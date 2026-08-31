import test from 'node:test';
import assert from 'node:assert/strict';
import { isStackThumbnailSourceNode, valueOnlyDimensionText } from '../../packages/paramagic-core/src/modules/StackSystem.js';

function node({ classes = [], stackId = 'stack-default', construction = false } = {}) {
  const names = new Set(classes);
  return {
    classList: { contains: (name) => names.has(name) },
    getAttribute: (name) => name === 'data-stack-id' ? stackId : null,
    querySelector: (selector) => selector === '.construction' && construction ? {} : null,
  };
}

test('Stack thumbnail sources include only owned canvas, array, and symmetric presentation groups', () => {
  const stackId = 'stack-a';
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['canvas-record'], stackId }), stackId), true);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['array-group'], stackId }), stackId), true);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['symmetric-mirror-group'], stackId }), stackId), true);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['canvas-record', 'object-visibility-hidden'], stackId }), stackId), false);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['array-group', 'object-visibility-hidden'], stackId }), stackId), false);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['canvas-record'], stackId: 'stack-b' }), stackId), false);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['closed-constrained-region'], stackId }), stackId), false);
});

test('Value Only Stack thumbnails include opted-in Driving Dimensions and omit excluded presentation', () => {
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['canvas-record', 'dimension-driving', 'dimension-export-excluded'] }), 'stack-default'), false);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['canvas-record', 'dimension-driving'] }), 'stack-default'), true);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['canvas-record'], construction: true }), 'stack-default'), false);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['array-group'], construction: true }), 'stack-default'), true);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['canvas-record', 'dimension-driven'] }), 'stack-default'), true);
  assert.equal(isStackThumbnailSourceNode(node({ classes: ['canvas-record', 'dimension-driven', 'dimension-export-excluded'] }), 'stack-default'), false);
  assert.equal(valueOnlyDimensionText('d12 = 31.75'), '31.75');
  assert.equal(valueOnlyDimensionText('31.75'), '31.75');
});
