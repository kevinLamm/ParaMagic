import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveSwellBoundaries,
  deriveSwellGeometry,
  isSwellEntity,
  normalizeSwellDefinition,
  resolveSwellTransitionDistances,
  SWELL_DEFAULT_EXPRESSIONS,
  swellBoundaryPath,
  swellDefinitionForEntity,
  withSwellDefinition,
} from '../../packages/paramagic-core/src/modules/SwellGeometry.js';
import { createGeometryBinding } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';

const VALUES = {
  offset: 1,
  swell: 3,
  start: 4,
  end: 4,
};

const pointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function definition(overrides = {}) {
  return {
    enabled: true,
    swellEnabled: true,
    offsetExpression: 'offset',
    swellOffsetExpression: 'swell',
    startTransitionExpression: 'start',
    endTransitionExpression: 'end',
    ...overrides,
  };
}

test('new Swell entities default to offset-only while legacy definitions retain Swell mode', () => {
  const source = withSwellDefinition({
    id: 'new-offset', type: 'line', start: [0, 0], end: [20, 0],
  });
  const stored = swellDefinitionForEntity(source);
  const result = deriveSwellGeometry({ entities: [source], evaluateLength: (value) => Number.parseFloat(value) }).get(source.id);

  assert.equal(stored.swellEnabled, false);
  assert.deepEqual(SWELL_DEFAULT_EXPRESSIONS, {
    swellEnabled: false,
    offsetExpression: '0.5',
    swellOffsetExpression: '1.5',
    startTransitionExpression: '4',
    endTransitionExpression: '4',
  });
  assert.deepEqual(result.pieces.map(({ role }) => role), ['offset']);
  assert.equal(normalizeSwellDefinition({ offsetExpression: '1 in' }).swellEnabled, true);
});

test('negative Swell expressions reverse direction while retaining positive distances', () => {
  const offsetOnly = swellEntity(
    { id: 'reverse-offset', type: 'line', start: [0, 0], end: [20, 0] },
    { swellEnabled: false, offsetExpression: '-1' },
  );
  const reversedOffset = deriveSwellGeometry({ entities: [offsetOnly], evaluateLength }).get(offsetOnly.id);
  assert.deepEqual(reversedOffset.pieces[0].entity, {
    type: 'line', start: [0, 1], end: [20, 1],
  });
  assert.equal(reversedOffset.segmentResults.get(0).evaluated.direction, -1);

  const asymmetric = swellEntity(
    { id: 'reverse-transitions', type: 'line', start: [0, 0], end: [20, 0] },
    { startTransitionExpression: '-2', endTransitionExpression: '5' },
  );
  const reversedSwell = deriveSwellGeometry({ entities: [asymmetric], evaluateLength }).get(asymmetric.id);
  assert.equal(reversedSwell.segmentResults.get(0).evaluated.direction, -1);
  assert.deepEqual(reversedSwell.pieces[1].entity.start, [5, 3]);
  assert.deepEqual(reversedSwell.pieces[1].entity.end, [18, 3]);
});

test('turning Swell off preserves its expressions and turning it back on restores the transition geometry', () => {
  const source = swellEntity(
    { id: 'toggle-swell', type: 'line', start: [0, 0], end: [20, 0] },
    { swellEnabled: false },
  );
  const disabled = deriveSwellGeometry({ entities: [source], evaluateLength }).get(source.id);
  const restored = withSwellDefinition(source, {
    ...swellDefinitionForEntity(source),
    swellEnabled: true,
  });
  const enabled = deriveSwellGeometry({ entities: [restored], evaluateLength }).get(restored.id);

  assert.deepEqual(disabled.pieces.map(({ role }) => role), ['offset']);
  assert.equal(swellDefinitionForEntity(source).swellOffsetExpression, 'swell');
  assert.deepEqual(enabled.pieces.map(({ role }) => role), ['start-transition', 'swell', 'end-transition']);
});

function evaluateLength(expression) {
  return VALUES[expression] ?? Number(expression);
}

function swellEntity(entity, overrides = {}) {
  return withSwellDefinition(entity, definition(overrides));
}

test('Swell decoration forces construction while preserving solver-round-trippable metadata', () => {
  const decorated = swellEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [20, 0] });
  assert.equal(decorated.construction, true);
  assert.equal(isSwellEntity(decorated), true);
  assert.deepEqual(swellDefinitionForEntity(decorated), definition());

  const roundTripped = createGeometryBinding(decorated).toEntity();
  assert.equal(roundTripped.construction, true);
  assert.deepEqual(roundTripped.composite, decorated.composite);
});

test('Swell line uses right-side base offset, transition arcs, and a central swell line', () => {
  const source = swellEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [20, 0] });
  const result = deriveSwellGeometry({ entities: [source], evaluateLength }).get(source.id);
  assert.deepEqual(result.pieces.map(({ role }) => role), ['start-transition', 'swell', 'end-transition']);
  assert.deepEqual(result.pieces[0].entity.start, [0, -1]);
  assert.equal(result.pieces[0].entity.ccw, true);
  assert.deepEqual(result.pieces[1].entity.start, [4, -3]);
  assert.deepEqual(result.pieces[1].entity.end, [16, -3]);
  assert.deepEqual(result.pieces[2].entity.end, [20, -1]);
  assert.equal(result.pieces[2].entity.ccw, true);
});

test('overlapping transition distances shrink proportionally no lower than half', () => {
  assert.deepEqual(resolveSwellTransitionDistances(5, 4, 4), {
    enabled: true,
    start: 2.5,
    end: 2.5,
    scale: 0.625,
  });
  assert.deepEqual(resolveSwellTransitionDistances(3, 4, 4), {
    enabled: false,
    start: 0,
    end: 0,
    scale: 0,
  });

  const source = swellEntity({ id: 'short-line', type: 'line', start: [0, 0], end: [3, 0] });
  const result = deriveSwellGeometry({ entities: [source], evaluateLength }).get(source.id);
  assert.equal(result.segmentResults.get(0).usedSwell, false);
  assert.deepEqual(result.pieces.map(({ role }) => role), ['offset']);
});

test('Swell Offset at or below Offset produces an ordinary offset', () => {
  const source = swellEntity(
    { id: 'line-a', type: 'line', start: [0, 0], end: [20, 0] },
    { swellOffsetExpression: 'offset' },
  );
  const result = deriveSwellGeometry({ entities: [source], evaluateLength }).get(source.id);
  assert.deepEqual(result.pieces.map(({ role }) => role), ['offset']);
  assert.deepEqual(result.pieces[0].entity, { type: 'line', start: [0, -1], end: [20, -1] });
});

test('Coincident construction endpoints miter their Swell offset sets', () => {
  const horizontal = swellEntity({ id: 'horizontal', type: 'line', start: [0, 0], end: [10, 0] });
  const vertical = swellEntity({ id: 'vertical', type: 'line', start: [10, 0], end: [10, -10] });
  const constraints = [{
    id: 'corner',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: horizontal.id, index: 2 },
      { kind: 'point', recordId: vertical.id, index: 0 },
    ],
  }];
  const derived = deriveSwellGeometry({ entities: [horizontal, vertical], constraints, evaluateLength });
  assert.deepEqual(derived.get(horizontal.id).pieces.at(-1).entity.end, [9, -1]);
  assert.deepEqual(derived.get(vertical.id).pieces[0].entity.start, [9, -1]);
});

test('Coincident line and arc offsets share the same joined endpoint', () => {
  const line = swellEntity({ id: 'line', type: 'line', start: [0, 0], end: [10, 0] });
  const arc = swellEntity({
    id: 'arc',
    type: 'arc',
    center: [10, -10],
    radius: 10,
    start: [10, 0],
    arcPoint: [17.0710678119, -2.9289321881],
    end: [20, -10],
    ccw: false,
  });
  const constraints = [{
    id: 'line-arc-join',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: line.id, index: 2 },
      { kind: 'point', recordId: arc.id, index: 0 },
    ],
  }];
  const derived = deriveSwellGeometry({ entities: [line, arc], constraints, evaluateLength });
  assert.deepEqual(derived.get(line.id).pieces.at(-1).entity.end, [10, -1]);
  assert.deepEqual(derived.get(arc.id).pieces[0].entity.start, [10, -1]);
});

test('a Swell fillet consumes the joined line transition and adds Swell Offset to its radius', () => {
  const line = swellEntity({ id: 'line', type: 'line', start: [0, 0], end: [20, 0] });
  const fillet = swellEntity({
    id: 'fillet',
    type: 'arc',
    center: [20, 4],
    radius: 4,
    start: [20, 0],
    arcPoint: [22.8284271247, 1.1715728753],
    end: [24, 4],
    ccw: true,
    composite: {
      swellFillet: {
        sourceEndpoints: [
          { recordId: 'line', index: 2 },
          { recordId: 'other', index: 0 },
        ],
      },
    },
  });
  const constraints = [{
    id: 'line-fillet-join',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: line.id, index: 2 },
      { kind: 'point', recordId: fillet.id, index: 0 },
    ],
  }];

  const derived = deriveSwellGeometry({ entities: [line, fillet], constraints, evaluateLength });
  const linePieces = derived.get(line.id).pieces;
  const offsetFillet = derived.get(fillet.id).pieces[0].entity;

  assert.deepEqual(linePieces.map(({ role }) => role), ['start-transition', 'swell']);
  assert.equal(linePieces.some(({ role }) => role === 'end-transition'), false);
  assert.equal(offsetFillet.radius, 7);
  assert.deepEqual(linePieces.at(-1).entity.end, [20, -3]);
  assert.deepEqual(offsetFillet.start, [20, -3]);

  const larger = deriveSwellGeometry({
    entities: [line, fillet],
    constraints,
    evaluateLength: (expression) => ({ offset: 1, swell: 5, start: 4, end: 4 })[expression] ?? Number(expression),
  });
  assert.equal(larger.get(fillet.id).pieces[0].entity.radius, 9);
  assert.deepEqual(larger.get(line.id).pieces.at(-1).entity.end, [20, -5]);
});

test('Coincident arc offsets intersect at one shared endpoint', () => {
  const first = swellEntity({
    id: 'first-arc',
    type: 'arc',
    center: [0, 0],
    radius: 10,
    start: [0, 10],
    arcPoint: [7.0710678119, 7.0710678119],
    end: [10, 0],
    ccw: false,
  });
  const second = swellEntity({
    id: 'second-arc',
    type: 'arc',
    center: [20, 0],
    radius: 10,
    start: [10, 0],
    arcPoint: [12.9289321881, -7.0710678119],
    end: [20, -10],
    ccw: true,
  });
  const constraints = [{
    id: 'arc-arc-join',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: first.id, index: 2 },
      { kind: 'point', recordId: second.id, index: 0 },
    ],
  }];
  const derived = deriveSwellGeometry({ entities: [first, second], constraints, evaluateLength });
  const firstEnd = derived.get(first.id).pieces[0].entity.end;
  const secondStart = derived.get(second.id).pieces[0].entity.start;
  assert.ok(pointDistance(firstEnd, [9, 0]) < 1e-8);
  assert.ok(pointDistance(secondStart, [9, 0]) < 1e-8);
  assert.deepEqual(firstEnd, secondStart);
});

test('circles and closed line chains offset outward regardless of segment direction', () => {
  const circle = swellEntity({ id: 'circle', type: 'circle', center: [0, 0], radius: 10 });
  const rectangle = [
    [[0, 0], [10, 0]],
    [[10, 0], [10, 5]],
    [[10, 5], [0, 5]],
    [[0, 5], [0, 0]],
  ].map(([startPoint, endPoint], index) => swellEntity({
    id: `rect-${index}`,
    type: 'line',
    start: startPoint,
    end: endPoint,
    composite: { id: 'rect', kind: 'rectangle', closed: true, index, count: 4 },
  }));
  const constraints = rectangle.map((entity, index) => ({
    id: `join-${index}`,
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: entity.id, index: 2 },
      { kind: 'point', recordId: rectangle[(index + 1) % rectangle.length].id, index: 0 },
    ],
  }));
  const derived = deriveSwellGeometry({ entities: [circle, ...rectangle], constraints, evaluateLength });
  assert.equal(derived.get(circle.id).pieces[0].entity.radius, 11);
  assert.deepEqual(derived.get('rect-0').pieces[0].entity.start, [-1, -1]);
  assert.deepEqual(derived.get('rect-1').pieces[0].entity.start, [11, -1]);
  assert.deepEqual(derived.get('rect-2').pieces[0].entity.start, [11, 6]);
  assert.deepEqual(derived.get('rect-3').pieces[0].entity.start, [-1, 6]);
});

test('closed Swell boundaries serialize analytic circle and mixed-feature SVG paths', () => {
  assert.equal(
    swellBoundaryPath([{ kind: 'circle', center: [5, 7], radius: 3 }]),
    'M 8 7 A 3 3 0 1 1 2 7 A 3 3 0 1 1 8 7 Z',
  );
  assert.match(swellBoundaryPath([
    { kind: 'segment', start: [0, 0], end: [10, 0] },
    { kind: 'arc', start: [10, 0], end: [0, 0], radius: 5, ccw: true },
  ]), /^M 0 0 L 10 0 A 5 5 0 0 1 0 0 Z$/);
});

test('arc offsets are concentric and follow the right side of their stored direction', () => {
  const ccw = swellEntity({
    id: 'ccw',
    type: 'arc',
    center: [0, 0],
    radius: 10,
    start: [10, 0],
    arcPoint: [0, 10],
    end: [-10, 0],
    ccw: true,
  });
  const cw = swellEntity({
    id: 'cw',
    type: 'arc',
    center: [30, 0],
    radius: 10,
    start: [40, 0],
    arcPoint: [30, -10],
    end: [20, 0],
    ccw: false,
  });
  const derived = deriveSwellGeometry({ entities: [ccw, cw], evaluateLength });
  assert.equal(derived.get(ccw.id).pieces[0].entity.radius, 11);
  assert.equal(derived.get(cw.id).pieces[0].entity.radius, 9);
  assert.deepEqual(derived.get(ccw.id).pieces[0].entity.center, [0, 0]);
  assert.deepEqual(derived.get(cw.id).pieces[0].entity.center, [30, 0]);
});

test('connected line, arc, and spline Swell objects join into one closed outward boundary', () => {
  const line = swellEntity({ id: 'mixed-line', type: 'line', start: [0, 0], end: [30, 0] });
  const arc = swellEntity({
    id: 'mixed-arc',
    type: 'arc',
    center: [30, 10],
    radius: 10,
    start: [30, 0],
    arcPoint: [40, 10],
    end: [30, 20],
    ccw: true,
  });
  const spline = swellEntity({
    id: 'mixed-spline',
    type: 'curve',
    points: [[30, 20], [18, 27], [3, 18], [0, 0]],
  });
  const constraints = [
    {
      id: 'mixed-line-arc',
      type: 'Coincident',
      featureRefs: [
        { kind: 'point', recordId: line.id, index: 2 },
        { kind: 'point', recordId: arc.id, index: 0 },
      ],
    },
    {
      id: 'mixed-arc-spline',
      type: 'Coincident',
      featureRefs: [
        { kind: 'point', recordId: arc.id, index: 2 },
        { kind: 'point', recordId: spline.id, index: 0 },
      ],
    },
    {
      id: 'mixed-spline-line',
      type: 'Coincident',
      featureRefs: [
        { kind: 'point', recordId: spline.id, index: spline.points.length - 1 },
        { kind: 'point', recordId: line.id, index: 0 },
      ],
    },
  ];
  const derived = deriveSwellGeometry({ entities: [line, arc, spline], constraints, evaluateLength });
  const boundaries = deriveSwellBoundaries({ entities: [line, arc, spline], constraints, evaluateLength });

  assert.equal(boundaries.length, 1);
  assert.deepEqual(new Set(boundaries[0].recordIds), new Set([line.id, arc.id, spline.id]));
  assert.ok(boundaries[0].polygon.length > 10);
  assert.ok(boundaries[0].features.some(({ sourceId, kind }) => sourceId === spline.id && kind === 'polyline'));
  [line.id, arc.id, spline.id].forEach((recordId) => assert.equal(derived.get(recordId).closed, true));
  boundaries[0].features.forEach((feature, index, features) => {
    const next = features[(index + 1) % features.length];
    const featureEnd = feature.kind === 'polyline' ? feature.points.at(-1) : feature.end;
    const nextStart = next.kind === 'polyline' ? next.points[0] : next.start;
    assert.ok(pointDistance(featureEnd, nextStart) < 1e-7);
  });
});

test('legacy polyline entities can retain per-segment Swell settings', () => {
  const base = swellEntity({ id: 'polyline', type: 'polyline', points: [[0, 0], [20, 0], [20, 20]] });
  const customized = withSwellDefinition(base, definition({ swellOffsetExpression: '5' }), 1);
  assert.equal(swellDefinitionForEntity(customized, 0).swellOffsetExpression, 'swell');
  assert.equal(swellDefinitionForEntity(customized, 1).swellOffsetExpression, '5');
});

test('closed Swell geometry exposes stable analytic boundary features for downstream tools', () => {
  const source = swellEntity({ id: 'panel', type: 'rect', x: 0, y: 0, width: 20, height: 12 });
  const [boundary] = deriveSwellBoundaries({ entities: [source], evaluateLength });

  assert.equal(boundary.id, source.composite.id);
  assert.deepEqual(boundary.recordIds, [source.id]);
  assert.equal(boundary.features.length, 12);
  assert.ok(boundary.polygon.length >= 12);
  assert.ok(boundary.features.every((feature) => feature.swellDerived === true));
  assert.ok(boundary.features.every((feature) => feature.sourceId === source.id));
  assert.ok(boundary.features.every((feature) => feature.targetId === boundary.id));
  assert.ok(boundary.features.every((feature) => feature.stableKey.startsWith(`swell-boundary:${boundary.id}:`)));
});
