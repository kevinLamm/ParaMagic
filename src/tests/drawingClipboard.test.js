import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAMAGIC_CLIPBOARD_FORMAT,
  createClipboardPackage,
  createDrawingContainerPackage,
  createDrawingClipboard,
  createStackSubtreePackage,
  parseClipboardPackage,
  retargetClipboardDrawing,
} from '../../packages/paramagic-core/src/modules/DrawingClipboard.js';
import {
  mergeDrawingDataWithMap,
  normalizeDrawingDataWithIdentityMap,
  serializeDrawingJson,
} from '../../packages/paramagic-core/src/modules/DrawingIO.js';
import { cloneDrawingIdentityGraph, identityAudit } from '../../packages/paramagic-core/src/modules/DrawingIdentitySystem.js';
import { withSwellDefinition } from '../../packages/paramagic-core/src/modules/SwellGeometry.js';
import { fixtureUuid } from './helpers/fixtureUuid.js';

const cid = (label) => fixtureUuid(`drawing-clipboard:${label}`);

function fixture() {
  return {
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    filletRadius: 5,
    entities: [
      { id: cid('a'), type: 'line', start: [0, 0], end: [20, 0], stackId: cid('stack-a') },
      { id: cid('b'), type: 'line', start: [20, 0], end: [20, 20], stackId: cid('stack-a') },
      { id: cid('outside'), type: 'line', start: [50, 0], end: [60, 0], stackId: cid('stack-b') },
      { id: cid('fillet'), type: 'fillet', sourceA: { recordId: cid('a'), index: 2 }, sourceB: { recordId: cid('b'), index: 0 }, radius: 2, stackId: cid('stack-a') },
      { id: cid('notch'), type: 'notch', host: { recordId: cid('a'), kind: 'segment', index: 0 }, stackId: cid('stack-a') },
      {
        id: cid('seam'), type: 'line', start: [0, 2], end: [18, 2], stackId: cid('stack-a'),
        composite: { kind: 'finish-size-offset', sourceFeatures: [{ recordId: cid('a'), kind: 'segment', index: 0 }] },
      },
      {
        id: cid('mirror'), type: 'line', start: [30, -10], end: [30, 30], construction: true, stackId: cid('stack-a'),
        composite: { kind: 'symmetric-centerline', sourceIds: [cid('a'), cid('b')] },
      },
      {
        id: cid('control'), type: 'control', controlType: 'checkbox', x: 2, y: 2,
        parameterId: cid('parameter-control'), parameterName: 'c1', stackId: cid('stack-a'),
      },
      { id: cid('cutter'), type: 'circle', center: [10, 0], radius: 3, subtract: true, subtractExpression: 'TRUE', stackId: cid('stack-a') },
    ],
    constraints: [
      { id: cid('constraint-inside'), type: 'Coincident', featureRefs: [{ recordId: cid('a') }, { recordId: cid('b') }] },
      { id: cid('constraint-outside'), type: 'Coincident', featureRefs: [{ recordId: cid('a') }, { recordId: cid('outside') }] },
    ],
    parameters: [
      { id: cid('parameter-control'), name: 'c1', kind: 'control', expression: 'TRUE', order: 0 },
      { id: cid('parameter-user'), name: 'spacing', kind: 'parameter', expression: '25', order: 1 },
      { id: cid('dimension-1'), name: 'd1', kind: 'dimension', expression: 'spacing', order: 2 },
    ],
    dimensionAnnotations: [{
      id: cid('annotation-1'), dimensionId: cid('dimension-1'), type: 'dimension-line',
      anchors: { start: { recordId: cid('a') }, end: { recordId: cid('b') } },
      start: [0, -4], end: [20, -4], stackId: cid('stack-a'),
    }],
    extensions: {
      arrayTools: {
        version: 3,
        arrays: [{
          id: cid('array-1'), arrayType: 'rectangular', sourceIds: [cid('a'), cid('b')],
          rowCountExpression: '2', columnCountExpression: 'spacing', stackId: cid('stack-a'),
        }],
      },
      stacks: { version: 2, activeStackId: cid('stack-a'), stacks: [
        { id: cid('stack-a'), name: 'A', systemRole: 'default-stack' },
        { id: cid('stack-b'), name: 'B' },
      ] },
    },
  };
}

test('clipboard package closes native and array feature dependencies but excludes unrelated objects', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: [cid('a'), cid('b')] });
  const ids = new Set(packageValue.drawing.entities.map(({ id }) => id));
  assert.equal(packageValue.format, PARAMAGIC_CLIPBOARD_FORMAT);
  assert.deepEqual(ids, new Set(['a', 'b', 'fillet', 'notch', 'seam'].map(cid)));
  assert.deepEqual(packageValue.drawing.constraints.map(({ id }) => id), [cid('constraint-inside')]);
  assert.deepEqual(packageValue.drawing.dimensionAnnotations.map(({ id }) => id), [cid('annotation-1')]);
  assert.deepEqual(packageValue.drawing.parameters.map(({ name }) => name), ['spacing', 'd1']);
  assert.equal(packageValue.drawing.extensions.stacks.activeStackId, cid('stack-a'));
  assert.deepEqual(packageValue.drawing.extensions.arrayTools.arrays.map(({ id }) => id), [cid('array-1')]);
});

test('copying only part of an array source does not create an incomplete array', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: [cid('a')] });
  assert.equal(packageValue.drawing.extensions?.arrayTools, undefined);
});

test('copying a symmetric group includes its centerline, sources, and source-owned features', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: [cid('mirror')] });
  assert.deepEqual(
    new Set(packageValue.drawing.entities.map(({ id }) => id)),
    new Set(['mirror', 'a', 'b', 'fillet', 'notch', 'seam'].map(cid)),
  );
});

test('copying an array includes its definition, sources, center dependencies, and expressions', () => {
  const packageValue = createClipboardPackage(fixture(), { arrayIds: [cid('array-1')] });
  assert.deepEqual(packageValue.drawing.extensions.arrayTools.arrays.map(({ id }) => id), [cid('array-1')]);
  assert.equal(packageValue.drawing.entities.some(({ id }) => id === cid('a')), true);
  assert.equal(packageValue.drawing.entities.some(({ id }) => id === cid('b')), true);
  assert.equal(packageValue.drawing.parameters.some(({ name }) => name === 'spacing'), true);
});

test('clipboard parameter closure uses spaced global names and the local Stack dimension identity', () => {
  const snapshot = fixture();
  snapshot.stackArchitectureVersion = 2;
  snapshot.entities.find(({ id }) => id === cid('a')).visibleExpression = 'panel width > d1';
  snapshot.parameters = [
    { id: cid('panel'), name: 'panel', kind: 'parameter', expression: '99', order: 0 },
    { id: cid('panel-width'), name: 'panel width', kind: 'parameter', expression: '25', order: 1 },
    { id: cid('dimension-a'), name: 'd1', kind: 'dimension', expression: 'panel width', stackId: cid('stack-a'), order: 2 },
    { id: cid('dimension-b'), name: 'd1', kind: 'dimension', expression: '40', stackId: cid('stack-b'), order: 3 },
  ];
  snapshot.dimensionAnnotations = [{
    id: cid('annotation-a'),
    dimensionId: cid('dimension-a'),
    type: 'dimension-line',
    anchors: { start: { recordId: cid('a') }, end: { recordId: cid('b') } },
    stackId: cid('stack-a'),
  }];

  const copied = createClipboardPackage(snapshot, { entityIds: [cid('a'), cid('b')] }).drawing;

  assert.deepEqual(
    copied.parameters.map(({ id }) => id),
    [cid('panel-width'), cid('dimension-a')],
  );
});

test('copying one explicit array does not pull in sibling arrays that share its sources', () => {
  const snapshot = fixture();
  snapshot.extensions.arrayTools.arrays.push({
    ...snapshot.extensions.arrayTools.arrays[0],
    id: cid('array-2'),
    rowCountExpression: '3',
  });
  const packageValue = createClipboardPackage(snapshot, { arrayIds: [cid('array-1')] });
  assert.deepEqual(packageValue.drawing.extensions.arrayTools.arrays.map(({ id }) => id), [cid('array-1')]);
});

test('linked duplicate and symmetric groups copy their definitions and parent geometry', () => {
  const snapshot = fixture();
  snapshot.extensions.linkedCopyTools = {
    version: 1,
    copies: [
      { id: cid('duplicate-1'), type: 'duplicate', sourceIds: [cid('a'), cid('b')], anchor: [40, 40], linear: { a: 1, b: 0, c: 0, d: 1 }, stackId: cid('stack-a') },
      { id: cid('symmetric-1'), type: 'symmetric', sourceIds: [cid('outside')], anchor: [-40, 40], linear: { a: -1, b: 0, c: 0, d: 1 }, stackId: cid('stack-b') },
    ],
  };
  const packageValue = createClipboardPackage(snapshot, { linkedCopyIds: [cid('duplicate-1')] });

  assert.deepEqual(packageValue.drawing.extensions.linkedCopyTools.copies.map(({ id }) => id), [cid('duplicate-1')]);
  assert.equal(packageValue.drawing.entities.some(({ id }) => id === cid('a')), true);
  assert.equal(packageValue.drawing.entities.some(({ id }) => id === cid('b')), true);
  assert.equal(packageValue.drawing.entities.some(({ id }) => id === cid('outside')), false);
  const retargeted = retargetClipboardDrawing(packageValue, cid('stack-destination'));
  assert.equal(retargeted.extensions.linkedCopyTools.copies[0].stackId, cid('stack-destination'));
});

test('control copy includes its control parameter and subtract state remains native JSON', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: [cid('control'), cid('cutter')] });
  assert.deepEqual(packageValue.drawing.parameters.map(({ name }) => name), ['c1']);
  assert.equal(packageValue.drawing.entities.find(({ id }) => id === cid('cutter')).subtract, true);
});

test('copying a closed object carries Seam Line intent without generated geometry', () => {
  const snapshot = {
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    entities: [{ id: cid('shape'), type: 'rect', x: 0, y: 0, width: 100, height: 80 }],
    constraints: [],
    parameters: [],
    dimensionAnnotations: [],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ id: cid('seam-definition'), regionId: cid('shape'), recordIds: [cid('shape')], defaultEnabled: true, overrides: [] }],
      },
    },
  };
  const copied = createClipboardPackage(snapshot, { entityIds: [cid('shape')] }).drawing;
  assert.equal(copied.entities.length, 1);
  assert.equal(copied.entities.some((entity) => entity.composite?.kind === 'finish-size-offset'), false);
  assert.equal(copied.extensions.seamLines.definitions[0].regionId, cid('shape'));
});

test('copying Swell geometry retains its source definition so full derived geometry regenerates on paste', () => {
  const source = withSwellDefinition({
    id: cid('swell-source'),
    type: 'line',
    start: [0, 0],
    end: [100, 0],
    stackId: cid('stack-a'),
  }, {
    enabled: true,
    offsetExpression: '5',
    swellOffsetExpression: '15',
    startTransitionExpression: '20',
    endTransitionExpression: '20',
  });
  const copied = createClipboardPackage({
    drawingUnit: 'mm',
    entities: [source],
    constraints: [],
    parameters: [],
    dimensionAnnotations: [],
  }, { entityIds: [source.id] }).drawing;

  assert.equal(copied.entities.length, 1);
  assert.equal(copied.entities[0].construction, true);
  assert.deepEqual(copied.entities[0].composite.swell, source.composite.swell);
  assert.equal(copied.entities.some(({ composite }) => composite?.kind === 'swell-derived-presentation'), false);
});

test('paste retargets every copied object and array to the destination stack', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: [cid('mirror')], arrayIds: [cid('array-1')] });
  const drawing = retargetClipboardDrawing(packageValue, cid('stack-destination'));
  assert.equal(drawing.entities.every(({ stackId }) => stackId === cid('stack-destination')), true);
  assert.equal(drawing.dimensionAnnotations.every(({ stackId }) => stackId === cid('stack-destination')), true);
  assert.equal(drawing.extensions.arrayTools.arrays.every(({ stackId }) => stackId === cid('stack-destination')), true);
  assert.equal(drawing.extensions.stacks.activeStackId, cid('stack-destination'));
  assert.equal(drawing.extensions.stacks.stacks.some(({ id, systemRole }) => id === cid('stack-destination') && systemRole === 'default-stack'), true);
  assert.equal(parseClipboardPackage(JSON.stringify(packageValue)).format, PARAMAGIC_CLIPBOARD_FORMAT);
});

test('paste preserves an array inferred from copied source geometry and remaps its ownership', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: [cid('a'), cid('b')] });
  const inserted = retargetClipboardDrawing(packageValue, cid('stack-destination'));
  const { drawing, idMap } = mergeDrawingDataWithMap({
    entities: [{ id: 'existing', type: 'line', start: [100, 0], end: [110, 0] }],
    constraints: [],
    parameters: [{ id: 'existing-spacing', name: 'spacing', kind: 'parameter', expression: '10' }],
    dimensionAnnotations: [],
    extensions: { stacks: {
      activeStackId: cid('stack-destination'),
      stacks: [
        { id: cid('base-default'), name: 'Default', systemRole: 'default-stack' },
        { id: cid('stack-destination'), name: 'Destination' },
      ],
    } },
  }, inserted, { inheritControlParameters: false, targetStackId: cid('stack-destination') });
  const pastedArray = drawing.extensions.arrayTools.arrays[0];

  assert.notEqual(pastedArray.id, cid('array-1'));
  assert.deepEqual(pastedArray.sourceIds, [idMap.get(cid('a')), idMap.get(cid('b'))]);
  assert.equal(pastedArray.stackId, cid('stack-destination'));
  assert.equal(pastedArray.columnCountExpression, 'spacing');
  assert.equal(drawing.entities.some(({ id }) => id === pastedArray.sourceIds[0]), true);
  assert.equal(drawing.entities.some(({ id }) => id === pastedArray.sourceIds[1]), true);
});

test('paste renames a conflicting local dimension and rewrites bare expressions in the destination Stack', () => {
  const snapshot = fixture();
  snapshot.stackArchitectureVersion = 2;
  snapshot.entities.find(({ id }) => id === cid('a')).visibleExpression = 'd1 > 0';
  snapshot.parameters = [{
    id: cid('dimension-a'), name: 'd1', kind: 'dimension', expression: '20', stackId: cid('stack-a'), order: 0,
  }];
  snapshot.dimensionAnnotations = [{
    id: cid('annotation-a'), dimensionId: cid('dimension-a'), type: 'dimension-line',
    anchors: { start: { recordId: cid('a') }, end: { recordId: cid('b') } }, stackId: cid('stack-a'),
  }];
  const packageValue = createClipboardPackage(snapshot, { entityIds: [cid('a'), cid('b')] });
  const targetStacks = {
    version: 2,
    activeStackId: cid('stack-destination'),
    stacks: [
      { id: cid('stack-default'), name: 'Default', systemRole: 'default-stack' },
      { id: cid('stack-destination'), name: 'Destination' },
    ],
  };
  const inserted = retargetClipboardDrawing(packageValue, cid('stack-destination'), targetStacks);
  const { drawing, idMap } = mergeDrawingDataWithMap({
    stackArchitectureVersion: 2,
    entities: [],
    constraints: [],
    parameters: [{
      id: cid('existing-dimension'), name: 'd1', kind: 'dimension', expression: '10', stackId: cid('stack-destination'), order: 0,
    }],
    dimensionAnnotations: [],
    extensions: { stacks: targetStacks },
  }, inserted, { inheritControlParameters: false, targetStackId: cid('stack-destination') });

  assert.equal(drawing.parameters.find(({ id }) => id === idMap.get(cid('dimension-a'))).name, 'd2');
  assert.equal(drawing.entities.find(({ id }) => id === idMap.get(cid('a'))).visibleExpression, 'd2 > 0');
});

test('cross-Stack paste qualifies source-only dimensions and allocates sequential destination handles', () => {
  const source = {
    stackArchitectureVersion: 2,
    entities: [
      {
        id: 'copied-a', type: 'line', start: [0, 0], end: [20, 0], stackId: 'source-stack',
        visibleExpression: 'd20 > d1 && d1@Original Stack > 0',
      },
      { id: 'copied-b', type: 'line', start: [20, 0], end: [20, 20], stackId: 'source-stack' },
      { id: 'source-only-a', type: 'line', start: [50, 0], end: [60, 0], stackId: 'source-stack' },
      { id: 'source-only-b', type: 'line', start: [60, 0], end: [60, 10], stackId: 'source-stack' },
    ],
    parameters: [
      { id: 'source-d1', name: 'd1', kind: 'dimension', expression: '10', stackId: 'source-stack', order: 0 },
      { id: 'source-d16', name: 'd16', kind: 'dimension', expression: 'D1 + 5', stackId: 'source-stack', order: 1 },
      { id: 'source-d20', name: 'd20', kind: 'dimension', expression: 'd16 + d1', stackId: 'source-stack', order: 2 },
    ],
    constraints: [
      {
        id: 'constraint-d1', type: 'Distance', source: 'dimension', dimensionRef: 'source-d1', stackId: 'source-stack',
        featureRefs: [{ recordId: 'source-only-a' }, { recordId: 'source-only-b' }],
      },
      {
        id: 'constraint-d16', type: 'Distance', source: 'dimension', dimensionRef: 'source-d16', stackId: 'source-stack',
        featureRefs: [{ recordId: 'copied-a' }, { recordId: 'copied-b' }],
      },
      {
        id: 'constraint-d20', type: 'Distance', source: 'dimension', dimensionRef: 'source-d20', stackId: 'source-stack',
        featureRefs: [{ recordId: 'copied-a' }, { recordId: 'copied-b' }],
      },
    ],
    dimensionAnnotations: [
      {
        id: 'annotation-d1', dimensionId: 'source-d1', dimensionName: 'd1', type: 'distance-dimension', stackId: 'source-stack',
        featureRefs: [{ recordId: 'source-only-a' }, { recordId: 'source-only-b' }],
      },
      {
        id: 'annotation-d16', dimensionId: 'source-d16', dimensionName: 'd16', type: 'distance-dimension', stackId: 'source-stack',
        featureRefs: [{ recordId: 'copied-a' }, { recordId: 'copied-b' }],
      },
      {
        id: 'annotation-d20', dimensionId: 'source-d20', dimensionName: 'd20', type: 'distance-dimension', stackId: 'source-stack',
        featureRefs: [{ recordId: 'copied-a' }, { recordId: 'copied-b' }],
      },
    ],
    extensions: {
      stacks: {
        version: 2,
        activeStackId: 'source-stack',
        stacks: [
          { id: 'source-stack', name: 'Original Stack' },
          { id: 'destination-stack', name: 'Destination Stack' },
        ],
      },
    },
  };
  const normalizedSource = normalizeDrawingDataWithIdentityMap(source);
  const sourceDrawing = normalizedSource.drawing;
  const sid = (legacyId) => normalizedSource.idMap.get(legacyId);
  const packageValue = createClipboardPackage(sourceDrawing, { entityIds: [sid('copied-a'), sid('copied-b')] });

  assert.deepEqual(packageValue.drawing.parameters.map(({ name }) => name), ['d16', 'd20']);
  assert.equal(packageValue.drawing.parameters.find(({ name }) => name === 'd16').expression, 'd1@Original Stack + 5');
  assert.equal(packageValue.drawing.parameters.find(({ name }) => name === 'd20').expression, 'd16 + d1@Original Stack');
  assert.equal(packageValue.drawing.entities.find(({ id }) => id === sid('copied-a')).visibleExpression, 'd20 > d1@Original Stack && d1@Original Stack > 0');
  assert.deepEqual(packageValue.externalDimensionReferences.map(({ dimensionId, displayName }) => ({ dimensionId, displayName })), [
    { dimensionId: sid('source-d1'), displayName: 'd1@Original Stack' },
  ]);

  const sameStackInserted = retargetClipboardDrawing(
    packageValue,
    sid('source-stack'),
    sourceDrawing.extensions.stacks,
  );
  const sameStackPaste = mergeDrawingDataWithMap(sourceDrawing, sameStackInserted, {
    inheritControlParameters: false,
    targetStackId: sid('source-stack'),
  });
  const sameStackD16 = sameStackPaste.drawing.parameters.find(({ id }) => id === sameStackPaste.idMap.get(sid('source-d16')));
  const sameStackD20 = sameStackPaste.drawing.parameters.find(({ id }) => id === sameStackPaste.idMap.get(sid('source-d20')));
  assert.deepEqual([sameStackD16.name, sameStackD20.name], ['d2', 'd3']);
  assert.equal(sameStackD16.expression, 'd1 + 5');
  assert.equal(sameStackD20.expression, 'd2 + d1');
  assert.equal(
    sameStackPaste.drawing.entities.find(({ id }) => id === sameStackPaste.idMap.get(sid('copied-a'))).visibleExpression,
    'd3 > d1 && d1 > 0',
  );

  const inserted = retargetClipboardDrawing(
    packageValue,
    sid('destination-stack'),
    sourceDrawing.extensions.stacks,
  );
  const firstPaste = mergeDrawingDataWithMap(sourceDrawing, inserted, {
    inheritControlParameters: false,
    targetStackId: sid('destination-stack'),
  });
  const pastedD16Id = firstPaste.idMap.get(sid('source-d16'));
  const pastedD20Id = firstPaste.idMap.get(sid('source-d20'));
  const pastedD16 = firstPaste.drawing.parameters.find(({ id }) => id === pastedD16Id);
  const pastedD20 = firstPaste.drawing.parameters.find(({ id }) => id === pastedD20Id);

  assert.notEqual(pastedD16Id, sid('source-d16'));
  assert.notEqual(pastedD20Id, sid('source-d20'));
  assert.deepEqual([pastedD16.name, pastedD20.name], ['d1', 'd2']);
  assert.equal(pastedD16.expression, 'd1@Original Stack + 5');
  assert.equal(pastedD20.expression, 'd1 + d1@Original Stack');
  assert.equal(
    firstPaste.drawing.entities.find(({ id }) => id === firstPaste.idMap.get(sid('copied-a'))).visibleExpression,
    'd2 > d1@Original Stack && d1@Original Stack > 0',
  );
  assert.equal(
    firstPaste.drawing.constraints.find(({ id }) => id === firstPaste.idMap.get(sid('constraint-d16'))).dimensionRef,
    pastedD16Id,
  );
  assert.equal(
    firstPaste.drawing.dimensionAnnotations.find(({ id }) => id === firstPaste.idMap.get(sid('annotation-d16'))).dimensionId,
    pastedD16Id,
  );

  const secondPaste = mergeDrawingDataWithMap(firstPaste.drawing, inserted, {
    inheritControlParameters: false,
    targetStackId: sid('destination-stack'),
  });
  assert.deepEqual(
    ['source-d16', 'source-d20'].map((id) => secondPaste.drawing.parameters.find(({ id: candidateId }) => candidateId === secondPaste.idMap.get(sid(id))).name),
    ['d3', 'd4'],
  );
});

test('separately inserted Stacks reactivate a complete cross-Stack dimension without duplicating its local symbol', () => {
  const source = {
    stackArchitectureVersion: 2,
    entities: [
      {
        id: 'front-line', type: 'line', start: [0, 0], end: [10, 0],
        stackId: 'source-front', visibleExpression: 'Global Ref > 0',
      },
      { id: 'back-line', type: 'line', start: [0, 10], end: [10, 10], stackId: 'source-back' },
    ],
    parameters: [
      {
        id: 'cross-dimension', sourceDimensionId: 'cross-dimension', name: 'd1', kind: 'dimension',
        expression: '10', value: 10, driving: true, stackId: 'source-front', participantStackIds: ['source-back'],
      },
      { id: 'global-ref', name: 'Global Ref', kind: 'user', expression: 'd1@Front + 1', value: 11 },
    ],
    constraints: [{
      id: 'cross-distance', sourceRelationshipId: 'cross-distance', type: 'Distance', source: 'dimension',
      dimensionRef: 'cross-dimension', stackId: 'source-front', participantStackIds: ['source-back'],
      featureRefs: [
        { kind: 'point', recordId: 'front-line', index: 0 },
        { kind: 'point', recordId: 'back-line', index: 0 },
      ],
    }],
    dimensionAnnotations: [{
      id: 'cross-annotation', sourceRelationshipId: 'cross-dimension', dimensionId: 'cross-dimension',
      dimensionName: 'd1', type: 'distance-dimension', stackId: 'source-front', participantStackIds: ['source-back'],
      featureRefs: [
        { kind: 'point', recordId: 'front-line', index: 0 },
        { kind: 'point', recordId: 'back-line', index: 0 },
      ],
    }],
    extensions: {
      stacks: {
        version: 2,
        activeStackId: 'source-front',
        stacks: [
          { id: 'source-front', sourceStackId: 'source-front', name: 'Front' },
          { id: 'source-back', sourceStackId: 'source-back', name: 'Back' },
        ],
      },
    },
  };
  const normalizedSource = normalizeDrawingDataWithIdentityMap(source);
  const sourceDrawing = normalizedSource.drawing;
  const sid = (legacyId) => normalizedSource.idMap.get(legacyId);
  const frontPackage = createClipboardPackage(sourceDrawing, { entityIds: [sid('front-line')], label: 'Front' });
  const backPackage = createClipboardPackage(sourceDrawing, { entityIds: [sid('back-line')], label: 'Back' });
  assert.equal(frontPackage.drawing.parameters.some(({ kind }) => kind === 'dimension'), false);
  assert.equal(frontPackage.drawing.parameters.some(({ name }) => name === 'Global Ref'), true);
  assert.equal(frontPackage.drawing.parameters.find(({ name }) => name === 'Global Ref').expression, 'd1@Front + 1');
  assert.equal(frontPackage.drawing.extensions.stackRelationships.templates.filter(({ type }) => type === 'dimension').length, 1);
  const parsedFront = parseClipboardPackage(frontPackage);
  assert.equal(parsedFront.drawing.parameters.find(({ name }) => name === 'Global Ref').expression, 'd1@Front + 1');
  assert.equal(parsedFront.drawing.extensions.stackRelationships.templates.filter(({ type }) => type === 'dimension').length, 1);
  assert.equal(parsedFront.drawing.parameters.some(({ kind }) => kind === 'dimension'), false);
  assert.equal(parsedFront.drawing.extensions.stackRelationships.templates.find(({ type }) => type === 'dimension').payload.parameter.name, 'd1');

  const frontState = {
    activeStackId: cid('front-live-stack'),
    stacks: [
      { id: cid('stack-default-live'), name: 'Default', systemRole: 'default-stack' },
      { id: cid('front-live-stack'), name: 'Front Imported' },
    ],
  };
  const retargetedFront = retargetClipboardDrawing(frontPackage, cid('front-live-stack'), frontState);
  assert.equal(retargetedFront.parameters.find(({ name }) => name === 'Global Ref').expression, 'd1@Front Imported + 1');
  let drawing = mergeDrawingDataWithMap(
    { extensions: { stacks: frontState } },
    retargetedFront,
    { inheritControlParameters: false, targetStackId: cid('front-live-stack') },
  ).drawing;
  assert.equal(drawing.parameters.some(({ kind }) => kind === 'dimension'), false);
  assert.equal(drawing.parameters.find(({ name }) => name === 'Global Ref').expression, 'd1@Front Imported + 1');

  const insertBack = (stackId, name) => {
    const state = {
      ...drawing.extensions.stacks,
      activeStackId: stackId,
      stacks: [...drawing.extensions.stacks.stacks, { id: stackId, name }],
    };
    drawing = {
      ...drawing,
      extensions: { ...drawing.extensions, stacks: state },
    };
    drawing = mergeDrawingDataWithMap(
      drawing,
      retargetClipboardDrawing(backPackage, stackId, state),
      { inheritControlParameters: false, targetStackId: stackId },
    ).drawing;
  };
  insertBack(cid('back-live-stack-1'), 'Back Imported');
  assert.deepEqual(
    drawing.parameters.filter(({ kind, stackId }) => kind === 'dimension' && stackId === cid('front-live-stack')).map(({ name }) => name),
    ['d1'],
  );
  assert.equal(drawing.constraints.filter(({ source }) => source === 'dimension').length, 1);
  assert.equal(drawing.constraints.find(({ source }) => source === 'dimension').dimensionRef, drawing.dimensionAnnotations[0].dimensionId);

  insertBack(cid('back-live-stack-2'), 'Back Imported(1)');
  assert.deepEqual(
    drawing.parameters.filter(({ kind, stackId }) => kind === 'dimension' && stackId === cid('front-live-stack')).map(({ name }) => name),
    ['d1', 'd2'],
  );
  assert.equal(drawing.constraints.filter(({ source }) => source === 'dimension').length, 2);
  assert.equal(drawing.parameters.find(({ name }) => name === 'Global Ref').expression, 'd1@Front Imported + 1');
});

test('Stack Save As package contains only the selected Stack and its dependencies', () => {
  const snapshot = fixture();
  const canvas = {
    getSelectedRecordIds: () => [],
    getActiveStackId: () => cid('stack-a'),
    getDrawingData: () => snapshot,
    getStackState: () => ({
      activeStackId: cid('stack-a'),
      stacks: [
        { id: cid('stack-a'), name: 'A', systemRole: 'default-stack' },
        { id: cid('stack-b'), name: 'B' },
      ],
    }),
  };
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {} };
  try {
    const clipboard = createDrawingClipboard({ canvas });
    const packageValue = clipboard.packageForStack(cid('stack-a'));
    assert.equal(packageValue.drawing.entities.some(({ id }) => id === cid('outside')), false);
    assert.equal(packageValue.drawing.entities.every(({ stackId }) => stackId === cid('stack-a')), true);
    assert.deepEqual(packageValue.drawing.extensions.arrayTools.arrays.map(({ id }) => id), [cid('array-1')]);
    const standaloneSource = retargetClipboardDrawing(packageValue);
    const standalone = cloneDrawingIdentityGraph(standaloneSource).drawing;
    const audit = identityAudit(standalone);
    assert.equal(audit.valid, true, JSON.stringify(audit.errors));
    assert.doesNotThrow(() => serializeDrawingJson(standalone, 'Saved Stack'));
    assert.equal(
      JSON.parse(serializeDrawingJson(cloneDrawingIdentityGraph(packageValue.drawing).drawing, 'Saved Stack'))
        .documentContext.contentKind,
      'stack-export',
    );
    assert.equal(
      standalone.entities.some(({ id }) => packageValue.drawing.entities.some((source) => source.id === id)),
      false,
    );
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('disabled Cut and Copy commands do not inspect or mutate the canvas selection', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {} };
  const disabledButton = { disabled: true, addEventListener() {} };
  const canvas = {
    getSelectedRecordIds() {
      throw new Error('Disabled clipboard commands must not inspect the canvas selection.');
    },
  };
  try {
    const clipboard = createDrawingClipboard({
      canvas,
      cutButton: disabledButton,
      copyButton: disabledButton,
    });
    assert.equal(await clipboard.cut(), false);
    assert.equal(await clipboard.copy(), false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('Drawing container Save As exports its child Stack tree without the container wrapper', () => {
  const containerId = cid('export-container');
  const rootId = cid('export-container-root');
  const childId = cid('export-container-child');
  const defaultId = cid('export-container-default');
  const packageValue = createDrawingContainerPackage({
    drawingId: cid('export-container-drawing'),
    entities: [
      { id: cid('export-container-line'), type: 'line', start: [0, 0], end: [1, 0], stackId: childId },
    ],
    extensions: { stacks: { version: 4, activeStackId: defaultId, stacks: [
      { id: defaultId, name: 'Default', systemRole: 'default-stack' },
      { id: containerId, kind: 'drawing', name: 'Imported Drawing', sourceDrawingId: cid('export-source-drawing') },
      { id: rootId, name: 'Imported Default', parentStackId: containerId },
      { id: childId, name: 'Rail', parentStackId: rootId },
    ] } },
  }, containerId);
  const exportedState = packageValue.drawing.extensions.stacks;
  assert.equal(packageValue.drawing.documentContext.contentKind, 'drawing');
  assert.equal(exportedState.stacks.some(({ id }) => id === containerId), false);
  assert.deepEqual(exportedState.stacks.map(({ id }) => id), [rootId, childId]);
  assert.equal(exportedState.stacks[0].parentStackId, null);
  assert.equal(exportedState.stacks[1].parentStackId, rootId);
});

test('Stack Save As packages the complete descendant tree without pulling in ancestors or siblings', () => {
  const rootId = cid('subtree-root');
  const childId = cid('subtree-child');
  const grandchildId = cid('subtree-grandchild');
  const outsideId = cid('subtree-outside');
  const defaultId = cid('subtree-default');
  const drawing = {
    entities: [
      { id: cid('subtree-root-line'), type: 'line', start: [0, 0], end: [10, 0], stackId: rootId },
      { id: cid('subtree-child-line'), type: 'line', start: [0, 5], end: [10, 5], stackId: childId },
      { id: cid('subtree-grandchild-line'), type: 'line', start: [0, 10], end: [10, 10], stackId: grandchildId },
      { id: cid('subtree-outside-line'), type: 'line', start: [0, 20], end: [10, 20], stackId: outsideId },
    ],
    extensions: { stacks: { version: 3, activeStackId: rootId, stacks: [
      { id: defaultId, name: 'Default', systemRole: 'default-stack' },
      { id: rootId, name: 'Assembly' },
      { id: childId, name: 'Support', parentStackId: rootId },
      { id: grandchildId, name: 'Fastener', parentStackId: childId },
      { id: outsideId, name: 'Outside' },
    ] } },
  };
  const packageValue = createStackSubtreePackage(drawing, rootId);
  const stackState = packageValue.drawing.extensions.stacks;

  assert.deepEqual(stackState.stacks.map(({ id }) => id), [rootId, childId, grandchildId]);
  assert.equal(stackState.stacks[0].parentStackId, null);
  assert.equal(stackState.stacks[1].parentStackId, rootId);
  assert.equal(stackState.stacks[2].parentStackId, childId);
  assert.deepEqual(new Set(packageValue.drawing.entities.map(({ stackId }) => stackId)), new Set([rootId, childId, grandchildId]));
  assert.equal(packageValue.drawing.entities.some(({ stackId }) => stackId === outsideId), false);
  assert.equal(packageValue.drawing.documentContext.contentKind, 'stack-export');
  assert.equal(packageValue.drawing.documentContext.displayName, 'Assembly');
});

test('Stack Insert wraps an ordinary full drawing in a drawing container', async () => {
  let pastedDrawing = null;
  let pasteOptions = null;
  const canvas = {
    getSelectedRecordIds: () => [],
    getActiveStackId: () => 'stack-default',
    requestHistoryCheckpoint() {},
    pasteDrawingData: (drawing, options) => {
      pastedDrawing = drawing;
      pasteOptions = options;
      return { count: drawing.entities.length };
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {} };
  try {
    const clipboard = createDrawingClipboard({ canvas });
    const result = await clipboard.importStack({
      name: 'Saved Stack.json',
      text: async () => JSON.stringify({
        format: 'ParaMagic Drawing',
        version: 2,
        entities: [{ id: 'line-a', type: 'line', stackId: 'stack-default', x1: 0, y1: 0, x2: 1, y2: 1 }],
      }),
    });
    assert.deepEqual(result, { count: 1 });
    const importedRoot = pastedDrawing.extensions.stacks.stacks.find(({ systemRole }) => systemRole === 'default-stack');
    assert.equal(importedRoot.name, 'Default');
    assert.equal(pastedDrawing.entities[0].stackId, importedRoot.id);
    assert.deepEqual(pasteOptions, {
      insertParentStackId: null,
      insertAsDrawing: true,
      drawingContainerName: 'Saved Stack',
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('Stack Insert inserts a marked Stack export directly without a drawing container', async () => {
  let pastedDrawing = null;
  let pasteOptions = null;
  const canvas = {
    getSelectedRecordIds: () => [],
    getActiveStackId: () => null,
    requestHistoryCheckpoint() {},
    pasteDrawingData: (drawing, options) => {
      pastedDrawing = drawing;
      pasteOptions = options;
      return { count: drawing.entities.length };
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {} };
  try {
    const clipboard = createDrawingClipboard({ canvas });
    await clipboard.importStack({
      name: 'Saved Stack.paramagic',
      text: async () => JSON.stringify({
        format: 'ParaMagic Drawing',
        version: 4,
        documentContext: { contentKind: 'stack-export', displayName: 'Saved Stack' },
        entities: [{ id: 'line-a', type: 'line', stackId: 'stack-default', x1: 0, y1: 0, x2: 1, y2: 1 }],
      }),
    });
    const importedRoot = pastedDrawing.extensions.stacks.stacks.find(({ systemRole }) => systemRole === 'default-stack');
    assert.equal(importedRoot.name, 'Saved Stack');
    assert.equal(pasteOptions.insertAsDrawing, false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('table cell clipboard takes precedence over drawing-object paste', async () => {
  let pastedText = null;
  const canvas = {
    getSelectedRecordIds: () => ['table-1'],
    getActiveStackId: () => 'stack-default',
    copySelectedTableCells: () => ({ text: 'cell contents', recordId: 'table-1' }),
    pasteSelectedTableCell: (text) => {
      pastedText = text;
      return { handled: true, changed: true, recordId: 'table-1' };
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {} };
  try {
    const clipboard = createDrawingClipboard({ canvas });
    assert.equal(await clipboard.copy(), true);
    const result = await clipboard.paste();
    assert.deepEqual(result, { handled: true, changed: true, recordId: 'table-1' });
    assert.equal(pastedText, 'cell contents');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
