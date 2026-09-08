import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTITY_RELATIONSHIP_SOLVE_DOMAIN,
  STACK_FRAME_RELATIONSHIP_SOLVE_DOMAIN,
  createDormantStackRelationships,
  isStackFrameRelationship,
  pruneDormantStackRelationships,
  reconcileDormantStackRelationships,
  stackRelationshipSolveDomain,
} from '../../packages/paramagic-core/src/modules/StackRelationshipSystem.js';

test('Stack relationship interaction mode follows active Stack state', () => {
  assert.equal(stackRelationshipSolveDomain(null), STACK_FRAME_RELATIONSHIP_SOLVE_DOMAIN);
  assert.equal(stackRelationshipSolveDomain('stack-a'), ENTITY_RELATIONSHIP_SOLVE_DOMAIN);
  assert.equal(isStackFrameRelationship({ coordinateSpace: 'global' }), true);
  assert.equal(isStackFrameRelationship({ coordinateSpace: 'global', solveDomain: 'entity' }), false);
  assert.equal(isStackFrameRelationship({ coordinateSpace: 'local', solveDomain: 'stack-frame' }), false);
});

function crossStackFixture() {
  return {
    entities: [
      { id: 'a', sourceRecordId: 'a', sourceStackId: 'source-a', stackId: 'source-a', type: 'line', start: [0, 0], end: [10, 0] },
      { id: 'b', sourceRecordId: 'b', sourceStackId: 'source-b', stackId: 'source-b', type: 'line', start: [0, 10], end: [10, 10] },
    ],
    constraints: [
      {
        id: 'cross-horizontal',
        sourceRelationshipId: 'cross-horizontal',
        type: 'Parallel',
        featureRefs: [
          { kind: 'segment', recordId: 'a', index: 0 },
          { kind: 'segment', recordId: 'b', index: 0 },
        ],
        stackId: 'source-a',
        participantStackIds: ['source-b'],
      },
      {
        id: 'cross-distance',
        sourceRelationshipId: 'cross-distance',
        type: 'Distance',
        source: 'dimension',
        dimensionRef: 'cross-dimension',
        featureRefs: [
          { kind: 'point', recordId: 'a', index: 0 },
          { kind: 'point', recordId: 'b', index: 0 },
        ],
        stackId: 'source-a',
        participantStackIds: ['source-b'],
      },
    ],
    parameters: [{
      id: 'cross-dimension', sourceDimensionId: 'cross-dimension', name: 'd1', kind: 'dimension',
      expression: '10', value: 10, driving: true, stackId: 'source-a', participantStackIds: ['source-b'],
    }],
    dimensionAnnotations: [{
      id: 'cross-annotation', dimensionId: 'cross-dimension', dimensionName: 'd1',
      sourceRelationshipId: 'cross-dimension', type: 'distance-dimension',
      featureRefs: [
        { kind: 'point', recordId: 'a', index: 0 },
        { kind: 'point', recordId: 'b', index: 0 },
      ],
      stackId: 'source-a', participantStackIds: ['source-b'],
    }],
    extensions: {
      stacks: {
        version: 2,
        activeStackId: 'source-a',
        stacks: [
          { id: 'source-a', sourceStackId: 'source-a', name: 'Front' },
          { id: 'source-b', sourceStackId: 'source-b', name: 'Back' },
        ],
      },
      linkedCopyTools: {
        version: 3,
        copies: [{ id: 'copy-a', sourceDefinitionId: 'copy-a', sourceStackId: 'source-a', stackId: 'source-a', sourceIds: ['a'] }],
        positionConstraints: [{
          id: 'linked-cross',
          externalDrivingTarget: { copyId: 'copy-a', sourceId: 'a', reference: { recordId: 'b' } },
          featureRefs: [{ kind: 'point', recordId: 'b', index: 0 }],
          stackId: 'source-a', participantStackIds: ['source-b'],
        }],
      },
      swell: {
        version: 1,
        constraints: [{
          id: 'swell-cross',
          externalTarget: { sourceId: 'a', movableRef: { recordId: 'b', index: 0 } },
          featureRefs: [{ kind: 'point', recordId: 'a' }, { kind: 'point', recordId: 'b' }],
          stackId: 'source-a', participantStackIds: ['source-b'],
        }],
      },
    },
  };
}

function insertedFront(relationships) {
  return {
    entities: [{ id: 'front-live', sourceRecordId: 'a', sourceStackId: 'source-a', stackId: 'front-live-stack', type: 'line', start: [0, 0], end: [10, 0] }],
    constraints: [],
    parameters: [],
    dimensionAnnotations: [],
    extensions: {
      stacks: {
        version: 2,
        activeStackId: 'front-live-stack',
        stacks: [{ id: 'front-live-stack', sourceStackId: 'source-a', name: 'Front' }],
      },
      linkedCopyTools: {
        version: 3,
        copies: [{ id: 'copy-live', sourceDefinitionId: 'copy-a', sourceStackId: 'source-a', stackId: 'front-live-stack', sourceIds: ['front-live'] }],
      },
      stackRelationships: relationships,
    },
  };
}

test('cross-Stack native, dimension, Linked Copy, and Swell relationships stay dormant until every source Stack is present', () => {
  const source = crossStackFixture();
  const relationships = createDormantStackRelationships(source, ['a']);
  assert.deepEqual(new Set(relationships.templates.map(({ type, extensionKey }) => `${type}:${extensionKey || 'native'}`)), new Set([
    'constraint:native',
    'dimension:native',
    'extension-constraint:linkedCopyTools',
    'extension-constraint:swell',
  ]));

  const dormant = reconcileDormantStackRelationships(insertedFront(relationships));
  assert.equal(dormant.constraints.length, 0);
  assert.equal(dormant.dimensionAnnotations.length, 0);
  assert.equal(dormant.extensions.linkedCopyTools.positionConstraints, undefined);

  dormant.entities.push({
    id: 'back-live-1', sourceRecordId: 'b', sourceStackId: 'source-b', stackId: 'back-live-stack-1',
    type: 'line', start: [0, 10], end: [10, 10],
  });
  dormant.extensions.stacks.stacks.push({ id: 'back-live-stack-1', sourceStackId: 'source-b', name: 'Back' });
  const active = reconcileDormantStackRelationships(dormant);
  assert.equal(active.constraints.length, 2);
  assert.equal(active.parameters.filter(({ kind }) => kind === 'dimension').length, 1);
  assert.equal(active.dimensionAnnotations.length, 1);
  assert.equal(active.extensions.linkedCopyTools.positionConstraints.length, 1);
  assert.equal(active.extensions.swell.constraints.length, 1);
  assert.equal(active.constraints[0].featureRefs[1].recordId, 'back-live-1');
  assert.equal(active.constraints.find(({ source }) => source === 'dimension').dimensionRef, active.parameters[0].id);
  assert.equal(active.dimensionAnnotations[0].participantStackIds[0], 'back-live-stack-1');
});

test('deleting the last instance of a source Stack removes its dormant cross-Stack templates', () => {
  const relationships = createDormantStackRelationships(crossStackFixture(), ['a']);
  assert.ok(relationships.templates.length > 0);
  assert.equal(pruneDormantStackRelationships(relationships, {
    removedSourceStackIds: ['source-b'],
    remainingSourceStackIds: ['source-a'],
  }).templates.length, 0);
  assert.equal(pruneDormantStackRelationships(relationships, {
    removedSourceStackIds: ['source-b'],
    remainingSourceStackIds: ['source-a', 'source-b'],
  }).templates.length, relationships.templates.length);
});

test('inserting the same companion Stack twice creates one independently bound relationship per Stack instance', () => {
  const source = crossStackFixture();
  const relationships = createDormantStackRelationships(source, ['a']);
  const drawing = insertedFront(relationships);
  drawing.entities.push({ id: 'back-live-1', sourceRecordId: 'b', sourceStackId: 'source-b', stackId: 'back-live-stack-1', type: 'line', start: [0, 10], end: [10, 10] });
  drawing.extensions.stacks.stacks.push({ id: 'back-live-stack-1', sourceStackId: 'source-b', name: 'Back' });
  const once = reconcileDormantStackRelationships(drawing);
  once.entities.push({ id: 'back-live-2', sourceRecordId: 'b', sourceStackId: 'source-b', stackId: 'back-live-stack-2', type: 'line', start: [0, 20], end: [10, 20] });
  once.extensions.stacks.stacks.push({ id: 'back-live-stack-2', sourceStackId: 'source-b', name: 'Back(1)' });
  const twice = reconcileDormantStackRelationships(once);
  assert.equal(twice.constraints.length, 4);
  assert.equal(twice.dimensionAnnotations.length, 2);
  assert.equal(twice.extensions.linkedCopyTools.positionConstraints.length, 2);
  assert.equal(twice.extensions.swell.constraints.length, 2);
  assert.equal(new Set(twice.dimensionAnnotations.map(({ stackRelationshipBindingKey }) => stackRelationshipBindingKey)).size, 2);
});
