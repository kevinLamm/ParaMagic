import { connectedChain, snapshot, verify } from './fixtures.js';
import { mixedConnectedChain } from './mixed-fixture.js';
import { loadWasmSolverModule, WasmSolverBackend } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';
import { solveConstraintScope } from '../../packages/paramagic-core/src/modules/solver/ComponentSolver.js';
import { createBrowserSolverWorkerClient, SolverWorkerClient } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerClient.js';

const modulePromise = loadWasmSolverModule();
const success = status => ['converged', 'unchanged'].includes(status);

// Same browser, equations, tolerance, initial coordinates and mutation. Native
// preparation is measured separately, then topology stays resident across edits.
export async function pairSample({ count, budgetMs = 5000, maxIterations = 2000, mode = 'final', repeats = 1, reverse = false, mixed = false }) {
  const module = await modulePromise;
  const records = {}, coordinates = {};
  for (const backend of reverse ? ['wasm', 'javascript'] : ['javascript', 'wasm']) {
    const f = mixed ? mixedConnectedChain(count) : connectedChain(count, { sharedTarget: true });
    const native = backend === 'wasm' ? new WasmSolverBackend(module) : null;
    const options = { model: f.scopedModel, dimensions: f.dimensions, registry: f.registry, jacobianMode: 'blocks',
      numericBackend: native, tolerance: 1e-3, maxIterations, solveMode: mode, timeBudgetMs: budgetMs };
    const loadStarted = performance.now();
    const loaded = solveConstraintScope(options);
    if (!success(loaded.status)) throw Error(`Initial ${backend} model is not satisfied: ${loaded.message}`);
    const residentLoadMs = performance.now() - loadStarted;
    const samples = [], states = [];
    for (let edit = 0; edit < repeats; edit++) {
      const target = 84.125 + edit * .025;
      f.dimensions.set({ ...f.dimensions.get('baseline-width'), expression: String(target) });
      const start = performance.now();
      const result = solveConstraintScope(options);
      const elapsedMs = performance.now() - start;
      const validation = verify(f, target);
      if (success(result.status) && validation.residualL2 >= 1e-3) throw Error('False convergence.');
      states.push(Float64Array.from(f.model.allVariables(), v => v.value));
      if (native && result.backend !== 'wasm') throw Error(`Native mixed fixture fell back: ${result.jacobianStats?.fallbackReason}`);
      samples.push({ target, status: result.status, iterations: result.iterations, elapsedMs, finalError: result.finalError, timings: result.timings,
        validation, jacobianStats: result.jacobianStats, heapUsedBytes: performance.memory?.usedJSHeapSize ?? null });
    }
    records[backend] = { residentLoadMs, variables: f.model.allVariables().length, samples };
    coordinates[backend] = states;
  }
  const comparisons = records.javascript.samples.map((js, i) => {
    const wasm = records.wasm.samples[i];
    let maxCoordinateDifference = 0;
    coordinates.javascript[i].forEach((value, col) => { maxCoordinateDifference = Math.max(maxCoordinateDifference, Math.abs(value - coordinates.wasm[i][col])); });
    const bothConverged = success(js.status) && success(wasm.status);
    const sameWork = js.status === wasm.status && js.iterations === wasm.iterations;
    return { bothConverged, sameWork, maxCoordinateDifference,
      speedup: bothConverged || (sameWork && mode === 'interactive') ? js.elapsedMs / wasm.elapsedMs : null };
  });
  return { count, mixed, budgetMs, maxIterations, mode, repeats, ...records, comparisons };
}

export async function nativeWorkerSample({ count = 1000, bundledWorkerUrl = null, mixed = false }) {
  const f = mixed ? mixedConnectedChain(count, { includeMeta: false }) : connectedChain(count, { sharedTarget: true });
  let client;
  if (bundledWorkerUrl) {
    const artifact = await fetch(bundledWorkerUrl);
    const source = await artifact.text();
    if (!artifact.ok || source.trimStart().startsWith('<')) throw Error(`Bundled Worker response ${artifact.status}: ${source.slice(0, 100)}`);
    const worker = new Worker(bundledWorkerUrl, { type: 'module' });
    worker.postMessage({ type: 'initialize', jacobianMode: 'blocks', backend: 'wasm' });
    client = new SolverWorkerClient(worker, { backend: 'wasm' });
  } else client = createBrowserSolverWorkerClient({ jacobianMode: 'blocks', backend: 'wasm' });
  try {
    const load = await client.loadSketch(snapshot(f));
    if (!success(load.status)) throw Error(`Worker load failed: ${load.message}`);
    const obsolete = client.setDimension('baseline-width', '84.125');
    await new Promise(resolve => setTimeout(resolve, 40));
    const middle = client.setDimension('baseline-width', '84.15');
    const latest = client.setDimension('baseline-width', '84.175');
    const results = await Promise.all([obsolete, middle, latest]);
    if (results[2].diagnostics.backend !== 'wasm' || results[0].diagnostics.cancellationReason !== 'superseded') {
      throw Error(`Expected native solving and actual interruption of the obsolete revision: ${JSON.stringify(results.map(r => ({ status: r.status, message: r.message, diagnostics: r.diagnostics })))}`);
    }
    const state = await client.getSnapshot();
    state.snapshot.entities.forEach(entity => entity.type === 'fillet' ? f.model.setDerivedEntity(entity) : f.model.updateEntity(entity));
    f.dimensions.restore(state.snapshot.parameters, { emit: false });
    const validation = verify(f, 84.175);
    if (results[0].status !== 'superseded' || results[1].status !== 'superseded' || !success(results[2].status)) throw Error(JSON.stringify(results.map(r => ({ status: r.status, diagnostics: r.diagnostics }))));
    if (validation.residualL2 >= 1e-3 || validation.parameterValue !== 84.175) throw Error('Worker output failed validation.');
    const builds = results[2].diagnostics.jacobianStats.topologyBuilds;
    const repeat = await client.setDimension('baseline-width', '84.2');
    if (!success(repeat.status) || repeat.diagnostics.jacobianStats.topologyBuilds !== builds) throw Error('Worker topology was not persistent.');
    return { count, mixed, load: load.diagnostics, results: results.map(r => ({ status: r.status, revision: r.revision, diagnostics: r.diagnostics })),
      repeat: { status: repeat.status, revision: repeat.revision, diagnostics: repeat.diagnostics }, validation };
  } finally { client.terminate(); }
}
