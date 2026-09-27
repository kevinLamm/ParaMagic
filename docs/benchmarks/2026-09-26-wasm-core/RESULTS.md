# Native Parametric Core pipeline — September 26, 2026

All six requested core changes are implemented. The supplied
`TestFrontView.paramagic` drawing passes the actual Controls-panel edit,
Undo/Redo, repeated edits and reload with native geometry and Stack solving.
General application scheduling, DOM updates and rendering overhead remain
outside this stage. All production source changes are in `paramagic-core`;
the canvas change is one shared service callback for derived geometry.

## What changed

| Core owner | Native work | JavaScript work retained |
| --- | --- | --- |
| `StackPlacementSolver` | Persistent x/y/rotation variables, sparse residual/Jacobian evaluation and frame solves | Relationship selection, frame application and temporary gauge lifecycle |
| `ParameterRepository`, `WasmParameters` | Resident numeric/Boolean instruction programs and dirty-entry batch evaluation | Parsing, names, units, computed resolvers, strings and original error behavior |
| `ConstraintGraph`, `WasmGraph` | Packed incidence and union-find component labeling, with reused memory | IDs, graph metadata, affected-region selection and topology packing |
| `SolverController`, `WasmContinuation`, `WasmSolverSession` | Coordinate history, secant prediction and numerical checkpoints | Continuation transactions, annotations and final document rollback |
| `CompiledConstraintSystem` | Bounded sparse LDLᵀ factorization and iterative refinement | Symbolic fill compilation when topology changes; large systems retain native PCG |
| `SwellGeometry`, `SwellTools` | Exported native Swell pieces and curve samples reused by display | Stale-packet checks, boundary assembly and SVG rendering |

Numeric preparation writes changed slots. A transaction-scoped token skips
repeated topology signatures within nonstructural continuation; ordinary edits
still validate compatibility. Component and Stack worlds remain bounded caches.
This reduces preparation work but does not eliminate JavaScript scans, all
allocations, or the Worker/document replica.

Two common JavaScript improvements also benefit the reference backend:
cached symbol tables with trie lookup, and graph traversal that expands each
previous component/constraint node once. Their gains must not be attributed
to C++ execution alone.

## Supplied drawing: measured performance

Three samples per backend, alternating order, in Chrome 153.0.8010.53 on Windows
with an Intel Core Ultra 9 275HX. Each fresh application loads the supplied
drawing and uses its visible control. The emitted client Worker/WASM assets
are loaded in the rendered development harness. Values below are medians in ms.

| Edit | Current JS Worker | New WASM Worker | Speedup | JS through render | WASM through render |
| --- | ---: | ---: | ---: | ---: | ---: |
| 50 → 85 | 598.1 | 94.6 | 6.32× | 1053.4 | 540.0 |
| 85 → 50 | 745.0 | 73.4 | 10.15× | 1081.0 | 397.9 |
| 50 → 85 again | 481.1 | 65.7 | 7.32× | 720.2 | 298.5 |

The [previous WASM run](../2026-09-26-wasm-swell/RESULTS.md) measured Worker
medians of 213.1, 240.3 and 183.5 ms on these edits. The new measurements are
2.25×, 3.27× and 2.79× faster respectively. That is a comparison with the
earlier run on the same machine/browser, not an interleaved old/new binary test.

Worker duration includes controller processing, preparation, continuation,
placement and solving. UI time covers the control event through committed
geometry plus two animation frames. The difference includes communication,
application work and scheduling; it is not a pure rendering measurement.
Reference correctness checks occur after timing.

The separate Stack-placement numerical timer reports approximately 3.1–3.3 ms
per complete WASM transaction, versus 84.0–88.0 ms medians in JS. This timer
excludes some placement preparation and should not be added to Worker time.
Individual runs can take different iteration paths in the free-floating model.

### Numerical and memory evidence

- All **193 constraints** remain enabled. The affected geometry world has
  **278 variables, 305 residual rows and 1,436 stored Jacobian entries**,
  including structural zeros.
- Native sparse factorization uses **2,446 factor entries**. The existing
  eligibility limits remain 2,048 active variables, 65,536 factor entries and
  two million symbolic work units. There is no dense global matrix.
- Native continuation uses **18 steps**, with **55, 93 and 51** geometry
  nonlinear iterations over the three transactions. Stack solves report
  another **126 iterations** per transaction. Last-corrector iteration counts
  of zero do not describe the total work.
- The geometry component arena uses **271,320 bytes**; topology builds and
  memory growth stay at one across the numeric edits. Last-corrector numeric
  synchronization writes 2,992, 2,680 and 2,288 bytes. These are not total
  transaction traffic or total application memory.
- The arena count excludes other native instances (parameters, graph,
  continuation, placement and display), reserved memory pages, the JS document
  and the browser heap. Full application memory was not measured here.
- Maximum final reference residual L2 across all rendered edits is
  **9.68333e-9**, below the unchanged cross-Stack tolerance of **1e-8**.
  The reference requires no further correction after each native result.
- Maximum paired world-coordinate difference is **0.002990 mm**. This
  free-floating drawing permits different placements; coordinates are not
  identical. Both solutions independently satisfy all constraints.
- The binary is **141,661 bytes**, **ABI 4**, with zero imports. It uses one
  CPU thread, no shared memory and no server or GPU solver.

## Isolated parameter and graph measurements

Three browser samples per backend/scale, alternating order. The parameter
fixture changes the first expression in a chain and verifies propagation to
every entry. The graph fixture adds a bridge to a connected constraint chain
and checks that the result is one component. Medians are in ms.

| Entries / constraints | JS parameter cold | WASM parameter cold | JS parameter edit | WASM parameter edit | JS graph bridge | WASM graph bridge |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2.9 | 5.9 | 2.0 | 1.1 | 2.0 | 1.6 |
| 5,000 | 11.6 | 22.6 | 5.5 | 4.2 | 7.6 | 8.4 |
| 10,000 | 22.0 | 42.2 | 12.2 | 7.1 | 18.1 | 15.0 |

Native expression compilation increases initial cost; the resident root edit
is faster in these measurements. Native graph dispatch is not uniformly faster:
packing and rebuilding JS metadata outweigh the kernel gain at 5,000 in this
run. Most of the reduction from the historical multi-second expression and
near-second graph baselines comes from removing repeated JavaScript work.
Keeping the native path is useful for the experiment; these measurements do
not justify claiming that every port independently speeds up the application.

## Correctness and deployment checks

- Full repository suite: **1,246 passed**. The six focused pipeline tests were
  rerun after final expression edge-case and graph coverage additions.
- Native expression tests cover units, numeric/Boolean types, eager branches,
  signed zero, non-finite power behavior, single-argument min/max, errors,
  strings, renames, cycles and restoration of dependency edges after rollback.
- A 10,000-parameter test verifies the same resident plan and memory across
  edits. Graph comparisons include component metadata, merges, splits and
  enable/disable updates against the reference.
- All three native rendered runs pass **53 checks** each; the three reference
  runs pass **47 checks** each. Native checks additionally require native
  Stack solving and a displayed Swell result from the native packet.
- The rendered workflow includes 50→85, Undo→50, Redo→85, 85→50, 50→85 and
  serialized reload. It verifies changed SVG geometry, all constraints,
  released temporary locks and absence of the stall message. The final native
  screenshot was inspected.
- Native display pieces for lines, arcs, circles, polygons and curves match
  reference pieces to `1e-8` relative/absolute. Source edits invalidate stale
  display packets. Existing native residual/Jacobian coverage also passes.
- Both production builds pass. Actual client and GitHub Pages Workers load
  their WASM assets, supersede obsolete requests, and return the latest 85
  state at final tolerance. The latest status can be `unchanged` when an earlier
  85 already committed before the intervening request was superseded.
- The live server at port 5173 was checked against the new binary's SHA-256
  and reports ABI 4. No deployment or special headers were needed.

## Remaining scope

General UI/DOM work, transport and application scheduling are deferred for the
user's test. This stage does not establish final convergence at 100,000
constraints or solve the earlier long-chain PCG conditioning limit. Large
Swell-heavy worlds, all rendered drag workflows, Firefox/Safari/mobile,
sustained idle CPU and failure recovery under native traps remain unconfirmed.
The broader native-solver experiment is therefore still in progress.

## Evidence and reproduction

- [Rendered application and client Worker data](validated/browser-baseline.json)
- [Native screenshot](validated/front-app-wasm.png), [reference screenshot](validated/front-app-javascript.png)
- [Isolated phase data](core-phases/browser-baseline.json)
- [Pages Worker](bundled-pages/browser-baseline.json), [live server](live-server.json)
- [Full tests](tests.txt), [focused tests](core-tests.txt)
- [Client build](build-client.txt), [Pages build](build-pages.txt)

```powershell
npm test
npm run build
npm run build:pages
node scripts/solver-baseline/run-browser.mjs --front-app-only=true --front-samples=3 --front-worker-only=true --built=client --output=tmp/core-validation
node scripts/solver-baseline/run-browser.mjs --core-pipeline-only=true --counts=1000,5000,10000 --samples=3 --output=tmp/core-phases
node scripts/solver-baseline/run-browser.mjs --front-worker-only=true --built=pages --output=tmp/core-pages
```
