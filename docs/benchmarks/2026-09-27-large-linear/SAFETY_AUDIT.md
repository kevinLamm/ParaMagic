# Solver safeguard audit — historical investigation

The large-system experiment was subsequently removed at the user's request.
See [ROLLBACK.md](ROLLBACK.md). The notes below record the investigation before
that rollback; no isolated translation or gauge experiment was installed.

## Trigger and current disposition

The user reported flattening a new rectangle and reversing existing region
geometry when adding Collinear to an existing region edge. They removed Collinear,
then development-server reload occurred during source editing. Removing the
relationship is not the same as undoing the geometry changes. The live app was
not intentionally reloaded through browser tools, but editing live source caused
automatic reload; work has moved to an isolated copy.

The large sparse-direct extension is now disabled by default. Established WASM
solving remains available. The added translation experiment described below has
not been installed in live source.

## Evidence

- Preserved the latest user-named local TestFrontView file in
  `tmp/constraint-add-regression.paramagic`: 82 drawing entities, 211 constraints,
  326 solver variables after excluding image/notch display entities. Two Vertical
  constraints are already disabled with non-degenerate-segment load errors. The
  newly added Collinear relationship is absent because the user removed it.
- This drawing is below the 2,048-active-variable threshold of the new algorithm.
  The saved old WASM binary and new binary load it with identical numerical results.
- Extracted committed core `e0a542c` into `tmp/pre-wasm-reference` using `git archive`.
  It contains no native solver modifications. Twelve small Collinear test scenarios
  reproduce the same deformation/collapse as the current JavaScript solver.
- A reconstructed rectangle added to the user's remaining saved geometry also
  reverses its winding in both the pristine original and current implementations.
  Example: signed area 808,200 before versus approximately -3,638,580 after a
  Collinear solve, while reference residual L2 is below 1e-8.
- These reproductions demonstrate a real geometric correctness gap. They do not
  identify the precise selected edges or prove the cause of all changes in the
  user's original operation. The pre-operation drawing and added relationship
  were not captured.

## Original code comparison

The committed original includes input constraint validation, rollback after failed
constraint creation, temporary translation gauges with `finally` cleanup, solver
iteration limits, finite-value checks, error-decrease acceptance, and restoration
on failed solves. Those mechanisms remain in the current controller/numerical
paths. `addConstraint` itself was unchanged by the WASM port before the isolated
experiment.

Changes needing explicit distinction:

- The earlier WASM work removed the accepted-step-size stagnation stop from the
  current JavaScript and native solvers, allowing small improving steps to continue
  toward strict cross-Stack tolerances. Iteration and rejected-step damping limits
  remain. This is a changed safeguard/termination condition, not unchanged code.
- The new large-system direct experiment changes regularization only above 2,048
  active variables. That route is now opt-in and never activates for the saved
  326-variable case.
- The native route has separate residual, derivative and numerical implementations.
  Passing comparisons does not by itself prove every original guard is equivalent.
  A full safeguard audit is not yet complete.

The original rigid-placement preference applies to Coincident, not Collinear.
Consequently Collinear can deform an underconstrained rectangle or pass through a
degenerate configuration while the final residual falls below tolerance. Small
residuals alone do not prove preserved shape, winding, or segment direction.

## Exact d11/d12 reproduction and correction to the comparison

A later saved file (`tmp/collinear-d11-d12.paramagic`, 72 entities and 202
constraints) identifies the exact two selected segments through its d11/d12
dimension annotations. Both are vertical. Neither dimension is driving.

The untouched committed JavaScript **dense** solver accepts this operation in 42
iterations, with squared residual about 5.90e-17. The original/current JavaScript
**sparse** path and ordinary WASM path reject it as invalid after 45 iterations.
The earlier statement that the original solver also fails was too broad: that
comparison used sparse mode. This distinction matters when investigating a
regression. See `tmp/collinear-pristine-dense.txt` and
`tmp/collinear-solve-paths.txt`.

One concrete shared-solver defect has been isolated. Temporary translation gauges
are selected using the entity order of a scoped model, which is constraint-graph
traversal order, instead of the original drawing's entity creation order required
by CODEXRULES.md. Selecting from the root model's creation order lets the exact
d11/d12 operation converge through the ordinary numerical path in 36 iterations
with no reversed line directions and a reference residual below 1e-8. No
Collinear-specific placement is involved in that result.

That change is **not a complete correction**. More widely separated variants
still fail, and the reconstructed earlier rectangle can still reverse winding.
The exact-case correction also resizes the new underconstrained rectangle; it
does not preserve its original width/height. A root-order scan must also be
reviewed for cost across many disconnected components before any rollout.

The ordering investigation exists only in `tmp/solver-regression-isolated`.
It has not been installed in the live app. The large-system experiment remains
disabled by default. No all-constraint or all-direction guarantee is established.

## Superseded placement experiment — not for installation

`tmp/solver-regression-isolated` contains a separate core copy. An experimental
extension tries translation of disconnected parallel-line components before
deformation. On reconstructed tests it retains rectangle lengths 2,694 × 300
and direction while satisfying all remaining relationships below 1e-8. It uses
temporary locks for verification and adds no permanent Fixed constraints.

The later d11/d12 fixture passed that experiment through the normal browser
constraint tool and WASM Worker, including Undo, Redo, and serialization/reopening.
Twenty focused numerical tests also passed. Those results verify the placement
approach only; they do not correct the failing ordinary numerical path.

After the user explicitly rejected a workaround, this experiment was removed
from the isolated controller as well. A research copy remains at
`tmp/collinear-placement-candidate.js`. Do not install it or cite its successful
checks as proof of a general solver correction. The `tmp/collinear-placement`
tests and preview verification script refer to that superseded candidate.
