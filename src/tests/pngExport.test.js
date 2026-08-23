import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAXIMUM_PNG_EXPORT_BYTES,
  PNG_EXPORT_FORMATS,
  PNG_EXPORT_PADDING_PIXELS,
  encodePngWithinLimit,
  fittedPngExportViewport,
  inlinePngPresentationStyles,
  pngBoundsIncludingStroke,
  pngExportFormatForBounds,
} from '../../packages/paramagic-core/src/modules/PngExport.js';

test('PNG export chooses the supported ratio requiring the least bounding-box expansion', () => {
  assert.equal(pngExportFormatForBounds({ x: 0, y: 0, width: 100, height: 90 }).ratio, '1:1');
  assert.equal(pngExportFormatForBounds({ x: 0, y: 0, width: 160, height: 90 }).ratio, '16:9');
  assert.equal(pngExportFormatForBounds({ x: 0, y: 0, width: 90, height: 160 }).ratio, '9:16');
  assert.deepEqual(PNG_EXPORT_FORMATS.map(({ ratio, width, height }) => ({ ratio, width, height })), [
    { ratio: '1:1', width: 1024, height: 1024 },
    { ratio: '16:9', width: 1360, height: 765 },
    { ratio: '9:16', width: 765, height: 1360 },
  ]);
  PNG_EXPORT_FORMATS.forEach(({ width, height }) => {
    assert.ok(width * height <= 1024 * 1024);
    assert.ok(width * height >= 1024 * 1024 * 0.99);
  });
});

test('PNG viewport centers the total bounds with at least 20 output pixels on every side', () => {
  const format = PNG_EXPORT_FORMATS.find(({ ratio }) => ratio === '16:9');
  const bounds = pngBoundsIncludingStroke({ x: -80, y: -45, width: 160, height: 90 }, 2);
  const viewport = fittedPngExportViewport(bounds, format.width, format.height);
  const rightPadding = format.width - viewport.paddingLeft - bounds.width * viewport.scale;
  const bottomPadding = format.height - viewport.paddingTop - bounds.height * viewport.scale;
  assert.ok(viewport.paddingLeft >= PNG_EXPORT_PADDING_PIXELS);
  assert.ok(viewport.paddingTop >= PNG_EXPORT_PADDING_PIXELS);
  assert.ok(rightPadding >= PNG_EXPORT_PADDING_PIXELS);
  assert.ok(bottomPadding >= PNG_EXPORT_PADDING_PIXELS);
  assert.ok(Math.abs(viewport.paddingLeft - rightPadding) < 1e-9);
  assert.ok(Math.abs(viewport.paddingTop - bottomPadding) < 1e-9);
  assert.ok(Math.abs((viewport.width / viewport.height) - (16 / 9)) < 1e-12);
  assert.deepEqual(bounds, { x: -81, y: -46, width: 162, height: 92 });
});

test('PNG encoding starts at the requested resolution and preserves its ratio while enforcing 1 MiB', async () => {
  const format = PNG_EXPORT_FORMATS.find(({ ratio }) => ratio === '16:9');
  const attempts = [];
  const result = await encodePngWithinLimit(format, async (width, height) => {
    attempts.push({ width, height });
    return new Blob([new Uint8Array(width * height * 3)], { type: 'image/png' });
  });
  assert.deepEqual(attempts[0], { width: 1360, height: 765 });
  assert.ok(attempts.length > 1);
  assert.equal(result.ratio, '16:9');
  assert.equal(result.width / result.height, 16 / 9);
  assert.ok(result.blob.size <= MAXIMUM_PNG_EXPORT_BYTES);
});

test('PNG presentation inlines live geometry and dimension colors, strokes, and text styling', () => {
  const pathStyleValues = new Map();
  const textStyleValues = new Map();
  const duplicateStyleValues = new Map();
  const derivedFillStyleValues = new Map();
  const dimensionPath = { tagName: 'path', style: { setProperty: (name, value) => pathStyleValues.set(name, value) }, computed: {
    stroke: '#06402b',
    'stroke-width': '0.9px',
    'vector-effect': 'non-scaling-stroke',
    fill: 'none',
  } };
  const dimensionText = { tagName: 'text', style: { setProperty: (name, value) => textStyleValues.set(name, value) }, computed: {
    fill: '#06402b',
    'font-family': 'Arial',
    'font-size': '14px',
  } };
  const duplicateLine = { tagName: 'line', style: { setProperty: (name, value) => duplicateStyleValues.set(name, value) }, computed: {
    stroke: '#202020',
    'stroke-width': '1.5px',
    'vector-effect': 'non-scaling-stroke',
    fill: 'none',
  } };
  const derivedFill = { tagName: 'path', style: { setProperty: (name, value) => derivedFillStyleValues.set(name, value) }, computed: {
    fill: 'url("#image-fill-derived")',
    'fill-opacity': '0.85',
    stroke: 'rgb(88, 42, 20)',
    'stroke-width': '2px',
    'vector-effect': 'non-scaling-stroke',
  } };
  let selectorUsed = '';
  const svg = {
    tagName: 'svg',
    style: { setProperty() {} },
    querySelectorAll: (selector) => {
      selectorUsed = selector;
      return [dimensionPath, dimensionText, duplicateLine, derivedFill];
    },
  };
  inlinePngPresentationStyles(svg, (node) => ({
    getPropertyValue: (property) => node.computed?.[property] || '',
  }));
  assert.equal(pathStyleValues.get('stroke'), '#06402b');
  assert.equal(pathStyleValues.get('stroke-width'), '0.9px');
  assert.equal(pathStyleValues.get('vector-effect'), 'non-scaling-stroke');
  assert.equal(pathStyleValues.get('fill'), 'none');
  assert.equal(textStyleValues.get('fill'), '#06402b');
  assert.equal(textStyleValues.get('font-family'), 'Arial');
  assert.equal(textStyleValues.get('font-size'), '14px');
  assert.match(selectorUsed, /\.entity/);
  assert.match(selectorUsed, /\.resolved-boundary-visual/);
  assert.match(selectorUsed, /\.linked-copy-group path/);
  assert.match(selectorUsed, /\.array-group image/);
  assert.match(selectorUsed, /\.symmetric-mirror-group line/);
  assert.equal(duplicateStyleValues.get('stroke'), '#202020');
  assert.equal(duplicateStyleValues.get('stroke-width'), '1.5px');
  assert.equal(duplicateStyleValues.get('vector-effect'), 'non-scaling-stroke');
  assert.equal(duplicateStyleValues.get('fill'), 'none');
  assert.equal(derivedFillStyleValues.get('fill'), 'url("#image-fill-derived")');
  assert.equal(derivedFillStyleValues.get('fill-opacity'), '0.85');
  assert.equal(derivedFillStyleValues.get('stroke'), 'rgb(88, 42, 20)');
  assert.equal(derivedFillStyleValues.get('stroke-width'), '2px');
  assert.equal(derivedFillStyleValues.get('vector-effect'), 'non-scaling-stroke');
});

test('PNG export rejects empty or non-measurable bounds', () => {
  assert.throws(
    () => pngExportFormatForBounds({ x: 0, y: 0, width: 0, height: 10 }),
    /visible object with measurable bounds/i,
  );
});
