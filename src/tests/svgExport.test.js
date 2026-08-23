import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeCanvasPresentationSvg } from '../../packages/paramagic-core/src/modules/SvgExport.js';

test('SVG export serializes the shared live-canvas presentation snapshot', async () => {
  const objectLayer = { id: 'live-object-layer' };
  const presentation = { id: 'shared-presentation' };
  let presentationOptions = null;
  let serializedNode = null;
  let embeddedMarkup = null;

  const svg = await serializeCanvasPresentationSvg(objectLayer, {
    stackId: 'stack-upholstery',
    width: 320,
    height: 200,
  }, {
    createPresentationSvg(options) {
      presentationOptions = options;
      return presentation;
    },
    serializePresentationElement(node) {
      serializedNode = node;
      return '<svg><g transform="translate(829.733 0)"/></svg>';
    },
    async embedImageAssets(markup) {
      embeddedMarkup = markup;
      return markup.replace('</svg>', '<image href="data:image/webp;base64,V0VCUA=="/></svg>');
    },
  });

  assert.equal(presentationOptions.objectLayer, objectLayer);
  assert.equal(presentationOptions.stackId, 'stack-upholstery');
  assert.equal(presentationOptions.width, 320);
  assert.equal(presentationOptions.height, 200);
  assert.equal(presentationOptions.background, null);
  assert.equal(serializedNode, presentation);
  assert.match(embeddedMarkup, /translate\(829\.733 0\)/);
  assert.match(svg, /data:image\/webp;base64,V0VCUA==/);
});

test('SVG export reports when no live canvas presentation is available', async () => {
  await assert.rejects(
    serializeCanvasPresentationSvg(null, {}, {
      createPresentationSvg: () => null,
      embedImageAssets: async (markup) => markup,
    }),
    /canvas presentation is unavailable/i,
  );
});
