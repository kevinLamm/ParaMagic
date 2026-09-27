// Numerical audit only: imports the production solver without changing it.
// Run from the repository root:
// node docs/benchmarks/2026-09-08-solver-audit/connected-scaling.mjs
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { SketchModel } from '../../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { ConstraintRegistry } from '../../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { ConstraintGraph } from '../../../packages/paramagic-core/src/modules/solver/ConstraintGraph.js';
import { DimensionRepository } from '../../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { solveConstraintScope } from '../../../packages/paramagic-core/src/modules/solver/ComponentSolver.js';

const samples = 3;
const timeBudgetMs = 15000;
const counts = [30, 120, 250, 500, 1000];
const report = {
  date: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  environment: { node: process.version, platform: process.platform, architecture: process.arch,
    cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  configuration: { samples, timeBudgetMs, counts, maxIterations: 500, tolerance: 1e-3 },
  methodology: 'Fresh synthetic models per sample; graph and fixture construction excluded from solve timer. One warm-up per scenario/backend. Same production component-scope solver and block derivatives; forced dense uses the identical block Jacobian with dense linear algebra. No browser, rendering, worker transport, history, or controller continuation is timed. Linear iteration diagnostics describe the last outer iteration, not the total.',
  results: [],
};
const output = fileURLToPath(new URL('./connected-scaling.json', import.meta.url));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function fixture(count, scenario) {
  const model = new SketchModel();
  const dimensions = new DimensionRepository();
  const constraints = [];
  for (let index = 0; index < count; index++) {
    const id = `audit-line-${index}`;
    model.addEntity({ id, type: 'line', start: [index * 10, scenario === 'restore-chain' && index > 0 ? 0.35 + (index % 2) * 0.05 : 0],
      end: [index * 10 + 10, scenario === 'restore-chain' ? 0.8 + (index % 3) * 0.08 : 0] });
    constraints.push({ id: `horizontal-${index}`, type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId: id, index: 0 }] });
    if (index) constraints.push({ id: `join-${index}`, type: 'Coincident', featureRefs: [
      { kind: 'point', recordId: `audit-line-${index - 1}`, index: 2 }, { kind: 'point', recordId: id, index: 0 }] });
    if (scenario === 'global-length-change') constraints.push({ id: `length-${index}`, type: 'Distance', dimensionRef: 'audit-length', featureRefs: [
      { kind: 'point', recordId: id, index: 0 }, { kind: 'point', recordId: id, index: 2 }] });
  }
  // The fixture deliberately has an explicit anchor; this does not change gauge policy.
  constraints.push({ id: 'anchor', type: 'Fixed', featureRefs: [{ kind: 'point', recordId: 'audit-line-0', index: 0 }], fixedPoint: [0, 0] });
  constraints.forEach(c => model.constraints.set(c.id, { enabled: true, ...c }));
  model.refreshFixedVariables();
  if (scenario === 'global-length-change') dimensions.restore([{ id: 'audit-length', name: 'd1', expression: '12', value: 12,
    kind: 'dimension', driving: true, computed: false, enabled: true, order: 0 }], { emit: false });
  const graph = new ConstraintGraph(model);
  const scope = graph.scopeForSeeds({ entityIds: ['audit-line-0'] });
  if (graph.components.size !== 1) throw new Error('Audit fixture must form one connected component.');
  return { model, dimensions, graph, scope };
}
report.graphUpdates = [];
for (const count of [30, 120, 250, 500, 1000]) {
  const raw = [];
  for (let sample = 0; sample < samples; sample++) {
    const { model, graph } = fixture(count, 'restore-chain');
    model.addEntity({ id: 'extension', type: 'line', start: [count * 10, 0], end: [count * 10 + 10, 0] });
    graph.addEntity('extension');
    model.constraints.set('extension-horizontal', { id: 'extension-horizontal', type: 'Horizontal', enabled: true,
      featureRefs: [{ kind: 'segment', recordId: 'extension', index: 0 }] });
    graph.addConstraint('extension-horizontal');
    model.constraints.set('bridge', { id: 'bridge', type: 'Coincident', enabled: true, featureRefs: [
      { kind: 'point', recordId: `audit-line-${count - 1}`, index: 2 }, { kind: 'point', recordId: 'extension', index: 0 }] });
    const started = performance.now();
    graph.addConstraint('bridge');
    const elapsedMs = performance.now() - started;
    if (graph.components.size !== 1) throw new Error('Bridge failed to produce one connected component.');
    raw.push(elapsedMs);
  }
  const row = { existingLines: count, elapsedMs: median(raw), raw,
    operation: 'Add one coincidence bridge from an existing chain to one horizontal line; graph update only, no numerical solve.' };
  report.graphUpdates.push(row);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(row));
}
function run(count, scenario, backend) {
  const { model, dimensions, graph, scope } = fixture(count, scenario);
  const registry = new ConstraintRegistry();
  const started = performance.now();
  const result = solveConstraintScope({ model: graph.scopedModel(scope), registry, dimensions,
    jacobianMode: 'blocks', ...(backend === 'forced-block-dense' ? { matrixFreeVariableThreshold: Infinity } : {}),
    maxIterations: 500, timeBudgetMs, tolerance: 1e-3 });
  const elapsedMs = performance.now() - started;
  const residuals = registry.evaluate(model, dimensions).values;
  const verifiedError = residuals.reduce((sum, v) => sum + v * v, 0);
  const converged = ['converged', 'unchanged'].includes(result.status);
  if (converged && !(verifiedError < 1e-6)) throw new Error('Reported convergence failed independent residual evaluation.');
  return { elapsedMs, status: result.status, iterations: result.iterations, acceptedSteps: result.acceptedSteps,
    rejectedSteps: result.rejectedSteps, initialError: result.initialError, finalError: result.finalError,
    verifiedError, maximumResidual: Math.max(...residuals.map(Math.abs)), activeVariables: model.activeVariables().length,
    constraints: model.constraints.size, residualCount: residuals.length, timings: result.timings, jacobianStats: result.jacobianStats };
}
for (const scenario of ['restore-chain', 'global-length-change']) {
  for (const backend of ['automatic', 'forced-block-dense']) {
    run(12, scenario, backend);
    for (const count of backend === 'automatic' ? counts : [30, 120]) {
      const raw = Array.from({ length: samples }, () => run(count, scenario, backend));
      const row = { scenario, backend, lines: count, activeVariables: raw[0].activeVariables, constraints: raw[0].constraints,
        residualCount: raw[0].residualCount, statuses: raw.map(r => r.status),
        elapsedMs: median(raw.map(r => r.elapsedMs)), jacobianMs: median(raw.map(r => r.timings.jacobianMs)),
        linearSolveMs: median(raw.map(r => r.timings.linearSolveMs)), iterations: median(raw.map(r => r.iterations)),
        finalLinearIterations: median(raw.map(r => r.jacobianStats.linearIterations || 0)), raw };
      report.results.push(row);
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ ...row, raw: undefined }));
      // Keep difficult cases bounded; preserve time-budget failures in the output.
      if (raw.some(r => r.status === 'cancelled')) break;
    }
  }
}
