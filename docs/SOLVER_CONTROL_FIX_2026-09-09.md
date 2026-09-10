# Ottoman control solver changes — 2026-09-09

The supplied Rectangle_Ottoman drawing is preserved in `src/tests/fixtures/rectangle-ottoman-controls.paramagic`. The original file was not overwritten.

## Confirmed causes and changes

1. The old semicircle projection inferred a permanent-in-solve diameter chord from the starting geometry. This added an unintended restriction and disabled analytical/block Jacobians for the entire connected component. `ArcSolveGeometry.js` now reduces an arc center only when a local distance target or fixed endpoints require a diameter chord. Its midpoint derivatives are propagated into endpoint columns. Arcs permitted to leave the semicircle retain their center variables; known shorter chord targets supply a winding-aware initial estimate at the singular diameter position. Original constraints and convergence tolerances remain in force.
2. The analytical Line Line Distance derivative divided by the actual reference length while its residual divided by `max(1, length)`. They disagreed below 1 mm, which occurred during c2 solves. The derivative now uses the same normalization as the residual.
3. Parameter continuation repeatedly solved from stationary geometry and used a fixed step even after a failed correction. It now predicts variable motion from successive converged states, halves failed steps, and restores the last accepted geometry before retrying. Every prediction must pass the original residual checks. Predicted entity IDs are included in renderer updates even if the correction itself requires no movement. Temporary numeric dimension expressions are restored to their original formulas.

The solver remains nonlinear. It computes linear approximations during iterations; it is not a one-pass linear geometry solver.

## Scope of c1 and c2

In this file, c1 directly drives `d14@Turned Leg = c1 - 4.5`, as well as dimensions in Base Rail, Front and Top. c2 directly drives Top dimensions. Cross-stack constraints connect Top to Front and Front to Base Rail and Turned Leg, including a Tangent relationship. Both updates therefore reach one component containing 70 entities, 310 original scalar variables and 203 enabled constraints. This change does not redefine the scope graph.

## Rendered validation

The actual app was loaded in headless Edge, using the supplied drawing through the Open file input. Each case began from a fresh copy. Controls text fields were changed and committed with Tab. Timing ends after the drawing update is no longer pending and two animation frames have rendered.

| Control edit | Complete visible update |
| --- | ---: |
| c1: 70 → 70.5 | 1.98 s |
| c1: 70 → 69.5 | 1.96 s |
| c2: 36.5 → 37 | 3.29 s |
| c2: 36.5 → 36 | 1.57 s |
| c1: 70 → 74 | 2.46 s |
| c1: 70 → 90 | 7.05 s |
| c1: 70 → 50 | 4.75 s |
| c2: 36.5 → 40 | 10.92 s |

All eight cases changed the rendered source geometry, restored it with Undo, reapplied it with Redo, and preserved it through the app's Save/download and Open workflow. Geometry-path attributes were compared; screen-sized editor handles were excluded because opening a file refits the view. Screenshots were retained and the ±20-inch width results visually inspected. Every saved output was checked without re-solving: its complete enabled residual norm was below 1e-8, including tangent constraints.

Evidence: `tmp/control-stall/ui-fixed/validated-results.json`, saved drawings, and original/reloaded PNGs. Reusable browser runner: `scripts/test-control-solver.mjs` (requires Playwright and the Vite server on port 5180).

The typical half-inch edits meet the requested 3–4-second target. The larger cases do not all meet it; the overall performance requirement remains incomplete. Core-only timings are shorter than the complete app workflow and must not be substituted for the table above.

## Automated checks

- Final full suite: 1,120 tests passed, including the inconsistent fully reduced arc rollback case.
- Final `npm run build:pages` passed.
- The Ottoman regression tests preserve dimensional expressions, check every enabled residual, verify no temporary locks remain, and exercise save/reload in the core.

## c5 follow-up — not yet confirmed

The user reported c5 changing from 11 to 7 with largest remaining error `d2@Base Rail`. In the supplied file, `d2@Base Rail` is a constant 1.75-inch Distance on line `1c68af30-ad86-4ef7-8211-b6a4feedba2c`. It is not an expression driven by c5. The c5-driven dimension is `d8@Front = c5 - 0.125`, which is disabled in that file (both parameter and constraint).

The actual app accepted c5 12 → 11 → 7 with the supplied file and current changes without an error. A disposable experiment enabling d8@Front reached c5 = 11, but its subsequent c5 = 7 run was interrupted after prolonged solving and has no final verdict. This experiment does not establish the state of the user's current drawing or the cause of the screenshot. A current saved drawing at c5 = 11 is needed to reproduce that precise failure.

Read-only inspection of the user's open Chrome drawing at `http://localhost:5173/` showed c1 = 35.5, c4 = 18.5 and c5 = 7, which differ from the supplied saved control values. The Parameters dialog confirmed:

```
d6@Front = c4 - 1.5
d8@Front = c5 - 0.125
d7@Front = if((d6-d8)<7,(d6-d8)-0.125,3.5)
d2@Base Rail = 1.75
```

At c4 = 18.5, c5 = 11 gives d6 = 17, d8 = 10.875 and d7 = 6. Changing c5 to 7 gives d8 = 6.875 and d7 = 3.5. The conditional is discontinuous at d6-d8 = 7: its left limit is 6.875, but its other branch returns 3.5. This establishes an additional abrupt dimension change in the dependency chain. It is a lead for the solver failure, not proof that the resulting geometry is impossible or that this formula alone caused the screenshot. No values were edited in the user's browser; the Parameters dialog was closed after inspection.
