import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fitCanvasPresentationSvg,
  fittedPresentationViewport,
  isCanvasPresentationSourceNode,
  valueOnlyDimensionText,
} from '../../packages/paramagic-core/src/modules/CanvasPresentation.js';

function presentationNode(classes, stackId = 'stack-default') {
  const names = new Set(classes);
  return {
    classList: { contains: (name) => names.has(name) },
    getAttribute: (name) => name === 'data-stack-id' ? stackId : null,
    querySelector: () => null,
  };
}

test('canvas presentation filtering is shared by whole-drawing and per-stack snapshots', () => {
  const source = presentationNode(['canvas-record'], 'stack-a');
  const array = presentationNode(['array-group'], 'stack-a');
  const otherStack = presentationNode(['canvas-record'], 'stack-b');
  const drivingDimension = presentationNode(['canvas-record', 'dimension-driving'], 'stack-a');
  const editingRegion = presentationNode(['canvas-record', 'closed-constrained-region'], 'stack-a');

  assert.equal(isCanvasPresentationSourceNode(source), true);
  assert.equal(isCanvasPresentationSourceNode(array), true);
  assert.equal(isCanvasPresentationSourceNode(otherStack), true);
  assert.equal(isCanvasPresentationSourceNode(source, 'stack-a'), true);
  assert.equal(isCanvasPresentationSourceNode(otherStack, 'stack-a'), false);
  assert.equal(isCanvasPresentationSourceNode(drivingDimension, 'stack-a'), false);
  assert.equal(isCanvasPresentationSourceNode(editingRegion, 'stack-a'), false);
});

test('canvas presentation snapshots share Value Only labels and fitted viewports', () => {
  assert.equal(valueOnlyDimensionText('d47 = 12.25'), '12.25');
  assert.equal(valueOnlyDimensionText('12.25'), '12.25');
  const viewport = fittedPresentationViewport({ x: 0, y: 0, width: 160, height: 100 }, 240, 150);
  assert.ok(Math.abs(viewport.x + 15.36) < 1e-9);
  assert.ok(Math.abs(viewport.y + 9.6) < 1e-9);
  assert.ok(Math.abs(viewport.width - 190.72) < 1e-9);
  assert.ok(Math.abs(viewport.height - 119.2) < 1e-9);
});

test('export viewport fitting reuses the SVG dimensions when callers omit explicit preview sizes', () => {
  const attributes = new Map([['width', '240'], ['height', '150']]);
  const content = {
    getBBox: () => ({ x: -100, y: -50, width: 400, height: 200 }),
    querySelectorAll: () => [],
  };
  const svg = {
    getAttribute: (name) => attributes.get(name) || null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    querySelector: (selector) => selector === '[data-canvas-presentation-content]' ? content : null,
  };

  const viewport = fitCanvasPresentationSvg(svg);

  assert.ok(Object.values(viewport).every(Number.isFinite));
  assert.equal(attributes.get('viewBox'), '-124 -90 448 280');
});
