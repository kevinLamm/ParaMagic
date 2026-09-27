# Collective relocation and persistent Worker synchronization

## Cause and correction

With no Stack active, `StackCanvasInteraction` moves the connected Stack frames
through `SolverController.setStackFrame`. The execution facade previously forwarded
that call only to the main-thread controller. The Worker kept the previous frames,
so a later authoritative control edit returned geometry at the old canvas position.
The same omission affected cancellation through `restoreStackPlacementState`.

The facade now journals and forwards the accepted placement state through the
existing incremental `update-model` command. This includes connected Stack frames
and dimension annotations. Consecutive frame changes coalesce; intervening world
geometry edits retain their ordering. Pending placement updates flush before a
dimension or control edit. Worker restart replays the same accepted placements.
Restoring placement leaves the nonmovable Global frame untouched.

This changes Parametric Core synchronization only. It does not change native
mathematics, constraints, direction rules, tolerances, drawing tools, or rendering.
The large-system linear solver experiment stays removed.

## Regression evidence

- Before the correction, both JavaScript and WASM Worker tests reproduced a move
  from x=5 to x=85 reverting to x=5 after a control edit.
- Six new automated cases cover both backends: an immediate control edit after
  repeated collective moves, cancellation, journal recovery, interleaved geometry
  edits, and rejected moves. They also check annotation parity, unchanged local
  shape, and absence of a full Worker model reload.
- The WASM cases retain the same native memory buffers and Jacobian topology
  build counts across relocation and the following control edit.
- After installation, the full suite passes: **1,263 tests, zero failures**.
- Client and Pages builds pass; the native binary is unchanged at SHA-256
  `65fa796f2c0fa2d6106263d71fefe3cc98751b1ac98cfadf14adf08335bca752`.

## Rendered supplied drawing

Tested an isolated copy of the user's latest saved `TestFrontView.paramagic`:
72 entities, 205 constraints, initial c1=54, no active Stack. Fixture SHA-256:
`cd53792810ca25c1c59e435e44eb84ead8b1ea34b456e6873d04bcdf1d3bd0f4`.

An actual browser pointer drag moved the Front geometry and its connected Stacks.
After c1 changed to 62, the WASM Worker converged with the relocated geometry:

- Final residual L2: `9.967425855770802e-9` (below `1e-8`).
- Maximum world-coordinate difference from the JavaScript reference solving the
  relocated snapshot: `4.729372449219227e-11` (threshold `1e-4`).
- The residual was measured from the rendered document without first solving or
  correcting it. All saved constraints remained present.
- No Worker model reload occurred during the collective drag/control workflow.
- Undoing the control edit retained the moved location; undoing the drag restored
  its original location. Both Redo steps and serialized drawing reload passed.

Browser testing used a separate localhost port. The fix was installed in the live
workspace only after the user confirmed their drawing was saved.
