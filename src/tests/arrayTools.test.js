import test from 'node:test';
import assert from 'node:assert/strict';

import {
  arrayCenterRecordId,
  arrayDerivedRecordId,
  arrayDerivedOwnerId,
  arrayParentVisibilityExpression,
  arrayPaintAnchorRecordId,
  arrayPlacementCount,
  arrayPlacementTransform,
  arraySelectionPropertyPatch,
  boundsCentroid,
  circularArrayAngles,
  createArrayCenterPointEntity,
  evaluateArrayDefinition,
  isArrayCenterPointEntity,
  migrateArrayDefinition,
  materializeArraySubtractOwners,
  normalizeArrayDefinition,
  parseArrayDerivedRecordId,
  rectangularArrayOffsets,
} from '../../packages/paramagic-core/src/modules/ArrayTools.js';
import { mergeDrawingData, normalizeDrawingData } from '../../packages/paramagic-core/src/modules/DrawingIO.js';
import { ParameterRepository } from '../../packages/paramagic-core/src/modules/solver/ParameterRepository.js';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { valueInUnit } from '../../packages/paramagic-core/src/modules/solver/Units.js';

test('array definitions normalize independent row and column spacing expressions', () => {
  const definition = normalizeArrayDefinition({
    id: 'array-1',
    type: 'Rectangular Array',
    sourceIds: ['shape-1', 'shape-1', 'shape-2'],
    rowSpacingExpression: 'width + 2',
    columnSpacingExpression: 'height / 2',
    rowCentroidSpacing: true,
    rowDirection: 'up',
    columnDirection: 'left',
  });

  assert.equal(definition.arrayType, 'rectangular');
  assert.deepEqual(definition.sourceIds, ['shape-1', 'shape-2']);
  assert.equal(definition.rowSpacingExpression, 'width + 2');
  assert.equal(definition.columnSpacingExpression, 'height / 2');
  assert.equal(definition.rowCentroidSpacing, true);
  assert.equal(definition.columnCentroidSpacing, false);
  assert.equal(definition.rowDirection, 'up');
  assert.equal(definition.columnDirection, 'left');
});

test('rectangular offsets follow left, center, right and up, center, down directions', () => {
  assert.deepEqual(rectangularArrayOffsets({
    rowCount: 3,
    columnCount: 2,
    rowSpacing: 10,
    columnSpacing: 20,
    objectWidth: 40,
    objectHeight: 30,
    rowDirection: 'up',
    columnDirection: 'left',
  }), [
    { translateX: 0, translateY: 0 },
    { translateX: -60, translateY: 0 },
    { translateX: 0, translateY: -40 },
    { translateX: -60, translateY: -40 },
    { translateX: 0, translateY: -80 },
    { translateX: -60, translateY: -80 },
  ]);

  assert.deepEqual(rectangularArrayOffsets({
    rowCount: 2,
    columnCount: 3,
    rowSpacing: 8,
    columnSpacing: 6,
    objectWidth: 12,
    objectHeight: 14,
    rowDirection: 'center',
    columnDirection: 'center',
  }), [
    { translateX: 0, translateY: 0 },
    { translateX: -18, translateY: 0 },
    { translateX: 18, translateY: 0 },
    { translateX: 0, translateY: -22 },
    { translateX: -18, translateY: -22 },
    { translateX: 18, translateY: -22 },
  ]);
});

test('equal rectangular spacing values produce equal edge gaps for a non-square object', () => {
  const width = 70;
  const height = 30;
  const gap = 20;
  const placements = rectangularArrayOffsets({
    rowCount: 2,
    columnCount: 2,
    rowSpacing: gap,
    columnSpacing: gap,
    objectWidth: width,
    objectHeight: height,
  });

  assert.equal(placements[1].translateX - width, gap);
  assert.equal(placements[2].translateY - height, gap);
});

test('rectangular centroid spacing can be enabled independently for rows and columns', () => {
  assert.deepEqual(rectangularArrayOffsets({
    rowCount: 2,
    columnCount: 2,
    rowSpacing: 30,
    columnSpacing: 70,
    objectWidth: 40,
    objectHeight: 20,
    rowCentroidSpacing: true,
    columnCentroidSpacing: false,
  }), [
    { translateX: 0, translateY: 0 },
    { translateX: 110, translateY: 0 },
    { translateX: 0, translateY: 30 },
    { translateX: 110, translateY: 30 },
  ]);

  assert.deepEqual(rectangularArrayOffsets({
    rowCount: 2,
    columnCount: 2,
    rowSpacing: 30,
    columnSpacing: 70,
    objectWidth: 40,
    objectHeight: 20,
    rowCentroidSpacing: false,
    columnCentroidSpacing: true,
  }), [
    { translateX: 0, translateY: 0 },
    { translateX: 70, translateY: 0 },
    { translateX: 0, translateY: 50 },
    { translateX: 70, translateY: 50 },
  ]);
});

test('circular angles distribute a full circle without duplicating 360 degrees', () => {
  assert.deepEqual(circularArrayAngles({ count: 4, fullCircle: true }), [0, 90, 180, 270]);
  assert.deepEqual(circularArrayAngles({
    count: 4,
    fullCircle: false,
    stopAngle: 120,
  }), [0, 40, 80, 120]);
  assert.deepEqual(circularArrayAngles({
    count: 4,
    fullCircle: false,
    stopAngle: -90,
  }), [0, -30, -60, -90]);
});

test('array dimension identities remain stable and placement transforms match rendered copies', () => {
  const recordId = arrayDerivedRecordId('array:one', 3, 'shape/one');
  assert.deepEqual(parseArrayDerivedRecordId(recordId), {
    arrayId: 'array:one',
    placementIndex: 3,
    sourceId: 'shape/one',
  });
  assert.deepEqual(arrayPlacementTransform({ translateX: 20, translateY: -5 })([3, 4]), [23, -1]);
  const rotated = arrayPlacementTransform({ angle: 90 }, [10, 10])([20, 10]);
  assert.ok(Math.abs(rotated[0] - 10) < 1e-9);
  assert.ok(Math.abs(rotated[1] - 20) < 1e-9);
});

test('rectangular array placements materialize active source circles as stable Boolean cutters', () => {
  const definition = normalizeArrayDefinition({
    id: 'cutter-array',
    arrayType: 'rectangular',
    sourceIds: ['cutter'],
  });
  const evaluated = {
    valid: true,
    placements: [
      { translateX: 0, translateY: 0 },
      { translateX: 40, translateY: 0 },
      { translateX: 80, translateY: 0 },
    ],
  };
  const owners = materializeArraySubtractOwners(definition, evaluated, [{
    id: 'cutter',
    recordIds: ['cutter'],
    entity: { id: 'cutter', type: 'circle', center: [10, 0], radius: 8, subtract: true },
  }]);

  assert.equal(owners.length, 2);
  assert.equal(owners[0].id, arrayDerivedOwnerId('cutter-array', 1, 'cutter'));
  assert.deepEqual(owners.map((owner) => owner.entity.center), [[50, 0], [90, 0]]);
  assert.deepEqual(owners.map((owner) => owner.entity.radius), [8, 8]);
  assert.ok(owners.every((owner) => owner.entity.subtract === true));
});

test('array Boolean copies inherit Subtract only from their original source object', () => {
  const definition = normalizeArrayDefinition({
    id: 'source-owned-array',
    arrayType: 'rectangular',
    sourceIds: ['source'],
  });
  const evaluated = {
    valid: true,
    placements: [{ translateX: 0, translateY: 0 }, { translateX: 30, translateY: 0 }],
  };
  const sourceOwner = {
    id: 'source',
    recordIds: ['source'],
    entity: { id: 'source', type: 'circle', center: [0, 0], radius: 5, subtract: false },
  };

  assert.deepEqual(materializeArraySubtractOwners(definition, evaluated, [sourceOwner]), []);
  sourceOwner.entity.subtract = true;
  assert.equal(materializeArraySubtractOwners(definition, evaluated, [sourceOwner]).length, 1);
});

test('selected array properties expose visibility without a Subtract property', () => {
  assert.deepEqual(arraySelectionPropertyPatch(
    { id: 'array-1' },
    {
      canEditVisible: true,
      visible: false,
      mixedVisible: false,
      visibleExpression: 'showArray',
      errors: { visible: null },
    },
  ), {
    selectionCount: 1,
    recordIds: [],
    ids: ['array-1'],
    arrayCount: 1,
    canEditVisible: true,
    visible: false,
    mixedVisible: false,
    visibleExpression: 'showArray',
    errors: { visible: null },
  });
});

test('circular array cutters rotate analytic composite boundaries without moving the source placement', () => {
  const definition = normalizeArrayDefinition({
    id: 'round-cutter-array',
    arrayType: 'circular',
    sourceIds: ['edge-a', 'edge-b', 'edge-c'],
    centerPoint: [0, 0],
  });
  const sourceOwner = {
    id: 'triangle-cutter',
    recordIds: ['edge-a', 'edge-b', 'edge-c'],
    entity: {
      id: 'triangle-cutter', type: 'polygon', points: [[10, 0], [20, 0], [10, 10]], subtract: true,
    },
    boundary: {
      polygon: [[10, 0], [20, 0], [10, 10]],
      features: [
        { kind: 'segment', sourceId: 'edge-a', sourceFeatureIndex: 0, start: [10, 0], end: [20, 0] },
        { kind: 'segment', sourceId: 'edge-b', sourceFeatureIndex: 1, start: [20, 0], end: [10, 10] },
        { kind: 'segment', sourceId: 'edge-c', sourceFeatureIndex: 2, start: [10, 10], end: [10, 0] },
      ],
    },
  };
  const owners = materializeArraySubtractOwners(definition, {
    valid: true,
    placements: [{ angle: 0 }, { angle: 90 }],
  }, [sourceOwner], { centerPoint: [0, 0] });

  assert.equal(owners.length, 1);
  assert.deepEqual(owners[0].entity.points.map((point) => point.map((value) => Math.round(value))), [
    [0, 10], [0, 20], [-10, 10],
  ]);
  assert.deepEqual(owners[0].boundary.features[0].start.map((value) => Math.round(value)), [0, 10]);
  assert.equal(owners[0].boundary.features[0].sourceId, owners[0].id);
  assert.equal(owners[0].sourceOwnerId, 'triangle-cutter');
});

test('circular arrays derive radius from the selected-object centroid and count the original', () => {
  assert.deepEqual(boundsCentroid({ x: 30, y: -10, width: 20, height: 20 }), [40, 0]);
  const result = evaluateArrayDefinition({
    arrayType: 'circular',
    sourceIds: ['shape-1'],
    countExpression: '4',
    fullCircle: true,
    centerPoint: [0, 0],
  }, {
    sourceBounds: { x: 30, y: -10, width: 20, height: 20 },
  });

  assert.equal(result.valid, true);
  assert.equal(result.values.radius, 40);
  assert.deepEqual(result.placements.map(({ angle }) => angle), [0, 90, 180, 270]);
  assert.equal(result.placements.slice(1).length, 3);
});

test('zero-count arrays have no placements and gate parent visibility to FALSE', () => {
  const rectangular = evaluateArrayDefinition({
    arrayType: 'rectangular',
    sourceIds: ['shape-1'],
    rowCountExpression: '0',
    columnCountExpression: '3',
    rowSpacingExpression: '10',
    columnSpacingExpression: '10',
  }, {
    sourceBounds: { width: 20, height: 20 },
  });
  const circular = evaluateArrayDefinition({
    arrayType: 'circular',
    sourceIds: ['shape-1'],
    countExpression: '0',
  }, {
    sourceBounds: { x: 20, y: 0, width: 10, height: 10 },
  });

  assert.equal(rectangular.valid, true);
  assert.equal(arrayPlacementCount(rectangular), 0);
  assert.deepEqual(rectangular.placements, []);
  assert.equal(circular.valid, true);
  assert.equal(arrayPlacementCount(circular), 0);
  assert.deepEqual(circular.placements, []);
  assert.equal(
    arrayParentVisibilityExpression(circular.definition),
    '((0) > 0)',
  );
  assert.equal(
    arrayParentVisibilityExpression({
      arrayType: 'rectangular',
      rowCountExpression: 'rows',
      columnCountExpression: 'columns',
    }, 'showParent'),
    '((showParent) && ((rows) > 0 && (columns) > 0))',
  );
});

test('array paint order follows its highest-positioned source object', () => {
  const definition = {
    sourceIds: ['source-low', 'source-high'],
  };
  assert.equal(
    arrayPaintAnchorRecordId(
      definition,
      ['source-low', 'unrelated', 'source-high', 'newer-front-object'],
    ),
    'source-high',
  );
  assert.equal(
    arrayPaintAnchorRecordId(
      definition,
      ['source-low', 'newer-front-object', 'source-high'],
    ),
    'source-high',
  );
  assert.equal(arrayPaintAnchorRecordId(definition, ['unrelated']), null);
});

test('a circular array center is a persistent solver point that accepts point constraints', () => {
  const definition = normalizeArrayDefinition({
    id: 'array-with-center',
    stackId: 'stack-a',
    arrayType: 'circular',
    sourceIds: ['shape-1'],
    centerPoint: [30, 40],
  });
  const center = createArrayCenterPointEntity(definition, definition.centerPoint);

  assert.equal(center.id, arrayCenterRecordId(definition.id));
  assert.equal(isArrayCenterPointEntity(center, definition.id), true);
  assert.equal(center.composite.kind, 'array-center');

  const solver = new SolverController();
  solver.addEntity(center);
  solver.addEntity({ id: 'target', type: 'line', start: [10, 15], end: [50, 15] });
  assert.ok(solver.addConstraint({
    type: 'Fixed',
    featureRefs: [{ kind: 'point', recordId: 'target', index: 0 }],
  }).constraint);
  const outcome = solver.addConstraint({
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: center.id, index: 0 },
      { kind: 'point', recordId: 'target', index: 0 },
    ],
  });

  assert.ok(outcome.constraint);
  assert.ok(['converged', 'unchanged'].includes(outcome.result.status), outcome.result.message);
  assert.deepEqual(solver.getEntity(center.id).point.map((value) => Math.round(value)), [10, 15]);
});

test('a circular array center accepts a driving point-to-point dimension', () => {
  const definition = normalizeArrayDefinition({
    id: 'dimensioned-array',
    arrayType: 'circular',
    sourceIds: ['shape-1'],
    centerPoint: [30, 40],
  });
  const center = createArrayCenterPointEntity(definition, definition.centerPoint);
  const solver = new SolverController();
  solver.addEntity(center);
  solver.addEntity({ id: 'target', type: 'line', start: [10, 15], end: [50, 15] });
  solver.addConstraint({
    type: 'Fixed',
    featureRefs: [{ kind: 'point', recordId: 'target', index: 0 }],
  });
  const dimension = solver.addDimension({
    type: 'dimension-line',
    dimensionMode: 'driving',
    subtype: 'horizontal',
    start: [10, 15],
    end: [30, 40],
    measureStart: [10, 15],
    measureEnd: [30, 40],
    label: [20, 50],
    text: '',
    anchors: {
      start: { type: 'point', recordId: 'target', index: 0 },
      end: { type: 'point', recordId: center.id, index: 0 },
      measureStart: { type: 'point', recordId: 'target', index: 0 },
      measureEnd: { type: 'point', recordId: center.id, index: 0 },
    },
  });

  assert.equal(dimension.entity.dimensionMode, 'driving');
  const outcome = solver.setDimension(dimension.entity.dimensionId, '25 mm');
  assert.ok(['converged', 'unchanged'].includes(outcome.status), outcome.message);
  assert.ok(Math.abs(Math.abs(solver.getEntity(center.id).point[0] - 10) - 25) < 1e-3);
});

test('partial circular arrays use the original as zero and a signed stop-angle sweep', () => {
  const result = evaluateArrayDefinition({
    arrayType: 'circular',
    sourceIds: ['shape-1'],
    countExpression: '3',
    fullCircle: false,
    stopAngleExpression: '-180',
    centerPoint: [0, 0],
  }, {
    sourceBounds: { x: 20, y: 10, width: 10, height: 10 },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.placements.map(({ angle }) => angle), [0, -90, -180]);
});

test('legacy circular arrays migrate away from radius and absolute start angle', () => {
  const migrated = migrateArrayDefinition({
    id: 'legacy-circle-array',
    arrayType: 'circular',
    sourceIds: ['shape-1'],
    radiusExpression: '50',
    fullCircle: false,
    startAngleExpression: '30',
    stopAngleExpression: '120',
    centerPoint: [0, 0],
  }, 2);

  assert.equal('radiusExpression' in migrated, false);
  assert.equal('startAngleExpression' in migrated, false);
  assert.equal(migrated.stopAngleExpression, '(120) - (30)');
});

test('array expressions resolve existing parameter names without creating parameters', () => {
  const values = { rows: 3, columns: 2, gap_x: 25, gap_y: 40 };
  const evaluate = (expression) => {
    const source = String(expression).trim();
    if (source in values) return values[source];
    return Number(source);
  };
  const result = evaluateArrayDefinition({
    id: 'array-1',
    arrayType: 'rectangular',
    sourceIds: ['shape-1'],
    rowCountExpression: 'rows',
    columnCountExpression: 'columns',
    rowSpacingExpression: 'gap_x',
    columnSpacingExpression: 'gap_y',
  }, {
    evaluateNumeric: evaluate,
    evaluateLength: evaluate,
    sourceBounds: { width: 30, height: 10 },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.values, {
    rowCount: 3,
    columnCount: 2,
    rowSpacing: 25,
    columnSpacing: 40,
  });
  assert.equal(result.placements.length, 6);
});

test('array expressions resolve real repository parameter names', () => {
  const parameters = new ParameterRepository();
  parameters.setDefaultLengthUnit('in');
  parameters.createUser({ name: 'columnCount', expression: '3' });
  parameters.createUser({ name: 'arrayGap', expression: '20' });
  const result = evaluateArrayDefinition({
    arrayType: 'rectangular',
    sourceIds: ['shape-1'],
    rowCountExpression: '2',
    columnCountExpression: 'columnCount',
    rowSpacingExpression: 'arrayGap',
    columnSpacingExpression: 'arrayGap',
  }, {
    evaluateNumeric: (expression) => valueInUnit(parameters.evaluateLengthExpression(expression), 'in'),
    evaluateLength: (expression) => parameters.evaluateLengthExpression(expression),
    sourceBounds: { width: 1524, height: 635 },
  });

  assert.equal(result.valid, true);
  assert.equal(result.values.columnCount, 3);
  assert.equal(result.values.rowSpacing, 508);
  assert.equal(result.placements.length, 6);
});

test('array validation rejects fractional counts and positive circular arrays without a center', () => {
  const rectangular = evaluateArrayDefinition({
    arrayType: 'rectangular',
    sourceIds: ['shape-1'],
    rowCountExpression: '2.5',
    columnCountExpression: '2',
    rowSpacingExpression: '10',
    columnSpacingExpression: '10',
  });
  assert.equal(rectangular.valid, false);
  assert.match(rectangular.errors.rowCount, /whole number/);

  const singlePosition = evaluateArrayDefinition({
    arrayType: 'rectangular',
    sourceIds: ['shape-1'],
    rowCountExpression: '1',
    columnCountExpression: '1',
    rowSpacingExpression: '10',
    columnSpacingExpression: '10',
  });
  assert.equal(singlePosition.valid, true);
  assert.equal(singlePosition.placements.length, 1);

  const circular = evaluateArrayDefinition({
    arrayType: 'circular',
    sourceIds: ['shape-1'],
    countExpression: '6',
  }, {
    sourceBounds: { x: 0, y: 0, width: 20, height: 20 },
  });
  assert.equal(circular.valid, false);
  assert.match(circular.errors.center, /center point/);

  const oneCircularPosition = evaluateArrayDefinition({
    arrayType: 'circular',
    sourceIds: ['shape-1'],
    countExpression: '1',
    centerPoint: [0, 0],
  }, {
    sourceBounds: { x: 20, y: 0, width: 10, height: 10 },
  });
  assert.equal(oneCircularPosition.valid, true);
  assert.equal(oneCircularPosition.placements.length, 1);
});

test('drawing I/O preserves, remaps, and merges array extension data', () => {
  const base = normalizeDrawingData({
    entities: [{ id: 'base-shape', type: 'line', start: [0, 0], end: [10, 0] }],
    parameters: [{ id: 'base-dimension', name: 'd1', kind: 'dimension', expression: '10', value: 10 }],
    extensions: {
      arrayTools: {
        version: 1,
        arrays: [{
          id: 'base-array',
          arrayType: 'rectangular',
          sourceIds: ['base-shape'],
          rowSpacingExpression: 'd1',
        }],
      },
    },
  });
  const inserted = normalizeDrawingData({
    entities: [{ id: 'inserted-shape', type: 'line', start: [0, 0], end: [5, 0] }],
    parameters: [{ id: 'inserted-dimension', name: 'd1', kind: 'dimension', expression: '5', value: 5 }],
    extensions: {
      arrayTools: {
        version: 1,
        arrays: [{
          id: 'inserted-array',
          arrayType: 'rectangular',
          sourceIds: ['inserted-shape'],
          rowSpacingExpression: 'd1 * 2',
        }],
      },
    },
  });

  const merged = mergeDrawingData(base, inserted);
  const arrays = merged.extensions.arrayTools.arrays;
  const insertedArray = arrays[1];
  assert.equal(arrays.length, 2);
  assert.notEqual(insertedArray.id, 'inserted-array');
  assert.notEqual(insertedArray.sourceIds[0], 'inserted-shape');
  assert.equal(insertedArray.sourceIds[0], merged.entities[1].id);
  assert.equal(insertedArray.rowSpacingExpression, 'd2 * 2');
});
