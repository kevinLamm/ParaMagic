import { createInfiniteCanvas, createDrawingFeatures, parsePortableDrawingText, importPortableCatalogImage } from '@paramagic/core/editor';
import { configureImageCatalogResources } from '@paramagic/core/images';
import { imageCatalogResources } from '../../app-config.js';
import { createAppSolver } from '../../AppSolver.js';
import { createPrintDialog } from '../../PrintDialog.js';

document.getElementById('root').innerHTML = `<aside class="fixture-controls">
  <h1>Viewer print acceptance</h1><label>Drawing description<textarea>Jazz, iCreate</textarea></label>
  <button data-viewer disabled>Viewer Print</button><button data-editor disabled>Editor Print</button>
  <p>Print captures the actual prepared page here, without opening the system print dialog.</p>
</aside><main class="canvas fixture-canvas"><div class="grid"></div><svg class="drawing-plane"></svg></main>`;
const canvas = createInfiniteCanvas({ canvas: document.querySelector('.fixture-canvas'), grid: document.querySelector('.grid'),
  svg: document.querySelector('.drawing-plane'), solver: createAppSolver(), entities: [], interactive: false, showAxes: false,
  status: document.createElement('span'), reset: document.createElement('button') });
createDrawingFeatures({ canvas });
configureImageCatalogResources(imageCatalogResources);
const content = await (await fetch('./front-view-large-control-edit.paramagic')).text();
const drawing = await parsePortableDrawingText('TestFrontView.paramagic', content, { importAsset: importPortableCatalogImage });
// Include a mix of horizontal and vertical dimensions in the Viewer regression.
drawing.dimensionAnnotations.slice(0, 6).forEach(dimension => { dimension.includeInValueOnly = true; });
canvas.loadDrawingData(drawing, { zoomToFit: true });
canvas.setDimensionTextMode('value');

function matchingDimensionGeometry(root) {
  const groups = [...root.querySelectorAll('.dimension-record')];
  return groups.length > 0 && groups.every(group => {
    const source = [...canvas.getObjectLayer().querySelectorAll('.dimension-record')]
      .find(candidate => candidate.dataset.recordId === group.dataset.recordId);
    if (!source) return false;
    const signature = element => [...element.querySelectorAll('.dimension-text, .dimension-arrow, .dimension-path:not(.hit-target), .dimension-extension:not(.hit-target)')]
      .map(node => ['d', 'x', 'y', 'transform', 'font-size'].map(name => node.getAttribute(name)));
    return JSON.stringify(signature(group)) === JSON.stringify(signature(source));
  });
}

function capturePrint() {
  const prepared = document.querySelector('.print-output-root');
  const capture = document.createElement('section'); capture.className = 'print-capture';
  const close = document.createElement('button'); close.textContent = 'Close captured print'; close.onclick = () => capture.remove();
  const report = document.createElement('output');
  capture.append(close, report, prepared.querySelector('.print-output-page').cloneNode(true)); document.body.append(capture);
  const page = capture.querySelector('.print-output-page');
  const header = page.querySelector('.print-page-header');
  const svg = page.querySelector('svg');
  const pageRect = page.getBoundingClientRect(); const svgRect = svg.getBoundingClientRect();
  const headerRect = header?.getBoundingClientRect();
  const checks = {
    'Complete description copied as text': !header || header.textContent === document.querySelector('textarea').value.trim(),
    'No overlap between description and drawing': !header || headerRect.bottom < svgRect.top,
    'Drawing inside printed page': svgRect.left >= pageRect.left && svgRect.right <= pageRect.right && svgRect.bottom <= pageRect.bottom,
    'Drawing output present': !!svg.querySelector('.canvas-record'),
    'Preview dimension sizes and positions match canvas': matchingDimensionGeometry(document.querySelector('.print-preview-svg')),
    'Printed dimension sizes and positions match canvas': matchingDimensionGeometry(svg),
  };
  report.textContent = Object.entries(checks).map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} ${name}`).join('\n');
  window.dispatchEvent(new Event('afterprint'));
}
const viewer = createPrintDialog({ canvas, getDrawingName: () => 'Drawing',
  fixedSettings: { area: 'full', scaleMode: 'fit', dimensionView: 'value' }, showScaleNote: false,
  getPageHeader: () => document.querySelector('textarea').value, print: capturePrint });
const editor = createPrintDialog({ canvas, print: capturePrint });
document.querySelector('[data-viewer]').onclick = () => viewer.open();
document.querySelector('[data-editor]').onclick = () => editor.open();
document.querySelectorAll('.fixture-controls button').forEach(button => { button.disabled = false; });
