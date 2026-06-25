# ParaMagic Solver Architecture

ParaMagic uses a DOM-independent geometric constraint solver in `src/modules/solver`. SVG records are views of solver-owned geometry snapshots.

## Pipeline

1. `GeometryBindings` converts drawing entities into stable scalar `Variable` objects.
2. `SketchModel` stores geometry, constraints, and stable references.
3. `ConstraintRegistry` flattens enabled constraint residuals into an error vector.
4. `Jacobian` computes finite-difference derivatives for active variables.
5. `LevenbergMarquardt` solves damped normal equations with partial-pivot Gaussian elimination.
6. `SolverController` commits a converged snapshot or restores the previous valid geometry.
7. `infiniteCanvas` applies the accepted snapshot and refreshes anchored dimensions.

Fixed variables and variables controlled directly during a drag are omitted from the active state vector. Drag updates are limited to one solve per animation frame.

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

## Parameters and dimensions

Parameters are local to the active drawing and live in `ParameterRepository` (exposed through the compatibility `DimensionRepository` class). User rows can be numeric Expressions or Yes/No values. The expression language supports arithmetic, powers, comparisons, boolean operators, named dependencies, common math/conditional functions, degree-based trigonometry, and `mm`, `cm`, `m`, `in`, and `deg` units. Expressions are parsed without `eval`; missing names and dependency cycles are retained as row-level validation errors without corrupting the last valid solve.

Every dimension receives a stable parameter ID and a sequential default name (`d1`, `d2`, and so on). Driving dimensions contribute solver targets and may reference user, driving, or driven parameters. Driven dimensions are computed read-only parameters backed by live model measurements. Removing a dimension from the drawing removes its parameter; dimension parameters cannot be manually removed from the Parameters table.

Conditional expressions use function syntax: `if(condition, value_when_true, value_when_false)`. For example, `if(test_YN, 600 mm, 50 mm)` evaluates to 600 mm when the `test_YN` checkbox is checked and 50 mm otherwise. Yes/No rows are edited with a checkbox in the Parameters table. Dimension annotations display their parameter name as a prefix, such as `d1 = 600 mm`.
