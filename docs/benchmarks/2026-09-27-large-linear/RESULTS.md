# Large-system linear solve experiment — 2026-09-27

## Status: rolled back at the user's request

The large-system sparse-direct extension has been removed. The previous native
sources and WASM binary are restored, and the earlier WASM and Trace Region
upgrades remain. The experimental compiler, opt-in option, tests and benchmark
entry point are removed. The document-bounds change introduced during this
experiment is also reverted. See [ROLLBACK.md](ROLLBACK.md).

The following measurements describe the withdrawn implementation; they are
historical evidence, not current application capabilities. The reported
Collinear failure is not claimed fixed by the rollback.

## Algorithm and limits

- Retain native LM, analytical Jacobians, sparse CSR and persistent buffers.
- Above 2,048 active variables, the experiment attempts sparse LDLᵀ using an
  indexed minimum-degree heap for ordering. The old compiler scanned all remaining
  variables for each pivot and rejected systems above 2,048 variables.
- Bound fill by `min(2,000,000, max(65,536, 16 * variables))` entries and symbolic
  work by 32,000,000 units. Otherwise use existing native PCG. No global dense matrix.
- Only the experimental large direct path replaces the fixed 1e-7 ridge with a
  diagonal-scaled floor of eight double-precision machine epsilons. The fixed
  ridge prevented correction of long-range modes even when LM reduced lambda.
- Preserve final residual tolerances, iteration limits, LM acceptance and damping
  schedule. Dimension edits reuse symbolic topology and numerical storage.
- JavaScript still performs symbolic preparation on structural changes. C++ owns
  numerical assembly, factorization, refinement and nonlinear iterations.

## Numerical browser measurements

Windows, Intel Core Ultra 9 275HX, Chrome 153.0.8010.53, single-threaded WASM.
One connected chain; three constraints per line (horizontal, length, joined
endpoints), with an explicit anchor and up to two redundant constraints. The
fixture asserts that all constraints form one connected component. A shared
dimension changes from 84 to 84.125. Normal final residual tolerance: 1e-3.
Maximum 2,000 nonlinear iterations and a **benchmark-only** three-second budget.

Before: one sample per scale, captured before changing the algorithm. After:
three fresh-realm samples per backend, alternating backend order. Setup/model
load and independent validation are outside solve timing. No rendering or Worker
transport is included. The new path was enabled for these measurements.

| Constraints | Variables | Old WASM | Experimental WASM median | Outer iterations | Jacobian entries | Native arena MiB | Residual L2 |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,332 | 775.9 ms | 785.2 ms | 70 | 5,318 | 0.48 | 9.59e-4 |
| 5,000 | 6,664 | Unfinished at 3 s | 15.4 ms | 10 | 26,648 | 2.72 | 9.24e-4 |
| 10,000 | 13,332 | Unfinished at 3 s | 25.5 ms | 11 | 53,318 | 5.36 | 1.91e-4 |
| 25,000 | 33,332 | Unfinished at 3 s | 58.6 ms | 12 | 133,318 | 13.30 | 9.02e-4 |
| 50,000 | 66,664 | Unfinished at 3 s | 145.6 ms | 15 | 266,648 | 26.52 | 5.09e-4 |
| 100,000 | 133,332 | Unfinished at 3 s | 445.2 ms | 23 | 533,318 | 52.97 | 8.25e-4 |

The 1,000-constraint case remains on PCG, explaining the non-monotonic timings.
The JavaScript reference did not finish any of these cases within three seconds.
Completed-solve speedup is therefore unavailable for the large cases. Do not
divide the timeout by the new duration and present that as a measured speedup.

At 100,000 constraints, initial resident load took a median 321.1 ms; the sparse
factor has 466,651 entries. Arena bytes exclude JavaScript objects, symbolic
compilation allocations, other native instances, rendering and browser overhead.

**Accuracy qualification:** normalized residual tolerance is not an absolute
coordinate tolerance. In the 100,000-constraint shared-dimension chain the maximum
coordinate error against its analytic solution is 5.70 drawing units at the normal
1e-3 residual tolerance. These numbers cannot establish export-level accuracy for
arbitrary drawings. Final tolerance was not loosened by the experiment.

Raw data: [before](before/browser-baseline.json), [after](after/browser-baseline.json).

## A single local dimension propagating through the chain

In [propagation](propagation/browser-baseline.json), only the first line references
the changed dimension; all later lines retain independent fixed target lengths.
Every line moved in both edits at each scale. Residual tolerance was 1e-8.

| Constraints | Separate line entities | First / second edit | Outer iterations | Maximum coordinate error across both edits |
| ---: | ---: | --- | --- | ---: |
| 5,000 | 1,666 | 16.1 / 9.1 ms | 11 / 11 | 5.33e-6 |
| 25,000 | 8,333 | 67.5 / 53.7 ms | 14 / 13 | 9.84e-6 |
| 100,000 | 33,333 | 475.7 / 393.8 ms | 26 / 23 | 6.23e-5 |

These are synthetic line systems, not tens of thousands of complex closed shapes.

## Verification and open failures

- Full suite passed 1,268 tests after the document-bounds fix. After disabling the
  experimental default, 16 targeted tests and 87 existing solver/Worker/facade
  regressions passed. Client and Pages builds were repeated with the default off.
- Numerical tests cover floating and underconstrained components, redundant and
  conflicting constraints, exact rollback, cancellation, repeated edits, topology
  reuse, and a 2,500-constraint mixed arc/tangency/fillet fixture.
- The rendered supplied TestFrontView c1 50→85 workflow passed with emitted client
  assets before the default was disabled. This exercises the retained small-system
  path, not the experimental large-system path.
- The attempted rendered 5,000-constraint workflow is **unconfirmed**. One run timed
  out; another was interrupted by development-server reload during source changes.
  There is no successful screenshot proving this full workflow.
- A 100,000-constraint Worker load hit a JavaScript argument-count limit in document
  bounding-box calculation. Replaced spread-to-Math.max/min with streaming bounds
  in its owning module and added a 100,000-entity regression. The full large Worker
  rapid-edit workflow has not been rerun successfully; it remains unconfirmed.
- User-reported Collinear collapse/reversal is unresolved in the live application.
  Related behavior is reproduced in the pristine original solver. A shape-preserving
  translation experiment exists only in an isolated temporary copy.

## Historical benchmark commands (entry point removed)

```sh
node scripts/solver-baseline/run-browser.mjs --linear-only=true --counts=1000,5000,10000,25000,50000,100000 --samples=3 --budget-ms=3000 --output=tmp/large-linear-rerun
node scripts/solver-baseline/run-browser.mjs --linear-only=true --linear-backends=wasm --linear-shared=false --linear-tolerance=0.00000001 --linear-repeats=2 --counts=5000,25000,100000 --samples=1 --budget-ms=10000 --output=tmp/large-linear-propagation
```

These commands require the withdrawn experimental implementation and no longer run in the current tree.
