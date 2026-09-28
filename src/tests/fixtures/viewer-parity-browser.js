import { createInfiniteCanvas, createDrawingFeatures, createControlTools, parsePortableDrawingText, importPortableCatalogImage } from '@paramagic/core/editor';
import { createSolverExecutionFacade } from '@paramagic/core/solver';
import { configureImageCatalogResources } from '@paramagic/core/images';
import { createAppSolver } from '../../AppSolver.js';
import { imageCatalogResources } from '../../app-config.js';

const baseline = new URLSearchParams(location.search).has('baseline');
const root = document.getElementById('root');
root.innerHTML = `<div class="drawing-viewer">
  <header class="viewer-header"><h1>Viewer parity regression${baseline ? ' — previous runtime' : ''}</h1><button data-fit>Fit drawing</button></header>
  <aside class="viewer-sidebar"><div class="viewer-controls"></div><button data-reload>Reload drawing</button><pre data-checks></pre></aside>
  <main class="canvas viewer-canvas"><div class="grid"></div><svg class="drawing-plane"></svg></main>
  <p class="viewer-status" role="status">Loading fixture…</p>
</div>`;
const solver = baseline ? createSolverExecutionFacade({ mode: 'sync' }) : createAppSolver();
let workerDiagnostics = null;
solver.workerClient?.worker.addEventListener('message', ({ data }) => {
  if (data.commandType === 'update-parameter') workerDiagnostics = data.diagnostics;
});
const canvas = createInfiniteCanvas({ canvas: root.querySelector('.viewer-canvas'), grid: root.querySelector('.grid'),
  svg: root.querySelector('svg'), status: document.createElement('span'), reset: root.querySelector('[data-fit]'),
  solver, entities: [], interactive: false });
if (!baseline) createDrawingFeatures({ canvas });
const controls = createControlTools({ canvas, solver, host: root.querySelector('.viewer-controls'), allowEditing: false, floating: false });
controls.panel.querySelector('.controls-panel-close').hidden = true;
configureImageCatalogResources(imageCatalogResources);
const drawing = await parsePortableDrawingText('TestFrontView.paramagic', await (await fetch('./front-view-large-control-edit.paramagic')).text(), { importAsset: importPortableCatalogImage });
canvas.loadDrawingData(drawing);
const originalControls = controls.model.list();
const sizes = controls.model.add('Container', { label: 'Overall Sizes' });
const arm = controls.model.add('Container', { label: 'Arm' });
for (const item of originalControls) controls.model.move(item.id, item.label.includes('Arm') ? arm.id : sizes.id);
const fixture = canvas.getDrawingData();

function check() {
  canvas.flushDrawingUpdate();
  const copies = root.querySelectorAll('.linked-copy-group').length;
  const containers = controls.panel.querySelectorAll('.panel-control-container').length;
  const editing = controls.panel.querySelector('[data-controls-edit]');
  root.querySelector('[data-checks]').textContent = JSON.stringify({
    copies, expectedCopies: drawing.extensions.linkedCopyTools.copies.length, containers,
    canvasInert: canvas.getCanvasElement().inert, editingHidden: editing.hidden && editing.disabled,
    execution: solver.executionStatus(),
  }, null, 2);
  if (!baseline && copies !== drawing.extensions.linkedCopyTools.copies.length) throw new Error('Missing derivative copies');
  if (containers !== 2) throw new Error('Missing control containers');
}
function reload() {
  canvas.loadDrawingData(fixture);
  controls.setVisible(true);
  check();
}
root.querySelector('[data-reload]').onclick = reload;
reload();
let started = null;
let frameCount = 0;
function countFrame() { if (started !== null) { frameCount++; requestAnimationFrame(countFrame); } }
controls.panel.addEventListener('change', () => {
  if (started === null) { started = performance.now(); frameCount = 0; requestAnimationFrame(countFrame); }
}, true);
solver.subscribe((_snapshot, result) => {
  if (started === null) return;
  requestAnimationFrame(() => {
    if (started === null || controls.panel.querySelector('[aria-busy="true"]')) return;
    const elapsedMs = Math.round(performance.now() - started);
    started = null;
    check();
    root.querySelector('.viewer-status').textContent = JSON.stringify({ elapsedMs, frameCount, status: result.status,
      backend: workerDiagnostics?.backend || result.backend || 'javascript', solverMs: workerDiagnostics?.durationMs,
      wasmError: workerDiagnostics?.wasmInitializationError || null });
  });
});
root.querySelector('.viewer-status').textContent = 'Ready. Change a control to measure the rendered update; Reload drawing checks container persistence.';
