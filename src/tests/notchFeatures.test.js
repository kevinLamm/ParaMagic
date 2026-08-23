import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_NOTCH_TYPE,
  createNotchEntity,
  createNotchLocationMemory,
  createSegmentLocationMemory,
  evaluateNotch,
  moveNotchToPoint,
  notchFeatureParameterDomain,
  notchFeatureLength,
  notchFillColor,
  notchGeometryPrimitives,
  notchGeometryPoints,
  notchLength,
  notchDxfLayer,
  notchParameterFromLocationMemory,
  segmentParameterFromLocationMemory,
} from '../../packages/paramagic-core/src/modules/NotchSystem.js';
import { notchDotRadiusForScale } from '../../packages/paramagic-core/src/modules/NotchSystem.js';
import {
  inwardTargetFromBoundary,
  pointInsideNotchBoundary,
} from '../../packages/paramagic-core/src/modules/NotchSystem.js';

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

test('notch marker radius remains six screen pixels at every zoom scale', () => {
  assert.equal(notchDotRadiusForScale(0.5), 12);
  assert.equal(notchDotRadiusForScale(1), 6);
  assert.equal(notchDotRadiusForScale(4), 1.5);
});

test('new Notches default to a quarter-inch-deep V cut', () => {
  const feature = { kind: 'segment', recordId: 'rect', index: 0, start: [0, 0], end: [100, 0] };
  const notch = createNotchEntity(feature, [50, 0], [50, 50], 'v-notch');
  const primitives = notchGeometryPrimitives(notch);

  assert.equal(notch.notchType, DEFAULT_NOTCH_TYPE);
  assert.equal(primitives.length, 2);
  assert.deepEqual(primitives[0].end, [50, 6.35]);
  assert.deepEqual(
    [primitives[0].start[0], primitives[1].end[0]].sort((a, b) => a - b),
    [46.825, 53.175],
  );
  assert.equal(notchFillColor(notch), '#000000');
  assert.equal(notchDxfLayer(notch), 'V-Notch');
});

test('a U-Notch is one-eighth inch wide with a quarter-inch deepest point', () => {
  const feature = { kind: 'segment', recordId: 'rect', index: 0, start: [0, 0], end: [100, 0] };
  const notch = createNotchEntity(feature, [50, 0], [50, 50], 'u-notch', 'u-notch');
  const [firstSide, bottom, secondSide] = notchGeometryPrimitives(notch);
  const geometryPoints = notchGeometryPoints(notch);

  assert.deepEqual(
    [firstSide.start[0], secondSide.end[0]].sort((a, b) => a - b),
    [48.4125, 51.5875],
  );
  assert.ok(Math.abs(firstSide.end[1] - 4.7625) < 1e-9);
  assert.equal(bottom.type, 'arc');
  assert.ok(distance(bottom.arcPoint, [50, 6.35]) < 1e-9);
  assert.ok(Math.abs(secondSide.end[1]) < 1e-9);
  assert.ok(geometryPoints.some((point) => distance(point, [50, 6.35]) < 1e-9));
  assert.equal(notchFillColor(notch), '#000000');
  assert.equal(notchDxfLayer(notch), 'U-Notch');
});

test('legacy Notches without a stored type remain straight slits', () => {
  const notch = { type: 'notch', point: [10, 20], end: [10, 26.35] };
  assert.deepEqual(notchGeometryPrimitives(notch), [{ type: 'line', start: [10, 20], end: [10, 26.35] }]);
  assert.equal(notchFillColor(notch), 'none');
  assert.equal(notchDxfLayer(notch), 'Straight Slit Notch');
});

test('Boolean arc Notches retain the source-circle parameter in their host metadata', () => {
  const feature = {
    recordId: 'target',
    sourceId: 'cutter',
    targetId: 'target',
    sourceFeatureIndex: 0,
    boundaryRole: 'subtract',
    stableKey: 'target:cutter:subtract:0:0:0.5',
    kind: 'arc',
    index: 0,
    parameterStart: 0,
    parameterEnd: 0.5,
    center: [0, 0],
    radius: 20,
    start: [20, 0],
    arcPoint: [0, 20],
    end: [-20, 0],
  };
  const notch = createNotchEntity(feature, [0, 20], [0, 40], 'boolean-arc-notch');
  assert.ok(Math.abs(notch.host.sourceParameter - 0.25) < 1e-9);
});

test('a segment notch stays on its host, points inward, and remains 0.25 inches long', () => {
  const feature = { kind: 'segment', recordId: 'rect', index: 0, start: [0, 0], end: [100, 0] };
  const notch = createNotchEntity(feature, [35, -4], [50, 40], 'notch-1');
  const evaluated = evaluateNotch(notch, feature, [50, 40]);
  const edge = [feature.end[0] - feature.start[0], feature.end[1] - feature.start[1]];
  const notchVector = [evaluated.end[0] - evaluated.point[0], evaluated.end[1] - evaluated.point[1]];

  assert.deepEqual(evaluated.point, [35, 0]);
  assert.ok(evaluated.end[1] > evaluated.point[1]);
  assert.ok(Math.abs(dot(edge, notchVector)) < 1e-9);
  assert.ok(Math.abs(distance(evaluated.point, evaluated.end) - notchLength) < 1e-9);
  assert.deepEqual(notch.implicitConstraints, ['Point-on', 'Perpendicular']);
});

test('a finished polyline-edge notch is created at the clicked projection', () => {
  const feature = {
    kind: 'polyline',
    recordId: 'finished',
    index: 2,
    points: [[0, 0], [30, 0], [40, 10]],
  };
  const notch = createNotchEntity(feature, [35, 5], [30, 20], 'finished-notch');
  assert.ok(distance(notch.point, [35, 5]) < 1e-9);
  const evaluated = evaluateNotch(notch, feature, [30, 20]);
  assert.ok(distance(evaluated.point, [35, 5]) < 1e-9);
});

test('a segment notch remembers a signed physical distance from its nearest endpoint or midpoint', () => {
  const feature = { kind: 'segment', recordId: 'line', index: 0, start: [0, 0], end: [100, 0] };
  const leftOfMidpoint = createSegmentLocationMemory(feature, 0.4);
  const rightOfMidpoint = createSegmentLocationMemory(feature, 0.6);

  assert.equal(leftOfMidpoint.anchor, 'midpoint');
  assert.ok(Math.abs(leftOfMidpoint.signedDistance + 10) < 1e-9);
  assert.equal(rightOfMidpoint.anchor, 'midpoint');
  assert.ok(Math.abs(rightOfMidpoint.signedDistance - 10) < 1e-9);
  assert.ok(Math.abs(segmentParameterFromLocationMemory(leftOfMidpoint, { ...feature, end: [200, 0] }) - 0.45) < 1e-9);
  assert.ok(Math.abs(segmentParameterFromLocationMemory(rightOfMidpoint, { ...feature, end: [200, 0] }) - 0.55) < 1e-9);
});

test('segment notch memory falls back to its recorded percentage before leaving a shortened edge', () => {
  const feature = { kind: 'segment', recordId: 'line', index: 0, start: [0, 0], end: [100, 0] };
  const memory = createSegmentLocationMemory(feature, 0.2);
  const shortened = { ...feature, end: [10, 0] };

  assert.equal(segmentParameterFromLocationMemory(memory, shortened), 0.2);
  assert.equal(segmentParameterFromLocationMemory(memory, { ...feature, end: [200, 0] }), 0.1);
  assert.equal(segmentParameterFromLocationMemory(memory, { ...feature, end: [200, 0] }, true), 0.2);
});

test('arc and circle notch memory preserves measured path distance as radius changes', () => {
  const arc = {
    kind: 'arc',
    center: [0, 0],
    radius: 10,
    start: [10, 0],
    arcPoint: [0, 10],
    end: [-10, 0],
  };
  const arcMemory = createNotchLocationMemory(arc, Math.PI * 0.4);
  assert.ok(Math.abs(notchFeatureLength(arc) - Math.PI * 10) < 1e-9);
  const largerArc = {
    ...arc,
    radius: 20,
    start: [20, 0],
    arcPoint: [0, 20],
    end: [-20, 0],
  };
  assert.ok(Math.abs(notchParameterFromLocationMemory(arcMemory, largerArc) - Math.PI * 0.45) < 1e-9);

  const circle = { kind: 'circle', center: [0, 0], radius: 10 };
  assert.ok(Math.abs(notchFeatureLength(circle) - Math.PI * 20) < 1e-9);
  const circleMemory = createNotchLocationMemory(circle, Math.PI * 0.4);
  assert.equal(circleMemory.anchor, 'quadrant');
  assert.equal(circleMemory.quadrant, 1);
  assert.ok(Math.abs(circleMemory.signedDistance + Math.PI) < 1e-9);
  assert.ok(Math.abs(notchParameterFromLocationMemory(circleMemory, { ...circle, radius: 20 }) - Math.PI * 0.45) < 1e-9);
});

test('circle notch memory uses the nearest quadrant across the angle wrap', () => {
  const circle = { kind: 'circle', center: [0, 0], radius: 12 };
  const nearRightAbove = createNotchLocationMemory(circle, Math.PI * 2 - Math.PI / 18);
  const nearLeftBelow = createNotchLocationMemory(circle, Math.PI + Math.PI / 18);

  assert.equal(nearRightAbove.quadrant, 0);
  assert.ok(nearRightAbove.signedDistance < 0);
  assert.equal(nearLeftBelow.quadrant, 2);
  assert.ok(nearLeftBelow.signedDistance > 0);
  assert.ok(Math.abs(
    notchParameterFromLocationMemory(nearRightAbove, circle)
      - (Math.PI * 2 - Math.PI / 18),
  ) < 1e-9);
});

test('curve notch memory uses spline arc length rather than its raw control-point parameter', () => {
  const curve = { kind: 'curve', recordId: 'curve-memory', points: [[0, 0], [100, 0]] };
  const memory = createNotchLocationMemory(curve, 0.2);
  const stretched = { ...curve, points: [[0, 0], [200, 0]] };
  const original = evaluateNotch({
    id: 'curve-notch',
    type: 'notch',
    host: { recordId: curve.recordId, kind: 'curve', index: 0 },
    parameter: 0.2,
    locationMemory: memory,
  }, curve, [50, 50]);
  const absolute = evaluateNotch({
    id: 'curve-notch',
    type: 'notch',
    host: { recordId: curve.recordId, kind: 'curve', index: 0 },
    parameter: 0.2,
    locationMemory: memory,
  }, stretched, [100, 50]);
  const proportional = evaluateNotch({
    id: 'curve-notch',
    type: 'notch',
    host: { recordId: curve.recordId, kind: 'curve', index: 0 },
    parameter: 0.2,
    locationMemory: { ...memory, forceProportional: true },
  }, stretched, [100, 50]);
  assert.ok(Math.abs(absolute.point[0] - original.point[0]) < 0.1);
  assert.ok(Math.abs(proportional.point[0] - original.point[0] * 2) < 0.1);
});

test('a circular notch points toward the circle center and drags around the host only', () => {
  const feature = { kind: 'circle', recordId: 'circle', center: [10, 20], radius: 30 };
  const notch = createNotchEntity(feature, [40, 20], feature.center, 'notch-2');
  moveNotchToPoint(notch, feature, [10, -10]);
  const evaluated = evaluateNotch(notch, feature, feature.center);

  assert.ok(distance(evaluated.point, [10, -10]) < 1e-9);
  assert.ok(evaluated.end[1] > evaluated.point[1]);
  assert.ok(Math.abs(distance(evaluated.point, evaluated.end) - 6.35) < 1e-9);
  assert.deepEqual(feature.center, [10, 20]);
  assert.equal(notch.locationMemory.anchor, 'quadrant');
  assert.equal(notch.locationMemory.quadrant, 3);
});

test('an arc notch stays radial but points away from its center when that is the closed-shape interior', () => {
  const feature = {
    kind: 'arc',
    recordId: 'concave-arc',
    center: [0, 0],
    radius: 20,
    start: [20, 0],
    arcPoint: [0, 20],
    end: [-20, 0],
  };
  const notch = createNotchEntity(feature, [0, 20], () => [0, 40], 'notch-concave-arc');
  const evaluated = evaluateNotch(notch, feature, () => [0, 40]);
  const radial = [
    evaluated.point[0] - feature.center[0],
    evaluated.point[1] - feature.center[1],
  ];
  const notchVector = [
    evaluated.end[0] - evaluated.point[0],
    evaluated.end[1] - evaluated.point[1],
  ];

  assert.ok(evaluated.end[1] > evaluated.point[1], 'the notch should point into the material, away from the center');
  assert.ok(Math.abs(radial[0] * notchVector[1] - radial[1] * notchVector[0]) < 1e-9);
});

test('a curve notch follows the spline and remains perpendicular to its local tangent', () => {
  const feature = {
    kind: 'curve',
    recordId: 'curve',
    points: [[0, 40], [30, 0], [70, 0], [100, 40]],
  };
  const notch = createNotchEntity(feature, [50, 0], [50, 50], 'notch-curve');
  const evaluated = evaluateNotch(notch, feature, [50, 50]);
  const before = { ...notch, parameter: notch.parameter - 0.0001 };
  const after = { ...notch, parameter: notch.parameter + 0.0001 };
  const beforePoint = evaluateNotch(before, feature, [50, 50]).point;
  const afterPoint = evaluateNotch(after, feature, [50, 50]).point;
  const tangent = [afterPoint[0] - beforePoint[0], afterPoint[1] - beforePoint[1]];
  const notchVector = [evaluated.end[0] - evaluated.point[0], evaluated.end[1] - evaluated.point[1]];

  assert.ok(Math.abs(dot(tangent, notchVector)) < 1e-5);
  assert.ok(evaluated.end[1] > evaluated.point[1]);
  assert.ok(Math.abs(distance(evaluated.point, evaluated.end) - notchLength) < 1e-9);
});

test('a curve notch uses the locally interior normal on a concave closed boundary', () => {
  const polygon = [
    [0, 0], [100, 0], [100, 100], [60, 100],
    [60, 40], [40, 40], [40, 100], [0, 100],
  ];
  const boundaryPoint = [60, 70];
  const tangent = [0, 1];
  const target = inwardTargetFromBoundary(boundaryPoint, tangent, polygon);

  assert.ok(target[0] > boundaryPoint[0], 'the notch should point into the right arm, not toward the outside cavity');
  assert.equal(pointInsideNotchBoundary(target, polygon), true);
});

test('notch parameter domains stay on their finite visible edges', () => {
  assert.deepEqual(notchFeatureParameterDomain({ kind: 'segment' }), [0, 1]);
  assert.deepEqual(notchFeatureParameterDomain({ kind: 'curve', points: [[0, 0], [1, 1], [2, 0]] }), [0, 2]);
  assert.deepEqual(notchFeatureParameterDomain({ kind: 'polyline', points: [[0, 0], [1, 1], [2, 0]] }), [0, 2]);
  const arcDomain = notchFeatureParameterDomain({
    kind: 'arc',
    center: [0, 0],
    radius: 10,
    start: [10, 0],
    arcPoint: [0, 10],
    end: [-10, 0],
  });
  assert.ok(Math.abs(arcDomain[0]) < 1e-9);
  assert.ok(Math.abs(arcDomain[1] - Math.PI) < 1e-9);
});
