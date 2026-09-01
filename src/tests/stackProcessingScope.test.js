import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStackProcessingScope,
  processingRelationshipStackIds,
} from '../../packages/paramagic-core/src/modules/StackProcessingScope.js';

test('Stack processing scope excludes disabled entities and touching relationships', () => {
  const enabled = new Set(['stack-a']);
  const scope = createStackProcessingScope({
    isStackEnabled: (stackId) => enabled.has(stackId),
    defaultStackId: 'stack-a',
  });
  const records = [
    { id: 'a', entity: { id: 'a', stackId: 'stack-a' } },
    { id: 'b', entity: { id: 'b', stackId: 'stack-b' } },
    {
      id: 'dimension-ab',
      recordType: 'dimension',
      entity: { id: 'dimension-ab', stackId: 'stack-a', participantStackIds: ['stack-b'] },
    },
  ];
  const relationships = [
    { id: 'inside-a', stackId: 'stack-a' },
    { id: 'inside-b', stackId: 'stack-b' },
    { id: 'cross-ab', stackId: 'stack-a', participantStackIds: ['stack-b'] },
  ];

  assert.deepEqual(scope.records(records).map(({ id }) => id), ['a']);
  assert.deepEqual(scope.relationships(relationships).map(({ id }) => id), ['inside-a']);
});

test('Stack processing scope re-admits data immediately after reactivation', () => {
  const enabled = new Set(['stack-a']);
  const scope = createStackProcessingScope({
    isStackEnabled: (stackId) => enabled.has(stackId),
    defaultStackId: () => 'stack-a',
  });
  const record = { id: 'b', entity: { id: 'b', stackId: 'stack-b' } };
  const relationship = { stackId: 'stack-a', participantStackIds: ['stack-b'] };

  assert.equal(scope.recordEnabled(record), false);
  assert.equal(scope.relationshipEnabled(relationship), false);
  enabled.add('stack-b');
  assert.equal(scope.recordEnabled(record), true);
  assert.equal(scope.relationshipEnabled(relationship), true);
  assert.deepEqual(processingRelationshipStackIds(relationship), ['stack-a', 'stack-b']);
});

test('Stack processing scope disables relationships from live referenced Stack ownership when metadata is missing', () => {
  const enabled = new Set(['stack-a']);
  const stackByRecordId = new Map([
    ['point-a', 'stack-a'],
    ['point-b', 'stack-b'],
  ]);
  const scope = createStackProcessingScope({
    isStackEnabled: (stackId) => enabled.has(stackId),
    defaultStackId: 'stack-a',
    resolveRelationshipStackIds: (relationship) => (relationship.featureRefs || [])
      .map(({ recordId }) => stackByRecordId.get(recordId))
      .filter(Boolean),
  });
  const relationship = {
    id: 'cross-ab',
    stackId: 'stack-a',
    featureRefs: [
      { kind: 'point', recordId: 'point-a', index: 0 },
      { kind: 'point', recordId: 'point-b', index: 0 },
    ],
  };

  assert.deepEqual(scope.relationshipStackIds(relationship), ['stack-a', 'stack-b']);
  assert.equal(scope.relationshipEnabled(relationship), false);
  enabled.add('stack-b');
  assert.equal(scope.relationshipEnabled(relationship), true);
});
