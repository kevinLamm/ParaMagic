import assert from 'node:assert/strict';
import test from 'node:test';
import {
  controlExpressionForValue,
  controlPanelState,
  controlRowMarkup,
  controlToolTypes,
  createControlItem,
  createControlPanelModel,
  formatMinMaxExpression,
  normalizeControlItem,
  parseControlArrayExpression,
  parseMinMaxExpression,
  resolveControlChoices,
  snapMinMaxValue,
} from '../../packages/paramagic-core/src/modules/CanvasUIControls.js';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';

test('the Controls panel exposes the requested userform controls', () => {
  assert.deepEqual(controlToolTypes, [
    'Slider Control',
    'Checkbox',
    'Numeric Textbox',
    'Options',
    'Dropdown',
  ]);
});

test('control rows omit the redundant control-type reference icon', () => {
  const solver = new SolverController();
  const item = createControlItem('Checkbox', { label: 'Enabled' });
  const markup = controlRowMarkup(item, controlPanelState(item, solver), false);

  assert.doesNotMatch(markup, /panel-control-type-icon/);
  assert.doesNotMatch(markup, /<svg/);
  assert.match(markup, />Enabled</);
});

test('panel controls normalize without canvas geometry', () => {
  const item = createControlItem('Horizontal Scrollbar');
  assert.equal(item.controlType, 'horizontal-scrollbar');
  assert.equal(item.label, '');
  assert.equal(item.configurationExpression, 'MinMax(0, 100, 50, 1)');
  assert.equal(item.selectedIndex, 0);
  assert.equal('x' in item, false);
  assert.equal('width' in item, false);
  assert.deepEqual(normalizeControlItem({ controlType: 'Numeric Textbox' }).controlType, 'numeric-textbox');
});

test('the legacy scrollbar label still normalizes to the slider control type', () => {
  assert.equal(createControlItem('Horizontal Scrollbar').controlType, 'horizontal-scrollbar');
  assert.equal(createControlItem('Slider Control').controlType, 'horizontal-scrollbar');
});

test('MinMax uses minimum, maximum, initial, and step expressions', () => {
  assert.deepEqual(parseMinMaxExpression('MinMax(low, high, initial, increment)'), {
    minimumExpression: 'low',
    maximumExpression: 'high',
    initialExpression: 'initial',
    stepExpression: 'increment',
  });
  assert.equal(formatMinMaxExpression({
    minimumExpression: 'low',
    maximumExpression: 'high',
    initialExpression: '25',
    stepExpression: '0.5',
  }), 'MinMax(low, high, 25, 0.5)');
  assert.equal(parseMinMaxExpression('MinMax(0, 100, 50)'), null);
});

test('scrollbar state resolves parameter names and preserves step while changing value', () => {
  const solver = new SolverController();
  solver.createParameter({ name: 'low', expression: '20' });
  solver.createParameter({ name: 'high', expression: '80' });
  solver.createParameter({ name: 'increment', expression: '0.5' });
  const model = createControlPanelModel({ solver });
  const item = model.add('Horizontal Scrollbar', {
    configurationExpression: 'MinMax(low, high, 35, increment)',
  });

  assert.equal(item.parameterName, 'c1');
  const state = controlPanelState(model.get(item.id), solver);
  assert.deepEqual(state.entry, solver.dimensions.get(item.parameterId));
  assert.equal(state.value, 35);
  assert.equal(state.valueText, '35');
  assert.ok(Math.abs(state.minimum - 20) < 1e-9);
  assert.ok(Math.abs(state.maximum - 80) < 1e-9);
  assert.ok(Math.abs(state.step - 0.5) < 1e-9);
  assert.equal(state.error, null);

  model.setValue(item.id, 42.5);
  const updated = model.get(item.id);
  assert.equal(updated.configurationExpression, 'MinMax(low, high, 42.5, increment)');
  assert.equal(solver.dimensions.get(item.parameterId).value, 42.5);
  assert.equal(solver.dimensions.get(item.parameterId).usesDrawingUnit, false);
  assert.equal(
    controlExpressionForValue(updated, 50),
    'MinMax(low, high, 50, increment)',
  );
});

test('slider values snap to the nearest MinMax step when committed', () => {
  assert.equal(snapMinMaxValue(12.24, 10, 30, 0.5), 12);
  assert.equal(snapMinMaxValue(12.26, 10, 30, 0.5), 12.5);
  assert.equal(snapMinMaxValue(40, 10, 30, 0.5), 30);

  const solver = new SolverController();
  const model = createControlPanelModel({ solver });
  const item = model.add('Slider Control', {
    configurationExpression: 'MinMax(10, 30, 10, 0.5)',
  });

  model.setValue(item.id, '12.26');

  assert.equal(
    model.get(item.id).configurationExpression,
    'MinMax(10, 30, 12.5, 0.5)',
  );
  assert.equal(solver.dimensions.get(item.parameterId).value, 12.5);
});

test('slider previews do not mutate parameters before the committed value', () => {
  const solver = new SolverController();
  const updates = [];
  const model = createControlPanelModel({
    solver,
    updateParameter: (parameterId, patch) => {
      updates.push({ parameterId, patch });
      return solver.updateParameter(parameterId, patch);
    },
  });
  const item = model.add('Slider Control', {
    configurationExpression: 'MinMax(20, 100, 35, 1)',
  });

  assert.equal(model.previewValue(item.id, 82), 82);
  assert.equal(model.get(item.id).configurationExpression, 'MinMax(20, 100, 35, 1)');
  assert.equal(solver.dimensions.get(item.parameterId).value, 35);
  assert.equal(updates.length, 0);

  model.setValue(item.id, 82);

  assert.equal(updates.length, 1);
  assert.equal(model.get(item.id).configurationExpression, 'MinMax(20, 100, 82, 1)');
  assert.equal(solver.dimensions.get(item.parameterId).value, 82);
});

test('slider runtime markup uses a numeric value textbox', () => {
  const solver = new SolverController();
  const item = createControlItem('Slider Control');
  const markup = controlRowMarkup(item, controlPanelState(item, solver), false);

  assert.match(markup, /panel-control-slider-value/);
  assert.match(markup, /type="number"/);
  assert.match(markup, /inputmode="decimal"/);
  assert.doesNotMatch(markup, /<output/);
});

test('editing controls uses a wrapping expression area and a Visible button before Delete', () => {
  const solver = new SolverController();
  const item = createControlItem('Slider Control', { parameterName: 'c1' });
  const markup = controlRowMarkup(item, controlPanelState(item, solver), true);
  const hiddenItem = { ...item, visible: false };
  const hiddenMarkup = controlRowMarkup(hiddenItem, controlPanelState(hiddenItem, solver), true);

  assert.match(markup, /<textarea[^>]*data-control-expression[^>]*rows="2"[^>]*wrap="soft"/);
  assert.match(markup, />MinMax\(0, 100, 50, 1\)<\/textarea>/);
  assert.match(markup, /data-control-visibility[^>]*aria-pressed="true"/);
  assert.ok(markup.indexOf('data-control-visibility') < markup.indexOf('data-control-remove'));
  assert.match(hiddenMarkup, /data-control-visibility[^>]*aria-pressed="false"/);
  assert.doesNotMatch(hiddenMarkup, /control-hidden|\sdisabled(?:=|\s|>)/);
});

test('control panel mutations can use an asynchronous parameter updater', async () => {
  const solver = new SolverController();
  const updates = [];
  const model = createControlPanelModel({
    solver,
    updateParameter: async (parameterId, patch) => {
      updates.push({ parameterId, patch });
      return solver.updateParameter(parameterId, patch);
    },
  });
  const item = model.add('Horizontal Scrollbar', {
    configurationExpression: 'MinMax(0, 100, 25, 1)',
  });

  const pending = model.setValue(item.id, 75);
  assert.equal(typeof pending?.then, 'function');
  assert.equal(model.get(item.id).configurationExpression, 'MinMax(0, 100, 75, 1)');
  await pending;

  assert.deepEqual(updates, [{
    parameterId: item.parameterId,
    patch: {
      expression: 'MinMax(0, 100, 75, 1)',
      usesDrawingUnit: false,
    },
  }]);
  assert.equal(solver.dimensions.get(item.parameterId).value, 75);
});

test('a unitless scrollbar drives geometry through the dimension drawing-unit context', () => {
  const solver = new SolverController();
  const model = createControlPanelModel({ solver });
  const control = model.add('Horizontal Scrollbar', {
    configurationExpression: 'MinMax(1, 12, 4, 0.5)',
  });
  const line = solver.addEntity({
    id: 'controlled-line',
    type: 'line',
    start: [0, 0],
    end: [4 * 25.4, 0],
  });
  const anchors = {
    start: { type: 'segment-start', recordId: line.id, index: 0 },
    end: { type: 'segment-end', recordId: line.id, index: 0 },
    measureStart: { type: 'segment-start', recordId: line.id, index: 0 },
    measureEnd: { type: 'segment-end', recordId: line.id, index: 0 },
  };
  const dimension = solver.addDimension({
    type: 'dimension-line',
    dimensionMode: 'driving',
    subtype: 'horizontal',
    start: [...line.start],
    end: [...line.end],
    measureStart: [...line.start],
    measureEnd: [...line.end],
    label: [2 * 25.4, -20],
    text: '',
    anchors,
  });

  const linked = solver.setDimension(dimension.entity.dimensionId, control.parameterName);
  assert.ok(['converged', 'unchanged'].includes(linked.status), linked.message);
  model.setValue(control.id, 7.5);

  const solved = solver.getEntity(line.id);
  assert.ok(Math.abs(Math.hypot(
    solved.end[0] - solved.start[0],
    solved.end[1] - solved.start[1],
  ) - (7.5 * 25.4)) < 1e-3);
  assert.equal(solver.getDimensionText(dimension.entity.dimensionId, 'value'), '7.5');
  assert.equal(solver.dimensions.get(control.parameterId).value, 7.5);
  assert.equal(solver.dimensions.get(control.parameterId).usesDrawingUnit, false);
  assert.equal(controlPanelState(model.get(control.id), solver).valueText, '7.5');
});

test('scrollbar and numeric textbox values stay unitless in metric drawings', () => {
  const solver = new SolverController();
  solver.setDrawingProperties({ drawingUnit: 'cm' });
  const model = createControlPanelModel({ solver });
  const control = model.add('Horizontal Scrollbar', {
    configurationExpression: 'MinMax(2, 8, 12, 0.25)',
  });
  const numeric = model.add('Numeric Textbox', {
    configurationExpression: '3.5',
  });

  const state = controlPanelState(model.get(control.id), solver);
  assert.equal(state.minimum, 2);
  assert.equal(state.maximum, 8);
  assert.equal(state.value, 8);
  assert.equal(state.step, 0.25);
  assert.equal(state.valueText, '8');
  assert.equal(solver.dimensions.get(control.parameterId).value, 8);
  assert.equal(controlPanelState(model.get(numeric.id), solver).value, 3.5);
  assert.equal(solver.dimensions.get(numeric.parameterId).value, 3.5);
});

test('restoring a legacy length-tagged scrollbar migrates it to a scalar', () => {
  const solver = new SolverController();
  solver.loadSketch({
    drawingUnit: 'in',
    parameters: [{
      id: 'legacy-control',
      name: 'c1',
      expression: 'MinMax(0, 100, 50, 1)',
      value: 50 * 25.4,
      kind: 'control',
      driving: false,
      computed: false,
      unit: null,
      error: null,
      order: 0,
      usesDrawingUnit: true,
    }],
  });
  const model = createControlPanelModel({ solver });

  model.restore({
    version: 1,
    items: [{
      id: 'legacy-slider',
      controlType: 'horizontal-scrollbar',
      configurationExpression: 'MinMax(0, 100, 50, 1)',
      parameterId: 'legacy-control',
      parameterName: 'c1',
    }],
  });

  const upgraded = solver.dimensions.get('legacy-control');
  assert.equal(upgraded.usesDrawingUnit, false);
  assert.equal(upgraded.value, 50);
  assert.equal(controlPanelState(model.get('legacy-slider'), solver).value, 50);
});

test('choice arrays resolve parameter names to values and preserve literal strings', () => {
  const solver = new SolverController();
  solver.createParameter({ name: 'dog', expression: '6 mm' });
  const item = normalizeControlItem({
    controlType: 'Options',
    configurationExpression: '{dog|cat|house}',
  });

  assert.deepEqual(parseControlArrayExpression(item.configurationExpression), ['dog', 'cat', 'house']);
  const resolved = resolveControlChoices(item, solver);
  assert.deepEqual(resolved.choices.map(({ label }) => label), ['0.236', 'cat', 'house']);
  assert.equal(resolved.choices[0].parameterExpression, 'dog');
  assert.equal(resolved.choices[1].parameterExpression, '"cat"');
});

test('Options and Dropdown values are real c parameters', () => {
  const solver = new SolverController();
  const model = createControlPanelModel({ solver });
  const options = model.add('Options', { configurationExpression: '{dog|cat|house}' });
  const dropdown = model.add('Dropdown', { configurationExpression: '{10|20|30}' });

  model.setValue(options.id, 1);
  model.setValue(dropdown.id, 2);

  assert.equal(solver.dimensions.get(options.parameterId).name, 'c1');
  assert.equal(solver.dimensions.get(options.parameterId).value, 'cat');
  assert.equal(solver.dimensions.get(dropdown.parameterId).name, 'c2');
  assert.equal(solver.dimensions.get(dropdown.parameterId).value, 30);
  assert.equal(solver.dimensions.get(dropdown.parameterId).usesDrawingUnit, false);
});

test('control panel serialization preserves labels and row order', () => {
  const solver = new SolverController();
  const model = createControlPanelModel({ solver });
  const first = model.add('Checkbox');
  const second = model.add('Numeric Textbox');
  model.setLabel(second.id, 'Quantity');
  model.setItemVisible(second.id, false);
  model.reorder(second.id, 0);

  const serialized = model.serialize();
  assert.equal(serialized.version, 2);
  assert.deepEqual(serialized.items.map(({ id }) => id), [second.id, first.id]);
  assert.equal(serialized.items[0].label, 'Quantity');
  assert.equal(serialized.items[0].visible, false);
  assert.equal(serialized.items.every((item) => !('x' in item)), true);

  model.clear();
  model.restore(serialized);
  assert.deepEqual(model.list().map(({ id }) => id), [second.id, first.id]);
  assert.equal(model.list()[0].parameterName, 'c2');
  assert.equal(model.list()[0].visible, false);
  assert.equal(normalizeControlItem({ controlType: 'Checkbox' }).visible, true);
});

test('renaming a referenced parameter updates stored control expressions', () => {
  const solver = new SolverController();
  const source = solver.createParameter({ name: 'choiceA', expression: '12 mm' });
  const model = createControlPanelModel({ solver });
  const item = model.add('Dropdown', { configurationExpression: '{choiceA|Other}' });

  solver.updateParameter(source.id, { name: 'renamedChoice' });
  model.synchronizeParameters(solver.parameters());

  assert.equal(model.get(item.id).configurationExpression, '{renamedChoice|Other}');
  assert.equal(resolveControlChoices(model.get(item.id), solver).choices[0].label, '0.472');
});

test('removing a panel control removes its parameter', () => {
  const solver = new SolverController();
  const model = createControlPanelModel({ solver });
  const item = model.add('Checkbox');
  assert.ok(solver.dimensions.get(item.parameterId));
  assert.equal(model.remove(item.id), true);
  assert.equal(solver.dimensions.get(item.parameterId), null);
});
