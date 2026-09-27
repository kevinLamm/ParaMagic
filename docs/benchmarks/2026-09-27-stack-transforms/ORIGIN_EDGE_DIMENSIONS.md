# Origin-to-edge dimensions in Stack transform mode

## Reproduced failure

With no active Stack, selecting the drawing origin and an edge created a `Point Line Distance` constraint, but used the legacy finite-segment projection. When the origin lay beyond the edge's span, the projected point was clamped to an endpoint. The relationship therefore behaved like a distance to a corner, despite retaining an edge reference in its metadata. Editing the value could rotate the Stack.

A second issue affected dragging against a world relationship. The requested frame was locked completely during the solve. A diagonal pointer movement containing both allowed and prohibited translation could fail entirely, making the Stack appear frozen.

## Correction

- The Smart Dimension tool passes its solve domain into candidate construction. New point-to-edge dimensions in Stack transform mode measure perpendicular distance to the edge's supporting line. This remains a point-to-edge relationship beyond either endpoint and is independent of label placement or selection order.
- The dimension stores `pointToSegment.projectionMode = 'line'`, aligned measurement and the original point/edge references. The existing JavaScript and WASM equations, derivative implementations and final tolerances already support this representation.
- Distance edits first solve with the accepted Stack directions held temporarily. If translation cannot satisfy the relationships, the same solve retries with rotation available. A Fixed-point case verifies that required rotation still works. No persistent Fixed or angle constraint is added.
- If the exact requested drag is incompatible with a world relationship, the placement solver projects it onto the allowed movement. An origin-edge dimension therefore permits sliding even when the pointer also moves slightly toward or away from the edge. Numerically unchanged frames retain their exact previous values to avoid empty history entries.

Active-Stack point/segment creation retains its existing semantics. Saved dimensions with the previous finite-segment projection are not silently reinterpreted. Recreate an affected old dimension to use the corrected supporting-line definition; already damaged geometry is not automatically restored.

## Automated validation

17 new tests cover JavaScript and WASM, horizontal/vertical/sloped edges, both selection orders, repeated dimension edits, snapshot reload and further edits, connected Collinear Stacks, diagonal sliding, required rotation about a Fixed world point, driving/driven preview and active-Stack compatibility.

- Focused suites: **125 passed**.
- Full `npm test`: **1,332 passed**, zero failed/skipped/cancelled; 69.86 seconds.
- `npm run build`: passed.
- `npm run build:pages`: passed.
- Existing bundle-size warnings remain.

Assertions use the existing `DEFAULT_SOLVE_TOLERANCE` for solved distances/residuals, exact local geometry during solving, and a 1e-6 radian bound for preserved frame directions through repeated edits and reload. Production convergence tolerance was not reduced.

## Rendered verification

Tested through real Smart Driving Dimension selection, canvas-origin selection, edge picking, placement, the expression editor, canvas dragging and Undo in an isolated app copy. The user's drawing was not used.

1. Horizontal rectangle edge at y=60, extending from x=100 to x=200: origin projection is beyond the endpoint. Preview and creation show 60 with an extension to the edge's line. Editing to 85 translates the Stack without rotating or deforming it; the dimension remains driving and attached to the edge.
2. Undo restores the 60 dimension. Redo restores 85.
3. Two Collinear rectangle Stacks: editing origin-edge distance 60 to 85 translates both while retaining their directions and local geometry. A diagonal drag then slides only the selected Stack along the common line, preserving 85 and Collinear.
4. Reloading that drawing retains the point-edge reference, driving status, distance and geometry.
5. Vertical edge at x=60, selected before the origin: preview/creation show 60; editing to 85 translates horizontally with no rotation. A diagonal drag retains vertical sliding freedom and the 85 distance.
6. No browser console errors were recorded.

The initial reload harness compared whole entity objects and flagged serialization metadata changes as a geometry failure. The check was corrected to compare numerical geometry fields. Reload then passed for the connected case; the production code was unchanged by that harness correction.
