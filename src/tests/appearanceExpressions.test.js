import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveColorExpression, resolveOpacityExpression } from '../modules/AppearanceExpressions.js';
import { ParameterRepository } from '../modules/solver/ParameterRepository.js';

test('appearance colors accept direct hex, numeric expressions, and parameter names', () => {
  const parameters = new ParameterRepository();
  parameters.createUser({ name: 'brandColor', expression: '255 * 65536 + 128 * 256' });
  assert.equal(resolveColorExpression('#3af', (expression) => parameters.evaluateExpression(expression)), '#33aaff');
  assert.equal(resolveColorExpression('16711680', (expression) => parameters.evaluateExpression(expression)), '#ff0000');
  assert.equal(resolveColorExpression('brandColor', (expression) => parameters.evaluateExpression(expression)), '#ff8000');
});

test('appearance opacity accepts expressions and clamps resolved percentages', () => {
  const parameters = new ParameterRepository();
  parameters.createUser({ name: 'fade', expression: '25 + 15' });
  assert.equal(resolveOpacityExpression('fade', (expression) => parameters.evaluateExpression(expression)), 0.4);
  assert.equal(resolveOpacityExpression('150', (expression) => parameters.evaluateExpression(expression)), 1);
  assert.equal(resolveOpacityExpression('-20', (expression) => parameters.evaluateExpression(expression)), 0);
  assert.throws(() => resolveOpacityExpression('missing', (expression) => parameters.evaluateExpression(expression)), /Unknown parameter/);
});
