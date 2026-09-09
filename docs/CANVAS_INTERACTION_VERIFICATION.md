# Dimension editing and overlap selection

## Interaction changes

- Dimension presses remain clicks until pointer movement reaches the shared 4 px drag threshold. Capture begins only when dragging starts.
- The expression editor opens on the completed second click. Opening on the second pointerdown could put the popup under pointerup and retarget the subsequent click to the canvas, immediately dismissing the editor.
- Alt-click previews overlap candidates without sending each candidate into the active tool. Alt-click or Tab advances; Shift reverses; Enter or a plain click near the cycle location accepts; Escape cancels the preview.
- The cycle includes hidden point handles, preserves the exact handle/segment target, removes duplicate edge hits, and filters candidates through the active constraint's accepted feature types.
- Preview keyboard handling precedes app shortcuts, so Escape preserves the active constraint tool.
- Curve point deletion uses Ctrl+Alt-click (Command+Alt-click also supported); Alt-click is reserved for cycling. Deletion remains undoable.

## Rendered verification

Fixture: `src/tests/fixtures/canvas-interactions-browser.html`, using the normal application canvas and tools with the existing Stack Coordinates drawing and focused overlap/curve scenes.

Browser checks performed:

1. Repeated dimension double-clicks open the expression textarea.
2. Five consecutive launches at a position covered by the newly opened popup keep the textarea visible and focused. Entering `4` and pressing Enter changes the rendered label to `d1 = 4`.
3. A 42 px deliberate drag moves the rendered label 42 px; a subsequent 2 px / 1 px jitter gesture leaves it unchanged. Editing still opens after dragging.
4. Zooming in and out preserves a roughly 37 px high text hit region and permits double-click editing.
5. Coincident previews the two overlapping endpoint handles without selecting either. Accepting each endpoint separately creates the intended Coincident constraint and renders its helper.
6. Parallel previews only the two eligible overlapping edges. Tab reaches the lower line; a plain click accepts it; accepting the other line creates the intended Parallel constraint and renders its helpers.
7. Tab, Shift+Tab, and Escape advance, reverse, and cancel the preview. Escape keeps the active Coincident tool enabled and leaves no selected points.
8. Smart Driving Dimension accepts cycled point handles and places a rendered dimension (`d1 = 3.937`). After Escape ends the creation tool, double-click opens the new dimension's expression editor.
9. Alt-click on a curve point previews it without deleting it. Ctrl+Alt-click changes the rendered curve from three handles to two; Undo restores three handles.

## Automated validation

- 77 focused tests passed across dimension interactions/extensions, overlap selection, pointer drag, viewport, constraint handlers, curve controls, and canvas selection.
- `npm run build` passed. Vite reports the existing large-bundle advisory.
- Both working-tree diff whitespace checks passed.
- Logs: `docs/benchmarks/canvas-interaction-tests.txt` and `docs/benchmarks/canvas-interaction-build.txt`.

Existing unrelated working-tree changes were preserved.

## Follow-up: handles beside unrelated edges

The handle hover loop previously required the owning geometry to be hovered or selected before testing its handles. A neighboring edge's broad hit stroke could prevent that prerequisite, leaving most of a handle inaccessible.

Hover, direct feature picking, and overlap cycling now share a 9 px screen-space point area. Handle hover no longer depends on the owning geometry's hover state. Constraints that accept points and both dimension tools prefer a nearby point; explicit cycle targets are preserved, and edge-only modes (including driven multi-curve length) retain geometry picking.

Additional rendered checks in **Reset near edge**:

- Eight perimeter positions, each 8.5 px from the handle center, all had the unrelated line as their top browser hit. Each revealed the endpoint with full opacity and enabled pointer events. This passed with Coincident active, followed by successful endpoint selection and a rendered Coincident helper.
- Point-on selected the nearby endpoint normally, then accepted the explicitly cycled neighboring edge and created `Point-on Line` with the intended point and segment references.
- Driving Dimension selected the point normally and the nearby edge through cycling, then rendered `d1 = 0.118`.
- Driven Dimension selected the edge by clicking farther along it, then selected the nearby endpoint normally and rendered the same measurement.

The follow-up's 60 focused tests and production build passed. Logs: `docs/benchmarks/point-priority-tests.txt` and `docs/benchmarks/point-priority-build.txt`.

## Follow-up: derivative handle visibility

Duplicate and symmetric derivative handles now follow hover and selection state. Activating a constraint or dimension tool no longer reveals every derivative handle. Hovering the corresponding geometry reveals its handles; hovering a handle's full 9 px point area reveals that handle independently. Selected, cycle-preview, and snap-target handles retain their explicit visibility states. The owning linked-copy module handles hover for both derivative types.

Rendered checks in **Reset derivatives**, with Coincident, Smart Driving Dimension, and Smart Driven Dimension each active:

- Both derivative types keep all three handles hidden with the pointer away.
- Hovering 8.5 px from a handle center reveals that handle.
- Hovering the geometry between handles reveals its handles.
- Moving away hides the handles again.
- Selecting a duplicate endpoint and then a symmetric endpoint in Coincident leaves only the selected endpoint visible after moving away.

All 83 focused tests and the production build passed. Logs: `docs/benchmarks/derivative-handle-tests.txt` and `docs/benchmarks/derivative-handle-build.txt`.

## Joined arc tangency

The supplied Rectangle Ottoman drawing reproduced the 2,000-iteration failure on the two left profile arcs in the Turned Leg stack. The general circle-distance residual loses its first-order angular gradient near a coincident endpoint. Joined arc tangency now uses radial alignment and point-on-circle contact, preserving the chosen internal/external branch. Both numerical and analytical Jacobians use this formulation. Failed additions identify the attempted operation; diagnostics retain small nonzero constraint errors instead of reporting an unknown relationship.

The same drawing converged in five iterations after the change. In the rendered application, selecting the two arcs with Tangent created its helper, left an endpoint gap below 6e-11, and reduced the sine of the tangent angle below 3e-9. Undo removed the tangent and its helper; Redo restored both. Serializing/reloading preserved the tangent and smooth joint; selecting Turned Leg after reload displayed its helper again.

The tangent-focused suite passed 131 tests, including either selection order, internal/external tangency at multiple scales, analytical derivative verification, save/load, and failure rollback. Before GitHub publication, all 1,096 application tests and the GitHub Pages production build passed. The full test run also identified and corrected a missing manifest entry for an already tracked nail image.
