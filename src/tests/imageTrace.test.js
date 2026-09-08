import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureOpenCvResources,
  createImageTraceSettingsMemory,
  getOpenCvResourceConfiguration,
  imageLocalToWorldPoint,
  imagePixelToLocalPoint,
  imageWorldToLocalPoint,
  imageWorldToPixelPoint,
  normalizeImageTraceSettings,
} from '../../packages/paramagic-core/src/modules/ImageTrace.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const nearPoint = (actual, expected) => {
  near(actual[0], expected[0]);
  near(actual[1], expected[1]);
};

test('the host configures the exact OpenCV script resource used by core', (context) => {
  context.after(() => configureOpenCvResources());
  assert.throws(() => configureOpenCvResources({}), /scriptUrl/);
  assert.deepEqual(configureOpenCvResources({
    scriptUrl: 'https://cdn.example/opencv/5.0.0/opencv.js',
  }), {
    scriptUrl: 'https://cdn.example/opencv/5.0.0/opencv.js',
  });
  assert.deepEqual(getOpenCvResourceConfiguration(), {
    scriptUrl: 'https://cdn.example/opencv/5.0.0/opencv.js',
  });
});

test('image trace settings use practical defaults and clamp user input', () => {
  assert.deepEqual(normalizeImageTraceSettings(), { tolerance: 24, detail: 8, smoothing: 1 });
  assert.deepEqual(normalizeImageTraceSettings({ tolerance: 250, detail: 0, smoothing: -4 }), {
    tolerance: 100,
    detail: 1,
    smoothing: 0,
  });
  assert.deepEqual(normalizeImageTraceSettings({ tolerance: '18', detail: '9', smoothing: '3' }), {
    tolerance: 18,
    detail: 9,
    smoothing: 3,
  });
});

test('image trace settings memory recalls the latest normalized slider values', () => {
  const memory = createImageTraceSettingsMemory();
  assert.deepEqual(memory.recall(), { tolerance: 24, detail: 8, smoothing: 1 });
  assert.deepEqual(memory.remember({ tolerance: '41', detail: '6', smoothing: '4' }), {
    tolerance: 41,
    detail: 6,
    smoothing: 4,
  });
  const recalled = memory.recall();
  assert.deepEqual(recalled, { tolerance: 41, detail: 6, smoothing: 4 });
  recalled.tolerance = 0;
  assert.equal(memory.recall().tolerance, 41);
});

test('trace coordinates map the displayed image corners to raster corners', () => {
  const entity = { x: 300, y: 200, width: 200, height: 100, rotation: 0, flipX: false, flipY: false };
  assert.deepEqual(imageWorldToPixelPoint(entity, [200, 150], 401, 201), [0, 0]);
  assert.deepEqual(imageWorldToPixelPoint(entity, [400, 250], 401, 201), [400, 200]);
  assert.deepEqual(imagePixelToLocalPoint(entity, [0, 0], 401, 201), [-100, -50]);
  assert.deepEqual(imagePixelToLocalPoint(entity, [400, 200], 401, 201), [100, 50]);
});

test('trace coordinate conversion respects image rotation and flips', () => {
  const entity = { x: 120, y: 80, width: 240, height: 120, rotation: 37, flipX: true, flipY: false };
  const local = [42, -27];
  const world = imageLocalToWorldPoint(entity, local);
  nearPoint(imageWorldToLocalPoint(entity, world), local);
  const pixel = imageWorldToPixelPoint(entity, world, 481, 241);
  assert.deepEqual(pixel, [324, 66]);
  nearPoint(imagePixelToLocalPoint(entity, pixel, 481, 241), local);
});

test('pixel points converted to world coordinates retain the displayed image transform', () => {
  const entity = { x: 50, y: 75, width: 100, height: 50, rotation: 90, flipX: false, flipY: true };
  const local = imagePixelToLocalPoint(entity, [100, 50], 201, 101);
  assert.deepEqual(local, [0, 0]);
  nearPoint(imageLocalToWorldPoint(entity, local), [50, 75]);
  nearPoint(imageLocalToWorldPoint(entity, [50, -25]), [25, 125]);
});
