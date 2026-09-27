# Browser baseline measurements

Recorded 2026-09-26T14:15:45.873Z; Intel(R) Core(TM) Ultra 9 275HX; Chrome/153.0.8010.53; win32.

## Connected system: one shared dimension, 84 → 84.125

Medians of 1 fresh-model samples at each scale, with a small warmup in each browser realm. Each model begins solved. Geometry, graph construction and final verification are outside the solve timer. Default production tolerance: L2 residual < 0.001. The 60000 ms budget cancels and restores geometry on failure. A cancelled runtime is a budget observation, **not time to convergence**. Iterations count completed outer iterations; production diagnostics expose only the last completed PCG iteration count, not the total.

| Constraints | Active variables | Numerical J nonzeros at start | Outer iterations | JS elapsed ms | Status | Linear ms | Jacobian ms | Residual ms | Heap after MiB | Returned residual L2 | WASM ms | Speedup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 1,330 | 2,659 | 70 | 11,058.0 | converged | 10,921.1 | 107.1 | 24.0 | 70.5 | 9.590e-4 | — | — |

Heap is renderer JS heap after the solve, including the model and unreclaimed garbage; it is not peak memory or native/WASM memory. Timeout residuals describe restored geometry against the requested new target. WASM has not been implemented or measured.

**Timing limitation:** the current solver copies its phase timers into a cancellation result before the interrupted phase's finally block updates them. Consequently Jacobian/linear times in cancelled samples can omit the final interrupted phase and are lower bounds. The unexplained remainder must not be labelled nonlinear overhead. The external elapsed timer and the separate CPU/phase profiles include that work. Successful sample phase timers do not have this cancellation issue.

## Isolated phases

One diagnostic sample per size on the first-panel edit. Callback timing adds overhead and browser clocks are quantized. Assembly remainder includes sparse index/value copying, validation, diagonal construction and entity preconditioner construction. These are not additive to the headline solve samples.

| Constraints | Graph build ms | Scope ms | Block topology ms | Analytical callbacks ms | Sparse assembly remainder ms | Stored J entries | Snapshot ms | Clone ms | JSON ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1000 | 2.9 | 0.3 | 3.2 | 1.3 | 1.2 | 5318 | 1.1 | 1.0 | 0.2 |

The block format stores some zero entries. The numerical nonzero count is value-dependent; the stored-entry count is a conservative topology size. No global dense matrix is created in these scale runs.

| Small dense case | Active variables | Derivative + assembly ms | Normal matrix construction ms | Gaussian elimination ms |
| --- | --- | --- | --- | --- |

## CPU and allocation profiles

## Parameter and graph work

| Parameters | Cold evaluation ms | Clean evaluation ms | Root edit ms | Affected parameters |
| --- | --- | --- | --- | --- |

| Existing constraints | Add bridge: graph only ms |
| --- | --- |

Parameter and graph rows are single diagnostic samples. The bridge mutation is synchronous and unbounded in production, so this diagnostic is limited to 5,000 constraints.

## Real Worker transport

| Constraints | Full object snapshot echo ms | Coordinate buffer transfer echo ms | Object JSON bytes | Coordinate bytes |
| --- | --- | --- | --- | --- |

The echo comparison isolates transport mechanisms and payload scope. The coordinate buffer omits topology and metadata, so this is not a solver speedup or an equal-payload format comparison. JSON byte counts estimate serialization size; browser postMessage uses structured clone, not JSON.

| Constraints | Load round trip ms | Dimension edit round trip ms | Worker processing ms | Status | Moved fraction | Residual L2 |
| --- | --- | --- | --- | --- | --- | --- |

Worker edits change only the first panel. They are not the shared-dimension scale benchmark. Load uses explicit millimetre units to match the raw numerical fixtures. Processing duration includes controller work and result construction; round-trip minus processing includes scheduling and transport and is not a pure copying timer.

## Accuracy diagnostic and repeated edits

| Scenario | Constraints | Tolerance | Edit | Status | JS ms | Residual L2 | Maximum closed-form coordinate error | Moved fraction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Coordinate error compares the chosen positive-direction anchored solution to its closed form. Normalized residual acceptance does not guarantee this global coordinate bound in a long chain. The 1e-8 diagnostic is stricter than the production default and does not alter product behavior.

## Production canvas presentation, separately from solving

| Entities | Load + presentation ms | Apply geometry ms | Forced layout ms | Apply through two frames ms | DOM descendants | Solve calls during apply |
| --- | --- | --- | --- | --- | --- | --- |

These rows use the actual createInfiniteCanvas/applySolverSnapshot implementation and application CSS, in an isolated page with no application panels. The entities are a visible grid of lines. Loading includes controller initialization; only the apply timer isolates presentation. Two animation frames are a headless presentation proxy, not measured physical display latency. Full application input-to-paint and drawing tools remain unmeasured.

## Errors and incomplete measurements

No harness errors in this run.

Raw data: [browser-baseline.json](browser-baseline.json). This is the baseline stage; it does not establish WASM parity, speedup, or complete application acceptance.
