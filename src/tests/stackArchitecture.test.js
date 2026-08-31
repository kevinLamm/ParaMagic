import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ancestorStackIds,
  createStackTreeIndex,
  descendantStackIds,
  DRAWING_NODE_KIND,
  migrateStackArchitecture,
  nextActiveStackId,
  normalizeStackArchitectureState,
  participantStackIds,
  reparentStack,
  reorderStack,
  STACK_ARCHITECTURE_VERSION,
  subtreeStackIds,
  validateStackReparent,
} from '../../packages/paramagic-core/src/modules/StackArchitecture.js';
import {
  dimensionCollectionNameError,
  dimensionDisplayName,
  dimensionParameterNameError,
  nextAvailableParameterName,
  qualifiedDimensionName,
  replaceExpressionSymbolReference,
  rewriteQualifiedDimensionReferences,
  uniqueStackName,
  userParameterNameError,
} from '../../packages/paramagic-core/src/modules/NamingSystem.js';
import { fixtureUuid } from './helpers/fixtureUuid.js';

const sid = (label) => fixtureUuid(`stack-architecture:${label}`);

test('v3 Stack state normalizes a deterministic pre-order tree with canonical fields', () => {
  const defaultId = sid('default');
  const parentId = sid('parent');
  const firstChildId = sid('first-child');
  const secondChildId = sid('second-child');
  const state = normalizeStackArchitectureState({
    version: 3,
    activeStackId: firstChildId,
    stacks: [
      { id: secondChildId, name: 'Second Child', parentStackId: parentId, order: 20 },
      { id: defaultId, name: 'Default', systemRole: 'default-stack', order: 0 },
      { id: firstChildId, name: 'First Child', parentStackId: parentId, order: 10, enabledExpression: 'Rail Length > 20' },
      { id: parentId, name: 'Parent', order: 1 },
    ],
  });

  assert.equal(state.version, STACK_ARCHITECTURE_VERSION);
  assert.equal(state.activeStackId, firstChildId);
  assert.deepEqual(state.stacks.map(({ id }) => id), [defaultId, parentId, firstChildId, secondChildId]);
  assert.deepEqual(state.stacks.map(({ order }) => order), [0, 1, 0, 1]);
  assert.equal(state.stacks.find(({ id }) => id === secondChildId).enabled, true);
  assert.equal(state.stacks.find(({ id }) => id === secondChildId).enabledExpression, '');
  assert.equal(state.stacks.find(({ id }) => id === firstChildId).enabled, false);
  assert.equal(state.stacks.find(({ id }) => id === firstChildId).enabledExpression, 'Rail Length > 20');
  assert.equal(state.stacks.find(({ id }) => id === firstChildId).removable, true);
});

test('Stack tree indexes expose stable ancestor, descendant, and subtree closures', () => {
  const defaultId = sid('closure-default');
  const parentId = sid('closure-parent');
  const childId = sid('closure-child');
  const grandchildId = sid('closure-grandchild');
  const state = normalizeStackArchitectureState({ version: 3, stacks: [
    { id: defaultId, name: 'Default', systemRole: 'default-stack' },
    { id: parentId, name: 'Parent' },
    { id: childId, name: 'Child', parentStackId: parentId },
    { id: grandchildId, name: 'Grandchild', parentStackId: childId },
  ] });
  const index = createStackTreeIndex(state);

  assert.equal(index.parent(childId).id, parentId);
  assert.deepEqual(index.children(parentId).map(({ id }) => id), [childId]);
  assert.deepEqual(ancestorStackIds(state, grandchildId), [childId, parentId]);
  assert.deepEqual(descendantStackIds(state, parentId), [childId, grandchildId]);
  assert.deepEqual(subtreeStackIds(state, parentId), [parentId, childId, grandchildId]);
});

test('canonical Stack trees reject duplicate IDs, missing parents, self-parenting, and cycles', () => {
  const defaultId = sid('invalid-default');
  const childId = sid('invalid-child');
  const missingId = sid('missing-parent');
  const base = { id: defaultId, name: 'Default', systemRole: 'default-stack' };

  assert.throws(() => normalizeStackArchitectureState({ version: 3, stacks: [base, { ...base }] }), /more than once/);
  assert.throws(() => normalizeStackArchitectureState({ version: 3, stacks: [base, {
    id: childId, name: 'Child', parentStackId: missingId,
  }] }), /missing parent/);
  assert.throws(() => normalizeStackArchitectureState({ version: 3, stacks: [base, {
    id: childId, name: 'Child', parentStackId: childId,
  }] }), /own parent/);
  assert.throws(() => normalizeStackArchitectureState({ version: 3, stacks: [base,
    { id: childId, name: 'Child', parentStackId: missingId },
    { id: missingId, name: 'Other', parentStackId: childId },
  ] }), /cycle/);
});

test('reparent and reorder preserve Stack IDs and reject descendant drops', () => {
  const defaultId = sid('move-default');
  const firstId = sid('move-first');
  const secondId = sid('move-second');
  const childId = sid('move-child');
  const state = normalizeStackArchitectureState({ version: 3, stacks: [
    { id: defaultId, name: 'Default', systemRole: 'default-stack' },
    { id: firstId, name: 'First' },
    { id: secondId, name: 'Second' },
    { id: childId, name: 'Child', parentStackId: firstId },
  ] });

  const nested = reparentStack(state, secondId, firstId, 0);
  assert.deepEqual(nested.stacks.map(({ id }) => id), [defaultId, firstId, secondId, childId]);
  assert.deepEqual(nested.stacks.find(({ id }) => id === secondId), {
    ...state.stacks.find(({ id }) => id === secondId), parentStackId: firstId, order: 0,
  });
  const reordered = reorderStack(nested, childId, 0);
  assert.deepEqual(createStackTreeIndex(reordered).children(firstId).map(({ id }) => id), [childId, secondId]);
  assert.equal(validateStackReparent(state, firstId, childId).valid, false);
  assert.throws(() => reparentStack(state, firstId, childId), /descendant/);
});

test('active Stack fallback prefers an enabled ancestor and then deterministic tree order', () => {
  const defaultId = sid('active-default');
  const parentId = sid('active-parent');
  const childId = sid('active-child');
  const siblingId = sid('active-sibling');
  const state = normalizeStackArchitectureState({ version: 3, activeStackId: childId, stacks: [
    { id: defaultId, name: 'Default', systemRole: 'default-stack' },
    { id: parentId, name: 'Parent' },
    { id: childId, name: 'Child', parentStackId: parentId },
    { id: siblingId, name: 'Sibling' },
  ] });

  assert.equal(nextActiveStackId(state, [childId], childId), parentId);
  assert.equal(nextActiveStackId(state, [childId, parentId], childId), siblingId);
  assert.equal(nextActiveStackId(state, state.stacks.map(({ id }) => id), childId), null);
});

test('v2 Stack state migrates flat once without re-running legacy expression rewriting', () => {
  const defaultId = sid('migration-default');
  const stackId = sid('migration-stack');
  const drawing = {
    stackArchitectureVersion: 2,
    entities: [], constraints: [], parameters: [], dimensionAnnotations: [],
    extensions: { stacks: { version: 2, activeStackId: stackId, stacks: [
      { id: defaultId, name: 'Default', systemRole: 'default-stack' },
      { id: stackId, name: 'Flat Stack', parentStackId: defaultId, enabledExpression: 'FALSE' },
    ] } },
  };
  const migrated = migrateStackArchitecture(drawing);

  assert.equal(migrated.stackArchitectureVersion, STACK_ARCHITECTURE_VERSION);
  assert.equal(migrated.extensions.stacks.stacks.find(({ id }) => id === stackId).parentStackId, null);
  assert.equal(migrated.extensions.stacks.stacks.find(({ id }) => id === stackId).enabled, false);
  assert.equal(migrated.extensions.stacks.stacks.find(({ id }) => id === stackId).enabledExpression, '');
  assert.deepEqual(migrateStackArchitecture(migrated), migrated);
});

test('v4 preserves an intentionally empty active Stack and rejects drawing containers as active', () => {
  const defaultId = sid('nullable-default');
  const containerId = sid('nullable-container');
  const state = normalizeStackArchitectureState({
    version: STACK_ARCHITECTURE_VERSION,
    activeStackId: null,
    stacks: [
      { id: defaultId, name: 'Default', systemRole: 'default-stack' },
      { id: containerId, kind: DRAWING_NODE_KIND, name: 'Imported Drawing', sourceDrawingId: sid('source-drawing') },
    ],
  });
  assert.equal(state.activeStackId, null);
  assert.equal(state.stacks.find(({ id }) => id === containerId).kind, DRAWING_NODE_KIND);
  assert.throws(() => normalizeStackArchitectureState({
    ...state,
    activeStackId: containerId,
  }), /not a drawable Stack/);
});

test('Stack names are unique case-insensitively and use the standard numeric suffix', () => {
  const stacks = [
    { id: 'a', name: 'Front Panel' },
    { id: 'b', name: 'Front Panel(1)' },
  ];
  assert.equal(uniqueStackName('front panel', stacks), 'front panel(2)');
  assert.equal(uniqueStackName('Back Panel', stacks), 'Back Panel');
});

test('qualified reference rewriting updates expression-bearing fields without changing labels', () => {
  const value = rewriteQualifiedDimensionReferences({
    visibleExpression: 'd1@Front Panel > 10',
    text: 'Width {d1@front panel}',
    label: 'd1@Front Panel',
  }, [{ before: 'd1@Front Panel', after: 'd1@Bodice Front' }]);
  assert.equal(value.visibleExpression, 'd1@Bodice Front > 10');
  assert.equal(value.text, 'Width {d1@Bodice Front}');
  assert.equal(value.label, 'd1@Front Panel');
});

test('qualified dimension names preserve spaces without quotes or delimiters', () => {
  assert.equal(qualifiedDimensionName('d1', 'Front Panel'), 'd1@Front Panel');
  assert.equal(dimensionDisplayName(
    { kind: 'dimension', name: 'd1', stackId: 'front' },
    { stacks: [{ id: 'front', name: 'Front Panel' }] },
  ), 'd1@Front Panel');
});

test('user parameter names allow spaces but reserve expression syntax', () => {
  assert.equal(userParameterNameError('Waist Ease'), null);
  assert.match(userParameterNameError('Waist+Ease'), /operators/);
  assert.match(userParameterNameError('d1@Front'), /cannot contain/);
});

test('the core naming system validates dimension handles and allocates new dimensions sequentially', () => {
  assert.equal(dimensionParameterNameError('d16'), null);
  assert.match(dimensionParameterNameError('width'), /d1, d2, d3/);
  assert.equal(nextAvailableParameterName('d16', 'dimension', new Set(), { sequentialDimension: true }), 'd1');
  assert.equal(nextAvailableParameterName('d16', 'dimension', new Set(['d1', 'd2']), { sequentialDimension: true }), 'd3');
  assert.equal(dimensionCollectionNameError([
    { kind: 'dimension', name: 'd1', stackId: 'front' },
    { kind: 'dimension', name: 'd1', stackId: 'back' },
  ]), null);
  assert.match(dimensionCollectionNameError([
    { kind: 'dimension', name: 'd1', stackId: 'front' },
    { kind: 'dimension', name: 'D1', stackId: 'front' },
  ]), /already exists/);
});

test('the core naming system rewrites exact spaced symbols without altering longer names or qualified dimensions', () => {
  const expression = 'Waist + Waist Ease + d1 + d1@Front Panel';
  assert.equal(replaceExpressionSymbolReference(expression, 'Waist', 'Body Waist', {
    knownNames: ['Waist', 'Waist Ease', 'd1', 'd1@Front Panel'],
  }), 'Body Waist + Waist Ease + d1 + d1@Front Panel');
  assert.equal(replaceExpressionSymbolReference(expression, 'd1', 'd2', {
    caseInsensitive: true,
    knownNames: ['Waist', 'Waist Ease', 'd1', 'd1@Front Panel'],
  }), 'Waist + Waist Ease + d2 + d1@Front Panel');
});

test('participant stacks contain every referenced non-owner Stack exactly once', () => {
  const entities = [
    { id: 'a', stackId: 'stack-a' },
    { id: 'b', stackId: 'stack-b' },
    { id: 'c', stackId: 'stack-b' },
  ];
  assert.deepEqual(participantStackIds({ refs: ['a', 'b', 'c'] }, entities, 'stack-a'), ['stack-b']);
});

test('legacy drawings migrate Stack ownership, participants, and global dimension references idempotently', () => {
  const legacy = {
    entities: [
      { id: 'a', type: 'line', stackId: 'stack-a', start: [0, 0], end: [10, 0] },
      { id: 'b', type: 'line', stackId: 'stack-b', start: [0, 5], end: [10, 5] },
    ],
    parameters: [
      { id: 'dim-a', kind: 'dimension', name: 'd1', expression: '10', computed: false },
      { id: 'dim-b', kind: 'dimension', name: 'd2', expression: 'd1 * 2', computed: false },
      { id: 'global', kind: 'user', name: 'Waist Ease', expression: 'd1 + d2' },
    ],
    dimensionAnnotations: [
      { id: 'ann-a', dimensionId: 'dim-a', dimensionName: 'd1', stackId: 'stack-a', anchors: { start: { recordId: 'a' } } },
      { id: 'ann-b', dimensionId: 'dim-b', dimensionName: 'd2', stackId: 'stack-b', anchors: { start: { recordId: 'a' }, end: { recordId: 'b' } } },
    ],
    constraints: [{ id: 'cross', type: 'Distance', featureRefs: [{ recordId: 'a' }, { recordId: 'b' }] }],
    extensions: {
      stacks: {
        activeStackId: 'stack-a',
        stacks: [
          { id: 'stack-a', name: 'Front Panel' },
          { id: 'stack-b', name: 'Back Panel' },
        ],
      },
    },
  };
  const migrated = migrateStackArchitecture(legacy);
  assert.equal(migrated.parameters.find(({ id }) => id === 'dim-a').stackId, 'stack-a');
  assert.equal(migrated.parameters.find(({ id }) => id === 'dim-b').stackId, 'stack-b');
  assert.equal(migrated.parameters.find(({ id }) => id === 'dim-b').expression, 'd1@Front Panel * 2');
  assert.equal(migrated.parameters.find(({ id }) => id === 'global').expression, 'd1@Front Panel + d2@Back Panel');
  assert.deepEqual(migrated.constraints[0].participantStackIds, ['stack-b']);
  assert.deepEqual(migrated.dimensionAnnotations[1].participantStackIds, ['stack-a']);
  assert.deepEqual(migrateStackArchitecture(migrated), migrated);
});

test('legacy descriptive dimension handles are canonicalized before reaching the solver', () => {
  const migrated = migrateStackArchitecture({
    entities: [{ id: 'a', type: 'line', stackId: 'front', start: [0, 0], end: [10, 0] }],
    parameters: [
      { id: 'width', kind: 'dimension', name: 'width', expression: '10', computed: false },
      { id: 'double', kind: 'user', name: 'Double Width', expression: 'width * 2' },
    ],
    dimensionAnnotations: [{
      id: 'width-annotation', dimensionId: 'width', dimensionName: 'width', stackId: 'front',
      anchors: { start: { recordId: 'a' } },
    }],
    extensions: { stacks: { activeStackId: 'front', stacks: [{ id: 'front', name: 'Front Panel' }] } },
  });

  assert.equal(migrated.parameters.find(({ id }) => id === 'width').name, 'd1');
  assert.equal(migrated.parameters.find(({ id }) => id === 'double').expression, 'd1@Front Panel * 2');
  assert.equal(migrated.dimensionAnnotations[0].dimensionName, 'd1');
});

test('canonical drawings reject legacy dimension handles instead of leaking them into the solver', () => {
  assert.throws(() => migrateStackArchitecture({
    stackArchitectureVersion: 2,
    parameters: [{ id: 'width', kind: 'dimension', name: 'width', expression: '10' }],
  }), /d1, d2, d3/);
});

test('legacy drawings without Stack metadata preserve declared Stack IDs and migrate extension ownership', () => {
  const migrated = migrateStackArchitecture({
    entities: [
      { id: 'a', type: 'line', stackId: 'stack-a', start: [0, 0], end: [10, 0] },
      { id: 'b', type: 'line', stackId: 'stack-b', start: [0, 5], end: [10, 5] },
    ],
    extensions: {
      arrayTools: {
        arrays: [{ id: 'array-a', sourceIds: ['a'], rowSpacingExpression: 'd1' }],
      },
      linkedCopyTools: {
        copies: [{ id: 'copy-a', sourceIds: ['a'] }],
        positionConstraints: [{
          id: 'linked-cross',
          externalDrivingTarget: { copyId: 'copy-a', reference: { recordId: 'b' } },
        }],
      },
      swell: {
        constraints: [{ id: 'swell-cross', featureRefs: [{ recordId: 'a' }, { recordId: 'b' }] }],
      },
    },
  });

  assert.deepEqual(new Set(migrated.entities.map(({ stackId }) => stackId)), new Set(['stack-a', 'stack-b']));
  assert.equal(migrated.extensions.arrayTools.arrays[0].stackId, 'stack-a');
  assert.equal(migrated.extensions.linkedCopyTools.copies[0].stackId, 'stack-a');
  assert.equal(migrated.extensions.linkedCopyTools.positionConstraints[0].stackId, 'stack-a');
  assert.deepEqual(migrated.extensions.linkedCopyTools.positionConstraints[0].participantStackIds, ['stack-b']);
  assert.equal(migrated.extensions.swell.constraints[0].stackId, 'stack-a');
  assert.deepEqual(migrated.extensions.swell.constraints[0].participantStackIds, ['stack-b']);
  assert.deepEqual(migrateStackArchitecture(migrated), migrated);
});
