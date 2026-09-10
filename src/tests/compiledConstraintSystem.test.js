import test from 'node:test';
import assert from 'node:assert/strict';
import { compileConstraintSystem } from '../../packages/paramagic-core/src/modules/solver/CompiledConstraintSystem.js';
import { createMatrixFreeJacobian, assembleJacobianBlocks, JacobianBlockCancellationError } from '../../packages/paramagic-core/src/modules/solver/JacobianBlocks.js';
import { multiply, transpose, multiplyMatrixVector, solveLinearSystem, solveLevenbergMarquardt, DimensionRepository } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';

function chain(size, { anchored = true, scale = 1 } = {}) {
  const variables = Array.from({ length: size }, (_, index) => ({ id: `v${index}`, ownerId: `e${Math.floor(index / 4)}` }));
  const blocks = [];
  function add(columns, values) {
    blocks.push({
      runtimeKey: `b${blocks.length}`, variables: columns.map(column => variables[column]), columnIndexes: columns,
      equations: [{}], evaluateResiduals: () => [0], evaluateAnalyticalJacobian: () => [values],
    });
  }
  for (let index = 1; index < size; index += 1) add([index - 1, index], [scale, -scale]);
  if (anchored) for (let index = 0; index < size; index += 7) add([index], [scale]);
  return { variables, blocks };
}

for (const scale of [0.001, 1, 1000]) {
  test(`compiled elimination matches a dense reference at scale ${scale}`, () => {
    const contract = chain(48, { scale });
    const compiled = compileConstraintSystem(contract);
    const operator = createMatrixFreeJacobian(contract);
    const jacobian = assembleJacobianBlocks(contract).matrix;
    const errors = Array.from({ length: operator.rowCount }, (_, index) => Math.sin(index) * scale);
    for (const lambda of [0.00001, 0.01, 10]) {
      const normal = multiply(transpose(jacobian), jacobian);
      normal.forEach((row, index) => { row[index] += lambda * Math.max(Math.abs(row[index]), 1) + 1e-7; });
      const expected = solveLinearSystem(normal, multiplyMatrixVector(transpose(jacobian), errors).map(value => -value));
      const actual = compiled.solve(operator, errors, lambda);
      assert.equal(actual.converged, true);
      actual.step.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-7 * Math.max(1, Math.abs(expected[index]))));
    }
    assert.ok(compiled.fillEntries < contract.variables.length * 3, 'A chain compiles to linear storage');
  });
}

test('floating networks preserve their common translation freedom', () => {
  const contract = chain(96, { anchored: false });
  const compiled = compileConstraintSystem(contract);
  const operator = createMatrixFreeJacobian(contract);
  const result = compiled.solve(operator, Array(operator.rowCount).fill(0.5), 0.01);
  assert.equal(result.converged, true);
  assert.ok(Math.abs([...result.step].reduce((sum, value) => sum + value, 0)) < 1e-8);
  assert.ok(contract.variables.every(variable => !variable.fixed && !variable.locked));
});

test('cached topology is reused with isolated numeric workspaces and invalidates on new connectivity', () => {
  const contract = chain(39);
  const first = compileConstraintSystem(contract);
  const second = compileConstraintSystem(contract);
  assert.equal(second.cacheHit, true);
  const operator = createMatrixFreeJacobian(contract);
  const errors = Array(operator.rowCount).fill(0.25);
  const expected = first.solve(operator, errors, 0.01).step;
  second.solve(operator, errors.map(value => -value), 10);
  assert.deepEqual(first.solve(operator, errors, 0.01).step, expected);
  const changed = chain(39);
  changed.blocks[0].columnIndexes = [0, 38];
  changed.blocks[0].variables = [changed.variables[0], changed.variables[38]];
  const changedOperator = createMatrixFreeJacobian(changed);
  const newPlan = compileConstraintSystem(changed);
  assert.equal(newPlan.cacheHit, false);
  assert.equal(newPlan.solve(changedOperator, errors, 0.01).converged, true);
  assert.throws(() => first.solve(changedOperator, errors, 0.01), /columns do not match/);
});

test('compilation and factorization respect cancellation and resource budgets', () => {
  const contract = chain(64);
  assert.throws(() => compileConstraintSystem(contract, { shouldCancel: () => true }), JacobianBlockCancellationError);
  const compiled = compileConstraintSystem(contract);
  const operator = createMatrixFreeJacobian(contract);
  assert.throws(() => compiled.solve(operator, Array(operator.rowCount).fill(1), 0.01, { shouldCancel: () => true }), JacobianBlockCancellationError);
  assert.equal(compileConstraintSystem(chain(2049)), null);
  assert.equal(compiled.solve(operator, Array(operator.rowCount).fill(1), 0.01).converged, true);
});

test('constant residual blocks have a distinct cache topology from an empty system', () => {
  const empty = chain(1, { anchored: false });
  compileConstraintSystem(empty);
  const constant = { ...empty, blocks: [{
    variables: [], columnIndexes: [], equations: [{}],
    evaluateResiduals: () => [1], evaluateAnalyticalJacobian: () => [[]],
  }] };
  const compiled = compileConstraintSystem(constant);
  assert.equal(compiled.cacheHit, false);
  assert.deepEqual([...compiled.solve(createMatrixFreeJacobian(constant), [1], 0.01).step], [0]);
});

test('arc solve cancellation inside compilation restores the drawing and does not retain locks', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'arc', type: 'arc', start: [-1, 0], end: [1, 0], arcPoint: [0, 1], center: [0, 0], radius: 1, ccw: false });
  model.addConstraint({ id: 'radius', type: 'Radius', value: 1, featureRefs: [{ kind: 'arc', recordId: 'arc' }] });
  model.addConstraint({ id: 'chord', type: 'Distance', value: 1.9, featureRefs: [0, 2].map(index => ({ kind: 'point', recordId: 'arc', index })) });
  const before = model.allVariables().map(variable => variable.value);
  let polls = 0;
  const result = solveLevenbergMarquardt({ model, dimensions: new DimensionRepository(), registry: new ConstraintRegistry(), jacobianMode: 'blocks', matrixFreeVariableThreshold: 0, shouldCancel: () => ++polls >= 2 });
  assert.equal(result.status, 'cancelled', result.message);
  assert.deepEqual(model.allVariables().map(variable => variable.value), before);
  assert.ok(model.allVariables().every(variable => variable.active));
});
