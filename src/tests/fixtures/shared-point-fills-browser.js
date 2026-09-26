import { canvasController as canvas, initialization } from '../../main.js';
import { sharedPointRegions, touchingComposites } from './sharedPointRegions.js';
import { normalizeDrawingData, serializeDrawingJson } from '../../../packages/paramagic-core/src/modules/DrawingIO.js';

await initialization;
const base = structuredClone(canvas.getDrawingData());
const panel = document.createElement('div');
panel.style.cssText = 'position:fixed;top:54px;left:320px;z-index:3000;background:white;padding:8px;display:flex;gap:8px';
const output = document.createElement('output');
output.setAttribute('aria-label', 'Shared point fill verification');
output.style.cssText = 'position:fixed;bottom:40px;left:320px;z-index:3000;background:white;padding:8px;white-space:pre-wrap;font:12px monospace';
document.body.append(panel, output);
let current;
const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const button = (label, action) => {
  const node = document.createElement('button');
  node.textContent = label;
  node.onclick = async (event) => {
    event.stopPropagation();
    try { await action(); } catch (error) { output.textContent = `FAIL: ${error.message}`; throw error; }
  };
  panel.append(node);
};

async function load(entities) {
  const drawing = structuredClone(base);
  drawing.entities = entities;
  drawing.constraints = [];
  drawing.parameters = [];
  drawing.dimensionAnnotations = [];
  canvas.loadDrawingData(normalizeDrawingData({ ...drawing, identityArchitectureVersion: 0 }), { zoomToFit: true });
  canvas.setActiveStack(canvas.getDrawingData().entities[0].stackId);
  await frames();
  current = canvas.getDrawingData();
  verify();
}

function verify() {
  const paths = [...document.querySelectorAll('.resolved-boundary-visual')];
  if (paths.length !== 2) throw Error(`Expected 2 filled regions, got ${paths.length}`);
  const colors = paths.map((path) => getComputedStyle(path).fill).sort();
  if (colors.join('|') !== 'rgb(232, 93, 117)|rgb(69, 139, 232)') throw Error(`Wrong fill colors: ${colors}`);
  const hits = [...document.querySelectorAll('.closed-region-hit')];
  if (hits.length !== 2) throw Error(`Expected 2 selectable regions, got ${hits.length}`);
  output.textContent = 'PASS: Two independent fill regions; pink and blue. Click either interior to select its boundary.';
}

button('Line / arc / curve', () => load(sharedPointRegions()));
button('Touching rectangles', () => load(touchingComposites()));
button('Mixed objects', () => load([
  ...touchingComposites().slice(0, 4),
  { id: 'loose-line', type: 'line', start: [100, 0], end: [100, 80], appearance: { fillExpression: '#458be8' } },
  { id: 'loose-curve', type: 'curve', points: [[100, 80], [150, 40], [100, 0]], appearance: { fillExpression: '#458be8' } },
]));
button('Reverse record order', async () => {
  const drawing = structuredClone(current);
  drawing.entities.reverse();
  canvas.loadDrawingData(drawing, { zoomToFit: true });
  canvas.setActiveStack(canvas.getDrawingData().entities[0].stackId);
  await frames();
  current = canvas.getDrawingData();
  verify();
});
button('Save / reload', async () => {
  canvas.loadDrawingData(JSON.parse(JSON.stringify(canvas.getDrawingData())), { zoomToFit: true });
  canvas.setActiveStack(canvas.getDrawingData().entities[0].stackId);
  await frames();
  verify();
});
button('Reopen drawing file', async () => {
  output.textContent = 'Opening saved drawing…';
  const transfer = new DataTransfer();
  transfer.items.add(new File([serializeDrawingJson(canvas.getDrawingData())], 'shared-point-fill-test.paramagic', { type: 'application/json' }));
  const input = document.getElementById('openDrawingFileInput');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  while (input.value) await frames();
  canvas.setActiveStack(canvas.getDrawingData().entities[0].stackId);
  await frames();
  verify();
});
await load(sharedPointRegions());
