import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectDrawingImageReferences, compactSvgImageAssets, configureImageCatalogResources, embedSvgImageAssets,
  hydratePortableImageAssets, imageFillContentUrl, parsePortableDrawingText,
  serializePortableDrawingJson, serializePortablePackageJson,
} from '../../packages/paramagic-core/src/modules/ImageSystem.js';

const drawing = {
  entities: [
    { id: 'shape-a', type: 'circle', appearance: { fillExpression: 'user/image-a', fillImageReference: 'user/image-a', fillType: 'image' } },
    { id: 'shape-b', type: 'rect', appearance: { fillExpression: 'user/image-a', fillImageReference: 'user/image-a', fillType: 'image' } },
    { id: 'shape-c', type: 'polygon', appearance: { fillExpression: '#ffffff', fillColor: '#ffffff' } },
  ],
};

test('portable JSON embeds each referenced image once without altering normal drawing data', async () => {
  assert.deepEqual(collectDrawingImageReferences(drawing), ['user/image-a']);
  const portable = JSON.parse(await serializePortableDrawingJson(drawing, 'Portable', {
    fetchAsset: async () => ({
      bytes: Uint8Array.from([137, 80, 78, 71]),
      mimeType: 'image/png',
      fileName: 'fabric.png',
      sha256: 'a'.repeat(64),
    }),
  }));
  assert.equal(portable.embeddedAssets.images.length, 1);
  assert.equal(portable.embeddedAssets.images[0].dataBase64, 'iVBORw==');
  assert.equal('embeddedAssets' in drawing, false);
});

test('portable import hydrates images and rewrites every matching appearance reference', async () => {
  const portable = JSON.stringify({
    format: 'ParaMagic Drawing', version: 1, ...drawing,
    embeddedAssets: { images: [{
      reference: 'user/image-a', fileName: 'fabric.png', mimeType: 'image/png',
      sha256: 'a'.repeat(64), dataBase64: 'iVBORw==',
    }] },
  });
  const imported = await parsePortableDrawingText('drawing.json', portable, {
    importAsset: async ({ bytes }) => {
      assert.deepEqual([...bytes], [137, 80, 78, 71]);
      return 'imported/local-image';
    },
  });
  assert.equal(imported.entities[0].appearance.fillExpression, 'imported/local-image');
  assert.equal(imported.entities[1].appearance.fillImageReference, 'imported/local-image');
});

test('portable stack packages embed and hydrate image references inside their drawing', async () => {
  const packageValue = { format: 'ParaMagic Clipboard', version: 1, drawing };
  const portable = JSON.parse(await serializePortablePackageJson(packageValue, {
    fetchAsset: async () => ({
      bytes: Uint8Array.from([137, 80, 78, 71]), mimeType: 'image/png', sha256: 'b'.repeat(64),
    }),
  }));
  assert.equal(portable.embeddedAssets.images.length, 1);
  const hydrated = await hydratePortableImageAssets(portable, {
    importAsset: async () => 'imported/stack-image',
  });
  assert.equal(hydrated.drawing.entities[0].appearance.fillExpression, 'imported/stack-image');
  assert.equal('embeddedAssets' in hydrated, false);
});

test('portable SVG without catalog images is unchanged and does not fetch assets', async () => {
  const svg = '<svg><rect fill="#ffffff"/></svg>';
  const portableSvg = await embedSvgImageAssets(svg, {
    fetchAsset: async () => assert.fail('an asset fetch was not expected'),
  });
  assert.equal(portableSvg, svg);
});

test('portable SVG embeds host-configured static basic images', async (context) => {
  context.after(() => configureImageCatalogResources());
  configureImageCatalogResources({
    manifestUrl: 'https://app.example/catalog.json',
    assetBaseUrl: 'https://app.example/basic-images/',
  });
  const reference = 'basic/Fabric/linen.webp';
  const url = imageFillContentUrl(reference);
  const svg = `<svg><pattern><image href="${url}"/></pattern></svg>`;
  const portableSvg = await embedSvgImageAssets(svg, {
    fetchAsset: async (requestedReference) => {
      assert.equal(requestedReference, reference);
      return { bytes: Uint8Array.from([137, 80, 78, 71]), mimeType: 'image/png' };
    },
  });
  assert.match(portableSvg, /href="data:image\/png;base64,iVBORw=="/);
  assert.doesNotMatch(portableSvg, /app\.example/);
});

test('portable SVG shares one embedded image asset across repeated pattern images', async (context) => {
  context.after(() => configureImageCatalogResources());
  configureImageCatalogResources({
    manifestUrl: 'https://app.example/catalog.json',
    assetBaseUrl: 'https://app.example/basic-images/',
  });
  const reference = 'basic/Fabric/linen.webp';
  const url = imageFillContentUrl(reference);
  const patterns = [1, 2, 3].map((sequence) => (
    `<pattern id="pattern-${sequence}"><image x="0" y="0" width="304.8" height="304.8" preserveAspectRatio="none" href="${url}" xmlns:ns${sequence}="http://www.w3.org/1999/xlink" ns${sequence}:href="${url}"/></pattern>`
  )).join('');
  let fetchCount = 0;
  const portableSvg = await embedSvgImageAssets(`<svg><defs>${patterns}</defs></svg>`, {
    fetchAsset: async (requestedReference) => {
      fetchCount += 1;
      assert.equal(requestedReference, reference);
      return { bytes: Uint8Array.from([137, 80, 78, 71]), mimeType: 'image/png' };
    },
  });

  assert.equal(fetchCount, 1);
  assert.equal((portableSvg.match(/data:image\/png;base64,iVBORw==/g) || []).length, 1);
  assert.equal((portableSvg.match(/<image\b/g) || []).length, 1);
  assert.equal((portableSvg.match(/<use href="#paramagic-shared-image-1"/g) || []).length, 3);
  assert.doesNotMatch(portableSvg, /xmlns:ns|ns\d+:href|app\.example/);
});

test('SVG image compaction preserves distinct display sizes while sharing their source', () => {
  const source = '<svg><defs>'
    + '<image x="0" y="0" width="304.8" height="304.8" preserveAspectRatio="none" href="data:image/png;base64,iVBORw=="/>'
    + '<image x="0" y="0" width="800" height="800" preserveAspectRatio="none" href="data:image/png;base64,iVBORw=="/>'
    + '</defs></svg>';
  const compacted = compactSvgImageAssets(source);
  assert.equal((compacted.match(/data:image\/png;base64,iVBORw==/g) || []).length, 1);
  assert.match(compacted, /<use href="#paramagic-shared-image-1" x="0" y="0" width="304\.8" height="304\.8"/);
  assert.match(compacted, /<use href="#paramagic-shared-image-1" x="0" y="0" width="800" height="800"/);
});
