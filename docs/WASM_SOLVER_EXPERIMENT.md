# Persistent WASM solver: baseline and implementation boundary

> This is the original baseline-stage record. The subsequent native subset,
> Worker integration, build workflow and comparison results are documented in
> [WASM_SOLVER_IMPLEMENTATION.md](WASM_SOLVER_IMPLEMENTATION.md). Statements
> below about unimplemented features describe the baseline stage.

## Status

The first stage inspects and profiles the existing JavaScript implementation. Production solver mathematics, tolerances, Worker behavior, and rendering are unchanged. The new code is a reproducible browser benchmark harness plus fixture validation tests.

The C++ solver, WASM build, backend selection, revision cancellation, and JS/WASM parity comparisons are **not implemented**. No WASM speedup or completion of the replacement is claimed. The measurements justify a bounded native experiment; they do not justify switching the application backend yet.

See [measured browser results](benchmarks/2026-09-26-wasm-baseline/RESULTS.md) and [raw samples, environment, and source hashes](benchmarks/2026-09-26-wasm-baseline/browser-baseline.json).

On this machine (Core Ultra 9 275HX, Chrome 153), all three shared-dimension samples at each of 1,000 / 5,000 / 10,000 / 25,000 / 50,000 / 100,000 constraints exceeded the five-second solve budget. A [separate longer run](benchmarks/2026-09-26-wasm-baseline/long-budget/RESULTS.md) converged at 1,000 constraints in **11.058 seconds**, with 70 outer iterations and **10.921 seconds in linear solving**. All 333 panels moved. Its normalized residual L2 was `9.59e-4`; maximum deviation from the exact anchored solution was **0.663 model units**, illustrating the accuracy caveat below. This longer run is one sample, not a median.

In the separate 5,000-constraint CPU profile, clock reads accounted for about **71.6%** of sampled self time. Other diagnostics measured **3.697 seconds** for a 10,000-parameter root edit, **0.985 seconds** for a bridge graph update at 5,000 constraints, and **1.142 seconds** for presentation-only application of 1,000 line entities. These measurements support a native numerical experiment while keeping graph, expressions and presentation visible as separate costs.

## What this checkout actually does

The normal application chooses analytical block mode through `solverJacobianModeFromEnvironment`. Calling `solveLevenbergMarquardt` directly without specifying the mode instead defaults to a dense numerical Jacobian. The new scale harness explicitly uses the production application's block mode.

| Owner | Current behavior | Native experiment boundary |
| --- | --- | --- |
| `SolverModel` | Geometry bindings, variable objects, feature access, constraints, Stack coordinate views | Compile supported geometry to persistent Float64 arrays in the Worker. Retain stable JS document IDs and native handle maps. |
| `ParameterRepository` | Expressions, units, scoped names, computed dimensions, dependency edges, dirty evaluation | Keep parser and semantic validation in JS initially. Evaluate mutations in the Worker and send bulk numeric target updates. Parameter evaluation is independently slow, so this is an explicit remaining cost. |
| `ConstraintGraph` | Dependency/component lookup and incremental structural updates | Keep JS ownership first. Compile stable sparse incidence per topology revision; do not invoke structural graph maintenance for a numeric target edit. |
| `ConstraintRegistry`, `AnalyticalJacobians` | Residual families, analytic derivative blocks and local central-difference fallback | Port a representative common subset together with its residuals, scaling and derivatives. Unsupported components stay entirely on the JS reference backend. |
| `JacobianBlocks` | Small constraint matrices; sparse matrix-vector operators; dense assembly below the threshold | First numerical hot path: packed sparse topology, in-place values, matrix-vector products, reusable entity preconditioner storage. |
| `NumericSolverCore` | LM acceptance/damping; PCG or Gaussian elimination; cancellation; rollback | Port the complete supported component's nonlinear and linear loops. Keep accepted, trial, initial and scratch vectors resident. |
| `CompiledConstraintSystem` | Sparse elimination used for arc systems; bounded symbolic cache | Preserve this algorithm where applicable; compare PCG first on the measured line corpus. Do not silently replace it with an unrelated solver. |
| `ArcSolveGeometry`, `ComponentSolver` | Arc reduction, temporary translation gauges, transactions | Preserve branch and gauge semantics. They are correctness requirements, not optional conditioning tricks. |
| Worker protocol/client/runtime/facade/journal | Persistent controller, ordered mutations, drag coalescing, shadow/replica paths, recovery | Reuse commands and journal IDs. Add a backend session and a revision contract covering all mutations, while keeping rendering/document history in JS. |
| Canvas, tools, selection, panels, documents | Application and presentation | Remain JavaScript. Measure geometry application separately. |

Large line components already avoid a global dense matrix. Final mode switches to matrix-free blocks at 192 active variables, interactive mode at 48. PCG uses entity blocks, a `1e-9` relative linear tolerance, at most 1,000 inner iterations, and damping `lambda * max(abs(diagonal), 1) + 1e-7`.

The current compiled sparse path is restricted to components containing arcs and at most 2,048 variables, 65,536 factor entries and 2,000,000 symbolic work units. Its topology cache holds eight entries; numeric workspaces belong to a solve. The earlier September audit predates parts of this implementation and cannot substitute for this baseline.

`StackPlacementSolver` still explicitly requests dense mode. Global-coordinate and derived-feature constraints can use numerical derivative fallback. The baseline line fixtures do not characterize these paths. They must not be routed through an incomplete native implementation.

## Findings that determine the first native experiment

1. **Sparse linear work is the dominant timed phase in the difficult connected fixture.** In the CPU profile, repeated `performance.now()` calls account for much of the sampled work. `createMatrixFreeJacobian` calls the cancellation predicate for each block in each `Jv` and `Jᵀv`; that predicate reads the clock even when the numeric solve has an infinite time budget. A native port that calls back to JavaScript at this frequency would retain a major cost.
2. **The numerical algorithm also matters.** The entity preconditioner does not capture coupling over a long chain. The fixed damping floor and residual scaling remain relevant even when a matrix-vector product becomes faster. Timeouts are preserved in the results. A native backend must be compared at identical tolerances and accepted geometry, not only at a fixed runtime.
3. **There is repeated allocation and structural work.** Block contracts are rebuilt for each solve; sparse operators, local value arrays, column-index arrays, preconditioners and PCG scratch are recreated during outer iterations. The allocation profile measures allocation volume separately from retained heap. Persistent packed memory should remove this repeated setup without changing equations.
4. **A fast numerical kernel will not fix expression evaluation.** `symbolDefinitions()` traverses the parameter repository for each dirty expression; evaluation also constructs a symbol key per expression. The chain benchmark shows the resulting growth. Cache symbol tables by namespace revision before considering a port of the full expression language.
5. **Structural graph changes are a separate bottleneck.** `rebuildComponentsForVariables` repeatedly scans a previous component's variable set. The bridge benchmark isolates this cost. Native numerical values cannot accelerate work that remains in this JS graph traversal.
6. **Residual success can differ from whole-chain coordinate accuracy.** At the default normalized L2 tolerance, the first-panel-only edit can pass while distant panels have not translated. The harness records closed-form coordinate error and moved fraction, and includes stricter diagnostic runs. Preserve the current acceptance contract during parity work and explicitly evaluate any future accuracy change.
7. **Transport and rendering must remain separate measurements.** Full object snapshots have substantially more data than coordinate deltas. The echo benchmark measures both, without calling that difference a solver speedup. Production canvas application is timed separately and can itself take longer than a frame.

There is also a diagnostic limitation: cancellation returns a copied timing object before the interrupted Jacobian/linear phase's `finally` records its duration. The reported phase times for cancelled samples can therefore omit the final interrupted phase. External elapsed times and CPU profiles include it. The report calls out this gap rather than treating it as measured nonlinear overhead. Production diagnostics were not modified for the baseline.

## Persistent storage contract to prototype

Begin with lines and explicit points plus Horizontal, Vertical, Coincident, Distance, axis distances and existing Fixed-variable semantics. Every supported component must use the original residual normalization, target units, analytical derivatives, damping, convergence and rollback rules. Add circles/radius, then arcs/intrinsic equations and branch-sensitive constraints only after the initial parity corpus passes.

Use a per-session arena with capacity growth at structural mutation boundaries:

- Float64 variable values, last accepted values, trial values and transaction baseline.
- Stable geometry handles, type/offset arrays and compact feature references.
- Constraint kind, enabled mask, target slot and reference ranges.
- Sparse row offsets/column indices; maintain separate topology and numeric revision counters.
- Residual and Jacobian value buffers, normal diagonal, small preconditioner blocks, PCG vectors and nonlinear scratch.
- Dirty target/geometry flags and changed-variable/entity output lists.

Column topology must conservatively include derivatives that happen to be zero at the current coordinates. Do not derive persistent topology from the numerical-nonzero count in the report. A branch-dependent residual count, fixed-variable change, enable/disable, arc reduction or reference change may require topology invalidation even if the document has the same number of entities.

Numeric dimension edits reuse topology and start from the last accepted coordinates. Structural edits rebuild only affected components. Preallocate/geometrically grow output buffers; copy coordinates into transferable output buffers rather than transferring the live WASM heap. Recreate JS typed views when WASM memory grows because old views can be detached. [MDN memory-growth semantics](https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow)

### Adapt the existing command surface

| Requested operation | Existing application operation |
| --- | --- |
| Add point/line/arc/circle | `add-entity` with the existing entity shape |
| Delete geometry | `remove-entity` and existing dependent-constraint transaction |
| Add/delete constraint | `add-constraint` / `remove-constraint` |
| Set dimension | `set-dimension` with expression parsing/unit evaluation in `ParameterRepository` |
| Set parameter/expression | `update-parameter` / existing dimension update |
| Move point | `update-entities` through existing feature/geometry mapping |
| Begin/update/end drag | Existing facade `beginDrag`, `drag-update` with locked variables, final `solve`/lock release |
| Enable/disable constraint | Adapt controller constraint/dimension activation; the current Worker protocol does not expose a general standalone constraint-enable command |

A drawing mutation must be validated and committed transactionally in one authoritative Worker session. Currently, `loadSketch`, ordinary `addConstraint`, some entity updates and constraint batches still do synchronous local work and then synchronize the Worker. Merely loading WASM into `SolverWorker` would leave these paths on the UI thread.

### Cancellation without initial multithreading

A synchronous WASM call blocks its Worker's message loop. Increasing generation numbers in queued messages does not interrupt that call. The current JS Worker has this limitation too, despite suppressing stale drag responses.

Use a native resumable `advance` operation that runs a bounded chunk of the **native** nonlinear/linear state machine. It owns iteration state, rejection handling and scratch; JavaScript does not evaluate residuals or implement the nonlinear loop. At chunk boundaries, yield the Worker event loop, apply/coalesce pending revisions and resume the newest transaction. Long PCG work also needs internal checkpoints so one nonlinear iteration cannot defeat the latency bound. Avoid a JS callback per block or derivative; sample deadlines at bounded intervals.

Return `{sessionId, topologyRevision, inputRevision, status, changedGeometry}`. Use a monotonic model revision for **every** mutation, separate from request tokens and the existing drag generation. Reject stale results before replica/render/history application. Coalesce numeric edits safely; preserve ordering and dependencies for structural transactions. Release temporary gauges/drag locks on every exit path. A converged session has no active pump/timer and consumes no solver CPU until another mutation.

Interactive mode may produce bounded previews using the current policy. End-drag/final/export must use the normal final acceptance policy and retain the transaction baseline until success. Cancellation and invalid/overconstrained final solves must not commit intermediate geometry or reset to default coordinates.

## Toolchain and deployment

No `emcc`, `clang++`, or `cmake` command was found on PATH during inspection. No compiler was installed and no Python was used. The intended build is a pinned Emscripten developer/CI toolchain producing versioned JS loader and `.wasm` assets bundled by Vite. Users would download those static assets with the application and install nothing. The current `build` and `build:pages` workflows are unchanged; WASM build integration is a later stage.

The first build should use Float64, one native thread, and no relaxed/fast-math transformations that alter numerical behavior. Retain the complete JavaScript reference backend and explicit capability checks for unsupported components. Benchmark cold download/compile, initial load, warm edits and structural edits separately.

Deployment inspection found:

- Vite uses `src/assets` as `publicDir`; the normal build uses the Cloudflare and Sites plugins.
- `wrangler.jsonc` serves static assets with SPA routing. `worker/index.js` is a 404 handler and does not configure isolation headers.
- `.github/workflows/pages.yml` also publishes a static `dist-pages` build at `/ParaMagic/`.
- No COOP/COEP header configuration was found. The benchmark page reports `crossOriginIsolated: false` and no `SharedArrayBuffer`.

The single-thread Worker experiment does not need shared memory or isolation headers. If profiling later justifies native threads, Emscripten requires shared memory and browser cross-origin isolation. Use a separate threaded artifact and retain the single-thread fallback. [Emscripten pthread requirements](https://emscripten.org/docs/porting/pthreads)

For the Cloudflare static-assets route, the required opt-in can be expressed in `src/assets/_headers` (copied to the built asset root):

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

Configure the same headers in Vite's `server.headers` and `preview.headers` for local threaded tests. Cloudflare `_headers` applies to static-asset responses; Worker-generated responses need their own headers. Cross-origin image/font/script resources must satisfy CORS/CORP for this embedder policy. The current GitHub Pages workflow contains no response-header mechanism; threaded capability there remains unconfirmed until actual deployed response headers and `crossOriginIsolated` are verified. No deployment changes were made. [Cloudflare static-asset header configuration](https://developers.cloudflare.com/workers/static-assets/headers/)

## Correctness and promotion gates

The existing JS solver is the behavior oracle. The five new fixture tests establish exact counts/connectivity, closed-form propagation on a short strictly solved chain, repeated warm edits, cancelled-final rollback and analytical derivative checks against central differences. Existing solver/graph/parameter/Worker suites remain the broader reference corpus.

For the native comparison, begin with Float64 absolute-plus-relative coordinate comparison (`1e-7 + 1e-9 * magnitude`) on uniquely determined fixtures; parameter values (`1e-10 + 1e-10 * magnitude`); residual-vector difference (`1e-9 + 1e-7 * magnitude`); and the **same production final acceptance threshold** for both backends. These are proposed comparison gates, not newly imposed application tolerances. Calibrate separately for normalized versus physical-unit residual families and branch boundaries, recording any justified adjustment.

Underconstrained models require matched deterministic gauges/locks and satisfaction checks; multiple valid configurations cannot be dismissed solely because coordinates differ. Include overconstrained, redundant, degenerate, free-floating, disabled, expression-dependent, repeated-edit, rejected-edit and large connected cases. Extend to curves, tangent branches, derived features, global Stack relationships and actual saved drawings before declaring full solver coverage. The current numerical acceptance does not by itself guarantee global coordinate accuracy in long systems.

Promotion also requires rendered end-to-end validation of dimension changes, drag previews, final drag convergence, stale-revision suppression, failed-edit rollback, load, undo/redo and save/reload. Test session reuse/topology revision stability across numeric edits, scratch capacity reuse, idle CPU, Worker failure recovery and memory growth. This baseline does not establish those native acceptance criteria.

## Reproduce

Validation recorded for this change: all **1,159 repository tests passed**, including the five new benchmark-fixture tests; `npm run build` passed. The full browser harness reported no errors, and result consistency checks verified every requested scale, successful Worker cases, and zero solver calls during timed presentation. Rendered line grids were inspected from the saved screenshots. Logs: [tests](benchmarks/2026-09-26-wasm-baseline/tests.txt), [production build](benchmarks/2026-09-26-wasm-baseline/build.txt). These checks validate the baseline infrastructure, not the unimplemented WASM backend or full native user workflows.

```powershell
npm run benchmark:solver:browser
node scripts/solver-baseline/summarize.mjs
node --test src/tests/solverBaseline.test.js
```

The browser runner uses the installed Chrome or Edge executable, Node's built-in WebSocket, and the project's Vite dependency. It starts a localhost server and a temporary browser profile, then closes both. Set `CHROME_PATH` or pass `--browser=...` if browser discovery fails. No browser automation package or end-user dependency is added.

Useful shorter runs:

```powershell
npm run benchmark:solver:browser -- --counts=1000,5000 --samples=1 --auxiliary=false --profile-count=0 --output=tmp/solver-short
npm run benchmark:solver:browser -- --worker-only=true --output=tmp/solver-worker
npm run benchmark:solver:browser -- --render-only=true --render-counts=333 --output=tmp/solver-render
```

Raw CPU/heap profiles can be inspected in Chrome DevTools. Headline timings use separate unprofiled runs. Auxiliary phase/graph/parameter/transport/render timings are single diagnostic samples; repeat them before making tight latency claims. Browser headless results on this machine do not establish foreground/mobile performance. JSON report fields for WASM time and speedup intentionally remain null.
