import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WasmSolverSession, WasmSolverBackend, loadWasmSolverModule } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';
import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { DimensionRepository } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { assembleJacobianBlocks } from '../../packages/paramagic-core/src/modules/solver/JacobianBlocks.js';
import { solveConstraintScope } from '../../packages/paramagic-core/src/modules/solver/ComponentSolver.js';
import { SolverWorkerRuntime } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerRuntime.js';
import { SolverWorkerClient } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerClient.js';
import { createSolverWorkerRequest, createSolverWorkerResult } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerProtocol.js';
import { connectedChain, pointRef, segmentRef, snapshot, verify } from '../../scripts/solver-baseline/fixtures.js';

const module = await loadWasmSolverModule(readFileSync(new URL('../../packages/paramagic-core/src/modules/solver/wasm/solver.wasm', import.meta.url)));
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (tolerance ${tolerance})`);
const request = (requestToken, type, payload = {}) => createSolverWorkerRequest({ requestToken, generation: requestToken, type, payload });

function equations(type, options = {}) {
  const model = new SketchModel(), dimensions = new DimensionRepository(), registry = new ConstraintRegistry();
  model.addEntity({ id: 'line', type: 'line', start: [2, 3], end: [7, 9] });
  model.addEntity({ id: 'point', type: 'point', point: options.point || [4, 6] });
  model.addEntity({ id: 'circle', type: 'circle', center: [0, 0], radius: options.radius ?? 2 });
  model.addEntity({ id: 'circle2', type: 'circle', center: [1, 3], radius: 4 });
  const features = {
    Horizontal: [segmentRef('line')], Vertical: [segmentRef('line')],
    Coincident: [pointRef('line'), pointRef('point')],
    Distance: [pointRef('line'), pointRef('line', 2)],
    'Horizontal Distance': [pointRef('line'), pointRef('line', 2)],
    'Vertical Distance': [pointRef('line'), pointRef('line', 2)],
    Fixed: [pointRef('point')], Radius: [segmentRef('circle')], Diameter: [segmentRef('circle')],
    Midpoint: [pointRef('point'), segmentRef('line')],
    Concentric: [segmentRef('circle'), segmentRef('circle2')],
    'Point-on Circle': [pointRef('point'), segmentRef('circle')],
  };
  model.addConstraint({ id: 'constraint', type, featureRefs: features[type], value: 5, fixedPoint: [1, 1], ...options.constraint });
  return { model, dimensions, registry };
}

for (const type of ['Coincident', 'Horizontal', 'Vertical', 'Distance', 'Horizontal Distance', 'Vertical Distance', 'Fixed',
  'Radius', 'Diameter', 'Midpoint', 'Concentric', 'Point-on Circle']) {
  test(`native ${type} residual and analytical Jacobian match JS`, () => {
    checkLinearization(equations(type));
  });
}
function checkLinearization(f) {
  const session = new WasmSolverSession(module);
  session.prepare(f); assert.equal(session.native.linearize(), 1);
  const expected = assembleJacobianBlocks(f.registry.blocks(f.model, f.dimensions)).matrix;
  const residuals = f.registry.evaluate(f.model, f.dimensions).values;
  const nativeResiduals = session.view(8, Float64Array, session.rowCount);
  const values = session.view(7, Float64Array, session.entryCount);
  const offsets = session.view(5, Int32Array, session.rowCount + 1);
  const columns = session.view(6, Int32Array, session.entryCount);
  assert.equal(session.rowCount, residuals.length);
  for (let row = 0; row < session.rowCount; row++) {
    close(nativeResiduals[row], residuals[row], 1e-12);
    const actual = new Float64Array(f.model.activeVariables().length);
    for (let e = offsets[row]; e < offsets[row + 1]; e++) actual[columns[e]] = values[e];
    expected[row].forEach((value, column) => close(actual[column], value, 1e-7));
  }
}

test('native LM continues small improving corrections to the requested final tolerance', () => {
  const f = equations('Radius', { radius: 1, constraint: { value: 1 + 5e-10, featureRefs: [{ kind: 'circle', recordId: 'circle' }] } });
  const result = new WasmSolverSession(module).solve({ ...f, tolerance: 2e-12 });
  assert.equal(result.status, 'converged');
  assert.ok(result.acceptedSteps > 1);
  assert.ok(result.jacobianStats.derivativeEntries > 0);
  assert.ok(Math.hypot(...f.registry.evaluate(f.model, f.dimensions).values) < 2e-12);
});

test('native derivative branches preserve degeneracies and signed radius semantics', () => {
  for (const radius of [0, -2, 1, 1 + 1e-10, 5]) {
    for (const point of [[0, 0], [1, 0], [3, 4], [1 + 1e-10, 0]]) checkLinearization(equations('Point-on Circle', { radius, point }));
    checkLinearization(equations('Radius', { radius }));
  }
  for (const direction of [[1, 0], [-1, 0]]) checkLinearization(equations('Distance', { constraint: { direction } }));
  const degenerate = equations('Distance');
  degenerate.model.updateEntity({ id: 'line', type: 'line', start: [0, 0], end: [0, 0] });
  checkLinearization(degenerate);
});

test('persistent repeated edits match the JS oracle and keep topology and arena', () => {
  const reference = connectedChain(300, { sharedTarget: true }), native = connectedChain(300, { sharedTarget: true });
  const backend = new WasmSolverBackend(module);
  let memory, rowOffset;
  for (const target of [84.125, 84.15, 84]) {
    const results = [reference, native].map((f, index) => {
      f.dimensions.set({ ...f.dimensions.get('baseline-width'), expression: String(target) });
      return solveConstraintScope({ model: f.scopedModel, registry: f.registry, dimensions: f.dimensions,
        jacobianMode: 'blocks', numericBackend: index ? backend : null });
    });
    assert.equal(results[1].backend, 'wasm'); assert.equal(results[1].status, results[0].status);
    close(results[1].finalError, results[0].finalError, 1e-9);
    reference.model.allVariables().forEach((v, i) => close(v.value, native.model.allVariables()[i].value, 1e-5));
    close(native.dimensions.value('baseline-width'), reference.dimensions.value('baseline-width'), 1e-12);
    assert.ok(verify(native, target).residualL2 < 1e-3);
    const session = [...backend.sessions.values()][0];
    if (memory) { assert.equal(session.native.memory.buffer, memory); assert.equal(session.native.buffer(5), rowOffset); }
    memory = session.native.memory.buffer; rowOffset = session.native.buffer(5);
    assert.equal(session.topologyBuilds, 1);
  }
});

test('native topology responds to structural edits, enabled states, and references', () => {
  const f = equations('Horizontal'), session = new WasmSolverSession(module);
  session.prepare(f); assert.equal(session.topologyBuilds, 1);
  f.model.constraints.get('constraint').enabled = false;
  session.prepare(f); assert.equal(session.topologyBuilds, 2); assert.equal(session.rowCount, 0);
  f.model.constraints.get('constraint').enabled = true;
  f.model.addConstraint({ id: 'vertical', type: 'Vertical', featureRefs: [segmentRef('line')] });
  session.prepare(f); assert.equal(session.topologyBuilds, 3);
  f.model.removeConstraint('vertical'); session.prepare(f); assert.equal(session.topologyBuilds, 4);
  f.model.addEntity({ id: 'new', type: 'line', start: [0, 1], end: [1, 0] });
  f.model.constraints.get('constraint').featureRefs = [segmentRef('new')];
  session.prepare(f); assert.equal(session.topologyBuilds, 5);
});

test('native preserves free-floating gauge, cancellation rollback, and lock release', () => {
  const f = connectedChain(300, { floating: true, sharedTarget: true });
  f.dimensions.set({ ...f.dimensions.get('baseline-width'), expression: '84.125' });
  const before = f.model.snapshot();
  const result = solveConstraintScope({ model: f.scopedModel, registry: f.registry, dimensions: f.dimensions,
    jacobianMode: 'blocks', numericBackend: new WasmSolverBackend(module), shouldCancel: () => 'superseded' });
  assert.equal(result.status, 'cancelled'); assert.equal(result.translationGaugeVariableIds.length, 2);
  assert.deepEqual(f.model.snapshot(), before);
  assert.ok(f.model.allVariables().every(v => !v.locked));
  assert.ok([...f.model.constraints.values()].every(c => c.type !== 'Fixed'));
});

test('inconsistent constraints and no-free-variable cases cannot report false convergence', () => {
  for (const locked of [false, true]) {
    const f = equations('Horizontal');
    f.model.addConstraint({ id: 'fixed-start', type: 'Fixed', featureRefs: [pointRef('line')], fixedPoint: [2, 3] });
    f.model.addConstraint({ id: 'fixed-end', type: 'Fixed', featureRefs: [pointRef('line', 2)], fixedPoint: [7, 9] });
    if (locked) f.model.allVariables().forEach(v => { v.locked = true; });
    const before = f.model.snapshot();
    const result = new WasmSolverSession(module).solve({ ...f, tolerance: 1e-8, maxIterations: 100 });
    assert.ok(['max-iterations', 'failed'].includes(result.status), result.status);
    assert.deepEqual(f.model.snapshot(), before);
  }
});

test('arc intrinsic equations now run through the native backend', () => {
  const f = equations('Horizontal');
  f.model.addEntity({ id: 'arc', type: 'arc', start: [5, 0], arcPoint: [0, 5], end: [-5, 0] });
  const result = solveConstraintScope({ ...f, jacobianMode: 'blocks', numericBackend: new WasmSolverBackend(module) });
  assert.equal(result.backend, 'wasm'); assert.equal(result.status, 'converged');
});

test('async Worker dimension transactions cancel, restore, then commit the newest revision', async () => {
  const f = connectedChain(1000, { sharedTarget: true });
  const runtime = new SolverWorkerRuntime({ jacobianMode: 'blocks', numericBackend: new WasmSolverBackend(module) });
  runtime.handleRequest(request(1, 'load-sketch', { snapshot: snapshot(f) }));
  const before = runtime.controller.getGeometrySnapshot();
  const pending = runtime.handleRequestAsync(request(2, 'set-dimension', { dimensionId: 'baseline-width', expression: '84.125' }));
  runtime.supersede(2);
  const obsolete = await pending;
  assert.equal(obsolete.status, 'superseded'); assert.equal(obsolete.revision, 2);
  assert.deepEqual(runtime.controller.getGeometrySnapshot(), before);
  close(runtime.controller.dimensions.value('baseline-width'), 84);
  const latest = await runtime.handleRequestAsync(request(3, 'set-dimension', { dimensionId: 'baseline-width', expression: '84.2' }));
  assert.equal(latest.status, 'converged'); assert.equal(latest.revision, 3); assert.equal(latest.diagnostics.backend, 'wasm');
  close(runtime.controller.dimensions.value('baseline-width'), 84.2);
  assert.ok(latest.diagnostics.finalError < 1e-6);
});

test('native Worker client coalesces same-dimension edits but respects ordering barriers', () => {
  const sent = [], worker = { postMessage: message => sent.push(message), addEventListener() {} };
  const client = new SolverWorkerClient(worker, { backend: 'wasm' });
  client.setDimension('d1', '84.1'); client.setDimension('d1', '84.2'); client.setDimension('d1', '84.3');
  assert.equal(sent.filter(m => m.type === 'supersede').length, 2);
  assert.equal(client.queue.length, 1); assert.equal(client.queue[0].request.payload.expression, '84.3');
  client.addEntity({ id: 'point', type: 'point', point: [0, 0] }); client.setDimension('d1', '84.4');
  assert.equal(sent.filter(m => m.type === 'supersede').length, 2);
});

test('a completed obsolete revision is hidden and carried into the next accepted delta', async () => {
  const sent = [], worker = { postMessage: message => sent.push(message), addEventListener() {} };
  const client = new SolverWorkerClient(worker, { backend: 'wasm' });
  const old = client.setDimension('d1', '84.1');
  const latest = client.setDimension('d1', 'invalid_expression');
  const entity = { id: 'line', type: 'line', start: [0, 0], end: [84.1, 0] };
  client.handleMessage({ data: createSolverWorkerResult(sent[0], {
    status: 'converged', changedEntities: [entity], changedParameters: [{ id: 'd1', value: 84.1 }],
  }) });
  assert.equal((await old).status, 'superseded'); assert.deepEqual((await old).changedEntities, []);
  client.handleMessage({ data: createSolverWorkerResult(sent.at(-1), { status: 'invalid' }) });
  const result = await latest;
  assert.equal(result.revision, 2); assert.deepEqual(result.changedEntities, [entity]);
  assert.equal(result.changedParameters[0].value, 84.1);
});

test('expression-driven parameter updates retain JavaScript values and native geometry parity', async () => {
  const input = snapshot(connectedChain(120, { sharedTarget: true }));
  input.parameters[0].expression = 'WIDTH';
  input.parameters.push({ id: 'width-source', name: 'WIDTH', kind: 'user', expression: '84', value: 84, computed: false });
  const reference = new SolverWorkerRuntime({ jacobianMode: 'blocks' });
  const native = new SolverWorkerRuntime({ jacobianMode: 'blocks', numericBackend: new WasmSolverBackend(module) });
  for (const runtime of [reference, native]) runtime.handleRequest(request(1, 'load-sketch', { snapshot: structuredClone(input) }));
  const mutation = request(2, 'update-parameter', { parameterId: 'width-source', patch: { expression: '84.125' } });
  const a = reference.handleRequest(mutation), b = await native.handleRequestAsync(mutation);
  assert.equal(b.status, a.status); assert.equal(b.diagnostics.backend, 'wasm');
  close(native.controller.dimensions.value('baseline-width'), reference.controller.dimensions.value('baseline-width'));
  reference.controller.model.allVariables().forEach((v, i) => close(v.value, native.controller.model.allVariables()[i].value, 1e-5));
});

test('native drag preview retains the existing final tolerance and releases locks', () => {
  const runtime = new SolverWorkerRuntime({ jacobianMode: 'blocks', numericBackend: new WasmSolverBackend(module),
    interactiveSolveOptions: { maxIterations: 1, timeBudgetMs: Infinity } });
  runtime.handleRequest(request(1, 'load-sketch', { snapshot: {
    entities: [{ id: 'line', type: 'line', start: [0, 0], end: [10, 0] }],
    constraints: [{ id: 'horizontal', type: 'Horizontal', featureRefs: [segmentRef('line')] }],
  } }));
  const locks = runtime.controller.variableIdsForFeature(pointRef('line', 2));
  const preview = runtime.handleRequest(request(2, 'drag-update', {
    entities: [{ id: 'line', type: 'line', start: [0, 0], end: [10, 10] }], lockedVariableIds: locks, previewConstraintTolerance: .2,
  }));
  assert.equal(preview.status, 'preview'); assert.equal(preview.diagnostics.backend, 'wasm');
  const approximate = runtime.controller.getEntity('line');
  assert.ok(Math.abs(approximate.end[1] - approximate.start[1]) > 1e-3);
  const final = runtime.handleRequest(request(3, 'solve', { options: { seedVariableIds: locks } }));
  assert.ok(['converged', 'unchanged'].includes(final.status), final.message);
  const line = runtime.controller.getEntity('line');
  assert.ok(Math.abs(line.start[1] - line.end[1]) < 1e-3); assert.deepEqual(line.end, [10, 10]);
  assert.ok(runtime.controller.model.allVariables().every(v => !v.locked));
});
