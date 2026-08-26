import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSeamLineEntities,
  materializeSeamLineEntitiesForDrawing,
  migrateLegacySeamLineDrawing,
  migrateSeamLineDrawingToExplicitEdges,
  normalizeSeamLineExtension,
  refreshSeamLineSourceReferences,
  SEAM_LINE_INSET,
  seamLineEdgeKey,
  seamLineEdgeReference,
  seamLineFeatureKey,
  seamLineSourceReference,
} from '../../packages/paramagic-core/src/modules/SeamLineSystem.js';
import { withSwellDefinition } from '../../packages/paramagic-core/src/modules/SwellGeometry.js';

const inward = (_feature, _point) => [50, 50];

test('Seam Lines materialize from closed Swell offset boundaries', () => {
  const source = withSwellDefinition({
    id: 'swell-panel',
    type: 'rect',
    x: 0,
    y: 0,
    width: 30,
    height: 20,
  }, {
    offsetExpression: '1',
    swellOffsetExpression: '3',
    startTransitionExpression: '4',
    endTransitionExpression: '4',
  });
  const entities = materializeSeamLineEntitiesForDrawing({
    entities: [source],
    constraints: [],
    extensions: {
      seamLines: {
        definitions: [{
          regionId: source.composite.id,
          recordIds: [source.id],
          defaultEnabled: true,
          overrides: [],
        }],
      },
    },
  }, { evaluateLength: Number });

  assert.ok(entities.length > 0);
  assert.ok(entities.every((entity) => entity.composite?.kind === 'finish-size-offset'));
  assert.ok(entities.every((entity) => entity.composite?.sourceRecordIds?.includes(source.id)));
  assert.ok(entities.some((entity) => entity.composite?.sourceFeatures?.some((feature) => (
    feature.sourceId === source.id && String(feature.boundaryRole).startsWith('swell-')
  ))));
});

test('seam-line edge keys distinguish segments on the same closed object', () => {
  assert.notEqual(
    seamLineFeatureKey({ recordId: 'rect', kind: 'segment', index: 0 }),
    seamLineFeatureKey({ recordId: 'rect', kind: 'segment', index: 1 }),
  );
});

test('a durable Seam Line edge key survives arc-to-circle topology changes', () => {
  assert.equal(
    seamLineEdgeKey({ sourceId: 'shape', sourceFeatureIndex: 0, boundaryRole: 'outer', kind: 'arc' }),
    seamLineEdgeKey({ sourceId: 'shape', sourceFeatureIndex: 0, boundaryRole: 'outer', kind: 'circle' }),
  );
});

test('Seam Line source references retain a geometric edge anchor', () => {
  assert.deepEqual(
    seamLineSourceReference({
      recordId: 'shape',
      kind: 'segment',
      index: 7,
      start: [20, 10],
      end: [80, 10],
    }),
    {
      recordId: 'shape',
      kind: 'segment',
      index: 7,
      referencePoint: [50, 10],
    },
  );
});

test('derived Seam Line source references retain the source-edge parameter anchor', () => {
  assert.deepEqual(
    seamLineSourceReference({
      recordId: 'target',
      sourceId: 'cutter',
      sourceFeatureIndex: 2,
      boundaryRole: 'subtract',
      stableKey: 'target:cutter:subtract:2:0.2:0.8',
      kind: 'segment',
      index: 4,
      parameterStart: 0.2,
      parameterEnd: 0.8,
      start: [20, 10],
      end: [80, 10],
    }),
    {
      recordId: 'target',
      kind: 'segment',
      index: 4,
      sourceId: 'cutter',
      sourceFeatureIndex: 2,
      boundaryRole: 'subtract',
      stableKey: 'target:cutter:subtract:2:0.2:0.8',
      sourceParameter: 0.5,
      referencePoint: [50, 10],
    },
  );
});

test('Seam Line refresh preserves source identity while updating its edge anchor', () => {
  assert.deepEqual(
    refreshSeamLineSourceReferences(
      [{ recordId: 'source-edge', kind: 'segment', index: 0 }],
      [{
        recordId: 'shape',
        kind: 'segment',
        index: 7,
        start: [20, 10],
        end: [80, 10],
      }],
    ),
    [{
      recordId: 'source-edge',
      kind: 'segment',
      index: 0,
      referencePoint: [50, 10],
    }],
  );
});

test('connected selected edges become one miter-connected offset polyline', () => {
  const entities = createSeamLineEntities([
    { recordId: 'rect', kind: 'segment', index: 0, start: [0, 0], end: [100, 0] },
    { recordId: 'rect', kind: 'segment', index: 1, start: [100, 0], end: [100, 80] },
  ], inward);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].type, 'polyline');
  assert.deepEqual(entities[0].points, [[0, 12.7], [87.3, 12.7], [87.3, 80]]);
  assert.equal(entities[0].composite.kind, 'finish-size-offset');
});

test('an open offset edge stays parallel and extends to both parent-edge endpoints', () => {
  const [entity] = createSeamLineEntities([
    { recordId: 'rect', kind: 'segment', index: 0, start: [0, 0], end: [100, 0] },
  ], inward);
  assert.deepEqual(entity.points, [[0, 12.7], [100, 12.7]]);
});

test('an open offset edge is clipped where it meets neighboring closed-object edges', () => {
  const selected = { recordId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [100, 0] };
  const boundary = [
    selected,
    { recordId: 'shape', kind: 'segment', index: 1, start: [100, 0], end: [50, 80] },
    { recordId: 'shape', kind: 'segment', index: 2, start: [50, 80], end: [0, 0] },
  ];
  const [entity] = createSeamLineEntities(
    [selected],
    inward,
    12.7,
    () => boundary,
  );
  assert.deepEqual(entity.points, [[7.9375, 12.7], [92.0625, 12.7]]);
});

test('an open seam endpoint follows a moved finite boundary instead of an adjacent edge extension', () => {
  const selected = { recordId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [0, 100] };
  const createBoundary = (diagonalEnd) => [
    selected,
    { recordId: 'shape', kind: 'segment', index: 1, start: [0, 100], end: [10, 100] },
    { recordId: 'shape', kind: 'segment', index: 2, start: [10, 100], end: diagonalEnd },
    { recordId: 'shape', kind: 'segment', index: 3, start: diagonalEnd, end: [0, 0] },
  ];
  const create = (boundary) => createSeamLineEntities(
    [selected],
    inward,
    12.7,
    () => boundary,
  )[0];

  const initial = create(createBoundary([50, 50]));
  const changed = create(createBoundary([60, 50]));

  assert.ok(Math.abs(initial.points[0][1] - 12.7) < 1e-9);
  assert.ok(Math.abs(initial.points[1][1] - 96.625) < 1e-9);
  assert.ok(Math.abs(changed.points[0][1] - 10.583333333333332) < 1e-9);
  assert.ok(Math.abs(changed.points[1][1] - 97.3) < 1e-9);
  assert.notEqual(changed.points[1][1], initial.points[1][1]);
});

test('a selected fillet seam stops at its natural interior endpoint', () => {
  const fillet = {
    recordId: 'fillet',
    kind: 'arc',
    index: 0,
    center: [20, 20],
    radius: 20,
    start: [20, 0],
    arcPoint: [5.857864376269051, 5.857864376269051],
    end: [0, 20],
  };
  const boundary = [
    fillet,
    { recordId: 'shape', kind: 'segment', index: 0, start: [0, 20], end: [0, 100] },
    { recordId: 'shape', kind: 'segment', index: 1, start: [0, 100], end: [100, 100] },
    { recordId: 'shape', kind: 'segment', index: 2, start: [100, 100], end: [100, 0] },
    { recordId: 'shape', kind: 'segment', index: 3, start: [100, 0], end: [20, 0] },
  ];
  const [entity] = createSeamLineEntities(
    [fillet],
    (_feature, _point) => [50, 50],
    12.7,
    () => boundary,
  );

  assert.equal(entity.type, 'arc');
  assert.ok(Math.abs(entity.radius - 7.3) < 1e-9);
  assert.ok(Math.hypot(entity.start[0] - 20, entity.start[1] - 12.7) < 1e-9);
  assert.ok(Math.hypot(entity.end[0] - 12.7, entity.end[1] - 20) < 1e-9);
  assert.ok(entity.start[1] > 0);
  assert.ok(entity.end[0] > 0);
});

test('an arc and its neighboring line join at their apparent offset intersection', () => {
  const arc = {
    recordId: 'shape',
    kind: 'arc',
    index: 0,
    center: [20, 20],
    radius: 20,
    start: [20, 0],
    arcPoint: [5.857864376269051, 5.857864376269051],
    end: [0, 20],
  };
  const line = {
    recordId: 'shape',
    kind: 'segment',
    index: 1,
    start: [0, 20],
    end: [0, 100],
  };
  const [entity] = createSeamLineEntities([arc, line], (_feature, _point) => [50, 50]);

  assert.equal(entity.type, 'polyline');
  assert.deepEqual(entity.points.at(-1), [12.7, 100]);
  assert.ok(Math.abs(entity.points.at(-2)[0] - 12.7) < 1e-9);
  assert.ok(Math.abs(entity.points.at(-2)[1] - 20) < 1e-9);
});

test('duplicate Boolean source references collapse to one analytic arc seam', () => {
  const arc = {
    recordId: 'target',
    sourceId: 'cutter',
    targetId: 'target',
    sourceFeatureIndex: 0,
    boundaryRole: 'subtract',
    stableKey: 'target:cutter:subtract:0:0:0.5',
    kind: 'arc',
    index: 0,
    center: [20, 20],
    radius: 20,
    start: [20, 0],
    arcPoint: [5.857864376269051, 5.857864376269051],
    end: [0, 20],
  };
  const [entity] = createSeamLineEntities([arc, arc], (_feature, _point) => [50, 50]);

  assert.equal(entity.type, 'arc');
  assert.equal(entity.composite.sourceFeatures.length, 1);
});

test('connected Boolean arc pieces remain one analytic arc seam', () => {
  const first = {
    recordId: 'target',
    sourceId: 'cutter',
    targetId: 'target',
    sourceFeatureIndex: 0,
    boundaryRole: 'subtract',
    stableKey: 'target:cutter:subtract:0:0:0',
    kind: 'arc',
    index: 0,
    center: [20, 20],
    radius: 20,
    start: [20, 0],
    arcPoint: [5.857864376269051, 5.857864376269051],
    end: [0, 20],
  };
  const second = {
    ...first,
    stableKey: 'target:cutter:subtract:0:0.5:1',
    start: [0, 20],
    arcPoint: [5.857864376269051, 34.14213562373095],
    end: [20, 40],
  };
  const [entity] = createSeamLineEntities([first, second], (_feature, _point) => [50, 50]);

  assert.equal(entity.type, 'arc');
  assert.equal(entity.composite.sourceFeatures.length, 2);
  assert.deepEqual(entity.start, [20, 12.7]);
  assert.deepEqual(entity.end, [20, 27.3]);
});

test('connected Boolean circle pieces use one offset radius through a seam junction', () => {
  const circle = { center: [50, 0], radius: 10 };
  const features = [
    { recordId: 'target', kind: 'segment', index: 0, sourceId: 'target', boundaryRole: 'outer', start: [0, 0], end: [40, 0] },
    { recordId: 'target', kind: 'arc', index: 1, sourceId: 'cutter', sourceFeatureIndex: 0, boundaryRole: 'subtract', ...circle, start: [60, 0], arcPoint: [50, 10], end: [40, 0] },
    { recordId: 'target', kind: 'arc', index: 2, sourceId: 'cutter', sourceFeatureIndex: 0, boundaryRole: 'subtract', ...circle, start: [59.9995, -0.1], arcPoint: [59.999875, -0.05], end: [60, 0] },
    { recordId: 'target', kind: 'segment', index: 3, sourceId: 'target', boundaryRole: 'outer', start: [60, -0.1], end: [100, -0.1] },
    { recordId: 'target', kind: 'segment', index: 4, sourceId: 'target', boundaryRole: 'outer', start: [100, -0.1], end: [100, 100] },
    { recordId: 'target', kind: 'segment', index: 5, sourceId: 'target', boundaryRole: 'outer', start: [100, 100], end: [0, 100] },
    { recordId: 'target', kind: 'segment', index: 6, sourceId: 'target', boundaryRole: 'outer', start: [0, 100], end: [0, 0] },
  ];
  const [entity] = createSeamLineEntities(features, (_feature, _point) => [50, 20], 1.5, () => features);
  const arcSources = entity.composite.sourceFeatures.filter((source) => source.sourceId === 'cutter');
  assert.equal(arcSources.length, 2);
  const arcPoints = entity.points.filter(([x, y]) => x > 25 && x < 75 && y > -1);
  assert.ok(arcPoints.length > 5);
  assert.ok(arcPoints.every((point) => Math.abs(Math.hypot(point[0] - 50, point[1]) - 11.5) < 0.05));
});

test('a curve produces an offset seam instead of being limited to line edges', () => {
  const [entity] = createSeamLineEntities([
    {
      recordId: 'curve',
      kind: 'curve',
      index: 0,
      points: [[0, 0], [40, 60], [80, 0]],
    },
  ], (_feature, _point) => [40, 20]);

  assert.equal(entity.type, 'polyline');
  assert.ok(entity.points.length > 10);
  assert.equal(entity.composite.sourceFeatures[0].kind, 'curve');
});

test('an inset circle remains an analytic offset circle entity', () => {
  const [entity] = createSeamLineEntities([
    { recordId: 'circle', kind: 'circle', center: [10, 20], radius: 40 },
  ], inward);
  assert.deepEqual(entity.center, [10, 20]);
  assert.equal(entity.radius, 27.3);
  assert.equal(entity.appearance.fillOpacity, 0);
  assert.equal(entity.composite.kind, 'finish-size-offset');
});

test('a circular seam offsets outward when the host interior is outward', () => {
  const [entity] = createSeamLineEntities([
    { recordId: 'cutter', kind: 'circle', center: [10, 20], radius: 40 },
  ], (_feature, point) => [point[0] + 10, point[1]]);
  assert.equal(entity.radius, 52.7);
  assert.equal(entity.appearance.fillOpacity, 0);
});

test('Seam Line V2 normalizes durable intent without generated geometry', () => {
  const feature = { recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 2 };
  assert.deepEqual(normalizeSeamLineExtension({
    definitions: [{
      regionId: 'shape',
      recordIds: ['shape'],
      defaultEnabled: false,
      overrides: [
        { ...seamLineEdgeReference(feature), enabled: true },
        { ...seamLineEdgeReference(feature), enabled: true },
      ],
    }],
  }), {
    version: 2,
    definitions: [{
      regionId: 'shape',
      recordIds: ['shape'],
      defaultEnabled: false,
      overrides: [{ ...seamLineEdgeReference(feature), enabled: true }],
    }],
  });
});

test('a V2 object-level Seam Line materializes from the current closed boundary only', () => {
  const drawing = {
    entities: [{ id: 'shape', type: 'rect', x: 0, y: 0, width: 100, height: 80 }],
    constraints: [],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'shape', recordIds: ['shape'], defaultEnabled: true, overrides: [] }],
      },
    },
  };
  const entities = materializeSeamLineEntitiesForDrawing(drawing);
  assert.equal(entities.length, 1);
  assert.equal(entities[0].composite.seamLineVersion, 2);
  assert.equal(entities[0].composite.ownerRecordId, 'shape');
  assert.equal(entities[0].composite.sourceFeatures.length, 4);
  assert.equal(drawing.entities.length, 1);
});

test('a V2 object-level Seam Line materializes for a closed circle', () => {
  const drawing = {
    entities: [{ id: 'circle', type: 'circle', center: [10, 20], radius: 40 }],
    constraints: [],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'circle', recordIds: ['circle'], defaultEnabled: true, overrides: [] }],
      },
    },
  };

  const [entity] = materializeSeamLineEntitiesForDrawing(drawing);
  assert.equal(entity.type, 'circle');
  assert.deepEqual(entity.center, [10, 20]);
  assert.equal(entity.radius, 27.3);
  assert.equal(entity.composite.ownerRecordId, 'circle');
});

test('a V2 partial edge uses joins from the complete offset contour', () => {
  const drawing = {
    entities: [{ id: 'shape', type: 'rect', x: 0, y: 0, width: 100, height: 80 }],
    constraints: [],
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
  const [entity] = materializeSeamLineEntitiesForDrawing(drawing);
  assert.ok(Math.hypot(entity.points[0][0] - 12.7, entity.points[0][1] - 12.7) < 1e-9);
  assert.ok(Math.hypot(entity.points[1][0] - 87.3, entity.points[1][1] - 12.7) < 1e-9);
});

test('Boolean Seam Line materialization follows both outer and subtract boundary roles', () => {
  const drawing = {
    entities: [
      { id: 'target', type: 'circle', center: [0, 0], radius: 100 },
      { id: 'cutter', type: 'circle', center: [0, -80], radius: 40, subtract: true, subtractExpression: 'TRUE' },
    ],
    constraints: [],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'target', recordIds: ['target'], defaultEnabled: true, overrides: [] }],
      },
    },
  };
  const entities = materializeSeamLineEntitiesForDrawing(drawing);
  const sources = entities.flatMap((entity) => entity.composite.sourceFeatures || []);
  assert.ok(entities.length > 0);
  assert.ok(entities.every((entity) => entity.composite.ownerRecordId === 'target'));
  assert.ok(sources.some((source) => source.boundaryRole === 'outer'));
  assert.ok(sources.some((source) => source.boundaryRole === 'subtract'));
});

test('region-wide Seam Line intent migrates to explicit outer and cut edge records', () => {
  const migrated = migrateSeamLineDrawingToExplicitEdges({
    entities: [
      { id: 'target', type: 'circle', center: [0, 0], radius: 100 },
      {
        id: 'cutter',
        type: 'circle',
        center: [0, 0],
        radius: 30,
        subtract: false,
        subtractExpression: 'FALSE',
        subtractFrom: ['target'],
      },
    ],
    constraints: [],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'target', recordIds: ['target'], defaultEnabled: true, overrides: [] }],
      },
    },
  });
  const [definition] = migrated.extensions.seamLines.definitions;
  assert.equal(definition.defaultEnabled, false);
  assert.ok(definition.overrides.some((item) => item.boundaryRole === 'outer' && item.enabled));
  assert.ok(definition.overrides.some((item) => item.boundaryRole === 'subtract' && item.enabled));
});

test('a circular Boolean slot keeps straight seams parallel and joins them to the analytic offset circle', () => {
  const drawing = {
    entities: [
      { id: 'target', type: 'circle', center: [0, 0], radius: 100 },
      {
        id: 'cutter',
        type: 'rect',
        x: 0,
        y: -30,
        width: 120,
        height: 60,
        subtract: true,
        subtractExpression: 'TRUE',
      },
    ],
    constraints: [],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'target', recordIds: ['target'], defaultEnabled: true, overrides: [] }],
      },
    },
  };

  const [entity] = materializeSeamLineEntitiesForDrawing(drawing);
  const [firstArcJoin, firstCorner, secondCorner, secondArcJoin] = entity.points;
  const offsetRadius = 100 - SEAM_LINE_INSET;
  const slotOffset = 30 + SEAM_LINE_INSET;

  assert.ok(Math.abs(firstArcJoin[1] - firstCorner[1]) < 1e-8);
  assert.ok(Math.abs(firstCorner[0] - secondCorner[0]) < 1e-8);
  assert.ok(Math.abs(secondCorner[1] - secondArcJoin[1]) < 1e-8);
  assert.ok(Math.abs(Math.abs(firstArcJoin[1]) - slotOffset) < 1e-8);
  assert.ok(Math.abs(Math.abs(secondArcJoin[1]) - slotOffset) < 1e-8);
  assert.ok(Math.abs(Math.hypot(...firstArcJoin) - offsetRadius) < 1e-8);
  assert.ok(Math.abs(Math.hypot(...secondArcJoin) - offsetRadius) < 1e-8);
});

test('disabling V2 intent produces no presentation entity, including after legacy migration', () => {
  const migrated = migrateLegacySeamLineDrawing({
    entities: [{ id: 'shape', type: 'circle', center: [0, 0], radius: 50 }],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'shape', recordIds: ['shape'], defaultEnabled: false, overrides: [] }],
      },
    },
  }).drawing;
  assert.deepEqual(materializeSeamLineEntitiesForDrawing(migrated), []);
});

test('an individual edge-off override survives an arc-to-circle topology change', () => {
  const migrated = migrateLegacySeamLineDrawing({
    entities: [
      { id: 'owner', type: 'circle', center: [0, 0], radius: 100 },
      { id: 'former-cutter', type: 'circle', center: [-250, 0], radius: 35 },
    ],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{
          regionId: 'owner',
          recordIds: ['owner'],
          defaultEnabled: true,
          overrides: [
            { sourceId: 'owner', sourceFeatureIndex: 0, boundaryRole: 'outer', kind: 'arc', enabled: false },
            { sourceId: 'former-cutter', sourceFeatureIndex: 0, boundaryRole: 'subtract', kind: 'arc', enabled: false },
          ],
        }],
      },
    },
  }).drawing;

  assert.equal(migrated.extensions.seamLines.definitions.length, 1);
  assert.deepEqual(materializeSeamLineEntitiesForDrawing(migrated), []);
});

test('disabled Seam Line intent stays empty through repeated Boolean operand edits', () => {
  const drawing = {
    entities: [
      { id: 'target', type: 'rect', x: 0, y: 0, width: 200, height: 120 },
      { id: 'cutter', type: 'circle', center: [20, 0], radius: 30, subtract: true, subtractExpression: 'TRUE' },
    ],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'target', recordIds: ['target'], defaultEnabled: false, overrides: [] }],
      },
    },
  };
  for (let index = 0; index < 100; index += 1) {
    drawing.entities[1].center = [20 + index * 1.25, Math.sin(index / 4) * 8];
    assert.deepEqual(materializeSeamLineEntitiesForDrawing(drawing), []);
  }
});
