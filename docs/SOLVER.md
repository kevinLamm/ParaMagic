# ParaMagic Solver Architecture

ParaMagic uses a DOM-independent geometric constraint solver in `packages/paramagic-core/src/modules/solver`. SVG records are views of solver-owned geometry snapshots.

## Pipeline

1. `GeometryBindings` converts drawing entities into stable scalar `Variable` objects.
2. `SketchModel` stores geometry, constraints, and stable references.
3. `ConstraintRegistry` flattens enabled constraint residuals into an error vector.
4. `Jacobian` computes finite-difference derivatives for active variables.
5. `LevenbergMarquardt` solves damped normal equations with partial-pivot Gaussian elimination.
6. `SolverController` commits a converged snapshot or restores the previous valid geometry.
7. `infiniteCanvas` applies the accepted snapshot and refreshes anchored dimensions.

Fixed variables and variables controlled directly during a drag are omitted from the active state vector. Drag updates are limited to one solve per animation frame.

Interactive drag results are presentation-safe transactions: the canvas converts a 0.2-pixel presentation tolerance into world units, and a time-budgeted preview is shown only when its combined constraint error stays below that limit. This permits responsive sub-pixel approximations without displaying visibly separated geometry. Otherwise, the last valid geometry remains visible. Pointer-up reapplies the latest requested drag with its manipulated variables locked, runs an unbudgeted final solve, and commits the result only when the constraints converge; an incompatible move restores the pre-drag geometry.

## Free-floating components

A connected component can fully determine its internal shape while leaving its absolute canvas position undefined. Translating every point by the same X/Y offset does not change internal distances, angles, or incidences, so those two rigid-body modes form a numerical nullspace.

Large matrix-free solves remove that ambiguity with a temporary translation gauge. The first-created eligible point in the component is held at its current X/Y values only while the solver runs. Explicit fixed variables, drag locks, `Fixed` constraints, and canvas-origin relationships take precedence. Temporary gauge locks are always released after the solve and are never serialized, added to history, shown in the UI, or included in the drawing's constraint count.

Drawings therefore remain intentionally free-floating unless the user explicitly fixes geometry or constrains it to the canvas origin.

## Public controller operations

- `addEntity`, `removeEntity`, and `updateEntities`
- `addConstraint`, `removeConstraint`, and `constraints`
- `addDimension`, `setDimension`, and `removeDimension`
- `beginDrag` and `endDrag`
- `loadSketch`, `getSketchSnapshot`, `getGeometrySnapshot`, and `getEntity`
- `variableIdsForFeature` and `variableIdsForEntity`
- `subscribe`

Every geometry, constraint, and dimension reference uses a stable ID. A sketch snapshot has this shape:

```js
{
  entities: [],
  constraints: [],
  dimensions: []
}
```

## Solve results

Solver calls return a structured result with status, iteration and error counts, changed entity IDs, problematic constraint IDs, a human-readable message, and residual/Jacobian/linear/total timings.

Successful statuses are `converged` and `unchanged`. Invalid, failed, and maximum-iteration results do not commit partial geometry.

## Stack-scoped activation and stabilization

The version-3 Stack tree does not create solver edges. `StackSolveSystem` partitions only by explicit geometry constraints, dimensions, and extension-owned relationships. `SolverController` filters entities and residuals by the current effectively enabled Stack-ID set; a relationship is active only when its owner and every `participantStackIds` entry are enabled.

`StackActivationSystem` compiles each Stack's `enabledExpression` with the same symbols and unit semantics as `ParameterRepository`. It tracks reverse dependents by stable parameter/dimension ID and reevaluates only dirty Stack expressions. A dimension whose owner Stack is disabled is unavailable, and diagnostics report its qualified name and owner Stack rather than treating it as an unknown symbol.

Driven-dimension activation uses a bounded transaction owned by `StackActivationSystem`: evaluate dirty expressions, delta-update enabled Stack IDs, solve newly enabled explicit participation groups, refresh changed parameters, and repeat until both activation and geometry are stable. Repeated state signatures, static cycles, solve failures, and maximum-round exhaustion restore the last accepted solver geometry and effective Stack state. Runtime activation state is never serialized; native drawings retain every disabled Stack and record.

## Parameters and dimensions

Parameters are local to the active drawing and live in `ParameterRepository` (exposed through the compatibility `DimensionRepository` class). Every row contains a name and an expression; expressions may evaluate to either a number or a boolean. The expression language supports arithmetic, powers, comparisons, boolean operators, named dependencies, common math/conditional functions, degree-based trigonometry, and `mm`, `cm`, `m`, `in`, and `deg` units. Expressions are parsed without `eval`; missing names and dependency cycles are retained as row-level validation errors without corrupting the last valid solve.

Every dimension receives a stable parameter ID and a sequential default name (`d1`, `d2`, and so on). Driving dimensions contribute solver targets and may reference user, driving, or driven parameters. Driven dimensions are computed read-only parameters backed by live model measurements. Removing a dimension from the drawing removes its parameter; dimension parameters cannot be manually removed from the Parameters table.

Drawing properties also persist the drawing unit, DXF export unit, and default fillet radius. The default fillet radius starts at one drawing unit and is used when a new fillet is created.

Conditional expressions use function syntax: `if(condition, value_when_true, value_when_false)`. For example, a parameter named `enabled` can use the expression `TRUE`, and `if(enabled, 600 mm, 50 mm)` evaluates to 600 mm. `TRUE` and `FALSE` are case-insensitive. Dimension annotations display their parameter name as a prefix, such as `d1 = 600 mm`.
