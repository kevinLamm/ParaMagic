import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { WasmSolverBackend } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';

const module = new WebAssembly.Module(readFileSync(new URL('../../packages/paramagic-core/src/modules/solver/wasm/solver.wasm', import.meta.url)));
const segment = id => ({ kind: 'segment', recordId: `edge-${id}`, index: 0 });
const point = id => ({ kind: 'point', recordId: `edge-${id}`, index: 0 });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const frame = (c, id) => ({ ...c.model.stackFrame(id) });
const locals = c => [...c.model.entities.values()].map(binding => binding.toEntity());
function fixture(native) {
  const c = new SolverController({ numericBackend: native ? new WasmSolverBackend(module) : null });
  c.setDrawingProperties({ drawingUnit: 'mm' });
  c.setStackState({ activeStackId: null, stacks: ['a', 'b', 'c'].map((id, i) => ({
    id, name: id, frame: { x: i * 100, y: 0, rotation: 0 },
  })) });
  for (let i = 0; i < 3; i++) {
    const id = ['a', 'b', 'c'][i], x = i * 100;
    c.addEntity({ id: `edge-${id}`, type: 'line', stackId: id, start: [x, 0], end: [x + 40, 0] });
    c.addEntity({ id: `circle-${id}`, type: 'circle', stackId: id, center: [x + 20, 25], radius: 5 });
  }
  return c;
}
function relation(c, type, ids, extra = {}) {
  const result = c.addConstraint({ type, solveDomain: 'stack-frame', featureRefs: ids.map(segment), ...extra });
  assert.ok(result.constraint, JSON.stringify(result.result));
  return result.constraint;
}
function dimension(c, a, b, subtype, mode = 'driving') {
  const start = c.model.resolvePoint(point(a)), end = c.model.resolvePoint(point(b));
  const result = c.addDimension({ type: 'dimension-line', subtype, dimensionMode: mode, solveDomain: 'stack-frame',
    start, end, label: [50, -30], anchors: { start: point(a), end: point(b) } });
  assert.ok(result.entity, JSON.stringify(result.result));
  return result.entity;
}
function drag(c, id, dx, dy) {
  const before = frame(c, id), local = locals(c);
  const outcome = c.setStackFrame(id, { ...before, x: before.x + dx, y: before.y + dy });
  assert.equal(outcome.changed, true, JSON.stringify(outcome.result));
  near(frame(c, id).x, before.x + dx); near(frame(c, id).y, before.y + dy);
  assert.deepEqual(locals(c), local);
  assert.ok(c.registry.evaluate(c.model, c.dimensions).values.every(v => Math.abs(v) < 1e-7));
  assert.ok([...c.placementWorlds?.values() || []].every(world => [...world.frames.values()].flat().every(v => !v.locked)));
  return outcome;
}

for (const native of [false, true]) {
  const backend = native ? 'WASM' : 'JavaScript';
  test(`${backend}: Parallel connects rotation without grouping translations, dragging either Stack`, () => {
    const c = fixture(native);
    relation(c, 'Parallel', ['a', 'b']);
    const b = frame(c, 'b');
    drag(c, 'a', 15, 30);
    assert.deepEqual(frame(c, 'b'), b);
    const a = frame(c, 'a');
    drag(c, 'b', -10, -20);
    assert.deepEqual(frame(c, 'a'), a);
    assert.deepEqual(frame(c, 'c'), { x: 200, y: 0, rotation: 0 });
  });
  test(`${backend}: Collinear permits sliding along the shared line and follows only perpendicular movement`, () => {
    const c = fixture(native);
    relation(c, 'Collinear', ['a', 'b']);
    const b = frame(c, 'b');
    drag(c, 'a', 25, 0);
    assert.deepEqual(frame(c, 'b'), b);
    drag(c, 'a', 0, 15);
    near(frame(c, 'b').x, b.x); near(frame(c, 'b').y, 15); near(frame(c, 'b').rotation, 0);
  });
  test(`${backend}: horizontal dimension preserves spacing without coupling vertical movement`, () => {
    const c = fixture(native);
    dimension(c, 'a', 'b', 'horizontal');
    drag(c, 'a', 0, 30);
    assert.deepEqual(frame(c, 'b'), { x: 100, y: 0, rotation: 0 });
    drag(c, 'a', 15, 0);
    near(frame(c, 'b').x, 115); near(frame(c, 'b').y, 0);
    const a = frame(c, 'a');
    drag(c, 'b', 0, -20);
    assert.deepEqual(frame(c, 'a'), a);
  });
  test(`${backend}: independent dimension directions stay independent through three connected Stacks`, () => {
    const c = fixture(native);
    dimension(c, 'a', 'b', 'horizontal');
    dimension(c, 'b', 'c', 'vertical');
    const third = frame(c, 'c');
    drag(c, 'a', 15, 25);
    near(frame(c, 'b').x, 115); near(frame(c, 'b').y, 0);
    assert.deepEqual(frame(c, 'c'), third);
  });
  test(`${backend}: a driven measurement does not couple Stack movement`, () => {
    const c = fixture(native);
    dimension(c, 'a', 'b', 'horizontal', 'driven');
    const b = frame(c, 'b');
    drag(c, 'a', 15, 30);
    assert.deepEqual(frame(c, 'b'), b);
  });
  test(`${backend}: disabled relationships do not couple Stack movement`, () => {
    const c = fixture(native);
    const added = relation(c, 'Coincident', ['a', 'b'], { featureRefs: [point('a'), point('b')] });
    c.model.constraints.get(added.id).enabled = false;
    c.invalidateConstraintGraph(); c.invalidateStackParticipationGraph();
    const b = frame(c, 'b');
    drag(c, 'a', 15, 30);
    assert.deepEqual(frame(c, 'b'), b);
  });
  test(`${backend}: Fixed keeps a related Stack anchored and an impossible move rolls back`, () => {
    const c = fixture(native);
    relation(c, 'Collinear', ['a', 'b']);
    relation(c, 'Fixed', ['b']);
    drag(c, 'a', 25, 0);
    const before = c.captureStackPlacementState(), local = locals(c);
    const outcome = c.setStackFrame('a', { ...frame(c, 'a'), y: 15 });
    assert.equal(outcome.changed, false);
    assert.deepEqual(c.captureStackPlacementState(), before);
    assert.deepEqual(locals(c), local);
  });
}
