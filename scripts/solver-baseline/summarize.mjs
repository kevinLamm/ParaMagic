import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const directory = resolve(process.argv[2] || 'docs/benchmarks/2026-09-26-wasm-baseline');
const report = JSON.parse(readFileSync(join(directory, 'browser-baseline.json'), 'utf8'));
const median = values => { const sorted = values.slice().sort((a, b) => a - b); const i = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2; };
const number = (value, decimals = 1) => Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—';
const table = (headers, rows) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
const selected = report.results.filter(row => row.scenario === 'shared-dimension' && row.tolerance === 1e-3);
const byCount = Map.groupBy(selected, row => row.count);
const scaleRows = [...byCount].map(([count, rows]) => {
  const samples = rows.flatMap(row => row.samples);
  const phases = report.phases.find(row => row.count === count);
  const med = fn => median(samples.map(fn));
  return [number(count, 0), number(rows[0].activeVariables, 0), number(phases?.numericalNonzeros, 0),
    number(med(row => row.iterations), 0), number(med(row => row.elapsedMs)),
    [...new Set(samples.map(row => row.status))].join(', '), number(med(row => row.timings.linearSolveMs)),
    number(med(row => row.timings.jacobianMs)), number(med(row => row.timings.residualMs)),
    number(med(row => row.heapAfterBytes / 1048576)), med(row => row.validation.residualL2).toExponential(3), '—', '—'];
});
const content = [
  '# Browser baseline measurements', '',
  `Recorded ${report.startedAt}; ${report.environment.cpu}; ${report.environment.browser.product}; ${report.environment.platform}.`, '',
  '## Connected system: one shared dimension, 84 → 84.125', '',
  `Medians of ${report.configuration.samples} fresh-model samples at each scale, with a small warmup in each browser realm. Each model begins solved. Geometry, graph construction and final verification are outside the solve timer. Default production tolerance: L2 residual < 0.001. The ${report.configuration.budgetMs} ms budget cancels and restores geometry on failure. A cancelled runtime is a budget observation, **not time to convergence**. Iterations count completed outer iterations; production diagnostics expose only the last completed PCG iteration count, not the total.`, '',
  table(['Constraints', 'Active variables', 'Numerical J nonzeros at start', 'Outer iterations', 'JS elapsed ms', 'Status', 'Linear ms', 'Jacobian ms', 'Residual ms', 'Heap after MiB', 'Returned residual L2', 'WASM ms', 'Speedup'], scaleRows), '',
  'Heap is renderer JS heap after the solve, including the model and unreclaimed garbage; it is not peak memory or native/WASM memory. Timeout residuals describe restored geometry against the requested new target. WASM has not been implemented or measured.', '',
  '**Timing limitation:** the current solver copies its phase timers into a cancellation result before the interrupted phase\'s finally block updates them. Consequently Jacobian/linear times in cancelled samples can omit the final interrupted phase and are lower bounds. The unexplained remainder must not be labelled nonlinear overhead. The external elapsed timer and the separate CPU/phase profiles include that work. Successful sample phase timers do not have this cancellation issue.', '',
  '## Isolated phases', '',
  'One diagnostic sample per size on the first-panel edit. Callback timing adds overhead and browser clocks are quantized. Assembly remainder includes sparse index/value copying, validation, diagonal construction and entity preconditioner construction. These are not additive to the headline solve samples.', '',
  table(['Constraints', 'Graph build ms', 'Scope ms', 'Block topology ms', 'Analytical callbacks ms', 'Sparse assembly remainder ms', 'Stored J entries', 'Snapshot ms', 'Clone ms', 'JSON ms'], report.phases.map(row => {
    const setup = selected.find(item => item.count === row.count)?.setup;
    return [row.count, number(setup?.graphMs), number(setup?.scopeMs), number(row.topologyMs), number(row.analyticalMs), number(row.assemblyAndPreconditionerMs), row.storedDerivativeEntries, number(row.snapshotMs), number(row.structuredCloneMs), number(row.jsonEncodeMs)];
  })), '',
  'The block format stores some zero entries. The numerical nonzero count is value-dependent; the stored-entry count is a conservative topology size. No global dense matrix is created in these scale runs.', '',
  table(['Small dense case', 'Active variables', 'Derivative + assembly ms', 'Normal matrix construction ms', 'Gaussian elimination ms'], (report.densePhases || []).map(row => [row.count, row.activeVariables, number(row.derivativeAndAssemblyMs), number(row.denseNormalConstructionMs), number(row.gaussianEliminationMs)])), '',
  '## CPU and allocation profiles', '',
  ...report.profiles.flatMap(profile => [
    `Separate ${profile.count.toLocaleString()}-constraint profile: ${number(profile.sampledDurationMs)} ms sampled; ${number(profile.garbageCollectorSampleMs)} ms attributed to the garbage collector. The allocation sampler estimated ${number(profile.sampledAllocatedBytesEstimate / 1048576)} MiB allocated across another run (including collected objects and setup). This is allocation volume, not live memory.`, '',
    table(['Function', 'Source line', 'Sampled self ms'], profile.topSelfTime.slice(0, 12).map(row => [row.name, `${row.url?.split('/').at(-1) || '(native)'}:${row.line}`, number(row.selfMs)])), '',
  ]),
  '## Parameter and graph work', '',
  table(['Parameters', 'Cold evaluation ms', 'Clean evaluation ms', 'Root edit ms', 'Affected parameters'], report.parameters.map(row => [row.count, number(row.coldEvaluateMs), number(row.cleanEvaluateMs), number(row.rootMutationMs), row.affectedCount])), '',
  table(['Existing constraints', 'Add bridge: graph only ms'], report.graphMutations.map(row => [row.count, number(row.bridgeMs)])), '',
  'Parameter and graph rows are single diagnostic samples. The bridge mutation is synchronous and unbounded in production, so this diagnostic is limited to 5,000 constraints.', '',
  '## Real Worker transport', '',
  table(['Constraints', 'Full object snapshot echo ms', 'Coordinate buffer transfer echo ms', 'Object JSON bytes', 'Coordinate bytes'], report.transport.map(row => [row.count, number(row.objectRoundTripMs), number(row.transferredRoundTripMs), number(row.objectJsonBytes, 0), number(row.packedBytes, 0)])), '',
  'The echo comparison isolates transport mechanisms and payload scope. The coordinate buffer omits topology and metadata, so this is not a solver speedup or an equal-payload format comparison. JSON byte counts estimate serialization size; browser postMessage uses structured clone, not JSON.', '',
  table(['Constraints', 'Load round trip ms', 'Dimension edit round trip ms', 'Worker processing ms', 'Status', 'Moved fraction', 'Residual L2'], report.workers.map(row => [row.count, number(row.loadDiagnostics.roundTripMs), number(row.diagnostics.roundTripMs), number(row.diagnostics.durationMs), row.status, number(row.validation.movedFraction * 100) + '%', row.validation.residualL2.toExponential(3)])), '',
  'Worker edits change only the first panel. They are not the shared-dimension scale benchmark. Load uses explicit millimetre units to match the raw numerical fixtures. Processing duration includes controller work and result construction; round-trip minus processing includes scheduling and transport and is not a pure copying timer.', '',
  '## Accuracy diagnostic and repeated edits', '',
  table(['Scenario', 'Constraints', 'Tolerance', 'Edit', 'Status', 'JS ms', 'Residual L2', 'Maximum closed-form coordinate error', 'Moved fraction'], report.results.filter(row => row.tolerance !== 1e-3 || row.scenario === 'first-panel-dimension').flatMap(row => row.samples.map(sample => [row.scenario, row.count, row.tolerance, sample.edit, sample.status, number(sample.elapsedMs), sample.validation.residualL2.toExponential(3), number(sample.validation.maxCoordinateError, 6), number(sample.validation.movedFraction * 100) + '%']))), '',
  'Coordinate error compares the chosen positive-direction anchored solution to its closed form. Normalized residual acceptance does not guarantee this global coordinate bound in a long chain. The 1e-8 diagnostic is stricter than the production default and does not alter product behavior.', '',
  '## Production canvas presentation, separately from solving', '',
  table(['Entities', 'Load + presentation ms', 'Apply geometry ms', 'Forced layout ms', 'Apply through two frames ms', 'DOM descendants', 'Solve calls during apply'], report.rendering.map(row => [row.entities, number(row.loadAndPresentationMs), number(row.applyMs), number(row.layoutMs), number(row.applyToTwoFramesMs), row.objectLayerNodes, row.solveCalls])), '',
  'These rows use the actual createInfiniteCanvas/applySolverSnapshot implementation and application CSS, in an isolated page with no application panels. The entities are a visible grid of lines. Loading includes controller initialization; only the apply timer isolates presentation. Two animation frames are a headless presentation proxy, not measured physical display latency. Full application input-to-paint and drawing tools remain unmeasured.', '',
  '## Errors and incomplete measurements', '',
  report.errors.length ? report.errors.map(error => `- ${error.collection || error.stage}: ${error.method || ''} ${JSON.stringify(error.args || {})}: ${error.error}`).join('\n') : 'No harness errors in this run.', '',
  `Raw data: [browser-baseline.json](browser-baseline.json). ${report.profiles.length ? 'Profiles: [solver.cpuprofile](solver.cpuprofile), [allocations.heapprofile](allocations.heapprofile). ' : ''}This is the baseline stage; it does not establish WASM parity, speedup, or complete application acceptance.`, '',
].join('\n');
writeFileSync(join(directory, 'RESULTS.md'), content);
console.log(join(directory, 'RESULTS.md'));
