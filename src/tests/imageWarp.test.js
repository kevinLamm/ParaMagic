import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateWarpPlan,
  enableWarpSettings,
  formatWarpDimension,
  formatWarpDimensionWithUnit,
  localPointToSourcePixel,
  moveWarpGuideCorner,
  normalizeWarpSettings,
  parseWarpDimensionInput,
  perspectiveTransformFromPoints,
  setWarpDimension,
  transformPerspectivePoint,
} from '../modules/ImageWarp.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('warp settings default to an inset source-image guide and shared dimensions', () => {
  const warp = normalizeWarpSettings({}, { source: 'data:image/png;base64,a', width: 200, height: 100 });
  assert.equal(warp.sourceDisplayWidth, 200);
  assert.equal(warp.sourceDisplayHeight, 100);
  assert.deepEqual(warp.points, [[-70, -35], [70, -35], [70, 35], [-70, 35]]);
  assert.equal(warp.targetWidth, 140);
  assert.equal(warp.targetHeight, 70);
});

test('warp corner and dimension edits preserve shared side values', () => {
  const warp = normalizeWarpSettings({}, { source: 'data:image/png;base64,a', width: 200, height: 100 });
  const moved = moveWarpGuideCorner(warp, 1, [88, -31]);
  assert.deepEqual(moved.points[1], [88, -31]);
  assert.equal(setWarpDimension(moved, 'width', 250).targetWidth, 250);
  assert.equal(setWarpDimension(moved, 'height', 125).targetHeight, 125);
  assert.equal(setWarpDimension(moved, 'width', 16).targetWidth, 16);
  assert.equal(setWarpDimension(moved, 'height', 22).targetHeight, 22);
  assert.equal(formatWarpDimension(125.5), '125.5');
  assert.equal(formatWarpDimensionWithUnit(125.5, 'mm'), '125.5 mm');
  assert.equal(formatWarpDimensionWithUnit(25.4 * 16, 'in'), '16 in');
  assert.equal(parseWarpDimensionInput('224 in', 10), 224 * 25.4);
  assert.equal(parseWarpDimensionInput('22"', 10), 22 * 25.4);
  assert.equal(parseWarpDimensionInput('16 inches', 10), 16 * 25.4);
  assert.equal(parseWarpDimensionInput('168 mm', 10), 168);
  assert.equal(parseWarpDimensionInput('16', 10, 'in'), 16 * 25.4);
  assert.equal(parseWarpDimensionInput('224.5', 10), 224.5);
  assert.equal(parseWarpDimensionInput('.5 in', 10), 0.5 * 25.4);
  assert.equal(parseWarpDimensionInput('', 10), 10);
  assert.equal(parseWarpDimensionInput('bad value', 10), 10);
  assert.equal(setWarpDimension(moved, 'width', parseWarpDimensionInput('', moved.targetWidth)).targetWidth, moved.targetWidth);
});

test('enabling warp rebases a stale guide to the image current display size', () => {
  const entity = {
    source: 'data:image/png;base64,a',
    width: 760,
    height: 380,
    warp: normalizeWarpSettings({
      sourceDisplayWidth: 320,
      sourceDisplayHeight: 160,
      points: [[-80, -60], [40, -60], [40, 60], [-80, 60]],
      targetWidth: 16 * 25.4,
      targetHeight: 24 * 25.4,
    }, { source: 'data:image/png;base64,a', width: 320, height: 160 }),
  };
  const rebased = enableWarpSettings(entity);
  assert.equal(rebased.enabled, true);
  assert.equal(rebased.sourceDisplayWidth, 760);
  assert.equal(rebased.sourceDisplayHeight, 380);
  assert.deepEqual(rebased.points, [[-190, -142.5], [95, -142.5], [95, 142.5], [-190, 142.5]]);
  assert.equal(rebased.targetWidth, 16 * 25.4);
  assert.equal(rebased.targetHeight, 24 * 25.4);
  const sourceBefore = localPointToSourcePixel(entity.warp.points[0], entity.warp, 1600, 800);
  const sourceAfter = localPointToSourcePixel(rebased.points[0], rebased, 1600, 800);
  assert.deepEqual(sourceAfter, sourceBefore);

  const plan = calculateWarpPlan({ ...entity, warp: rebased }, { naturalWidth: 1600, naturalHeight: 800 });
  const rendered = rebased.points.map((point) => {
    const sourcePixel = localPointToSourcePixel(point, rebased, 1600, 800);
    const outputPixel = transformPerspectivePoint(plan.rasterSourceToDestination, sourcePixel);
    return [
      outputPixel[0] * plan.displayWidth / plan.outputWidth,
      outputPixel[1] * plan.displayHeight / plan.outputHeight,
    ];
  });
  near(rendered[1][1], rendered[0][1]);
  near(rendered[3][0], rendered[0][0]);
  near(rendered[1][0] - rendered[0][0], 16 * 25.4, 0.2);
  near(rendered[3][1] - rendered[0][1], 24 * 25.4, 0.2);
});

test('image-local guide coordinates convert to source pixels', () => {
  const warp = normalizeWarpSettings({ sourceDisplayWidth: 200, sourceDisplayHeight: 100 }, { source: 'data:image/png;base64,a', width: 200, height: 100 });
  assert.deepEqual(localPointToSourcePixel([-100, -50], warp, 400, 300), [0, 0]);
  assert.deepEqual(localPointToSourcePixel([100, 50], warp, 400, 300), [400, 300]);
});

test('perspective transform maps guide points to target rectangle corners', () => {
  const source = [[10, 20], [210, 10], [230, 120], [0, 100]];
  const destination = [[0, 0], [300, 0], [300, 150], [0, 150]];
  const transform = perspectiveTransformFromPoints(source, destination);
  source.forEach((point, index) => {
    const mapped = transformPerspectivePoint(transform, point);
    near(mapped[0], destination[index][0]);
    near(mapped[1], destination[index][1]);
  });
});

test('warp plan preserves guide rectangle dimensions while carrying the full image bounds', () => {
  const entity = {
    type: 'image',
    source: 'data:image/png;base64,a',
    width: 640,
    height: 480,
    warp: normalizeWarpSettings({
      enabled: true,
      source: 'data:image/png;base64,a',
      sourceDisplayWidth: 640,
      sourceDisplayHeight: 480,
      points: [[-180, -24], [190, -44], [180, 118], [-190, 132]],
      targetWidth: 224,
      targetHeight: 168,
    }, { source: 'data:image/png;base64,a', width: 640, height: 480 }),
  };
  const image = { naturalWidth: 1280, naturalHeight: 960 };
  const plan = calculateWarpPlan(entity, image);
  entity.warp.points.forEach((point, index) => {
    const sourcePixel = localPointToSourcePixel(point, entity.warp, image.naturalWidth, image.naturalHeight);
    const mappedPixel = transformPerspectivePoint(plan.sourceToDestination, sourcePixel);
    const mappedDisplay = [mappedPixel[0] / 2, mappedPixel[1] / 2];
    const expected = [[0, 0], [224, 0], [224, 168], [0, 168]][index];
    const projectedOffset = transformPerspectivePoint(plan.sourceToDestination, localPointToSourcePixel(entity.warp.points[0], entity.warp, image.naturalWidth, image.naturalHeight));
    const offsetDisplay = [projectedOffset[0] / 2, projectedOffset[1] / 2];
    near(mappedDisplay[0] - offsetDisplay[0], expected[0]);
    near(mappedDisplay[1] - offsetDisplay[1], expected[1]);
  });
  assert.ok(plan.displayWidth > 224);
  assert.ok(plan.displayHeight > 168);
});

test('inch warp dimensions are stored in drawing units and project to true canvas size', () => {
  const targetWidth = parseWarpDimensionInput('16', 0, 'in');
  const targetHeight = parseWarpDimensionInput('22"', 0, 'in');
  const entity = {
    type: 'image',
    source: 'data:image/png;base64,a',
    width: 640,
    height: 480,
    warp: normalizeWarpSettings({
      enabled: true,
      source: 'data:image/png;base64,a',
      sourceDisplayWidth: 640,
      sourceDisplayHeight: 480,
      points: [[-200, -160], [180, -140], [210, 160], [-190, 150]],
      targetWidth,
      targetHeight,
    }, { source: 'data:image/png;base64,a', width: 640, height: 480 }),
  };
  const image = { naturalWidth: 1280, naturalHeight: 960 };
  const plan = calculateWarpPlan(entity, image);
  const projected = entity.warp.points.map((point) => {
    const sourcePixel = localPointToSourcePixel(point, entity.warp, image.naturalWidth, image.naturalHeight);
    return transformPerspectivePoint(plan.sourceToDestination, sourcePixel);
  });
  near((projected[1][0] - projected[0][0]) / 2, 16 * 25.4);
  near((projected[3][1] - projected[0][1]) / 2, 22 * 25.4);
});

test('large full-image projections downsample raster output without changing display bounds', () => {
  const entity = {
    type: 'image',
    source: 'data:image/png;base64,a',
    width: 800,
    height: 600,
    warp: normalizeWarpSettings({
      sourceDisplayWidth: 800,
      sourceDisplayHeight: 600,
      points: [[-300, -20], [300, -40], [320, 30], [-320, 35]],
      targetWidth: 224,
      targetHeight: 168,
    }, { source: 'data:image/png;base64,a', width: 800, height: 600 }),
  };
  const plan = calculateWarpPlan(entity, { naturalWidth: 3200, naturalHeight: 2400 });
  assert.ok(plan.baseOutputWidth >= plan.outputWidth);
  assert.ok(plan.baseOutputHeight >= plan.outputHeight);
  assert.ok(plan.rasterScale <= 1);
  near(plan.displayWidth, plan.baseOutputWidth / 4);
  near(plan.displayHeight, plan.baseOutputHeight / 4);
});
