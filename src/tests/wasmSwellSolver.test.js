import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { WasmSolverSession, WasmSolverBackend, loadWasmSolverModule } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';
import { assembleJacobianBlocks } from '../../packages/paramagic-core/src/modules/solver/JacobianBlocks.js';
import { deriveSwellGeometry, withSwellDefinition } from '../../packages/paramagic-core/src/modules/SwellGeometry.js';

const module = await loadWasmSolverModule(readFileSync(new URL('../../packages/paramagic-core/src/modules/solver/wasm/solver.wasm', import.meta.url)));
const ref = (id, index = 0) => ({ kind: 'point', recordId: id, index });
const definition = { swellEnabled: true, offsetExpression: '2', swellOffsetExpression: '6', startTransitionExpression: '8', endTransitionExpression: '12' };
const swell = (entity, overrides = {}) => withSwellDefinition(entity, { ...definition, ...overrides });
const line = (id, start = [10, 20], end = [110, 35], overrides) => swell({ id, type: 'line', start, end }, overrides);
const join = (a, ai, b, bi) => ({ id: a + '-' + ai + '-' + b + '-' + bi, type: 'Coincident', featureRefs: [ref(a, ai), ref(b, bi)] });
function check(entities, constraints = [], { global = false, parameters = [], frame = null } = {}) {
  const controller = new SolverController({ jacobianMode: 'blocks' });
  controller.loadSketch({ drawingUnit: 'mm', entities: [...entities, { id: 'probe', type: 'point', point: [23, 41] }], parameters });
  controller.model.addConstraints(constraints);
  if (frame) controller.model.stackFrame = () => frame;
  const derived = deriveSwellGeometry({ entities: controller.model.snapshot(), constraints,
    evaluateLength: (expression, entity) => controller.evaluateDrawingLengthExpression(expression, entity) });
  let index = 0;
  const add = c => controller.model.addConstraint({ id: 'derived-test-' + index++, coordinateSpace: global ? 'global' : 'local', ...c });
  for (const [owner, result] of derived) for (const piece of result.pieces) {
    const base = { recordId: owner, derivedFeature: { provider: 'swell', segmentIndex: piece.segmentIndex, role: piece.role, ordinal: piece.ordinal } };
    const e = piece.entity;
    const indexes = e.type === 'line' ? [0, 1, 2] : e.type === 'arc' ? [0, 1, 2, 3]
      : e.type === 'circle' ? [0, 1, 2, 3, 4] : [0, Math.floor(e.points.length / 2), e.points.length - 1];
    for (const point of indexes) add({ type: 'Coincident', featureRefs: [ref('probe'), { ...base, kind: 'point', index: point }] });
    if (e.type === 'arc') add({ type: 'Coincident', featureRefs: [ref('probe'), { ...base, kind: 'point', index: 1, pointRole: 'arc-midpoint' }] });
    if (['circle', 'arc'].includes(e.type)) {
      add({ type: 'Radius', value: 11, featureRefs: [{ ...base, kind: e.type }] });
      add({ type: 'Point-on Circle', featureRefs: [ref('probe'), { ...base, kind: e.type }] });
    }
    if (['line', 'polyline', 'polygon'].includes(e.type)) {
      const segment = e.type === 'line' ? 0 : Math.floor((e.points.length - 2) / 2);
      add({ type: 'Point-on Line', featureRefs: [ref('probe'), { ...base, kind: 'segment', index: segment }] });
      add({ type: 'Coincident', featureRefs: [ref('probe'), { ...base, type: 'segment-point', index: segment, ratio: .37 }] });
    }
  }
  assert.ok(index > 0, 'Fixture has derived equations');
  const options = { model: controller.model, dimensions: controller.dimensions, registry: controller.registry };
  const session = new WasmSolverSession(module); session.prepare(options);
  assert.equal(session.native.linearize(), 1);
  const contract = controller.registry.blocks(controller.model, controller.dimensions, { variables: session.variables });
  const expected = assembleJacobianBlocks(session.arcGeometry?.reduceBlocks(contract) || contract);
  session.arcGeometry?.project();
  const residuals = controller.registry.evaluate(controller.model, controller.dimensions).values;
  const actual = session.view(8, Float64Array, session.rowCount), values = session.view(7, Float64Array, session.entryCount);
  const offsets = session.view(5, Int32Array, session.rowCount + 1), columns = session.view(6, Int32Array, session.entryCount);
  assert.equal(actual.length, residuals.length);
  const close = (a, b, tolerance, label) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), label + ': ' + a + ' != ' + b);
  for (let row = 0; row < actual.length; row++) {
    close(actual[row], residuals[row], 1e-10, 'Residual row ' + row);
    const nativeRow = new Float64Array(session.active.length);
    for (let e = offsets[row]; e < offsets[row + 1]; e++) nativeRow[columns[e]] = values[e];
    expected.matrix[row].forEach((value, column) => close(nativeRow[column], value, 1e-6, 'Jacobian row ' + row + ', column ' + column));
  }
  return { controller, session, options };
}

for (const [name, overrides, end] of [
  ['offset', { swellEnabled: false }, [110, 35]],
  ['transitions', {}, [110, 35]],
  ['negative offsets and reversed transition assignment', { offsetExpression: '-2' }, [110, 35]],
  ['scaled transitions', {}, [25, 20]],
  ['disabled short transitions', {}, [15, 20]],
  ['equal offsets', { swellOffsetExpression: '2' }, [110, 35]],
]) test('native Swell ' + name + ' geometry and derivatives match JS', () => check([line('a', [10, 20], end, overrides)]));

for (const type of ['polyline', 'polygon', 'rect', 'curve', 'circle', 'arc']) {
  test('native Swell ' + type + ' features and derivatives match JS', () => {
    const entity = type === 'rect' ? { id: 'a', type, x: 10, y: 20, width: 80, height: 60 }
      : type === 'circle' ? { id: 'a', type, center: [10, 20], radius: 40 }
      : type === 'arc' ? { id: 'a', type, center: [10, 20], radius: 40, start: [50, 20], arcPoint: [10 + 40 / Math.sqrt(2), 20 + 40 / Math.sqrt(2)], end: [10, 60] }
      : { id: 'a', type, points: [[10, 20], [60, 90], [110, 30], [150, 100]] };
    check([swell(entity)]);
  });
}
test('native Swell joined line cycle preserves outward normals and endpoint derivatives', () => {
  const entities = [line('a', [0, 0], [80, 0]), line('b', [80, 0], [80, 60]), line('c', [80, 60], [0, 60]), line('d', [0, 60], [0, 0])];
  check(entities, [join('a', 2, 'b', 0), join('b', 2, 'c', 0), join('c', 2, 'd', 0), join('d', 2, 'a', 0)]);
});
test('native Swell connected line/arc and suppressed fillet transitions match JS', () => {
  const arc = swell({ id: 'b', type: 'arc', center: [60, 20], radius: 20, start: [60, 0], arcPoint: [60 + 20 / Math.sqrt(2), 20 - 20 / Math.sqrt(2)], end: [80, 20] });
  arc.composite.swellFillet = { sourceEndpoints: [{ recordId: 'a', index: 2 }, { recordId: 'c', index: 0 }] };
  check([line('a', [0, 0], [60, 0]), arc, line('c', [80, 20], [80, 90])], [join('a', 2, 'b', 0), join('b', 2, 'c', 0)]);
});
test('native Swell connected curve endpoints and composite normals match JS', () => {
  const a = line('a', [0, 0], [80, 0], { swellEnabled: false });
  const b = swell({ id: 'b', type: 'curve', points: [[80, 0], [100, 40], [0, 0]] }, { swellEnabled: false });
  check([a, b], [join('a', 2, 'b', 0), join('b', 2, 'a', 0)]);
});

for (const global of [false, true]) test('native Swell respects rotated stack frames (' + (global ? 'global' : 'local') + ')', () =>
  check([line('a')], [], { global, frame: { x: 143, y: -230, rotation: .52 } }));

test('native Swell clockwise/major arcs and inward circle offsets match JS', () => {
  check([swell({ id: 'a', type: 'arc', center: [0, 0], radius: 40,
    start: [40, 0], arcPoint: [-40, 0], end: [0, 40] }, { offsetExpression: '-3' })]);
  check([swell({ id: 'a', type: 'circle', center: [10, 20], radius: 4 }, { offsetExpression: '-10' })]);
});

test('native Swell multiple endpoint joins and composite outward normals match JS', () => {
  const entities = [line('a', [0, 0], [80, 0]), line('b', [80, 0], [80, 60]), line('c', [80, 0], [140, -30])];
  for (const e of entities) Object.assign(e.composite, { id: 'shared-composite', closed: true });
  check(entities, [join('a', 2, 'b', 0), join('a', 2, 'c', 0)]);
});

test('native Swell line-arc and arc-arc joins match JS without transition suppression', () => {
  const a = swell({ id: 'a', type: 'arc', center: [0, 0], radius: 40,
    start: [40, 0], arcPoint: [40 / Math.sqrt(2), 40 / Math.sqrt(2)], end: [0, 40] });
  const b = swell({ id: 'b', type: 'arc', center: [0, 80], radius: 40,
    start: [0, 40], arcPoint: [-40 / Math.sqrt(2), 80 - 40 / Math.sqrt(2)], end: [-40, 80] });
  check([a, b], [join('a', 2, 'b', 0)]);
  check([line('l', [40, -50], [40, 0]), a], [join('l', 2, 'a', 0)]);
});

test('native Swell numeric parameter mutations preserve CSR topology and arena', () => {
  const f = check([line('a', [0, 0], [80, 0], { swellEnabled: false, offsetExpression: 'offset' })], [],
    { parameters: [{ id: 'offset', name: 'offset', kind: 'user', expression: '2', value: 2, unit: 'mm' }] });
  const memory = f.session.native.memory.buffer, rows = f.session.native.buffer(5);
  for (const value of [20, -4, 0, 2]) {
    f.controller.dimensions.set({ ...f.controller.dimensions.get('offset'), expression: String(value) });
    f.session.prepare(f.options); assert.equal(f.session.native.linearize(), 1);
    const expected = f.controller.registry.evaluate(f.controller.model, f.controller.dimensions).values;
    const actual = f.session.view(8, Float64Array, f.session.rowCount);
    expected.forEach((v, i) => assert.ok(Math.abs(v - actual[i]) < 1e-9));
    assert.equal(f.session.topologyBuilds, 1);
    assert.equal(f.session.native.memory.buffer, memory); assert.equal(f.session.native.buffer(5), rows);
  }
});

test('native Swell rejects a missing derived piece and restores a failed final solve', () => {
  const f = check([line('a')]);
  f.controller.model.updateEntity({ ...f.controller.model.entity('a'), end: [10, 20] });
  const before = f.controller.model.allVariables().map(v => v.value);
  const result = f.session.solve(f.options);
  assert.equal(result.status, 'invalid');
  assert.deepEqual(f.controller.model.allVariables().map(v => v.value), before);
});

test('native Swell derived arc radius edits do not impose source arc center reductions', () => {
  for (const native of [false, true]) {
    const h = Math.sqrt(60 ** 2 - 50 ** 2);
    const entity = swell({ id: 'a', type: 'arc', start: [-50, 0], end: [50, 0], center: [0, h], radius: 60, arcPoint: [0, h - 60] },
      { swellEnabled: false, offsetExpression: '-10' });
    const derived = { kind: 'arc', recordId: 'a', derivedFeature: { provider: 'swell', segmentIndex: null, role: 'offset', ordinal: 0 } };
    const controller = new SolverController({ jacobianMode: 'blocks', numericBackend: native ? new WasmSolverBackend(module) : null });
    controller.loadSketch({ drawingUnit: 'mm', entities: [entity], constraints: [
      { id: 'start', type: 'Fixed', featureRefs: [ref('a', 0)], fixedPoint: [-50, 0] },
      { id: 'end', type: 'Fixed', featureRefs: [ref('a', 2)], fixedPoint: [50, 0] },
      { id: 'radius', type: 'Radius', featureRefs: [derived], value: 50 },
    ] });
    for (const target of [55, 50]) {
      controller.model.constraints.get('radius').value = target;
      const result = controller.solve({ fullSolve: true, tolerance: 1e-8 });
      assert.equal(result.status, 'converged', (native ? 'WASM: ' : 'JS: ') + result.message);
      assert.ok(Math.hypot(...controller.registry.evaluate(controller.model, controller.dimensions).values) < 1e-8);
      assert.ok(Math.abs(controller.model.entity('a').radius - (target + 10)) < 1e-8);
      if (native) assert.equal(result.backend, 'wasm');
    }
  }
});

test('resident native Swell iterations need no JavaScript geometry or derivative callbacks', () => {
  const controller = new SolverController({ jacobianMode: 'blocks' });
  controller.loadSketch({ drawingUnit: 'mm', entities: [line('a', [0, 0], [80, 0], { swellEnabled: false }), { id: 'probe', type: 'point', point: [30, 15] }] });
  controller.model.addConstraint({ id: 'on', type: 'Point-on Line', featureRefs: [ref('probe'), { kind: 'segment', recordId: 'a', index: 0,
    derivedFeature: { provider: 'swell', segmentIndex: 0, role: 'offset', ordinal: 0 } }] });
  const options = { model: controller.model, dimensions: controller.dimensions, registry: controller.registry, tolerance: 1e-8 };
  const session = new WasmSolverSession(module); session.prepare(options);
  const provider = controller.model.derivedFeatureProviders.get('swell'), binding = provider.binding;
  provider.binding = () => { throw Error('JavaScript Swell evaluation reached during native solve'); };
  let result;
  try { result = session.solve(options, true); } finally { provider.binding = binding; }
  assert.equal(result.backend, 'wasm'); assert.equal(result.status, 'converged');
  assert.ok(Math.hypot(...controller.registry.evaluate(controller.model, controller.dimensions).values) < 1e-8);
});

test('native Swell finite differences include reduced arc center dependencies', () => {
  const entity = swell({ id: 'a', type: 'arc', start: [-50, 0], end: [50, 0], center: [0, 0], radius: 50, arcPoint: [0, -50] }, { swellEnabled: false });
  const f = check([entity], [
    { id: 'radius', type: 'Radius', featureRefs: [{ kind: 'arc', recordId: 'a' }], value: 50 },
    { id: 'chord', type: 'Distance', featureRefs: [ref('a', 0), ref('a', 2)], value: 100 },
  ]);
  assert.equal(f.session.arcGeometry.dependencies.size, 2);
});
