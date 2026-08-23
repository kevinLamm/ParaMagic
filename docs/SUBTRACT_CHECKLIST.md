# Subtract Feature Implementation Checklist

This checklist records the completed property-driven Subtract implementation and remains the monitoring reference for future changes.

## Supported scope

- Circles, primitive rectangles/polygons, and app-created closed line composites (including Rectangle and closed Polyline/Polygon groups) are supported as property-driven Subtract objects.
- Subtract is opt-in through `subtract` and `subtractExpression`; subtracting objects remain independently selectable, movable, and deletable.
- Arbitrary closed cycles made from arc, curve, or fillet records are not yet exposed as Subtract owners. They remain unchanged and are reserved for a future extension.

## Phase 0 - Semantics and geometry foundation

- [x] Define `subtract: true` as "this closed object acts as a cutter."
- [x] Support the documented primitive and closed line-composite scope.
- [x] Confirm subtractors cut non-subtracting closed objects and do not cut one another.
- [x] Add geometry fixtures for disjoint, partial overlap, containment, tangent contact, coincident edges, and multiple cutters.
- [x] Establish stable boundary references tied to source objects and source feature parameters.

## Phase 1 - Persisted property and Properties panel

- [x] Preserve `subtract` and `subtractExpression` through solver bindings and snapshots.
- [x] Add boolean-expression evaluation and validation.
- [x] Add the Subtract checkbox and expression textbox to the Properties panel.
- [x] Support mixed state for multi-selection.
- [x] Route property changes through history and solver update paths.

## Phase 2 - Derived rendering and selection

- [x] Render target fills after subtracting active cutter regions.
- [x] Redraw visible target edges and cut edges.
- [x] Trim subtractor rendering to the target material boundary while retaining a selectable source hit target.
- [x] Hide target fill when subtraction removes all material.
- [x] Keep original source records, handles, hit targets, and deletion behavior intact.
- [x] Recompute subtraction presentation after live changes and solver snapshots.

## Phase 3 - Tool integration

- [x] Make Notch pick exact visible outer and cut boundaries with correct material-side orientation.
- [x] Make Notch traverse every current visible boundary, invert on cut boundaries, and preserve location memory.
- [x] Make Seam Lines select and regenerate around cut boundaries.
- [x] Make Symmetry preserve subtract state and derived previews.
- [x] Add the refresh path for target/cutter edits so dependent Seam Lines regenerate from current boundary features.

## Phase 4 - Lifecycle and compatibility

- [x] Moving a target redraws all affected cuts and dependent Seam Lines through the shared refresh path.
- [x] Moving a cutter redraws every affected target and dependent Seam Lines through the shared refresh path.
- [x] Deleting a cutter restores target material.
- [x] Deleting a target leaves unrelated cutters intact.
- [x] Parameter-driven Subtract changes redraw without geometry loss.
- [x] Save/load and insert preserve expressions and references through the existing entity persistence paths.
- [x] Existing drawings without Subtract remain unchanged; no Subtract fields are injected into ordinary entities.

## Phase 5 - Verification gate

- [x] Focused Subtract geometry tests pass.
- [x] Focused property and persistence paths pass.
- [x] Focused Notch, Seam Lines, and Symmetry automated suites pass.
- [x] Full `npm test` passes: 211 tests passed, 0 failed.
- [x] `npm run -s build` passes.
- [x] `git diff --check` passes; only existing line-ending conversion warnings were reported.
- [ ] Interactive browser acceptance checks pass for clipped cutter rendering, inverted Notch direction, Seam Lines around cut boundaries, and live edits.

## Phase 6 - Seam Line property redesign

- [x] Move Seam Line control into the Properties panel for the selected boundary stroke.
- [x] Persist generated Seam Line source references as ordinary derived drawing entities.
- [x] Remove the Seam Lines toolbar workflow.
- [x] Preserve boundary metadata through Seam Line direction resolution.
- [x] Preserve analytic circle/arc features for cut-boundary offsets.
- [x] Offset curves and join arc/line seam runs at their apparent tangent intersection.
- [x] Move Seam Line property, lifecycle, and derived-record management into `SeamLineSystem.js`.
- [x] Restrict Seam Lines to closed hosts and make generated seam entities display-only.
- [x] Move Boolean owner/state, boundary resolution, material-side targeting, and mask presentation into `SubtractSystem.js`.
- [x] Resolve legacy subtractor-circle Notches against their current visible arc boundaries.
- [x] Merge legacy Seam Line fragments into the current connected Boolean boundary scope during refresh.
- [x] Preserve analytic arc output when a Boolean circle boundary is split into multiple connected arc features.
- [x] Coalesce connected same-circle Boolean arc pieces before seam offsetting to prevent radius discontinuities and miter spikes.
- [x] Reconstruct composite Boolean owners from evaluated fillet topology instead of raw polygon corners.
- [x] Remap Boolean outer-boundary features to their actual line and fillet source records.
- [x] Mirror derived Seam Lines with Symmetric previews.
- [x] Expand Boolean masks by the source stroke width so the mask does not visually thin the base stroke.
- [ ] Verify a complete Seam Line around a Boolean cutout in the browser.
- [ ] Verify Seam Line regeneration after target and cutter edits in the browser.

## Verification record

Recorded 2026-07-11. The supported scope is defined above, but implementation completion is currently blocked on the unchecked acceptance items. Any future support for arc/curve/fillet cycles should begin as a separate scoped extension with new geometry and interaction fixtures.

## Review correction - 2026-07-11

The previous completion claim is withdrawn. Automated tests and build checks are green (211 tests passed), but the feature acceptance is not complete:

- The previous implementation left the cutter stroke untrimmed; the code now applies a per-cutter material mask, pending browser verification.
- The previous Seam callback discarded cut-boundary metadata; the code now preserves it and uses analytic arc/circle features, pending browser verification.
- Seam offsets now support curves, use consistent analytic arc radii, join connected runs at tangent intersections, and replace derived records when a live Boolean edit changes their geometry type.
- Seam lifecycle and closed-host validation now live in `SeamLineSystem.js`; `infiniteCanvas.js` only wires the system into canvas callbacks.
- Boolean owner/state and presentation lifecycle now live in `SubtractSystem.js`; `infiniteCanvas.js` retains only canvas integration and appearance callbacks.
- The supplied `Untitled Drawing (12).json` pattern is covered by legacy cutter-Notch and duplicate-arc seam regression tests.
- Legacy seam fragments are now rebuilt from the current connected boundary scope, and connected Boolean arc pieces retain analytic arc output.
- Composite Boolean targets now use the evaluated filleted boundary for fill masks, Notch/Seam feature resolution, and outer-edge source metadata.
- Symmetric previews now include derived Seam Line records whose parent boundary is selected.
- Boolean masks are stroke-aware; the fill region remains below the base geometry, while the expanded mask protects the full base stroke width.
- Connected Boolean arc pieces are merged before offsetting, preventing the split-arc seam trim error shown in `Untitled Drawing (14).json`.
- The previous tests checked mask existence, source metadata, and helper output. Browser acceptance is still required for rendered clipping, complete Seam Lines, and live edits.
