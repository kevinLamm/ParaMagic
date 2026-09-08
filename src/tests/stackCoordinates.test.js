import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { GLOBAL_LAYER_ID, stackFrameFor, transformStackPoint, transformStackEntity, updateStackAxes } from '../../packages/paramagic-core/src/modules/StackCoordinates.js';
import { createDxfDimensionPlans } from '../../packages/paramagic-core/src/modules/DxfDimensionExport.js';
import { createStackSystem } from '../../packages/paramagic-core/src/modules/StackSystem.js';
import { SolverWorkerRuntime } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerRuntime.js';
import { createSolverWorkerRequest } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerProtocol.js';
import { canvasOriginPointFeature } from '../../packages/paramagic-core/src/modules/CanvasOrigin.js';
import { candidateFromSelections } from '../../packages/paramagic-core/src/modules/DimensionSystem.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);
function assembly() {
  const solver = createSolverController();
  solver.setStackState({ version: 6, activeStackId: 'a', stacks: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  solver.addEntity({ id: 'edge-a', type: 'line', stackId: 'a', start: [0, 0], end: [10, 10] });
  solver.addEntity({ id: 'edge-b', type: 'line', stackId: 'b', start: [30, 0], end: [40, 0] });
  solver.addEntity({ id: 'loose-b', type: 'circle', stackId: 'b', center: [35, 5], radius: 2 });
  return solver;
}
const segment = (id) => ({ kind: 'segment', recordId: id, index: 0 });
const point = (id, index = 0) => ({ kind: 'point', recordId: id, index });

test('empty persisted Global frames resolve to the identity coordinate system', () => {
  const state = {
    activeStackId: null,
    stacks: [{ id: GLOBAL_LAYER_ID, kind: 'global', frame: {} }],
  };

  assert.deepEqual(stackFrameFor(state, GLOBAL_LAYER_ID), { x: 0, y: 0, rotation: 0 });
  assert.deepEqual(transformStackPoint([12, -8], stackFrameFor(state, GLOBAL_LAYER_ID)), [12, -8]);
});

test('global parallel rotates the inactive Stack without changing any local shape', () => {
  const solver = assembly();
  solver.addConstraint({ type: 'Horizontal', featureRefs: [segment('edge-b')] });
  const local = solver.model.binding('edge-b').toEntity();
  const circle = solver.model.binding('loose-b').toEntity();
  const reference = solver.model.entity('edge-a');
  const outcome = solver.addConstraint({ type: 'Parallel', featureRefs: [segment('edge-a'), segment('edge-b')] });
  assert.ok(outcome.constraint, JSON.stringify(outcome.result));
  assert.equal(outcome.constraint.stackId, GLOBAL_LAYER_ID);
  assert.equal(outcome.constraint.referenceStackId, 'a');
  assert.equal(outcome.constraint.movingStackId, 'b');
  assert.deepEqual(solver.model.entity('edge-a'), reference);
  assert.deepEqual(solver.model.binding('edge-b').toEntity(), local);
  assert.deepEqual(solver.model.binding('loose-b').toEntity(), circle);
  const frame = solver.stackState.stacks.find(({ id }) => id === 'b').frame;
  close(frame.rotation, Math.PI / 4);
  const actualCircle = solver.model.entity('loose-b');
  const expected = transformStackPoint(circle.center, frame);
  actualCircle.center.forEach((value, index) => close(value, expected[index]));
  assert.ok(outcome.result.changedEntityIds.includes('loose-b'));
});

test('a new global relationship solves every Stack in the connected placement component', () => {
  const solver = createSolverController();
  solver.setStackState({
    version: 6,
    activeStackId: null,
    stacks: [
      { id: 'a', name: 'A', frame: { x: 0, y: 0, rotation: 0 } },
      { id: 'b', name: 'B', frame: { x: 0, y: 0, rotation: 0 } },
      { id: 'c', name: 'C', frame: { x: 0, y: 0, rotation: 0 } },
    ],
  });
  solver.addEntity({ id: 'point-a', type: 'point', stackId: 'a', point: [0, 0] });
  solver.addEntity({ id: 'point-b', type: 'point', stackId: 'b', point: [20, 0] });
  solver.addEntity({ id: 'point-c', type: 'point', stackId: 'c', point: [100, 0] });
  assert.ok(solver.addConstraint({
    type: 'Coincident',
    featureRefs: [point('point-a'), point('point-b')],
  }).constraint);

  const connected = solver.addConstraint({
    type: 'Coincident',
    featureRefs: [point('point-c'), point('point-b')],
  });

  assert.ok(connected.constraint, JSON.stringify(connected.result));
  const frames = new Map(solver.stackState.stacks.map(({ id, frame }) => [id, frame]));
  close(frames.get('a').x, 100);
  close(frames.get('b').x, 80);
  close(frames.get('c').x, 0);
  for (const id of ['point-a', 'point-b', 'point-c']) {
    const world = solver.model.resolvePoint(point(id));
    close(world[0], 100);
    close(world[1], 0);
  }
  assert.deepEqual(new Set(connected.result.solveScope.stackIds), new Set(['a', 'b', 'c']));
});

test('dragging either Stack holds its frame and solves the complete related placement component', () => {
  const solver = createSolverController();
  solver.setStackState({
    activeStackId: null,
    stacks: [
      { id: 'a', name: 'A', frame: { x: 0, y: 0, rotation: 0 } },
      { id: 'b', name: 'B', frame: { x: 0, y: 0, rotation: 0 } },
    ],
  });
  solver.addEntity({ id: 'point-a', type: 'point', stackId: 'a', point: [0, 0] });
  solver.addEntity({ id: 'point-b', type: 'point', stackId: 'b', point: [20, 0] });
  assert.ok(solver.addConstraint({
    type: 'Coincident',
    featureRefs: [point('point-a'), point('point-b')],
  }).constraint);
  const beforeB = structuredClone(solver.stackState.stacks.find(({ id }) => id === 'b').frame);
  const requested = { ...beforeB, x: beforeB.x + 15, y: beforeB.y - 7 };

  const dragged = solver.setStackFrame('b', requested);

  assert.ok(dragged.changed, JSON.stringify(dragged.result));
  const frames = new Map(solver.stackState.stacks.map(({ id, frame }) => [id, frame]));
  close(frames.get('b').x, requested.x);
  close(frames.get('b').y, requested.y);
  close(frames.get('a').x, 15);
  close(frames.get('a').y, -7);
  const worldA = solver.model.resolvePoint(point('point-a'));
  const worldB = solver.model.resolvePoint(point('point-b'));
  worldA.forEach((value, axis) => close(value, worldB[axis]));
  assert.deepEqual(new Set(dragged.result.solveScope.stackIds), new Set(['a', 'b']));
  assert.deepEqual(new Set(dragged.result.changedStackIds), new Set(['a', 'b']));
});

test('global dragging translates Stacks joined by an active-Stack cross-Stack Collinear constraint in real time', () => {
  const solver = createSolverController();
  solver.setStackState({
    activeStackId: 'a',
    stacks: [
      { id: 'a', name: 'A', frame: { x: 0, y: 0, rotation: 0 } },
      { id: 'b', name: 'B', frame: { x: 0, y: 0, rotation: 0 } },
    ],
  });
  solver.addEntity({ id: 'edge-a', type: 'line', stackId: 'a', start: [0, 0], end: [10, 0] });
  solver.addEntity({ id: 'edge-b', type: 'line', stackId: 'b', start: [30, 0], end: [40, 0] });
  const collinear = solver.addConstraint({
    type: 'Collinear',
    solveDomain: 'entity',
    featureRefs: [segment('edge-a'), segment('edge-b')],
  });
  assert.ok(collinear.constraint, JSON.stringify(collinear.result));
  assert.equal(collinear.constraint.solveDomain, 'entity');
  solver.setStackState({ ...solver.stackState, activeStackId: null });
  const beforeFrames = new Map(solver.stackState.stacks.map(({ id, frame }) => [id, structuredClone(frame)]));
  const beforeLocalA = structuredClone(solver.model.binding('edge-a').toEntity());
  const beforeLocalB = structuredClone(solver.model.binding('edge-b').toEntity());
  const beforeA = solver.model.entity('edge-a');
  const beforeB = solver.model.entity('edge-b');
  const delta = { x: 12, y: 0 };
  const beforeDragged = beforeFrames.get('a');

  const dragged = solver.setStackFrame('a', {
    ...beforeDragged,
    x: beforeDragged.x + delta.x,
    y: beforeDragged.y + delta.y,
  });

  assert.ok(dragged.changed, JSON.stringify(dragged.result));
  assert.deepEqual(solver.model.binding('edge-a').toEntity(), beforeLocalA);
  assert.deepEqual(solver.model.binding('edge-b').toEntity(), beforeLocalB);
  const afterFrames = new Map(solver.stackState.stacks.map(({ id, frame }) => [id, frame]));
  for (const stackId of ['a', 'b']) {
    close(afterFrames.get(stackId).x - beforeFrames.get(stackId).x, delta.x);
    close(afterFrames.get(stackId).y - beforeFrames.get(stackId).y, delta.y);
    close(afterFrames.get(stackId).rotation, beforeFrames.get(stackId).rotation);
  }
  const afterA = solver.model.entity('edge-a');
  const afterB = solver.model.entity('edge-b');
  for (const [before, after] of [[beforeA, afterA], [beforeB, afterB]]) {
    close(after.start[0] - before.start[0], delta.x);
    close(after.start[1] - before.start[1], delta.y);
    close(after.end[0] - before.end[0], delta.x);
    close(after.end[1] - before.end[1], delta.y);
  }
  assert.deepEqual(new Set(dragged.result.changedStackIds), new Set(['a', 'b']));
});

test('global transform constraints solve through active-Stack cross-Stack entity relationships', () => {
  const solver = createSolverController();
  solver.setStackState({
    activeStackId: 'a',
    stacks: [
      { id: 'a', name: 'A', frame: { x: 0, y: 0, rotation: 0 } },
      { id: 'b', name: 'B', frame: { x: 0, y: 0, rotation: 0 } },
      { id: 'c', name: 'C', frame: { x: 0, y: 0, rotation: 0 } },
    ],
  });
  solver.addEntity({ id: 'edge-a', type: 'line', stackId: 'a', start: [0, 0], end: [10, 0] });
  solver.addEntity({ id: 'edge-b', type: 'line', stackId: 'b', start: [30, 0], end: [40, 0] });
  solver.addEntity({ id: 'edge-c', type: 'line', stackId: 'c', start: [0, 0], end: [10, 10] });
  const entityRelationship = solver.addConstraint({
    type: 'Collinear',
    solveDomain: 'entity',
    featureRefs: [segment('edge-a'), segment('edge-b')],
  });
  assert.ok(entityRelationship.constraint, JSON.stringify(entityRelationship.result));
  solver.setStackState({ ...solver.stackState, activeStackId: null });
  const beforeLocal = new Map(['edge-a', 'edge-b', 'edge-c']
    .map((id) => [id, structuredClone(solver.model.binding(id).toEntity())]));

  const transformed = solver.addConstraint({
    type: 'Parallel',
    solveDomain: 'stack-frame',
    referenceStackId: 'c',
    movingStackId: 'a',
    featureRefs: [segment('edge-c'), segment('edge-a')],
  });

  assert.ok(transformed.constraint, JSON.stringify(transformed.result));
  assert.equal(transformed.constraint.solveDomain, 'stack-frame');
  for (const [id, local] of beforeLocal) assert.deepEqual(solver.model.binding(id).toEntity(), local);
  const edgeA = solver.model.entity('edge-a');
  const edgeB = solver.model.entity('edge-b');
  const edgeC = solver.model.entity('edge-c');
  close((edgeA.end[1] - edgeA.start[1]) * (edgeC.end[0] - edgeC.start[0])
    - (edgeA.end[0] - edgeA.start[0]) * (edgeC.end[1] - edgeC.start[1]), 0);
  close((edgeA.end[1] - edgeA.start[1]) * (edgeB.end[0] - edgeB.start[0])
    - (edgeA.end[0] - edgeA.start[0]) * (edgeB.end[1] - edgeB.start[1]), 0);
  close((edgeB.start[0] - edgeA.start[0]) * (edgeA.end[1] - edgeA.start[1])
    - (edgeB.start[1] - edgeA.start[1]) * (edgeA.end[0] - edgeA.start[0]), 0);
  assert.ok(transformed.result.changedStackIds.includes('a'));
  assert.ok(transformed.result.changedStackIds.includes('b'));
});

test('active-Stack cross-Stack parallel solves entity geometry without moving Stack frames', () => {
  const solver = assembly();
  solver.addConstraint({ type: 'Horizontal', featureRefs: [segment('edge-b')] });
  const beforeFrames = structuredClone(solver.stackState.stacks.map(({ id, frame }) => ({ id, frame })));
  const beforeA = structuredClone(solver.model.binding('edge-a').toEntity());
  const beforeCircle = structuredClone(solver.model.binding('loose-b').toEntity());

  const outcome = solver.addConstraint({
    type: 'Parallel',
    solveDomain: 'entity',
    featureRefs: [segment('edge-a'), segment('edge-b')],
  });

  assert.ok(outcome.constraint, JSON.stringify(outcome.result));
  assert.equal(outcome.constraint.stackId, GLOBAL_LAYER_ID);
  assert.equal(outcome.constraint.coordinateSpace, 'global');
  assert.equal(outcome.constraint.solveDomain, 'entity');
  assert.equal(outcome.constraint.referenceStackId, undefined);
  assert.equal(outcome.constraint.movingStackId, undefined);
  assert.deepEqual(solver.stackState.stacks.map(({ id, frame }) => ({ id, frame })), beforeFrames);
  assert.notDeepEqual(solver.model.binding('edge-a').toEntity(), beforeA);
  assert.deepEqual(solver.model.binding('loose-b').toEntity(), beforeCircle);
  const edgeA = solver.model.entity('edge-a');
  const edgeB = solver.model.entity('edge-b');
  close((edgeA.end[1] - edgeA.start[1]) * (edgeB.end[0] - edgeB.start[0])
    - (edgeA.end[0] - edgeA.start[0]) * (edgeB.end[1] - edgeB.start[1]), 0);
});

test('active-Stack cross-Stack driving dimensions reshape entities instead of moving Stack frames', () => {
  const solver = assembly();
  solver.drawingUnit = 'mm';
  solver.dimensions.setDefaultLengthUnit('mm');
  const beforeFrames = structuredClone(solver.stackState.stacks.map(({ id, frame }) => ({ id, frame })));
  const beforeLocal = structuredClone(solver.model.binding('edge-b').toEntity());
  const dimension = solver.addDimension({
    type: 'dimension-line', subtype: 'aligned', dimensionMode: 'driving', solveDomain: 'entity',
    start: [0, 0], end: [30, 0], label: [15, -10],
    anchors: {
      start: { kind: 'point', recordId: 'edge-a', index: 0 },
      end: { kind: 'point', recordId: 'edge-b', index: 0 },
    },
  });

  assert.equal(dimension.entity.solveDomain, 'entity');
  const changed = solver.setDimension(dimension.entity.dimensionId, '50');
  assert.ok(['converged', 'unchanged'].includes(changed.result?.status || changed.status), JSON.stringify(changed));
  assert.deepEqual(solver.stackState.stacks.map(({ id, frame }) => ({ id, frame })), beforeFrames);
  assert.notDeepEqual(solver.model.binding('edge-b').toEntity(), beforeLocal);
  const first = solver.model.resolvePoint({ recordId: 'edge-a', index: 0 });
  const second = solver.model.resolvePoint({ recordId: 'edge-b', index: 0 });
  close(Math.hypot(second[0] - first[0], second[1] - first[1]), 50);
});

test('saved placement roles survive activation changes and a drawing round trip', () => {
  const solver = assembly();
  const added = solver.addConstraint({ type: 'Parallel', featureRefs: [segment('edge-a'), segment('edge-b')] });
  assert.ok(added.constraint);
  solver.setStackState({ ...solver.stackState, activeStackId: 'b' });
  const snapshot = solver.getSketchSnapshot();
  const restored = createSolverController();
  restored.loadSketch(snapshot);
  const constraint = restored.constraints().find(({ id }) => id === added.constraint.id);
  assert.equal(constraint.referenceStackId, 'a');
  assert.equal(constraint.movingStackId, 'b');
  restored.updateEntities([{ ...restored.model.entity('edge-a'), end: [0, 10] }]);
  const moved = restored.model.entity('edge-b');
  close(moved.end[0] - moved.start[0], 0);
  close(Math.hypot(moved.end[0] - moved.start[0], moved.end[1] - moved.start[1]), 10);
});

test('an impossible global equal-length relationship fails without deforming either Stack', () => {
  const solver = assembly();
  const before = solver.getGeometrySnapshot();
  const outcome = solver.addConstraint({ type: 'Equal', featureRefs: [segment('edge-a'), segment('edge-b')] });
  assert.equal(outcome.constraint, null);
  assert.deepEqual(solver.getGeometrySnapshot(), before);
});

test('collinear placement translates and rotates every entity while keeping the reference still', () => {
  const solver = assembly();
  const before = solver.model.binding('loose-b').toEntity();
  const added = solver.addConstraint({ type: 'Collinear', featureRefs: [segment('edge-a'), segment('edge-b')] });
  assert.ok(added.constraint, JSON.stringify(added.result));
  const edge = solver.model.entity('edge-b');
  close(edge.start[0], edge.start[1]);
  close(edge.end[0], edge.end[1]);
  assert.deepEqual(solver.model.binding('loose-b').toEntity(), before);
  assert.deepEqual(solver.model.entity('edge-a').start, [0, 0]);
  assert.deepEqual(solver.model.entity('edge-a').end, [10, 10]);
});

test('global driving dimensions move a whole Stack; local dimensions still change its shape after rotation', () => {
  const solver = assembly();
  solver.drawingUnit = 'mm';
  solver.dimensions.setDefaultLengthUnit('mm');
  const local = solver.addDimension({ type: 'dimension-line', stackId: 'b', subtype: 'horizontal', dimensionMode: 'driving',
    start: [30, 0], end: [40, 0], label: [35, -10], anchors: {
      start: { kind: 'point', recordId: 'edge-b', index: 0 }, end: { kind: 'point', recordId: 'edge-b', index: 2 },
    } });
  assert.equal(local.entity.stackId, 'b');
  solver.addConstraint({ type: 'Parallel', featureRefs: [segment('edge-a'), segment('edge-b')] });
  const dimension = solver.addDimension({ type: 'dimension-line', subtype: 'aligned', dimensionMode: 'driving',
    start: [0, 0], end: solver.model.resolvePoint({ recordId: 'edge-b', index: 0 }), label: [20, -20], anchors: {
      start: { kind: 'point', recordId: 'edge-a', index: 0 }, end: { kind: 'point', recordId: 'edge-b', index: 0 },
    } });
  assert.equal(dimension.entity.stackId, GLOBAL_LAYER_ID);
  const shape = solver.model.binding('edge-b').toEntity();
  const changed = solver.setDimension(dimension.entity.dimensionId, '50');
  assert.ok(['converged', 'unchanged'].includes(changed.result?.status || changed.status), JSON.stringify(changed));
  assert.deepEqual(solver.model.binding('edge-b').toEntity(), shape);
  const start = solver.model.entity('edge-b').start;
  assert.ok(Math.abs(Math.hypot(...start) - 50) < 0.001);
  const resized = solver.setDimension(local.entity.dimensionId, '20');
  assert.ok(['converged', 'unchanged'].includes(resized.result?.status || resized.status), JSON.stringify(resized));
  const edge = solver.model.entity('edge-b');
  assert.ok(Math.abs(Math.hypot(edge.end[0] - edge.start[0], edge.end[1] - edge.start[1]) - 20) < 0.001);
  close(edge.end[0] - edge.start[0], edge.end[1] - edge.start[1]);
});

test('a global-origin driving dimension transforms its whole Stack and preserves its annotation geometry', () => {
  const solver = createSolverController();
  solver.setStackState({
    version: 6,
    activeStackId: null,
    stacks: [{ id: 'moving', name: 'Moving', frame: { x: 180, y: 0, rotation: 0 } }],
  });
  solver.drawingUnit = 'mm';
  solver.dimensions.setDefaultLengthUnit('mm');
  solver.addEntity({ id: 'edge', type: 'line', stackId: 'moving', start: [180, 0], end: [200, 0] });
  solver.addEntity({ id: 'circle', type: 'circle', stackId: 'moving', center: [190, 30], radius: 5 });
  const beforeEdge = structuredClone(solver.model.binding('edge').toEntity());
  const beforeCircle = structuredClone(solver.model.binding('circle').toEntity());
  const origin = canvasOriginPointFeature(null, solver.stackState);
  const candidate = candidateFromSelections([origin, {
    kind: 'point', recordId: 'edge', entityType: 'line', index: 0, point: [180, 0],
  }], [90, -20], 'driving', false, 'mm');

  const added = solver.addDimension({ ...candidate, solveDomain: 'stack-frame' });

  assert.equal(added.entity.stackId, GLOBAL_LAYER_ID);
  assert.deepEqual(added.entity.participantStackIds, ['moving']);
  assert.equal(added.entity.referenceStackId, GLOBAL_LAYER_ID);
  assert.equal(added.entity.movingStackId, 'moving');
  assert.deepEqual(solver.model.binding('edge').toEntity(), beforeEdge);
  assert.deepEqual(solver.model.binding('circle').toEntity(), beforeCircle);
  assert.deepEqual(added.entity.start, [0, 0]);
  assert.deepEqual(added.entity.end, [180, 0]);
  assert.deepEqual(added.entity.measureStart, [0, 0]);
  assert.deepEqual(added.entity.measureEnd, [180, 0]);
  assert.deepEqual(added.entity.label, [90, -20]);

  const changed = solver.setDimension(added.entity.dimensionId, '50');

  assert.ok(['converged', 'unchanged'].includes(changed.status), JSON.stringify(changed));
  assert.deepEqual(solver.model.binding('edge').toEntity(), beforeEdge);
  assert.deepEqual(solver.model.binding('circle').toEntity(), beforeCircle);
  const edge = solver.model.entity('edge');
  const circle = solver.model.entity('circle');
  assert.ok(Math.abs(edge.start[0] - 50) < 0.001, `${edge.start[0]} != 50`);
  close(edge.start[1], 0);
  assert.ok(Math.abs(circle.center[0] - 60) < 0.001, `${circle.center[0]} != 60`);
  close(circle.center[1], 30);
});

test('global layer is permanent and cannot become the active drawable Stack', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  assert.equal(system.stack(GLOBAL_LAYER_ID).kind, 'global');
  assert.equal(system.removeStack(GLOBAL_LAYER_ID), false);
  assert.equal(system.setActiveStack(GLOBAL_LAYER_ID), false);
  assert.equal(system.reparentStack(GLOBAL_LAYER_ID, system.activeStackId()), false);
  assert.equal(system.renameStack(GLOBAL_LAYER_ID, 'Renamed'), false);
  assert.equal(system.setStackEnabled(GLOBAL_LAYER_ID, false), false);
  assert.equal(system.addChildStack(GLOBAL_LAYER_ID), null);
});

test('removing geometry also removes its global relationships from an initialized graph', () => {
  const solver = assembly();
  const added = solver.addConstraint({ type: 'Parallel', featureRefs: [segment('edge-a'), segment('edge-b')] });
  solver.getConstraintGraph();
  solver.removeEntity('edge-b');
  assert.equal(solver.constraints().some(({ id }) => id === added.constraint.id), false);
  assert.ok(['converged', 'unchanged'].includes(solver.solve().status));
});

test('DXF preserves the placement and local horizontal direction of a rotated dimension', () => {
  const frame = { x: 100, y: 50, rotation: Math.PI / 4 };
  const local = { type: 'dimension-line', subtype: 'horizontal', dimensionMode: 'driven',
    start: [0, 0], end: [20, 0], measureStart: [0, 0], measureEnd: [20, 0], label: [10, -10], text: '20' };
  const [expected] = createDxfDimensionPlans({ dimensionAnnotations: [local] });
  const [actual] = createDxfDimensionPlans({ dimensionAnnotations: [{ ...transformStackEntity(local, frame), coordinateFrame: frame }] });
  close(actual.rotation, 45);
  const point = transformStackPoint(expected.definitionPoint, frame);
  actual.definitionPoint.forEach((value, index) => close(value, point[index]));
  close(actual.picture.textAngle, expected.picture.textAngle + 45);
});

test('canvas axes use the active Stack frame and return to global when none is active', () => {
  const node = () => ({ values: {}, setAttribute(key, value) { this.values[key] = value; } });
  const axisX = node(), axisY = node(), originPoint = node();
  const state = { activeStackId: 'b', stacks: [{ id: 'b', frame: { x: 30, y: 20, rotation: Math.PI / 2 } }] };
  const inputs = { axisX, axisY, originPoint, state, bounds: { left: 0, right: 100, top: 0, bottom: 100 } };
  updateStackAxes(inputs);
  close(axisX.values.x1, 30);
  close(axisX.values.x2, 30);
  close(axisY.values.y1, 20);
  assert.equal(originPoint.values.transform, 'translate(30 20)');
  updateStackAxes({ ...inputs, state: { ...state, activeStackId: null } });
  close(axisX.values.y1, 0);
  close(axisY.values.x1, 0);
});

test('worker placement results carry frames before the main controller imports world geometry', () => {
  const main = assembly();
  const worker = new SolverWorkerRuntime();
  worker.handleRequest(createSolverWorkerRequest({ requestToken: 1, generation: 0, type: 'load-sketch', payload: { snapshot: main.getSketchSnapshot() } }));
  const result = worker.handleRequest(createSolverWorkerRequest({ requestToken: 2, generation: 0, type: 'add-constraint', payload: {
    constraint: { type: 'Parallel', featureRefs: [segment('edge-a'), segment('edge-b')] },
  } }));
  assert.equal(result.status, 'converged');
  const shape = main.model.binding('loose-b').toEntity();
  main.applyAuthoritativeState({ entities: result.changedEntities, constraints: result.changedConstraints }, result);
  close(main.stackState.stacks.find(({ id }) => id === 'b').frame.rotation, Math.PI / 4);
  const actual = main.model.binding('loose-b').toEntity();
  actual.center.forEach((value, index) => close(value, shape.center[index]));
  close(actual.radius, shape.radius);
});

test('failed placement transactions restore frames, annotations, and local shape together', () => {
  const solver = assembly();
  solver.addConstraint({ type: 'Parallel', featureRefs: [segment('edge-a'), segment('edge-b')] });
  const transaction = solver.snapshotGeometryForSeeds({ entityIds: ['edge-a'] });
  const before = solver.getGeometrySnapshot();
  const originalFrames = structuredClone(solver.stackState);
  solver.updateEntities([{ ...solver.model.entity('edge-a'), end: [0, 10] }]);
  solver.restoreGeometryTransaction(transaction);
  assert.deepEqual(solver.stackState, originalFrames);
  solver.getGeometrySnapshot().forEach((entity, index) => {
    if (entity.start) entity.start.forEach((value, axis) => close(value, before[index].start[axis]));
    if (entity.end) entity.end.forEach((value, axis) => close(value, before[index].end[axis]));
    if (entity.center) entity.center.forEach((value, axis) => close(value, before[index].center[axis]));
  });
});

test('moving a Stack frame translates all geometry and its local dimensions without deforming local shape', () => {
  const solver = assembly();
  const dimension = solver.addDimension({
    type: 'dimension-line',
    stackId: 'b',
    subtype: 'horizontal',
    dimensionMode: 'driven',
    start: [30, 0],
    end: [40, 0],
    label: [35, -10],
    anchors: {
      start: { kind: 'point', recordId: 'edge-b', index: 0 },
      end: { kind: 'point', recordId: 'edge-b', index: 2 },
    },
  });
  const localLine = structuredClone(solver.model.binding('edge-b').toEntity());
  const localCircle = structuredClone(solver.model.binding('loose-b').toEntity());
  const beforeAnnotation = solver.getSketchSnapshot().dimensionAnnotations
    .find(({ id }) => id === dimension.entity.id);

  const outcome = solver.setStackFrame('b', { x: 12, y: -7, rotation: 0 });

  assert.equal(outcome.changed, true);
  assert.deepEqual(solver.model.binding('edge-b').toEntity(), localLine);
  assert.deepEqual(solver.model.binding('loose-b').toEntity(), localCircle);
  assert.deepEqual(solver.model.entity('edge-b').start, [42, -7]);
  assert.deepEqual(solver.model.entity('loose-b').center, [47, -2]);
  const annotation = solver.getSketchSnapshot().dimensionAnnotations
    .find(({ id }) => id === dimension.entity.id);
  assert.deepEqual(annotation.start, [beforeAnnotation.start[0] + 12, beforeAnnotation.start[1] - 7]);
  assert.deepEqual(annotation.label, [beforeAnnotation.label[0] + 12, beforeAnnotation.label[1] - 7]);
  assert.deepEqual(annotation.coordinateFrame, { x: 12, y: -7, rotation: 0 });
});
