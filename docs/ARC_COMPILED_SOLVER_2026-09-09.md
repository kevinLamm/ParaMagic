# Compiled elimination for arc-containing constraint networks

The app now compiles the connectivity of an arc-containing constraint component into a sparse elimination program. Local constraint derivatives are assembled into the program's storage slots, the remaining coupled equations are factored, and eliminated coordinates are recovered by back-substitution. The engine checks its answer against the original Jacobian operator and can refine it through the same factors.

This replaces the expensive iterative linear backend for eligible arc-containing components. The outer nonlinear solver still checks and corrects the actual geometric constraints. Sparse LDLᵀ elimination and minimum-degree ordering are established numerical methods; the change is a new compiled execution architecture in this app, not a claim of newly invented mathematics.

## Why this approach

Profiling the supplied Ottoman found the linear solve dominating cost. A half-inch c1 edit spent approximately 430 ms there; the first compiled run spent 16 ms. A half-inch c2 edit spent approximately 1,567 ms there, versus 28 ms with compiled elimination. The previous iterative backend frequently needed several hundred linear iterations for a single nonlinear correction.

The drawing contains profiles that retain legitimate internal freedom. The engine therefore eliminates coordinates algebraically while retaining every equation and freedom, rather than declaring all connected arcs rigid. The existing semicircle handling remains in place. Arc coordinates, constraints, and drawing serialization keep their existing representation.

## Implementation

- `packages/paramagic-core/src/modules/solver/CompiledConstraintSystem.js` owns topology compilation, sparse numeric assembly, factorization, back-substitution, residual verification and refinement.
- A bounded cache retains eight connectivity plans across corrections and parameter updates. Numeric workspaces belong to individual solves. Changed connectivity, column ordering or block counts produce a different plan.
- `JacobianBlocks.js` exposes its already evaluated local blocks to the compiler; a full rectangular Jacobian is not required.
- `NumericSolverCore.js` selects compiled elimination for arc-containing components that reach the existing matrix-free threshold. Nonlinear damping, convergence tolerance, failure rollback and cancellation remain authoritative.
- `ComponentSolver.js` reports the chosen linear backend and factor storage in diagnostics.
- `SolverController.js` gives the direct parameter attempt the same 200-iteration correction budget as continuation when a continuation route exists. A difficult initial guess therefore changes strategy before exhausting the general 2,000-iteration budget. All accepted corrections still satisfy the original tolerance.
- No feature behavior was added to `infiniteCanvas.js`. No persistent locks, fixed constraints, or origin relationships are introduced.

Compilation has explicit work and storage budgets: at most 2,048 variables, 65,536 factor entries and 2,000,000 counted symbolic operations. Components outside these budgets use the existing iterative backend. These are backend selection limits, not drawing-size restrictions. Cancellation is checked while compiling, assembling, factoring and verifying.

## Complete browser results

The existing eight-case browser runner loaded a fresh copy of the supplied drawing, committed each Controls edit, waited until the update completed and two animation frames rendered, then checked Undo, Redo, Save/download and Open. The table compares the previously recorded complete workflow timings with this run. Values are representative measurements, not worst-case guarantees.

| Control edit | Previous visible update | Compiled visible update |
| --- | ---: | ---: |
| c1: 70 → 70.5 | 1.98 s | 1.99 s |
| c1: 70 → 69.5 | 1.96 s | 2.06 s |
| c2: 36.5 → 37 | 3.29 s | 1.92 s |
| c2: 36.5 → 36 | 1.57 s | 1.79 s |
| c1: 70 → 74 | 2.46 s | 2.19 s |
| c1: 70 → 90 | 7.05 s | 2.50 s |
| c1: 70 → 50 | 4.75 s | 1.72 s |
| c2: 36.5 → 40 | 10.92 s | 2.28 s |

All eight saved outputs were checked without solving again: the complete enabled residual norm was below 1e-8, including tangency. Rendered source geometry survived Undo/Redo and Save/Open. Large width/depth screenshots were inspected. The original user file was not overwritten.

Evidence is in `tmp/arc-compiled-ui-final/validated-results.json`, saved `.paramagic` outputs and screenshots. The final cache-key edge-case correction is also exercised in `tmp/arc-compiled-ui-cache-check/` using the two large edits.

That final repeat measured 2.75 s for c1 70 → 90 and 3.13 s for c2 36.5 → 40. Both again passed Undo/Redo, Save/Open, and saved residual verification. The variation illustrates why the table is a measured run rather than a timing guarantee.

Core-only CPU-profiled measurements, taken separately from browser testing:

| Control edit | Iterative backend | Compiled backend |
| --- | ---: | ---: |
| c1: 70 → 70.5 | 539 ms | 132 ms |
| c1: 70 → 90 | 3,834 ms | 871 ms |
| c2: 36.5 → 37 | 1,799 ms | 252 ms |
| c2: 36.5 → 40 | 8,318 ms | 1,161 ms |

Detailed solve timings and backend diagnostics are retained in `tmp/arc-baseline.json` and `tmp/arc-compiled-final.json`.

## Verification and reproduction

The full test suite passes 1,130 tests. New coverage compares the compiled system with a dense reference across scales and damping values, checks floating networks, topology invalidation, cache workspace isolation, constant residual blocks, resource limits and cancellation. Ottoman regressions assert the new backend and preserve all original constraints and expressions. `npm run build:pages` passes.

Use `node scripts/benchmark-arc-solver.mjs <optional-output.json>` for core-only measurements. Use `scripts/test-control-solver.mjs` with Playwright and Vite on port 5180 for visible workflow measurements; optional `CONTROL_CASES` selects a JSON list such as `[["c1",90],["c2",40]]`, and `CONTROL_AUDIT_OUTPUT` selects an evidence directory.

## Updated saved drawing

During validation, the file on disk changed to a newer drawing with c1 = c2 = 32.5, 71 entities and 213 constraints in the affected scope. That snapshot is retained as `src/tests/fixtures/rectangle-ottoman-latest-controls.paramagic`. It exposed a direct c2 32.5 → 33 attempt that exhausted 2,000 nonlinear iterations before continuation succeeded. The shared correction budget removes that delay: its complete visible update fell from 7.32 s to 2.74 s. c2 32.5 → 36 finished in 2.30 s. Both final runs passed Undo/Redo and Save/Open; saved residual norms were below 1e-8 without re-solving.

The newer drawing's c1 32.5 → 33 and 32.5 → 52.5 edits also passed the complete browser workflow in 1.99 s and 2.07 s. Evidence is in `tmp/arc-compiled-latest-ui/` and `tmp/arc-compiled-latest-final-ui/validated-results.json`. The latest-depth regression asserts that the initial attempt uses at most one correction budget while preserving all constraints and releasing locks.

The improvement is verified on both supplied drawing snapshots and the automated suite. It is not a guarantee for every possible arc network. The separate c5 11 → 7 failure remains outside the verified cases.
