import { GLOBAL_LAYER_ID } from '../../packages/paramagic-core/src/modules/StackCoordinates.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createStackTreeIndex } from '../../packages/paramagic-core/src/modules/StackArchitecture.js';
import {
  STACK_ENABLE_EXPRESSION_PLACEHOLDER,
  STACK_EXPRESSION_INPUT_MINIMUM_WIDTH,
  stackActivationTarget,
  stackDisclosureLabel,
  stackExpressionInputWidth,
  stackIdForCanvasHover,
  stackIdForRowHover,
  stackStatusText,
  stackToolbarAvailable,
  stackToolbarLeft,
  stackVisibilityAvailable,
  visibleStackIds,
} from '../../packages/paramagic-core/src/modules/StackTreePanel.js';
import { fixtureUuid } from './helpers/fixtureUuid.js';

const stackId = (name) => fixtureUuid(`stack-tree-panel:${name}`);

test('collapsed Stack descendants are absent from the visible tree order', () => {
  const defaultId = stackId('default');
  const parentId = stackId('parent');
  const childId = stackId('child');
  const grandchildId = stackId('grandchild');
  const siblingId = stackId('sibling');
  const index = createStackTreeIndex({ version: 3, stacks: [
    { id: defaultId, name: 'Default', systemRole: 'default-stack' },
    { id: parentId, name: 'Parent' },
    { id: childId, name: 'Child', parentStackId: parentId },
    { id: grandchildId, name: 'Grandchild', parentStackId: childId },
    { id: siblingId, name: 'Sibling' },
  ] });

  assert.deepEqual(
    visibleStackIds(index, new Set([defaultId, parentId, childId])),
    [defaultId, parentId, childId, grandchildId, siblingId, GLOBAL_LAYER_ID],
  );
  assert.deepEqual(
    visibleStackIds(index, new Set([defaultId, childId])),
    [defaultId, parentId, siblingId, GLOBAL_LAYER_ID],
  );
});

test('visibility control is available only while a Stack is effectively enabled', () => {
  assert.equal(stackVisibilityAvailable({ enabled: true, effectiveEnabled: true }), true);
  assert.equal(stackVisibilityAvailable({ enabled: false, enabledExpression: '1 < 2', effectiveEnabled: true }), true);
  assert.equal(stackVisibilityAvailable({ enabled: false, enabledExpression: '', effectiveEnabled: false }), false);
  assert.equal(stackVisibilityAvailable({ enabled: true, effectiveEnabled: false }), false);
});

test('Stack row status reserves its marker for activation errors', () => {
  assert.equal(stackStatusText('Expression failed'), '!');
  assert.equal(stackStatusText(''), '');
  assert.equal(stackStatusText(null), '');
});

test('blank Stack enable expressions show the FALSE hint', () => {
  assert.equal(STACK_ENABLE_EXPRESSION_PLACEHOLDER, 'FALSE');
});

test('Stack enable expression inputs retain their base width and expand to fit longer text', () => {
  assert.equal(STACK_EXPRESSION_INPUT_MINIMUM_WIDTH, 220);
  assert.equal(stackExpressionInputWidth(218), 220);
  assert.equal(stackExpressionInputWidth(340.2), 343);
  assert.equal(stackExpressionInputWidth(Number.NaN), 220);
});

test('Stack disclosure controls clearly label both tree states', () => {
  assert.equal(stackDisclosureLabel(false, 'Frame'), 'Expand Frame');
  assert.equal(stackDisclosureLabel(true, 'Frame'), 'Collapse Frame');
});

test('Stack toolbar is available to active Stacks and drawing containers, not the permanent drawing row', () => {
  assert.equal(stackToolbarAvailable({ active: true }), true);
  assert.equal(stackToolbarAvailable({ active: false }), false);
  assert.equal(stackToolbarAvailable({ drawingContainer: true }), true);
  assert.equal(stackToolbarAvailable({ drawingRoot: true }), false);
});

test('Stack row activation toggles the clicked Stack', () => {
  assert.equal(stackActivationTarget('stack-b', 'stack-a'), 'stack-b');
  assert.equal(stackActivationTarget('stack-a', 'stack-a'), null);
  assert.equal(stackActivationTarget('', 'stack-a'), null);
});

test('Stack toolbar anchors to the visible sidebar edge when a row overflows a narrow panel', () => {
  assert.equal(stackToolbarLeft({ rowRight: 240, sidebarRight: 260 }), 244);
  assert.equal(stackToolbarLeft({ rowRight: 236.58, sidebarRight: 190 }), 194);
});

test('canvas geometry hover resolves the owning Stack for tree highlighting', () => {
  assert.equal(stackIdForCanvasHover({ stackId: 'stack-b', recordId: 'line-b' }), 'stack-b');
  assert.equal(stackIdForCanvasHover({ recordId: 'line-a' }, () => 'stack-a'), 'stack-a');
  assert.equal(stackIdForCanvasHover({}, () => 'stack-a'), null);
  assert.equal(stackIdForCanvasHover({ stackId: 'stack-a' }, () => null, 'stack-a'), null);
  assert.equal(stackIdForCanvasHover({ stackId: 'stack-b' }, () => null, 'stack-a'), 'stack-b');
});

test('Stack row hover previews only non-active Stacks on the canvas', () => {
  assert.equal(stackIdForRowHover('stack-b', 'stack-a'), 'stack-b');
  assert.equal(stackIdForRowHover('stack-a', 'stack-a'), null);
  assert.equal(stackIdForRowHover('stack-a', null), 'stack-a');
});
