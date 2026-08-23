# ParaMagic Large-Drawing Performance Upgrade Plan

## Objective

Make ParaMagic remain responsive and solve predictably when a drawing contains thousands of parameters, entities, dimensions, and geometric constraints.

The primary workload is a value change that propagates through most or all of a large drawing. Large drawings may still contain separable constraint components, but locality cannot be assumed: a parameter, dimension, or control commonly changes many components in one operation. The numerical path must therefore remain practical when thousands of variables participate in one update and when one connected component is itself large.

Small local edits remain an optimization opportunity, not the basis of the scaling architecture.

Correctness, deterministic save/load behavior, atomic rollback, and existing drawing compatibility are non-negotiable.

## Success criteria

- Pointer input and UI controls stay responsive while a solve is running.
- A bounded drag preview returns within its worker-side budget even when a final global solve requires more work.
- Main-thread processing for a solver result normally remains below 4 ms.
- Parameter evaluation cost is proportional to the changed parameter and its downstream dependents, not the total table size.
- A global value change may solve every affected component without constructing a drawing-wide dense matrix.
- Solver-to-UI messages contain changed records rather than complete drawing snapshots during normal editing.
- Solver topology, variable ordering, block structure, and typed-array workspaces are reused while constraints and entity structure remain unchanged.
- Failed final solves restore the previous accepted geometry and parameter values atomically.
- Existing drawings load without migration loss and produce equivalent solved geometry within tolerance.

## Baseline architecture before this upgrade

The current solver is DOM-independent, which makes worker isolation practical. The primary scaling limitations are:

- `computeJacobian` uses finite differences and evaluates the full residual vector once per active variable per iteration.
- Levenberg-Marquardt assembles dense JavaScript matrices, forms dense normal equations, and uses dense Gaussian elimination.
- Every solve includes all active model variables and all enabled constraints.
- Constraint residual evaluation calls full parameter evaluation, so expressions are repeatedly parsed during Jacobian construction.
- controller operations clone full model snapshots for rollback and emission.
- the canvas applies full solver snapshots and refreshes all derived presentation systems.
- several hot-path lookups scan arrays or reconstruct variable arrays.
- drag requests are frame-throttled, but ongoing solver work is not cancellable or superseded.

## Design principles

- **Measure before optimizing.** Every phase starts and ends with the same repeatable benchmark suite.
- **One authoritative solver model.** After worker migration, the worker owns solver state; the main thread owns presentation state.
- **Mutation commands in, deltas out.** Full snapshots are for load, save, recovery, and occasional history checkpoints.
- **Global propagation is ordinary.** Optimize the full affected system first; use component locality when it genuinely exists.
- **Topology and values are separate.** Structural changes rebuild indexes; value-only changes reuse them.
- **Interactive and final solves have different budgets.** Drag previews favor latency; committed edits favor accuracy.
- **Preserve atomicity.** No failed or stale result may partially update the accepted drawing.
- **Keep ownership boundaries.** Solver work stays in `packages/paramagic-core/src/modules/solver`; canvas changes remain shared orchestration and rendering infrastructure.

## Delivery phases and checklist

### Phase 0 — Baseline, fixtures, and observability

Purpose: establish trustworthy before/after measurements without changing solver behavior.

- [x] Define the performance upgrade plan and acceptance targets.
- [x] Add `npm run benchmark:solver`.
- [x] Add named benchmark profiles: `quick`, `standard`, and `stress`.
- [x] Add a large parameter-dependency-chain fixture.
- [x] Add a disconnected constrained-geometry fixture.
- [x] Add a single connected constraint-chain fixture.
- [x] Add an arc/radius-heavy fixture.
- [x] Measure parameter evaluation, residual evaluation, Jacobian construction, linear solving, total solve time, iterations, and snapshot creation.
- [x] Print machine-readable JSON as well as a human-readable summary.
- [x] Record environment metadata: Node version, platform, CPU count, profile, and timestamp.
- [x] Establish a checked-in baseline table from the current implementation.
- [ ] Add regression thresholds only after results are stable across repeated runs.
- [x] Document how to reproduce a benchmark and capture JSON result files.

Exit criteria:

- The suite runs from a clean checkout with one command.
- It reports enough counts and timings to identify whether residuals, Jacobian construction, dense linear algebra, parameters, snapshots, or UI application dominate.
- Benchmark code does not alter production behavior.

### Phase 1 — Hot-path indexes and parameter compilation

Purpose: remove repeated global work before changing solver topology or threading.

#### Stable lookup indexes

- [ ] Add a persistent `variableById` map to `SketchModel`.
- [ ] Maintain cached ordered `allVariables` and `activeVariables` collections.
- [ ] Replace repeated `records.find()` calls in hot canvas paths with `recordById` maps.
- [ ] Index constraints by referenced entity and variable.
- [ ] Index dimensions by anchored record ID.
- [ ] Replace full fixed-variable rescans with fixed-reference counts or dirty fixed sets.
- [ ] Add invariant tests that indexes match authoritative maps after add, remove, load, undo, and curve-point remapping.

#### Compiled parameter graph

- [x] Cache an immutable token stream for each unchanged expression.
- [ ] Compile cached token streams into an immutable AST or bytecode program so grammar traversal is also eliminated.
- [x] Store direct dependency IDs for each parameter.
- [x] Store reverse dependent IDs for invalidation.
- [ ] Detect cycles when dependency edges change.
- [x] Evaluate dirty parameters in dependency order.
- [x] Mark only downstream dependents dirty after an expression or value change.
- [x] Cache evaluated dimensional target scalars once at the start of numerical solving.
- [x] Remove `evaluateAll()` from residual/Jacobian evaluation.
- [ ] Refresh computed driven dimensions only for changed geometry dependencies.
- [ ] Preserve current error messages, unit semantics, boolean/string behavior, and last-valid values.
- [ ] Add tests for wide fan-out, deep chains, cycles, unknown names, renames, and mixed units.

Exit criteria:

- Repeated residual evaluation performs no expression parsing.
- Updating one leaf parameter does not evaluate unrelated parameters.
- Existing parameter and solver tests remain unchanged or gain equivalent assertions.

### Phase 2 — Constraint graph and component-local solving

Purpose: solve only the geometry that can be affected by the current operation.

#### Graph model

- [x] Build a bipartite graph of variable nodes and constraint nodes, with entity ownership retained for scope and delta reporting.
- [x] Include intrinsic entity residual dependencies.
- [x] Include dimension-target dependencies from the parameter graph.
- [x] Include derived fillet/source dependencies and anchor/tangent/meta-constraint references.
- [ ] Include any future external driving target that directly owns solver variables; current external targets intentionally bypass the geometry solver.
- [x] Cache the graph between structural edits and rebuild it lazily after invalidation.
- [x] Incrementally add entity and constraint/dimension edges, merging only touched components.
- [x] Incrementally remove, enable, and disable constraint/dimension edges, splitting only the prior component.
- [x] Incrementally remove entity variables and their deleted constraint edges, recomputing only the prior component.
- [x] Incrementally remap curve/entity variables and derived-feature source dependencies using reverse record indexes.
- [x] Assign deterministic component IDs from stable variable IDs.
- [x] Recompute only components touched by constraint/dimension add, remove, enable, and disable operations.
- [x] Extend touched-component recomputation to entity removal.
- [x] Extend touched-component recomputation to entity and derived-feature remapping.
- [x] Expose graph diagnostics: component count, variable count, residual count, fixed DOF count, and referenced parameter count.

#### Solve-scope selection

- [x] Drag seed: directly manipulated and locked variables.
- [x] Dimension seed: constraints using the changed dimension or a downstream parameter target.
- [x] Parameter seed: affected driving dimensions after dependency propagation.
- [x] Constraint-add seed: variables referenced by the new constraint.
- [x] Constraint-remove seed: the previous component, followed by newly separated components if validation is required.
- [x] Geometry-edit seed: variables belonging to edited entities.
- [x] Provide an explicit full-solve diagnostic command/API.
- [x] Snapshot and restore only candidate components for drag/geometry-edit rollback while preserving atomicity.
- [x] Extend component-only rollback to dimension continuation and parameter-driven transactions.
- [x] Return changed entity IDs from the component, not from the entire model.

Exit criteria:

- Benchmarking one changed object in a large disconnected drawing scales with its component size.
- Local and global solves produce equivalent geometry within tolerance.
- Adding a bridge constraint correctly merges two components; removing it correctly separates them.

### Phase 3 — Worker-owned solver runtime

Purpose: keep the main thread responsive regardless of final solve duration.

#### Worker boundary

- [x] Create `SolverWorkerRuntime` inside `packages/paramagic-core/src/modules/solver`.
- [x] Create a main-thread `SolverWorkerClient` facade matching the controller mutation operations needed by the application.
- [ ] Move authoritative geometry, constraints, dimensions, dependency graphs, and accepted solver state into the worker.
- [x] Support loading a full sketch once and then sending mutation commands through the runtime protocol.
- [x] Integrate a guarded application facade in opt-in shadow mode with synchronous fallback and parity checks.
- [x] Promote drag updates and drag-finalization solves to Worker-authoritative execution behind `?solverWorker=drag`.
- [x] Promote dimension-editor and parameter-table mutations to Worker-authoritative execution behind `?solverWorker=drag`.
- [x] Coalesce high-frequency Controls-panel parameter streams and commit their accepted Worker results before history finalization.
- [x] Promote manual and automatic geometric constraint add/remove operations to Worker-authoritative execution.
- [ ] Switch the application orchestration layer from direct controller calls to the worker client.
- [x] Keep serialization, storage, and UI presentation on the main thread.
- [x] Define versioned worker messages and validate command-specific payloads.
- [x] Preserve the synchronous controller path for unit tests and fallback diagnostics.

Proposed command envelope:

```js
{
  version: 1,
  requestId: 42,
  generation: 108,
  type: 'drag-update',
  payload: { entities: [], lockedVariableIds: [] }
}
```

Proposed result envelope:

```js
{
  version: 1,
  requestId: 42,
  generation: 108,
  status: 'converged',
  changedEntities: [],
  changedDimensions: [],
  changedParameters: [],
  changedConstraints: [],
  removedConstraintIds: [],
  diagnostics: { componentId: 'component-7', timings: {} }
}
```

#### Scheduling and cancellation

- [x] Give every interactive request a monotonically increasing generation.
- [x] Discard stale results on both worker and client sides.
- [x] Coalesce queued drag updates so only the newest pointer state remains.
- [x] Add cooperative cancellation checks between LM iterations and inside dense numerical kernels.
- [ ] If necessary, use a shared atomic cancellation flag after COOP/COEP deployment requirements are understood.
- [x] Keep committed operations ordered and non-droppable.
- [x] Recover shadow-worker failure by recreating it from a revision-stabilized synchronous checkpoint that includes locally committed mutations.
- [x] Retain accepted shadow-worker checkpoints plus a replayable, revisioned committed-command journal.
- [ ] When synchronous mirroring is removed, source periodic accepted checkpoints directly from the authoritative worker.
- [x] Surface queue and round-trip time separately from worker operation duration.

Exit criteria:

- A deliberately slow solve does not block toolbar, pan, zoom, or text input.
- Stale drag results never move geometry backward.
- Worker restart restores the last accepted drawing without data loss.

### Phase 4 — Interactive solve policy and warm starts

Purpose: minimize latency during continuous manipulation.

- [x] Add explicit `interactive` and `final` solve modes.
- [x] Warm-start each solve from the last accepted or last preview solution for that component.
- [x] Give interactive solves an elapsed-time budget in addition to an iteration limit.
- [x] Return the best finite improving preview state when the interactive budget expires only when its combined constraint error remains within the canvas-provided 0.2-pixel presentation limit; otherwise retain the last valid geometry.
- [x] Run strict convergence and continuation only for committed/final operations.
- [x] Avoid history and autosave writes for transient previews.
- [x] Reapply the latest requested drag and run a strict final solve on pointer-up before committing history.
- [x] Preserve last valid geometry when a final solve fails.
- [x] Add hysteresis or damping controls to prevent visible preview jitter.
- [x] Record accepted/rejected steps and cancellation reason for diagnostics.

Exit criteria:

- Dragging remains visually continuous under benchmark load.
- Pointer-up always leaves a strictly solved or atomically restored drawing.

### Phase 5 — Local analytical Jacobians

Purpose: eliminate full residual reevaluation for every active variable.

- [x] Define a residual/Jacobian block contract in `ConstraintRegistry`.
- [x] Map local variable IDs to component-local column indexes.
- [x] Implement analytical derivatives for the common algebraic constraints.
  - [x] Coincident, Horizontal, Vertical, Distance, Radius, Diameter, and Concentric.
  - [x] Parallel, Perpendicular, Equal, Collinear, and Midpoint.
- [x] Implement analytical derivatives for point-on and tangent constraints.
  - [x] Native Point-on Line, Point-on Circle, interior-domain Point-on Arc, and all native Tangent variants.
  - [x] Derived Point-on Fillet dependencies for line, curve, and arc source combinations; retain fallback for branch singularities and arc-domain boundaries.
- [x] Implement intrinsic arc/entity derivative blocks.
- [x] Retain finite differences as a per-constraint fallback during migration.
- [x] Add derivative verification tests comparing analytical blocks to central finite differences.
- [x] Scale derivative comparisons by geometry magnitude and units.
- [x] Report the number of analytical and fallback Jacobian blocks in diagnostics.
- [x] Wire mixed block Jacobians through the application controller and Worker behind an independent rollout switch; initially keep dense mode as the default.
- [x] Preserve the selected Jacobian mode across Worker creation and restart, and expose it with Worker block-usage diagnostics.
- [x] Add serialized mixed-drawing dense/block convergence and geometry-parity coverage.
- [x] Promote block mode to the application default after browser, saved-drawing, and quick/standard/stress benchmark gates; retain explicit dense fallback.

Exit criteria:

- Common constraints do not trigger whole-model finite-difference evaluations.
- Analytical derivatives match numerical checks within defined tolerances.
- Solver convergence is equal to or better than the baseline fixture set.

### Phase 6 — Pure-JavaScript matrix-free global backend

Purpose: make genuinely large connected components practical.

- [x] Keep the existing local Jacobian block contract as the sparse structural representation.
- [x] Apply `J*v` and `J^T*v` directly without expanding a global dense Jacobian.
- [x] Solve damped normal equations with a pure-JavaScript, diagonally preconditioned conjugate-gradient path.
- [x] Keep global vectors, diagonal terms, and iterative workspaces in typed arrays.
- [x] Select the matrix-free backend automatically for large block-mode components while retaining the dense reference backend for small systems.
- [ ] Replace per-iteration local block allocations with cached packed typed-array block storage.
- [ ] Reuse variable ordering, block structure, workspaces, and iterative warm starts while topology is unchanged.
- [ ] Evaluate LSQR/LSMR against PCG on ill-conditioned and rank-deficient sketches without introducing a native or WASM dependency.
- [ ] Add block-Jacobi and geometry-cluster preconditioners.
- [ ] Compile and eliminate exact relationships and procedurally derived geometry before the numerical solve.
- [ ] Add low-dimensional global deformation modes and multilevel correction for drawings dominated by global changes.
- [ ] Add rank/gauge diagnostics for underconstrained components.
- [ ] Preserve LM damping and rollback behavior.
- [ ] Compare sparse results against the dense reference solver in tests.

Exit criteria:

- A connected component with thousands of variables fits within the memory budget.
- Solve memory grows with local derivative entries rather than residual-count times variable-count or variable-count squared.
- Dense and matrix-free implementations agree on the regression corpus.

### Phase 7 — Delta rendering and derived-system invalidation

Purpose: ensure solver improvements are not hidden by whole-canvas update costs.

- [ ] Return changed entity payloads instead of complete geometry snapshots.
- [ ] Update only changed SVG records and handles.
- [ ] Refresh only dimensions anchored to changed records.
- [ ] Refresh only constraint helpers referencing changed records.
- [ ] Add dependency indexes for fillets, notches, seam lines, arrays, symmetric copies, Boolean subtraction, and closed-region topology.
- [ ] Recompute derived systems only when their dependency sets intersect changed IDs.
- [ ] Batch DOM writes into one animation-frame commit.
- [ ] Avoid global `syncState()` and full query-selector passes in drag frames.
- [ ] Consider viewport culling for helpers, handles, labels, and complex derived overlays.
- [ ] Measure solver time and UI-application time separately.

Exit criteria:

- Applying a two-entity delta does not touch unrelated SVG records.
- Main-thread delta application meets the 4 ms target for typical edits.

### Phase 8 — History, autosave, and persistence efficiency

Purpose: prevent non-solver systems from becoming the new bottleneck.

- [ ] Store undoable mutation transactions between periodic full checkpoints.
- [ ] Keep a bounded checkpoint interval and memory budget.
- [ ] Do not create history entries for transient drag previews.
- [ ] Debounce autosave after committed changes.
- [ ] Serialize from the worker only when save/autosave needs a stable checkpoint.
- [ ] Avoid serializing full drawings on every solver emission.
- [ ] Add recovery tests for worker restart, failed saves, and undo across checkpoints.
- [ ] Measure history memory and serialization time in stress fixtures.

Exit criteria:

- Continuous dragging produces one committed history operation.
- Autosave and history work do not block interactive rendering.

## Benchmark matrix

| Scenario | Primary variable | What it exposes |
| --- | ---: | --- |
| Parameter chain | 1k, 5k, 10k parameters | parsing, dependency evaluation, cycle traversal |
| Parameter fan-out | one source with thousands of dependents | invalidation and topological evaluation |
| Disconnected lines | 100, 1k, 10k components | global-versus-local solve cost |
| Connected line chain | 100, 500, 2k entities | component solve and sparse factorization |
| Arc/radius network | 25, 100, 500 arcs | nonlinear conditioning and intrinsic residuals |
| Mixed production fixture | representative real drawing | end-to-end realism |
| Drag stream | 300 updates at 60 Hz | coalescing, cancellation, warm starts, UI deltas |
| Snapshot/history | 1k, 10k, 50k records | cloning, serialization, memory, restore |

Each result should record:

- fixture and profile;
- entity, parameter, variable, constraint, residual, and component counts;
- setup time where relevant;
- parameter evaluation time;
- residual, Jacobian, linear-solve, and total solve timings;
- iteration and accepted/rejected step counts;
- snapshot/delta creation time and payload size;
- worker queue and transfer time after Phase 3;
- UI delta-application time after Phase 7;
- process memory before and after;
- status and final error.

## Correctness and compatibility gates

Every phase must keep these checks green:

- [ ] Full existing unit/integration test suite.
- [ ] JSON save/load round trip.
- [ ] Undo/redo round trip.
- [ ] Legacy drawing fixtures.
- [ ] Failed-solve atomic restoration.
- [ ] Dimension continuation fixtures.
- [ ] Arc semicircle and shallow-radius regressions.
- [ ] Equal, tangent, point-on, fixed, and origin constraints.
- [ ] Derived fillet/notch/array/symmetric dependencies.
- [ ] Deterministic results within tolerance across main-thread and worker paths.

## Rollout strategy

- Keep the dense global solver as a reference/fallback until sparse parity is demonstrated.
- Keep component solving, worker solving, analytical Jacobians, and the matrix-free threshold independently observable and reversible.
- Compare local results against periodic background global validation during development.
- Log component and constraint IDs when local/global results diverge.
- Do not combine worker migration and numerical-method replacement into one release.
- Promote one phase at a time after benchmark improvement and correctness gates are both satisfied.

## Immediate next actions

1. Measure the new matrix-free PCG path on globally changing connected, redundant, and underconstrained drawings.
2. Pack and cache evaluated block storage and iterative workspaces while topology is unchanged.
3. Compare pure-JavaScript LSQR/LSMR with PCG on the same fixtures, including difficult arc and spline systems.
4. Add stronger block/cluster preconditioning, then exact relationship elimination.
5. Add global deformation modes and multilevel correction if iteration counts still grow materially with drawing size.

## Running the benchmarks

Run the repeatable quick baseline:

```powershell
npm run benchmark:solver
```

Select a larger profile or override the sample count:

```powershell
npm run benchmark:solver -- --profile=standard
npm run benchmark:solver -- --profile=stress --samples=1
npm run benchmark:solver -- --profile=quick --graph-count=1000 --samples=5
npm run benchmark:solver -- --profile=standard --drag-only --samples=3
npm run benchmark:solver -- --profile=quick --drag-updates=120
npm run benchmark:solver -- --profile=quick --jacobian-mode=blocks
```

Print machine-readable JSON or save it to an explicitly selected artifact path:

```powershell
npm run benchmark:solver -- --profile=quick --json
npm run benchmark:solver -- --profile=quick --output=benchmark-before.json
```

Keep before/after JSON artifacts from the same machine and profile. Compare each result by benchmark `name`, using `elapsedMs` for end-to-end cost and the residual/Jacobian/linear timing fields to identify which phase changed. Automated threshold comparison will be added only after several runs establish normal variance.

Block Jacobians are the application default after the Phase 5 promotion gates. Use `?solverJacobian=dense` for the immediate reference/fallback path, or set `PARAMAGIC_SOLVER_JACOBIAN_MODE` to `dense` in tests and embedded environments. `?solverWorker=drag` combines Worker-authoritative mutations with the default block assembly; `?solverWorker=drag&solverJacobian=dense` isolates Worker behavior from the numerical-method upgrade.

Worker-authoritative solving is also the application default after user acceptance. Use `?solverWorker=sync` for the immediate main-thread fallback, `?solverWorker=sync&solverJacobian=dense` for the original execution/numerical combination, or `?solverWorker=shadow` for mirrored diagnostic execution. If Worker construction fails, the facade still falls back to synchronous execution automatically.

## Initial baseline

Environment: Windows, Node `v22.20.0`, quick profile, three samples per scenario. Values are medians from the first repeatable run on 2026-07-31 and are diagnostic rather than acceptance thresholds.

| Benchmark | Size | Status | Iterations | Elapsed ms | Jacobian ms | Linear ms |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Parameter chain evaluate | 1,000 parameters | completed | 0 | 2.003 | 0 | 0 |
| Parameter chain root update | 1,000 parameters | completed | 0 | 1.574 | 0 | 0 |
| Disconnected horizontal lines | 30 entities / 120 variables | converged | 3 | 6.093 | 1.614 | 1.687 |
| Connected line chain | 18 entities / 72 variables | converged | 6 | 8.273 | 3.772 | 0.886 |
| Fixed-endpoint arcs | 8 entities / 48 variables | converged | 5 | 3.230 | 2.735 | 0.083 |
| Geometry snapshot | 2,000 entities | completed | 0 | 0.639 | 0 | 0 |

A one-sample standard diagnostic also showed the expected dense growth: 300 variables across 75 disconnected lines required 87.318 ms, while a 180-variable connected chain required 91.727 ms. This confirms that component-local solving is necessary and that dense global work becomes interactive-latency-limited at only a few hundred variables.

### Phase 1 parameter checkpoint

After adding cached token streams plus forward/reverse dependency edges, the quick profile updates one two-parameter branch inside a 1,000-parameter disconnected forest in a median 0.098 ms. Updating the root of a fully connected 1,000-parameter chain still evaluates all downstream values, as required, and took 1.687 ms in the same run. These scenarios intentionally distinguish dirty-subgraph behavior from unavoidable dependency propagation.

### Phase 2 component-solve checkpoint

With 30 disconnected horizontal-line components, the quick benchmark's global dense solve processed 120 variables and took a median 19.399 ms. Selecting one cached graph component processed 4 variables and one residual in 0.075 ms, about 259 times faster for the numerical solve.

The latest nine-sample, 1,000-entity graph-only checkpoint built the complete 4,000-variable graph in 7.801 ms. Adding a bridge constraint and merging its two touched components took 0.075 ms; removing that bridge and splitting the prior component took 0.052 ms. Removing one entity and its indexed constraint edges took 0.041 ms. Inserting and remapping a curve control point took 0.113 ms, while changing a derived feature's source dependency took 0.130 ms. Each structural mutation remained below 2% of the full graph-rebuild cost. Successful dimension and parameter transactions snapshot only their affected dependency branches and geometry components, avoiding full-drawing rollback copies on the ordinary edit path.

### Phase 4 drag-stream checkpoint

The scheduler-level drag benchmark now drives the versioned Worker client and loopback transport, not only the numerical runtime. It records update median/p95/max, Worker duration, queue delay, round-trip delay, estimated transfer/dispatch overhead, payload size, preview and budget-expiration counts, and strict final-solve time. On the one-sample standard fixture of 45 connected lines, 180 variables, 90 constraints, 135 residuals, and 300 absolute pointer updates, update p95 was 10.411 ms, round-trip p95 was 10.391 ms, median queue time was 0.003 ms, and the final solve took 0.250 ms. The 0.2-screen-pixel dependent-geometry deadband leaves directly manipulated geometry unfiltered and the final component-wide delta guarantees replica convergence.

## Progress log

Use this section to record completed slices, benchmark artifacts, important decisions, and the next unchecked task.

- 2026-07-31: Plan created.
- 2026-07-31: Added the Phase 0 benchmark harness, quick/standard/stress profiles, six baseline scenarios, human/JSON output, and the initial quick baseline. The next implementation slice is parameter-evaluation call instrumentation followed by compiled parameter dependency caching.
- 2026-07-31: Completed the first Phase 1 hot-path slice. Numerical solves now sample parameter and dimensional targets once before iteration instead of evaluating the entire repository for every residual call and finite-difference Jacobian column. Added a regression test proving one parameter sampling call per solve.
- 2026-07-31: Added cached immutable expression tokens, direct dependency edges, reverse dependent edges, and dirty-subgraph evaluation. Added lifecycle/regression coverage plus a 1,000-parameter disconnected-forest benchmark. Validation: 438/438 full tests pass, 74/74 focused parameter/solver tests pass, and the production build validates 90 JavaScript files. The next solver-scaling slice is the Phase 2 constraint-component graph and solve-scope selection; full AST/bytecode expression compilation remains an independent Phase 1 follow-up.
- 2026-07-31: Added the Phase 2 bipartite constraint graph, deterministic components, scoped authoritative model views, graph diagnostics, and seeded solve routing for dragging, geometry edits, dimensions, parameter dependents, and constraint addition. Geometry-edit rollback now snapshots only candidate components. Bridge add/remove, intrinsic arcs, derived fillets, local/global behavior, and unrelated-component isolation have regression coverage. Validation: 442/442 full tests pass, the production build validates 92 JavaScript files, and the 30-component benchmark improved from 19.399 ms globally to 0.075 ms locally. The next Phase 2 slice is incremental graph-edge maintenance plus component-only dimension/parameter transaction snapshots.
- 2026-07-31: Added targeted parameter-entry and geometry-component snapshots for dimension continuation and parameter-driven transactions. Constraint/dimension add, remove, enable, and disable now update graph edges and recompute only touched components. A 1,000-entity graph builds in 7.680 ms, adds a bridge in 0.089 ms, and removes/splits it in 0.069 ms. Validation: 444/444 full tests pass and the production build validates 92 JavaScript files. The remaining Phase 2 structural work is incremental entity removal and derived-feature remapping.
- 2026-07-31: Added indexed incremental entity removal, including targeted model-constraint deletion and touched-component graph repair. The nine-sample 1,000-entity benchmark removes an entity in 0.039 ms versus 7.099 ms for a full graph rebuild. Derived-dependent removals still invalidate conservatively. Validation: 445/445 full tests pass and the production build validates 92 JavaScript files. The remaining Phase 2 structural work is entity/derived-feature remapping.
- 2026-07-31: Completed Phase 2 structural graph maintenance. Reverse record indexes now target curve constraints and dimension annotations; reverse source indexes target derived-feature consumers. Curve insertion/deletion, derived source changes, and derived deletion update only touched graph components and are checked against fresh-rebuild component signatures. On 1,000 entities, curve remapping takes 0.113 ms and derived remapping 0.130 ms versus 7.801 ms for a full graph build. Validation: 447/447 full tests pass and the production build validates 92 JavaScript files. The next implementation phase is the worker-owned solver runtime and mutation protocol.
- 2026-07-31: Added the Phase 3 worker foundation: a browser Worker entry, authoritative `SolverWorkerRuntime`, versioned command/result protocol with command-specific payload validation, and a main-thread client scheduler. The client serializes committed mutations, coalesces consecutive queued drag updates, rejects stale generations without applying geometry, and reports queue/round-trip time separately from worker duration. Runtime results use changed-entity deltas; full snapshots are explicit requests. Validation: 452/452 full tests pass and the production build validates 97 JavaScript files. The next slice is application integration behind a synchronous fallback, followed by worker restart recovery and cooperative solver cancellation.
- 2026-07-31: Added guarded application integration through `SolverExecutionFacade`. Synchronous execution remains the default; `?solverWorker=shadow` enables the real browser Worker as a mirrored state owner while preserving immediate synchronous return values. Supported mutations use incremental worker commands, unsupported structural operations coalesce normalized full resynchronizations, drag locks/generations are mirrored, and any transport failure falls back without interrupting local edits. Full snapshot parity, coalesced drag parity, feature gating, and crash fallback have regression coverage. A real-browser development-server check reached `shadow / ready` with no console errors. Validation: 456/456 full tests pass and the production build validates 99 JavaScript files. The next slice is checkpoint-based worker restart recovery, followed by promotion of selected asynchronous paths from shadow to worker-authoritative execution.
- 2026-07-31: Added bounded shadow-worker restart recovery. The facade tracks local mutation and accepted-worker revisions, recreates a failed transport up to two times, and repeatedly reloads the synchronous checkpoint until no mutation occurred during recovery. Successful recovery clears transport/parity errors and resumes mirroring; repeated replacement failure leaves the application on the uninterrupted synchronous fallback. Tests cover a crash with an unaccepted queued edit, checkpoint parity after restart, and the bounded-failure path. Validation: 457/457 full tests pass and the production build validates 99 JavaScript files. The next safety prerequisite for worker-authoritative drag is an accepted checkpoint plus replayable committed-command journal.
- 2026-07-31: Added `SolverMutationJournal` and integrated it into shadow execution/recovery. Every mirrored mutation now has a serializable command payload and monotonic revision. Recovery loads the last accepted checkpoint, replays later commands in order, and continues until it reaches the latest local revision; consecutive unaccepted drag commands coalesce to their newest absolute geometry. Accepted catch-up states periodically become bounded checkpoints and prune older journal entries. Tests cover replay ordering, coalescing boundaries, checkpoint ownership/pruning, and recovery of an edit rejected with the failed transport. Validation: 460/460 full tests pass and the production build validates 101 JavaScript files. The next slice is Worker-authoritative asynchronous drag execution, initially behind a separate opt-in mode.
- 2026-07-31: Added opt-in Worker-authoritative drag execution through `?solverWorker=drag`. Drag previews and final drag solves now run asynchronously in the Worker; stale generations cannot update the local read replica, accepted changed-entity deltas are applied without a second main-thread solve, and transport failure recovers from the command journal before falling back to the synchronous transaction. Directly edited unconstrained entities are included in Worker deltas even when the numerical result is `unchanged`. The synchronous default and shadow mode remain unchanged. A real-browser check reached `worker-drag / ready`. Validation: 462/462 full tests pass and the production build validates 101 JavaScript files. The next Phase 3 slice is cooperative cancellation and explicit interactive/final solve budgets, followed by promotion of additional mutation paths.
- 2026-07-31: Added cooperative numerical cancellation and the first Phase 4 interactive policy. Worker drag previews use a 10 ms elapsed-time budget and 24-iteration ceiling, with deadline checks during Jacobian columns, dense normal-matrix assembly, matrix-vector multiplication, and Gaussian elimination. Budget expiry retains the best finite preview; pointer-up runs an unbudgeted strict final solve. The Worker keeps a component-scoped pre-drag baseline so final failure restores valid geometry atomically. Preview emissions do not trigger autosave or advance recovery checkpoints, while final results report solve mode, accepted/rejected steps, and cancellation reason. Validation: 466/466 full tests pass and the production build validates 101 JavaScript files. The next slice is interactive jitter control and measured drag-stream latency, followed by promotion of additional Worker-authoritative mutations.
- 2026-07-31: Completed the remaining Phase 4 jitter/measurement slice. Worker-authoritative previews apply a 0.2-screen-pixel cumulative deadband only to dependent geometry; directly manipulated entities always update, and final solve responses include every entity in the affected component to eliminate replica drift. The benchmark harness now includes configurable quick/standard/stress drag streams through the actual Worker client scheduler and reports runtime, queue, round-trip, transfer, payload, budget, and finalization metrics. The 300-update standard checkpoint held update and round-trip p95 to 10.411/10.391 ms with 0.003 ms median queue delay. Validation: 468/468 full tests pass and the production build validates 101 JavaScript files. The next slice is promotion of dimension and parameter mutations to guarded Worker-authoritative execution, followed by analytical Jacobian blocks.
- 2026-07-31: Promoted dimension-editor commits and parameter-table edits to guarded Worker-authoritative execution in `?solverWorker=drag` mode. Worker results now return affected parameter-entry deltas as well as geometry, so dependent expression rewrites, evaluated values, and errors synchronize into the main-thread read replica without a second solve. Async UI paths guard against stale row responses, and journal/restart recovery retains the synchronous fallback on transport failure. The Controls panel remains on the synchronous/shadow path until its high-frequency input stream is coalesced. Validation: 471/471 full tests pass and the production build validates 101 JavaScript files. The next Phase 3 slice is coalesced Worker-authoritative Controls-panel updates and promotion of remaining committed constraint mutations; Phase 5 analytical Jacobian blocks follows that boundary work.
- 2026-07-31: Promoted Controls-panel parameter changes to the guarded Worker-authoritative path. The Controls model retains its synchronous default API for isolated tests, while application wiring injects an async updater with a per-parameter coalescing key. The Worker client and mutation journal preserve the in-flight update and only the newest consecutive queued absolute value; unrelated and ordinary parameter mutations remain ordered and non-droppable. Control rows expose pending state, ignore stale completions, synchronize accepted geometry/parameter deltas, and defer final history commits until the latest update settles. Newly created control parameters trigger a structural Worker resync before their first value command. A real-browser smoke test changed a scrollbar from 50 to 75 in `worker-drag / ready`, cleared pending state, and produced no console errors. Validation: 474/474 full tests pass and the production build validates 101 JavaScript files. The next Phase 3 slice is promotion of remaining committed constraint add/remove mutations, followed by Phase 5 analytical Jacobian blocks.
- 2026-07-31: Promoted manual geometric constraints, constraint-helper removals, and drawing-time auto-constraints to guarded Worker-authoritative execution. Constraint IDs are assigned before journaling so restart replay is deterministic. Worker results now carry accepted constraint records and removed IDs alongside solved geometry; the main-thread replica updates its model and incremental constraint graph without another numerical solve. Constraint selection is gated while an add is pending, helper deletion is idempotent across pointer/click events, and auto-constraint history notification waits for all accepted outcomes. Validation: 476/476 full tests pass and the production build validates 101 JavaScript files. The next implementation slice begins Phase 5 by defining the residual/Jacobian block contract and central finite-difference verification harness.
- 2026-07-31: Added the Phase 5 residual/Jacobian block contract. Each enabled constraint and intrinsic entity residual now exposes only its active local variables plus their component-column indexes. Blocks support an optional analytical matrix and otherwise use isolated central finite differences; verification scales absolute and relative error by derivative magnitude and reports exact failing row/column entries. The production solver remains on the dense reference Jacobian until real constraint derivatives pass this verifier. Validation: 481/481 full tests pass and the production build validates 103 JavaScript files. The next slice implements and verifies analytical blocks for Coincident, Horizontal, Vertical, Distance, Radius, Diameter, and Concentric before assembling block matrices in the solver.
- 2026-07-31: Implemented and centrally verified the first analytical Jacobian families: Coincident, Horizontal, Vertical, Distance, Radius, Diameter, and Concentric. Affine point differentiation covers immutable origin references, endpoints, line midpoints, polygon/polyline/curve points, circle cardinal handles, and proportional segment anchors; circle and arc radius derivatives are both supported. Nondifferentiable scale boundaries and generated arc-middle points automatically retain the local finite-difference fallback. Validation: 483/483 full tests pass and the production build validates 104 JavaScript files. The next slice adds Parallel, Perpendicular, Equal, Collinear, and Midpoint, then assembles mixed analytical/fallback blocks into the live solver with usage diagnostics.
- 2026-07-31: Completed analytical derivatives for the common algebraic constraints with Parallel, Perpendicular, Equal, Collinear, and Midpoint. Normalized residual derivatives include their piecewise magnitude scaling; Equal supports segment length, circle radius, and true arc length, including arc-radius and sweep-angle terms. Branch boundaries remain on the numerical fallback. Validation: 484/484 full tests pass and the production build validates 104 JavaScript files. The next slice assembles mixed analytical/fallback blocks into the solver behind an explicit development mode, reports block usage, and compares its convergence against the dense reference path.
- 2026-07-31: Added mixed analytical/fallback block assembly behind `jacobianMode: 'blocks'`; the dense Jacobian remains the application default. Local matrices scatter through component-column indexes, cancellation remains cooperative, row-shape changes fail safely, and solve diagnostics report analytical/fallback block counts. Semicircle projection explicitly retains and reports the dense-reference path. The benchmark accepts `--jacobian-mode=blocks` and reports block usage. On the three-sample quick checkpoint, block Jacobian time improved from 1.488 to 0.347 ms for 30 disconnected lines, 3.602 to 1.201 ms for the connected chain, and 2.050 to 0.563 ms for fixed-endpoint arcs; all cases retained their dense convergence status and iteration count. Validation: 486/486 full tests pass and the production build validates 104 JavaScript files. The next slice implements point-on and tangent analytical blocks plus intrinsic arc derivatives, then broadens dense/block parity coverage before enabling the mode in the application Worker.
- 2026-07-31: Added centrally verified derivatives for native Point-on Line, Point-on Circle, interior-domain Point-on Arc, line/round endpoint tangency, general line/round tangency, internal round/round tangency, external round/round tangency, and intrinsic arc equal-radius residuals. Arc-domain edges, derived fillet geometry, and other nondifferentiable states retain block-local finite differences. Dense/block convergence parity now covers mixed algebraic constraints, point-on-circle, point-on-arc, tangent, and the semicircle dense-reference exception. Avoiding duplicate analytical residual evaluations reduced the connected-chain quick checkpoint to 0.776 ms of Jacobian time; the fixed-endpoint arc fixture now reports 16 analytical and 16 fallback blocks instead of 8/24. Validation: 488/488 full tests pass and the production build validates 104 JavaScript files. The next slice adds a guarded application/Worker opt-in for block mode and expands parity checks across saved drawing fixtures before considering it as the default.
- 2026-08-01: Wired mixed analytical/fallback block Jacobians through the application controller and browser Worker behind the independent `?solverJacobian=blocks` switch; dense remains the default, `?solverWorker=drag&solverJacobian=blocks` combines both guarded upgrades, and Worker restarts preserve the selected mode. Execution state exposes the mode and Worker results include block-usage diagnostics. Added a repository-owned serialized mixed drawing parity regression. A manual `Jazz Test (1).json` perturbation converged in six iterations in both modes, with maximum geometry delta of approximately `1.54e-10`; block mode assembled 61 blocks (51 analytical, 10 fallback) across 91 residual rows. Validation: 492/492 full tests pass, the production build validates 104 JavaScript files, and `git diff --check` reports no whitespace errors. The next Phase 5 slice is the remaining derived Point-on Fillet analytical block, followed by a real-browser Worker/block smoke test and broader saved-drawing parity.
- 2026-08-01: Completed the Phase 5 derivative matrix with derived Point-on Fillet blocks. The selected fillet center is differentiated implicitly from its two offset-source equations, covering every supported line, curve, and arc source pairing without differentiating discontinuous candidate selection. Singular intersections, invalid branch reconstruction, and both arc-domain endpoints retain block-local finite differences. Central verification covers line-line, line-arc, curve-line, curve-curve, and arc-arc fillets; an endpoint fixture proves fallback, and a live fillet solve retains dense/block convergence parity. Validation: 494/494 full tests pass, the production build validates 104 JavaScript files, and `git diff --check` reports no whitespace errors. Phase 5 is functionally complete; the next gate is a real-browser Worker/block smoke test followed by broader saved-drawing benchmarking before any default-mode change.
- 2026-08-01: Passed the combined real-browser gate at `?solverWorker=drag&solverJacobian=blocks`. The application reached `worker-drag / ready` with block mode exposed in the DOM and no console warnings or errors. Dragging a constrained line endpoint completed through the Worker and restored horizontal agreement to approximately `3.4e-9`; geometry creation, undo, and redo retained ready state and a blank solver status. A full page reload recreated the guarded Worker, restored the two-record drawing, and returned to `ready` without console output. Automated tests remain the authoritative transport-failure/restart coverage; an explicit browser fault-injection hook is optional follow-up. The next gate is broader saved-drawing parity plus archived dense/block benchmarks.
- 2026-08-01: Passed the Phase 5 promotion gate and made block Jacobians the application default while retaining `?solverJacobian=dense` as the immediate fallback; direct solver-library construction remains dense by default for reference tests. Added a serialized 12-component arc/derived-fillet drawing whose constrained geometry, convergence status, and iteration count match across dense and block modes. Archived paired quick, standard, and stress JSON results under `docs/benchmarks/2026-08-01-phase5`: every solver fixture retained status and iteration parity, Jacobian time improved by 63.1-97.4% in the measured global fixtures, Worker update p95 did not regress, and total arc-fixture time improved by 14.3-45.1%. At stress size, a 97.4% connected-chain Jacobian reduction improved total time only 0.9%, proving dense assembly/factorization is now the dominant bottleneck. Phase 6 sparse matrix evaluation is next.
- 2026-08-01: User acceptance found no issues in the combined Worker/block application path. Promoted `worker-drag` to the application execution default alongside block Jacobians. `?solverWorker=sync` remains the explicit main-thread fallback, `?solverJacobian=dense` independently selects the reference Jacobian, and combining both switches restores the original synchronous/dense path. Worker construction and bounded restart failure still fall back automatically. The solver-library facade constructor retains its explicit `sync` default so isolated callers and reference tests do not acquire a browser dependency.
- 2026-08-16: Reframed Phase 6 around the actual global-propagation workload and the pure-JavaScript requirement. Added a matrix-free block operator for `J*v` and `J^T*v`, typed-array workspaces, diagonal preconditioning, and a damped PCG solve selected automatically at 192 active variables while preserving the dense block backend below that cutoff. The 480-variable connected stress chain retained eight-iteration convergence and improved from the archived block-dense 1,956.925 ms to 71.008 ms. A 3,998-variable/2,000-constraint connected chain converged in bounded memory in 10.666 seconds; its 1,000-iteration inner solve identifies stronger block/multilevel preconditioning as the next scaling task. The supplied control-slider drawing converged through nine forced matrix-free value jumps, and the rendered Worker workflow settled at 69 with no solver or console errors. Focused validation: 114/114 solver, parameter, Worker, and execution-facade tests pass.
- 2026-08-16: Fixed the rectangle auto-constraint transaction regression found in the supplied drawing. Editable line chains now stage all four rectangle edges and all eight generated Coincident/Horizontal/Vertical constraints in one atomic solve and one Worker resynchronization, rather than four entity commits and eight individually queued authoritative constraint solves. In the rendered fixture, constraint helpers changed from arriving in batches over about 1.9 seconds to appearing atomically with about 0.16 seconds of application work above the browser input baseline. Focused validation: 25/25 auto-constraint, drawing-tool, and execution-facade tests pass.
