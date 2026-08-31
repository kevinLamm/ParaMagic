import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDrawingData, mergeDrawingDataWithMap, normalizeDrawingData,
  parseDxf, serializeDxf, serializeDrawingJson,
} from '../../packages/paramagic-core/src/modules/DrawingIO.js';
import { createDrawingDxfSnapshot } from '../../packages/paramagic-core/src/modules/DxfExport.js';
import { isUuid } from '../../packages/paramagic-core/src/modules/IdentitySystem.js';
import { fixtureUuid } from './helpers/fixtureUuid.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const exportDxf = (drawing) => serializeDxf(createDrawingDxfSnapshot(drawing));
const stackFixtureId = (label) => fixtureUuid(`drawing-io-stack-tree:${label}`);

test('subtree insertion remaps every Stack identity, parent edge, name, and qualified expression', () => {
  const baseDefaultId = stackFixtureId('base-default');
  const existingParentId = stackFixtureId('existing-parent');
  const existingChildId = stackFixtureId('existing-child');
  const sourceRootId = stackFixtureId('source-root');
  const sourceChildId = stackFixtureId('source-child');
  const sourceDimensionId = stackFixtureId('source-dimension');
  const base = {
    extensions: { stacks: { version: 3, activeStackId: existingParentId, stacks: [
      { id: baseDefaultId, name: 'Default', systemRole: 'default-stack' },
      { id: existingParentId, name: 'Assembly' },
      { id: existingChildId, name: 'Support' },
    ] } },
  };
  const inserted = {
    parameters: [{
      id: sourceDimensionId, kind: 'dimension', name: 'd1', stackId: sourceChildId,
      expression: '10', value: 10, driving: true,
    }],
    extensions: { stacks: { version: 3, activeStackId: sourceRootId, stacks: [
      {
        id: sourceRootId, name: 'Assembly', systemRole: 'default-stack',
        enabledExpression: 'd1@Support > 5',
      },
      { id: sourceChildId, name: 'Support', parentStackId: sourceRootId },
    ] } },
  };
  const { drawing, idMap } = mergeDrawingDataWithMap(base, inserted);
  const mappedRootId = idMap.get(sourceRootId);
  const mappedChildId = idMap.get(sourceChildId);
  const mappedRoot = drawing.extensions.stacks.stacks.find(({ id }) => id === mappedRootId);
  const mappedChild = drawing.extensions.stacks.stacks.find(({ id }) => id === mappedChildId);

  assert.notEqual(mappedRootId, sourceRootId);
  assert.notEqual(mappedChildId, sourceChildId);
  assert.equal(mappedRoot.name, 'Assembly(1)');
  assert.equal(mappedRoot.enabledExpression, 'd1@Support(1) > 5');
  assert.equal(mappedChild.name, 'Support(1)');
  assert.equal(mappedChild.parentStackId, mappedRootId);
  assert.equal(drawing.parameters.find(({ kind }) => kind === 'dimension').stackId, mappedChildId);
});

test('full drawing insertion creates a non-drawable container above every inserted root Stack', () => {
  const sourceDrawingId = stackFixtureId('source-drawing');
  const sourceRootId = stackFixtureId('full-source-root');
  const sourceChildId = stackFixtureId('full-source-child');
  const { drawing, idMap, insertedRootNodeIds } = mergeDrawingDataWithMap({}, {
    drawingId: sourceDrawingId,
    documentContext: { displayName: 'Support Assembly' },
    extensions: { stacks: { version: 3, activeStackId: sourceRootId, stacks: [
      { id: sourceRootId, name: 'Default', systemRole: 'default-stack' },
      { id: sourceChildId, name: 'Rail', parentStackId: sourceRootId },
    ] } },
  }, { insertAsDrawing: true, drawingContainerName: 'Support Assembly' });
  const container = drawing.extensions.stacks.stacks.find(({ id }) => id === insertedRootNodeIds[0]);
  const mappedRoot = drawing.extensions.stacks.stacks.find(({ id }) => id === idMap.get(sourceRootId));
  const mappedChild = drawing.extensions.stacks.stacks.find(({ id }) => id === idMap.get(sourceChildId));
  assert.equal(container.kind, 'drawing');
  assert.equal(container.name, 'Support Assembly');
  assert.equal(container.sourceDrawingId, sourceDrawingId);
  assert.equal(mappedRoot.parentStackId, container.id);
  assert.equal(mappedRoot.systemRole, undefined);
  assert.equal(mappedChild.parentStackId, mappedRoot.id);
  assert.equal(drawing.extensions.stacks.activeStackId, drawing.extensions.stacks.stacks
    .find(({ systemRole }) => systemRole === 'default-stack').id);
});

function dxfRecordBlocks(dxf, recordType) {
  const pairs = dxf.replace(/\r/g, '').split('\n').reduce((result, value, index, values) => {
    if (index % 2 === 0 && index + 1 < values.length) result.push([value, values[index + 1]]);
    return result;
  }, []);
  const blocks = [];
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index][0] !== '0' || pairs[index][1] !== recordType) continue;
    let end = index + 1;
    while (end < pairs.length && pairs[end][0] !== '0') end += 1;
    blocks.push(pairs.slice(index, end));
    index = end - 1;
  }
  return blocks;
}

const dxfRecordValues = (record, code) => record
  .filter(([groupCode]) => groupCode === String(code))
  .map(([, value]) => value);

const namedDxfRecord = (dxf, recordType, name) => dxfRecordBlocks(dxf, recordType)
  .find((record) => dxfRecordValues(record, 2).includes(name));

const dxfDictionaryEntries = (record) => {
  const entries = new Map();
  record.forEach(([code, value], index) => {
    if (code === '3' && record[index + 1]?.[0] === '350') entries.set(value, record[index + 1][1]);
  });
  return entries;
};

test('drawing normalization upgrades Classes to root-level data and migrates legacy geometry into X', () => {
  const drawing = normalizeDrawingData({
    entities: [{
      id: 'legacy-edge',
      type: 'line',
      start: [0, 0],
      end: [10, 0],
      appearance: { strokeColor: '#123456' },
    }],
  });

  const defaultClass = drawing.classes.find(({ systemRole }) => systemRole === 'default-class');
  assert.ok(defaultClass);
  assert.equal(isUuid(defaultClass.id), true);
  assert.equal(drawing.activeClassId, defaultClass.id);
  assert.deepEqual(drawing.classes.map(({ name }) => name), ['X']);
  assert.equal(drawing.entities[0].classId, defaultClass.id);
  assert.deepEqual(drawing.entities[0].classPropertyOverrides, ['stroke']);
  assert.equal(JSON.parse(serializeDrawingJson(drawing)).version, 4);
});

test('drawing normalization upgrades legacy parallel-edge dimensions to live supporting-line distance semantics', () => {
  const dimensionId = 'legacy-parallel-distance';
  const drawing = normalizeDrawingData({
    entities: [
      { id: 'reference', type: 'line', start: [0, 0], end: [10, 0] },
      { id: 'measured', type: 'line', start: [20, 5], end: [30, 5] },
    ],
    constraints: [{
      id: 'legacy-constraint',
      type: 'Distance',
      source: 'dimension',
      anchors: {
        start: { type: 'segment-point', recordId: 'reference', index: 0, ratio: 1 },
        end: { type: 'segment-start', recordId: 'measured', index: 0 },
      },
      featureRefs: [],
      dimensionRef: dimensionId,
    }],
    dimensionAnnotations: [{
      id: 'legacy-annotation',
      dimensionId,
      type: 'dimension-line',
      dimensionMode: 'driving',
      subtype: 'aligned',
      start: [10, 0],
      end: [20, 5],
      measureStart: [10, 0],
      measureEnd: [20, 5],
      label: [20, 10],
      anchors: {
        measureStart: { type: 'segment-point', recordId: 'reference', index: 0, ratio: 1 },
        measureEnd: { type: 'segment-start', recordId: 'measured', index: 0 },
      },
    }],
  });

  const annotation = drawing.dimensionAnnotations[0];
  assert.equal(annotation.measurementKind, 'parallel-edge-distance');
  assert.deepEqual(annotation.measureStart, [25, 0]);
  assert.deepEqual(annotation.measureEnd, [25, 5]);
  assert.deepEqual(annotation.anchors.lineToLine, {
    reference: { kind: 'segment', recordId: drawing.entities[0].id, index: 0 },
    measured: { kind: 'segment', recordId: drawing.entities[1].id, index: 0 },
  });
  const constraint = drawing.constraints[0];
  assert.equal(constraint.type, 'Line Line Distance');
  assert.equal(constraint.subtype, 'aligned');
  assert.equal(constraint.anchors, undefined);
  assert.deepEqual(constraint.featureRefs, [
    { kind: 'segment', recordId: drawing.entities[0].id, index: 0 },
    { kind: 'segment', recordId: drawing.entities[1].id, index: 0 },
  ]);
});

test('drawing normalization upgrades point-to-line parallel dimensions to line-to-line constraints', () => {
  const dimensionId = 'point-line-parallel-distance';
  const drawing = normalizeDrawingData({
    entities: [
      { id: 'reference', type: 'line', start: [0, 0], end: [10, 0] },
      { id: 'measured', type: 'line', start: [20, 5], end: [30, 5] },
    ],
    constraints: [{
      id: 'point-line-constraint',
      type: 'Point Line Distance',
      source: 'dimension',
      subtype: 'aligned',
      projectionMode: 'line',
      featureRefs: [
        { kind: 'point', type: 'segment-start', recordId: 'measured', index: 0 },
        { kind: 'segment', recordId: 'reference', index: 0 },
      ],
      dimensionRef: dimensionId,
    }],
    dimensionAnnotations: [{
      id: 'point-line-annotation',
      dimensionId,
      type: 'dimension-line',
      dimensionMode: 'driving',
      measurementKind: 'parallel-edge-distance',
      subtype: 'aligned',
      start: [20, 0],
      end: [20, 5],
      measureStart: [20, 0],
      measureEnd: [20, 5],
      label: [20, 10],
      anchors: {
        pointToSegment: {
          point: { type: 'segment-start', recordId: 'measured', index: 0 },
          segment: { kind: 'segment', recordId: 'reference', index: 0 },
          projectionMode: 'line',
        },
      },
    }],
  });
  assert.equal(drawing.constraints[0].type, 'Line Line Distance');
  assert.deepEqual(drawing.dimensionAnnotations[0].anchors.lineToLine, {
    reference: { kind: 'segment', recordId: drawing.entities[0].id, index: 0 },
    measured: { kind: 'segment', recordId: drawing.entities[1].id, index: 0 },
  });
});

test('insert merges same-named classes and preserves unique inserted class definitions', () => {
  const base = normalizeDrawingData({
    classes: [{ id: 'class-cut-a', name: 'Cut', properties: { strokeThickness: 2 } }],
    entities: [],
  });
  const inserted = normalizeDrawingData({
    classes: [
      { id: 'class-cut-b', name: 'Cut', properties: { strokeThickness: 7 } },
      { id: 'class-shell', name: 'Shell', properties: { strokeThickness: 4 } },
    ],
    entities: [
      { id: 'cut-edge', type: 'line', start: [0, 0], end: [1, 0], classId: 'class-cut-b' },
      { id: 'shell-edge', type: 'line', start: [0, 0], end: [0, 1], classId: 'class-shell' },
    ],
  });
  const { drawing } = mergeDrawingDataWithMap(base, inserted);

  assert.deepEqual(drawing.classes.map(({ name }) => name), ['X', 'Cut', 'Shell']);
  assert.equal(drawing.entities[0].classId, drawing.classes.find(({ name }) => name === 'Cut').id);
  assert.equal(
    drawing.entities[1].classId,
    drawing.classes.find(({ name }) => name === 'Shell').id,
  );
});

test('JSON export includes drawing parameters as first-class data', () => {
  const json = serializeDrawingJson({
    drawingUnit: 'in',
    entities: [{
      id: 'line-1', type: 'line', start: [0, 0], end: [25.4, 0],
      appearance: {
        fillType: 'image', fillExpression: 'basic/Fabric/sample.webp',
        fillImageReference: 'basic/Fabric/sample.webp', fillImageMode: 'tile',
        fillImageScaleExpression: 'textureScale',
      },
    }],
    constraints: [],
    parameters: [{ id: 'parameter-1', name: 'width', kind: 'user', type: 'Expression', expression: '12 in', value: 304.8, order: 0 }],
    dimensionAnnotations: [],
  }, 'Parameterized Part');
  const parsed = JSON.parse(json);
  assert.equal(parsed.format, 'ParaMagic Drawing');
  assert.equal(parsed.name, 'Parameterized Part');
  assert.equal(parsed.parameters[0].name, 'width');
  assert.equal(parsed.parameters[0].expression, '12 in');
  assert.equal(parsed.entities[0].appearance.fillImageMode, 'tile');
  assert.equal(parsed.entities[0].appearance.fillImageScaleExpression, 'textureScale');
  assert.equal(parsed.drawingUnit, 'in');
  assert.equal(parsed.dxfExportUnit, 'in');
  assert.equal(parsed.filletRadius, 25.4);
});

test('drawing normalization migrates legacy text font sizes to physical millimetre heights', () => {
  const drawing = normalizeDrawingData({
    entities: [
      { id: 'legacy-text', type: 'text', x: 0, y: 0, text: 'Legacy', fontSize: 96 },
      { id: 'physical-text', type: 'text', x: 0, y: 20, text: 'Physical', fontSize: 12, textHeight: 4 },
    ],
  });
  near(drawing.entities[0].textHeight, 25.4);
  assert.equal(drawing.entities[1].textHeight, 4);

  const serialized = JSON.parse(serializeDrawingJson(drawing));
  near(serialized.entities[0].textHeight, 25.4);
  assert.equal(serialized.entities[1].textHeight, 4);
});

test('insert inherits matching active user parameters and remaps entity IDs', () => {
  const base = {
    entities: [{ id: 'shared-line', type: 'line', start: [0, 0], end: [10, 0] }],
    parameters: [{ id: 'base-width', name: 'width', kind: 'user', expression: '10', value: 10, order: 0 }],
  };
  const inserted = {
    entities: [{ id: 'shared-line', type: 'line', start: [20, 0], end: [30, 0] }],
    parameters: [
      { id: 'insert-width', name: 'width', kind: 'user', expression: '20', value: 20, order: 0 },
      { id: 'insert-double', name: 'double', kind: 'user', expression: 'width * 2', value: 40, order: 1 },
    ],
  };
  const merged = mergeDrawingData(base, inserted);
  assert.equal(merged.entities.length, 2);
  assert.notEqual(merged.entities[0].id, merged.entities[1].id);
  assert.deepEqual(merged.parameters.map(({ name }) => name), ['width', 'double']);
  assert.equal(merged.parameters[0].expression, '10');
  assert.equal(merged.parameters[1].expression, 'width * 2');
});

test('insert remaps primitive and cycle Subtract parent relationships', () => {
  const inserted = {
    entities: [
      { id: 'edge-a', type: 'line', start: [0, 0], end: [10, 0] },
      { id: 'edge-b', type: 'line', start: [10, 0], end: [0, 0] },
      { id: 'primitive-parent', type: 'rect', x: 20, y: 0, width: 10, height: 10 },
      {
        id: 'cutter', type: 'circle', center: [5, 0], radius: 2,
        subtractFrom: ['cycle:edge-a|edge-b', 'primitive-parent'],
      },
    ],
  };
  const { drawing, idMap } = mergeDrawingDataWithMap({}, inserted);
  const cutter = drawing.entities.find((entity) => entity.id === idMap.get('cutter'));
  assert.deepEqual(cutter.subtractFrom, [{
    kind: 'boundary-cycle',
    memberRecordIds: [idMap.get('edge-a'), idMap.get('edge-b')],
  }, idMap.get('primitive-parent')]);
});

test('insert remaps control parameters and expressions without losing control metadata', () => {
  const merged = mergeDrawingData(
    { parameters: [{ id: 'base-c1', name: 'c1', kind: 'control', expression: '10', value: 10, order: 0 }] },
    {
      parameters: [
        { id: 'insert-c1', name: 'c1', kind: 'control', expression: '20', value: 20, order: 0 },
        { id: 'insert-p1', name: 'result', kind: 'user', expression: 'c1 * 2', value: 40, order: 1 },
      ],
      entities: [{
        id: 'insert-control',
        type: 'control',
        controlType: 'horizontal-slider',
        x: 10,
        y: 20,
        width: 160,
        height: 48,
        parameterId: 'insert-c1',
        parameterName: 'c1',
        minExpression: '0',
        maxExpression: 'result',
        initialExpression: 'c1',
      }],
    },
  );
  const control = merged.entities[0];
  assert.equal(control.type, 'control');
  assert.equal(control.parameterId, merged.parameters.find(({ name }) => name === 'c1').id);
  assert.equal(control.parameterName, 'c1');
  assert.equal(control.maxExpression, 'result');
  assert.equal(control.initialExpression, 'c1');
  assert.equal(merged.parameters.length, 2);
});

test('clipboard-style insert can duplicate a control parameter instead of linking the pasted control to its source', () => {
  const base = {
    parameters: [{ id: 'base-c1', name: 'c1', kind: 'control', expression: '10', value: 10, order: 0 }],
  };
  const inserted = {
    parameters: [{ id: 'insert-c1', name: 'c1', kind: 'control', expression: '20', value: 20, order: 0 }],
    entities: [{
      id: 'insert-control', type: 'control', controlType: 'horizontal-slider', x: 0, y: 0,
      parameterId: 'insert-c1', parameterName: 'c1', minExpression: '0', maxExpression: '100', initialExpression: 'c1',
    }],
  };
  const { drawing } = mergeDrawingDataWithMap(base, inserted, { inheritControlParameters: false });
  const pasted = drawing.entities[0];
  assert.equal(pasted.parameterName, 'c2');
  assert.equal(pasted.initialExpression, 'c2');
  assert.notEqual(pasted.parameterId, 'base-c1');
  assert.deepEqual(drawing.parameters.map(({ name }) => name), ['c1', 'c2']);
});

test('insert renames conflicting dimensions and rewrites every inserted expression reference', () => {
  const base = {
    parameters: [
      { id: 'base-d1', name: 'd1', kind: 'dimension', expression: '10', value: 10, order: 0 },
      { id: 'base-d2', name: 'd2', kind: 'dimension', expression: '15', value: 15, order: 1 },
      { id: 'base-width', name: 'width', kind: 'user', expression: '100', value: 100, order: 2 },
    ],
  };
  const inserted = {
    entities: [{
      id: 'conditional-circle', type: 'circle', center: [0, 0], radius: 5,
      appearance: { visible: false, visibleExpression: 'd1 > d2' },
    }],
    parameters: [
      { id: 'insert-d1', name: 'd1', kind: 'dimension', expression: '20', value: 20, order: 0 },
      { id: 'insert-d2', name: 'd2', kind: 'dimension', expression: '25', value: 25, order: 1 },
      { id: 'insert-width', name: 'width', kind: 'user', expression: '200', value: 200, order: 2 },
      { id: 'insert-result', name: 'result', kind: 'user', expression: 'd1 + d2 + width', value: 245, order: 3 },
    ],
    constraints: [{ id: 'insert-constraint', type: 'Distance', dimensionRef: 'insert-d1' }],
    dimensionAnnotations: [{ id: 'insert-annotation', dimensionId: 'insert-d1', dimensionName: 'd1' }],
  };

  const merged = mergeDrawingData(base, inserted);
  assert.deepEqual(merged.parameters.map(({ name }) => name), ['d1', 'd2', 'width', 'd1', 'd2', 'result']);
  assert.equal(merged.parameters.find(({ name }) => name === 'width').expression, '100');
  assert.equal(merged.parameters.find(({ name }) => name === 'result').expression, 'd1@Default(1) + d2@Default(1) + width');
  const insertedDimension = merged.parameters.find(({ id }) => id === merged.dimensionAnnotations[0].dimensionId);
  assert.equal(insertedDimension.name, 'd1');
  assert.equal(merged.dimensionAnnotations[0].dimensionId, insertedDimension.id);
  assert.equal(merged.dimensionAnnotations[0].dimensionName, 'd1');
  assert.equal(merged.constraints[0].dimensionRef, insertedDimension.id);
  assert.equal(merged.entities[0].appearance.visibleExpression, 'd1 > d2');
});

test('every inserted dimension uses the destination Stack sequence instead of preserving source gaps', () => {
  const merged = mergeDrawingData({}, {
    entities: [{ id: 'line', type: 'line', start: [0, 0], end: [10, 0], visibleExpression: 'd20 > d16' }],
    parameters: [
      { id: 'insert-d16', name: 'd16', kind: 'dimension', expression: '10', stackId: 'stack-default' },
      { id: 'insert-d20', name: 'd20', kind: 'dimension', expression: 'd16 + 5', stackId: 'stack-default' },
    ],
    dimensionAnnotations: [
      { id: 'annotation-d16', dimensionId: 'insert-d16', dimensionName: 'd16', stackId: 'stack-default' },
      { id: 'annotation-d20', dimensionId: 'insert-d20', dimensionName: 'd20', stackId: 'stack-default' },
    ],
  });

  assert.deepEqual(merged.parameters.map(({ name }) => name), ['d1', 'd2']);
  assert.equal(merged.parameters.find(({ name }) => name === 'd2').expression, 'd1 + 5');
  assert.equal(merged.entities[0].visibleExpression, 'd2 > d1');
  assert.deepEqual(merged.dimensionAnnotations.map(({ dimensionName }) => dimensionName), ['d1', 'd2']);
});

test('insert preserves appearances and remaps composite drawing-command IDs', () => {
  const composite = { id: 'rectangle-command', kind: 'rectangle', closed: true, count: 2 };
  const inserted = {
    entities: [
      { id: 'a', type: 'line', start: [0, 0], end: [10, 0], composite: { ...composite, index: 0 }, appearance: { fillColor: '#336699', strokeThickness: 2, zIndex: 1 } },
      { id: 'b', type: 'line', start: [10, 0], end: [0, 0], composite: { ...composite, index: 1 }, appearance: { fillColor: '#336699', strokeThickness: 2, zIndex: 2 } },
    ],
  };
  const merged = mergeDrawingData({}, inserted);
  assert.notEqual(merged.entities[0].composite.id, 'rectangle-command');
  assert.equal(merged.entities[0].composite.id, merged.entities[1].composite.id);
  assert.deepEqual(merged.entities[0].appearance, { fillColor: '#336699', strokeThickness: 2, zIndex: 1 });
});

test('insert remaps stack ownership and preserves the destination default stack', () => {
  const base = {
    extensions: {
      stacks: { version: 1, activeStackId: 'stack-default', stacks: [{ id: 'stack-default', name: 'Default', visible: true }] },
    },
  };
  const inserted = {
    entities: [{ id: 'trace-line', type: 'line', start: [0, 0], end: [10, 0], stackId: 'trace-stack' }],
    extensions: {
      stacks: {
        version: 1,
        activeStackId: 'trace-stack',
        stacks: [
          { id: 'stack-default', name: 'Imported Default', visible: true },
          { id: 'trace-stack', name: 'Trace', visible: false },
        ],
      },
    },
  };
  const merged = mergeDrawingData(base, inserted);
  const traceStack = merged.extensions.stacks.stacks.find(({ name }) => name === 'Trace');
  assert.ok(traceStack);
  assert.notEqual(traceStack.id, 'trace-stack');
  assert.equal(merged.entities[0].stackId, traceStack.id);
  const defaultStack = merged.extensions.stacks.stacks.find(({ systemRole }) => systemRole === 'default-stack');
  assert.ok(defaultStack);
  assert.equal(isUuid(defaultStack.id), true);
});

test('DXF export and import round-trip supported geometry in inch units', () => {
  const source = {
    drawingUnit: 'in',
    dxfExportUnit: 'in',
    entities: [
      { id: 'line', type: 'line', start: [0, 0], end: [25.4, 50.8] },
      { id: 'circle', type: 'circle', center: [76.2, 25.4], radius: 12.7 },
      { id: 'polyline', type: 'polyline', points: [[0, 0], [25.4, 0], [25.4, 25.4]] },
    ],
  };
  const dxf = exportDxf(source);
  assert.match(dxf, /\$INSUNITS/);
  const restored = parseDxf(dxf);
  assert.equal(restored.drawingUnit, 'in');
  assert.equal(restored.dxfExportUnit, 'in');
  assert.equal(restored.entities.length, 3);
  assert.equal(new Set(restored.entities.map(({ id }) => id)).size, restored.entities.length);
  restored.entities.forEach(({ id }) => assert.equal(isUuid(id), true));
  const restoredLine = restored.entities.find(({ type }) => type === 'line');
  const restoredCircle = restored.entities.find(({ type }) => type === 'circle');
  const restoredPolyline = restored.entities.find(({ type }) => type === 'polyline');
  assert.deepEqual(restoredLine.start, [0, 0]);
  near(restoredLine.end[0], source.entities[0].end[0]);
  near(restoredLine.end[1], source.entities[0].end[1]);
  near(restoredCircle.radius, source.entities[1].radius);
  restoredPolyline.points.flat().forEach((value, index) => near(value, source.entities[2].points.flat()[index]));
});

test('DXF export converts drawing coordinates into the selected DXF unit', () => {
  const source = {
    drawingUnit: 'in',
    dxfExportUnit: 'mm',
    entities: [{ id: 'line', type: 'line', start: [0, 0], end: [25.4, 50.8] }],
  };
  const dxf = exportDxf(source);
  assert.match(dxf, /\$INSUNITS\n70\n4/);
  assert.match(dxf, /\n11\n25\.4\n21\n-50\.8/);
  const restored = parseDxf(dxf);
  assert.equal(restored.drawingUnit, 'mm');
  assert.equal(restored.dxfExportUnit, 'mm');
  near(restored.entities[0].end[0], 25.4);
  near(restored.entities[0].end[1], 50.8);
});

test('DXF export converts internal millimetres only to the export unit', () => {
  const exported = (drawingUnit, dxfExportUnit) => {
    const dxf = exportDxf({
      drawingUnit,
      dxfExportUnit,
      entities: [{ id: 'line', type: 'line', start: [0, 0], end: [50.8, 0] }],
    });
    const line = dxfRecordBlocks(dxf, 'LINE')[0];
    return {
      coordinate: Number(dxfRecordValues(line, 11)[0]),
      headerUnit: Number(/\$INSUNITS\n70\n([^\n]+)/.exec(dxf)?.[1]),
    };
  };

  const cases = [
    ['in', 'mm', 50.8, 4],
    ['in', 'in', 2, 1],
    ['mm', 'in', 2, 1],
    ['cm', 'm', 0.0508, 6],
    ['m', 'ft', 50.8 / 304.8, 2],
    ['ft', 'cm', 5.08, 5],
    ['mm', 'mm', 50.8, 4],
  ];
  cases.forEach(([drawingUnit, dxfExportUnit, coordinate, headerUnit]) => {
    const result = exported(drawingUnit, dxfExportUnit);
    near(result.coordinate, coordinate);
    assert.equal(result.headerUnit, headerUnit);
  });
});

test('DXF header declares a compatible version and measurement system for the selected export unit', () => {
  const metric = exportDxf({ drawingUnit: 'mm', entities: [] });
  assert.match(metric, /\$ACADVER\n1\nAC1015/);
  assert.match(metric, /\$INSUNITS\n70\n4/);
  assert.match(metric, /\$MEASUREMENT\n70\n1/);

  const imperial = exportDxf({ drawingUnit: 'mm', dxfExportUnit: 'ft', entities: [] });
  assert.match(imperial, /\$INSUNITS\n70\n2/);
  assert.match(imperial, /\$MEASUREMENT\n70\n0/);
});

test('DXF R2000 export writes Autodesk-compatible symbol tables, dictionaries, layouts, and common entity data', () => {
  const dxf = exportDxf({
    drawingUnit: 'mm',
    entities: [{ id: 'line', type: 'line', start: [0, 0], end: [10, 0] }],
  });
  const tableNames = dxfRecordBlocks(dxf, 'TABLE').map((record) => dxfRecordValues(record, 2)[0]);
  assert.deepEqual(tableNames, [
    'VPORT', 'LTYPE', 'LAYER', 'STYLE', 'VIEW', 'UCS', 'APPID', 'DIMSTYLE', 'BLOCK_RECORD',
  ]);
  dxfRecordBlocks(dxf, 'TABLE').forEach((record) => {
    assert.equal(dxfRecordValues(record, 5).length, 1);
    assert.deepEqual(dxfRecordValues(record, 330), ['0']);
    assert.equal(dxfRecordValues(record, 100).includes('AcDbSymbolTable'), true);
  });

  const appId = namedDxfRecord(dxf, 'APPID', 'ACAD');
  assert.ok(appId);
  assert.equal(dxfRecordValues(appId, 5).length, 1);
  assert.equal(dxfRecordValues(appId, 100).includes('AcDbRegAppTableRecord'), true);
  assert.ok(namedDxfRecord(dxf, 'STYLE', 'STANDARD'));
  const modelBlockRecord = namedDxfRecord(dxf, 'BLOCK_RECORD', '*Model_Space');
  const paperBlockRecord = namedDxfRecord(dxf, 'BLOCK_RECORD', '*Paper_Space');
  assert.ok(modelBlockRecord);
  assert.ok(paperBlockRecord);

  const rootDictionary = dxfRecordBlocks(dxf, 'DICTIONARY')
    .find((record) => dxfRecordValues(record, 330)[0] === '0');
  assert.ok(rootDictionary);
  const rootEntries = dxfDictionaryEntries(rootDictionary);
  assert.deepEqual([...rootEntries.keys()], [
    'ACAD_GROUP', 'ACAD_LAYOUT', 'ACAD_MLINESTYLE', 'ACAD_PLOTSETTINGS', 'ACAD_PLOTSTYLENAME',
  ]);
  const layoutDictionary = dxfRecordBlocks(dxf, 'DICTIONARY')
    .find((record) => dxfRecordValues(record, 5)[0] === rootEntries.get('ACAD_LAYOUT'));
  assert.ok(layoutDictionary);
  const layoutEntries = dxfDictionaryEntries(layoutDictionary);
  assert.deepEqual([...layoutEntries.keys()], ['Layout1', 'Model']);

  const modelLayout = dxfRecordBlocks(dxf, 'LAYOUT')
    .find((record) => dxfRecordValues(record, 1).includes('Model'));
  const paperLayout = dxfRecordBlocks(dxf, 'LAYOUT')
    .find((record) => dxfRecordValues(record, 1).includes('Layout1'));
  assert.ok(modelLayout);
  assert.ok(paperLayout);
  assert.equal(dxfRecordValues(modelLayout, 330).at(-1), dxfRecordValues(modelBlockRecord, 5)[0]);
  assert.equal(dxfRecordValues(paperLayout, 330).at(-1), dxfRecordValues(paperBlockRecord, 5)[0]);
  assert.deepEqual(dxfRecordValues(modelBlockRecord, 340), dxfRecordValues(modelLayout, 5));
  assert.deepEqual(dxfRecordValues(paperBlockRecord, 340), dxfRecordValues(paperLayout, 5));

  const normalPlotStyle = dxfRecordBlocks(dxf, 'ACDBPLACEHOLDER')[0];
  assert.ok(normalPlotStyle);
  dxfRecordBlocks(dxf, 'LAYER').forEach((record) => {
    assert.deepEqual(dxfRecordValues(record, 370), ['-3']);
    assert.deepEqual(dxfRecordValues(record, 390), dxfRecordValues(normalPlotStyle, 5));
  });
  const line = dxfRecordBlocks(dxf, 'LINE')[0];
  assert.deepEqual(dxfRecordValues(line, 410), ['Model']);
  assert.deepEqual(dxfRecordValues(line, 370), ['-1']);
  assert.match(dxf, /\$HANDSEED\n5\n[0-9A-F]+/);
});

test('DXF unit scaling is applied to every supported geometric coordinate and radius', () => {
  const dxf = exportDxf({
    drawingUnit: 'in',
    dxfExportUnit: 'mm',
    entities: [
      { id: 'line', type: 'line', start: [25.4, 50.8], end: [76.2, 101.6] },
      { id: 'circle', type: 'circle', center: [127, 152.4], radius: 50.8 },
      { id: 'arc', type: 'arc', center: [203.2, 203.2], radius: 50.8, start: [254, 203.2], arcPoint: [203.2, 152.4], end: [152.4, 203.2] },
      { id: 'polyline', type: 'polyline', points: [[177.8, 203.2], [228.6, 254]] },
    ],
  });
  assert.match(dxf, /\n10\n25\.4\n20\n-50\.8\n11\n76\.2\n21\n-101\.6/);
  assert.match(dxf, /\nCIRCLE\n[\s\S]*?\n10\n127\n20\n-152\.4\n40\n50\.8/);
  assert.match(dxf, /\nARC\n[\s\S]*?\n10\n203\.2\n20\n-203\.2\n40\n50\.8/);
  assert.match(dxf, /\nLWPOLYLINE\n[\s\S]*?\n10\n177\.8\n20\n-203\.2\n10\n228\.6\n20\n-254/);
});

test('DXF export writes every physical Notch shape to its dedicated layer', () => {
  const dxf = exportDxf({
    drawingUnit: 'in',
    dxfExportUnit: 'mm',
    entities: [
      { id: 'slit', type: 'notch', notchType: 'straight-slit', point: [0, 0], end: [0, 6.35] },
      { id: 'vee', type: 'notch', notchType: 'v-notch', point: [20, 0], end: [20, 6.35] },
      { id: 'u', type: 'notch', notchType: 'u-notch', point: [40, 0], end: [40, 6.35] },
    ],
  });

  assert.ok(namedDxfRecord(dxf, 'LAYER', 'Straight Slit Notch'));
  assert.ok(namedDxfRecord(dxf, 'LAYER', 'V-Notch'));
  assert.ok(namedDxfRecord(dxf, 'LAYER', 'U-Notch'));
  const lineLayers = dxfRecordBlocks(dxf, 'LINE').flatMap((record) => dxfRecordValues(record, 8));
  const arcLayers = dxfRecordBlocks(dxf, 'ARC').flatMap((record) => dxfRecordValues(record, 8));
  assert.equal(lineLayers.filter((layer) => layer === 'Straight Slit Notch').length, 1);
  assert.equal(lineLayers.filter((layer) => layer === 'V-Notch').length, 2);
  assert.equal(lineLayers.filter((layer) => layer === 'U-Notch').length, 2);
  assert.equal(arcLayers.filter((layer) => layer === 'U-Notch').length, 1);
});

test('DXF export places seam geometry on a dashed Seam Lines layer', () => {
  const dxf = exportDxf({
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    entities: [
      { id: 'base', type: 'line', start: [0, 0], end: [50, 0] },
      {
        id: 'seam', type: 'line', start: [0, 10], end: [50, 10],
        composite: { kind: 'finish-size-offset', sourceFeatures: [{ recordId: 'base', kind: 'segment', index: 0 }] },
      },
    ],
  });

  assert.ok(namedDxfRecord(dxf, 'LTYPE', 'DASHED'));
  const seamLayerRecord = namedDxfRecord(dxf, 'LAYER', 'Seam Lines');
  assert.ok(seamLayerRecord);
  assert.deepEqual(dxfRecordValues(seamLayerRecord, 6), ['DASHED']);
  const lineLayers = dxfRecordBlocks(dxf, 'LINE').flatMap((record) => dxfRecordValues(record, 8));
  assert.equal(lineLayers.includes('Seam Lines'), true);
  assert.equal(lineLayers.includes('0'), true);
});

test('V2 Seam Line intent remaps with inserted geometry and exports without stored seam entities', () => {
  const inserted = {
    drawingUnit: 'mm',
    entities: [{ id: 'shape', type: 'rect', x: 0, y: 0, width: 100, height: 80 }],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{
          regionId: 'shape',
          recordIds: ['shape'],
          defaultEnabled: false,
          overrides: [{ sourceId: 'shape', sourceFeatureIndex: 0, boundaryRole: 'outer', kind: 'segment', enabled: true }],
        }],
      },
    },
  };
  const { drawing, idMap } = mergeDrawingDataWithMap({}, inserted);
  const mappedId = idMap.get('shape');
  const definition = drawing.extensions.seamLines.definitions[0];
  assert.equal(definition.regionId, mappedId);
  assert.deepEqual(definition.recordIds, [mappedId]);
  assert.equal(definition.overrides[0].sourceId, mappedId);
  assert.equal(drawing.entities.some((entity) => entity.composite?.kind === 'finish-size-offset'), false);
  assert.ok(namedDxfRecord(exportDxf(drawing), 'LAYER', 'Seam Lines'));
});

test('insert keeps the destination drawing and DXF units', () => {
  const merged = mergeDrawingData(
    { drawingUnit: 'cm', dxfExportUnit: 'm' },
    { drawingUnit: 'mm', dxfExportUnit: 'ft' },
  );
  assert.equal(merged.drawingUnit, 'cm');
  assert.equal(merged.dxfExportUnit, 'm');
});

test('fillets persist in JSON, remap source references on insert, and export as trimmed DXF geometry', () => {
  const source = {
    entities: [
      { id: 'horizontal', type: 'line', start: [0, 0], end: [100, 0] },
      { id: 'vertical', type: 'line', start: [0, 0], end: [0, 100] },
      {
        id: 'corner-fillet',
        type: 'fillet',
        sourceA: { recordId: 'horizontal', index: 0 },
        sourceB: { recordId: 'vertical', index: 0 },
        radius: 10,
        radiusExpression: '10 mm',
      },
    ],
  };
  const parsed = JSON.parse(serializeDrawingJson(source, 'Filleted Corner'));
  assert.equal(parsed.entities[2].type, 'fillet');
  assert.equal(parsed.entities[2].radiusExpression, '10 mm');

  const merged = mergeDrawingData({}, source);
  const mergedFillet = merged.entities.find(({ type }) => type === 'fillet');
  assert.notEqual(mergedFillet.sourceA.recordId, 'horizontal');
  assert.notEqual(mergedFillet.sourceB.recordId, 'vertical');
  assert.ok(merged.entities.some(({ id }) => id === mergedFillet.sourceA.recordId));
  assert.ok(merged.entities.some(({ id }) => id === mergedFillet.sourceB.recordId));

  const dxf = exportDxf(source);
  assert.equal((dxf.match(/\nLINE\n/g) || []).length, 2);
  assert.equal((dxf.match(/\nARC\n/g) || []).length, 1);
  assert.doesNotMatch(dxf, /\n10\n0\n20\n0\n11\n3\.937/);
});

test('inserted notches retain their hidden constraints and remap their host drawing object', () => {
  const inserted = normalizeDrawingData({
    entities: [
      { id: 'host-line', type: 'line', start: [0, 0], end: [100, 0] },
      {
        id: 'notch-1',
        type: 'notch',
        host: { recordId: 'host-line', kind: 'segment', index: 0 },
        parameter: 0.5,
        point: [50, 0],
        end: [50, 6.35],
        length: 6.35,
        implicitConstraints: ['Point-on', 'Perpendicular'],
      },
    ],
  });
  const merged = mergeDrawingData(normalizeDrawingData({}), inserted);
  const host = merged.entities.find((entity) => entity.type === 'line');
  const notch = merged.entities.find((entity) => entity.type === 'notch');

  assert.ok(host);
  assert.ok(notch);
  assert.equal(notch.host.recordId, host.id);
  assert.deepEqual(notch.implicitConstraints, ['Point-on', 'Perpendicular']);
});
