import test from 'node:test';
import assert from 'node:assert/strict';
import cvPromise from '@techstark/opencv-js';
import {
  ARUCO_WARP_DICTIONARY,
  classifyArucoWarpMarkers,
  detectArucoMarkersInMat,
  orderArucoWarpMarkers,
} from '../../packages/paramagic-core/src/modules/ImageWarpAruco.js';

const marker = (id, center) => ({ id, center, corners: [] });

test('required marker centers are ordered spatially rather than by marker ID', () => {
  const ordered = orderArucoWarpMarkers([
    marker(2, [820, 700]),
    marker(0, [790, 120]),
    marker(3, [110, 720]),
    marker(1, [130, 150]),
  ]);
  assert.deepEqual(ordered.map(({ id }) => id), [1, 0, 2, 3]);
});

test('classification requires one each of IDs 0 through 3 and ignores extras', () => {
  const complete = classifyArucoWarpMarkers([
    marker(8, [450, 450]),
    marker(0, [790, 120]),
    marker(3, [110, 720]),
    marker(1, [130, 150]),
    marker(2, [820, 700]),
  ]);
  assert.equal(complete.state, 'complete');
  assert.deepEqual(complete.detectedIds, [0, 1, 2, 3, 8]);
  assert.deepEqual(complete.extraIds, [8]);
  assert.deepEqual(complete.orderedMarkers.map(({ id }) => id), [1, 0, 2, 3]);

  const partial = classifyArucoWarpMarkers([
    marker(0, [790, 120]),
    marker(1, [130, 150]),
    marker(3, [110, 720]),
  ]);
  assert.equal(partial.state, 'partial');
  assert.deepEqual(partial.detectedIds, [0, 1, 3]);
  assert.deepEqual(partial.missingIds, [2]);

  const duplicate = classifyArucoWarpMarkers([
    marker(0, [790, 120]),
    marker(1, [130, 150]),
    marker(2, [820, 700]),
    marker(3, [110, 720]),
    marker(3, [120, 710]),
  ]);
  assert.equal(duplicate.state, 'partial');
  assert.deepEqual(duplicate.duplicateIds, [3]);
});

test('the bundled OpenCV 5 ArUCo detector finds a synthetic DICT_4X4_50 marker set', async () => {
  const cv = await cvPromise;
  const dictionary = cv.getPredefinedDictionary(cv[ARUCO_WARP_DICTIONARY]);
  const image = new cv.Mat(900, 1100, cv.CV_8UC1, new cv.Scalar(255));
  try {
    for (const [id, x, y] of [[1, 100, 100], [0, 800, 100], [2, 800, 600], [3, 100, 600]]) {
      const generated = new cv.Mat();
      const region = image.roi(new cv.Rect(x, y, 180, 180));
      try {
        cv.generateImageMarker(dictionary, id, 180, generated, 1);
        generated.copyTo(region);
      } finally {
        generated.delete();
        region.delete();
      }
    }
    const detection = detectArucoMarkersInMat(cv, image);
    assert.deepEqual(detection.markers.map(({ id }) => id).sort((a, b) => a - b), [0, 1, 2, 3]);
    const classified = classifyArucoWarpMarkers(detection.markers);
    assert.equal(classified.state, 'complete');
    assert.deepEqual(classified.orderedMarkers.map(({ id }) => id), [1, 0, 2, 3]);
  } finally {
    image.delete();
    dictionary.delete();
  }
});
