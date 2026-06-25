import { createGeometryBinding } from './GeometryBindings.js';
import { createStableId } from './Variable.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export class SketchModel {
  constructor() {
    this.entities = new Map();
    this.constraints = new Map();
  }

  addEntity(entity) {
    const binding = createGeometryBinding(entity);
    if (this.entities.has(binding.id)) throw new Error(`Duplicate entity ID: ${binding.id}`);
    this.entities.set(binding.id, binding);
    return binding.toEntity();
  }

  updateEntity(entity) {
    const binding = this.entities.get(entity.id);
    if (!binding) throw new Error(`Unknown entity: ${entity.id}`);
    if (!binding.updateFromEntity(entity)) throw new Error(`Invalid ${entity.type} geometry.`);
    return binding.toEntity();
  }

  removeEntity(entityId) {
    const removed = this.entities.delete(entityId);
    for (const [constraintId, constraint] of this.constraints) {
      const text = JSON.stringify(constraint);
      if (text.includes(`\"${entityId}\"`)) this.constraints.delete(constraintId);
    }
    return removed;
  }

  clear() {
    this.entities.clear();
    this.constraints.clear();
  }

  addConstraint(input) {
    const constraint = clone({ ...input, id: input.id || createStableId('constraint'), enabled: input.enabled !== false });
    this.constraints.set(constraint.id, constraint);
    this.refreshFixedVariables();
    return clone(constraint);
  }

  removeConstraint(constraintId) {
    const removed = this.constraints.delete(constraintId);
    this.refreshFixedVariables();
    return removed;
  }

  refreshFixedVariables() {
    this.allVariables().forEach((variable) => { variable.fixed = false; });
    for (const constraint of this.constraints.values()) {
      if (constraint.enabled === false || constraint.type !== 'Fixed') continue;
      for (const feature of constraint.featureRefs || []) {
        this.variableIdsForFeature(feature).forEach((id) => {
          const variable = this.variableById(id);
          if (variable) variable.fixed = true;
        });
      }
    }
  }

  binding(entityId) {
    return this.entities.get(entityId) || null;
  }

  entity(entityId) {
    return this.binding(entityId)?.toEntity() || null;
  }

  snapshot() {
    return [...this.entities.values()].map((binding) => binding.toEntity());
  }

  allVariables() {
    return [...this.entities.values()].flatMap((binding) => binding.allVariables());
  }

  activeVariables() {
    return this.allVariables().filter((variable) => variable.active);
  }

  variableById(id) {
    return this.allVariables().find((variable) => variable.id === id) || null;
  }

  resolvePoint(ref) {
    if (!ref) return null;
    const binding = this.binding(ref.entityId || ref.recordId);
    if (!binding) return null;
    if (ref.type === 'segment-start' || ref.type === 'segment-end') {
      const segment = binding.segmentFeature(ref.index || 0);
      return segment ? [...(ref.type === 'segment-start' ? segment.start : segment.end)] : null;
    }
    if (ref.type === 'center') return binding.entityFeature()?.center || null;
    return binding.pointFeature(ref.index || 0);
  }

  resolveSegment(ref) {
    if (!ref) return null;
    return this.binding(ref.entityId || ref.recordId)?.segmentFeature(ref.index || 0) || null;
  }

  resolveEntity(ref) {
    if (!ref) return null;
    return this.binding(ref.entityId || ref.recordId)?.entityFeature() || null;
  }

  resolveFeature(ref) {
    if (ref?.kind === 'point') return { kind: 'point', point: this.resolvePoint(ref) };
    if (ref?.kind === 'segment') return { kind: 'segment', ...this.resolveSegment(ref) };
    return this.resolveEntity(ref);
  }

  variableIdsForFeature(ref) {
    const binding = this.binding(ref?.entityId || ref?.recordId);
    if (!binding) return [];
    if (ref.kind === 'point' || ref.type === 'point') return binding.variableIdsForPoint(ref.index || 0);
    if (ref.kind === 'segment' || ref.type === 'segment-start' || ref.type === 'segment-end') return binding.variableIdsForSegment(ref.index || 0);
    if (ref.kind === 'circle' || ref.kind === 'arc' || ref.type === 'center' || ref.type === 'radius') return binding.allVariables().map((variable) => variable.id);
    return binding.allVariables().map((variable) => variable.id);
  }

  intrinsicResiduals() {
    return [...this.entities.values()].flatMap((binding) => binding.intrinsicResiduals());
  }
}
