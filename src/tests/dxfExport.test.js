import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DXF_EXPORT_SOLVE_TOLERANCE,
  createDrawingDxfSnapshot,
  createStackDxfSnapshot,
  prepareDxfExportGeometry,
} from '../../packages/paramagic-core/src/modules/DxfExport.js';
import {
  DXF_BOUNDARY_ENTITY_TYPE,
  drawingCurveToDxfSegments,
} from '../../packages/paramagic-core/src/modules/DxfExportGeometry.js';
import { parseDxf, resolveDrawingScene, serializeDxf } from '../../packages/paramagic-core/src/modules/DrawingIO.js';
import { DXF_DIMENSION_STYLE } from '../../packages/paramagic-core/src/modules/DxfDimensionExport.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { withSwellDefinition } from '../../packages/paramagic-core/src/modules/SwellGeometry.js';

const exportDxf = (drawing) => serializeDxf(createDrawingDxfSnapshot(drawing));
const unit = (point) => {
  const size = Math.hypot(point[0], point[1]);
  return size ? [point[0] / size, point[1] / size] : [0, 0];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const perpendicular = (point) => [-point[1], point[0]];
const closePoint = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) <= tolerance);
};

test('DXF export requires a successful full solve at 1e-8', () => {
  let solveOptions = null;
  const result = prepareDxfExportGeometry((options) => {
    solveOptions = options;
    return { status: 'converged' };
  });

  assert.equal(DXF_EXPORT_SOLVE_TOLERANCE, 1e-8);
  assert.deepEqual(solveOptions, {
    fullSolve: true,
    solveMode: 'final',
    tolerance: 1e-8,
  });
  assert.equal(result.status, 'converged');
  assert.throws(
    () => prepareDxfExportGeometry(() => ({ status: 'max-iterations', message: 'still inaccurate' })),
    /still inaccurate/,
  );
});

test('DXF preparation refines geometry that a normal 1e-3 solve accepts', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'export-line', type: 'line', start: [0, 0], end: [10, 0] });
  assert.ok(controller.addConstraint({
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'export-line', index: 0 }],
  }).constraint);
  controller.model.variableById('export-line:end.y').value = 5e-4;

  const normalResult = controller.solve({ fullSolve: true });
  assert.equal(normalResult.status, 'unchanged');
  assert.equal(controller.getEntity('export-line').end[1], 5e-4);

  const exportResult = prepareDxfExportGeometry(controller.solve.bind(controller));
  assert.equal(exportResult.status, 'converged');
  const solved = controller.getEntity('export-line');
  assert.ok(Math.abs(solved.end[1] - solved.start[1]) < 1e-8);
});

function arcDirection(segment, atEnd) {
  const point = atEnd ? segment.end : segment.start;
  const radial = unit(subtract(point, segment.center));
  const startAngle = Math.atan2(
    segment.start[1] - segment.center[1],
    segment.start[0] - segment.center[0],
  );
  const middleAngle = Math.atan2(
    segment.arcPoint[1] - segment.center[1],
    segment.arcPoint[0] - segment.center[0],
  );
  const endAngle = Math.atan2(
    segment.end[1] - segment.center[1],
    segment.end[0] - segment.center[0],
  );
  const normalize = (angle) => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const ccw = normalize(middleAngle - startAngle) <= normalize(endAngle - startAngle) + 1e-9;
  return ccw ? perpendicular(radial) : unit([radial[1], -radial[0]]);
}

function segmentDirection(segment, atEnd) {
  return segment.type === 'arc'
    ? arcDirection(segment, atEnd)
    : unit(subtract(segment.end, segment.start));
}

function lwPolylineBlocks(dxf) {
  const lines = dxf.replace(/\r/g, '').split('\n');
  const pairs = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    pairs.push([lines[index], lines[index + 1]]);
  }
  const blocks = [];
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index][0] !== '0' || pairs[index][1] !== 'LWPOLYLINE') continue;
    let end = index + 1;
    while (end < pairs.length && pairs[end][0] !== '0') end += 1;
    blocks.push(pairs.slice(index, end).flat().join('\n'));
    index = end - 1;
  }
  return blocks;
}

function entityBlocks(dxf, entityType) {
  const lines = dxf.replace(/\r/g, '').split('\n');
  const pairs = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    pairs.push([lines[index], lines[index + 1]]);
  }
  const blocks = [];
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index][0] !== '0' || pairs[index][1] !== entityType) continue;
    let end = index + 1;
    while (end < pairs.length && pairs[end][0] !== '0') end += 1;
    blocks.push(pairs.slice(index, end).flat().join('\n'));
    index = end - 1;
  }
  return blocks;
}

const namedEntityBlock = (dxf, entityType, name) => entityBlocks(dxf, entityType)
  .find((block) => block.includes(`\n2\n${name}\n`));

function bulges(block) {
  return [...block.matchAll(/\n42\n([^\n]+)/g)].map((match) => Number(match[1]));
}

test('closed rectangles export as one closed LWPOLYLINE while circles remain circles', () => {
  const dxf = exportDxf({
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    entities: [
      { id: 'rectangle', type: 'rect', x: 0, y: 0, width: 100, height: 60 },
      { id: 'circle', type: 'circle', center: [150, 30], radius: 20 },
    ],
  });

  const blocks = lwPolylineBlocks(dxf);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /\n90\n4\n70\n1\n/);
  assert.equal(bulges(blocks[0]).every((value) => value === 0), true);
  assert.equal((dxf.match(/\nCIRCLE\n/g) || []).length, 1);
  assert.equal((dxf.match(/\nLINE\n/g) || []).length, 0);
});

test('a closed mixed line and arc object becomes one bulged LWPOLYLINE without duplicate edges', () => {
  const composite = { id: 'arched-panel', kind: 'polyline', closed: true, count: 2 };
  const dxf = exportDxf({
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    entities: [
      {
        id: 'arched-edge', type: 'arc',
        start: [-50, 0], arcPoint: [0, -50], end: [50, 0],
        center: [0, 0], radius: 50,
        composite: { ...composite, index: 0 },
      },
      {
        id: 'straight-edge', type: 'line', start: [50, 0], end: [-50, 0],
        composite: { ...composite, index: 1 },
      },
    ],
  });

  const blocks = lwPolylineBlocks(dxf);
  assert.equal(blocks.length, 1);
  assert.equal(bulges(blocks[0]).length, 2);
  assert.ok(bulges(blocks[0]).some((value) => Math.abs(value) > 0.9));
  assert.equal((dxf.match(/\nARC\n/g) || []).length, 0);
  assert.equal((dxf.match(/\nLINE\n/g) || []).length, 0);

  const restored = parseDxf(dxf);
  assert.equal(restored.entities.length, 2);
  assert.equal(restored.entities.some(({ type }) => type === 'arc'), true);
  assert.equal(restored.entities.every(({ composite: value }) => value?.closed === true), true);
});

test('drawing curves use a reduced global chain of endpoint- and join-tangent biarcs', () => {
  const points = [[50, 0], [25, 55], [-25, 55], [-50, 0]];
  const segments = drawingCurveToDxfSegments(points);

  assert.ok(segments.length >= 2);
  assert.ok(segments.length <= 12);
  assert.equal(segments.some(({ type }) => type === 'arc'), true);
  closePoint(segments[0].start, points[0]);
  closePoint(segments.at(-1).end, points.at(-1));
  for (let index = 1; index < segments.length; index += 1) {
    closePoint(segments[index - 1].end, segments[index].start);
    assert.ok(dot(
      segmentDirection(segments[index - 1], true),
      segmentDirection(segments[index], false),
    ) > 0.999);
  }

  const composite = { id: 'curved-panel', kind: 'polyline', closed: true, count: 2 };
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    entities: [
      {
        id: 'curve', type: 'curve', points,
        composite: { ...composite, index: 0 },
      },
      {
        id: 'base', type: 'line', start: [-50, 0], end: [50, 0],
        composite: { ...composite, index: 1 },
      },
    ],
  });
  assert.equal(snapshot.entities.length, 1);
  assert.equal(snapshot.entities[0].type, DXF_BOUNDARY_ENTITY_TYPE);

  const dxf = serializeDxf(snapshot);
  const blocks = lwPolylineBlocks(dxf);
  assert.equal(blocks.length, 1);
  assert.ok(bulges(blocks[0]).filter((value) => Math.abs(value) > 1e-8).length >= 2);
  assert.equal((dxf.match(/\nARC\n/g) || []).length, 0);
});

test('array and symmetric copies retain separate closed boundaries with reflected arc direction', () => {
  const composite = { id: 'source-panel', kind: 'polyline', closed: true, count: 2 };
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    entities: [
      {
        id: 'arc', type: 'arc', stackId: 'source-stack',
        start: [0, 0], arcPoint: [5, -5], end: [10, 0], center: [5, 0], radius: 5,
        composite: { ...composite, index: 0 },
      },
      {
        id: 'line', type: 'line', stackId: 'source-stack',
        start: [10, 0], end: [0, 0],
        composite: { ...composite, index: 1 },
      },
      {
        id: 'mirror', type: 'line', stackId: 'mirror-stack', construction: true,
        start: [20, -20], end: [20, 20],
        composite: { kind: 'symmetric-centerline', sourceIds: ['arc', 'line'] },
      },
    ],
    extensions: {
      arrayTools: {
        version: 4,
        arrays: [{
          id: 'array', stackId: 'array-stack', arrayType: 'rectangular',
          sourceIds: ['arc', 'line'],
          rowCountExpression: '1', columnCountExpression: '2',
          rowSpacingExpression: '0', columnSpacingExpression: '20',
          rowDirection: 'down', columnDirection: 'right',
        }],
      },
    },
  });

  assert.equal(snapshot.entities.length, 3);
  assert.equal(
    snapshot.entities.filter(({ type }) => type === DXF_BOUNDARY_ENTITY_TYPE).length,
    3,
  );
  assert.equal(
    snapshot.entities.some((entity) => entity.composite?.kind === 'symmetric-centerline'),
    false,
  );
  const blocks = lwPolylineBlocks(serializeDxf(snapshot));
  assert.equal(blocks.length, 3);
  const curvedBulges = blocks.map((block) => bulges(block).find((value) => Math.abs(value) > 1e-8));
  assert.equal(curvedBulges.filter((value) => value > 0).length > 0, true);
  assert.equal(curvedBulges.filter((value) => value < 0).length > 0, true);
});

test('constraint-connected loops resolve before export IDs are flattened', () => {
  const point = (recordId, index) => ({ kind: 'point', recordId, index });
  const coincident = (id, first, second) => ({
    id,
    type: 'Coincident',
    featureRefs: [first, second],
    enabled: true,
  });
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    entities: [
      { id: 'top', type: 'line', start: [0, 0], end: [40, 0] },
      { id: 'right', type: 'line', start: [40, 0], end: [40, 30] },
      { id: 'bottom', type: 'line', start: [40, 30], end: [0, 30] },
      { id: 'left', type: 'line', start: [0, 30], end: [0, 0] },
    ],
    constraints: [
      coincident('a', point('top', 2), point('right', 0)),
      coincident('b', point('right', 2), point('bottom', 0)),
      coincident('c', point('bottom', 2), point('left', 0)),
      coincident('d', point('left', 2), point('top', 0)),
    ],
  });

  assert.equal(snapshot.entities.length, 1);
  assert.equal(snapshot.entities[0].type, DXF_BOUNDARY_ENTITY_TYPE);
  assert.equal(lwPolylineBlocks(serializeDxf(snapshot)).length, 1);
});

test('V2 closed seam lines are materialized before their source IDs are replaced', () => {
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    entities: [{ id: 'shape', type: 'rect', x: 0, y: 0, width: 100, height: 80 }],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{
          regionId: 'shape',
          recordIds: ['shape'],
          defaultEnabled: true,
          overrides: [],
        }],
      },
    },
  });
  const dxf = serializeDxf(snapshot);
  const blocks = lwPolylineBlocks(dxf);

  assert.equal(blocks.length, 2);
  assert.equal(blocks.some((block) => block.includes('8\nSeam Lines')), true);
  assert.equal(blocks.every((block) => block.includes('70\n1')), true);
});

test('fillets become bulged members of their closed LWPOLYLINE instead of separate arcs', () => {
  const composite = { id: 'rounded-panel', kind: 'rectangle', closed: true, count: 4 };
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    entities: [
      {
        id: 'top', type: 'line', start: [0, 0], end: [100, 0],
        composite: { ...composite, index: 0 },
      },
      {
        id: 'right', type: 'line', start: [100, 0], end: [100, 60],
        composite: { ...composite, index: 1 },
      },
      {
        id: 'bottom', type: 'line', start: [100, 60], end: [0, 60],
        composite: { ...composite, index: 2 },
      },
      {
        id: 'left', type: 'line', start: [0, 60], end: [0, 0],
        composite: { ...composite, index: 3 },
      },
      {
        id: 'fillet', type: 'fillet', radius: 10,
        sourceA: { recordId: 'top', index: 2 },
        sourceB: { recordId: 'right', index: 0 },
      },
    ],
  });
  const dxf = serializeDxf(snapshot);
  const blocks = lwPolylineBlocks(dxf);

  assert.equal(snapshot.entities.length, 1);
  assert.equal(blocks.length, 1);
  assert.equal(bulges(blocks[0]).some((value) => Math.abs(value) > 1e-8), true);
  assert.equal((dxf.match(/\nARC\n/g) || []).length, 0);
  assert.equal((dxf.match(/\nLINE\n/g) || []).length, 0);
});

test('per-stack DXF snapshots flatten derived copies and exclude the symmetry construction line', () => {
  const arraySnapshot = {
    drawingUnit: 'mm',
    entities: [{ id: 'source', type: 'line', start: [0, 0], end: [10, 0], stackId: 'source-stack' }],
    extensions: {
      arrayTools: {
        version: 4,
        arrays: [{
          id: 'array', stackId: 'array-stack', arrayType: 'rectangular', sourceIds: ['source'],
          rowCountExpression: '1', columnCountExpression: '2',
          rowSpacingExpression: '0', columnSpacingExpression: '10',
          rowDirection: 'down', columnDirection: 'right',
        }],
      },
    },
  };
  const arrayExport = createStackDxfSnapshot(arraySnapshot, 'array-stack');
  assert.equal(arrayExport.entities.length, 1);
  assert.deepEqual(arrayExport.entities[0].start, [20, 0]);
  assert.deepEqual(arrayExport.entities[0].end, [30, 0]);

  const mirrorExport = createStackDxfSnapshot({
    drawingUnit: 'mm',
    entities: [
      ...arraySnapshot.entities,
      {
        id: 'centerline', type: 'line', construction: true, stackId: 'mirror-stack',
        start: [20, -10], end: [20, 10],
        composite: { kind: 'symmetric-centerline', sourceIds: ['source'] },
      },
    ],
  }, 'mirror-stack');
  assert.equal(mirrorExport.entities.length, 1);
  const mirrored = mirrorExport.entities.find(
    (entity) => entity.composite?.kind !== 'symmetric-centerline',
  );
  assert.deepEqual(mirrored.start, [40, 0]);
  assert.deepEqual(mirrored.end, [30, 0]);
});

test('whole-drawing snapshots preserve every circular-array placement through serialization', () => {
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    entities: [{ id: 'source', type: 'line', start: [10, 0], end: [20, 0] }],
    extensions: {
      arrayTools: {
        version: 4,
        arrays: [{
          id: 'circular-array', stackId: 'stack-default', arrayType: 'circular',
          sourceIds: ['source'], countExpression: '4', fullCircle: true,
          centerPoint: [0, 0], centerRef: null,
        }],
      },
    },
  });
  const restored = parseDxf(serializeDxf(snapshot));
  const coordinateKeys = new Set(restored.entities.map(({ start, end }) => [start, end]
    .map(([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`)
    .sort()
    .join('|')));

  assert.equal(restored.entities.length, 4);
  assert.equal(coordinateKeys.size, 4);
});

test('DXF and thumbnail scenes share unit-aware dimensional array counts', () => {
  const drawing = {
    drawingUnit: 'in',
    entities: [
      { id: 'source', type: 'line', start: [0, 0], end: [25.4, 0] },
    ],
    parameters: [{
      id: 'control-width',
      name: 'c4',
      expression: 'MinMax(16, 52, 20.5, 0.5)',
      value: 520.7,
      kind: 'control',
      driving: false,
      computed: false,
      unit: null,
      usesDrawingUnit: true,
      order: 1,
    }],
    extensions: {
      arrayTools: {
        version: 4,
        arrays: [{
          id: 'dimensional-count-array',
          stackId: 'stack-default',
          arrayType: 'rectangular',
          sourceIds: ['source'],
          rowCountExpression: '1',
          columnCountExpression: 'round(max(4,c4/2)/2)*2',
          rowSpacingExpression: '0',
          columnSpacingExpression: '0',
          rowDirection: 'down',
          columnDirection: 'right',
        }],
      },
    },
  };

  const scene = resolveDrawingScene(drawing);
  const snapshot = createDrawingDxfSnapshot(drawing);

  assert.equal(scene.entities.filter(({ type }) => type === 'line').length, 10);
  assert.equal(snapshot.entities.filter(({ type }) => type === 'line').length, 10);
});

test('DXF snapshots exclude construction geometry and symmetry centerlines', () => {
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    entities: [
      {
        id: 'guide', type: 'line', construction: true,
        start: [0, 0], end: [20, 0],
      },
      {
        id: 'source', type: 'line', stackId: 'source-stack',
        start: [5, 5], end: [15, 5],
      },
      {
        id: 'symmetry', type: 'line', stackId: 'mirror-stack',
        start: [30, -10], end: [30, 10],
        composite: { kind: 'symmetric-centerline', sourceIds: ['source'] },
      },
    ],
  });
  const dxf = serializeDxf(snapshot);

  const constructionLayer = namedEntityBlock(dxf, 'LAYER', 'Construction');
  assert.equal(constructionLayer, undefined);
  const lineBlocks = entityBlocks(dxf, 'LINE');
  assert.equal(lineBlocks.filter((block) => block.includes('\n8\nConstruction\n')).length, 0);
  assert.equal(lineBlocks.filter((block) => block.includes('\n8\n0\n')).length, 2);
});

test('standalone drawing-tool curves export as open tangent-arc LWPOLYLINE entities', () => {
  const dxf = exportDxf({
    drawingUnit: 'mm',
    entities: [{
      id: 'open-curve',
      type: 'curve',
      points: [[0, 0], [30, -50], [70, -50], [100, 0]],
    }],
  });
  const blocks = lwPolylineBlocks(dxf);

  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /\n70\n0\n/);
  assert.ok(bulges(blocks[0]).some((value) => Math.abs(value) > 1e-8));
  assert.equal((dxf.match(/\nARC\n/g) || []).length, 0);
});

test('DXF snapshots exclude construction curves and closed construction cycles', () => {
  const composite = { id: 'construction-loop', kind: 'polyline', closed: true, count: 2 };
  const dxf = exportDxf({
    drawingUnit: 'mm',
    entities: [
      {
        id: 'construction-curve',
        type: 'curve',
        construction: true,
        points: [[50, 0], [0, 50], [-50, 0]],
        composite: { ...composite, index: 0 },
      },
      {
        id: 'construction-base',
        type: 'line',
        construction: true,
        start: [-50, 0],
        end: [50, 0],
        composite: { ...composite, index: 1 },
      },
    ],
  });
  const blocks = lwPolylineBlocks(dxf);

  assert.equal(blocks.length, 0);
  assert.doesNotMatch(dxf, /\nConstruction\n/);
  assert.equal((dxf.match(/\nLINE\n/g) || []).length, 0);
});

test('intersecting Boolean operands export only their final closed LWPOLYLINE contour', () => {
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    entities: [
      { id: 'target', type: 'rect', x: 0, y: 0, width: 100, height: 80 },
      {
        id: 'cutter',
        type: 'rect',
        x: 70,
        y: 20,
        width: 50,
        height: 40,
        subtract: true,
        subtractExpression: 'TRUE',
      },
    ],
  });
  const dxf = serializeDxf(snapshot);
  const blocks = lwPolylineBlocks(dxf);

  assert.equal(snapshot.entities.length, 1);
  assert.equal(snapshot.entities[0].booleanResult, true);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /\n70\n1\n/);
  assert.equal((dxf.match(/\nLINE\n/g) || []).length, 0);
  assert.equal((dxf.match(/\nCIRCLE\n/g) || []).length, 0);
});

test('an enclosed circular Boolean cut exports separate closed outer and hole LWPOLYLINE contours', () => {
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    entities: [
      { id: 'target', type: 'rect', x: 0, y: 0, width: 120, height: 80 },
      {
        id: 'hole',
        type: 'circle',
        center: [60, 40],
        radius: 15,
        subtract: true,
        subtractExpression: 'TRUE',
      },
    ],
  });
  const dxf = serializeDxf(snapshot);
  const blocks = lwPolylineBlocks(dxf);

  assert.equal(snapshot.entities.length, 2);
  assert.equal(snapshot.entities.every(({ booleanResult }) => booleanResult === true), true);
  assert.equal(blocks.length, 2);
  assert.equal(blocks.every((block) => block.includes('70\n1')), true);
  assert.equal((dxf.match(/\nCIRCLE\n/g) || []).length, 0);
});

test('array children reuse the final Boolean outer and hole contours', () => {
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    entities: [
      { id: 'target', type: 'rect', x: 0, y: 0, width: 100, height: 60 },
      {
        id: 'hole',
        type: 'circle',
        center: [30, 30],
        radius: 10,
        subtract: true,
        subtractExpression: 'TRUE',
      },
    ],
    extensions: {
      arrayTools: {
        version: 4,
        arrays: [{
          id: 'boolean-array',
          stackId: 'stack-default',
          arrayType: 'rectangular',
          sourceIds: ['target'],
          rowCountExpression: '1',
          columnCountExpression: '2',
          rowSpacingExpression: '0',
          columnSpacingExpression: '20',
          rowDirection: 'down',
          columnDirection: 'right',
        }],
      },
    },
  });
  const boundaries = snapshot.entities.filter(({ type }) => type === DXF_BOUNDARY_ENTITY_TYPE);

  assert.equal(boundaries.length, 4);
  assert.equal(boundaries.every(({ booleanResult }) => booleanResult === true), true);
  assert.deepEqual(
    boundaries.map(({ segments }) => segments.length).sort((a, b) => a - b),
    [2, 2, 4, 4],
  );
  assert.equal(lwPolylineBlocks(serializeDxf(snapshot)).length, 4);
});

test('symmetric children reuse the reflected final Boolean outer and hole contours', () => {
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    entities: [
      { id: 'target', type: 'rect', x: 0, y: 0, width: 100, height: 60 },
      {
        id: 'hole',
        type: 'circle',
        center: [30, 30],
        radius: 10,
        subtract: true,
        subtractExpression: 'TRUE',
      },
      {
        id: 'symmetry',
        type: 'line',
        construction: true,
        start: [150, -20],
        end: [150, 80],
        composite: { kind: 'symmetric-centerline', sourceIds: ['target'] },
      },
    ],
  });
  const boundaries = snapshot.entities.filter(({ type }) => type === DXF_BOUNDARY_ENTITY_TYPE);

  assert.equal(boundaries.length, 4);
  assert.equal(boundaries.every(({ booleanResult }) => booleanResult === true), true);
  assert.deepEqual(
    boundaries.map(({ segments }) => segments.length).sort((a, b) => a - b),
    [2, 2, 4, 4],
  );
  assert.equal(
    snapshot.entities.some((entity) => entity.composite?.kind === 'symmetric-centerline'),
    false,
  );
  assert.equal(lwPolylineBlocks(serializeDxf(snapshot)).length, 4);
});

test('Boolean Seam Line contours follow both array and symmetric final-shape children', () => {
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    entities: [
      { id: 'target', type: 'rect', x: 0, y: 0, width: 120, height: 80 },
      {
        id: 'hole',
        type: 'circle',
        center: [60, 40],
        radius: 15,
        subtract: true,
        subtractExpression: 'TRUE',
      },
      {
        id: 'symmetry',
        type: 'line',
        construction: true,
        start: [300, -20],
        end: [300, 100],
        composite: { kind: 'symmetric-centerline', sourceIds: ['target'] },
      },
    ],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{
          regionId: 'target',
          recordIds: ['target'],
          defaultEnabled: true,
          overrides: [],
        }],
      },
      arrayTools: {
        version: 4,
        arrays: [{
          id: 'boolean-seam-array',
          stackId: 'stack-default',
          arrayType: 'rectangular',
          sourceIds: ['target'],
          rowCountExpression: '1',
          columnCountExpression: '2',
          rowSpacingExpression: '0',
          columnSpacingExpression: '20',
          rowDirection: 'down',
          columnDirection: 'right',
        }],
      },
    },
  });
  const seams = snapshot.entities.filter(
    (entity) => entity.composite?.kind === 'finish-size-offset',
  );

  assert.equal(seams.length, 9);
  assert.equal(
    seams.every((entity) => (
      entity.composite.sourceFeatures.some(({ boundaryRole }) => boundaryRole === 'outer')
      || entity.composite.sourceFeatures.some(({ boundaryRole }) => boundaryRole === 'subtract')
    )),
    true,
  );
  assert.equal(
    lwPolylineBlocks(serializeDxf(snapshot))
      .filter((block) => block.includes('\n8\nSeam Lines\n')).length,
    9,
  );
});

test('single-line text exports as aligned TEXT on a continuous Text layer with physical unit scaling', () => {
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    dxfExportUnit: 'in',
    entities: [{
      id: 'single-line',
      type: 'text',
      stackId: 'stack-default',
      x: 25.4,
      y: 50.8,
      text: 'Pattern label',
      fontName: 'Times New Roman',
      fontSize: 96,
      scaleWithZoom: false,
      multiline: false,
      textAlign: 'center',
    }],
  });
  const dxf = serializeDxf(snapshot);
  const blocks = entityBlocks(dxf, 'TEXT');

  assert.equal(snapshot.entities.length, 1);
  assert.ok(Math.abs(snapshot.entities[0].textHeight - 25.4) < 1e-12);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /\n8\nText\n/);
  assert.match(blocks[0], /\n10\n1\n20\n-2\n40\n1\n1\nPattern label\n/);
  assert.match(blocks[0], /\n72\n1\n/);
  assert.match(blocks[0], /\n100\nAcDbText\n73\n3$/);
  assert.equal(entityBlocks(dxf, 'MTEXT').length, 0);
  const textLayer = namedEntityBlock(dxf, 'LAYER', 'Text');
  assert.ok(textLayer);
  assert.match(textLayer, /\n62\n7\n6\nCONTINUOUS\n370\n-3\n390\n[0-9A-F]+$/);
  const timesStyle = namedEntityBlock(dxf, 'STYLE', 'TIMES_NEW_ROMAN');
  assert.ok(timesStyle);
  assert.match(timesStyle, /\n3\ntimes\.ttf\n/);
});

test('multiline text exports as MTEXT with explicit height, paragraphs, fields, and top-right attachment', () => {
  const snapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    parameters: [{
      id: 'width-parameter',
      name: 'width',
      kind: 'user',
      value: 25.4,
      expression: '25.4',
    }],
    entities: [{
      id: 'multiline',
      type: 'text',
      x: 100,
      y: 40,
      text: '[width]\n{Back} \\ panel',
      fontName: 'Arial',
      fontSize: 14,
      textHeight: 5,
      scaleWithZoom: true,
      multiline: true,
      textAlign: 'right',
    }],
  });
  const dxf = serializeDxf(snapshot);
  const blocks = entityBlocks(dxf, 'MTEXT');

  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /\n8\nText\n/);
  assert.match(blocks[0], /\n10\n100\n20\n-40\n40\n5\n/);
  assert.match(blocks[0], /\n71\n3\n72\n1\n/);
  assert.match(blocks[0], /\n1\n25\.4\\P\\\{Back\\\} \\\\ panel\n44\n1\.25$/);
  assert.equal(entityBlocks(dxf, 'TEXT').length, 0);
});

test('driven dimensions export as native DXF dimensions on the Dimensions layer', () => {
  const dxf = exportDxf({
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    entities: [],
    dimensionAnnotations: [
      {
        id: 'aligned',
        type: 'dimension-line',
        dimensionMode: 'driven',
        start: [0, 0],
        end: [60, 40],
        measureStart: [0, 0],
        measureEnd: [60, 40],
        label: [20, -25],
        text: 'd1 = 72.111 mm',
      },
      {
        id: 'horizontal',
        type: 'dimension-line',
        subtype: 'horizontal',
        dimensionMode: 'driven',
        start: [0, 0],
        end: [100, 0],
        measureStart: [0, 0],
        measureEnd: [100, 0],
        label: [50, -30],
        text: 'd2 = 100 mm',
      },
      {
        id: 'vertical',
        type: 'dimension-line',
        subtype: 'vertical',
        dimensionMode: 'driven',
        start: [0, 0],
        end: [0, 80],
        measureStart: [0, 0],
        measureEnd: [0, 80],
        label: [-30, 40],
        text: 'd3 = 80 mm',
      },
      {
        id: 'radius',
        type: 'radius-dimension',
        dimensionMode: 'driven',
        center: [150, 40],
        radius: 20,
        elbow: [180, 10],
        label: [180, 10],
        text: 'd4 = 20 mm',
      },
      {
        id: 'diameter',
        type: 'radius-dimension',
        subtype: 'diameter',
        dimensionMode: 'driven',
        center: [195, 40],
        radius: 20,
        elbow: [225, 10],
        label: [225, 10],
        text: 'd5 = 40 mm',
      },
      {
        id: 'angle',
        type: 'angle-dimension',
        dimensionMode: 'driven',
        vertex: [220, 60],
        start: [260, 60],
        end: [220, 20],
        radius: 30,
        label: [245, 35],
        text: 'd5 = 90°',
      },
      {
        id: 'multi-length',
        type: 'multi-curve-length-dimension',
        dimensionMode: 'driven',
        target: [300, 0],
        elbow: [320, -20],
        label: [340, -20],
        text: 'MCL = 125 mm',
      },
      {
        id: 'driving',
        type: 'dimension-line',
        subtype: 'horizontal',
        dimensionMode: 'driving',
        start: [0, 100],
        end: [100, 100],
        measureStart: [0, 100],
        measureEnd: [100, 100],
        label: [50, 125],
        text: 'driving-only',
      },
    ],
  });
  const dimensions = entityBlocks(dxf, 'DIMENSION');

  assert.equal(dimensions.length, 6);
  assert.equal(dimensions.every((block) => block.includes('\n8\nDimensions\n')), true);
  assert.equal(dimensions.every((block) => block.includes('\n1\n<>\n3\nPARAMAGIC\n')), true);
  assert.equal(dimensions.filter((block) => block.includes('\n70\n161\n')).length, 1);
  assert.equal(dimensions.filter((block) => block.includes('\n70\n160\n')).length, 2);
  assert.equal(dimensions.filter((block) => block.includes('\n70\n164\n')).length, 1);
  assert.equal(dimensions.filter((block) => block.includes('\n70\n163\n')).length, 1);
  assert.equal(dimensions.filter((block) => block.includes('\n70\n165\n')).length, 1);
  assert.equal(dimensions.filter((block) => block.includes('\n100\nAcDbDiametricDimension\n')).length, 1);
  assert.equal(dimensions.filter((block) => block.includes('\n100\nAcDb3PointAngularDimension\n')).length, 1);
  const dimensionsLayer = namedEntityBlock(dxf, 'LAYER', 'Dimensions');
  assert.ok(dimensionsLayer);
  assert.match(dimensionsLayer, /\n62\n5\n6\nCONTINUOUS\n370\n-3\n390\n[0-9A-F]+$/);
  assert.ok(namedEntityBlock(dxf, 'DIMSTYLE', DXF_DIMENSION_STYLE));
  assert.match(dxf, /\n78\n0\n79\n0\n179\n3\n271\n3\n/);
  assert.equal(entityBlocks(dxf, 'BLOCK').filter((block) => /\n2\n\*D\d+\n/.test(block)).length, 6);
  assert.match(dxf, /\n1\nPERIM 125\.000\n/);
  assert.doesNotMatch(dxf, /\n1\nPERIM 125\.000 mm\n/);
  assert.doesNotMatch(dxf, /driving-only/);
});

test('DXF export omits driven dimensions disabled for export', () => {
  const dxf = exportDxf({
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    entities: [],
    dimensionAnnotations: [
      {
        id: 'included-dimension',
        type: 'dimension-line',
        subtype: 'horizontal',
        dimensionMode: 'driven',
        start: [0, 0],
        end: [100, 0],
        measureStart: [0, 0],
        measureEnd: [100, 0],
        label: [50, -30],
        text: 'included-dimension',
      },
      {
        id: 'excluded-dimension',
        type: 'dimension-line',
        subtype: 'horizontal',
        dimensionMode: 'driven',
        excludeFromExport: true,
        start: [0, 20],
        end: [75, 20],
        measureStart: [0, 20],
        measureEnd: [75, 20],
        label: [37.5, 50],
        text: 'excluded-dimension',
      },
    ],
  });

  assert.equal(entityBlocks(dxf, 'DIMENSION').length, 1);
  assert.match(dxf, /included-dimension/);
  assert.doesNotMatch(dxf, /excluded-dimension/);
});

test('per-stack DXF export includes only driven dimensions owned by that stack', () => {
  const snapshot = createStackDxfSnapshot({
    drawingUnit: 'mm',
    entities: [
      { id: 'line-a', type: 'line', stackId: 'stack-a', start: [0, 0], end: [50, 0] },
      { id: 'line-b', type: 'line', stackId: 'stack-b', start: [0, 20], end: [75, 20] },
    ],
    dimensionAnnotations: [
      {
        id: 'dimension-a',
        type: 'dimension-line',
        dimensionMode: 'driven',
        stackId: 'stack-a',
        start: [0, 0],
        end: [50, 0],
        measureStart: [0, 0],
        measureEnd: [50, 0],
        label: [25, -20],
        text: 'stack-a-value',
      },
      {
        id: 'dimension-b',
        type: 'dimension-line',
        dimensionMode: 'driven',
        stackId: 'stack-b',
        start: [0, 20],
        end: [75, 20],
        measureStart: [0, 20],
        measureEnd: [75, 20],
        label: [37.5, 40],
        text: 'stack-b-value',
      },
    ],
  }, 'stack-a');
  const dxf = serializeDxf(snapshot);

  assert.equal(entityBlocks(dxf, 'DIMENSION').length, 1);
  assert.match(dxf, /stack-a-value/);
  assert.doesNotMatch(dxf, /stack-b-value/);
});

test('DXF export excludes construction parents and retains complete derived Swell geometry', () => {
  const source = withSwellDefinition({
    id: 'swell-line',
    type: 'line',
    start: [0, 0],
    end: [100, 0],
  }, {
    enabled: true,
    offsetExpression: '5',
    swellOffsetExpression: '15',
    startTransitionExpression: '20',
    endTransitionExpression: '20',
  });
  const scene = resolveDrawingScene({ drawingUnit: 'mm', entities: [source], constraints: [] });
  const derived = scene.entities.filter(({ composite }) => composite?.kind === 'swell-derived-presentation');
  assert.equal(scene.entities.some(({ id, construction }) => id === source.id && construction === true), true);
  assert.deepEqual(derived.map(({ type }) => type), ['arc', 'line', 'arc']);

  const snapshot = createDrawingDxfSnapshot({ drawingUnit: 'mm', dxfExportUnit: 'mm', entities: [source], constraints: [] });
  assert.equal(snapshot.entities.length, 3);
  assert.equal(snapshot.entities.filter(({ construction }) => construction === true).length, 0);
});
