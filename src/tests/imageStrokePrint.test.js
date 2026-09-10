import assert from 'node:assert/strict';
import test from 'node:test';
import { imageStrokePrintRasterSize, prepareImageStrokePrintSvg } from '../../packages/paramagic-core/src/modules/ImageStrokePrint.js';

test('image strokes use physical print density with bounded bitmap memory for large sheets', () => {
  assert.deepEqual(imageStrokePrintRasterSize({ width: 25.4, height: 12.7 }, 300 / 25.4), { width: 300, height: 150 });
  const large = imageStrokePrintRasterSize({ width: 10000, height: 5000 }, 300 / 25.4);
  assert.ok(large.width <= 8192 && large.height <= 8192);
  assert.ok(large.width * large.height <= 16 * 1024 * 1024);
  assert.ok(Math.abs(large.width / large.height - 2) < 0.001);
});

test('drawings without image strokes pass through without rasterization or measurement', async () => {
  await prepareImageStrokePrintSvg({ querySelectorAll: () => [] }, {}, {}, {
    rasterize: () => assert.fail('Ordinary vector drawings must not be rasterized'),
  });
});
