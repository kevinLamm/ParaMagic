import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flipImageEntity,
  imageAppearance,
  normalizeImageEntity,
  rotateImageFromPointer,
  scaleImageFromCorner,
} from '../modules/ImageManipulation.js';
import { mergeDrawingData, serializeDrawingJson } from '../modules/DrawingIO.js';

const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('image entities normalize transform and appearance data', () => {
  const image = normalizeImageEntity({ source, x: 10, y: 20, width: 200, height: 100, rotation: 15, appearance: { fillOpacityExpression: 'fade', fillOpacity: 0.4 } });
  assert.equal(image.type, 'image');
  assert.equal(image.source, source);
  assert.equal(image.width, 200);
  assert.equal(image.rotation, 15);
  assert.deepEqual(imageAppearance(image, (expression) => expression === 'fade' ? 40 : 100), {
    fillOpacityExpression: 'fade',
    fillOpacity: 0.4,
    zIndex: null,
    error: null,
  });
});

test('corner scaling preserves aspect ratio and anchors the opposite corner', () => {
  const image = normalizeImageEntity({ source, x: 0, y: 0, width: 200, height: 100 });
  const scaled = scaleImageFromCorner(image, 2, [200, 100]);
  near(scaled.width / scaled.height, 2);
  near(scaled.x - scaled.width / 2, -100);
  near(scaled.y - scaled.height / 2, -50);
});

test('rotation and flip helpers preserve the rest of the image entity', () => {
  const image = normalizeImageEntity({ source, x: 0, y: 0, width: 100, height: 50 });
  const rotated = rotateImageFromPointer(image, [0, -50], [50, 0]);
  near(rotated.rotation, 90);
  assert.equal(flipImageEntity(rotated, 'horizontal').flipX, true);
  assert.equal(flipImageEntity(rotated, 'vertical').flipY, true);
});

test('Base64 image data survives JSON export and inserted image IDs are remapped', () => {
  const image = normalizeImageEntity({ id: 'image-shared', source, x: 5, y: 6, width: 80, height: 40 });
  const parsed = JSON.parse(serializeDrawingJson({ entities: [image] }, 'Image Drawing'));
  assert.equal(parsed.entities[0].source, source);
  assert.equal(parsed.entities[0].type, 'image');

  const merged = mergeDrawingData({ entities: [image] }, { entities: [image] });
  assert.equal(merged.entities.length, 2);
  assert.notEqual(merged.entities[0].id, merged.entities[1].id);
  assert.equal(merged.entities[1].source, source);
});
