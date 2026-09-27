import * as measurements from './measure.js';
import { connectedChain, snapshot, verify } from './fixtures.js';
import { createBrowserSolverWorkerClient } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerClient.js';

function echo(worker, payload, transfer = []) {
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => resolve(data);
    worker.onerror = error => reject(Error(error.message));
    worker.postMessage(payload, transfer);
  });
}
async function transportSample({ count }) {
  const f = connectedChain(count);
  const input = snapshot(f);
  const worker = new Worker(new URL('./transport-worker.js', import.meta.url), { type: 'module' });
  try {
    await echo(worker, { warmup: true });
    let start = performance.now();
    const response = await echo(worker, input);
    const objectRoundTripMs = performance.now() - start;
    if (response.entities.length !== f.lineCount) throw new Error('Transport lost entities.');
    const packed = Float64Array.from(f.model.allVariables(), variable => variable.value);
    const packedBytes = packed.byteLength;
    start = performance.now();
    const returned = await echo(worker, { buffer: packed.buffer }, [packed.buffer]);
    const transferredRoundTripMs = performance.now() - start;
    if (packed.byteLength !== 0 || returned.buffer.byteLength !== packedBytes) throw new Error('Transfer failed.');
    return { count, objectRoundTripMs, transferredRoundTripMs, packedBytes,
      objectJsonBytes: new TextEncoder().encode(JSON.stringify(input)).length };
  } finally { worker.terminate(); }
}
async function workerSample({ count }) {
  const f = connectedChain(count);
  const client = createBrowserSolverWorkerClient({ jacobianMode: 'blocks' });
  try {
    const load = await client.loadSketch(snapshot(f));
    const start = performance.now();
    const change = await client.setDimension('baseline-width', '84.125');
    const elapsedMs = performance.now() - start;
    const state = await client.getSnapshot();
    for (const entity of state.snapshot.entities) f.model.updateEntity(entity);
    f.dimensions.restore(state.snapshot.parameters, { emit: false });
    const validation = verify(f);
    if (['converged', 'unchanged'].includes(change.status) && validation.residualL2 >= 1e-3) throw new Error('Worker false convergence.');
    return { count, loadStatus: load.status, loadDiagnostics: load.diagnostics,
      status: change.status, elapsedMs, generation: change.generation, requestToken: change.requestToken,
      diagnostics: change.diagnostics, changedEntities: change.changedEntities.length, validation };
  } finally { client.terminate(); }
}
window.baseline = { ...measurements, transportSample, workerSample,
  traceSample: async options => (await import('../image-trace/measure.js')).traceSample(options),
  traceAppSample: async options => (await import('../image-trace/app.js')).traceAppSample(options),
  corePipelineSample: async options => (await import('./core-pipeline.js')).corePipelineSample(options),
  pairSample: async options => (await import('./wasm.js')).pairSample(options),
  nativeWorkerSample: async options => (await import('./wasm.js')).nativeWorkerSample(options),
  nativeAppSample: async options => (await import('./native-app.js')).nativeAppSample(options),
  frontAppSample: async options => (await import('./front-app.js')).frontAppSample(options),
  frontWorkerSample: async options => (await import('./front-worker.js')).frontWorkerSample(options),
  renderSample: async options => (await import('./render.js')).renderSample(options) };
document.getElementById('run').onclick = async () => {
  document.getElementById('output').textContent = 'Running…';
  await new Promise(resolve => setTimeout(resolve, 0));
  try { document.getElementById('output').textContent = JSON.stringify(measurements.solveSample({ count: 1000 }), null, 2); }
  catch (error) { document.getElementById('output').textContent = error.stack; }
};
