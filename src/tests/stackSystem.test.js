import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STACK_ID,
  createStackSystem,
  inactiveStackInteractionAllowed,
  normalizeStackState,
  stackExportMenuMarkup,
} from '../../packages/paramagic-core/src/modules/StackSystem.js';

function trackedClassList(initial = []) {
  const classes = new Set(initial);
  return {
    classes,
    contains: (name) => classes.has(name),
    toggle(name, enabled) {
      if (enabled) classes.add(name);
      else classes.delete(name);
    },
  };
}

function presentationNode() {
  const attributes = new Map();
  const classList = trackedClassList();
  return {
    attributes,
    classList,
    mutationCount: 0,
    setAttribute(name, value) {
      this.mutationCount += 1;
      attributes.set(name, String(value));
    },
  };
}

test('Stack tools group DXF, SVG, PNG, and JSON under an Export submenu', () => {
  const markup = stackExportMenuMarkup();
  assert.match(markup, /data-stack-export-toggle[^>]*aria-expanded="false"/);
  assert.match(markup, /data-stack-export-options hidden/);
  assert.deepEqual(
    [...markup.matchAll(/data-stack-export="([^"]+)"/g)].map((match) => match[1]),
    ['dxf', 'svg', 'png', 'json'],
  );
});

test('stack state always contains one non-removable default stack', () => {
  const state = normalizeStackState({
    activeStackId: 'missing',
    stacks: [
      { id: DEFAULT_STACK_ID, name: 'Base', visible: false, removable: true },
      { id: 'stack-a', name: 'Trace', visible: true },
      { id: 'stack-a', name: 'Duplicate' },
    ],
  });
  assert.deepEqual(state.stacks, [
    { id: DEFAULT_STACK_ID, name: 'Base', visible: false, removable: false },
    { id: 'stack-a', name: 'Trace', visible: true, removable: true },
  ]);
  assert.equal(state.activeStackId, DEFAULT_STACK_ID);
});

test('new entities inherit the active stack and unknown stack IDs migrate to default', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const added = system.addStack('Annotations');
  assert.equal(system.assignEntity({ id: 'a', type: 'line' }).stackId, added.id);
  assert.equal(system.assignEntity({ id: 'b', type: 'line' }, 'missing').stackId, DEFAULT_STACK_ID);
});

test('hidden stacks hide records and remove them from selection without deleting them', () => {
  const classes = new Set();
  const group = {
    setAttribute() {},
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  const selectedIds = new Set(['line-a']);
  const records = [{ id: 'line-a', entity: { id: 'line-a', stackId: 'stack-a' }, group }];
  const system = createStackSystem({ records, selectedIds });
  system.restore({ activeStackId: 'stack-a', stacks: [{ id: 'stack-a', name: 'A', visible: false }] });
  system.syncPresentation();
  assert.equal(classes.has('stack-hidden'), true);
  assert.equal(selectedIds.has('line-a'), false);
  assert.equal(records.length, 1);
});

test('inactive Stack records are dimmed and disabled until a dimension or constraint tool is active', () => {
  const canvasClassList = trackedClassList();
  const canvasElement = { classList: canvasClassList };
  const activeGroup = presentationNode();
  const inactiveGroup = presentationNode();
  const inactiveHandles = presentationNode();
  const selectedIds = new Set(['line-b']);
  const disabledIds = [];
  const activeRecord = {
    id: 'line-a',
    entity: { id: 'line-a', stackId: 'stack-a' },
    group: activeGroup,
  };
  const inactiveRecord = {
    id: 'line-b',
    entity: { id: 'line-b', stackId: 'stack-b' },
    group: inactiveGroup,
    handleGroup: inactiveHandles,
  };
  const system = createStackSystem({
    records: [activeRecord, inactiveRecord],
    selectedIds,
    canvasElement,
    onRecordDisabled: (record) => disabledIds.push(record.id),
  });
  system.restore({
    activeStackId: 'stack-a',
    stacks: [
      { id: 'stack-a', name: 'A', visible: true },
      { id: 'stack-b', name: 'B', visible: true },
    ],
  });

  system.syncPresentation();
  assert.equal(activeGroup.classList.classes.has('stack-inactive'), false);
  assert.equal(inactiveGroup.classList.classes.has('stack-inactive'), true);
  assert.equal(inactiveHandles.classList.classes.has('stack-inactive'), true);
  assert.equal(inactiveGroup.attributes.get('data-stack-active'), 'false');
  assert.equal(system.isRecordEnabled(activeRecord), true);
  assert.equal(system.isRecordEnabled(inactiveRecord), false);
  assert.equal(selectedIds.has('line-b'), false);
  assert.deepEqual(disabledIds, ['line-b']);

  const mutationsAfterFirstSync = inactiveGroup.mutationCount;
  system.syncPresentation();
  assert.equal(inactiveGroup.mutationCount, mutationsAfterFirstSync);
  assert.deepEqual(disabledIds, ['line-b']);

  canvasClassList.toggle('dimension-selection-active', true);
  assert.equal(inactiveStackInteractionAllowed(canvasElement), true);
  assert.equal(system.isRecordEnabled(inactiveRecord), true);
  canvasClassList.toggle('dimension-selection-active', false);
  canvasClassList.toggle('constraint-selection-active', true);
  assert.equal(system.isRecordEnabled(inactiveRecord), true);

  system.setStackVisible('stack-b', false);
  assert.equal(system.isRecordEnabled(inactiveRecord), false);
});

test('stacks can be reordered directly to a dragged list index', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const first = system.addStack('First');
  const second = system.addStack('Second');
  const third = system.addStack('Third');
  assert.equal(system.moveStackToIndex(third.id, 1), true);
  assert.deepEqual(system.getState().stacks.map(({ id }) => id), [DEFAULT_STACK_ID, third.id, first.id, second.id]);
  assert.equal(system.moveStackToIndex(DEFAULT_STACK_ID, 99), true);
  assert.deepEqual(system.getState().stacks.map(({ id }) => id), [third.id, first.id, second.id, DEFAULT_STACK_ID]);
  assert.deepEqual(normalizeStackState(system.getState()).stacks.map(({ id }) => id), [third.id, first.id, second.id, DEFAULT_STACK_ID]);
});

test('drawing-extension restoration notifies stack panel subscribers', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const reasons = [];
  system.onStateChange((_state, change) => reasons.push(change.reason));
  system.extensionProvider.restore({
    activeStackId: 'stack-two',
    stacks: [
      { id: DEFAULT_STACK_ID, name: 'Default', visible: true },
      { id: 'stack-two', name: 'Stack 2', visible: true },
    ],
  });
  assert.deepEqual(reasons, ['subscribe', 'restore']);
  assert.deepEqual(system.getState().stacks.map(({ name }) => name), ['Default', 'Stack 2']);
});
