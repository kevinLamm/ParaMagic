# Swell in the native solver — September 26, 2026

Swell geometry and its reference finite-difference derivatives now execute in
the persistent WASM kernel. The supplied `TestFrontView.paramagic` drawing uses
native constraint evaluation for the `c1: 50 → 85` edit without a component
fallback. JavaScript still owns parameter evaluation, continuation transactions,
scope selection, the separate Stack-placement solver, and presentation.

## Measured application performance

Three samples per backend, with alternating backend order, used Chrome
153.0.8010.53 on Windows and an Intel Core Ultra 9 275HX. Each sample loaded the
supplied file, edited its visible Controls-panel input, exercised Undo/Redo,
repeated the edits, and reloaded the accepted document. Both backends include
the shared convergence correction. These are medians, in milliseconds.

| Edit | JS Worker | WASM Worker | Worker speedup | JS through render | WASM through render |
| --- | ---: | ---: | ---: | ---: | ---: |
| 50 → 85 | 564.7 | 213.1 | 2.65× | 1151.0 | 803.7 |
| 85 → 50 | 708.0 | 240.3 | 2.95× | 1179.9 | 726.5 |
| 50 → 85 again | 497.7 | 183.5 | 2.71× | 769.8 | 457.6 |

Worker duration includes controller processing, preparation, continuation and
solving. The UI measurement runs from the control event to committed geometry
plus two animation frames; it includes application work, transport and
scheduling. Neither measurement isolates the native numerical loop, and their
difference is not a pure rendering timer. Reference validation runs afterward.

The drawing retains all 193 constraints. The affected geometry model has 278
variables, 305 residual rows, and 1,436 stored sparse derivative entries,
including structural zeros. Its native arena occupies 207,560 bytes. Reported
topology builds and memory growth remain at one across the repeated numeric
edits. Total native continuation iterations are 55, 102 and 45 respectively;
the first edit reports 18 continuation steps. Last-corrector iteration counts
can be zero and must not be used as the total transaction work.

The WASM artifact is 99,824 bytes, ABI 3, with zero JavaScript imports. It uses
one CPU thread and no shared memory. The native arena count excludes the JS
document, browser heap, and reserved WebAssembly memory pages.

## Correctness and visible behavior

- All six application samples passed 47 checks each, including the requested
  backend, changed SVG geometry, all constraints enabled, Undo/Redo, reload,
  released temporary locks, and absence of the stall error.
- Reference validation of each rendered document required no further
  correction. The maximum final residual L2 across these edits was
  `9.77215e-9`, below the unchanged cross-Stack tolerance of `1e-8`.
- Raw world-coordinate comparisons between the paired backends differed by
  at most `0.002990 mm`. The drawing permits free placement, so coordinates
  are reported alongside constraint satisfaction. Coordinates were not
  identical. Local-coordinate comparisons alone would also mix in differences
  in how translation is divided between Stack frames and local geometry.
- Twenty-five Swell tests compare reference and native geometry, residuals,
  derivatives, repeated parameter changes, frames, transitions, joins,
  degeneracies, circles, arcs, curves and polygons. Residual comparisons use
  absolute/relative tolerances of `1e-10`; Jacobian comparisons use `1e-6`.
  A test makes the JS derived-geometry provider throw after native preparation
  and verifies that the native solve still succeeds.
- The full repository suite passed **1,240 tests**. Both production builds
  passed. Actual emitted client and Pages Workers loaded their WASM assets,
  superseded two obsolete parameter revisions, and converged the latest edit.

The implementation also corrects shared arc preparation: a radius constraint
on a derived Swell arc must not seed or reduce its source arc as though the
two radii were equal. Both backends retain the same final accuracy policy.

## Remaining performance work

This result establishes native Swell coverage on the supplied drawing and the
tested geometry cases. It does not establish final convergence at 100,000
constraints. The previous large-chain PCG conditioning limit remains, and
large Swell-heavy worlds have not been measured. Native Swell still preserves
reference finite differences and some quadratic topology/join processing;
those algorithms may need additional work after profiling.

Source inspection identifies these remaining candidates:

| Owner | Remaining work and possible native boundary | Evidence |
| --- | --- | --- |
| `StackPlacementSolver.solveStackPlacements` | A separate JS dense numerical solve for Stack x/y/rotation. Pack frame variables and use native sparse equations. | Confirmed direct call to the JS LM kernel; no isolated timing yet. |
| `ParameterRepository.evaluateDirty`, `symbolDefinitions` | Cache namespace tables and compile stable numeric expression programs; keep names, units and errors consistent. | Original baseline: a 10,000-parameter root edit took 3,697.3 ms in one diagnostic sample. |
| `SolverController.solveParameterContinuationWork`, `WasmSolverSession.prepare` | Keep predictor/checkpoint arrays and numeric target steps resident; replace full compatibility scans/copies with revision and dirty-slot updates. Preserve transaction rollback and branch behavior. | This fixture uses 18 continuation steps; individual setup costs are not isolated. |
| `ConstraintGraph.rebuildComponentsForVariables` | Remove repeated component scans, retain packed adjacency and incrementally update affected components. | Original baseline: a bridge update at 5,000 constraints took 984.8 ms in one diagnostic sample. |
| `CompiledConstraintSystem` | Port the existing bounded sparse elimination alternative and benchmark it against native PCG on applicable arc components. | JS has this path; native currently uses PCG. Benefits depend on conditioning and factor fill. |
| Application geometry/presentation | Reuse native derived geometry where useful; apply changed geometry incrementally and batch DOM work. | Original presentation-only baseline: applying 1,000 lines took 1,141.5 ms. This is not a predicted WASM gain. |

Some facade operations also perform synchronous local controller work before
Worker synchronization (`loadSketch`, ordinary `addConstraint`, and constraint
batches). Consolidating numerical ownership in the Worker is a separate
responsiveness improvement. The remaining work should be timed individually
before choosing the next port. Faster expression lookup or graph traversal may
come from eliminating repeated work before changing language.

## Evidence and reproduction

- [Application samples and client Worker](validated/browser-baseline.json)
- [Rendered WASM application](validated/front-app-wasm.png)
- [Rendered JavaScript reference](validated/front-app-javascript.png)
- [Pages Worker](bundled-pages/browser-baseline.json)
- [Full test suite](tests-final.txt), [client build](build.txt), [Pages build](build-pages.txt)
- [Original parameter, graph and presentation measurements](../2026-09-26-wasm-baseline/RESULTS.md)

The front-view runs populate `nativeApp` and `nativeWorkers`; the generic
baseline configuration/methodology fields in the JSON describe the harness's
default scale run, which was not executed in these front-only invocations.

```powershell
node --test src/tests/wasmSwellSolver.test.js src/tests/frontViewControlSolver.test.js
npm run build
node scripts/solver-baseline/run-browser.mjs --front-app-only=true --front-samples=3 --front-worker-only=true --built=client --output=tmp/swell-validation
npm run build:pages
node scripts/solver-baseline/run-browser.mjs --front-worker-only=true --built=pages --output=tmp/swell-pages
```
