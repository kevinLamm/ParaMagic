# Seam Line V2 Overhaul Checklist

## Architecture

- [x] Persist Seam Line intent instead of generated `finish-size-offset` geometry.
- [x] Resolve Seam Lines from the final ordered material boundary after fillets and Boolean subtraction.
- [x] Render Seam Lines as non-interactive presentation geometry inside the owning closed object's SVG group and outside solver/selection records.
- [x] Recompute presentation atomically so an invalid intermediate solve cannot leave partial geometry.
- [x] Keep all Seam Line state, migration, geometry, and presentation behavior in the Seam Line modules.
- [x] Remove the legacy Finish Size runtime path and derived Seam Line record branches from `infiniteCanvas.js`.

## State and Properties

- [x] Add a versioned `extensions.seamLines` drawing schema.
- [x] Support whole-boundary defaults and stable per-source-edge overrides.
- [x] Make the Properties checkbox read directly from Seam Line intent.
- [x] Ensure disabling an object or mixed selection removes every applicable Seam Line intent.
- [x] Keep edge-proximity clicks scoped to individual line, arc, circle, curve, and Boolean boundary edges while interior-fill clicks control the complete closed region.
- [x] Store partial intent as default-off plus explicit enabled edges so future Boolean topology cannot enable new seams.
- [x] Keep durable edge identity stable when the same Boolean source edge changes between arc and circle presentation.
- [x] Preserve Seam Line definitions through history, save/load, insert, and clipboard ID remapping.
- [x] Migrate explicitly enabled legacy `finish-size-offset` entities on load, discard stale generated entities, and exclude all generated entities from the solver.

## Geometry

- [x] Generate complete outer and Boolean-cut contours from the same final-boundary source used by rendering.
- [x] Offset lines, circles, arcs, curves, and polylines toward the remaining material.
- [x] Choose one invariant inward side for each ordered boundary feature so a straight parent edge always produces a parallel straight seam.
- [x] Join neighboring offsets at their analytic line-line, line-circle, or circle-circle apparent intersections using immutable source tangents.
- [x] Keep partial edge seams trimmed to the complete contour's joined offset.
- [x] Remove collapsed/invalid intermediate output atomically rather than retaining partial presentation paths.
- [x] Keep output deterministic while operands are dragged, constrained, filleted, or reordered.

## Derived and Secondary Presentation

- [x] Update array instances whenever source or Boolean geometry changes.
- [x] Reflect Seam Lines correctly in symmetric instances.
- [x] Honor stack visibility and source stack ownership.
- [x] Use the shared Seam Line evaluator in Stack and Open/Insert thumbnails.
- [x] Export shared evaluated Seam Line geometry to the dashed `Seam Lines` DXF layer.

## Verification

- [x] Unit tests cover intent normalization, legacy migration, stale legacy output, mixed state, and deletion.
- [x] Geometry tests cover lines, circles, arcs, curves, fillets, cutouts, collinear edges, and tangent cases.
- [x] Integration tests cover arrays, symmetry, stacks, thumbnails, clipboard, JSON, and DXF.
- [x] Repeated-drag stability tests produce no duplicate, jumping, or stale partial Seam Lines.
- [x] The complete automated test suite passes: 348/348 on 2026-07-22.
- [x] The application build validation passes: 113 JavaScript modules checked on 2026-07-22.
- [x] `Untitled Drawing (18).json` passes live browser verification with no console errors.
- [x] `Untitled Drawing (18) (1).json` renders no Seam Line on its disabled selected outer edge while preserving independent enabled cutout-edge intent.
- [x] A circular Boolean boundary with a rectangular slot keeps both slot seams parallel, the connecting seam perpendicular, and both joins on the analytic inset circle.
- [x] Overlapping foreground objects mask owner-mounted Seam Lines according to normal stack/Z-index order.
