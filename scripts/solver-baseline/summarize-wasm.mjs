import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] || 'docs/benchmarks/2026-09-26-wasm-native');
const report = JSON.parse(readFileSync(resolve(directory, 'browser-baseline.json'), 'utf8'));
if (!report.finishedAt || report.errors.length) throw Error('Comparison is unfinished or has errors; inspect the raw report.');
const fixed = report.wasmPairs.filter(p => p.mode === 'interactive');
const finals = report.wasmPairs.filter(p => p.mode === 'final' && p.repeats === 1);
const repeated = report.wasmPairs.find(p => p.repeats === 3);
const milliseconds = value => value.toFixed(1);
const ratio = value => value == null ? '—' : `${value.toFixed(2)}x`;
const compact = value => value.toExponential(3);
const rows = repeated.javascript.samples.map((js, i) => {
  const wasm = repeated.wasm.samples[i], comparison = repeated.comparisons[i];
  if (!comparison.bothConverged || comparison.maxCoordinateDifference > 1e-5) throw Error('Repeated-edit parity failed.');
  return `| ${js.target} | ${js.iterations} / ${wasm.iterations} | ${milliseconds(js.elapsedMs)} | ${milliseconds(wasm.elapsedMs)} | ${ratio(comparison.speedup)} | ${compact(wasm.validation.residualL2)} | ${comparison.maxCoordinateDifference} |`;
});
const text = `# Same-browser JavaScript / WASM comparison

Measured ${report.startedAt} on ${report.environment.cpu}, ${report.environment.browser.product}, Windows. One sequential sample per scale and backend; three different consecutive edits in the repeated-edit case. These are not statistical confidence intervals. Both backends use Float64, tolerance 1e-3, the same original equations and entity-block PCG preconditioner. The JS numerical kernel is unchanged.

## Completed connected solves

One shared dimension propagates through all 333 panels: 1,000 constraints, 1,332 variables, 5,318 stored Jacobian entries. Initial target 84. Resident native topology is loaded before timing. Timings include numeric synchronization and numerical solve, exclude rendering and validation, and are separate from Worker round-trip measurements. The first edit moves all panels; each following edit starts from the previous solution. Native topology builds and memory growth remain at one across the edits.

| Dimension target | JS / WASM outer iterations | JS ms | WASM ms | Speedup | Final residual L2 | Maximum coordinate difference |
|---|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}

Parameter values and convergence status also match. The first solution differs from the exact chain coordinates by about 0.663 model units in **both** implementations, due to the existing normalized residual acceptance policy. This experiment preserves that policy. The speedup includes fewer clock calls and packed sparse memory, so it does not isolate a language-only effect.

## Large-scale throughput: two preview iterations

These are deliberately incomplete previews, not final solutions. Each row runs the same two LM iterations; PCG work and coordinates match. Their residuals exceed the final threshold. Stored CSR entries include structural zero slots retained for reuse. Native arena bytes include scratch and module stack/static storage, not the JavaScript model, browser heap or rendering memory.

| Constraints | Variables | Stored Jacobian entries | Native arena MiB | JS ms | WASM ms | Throughput ratio | Preview residual L2 |
|---:|---:|---:|---:|---:|---:|---:|---:|
${fixed.map(p => { const a=p.javascript.samples[0],b=p.wasm.samples[0]; if(!p.comparisons[0].sameWork || p.comparisons[0].maxCoordinateDifference > 1e-5)throw Error('Preview parity failed'); return `| ${p.count} | ${p.wasm.variables} | ${b.jacobianStats.derivativeEntries} | ${(b.jacobianStats.arenaBytes/1048576).toFixed(2)} | ${milliseconds(a.elapsedMs)} | ${milliseconds(b.elapsedMs)} | ${ratio(p.comparisons[0].speedup)} | ${compact(b.validation.residualL2)} |`; }).join('\n')}

## Five-second final-solve budget

Cancelled final solves restore coordinates. Different completed iteration counts are not a valid completed-solve speedup, so those ratios are omitted.

| Constraints | JS status / outer iterations | WASM status / outer iterations |
|---:|---|---|
${finals.map(p => {const a=p.javascript.samples[0],b=p.wasm.samples[0];return `| ${p.count} | ${a.status} / ${a.iterations} | ${b.status} / ${b.iterations} |`;}).join('\n')}

Native iteration throughput is higher, but neither backend finishes the 5,000–100,000 constraint chains within this budget. The retained linear solver/preconditioner needs further investigation before claiming practical final solves at those scales. Parallelism is not enabled.

## Worker and user workflow

The real Worker test cancels an obsolete dimension revision, coalesces an intermediate revision, converges the latest revision and reuses native topology on another edit. Its timing includes asynchronous scheduling and differs from the synchronous numerical timings above. See [raw report](browser-baseline.json), [Worker check](worker/browser-baseline.json), and [rendered application check](app/browser-baseline.json). The application check covers dimension text and SVG updates, undo/redo, reload and invalid-expression rollback; [screenshot](app/native-app.png).

All 1,182 repository tests passed: [test log](tests.txt). Both production build targets passed: [Cloudflare build](build.txt), [GitHub Pages build](build-pages.txt). Full native geometry coverage and rendered drag workflows across all tool types remain unconfirmed; see [implementation scope](../../WASM_SOLVER_IMPLEMENTATION.md).

The raw report records browser/CPU details, source/binary hashes, iteration counts, final residuals, topology and memory counters. Heap samples are observations after a solve, not isolated peak memory or GC measurements. Baseline CPU/heap profiles and separate rendering/expression/graph measurements remain in the earlier baseline report. No end-to-end application speedup is claimed from numerical timings alone.
`;
writeFileSync(resolve(directory, 'RESULTS.md'), text);
console.log(`Wrote ${resolve(directory, 'RESULTS.md')}`);
