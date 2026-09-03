import test from 'node:test';
import assert from 'node:assert/strict';
import { ParameterRepository, parseExpression } from '../../packages/paramagic-core/src/modules/solver/ParameterRepository.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { dimensionDisplayText } from '../../packages/paramagic-core/src/modules/DimensionSystem.js';
import {
  formatDxfDimensionValue,
  formatValueOnlyDimensionValue,
} from '../../packages/paramagic-core/src/modules/solver/Units.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('expression parser supports precedence, units, powers, functions, and degree trig', () => {
  near(parseExpression('2 + 3 * 4 ^ 2', () => 0), 50);
  near(parseExpression('1 in + 10 mm', () => 0), 35.4);
  near(parseExpression('clamp(-2, 0, 10) + sqrt(81)', () => 0), 9);
  near(parseExpression('sin(30) + cos(60)', () => 0), 1);
});

test('parameter evaluation reuses compiled expression tokens until an expression changes', () => {
  const repository = new ParameterRepository();
  const width = repository.createUser({ name: 'width', expression: '2 + 3 * 4' });
  const firstTokens = repository.compiledExpressions.get(width.id).tokens;

  repository.evaluateAll();
  assert.equal(repository.compiledExpressions.get(width.id).tokens, firstTokens);

  repository.update(width.id, { expression: '3 + 4 * 5' }, { strict: true });
  assert.notEqual(repository.compiledExpressions.get(width.id).tokens, firstTokens);
  assert.equal(repository.value(width.id), 23);
});

test('dirty parameter evaluation follows reverse dependencies without evaluating disconnected branches', () => {
  const repository = new ParameterRepository();
  repository.restore([
    { id: 'root-a', name: 'rootA', expression: '1', value: 0, kind: 'user', computed: false, order: 0 },
    { id: 'leaf-a', name: 'leafA', expression: 'rootA + 1', value: 0, kind: 'user', computed: false, order: 1 },
    { id: 'root-b', name: 'rootB', expression: '10', value: 0, kind: 'user', computed: false, order: 2 },
    { id: 'leaf-b', name: 'leafB', expression: 'rootB + 1', value: 0, kind: 'user', computed: false, order: 3 },
  ], { emit: false });
  repository.evaluateAll();

  repository.entries.get('root-a').expression = '4';
  repository.markDirty('root-a');
  const evaluated = repository.evaluateDirty({ refreshComputed: false });

  assert.deepEqual([...evaluated.keys()].sort(), ['leaf-a', 'root-a']);
  assert.equal(repository.value('leafA'), 5);
  assert.equal(repository.value('leafB'), 11);
  assert.deepEqual([...repository.dependencies.get('leaf-a')], ['root-a']);
  assert.ok(repository.dependents.get('root-a').has('leaf-a'));
});

test('parameter updates snapshot only their affected dependency branch', () => {
  const repository = new ParameterRepository();
  repository.restore([
    { id: 'root-a', name: 'rootA', expression: '1', value: 1, kind: 'user', computed: false, order: 0 },
    { id: 'leaf-a', name: 'leafA', expression: 'rootA + 1', value: 2, kind: 'user', computed: false, order: 1 },
    { id: 'root-b', name: 'rootB', expression: '10', value: 10, kind: 'user', computed: false, order: 2 },
    { id: 'leaf-b', name: 'leafB', expression: 'rootB + 1', value: 11, kind: 'user', computed: false, order: 3 },
  ], { emit: false });
  repository.evaluateAll();
  const snapshotEntries = repository.snapshotEntries.bind(repository);
  let capturedIds = [];
  repository.snapshotEntries = (ids) => {
    capturedIds = [...ids].sort();
    return snapshotEntries(ids);
  };
  repository.snapshot = () => { throw new Error('full parameter snapshot should not be used'); };

  repository.update('root-a', { expression: '4' }, { strict: true });

  assert.deepEqual(capturedIds, ['leaf-a', 'root-a']);
  assert.equal(repository.value('leafA'), 5);
  assert.equal(repository.value('leafB'), 11);
});

test('boolean expressions need no parameter type and support comparisons, logic, and if()', () => {
  const repository = new ParameterRepository();
  repository.setDefaultLengthUnit('in');
  const width = repository.createUser({ name: 'width', expression: '120 mm' });
  const enabled = repository.createUser({ name: 'enabled', expression: 'TRUE' });
  const disabled = repository.createUser({ name: 'disabled', expression: 'FALSE' });
  const wide = repository.createUser({ name: 'wide', expression: 'width >= 4 && enabled && !disabled' });
  const result = repository.createUser({ name: 'result', expression: 'if(enabled, width / 2, 0)' });
  assert.equal(repository.value(enabled.id), true);
  assert.equal(repository.value(disabled.id), false);
  assert.equal(repository.value(wide.id), true);
  near(repository.value(result.id), 60);
  near(repository.value(width.id), 120);
  assert.equal(Object.hasOwn(repository.get(enabled.id), 'type'), false);
});

test('ordinary parameters preserve quoted strings and string references', () => {
  const repository = new ParameterRepository();
  const bodyCover = repository.createUser({
    name: 'BodyCover',
    expression: '"basic/Fabric/36981_106.webp"',
  });
  const selectedCover = repository.createUser({
    name: 'SelectedCover',
    expression: 'BodyCover',
  });

  assert.equal(repository.get(bodyCover.id).value, 'basic/Fabric/36981_106.webp');
  assert.equal(repository.get(bodyCover.id).error, null);
  assert.equal(repository.get(selectedCover.id).value, 'basic/Fabric/36981_106.webp');
  assert.equal(repository.evaluateExpression('SelectedCover'), 'basic/Fabric/36981_106.webp');
});

test('length evaluation rejects text results instead of leaking NaN', () => {
  const repository = new ParameterRepository();
  repository.setDefaultLengthUnit('in');
  repository.createControl({ name: 'c4', expression: '"Straight Cushion"' });

  assert.throws(
    () => repository.evaluateLengthExpression('if(c4=="Straight Cushion","Straight","T Cushion")'),
    /finite number/i,
  );
});

test('catalog image references can be entered without quotes', () => {
  const repository = new ParameterRepository();
  const fabric = repository.createUser({
    name: 'Fabric1',
    expression: 'basic/Fabric/linen-texture-wallpaper-2x.jpg',
  });

  assert.equal(fabric.value, 'basic/Fabric/linen-texture-wallpaper-2x.jpg');
  assert.equal(fabric.error, null);
  assert.equal(repository.evaluateExpression('Fabric1'), 'basic/Fabric/linen-texture-wallpaper-2x.jpg');
});

test('legacy typed parameter snapshots load as ordinary expressions', () => {
  const repository = new ParameterRepository();
  repository.restore([{
    id: 'legacy-boolean',
    name: 'enabled',
    type: 'Yes/No',
    expression: 'yes',
    value: true,
    kind: 'user',
    driving: false,
    computed: false,
    unit: null,
    error: null,
    order: 0,
  }]);
  repository.evaluateAll();
  assert.equal(repository.value('enabled'), true);
  assert.equal(Object.hasOwn(repository.get('enabled'), 'type'), false);
});

test('renaming parameters updates dependent expression references', () => {
  const repository = new ParameterRepository();
  const width = repository.createUser({ name: 'width', expression: '40' });
  const half = repository.createUser({ name: 'half', expression: 'width / 2' });
  repository.update(width.id, { name: 'plate_width' }, { strict: true });
  assert.equal(repository.get(half.id).expression, 'plate_width / 2');
  assert.equal(repository.value(half.id), 20);
});

test('drawing parameters use the drawing unit for suffix-free arithmetic expressions', () => {
  const controller = createSolverController();
  const width = controller.createParameter({ name: 'width', expression: '41*2' });
  const dimension = controller.dimensions.addDimension({
    name: 'd1',
    expression: 'width',
    value: 0,
    driving: true,
    unit: 'in',
  });

  near(controller.dimensions.get(width.id).value, 82 * 25.4);
  near(controller.dimensions.get(dimension.id).value, 82 * 25.4);
  assert.equal(controller.dimensions.get(width.id).expression, '41*2');
  assert.equal(controller.dimensions.get(dimension.id).expression, 'width');
  assert.equal(controller.getDimensionText(dimension.id, 'value'), '82');
});

test('controls remain unitless scalars even when legacy metadata marks them as drawing lengths', () => {
  const controller = createSolverController();
  controller.setDrawingProperties({ drawingUnit: 'in' });
  const count = controller.createControlParameter({
    name: 'c14',
    expression: 'MinMax(0, 12, 4, 4)',
    usesDrawingUnit: true,
  });
  const angle = controller.dimensions.addDimension({
    name: 'd70',
    expression: '360/c14',
    value: 0,
    driving: true,
    unit: 'deg',
  });

  near(controller.dimensions.get(count.id).value, 4);
  assert.equal(controller.dimensions.get(count.id).usesDrawingUnit, false);
  near(controller.dimensions.get(angle.id).value, 90);
  assert.equal(controller.dimensions.get(angle.id).expression, '360/c14');
});

test('scalar expression evaluation converts length dependencies to drawing-unit numbers', () => {
  const repository = new ParameterRepository();
  repository.setDefaultLengthUnit('in');
  repository.createUser({ name: 'width', expression: '6 mm' });
  repository.createControl({ name: 'choice', expression: 'width' });

  near(repository.evaluateScalarExpression('width'), 6 / 25.4);
  near(repository.value('choice'), 6 / 25.4);
});

test('an unrelated invalid parameter does not prevent adding a valid dimension', () => {
  const repository = new ParameterRepository();
  repository.setDefaultLengthUnit('in');
  repository.restore([
    {
      id: 'control-count',
      name: 'c14',
      expression: 'MinMax(0, 12, 0, 4)',
      value: 0,
      kind: 'control',
      driving: false,
      computed: false,
      unit: null,
      error: null,
      order: 0,
      usesDrawingUnit: false,
    },
    {
      id: 'invalid-angle',
      name: 'd70',
      expression: '360/c14',
      value: 45,
      kind: 'dimension',
      driving: true,
      computed: false,
      unit: 'deg',
      annotationId: null,
      error: null,
      order: 1,
    },
  ]);
  repository.evaluateAll({ strict: false });
  assert.match(repository.get('d70').error, /finite number/i);

  const diameter = repository.addDimension({
    name: 'd71',
    expression: '3.911 in',
    value: 3.911 * 25.4,
    driving: true,
    unit: 'in',
  });

  near(diameter.value, 3.911 * 25.4);
  assert.equal(diameter.error, null);
  assert.match(repository.get('d70').error, /finite number/i);
});

test('disabled dimensions retain their expression and last value without reporting evaluation errors', () => {
  const repository = new ParameterRepository();
  repository.restore([
    {
      id: 'control-count',
      name: 'c14',
      expression: '0',
      value: 0,
      kind: 'control',
      driving: false,
      computed: false,
      unit: null,
      error: null,
      order: 0,
    },
    {
      id: 'angle',
      name: 'd70',
      expression: '360/c14',
      value: 45,
      kind: 'dimension',
      driving: true,
      computed: false,
      enabled: false,
      unit: 'deg',
      error: null,
      order: 1,
    },
  ]);

  repository.evaluateAll({ strict: false });
  assert.equal(repository.get('d70').error, null);
  assert.equal(repository.get('d70').value, 45);
  assert.equal(repository.get('d70').expression, '360/c14');

  repository.setEnabled('d70', true);
  assert.match(repository.get('d70').error, /finite number/i);
  repository.setEnabled('d70', false);
  assert.equal(repository.get('d70').error, null);
});

test('suffix-free offsets in referenced dimension expressions use the drawing unit', () => {
  const controller = createSolverController();
  controller.setDrawingProperties({ drawingUnit: 'in' });
  const height = controller.createParameter({ name: 'AHeight', expression: '24' });
  const offset = controller.dimensions.addDimension({
    name: 'd1',
    expression: 'AHeight+10',
    value: 0,
    driving: true,
    unit: 'in',
  });
  const doubled = controller.createParameter({ name: 'doubled', expression: 'AHeight*2' });
  const mixed = controller.createParameter({ name: 'mixed', expression: 'AHeight+10 mm' });

  near(controller.dimensions.get(height.id).value, 24 * 25.4);
  near(controller.dimensions.get(offset.id).value, 34 * 25.4);
  near(controller.dimensions.get(doubled.id).value, 48 * 25.4);
  near(controller.dimensions.get(mixed.id).value, (24 * 25.4) + 10);
  assert.equal(controller.dimensions.get(offset.id).expression, 'AHeight+10');
});

test('suffix-free referenced expressions follow metric drawing units too', () => {
  const controller = createSolverController();
  controller.setDrawingProperties({ drawingUnit: 'cm' });
  const height = controller.createParameter({ name: 'height', expression: '20' });
  const clearance = controller.createParameter({ name: 'clearance', expression: 'height+2.5' });

  near(controller.dimensions.get(height.id).value, 200);
  near(controller.dimensions.get(clearance.id).value, 225);
  near(controller.evaluateDrawingLengthExpression('height+5'), 250);
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
  const doubled = repository.createUser({ name: 'double_length', expression: 'd1@Stack 1 * 2' });
  assert.equal(repository.value(doubled.id), 60);
  measured = 45;
  repository.evaluateAll({ strict: false });
  assert.equal(repository.value(doubled.id), 90);
});

test('dimensions are numbered per Stack and qualified references are case-insensitive', () => {
  const repository = new ParameterRepository();
  repository.setStackState({
    activeStackId: 'front',
    stacks: [
      { id: 'front', name: 'Front Panel' },
      { id: 'back', name: 'Back Panel' },
    ],
  }, { emit: false });
  const front = repository.addDimension({ stackId: 'front', value: 10, driving: false });
  const back = repository.addDimension({ stackId: 'back', value: 20, driving: false });
  assert.equal(front.name, 'd1');
  assert.equal(back.name, 'd1');
  assert.equal(repository.evaluateExpression('d1@front panel + d1@BACK PANEL'), 30);
  assert.throws(() => repository.evaluateExpression('d1'), /Unknown parameter/);
  assert.equal(repository.evaluateExpression('d1', { stackId: 'front' }), 10);
  assert.throws(() => repository.update(front.id, { name: 'width' }, { strict: true }), /d1, d2, d3/);
  assert.equal(repository.get(front.id).name, 'd1');
});

test('the live dimension repository rejects legacy descriptive handles at every entry point', () => {
  assert.throws(
    () => new ParameterRepository().addDimension({ name: 'width', driving: true, expression: '10' }),
    /d1, d2, d3/,
  );
  assert.throws(
    () => new ParameterRepository().set({ id: 'legacy-width', name: 'width', expression: '10' }),
    /d1, d2, d3/,
  );
  assert.throws(
    () => new ParameterRepository().restore([{
      id: 'legacy-width', name: 'width', kind: 'dimension', expression: '10', driving: true,
    }]),
    /d1, d2, d3/,
  );
});

test('spaced user parameter names resolve by longest registered name without quotes', () => {
  const repository = new ParameterRepository();
  repository.createUser({ name: 'Waist', expression: '10' });
  repository.createUser({ name: 'Waist Ease', expression: '2' });
  const result = repository.createUser({ name: 'Adjusted Waist', expression: 'Waist + Waist Ease' });
  assert.equal(repository.value(result.id), 12);
});

test('renaming a spaced parameter updates only its exact symbol and preserves longer parameter names', () => {
  const repository = new ParameterRepository();
  const waist = repository.createUser({ name: 'Waist', expression: '10' });
  repository.createUser({ name: 'Waist Ease', expression: '2' });
  const result = repository.createUser({ name: 'Adjusted Waist', expression: 'Waist + Waist Ease' });

  repository.update(waist.id, { name: 'Body Waist' }, { strict: true });

  assert.equal(repository.get(result.id).expression, 'Body Waist + Waist Ease');
  assert.equal(repository.value(result.id), 12);
});

test('expression lookup exposes qualified dimension names and keeps local aliases optional', () => {
  const repository = new ParameterRepository();
  repository.setStackState({
    activeStackId: 'stack-a',
    stacks: [
      { id: 'stack-default', name: 'Default' },
      { id: 'stack-a', name: 'Front Panel' },
      { id: 'stack-b', name: 'Back Panel' },
    ],
  });
  repository.addDimension({ id: 'front-d1', name: 'd1', stackId: 'stack-a', driving: true, expression: '10', unit: 'mm' });
  repository.addDimension({ id: 'back-d1', name: 'd1', stackId: 'stack-b', driving: true, expression: '20', unit: 'mm' });
  const qualified = repository.expressionSymbols({ stackId: 'stack-a' });
  assert.ok(qualified.some(({ name }) => name === 'd1@Front Panel'));
  assert.ok(qualified.some(({ name }) => name === 'd1@Back Panel'));
  assert.equal(qualified.some(({ name }) => name === 'd1'), false);
  assert.ok(repository.expressionSymbols({ stackId: 'stack-a', includeLocalAliases: true })
    .some(({ name, alias }) => name === 'd1' && alias));
});

test('global expressions report a disabled dimension source by qualified Stack name', () => {
  const repository = new ParameterRepository();
  repository.setStackState({ stacks: [
    { id: 'stack-default', name: 'Default', systemRole: 'default-stack' },
    { id: 'stack-structure', name: 'Structure' },
  ] }, { emit: false });
  const length = repository.addDimension({
    id: 'structure-length', name: 'd1', stackId: 'stack-structure', value: 120,
    driving: false, computed: true,
  });
  const result = repository.createUser({ name: 'Support Required', expression: 'd1@Structure >= 100' });

  repository.setEnabledStackIds(['stack-default'], { emit: false });

  assert.match(repository.get(result.id).error, /d1@Structure/);
  assert.match(repository.get(result.id).error, /Stack "Structure" is disabled/);
  assert.throws(() => repository.evaluateExpression('d1@Structure > 0'), /unavailable.*Structure.*disabled/i);

  repository.setEnabledStackIds(['stack-default', 'stack-structure'], { emit: false });
  assert.equal(repository.get(result.id).error, null);
  assert.equal(repository.value(result.id), true);
  assert.equal(repository.get(length.id).id, length.id);
});

test('disabled Stack dimensions remain dormant until their Stack is re-enabled', () => {
  const repository = new ParameterRepository();
  repository.setStackState({
    activeStackId: 'stack-a',
    stacks: [
      { id: 'stack-a', name: 'Stack A' },
      { id: 'stack-b', name: 'Stack B' },
    ],
  }, { emit: false });
  const dimension = repository.addDimension({
    id: 'dimension-b',
    name: 'd1',
    stackId: 'stack-b',
    value: 25,
    driving: false,
  });
  let resolverCalls = 0;
  repository.setComputedResolver(dimension.id, () => {
    resolverCalls += 1;
    return 25;
  });
  resolverCalls = 0;

  repository.setEnabledStackIds(['stack-a'], { emit: false });
  assert.equal(repository.setComputedValue(dimension.id, 99), false);
  assert.equal(repository.get(dimension.id).value, 25);
  repository.evaluateAll({ strict: false });
  assert.equal(resolverCalls, 0);

  repository.setEnabledStackIds(['stack-a', 'stack-b'], { emit: false });
  assert.equal(resolverCalls, 1);
});

test('cross-Stack dimensions are dormant while any participant Stack is disabled', () => {
  const repository = new ParameterRepository();
  repository.setStackState({
    activeStackId: 'stack-a',
    stacks: [
      { id: 'stack-a', name: 'Stack A' },
      { id: 'stack-b', name: 'Stack B' },
    ],
  }, { emit: false });
  const dimension = repository.addDimension({
    id: 'dimension-ab',
    name: 'd1',
    stackId: 'stack-a',
    participantStackIds: ['stack-b'],
    value: 25,
    driving: false,
  });
  let resolverCalls = 0;
  repository.setComputedResolver(dimension.id, () => {
    resolverCalls += 1;
    return 25;
  });
  resolverCalls = 0;

  repository.setEnabledStackIds(['stack-a'], { emit: false });
  repository.evaluateDirty({ strict: false, refreshComputed: true });
  assert.equal(resolverCalls, 0);
  assert.throws(
    () => repository.evaluateExpression('d1@Stack A'),
    /Stack "Stack B" is disabled/,
  );

  repository.setEnabledStackIds(['stack-a', 'stack-b'], { emit: false });
  assert.equal(resolverCalls, 1);
});

test('renaming a Stack rewrites qualified expressions and preserves dimension identity', () => {
  const repository = new ParameterRepository();
  repository.setStackState({ stacks: [{ id: 'front', name: 'Front Panel' }] }, { emit: false });
  const dimension = repository.addDimension({ stackId: 'front', value: 15, driving: false });
  const global = repository.createUser({ name: 'Result', expression: 'd1@Front Panel * 2' });
  repository.setStackState({ stacks: [{ id: 'front', name: 'Bodice Front' }] }, { emit: false });
  assert.equal(repository.get(global.id).expression, 'd1@Bodice Front * 2');
  assert.equal(repository.value(global.id), 30);
  assert.equal(repository.get(dimension.id).stackId, 'front');
});

test('computed dimension refresh can be scoped to an interactive constraint component', () => {
  const repository = new ParameterRepository();
  const first = repository.addDimension({ id: 'first', value: 10, driving: false });
  const second = repository.addDimension({ id: 'second', value: 20, driving: false });
  let firstRefreshes = 0;
  let secondRefreshes = 0;
  repository.setComputedResolver(first.id, () => { firstRefreshes += 1; return 10; });
  repository.setComputedResolver(second.id, () => { secondRefreshes += 1; return 20; });
  firstRefreshes = 0;
  secondRefreshes = 0;

  repository.evaluateDirty({
    strict: false,
    refreshComputed: true,
    refreshComputedIds: new Set([first.id]),
  });

  assert.equal(firstRefreshes, 1);
  assert.equal(secondRefreshes, 0);
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
  assert.ok(Math.abs(controlledLength - 100) < 100e-3, `Expected controlled length 100, got ${controlledLength}`);
});

test('large control-parameter jumps continue through dependent driving dimensions', () => {
  const controller = createSolverController({ jacobianMode: 'blocks' });
  controller.setDrawingProperties({ drawingUnit: 'in' });
  const control = controller.createControlParameter({
    name: 'c1',
    expression: 'MinMax(20, 100, 35, 1)',
    usesDrawingUnit: false,
  });
  const line = controller.addEntity({
    id: 'slider-controlled-line',
    type: 'line',
    start: [0, 0],
    end: [35 * 25.4, 0],
  });
  const dimension = controller.addDimension({
    type: 'dimension-line',
    dimensionMode: 'driving',
    subtype: 'horizontal',
    start: [...line.start],
    end: [...line.end],
    measureStart: [...line.start],
    measureEnd: [...line.end],
    label: [35 * 12.7, -20],
    text: '',
    anchors: {
      start: { type: 'segment-start', recordId: line.id, index: 0 },
      end: { type: 'segment-end', recordId: line.id, index: 0 },
      measureStart: { type: 'segment-start', recordId: line.id, index: 0 },
      measureEnd: { type: 'segment-end', recordId: line.id, index: 0 },
    },
  });
  const dimensionId = dimension.entity.dimensionId;
  const linked = controller.setDimension(dimensionId, control.name);
  assert.ok(['converged', 'unchanged'].includes(linked.status), linked.message);

  const originalSolve = controller.solve.bind(controller);
  let previousTarget = controller.dimensions.get(dimensionId).value;
  let largestTargetJump = 0;
  controller.solve = (options) => {
    const target = controller.dimensions.get(dimensionId).value;
    const targetJump = Math.abs(target - previousTarget);
    largestTargetJump = Math.max(largestTargetJump, targetJump);
    if (targetJump > 4 * 25.4) {
      return {
        status: 'max-iterations',
        message: 'A discontinuous parameter jump did not converge.',
        changedEntityIds: [],
      };
    }
    previousTarget = target;
    return originalSolve(options);
  };

  const outcome = controller.updateParameter(control.id, {
    expression: 'MinMax(20, 100, 100, 1)',
    usesDrawingUnit: false,
  });

  assert.ok(['converged', 'unchanged'].includes(outcome.result.status), outcome.result.message);
  assert.ok(outcome.result.continuationSteps > 1);
  assert.ok(largestTargetJump <= 4 * 25.4);
  assert.equal(controller.dimensions.get(control.id).expression, 'MinMax(20, 100, 100, 1)');
  assert.equal(controller.dimensions.get(control.id).value, 100);
  assert.equal(controller.dimensions.get(dimensionId).expression, 'c1');
  const solved = controller.getEntity(line.id);
  assert.ok(Math.abs(Math.abs(solved.end[0] - solved.start[0]) - 100 * 25.4) < 1e-3);
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
  assert.equal(controller.getDimensionText(id, 'named-value'), 'd1 = 10');
  assert.equal(controller.getDimensionText(id, 'value'), '10');
  assert.equal(controller.getDimensionText(id, 'expression'), 'd1 = 10');

  assert.equal(controller.updateDimensionAnnotation(id, {
    ...added.entity,
    includeInValueOnly: true,
  }), true);
  assert.equal(controller.getDimensionText(id, 'value'), '10"');

  const result = controller.setDimension(id, 'if(yes, 12 in, 4 in)');
  assert.ok(['converged', 'unchanged'].includes(result.status));
  assert.equal(controller.getDimensionText(id, 'expression'), 'd1 = if(yes, 12, 4)');
  assert.equal(controller.getDimensionText(id, 'named-value'), 'd1 = 12');
  assert.equal(controller.getDimensionText(id, 'value'), '12"');
});

test('Driven-format Value Only dimensions display units using architectural symbols', () => {
  const controller = createSolverController();
  controller.loadSketch({
    drawingUnit: 'in',
    parameters: [{
      id: 'driven-width',
      name: 'd1',
      type: 'Expression',
      expression: '82 in',
      value: 82 * 25.4,
      kind: 'dimension',
      driving: false,
      computed: true,
      unit: 'in',
      annotationId: null,
      error: null,
      order: 0,
    }],
  });

  assert.equal(controller.getDimensionText('d1', 'expression'), 'd1 = 82');
  assert.equal(controller.getDimensionText('d1', 'named-value'), 'd1 = 82');
  assert.equal(controller.getDimensionText('d1', 'value'), '82"');
  assert.equal(formatDxfDimensionValue(914.4, 'ft'), "3'");
  assert.equal(formatDxfDimensionValue(90, 'deg'), '90°');
  assert.equal(formatDxfDimensionValue(250, 'mm'), '250 mm');
});

test('DXF dimension display rounds inches to thirty-seconds and millimeters to whole numbers', () => {
  assert.equal(formatDxfDimensionValue(1.109 * 25.4, 'in'), '1.09375"');
  assert.equal(formatDxfDimensionValue(1.11 * 25.4, 'in'), '1.125"');
  assert.equal(formatDxfDimensionValue(24 * 25.4, 'in'), '24"');
  assert.equal(formatDxfDimensionValue(250.49, 'mm'), '250 mm');
  assert.equal(formatDxfDimensionValue(250.5, 'mm'), '251 mm');
  assert.equal(formatDxfDimensionValue(250.49, 'cm'), '25.049 cm');

  const controller = createSolverController();
  controller.dimensions.restore([{
      id: 'rounded-driven', name: 'd1', kind: 'dimension', expression: '23.599 in',
      value: 23.599 * 25.4, unit: 'in', driving: false, computed: true, order: 0,
  }]);
  assert.equal(controller.getDimensionText('d1', 'named-value'), 'd1 = 23.599');
  assert.equal(controller.getDimensionText('d1', 'value'), '23.625"');
});

test('Value Only presentation rounds inches to the nearest eighth', () => {
  assert.equal(formatValueOnlyDimensionValue(1.0624 * 25.4, 'in'), '1"');
  assert.equal(formatValueOnlyDimensionValue(1.0626 * 25.4, 'in'), '1.125"');
  assert.equal(formatValueOnlyDimensionValue(1.1874 * 25.4, 'in'), '1.125"');
  assert.equal(formatValueOnlyDimensionValue(1.1876 * 25.4, 'in'), '1.25"');
  assert.equal(formatValueOnlyDimensionValue(24 * 25.4, 'in'), '24"');
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
