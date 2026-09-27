import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] || 'docs/benchmarks/2026-09-26-wasm-coverage');
const report = JSON.parse(readFileSync(resolve(directory, 'final/browser-baseline.json'), 'utf8'));
if (report.errors.length || report.wasmPairs.length !== 13) throw Error('Expected all six final/preview pairs plus repeated edits, without benchmark errors.');
const fmt = (v, places = 1) => Number(v).toLocaleString('en-US', { maximumFractionDigits: places, minimumFractionDigits: places });
const finals = report.wasmPairs.filter(p => p.mode === 'final' && p.repeats === 1);
const previews = report.wasmPairs.filter(p => p.mode === 'interactive');
const edits = report.wasmPairs.find(p => p.repeats === 3);
const speed = c => c.speedup == null ? '—' : `${fmt(c.speedup, 2)}×`;
const rows = pairs => pairs.map(p => {
  const j = p.javascript.samples[0], w = p.wasm.samples[0], c = p.comparisons[0];
  return `| ${fmt(p.count, 0)} | ${fmt(p.wasm.variables, 0)} | ${fmt(w.jacobianStats.derivativeEntries, 0)} | ${j.iterations} / ${w.iterations} | ${fmt(j.elapsedMs)} | ${fmt(w.elapsedMs)} | ${speed(c)} | ${j.status} / ${w.status} | ${w.validation.residualL2.toExponential(3)} | ${fmt(w.jacobianStats.arenaBytes / 1048576, 2)} |`;
}).join('\n');
const table = pairs => `| Constraints | Variables | CSR entries | Iterations JS / WASM | JS ms | WASM ms | Speedup | Status JS / WASM | WASM residual L2 | Native arena MiB |\n|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|\n${rows(pairs)}`;
const repeatRows = edits.javascript.samples.map((j, i) => {
  const w = edits.wasm.samples[i], c = edits.comparisons[i];
  if (!c.bothConverged || c.maxCoordinateDifference > 1e-5 || w.jacobianStats.topologyBuilds !== 1) throw Error('Repeated edit parity/persistence failed.');
  return `| ${j.target} | ${fmt(j.elapsedMs)} | ${fmt(w.elapsedMs)} | ${speed(c)} | ${c.maxCoordinateDifference.toExponential(3)} | ${w.validation.residualL2.toExponential(3)} | ${w.jacobianStats.topologyBuilds} |`;
}).join('\n');
const wasm = edits.wasm.samples[0];
const contents = `# Expanded native constraint coverage — 2026-09-26

All 25 registered constraint types now have native evaluation. The 13 additions
are Parallel, Perpendicular, Point-on Line, Point Line Distance, Line Line
Distance, Collinear, Equal, Length, Tangent, Point-on Arc, Point-on Fillet, Angle
and Meta. Native support also includes arc intrinsic equations, polygon/table
segments, interpolated points and global transforms. Derived Swell references
remain an explicit whole-component JavaScript fallback.

## Same-browser measurements

Measured on ${report.environment.cpu}, ${report.environment.browser.product}.
The connected mixed fixture contains parallel panel tops, perpendicular sides,
projected dimensions, equal lengths, angles, tangent circles, semicircular arcs,
arc points and derived fillets. One dimension drives every panel width. Models
contain exactly the requested number of constraints; intrinsic arc equations
are additional residual rows. This is a synthetic connected drawing, not a
claim about every saved document.

Fresh same-browser models, same mutation (84 → 84.125), same final residual L2
tolerance (1e-3), same Float64 equations. Setup and first resident load are
reported separately in the raw file. Timed solves include parameter evaluation,
arc preparation, signature checks, numeric copies and native work. Final solve
budgets include preparation time. Browser scheduling and indivisible passes can
overshoot a budget. One main sample per scale; the repeated 1,000-constraint
sample below provides additional measurements. No multicore, GPU or server work.

### Final convergence, five-second budget

${table(finals)}

A cancelled final solve restores its original coordinates. Residuals in those
rows describe that restored state against the new target. Speedup is withheld
unless both implementations converge. Equal restored coordinates alone are not
evidence of solving a cancelled model.

### Two-iteration preview, sixty-second ceiling

${table(previews)}

These are temporary previews, not final-accuracy results. Speedup appears only
when status and completed iteration counts match. At the largest scale the
JavaScript reference can reach its time ceiling before two iterations finish.
CSR entries include structural zeroes. Native arena bytes exclude the JS model,
module code and browser overhead; they are not total application memory. Raw
files also record browser heap snapshots, which are affected by garbage collection.

### Repeated edits at 1,000 constraints

| Width | JS ms | WASM ms | Speedup | Largest coordinate difference | WASM residual L2 | Topology builds |
|---:|---:|---:|---:|---:|---:|---:|
${repeatRows}

The native arena and topology remain resident. The first repeated solve evaluated
${wasm.jacobianStats.analyticalBlocks} analytical blocks and ${wasm.jacobianStats.fallbackBlocks}
numerical blocks; the latter are Angle and Meta in this fixture. Fillet and arc
derivatives remain analytical away from the reference's branch boundaries.

## Validation

- The full application suite passed 1,209 tests. After the final input-validation
  and fallback additions, all 52 native solver tests passed.
- Native residual/Jacobian comparisons cover all 25 types, tangent variants,
  domain boundaries, degenerate projections, fillets from line/curve/arc sources,
  global frames and polygon/table features. Residual comparisons use 1e-11 or
  tighter relative/absolute bounds; Jacobians use 1e-7, or 1e-6 for rounded fillet
  constructions. Full solves also check residual L2 as strictly as 1e-9 and
  compare repeated coordinates. Final application tolerance was not changed.
- Exact diameter-chord reductions, radius branch seeding, billion-unit radii,
  repeated fillet radius edits, cancellation rollback, retained topology,
  inconsistent systems and explicit Swell fallback are tested.
- The actual dimension editor passed 17 checks on a rendered mixed drawing with
  22 constraint types (including 12 of the 13 additions), with native Worker
  diagnostics, updated SVG geometry, residual validation, undo/redo, serialized
  reload and rejected-expression rollback. Meta has numerical/API coverage;
  there is no Meta editing UI exercised by this fixture.
- Both normal and GitHub Pages builds pass. Both emitted Worker/WASM bundles
  solve the mixed model, interrupt an obsolete revision, prioritize the latest
  edit and retain topology on the next edit.

## Limits and next decision

The requested constraint equations now execute inside WASM. This does not
complete the full solver migration: derived Swell generation, expression/unit
evaluation, graph work and transaction orchestration remain JavaScript. Arc
preparation is also measured JS work, including its dependency analysis. The
backend keeps native packed state and reuses CSR and numerical scratch; the JS
document replica still exists.

The large-scale results justify further work on nonlinear/linear convergence and
arc/dependency preparation before adding WASM threads. Native final convergence
at 100,000 constraints, arbitrary saved-document parity, every rendered drag/tool
workflow, mobile/Firefox/Safari behavior and trap recovery remain unconfirmed.

## Evidence and reproduction

- [Raw paired measurements](final/browser-baseline.json)
- [Rendered mixed app and built Worker checks](bundled-client/browser-baseline.json)
- [Screenshot](bundled-client/native-app.png)
- [GitHub Pages Worker checks](bundled-pages/browser-baseline.json)
- [Full test log](tests.txt), [native test log](native-tests.txt)
- [Normal build](build.txt), [Pages build](build-pages.txt)

Earlier pilot/scales files record development-stage measurements. The final
directory is the source for every timing in this report.

\`\`\`powershell
node scripts/solver-baseline/run-browser.mjs --wasm=true --mixed=true --counts=1000,5000,10000,25000,50000,100000 --samples=1 --budget-ms=5000 --auxiliary=false --profile-count=0 --output=docs/benchmarks/2026-09-26-wasm-coverage/final
node scripts/solver-baseline/summarize-coverage.mjs
\`\`\`
`;
writeFileSync(resolve(directory, 'RESULTS.md'), contents);
console.log(`Wrote ${resolve(directory, 'RESULTS.md')}`);
