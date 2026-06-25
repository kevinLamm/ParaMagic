import test from 'node:test';
import assert from 'node:assert/strict';
import { ParameterRepository, parseExpression } from '../modules/solver/ParameterRepository.js';
import { createSolverController } from '../modules/solver/SolverController.js';
import { dimensionDisplayText } from '../modules/DimensionTools.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('expression parser supports precedence, units, powers, functions, and degree trig', () => {
  near(parseExpression('2 + 3 * 4 ^ 2', () => 0), 50);
  near(parseExpression('1 in + 10 mm', () => 0), 35.4);
  near(parseExpression('clamp(-2, 0, 10) + sqrt(81)', () => 0), 9);
  near(parseExpression('sin(30) + cos(60)', () => 0), 1);
});

test('Yes/No parameters support comparisons, logical operators, and if()', () => {
  const repository = new ParameterRepository();
  const width = repository.createUser({ name: 'width', expression: '120 mm' });
  const enabled = repository.createUser({ name: 'enabled', type: 'Yes/No', expression: 'width >= 100 && yes' });
  const result = repository.createUser({ name: 'result', expression: 'if(enabled, width / 2, 0)' });
  assert.equal(repository.value(enabled.id), true);
  assert.equal(repository.value(result.id), 60);
  assert.equal(repository.value(width.id), 120);
});

test('renaming parameters updates dependent expression references', () => {
  const repository = new ParameterRepository();
  const width = repository.createUser({ name: 'width', expression: '40' });
  const half = repository.createUser({ name: 'half', expression: 'width / 2' });
  repository.update(width.id, { name: 'plate_width' }, { strict: true });
  assert.equal(repository.get(half.id).expression, 'plate_width / 2');
  assert.equal(repository.value(half.id), 20);
});

test('cycles and missing references are retained as row errors without losing last valid values', () => {
  const repository = new ParameterRepository();
  const a = repository.createUser({ name: 'a', expression: '10' });
  const b = repository.createUser({ name: 'b', expression: 'a + 5' });
  repository.update(a.id, { expression: 'b + 1' });
  assert.match(repository.get(a.id).error, /cycle/i);
  assert.equal(repository.value(a.id), 10);
  repository.update(b.id, { expression: 'missing + 1' });
  assert.match(repository.get(b.id).error, /unknown parameter/i);
});

test('rows reorder and only user parameters can be manually removed', () => {
  const repository = new ParameterRepository();
  const first = repository.createUser({ expression: '1' });
  const second = repository.createUser({ expression: '2' });
  const dimension = repository.addDimension({ value: 25, driving: false });
  assert.equal(first.name, 'p1');
  assert.equal(second.name, 'p2');
  assert.equal(dimension.name, 'd1');
  repository.reorder(second.id, first.id);
  assert.deepEqual(repository.list().map((entry) => entry.id), [second.id, first.id, dimension.id]);
  assert.equal(repository.remove(dimension.id), false);
  assert.equal(repository.remove(first.id), true);
});

test('computed dimension parameters can drive dependent expressions', () => {
  const repository = new ParameterRepository();
  let measured = 30;
  const dimension = repository.addDimension({ value: measured, driving: false });
  repository.setComputedResolver(dimension.id, () => measured);
  const doubled = repository.createUser({ name: 'double_length', expression: 'd1 * 2' });
  assert.equal(repository.value(doubled.id), 60);
  measured = 45;
  repository.evaluateAll({ strict: false });
  assert.equal(repository.value(doubled.id), 90);
});

test('driving and driven dimensions receive sequential parameter names and lifecycle protection', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [100, 0] });
  const anchors = {
    start: { type: 'segment-start', recordId: line.id, index: 0 },
    end: { type: 'segment-end', recordId: line.id, index: 0 },
    measureStart: { type: 'segment-start', recordId: line.id, index: 0 },
    measureEnd: { type: 'segment-end', recordId: line.id, index: 0 },
  };
  const driven = controller.addDimension({ type: 'dimension-line', dimensionMode: 'driven', subtype: 'aligned', start: [0, 0], end: [100, 0], measureStart: [0, 0], measureEnd: [100, 0], label: [50, -20], text: '100 mm', anchors });
  const driving = controller.addDimension({ type: 'dimension-line', dimensionMode: 'driving', subtype: 'aligned', start: [0, 0], end: [100, 0], measureStart: [0, 0], measureEnd: [100, 0], label: [50, -40], text: '100 mm', anchors });
  assert.equal(controller.dimensions.get(driven.entity.dimensionId).name, 'd1');
  assert.equal(controller.dimensions.get(driving.entity.dimensionId).name, 'd2');
  assert.equal(controller.removeParameter(driven.entity.dimensionId), false);
  assert.equal(controller.removeDimension(driven.entity.dimensionId), true);
  assert.equal(controller.dimensions.get(driven.entity.dimensionId), null);
});

test('a driven dimension referenced by a driving dimension remains read-only', () => {
  const controller = createSolverController();
  const measuredLine = controller.addEntity({ id: 'measured-line', type: 'line', start: [0, 0], end: [100, 0] });
  const controlledLine = controller.addEntity({ id: 'controlled-line', type: 'line', start: [0, 50], end: [40, 50] });
  const dimensionFor = (line, mode, labelY) => ({
    type: 'dimension-line',
    dimensionMode: mode,
    subtype: 'aligned',
    start: [...line.start],
    end: [...line.end],
    measureStart: [...line.start],
    measureEnd: [...line.end],
    label: [(line.start[0] + line.end[0]) / 2, labelY],
    text: '',
    anchors: {
      start: { type: 'segment-start', recordId: line.id, index: 0 },
      end: { type: 'segment-end', recordId: line.id, index: 0 },
      measureStart: { type: 'segment-start', recordId: line.id, index: 0 },
      measureEnd: { type: 'segment-end', recordId: line.id, index: 0 },
    },
  });
  const driven = controller.addDimension(dimensionFor(measuredLine, 'driven', -20));
  const driving = controller.addDimension(dimensionFor(controlledLine, 'driving', 30));
  const measuredBefore = controller.getEntity(measuredLine.id);

  const result = controller.setDimension(driving.entity.dimensionId, driven.entity.dimensionName);

  assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
  assert.deepEqual(controller.getEntity(measuredLine.id), measuredBefore);
  const controlledAfter = controller.getEntity(controlledLine.id);
  const controlledLength = Math.hypot(
    controlledAfter.end[0] - controlledAfter.start[0],
    controlledAfter.end[1] - controlledAfter.start[1],
  );
  assert.ok(Math.abs(controlledLength - 100) < 1e-3, `Expected controlled length 100, got ${controlledLength}`);
});

test('dimension display text includes its parameter name without duplicating prefixes', () => {
  const entity = { dimensionName: 'd1' };
  assert.equal(dimensionDisplayText(entity, '600 mm'), 'd1 = 600 mm');
  assert.equal(dimensionDisplayText(entity, 'd1 = 600 mm'), 'd1 = 600 mm');
  assert.equal(dimensionDisplayText({ dimensionName: 'd2' }, 'MCL = 125 mm'), 'd2 = 125 mm');
  assert.equal(dimensionDisplayText({ dimensionName: 'd3', managedDimensionText: true }, '3.937 in'), '3.937 in');
});

test('drawing dimensions default to inches and support all three display modes', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'line-display', type: 'line', start: [0, 0], end: [254, 0] });
  const anchors = {
    start: { type: 'segment-start', recordId: line.id, index: 0 },
    end: { type: 'segment-end', recordId: line.id, index: 0 },
    measureStart: { type: 'segment-start', recordId: line.id, index: 0 },
    measureEnd: { type: 'segment-end', recordId: line.id, index: 0 },
  };
  const added = controller.addDimension({
    type: 'dimension-line',
    dimensionMode: 'driving',
    subtype: 'horizontal',
    start: [0, 0],
    end: [254, 0],
    measureStart: [0, 0],
    measureEnd: [254, 0],
    label: [127, -20],
    text: '10 in',
    anchors,
  });
  const id = added.entity.dimensionId;
  assert.equal(controller.dimensions.get(id).unit, 'in');
  assert.equal(controller.getDimensionText(id, 'named-value'), 'd1 = 10 in');
  assert.equal(controller.getDimensionText(id, 'value'), '10 in');
  assert.equal(controller.getDimensionText(id, 'expression'), 'd1 = 10 in');

  const result = controller.setDimension(id, 'if(yes, 12 in, 4 in)');
  assert.ok(['converged', 'unchanged'].includes(result.status));
  assert.equal(controller.getDimensionText(id, 'expression'), 'd1 = if(yes, 12 in, 4 in)');
  assert.equal(controller.getDimensionText(id, 'named-value'), 'd1 = 12 in');
  assert.equal(controller.getDimensionText(id, 'value'), '12 in');
});

test('display formatting converts internal millimetres into the requested unit', () => {
  const repository = new ParameterRepository();
  assert.equal(repository.formatValue(25.4, 'in'), '1 in');
  assert.equal(repository.formatValue(600, 'in'), '23.622 in');
  assert.equal(repository.formatValue(600, 'mm'), '600 mm');
});

test('drawing snapshots retain parameters and dimension annotations for JSON round trips', () => {
  const source = createSolverController();
  const line = source.addEntity({ id: 'snapshot-line', type: 'line', start: [0, 0], end: [25.4, 0] });
  const anchors = {
    start: { type: 'segment-start', recordId: line.id, index: 0 },
    end: { type: 'segment-end', recordId: line.id, index: 0 },
    measureStart: { type: 'segment-start', recordId: line.id, index: 0 },
    measureEnd: { type: 'segment-end', recordId: line.id, index: 0 },
  };
  source.createParameter({ name: 'allowance', expression: '0.25 in' });
  source.addDimension({ type: 'dimension-line', dimensionMode: 'driven', subtype: 'horizontal', start: [0, 0], end: [25.4, 0], measureStart: [0, 0], measureEnd: [25.4, 0], label: [12.7, -10], text: '1 in', anchors });
  const snapshot = source.getSketchSnapshot();
  assert.equal(snapshot.parameters.length, 2);
  assert.equal(snapshot.dimensionAnnotations.length, 1);

  const restored = createSolverController();
  restored.loadSketch(snapshot);
  assert.deepEqual(restored.parameters().map(({ name }) => name), ['allowance', 'd1']);
  assert.equal(restored.getSketchSnapshot().dimensionAnnotations.length, 1);
});
