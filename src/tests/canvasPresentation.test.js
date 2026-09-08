import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasPresentationDefinitionRoots,
  constructionHiddenInValueOnly,
  fitCanvasPresentationSvg,
  fittedPresentationViewport,
  isCanvasPresentationSourceNode,
  valueOnlyDimensionText,
} from '../../packages/paramagic-core/src/modules/CanvasPresentation.js';

test('Value Only identifies construction sources for derivative renderers', () => {
  assert.equal(constructionHiddenInValueOnly({ construction: true }, 'value'), true);
  assert.equal(constructionHiddenInValueOnly({ construction: false }, 'value'), false);
  assert.equal(constructionHiddenInValueOnly({ construction: true }, 'named-value'), false);
});

function svgNode(tagName, attributes = {}, children = []) {
  const node = {
    tagName,
    children,
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, localName: name, value })),
    getAttribute: (name) => attributes[name] || null,
    querySelectorAll: (selector) => selector === '*'
      ? children.flatMap((child) => [child, ...(child.querySelectorAll?.('*') || [])])
      : [],
  };
  return node;
}

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
  const excludedDrivingDimension = presentationNode([
    'canvas-record',
    'dimension-driving',
    'dimension-export-excluded',
  ], 'stack-a');
  const includedDrivingDimension = presentationNode(['canvas-record', 'dimension-driving'], 'stack-a');
  const editingRegion = presentationNode(['canvas-record', 'closed-constrained-region'], 'stack-a');
  const disabledStack = presentationNode(['canvas-record', 'stack-disabled'], 'stack-a');

  assert.equal(isCanvasPresentationSourceNode(source), true);
  assert.equal(isCanvasPresentationSourceNode(array), true);
  assert.equal(isCanvasPresentationSourceNode(otherStack), true);
  assert.equal(isCanvasPresentationSourceNode(source, 'stack-a'), true);
  assert.equal(isCanvasPresentationSourceNode(otherStack, 'stack-a'), false);
  assert.equal(isCanvasPresentationSourceNode(excludedDrivingDimension, 'stack-a'), false);
  assert.equal(isCanvasPresentationSourceNode(includedDrivingDimension, 'stack-a'), true);
  assert.equal(isCanvasPresentationSourceNode(editingRegion, 'stack-a'), false);
  assert.equal(isCanvasPresentationSourceNode(disabledStack, 'stack-a'), false);
});

test('Value Only presentation keeps derived Swell records while omitting their construction sources', () => {
  const constructionSource = presentationNode(['canvas-record'], 'stack-a');
  constructionSource.querySelector = (selector) => selector === '.construction' ? {} : null;
  const derivedSwell = presentationNode(['canvas-record', 'swell-derived-group'], 'stack-a');
  const derivedSwellFill = presentationNode(['canvas-record', 'swell-derived-fill-group'], 'stack-a');

  assert.equal(isCanvasPresentationSourceNode(constructionSource, 'stack-a'), false);
  assert.equal(isCanvasPresentationSourceNode(derivedSwell, 'stack-a'), true);
  assert.equal(isCanvasPresentationSourceNode(derivedSwellFill, 'stack-a'), true);
});

test('print presentation modes include construction and excluded dimensions outside Value Only', () => {
  const constructionSource = presentationNode(['canvas-record'], 'stack-a');
  constructionSource.querySelector = (selector) => selector === '.construction' ? {} : null;
  const excludedDimension = presentationNode([
    'canvas-record',
    'dimension-driving',
    'dimension-export-excluded',
  ], 'stack-a');

  assert.equal(isCanvasPresentationSourceNode(constructionSource, 'stack-a'), false);
  assert.equal(isCanvasPresentationSourceNode(excludedDimension, 'stack-a'), false);
  assert.equal(isCanvasPresentationSourceNode(
    constructionSource,
    'stack-a',
    { dimensionTextMode: 'named-value' },
  ), true);
  assert.equal(isCanvasPresentationSourceNode(
    excludedDimension,
    'stack-a',
    { dimensionTextMode: 'expression' },
  ), true);
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

test('canvas presentation copies only referenced definition dependencies', () => {
  const externalImage = svgNode('image', { href: 'https://example.invalid/stale.png' });
  const unusedPattern = svgNode('pattern', { id: 'unused-image' }, [externalImage]);
  const gradient = svgNode('linearGradient', { id: 'used-gradient' });
  const usedPattern = svgNode('pattern', { id: 'used-pattern', fill: 'url(#used-gradient)' });
  const definitions = svgNode('defs', {}, [unusedPattern, gradient, usedPattern]);
  const ownerSVGElement = svgNode('svg', {}, [definitions]);
  const objectLayer = { ownerSVGElement };
  const content = svgNode('g', {}, [svgNode('rect', { fill: 'url("#used-pattern")' })]);

  assert.deepEqual(
    canvasPresentationDefinitionRoots(objectLayer, content),
    [gradient, usedPattern],
  );
});

test('canvas presentation omits all live-canvas definitions when exported content has no references', () => {
  const stalePattern = svgNode('pattern', { id: 'stale-image' }, [
    svgNode('image', { href: 'https://example.invalid/stale.png' }),
  ]);
  const ownerSVGElement = svgNode('svg', {}, [svgNode('defs', {}, [stalePattern])]);
  const content = svgNode('g', {}, [svgNode('path', { stroke: '#000000' })]);

  assert.deepEqual(canvasPresentationDefinitionRoots({ ownerSVGElement }, content), []);
});
