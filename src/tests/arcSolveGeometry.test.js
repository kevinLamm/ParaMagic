import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareArcSolveGeometry } from '../../packages/paramagic-core/src/modules/solver/ArcSolveGeometry.js';
import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { DimensionRepository, solveLevenbergMarquardt } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { verifyJacobianBlock, assembleJacobianBlocks, createMatrixFreeJacobian } from '../../packages/paramagic-core/src/modules/solver/JacobianBlocks.js';

function fixture({ scale = 1, ccw = false, angle = 0, chord = 2, dimensionRef = true } = {}) {
  const model = new SketchModel();
  const transform = ([x, y]) => [scale * (x * Math.cos(angle) - y * Math.sin(angle)), scale * (x * Math.sin(angle) + y * Math.cos(angle))];
  model.addEntity({ id: 'arc', type: 'arc', start: transform([-1, 0]), end: transform([1, 0]), arcPoint: transform([0, ccw ? -1 : 1]), center: [0, 0], radius: scale, ccw });
  const dimensions = new DimensionRepository();
  dimensions.set({ id: 'radius', name: 'd1', expression: `${scale} mm` });
  dimensions.set({ id: 'chord', name: 'd2', expression: `${chord * scale} mm` });
  dimensions.evaluateAll();
  model.addConstraint({ id: 'radius', type: 'Radius', featureRefs: [{ kind: 'arc', recordId: 'arc' }], ...(dimensionRef ? { dimensionRef: 'radius' } : { value: scale }) });
  model.addConstraint({ id: 'chord', type: 'Distance', featureRefs: [0, 2].map((index) => ({ kind: 'point', recordId: 'arc', index })), ...(dimensionRef ? { dimensionRef: 'chord' } : { value: chord * scale }) });
  return { model, dimensions, registry: new ConstraintRegistry() };
}

for (const jacobianMode of ['dense', 'blocks']) {
  for (const ccw of [false, true]) {
    test(`a semicircle can shorten its chord without changing radius (${jacobianMode}, ccw=${ccw})`, () => {
      for (const scale of [0.1, 1, 100]) {
        const context = fixture({ scale, ccw, angle: 0.7, chord: 1.9 });
        const beforeConstraints = structuredClone([...context.model.constraints.values()]);
        const result = solveLevenbergMarquardt({ ...context, jacobianMode, tolerance: 1e-8 });
        assert.equal(result.status, 'converged', result.message);
        const arc = context.model.entity('arc');
        assert.ok(Math.abs(arc.radius - scale) < 1e-7);
        assert.ok(Math.abs(Math.hypot(arc.end[0] - arc.start[0], arc.end[1] - arc.start[1]) - 1.9 * scale) < 1e-6);
        assert.equal(arc.ccw, ccw);
        assert.equal(arc.major, false);
        assert.deepEqual([...context.model.constraints.values()], beforeConstraints);
        assert.ok(context.model.allVariables().every((variable) => variable.active));
      }
    });
  }
}

test('a starting semicircle without a diameter constraint keeps its center degrees of freedom', () => {
  const { model, dimensions } = fixture();
  model.constraints.delete('chord');
  const variables = model.activeVariables();
  const geometry = prepareArcSolveGeometry(model, dimensions, variables);
  assert.equal(geometry.reducedArcCenters, 0);
  assert.deepEqual(geometry.variables, variables);
  model.binding('arc').variables.get('center.y').value = 0.2;
  geometry.project();
  assert.equal(model.binding('arc').variables.get('center.y').value, 0.2);
});

test('required semicircles chain center derivatives into endpoints including tangent blocks', () => {
  const { model, dimensions, registry } = fixture({ dimensionRef: false });
  model.addEntity({ id: 'line', type: 'line', start: [1, 0], end: [1, 3] });
  model.addConstraint({ id: 'tangent', type: 'Tangent', featureRefs: [{ kind: 'segment', recordId: 'line' }, { kind: 'arc', recordId: 'arc' }], tangentPoint: { kind: 'point', recordId: 'arc', index: 2 }, tangentOrientation: 1 });
  const original = model.activeVariables();
  const geometry = prepareArcSolveGeometry(model, dimensions, original);
  assert.equal(geometry.reducedArcCenters, 1);
  assert.equal(geometry.variables.length, original.length - 2);
  geometry.project();
  const contract = geometry.reduceBlocks(registry.blocks(model, dimensions, { variables: original }));
  for (const block of contract.blocks) {
    // Radius/distance normalization can request the local numerical fallback
    // exactly at its scale boundary. Test every available analytical block.
    if (block.evaluateAnalyticalJacobian()) {
      assert.equal(verifyJacobianBlock(block).valid, true, block.runtimeKey);
    }
  }
  geometry.project();
  const dense = assembleJacobianBlocks(contract).matrix;
  const operator = createMatrixFreeJacobian(contract);
  const vector = geometry.variables.map((_, index) => index + 1);
  const expected = dense.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
  assert.deepEqual([...operator.applyJacobian(vector)], expected);
});

test('failed and cancelled semicircle solves restore geometry without retaining locks', () => {
  for (const cancelled of [false, true]) {
    const context = fixture({ chord: 1.9 });
    const variables = context.model.allVariables();
    const before = variables.map((variable) => variable.value);
    const result = solveLevenbergMarquardt({ ...context, jacobianMode: 'blocks', maxIterations: 0, ...(cancelled ? { maxIterations: 10, shouldCancel: () => true } : {}) });
    assert.equal(result.status, cancelled ? 'cancelled' : 'max-iterations');
    assert.deepEqual(variables.map((variable) => variable.value), before);
    assert.ok(variables.every((variable) => variable.active));
  }
});

test('global or disabled coincidence cannot prove a local diameter chord', () => {
  for (const connection of [{ coordinateSpace: 'global' }, { enabled: false }]) {
    const { model, dimensions } = fixture();
    model.constraints.delete('chord');
    model.addEntity({ id: 'line', type: 'line', start: [-1, 0], end: [1, 0] });
    for (const index of [0, 2]) model.addConstraint({ id: `join${index}`, type: 'Coincident', featureRefs: ['arc', 'line'].map((recordId) => ({ kind: 'point', recordId, index })), ...connection });
    model.addConstraint({ id: 'chord', type: 'Distance', value: 2, featureRefs: [0, 2].map((index) => ({ kind: 'point', recordId: 'line', index })) });
    assert.equal(prepareArcSolveGeometry(model, dimensions, model.activeVariables()).reducedArcCenters, 0);
  }
});

test('an inconsistent fully reduced arc restores its original center', () => {
  const context = fixture();
  const binding = context.model.binding('arc');
  binding.variables.get('center.y').value = 0.2;
  context.model.addConstraint({ id: 'conflicting-radius', type: 'Radius', value: 3, featureRefs: [{ kind: 'arc', recordId: 'arc' }] });
  for (const prefix of ['start', 'end']) for (const axis of ['x', 'y']) binding.variables.get(`${prefix}.${axis}`).fixed = true;
  const before = context.model.allVariables().map((variable) => variable.value);
  const result = solveLevenbergMarquardt({ ...context, jacobianMode: 'blocks' });
  assert.equal(result.status, 'failed');
  assert.deepEqual(context.model.allVariables().map((variable) => variable.value), before);
});
