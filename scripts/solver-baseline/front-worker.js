import { SolverWorkerClient, createBrowserSolverWorkerClient } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerClient.js';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';

export async function frontWorkerSample({ bundledWorkerUrl = null } = {}) {
  let client;
  if (bundledWorkerUrl) {
    const worker = new Worker(bundledWorkerUrl, { type: 'module' });
    worker.postMessage({ type: 'initialize', jacobianMode: 'blocks', backend: 'wasm' });
    client = new SolverWorkerClient(worker, { backend: 'wasm' });
  } else client = createBrowserSolverWorkerClient({ jacobianMode: 'blocks', backend: 'wasm' });
  try {
    const drawing = await (await fetch('/src/tests/fixtures/front-view-large-control-edit.paramagic')).json();
    const loaded = await client.loadSketch(drawing);
    if (!['converged', 'unchanged'].includes(loaded.status)) throw Error(loaded.message);
    const parameter = drawing.parameters.find(p => p.name === 'c1');
    const patch = target => ({ expression: 'MinMax(Min Width, 100, ' + target + ', 1)', usesDrawingUnit: false });
    const options = { coalesceKey: 'parameter:' + parameter.id };
    const obsolete = client.updateParameter(parameter.id, patch(85), options);
    await new Promise(resolve => setTimeout(resolve, 10));
    const middle = client.updateParameter(parameter.id, patch(50), options);
    const latest = client.updateParameter(parameter.id, patch(85), options);
    const results = await Promise.all([obsolete, middle, latest]);
    const final = results[2];
    if (!['converged', 'unchanged'].includes(final.status) || final.diagnostics.backend !== 'wasm') throw Error(JSON.stringify(final.diagnostics));
    const state = await client.getSnapshot();
    const oracle = new SolverController({ jacobianMode: 'blocks' });
    oracle.loadSketch(state.snapshot);
    const residualL2 = Math.hypot(...oracle.registry.evaluate(oracle.model, oracle.dimensions).values);
    if (oracle.lastResult.status !== 'unchanged' || oracle.dimensions.value(parameter.id) !== 85 || residualL2 >= 1e-8
      || oracle.constraints().length !== 193) throw Error('Latest native Swell revision failed reference validation');
    if (results.slice(0, 2).some(r => r.status !== 'superseded')) throw Error('Obsolete control revisions were not discarded');
    return { bundledWorkerUrl, status: final.status, residualL2, revisions: results.map(r => ({ status: r.status, revision: r.revision })),
      diagnostics: final.diagnostics };
  } finally { client.terminate(); }
}
