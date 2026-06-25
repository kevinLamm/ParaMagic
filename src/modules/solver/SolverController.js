import { ConstraintRegistry } from './ConstraintRegistry.js';
import { DimensionRepository } from './DimensionRepository.js';
import { SketchModel } from './SketchModel.js';
import { solveLevenbergMarquardt } from './LevenbergMarquardt.js';
import { isSuccessfulSolve } from './SolverDiagnostics.js';
import { createStableId } from './Variable.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function restoreEntities(model, snapshot) {
  snapshot.forEach((entity) => model.updateEntity(entity));
}

function dimensionValue(entity) {
  if (entity.type === 'dimension-line') {
    const a = entity.measureStart || entity.start;
    const b = entity.measureEnd || entity.end;
    if (entity.subtype === 'horizontal') return Math.abs(b[0] - a[0]);
    if (entity.subtype === 'vertical') return Math.abs(b[1] - a[1]);
    return distance(entity.start, entity.end);
  }
  if (entity.type === 'radius-dimension') return entity.radius;
  if (entity.type === 'angle-dimension') {
    const a = Math.atan2(entity.start[1] - entity.vertex[1], entity.start[0] - entity.vertex[0]);
    const b = Math.atan2(entity.end[1] - entity.vertex[1], entity.end[0] - entity.vertex[0]);
    return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) * 180 / Math.PI;
  }
  return 0;
}

function dimensionValueFromModel(entity, model) {
  if (entity.type === 'dimension-line') {
    const startAnchor = entity.anchors?.measureStart || entity.anchors?.start;
    const endAnchor = entity.anchors?.measureEnd || entity.anchors?.end;
    const a = model.resolvePoint(startAnchor) || entity.measureStart || entity.start;
    const b = model.resolvePoint(endAnchor) || entity.measureEnd || entity.end;
    if (entity.subtype === 'horizontal') return Math.abs(b[0] - a[0]);
    if (entity.subtype === 'vertical') return Math.abs(b[1] - a[1]);
    return distance(a, b);
  }
  if (entity.type === 'radius-dimension') {
    return model.resolveEntity({ recordId: entity.anchors?.center?.recordId })?.radius ?? entity.radius;
  }
  if (entity.type === 'angle-dimension') {
    const first = model.resolveSegment(segmentRefFromAnchors(entity.anchors?.firstSegment));
    const second = model.resolveSegment(segmentRefFromAnchors(entity.anchors?.secondSegment));
    if (!first || !second) return dimensionValue(entity);
    const firstAngle = Math.atan2(first.end[1] - first.start[1], first.end[0] - first.start[0]);
    const secondAngle = Math.atan2(second.end[1] - second.start[1], second.end[0] - second.start[0]);
    return Math.abs(Math.atan2(Math.sin(secondAngle - firstAngle), Math.cos(secondAngle - firstAngle))) * 180 / Math.PI;
  }
  if (entity.type === 'multi-curve-length-dimension') {
    return (entity.anchors?.features || []).reduce((total, ref) => {
      const feature = model.resolveFeature(ref);
      if (feature?.kind === 'segment') return total + distance(feature.start, feature.end);
      if (feature?.kind === 'circle') return total + Math.PI * 2 * feature.radius;
      if (feature?.kind === 'arc') {
        const startAngle = Math.atan2(feature.start[1] - feature.center[1], feature.start[0] - feature.center[0]);
        const endAngle = Math.atan2(feature.end[1] - feature.center[1], feature.end[0] - feature.center[0]);
        const tau = Math.PI * 2;
        const normalize = (angle) => (angle + tau) % tau;
        const span = feature.ccw ? normalize(endAngle - startAngle) : normalize(startAngle - endAngle);
        return total + feature.radius * span;
      }
      if (feature?.kind === 'curve') return total + feature.points.slice(1).reduce((sum, point, index) => sum + distance(feature.points[index], point), 0);
      return total;
    }, 0);
  }
  return dimensionValue(entity);
}

function segmentRefFromAnchors(anchors) {
  const anchor = anchors?.start || anchors?.end;
  return anchor ? { kind: 'segment', recordId: anchor.recordId, index: anchor.index || 0 } : null;
}

export class SolverController {
  constructor() {
    this.model = new SketchModel();
    this.dimensions = new DimensionRepository();
    this.registry = new ConstraintRegistry();
    this.listeners = new Set();
    this.lastResult = null;
    this.dragLocks = new Set();
    this.dimensionConstraints = new Map();
    this.dimensionAnnotations = new Map();
    this.drawingUnit = 'in';
  }

  emit() {
    const snapshot = this.getGeometrySnapshot();
    this.listeners.forEach((listener) => listener(snapshot, this.lastResult));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addEntity(entity) {
    const created = this.model.addEntity(entity);
    this.emit();
    return created;
  }

  removeEntity(entityId) {
    const removed = this.model.removeEntity(entityId);
    if (removed) this.emit();
    return removed;
  }

  updateEntityAppearances(updates = []) {
    const changed = [];
    updates.forEach(({ id, appearance }) => {
      const current = this.model.entity(id);
      if (!current || current.construction) return;
      changed.push(this.model.updateEntity({ ...current, appearance: clone(appearance) }));
    });
    if (changed.length) this.emit();
    return changed;
  }

  updateEntityConstruction(entityIds = [], construction = false) {
    const changed = [];
    entityIds.forEach((id) => {
      const current = this.model.entity(id);
      if (!current) return;
      changed.push(this.model.updateEntity({ ...current, construction: Boolean(construction) }));
    });
    if (changed.length) this.emit();
    return changed;
  }

  evaluateParameterExpression(expression) {
    return this.dimensions.evaluateExpression(expression);
  }

  clear() {
    this.model.clear();
    this.dimensions.clear();
    this.dimensionConstraints.clear();
    this.dimensionAnnotations.clear();
    this.lastResult = null;
    this.emit();
  }

  loadSketch(snapshot) {
    this.model.clear();
    this.dimensions.clear();
    this.dimensionConstraints.clear();
    this.dimensionAnnotations.clear();
    this.drawingUnit = snapshot?.drawingUnit || 'in';
    (snapshot?.entities || []).forEach((entity) => this.model.addEntity(entity));
    const parameters = snapshot?.parameters || snapshot?.dimensions;
    if (parameters) this.dimensions.restore(parameters);
    (snapshot?.dimensionAnnotations || []).forEach((annotation) => {
      if (annotation.dimensionId) this.dimensionAnnotations.set(annotation.dimensionId, clone(annotation));
    });
    this.dimensions.list().forEach((entry) => {
      if (!entry.computed) return;
      this.dimensions.setComputedResolver(entry.id, () => {
        const annotation = this.dimensionAnnotations.get(entry.id);
        return annotation ? dimensionValueFromModel(annotation, this.model) : entry.value;
      });
    });
    this.dimensions.evaluateAll({ strict: false });
    (snapshot?.constraints || []).forEach((constraint) => {
      this.registry.validate(this.model, constraint, this.dimensions);
      this.model.addConstraint(constraint);
      if (constraint.dimensionRef) this.dimensionConstraints.set(constraint.dimensionRef, constraint.id);
    });
    this.lastResult = this.solve();
    this.emit();
    return this.lastResult;
  }

  getSketchSnapshot() {
    const parameters = this.dimensions.snapshot();
    return {
      drawingUnit: this.drawingUnit,
      entities: this.getGeometrySnapshot(),
      constraints: this.constraints(),
      parameters,
      dimensions: clone(parameters),
      dimensionAnnotations: [...this.dimensionAnnotations.values()].map(clone),
    };
  }

  solve() {
    // Sample driven dimensions once. Their cached values may be consumed by
    // driving expressions, but their measured geometry must not participate
    // in the Jacobian as though the measurement were a constraint.
    this.dimensions.evaluateAll({ strict: false, refreshComputed: true });
    this.lastResult = solveLevenbergMarquardt({ model: this.model, registry: this.registry, dimensions: this.dimensions });
    // Refresh displayed measurements after driving constraints have moved
    // their own target geometry.
    this.dimensions.evaluateAll({ strict: false, refreshComputed: true });
    return this.lastResult;
  }

  updateEntities(entities, { lockedVariableIds = [] } = {}) {
    const before = this.model.snapshot();
    const fixedValues = new Map(this.model.allVariables().filter((variable) => variable.fixed).map((variable) => [variable.id, variable.value]));
    try {
      entities.forEach((entity) => this.model.updateEntity(entity));
      fixedValues.forEach((value, id) => { const variable = this.model.variableById(id); if (variable) variable.value = value; });
    } catch (error) {
      restoreEntities(this.model, before);
      this.lastResult = { status: 'invalid', message: error.message, changedEntityIds: [] };
      this.emit();
      return { result: this.lastResult, snapshot: this.getGeometrySnapshot() };
    }
    const locks = new Set([...this.dragLocks, ...lockedVariableIds]);
    locks.forEach((id) => { const variable = this.model.variableById(id); if (variable) variable.locked = true; });
    const result = this.solve();
    locks.forEach((id) => { const variable = this.model.variableById(id); if (variable) variable.locked = false; });
    if (!isSuccessfulSolve(result)) restoreEntities(this.model, before);
    this.emit();
    return { result, snapshot: this.getGeometrySnapshot() };
  }

  addConstraint(input) {
    const before = this.model.snapshot();
    const constraint = { ...clone(input), id: input.id || createStableId('constraint') };
    try {
      this.registry.validate(this.model, constraint, this.dimensions);
    } catch (error) {
      this.lastResult = { status: 'invalid', message: error.message, changedEntityIds: [] };
      this.emit();
      return { constraint: null, result: this.lastResult, snapshot: this.getGeometrySnapshot() };
    }
    this.model.addConstraint(constraint);
    const result = this.solve();
    if (!isSuccessfulSolve(result)) {
      this.model.removeConstraint(constraint.id);
      restoreEntities(this.model, before);
      this.emit();
      return { constraint: null, result, snapshot: this.getGeometrySnapshot() };
    }
    this.emit();
    return { constraint, result, snapshot: this.getGeometrySnapshot() };
  }

  removeConstraint(id) {
    const removed = this.model.removeConstraint(id);
    if (removed) {
      this.lastResult = this.solve();
      this.emit();
    }
    return removed;
  }

  constraints() {
    return [...this.model.constraints.values()].map(clone);
  }

  beginDrag(variableIds) {
    this.dragLocks = new Set(variableIds);
  }

  endDrag() {
    this.dragLocks.clear();
    const result = this.solve();
    this.emit();
    return result;
  }

  variableIdsForFeature(feature) {
    return this.model.variableIdsForFeature(feature);
  }

  variableIdsForEntity(entityId) {
    return this.model.binding(entityId)?.allVariables().map((variable) => variable.id) || [];
  }

  addDimension(entity) {
    const dimension = clone({ id: entity.id || createStableId('dimension-annotation'), ...entity });
    const value = dimensionValue(dimension);
    const driving = dimension.dimensionMode === 'driving';
    const unit = dimension.type === 'angle-dimension' ? 'deg' : this.drawingUnit;
    const entry = this.dimensions.addDimension({
      id: dimension.dimensionId || createStableId('dimension'),
      name: dimension.dimensionName,
      expression: this.dimensions.formatValue(value, unit),
      value,
      driving,
      unit,
      annotationId: dimension.id,
    });
    dimension.dimensionId = entry.id;
    dimension.dimensionName = entry.name;
    this.dimensionAnnotations.set(entry.id, clone(dimension));
    const fallbackToDriven = (result) => {
      this.dimensions.remove(entry.id, { allowDimension: true });
      const drivenEntity = { ...dimension, dimensionMode: 'driven' };
      const drivenEntry = this.dimensions.addDimension({ id: entry.id, name: entry.name, value, driving: false, unit: entry.unit, annotationId: dimension.id });
      this.dimensionAnnotations.set(drivenEntry.id, clone(drivenEntity));
      this.dimensions.setComputedResolver(drivenEntry.id, () => dimensionValueFromModel(this.dimensionAnnotations.get(drivenEntry.id), this.model));
      return { entity: drivenEntity, result };
    };
    if (!driving) {
      this.dimensions.setComputedResolver(entry.id, () => dimensionValueFromModel(this.dimensionAnnotations.get(entry.id), this.model));
      return { entity: dimension, result: null };
    }
    let constraint = null;
    if (dimension.type === 'dimension-line') {
      const subtype = dimension.subtype === 'horizontal' ? 'Horizontal Distance' : dimension.subtype === 'vertical' ? 'Vertical Distance' : 'Distance';
      constraint = {
        type: subtype,
        source: 'dimension',
        anchors: { start: dimension.anchors?.measureStart || dimension.anchors?.start, end: dimension.anchors?.measureEnd || dimension.anchors?.end },
        featureRefs: [],
        dimensionRef: entry.id,
      };
    }
    if (dimension.type === 'radius-dimension') constraint = { type: 'Radius', source: 'dimension', featureRefs: [{ kind: 'circle', recordId: dimension.anchors?.center?.recordId }], dimensionRef: entry.id };
    if (dimension.type === 'angle-dimension') {
      constraint = {
        type: 'Angle',
        source: 'dimension',
        featureRefs: [segmentRefFromAnchors(dimension.anchors?.firstSegment), segmentRefFromAnchors(dimension.anchors?.secondSegment)],
        dimensionRef: entry.id,
      };
    }
    if (!constraint || constraint.featureRefs?.some((ref) => !ref) || (constraint.anchors && (!constraint.anchors.start || !constraint.anchors.end))) {
      return fallbackToDriven({ status: 'invalid', message: 'Driving dimension is not linked to solvable geometry.' });
    }
    let added;
    try {
      added = this.addConstraint(constraint);
    } catch (error) {
      return fallbackToDriven({ status: 'invalid', message: error.message });
    }
    if (!added.constraint) {
      return fallbackToDriven(added.result);
    }
    this.dimensionConstraints.set(entry.id, added.constraint.id);
    return { entity: dimension, result: added.result };
  }

  setDimension(idOrName, expression) {
    const beforeDimensions = this.dimensions.snapshot();
    const beforeGeometry = this.model.snapshot();
    const existing = this.dimensions.get(idOrName);
    if (!existing) return { status: 'invalid', message: `Unknown dimension: ${idOrName}` };
    try {
      this.dimensions.set({ ...existing, expression });
    } catch (error) {
      this.dimensions.restore(beforeDimensions);
      return { status: 'invalid', message: error.message };
    }
    const result = this.solve();
    if (!isSuccessfulSolve(result)) {
      this.dimensions.restore(beforeDimensions);
      restoreEntities(this.model, beforeGeometry);
    }
    this.emit();
    return result;
  }

  removeDimension(dimensionId) {
    const constraintId = this.dimensionConstraints.get(dimensionId);
    if (constraintId) this.model.removeConstraint(constraintId);
    this.dimensionConstraints.delete(dimensionId);
    this.dimensionAnnotations.delete(dimensionId);
    const removed = this.dimensions.remove(dimensionId, { allowDimension: true });
    if (removed) {
      this.lastResult = this.solve();
      this.emit();
    }
    return removed;
  }

  parameters() {
    this.dimensions.evaluateAll({ strict: false });
    return this.dimensions.list();
  }

  getDimensionText(idOrName, mode = 'named-value') {
    this.dimensions.evaluateAll({ strict: false });
    const entry = this.dimensions.get(idOrName);
    if (!entry) return '';
    if (mode === 'expression') return `${entry.name} = ${entry.expression}`;
    const valueText = this.dimensions.formatValue(entry.value, entry.unit);
    return mode === 'value' ? valueText : `${entry.name} = ${valueText}`;
  }

  createParameter(input = {}) {
    return this.dimensions.createUser(input);
  }

  updateParameter(id, patch) {
    const beforeDimensions = this.dimensions.snapshot();
    const beforeGeometry = this.model.snapshot();
    let entry;
    try {
      entry = this.dimensions.update(id, patch, { strict: false });
    } catch (error) {
      return { entry: this.dimensions.get(id), result: { status: 'invalid', message: error.message } };
    }
    const invalidDriving = this.dimensions.list().some((candidate) => candidate.kind === 'dimension' && candidate.driving && candidate.error);
    if (invalidDriving || entry.error) return { entry, result: { status: 'invalid', message: entry.error || 'A driving expression is invalid.' } };
    const result = this.solve();
    if (!isSuccessfulSolve(result)) {
      this.dimensions.restore(beforeDimensions);
      restoreEntities(this.model, beforeGeometry);
    }
    this.emit();
    return { entry: this.dimensions.get(id), result };
  }

  removeParameter(id) {
    const removed = this.dimensions.remove(id);
    if (removed) {
      this.lastResult = this.solve();
      this.emit();
    }
    return removed;
  }

  reorderParameter(id, beforeId = null) {
    return this.dimensions.reorder(id, beforeId);
  }

  getGeometrySnapshot() {
    return this.model.snapshot();
  }

  getEntity(entityId) {
    return this.model.entity(entityId);
  }
}

export function createSolverController() {
  return new SolverController();
}
