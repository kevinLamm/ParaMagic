# Browser baseline measurements

Recorded 2026-09-26T14:09:03.691Z; Intel(R) Core(TM) Ultra 9 275HX; Chrome/153.0.8010.53; win32.

## Connected system: one shared dimension, 84 → 84.125

Medians of 3 fresh-model samples at each scale, with a small warmup in each browser realm. Each model begins solved. Geometry, graph construction and final verification are outside the solve timer. Default production tolerance: L2 residual < 0.001. The 5000 ms budget cancels and restores geometry on failure. A cancelled runtime is a budget observation, **not time to convergence**. Iterations count completed outer iterations; production diagnostics expose only the last completed PCG iteration count, not the total.

| Constraints | Active variables | Numerical J nonzeros at start | Outer iterations | JS elapsed ms | Status | Linear ms | Jacobian ms | Residual ms | Heap after MiB | Returned residual L2 | WASM ms | Speedup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 1,330 | 2,659 | 33 | 5,000.3 | cancelled | 4,786.9 | 54.3 | 13.5 | 59.2 | 5.419e-2 | — | — |
| 5,000 | 6,662 | 13,324 | 8 | 5,000.4 | cancelled | 4,500.8 | 72.4 | 19.3 | 43.8 | 1.212e-1 | — | — |
| 10,000 | 13,330 | 26,659 | 6 | 5,000.5 | cancelled | 4,702.4 | 126.8 | 23.3 | 87.1 | 1.714e-1 | — | — |
| 25,000 | 33,330 | 66,659 | 4 | 5,001.1 | cancelled | 2,093.6 | 224.0 | 32.6 | 217.0 | 2.711e-1 | — | — |
| 50,000 | 66,662 | 133,324 | 3 | 5,001.9 | cancelled | 1,461.5 | 334.7 | 42.9 | 368.3 | 3.834e-1 | — | — |
| 100,000 | 133,330 | 266,659 | 3 | 5,003.5 | cancelled | 3,309.8 | 638.4 | 102.0 | 532.3 | 5.422e-1 | — | — |

Heap is renderer JS heap after the solve, including the model and unreclaimed garbage; it is not peak memory or native/WASM memory. Timeout residuals describe restored geometry against the requested new target. WASM has not been implemented or measured.

**Timing limitation:** the current solver copies its phase timers into a cancellation result before the interrupted phase's finally block updates them. Consequently Jacobian/linear times in cancelled samples can omit the final interrupted phase and are lower bounds. The unexplained remainder must not be labelled nonlinear overhead. The external elapsed timer and the separate CPU/phase profiles include that work. Successful sample phase timers do not have this cancellation issue.

## Isolated phases

One diagnostic sample per size on the first-panel edit. Callback timing adds overhead and browser clocks are quantized. Assembly remainder includes sparse index/value copying, validation, diagonal construction and entity preconditioner construction. These are not additive to the headline solve samples.

| Constraints | Graph build ms | Scope ms | Block topology ms | Analytical callbacks ms | Sparse assembly remainder ms | Stored J entries | Snapshot ms | Clone ms | JSON ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1000 | 2.7 | 0.3 | 2.4 | 1.2 | 1.2 | 5318 | 0.8 | 1.2 | 0.2 |
| 5000 | 15.1 | 1.2 | 12.8 | 5.2 | 6.4 | 26648 | 4.4 | 4.3 | 0.9 |
| 10000 | 33.4 | 2.3 | 23.6 | 11.7 | 10.5 | 53318 | 8.1 | 9.9 | 2.1 |
| 25000 | 84.0 | 6.7 | 45.9 | 33.0 | 28.1 | 133318 | 17.2 | 25.9 | 5.6 |
| 50000 | 217.2 | 15.0 | 93.4 | 48.0 | 50.6 | 266648 | 32.2 | 61.5 | 11.1 |
| 100000 | 393.2 | 29.2 | 175.4 | 73.7 | 118.4 | 533318 | 62.6 | 123.0 | 24.6 |

The block format stores some zero entries. The numerical nonzero count is value-dependent; the stored-entry count is a conservative topology size. No global dense matrix is created in these scale runs.

| Small dense case | Active variables | Derivative + assembly ms | Normal matrix construction ms | Gaussian elimination ms |
| --- | --- | --- | --- | --- |
| 90 | 118 | 0.4 | 6.5 | 1.8 |

## CPU and allocation profiles

Separate 5,000-constraint profile: 5,091.3 ms sampled; 52.0 ms attributed to the garbage collector. The allocation sampler estimated 2,587.9 MiB allocated across another run (including collected objects and setup). This is allocation volume, not live memory.

| Function | Source line | Sampled self ms |
| --- | --- | --- |
| now | (native):0 | 1,892.0 |
| now | NumericSolverCore.js:692 | 1,751.6 |
| apply | NumericSolverCore.js:158 | 351.6 |
| (anonymous) | JacobianBlocks.js:250 | 198.7 |
| cancellationCheck | NumericSolverCore.js:704 | 172.6 |
| (anonymous) | JacobianBlocks.js:233 | 164.9 |
| solveMatrixFreeDampedLeastSquares | NumericSolverCore.js:186 | 81.4 |
| applyJacobian | JacobianBlocks.js:226 | 65.4 |
| applyJacobianTranspose | JacobianBlocks.js:243 | 60.9 |
| (garbage collector) | (native):0 | 52.0 |
| throwIfCancelled | JacobianBlocks.js:15 | 51.4 |
| vectorDot | NumericSolverCore.js:101 | 37.2 |

## Parameter and graph work

| Parameters | Cold evaluation ms | Clean evaluation ms | Root edit ms | Affected parameters |
| --- | --- | --- | --- | --- |
| 1000 | 75.0 | 0.1 | 42.0 | 1000 |
| 5000 | 1,669.4 | 0.1 | 950.0 | 5000 |
| 10000 | 6,438.7 | 0.2 | 3,697.3 | 10000 |

| Existing constraints | Add bridge: graph only ms |
| --- | --- |
| 1000 | 27.0 |
| 3000 | 340.4 |
| 5000 | 984.8 |

Parameter and graph rows are single diagnostic samples. The bridge mutation is synchronous and unbounded in production, so this diagnostic is limited to 5,000 constraints.

## Real Worker transport

| Constraints | Full object snapshot echo ms | Coordinate buffer transfer echo ms | Object JSON bytes | Coordinate bytes |
| --- | --- | --- | --- | --- |
| 1000 | 2.0 | 0.1 | 179,973 | 10,656 |
| 5000 | 11.4 | 0.2 | 910,862 | 53,312 |
| 10000 | 22.7 | 0.2 | 1,834,255 | 106,656 |
| 25000 | 60.9 | 0.4 | 4,604,256 | 266,656 |
| 50000 | 130.4 | 0.2 | 9,290,380 | 533,312 |
| 100000 | 280.0 | 0.4 | 18,707,109 | 1,066,656 |

The echo comparison isolates transport mechanisms and payload scope. The coordinate buffer omits topology and metadata, so this is not a solver speedup or an equal-payload format comparison. JSON byte counts estimate serialization size; browser postMessage uses structured clone, not JSON.

| Constraints | Load round trip ms | Dimension edit round trip ms | Worker processing ms | Status | Moved fraction | Residual L2 |
| --- | --- | --- | --- | --- | --- | --- |
| 1000 | 85.6 | 78.7 | 78.5 | converged | 26.1% | 8.610e-4 |
| 5000 | 166.6 | 377.1 | 376.6 | converged | 5.2% | 8.610e-4 |

Worker edits change only the first panel. They are not the shared-dimension scale benchmark. Load uses explicit millimetre units to match the raw numerical fixtures. Processing duration includes controller work and result construction; round-trip minus processing includes scheduling and transport and is not a pure copying timer.

## Accuracy diagnostic and repeated edits

| Scenario | Constraints | Tolerance | Edit | Status | JS ms | Residual L2 | Maximum closed-form coordinate error | Moved fraction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shared-dimension | 30 | 1e-8 | 0 | converged | 4.6 | 3.952e-9 | 0.000000 | 100.0% |
| shared-dimension | 30 | 1e-8 | 1 | converged | 3.0 | 3.997e-9 | 0.000000 | 100.0% |
| shared-dimension | 30 | 1e-8 | 2 | converged | 3.6 | 4.042e-9 | 0.000000 | 100.0% |
| first-panel-dimension | 1000 | 0.001 | 0 | converged | 81.9 | 8.610e-4 | 0.125000 | 26.1% |
| first-panel-dimension | 1000 | 0.001 | 1 | converged | 194.1 | 9.650e-4 | 0.250000 | 78.4% |
| first-panel-dimension | 1000 | 0.001 | 2 | converged | 377.7 | 9.012e-4 | 0.374842 | 100.0% |
| first-panel-dimension | 1000 | 1e-8 | 0 | cancelled | 5,000.4 | 2.970e-3 | 0.125000 | 0.0% |

Coordinate error compares the chosen positive-direction anchored solution to its closed form. Normalized residual acceptance does not guarantee this global coordinate bound in a long chain. The 1e-8 diagnostic is stricter than the production default and does not alter product behavior.

## Production canvas presentation, separately from solving

| Entities | Load + presentation ms | Apply geometry ms | Forced layout ms | Apply through two frames ms | DOM descendants | Solve calls during apply |
| --- | --- | --- | --- | --- | --- | --- |
| 333 | 1,656.3 | 129.6 | 5.5 | 168.9 | 1998 | 0 |
| 1000 | 14,170.9 | 1,141.5 | 19.3 | 1,278.5 | 6000 | 0 |
| 1666 | 40,084.8 | 3,127.9 | 26.4 | 3,330.2 | 9996 | 0 |

These rows use the actual createInfiniteCanvas/applySolverSnapshot implementation and application CSS, in an isolated page with no application panels. The entities are a visible grid of lines. Loading includes controller initialization; only the apply timer isolates presentation. Two animation frames are a headless presentation proxy, not measured physical display latency. Full application input-to-paint and drawing tools remain unmeasured.

## Errors and incomplete measurements

No harness errors in this run.

Raw data: [browser-baseline.json](browser-baseline.json). Profiles: [solver.cpuprofile](solver.cpuprofile), [allocations.heapprofile](allocations.heapprofile). This is the baseline stage; it does not establish WASM parity, speedup, or complete application acceptance.
