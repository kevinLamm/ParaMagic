import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogImageFillSizePatch,
  closedImageFillSelection, imageFillContentUrl, imageFillPatternDefinition,
  configureImageCatalogResources, getImageCatalogResourceConfiguration, loadImageCatalog,
  imageFillReferenceFromContentUrl,
  imageFillMetricsAppearancePatch,
  imageFillPropertiesMarkup, imageFillSelectionProperties, isImageFillReference,
  MAXIMUM_RUNTIME_CATALOG_IMAGE_BYTES, prepareImageFillContentUrl, reduceCatalogImageBlob,
  resolveGeometryFillAppearance,
  resolveImageFillLength, resolveImageFillOffset, resolveImageFillScale, updateFillAppearance,
  runtimeCatalogImageInfo,
} from '../../packages/paramagic-core/src/modules/ImageSystem.js';

function fakeCanvas(encodedSize) {
  const draws = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect() {},
      drawImage: (...args) => draws.push(args),
    }),
    toBlob(callback, type, quality) {
      callback(new Blob([new Uint8Array(encodedSize(canvas.width, canvas.height, quality))], { type }));
    },
  };
  return { canvas, draws };
}

test('runtime catalog reduction caps lossless images at 128 KiB while preserving aspect ratio', async () => {
  let closed = false;
  const { canvas, draws } = fakeCanvas((width, height) => width * height);
  const result = await reduceCatalogImageBlob(
    new Blob([new Uint8Array(200_000)], { type: 'image/png' }),
    {
      createImageBitmapImpl: async () => ({ width: 600, height: 400, close: () => { closed = true; } }),
      createCanvas: () => canvas,
    },
  );
  assert.ok(result.size <= MAXIMUM_RUNTIME_CATALOG_IMAGE_BYTES);
  assert.equal(result.type, 'image/png');
  assert.equal(closed, true);
  const [, , , renderedWidth, renderedHeight] = draws.at(-1);
  assert.ok(Math.abs((renderedWidth / renderedHeight) - 1.5) < 0.01);
});

test('runtime catalog reduction retains full dimensions when lossy encoding alone meets the cap', async () => {
  const { canvas, draws } = fakeCanvas((width, height, quality) => Math.ceil(width * height * quality));
  const result = await reduceCatalogImageBlob(
    new Blob([new Uint8Array(200_000)], { type: 'image/webp' }),
    {
      createImageBitmapImpl: async () => ({ width: 500, height: 500, close() {} }),
      createCanvas: () => canvas,
    },
  );
  assert.ok(result.size <= MAXIMUM_RUNTIME_CATALOG_IMAGE_BYTES);
  assert.equal(result.type, 'image/webp');
  assert.equal(draws.at(-1)[3], 500);
  assert.equal(draws.at(-1)[4], 500);
});

test('catalog preparation caches a capped runtime Blob URL without changing the static source', async (context) => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  context.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    configureImageCatalogResources();
  });
  const { canvas } = fakeCanvas((width, height) => width * height);
  let sourceFetches = 0;
  globalThis.fetch = async () => {
    sourceFetches += 1;
    return {
      ok: true,
      blob: async () => new Blob([new Uint8Array(200_000)], { type: 'image/png' }),
    };
  };
  globalThis.document = { createElement: () => canvas };
  globalThis.createImageBitmap = async () => ({ width: 600, height: 400, close() {} });
  configureImageCatalogResources({
    manifestUrl: 'https://app.example/assets/catalog.json',
    assetBaseUrl: 'https://app.example/assets/images',
  });
  const reference = 'basic/Fabric/large.png';
  const staticUrl = imageFillContentUrl(reference);
  const first = await prepareImageFillContentUrl(reference);
  const second = await prepareImageFillContentUrl(reference);
  assert.equal(sourceFetches, 1);
  assert.equal(second, first);
  assert.notEqual(first, staticUrl);
  assert.equal(imageFillContentUrl(reference), first);
  assert.equal(imageFillReferenceFromContentUrl(first), reference);
  const runtimeBlob = await originalFetch(first).then((response) => response.blob());
  assert.ok(runtimeBlob.size <= MAXIMUM_RUNTIME_CATALOG_IMAGE_BYTES);
  assert.deepEqual(runtimeCatalogImageInfo(reference), {
    contentUrl: first,
    byteSize: runtimeBlob.size,
  });
});

test('catalog preparation isolates small cross-origin images behind runtime Blob URLs', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
    configureImageCatalogResources();
  });
  let sourceFetches = 0;
  globalThis.fetch = async () => {
    sourceFetches += 1;
    return {
      ok: true,
      blob: async () => new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' }),
    };
  };
  configureImageCatalogResources({
    manifestUrl: 'https://cdn.example/catalog.json',
    assetBaseUrl: 'https://cdn.example/images',
  });
  const reference = 'basic/Fabric/small.png';
  const staticUrl = imageFillContentUrl(reference);
  const runtimeUrl = await prepareImageFillContentUrl(reference);

  assert.equal(sourceFetches, 1);
  assert.notEqual(runtimeUrl, staticUrl);
  assert.match(runtimeUrl, /^blob:/);
  assert.equal(imageFillReferenceFromContentUrl(runtimeUrl), reference);
  const runtimeBlob = await originalFetch(runtimeUrl).then((response) => response.blob());
  assert.deepEqual([...new Uint8Array(await runtimeBlob.arrayBuffer())], [137, 80, 78, 71]);
});

test('image fill mode control defaults to Tiled without exposing a Mixed option', () => {
  const markup = imageFillPropertiesMarkup();
  assert.match(markup, /<option value="tile" selected>Tiled<\/option>/);
  assert.doesNotMatch(markup, />Mixed<\/option>/);
  assert.match(markup, />Tile Shift Left</);
  assert.match(markup, />Tile Shift Top</);
  assert.match(markup, /Image Fill Rotation Angle/);
  assert.match(markup, /id="imageFillRotationProperty"[^>]*type="number"/);
  assert.doesNotMatch(markup, />Tile Width</);
  assert.doesNotMatch(markup, />Tile Height</);
  assert.doesNotMatch(markup, /Tile Scale/);
  assert.ok(markup.indexOf('value="tile"') < markup.indexOf('value="scale"'));
});

test('catalog standard size becomes independent per-object tile expressions', () => {
  assert.deepEqual(catalogImageFillSizePatch({
    standardTileWidth: 254,
    standardTileHeight: 203.2,
  }, (value) => `${value / 25.4} in`), {
    fillImageWidthExpression: '10 in',
    fillImageHeightExpression: '8 in',
  });
  assert.deepEqual(catalogImageFillSizePatch({}), {});
});

test('host configuration maps a read-only manifest to stable basic image references', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
    configureImageCatalogResources();
  });
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return {
      ok: true,
      json: async () => ({
        version: 1,
        assets: [{
          reference: 'basic/Fabric/linen.webp',
          standardTileWidth: 254,
          standardTileHeight: 203.2,
        }],
      }),
    };
  };

  configureImageCatalogResources({
    manifestUrl: 'https://app.example/assets/catalog.json',
    assetBaseUrl: 'https://app.example/assets/images',
  });
  assert.deepEqual(getImageCatalogResourceConfiguration(), {
    manifestUrl: 'https://app.example/assets/catalog.json',
    assetBaseUrl: 'https://app.example/assets/images/',
    readOnly: true,
  });
  assert.equal(
    imageFillContentUrl('basic/Fabric/linen.webp'),
    'https://app.example/assets/images/Fabric/linen.webp',
  );
  assert.equal(
    imageFillContentUrl('user/asset-1'),
    '',
  );
  const catalog = await loadImageCatalog();
  assert.deepEqual(requests, ['https://app.example/assets/catalog.json']);
  assert.equal(catalog.basic.length, 1);
  assert.equal(catalog.basic[0].reference, 'basic/Fabric/linen.webp');
  assert.equal(catalog.basic[0].contentUrl, 'https://app.example/assets/images/Fabric/linen.webp');
  assert.equal(catalog.basic[0].standardTileWidth, 254);
  assert.deepEqual(catalog.user, []);
  assert.deepEqual(catalog.imported, []);
});

test('image fill expressions resolve as catalog references while colors remain expressions', () => {
  assert.equal(isImageFillReference('basic/Fabric/linen.webp'), true);
  assert.equal(isImageFillReference('https://example.com/image.png'), false);
  assert.equal(
    imageFillContentUrl('user/asset-1'),
    '',
  );
  assert.deepEqual(resolveGeometryFillAppearance({
    fillExpression: 'basic/Fabric/linen.webp', fillColor: '#abcdef',
  }), {
    fillExpression: 'basic/Fabric/linen.webp',
    fillType: 'image',
    fillImageReference: 'basic/Fabric/linen.webp',
    fillImageMode: 'tile',
    fillImageRotationAngle: 0,
    fillImageScaleExpression: '100',
    fillImageScale: 100,
    fillImageAspectRatio: 1,
    fillImagePixelWidth: null,
    fillImagePixelHeight: null,
    fillImageWidthExpression: '',
    fillImageHeightExpression: '',
    fillImageWidth: 1,
    fillImageHeight: 1,
    fillImageLeftExpression: '0',
    fillImageTopExpression: '0',
    fillImageLeft: 0,
    fillImageTop: 0,
    imageWidthError: null,
    imageHeightError: null,
    imageLeftError: null,
    imageTopError: null,
    imageRotationError: null,
    fillColor: '#abcdef',
    error: null,
    imageScaleError: null,
  });
  assert.equal(resolveGeometryFillAppearance({ fillExpression: '16711680' }, Number).fillColor, '#ff0000');

  const color = updateFillAppearance({ fillImageReference: 'user/old', fillColor: '#abcdef' }, '#123456');
  assert.equal(color.appearance.fillType, 'color');
  assert.equal(color.appearance.fillImageReference, null);
  assert.equal(color.appearance.fillColor, '#123456');
});

test('string-valued parameters resolve to linked catalog image fills', () => {
  const evaluate = (expression) => expression === 'Fabric1'
    ? 'basic/Fabric/linen-texture-wallpaper-2x.jpg'
    : Number(expression);
  const resolved = resolveGeometryFillAppearance({
    fillExpression: 'Fabric1', fillColor: '#abcdef',
  }, evaluate);
  assert.equal(resolved.fillExpression, 'Fabric1');
  assert.equal(resolved.fillType, 'image');
  assert.equal(resolved.fillImageReference, 'basic/Fabric/linen-texture-wallpaper-2x.jpg');
  assert.equal(resolved.error, null);

  const updated = updateFillAppearance(
    { fillColor: '#abcdef' },
    { fillExpression: 'Fabric1' },
    evaluate,
  );
  assert.equal(updated.error, null);
  assert.equal(updated.appearance.fillExpression, 'Fabric1');
  assert.equal(updated.appearance.fillImageReference, 'basic/Fabric/linen-texture-wallpaper-2x.jpg');
});

test('Scale covers without distortion while Stretch and Tile use exact requested dimensions', () => {
  assert.deepEqual(resolveImageFillScale('imageScale', (expression) => (
    expression === 'imageScale' ? 40 : NaN
  )), { expression: 'imageScale', value: 40, error: null });
  assert.match(resolveImageFillScale('0').error, /greater than 0/);
  assert.deepEqual(resolveImageFillLength('tileWidth', 1, (expression) => (
    expression === 'tileWidth' ? 160 : NaN
  )), { expression: 'tileWidth', value: 160, error: null });
  assert.deepEqual(resolveImageFillOffset('-12', Number), {
    expression: '-12', value: -12, error: null,
  });

  const base = {
    fillImageReference: 'basic/Fabric/linen.webp', fillColor: '#abcdef',
    fillImageScale: 40, fillImageAspectRatio: 2,
    fillImagePixelWidth: 400, fillImagePixelHeight: 200,
    fillImageWidthExpression: '160 mm', fillImageHeightExpression: '80 mm',
    fillImageWidth: 160, fillImageHeight: 80,
    fillImageLeftExpression: '0', fillImageTopExpression: '-12',
    fillImageLeft: 0, fillImageTop: -12,
  };
  const bounds = { x: 10, y: 20, width: 80, height: 40 };
  const scaled = imageFillPatternDefinition({ ...base, fillImageMode: 'scale' }, bounds);
  assert.equal(scaled.pattern.patternUnits, 'userSpaceOnUse');
  assert.deepEqual(
    {
      x: scaled.pattern.x,
      y: scaled.pattern.y,
      width: scaled.pattern.width,
      height: scaled.pattern.height,
    },
    bounds,
  );
  assert.deepEqual(
    {
      x: scaled.image.x,
      y: scaled.image.y,
      width: scaled.image.width,
      height: scaled.image.height,
    },
    { x: -40, y: -20, width: 160, height: 80 },
  );
  assert.equal(scaled.pattern.viewBox, '0 0 80 40');
  assert.equal(scaled.image.preserveAspectRatio, 'xMidYMid meet');
  assert.equal(scaled.pattern['data-image-fill-width'], undefined);

  const stretched = imageFillPatternDefinition({ ...base, fillImageMode: 'stretch' }, bounds);
  assert.deepEqual(
    {
      x: stretched.image.x,
      y: stretched.image.y,
      width: stretched.image.width,
      height: stretched.image.height,
    },
    { x: 0, y: 0, width: 80, height: 40 },
  );
  assert.equal(stretched.image.preserveAspectRatio, 'none');

  const tiled = imageFillPatternDefinition({ ...base, fillImageMode: 'tile' }, bounds);
  assert.deepEqual(
    {
      x: tiled.pattern.x,
      y: tiled.pattern.y,
      width: tiled.pattern.width,
      height: tiled.pattern.height,
      imageX: tiled.image.x,
      imageY: tiled.image.y,
      imageWidth: tiled.image.width,
      imageHeight: tiled.image.height,
    },
    {
      x: -80, y: -52, width: 160, height: 80,
      imageX: 0, imageY: 0, imageWidth: 160, imageHeight: 80,
    },
  );
  assert.equal(tiled.pattern['data-image-fill-width'], 160);
  assert.equal(tiled.pattern['data-image-fill-height'], 80);
  assert.equal(tiled.pattern['data-image-fill-left'], 0);
  assert.equal(tiled.pattern['data-image-fill-top'], -12);
  assert.equal(tiled.image.preserveAspectRatio, 'none');

  const rotated = imageFillPatternDefinition({
    ...base,
    fillImageMode: 'scale',
    fillImageRotationAngle: 37.5,
  }, bounds);
  assert.equal(rotated.pattern['data-image-fill-rotation-angle'], 37.5);
  assert.equal(rotated.pattern.patternTransform, 'rotate(37.5 50 40)');

  const resized = imageFillPatternDefinition(
    { ...base, fillImageMode: 'scale' },
    { x: 10, y: 20, width: 120, height: 50 },
  );
  assert.deepEqual(
    { width: resized.image.width, height: resized.image.height },
    { width: 240, height: 120 },
  );
  const resizedTile = imageFillPatternDefinition(
    { ...base, fillImageMode: 'tile' },
    { x: 10, y: 20, width: 120, height: 50 },
  );
  assert.deepEqual(
    {
      x: resizedTile.pattern.x,
      y: resizedTile.pattern.y,
      width: resizedTile.image.width,
      height: resizedTile.image.height,
    },
    { x: -80, y: -52, width: 160, height: 80 },
  );
});

test('image fill settings persist expressions and report mixed selections', () => {
  const evaluateLength = (expression) => ({
    tileWidth: 160,
    tileHeight: 80,
    leftShift: 0,
    topShift: -12,
  })[expression] ?? Number(expression);
  const updated = updateFillAppearance({
    fillExpression: 'user/image-a', fillImageReference: 'user/image-a', fillType: 'image',
    fillImageAspectRatio: 2, fillImagePixelWidth: 400, fillImagePixelHeight: 200,
    fillImageWidthExpression: 'tileWidth',
    fillImageHeightExpression: 'tileHeight',
  }, {
    fillImageMode: 'tile',
    fillImageRotationAngle: 22.5,
    fillImageLeftExpression: 'leftShift',
    fillImageTopExpression: 'topShift',
  }, Number, evaluateLength);
  assert.equal(updated.error, null);
  assert.equal(updated.appearance.fillImageMode, 'tile');
  assert.equal(updated.appearance.fillImageRotationAngle, 22.5);
  assert.equal(updated.appearance.fillImageLeftExpression, 'leftShift');
  assert.equal(updated.appearance.fillImageTopExpression, 'topShift');

  assert.deepEqual(imageFillSelectionProperties([
    resolveGeometryFillAppearance(updated.appearance, Number, evaluateLength),
  ], true), {
    canEditImageFillSettings: true,
    imageFillMode: 'tile',
    mixedImageFillMode: false,
    imageFillRotationAngle: 22.5,
    mixedImageFillRotationAngle: false,
    imageFillLeftExpression: 'leftShift',
    mixedImageFillLeft: false,
    imageFillTopExpression: 'topShift',
    mixedImageFillTop: false,
    imageLeftError: null,
    imageTopError: null,
    imageRotationError: null,
  });
  assert.equal(imageFillSelectionProperties([
    resolveGeometryFillAppearance(updated.appearance, Number, evaluateLength),
    resolveGeometryFillAppearance({
      ...updated.appearance,
      fillImageTopExpression: '0',
    }, Number, evaluateLength),
  ], true).mixedImageFillTop, true);

  const invalidTop = resolveGeometryFillAppearance({
    ...updated.appearance, fillImageTopExpression: 'missingParameter',
  }, Number, () => { throw new Error('Unknown parameter'); });
  assert.match(invalidTop.imageTopError, /Unknown parameter/);

  const separateLengthEvaluator = resolveGeometryFillAppearance({
    ...updated.appearance,
    fillImageLeftExpression: 'd1',
    fillImageTopExpression: 'd2',
  }, () => 3.329, (expression) => expression === 'd1' ? 84.5566 : -42.2783);
  assert.equal(separateLengthEvaluator.fillImageLeft, 84.5566);
  assert.equal(separateLengthEvaluator.fillImageTop, -42.2783);
});

test('image metrics initialize per-image dimensions while width and height remain independent', () => {
  assert.deepEqual(imageFillMetricsAppearancePatch({}, {
    aspectRatio: 2,
    pixelWidth: 400,
    pixelHeight: 200,
  }, (value) => `${value / 25.4} in`), {
    fillImageAspectRatio: 2,
    fillImagePixelWidth: 400,
    fillImagePixelHeight: 200,
    fillImageWidthExpression: `${400 / 25.4} in`,
    fillImageHeightExpression: `${200 / 25.4} in`,
  });
  assert.equal(imageFillMetricsAppearancePatch({
    fillImageWidthExpression: '8 in',
  }, {
    aspectRatio: 2,
    pixelWidth: 400,
    pixelHeight: 200,
  }, (value) => `${value / 25.4} in`).fillImageHeightExpression, `${200 / 25.4} in`);
  const heightEdited = updateFillAppearance({
    fillExpression: 'user/image-a',
    fillImageReference: 'user/image-a',
    fillImageAspectRatio: 2,
    fillImageWidthExpression: '10 in',
  }, { fillImageHeightExpression: '3 in' }, Number, () => 1);
  assert.equal(heightEdited.appearance.fillImageHeightExpression, '3 in');
  assert.equal(heightEdited.appearance.fillImageWidthExpression, '10 in');

  const changedImage = updateFillAppearance({
    fillExpression: 'user/image-a',
    fillImageReference: 'user/image-a',
    fillImageAspectRatio: 2,
    fillImagePixelWidth: 400,
    fillImagePixelHeight: 200,
    fillImageWidthExpression: '8 in',
    fillImageHeightExpression: '4 in',
    fillImageLeftExpression: '2 in',
    fillImageTopExpression: '-1 in',
  }, { fillExpression: 'user/image-b' });
  assert.equal(changedImage.appearance.fillImageWidthExpression, '');
  assert.equal(changedImage.appearance.fillImageHeightExpression, '');
  assert.equal(changedImage.appearance.fillImageLeftExpression, '0');
  assert.equal(changedImage.appearance.fillImageTopExpression, '0');
});

test('image fill is available only when the complete selected object is closed', () => {
  const records = [
    { id: 'circle', recordType: 'geometry', entity: { type: 'circle' } },
    { id: 'a', recordType: 'geometry', entity: { type: 'line' } },
    { id: 'b', recordType: 'geometry', entity: { type: 'line' } },
  ];
  assert.equal(closedImageFillSelection(records, new Set(['circle']), []).canEditImageFill, true);
  assert.equal(closedImageFillSelection(records, new Set(['a']), []).canEditImageFill, false);
  assert.deepEqual(
    closedImageFillSelection(records, new Set(['a', 'b']), [[{ entityId: 'a' }, { entityId: 'b' }]]),
    { canEditImageFill: true, targetIds: ['a', 'b'] },
  );
});
