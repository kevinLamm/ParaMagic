import { connectedChain, verify, snapshot, TARGET_LENGTH, FINAL_TOLERANCE, pointRef, segmentRef } from './fixtures.js';
import { solveConstraintScope } from '../../packages/paramagic-core/src/modules/solver/ComponentSolver.js';
import { assembleJacobianBlocks, createMatrixFreeJacobian, evaluateJacobianBlock } from '../../packages/paramagic-core/src/modules/solver/JacobianBlocks.js';
import { solveMatrixFreeDampedLeastSquares, transpose, multiply, multiplyMatrixVector, solveLinearSystem } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { ParameterRepository } from '../../packages/paramagic-core/src/modules/solver/ParameterRepository.js';
import { ConstraintGraph } from '../../packages/paramagic-core/src/modules/solver/ConstraintGraph.js';

const time = fn => { const start = performance.now(); const value = fn(); return { value, ms: performance.now() - start }; };
const heap = () => globalThis.performance?.memory?.usedJSHeapSize ?? null;
export function solveSample({ count, budgetMs = 5000, target = TARGET_LENGTH, sharedTarget = false, repeats = 1, tolerance = FINAL_TOLERANCE } = {}) {
  const fixture = connectedChain(count, { sharedTarget });
  const initial = verify(fixture, 84);
  if (initial.residualL2 !== 0) throw new Error('Baseline geometry must already satisfy constraints.');
  const samples = [];
  for (let edit = 0; edit < repeats; edit++) {
    const value = target + edit * 0.125;
    const beforeHeap = heap();
    const mutation = time(() => fixture.dimensions.update('baseline-width', { expression: String(value) }, { strict: true }));
    const solve = time(() => solveConstraintScope({ model: fixture.scopedModel, registry: fixture.registry,
      dimensions: fixture.dimensions, jacobianMode: 'blocks', tolerance,
      maxIterations: 2000, timeBudgetMs: budgetMs }));
    const afterHeap = heap();
    const validation = verify(fixture, value);
    const result = solve.value;
    if (['converged', 'unchanged'].includes(result.status) && !(validation.residualL2 < tolerance)) throw new Error('False convergence.');
    if (result.status === 'cancelled' && validation.movedEntities !== 0 && edit === 0) throw new Error('Cancelled final solve failed to restore initial geometry.');
    samples.push({ edit, requestedTarget: value, mutationMs: mutation.ms, elapsedMs: solve.ms,
      status: result.status, message: result.message, iterations: result.iterations,
      acceptedSteps: result.acceptedSteps, rejectedSteps: result.rejectedSteps,
      cancellationReason: result.cancellationReason ?? null, timings: result.timings,
      jacobianStats: result.jacobianStats, validation, heapBeforeBytes: beforeHeap, heapAfterBytes: afterHeap,
      heapDeltaBytes: beforeHeap === null ? null : afterHeap - beforeHeap,
      wasmSolveMs: null, speedup: null });
    if (!['converged', 'unchanged'].includes(result.status)) break;
  }
  return { scenario: sharedTarget ? 'shared-dimension' : 'first-panel-dimension', count,
    tolerance, entities: fixture.lineCount, variables: fixture.model.allVariables().length,
    activeVariables: fixture.model.activeVariables().length, components: fixture.graph.components.size,
    setup: fixture.setup, samples };
}

// Isolated phase diagnostics, deliberately excluded from headline solve timings.
// Callback timers perturb tiny derivative functions; report that overhead explicitly.
export function phaseSample({ count, budgetMs = 5000 } = {}) {
  const f = connectedChain(count);
  f.dimensions.update('baseline-width', { expression: String(TARGET_LENGTH) }, { strict: true });
  const residual = time(() => f.registry.evaluate(f.scopedModel, f.dimensions));
  const topology = time(() => f.registry.blocks(f.scopedModel, f.dimensions));
  const contract = topology.value;
  let analyticalMs = 0, fallbackResidualMs = 0, analyticalCalls = 0;
  for (const block of contract.blocks) {
    const analytical = block.evaluateAnalyticalJacobian;
    if (analytical) block.evaluateAnalyticalJacobian = () => {
      const started = performance.now();
      try { return analytical(); } finally { analyticalMs += performance.now() - started; analyticalCalls++; }
    };
    const evaluate = block.evaluateResiduals;
    block.evaluateResiduals = () => {
      const started = performance.now();
      try { return evaluate(); } finally { fallbackResidualMs += performance.now() - started; }
    };
  }
  const assembly = time(() => createMatrixFreeJacobian(contract));
  const operator = assembly.value;
  let nnz = 0;
  for (const block of operator.blocks) for (const row of block.values) for (const value of row) if (value !== 0) nnz++;
  const linearStart = performance.now();
  let linear, linearError;
  try { linear = solveMatrixFreeDampedLeastSquares(operator, residual.value.values, 0.01, {
    shouldCancel: () => performance.now() - linearStart >= budgetMs ? 'time-budget' : false,
  }); } catch (error) { linearError = error.message; }
  const linearMs = performance.now() - linearStart;
  const serialized = time(() => snapshot(f));
  const cloned = time(() => structuredClone(serialized.value));
  const encoded = time(() => JSON.stringify(serialized.value));
  return { count, variables: contract.variables.length, residualCount: operator.rowCount,
    residualMs: residual.ms, topologyMs: topology.ms, analyticalMs, analyticalCalls, fallbackResidualMs,
    assemblyTotalMs: assembly.ms, assemblyAndPreconditionerMs: assembly.ms - analyticalMs - fallbackResidualMs,
    numericalNonzeros: nnz, storedDerivativeEntries: operator.diagnostics.derivativeEntries,
    diagnostics: operator.diagnostics, firstLinearStepMs: linearMs,
    firstLinearIterations: linear?.iterations ?? null, firstLinearConverged: linear?.converged ?? false,
    linearError: linearError ?? null, snapshotMs: serialized.ms, structuredCloneMs: cloned.ms,
    jsonEncodeMs: encoded.ms, jsonBytes: new TextEncoder().encode(encoded.value).length };
}

export function parameterSample({ count, numericEvaluator = null } = {}) {
  const repository = new ParameterRepository();
  repository.numericEvaluator = numericEvaluator;
  const entries = Array.from({ length: count }, (_, i) => ({ id: `parameter-${i}`, name: `p${i}`,
    expression: i ? `p${i - 1}+1` : '84', value: 84 + i, kind: 'user', driving: false,
    computed: false, enabled: true, order: i }));
  const restore = time(() => repository.restore(entries, { emit: false }));
  const cold = time(() => repository.evaluateDirty({ strict: true }));
  const clean = time(() => repository.evaluateDirty({ strict: true }));
  const mutation = time(() => repository.update('parameter-0', { expression: '84.125' }, { strict: true }));
  const finalValue = repository.value(`parameter-${count - 1}`);
  if (finalValue !== 84.125 + count - 1) throw new Error('Parameter chain did not propagate.');
  return { count, restoreMs: restore.ms, coldEvaluateMs: cold.ms, cleanEvaluateMs: clean.ms,
    rootMutationMs: mutation.ms, finalValue, affectedCount: repository.affectedIds('parameter-0').size };
}

export function graphMutationSample({ count, nativeGraph = null } = {}) {
  const f = connectedChain(count);
  if (nativeGraph) f.graph = new ConstraintGraph(f.model, { nativeGraph });
  f.model.addEntity({ id: 'extension', type: 'line', start: [f.lineCount * 84, 0], end: [(f.lineCount + 1) * 84, 0] });
  f.graph.addEntity('extension');
  f.model.addConstraint({ id: 'extension-horizontal', type: 'Horizontal', featureRefs: [segmentRef('extension')] });
  f.graph.addConstraint('extension-horizontal');
  f.model.addConstraint({ id: 'bridge', type: 'Coincident', featureRefs: [pointRef(`panel-${f.lineCount - 1}`, 2), pointRef('extension')] });
  const operation = time(() => f.graph.addConstraint('bridge'));
  if (f.graph.components.size !== 1) throw new Error('Bridge graph update failed.');
  return { count, bridgeMs: operation.ms, components: f.graph.components.size };
}

export function derivativeCheck({ count = 30 } = {}) {
  const f = connectedChain(count);
  const contract = f.registry.blocks(f.model, f.dimensions);
  return contract.blocks.map(block => ({ type: block.type, kind: evaluateJacobianBlock(block).kind }));
}

export function densePhaseSample({ count = 90 } = {}) {
  if (count > 144) throw new Error('Dense diagnostic is limited to small systems below the production sparse threshold.');
  const f = connectedChain(count);
  f.dimensions.update('baseline-width', { expression: String(TARGET_LENGTH) }, { strict: true });
  const residual = f.registry.evaluate(f.model, f.dimensions).values;
  const topology = time(() => f.registry.blocks(f.model, f.dimensions));
  const assembled = time(() => assembleJacobianBlocks(topology.value));
  const normal = time(() => {
    const jt = transpose(assembled.value.matrix);
    const matrix = multiply(jt, assembled.value.matrix);
    for (let i = 0; i < matrix.length; i++) matrix[i][i] += 0.01 * Math.max(Math.abs(matrix[i][i]), 1) + 1e-7;
    return { matrix, gradient: multiplyMatrixVector(jt, residual).map(value => -value) };
  });
  const linear = time(() => solveLinearSystem(normal.value.matrix, normal.value.gradient));
  return { count, activeVariables: topology.value.variables.length, residuals: residual.length,
    topologyMs: topology.ms, derivativeAndAssemblyMs: assembled.ms, denseNormalConstructionMs: normal.ms,
    gaussianEliminationMs: linear.ms, diagnostics: assembled.value.diagnostics };
}
