import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ParameterRepository } from '../../packages/paramagic-core/src/modules/solver/ParameterRepository.js';
import { WasmSolverBackend } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';
import { WasmParameters } from '../../packages/paramagic-core/src/modules/solver/WasmParameters.js';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { ConstraintGraph } from '../../packages/paramagic-core/src/modules/solver/ConstraintGraph.js';
import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { createSwellGeometryEvaluator, deriveSwellGeometry, withSwellDefinition } from '../../packages/paramagic-core/src/modules/SwellGeometry.js';
const module = new WebAssembly.Module(readFileSync(new URL('../../packages/paramagic-core/src/modules/solver/wasm/solver.wasm', import.meta.url)));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/front-view-large-control-edit.paramagic', import.meta.url)));
const entries = expressions => expressions.map((expression, i) => ({ id: `p${i}`, name: `p${i}`, expression, kind: 'user', value: 0, computed: false, unit: null, order: i }));
const pair = expressions => [false, true].map(native => { const r = new ParameterRepository(); if (native) r.numericEvaluator = new WasmParameters(module); r.restore(entries(expressions), { emit: false }); r.evaluateDirty({ strict: false }); return r; });
function compare(a, b) {
  assert.equal(a.entries.size, b.entries.size);
  for (const [id, entry] of a.entries) {
    const other = b.entries.get(id);
    assert.equal(other.error, entry.error, id);
    assert.equal(typeof other.value, typeof entry.value, id);
    if (typeof entry.value === 'number') assert.ok(Object.is(entry.value, other.value) || Math.abs(entry.value - other.value) <= 1e-12 * Math.max(1, Math.abs(entry.value)), `${id}: ${entry.value} != ${other.value}`);
    else assert.equal(other.value, entry.value, id);
  }
}

test('native parameter batch preserves grammar, units, types, eager branches and errors', () => {
  const expressions = ['2', 'p0 + 3 * 4 ^ 2', '-2^2', '2 ^ -2', '1 in + 10 mm',
    'abs(-4)', 'min(4, 2, 8)', 'max(4, 2, 8)', 'round(-0.5)', 'floor(-1.1)', 'ceil(-1.1)',
    'sqrt(81)', 'pow(2, 3)', 'clamp(-2, 0, 10)', 'MinMax(10, 2, 5, 1)',
    'sin(30) + cos(60)', 'tan(45)', 'asin(0.5)', 'acos(0.5)', 'atan(1)',
    'true == 1', 'false != 0', '!0', '1 < 2 && 4 >= 3', 'if(0, true, 4)',
    'if(true, false, 4)', 'min(1 / 0, 2)', '0 / 0 < 1', '!(0 / 0)',
    'if(false, sqrt(-1), 3)', '"hello"', 'if(true, "hello", "world")', 'sqrt(-1)', 'missing + 1'];
  const [js, native] = pair(expressions.slice(0, 29)); compare(js, native);
  assert.ok(native.numericEvaluator.evaluatedEntries > 20);
  for (const r of [js, native]) { r.update('p0', { expression: '3' }); r.setDefaultLengthUnit('in'); }
  compare(js, native);
  compare(...pair(expressions.slice(29)));
  compare(...pair(['min(true)', 'max(false)', 'min(true) == 1', 'max(false) == 0']));
  compare(...pair(['pow(-1, 1 / 0)', 'pow(1, 1 / 0)', 'pow(1, 0 / 0)', '(-1) ^ (1 / 0)', '(1 ^ (1 / 0)) < 2']));
});

test('resident numeric expression program updates literals, renames, dependencies and rollback', () => {
  const [js, native] = pair(['2', 'p0 * 3', 'p1 + p0', 'if(p2 > 5, true, false)']);
  const buffer = native.numericEvaluator.native.memory.buffer;
  for (const value of [3, 4, 2]) { for (const r of [js, native]) r.update('p0', { expression: String(value) }); compare(js, native); }
  assert.equal(native.numericEvaluator.native.memory.buffer, buffer);
  for (const r of [js, native]) { r.update('p0', { name: 'Width' }); r.update('p1', { expression: 'Width * 4' }); }
  compare(js, native);
  for (const r of [js, native]) assert.throws(() => r.update('p0', { expression: 'p2 + 1' }, { strict: true }), /cycle/i);
  compare(js, native);
  for (const r of [js, native]) { r.restoreEntries(r.snapshot(), { emit: false }); r.update('p0', { expression: '5' }); }
  compare(js, native);
  assert.equal(native.entries.get('p2').value, 25);
  assert.deepEqual([...native.affectedIds('p0')].sort(), [...js.affectedIds('p0')].sort());
});

test('native numeric DAG handles 10,000 dependent parameters and reuses program memory', () => {
  const input = Array.from({ length: 10000 }, (_, i) => i ? `p${i - 1} + 1` : '1');
  const [js, native] = pair(input), plan = native.numericEvaluator.plan;
  for (const r of [js, native]) r.update('p0', { expression: '2' });
  compare(js, native);
  assert.equal(native.entries.get('p9999').value, 10001);
  assert.equal(native.numericEvaluator.plan, plan);
});

test('native component graph matches JavaScript after bridges, splits and disabled constraints', () => {
  const model = new SketchModel();
  for (let i = 0; i < 80; i++) model.addEntity({ id: `line${i}`, type: 'line', start: [i, 0], end: [i + 1, 0] });
  const backend = new WasmSolverBackend(module), js = new ConstraintGraph(model), native = new ConstraintGraph(model, { nativeGraph: backend.createGraph() });
  const signature = graph => [...graph.components.values()].map(c => JSON.stringify(
    ['variableIds', 'constraintIds', 'intrinsicEntityIds', 'entityIds', 'dimensionIds'].map(key => [...c[key]].sort()))).sort();
  for (let i = 0; i < 79; i++) { model.addConstraint({ id: `join${i}`, type: 'Coincident', featureRefs: [{ kind: 'point', recordId: `line${i}`, index: 2 }, { kind: 'point', recordId: `line${i + 1}`, index: 0 }] }); js.addConstraint(`join${i}`); native.addConstraint(`join${i}`); }
  assert.deepEqual(signature(native), signature(js));
  for (const id of ['join30', 'join40', 'join50']) { model.constraints.delete(id); js.removeConstraint(id); native.removeConstraint(id); }
  assert.deepEqual(signature(native), signature(js));
  for (const enabled of [false, true]) {
    model.constraints.get('join20').enabled = enabled;
    js.refreshConstraints(['join20']); native.refreshConstraints(['join20']);
    assert.deepEqual(signature(native), signature(js));
  }
  assert.ok(native.nativeGraph.builds > 80);
});

test('supplied drawing uses native placement, sparse elimination and resident continuation', () => {
  const backend = new WasmSolverBackend(module), c = new SolverController({ jacobianMode: 'blocks', numericBackend: backend });
  c.loadSketch(structuredClone(fixture));
  const { result } = c.updateParameter(c.parameters().find(p => p.name === 'c1').id, { expression: '85' });
  assert.equal(result.status, 'converged');
  assert.equal(result.placementBackend, 'wasm');
  assert.ok([...backend.sessions.keys()].some(key => String(key).startsWith('placement:')));
  assert.ok([...backend.sessions.values()].some(s => s.view(14, Float64Array, 20)[17] > 0));
  assert.ok(backend.continuation.predictions > 0);
  assert.equal(c.constraints().filter(x => x.enabled !== false).length, 193);
  assert.ok(Math.hypot(...c.registry.evaluate(c.model, c.dimensions).values) < 1e-8);
});

test('native display geometry preserves Swell pieces and rejects stale source/parameter state', () => {
  const backend = new WasmSolverBackend(module), c = new SolverController({ jacobianMode: 'blocks', numericBackend: backend });
  const shapes = [
    { id: 'line', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'arc', type: 'arc', start: [150, 0], arcPoint: [200, 50], end: [250, 0], center: [200, 0], radius: 50, ccw: false },
    { id: 'circle', type: 'circle', center: [400, 10], radius: 25 },
    { id: 'polygon', type: 'polygon', points: [[500, 0], [550, 0], [550, 50], [500, 50]] },
    { id: 'curve', type: 'curve', points: [[600, 0], [630, 20], [650, 0]] },
  ].map(e => withSwellDefinition(e, { swellEnabled: true, offsetExpression: '2', swellOffsetExpression: '6', startTransitionExpression: '8', endTransitionExpression: '8' }));
  c.loadSketch({ drawingUnit: 'mm', entities: shapes });
  const input = () => ({ entities: c.model.snapshot(), constraints: c.constraints(), evaluateLength: (expression, entity) => c.dimensions.evaluateLengthExpression(expression, { stackId: entity.stackId }) });
  const packet = backend.derivedGeometry(c.model, c.dimensions).swell, evaluate = createSwellGeometryEvaluator();
  const actual = evaluate({ ...input(), nativeGeometry: packet }), expected = deriveSwellGeometry(input());
  const near = (a, b) => { if (typeof b === 'number') assert.ok(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
    else if (b && typeof b === 'object') for (const key of Object.keys(b)) near(a[key], b[key]); else assert.equal(a, b); };
  for (const [id, value] of expected) near(actual.get(id).pieces, value.pieces);
  assert.equal(evaluate.stats.nativeHits, 1);
  c.model.binding('line').variables.get('end.x').value = 101;
  evaluate({ ...input(), nativeGeometry: packet });
  assert.equal(evaluate.stats.nativeHits, 1); assert.equal(evaluate.stats.lastBackend, 'javascript');
  const updated = backend.derivedGeometry(c.model, c.dimensions).swell;
  evaluate({ ...input(), nativeGeometry: updated });
  assert.equal(evaluate.stats.nativeHits, 2);
});
