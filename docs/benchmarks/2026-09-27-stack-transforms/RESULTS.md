# Constraints with no active Stack

## Behavior

With no Stack active, new constraints and dimensions position rigid Stacks. Horizontal and Vertical rotate the owning Stack against the drawing axes. Local coordinates, object sizes and internal constraints are preserved. These relationships belong to Global and remain in the saved drawing.

Length and Equal are disabled until a Stack is active. Smart Dimensions in this mode accept distances and angles between different Stacks or a Stack and the drawing origin. Internal lengths, radii and other dimensions that change local geometry require an active Stack. Relations involving only geometry inside one Stack are rejected, except Horizontal, Vertical and Fixed. Fixed on a point holds that world point; Fixed on an edge holds its Stack frame. Linked-copy internal adjustments also require an active Stack.

The existing local editing behavior remains available when a Stack is active. Loading existing drawings does not apply the new-constraint restrictions retroactively.

## Implementation

The ownership resolver previously reassigned a relationship with one participating Stack to local geometry even when the tool explicitly requested a Stack transform. It now preserves that requested solve domain and uses the drawing frame as the reference for a single-Stack relation.

A pure rotation also requires an appropriate axis residual. An endpoint-height residual has zero rotational derivative when a vertical edge is asked to become horizontal. The initial probe produced an excessive rotation in JavaScript and exhausted iterations in WASM. Stack-frame Horizontal/Vertical now use a length-scaled angular residual with the nearest axis ray recorded when the constraint is created. Exact quarter turns converge in both backends; local Horizontal/Vertical equations and final solve tolerances are unchanged. WASM evaluates the new equations and derivatives using its existing native expression tape.

Tool availability and creation rules live in `StackTransformPolicy`, `ConstraintSystem`, `DimensionSystem` and `CanvasUIControls`. Solver ownership and validation live in `SolverController`. The canvas coordinator only handles the absence of a created dimension.

## Automated checks

- `npm test`: **1,301 passed**, zero failed, skipped or cancelled (69.75 seconds).
- `npm run build`: passed.
- `npm run build:pages`: passed.
- Both builds retain the existing large-bundle warning.

The 21 new tests exercise JavaScript and WASM: whole-Stack axis rotation, exact quarter turns, reversed edge direction, unchanged local geometry, unaffected unrelated Stacks, retained internal constraints, conflicting-constraint rollback, Fixed point/frame behavior, rejected shape-editing constraints, driving distance edits, active-Stack local editing and snapshot restoration. Toolbar and Smart Dimension tests cover the context restrictions.

New axis alignment is checked within 1e-7. Local geometry is checked exactly during solving; snapshot round trips allow floating-point coordinate conversion at 1e-9. Existing local and dimension solver tolerances were not reduced.

## Rendered browser verification

Used an isolated copy of the current app at `http://127.0.0.1:5174/check.html`, leaving the user's drawing untouched. The fixture contains a rectangle with four local Horizontal/Vertical constraints plus a circle in Panel A, and a separate line in Panel B. Actions used the real menus, canvas picking, dimension editor and Undo button.

Verified:

1. With no Stack active, Length and Equal are visibly disabled.
2. Applying Horizontal to the rectangle's vertical edge rotates the entire rectangle and companion circle. The edge becomes horizontal, the other Stack stays in place, internal geometry and constraints are preserved, and no Stack becomes active.
3. Undo restores the original geometry and removes the new relationship.
4. Applying Vertical to the horizontal edge rotates the entire Stack; the same geometry and ownership checks pass. Undo restores it.
5. Activating Panel A makes Length and Equal available again.
6. With no Stack active, attempting a Smart Driving Dimension on an internal rectangle edge creates no dimension.
7. A driving distance between Panel A and Panel B is created in Global. Editing 60 to 90 moves the free Stack while preserving all local geometry.
8. A driving angle between edges in the two Stacks is created in Global. Editing 90 degrees to 60 degrees visibly rotates Panel B and preserves local geometry.

No browser console errors were recorded. The browser harness and build/test logs are retained beside this report. This is a correctness and behavior change; no performance improvement is claimed.
