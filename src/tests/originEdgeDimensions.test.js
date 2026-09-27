import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { WasmSolverBackend } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';
import { candidateFromSelections } from '../../packages/paramagic-core/src/modules/DimensionSystem.js';
import { canvasOriginPointFeature } from '../../packages/paramagic-core/src/modules/CanvasOrigin.js';
import { GLOBAL_LAYER_ID } from '../../packages/paramagic-core/src/modules/StackCoordinates.js';
import { DEFAULT_SOLVE_TOLERANCE } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';

const module = new WebAssembly.Module(readFileSync(new URL('../../packages/paramagic-core/src/modules/solver/wasm/solver.wasm', import.meta.url)));
const near = (a, b, tolerance = DEFAULT_SOLVE_TOLERANCE * Math.max(1, Math.abs(b))) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const local = c => [...c.model.entities.values()].map(b => b.toEntity());
const segment = id => ({ kind: 'segment', recordId: id, index: 0 });
function fixture(native, start = [100, 60], end = [200, 60]) {
  const c = new SolverController({ numericBackend: native ? new WasmSolverBackend(module) : null });
  c.setDrawingProperties({ drawingUnit: 'mm' });
  c.setStackState({ version: 6, activeStackId: null, stacks: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  c.addEntity({ id: 'edge', type: 'line', stackId: 'a', start, end });
  c.addEntity({ id: 'circle', type: 'circle', stackId: 'a', center: [150, 100], radius: 12 });
  c.addEntity({ id: 'other', type: 'line', stackId: 'b', start: [250, 60], end: [300, 60] });
  return c;
}
function candidate(c, reverse = false, pointer = [40, 100], mode = 'driving') {
  const edge = { ...segment('edge'), entityType: 'line', ...c.model.entity('edge') }, origin = canvasOriginPointFeature(null, c.stackState);
  return candidateFromSelections(reverse ? [edge, origin] : [origin, edge], pointer, mode, false, 'mm', { solveDomain: 'stack-frame' });
}
function distance(c) {
  const { start: a, end: b } = c.model.entity('edge'), dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.abs(dx * a[1] - dy * a[0]) / Math.hypot(dx, dy);
}
function checkDimension(c, id) {
  const annotation = c.dimensionAnnotations.get(id), constraint = c.constraints().find(c => c.dimensionRef === id);
  assert.equal(annotation.dimensionMode, 'driving');
  assert.equal(annotation.anchors.pointToSegment.projectionMode, 'line');
  assert.equal(annotation.anchors.pointToSegment.point.referenceRole, 'canvas-origin');
  assert.equal(annotation.stackId, GLOBAL_LAYER_ID);
  assert.equal(constraint.type, 'Point Line Distance');
  assert.equal(constraint.projectionMode, 'line');
  assert.equal(constraint.featureRefs[1].recordId, 'edge');
  assert.ok(c.registry.evaluate(c.model, c.dimensions).values.every(v => Math.abs(v) < DEFAULT_SOLVE_TOLERANCE));
  assert.ok([...c.placementWorlds.values()].every(world => [...world.frames.values()].flat().every(v => !v.locked)));
}

for (const native of [false, true]) {
  const backend = native ? 'WASM' : 'JavaScript';
  for (const [name, start, end] of [
    ['horizontal', [100, 60], [200, 60]],
    ['vertical', [60, 100], [60, 200]],
    ['sloped', [100, 60], [200, 110]],
  ]) for (const reverse of [false, true]) {
    test(`${backend}: origin to ${name} edge retains its line distance and direction, order ${reverse}`, () => {
      const c = fixture(native, start, end), before = local(c), frames = structuredClone(c.stackState);
      const selection = candidate(c, reverse), initialDistance = distance(c);
      near(selection.measuredValue, initialDistance);
      assert.equal(selection.subtype, 'aligned');
      const added = c.addDimension({ ...selection, solveDomain: 'stack-frame' });
      assert.equal(added.entity.dimensionMode, 'driving');
      for (const stack of frames.stacks) for (const axis of ['x', 'y', 'rotation']) {
        near(c.model.stackFrame(stack.id)[axis], stack.frame?.[axis] || 0, 0.001);
      }
      const id = added.entity.dimensionId;
      for (const value of [initialDistance + 20, initialDistance + 40, initialDistance]) {
        const result = c.setDimension(id, String(value));
        assert.ok(['converged', 'unchanged'].includes(result.status), JSON.stringify(result));
        near(distance(c), value);
        near(c.model.stackFrame('a').rotation, 0, 1e-6);
        assert.deepEqual(local(c), before);
        checkDimension(c, id);
      }
      const restored = fixture(native);
      restored.loadSketch(c.getSketchSnapshot());
      checkDimension(restored, id);
      assert.equal(restored.setDimension(id, String(initialDistance + 10)).status, 'converged');
      near(distance(restored), initialDistance + 10);
      near(restored.model.stackFrame('a').rotation, 0, 1e-6);
      checkDimension(restored, id);
    });
  }
  test(`${backend}: an origin-edge edit translates connected Collinear Stacks and still allows sliding`, () => {
    const c = fixture(native), before = local(c);
    assert.ok(c.addConstraint({ type: 'Collinear', solveDomain: 'stack-frame', featureRefs: [segment('edge'), segment('other')] }).constraint);
    const dimension = c.addDimension({ ...candidate(c), solveDomain: 'stack-frame' }).entity;
    assert.equal(c.setDimension(dimension.dimensionId, '85').status, 'converged');
    for (const id of ['a', 'b']) { near(c.model.stackFrame(id).y, 25); near(c.model.stackFrame(id).rotation, 0, 1e-12); }
    assert.deepEqual(local(c), before);
    assert.equal(c.setStackFrame('a', { ...c.model.stackFrame('a'), x: 30, y: 35 }).changed, true);
    near(distance(c), 85); near(c.model.stackFrame('b').x, 0);
    near(c.model.stackFrame('a').x, 30);
    checkDimension(c, dimension.dimensionId);
  });
  test(`${backend}: point-edge distance permits required rotation when a world Fixed point prevents translation`, () => {
    const c = fixture(native), before = local(c);
    const pin = { kind: 'point', recordId: 'edge', index: 0 };
    assert.ok(c.addConstraint({ type: 'Fixed', solveDomain: 'stack-frame', featureRefs: [pin] }).constraint);
    const dimension = c.addDimension({ ...candidate(c), solveDomain: 'stack-frame' }).entity;
    const result = c.setDimension(dimension.dimensionId, '80');
    assert.equal(result.status, 'converged', JSON.stringify(result));
    c.model.resolvePoint(pin).forEach((v, i) => near(v, [100, 60][i]));
    near(distance(c), 80);
    assert.ok(Math.abs(c.model.stackFrame('a').rotation) > 0.01);
    assert.deepEqual(local(c), before);
    checkDimension(c, dimension.dimensionId);
  });
}

test('Stack point-edge preview measures the supporting line independently of label position and retains active-Stack behavior', () => {
  const c = fixture(false);
  for (const mode of ['driving', 'driven']) for (const pointer of [[40, 100], [200, 30], [-100, -100]]) {
    const dimension = candidate(c, false, pointer, mode);
    near(dimension.measuredValue, 60);
    assert.deepEqual(dimension.measureStart, [0, 60]);
    assert.equal(dimension.anchors.pointToSegment.projectionMode, 'line');
  }
  const existingLocal = candidateFromSelections([canvasOriginPointFeature(), {
    ...segment('edge'), start: [100, 60], end: [200, 60],
  }], [40, 100], 'driving', false, 'mm', { solveDomain: 'entity' });
  assert.equal(existingLocal.anchors.pointToSegment.projectionMode, undefined);
  assert.deepEqual(existingLocal.measureStart, [100, 60]);
});
