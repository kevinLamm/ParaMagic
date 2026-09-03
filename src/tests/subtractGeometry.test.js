import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateSubtractExpression,
  isSubtractableEntity,
  subtractMaterialTarget,
  subtractBoundaryContours,
  subtractBoundaryFeatures,
  subtractBoundaryPath,
  subtractParentIds,
  subtractPlan,
  subtractPresentationDependsOn,
  prepareSubtractPresentationClone,
} from '../../packages/paramagic-core/src/modules/SubtractSystem.js';
import { createGeometryBinding } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { createSubtractSystem, subtractDrawingOwners, subtractDrawingResults } from '../../packages/paramagic-core/src/modules/SubtractSystem.js';
import { evaluateFilletedGeometry, filletTopologyConstraints } from '../../packages/paramagic-core/src/modules/FilletSystem.js';
import { findClosedGeometryCycles } from '../../packages/paramagic-core/src/modules/BoundaryTopology.js';
import {
  arrayDerivedOwnerId,
  materializeArraySubtractOwners,
  normalizeArrayDefinition,
} from '../../packages/paramagic-core/src/modules/ArrayTools.js';

const rect = (id, x, y, width, height, extra = {}) => ({ id, type: 'rect', x, y, width, height, ...extra });

test('subtract presentation skips records outside its cached dependency set', () => {
  const dependencies = new Set(['target-edge', 'cutter-edge']);
  assert.equal(subtractPresentationDependsOn(dependencies, new Set(['target-edge'])), true);
  assert.equal(subtractPresentationDependsOn(dependencies, new Set(['unrelated-edge'])), false);
  assert.equal(subtractPresentationDependsOn(dependencies), true);
});

test('standalone export keeps the authoritative subtract result and removes stylesheet-hidden source drawings', () => {
  const removed = [];
  const sourceFill = { remove: () => removed.push('source-fill') };
  const sourceGeometry = { remove: () => removed.push('source-geometry') };
  const subtractResult = { remove: () => removed.push('result') };
  let selector = '';
  const root = {
    querySelectorAll(value) {
      selector = value;
      return [sourceFill, sourceGeometry];
    },
  };

  assert.equal(prepareSubtractPresentationClone(root), root);
  assert.match(selector, /subtract-source-record \.resolved-boundary-visual/);
  assert.match(selector, /entity-record\.subtract-source-record \.selectable-entity/);
  assert.deepEqual(removed, ['source-fill', 'source-geometry']);
  assert.equal(removed.includes(subtractResult), false);
});

function closedCurvedCycle(kind, prefix, { subtract = false } = {}) {
  const curved = kind === 'arc'
    ? {
      id: `${prefix}-arc`, type: 'arc', start: [0, 0], arcPoint: [50, -50], end: [100, 0],
      center: [50, 0], radius: 50,
    }
    : {
      id: `${prefix}-curve`, type: 'curve', points: [[0, 0], [30, -50], [70, -50], [100, 0]],
    };
  const line = { id: `${prefix}-line`, type: 'line', start: [100, 0], end: [0, 0] };
  if (subtract) {
    [curved, line].forEach((entity) => {
      entity.subtract = true;
      entity.subtractExpression = 'TRUE';
    });
  }
  const curvedEndIndex = kind === 'arc' ? 2 : curved.points.length - 1;
  return {
    entities: [curved, line],
    curved,
    line,
    constraints: [
      {
        id: `${prefix}-start`, type: 'Coincident',
        featureRefs: [
          { recordId: curved.id, kind: 'point', index: 0 },
          { recordId: line.id, kind: 'point', index: 2 },
        ],
      },
      {
        id: `${prefix}-end`, type: 'Coincident',
        featureRefs: [
          { recordId: curved.id, kind: 'point', index: curvedEndIndex },
          { recordId: line.id, kind: 'point', index: 0 },
        ],
      },
    ],
  };
}

function fakeSvgElement(parent = null) {
  const classes = new Set();
  const element = {
    parent,
    children: [],
    attributes: new Map(),
    classList: {
      add: (...values) => values.forEach((value) => classes.add(value)),
      remove: (...values) => values.forEach((value) => classes.delete(value)),
      contains: (value) => classes.has(value),
      toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); },
    },
    style: {
      setProperty(name, value) { this[name] = String(value); },
    },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
    insertBefore(child, before) {
      const current = this.children.indexOf(child);
      if (current >= 0) this.children.splice(current, 1);
      const index = before ? this.children.indexOf(before) : -1;
      this.children.splice(index >= 0 ? index : 0, 0, child);
      child.parent = this;
    },
    remove() {
      if (!this.parent) return;
      const index = this.parent.children.indexOf(this);
      if (index >= 0) this.parent.children.splice(index, 1);
    },
  };
  Object.defineProperty(element, 'firstChild', { get: () => element.children[0] || null });
  return element;
}

test('Subtract expressions accept booleans and reject numeric results', () => {
  assert.deepEqual(evaluateSubtractExpression('cutFlag', (expression) => expression === 'cutFlag'), { value: true, error: null });
  assert.match(evaluateSubtractExpression('12', () => 12).error, /TRUE or FALSE/);
});

test('Subtract geometry supports only non-construction closed primitives', () => {
  assert.equal(isSubtractableEntity(rect('r', 0, 0, 10, 10)), true);
  assert.equal(isSubtractableEntity({ id: 'line', type: 'line', start: [0, 0], end: [10, 0] }), false);
  assert.equal(isSubtractableEntity(rect('construction', 0, 0, 10, 10, { construction: true })), false);
});

test('a cutter affects only the parent regions recorded on that cutter', () => {
  const first = rect('first-parent', 0, 0, 10, 10);
  const second = rect('second-parent', 20, 0, 10, 10);
  const cutter = rect('cutter', 5, 0, 20, 10, { subtractFrom: [first.id] });
  const presentation = subtractDrawingResults({ entities: [first, second, cutter] });

  assert.ok(presentation.results.some((result) => result.ownerId === first.id));
  assert.equal(presentation.results.some((result) => result.ownerId === second.id), false);
});

test('the Subtract system records multiple parents on the cutter and deletion removes its cuts', () => {
  const first = rect('first-parent', 0, 0, 10, 10);
  const second = rect('second-parent', 20, 0, 10, 10);
  const cutter = rect('cutter', 5, 0, 20, 10);
  const records = [first, second, cutter].map((entity) => ({
    id: entity.id,
    recordType: 'geometry',
    entity,
    group: null,
    node: null,
  }));
  const selectedIds = new Set([first.id]);
  const system = createSubtractSystem({
    records,
    selectedIds,
    solver: {
      constraints: () => [],
      evaluateParameterExpression: () => false,
      updateEntity: (entity) => entity,
    },
    addSvg: () => null,
    closedRegionNodes: new Set(),
    geometryAppearance: () => ({ fillColor: '#fff', fillOpacity: 1, strokeThickness: 1.5, strokeOpacity: 1 }),
    applyGeometryAppearance() {},
  });

  assert.equal(system.selectedParentOwner().id, first.id);
  assert.equal(system.addSubtractRelation(first.id, cutter.id).success, true);
  assert.equal(system.addSubtractRelation(second.id, cutter.id).success, true);
  assert.deepEqual(subtractParentIds(records[2].entity), [first.id, second.id]);
  assert.equal(records[2].entity.subtract, false);

  records.splice(2, 1);
  assert.equal(system.activeSubtractorOwners().length, 0);
  assert.equal(system.featuresForRecord(first.id).length, 0);
});

for (const kind of ['arc', 'curve']) {
  test(`a closed object containing a ${kind} can receive a Boolean subtraction`, () => {
    const cycle = closedCurvedCycle(kind, `${kind}-target`);
    const cutter = rect(`${kind}-rect-cutter`, 40, -60, 20, 30, {
      subtract: true,
      subtractExpression: 'TRUE',
    });
    const drawing = { entities: [...cycle.entities, cutter], constraints: cycle.constraints };
    const owner = subtractDrawingOwners(drawing).find((candidate) => (
      candidate.recordIds.includes(cycle.curved.id)
      && candidate.recordIds.includes(cycle.line.id)
    ));
    const result = subtractDrawingResults(drawing).results.find((candidate) => candidate.ownerId === owner?.id);

    assert.ok(owner);
    assert.ok(owner.boundary.features.some((feature) => feature.kind === kind));
    assert.ok(result);
    assert.equal(result.plan.intersects, true);
    assert.ok(result.plan.features.some((feature) => feature.boundaryRole === 'outer' && feature.sourceId === cycle.curved.id));
  });

  test(`a closed object containing a ${kind} can act as a Boolean cutter`, () => {
    const cycle = closedCurvedCycle(kind, `${kind}-cutter`, { subtract: true });
    const target = rect(`${kind}-rect-target`, -20, -70, 140, 90);
    const drawing = { entities: [target, ...cycle.entities], constraints: cycle.constraints };
    const owner = subtractDrawingOwners(drawing).find((candidate) => (
      candidate.recordIds.includes(cycle.curved.id)
      && candidate.recordIds.includes(cycle.line.id)
    ));
    const result = subtractDrawingResults(drawing).results.find((candidate) => candidate.ownerId === target.id);

    assert.ok(owner);
    assert.equal(owner.entity.subtract, true);
    assert.ok(result);
    assert.equal(result.plan.intersects, true);
    assert.ok(result.plan.features.some((feature) => feature.boundaryRole === 'subtract' && feature.sourceId === cycle.curved.id));
  });

  test(`the live Subtract system resolves a ${kind} cycle through any selected member`, () => {
    const cycle = closedCurvedCycle(kind, `${kind}-live-target`);
    const cutter = rect(`${kind}-live-cutter`, 40, -60, 20, 30, {
      subtract: true,
      subtractExpression: 'TRUE',
    });
    const records = [...cycle.entities, cutter].map((entity) => ({
      id: entity.id,
      recordType: 'geometry',
      entity,
      node: null,
      group: null,
    }));
    const system = createSubtractSystem({
      records,
      solver: {
        constraints: () => cycle.constraints,
        evaluateParameterExpression: () => true,
      },
      addSvg: () => null,
      closedRegionNodes: new Set(),
      geometryAppearance: () => ({ fillColor: '#fff', fillOpacity: 1, strokeThickness: 1.5, strokeOpacity: 1 }),
      applyGeometryAppearance() {},
    });

    system.refreshPresentation();
    const owner = system.ownerForRecord(cycle.curved.id);
    const plan = system.planFor(cycle.line.id);
    assert.ok(owner);
    assert.deepEqual(new Set(owner.recordIds), new Set([cycle.curved.id, cycle.line.id]));
    assert.ok(owner.boundary.features.some((feature) => feature.kind === kind));
    assert.equal(plan.intersects, true);
    assert.ok(plan.features.some((feature) => feature.boundaryRole === 'outer' && feature.sourceId === cycle.curved.id));
  });
}

test('SubtractSystem resolves a legacy cutter Notch onto its current visible arc', () => {
  const target = rect('target', 0, 0, 100, 100);
  const cutter = { id: 'cutter', type: 'circle', center: [50, 0], radius: 20, subtract: true, subtractExpression: 'TRUE' };
  const records = [
    { id: target.id, recordType: 'geometry', entity: target, node: null },
    { id: cutter.id, recordType: 'geometry', entity: cutter, node: null },
  ];
  const system = createSubtractSystem({
    records,
    solver: { evaluateParameterExpression: () => true },
    addSvg: () => null,
    subtractDefs: null,
    closedRegionNodes: new Set(),
    geometryAppearance: () => ({ fillColor: '#fff', fillOpacity: 1 }),
    applyGeometryAppearance() {},
    pointList: () => '',
  });

  const feature = system.featureForHost(
    { recordId: cutter.id, kind: 'circle', index: 0 },
    { parameter: Math.PI / 2, point: [50, 20] },
  );
  assert.equal(feature.sourceId, cutter.id);
  assert.equal(feature.targetId, target.id);
  assert.equal(feature.kind, 'arc');
  assert.equal(system.featuresForHost({ recordId: cutter.id, kind: 'circle' }).length, 1);
});

test('SubtractSystem consumes rectangular array placements as live derived cutters', () => {
  const target = rect('target', 0, 0, 140, 60);
  const cutter = {
    id: 'cutter', type: 'circle', center: [20, 0], radius: 10,
    subtract: true, subtractExpression: 'TRUE',
  };
  const records = [
    { id: target.id, recordType: 'geometry', entity: target, node: null },
    { id: cutter.id, recordType: 'geometry', entity: cutter, node: null },
  ];
  const definition = normalizeArrayDefinition({
    id: 'cutters', arrayType: 'rectangular', sourceIds: ['cutter'],
  });
  const evaluated = {
    valid: true,
    placements: [
      { translateX: 0, translateY: 0 },
      { translateX: 50, translateY: 0 },
      { translateX: 100, translateY: 0 },
    ],
  };
  const system = createSubtractSystem({
    records,
    solver: { evaluateParameterExpression: () => true },
    addSvg: () => null,
    closedRegionNodes: new Set(),
    geometryAppearance: () => ({ fillColor: '#fff', fillOpacity: 1 }),
    applyGeometryAppearance() {},
    getDerivedSubtractorOwners: (baseOwners) => (
      materializeArraySubtractOwners(definition, evaluated, baseOwners)
    ),
  });

  system.refreshPresentation();
  const firstPlan = system.planFor('target');
  const firstDerivedId = arrayDerivedOwnerId('cutters', 1, 'cutter');
  const secondDerivedId = arrayDerivedOwnerId('cutters', 2, 'cutter');
  assert.equal(firstPlan.intersects, true);
  assert.deepEqual(new Set(firstPlan.features
    .filter((feature) => feature.boundaryRole === 'subtract')
    .map((feature) => feature.sourceId)), new Set(['cutter', firstDerivedId, secondDerivedId]));
  const firstArrayFeature = firstPlan.features.find((feature) => (
    feature.sourceId === firstDerivedId && feature.center?.[0] === 70
  ));
  assert.ok(firstArrayFeature);
  assert.equal(firstArrayFeature.arrayId, definition.id);
  assert.equal(firstArrayFeature.arrayPlacementIndex, 1);
  assert.equal(firstArrayFeature.arraySourceId, cutter.id);
  assert.equal(system.featureForHost({
    recordId: target.id,
    sourceId: cutter.id,
    arrayId: definition.id,
    arrayPlacementIndex: 1,
    sourceFeatureIndex: firstArrayFeature.sourceFeatureIndex,
  }).sourceId, firstDerivedId);

  evaluated.placements[1].translateX = 60;
  system.refreshPresentation();
  const updatedPlan = system.planFor('target');
  assert.ok(updatedPlan.features.some((feature) => feature.sourceId === firstDerivedId && feature.center?.[0] === 80));
  assert.equal(updatedPlan.features.some((feature) => feature.sourceId === firstDerivedId && feature.center?.[0] === 70), false);
});

test('SubtractSystem consumes circular array placements around one target contour', () => {
  const target = rect('target', 0, 0, 140, 100);
  const cutter = {
    id: 'cutter', type: 'circle', center: [70, 0], radius: 10,
    subtract: true, subtractExpression: 'TRUE',
  };
  const records = [
    { id: target.id, recordType: 'geometry', entity: target, node: null },
    { id: cutter.id, recordType: 'geometry', entity: cutter, node: null },
  ];
  const definition = normalizeArrayDefinition({
    id: 'radial-cutters', arrayType: 'circular', sourceIds: ['cutter'], centerPoint: [70, 50],
  });
  const evaluated = {
    valid: true,
    placements: [{ angle: 0 }, { angle: 90 }, { angle: 180 }, { angle: 270 }],
  };
  const system = createSubtractSystem({
    records,
    solver: { evaluateParameterExpression: () => true },
    addSvg: () => null,
    closedRegionNodes: new Set(),
    geometryAppearance: () => ({ fillColor: '#fff', fillOpacity: 1 }),
    applyGeometryAppearance() {},
    getDerivedSubtractorOwners: (baseOwners) => materializeArraySubtractOwners(
      definition,
      evaluated,
      baseOwners,
      { centerPoint: [70, 50] },
    ),
  });

  system.refreshPresentation();
  const plan = system.planFor('target');
  const sourceIds = new Set(plan.features
    .filter((feature) => feature.boundaryRole === 'subtract')
    .map((feature) => feature.sourceId));
  assert.equal(plan.intersects, true);
  assert.equal(sourceIds.size, 4);
  assert.equal(subtractBoundaryPath(plan.features, plan.tolerance).closed, true);
});

test('SubtractSystem preserves a filleted composite boundary for Boolean tools', () => {
  const composite = { id: 'rounded-target', kind: 'rectangle', closed: true, count: 4 };
  const lines = [
    { id: 'edge-a', type: 'line', start: [0, 0], end: [100, 0], composite: { ...composite, index: 0 } },
    { id: 'edge-b', type: 'line', start: [100, 0], end: [100, 100], composite: { ...composite, index: 1 } },
    { id: 'edge-c', type: 'line', start: [100, 100], end: [0, 100], composite: { ...composite, index: 2 } },
    { id: 'edge-d', type: 'line', start: [0, 100], end: [0, 0], composite: { ...composite, index: 3 } },
  ];
  const fillet = {
    id: 'corner-fillet',
    type: 'fillet',
    sourceA: { recordId: 'edge-a', index: 2 },
    sourceB: { recordId: 'edge-b', index: 0 },
    radius: 10,
    construction: false,
  };
  const cutter = { id: 'cutter', type: 'circle', center: [40, 0], radius: 15, subtract: true };
  const records = [
    ...lines.map((entity) => ({ id: entity.id, recordType: 'geometry', entity, node: null })),
    { id: fillet.id, recordType: 'fillet', entity: fillet, node: null },
    { id: cutter.id, recordType: 'geometry', entity: cutter, node: null },
  ];
  const closedRegion = fakeSvgElement();
  closedRegion.dataset = { parentIds: [...lines.map(({ id }) => id), fillet.id].join(',') };
  const cycles = () => findClosedGeometryCycles(
    evaluateFilletedGeometry(records.map((record) => record.entity)),
    filletTopologyConstraints([], [fillet]),
  );
  const system = createSubtractSystem({
    records,
    solver: { evaluateParameterExpression: () => true },
    addSvg: () => null,
    subtractDefs: null,
    closedRegionNodes: new Set([closedRegion]),
    geometryAppearance: () => ({ fillColor: '#fff', fillOpacity: 1, strokeThickness: 1.5 }),
    applyGeometryAppearance() {},
    pointList: () => '',
    evaluateFilletedGeometry,
    getClosedCycles: cycles,
  });

  const owner = system.ownerForRecord('edge-a');
  const features = system.featuresForRecord('edge-a');
  assert.ok(owner.boundary.features.some((feature) => feature.kind === 'arc' && feature.sourceId === fillet.id));
  assert.ok(features.some((feature) => feature.kind === 'arc' && feature.sourceId === fillet.id));
  assert.ok(features.some((feature) => feature.sourceId === 'edge-a' && feature.end[0] < 91));
  assert.ok(owner.entity.boundaryPolygon.length > 4);
  assert.equal(
    subtractBoundaryPath(features, subtractPlan(owner.entity, [cutter]).tolerance).closed,
    true,
  );
  system.refreshPresentation();
  assert.equal(closedRegion.classList.contains('subtract-source-region'), true);
  assert.equal(closedRegion.attributes.get('fill'), 'transparent');
  assert.equal(closedRegion.attributes.get('fill-opacity'), '0');
  const resolvedFillet = system.featureForHost({
    recordId: 'edge-a',
    kind: 'arc',
    sourceId: fillet.id,
    targetId: composite.id,
    sourceFeatureIndex: 0,
    boundaryRole: 'outer',
    stableKey: `${composite.id}:${fillet.id}:outer:arc`,
  });
  assert.equal(resolvedFillet.sourceId, fillet.id);
});

test('SubtractSystem renders a filleted cutter from its solved analytic boundary', () => {
  const target = rect('target', 0, 0, 100, 100);
  const composite = { id: 'rounded-cutter', kind: 'rectangle', closed: true, count: 4 };
  const lines = [
    { id: 'cut-a', type: 'line', start: [30, -20], end: [70, -20], composite: { ...composite, index: 0 }, subtract: true, subtractExpression: 'TRUE' },
    { id: 'cut-b', type: 'line', start: [70, -20], end: [70, 20], composite: { ...composite, index: 1 } },
    { id: 'cut-c', type: 'line', start: [70, 20], end: [30, 20], composite: { ...composite, index: 2 } },
    { id: 'cut-d', type: 'line', start: [30, 20], end: [30, -20], composite: { ...composite, index: 3 } },
  ];
  const fillet = {
    id: 'cutter-fillet',
    type: 'fillet',
    sourceA: { recordId: 'cut-b', index: 2 },
    sourceB: { recordId: 'cut-c', index: 0 },
    radius: 10,
    construction: false,
  };
  const records = [
    { id: target.id, recordType: 'geometry', entity: target, node: null },
    ...lines.map((entity) => ({ id: entity.id, recordType: 'geometry', entity, node: null })),
    { id: fillet.id, recordType: 'fillet', entity: fillet, node: null },
  ];
  const cycles = () => findClosedGeometryCycles(
    evaluateFilletedGeometry(records.map((record) => record.entity)),
    filletTopologyConstraints([], [fillet]),
  );
  const system = createSubtractSystem({
    records,
    solver: { evaluateParameterExpression: () => true },
    addSvg: () => null,
    closedRegionNodes: new Set(),
    geometryAppearance: () => ({ fillColor: '#fff', fillOpacity: 1, strokeThickness: 1.5 }),
    applyGeometryAppearance() {},
    evaluateFilletedGeometry,
    getClosedCycles: cycles,
  });

  const plan = system.planFor('target') || (() => {
    system.refreshPresentation();
    return system.planFor('target');
  })();
  assert.equal(plan.intersects, true);
  assert.ok(plan.features.some((feature) => (
    feature.boundaryRole === 'subtract'
    && feature.kind === 'arc'
    && feature.sourceId === fillet.id
  )));
  assert.equal(plan.features.some((feature) => feature.sourceId === composite.id), false);
  assert.equal(subtractBoundaryPath(plan.features, plan.tolerance).closed, true);
});

test('disjoint cutters leave the target unchanged', () => {
  const plan = subtractPlan(rect('target', 0, 0, 10, 10), [rect('cutter', 20, 20, 2, 2)]);
  assert.equal(plan.intersects, false);
  assert.equal(plan.materialEmpty, false);
  assert.deepEqual(plan.features, []);
});

test('tangent contact does not remove material or create a cut boundary', () => {
  const plan = subtractPlan(rect('target', 0, 0, 10, 10), [rect('cutter', 10, 0, 2, 10)]);
  assert.equal(plan.intersects, false);
  assert.equal(plan.materialEmpty, false);
  assert.deepEqual(plan.features, []);
});

test('coincident outer edges still produce the interior cut boundary', () => {
  const plan = subtractPlan(rect('target', 0, 0, 10, 10), [rect('cutter', -2, 0, 4, 10)]);
  assert.equal(plan.intersects, true);
  assert.ok(plan.features.some((feature) => feature.boundaryRole === 'subtract' && feature.sourceId === 'cutter'));
  assert.ok(plan.features.some((feature) => feature.boundaryRole === 'outer' && feature.sourceId === 'target'));
  assert.equal(plan.features.some((feature) => (
    feature.boundaryRole === 'outer'
    && feature.kind === 'segment'
    && Math.min(feature.start[0], feature.end[0]) < 2
    && (Math.abs(feature.start[1]) < 1e-8 || Math.abs(feature.start[1] - 10) < 1e-8)
  )), false);
});

test('solver-scale deviations around a coincident edge preserve the same visible topology', () => {
  const summaries = [-1e-6, 0, 1e-6].map((offset) => {
    const plan = subtractPlan(
      rect('target', 0, 0, 10, 10),
      [rect('cutter', -2, offset, 4, 10)],
    );
    return plan.features.map((feature) => ({
      role: feature.boundaryRole,
      sourceFeatureIndex: feature.sourceFeatureIndex,
      sourceId: feature.sourceId,
    }));
  });
  assert.deepEqual(summaries[0], summaries[1]);
  assert.deepEqual(summaries[1], summaries[2]);
});

test('Boolean boundary features form deterministic closed result contours', () => {
  const plan = subtractPlan(rect('target', 0, 0, 20, 20), [
    { id: 'cutter', type: 'circle', center: [10, 10], radius: 4 },
  ]);
  const contours = subtractBoundaryContours(plan.features, plan.tolerance);
  assert.equal(contours.length, 2);
  assert.ok(contours.every(({ closed }) => closed));
  assert.ok(contours.some(({ features }) => features.some(({ kind }) => kind === 'circle')));
  assert.ok(contours.some(({ features }) => features.every(({ boundaryRole }) => boundaryRole === 'outer')));
  const path = subtractBoundaryPath(plan.features, plan.tolerance);
  assert.equal(path.closed, true);
  assert.equal((path.d.match(/\bM\b/g) || []).length, 2);
  assert.equal((path.d.match(/\bZ\b/g) || []).length, 2);
  assert.match(path.d, /\bA 4 4\b/);
});

test('SubtractSystem renders one authoritative result path and retains source geometry only as overlays', () => {
  const target = rect('target', 0, 0, 10, 10);
  const cutter = rect('cutter', -2, 0, 4, 10, { subtract: true, subtractExpression: 'TRUE' });
  const records = [target, cutter].map((entity) => {
    const group = fakeSvgElement();
    const node = fakeSvgElement(group);
    group.children.push(node);
    return { id: entity.id, recordType: 'geometry', entity, group, node };
  });
  const addSvg = (parent, type, attributes) => {
    const node = fakeSvgElement(parent);
    node.type = type;
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
    parent.children.push(node);
    return node;
  };
  const system = createSubtractSystem({
    records,
    solver: { evaluateParameterExpression: (expression) => expression === 'TRUE' },
    addSvg,
    closedRegionNodes: new Set(),
    geometryAppearance: () => ({
      fillColor: '#ffffff', fillOpacity: 1, strokeThickness: 1.5, strokeOpacity: 1,
    }),
    fillPaint: () => '#ffffff',
    applyGeometryAppearance() {},
  });

  system.refreshPresentation();
  system.refreshPresentation();
  const resultNodes = records[0].group.children.filter((node) => node.attributes.get('data-subtract-result') === 'target');
  assert.equal(resultNodes.length, 1);
  assert.equal(resultNodes[0].attributes.get('fill-rule'), 'evenodd');
  assert.equal(resultNodes[0].attributes.get('stroke'), '#000000');
  assert.match(resultNodes[0].attributes.get('d'), /M 2 0/);
  assert.equal(records[0].group.classList.contains('subtract-source-record'), true);
  assert.equal(records[1].group.classList.contains('subtract-source-record'), true);
  assert.equal(records[0].node.attributes.get('fill'), 'transparent');
  assert.equal(records[1].node.attributes.get('fill'), 'transparent');

  records.splice(1, 1);
  system.refreshPresentation();
  assert.equal(records[0].group.children.some((node) => node.attributes.get('data-subtract-result') === 'target'), false);
  assert.equal(records[0].group.classList.contains('subtract-source-record'), false);
});

test('an intersecting cutter exposes target and cut boundary pieces with stable source references', () => {
  const plan = subtractPlan(rect('target', 0, 0, 10, 10), [rect('cutter', 5, -2, 4, 6)]);
  assert.equal(plan.intersects, true);
  assert.ok(plan.features.some((feature) => feature.boundaryRole === 'outer' && feature.sourceId === 'target'));
  assert.ok(plan.features.some((feature) => feature.boundaryRole === 'subtract' && feature.sourceId === 'cutter'));
  assert.ok(plan.features.every((feature) => feature.stableKey.includes(feature.sourceId)));
});

test('a cutter fully covering the target reports empty material', () => {
  const plan = subtractPlan(rect('target', 1, 1, 4, 4), [rect('cutter', 0, 0, 10, 10)]);
  assert.equal(plan.intersects, true);
  assert.equal(plan.materialEmpty, true);
});

test('overlapping cutters produce one visible boundary set without internal overlap edges', () => {
  const plan = subtractPlan(
    rect('target', 0, 0, 20, 20),
    [rect('first', 2, 2, 10, 10), rect('second', 8, 2, 10, 10)],
  );
  const keys = new Set(plan.features.map((feature) => feature.stableKey));
  assert.equal(keys.size, plan.features.length);
  assert.ok(plan.features.some((feature) => feature.sourceId === 'first'));
  assert.ok(plan.features.some((feature) => feature.sourceId === 'second'));
});

test('Subtract relationships survive geometry binding updates and snapshots', () => {
  const binding = createGeometryBinding({
    id: 'target',
    type: 'rect',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    subtract: true,
    subtractExpression: 'cutFlag',
    subtractFrom: ['parent-a', 'parent-b'],
  });
  assert.equal(binding.toEntity().subtract, true);
  assert.equal(binding.toEntity().subtractExpression, 'cutFlag');
  assert.deepEqual(binding.toEntity().subtractFrom, ['parent-a', 'parent-b']);
  binding.updateFromEntity({
    ...binding.toEntity(),
    x: 4,
    y: 5,
    subtract: false,
    subtractExpression: 'FALSE',
    subtractFrom: ['parent-b'],
  });
  assert.equal(binding.toEntity().subtract, false);
  assert.equal(binding.toEntity().subtractExpression, 'FALSE');
  assert.deepEqual(binding.toEntity().subtractFrom, ['parent-b']);
});

test('ordinary geometry bindings do not gain Subtract fields implicitly', () => {
  const binding = createGeometryBinding(rect('ordinary', 0, 0, 10, 10));
  const entity = binding.toEntity();
  assert.equal(Object.prototype.hasOwnProperty.call(entity, 'subtract'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(entity, 'subtractExpression'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(entity, 'subtractFrom'), false);
});

test('cut-boundary material targets lie inside the parent and outside the cutter', () => {
  const target = rect('target', 0, 0, 20, 20);
  const cutter = { id: 'cutter', type: 'circle', center: [10, 10], radius: 4 };
  const material = subtractMaterialTarget([14, 10], [0, 1], target, [cutter], [0.1]);
  assert.deepEqual(material, [14.1, 10]);
});

test('circular cut boundaries remain analytic circles or arcs', () => {
  const full = subtractPlan(rect('target', 0, 0, 20, 20), [
    { id: 'cutter', type: 'circle', center: [10, 10], radius: 4 },
  ]);
  const fullCut = full.features.filter((feature) => feature.boundaryRole === 'subtract');
  assert.equal(fullCut.length, 1);
  assert.equal(fullCut[0].kind, 'circle');

  const partial = subtractPlan(rect('target', 0, 0, 20, 20), [
    { id: 'cutter', type: 'circle', center: [10, 2], radius: 5 },
  ]);
  const partialCut = partial.features.filter((feature) => feature.boundaryRole === 'subtract');
  assert.ok(partialCut.length >= 1);
  assert.ok(partialCut.every((feature) => feature.kind === 'arc'));
  const partialPath = subtractBoundaryPath(partial.features, partial.tolerance);
  assert.equal(partialPath.closed, true);
  assert.match(partialPath.d, /\bA 5 5\b/);
});
