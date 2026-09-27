// Real production canvas presentation, timed separately from numeric solving.
// This intentionally omits the application shell/panels and their subscriptions.
import { createInfiniteCanvas } from '../../packages/paramagic-core/src/modules/infiniteCanvas.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import '../../src/styles/app.css';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
export async function renderSample({ count = 333 } = {}) {
  document.body.innerHTML = '<div id="canvas" style="position:relative;width:1200px;height:800px;overflow:hidden"><div id="grid"></div><svg id="svg" width="1200" height="800"></svg></div><output id="status"></output><button id="reset">Reset</button>';
  const solver = createSolverController({ jacobianMode: 'blocks' });
  const controller = createInfiniteCanvas({ canvas: document.getElementById('canvas'), grid: document.getElementById('grid'),
    svg: document.getElementById('svg'), status: document.getElementById('status'), reset: document.getElementById('reset'), entities: [], solver });
  const entities = Array.from({ length: count }, (_, i) => ({ id: `render-${i}`, type: 'line',
    start: [(i % 50) * 20, Math.floor(i / 50) * 16], end: [(i % 50) * 20 + 15, Math.floor(i / 50) * 16 + 8] }));
  const loadStart = performance.now();
  controller.loadDrawingData({ entities, constraints: [], parameters: [] });
  const loadAndPresentationMs = performance.now() - loadStart;
  await frame(); await frame();
  const changed = solver.getGeometrySnapshot().map(entity => ({ ...entity,
    start: [entity.start[0], entity.start[1] + 0.125], end: [entity.end[0], entity.end[1] + 0.125] }));
  solver.applyAuthoritativeEntities(changed, { status: 'converged', changedEntityIds: changed.map(e => e.id) });
  let solveCalls = 0;
  const originalSolve = solver.solve;
  solver.solve = () => { solveCalls++; throw Error('Unexpected solve during presentation benchmark'); };
  const started = performance.now();
  let changedIds;
  try { changedIds = controller.applySolverSnapshot(changed, { incremental: true }); }
  finally { solver.solve = originalSolve; }
  const applyMs = performance.now() - started;
  // Layout is explicitly forced; the two-frame interval is a presentation proxy,
  // not proof of compositor/display latency on a user's physical screen.
  const layoutStarted = performance.now();
  const bounds = controller.getObjectLayer().getBBox();
  const layoutMs = performance.now() - layoutStarted;
  await frame(); await frame();
  const applyToTwoFramesMs = performance.now() - started;
  const nodes = controller.getObjectLayer().querySelectorAll('*').length;
  if (!nodes || !bounds.width || solveCalls) throw Error('Presentation benchmark did not render valid geometry.');
  return { entities: count, changedEntities: changedIds?.size ?? changedIds?.length ?? null, loadAndPresentationMs,
    applyMs, layoutMs, applyToTwoFramesMs, objectLayerNodes: nodes, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, solveCalls };
}
