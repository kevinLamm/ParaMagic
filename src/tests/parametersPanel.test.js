import test from 'node:test';
import assert from 'node:assert/strict';
import {
  controlLabelForParameter,
  createParameterExportMenuController,
  createParameterTableViewToggle,
  parameterNameEditorMarkup,
  parameterTableBodyMarkup,
  parameterTableGroupKey,
  parameterTableSections,
  parametersPanelHeaderActionsMarkup,
} from '../../packages/paramagic-core/src/modules/ParametersPanel.js';

const entries = [
  { id: 'dimension-2', kind: 'dimension' },
  { id: 'parameter-2', kind: 'user' },
  { id: 'control-1', kind: 'control' },
  { id: 'parameter-1', kind: 'user' },
  { id: 'dimension-1', kind: 'dimension' },
  { id: 'control-2', kind: 'control' },
];

test('the full Parameters Panel list retains the user-sorted order', () => {
  const [section] = parameterTableSections(entries);
  assert.equal(section.key, 'all');
  assert.deepEqual(section.entries.map(({ id }) => id), entries.map(({ id }) => id));
});

test('the separated Parameters Panel view preserves relative user order within each type', () => {
  const sections = parameterTableSections(entries, { separated: true });
  assert.deepEqual(sections.map(({ key }) => key), ['parameter', 'dimension', 'control']);
  assert.deepEqual(sections[0].entries.map(({ id }) => id), ['parameter-2', 'parameter-1']);
  assert.deepEqual(sections[1].entries.map(({ id }) => id), ['dimension-2', 'dimension-1']);
  assert.deepEqual(sections[2].entries.map(({ id }) => id), ['control-1', 'control-2']);
});

test('the separated table adds type headings and keeps the new-parameter row in Parameters', () => {
  const markup = parameterTableBodyMarkup(entries, {
    separated: true,
    rowMarkup: ({ id }) => `<tr data-id="${id}"></tr>`,
    draftMarkup: () => '<tr data-draft></tr>',
  });
  assert.ok(markup.indexOf('>Parameters<') < markup.indexOf('data-id="parameter-2"'));
  assert.ok(markup.indexOf('data-id="parameter-1"') < markup.indexOf('data-draft'));
  assert.ok(markup.indexOf('data-draft') < markup.indexOf('>Dimensions<'));
  assert.ok(markup.indexOf('>Dimensions<') < markup.indexOf('data-id="dimension-2"'));
  assert.ok(markup.indexOf('>Controls<') < markup.indexOf('data-id="control-1"'));
});

test('unknown and user kinds are treated as Parameters', () => {
  assert.equal(parameterTableGroupKey({ kind: 'user' }), 'parameter');
  assert.equal(parameterTableGroupKey({}), 'parameter');
});

test('control parameter names show their assigned Control label as non-editable context', () => {
  const entry = { id: 'control-parameter-1', name: 'c1', kind: 'control' };
  const controls = [{
    parameterId: 'control-parameter-1',
    parameterName: 'c1',
    label: 'Waist Ease',
  }];

  assert.equal(controlLabelForParameter(entry, controls), 'Waist Ease');
  const markup = parameterNameEditorMarkup(entry, { controlItems: controls });
  assert.match(markup, /class="parameter-name"[^>]*value="c1"/);
  assert.match(markup, /class="parameter-control-label-ghost"/);
  assert.match(markup, /aria-label="Control label: Waist Ease"/);
  assert.match(markup, />Waist Ease</);
  assert.doesNotMatch(markup, /data-control-label/);
});

test('parameter name rows omit the label ghost when no Control label is assigned', () => {
  const userMarkup = parameterNameEditorMarkup({ id: 'parameter-1', name: 'width', kind: 'user' }, {
    controlItems: [{ parameterName: 'width', label: 'Not a control' }],
  });
  const unlabeledControlMarkup = parameterNameEditorMarkup({ id: 'control-1', name: 'c1', kind: 'control' }, {
    controlItems: [{ parameterId: 'control-1', parameterName: 'c1', label: '  ' }],
  });

  assert.doesNotMatch(userMarkup, /parameter-control-label-ghost/);
  assert.doesNotMatch(unlabeledControlMarkup, /parameter-control-label-ghost/);
});

test('Control label ghosts escape saved label text', () => {
  const markup = parameterNameEditorMarkup({ id: 'control-1', name: 'c1', kind: 'control' }, {
    controlItems: [{ parameterId: 'control-1', label: '<Waist & Hip>' }],
  });

  assert.match(markup, /&lt;Waist &amp; Hip&gt;/);
  assert.doesNotMatch(markup, /<Waist/);
});

test('the table view toggle changes modes and limits grouped reordering to one type', () => {
  const listeners = new Map();
  const attributes = new Map();
  const button = {
    title: '',
    addEventListener: (type, listener) => listeners.set(type, listener),
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const changes = [];
  const view = createParameterTableViewToggle({
    button,
    onChange: (separated) => changes.push(separated),
  });

  assert.equal(view.isSeparated(), false);
  assert.equal(attributes.get('aria-pressed'), 'false');
  assert.equal(view.canReorder({ kind: 'user' }, { kind: 'dimension' }), true);

  listeners.get('click')();

  assert.equal(view.isSeparated(), true);
  assert.equal(attributes.get('aria-pressed'), 'true');
  assert.deepEqual(changes, [true]);
  assert.equal(view.canReorder({ kind: 'user' }, { kind: 'dimension' }), false);
  assert.equal(view.canReorder({ kind: 'dimension' }, { kind: 'dimension' }), true);
});

test('the Parameter export button reliably opens and closes its format menu', () => {
  const buttonListeners = new Map();
  const rootListeners = new Map();
  const attributes = new Map([['aria-expanded', 'false']]);
  const button = {
    addEventListener: (type, listener) => buttonListeners.set(type, listener),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const menu = { hidden: true };
  const root = { addEventListener: (type, listener) => rootListeners.set(type, listener) };
  const controller = createParameterExportMenuController({ button, menu, root });

  let clickPropagationStopped = false;
  buttonListeners.get('click')({ stopPropagation: () => { clickPropagationStopped = true; } });
  assert.equal(clickPropagationStopped, true);
  assert.equal(controller.isOpen(), true);
  assert.equal(menu.hidden, false);
  assert.equal(attributes.get('aria-expanded'), 'true');

  rootListeners.get('pointerdown')({
    composedPath: () => [{ closest: () => null }],
    target: { closest: () => null },
  });
  assert.equal(controller.isOpen(), false);
  assert.equal(menu.hidden, true);

  controller.setOpen(true);
  rootListeners.get('pointerdown')({
    composedPath: () => [button],
    target: { closest: () => null },
  });
  assert.equal(controller.isOpen(), true);
});

test('the Parameters heading uses icon-only Group By, Import, Export, and Help buttons', () => {
  const markup = parametersPanelHeaderActionsMarkup();
  assert.match(markup, /aria-label="Group by type"/);
  assert.match(markup, /aria-label="Import parameter table"/);
  assert.match(markup, /aria-label="Export parameter table"/);
  assert.match(markup, /aria-label="Expression help"/);
  assert.doesNotMatch(markup, />Separate by type</);
});
