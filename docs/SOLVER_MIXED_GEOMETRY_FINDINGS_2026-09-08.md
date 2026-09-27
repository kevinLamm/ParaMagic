# ParaMagic: Ottoman and mixed geometry performance findings

The tests change the priority of the earlier solver recommendation. At modest complexity, most observed latency occurs in the application's update and derived-presentation work. Numerical solving is a second, independently demonstrated scaling problem. A replacement mathematical kernel alone would leave substantial delays in the tested small drawings.

This is an investigation and reproducible benchmark, with production source unchanged at revision `b5d9a6f81765e79d57a2d187e79b44faaa4c954e`. It is not a completed performance upgrade.

## What was tested

The supplied `Rectangle_Ottoman.paramagic` contains 30 source entities, 89 core constraints, 37 parameters, 22 dimension annotations, six Array definitions, nested Array references, a linked copy, and two external Swell constraints. Its rendered object layer had 4,359 SVG descendants and 161 Array placements. The original file was copied locally for testing, never overwritten or published.

The generated fixtures have two, four, and eight separated source regions connected through collinear constraints and driving dimensions. Each region has four tangent corner arcs, four straight boundary segments, two concentric circles tied to a guide line, point-on-line constraints, a live source-based fillet, a dimensioned marker constrained to that fillet, a Swell source and a dimensioned follower constrained to its derived output. Rectangular, circular, and nested Arrays reference those sources; a circular Array's center references a constrained circle, and nested Array spacing depends on the radius control. Arrays remain derivative objects with source/parameter dependencies; the test does not claim that every copied placement is an independently solved entity.

| Source regions | Source entities including live fillets | Core constraints | Live fillets | Array definitions | External Swell constraints |
|---|---:|---:|---:|---:|---:|
| 2 | 32 | 96 | 2 | 6 | 2 |
| 4 | 64 | 194 | 4 | 12 | 4 |
| 8 | 128 | 390 | 8 | 24 | 8 |

No persistent Fixed/origin constraints were added to these mixed fixtures. The numerical comparison also covers 16 regions and equivalent geometrically disconnected regions sharing the same control parameters.

## Browser results

These are local development-build observations on this Windows machine in the Codex in-app Chromium browser, using the production application with test-only timing wrappers. A fixture loads the drawing through the canvas document loader and exercises the actual rendered control handlers. Drag tests use real browser pointer actions. Creation uses the public canvas creation operation with automatic Concentric detection and checks the resulting rendered object. They are not production p95 measurements or cross-browser performance guarantees.

"Settled" measures from the action until four consecutive animation frames without a tracked worker request, queued worker work, restart, or pending control indicator. It includes follow-up work and an idle-frame allowance; a no-op baseline was 27.6 ms. It is not an input-to-first-paint metric. The initial worker column measures the first parameter command, not every subsequent worker operation. Method timings are inclusive and must not be added together as exclusive costs. Startup measurements are variable and not used to establish steady-state performance.

| Operation | Full app settling time | Initial worker command |
|---|---:|---:|
| Ottoman Width, 88 → 88.5 → 88 | 3.94–3.95 s | 256–258 ms |
| Ottoman Depth, 53 → 53.5 → 53 | 3.90–4.18 s | 68–84 ms |
| Ottoman Diamond Width, 9 → 9.5 → 9 | 7.39–7.58 s | 3.45–3.70 s |
| Ottoman Height, repeated focused test | 3.39–3.46 s | About 0.1 s |
| Mixed 2 regions, width/radius changes | 2.16–2.85 s | 28–30 ms |
| Mixed 4 regions, width/radius changes | 14.26–14.66 s | 46–79 ms |
| Mixed 8 regions, load | 22.43 s | Multiple load/synchronization commands |
| Mixed 8 regions, first width edit | **Failed the 90-second settling limit** | Detailed failed-edit timing was not retained in the first harness version |

The eight-region run stopped at that failure; its remaining width/radius edits are unconfirmed. The timeout is not a claim of 90 seconds spent in numerical solving. The harness now preserves timeout diagnostics before stopping further edits.

Removing Arrays from a test copy reduced the Ottoman Diamond Width changes to 4.67–4.75 s. Disabling Swell definitions and their two external constraints reduced Height changes to 1.87–1.94 s. These are feature-removal comparisons, not equivalent drawings or clean estimates of each feature's isolated cost; JIT warm-up and changed workload also affect them.

An actual Ottoman source-edge drag took 5.51 s through settling, including pointer motion. Its six worker previews took about 12–13 ms each; the final worker solve took 181 ms. Undo took 4.28 s and Redo 2.75 s. Geometry matched the saved pre-drag state to `2.3e-13` on Undo and exactly on Redo. Serialization/reload retained 30 entities and 89 constraints and finite rendered geometry.

The final two-region workflow checks confirmed that both live fillets remained valid; both external Swell relationships resolved and their point-to-derived-line errors stayed below `5e-16` after width/radius changes. Adding a new circle created one automatic Concentric constraint and a rendered object in 625 ms. A real pointer drag took 4.66 s through settling; Undo/Redo restored geometry within `1.2e-14`. Save/reload preserved the resulting 33 entities, 97 core constraints, Array definitions and Swell relationships. **The subsequent whole-worker snapshot comparison failed**, although core residuals and the checked Swell relationships remained satisfied. The exact divergent field is not isolated; the comparator normalizes numbers to 12 significant digits and checks the entire snapshot. This consistency criterion is unresolved. These measurements do not establish complete correctness for the mixed workflow or the failed eight-region sequence.

## What the code and traces establish

1. **One edit generates broad repeated work.** A focused Ottoman Height edit requested 263 solver snapshots, 270 processing drawing snapshots, and 1,031 derived-presentation lookups. Applying the solver snapshot alone took 713–752 ms, notifying object changes 403–406 ms, and two derived-feature notifications about 220–223 ms. These inclusive measurements identify expensive paths without claiming a complete exclusive CPU profile.
2. **Arrays rebuild presentation and use DOM geometry as an input.** [ArrayTools.js](<C:/Apps/ParaMagic - Experiment/packages/paramagic-core/src/modules/ArrayTools.js:1341>) removes every Array group and renders definitions again. Its [sourceBounds](<C:/Apps/ParaMagic - Experiment/packages/paramagic-core/src/modules/ArrayTools.js:1752>) clones nodes into the live SVG, reads `getBBox()`, then removes the temporary group. That creates repeated layout-dependent work as definitions and dependencies grow.
3. **Swell rendering can initiate geometry mutations.** [SwellTools.js](<C:/Apps/ParaMagic - Experiment/packages/paramagic-core/src/modules/SwellTools.js:914>) rebuilds derived output, applies external constraints by positioning source points, then announces derived-feature changes. Those announcements refresh additional systems in [infiniteCanvas.js](<C:/Apps/ParaMagic - Experiment/packages/paramagic-core/src/modules/infiniteCanvas.js:4718>). This couples rendering, dependency evaluation, and solver synchronization.
4. **Full synchronization repeats after small changes.** Control completion calls a full snapshot application and object-change notification in [CanvasUIControls.js](<C:/Apps/ParaMagic - Experiment/packages/paramagic-core/src/modules/CanvasUIControls.js:1190>). Traces show repeated worker `load-sketch` commands after a single parameter edit. [SolverExecutionFacade.js](<C:/Apps/ParaMagic - Experiment/packages/paramagic-core/src/modules/solver/SolverExecutionFacade.js:282>) serializes the whole controller state for a resynchronization.
5. **Numerical continuation is material in some small cases.** Each measured Ottoman Diamond Width edit invoked 14 continuation solves, totaling about 363–364 outer iterations. The controller's [parameter continuation policy](<C:/Apps/ParaMagic - Experiment/packages/paramagic-core/src/modules/solver/SolverController.js:2603>) therefore deserves its own profiling and branch-preservation benchmarks.

A transient worker/local delta mismatch was reported for the Ottoman's Swell-constrained line during updates. An explicit whole-worker consistency check after settling passed. This is evidence to improve versioned synchronization and diagnostics, not proof that the settled drawing is corrupt.

The final mixed snapshot comparison, in contrast, remained unmatched after settling. Preserve this reproduction as a consistency regression gate during the update-architecture work; do not infer a specific geometric failure from a whole-snapshot mismatch alone.

## Numerical scaling remains a separate issue

The production controller was tested without rendering or external Swell follow-up, with live fillet residuals included. Each case uses three fresh fixtures; each fixture changes width out/back, changes radius out/back, and adds a circle with a point-on-line constraint. All 120 measured operations converged. The 96 parameter edits committed their requested values. Maximum residual across operations was `6.89e-4`; the largest recorded squared residual sum for parameter edits was `9.31e-7`, within the existing `1e-3` norm tolerance.

| Regions | Scalar variables before temporary locks | Connected width change, median | Geometrically separate width change, median |
|---|---:|---:|---:|
| 2 | 132 | 47.8 ms | 22.4 ms |
| 4 | 264 | 64.2 ms | 36.2 ms |
| 8 | 528 | 313.7 ms | 65.9 ms |
| 16 | 1,056 | 3,755.4 ms | 133.2 ms |

These numbers isolate the core/controller cost and do not substitute for rendered results. The original chain benchmark's numerical concerns still apply; the mixed model establishes that geometric connectivity changes solver scaling too.

## Revised upgrade order

1. **Make an edit a coherent transaction.** Compute parameter changes, affected geometry, dependent geometry, validation, and history as one versioned operation. Send a consolidated change set to a persistent worker and commit one validated result. Preserve stable IDs and use full snapshots for checkpoints/recovery rather than routine propagation.
2. **Make derived geometry a model dependency.** Track source entities, dimensions, fillets, Swell, Arrays, and their downstream references explicitly. Evaluate dirty dependencies in order. Represent relationships to derived geometry in the transaction; resolve any feedback within a bounded solve/evaluation process. Rendering should consume committed geometry without moving source points. This is the most urgent architectural change suggested by the modest-complexity tests.
3. **Retain and update presentation incrementally.** Cache source geometry, bounds, and Array templates by revision. Update changed SVG nodes and transforms, and use shared instances where compatible with interaction/export semantics. Avoid live DOM insertion and layout reads to calculate ordinary model bounds. Measure before deciding whether Canvas/WebGL is needed for larger presentation workloads.
4. **Then compare numerical backends behind a stable interface.** Reduce exact linear relationships and reuse graph/sparse workspaces. Benchmark a stronger sparse kernel compiled to WebAssembly against the reduced JavaScript implementation and an available geometric kernel such as D-Cubed 2D DCM for WebAssembly. Evaluate total edit latency, correctness, branch stability, deployment, and licensing. The earlier review contains primary-source references for these options; none has yet been benchmarked inside ParaMagic.

All four changes can retain a browser application. The tests provide no reason to require a desktop conversion. They also do not establish which replacement kernel will win before implementation and like-for-like measurements.

The release gate should use the Ottoman plus these mixed fixtures for rendered parameter edits, dragging, constraint creation, Undo/Redo, and save/reload. Preserve accuracy, free-floating components, derived references, stable identity, and exports while measuring update counts and end-to-end latency. Initial performance targets should be set on named hardware/browser configurations; speedups are unproven until that gate passes.

## Continuous dragging under the proposed architecture

One coordinated update does not mean delaying geometry updates until mouse release. A drag is a stream of preview targets followed by one committed edit. Keep the newest pointer target, allow at most one preview computation in flight with one replaceable pending target, and discard obsolete results by revision. Preview work gets a bounded compute budget; update affected derived geometry and presentation together from the accepted preview. The UI can paint while the worker computes. A 60 Hz display has about 16.7 ms per frame, so large models must be measured against that budget instead of assuming every raw pointer event can afford a full solve.

On release, run the accurate final solve for the latest target, validate dependent relationships, commit one coherent geometry version, and create one Undo entry for the gesture. If final validation fails, restore the last valid committed state and report the failure through the existing interaction semantics. This preserves continuous feedback and final accuracy. ParaMagic already has interactive solve budgets and request coalescing; the upgrade must extend that discipline through derived geometry and rendering, where the tests show extensive repeated work.

## Reproduction and evidence

Files are in [the audit directory](<C:/Apps/ParaMagic - Experiment/docs/benchmarks/2026-09-08-mixed-solver-audit>):

- `generate-mixed.mjs` creates the three standalone `.paramagic` fixtures.
- `mixed-numerical.mjs` runs the 120 numerical operations; `mixed-numerical.json` and the per-case JSON files contain raw results.
- `browser.html`, `browser.mjs`, `worker.mjs`, and `instrumentation.mjs` instrument the production app without editing it.
- `original-browser.json` contains the initial Ottoman/control/Array-removal measurements; `mixed-browser-stage1.json` contains Swell-removal and mixed scaling measurements including the stress failure; `mixed-browser-stage2.json` contains the focused Ottoman profiling, pointer/history, consistency, and reload checks. `mixed-browser.json` contains the final mixed correctness/workflow checks.
- `collector.mjs` is a loopback-only result sink, not an application service.

The focused existing regression run passed **209 tests** across solver core, graph, worker/facade, fillet, Array, Swell, identity, and auto-constraint modules. Its output is `regression-tests.txt`. That unit-level success does not override the browser timeout or mixed snapshot mismatch.

To repeat locally, start `npm run dev -- --host 127.0.0.1 --port 5187 --strictPort`, start `node docs/benchmarks/2026-09-08-mixed-solver-audit/collector.mjs`, and open `/docs/benchmarks/2026-09-08-mixed-solver-audit/browser` on that local server. Run one scenario at a time and archive results before a page reload. The first saved eight-region failure predates timeout-row preservation, so its error is retained separately from successful measurements.

The supplied drawing's original and copied SHA-256 hashes match: `4288E0A6007A51DD4789FBE2F32F0F53A44134B916138DBC8A2D952056BC5105`. The screenshot records an actual rendered test state. Mixed drawings were also inspected in the live application.

![Ottoman after the rendered workflow checks](<C:/Apps/ParaMagic - Experiment/docs/benchmarks/2026-09-08-mixed-solver-audit/ottoman.png>)
