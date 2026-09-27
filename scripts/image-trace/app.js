import { traceFixture } from './measure.js';
import { configureOpenCvResources, prepareImageTrace, tracePreparedImageRegion } from '../../packages/paramagic-core/src/modules/ImageTrace.js';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import '../../src/styles/app.css';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function waitFor(check, label) {
  const start = performance.now();
  while (performance.now() - start < 30000) { if (check()) return; await frame(); }
  throw Error(`Timed out: ${label}`);
}
export async function traceAppSample({ bundledTraceWorkerUrl, bundledOpenCvUrl, complex = false } = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const BrowserWorker = globalThis.Worker, messages = [], requests = [], workers = [];
  globalThis.Worker = class extends BrowserWorker {
    constructor(url, options) {
      const trace = String(url).includes('ImageTraceWorker');
      super(trace && bundledTraceWorkerUrl ? new URL(bundledTraceWorkerUrl, location.href) : url, options);
      if (trace) { workers.push(this); this.addEventListener('message', ({ data }) => messages.push(data)); }
      this.isTrace = trace;
    }
    postMessage(message, transfer) {
      if (this.isTrace) requests.push({ id: message.id, type: message.type, sourceVersion: message.sourceVersion, transferredBuffers: transfer?.length || 0 });
      return super.postMessage(message, transfer);
    }
  };
  const checks = [], timings = [];
  const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  try {
    const { canvasController, initialization } = await import('../../src/main.js'); await initialization;
    if (bundledOpenCvUrl) configureOpenCvResources({ scriptUrl: bundledOpenCvUrl });
    const { entity } = traceFixture(4000000, { complex });
    canvasController.loadDrawingData({ entities: [entity], constraints: [], parameters: [] }, { zoomToFit: true, history: 'commit' });
    await frame(); await frame();
    canvasController.setActiveStack(canvasController.getDrawingData().entities.find(e => e.id === entity.id).stackId);
    canvasController.selectRecords([entity.id]); await frame();
    const record = () => document.querySelector(`[data-record-id="${entity.id}"]`);
    const status = () => record().querySelector('.image-trace-status');
    const preview = () => record().querySelector('.image-trace-preview');
    const traceButton = () => record().querySelector('[title="Trace Region"]');
    traceButton().click(); await frame();
    check(!record().querySelector('.image-trace-panel').hidden, 'Trace Region panel opens');
    let frames = 0, ticking = true;
    const tick = () => { if (ticking) { frames++; requestAnimationFrame(tick); } }; requestAnimationFrame(tick);
    const hit = record().querySelector('.image-hit-target'), box = hit.getBoundingClientRect();
    const started = performance.now();
    hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 21, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
    await waitFor(() => status().textContent.startsWith('Ready:'), 'first native trace'); ticking = false;
    timings.push({ name: 'cold visible trace', elapsedMs: performance.now() - started, animationFrames: frames });
    check(frames > 2, 'UI continues animating during Worker initialization and tracing');
    check(messages.some(m => m.diagnostics?.backend === 'opencv-wasm-worker'), 'Trace completed in the image WASM Worker');
    check(preview().getBoundingClientRect().width > 0, 'Trace polygon is rendered');
    const currentImage = () => canvasController.getDrawingData().entities.find(e => e.id === entity.id);
    const prepared = await prepareImageTrace(currentImage());
    async function verify(settings) {
      const expected = await tracePreparedImageRegion(prepared, currentImage(), [currentImage().x, currentImage().y], settings);
      const actual = preview().getAttribute('points').split(' ').map(p => p.split(',').map(Number));
      check(JSON.stringify(actual) === JSON.stringify(expected.localPoints), 'Rendered contour exactly matches the reference');
      return expected;
    }
    await verify({ tolerance: 24, detail: 8, smoothing: 1 });
    async function setting(name, value) {
      const input = record().querySelector(`.image-trace-${name}`), before = messages.length, start = performance.now();
      input.value = value; input.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => messages.length > before && status().textContent.startsWith('Ready:'), `${name} preview`);
      timings.push({ name, elapsedMs: performance.now() - start });
    }
    await setting('detail', 10); await verify({ tolerance: 24, detail: 10, smoothing: 1 });
    const detail = messages.filter(m => m.status === 'complete').at(-1);
    check(detail.diagnostics.stages.length === 0, 'Edge Detail reuses cached native contour');
    await setting('smoothing', 4); await verify({ tolerance: 24, detail: 10, smoothing: 4 });
    // Spaced revisions can arrive while connected components/morphology runs.
    const tolerance = record().querySelector('.image-trace-tolerance');
    for (const value of [2, 50, 8]) { tolerance.value = value; tolerance.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 1)); }
    await waitFor(() => status().textContent.startsWith('Ready:') && messages.some(m => m.result?.settings?.tolerance === 8), 'latest rapid trace');
    const expected = await verify({ tolerance: 8, detail: 10, smoothing: 4 });
    check(requests.filter(r => r.type === 'open').length === 1, 'Repeated settings upload the image only once');
    check(requests.filter(r => r.type === 'trace').every(r => r.transferredBuffers === 0), 'Settings requests contain no image buffers');
    const beforeApply = canvasController.getDrawingData();
    const applyStarted = performance.now();
    record().querySelector('.image-trace-create').click();
    const applySynchronousMs = performance.now() - applyStarted;
    await waitFor(() => canvasController.getDrawingData().entities.filter(e => e.type === 'line').length === expected.worldPoints.length, 'Apply Trace creates closed chain');
    await frame(); await frame();
    timings.push({ name: 'apply', vertices: expected.worldPoints.length, synchronousMs: applySynchronousMs, elapsedMs: performance.now() - applyStarted });
    canvasController.flushDrawingUpdate();
    const accepted = canvasController.getDrawingData();
    const oracle = new SolverController({ jacobianMode: 'blocks' });
    oracle.loadSketch({ ...accepted, entities: accepted.entities.filter(e => e.type === 'line') });
    check(oracle.lastResult.status === 'unchanged', 'Applied line chain needs no reference correction');
    check(Math.hypot(...oracle.registry.evaluate(oracle.model, oracle.dimensions).values) < 1e-3, 'Applied constraints meet the existing final tolerance');
    const chain = accepted.entities.filter(e => e.type === 'line').sort((a, b) => a.composite.index - b.composite.index);
    check(chain.every((line, i) => Math.hypot(line.end[0] - chain[(i + 1) % chain.length].start[0], line.end[1] - chain[(i + 1) % chain.length].start[1]) < 1e-3), 'Applied line chain is closed with connected endpoints');
    check(document.querySelectorAll('.canvas-record[data-entity-type="line"]').length === expected.worldPoints.length, 'Applied trace lines are rendered');
    check(accepted.entities.find(e => e.id === entity.id).source === entity.source, 'Source image is preserved');
    document.querySelector('#undoButton').click();
    await waitFor(() => canvasController.getDrawingData().entities.length === beforeApply.entities.length, 'Undo trace');
    document.querySelector('#redoButton').click();
    await waitFor(() => canvasController.getDrawingData().entities.length === accepted.entities.length, 'Redo trace');
    canvasController.loadDrawingData(JSON.parse(JSON.stringify(accepted)), { zoomToFit: true }); await frame(); await frame();
    check(canvasController.getDrawingData().entities.length === accepted.entities.length, 'Trace survives serialized reload');
    canvasController.setActiveStack(currentImage().stackId);
    canvasController.selectRecords([entity.id]); traceButton().click(); await frame();
    const newHit = record().querySelector('.image-hit-target'), newBox = newHit.getBoundingClientRect();
    newHit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 22, clientX: newBox.x + newBox.width / 2, clientY: newBox.y + newBox.height / 2 }));
    await waitFor(() => status().textContent.startsWith('Ready:'), 'trace after reload');
    check(workers.length === 1, 'The initialized image Worker is reused after Apply/Undo/Redo/reload');
    check(preview().getBoundingClientRect().width > 0, 'Reloaded image displays a new native trace');
    const resultCount = messages.filter(m => m.status === 'complete').length;
    await new Promise(resolve => setTimeout(resolve, 150));
    check(messages.filter(m => m.status === 'complete').length === resultCount, 'Idle image Worker produces no repeated work');
    const output = document.createElement('output'); output.style.cssText = 'position:fixed;bottom:12px;right:12px;background:white;padding:12px;border:1px solid #567;z-index:9999';
    output.textContent = `Trace Region: ${checks.length} checks passed. Native Worker / exact contour parity / Undo + Redo + reload.`;
    document.body.append(output); await frame();
    return { checks, timings, requests, appliedConstraintTypes: accepted.constraints.map(c => c.type).sort(),
      appliedCoordinates: accepted.entities.filter(e => e.type === 'line').map(e => [e.start, e.end]),
      diagnostics: messages.filter(m => m.diagnostics).map(m => m.diagnostics) };
  } finally { globalThis.Worker = BrowserWorker; }
}
