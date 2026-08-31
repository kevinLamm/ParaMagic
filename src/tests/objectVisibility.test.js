import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createObjectVisibilitySystem,
  evaluateVisibleExpression,
  filterVisibleThumbnailEntities,
  objectVisibilityState,
} from '../../packages/paramagic-core/src/modules/ObjectVisibility.js';

function presentationNode() {
  const classes = new Set();
  const attributes = new Map();
  return {
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute: (name, value) => attributes.set(name, value),
    classes,
    attributes,
  };
}

test('Visible expressions accept booleans, default to TRUE, and reject non-booleans', () => {
  const evaluate = (expression) => ({ TRUE: true, FALSE: false, showPanel: false, count: 2 })[expression];
  assert.deepEqual(objectVisibilityState({}, evaluate), {
    value: true,
    expression: 'TRUE',
    error: null,
  });
  assert.deepEqual(objectVisibilityState({
    appearance: { visible: true, visibleExpression: 'showPanel' },
  }, evaluate), {
    value: false,
    expression: 'showPanel',
    error: null,
  });
  assert.match(evaluateVisibleExpression('count', evaluate).error, /TRUE or FALSE/);
});

test('closed-object visibility updates every boundary record and supports a presentation-only override', () => {
  const records = ['edge-a', 'edge-b'].map((id) => ({
    id,
    recordType: 'geometry',
    entity: { id, type: 'line', appearance: { fillColor: '#ffffff' } },
    group: presentationNode(),
  }));
  const selectedIds = new Set(records.map(({ id }) => id));
  const owner = {
    id: 'closed-owner',
    recordIds: records.map(({ id }) => id),
    entity: { id: 'closed-owner', type: 'polygon' },
  };
  const canvasElement = presentationNode();
  const checkpoints = [];
  const system = createObjectVisibilitySystem({
    records,
    selectedIds,
    canvasElement,
    owners: () => [owner],
    ownerForRecord: (id) => owner.recordIds.includes(id) ? owner : null,
    evaluateExpression: (expression) => ({ TRUE: true, FALSE: false, showPanel: false })[expression],
    updateEntityAppearances: (updates) => updates.map(({ id, appearance }) => ({
      ...records.find((record) => record.id === id).entity,
      appearance,
    })),
    applyChangedEntity: (entity) => {
      records.find((record) => record.id === entity.id).entity = entity;
    },
    requestHistoryCheckpoint: (reason) => checkpoints.push(reason),
  });

  assert.equal(system.selectedProperties().canEditVisible, true);
  assert.equal(system.setSelectedVisibility({ visibleExpression: 'showPanel' }).success, true);
  assert.equal(checkpoints[0], 'object-visibility-update');
  assert.equal(records.every(({ entity }) => entity.appearance.visibleExpression === 'showPanel'), true);
  assert.equal(records.every(({ entity }) => entity.appearance.visible === false), true);

  system.syncPresentation();
  assert.equal(records.every(({ group }) => group.classes.has('object-visibility-hidden')), true);
  assert.equal(selectedIds.size, 2);
  assert.equal(system.isRecordShown('edge-a'), false);

  assert.equal(system.setShowHiddenObjects(true), true);
  assert.equal(system.isRecordShown('edge-a'), true);
  assert.equal(canvasElement.classes.has('show-hidden-objects'), true);
});

test('open and construction geometry expose visibility as individual objects', () => {
  const records = [
    {
      id: 'open-line',
      recordType: 'geometry',
      entity: { id: 'open-line', type: 'line', start: [0, 0], end: [10, 0] },
      group: presentationNode(),
    },
    {
      id: 'construction-line',
      recordType: 'geometry',
      entity: { id: 'construction-line', type: 'line', start: [0, 5], end: [10, 5], construction: true },
      group: presentationNode(),
    },
  ];
  const selectedIds = new Set(records.map(({ id }) => id));
  const system = createObjectVisibilitySystem({
    records,
    selectedIds,
    evaluateExpression: (expression) => ({ TRUE: true, FALSE: false })[expression],
    updateEntityAppearances: (updates) => updates.map(({ id, appearance }) => ({
      ...records.find((record) => record.id === id).entity,
      appearance,
    })),
    applyChangedEntity: (entity) => {
      records.find((record) => record.id === entity.id).entity = entity;
    },
  });

  assert.equal(system.selectedProperties().canEditVisible, true);
  assert.equal(system.setSelectedVisibility({ visibleExpression: 'FALSE' }).success, true);
  assert.equal(records.every(({ entity }) => entity.appearance.visible === false), true);

  system.syncPresentation();
  assert.equal(records.every(({ group }) => group.classes.has('object-visibility-hidden')), true);
  assert.equal(system.isRecordShown('open-line'), false);
  assert.equal(system.isRecordShown('construction-line'), false);
});

test('additional tool-owned records expose expression-driven visibility', () => {
  const record = {
    id: 'text-label',
    recordType: 'text',
    entity: { id: 'text-label', type: 'text', text: 'Label' },
    group: presentationNode(),
  };
  const system = createObjectVisibilitySystem({
    records: [record],
    selectedIds: new Set([record.id]),
    additionalVisibilityRecord: (candidate) => candidate.recordType === 'text',
    evaluateExpression: (expression) => ({ TRUE: true, FALSE: false, showLabel: false })[expression],
    updateEntity: (entity) => entity,
    applyChangedEntity: (entity) => { record.entity = entity; },
  });

  assert.deepEqual(system.selectedProperties(), {
    canEditVisible: true,
    visible: true,
    mixedVisible: false,
    visibleExpression: 'TRUE',
    errors: { visible: null },
  });
  assert.equal(system.setSelectedVisibility({ visibleExpression: 'showLabel' }).success, true);
  assert.equal(record.entity.appearance.visibleExpression, 'showLabel');
  assert.equal(record.entity.appearance.visible, false);

  system.syncPresentation();
  assert.equal(record.group.classes.has('object-visibility-hidden'), true);
  assert.equal(system.isRecordShown(record.id), false);
});

test('thumbnail visibility follows source ownership for arrays, symmetry, seams, and Boolean results', () => {
  const drawing = {
    entities: [
      { id: 'hidden-source', appearance: { visibleExpression: 'showSource' } },
      { id: 'visible-source' },
    ],
  };
  const entities = [
    { id: 'array-copy', _thumbnailSourceId: 'hidden-source' },
    { id: 'symmetric-copy', _thumbnailSourceId: 'hidden-source' },
    {
      id: 'seam',
      composite: { kind: 'finish-size-offset', sourceFeatures: [{ recordId: 'hidden-source' }] },
    },
    {
      id: 'boolean-result',
      _thumbnailSourceIds: ['hidden-source'],
    },
    { id: 'visible-copy', _thumbnailSourceId: 'visible-source' },
  ];
  assert.deepEqual(
    filterVisibleThumbnailEntities(
      drawing,
      entities,
      (expression) => ({ showSource: false })[expression],
    ).map(({ id }) => id),
    ['visible-copy'],
  );
});
