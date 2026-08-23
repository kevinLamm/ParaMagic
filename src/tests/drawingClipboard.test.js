import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAMAGIC_CLIPBOARD_FORMAT,
  createClipboardPackage,
  createDrawingClipboard,
  parseClipboardPackage,
  retargetClipboardDrawing,
} from '../../packages/paramagic-core/src/modules/DrawingClipboard.js';
import { mergeDrawingDataWithMap } from '../../packages/paramagic-core/src/modules/DrawingIO.js';

function fixture() {
  return {
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    filletRadius: 5,
    entities: [
      { id: 'a', type: 'line', start: [0, 0], end: [20, 0], stackId: 'stack-a' },
      { id: 'b', type: 'line', start: [20, 0], end: [20, 20], stackId: 'stack-a' },
      { id: 'outside', type: 'line', start: [50, 0], end: [60, 0], stackId: 'stack-b' },
      { id: 'fillet', type: 'fillet', sourceA: { recordId: 'a', index: 2 }, sourceB: { recordId: 'b', index: 0 }, radius: 2, stackId: 'stack-a' },
      { id: 'notch', type: 'notch', host: { recordId: 'a', kind: 'segment', index: 0 }, stackId: 'stack-a' },
      {
        id: 'seam', type: 'line', start: [0, 2], end: [18, 2], stackId: 'stack-a',
        composite: { kind: 'finish-size-offset', sourceFeatures: [{ recordId: 'a', kind: 'segment', index: 0 }] },
      },
      {
        id: 'mirror', type: 'line', start: [30, -10], end: [30, 30], construction: true, stackId: 'stack-a',
        composite: { kind: 'symmetric-centerline', sourceIds: ['a', 'b'] },
      },
      {
        id: 'control', type: 'control', controlType: 'checkbox', x: 2, y: 2,
        parameterId: 'parameter-control', parameterName: 'c1', stackId: 'stack-a',
      },
      { id: 'cutter', type: 'circle', center: [10, 0], radius: 3, subtract: true, subtractExpression: 'TRUE', stackId: 'stack-a' },
    ],
    constraints: [
      { id: 'constraint-inside', type: 'Coincident', featureRefs: [{ recordId: 'a' }, { recordId: 'b' }] },
      { id: 'constraint-outside', type: 'Coincident', featureRefs: [{ recordId: 'a' }, { recordId: 'outside' }] },
    ],
    parameters: [
      { id: 'parameter-control', name: 'c1', kind: 'control', expression: 'TRUE', order: 0 },
      { id: 'parameter-user', name: 'spacing', kind: 'parameter', expression: '25', order: 1 },
      { id: 'dimension-1', name: 'd1', kind: 'dimension', expression: 'spacing', order: 2 },
    ],
    dimensionAnnotations: [{
      id: 'annotation-1', dimensionId: 'dimension-1', type: 'dimension-line',
      anchors: { start: { recordId: 'a' }, end: { recordId: 'b' } },
      start: [0, -4], end: [20, -4], stackId: 'stack-a',
    }],
    extensions: {
      arrayTools: {
        version: 3,
        arrays: [{
          id: 'array-1', arrayType: 'rectangular', sourceIds: ['a', 'b'],
          rowCountExpression: '2', columnCountExpression: 'spacing', stackId: 'stack-a',
        }],
      },
      stacks: { version: 1, activeStackId: 'stack-a', stacks: [{ id: 'stack-a', name: 'A' }] },
    },
  };
}

test('clipboard package closes native and array feature dependencies but excludes unrelated objects', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: ['a', 'b'] });
  const ids = new Set(packageValue.drawing.entities.map(({ id }) => id));
  assert.equal(packageValue.format, PARAMAGIC_CLIPBOARD_FORMAT);
  assert.deepEqual(ids, new Set(['a', 'b', 'fillet', 'notch', 'seam']));
  assert.deepEqual(packageValue.drawing.constraints.map(({ id }) => id), ['constraint-inside']);
  assert.deepEqual(packageValue.drawing.dimensionAnnotations.map(({ id }) => id), ['annotation-1']);
  assert.deepEqual(packageValue.drawing.parameters.map(({ name }) => name), ['spacing', 'd1']);
  assert.equal(packageValue.drawing.extensions?.stacks, undefined);
  assert.deepEqual(packageValue.drawing.extensions.arrayTools.arrays.map(({ id }) => id), ['array-1']);
});

test('copying only part of an array source does not create an incomplete array', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: ['a'] });
  assert.equal(packageValue.drawing.extensions?.arrayTools, undefined);
});

test('copying a symmetric group includes its centerline, sources, and source-owned features', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: ['mirror'] });
  assert.deepEqual(
    new Set(packageValue.drawing.entities.map(({ id }) => id)),
    new Set(['mirror', 'a', 'b', 'fillet', 'notch', 'seam']),
  );
});

test('copying an array includes its definition, sources, center dependencies, and expressions', () => {
  const packageValue = createClipboardPackage(fixture(), { arrayIds: ['array-1'] });
  assert.deepEqual(packageValue.drawing.extensions.arrayTools.arrays.map(({ id }) => id), ['array-1']);
  assert.equal(packageValue.drawing.entities.some(({ id }) => id === 'a'), true);
  assert.equal(packageValue.drawing.entities.some(({ id }) => id === 'b'), true);
  assert.equal(packageValue.drawing.parameters.some(({ name }) => name === 'spacing'), true);
});

test('copying one explicit array does not pull in sibling arrays that share its sources', () => {
  const snapshot = fixture();
  snapshot.extensions.arrayTools.arrays.push({
    ...snapshot.extensions.arrayTools.arrays[0],
    id: 'array-2',
    rowCountExpression: '3',
  });
  const packageValue = createClipboardPackage(snapshot, { arrayIds: ['array-1'] });
  assert.deepEqual(packageValue.drawing.extensions.arrayTools.arrays.map(({ id }) => id), ['array-1']);
});

test('linked duplicate and symmetric groups copy their definitions and parent geometry', () => {
  const snapshot = fixture();
  snapshot.extensions.linkedCopyTools = {
    version: 1,
    copies: [
      { id: 'duplicate-1', type: 'duplicate', sourceIds: ['a', 'b'], anchor: [40, 40], linear: { a: 1, b: 0, c: 0, d: 1 }, stackId: 'stack-a' },
      { id: 'symmetric-1', type: 'symmetric', sourceIds: ['outside'], anchor: [-40, 40], linear: { a: -1, b: 0, c: 0, d: 1 }, stackId: 'stack-b' },
    ],
  };
  const packageValue = createClipboardPackage(snapshot, { linkedCopyIds: ['duplicate-1'] });

  assert.deepEqual(packageValue.drawing.extensions.linkedCopyTools.copies.map(({ id }) => id), ['duplicate-1']);
  assert.equal(packageValue.drawing.entities.some(({ id }) => id === 'a'), true);
  assert.equal(packageValue.drawing.entities.some(({ id }) => id === 'b'), true);
  assert.equal(packageValue.drawing.entities.some(({ id }) => id === 'outside'), false);
  const retargeted = retargetClipboardDrawing(packageValue, 'stack-destination');
  assert.equal(retargeted.extensions.linkedCopyTools.copies[0].stackId, 'stack-destination');
});

test('control copy includes its control parameter and subtract state remains native JSON', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: ['control', 'cutter'] });
  assert.deepEqual(packageValue.drawing.parameters.map(({ name }) => name), ['c1']);
  assert.equal(packageValue.drawing.entities.find(({ id }) => id === 'cutter').subtract, true);
});

test('copying a closed object carries Seam Line intent without generated geometry', () => {
  const snapshot = {
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    entities: [{ id: 'shape', type: 'rect', x: 0, y: 0, width: 100, height: 80 }],
    constraints: [],
    parameters: [],
    dimensionAnnotations: [],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'shape', recordIds: ['shape'], defaultEnabled: true, overrides: [] }],
      },
    },
  };
  const copied = createClipboardPackage(snapshot, { entityIds: ['shape'] }).drawing;
  assert.equal(copied.entities.length, 1);
  assert.equal(copied.entities.some((entity) => entity.composite?.kind === 'finish-size-offset'), false);
  assert.equal(copied.extensions.seamLines.definitions[0].regionId, 'shape');
});

test('paste retargets every copied object and array to the destination stack', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: ['mirror'], arrayIds: ['array-1'] });
  const drawing = retargetClipboardDrawing(packageValue, 'stack-destination');
  assert.equal(drawing.entities.every(({ stackId }) => stackId === 'stack-destination'), true);
  assert.equal(drawing.dimensionAnnotations.every(({ stackId }) => stackId === 'stack-destination'), true);
  assert.equal(drawing.extensions.arrayTools.arrays.every(({ stackId }) => stackId === 'stack-destination'), true);
  assert.equal(drawing.extensions.stacks, undefined);
  assert.equal(parseClipboardPackage(JSON.stringify(packageValue)).format, PARAMAGIC_CLIPBOARD_FORMAT);
});

test('paste preserves an array inferred from copied source geometry and remaps its ownership', () => {
  const packageValue = createClipboardPackage(fixture(), { entityIds: ['a', 'b'] });
  const inserted = retargetClipboardDrawing(packageValue, 'stack-destination');
  const { drawing, idMap } = mergeDrawingDataWithMap({
    entities: [{ id: 'existing', type: 'line', start: [100, 0], end: [110, 0] }],
    constraints: [],
    parameters: [{ id: 'existing-spacing', name: 'spacing', kind: 'parameter', expression: '10' }],
    dimensionAnnotations: [],
  }, inserted, { inheritControlParameters: false });
  const pastedArray = drawing.extensions.arrayTools.arrays[0];

  assert.notEqual(pastedArray.id, 'array-1');
  assert.deepEqual(pastedArray.sourceIds, [idMap.get('a'), idMap.get('b')]);
  assert.equal(pastedArray.stackId, 'stack-destination');
  assert.equal(pastedArray.columnCountExpression, 'spacing');
  assert.equal(drawing.entities.some(({ id }) => id === pastedArray.sourceIds[0]), true);
  assert.equal(drawing.entities.some(({ id }) => id === pastedArray.sourceIds[1]), true);
});

test('Stack JSON export passes only the selected Stack package to its exporter', async () => {
  const snapshot = fixture();
  let exportedPackage = null;
  const canvas = {
    getSelectedRecordIds: () => [],
    getActiveStackId: () => 'stack-a',
    getDrawingData: () => snapshot,
    getStackState: () => ({
      activeStackId: 'stack-a',
      stacks: [
        { id: 'stack-a', name: 'A' },
        { id: 'stack-b', name: 'B' },
      ],
    }),
  };
  const previousDocument = globalThis.document;
  globalThis.document = { addEventListener() {} };
  try {
    const clipboard = createDrawingClipboard({
      canvas,
      stackExporters: {
        json: async ({ packageValue }) => { exportedPackage = packageValue; },
      },
    });
    assert.equal(await clipboard.exportStack('stack-a', 'json'), true);
    assert.equal(exportedPackage.drawing.entities.some(({ id }) => id === 'outside'), false);
    assert.equal(exportedPackage.drawing.entities.every(({ stackId }) => stackId === 'stack-a'), true);
    assert.deepEqual(exportedPackage.drawing.extensions.arrayTools.arrays.map(({ id }) => id), ['array-1']);
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
