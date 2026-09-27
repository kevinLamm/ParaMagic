# Expanded native constraint coverage — 2026-09-26

All 25 registered constraint types now have native evaluation. The 13 additions
are Parallel, Perpendicular, Point-on Line, Point Line Distance, Line Line
Distance, Collinear, Equal, Length, Tangent, Point-on Arc, Point-on Fillet, Angle
and Meta. Native support also includes arc intrinsic equations, polygon/table
segments, interpolated points and global transforms. Derived Swell references
remain an explicit whole-component JavaScript fallback.

## Same-browser measurements

Measured on Intel(R) Core(TM) Ultra 9 275HX, Chrome/153.0.8010.53.
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

| Constraints | Variables | CSR entries | Iterations JS / WASM | JS ms | WASM ms | Speedup | Status JS / WASM | WASM residual L2 | Native arena MiB |
|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| 1,000 | 918 | 7,811 | 14 / 14 | 294.6 | 80.2 | 3.67× | converged / converged | 3.658e-5 | 1.12 |
| 5,000 | 4,644 | 39,401 | 4 / 69 | 5,000.4 | 4,857.8 | — | cancelled / converged | 2.670e-4 | 5.34 |
| 10,000 | 9,288 | 78,861 | 2 / 36 | 5,000.5 | 5,000.7 | — | cancelled / cancelled | 1.161e+0 | 10.60 |
| 25,000 | 23,274 | 197,351 | 0 / 14 | 5,000.6 | 5,001.1 | — | cancelled / cancelled | 1.837e+0 | 26.42 |
| 50,000 | 46,548 | 394,761 | 0 / 8 | 5,001.2 | 5,001.8 | — | cancelled / cancelled | 2.598e+0 | 52.76 |
| 100,000 | 93,096 | 789,581 | 0 / 3 | 5,002.6 | 5,004.7 | — | cancelled / cancelled | 3.674e+0 | 105.45 |

A cancelled final solve restores its original coordinates. Residuals in those
rows describe that restored state against the new target. Speedup is withheld
unless both implementations converge. Equal restored coordinates alone are not
evidence of solving a cancelled model.

### Two-iteration preview, sixty-second ceiling

| Constraints | Variables | CSR entries | Iterations JS / WASM | JS ms | WASM ms | Speedup | Status JS / WASM | WASM residual L2 | Native arena MiB |
|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| 1,000 | 918 | 7,811 | 2 / 2 | 69.0 | 13.2 | 5.23× | preview / preview | 2.560e-1 | 1.12 |
| 5,000 | 4,644 | 39,401 | 2 / 2 | 1,351.4 | 61.4 | 22.01× | preview / preview | 6.120e-1 | 5.34 |
| 10,000 | 9,288 | 78,861 | 2 / 2 | 3,980.2 | 114.1 | 34.88× | preview / preview | 8.715e-1 | 10.60 |
| 25,000 | 23,274 | 197,351 | 2 / 2 | 18,306.7 | 415.4 | 44.07× | preview / preview | 1.385e+0 | 26.42 |
| 50,000 | 46,548 | 394,761 | 1 / 2 | 60,003.5 | 1,173.9 | — | preview / preview | 1.962e+0 | 52.76 |
| 100,000 | 93,096 | 789,581 | 0 / 2 | 60,002.5 | 4,307.7 | — | preview / preview | 2.776e+0 | 105.45 |

These are temporary previews, not final-accuracy results. Speedup appears only
when status and completed iteration counts match. At the largest scale the
JavaScript reference can reach its time ceiling before two iterations finish.
CSR entries include structural zeroes. Native arena bytes exclude the JS model,
module code and browser overhead; they are not total application memory. Raw
files also record browser heap snapshots, which are affected by garbage collection.

### Repeated edits at 1,000 constraints

| Width | JS ms | WASM ms | Speedup | Largest coordinate difference | WASM residual L2 | Topology builds |
|---:|---:|---:|---:|---:|---:|---:|
| 84.125 | 293.5 | 79.4 | 3.70× | 5.338e-10 | 3.658e-5 | 1 |
| 84.15 | 114.0 | 31.0 | 3.68× | 1.623e-10 | 1.272e-5 | 1 |
| 84.175 | 106.7 | 31.0 | 3.44× | 1.707e-10 | 1.225e-5 | 1 |

The native arena and topology remain resident. The first repeated solve evaluated
966 analytical blocks and 68
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

```powershell
node scripts/solver-baseline/run-browser.mjs --wasm=true --mixed=true --counts=1000,5000,10000,25000,50000,100000 --samples=1 --budget-ms=5000 --auxiliary=false --profile-count=0 --output=docs/benchmarks/2026-09-26-wasm-coverage/final
node scripts/solver-baseline/summarize-coverage.mjs
```
