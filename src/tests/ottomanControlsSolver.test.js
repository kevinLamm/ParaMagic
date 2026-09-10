import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';

const drawing = JSON.parse(readFileSync(new URL('./fixtures/rectangle-ottoman-controls.paramagic', import.meta.url), 'utf8'));

test('the latest Ottoman depth edit changes strategy within one correction budget', () => {
  const latest = JSON.parse(readFileSync(new URL('./fixtures/rectangle-ottoman-latest-controls.paramagic', import.meta.url), 'utf8'));
  const controller = new SolverController({ jacobianMode: 'blocks' });
  controller.loadSketch(latest);
  const parameter = controller.dimensions.list().find(entry => entry.name === 'c2');
  const constraints = structuredClone(controller.constraints());
  const attempts = [];
  const solve = controller.solve.bind(controller);
  controller.solve = (...args) => {
    const result = solve(...args);
    attempts.push(result);
    return result;
  };
  const { result } = controller.updateParameter(parameter.id, { expression: 'MinMax(22, 100, 33, 0.5)', usesDrawingUnit: false });
  assert.equal(result.status, 'converged', result.message);
  assert.ok(attempts[0].iterations <= 200);
  assert.equal(controller.dimensions.get(parameter.id).value, 33);
  assert.deepEqual(controller.constraints(), constraints);
  assert.ok(Math.hypot(...controller.registry.evaluate(controller.model, controller.dimensions).values) < 1e-8);
  assert.ok(controller.model.allVariables().every(variable => !variable.locked));
});

for (const [name, value] of [['c1', 70.5], ['c1', 69.5], ['c1', 74], ['c1', 90], ['c1', 50], ['c2', 37], ['c2', 36], ['c2', 40]]) {
  test(`Ottoman ${name} accepts ${value} with all dimensional and tangent constraints intact`, () => {
    const controller = new SolverController({ jacobianMode: 'blocks' });
    controller.loadSketch(structuredClone(drawing));
    const parameter = controller.dimensions.list().find((entry) => entry.name === name);
    const constraints = structuredClone(controller.constraints());
    const expressions = new Map(controller.dimensions.list().map((entry) => [entry.id, entry.expression]));
    const before = controller.getSketchSnapshot();
    const expression = parameter.expression.replace(/^(MinMax\([^,]+,[^,]+,)\s*[^,]+,/, `$1 ${value},`);
    const { result } = controller.updateParameter(parameter.id, { expression, usesDrawingUnit: false });
    assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
    assert.equal(controller.dimensions.get(parameter.id).value, value);
    assert.notEqual(result.jacobianStats.mode, 'dense-reference');
    assert.equal(result.jacobianStats.linearSolver, 'compiled-elimination');
    assert.ok(result.changedEntityIds.length > 0, 'Predicted geometry must be returned to the renderer');
    assert.deepEqual(controller.constraints(), constraints);
    for (const entry of controller.dimensions.list()) {
      if (entry.id !== parameter.id) assert.equal(entry.expression, expressions.get(entry.id), entry.name);
    }
    const residuals = controller.registry.evaluate(controller.model, controller.dimensions).values;
    assert.ok(Math.hypot(...residuals) < 1e-8, `Residual norm ${Math.hypot(...residuals)}`);
    assert.ok(controller.model.allVariables().every((variable) => !variable.locked));
    const reloaded = new SolverController({ jacobianMode: 'blocks' });
    reloaded.loadSketch(controller.getSketchSnapshot());
    assert.equal(reloaded.dimensions.get(parameter.id).value, value);
    assert.ok(Math.hypot(...reloaded.registry.evaluate(reloaded.model, reloaded.dimensions).values) < 1e-8);
    controller.loadSketch(before);
    assert.equal(controller.dimensions.get(parameter.id).value, parameter.value);
  });
}
