import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PNG_EXPORT_FORMATS,
  PNG_EXPORT_CAPTURE_DENSITY,
  PNG_EXPORT_PADDING_PIXELS,
  applyPngValueOnlyDimensionText,
  assertPngRasterSourcesEmbedded,
  encodePngAtCaptureSize,
  fittedPngExportViewport,
  inlinePngPresentationStyles,
  pngBoundsIncludingStroke,
  pngExportFormatForBounds,
  preparePngRasterMarkup,
  rasterizePresentationSvg,
} from '../../packages/paramagic-core/src/modules/PngExport.js';

test('PNG export chooses the supported ratio requiring the least bounding-box expansion', () => {
  assert.equal(PNG_EXPORT_CAPTURE_DENSITY, 2);
  assert.equal(pngExportFormatForBounds({ x: 0, y: 0, width: 100, height: 90 }).ratio, '1:1');
  assert.equal(pngExportFormatForBounds({ x: 0, y: 0, width: 160, height: 90 }).ratio, '16:9');
  assert.equal(pngExportFormatForBounds({ x: 0, y: 0, width: 90, height: 160 }).ratio, '9:16');
  assert.deepEqual(PNG_EXPORT_FORMATS.map(({ ratio, width, height }) => ({ ratio, width, height })), [
    { ratio: '1:1', width: 2048, height: 2048 },
    { ratio: '16:9', width: 2720, height: 1530 },
    { ratio: '9:16', width: 1530, height: 2720 },
  ]);
  PNG_EXPORT_FORMATS.forEach(({ width, height }) => {
    assert.ok(width * height >= 4 * 1024 * 1024 * 0.99);
    assert.ok(width * height <= 4 * 1024 * 1024);
  });
});

test('PNG viewport centers the total bounds with at least 50 output pixels on every side', () => {
  assert.equal(PNG_EXPORT_PADDING_PIXELS, 50);
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

test('PNG export requests exact Value Only dimension text independently of the live label', () => {
  let appliedText = '';
  let requestedId = '';
  const textNode = { textContent: 'd1 = 100.013' };
  const group = {
    getAttribute: (name) => name === 'data-dimension-id' ? 'dimension-1' : null,
    querySelector: (selector) => selector === '.dimension-text' ? textNode : null,
  };
  const root = { querySelectorAll: () => [group] };

  applyPngValueOnlyDimensionText(root, (dimensionId) => {
    requestedId = dimensionId;
    return '100"';
  });
  appliedText = textNode.textContent;

  assert.equal(requestedId, 'dimension-1');
  assert.equal(appliedText, '100"');
});

test('PNG encoding saves the full selected capture size without dimension reduction', async () => {
  const format = PNG_EXPORT_FORMATS.find(({ ratio }) => ratio === '16:9');
  const attempts = [];
  const result = await encodePngAtCaptureSize(format, async (width, height) => {
    attempts.push({ width, height });
    return new Blob([new Uint8Array(width * height * 3)], { type: 'image/png' });
  });
  assert.deepEqual(attempts, [{ width: 2720, height: 1530 }]);
  assert.equal(result.ratio, '16:9');
  assert.equal(result.width / result.height, 16 / 9);
  assert.ok(result.blob.size > 1024 * 1024);
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

test('PNG raster preparation embeds every image source before loading the SVG image', async () => {
  const steps = [];
  const svg = {};
  const markup = await preparePngRasterMarkup(svg, {
    inlinePresentationStyles: (received) => {
      assert.equal(received, svg);
      steps.push('styles');
    },
    serializePresentationElement: (received) => {
      assert.equal(received, svg);
      steps.push('serialize');
      return '<svg><image href="https://images.example/fabric.png"></image></svg>';
    },
    embedImageAssets: async (serialized) => {
      assert.match(serialized, /images\.example/);
      steps.push('embed');
      return '<svg><image href="data:image/png;base64,iVBORw=="></image></svg>';
    },
  });

  assert.deepEqual(steps, ['styles', 'serialize', 'embed']);
  assert.match(markup, /data:image\/png/);
});

test('PNG raster preparation refuses unresolved image sources before canvas drawing', async () => {
  assert.throws(
    () => assertPngRasterSourcesEmbedded('<svg><image href="blob:https://app.example/unresolved"></image></svg>'),
    /could not embed an image source/i,
  );
  assert.doesNotThrow(() => assertPngRasterSourcesEmbedded(
    '<svg><image href="data:image/webp;base64,V0VCUA=="></image><use href="#shared"/></svg>',
  ));
  assert.throws(
    () => assertPngRasterSourcesEmbedded('<svg><foreignObject><textarea>Text</textarea></foreignObject></svg>'),
    /drawing text must use native SVG text/i,
  );
  await assert.rejects(
    () => preparePngRasterMarkup({}, {
      inlinePresentationStyles: () => {},
      serializePresentationElement: () => '<svg><image href="https://images.example/fabric.png"/></svg>',
      embedImageAssets: async (serialized) => serialized,
    }),
    /could not embed an image source/i,
  );
});

test('PNG rasterization saves the full fitted capture canvas without downsampling', async () => {
  const svg = {
    style: {},
    querySelectorAll: () => [],
  };
  const draws = [];
  const context = {
    fillRect() {},
    drawImage: (...args) => draws.push(args),
  };
  const canvas = {
    getContext: () => context,
    toBlob: (resolve) => resolve(new Blob(['png'], { type: 'image/png' })),
  };
  let released = false;

  const blob = await rasterizePresentationSvg(svg, 2720, 1530, {
    createCanvas: () => canvas,
    inlinePresentationStyles: () => {},
    embedImageAssets: async (markup) => markup,
    serializePresentationElement: () => '<svg/>',
    loadSvgImage: async () => ({ image: { source: 'svg' }, release: () => { released = true; } }),
  });

  assert.equal(canvas.width, 2720);
  assert.equal(canvas.height, 1530);
  assert.deepEqual(draws[0].slice(1), [0, 0, 2720, 1530]);
  assert.equal(blob.type, 'image/png');
  assert.equal(released, true);
});

test('PNG export keeps its measurement host mounted while rendering one full-size fitted snapshot', async () => {
  const presentations = [];
  const host = {
    style: {},
    isConnected: false,
    replaceChildren(svg) { this.svg = svg; },
    remove() { this.isConnected = false; },
  };
  const documentRef = {
    body: {
      appendChild(received) {
        assert.equal(received, host);
        received.isConnected = true;
      },
    },
    createElement() { return host; },
  };
  const createPresentationSvg = () => {
    const content = {
      querySelector: () => null,
      querySelectorAll: () => [],
      getBBox: () => ({ x: 0, y: 0, width: 160, height: 90 }),
    };
    const svg = {
      content,
      querySelector: (selector) => selector === '[data-canvas-presentation-content]' ? content : null,
      setAttribute() {},
    };
    presentations.push(svg);
    return svg;
  };
  const rasterized = [];
  const rasterizePresentation = async (svg, width, height) => {
    rasterized.push({ svg, width, height });
    await Promise.resolve();
    assert.equal(host.isConnected, true);
    return new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/png' });
  };

  const { createCanvasPresentationPng } = await import('../../packages/paramagic-core/src/modules/PngExport.js');
  const result = await createCanvasPresentationPng({}, { documentRef }, {
    createPresentationSvg,
    rasterizePresentation,
  });

  assert.equal(rasterized.length, 1);
  assert.equal(rasterized[0].width, 2720);
  assert.equal(rasterized[0].height, 1530);
  assert.equal(presentations.length, 2);
  assert.equal(result.blob.size, 2 * 1024 * 1024);
  assert.equal(host.isConnected, false);
});

test('shared rasterization supports transparent artwork without painting a white rectangle behind it', async () => {
  const draws = [];
  const canvas = {
    getContext: () => ({
      fillRect: () => assert.fail('Transparent brush snapshots must not cover underlying drawing objects'),
      drawImage: (...args) => draws.push(args),
    }),
    toBlob: resolve => resolve(new Blob(['png'], { type: 'image/png' })),
  };
  let released = false;
  await rasterizePresentationSvg({}, 100, 50, {
    background: null,
    createCanvas: () => canvas,
    prepareRasterMarkup: async () => '<svg/>',
    loadSvgImage: async () => ({ image: {}, release: () => { released = true; } }),
  });
  assert.equal(draws.length, 1);
  assert.equal(released, true);
});

test('PNG export rejects empty or non-measurable bounds', () => {
  assert.throws(
    () => pngExportFormatForBounds({ x: 0, y: 0, width: 0, height: 10 }),
    /visible object with measurable bounds/i,
  );
});
