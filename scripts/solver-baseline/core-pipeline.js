import { parameterSample, graphMutationSample } from './measure.js';
import { loadWasmSolverModule, WasmSolverBackend } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';

export async function corePipelineSample({ count = 10000, backend = 'wasm', sample = 0 } = {}) {
  const native = backend === 'wasm' ? new WasmSolverBackend(await loadWasmSolverModule()) : null;
  const parameters = parameterSample({ count, numericEvaluator: native?.createParameters() });
  const graph = graphMutationSample({ count, nativeGraph: native?.createGraph() });
  return { backend, sample, count, parameters, graph };
}
