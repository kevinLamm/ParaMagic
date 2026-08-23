import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogImageStrokeSizePatch,
  imageStrokePropertiesMarkup,
  imageStrokeSlicePlan,
  resolveGeometryStrokeAppearance,
  updateStrokeAppearance,
} from '../../packages/paramagic-core/src/modules/ImageStrokeSystem.js';

test('image stroke resolves a catalog reference and its physical dimensions', () => {
  const resolved = resolveGeometryStrokeAppearance({
    strokeExpression: 'basic/Trim/contrast-welt.png',
    strokeImageWidthExpression: '12',
    strokeImageHeightExpression: '3',
    strokeColor: '#123456',
  });

  assert.equal(resolved.strokeType, 'image');
  assert.equal(resolved.strokeImageReference, 'basic/Trim/contrast-welt.png');
  assert.equal(resolved.strokeImageWidth, 12);
  assert.equal(resolved.strokeImageHeight, 3);
  assert.equal(resolved.strokeColor, '#123456');
});

test('switching an image stroke back to a color keeps the color expression workflow', () => {
  const result = updateStrokeAppearance({
    strokeExpression: 'basic/Trim/tape.png',
    strokeImageReference: 'basic/Trim/tape.png',
    strokeColor: '#202020',
  }, { strokeExpression: '#aabbcc' });

  assert.equal(result.error, null);
  assert.equal(result.appearance.strokeType, 'color');
  assert.equal(result.appearance.strokeImageReference, null);
  assert.equal(result.appearance.strokeColor, '#aabbcc');
});

test('catalog standard tile dimensions map to image stroke dimensions', () => {
  assert.deepEqual(catalogImageStrokeSizePatch({
    fillImageWidthExpression: '8 in',
    fillImageHeightExpression: '0.25 in',
  }), {
    strokeImageWidthExpression: '8 in',
    strokeImageHeightExpression: '0.25 in',
  });
});

test('slice plan starts and stops exactly on open path endpoints', () => {
  const slices = imageStrokeSlicePlan(10, 3, 1, 8);

  assert.equal(slices[0].start, 0);
  assert.equal(slices.at(-1).end, 10);
  assert.equal(slices.length, 8);
  assert.ok(slices.every((slice) => slice.start >= 0 && slice.end <= 10));
  assert.ok(slices.every((slice) => slice.end > slice.start));
  assert.ok(slices.every((slice) => slice.phase >= 0 && slice.phase < 3));
});

test('slice plan remains bounded when a long path uses a small repeat image', () => {
  const slices = imageStrokeSlicePlan(600, 6, 1.5, 256);

  assert.equal(slices.length, 256);
  assert.equal(slices.at(-1).end, 600);
});

test('image stroke property markup exposes physical repeat width and brush height', () => {
  const markup = imageStrokePropertiesMarkup();
  assert.match(markup, /Image Stroke Width/);
  assert.match(markup, /Image Stroke Height/);
  assert.match(markup, /imageStrokeParameterNames/);
});
