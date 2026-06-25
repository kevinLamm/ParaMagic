# ParaMagic JSketcher Solver Replacement Plan

## Objective

Replace ParaMagic's current rule-by-rule geometry mutation system with a JSketcher-style geometric constraint solver. The new solver will treat the sketch as a mathematical system of scalar variables and residual equations, solve it with a finite-difference Levenberg-Marquardt optimizer, and then project the solved values back into the SVG canvas.

This is a replacement, not an incremental repair of the current solver. The existing constraint selection UI and canvas interaction patterns should be retained where useful, while constraint mathematics and propagation move into the new solver subsystem.

## Source of truth

The implementation will follow `Jsketcher reverse.pdf`:

1. Parameterize geometry into independent scalar variables.
2. Express constraints as residual equations that equal zero when satisfied.
3. Assemble all free variables into an active state vector.
4. Build a numerical Jacobian with finite differences.
5. Minimize residual error with Levenberg-Marquardt.
6. Solve normal-equation steps with Gaussian elimination and partial pivoting.
7. Keep fixed or temporarily dragged variables out of the active state vector.
8. Store named dimensions centrally and re-solve when driving values change.

## Current integration points

The replacement must account for these existing boundaries:

- `src/modules/infiniteCanvas.js` owns geometry records, SVG rendering, feature lookup, handles, dragging, snapping, dimensions, selection, and the current `geometryRuleSystem` callback seam.
- `src/modules/ConstraintHandlers.js` currently owns constraint selection, constraint storage, helper icons, and direct geometry mutation.
- `src/modules/SmartDimensionTools.js` creates driving and driven dimension entities and their geometry anchors.
- `src/modules/DimensionTools.js` renders dimension graphics and supports dimension-label positioning.
- `src/modules/DrawingTools.js` creates line, circle, polygon, polyline, spline, and three-point arc entities.
- `src/modules/config.js` advertises the broader constraint and dimension vocabulary.

The new solver must become the canonical owner of mathematical geometry state. SVG nodes remain a view of that state rather than input to constraint propagation.

## Target architecture

Add a solver package under `src/modules/solver/` with no DOM dependencies:

```text
src/modules/solver/
  Variable.js                 Scalar variable and fixed/locked metadata
  SketchModel.js              Entities, parameters, constraints, dimensions, IDs
  GeometryBindings.js         ParaMagic entity <-> solver parameter mappings
  ConstraintRegistry.js       Constraint type registration and validation
  residuals.js                Residual implementations
  DimensionRepository.js      Driving values, expressions, dependencies, units
  Jacobian.js                 Residual flattening and finite differences
  LinearAlgebra.js            Matrix helpers and partial-pivot linear solver
  LevenbergMarquardt.js        Iteration, damping, convergence, rollback
  SolverController.js         App-facing mutation, solve, and result API
  SolverDiagnostics.js        Structured convergence and invalid-system reports
```

The dependency direction will be:

```text
Drawing/constraint/dimension UI
              |
              v
       SolverController
              |
              v
 SketchModel + residual registry + dimension repository
              |
              v
 Jacobian -> Levenberg-Marquardt -> linear algebra
              |
              v
     solved geometry snapshot
              |
              v
 InfiniteCanvas SVG rendering
```

The numerical modules must be independently testable in Node without constructing the application DOM.

## Canonical data model

### Stable identifiers

- Give every sketch entity, point/feature, variable, constraint, and dimension a stable ID.
- Stop using render-record IDs based on array position and `Date.now()` as mathematical references.
- Keep render record IDs as view details if necessary, but all constraints and dimension anchors must reference stable model IDs.
- Preserve IDs through redraw, solve, serialization, and future persistence.

### Variables

Each `Variable` will contain at least:

- `id`
- numeric `value`
- `fixed` state for permanent locks
- temporary `locked` state used during dragging
- optional owner metadata such as entity ID and parameter name

Only variables that are neither fixed nor temporarily locked enter the active state vector. Fixed and locked variables remain readable by residual functions as constants.

### Geometry parameterization

Use these mappings as the canonical solver representation:

- Point feature: `[x, y]`
- Line: `[x1, y1, x2, y2]`
- Circle: `[xc, yc, r]`
- Arc: `[xc, yc, x1, y1, x2, y2]` plus persistent sweep/orientation metadata
- Polyline/polygon: two variables per vertex, with segments referencing shared endpoint variables
- Spline/curve: two variables per control point; initially expose point-level constraints and driven measurements only

ParaMagic currently stores arcs as start, through-point, and end. `GeometryBindings.js` must convert a valid three-point arc into center/start/end variables and preserve the intended sweep. Rendering converts the solved center/start/end representation back into the SVG arc data needed by the canvas. Degenerate three-point arcs must produce a validation result rather than non-finite variables.

Legacy `rect` entities should be normalized to four shared polygon vertices at the solver boundary. The current rectangle drawing tool already creates polygons.

### Constraints

Store constraints as declarative records:

```js
{
  id,
  type,
  featureRefs,
  parameterRefs,
  dimensionRef,
  enabled
}
```

Constraint records must not contain SVG nodes or closures over canvas records. The registry resolves feature references to variables and returns a flat array of residual values.

### Dimensions

Separate mathematical dimensions from rendered dimension annotations:

- A driving dimension owns or references a value in `DimensionRepository` and contributes residual equations.
- A driven dimension contributes no residuals; it is recomputed after a successful solve.
- Rendered dimension entities retain label/elbow placement and anchor metadata, but target model IDs rather than transient render IDs.
- Changing a driving value or expression triggers dependency evaluation followed by a solve.

Expressions must use a small deterministic parser with explicit units and dimension-name references. Do not use JavaScript `eval`. Detect missing names and dependency cycles before invoking the numerical solver.

## Residual dictionary

Implement each constraint as one or more residual equations. A satisfied constraint returns residuals near zero.

The first complete registry must include the equations described by the PDF:

- Coincident point-to-point: `x1 - x2`, `y1 - y2`
- Horizontal: `y1 - y2`
- Vertical: `x1 - x2`
- Point-to-point distance: `(dx * dx + dy * dy) - D * D`
- Parallel lines: 2D cross product of line directions
- Perpendicular lines: dot product of line directions
- Point on line: cross product of point offset and line direction
- Equal line length: squared length difference
- Line-circle tangent: squared center-to-line distance minus squared radius
- Midpoint: point minus the average of segment endpoints, returning two residuals
- Meta/dimension equation: variable minus evaluated repository value

Add residuals required to preserve ParaMagic's currently exposed workflows:

- Concentric circle/arc centers: two center-coordinate residuals
- Collinear segments: both follower endpoints constrained to the driver's infinite line
- Fixed: remove the selected variables from the active state vector and retain their values
- Circle/arc radius: `r - D`
- Horizontal and vertical driving distance: signed or orientation-preserving coordinate delta minus the target
- Angle between lines: a numerically stable residual formulation with an explicit branch/orientation policy
- Point on circle/arc: squared center distance minus squared radius, with arc-domain validation for arcs

Point-on ellipse and point-on curve must not be presented as working constraints until those entity models and residuals exist. The registry should make unsupported combinations explicit instead of silently applying a different constraint.

Normalize residual scales where equations have substantially different magnitudes so that squared-distance residuals do not dominate coordinate or angular residuals. Document every normalization rule and test it.

## Numerical engine

### Residual assembly

- Resolve enabled constraints against the current model.
- Flatten their residual arrays into one deterministic error vector `E`.
- Validate that every residual is finite.
- Retain equation-to-constraint metadata for diagnostics.

### Numerical Jacobian

- Assemble active variables in a stable order.
- Evaluate baseline residuals once.
- Perturb one active variable at a time and recompute residuals.
- Use the PDF's finite-difference delta of approximately `1e-6`, with a scale-aware fallback for very large or small values.
- Restore every perturbed value even if residual evaluation fails.
- Produce an `M x N` Jacobian where `M` is residual count and `N` is active variable count.

### Linear algebra

Implement and unit-test:

- Matrix transpose
- Matrix-matrix multiplication
- Matrix-vector multiplication
- Dot products and squared norms
- Gaussian elimination with partial pivoting
- Singular/near-singular pivot detection

Keep the first implementation in plain JavaScript arrays for clarity. The API should permit a future typed-array optimization without changing solver callers.

### Levenberg-Marquardt loop

For each solve:

1. Snapshot all variable values for rollback.
2. Evaluate `E` and total squared error.
3. Stop successfully when total error is below `1e-8`.
4. Build `J`, `J^T J`, and `J^T E`.
5. Apply damping to the diagonal: `J^T J + lambda * diag(J^T J)`, plus a small floor such as `1e-7`.
6. Solve for `deltaX` using partial-pivot Gaussian elimination.
7. Apply the proposed step and evaluate the new total error.
8. Accept an improving finite step and divide `lambda` by 10.
9. Reject a non-improving or non-finite step, restore the previous values, and multiply `lambda` by 10.
10. Stop at the iteration limit, initially 100, or when step/error improvement falls below documented tolerances.

If a linear solve cannot produce a stable step, increase damping and retry rather than corrupting model state. A failed solve must return the original valid geometry snapshot.

Return a structured result:

```js
{
  status,              // converged, unchanged, max-iterations, invalid, failed
  iterations,
  initialError,
  finalError,
  acceptedSteps,
  rejectedSteps,
  changedEntityIds,
  problematicConstraintIds,
  message
}
```

Diagnostics are data for the UI and tests; numerical code must not call `alert`, manipulate DOM, or log unstructured errors.

## Application integration

### Solver controller API

`SolverController` should expose operations such as:

- `loadSketch(snapshot)`
- `addEntity(entity)` / `removeEntity(entityId)`
- `updateEntityParameters(entityId, values)`
- `addConstraint(constraint)` / `removeConstraint(constraintId)`
- `setDimension(nameOrId, expression)`
- `solve(options)`
- `beginDrag(variableIds)` / `updateDrag(values)` / `endDrag()`
- `getGeometrySnapshot()`
- `getDrivenMeasurements()`
- `subscribe(listener)`

Each public mutation is transactional: validate, solve when required, commit on success, and roll back on failure.

### Canvas changes

Refactor `infiniteCanvas.js` so that:

- Drawing creates model entities through `SolverController`, then renders the returned snapshot.
- Handle and object drags update model variables instead of directly propagating constraints through geometry records.
- Constraint solving no longer calls `moveFeaturePoint`, `moveFeatureCenter`, or `setFeatureSegment` recursively.
- The canvas refreshes only entities reported as changed by the solver.
- Dimension annotations refresh after geometry commits.
- Selection, camera, snapping, helper icons, and label positioning remain view responsibilities.

Replace `setGeometryRuleSystem()` with a model/solver adapter. Keep a short-lived compatibility adapter only while migration is in progress; remove it in the final cleanup phase.

### Constraint handler changes

Refactor `ConstraintHandlers.js` into a UI/controller module that:

- Determines valid feature selections for a constraint type.
- Creates declarative constraint records through `SolverController`.
- Renders/removes helper icons based on model constraints.
- Displays structured rejection or convergence information when needed.
- Contains no projection, axis-propagation, iterative mutation, or constraint math.

### Dragging behavior

Follow the PDF's JSketcher behavior:

- On pointer-down, identify the variables controlled directly by the dragged handle or entity.
- Temporarily lock those variables and write pointer coordinates to them.
- Schedule at most one solve per animation frame with `requestAnimationFrame`.
- Solve all remaining free variables and render the accepted snapshot.
- On pointer-up, run a final solve, remove temporary locks, and commit one logical edit.
- On failure, retain the last accepted geometry and expose a diagnostic state.

Whole-object dragging must lock all variables belonging to the dragged geometry. Multi-selection dragging must lock all directly moved variables while allowing connected, unselected geometry to solve.

### Dimension behavior

- Creating a driving distance, horizontal distance, vertical distance, angle, or radius annotation must also create the corresponding mathematical dimension/constraint.
- Editing a driving dimension updates `DimensionRepository` and re-solves.
- Driven dimensions update their displayed measurement after every accepted solve but never enter the residual vector.
- Multi-curve length remains driven unless a dedicated driving residual is designed and approved.
- Moving a dimension label or leader changes annotation layout only and must not invoke the solver.

## Migration sequence

### Phase 1 - Characterization and model fixtures

- [x] Add a test runner using Node's built-in test support; avoid adding a framework unless needed.
- [x] Capture current entity shapes and feature-addressing behavior as fixtures.
- [x] Define stable serialized sketch, entity, constraint, and dimension schemas.
- [x] Add conversion tests for line, circle, polygon/polyline, curve, and three-point arc entities.
- [x] Define numeric tolerances and expected diagnostic statuses.

Exit criterion: ParaMagic entities can round-trip through `SketchModel` without SVG or DOM access and without losing geometry or stable IDs.

### Phase 2 - Numerical foundation

- [x] Implement `Variable`, residual flattening, matrix helpers, partial-pivot Gaussian elimination, and numerical Jacobian.
- [x] Implement Levenberg-Marquardt acceptance, rejection, damping, convergence, and rollback.
- [x] Add deterministic unit tests for exact, under-constrained, redundant, inconsistent, singular, and non-finite systems.

Exit criterion: small mathematical systems converge to known solutions and never leave variables in a rejected state.

### Phase 3 - Geometry bindings and residual registry

- [x] Implement solver bindings for current ParaMagic geometry.
- [x] Implement the PDF residual dictionary and ParaMagic compatibility residuals listed above.
- [x] Validate entity/feature combinations before constraints enter the model.
- [x] Add fixture tests for each constraint in isolation and in connected chains.

Exit criterion: every enabled constraint type has passing residual and end-to-end solve fixtures, including reversed selection order.

### Phase 4 - Dimension repository

- [x] Implement named driving values, unit normalization, expression dependencies, cycle detection, and meta residuals.
- [x] Connect driving distance, axis distance, radius, and angle dimensions.
- [x] Keep driven and multi-curve measurements read-only.
- [x] Add update and dependency-chain tests.

Exit criterion: changing one driving value deterministically updates all connected geometry and driven annotations or returns a structured, non-destructive failure.

### Phase 5 - Canvas and command integration

- [x] Instantiate `SolverController` during app startup.
- [x] Route entity creation, deletion, constraint creation/removal, and geometry edits through the controller.
- [x] Rebind canvas render records to stable entity IDs.
- [x] Replace direct constraint mutation calls with solved snapshot application.
- [x] Preserve current tool activation, feature selection, snapping, and helper rendering behavior.

Exit criterion: all existing drawing and supported constraint workflows use the new solver, with no call to the old propagation routines.

### Phase 6 - Interactive drag solving

- [x] Add temporary variable locks and animation-frame solve scheduling.
- [x] Integrate point, segment, whole-entity, and multi-selection dragging.
- [x] Ensure label-only dimension dragging bypasses solving.
- [x] Add browser interaction tests for constrained dragging and final pointer-up commits.

Exit criterion: constrained sketches solve continuously during drag without recursive canvas mutation, stale anchors, or model/render divergence.

### Phase 7 - Removal and hardening

- [x] Delete the old solver math and propagation loop from `ConstraintHandlers.js`.
- [x] Remove the `geometryRuleSystem` compatibility seam and obsolete canvas mutation APIs once no callers remain.
- [x] Prune constraints and dimensions transactionally when referenced entities are deleted.
- [x] Add performance timing around residual/Jacobian/linear solve stages.
- [x] Verify sketches near the expected upper range of 200 active parameters.
- [x] Document serialization and public solver APIs.

Exit criterion: there is one mathematical source of truth and one active solver path in production code.

## Test plan

### Unit tests

- [x] Variable active/fixed/temporary-lock behavior
- [x] Every residual at satisfied and unsatisfied values
- [x] Residual flattening and equation metadata
- [x] Numerical Jacobian against known derivatives
- [x] Matrix dimensions and multiplication
- [x] Gaussian elimination with pivot swaps, singular matrices, and near-zero pivots
- [x] LM accepted/rejected steps, damping changes, convergence, iteration limit, and rollback
- [x] Dimension expression parsing, units, missing references, and cycles
- [x] Arc conversion and sweep preservation

### Solver fixtures

- [x] Coincident line endpoints
- [x] Horizontal and vertical lines
- [x] Parallel and perpendicular line pairs
- [x] Fixed driver with a constrained follower
- [x] Equal-length lines
- [x] Midpoint point/segment relationship
- [x] Point-on-line and collinear chains
- [x] Concentric circles/arcs
- [x] Line-circle tangent
- [x] Driving point distance, axis distance, radius, and angle
- [x] Multiple constraints sharing variables
- [x] Under-constrained sketch with free motion
- [x] Redundant constraints
- [x] Contradictory/over-constrained sketch with rollback
- [x] Degenerate zero-length line and invalid arc inputs
- [x] Approximately 200 active parameters for performance coverage

### Integration tests

- [x] Create geometry, add a constraint, solve, and render the returned snapshot
- [x] Remove an entity and prune dependent constraints/dimensions
- [x] Edit a driving dimension and refresh driven dimensions
- [x] Drag locked variables while connected free variables solve
- [x] Preserve stable anchors after redraw and deletion of unrelated entities
- [x] Clear/new drawing resets model, dimensions, constraints, helpers, and SVG records together

### Browser tests

- [x] Draw each supported primitive
- [x] Apply every enabled constraint through the toolbar
- [x] Create and edit driving dimensions
- [x] Create driven radius, angle, distance, and multi-curve measurements
- [x] Drag constrained points, segments, whole objects, and multi-selections
- [x] Remove constraint helpers and verify freedom is restored
- [x] Exercise zoom/pan during constrained sketches
- [x] Confirm no console errors or model/render drift after repeated edits

## Acceptance criteria

The replacement is complete when:

- [x] All geometry constraints are residual equations evaluated by the new solver.
- [x] Levenberg-Marquardt with numerical Jacobians and partial-pivot Gaussian elimination is the only production solve path.
- [x] Fixed and dragged variables are excluded from the active state vector.
- [x] Solver failures are non-destructive and return structured diagnostics.
- [x] Driving dimensions participate in solving; driven dimensions only measure solved geometry.
- [x] Constraint and dimension references use stable model IDs.
- [x] Canvas rendering never serves as the canonical mathematical state.
- [x] The old iterative projection/axis propagation implementation is removed.
- [x] Unit, fixture, integration, build, and browser tests pass.
- [x] Performance is acceptable for sketches near 200 active parameters, with measurements recorded for regression tracking.

## Non-goals for this replacement

- Redesigning the ParaMagic UI
- Implementing the SQL backend shown in the parameters modal
- Adding ellipse geometry before its model and residuals are designed
- Making multi-curve length a driving constraint
- Adding a general symbolic algebra system beyond safe dimension expressions
- Preserving the old solver as a selectable production mode

## Implementation rule

Do not connect partially implemented constraints to the toolbar. A constraint type becomes available only after its feature validation, residual equations, solver fixtures, integration behavior, and removal behavior are all complete.

## Auto Constrain and Object Snap

- [x] Add default-on Auto Constrain and Object Snap toolbar toggles.
- [x] Snap drawing input to nearby existing point handles using a screen-space tolerance.
- [x] Show real-time green feedback on the active snap target.
- [x] Carry explicit snap references through object commit for Coincident and Concentric constraints.
- [x] Detect Horizontal, Vertical, Parallel, Perpendicular, and Concentric geometry at commit time.
- [x] Keep object creation and generated constraints in one undo/redo history action.
- [x] Add detector coverage and rendered browser checks for enabled and disabled behavior.
- [x] Hide construction geometry along with driving dimensions and constraint helpers in Value Only mode.
- [x] Commit Rectangle and Polyline tools as connected individual line entities while preserving closed fill and optional auto constraints.
- [x] Add fill hit-testing, parent-object region selection, and persistent non-construction fill/stroke properties through a draggable Properties panel.
- [x] Collapse Coincident helpers, add persistent stacking controls, and support constrained multi-object dragging from region fills.
- [x] Add expression-aware fill hex and fill/stroke opacity controls plus reversible Construction conversion in Properties.
