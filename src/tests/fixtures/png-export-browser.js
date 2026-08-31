import {
  PNG_EXPORT_FORMATS,
  PNG_EXPORT_CAPTURE_DENSITY,
  PNG_EXPORT_PADDING_PIXELS,
  createCanvasPresentationPng,
  rasterizePresentationSvg,
} from '../../../packages/paramagic-core/src/modules/PngExport.js';
import { createCanvasPresentationSvg } from '../../../packages/paramagic-core/src/modules/CanvasPresentation.js';
import { createDimensionRecord } from '../../../packages/paramagic-core/src/modules/DimensionSystem.js';
import { serializeCanvasPresentationSvg } from '../../../packages/paramagic-core/src/modules/SvgExport.js';
import { formatValueOnlyDimensionValue } from '../../../packages/paramagic-core/src/modules/solver/Units.js';

const status = document.getElementById('status');
const details = document.getElementById('details');
const resultImage = document.getElementById('result');
const svgResult = document.getElementById('svg-result');
const objectLayer = document.getElementById('object-layer');

function addSvg(parent, tag, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
  parent.appendChild(node);
  return node;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function decodedImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The encoded PNG could not be decoded.'));
    };
    image.src = url;
  });
}

function nonWhiteBounds(data, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const nonWhite = data[offset] < 250 || data[offset + 1] < 250 || data[offset + 2] < 250;
      if (!nonWhite) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, top, right, bottom };
}

async function run() {
  const sourceDimensionScale = 0.25;
  const sourceDimensionValue = 1.14 * 25.4;
  const valueOnlyDimensionText = formatValueOnlyDimensionValue(sourceDimensionValue, 'in');
  const dimensionRecord = createDimensionRecord({
    add: addSvg,
    objectLayer,
    entity: {
      id: 'png-dimension-scale-proof',
      type: 'dimension-line',
      subtype: 'horizontal',
      dimensionMode: 'driven',
      dimensionId: 'png-dimension-value',
      start: [20, 0],
      end: [340, 0],
      measureStart: [20, 0],
      measureEnd: [340, 0],
      label: [180, 260],
      text: 'Width = 1.14',
    },
    index: 0,
    scale: sourceDimensionScale,
    updateRecordHandles() {},
    bindRecordEvents() {},
  });
  dimensionRecord.group.setAttribute('data-stack-id', 'stack-a');

  const presentation = createCanvasPresentationSvg({
    objectLayer,
    stackId: 'stack-a',
    width: 1024,
    height: 1024,
    background: '#ffffff',
  });
  const presentationText = presentation.textContent;
  assert(presentation.querySelector('.array-group'), 'Derived array geometry was excluded.');
  assert(!presentation.querySelector('.dimension-driving'), 'Driving dimensions were included.');
  assert(!presentation.querySelector('.object-visibility-hidden'), 'Hidden geometry was included.');
  assert(!presentation.querySelector('.construction'), 'Construction geometry was included.');
  assert(!presentationText.includes('Driving') && !presentationText.includes('999'), 'Driving dimension text survived filtering.');
  assert(presentation.querySelector('.dimension-text')?.textContent === '1.14', 'Shared presentation did not remove the dimension name.');
  assert(!presentation.querySelector('foreignObject'), 'HTML text controls were included in the raster presentation.');
  assert(presentation.querySelector('.drawing-text-presentation')?.textContent === 'Export Text', 'Drawing text was not converted to native SVG text.');
  assert(presentation.querySelectorAll('.table-cell-text-presentation').length === 2, 'Table cell editors were not converted to native SVG text.');
  assert([...presentation.querySelectorAll('.table-cell-text-presentation')].map((node) => node.textContent).join('|') === 'Table A|Table B', 'Table cell text was lost during presentation conversion.');
  assert(presentation.querySelector('.notch-line'), 'The physical Notch shape was excluded.');
  assert(!presentation.querySelector('.notch-dot, .notch-hit'), 'Notch editing markers were included in Value Only output.');
  assert(presentation.querySelector('.seam-line-path')?.getAttribute('stroke-dasharray') === '7 5', 'The Seam Line presentation styling was lost.');
  assert(!presentation.querySelector('[data-stack-id="stack-b"]'), 'Another Stack was included.');
  assert(presentation.querySelectorAll('.subtract-result-boundary').length === 4, 'A source or Duplicate lost its authoritative Boolean result.');
  assert(!presentation.querySelector('.subtract-source-record .resolved-boundary-visual'), 'A stylesheet-hidden source fill survived export preparation.');
  assert(!presentation.querySelector('.entity-record.subtract-source-record .selectable-entity'), 'Stylesheet-hidden source geometry survived export preparation.');
  assert(presentation.querySelectorAll('.linked-copy-group .subtract-result-boundary').length === 2, 'Duplicate Boolean results were not preserved.');
  assert(presentation.querySelector('.linked-copy-group .subtract-result-boundary[fill="url(#browser-test-image-fill)"]'), 'Duplicate image fill was not preserved on the Boolean contour.');

  const serializedSvg = await serializeCanvasPresentationSvg(objectLayer, {
    stackId: 'stack-a',
    resolveValueOnlyDimensionText: (dimensionId) => dimensionId === 'png-dimension-value'
      ? valueOnlyDimensionText
      : '',
  });
  assert(serializedSvg.includes('1.125&quot;') || serializedSvg.includes('1.125"'), 'SVG dimension text did not round to the nearest eighth inch.');
  assert(serializedSvg.includes('#06402B') || serializedSvg.includes('#06402b') || serializedSvg.includes('rgb(6, 64, 43)'), 'SVG dimensions did not use the Driven Dimension export color.');
  assert(!serializedSvg.includes('resolved-boundary-visual'), 'SVG export serialized a stylesheet-hidden source fill.');
  assert(!serializedSvg.includes('closed-entity selectable-entity'), 'SVG export serialized stylesheet-hidden source geometry.');
  assert((serializedSvg.match(/class="subtract-result-boundary"/g) || []).length === 4, 'SVG export did not keep all original and Duplicate Boolean contours.');
  assert(serializedSvg.includes('fill="url(#browser-test-image-fill)"'), 'SVG export lost the Duplicate image fill reference.');
  svgResult.innerHTML = serializedSvg;

  let dimensionMetrics = null;
  const png = await createCanvasPresentationPng(objectLayer, {
    stackId: 'stack-a',
    resolveValueOnlyDimensionText: (dimensionId) => dimensionId === 'png-dimension-value'
      ? valueOnlyDimensionText
      : '',
  }, {
    rasterizePresentation: async (svg, width, height) => {
      const viewBox = svg.getAttribute('viewBox').trim().split(/\s+/).map(Number);
      const scale = Math.min(width / viewBox[2], height / viewBox[3]);
      const arrow = svg.querySelector('.dimension-arrow');
      const arrowValues = arrow.getAttribute('d').match(/[-+]?(?:\d+\.?\d*|\.\d+)/g).map(Number);
      const tip = arrowValues.slice(0, 2);
      const baseCenter = [
        (arrowValues[2] + arrowValues[4]) / 2,
        (arrowValues[3] + arrowValues[5]) / 2,
      ];
      const pathValues = svg.querySelector('.dimension-path').getAttribute('d')
        .match(/[-+]?(?:\d+\.?\d*|\.\d+)/g).map(Number);
      const text = svg.querySelector('.dimension-text');
      assert(text.textContent === '1.125"', 'PNG dimension text did not round to the nearest eighth inch.');
      assert(getComputedStyle(text).fill === 'rgb(6, 64, 43)', 'PNG dimensions did not use the Driven Dimension export color.');
      dimensionMetrics = {
        arrowLength: Math.hypot(baseCenter[0] - tip[0], baseCenter[1] - tip[1]) * scale,
        fontSize: Number.parseFloat(text.getAttribute('font-size')) * scale,
        textOffset: Math.abs(Number(text.getAttribute('y')) - pathValues[1]) * scale,
      };
      return rasterizePresentationSvg(svg, width, height);
    },
  });
  assert(Math.abs(dimensionMetrics.arrowLength - 12 * PNG_EXPORT_CAPTURE_DENSITY) < 0.01, 'Dimension arrowhead did not retain its app size at capture density.');
  assert(Math.abs(dimensionMetrics.fontSize - 14 * PNG_EXPORT_CAPTURE_DENSITY) < 0.01, 'Dimension text did not retain its app size at capture density.');
  assert(Math.abs(dimensionMetrics.textOffset - 14 * PNG_EXPORT_CAPTURE_DENSITY) < 0.01, 'Dimension text offset did not retain its app spacing at capture density.');
  assert(png.blob.type === 'image/png', 'The output MIME type is not image/png.');
  assert(['1:1', '16:9', '9:16'].includes(png.ratio), 'The PNG used an unsupported aspect ratio.');
  const expectedRatio = png.ratio === '16:9' ? 16 / 9 : png.ratio === '9:16' ? 9 / 16 : 1;
  assert(Math.abs((png.width / png.height) - expectedRatio) < 1e-12, 'The encoded ratio was not preserved.');
  const format = PNG_EXPORT_FORMATS.find(({ ratio }) => ratio === png.ratio);
  assert(png.width === format.width && png.height === format.height, 'The full fitted capture size was not saved.');

  const decoded = await decodedImage(png.blob);
  const canvas = document.createElement('canvas');
  canvas.width = png.width;
  canvas.height = png.height;
  const context = canvas.getContext('2d');
  context.drawImage(decoded.image, 0, 0);
  const pixels = context.getImageData(0, 0, png.width, png.height);
  const corner = [...pixels.data.slice(0, 4)];
  assert(corner[0] === 255 && corner[1] === 255 && corner[2] === 255 && corner[3] === 255, 'The background is not opaque white.');
  const bounds = nonWhiteBounds(pixels.data, png.width, png.height);
  assert(bounds.right >= bounds.left && bounds.bottom >= bounds.top, 'No visible content was rasterized.');
  const padding = {
    left: bounds.left,
    top: bounds.top,
    right: png.width - 1 - bounds.right,
    bottom: png.height - 1 - bounds.bottom,
  };
  Object.entries(padding).forEach(([side, value]) => {
    assert(value >= PNG_EXPORT_PADDING_PIXELS - 2, `${side} padding was below the ${PNG_EXPORT_PADDING_PIXELS}-pixel contract.`);
  });

  resultImage.src = decoded.url;
  resultImage.hidden = false;
  status.dataset.state = 'passed';
  status.textContent = 'PASS — the local PNG export completed without a tainted canvas.';
  details.textContent = JSON.stringify({
    ratio: png.ratio,
    width: png.width,
    height: png.height,
    bytes: png.blob.size,
    padding,
    valueOnlyDimension: valueOnlyDimensionText,
    svgValueOnlyDimension: valueOnlyDimensionText,
    dimensionMetrics,
  }, null, 2);
  document.documentElement.dataset.pngExportTest = 'passed';
}

run().catch((error) => {
  status.dataset.state = 'failed';
  status.textContent = `FAIL — ${error.message}`;
  details.textContent = error.stack || String(error);
  document.documentElement.dataset.pngExportTest = 'failed';
});
