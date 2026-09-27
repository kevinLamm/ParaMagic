import { connectedChain, snapshot, pointRef } from './fixtures.js';
import { mixedConnectedChain } from './mixed-fixture.js';
import '../../src/styles/app.css';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function waitFor(check, label) {
  for (let i = 0; i < 600; i++) { if (check()) return; await frame(); }
  throw Error(`Timed out: ${label}`);
}

export async function nativeAppSample({ mixed = false } = {}) {
  globalThis.PARAMAGIC_SOLVER_BACKEND = 'wasm';
  document.body.innerHTML = '<div id="root"></div>';
  const messages = [], BrowserWorker = globalThis.Worker;
  globalThis.Worker = class extends BrowserWorker {
    constructor(url, options) {
      super(url, options);
      if (String(url).includes('SolverWorker')) this.addEventListener('message', ({ data }) => messages.push(data));
    }
  };
  const { canvasController, initialization } = await import('../../src/main.js');
  await initialization;
  globalThis.Worker = BrowserWorker;
  const f = mixed ? mixedConnectedChain(56, { includeMeta: false }) : connectedChain(12, { sharedTarget: true });
  const drawing = snapshot(f);
  // Canvas documents include derived fillets among drawing entities; the
  // solver protocol uses its separate derivedEntities field.
  drawing.entities.push(...drawing.derivedEntities); delete drawing.derivedEntities;
  drawing.dimensionAnnotations = [{ id: 'width-label', type: 'dimension-line', dimensionId: 'baseline-width', dimensionName: 'd1',
    dimensionMode: 'driving', subtype: 'aligned', start: [0, 0], end: [84, 0], label: [42, -30],
    anchors: { start: pointRef('panel-0'), end: pointRef('panel-0', 2) } }];
  const loadsBefore = messages.filter(m => m.commandType === 'load-sketch').length;
  canvasController.loadDrawingData(drawing, { zoomToFit: true, history: 'commit' });
  canvasController.setActiveStack(canvasController.getStackRuntimeState().stacks.find(s => s.kind === 'stack').id);
  await waitFor(() => messages.filter(m => m.commandType === 'load-sketch').length > loadsBefore, 'Worker model load');
  await frame(); await frame();
  const value = () => canvasController.getParameters().find(p => p.name === 'd1')?.value;
  const checks = [];
  const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  async function edit(expression) {
    const label = document.querySelector('.dimension-text');
    check(Boolean(label && label.getBoundingClientRect().width), 'Dimension label is rendered');
    label.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 150, clientY: 150 }));
    const input = document.querySelector('.dimension-edit-input');
    await waitFor(() => !document.querySelector('.dimension-edit-panel').hidden, 'dimension editor');
    input.value = expression; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  const before = canvasController.getDrawingData();
  const renderedGeometry = () => before.entities.map(entity => document.querySelector(`[data-record-id="${entity.id}"]`)?.outerHTML).join('|');
  const beforePath = renderedGeometry();
  await edit('84.125');
  await waitFor(() => document.querySelector('.dimension-edit-panel').hidden && value() === 84.125, 'native dimension commit');
  const change = messages.filter(m => m.commandType === 'set-dimension').at(-1);
  check(change.diagnostics.backend === 'wasm', 'Dimension edit used the native Worker');
  check(change.status === 'converged', 'Native final solve converged');
  const after = canvasController.getDrawingData();
  check(JSON.stringify(after.entities) !== JSON.stringify(before.entities), 'Solved geometry changed');
  check(document.querySelector('.dimension-text').textContent.includes('84.125'), 'Updated dimension text is visible');
  const afterPath = renderedGeometry();
  check(afterPath !== beforePath, 'SVG geometry was updated');
  after.entities.filter(e => e.type !== 'fillet').forEach(e => f.model.updateEntity(e));
  f.dimensions.restore(after.parameters, { emit: false });
  const finalResidual = Math.hypot(...f.registry.evaluate(f.model, f.dimensions).values);
  check(finalResidual < 1e-3, 'All rendered constraints satisfy the normal final tolerance');
  if (mixed) {
    for (const type of ['arc', 'circle', 'line', 'point']) {
      const entities = after.entities.filter(e => e.type === type);
      check(entities.length > 0 && entities.every(e => document.querySelector(`[data-record-id="${e.id}"]`)), `${type} geometry is rendered`);
    }
    after.entities.filter(e => e.type !== 'fillet').forEach(e => f.model.updateEntity(e));
    f.dimensions.restore(after.parameters, { emit: false });
    check(Math.hypot(...f.registry.evaluate(f.model, f.dimensions).values) < 1e-3, 'Mixed constraint residuals satisfy final tolerance');
  }
  canvasController.flushDrawingUpdate();
  document.getElementById('undoButton').click();
  await waitFor(() => value() === 84, 'undo'); check(value() === 84, 'Undo restores the previous dimension');
  document.getElementById('redoButton').click();
  await waitFor(() => value() === 84.125, 'redo'); check(value() === 84.125, 'Redo restores the solved dimension');
  canvasController.loadDrawingData(JSON.parse(JSON.stringify(after)), { zoomToFit: true });
  canvasController.setActiveStack(canvasController.getStackRuntimeState().stacks.find(s => s.kind === 'stack').id);
  await frame(); await frame();
  check(value() === 84.125, 'Serialized drawing reload preserves the solved dimension');
  await edit('missing_parameter');
  await waitFor(() => document.querySelector('.dimension-edit-panel').classList.contains('invalid'), 'invalid expression');
  check(value() === 84.125, 'Invalid expression preserves the accepted dimension');
  check(Boolean(document.querySelector('.dimension-edit-error').textContent), 'Invalid expression is reported in the editor');
  document.querySelector('.dimension-edit-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const output = document.createElement('output');
  output.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:9999;background:white;color:#123;padding:12px;border:1px solid #678;white-space:pre;font:12px sans-serif';
  output.textContent = `Native solver workflow: ${checks.length} checks passed\n` + checks.join('\n');
  document.body.append(output);
  await frame(); await frame();
  return { checks, finalResidual, constraintTypes: [...new Set(drawing.constraints.map(c => c.type))], change: { status: change.status, revision: change.revision, diagnostics: change.diagnostics } };
}
