# Same-browser JavaScript / WASM comparison

Measured 2026-09-26T15:25:27.519Z on Intel(R) Core(TM) Ultra 9 275HX, Chrome/153.0.8010.53, Windows. One sequential sample per scale and backend; three different consecutive edits in the repeated-edit case. These are not statistical confidence intervals. Both backends use Float64, tolerance 1e-3, the same original equations and entity-block PCG preconditioner. The JS numerical kernel is unchanged.

## Completed connected solves

One shared dimension propagates through all 333 panels: 1,000 constraints, 1,332 variables, 5,318 stored Jacobian entries. Initial target 84. Resident native topology is loaded before timing. Timings include numeric synchronization and numerical solve, exclude rendering and validation, and are separate from Worker round-trip measurements. The first edit moves all panels; each following edit starts from the previous solution. Native topology builds and memory growth remain at one across the edits.

| Dimension target | JS / WASM outer iterations | JS ms | WASM ms | Speedup | Final residual L2 | Maximum coordinate difference |
|---|---:|---:|---:|---:|---:|---:|
| 84.125 | 70 / 70 | 11354.6 | 774.0 | 14.67x | 9.590e-4 | 0 |
| 84.15 | 45 / 45 | 7108.7 | 482.3 | 14.74x | 9.660e-4 | 0 |
| 84.175 | 45 / 45 | 7071.3 | 476.3 | 14.85x | 9.677e-4 | 0 |

Parameter values and convergence status also match. The first solution differs from the exact chain coordinates by about 0.663 model units in **both** implementations, due to the existing normalized residual acceptance policy. This experiment preserves that policy. The speedup includes fewer clock calls and packed sparse memory, so it does not isolate a language-only effect.

## Large-scale throughput: two preview iterations

These are deliberately incomplete previews, not final solutions. Each row runs the same two LM iterations; PCG work and coordinates match. Their residuals exceed the final threshold. Stored CSR entries include structural zero slots retained for reuse. Native arena bytes include scratch and module stack/static storage, not the JavaScript model, browser heap or rendering memory.

| Constraints | Variables | Stored Jacobian entries | Native arena MiB | JS ms | WASM ms | Throughput ratio | Preview residual L2 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1000 | 1332 | 5318 | 0.47 | 20.3 | 2.5 | 8.12x | 5.412e-2 |
| 5000 | 6664 | 26648 | 2.08 | 97.1 | 9.3 | 10.44x | 1.211e-1 |
| 10000 | 13332 | 53318 | 4.11 | 191.6 | 14.8 | 12.95x | 1.714e-1 |
| 25000 | 33332 | 133318 | 10.17 | 433.1 | 34.4 | 12.59x | 2.710e-1 |
| 50000 | 66664 | 266648 | 20.28 | 837.0 | 64.2 | 13.04x | 3.832e-1 |
| 100000 | 133332 | 533318 | 40.50 | 1819.8 | 147.2 | 12.36x | 5.420e-1 |

## Five-second final-solve budget

Cancelled final solves restore coordinates. Different completed iteration counts are not a valid completed-solve speedup, so those ratios are omitted.

| Constraints | JS status / outer iterations | WASM status / outer iterations |
|---:|---|---|
| 1000 | cancelled / 33 | converged / 70 |
| 5000 | cancelled / 8 | cancelled / 64 |
| 10000 | cancelled / 6 | cancelled / 34 |
| 25000 | cancelled / 4 | cancelled / 16 |
| 50000 | cancelled / 4 | cancelled / 10 |
| 100000 | cancelled / 3 | cancelled / 7 |

Native iteration throughput is higher, but neither backend finishes the 5,000–100,000 constraint chains within this budget. The retained linear solver/preconditioner needs further investigation before claiming practical final solves at those scales. Parallelism is not enabled.

## Worker and user workflow

The real Worker test cancels an obsolete dimension revision, coalesces an intermediate revision, converges the latest revision and reuses native topology on another edit. Its timing includes asynchronous scheduling and differs from the synchronous numerical timings above. See [raw report](browser-baseline.json), [Worker check](worker/browser-baseline.json), and [rendered application check](app/browser-baseline.json). The application check covers dimension text and SVG updates, undo/redo, reload and invalid-expression rollback; [screenshot](app/native-app.png).

All 1,182 repository tests passed: [test log](tests.txt). Both production build targets passed: [Cloudflare build](build.txt), [GitHub Pages build](build-pages.txt). Full native geometry coverage and rendered drag workflows across all tool types remain unconfirmed; see [implementation scope](../../WASM_SOLVER_IMPLEMENTATION.md).

The raw report records browser/CPU details, source/binary hashes, iteration counts, final residuals, topology and memory counters. Heap samples are observations after a solve, not isolated peak memory or GC measurements. Baseline CPU/heap profiles and separate rendering/expression/graph measurements remain in the earlier baseline report. No end-to-end application speedup is claimed from numerical timings alone.
