import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_USER_STACK_NAME,
  bindCanvasStackInteractions,
  createNewDrawingStackState,
  createStackSystem,
  inactiveStackInteractionAllowed,
  normalizeStackState,
  renderStackHoverOverlay,
  stackIdForCanvasInteractionTarget,
} from '../../packages/paramagic-core/src/modules/StackSystem.js';
import { defaultStackId } from '../../packages/paramagic-core/src/modules/StackArchitecture.js';
import { fixtureUuid } from './helpers/fixtureUuid.js';

function trackedClassList(initial = []) {
  const classes = new Set(initial);
  return {
    classes,
    add: (...names) => names.forEach((name) => classes.add(name)),
    contains: (name) => classes.has(name),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
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

function interactionCanvas() {
  const listeners = new Map();
  return {
    classList: trackedClassList(),
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    contains: () => true,
    dispatch(type, stackId, eventData = {}) {
      const owner = { dataset: { stackId } };
      const event = {
        ...eventData,
        target: { closest: () => owner },
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.propagationStopped = true; },
      };
      listeners.get(type)?.(event);
      return event;
    },
    listenerCount: () => listeners.size,
  };
}

test('canvas Stack interaction resolves ownership from the nearest Stack presentation node', () => {
  const owner = { dataset: { stackId: 'stack-b' } };
  const canvas = { contains: (candidate) => candidate === owner };
  assert.equal(stackIdForCanvasInteractionTarget({ closest: () => owner }, canvas), 'stack-b');
  assert.equal(stackIdForCanvasInteractionTarget({ closest: () => null }, canvas), null);
  assert.equal(stackIdForCanvasInteractionTarget({ closest: () => ({ dataset: { stackId: 'outside' } }) }, canvas), null);
});

test('inactive canvas records select their Stack on click and activate it on double click', () => {
  const canvas = interactionCanvas();
  let activeStackId = 'stack-a';
  let selectedStackId = 'stack-a';
  const stop = bindCanvasStackInteractions({
    canvasElement: canvas,
    getActiveStackId: () => activeStackId,
    hasStack: (stackId) => ['stack-a', 'stack-b'].includes(stackId),
    selectStack: (stackId) => { selectedStackId = stackId; return true; },
    activateStack: (stackId) => { activeStackId = stackId; selectedStackId = stackId; return true; },
  });

  const click = canvas.dispatch('click', 'stack-b');
  assert.equal(selectedStackId, 'stack-b');
  assert.equal(activeStackId, 'stack-a');
  assert.equal(click.defaultPrevented, true);
  assert.equal(click.propagationStopped, true);

  const doubleClick = canvas.dispatch('dblclick', 'stack-b');
  assert.equal(activeStackId, 'stack-b');
  assert.equal(doubleClick.defaultPrevented, true);

  const activeClick = canvas.dispatch('click', 'stack-b');
  assert.equal(activeClick.defaultPrevented, false);
  stop();
  assert.equal(canvas.listenerCount(), 0);
});

test('the second captured geometry click activates its inactive Stack when a fill consumes dblclick', () => {
  const canvas = interactionCanvas();
  let activeStackId = 'stack-a';
  let selectedStackId = 'stack-a';
  bindCanvasStackInteractions({
    canvasElement: canvas,
    getActiveStackId: () => activeStackId,
    hasStack: (stackId) => ['stack-a', 'stack-b'].includes(stackId),
    selectStack: (stackId) => { selectedStackId = stackId; return true; },
    activateStack: (stackId) => { activeStackId = stackId; selectedStackId = stackId; return true; },
  });

  canvas.dispatch('click', 'stack-b', { detail: 1 });
  const secondClick = canvas.dispatch('click', 'stack-b', { detail: 2 });

  assert.equal(activeStackId, 'stack-b');
  assert.equal(selectedStackId, 'stack-b');
  assert.equal(secondClick.defaultPrevented, true);
  assert.equal(secondClick.propagationStopped, true);
});

test('nearby pointer presses activate an inactive Stack before a fill can consume the click sequence', () => {
  const canvas = interactionCanvas();
  let activeStackId = 'stack-a';
  bindCanvasStackInteractions({
    canvasElement: canvas,
    getActiveStackId: () => activeStackId,
    hasStack: (stackId) => ['stack-a', 'stack-b'].includes(stackId),
    selectStack: () => true,
    activateStack: (stackId) => { activeStackId = stackId; return true; },
  });

  canvas.dispatch('pointerdown', 'stack-b', {
    button: 0, detail: 1, timeStamp: 100, clientX: 42, clientY: 84,
  });
  canvas.dispatch('pointerdown', 'stack-b', {
    button: 0, detail: 1, timeStamp: 360, clientX: 44, clientY: 82,
  });
  assert.equal(activeStackId, 'stack-b');
});

test('separate clicks do not activate an inactive Stack outside the double-click gesture', () => {
  const canvas = interactionCanvas();
  let activeStackId = 'stack-a';
  bindCanvasStackInteractions({
    canvasElement: canvas,
    getActiveStackId: () => activeStackId,
    hasStack: (stackId) => ['stack-a', 'stack-b'].includes(stackId),
    selectStack: () => true,
    activateStack: (stackId) => { activeStackId = stackId; return true; },
  });

  canvas.dispatch('click', 'stack-b', { detail: 1, timeStamp: 100, clientX: 42, clientY: 84 });
  canvas.dispatch('click', 'stack-b', { detail: 1, timeStamp: 800, clientX: 42, clientY: 84 });
  canvas.dispatch('click', 'stack-b', { detail: 1, timeStamp: 900, clientX: 60, clientY: 84 });
  assert.equal(activeStackId, 'stack-a');
});

test('cross-Stack dimension and constraint tool clicks remain owned by the active tool', () => {
  const canvas = interactionCanvas();
  let selectedStackId = 'stack-a';
  bindCanvasStackInteractions({
    canvasElement: canvas,
    getActiveStackId: () => 'stack-a',
    hasStack: () => true,
    selectStack: (stackId) => { selectedStackId = stackId; return true; },
    activateStack: () => true,
    isToolInteractionActive: () => true,
  });

  const click = canvas.dispatch('click', 'stack-b');
  assert.equal(selectedStackId, 'stack-a');
  assert.equal(click.defaultPrevented, false);
});

test('Stack hover overlay mounts foreground clones and clears them with the hover state', () => {
  const clone = {
    classList: trackedClassList(),
    attributes: new Map(),
    matches: () => false,
    querySelectorAll(selector) {
      if (selector === '*') return [graphic];
      if (selector === '[id]') return [];
      return [graphic];
    },
    removeAttribute(name) { this.attributes.delete(name); },
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
  const graphic = {
    classList: trackedClassList(['selectable-entity', 'selected']),
    parentElement: clone,
  };
  const source = { cloneNode: () => clone };
  const layer = {
    children: [],
    replaceChildren(...children) { this.children = children; },
  };

  const mounted = renderStackHoverOverlay(layer, [source, source]);
  assert.equal(mounted.length, 1);
  assert.equal(layer.children[0], clone);
  assert.equal(clone.classList.classes.has('stack-hover-overlay-record'), true);
  assert.equal(graphic.classList.classes.has('stack-hover-overlay-graphic'), true);
  assert.equal(graphic.classList.classes.has('selected'), false);
  assert.equal(clone.attributes.get('aria-hidden'), 'true');

  renderStackHoverOverlay(layer, []);
  assert.deepEqual(layer.children, []);
});

test('fallback ownership role belongs to an ordinary removable Stack', () => {
  const defaultId = fixtureUuid('stack-system-default');
  const state = normalizeStackState({
    activeStackId: 'missing',
    stacks: [
      { id: defaultId, name: 'Base', visible: false, systemRole: 'default-stack', removable: true },
      { id: 'stack-a', name: 'Trace', visible: true },
      { id: 'stack-a', name: 'Duplicate' },
    ],
  });
  assert.deepEqual(state.stacks, [
    {
      id: defaultId, name: 'Base', visible: false, systemRole: 'default-stack', removable: true,
      kind: 'stack', sourceStackId: defaultId, parentStackId: null, order: 0, enabled: true, enabledExpression: '',
    },
    {
      id: 'stack-a', kind: 'stack', name: 'Trace', visible: true, removable: true, sourceStackId: 'stack-a',
      parentStackId: null, order: 1, enabled: true, enabledExpression: '',
    },
  ]);
  assert.equal(state.activeStackId, defaultId);
});

test('a new drawing starts with only a fresh active Stack 1', () => {
  const first = createNewDrawingStackState();
  const second = createNewDrawingStackState();
  const initial = first.stacks.find(({ name }) => name === INITIAL_USER_STACK_NAME);

  assert.deepEqual(first.stacks.map(({ name }) => name), ['Stack 1']);
  assert.equal(first.activeStackId, initial.id);
  assert.equal(initial.removable, true);
  assert.notEqual(second.activeStackId, first.activeStackId);
});

test('new entities inherit the active stack and unknown stack IDs migrate to default', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const defaultId = defaultStackId(system.getState());
  const initialStackId = system.activeStackId();
  const added = system.addStack('Annotations');
  assert.equal(system.assignEntity({ id: 'a', type: 'line' }).stackId, initialStackId);
  assert.equal(system.setActiveStack(added.id), true);
  assert.equal(system.assignEntity({ id: 'a', type: 'line' }).stackId, added.id);
  assert.equal(system.assignEntity({ id: 'b', type: 'line' }, 'missing').stackId, defaultId);
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

test('no active Stack keeps all visible geometry at full opacity while leaving it non-editable', () => {
  const canvasClassList = trackedClassList();
  const firstGroup = presentationNode();
  const secondGroup = presentationNode();
  const records = [
    { id: 'line-a', entity: { id: 'line-a', stackId: 'stack-a' }, group: firstGroup },
    { id: 'line-b', entity: { id: 'line-b', stackId: 'stack-b' }, group: secondGroup },
  ];
  const system = createStackSystem({
    records,
    selectedIds: new Set(),
    canvasElement: { classList: canvasClassList },
  });
  system.restore({
    activeStackId: 'stack-a',
    stacks: [
      { id: 'stack-a', name: 'A', visible: true },
      { id: 'stack-b', name: 'B', visible: true },
    ],
  });
  system.setActiveStack(null);

  system.syncPresentation();

  assert.equal(firstGroup.classList.classes.has('stack-inactive'), false);
  assert.equal(secondGroup.classList.classes.has('stack-inactive'), false);
  assert.equal(system.isRecordEnabled(records[0]), false);
  assert.equal(system.isRecordEnabled(records[1]), false);
  canvasClassList.toggle('dimension-selection-active', true);
  assert.equal(system.isRecordEnabled(records[0]), false);
});

test('hovering a Stack applies a presentation-only highlight to all of its records', () => {
  const firstGroup = presentationNode();
  const secondGroup = presentationNode();
  const presentationChanges = [];
  const records = [
    { id: 'line-a', entity: { id: 'line-a', stackId: 'stack-a' }, group: firstGroup },
    { id: 'line-b', entity: { id: 'line-b', stackId: 'stack-b' }, group: secondGroup },
  ];
  const system = createStackSystem({
    records,
    selectedIds: new Set(),
    onPresentationChange: (change) => presentationChanges.push(change),
  });
  system.restore({
    activeStackId: 'stack-a',
    stacks: [
      { id: 'stack-a', name: 'A', visible: true },
      { id: 'stack-b', name: 'B', visible: true },
    ],
  });

  system.setHoveredStack('stack-b');
  system.syncPresentation();
  assert.equal(firstGroup.classList.classes.has('stack-hovered'), false);
  assert.equal(secondGroup.classList.classes.has('stack-hovered'), true);
  assert.equal(system.getState().hoveredStackId, undefined);
  assert.equal(system.getRuntimeState().hoveredStackId, 'stack-b');
  assert.equal(presentationChanges.at(-1).reason, 'hover');

  system.setHoveredStack(null);
  system.syncPresentation();
  assert.equal(secondGroup.classList.classes.has('stack-hovered'), false);
});

test('stacks can be reordered directly to a dragged list index', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const defaultId = defaultStackId(system.getState());
  const initialId = system.getState().stacks.find(({ name }) => name === 'Stack 1').id;
  const first = system.addStack('First');
  const second = system.addStack('Second');
  const third = system.addStack('Third');
  assert.equal(system.moveStackToIndex(third.id, 1), true);
  assert.equal(defaultId, initialId);
  assert.deepEqual(system.getState().stacks.map(({ id }) => id), [initialId, third.id, first.id, second.id]);
  assert.equal(system.moveStackToIndex(defaultId, 99), true);
  assert.deepEqual(system.getState().stacks.map(({ id }) => id), [third.id, first.id, second.id, initialId]);
  assert.deepEqual(normalizeStackState(system.getState()).stacks.map(({ id }) => id), [third.id, first.id, second.id, initialId]);
});

test('drawing-extension restoration notifies stack panel subscribers', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const defaultId = fixtureUuid('stack-system-restore-default');
  const reasons = [];
  system.onStateChange((_state, change) => reasons.push(change.reason));
  system.extensionProvider.restore({
    activeStackId: 'stack-two',
    stacks: [
      { id: defaultId, name: 'Default', systemRole: 'default-stack', visible: true },
      { id: 'stack-two', name: 'Stack 2', visible: true },
    ],
  });
  assert.deepEqual(reasons, ['subscribe', 'restore']);
  assert.deepEqual(system.getState().stacks.map(({ name }) => name), ['Default', 'Stack 2']);
});

test('Stack creation and rename enforce case-insensitive unique display names', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const first = system.addStack('Front Panel');
  const second = system.addStack('front panel');
  assert.equal(first.name, 'Front Panel');
  assert.equal(second.name, 'front panel(1)');
  assert.equal(system.renameStack(second.id, 'FRONT PANEL'), true);
  assert.equal(system.stack(second.id).name, 'FRONT PANEL(1)');
  assert.equal(system.renameStack(second.id, 'Front@Panel'), false);
  assert.equal(system.stack(second.id).name, 'FRONT PANEL(1)');
});

test('automatic Stack names advance from the initial Stack 1', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const second = system.addStack();
  const third = system.addStack();
  assert.deepEqual(system.getState().stacks.map(({ name }) => name), ['Stack 1', 'Stack 2', 'Stack 3']);
  assert.equal(second.name, 'Stack 2');
  assert.equal(third.name, 'Stack 3');
});

test('manual Stack enablement remains independent from its preserved expression', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const stack = system.addStack('Conditional');

  system.setStackEnabledExpression(stack.id, 'Width > 20');
  system.setStackEnabled(stack.id, false);
  assert.equal(system.stack(stack.id).enabled, false);
  assert.equal(system.stack(stack.id).enabledExpression, 'Width > 20');

  system.setStackEnabled(stack.id, true);
  assert.equal(system.stack(stack.id).enabled, true);
  assert.equal(system.stack(stack.id).enabledExpression, 'Width > 20');
});

test('Stack manager creates child and sibling nodes and reparents without changing identity', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const parent = system.addStack('Parent');
  const child = system.addChildStack(parent.id, 'Child');
  const sibling = system.addSiblingStack(child.id, 'Sibling');

  assert.equal(system.stack(child.id).parentStackId, parent.id);
  assert.equal(system.stack(sibling.id).parentStackId, parent.id);
  assert.deepEqual(system.getState().stacks.map(({ id }) => id).slice(-3), [parent.id, child.id, sibling.id]);
  assert.equal(system.reparentStack(sibling.id, null, 0), true);
  assert.equal(system.stack(sibling.id).id, sibling.id);
  assert.equal(system.stack(sibling.id).parentStackId, null);
  assert.equal(system.reparentStack(parent.id, child.id), false);
});

test('selection and activation remain independent from effective Stack enablement', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const parent = system.addStack('Parent');
  const child = system.addChildStack(parent.id, 'Child');
  const other = system.addStack('Other');

  system.setActivationStates({
    [parent.id]: { localEnabled: false },
    [child.id]: { localEnabled: true },
    [other.id]: { localEnabled: true },
  });
  assert.equal(system.isStackLocallyEnabled(child.id), true);
  assert.equal(system.isStackEffectivelyEnabled(child.id), false);
  assert.equal(system.setSelectedStack(child.id), true);
  assert.equal(system.selectedStackId(), child.id);
  assert.equal(system.setActiveStack(child.id), true);
  assert.equal(system.activeStackId(), child.id);
  assert.equal(system.setActiveStack(null), true);
  assert.equal(system.activeStackId(), null);
  assert.equal(system.getState().stacks.some((stack) => 'effectiveEnabled' in stack), false);
});

test('subtree deletion reports every owned record and removes descendants atomically', () => {
  const parentId = fixtureUuid('stack-system-delete-parent');
  const childId = fixtureUuid('stack-system-delete-child');
  const records = [
    { id: 'parent-record', entity: { id: 'parent-record', stackId: parentId } },
    { id: 'child-record', entity: { id: 'child-record', stackId: childId } },
    { id: 'outside-record', entity: { id: 'outside-record', stackId: fixtureUuid('stack-system-delete-default') } },
  ];
  const system = createStackSystem({ records, selectedIds: new Set() });
  const defaultId = fixtureUuid('stack-system-delete-default');
  system.restore({ version: 3, activeStackId: childId, stacks: [
    { id: defaultId, name: 'Default', systemRole: 'default-stack' },
    { id: parentId, name: 'Parent' },
    { id: childId, name: 'Child', parentStackId: parentId },
  ] });

  const removed = system.removeStackSubtree(parentId);
  assert.deepEqual(removed.removedStackIds, [parentId, childId]);
  assert.deepEqual(new Set(removed.recordIds), new Set(['parent-record', 'child-record']));
  assert.equal(removed.createdStackId, null);
  assert.deepEqual(system.getState().stacks.map(({ name }) => name), ['Default']);
});

test('deleting the last Stack creates and activates a fresh Stack 1', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const removedId = system.activeStackId();

  const removed = system.removeStackSubtree(removedId);
  const replacement = system.stack(removed.createdStackId);

  assert.deepEqual(removed.removedStackIds, [removedId]);
  assert.deepEqual(system.getState().stacks.map(({ name }) => name), ['Stack 1']);
  assert.equal(replacement.name, 'Stack 1');
  assert.equal(replacement.removable, true);
  assert.equal(system.activeStackId(), replacement.id);
  assert.equal(system.selectedStackId(), replacement.id);
  assert.notEqual(replacement.id, removedId);
});

test('clearing a drawing creates and activates a new Stack 1 UUID', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const originalStackId = system.activeStackId();
  const changes = [];
  system.onStateChange((_state, change) => changes.push(change));
  system.addStack('Other');

  const cleared = system.clear();
  const initial = cleared.stacks.find(({ name }) => name === 'Stack 1');
  assert.deepEqual(cleared.stacks.map(({ name }) => name), ['Stack 1']);
  assert.equal(cleared.activeStackId, initial.id);
  assert.notEqual(initial.id, originalStackId);
  assert.equal(changes.at(-1).reason, 'clear');
  assert.deepEqual(changes.at(-1).affectedStackIds, [initial.id]);
});

test('drawing containers cannot own geometry or become the active Stack', () => {
  const system = createStackSystem({ records: [], selectedIds: new Set() });
  const defaultId = defaultStackId(system.getState());
  const containerId = fixtureUuid('stack-system-container');
  system.restore({ version: 4, activeStackId: null, stacks: [
    { id: defaultId, name: 'Default', systemRole: 'default-stack' },
    { id: containerId, kind: 'drawing', name: 'Imported Drawing' },
  ] });
  assert.equal(system.setActiveStack(containerId), false);
  assert.equal(system.assignEntity({ id: 'line', type: 'line' }, containerId).stackId, defaultId);
});
