# Stack dragging respects the remaining movement freedom

## Cause and correction

`SolverController.setStackFrame` translated the entire transitive Stack participation component before solving its equations. That made a relationship such as Parallel, a one-axis distance, or even a driven measurement behave like a rigid group.

Dragging now changes only the requested Stack frame before the placement solve. Other frames start at their accepted positions. The existing placement solver determines their required movement from the enabled constraints and driving dimensions. The unconditional group-translation function was removed from `StackPlacementSolver`.

This applies to both JavaScript and WASM. Local geometry, constraint equations, solve tolerances, worker mutation handling and drag cancellation/history remain unchanged. An impossible requested frame still rolls back; this change does not introduce approximate constraint satisfaction or a new drag algorithm.

## Automated evidence

Before the correction, the new regression suite had **12 failures and 2 passes** across JavaScript and WASM. Afterward, all **14 cases pass**:

- Parallel permits independent translation when dragging either Stack.
- Collinear allows sliding along the shared line; only perpendicular movement propagates.
- A horizontal driving dimension preserves horizontal spacing without coupling vertical movement.
- A three-Stack chain preserves the independent axes of its two dimensions.
- Driven dimensions do not couple movement.
- Disabled constraints do not couple movement.
- Fixed remains effective; an impossible move restores the previous frames and geometry.

The existing test that required both Collinear Stacks to translate along their common line was updated to require free sliding. Existing Coincident, worker synchronization, later parameter edits and cancellation checks still pass.

- Focused suites: **67 passed**.
- Full `npm test`: **1,315 passed**, zero failures/skips/cancellations; 70.07 seconds.
- `npm run build`: passed.
- `npm run build:pages`: passed.
- Existing large-bundle warnings remain.

## Rendered browser checks

Used an isolated copy of the app at `http://127.0.0.1:5174/drag-check.html`. Each of three Stacks contained a rectangle with internal H/V constraints and a companion circle. Relations were loaded into the real app, then dragged with canvas pointer gestures and verified through rendered geometry and numeric checks.

| Scenario | Panel A translation, mm | Panel B translation, mm | Result |
| --- | --- | --- | --- |
| Parallel | (15.873016, 14.285714) | (0, 0) | Independent translation |
| Collinear, along line | (15.873016, 0) | (0, 0) | Free sliding |
| Collinear, additional diagonal move; total shown | (22.222222, 12.698413) | (0, 12.698413) | Only required direction follows |
| Horizontal driving dimension | (14.285714, -14.285714) | (14.285714, 0) | 110 mm spacing retained |
| Horizontal A–B plus vertical B–C dimensions | (14.285714, -14.285714) | (14.285714, 0) | Panel C remains still |
| Driven horizontal measurement | (14.285714, -14.285714) | (0, 0) | Displayed value updates from 110 to 95.714 |

All checks preserved local geometry and constraint satisfaction. No Stack became active. Undo restored the Parallel and driving-dimension drag cases. No browser console errors were recorded. The user's browser drawing was not used for these tests.
