import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import '../../src/styles/app.css';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function waitFor(check, label) {
  const start = performance.now();
  while (performance.now() - start < 30000) { if (check()) return; await frame(); }
  throw Error(`Timed out: ${label}`);
}

export async function frontAppSample({ backend = 'wasm', sample = 0, bundledWorkerUrl = null, expectWasmLoadFailure = false } = {}) {
  delete globalThis.PARAMAGIC_SOLVER_BACKEND;
  const pageUrl = new URL(location.href);
  pageUrl.searchParams.delete('solverBackend');
  if (backend !== 'default') pageUrl.searchParams.set('solverBackend', backend);
  history.replaceState(null, '', pageUrl);
  const expectedBackend = expectWasmLoadFailure ? 'javascript' : backend === 'default' ? 'wasm' : backend;
  document.body.innerHTML = '<div id="root"></div>';
  const messages = [], startup = [], BrowserWorker = globalThis.Worker;
  globalThis.Worker = class extends BrowserWorker {
    constructor(url, options) {
      const solver = String(url).includes('SolverWorker');
      super(solver && bundledWorkerUrl ? new URL(bundledWorkerUrl, location.href) : url, options);
      this.isSolver = solver;
      if (solver) this.addEventListener('message', ({ data }) => messages.push(data));
    }
    postMessage(message, transfer) {
      if (this.isSolver && message.type === 'initialize') startup.push(message);
      return super.postMessage(message, transfer);
    }
  };
  const { canvasController, initialization } = await import('../../src/main.js');
  await initialization;
  globalThis.Worker = BrowserWorker;
  const drawing = await (await fetch('/src/tests/fixtures/front-view-large-control-edit.paramagic')).json();
  const checks = [], edits = [];
  const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  check(startup[0]?.backend === (backend === 'default' ? 'wasm' : backend), 'App selects the requested/default Worker backend');
  if (backend === 'default') check(!pageUrl.searchParams.has('solverBackend'), 'Default startup requires no backend URL flag');
  const value = () => canvasController.getParameters().find(p => p.name === 'c1')?.value;
  const row = () => document.querySelector('[data-control-id="316c9625-7a89-4d59-b067-c2759d42f833"]');
  const input = () => row()?.querySelector('.panel-control-slider-value');
  const widthId = 'e00ba7d1-23a4-46bf-8014-b9cb8e6b54dc';
  const svg = () => document.querySelector(`[data-record-id="${widthId}"]`)?.outerHTML;
  async function load(data, history) {
    const count = messages.filter(m => m.commandType === 'load-sketch').length;
    canvasController.loadDrawingData(data, { zoomToFit: true, history });
    await waitFor(() => messages.filter(m => m.commandType === 'load-sketch').length > count, 'Worker load');
    await frame(); await frame();
  }
  await load(drawing, 'commit');
  if (!input()?.getBoundingClientRect().width) document.querySelector('#controlsToggle').click();
  await waitFor(() => input()?.getBoundingClientRect().width > 0, 'visible c1 numeric control');
  check(value() === 50 && Number(input().value) === 50, 'Supplied drawing opens with c1 = 50');
  check(Boolean(svg()), 'Front width geometry is rendered');
  const beforeSvg = svg();
  const constraints = JSON.stringify(canvasController.getDrawingData().constraints);
  function verify(target) {
    const snapshot = canvasController.getDrawingData();
    check(value() === target && Number(input().value) === target, `Control displays ${target}`);
    check(JSON.stringify(snapshot.constraints) === constraints, `All constraints retained at ${target}`);
    // Read the rendered document through the reference model. A satisfied load
    // must need zero correction; otherwise this would conceal a bad UI result.
    const oracle = new SolverController({ jacobianMode: 'blocks' });
    oracle.loadSketch(snapshot);
    check(oracle.lastResult.status === 'unchanged', `Rendered model needs no correction at ${target}`);
    const residualL2 = Math.hypot(...oracle.registry.evaluate(oracle.model, oracle.dimensions).values);
    check(residualL2 < 1e-8, `Rendered model meets final tolerance at ${target}`);
    check(oracle.constraints().length === 193 && oracle.constraints().every(c => c.enabled !== false && !c.loadError), 'All 193 constraints enabled');
    check(oracle.model.allVariables().every(v => !v.locked && !v.fixed), 'Temporary solve locks released');
    // Compare visible world coordinates. Stack placement may redistribute a
    // translation between a local frame and local coordinates with no movement
    // of the drawing itself.
    const coordinates = Object.fromEntries(oracle.model.snapshot().flatMap(entity => [
      ...['start', 'end', 'center', 'arcPoint', 'point'].flatMap(key => Array.isArray(entity[key])
        ? entity[key].map((value, axis) => [entity.id + ':' + key + '.' + axis, value]) : []),
      ...(Number.isFinite(entity.radius) ? [[entity.id + ':radius', entity.radius]] : []),
    ]));
    return { snapshot, residualL2, coordinates };
  }
  async function edit(target) {
    const count = messages.filter(m => m.commandType === 'update-parameter').length;
    const start = performance.now();
    input().dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    input().value = String(target);
    input().dispatchEvent(new Event('input', { bubbles: true }));
    input().dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => messages.filter(m => m.commandType === 'update-parameter').length > count, 'control Worker response');
    const response = messages.filter(m => m.commandType === 'update-parameter').at(-1);
    check(response.status === 'converged', `c1 edit ${target} converged: ${response.message}`);
    check(response.diagnostics.backend === expectedBackend, `c1 edit ${target} used ${expectedBackend}`);
    check(Boolean(response.diagnostics.wasmInitializationError) === expectWasmLoadFailure,
      expectWasmLoadFailure ? 'WASM loading failure is recorded while JavaScript keeps the drawing usable' : 'No native initialization failure');
    await waitFor(() => value() === target && Number(input().value) === target, 'control commit');
    await frame(); await frame();
    const elapsedMs = performance.now() - start;
    if (expectedBackend === 'wasm') {
      check(response.diagnostics.placementBackend === 'wasm', 'Stack placement used native solving');
      check(Boolean(document.querySelector('[data-swell-geometry-backend="wasm"]')), 'Rendered Swell reuses native geometry');
    }
    const { snapshot, residualL2, coordinates } = verify(target);
    edits.push({ target, elapsedMs, status: response.status, diagnostics: response.diagnostics, residualL2, coordinates });
    return snapshot;
  }
  const accepted = await edit(85);
  check(svg() !== beforeSvg, 'SVG geometry changed after 50 → 85');
  canvasController.flushDrawingUpdate();
  document.querySelector('#undoButton').click();
  await waitFor(() => value() === 50, 'Undo to 50');
  await frame(); await frame(); verify(50);
  check(svg() === beforeSvg, 'Undo restores the rendered width geometry');
  document.querySelector('#redoButton').click();
  await waitFor(() => value() === 85, 'Redo to 85');
  await frame(); await frame(); verify(85);
  await edit(50); await edit(85);
  await load(JSON.parse(JSON.stringify(accepted)));
  await frame(); await frame(); verify(85);
  check(!document.body.innerText.includes('Solver stalled'), 'No solver stall error is displayed');
  const output = document.createElement('output');
  output.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9999;background:white;color:#123;padding:12px;border:1px solid #678;white-space:pre;font:12px sans-serif';
  output.textContent = `TestFrontView c1: 50 → 85\n${checks.length} checks passed\nAll 193 constraints retained\nFinal residual < 1e-8\nBackend: ${edits[0].diagnostics.backend}`;
  document.body.append(output); await frame();
  return { backend, expectedBackend, sample, bundledWorkerUrl, startup, checks, edits };
}
