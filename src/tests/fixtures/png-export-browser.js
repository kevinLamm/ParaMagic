import {
  PNG_EXPORT_FORMATS,
  PNG_EXPORT_PADDING_PIXELS,
  createCanvasPresentationPng,
} from '../../../packages/paramagic-core/src/modules/PngExport.js';
import { createCanvasPresentationSvg } from '../../../packages/paramagic-core/src/modules/CanvasPresentation.js';

const status = document.getElementById('status');
const details = document.getElementById('details');
const resultImage = document.getElementById('result');
const objectLayer = document.getElementById('object-layer');

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
  assert(presentation.querySelector('.dimension-text')?.textContent === '320', 'Driven dimension was not Value Only.');
  assert(!presentation.querySelector('foreignObject'), 'HTML text controls were included in the raster presentation.');
  assert(presentation.querySelector('.drawing-text-presentation')?.textContent === 'Export Text', 'Drawing text was not converted to native SVG text.');
  assert(presentation.querySelector('.notch-line'), 'The physical Notch shape was excluded.');
  assert(!presentation.querySelector('.notch-dot, .notch-hit'), 'Notch editing markers were included in Value Only output.');
  assert(presentation.querySelector('.seam-line-path')?.getAttribute('stroke-dasharray') === '7 5', 'The Seam Line presentation styling was lost.');
  assert(!presentation.querySelector('[data-stack-id="stack-b"]'), 'Another Stack was included.');

  const png = await createCanvasPresentationPng(objectLayer, { stackId: 'stack-a' });
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
    assert(value >= PNG_EXPORT_PADDING_PIXELS - 2, `${side} padding was below the 20-pixel contract.`);
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
    valueOnlyDimension: '320',
  }, null, 2);
  document.documentElement.dataset.pngExportTest = 'passed';
}

run().catch((error) => {
  status.dataset.state = 'failed';
  status.textContent = `FAIL — ${error.message}`;
  details.textContent = error.stack || String(error);
  document.documentElement.dataset.pngExportTest = 'failed';
});
