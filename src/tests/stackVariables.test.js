import test from 'node:test';
import assert from 'node:assert/strict';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { createStackActivationSystem } from '../../packages/paramagic-core/src/modules/StackActivationSystem.js';
import { resolveTextFields } from '../../packages/paramagic-core/src/modules/TextTools.js';
import { stackExpressionRenames } from '../../packages/paramagic-core/src/modules/StackVariables.js';
import { rewriteQualifiedDimensionReferences } from '../../packages/paramagic-core/src/modules/NamingSystem.js';

function fixture() {
  const solver = new SolverController();
  solver.loadSketch({ stackState: { activeStackId: 'base', stacks: [
    { id: 'base', name: 'Default', systemRole: 'default-stack' },
    { id: 'front', name: 'Front View', enabled: false, enabledExpression: 'c4 == StackName' },
    { id: 'back', name: 'Back View', enabled: false, enabledExpression: 'c4 == StackName' },
  ] }, parameters: [{ id: 'choice', name: 'c4', kind: 'control', expression: '"Front View"', value: 'Front View' }] });
  const system = createStackActivationSystem({
    getStackState: () => solver.stackState,
    expressionSymbols: options => solver.parameterExpressionSymbols(options),
    expressionEntries: options => solver.parameterExpressionEntries(options),
    evaluateExpression: (expression, options) => solver.evaluateParameterExpression(expression, options),
  });
  return { solver, system };
}

test('StackName compares a control with the evaluated stack, including disabled stacks', () => {
  const { solver, system } = fixture();
  solver.setEnabledStackIds(['base']);
  let result = system.evaluateDirtyStackExpressions();
  assert.equal(result.states.get('front').effectiveEnabled, true);
  assert.equal(result.states.get('back').effectiveEnabled, false);
  assert.deepEqual(system.activationDiagnostics(), []);
  solver.updateParameter('choice', { expression: '"Back View"' });
  system.markActivationDependentsDirty(['choice']);
  result = system.evaluateDirtyStackExpressions();
  assert.equal(result.states.get('front').effectiveEnabled, false);
  assert.equal(result.states.get('back').effectiveEnabled, true);
  assert.deepEqual(new Set(result.evaluatedStackIds), new Set(['front', 'back']));
  assert.deepEqual(system.activationDiagnostics(), []);
});

test('qualified stack names resolve in global expressions and local names resolve in text fields', () => {
  const { solver } = fixture();
  const parameter = solver.createParameter({ name: 'ViewLabel', expression: 'StackName@Front View' });
  assert.equal(parameter.value, 'Front View');
  assert.equal(parameter.error, null);
  assert.equal(solver.evaluateParameterExpression('stackname@front view'), 'Front View');
  assert.equal(solver.evaluateParameterExpression('StackName', { stackId: 'back' }), 'Back View');
  assert.equal(solver.evaluateParameterExpression('"Front View" == StackName', { stackId: 'front' }), true);
  assert.equal(solver.evaluateParameterExpression('"front view" == StackName', { stackId: 'front' }), false);
  assert.equal(resolveTextFields('[StackName] / [StackName@Back View]', solver.parameterExpressionEntries({ stackId: 'front' })), 'Front View / Back View');
  assert.ok(solver.parameterExpressionSymbols({ stackId: 'front' }).some(symbol => symbol.name === 'StackName'));
  assert.throws(() => solver.evaluateParameterExpression('StackName'), /Unknown parameter/);
});

test('stack renaming updates references without needing any dimensions and survives save/open', () => {
  const { solver } = fixture();
  const parameter = solver.createParameter({ name: 'ViewLabel', expression: 'StackName@Front View' });
  const before = solver.stackState.stacks.find(s => s.id === 'front');
  const after = { ...before, name: 'Front Elevation' };
  const rewritten = rewriteQualifiedDimensionReferences({ text: '[StackName] / [StackName@Front View]' }, stackExpressionRenames([], before, after));
  assert.equal(rewritten.text, '[StackName] / [StackName@Front Elevation]');
  solver.setStackState({ ...solver.stackState, stacks: solver.stackState.stacks.map(s => s.id === 'front' ? after : s) });
  assert.equal(solver.dimensions.get(parameter.id).expression, 'StackName@Front Elevation');
  assert.equal(solver.dimensions.get(parameter.id).value, 'Front Elevation');
  assert.equal(solver.evaluateParameterExpression('c4 == StackName', { stackId: 'front' }), false);
  const restored = new SolverController();
  restored.loadSketch(solver.getSketchSnapshot());
  assert.equal(restored.evaluateParameterExpression('StackName', { stackId: 'front' }), 'Front Elevation');
  assert.equal(restored.dimensions.get(parameter.id).value, 'Front Elevation');
});
