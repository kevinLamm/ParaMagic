import test from 'node:test';
import assert from 'node:assert/strict';
import { ConstraintGraph, constraintVariableIds } from '../../packages/paramagic-core/src/modules/solver/ConstraintGraph.js';
import { solveConstraintScope } from '../../packages/paramagic-core/src/modules/solver/ComponentSolver.js';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { DimensionRepository, solveLevenbergMarquardt } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { CANVAS_ORIGIN_RECORD_ID } from '../../packages/paramagic-core/src/modules/CanvasOrigin.js';

function addHorizontalLine(model, id, xOffset = 0) {
  model.addEntity({ id, type: 'line', start: [xOffset, 0], end: [xOffset + 10, 3] });
  model.addConstraint({
    id: `horizontal-${id}`,
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: id, index: 0 }],
  });
}

function componentSignature(graph) {
  return [...graph.components.values()]
    .map((component) => [...component.variableIds].sort().join('|'))
    .sort();
}

test('constraint graph separates disconnected geometry and merges bridged components', () => {
  const model = new SketchModel();
  addHorizontalLine(model, 'line-a', 0);
  addHorizontalLine(model, 'line-b', 30);

  let graph = new ConstraintGraph(model);
  assert.equal(graph.diagnostics().componentCount, 2);
  const diagnostics = graph.diagnostics({ registry: new ConstraintRegistry(), dimensions: new DimensionRepository() });
  assert.equal(diagnostics.residualCount, 2);
  assert.equal(diagnostics.variableCount, 8);
  assert.equal(graph.scopeForSeeds({ entityIds: ['line-a'] }).variableIds.size, 4);

  model.addConstraint({
    id: 'bridge',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'line-a', index: 2 },
      { kind: 'point', recordId: 'line-b', index: 0 },
    ],
  });
  assert.equal(graph.addConstraint('bridge'), true);
  assert.equal(graph.diagnostics().componentCount, 1);
  assert.equal(graph.scopeForSeeds({ constraintIds: ['bridge'] }).variableIds.size, 8);

  model.removeConstraint('bridge');
  assert.equal(graph.removeConstraint('bridge').size, 8);
  assert.equal(graph.diagnostics().componentCount, 2);
});

test('an active Stack solve includes inactive geometry only through transitive constraints', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'active-line', type: 'line', stackId: 'stack-active', start: [0, 0], end: [10, 3] });
  model.addEntity({ id: 'tied-inactive-line', type: 'line', stackId: 'stack-inactive', start: [10, 3], end: [20, 7] });
  model.addEntity({ id: 'unrelated-inactive-line', type: 'line', stackId: 'stack-inactive', start: [40, 0], end: [50, 4] });
  model.addConstraint({
    id: 'active-to-inactive',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'active-line', index: 2 },
      { kind: 'point', recordId: 'tied-inactive-line', index: 0 },
    ],
  });
  model.addConstraint({
    id: 'inactive-horizontal',
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'unrelated-inactive-line', index: 0 }],
  });

  const scope = new ConstraintGraph(model).scopeForSeeds({ entityIds: ['active-line'] });
  assert.deepEqual([...scope.entityIds].sort(), ['active-line', 'tied-inactive-line']);
  assert.equal(scope.entityIds.has('unrelated-inactive-line'), false);
  assert.equal(scope.constraintIds.has('active-to-inactive'), true);
  assert.equal(scope.constraintIds.has('inactive-horizontal'), false);
});

test('interactive updates return only the edited dependency component for presentation', () => {
  const controller = createSolverController();
  addHorizontalLine(controller.model, 'active-line', 0);
  addHorizontalLine(controller.model, 'inactive-unrelated-line', 30);

  const outcome = controller.updateEntities([{
    ...controller.getEntity('active-line'),
    start: [5, 0],
    end: [15, 3],
  }]);

  assert.equal(outcome.snapshotMode, 'delta');
  assert.deepEqual(outcome.snapshot.map(({ id }) => id), ['active-line']);
  assert.ok(controller.getEntity('inactive-unrelated-line'));
});

test('record-scoped constraint lookup avoids enumerating unrelated constraints', () => {
  const controller = createSolverController();
  addHorizontalLine(controller.model, 'line-a', 0);
  addHorizontalLine(controller.model, 'line-b', 30);
  assert.deepEqual(
    controller.constraintsForRecordIds(['line-a']).map(({ id }) => id),
    ['horizontal-line-a'],
  );
});

test('entity removal incrementally deletes its variables and splits only the touched component', () => {
  const controller = createSolverController();
  addHorizontalLine(controller.model, 'line-a', 0);
  addHorizontalLine(controller.model, 'line-b', 30);
  addHorizontalLine(controller.model, 'line-c', 60);
  controller.model.addConstraint({
    id: 'bridge',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'line-a', index: 2 },
      { kind: 'point', recordId: 'line-b', index: 0 },
    ],
  });
  const graph = controller.getConstraintGraph();
  const untouchedComponentId = graph.componentForVariable.get('line-c:start.x');
  const untouchedComponent = graph.components.get(untouchedComponentId);
  graph.rebuild = () => {
    throw new Error('entity removal should not rebuild the full graph');
  };

  assert.equal(controller.removeEntity('line-b'), true);
  assert.equal(controller.constraintGraph, graph);
  assert.equal(graph.diagnostics().componentCount, 2);
  assert.equal(graph.diagnostics().variableCount, 8);
  assert.equal(graph.scopeForSeeds({ entityIds: ['line-b'] }), null);
  assert.equal(graph.scopeForSeeds({ entityIds: ['line-a'] }).variableIds.size, 4);
  assert.equal(graph.components.get(untouchedComponentId), untouchedComponent);
  assert.equal(graph.constraintVariables.has('constraint:bridge'), false);
  assert.equal(graph.constraintVariables.has('constraint:horizontal-line-b'), false);
});

test('curve point insertion remaps indexed constraints without rebuilding unrelated components', () => {
  const controller = createSolverController();
  controller.model.addEntity({ id: 'curve-a', type: 'curve', points: [[0, 0], [5, 5], [10, 0]] });
  controller.model.addEntity({ id: 'marker-a', type: 'point', point: [10, 0] });
  addHorizontalLine(controller.model, 'line-unrelated', 40);
  controller.model.addConstraint({
    id: 'curve-point-link',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'curve-a', index: 2 },
      { kind: 'point', recordId: 'marker-a', index: 0 },
    ],
  });
  controller.setDimensionAnnotation('curve-dimension', {
    dimensionId: 'curve-dimension',
    anchors: { start: { type: 'point', recordId: 'curve-a', index: 2 } },
  });
  controller.setDimensionAnnotation('unrelated-dimension', {
    dimensionId: 'unrelated-dimension',
    anchors: { start: { type: 'point', recordId: 'line-unrelated', index: 0 } },
  });
  const unrelatedAnnotation = controller.dimensionAnnotations.get('unrelated-dimension');
  const graph = controller.getConstraintGraph();
  const unrelatedComponentId = graph.componentForVariable.get('line-unrelated:start.x');
  const unrelatedComponent = graph.components.get(unrelatedComponentId);
  graph.rebuild = () => {
    throw new Error('curve remapping should not rebuild the full graph');
  };

  controller.updateCurveControlPoints(
    'curve-a',
    [[0, 0], [2, 3], [5, 5], [10, 0]],
    { type: 'insert', index: 1 },
  );

  const constraint = controller.model.constraints.get('curve-point-link');
  assert.equal(constraint.featureRefs[0].index, 3);
  assert.equal(controller.constraintGraph, graph);
  assert.equal(graph.variablesById.has('curve-a:p3.x'), true);
  assert.equal(graph.constraintVariables.get('constraint:curve-point-link').has('curve-a:p3.x'), true);
  assert.equal(graph.constraintVariables.get('constraint:curve-point-link').has('curve-a:p2.x'), false);
  assert.equal(graph.components.get(unrelatedComponentId), unrelatedComponent);
  assert.equal(controller.dimensionAnnotations.get('curve-dimension').anchors.start.index, 3);
  assert.equal(controller.dimensionAnnotations.get('unrelated-dimension'), unrelatedAnnotation);
  assert.deepEqual(componentSignature(graph), componentSignature(new ConstraintGraph(controller.model)));

  controller.updateCurveControlPoints(
    'curve-a',
    [[0, 0], [5, 5], [10, 0]],
    { type: 'delete', index: 1 },
  );
  assert.equal(controller.model.constraints.get('curve-point-link').featureRefs[0].index, 2);
  assert.equal(graph.variablesById.has('curve-a:p3.x'), false);
  assert.deepEqual(componentSignature(graph), componentSignature(new ConstraintGraph(controller.model)));
});

test('derived feature source changes reconnect only constraints that reference that feature', () => {
  const controller = createSolverController();
  controller.model.addEntity({ id: 'source-a', type: 'line', start: [0, 0], end: [10, 0] });
  controller.model.addEntity({ id: 'source-b', type: 'line', start: [0, 0], end: [0, 10] });
  controller.model.addEntity({ id: 'source-c', type: 'line', start: [20, 0], end: [20, 10] });
  controller.model.addEntity({ id: 'marker', type: 'point', point: [2, 2] });
  controller.model.setDerivedEntity({
    id: 'fillet-a',
    type: 'fillet',
    sourceA: { recordId: 'source-a', index: 0 },
    sourceB: { recordId: 'source-b', index: 0 },
    radius: 2,
  });
  controller.model.addConstraint({
    id: 'fillet-link',
    type: 'Point-on Fillet',
    featureRefs: [
      { kind: 'point', recordId: 'marker', index: 0 },
      { kind: 'arc', recordId: 'fillet-a' },
    ],
  });
  const graph = controller.getConstraintGraph();
  graph.rebuild = () => {
    throw new Error('derived feature remapping should not rebuild the full graph');
  };

  controller.setDerivedEntity({
    id: 'fillet-a',
    type: 'fillet',
    sourceA: { recordId: 'source-a', index: 0 },
    sourceB: { recordId: 'source-c', index: 0 },
    radius: 3,
  });

  const linkedOwners = new Set([...graph.scopeForSeeds({ constraintIds: ['fillet-link'] }).variableIds]
    .map((id) => graph.variablesById.get(id)?.owner));
  assert.deepEqual(linkedOwners, new Set(['source-a', 'source-c', 'marker']));
  assert.equal(graph.hasDerivedDependency('source-b'), false);
  assert.equal(graph.hasDerivedDependency('source-c'), true);
  assert.deepEqual(graph.constraintIdsForRecord('fillet-a'), new Set(['fillet-link']));
  assert.deepEqual(componentSignature(graph), componentSignature(new ConstraintGraph(controller.model)));

  assert.equal(controller.removeDerivedEntity('fillet-a'), true);
  assert.equal(controller.constraintGraph, graph);
  assert.equal(controller.model.constraints.has('fillet-link'), false);
  assert.equal(graph.constraintVariables.has('constraint:fillet-link'), false);
  assert.deepEqual(graph.constraintIdsForRecord('fillet-a'), new Set());
  assert.deepEqual(componentSignature(graph), componentSignature(new ConstraintGraph(controller.model)));
});

test('constraint graph includes anchor, meta-variable, intrinsic arc, and derived-fillet dependencies', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [10, 0] });
  model.addEntity({ id: 'line-b', type: 'line', start: [10, 0], end: [10, 10] });
  model.addEntity({ id: 'point-a', type: 'point', point: [2, 3] });
  model.addEntity({ id: 'arc-a', type: 'arc', start: [20, 0], arcPoint: [25, 5], end: [30, 0] });
  model.setDerivedEntity({
    id: 'fillet-a',
    type: 'fillet',
    sourceA: { recordId: 'line-a', index: 0 },
    sourceB: { recordId: 'line-b', index: 0 },
    radius: 2,
  });

  const anchorConstraint = {
    id: 'distance-a',
    type: 'Distance',
    featureRefs: [],
    anchors: {
      start: { type: 'segment-start', recordId: 'line-a', index: 0 },
      end: { type: 'point', recordId: 'point-a', index: 0 },
    },
    value: 5,
  };
  assert.equal(constraintVariableIds(model, anchorConstraint).size, 6);

  const metaVariable = model.binding('point-a').allVariables()[0];
  assert.deepEqual([...constraintVariableIds(model, { parameterRef: metaVariable.id })], [metaVariable.id]);

  const filletVariables = constraintVariableIds(model, {
    featureRefs: [
      { kind: 'point', recordId: 'point-a', index: 0 },
      { kind: 'fillet', recordId: 'fillet-a' },
    ],
  });
  assert.equal(filletVariables.size, 10);

  const graph = new ConstraintGraph(model);
  const arcScope = graph.scopeForSeeds({ entityIds: ['arc-a'] });
  assert.equal(arcScope.variableIds.size, 6);
  assert.deepEqual([...arcScope.intrinsicEntityIds], ['arc-a']);
});

test('a scoped model solves only its selected component using authoritative variables', () => {
  const model = new SketchModel();
  addHorizontalLine(model, 'line-a', 0);
  addHorizontalLine(model, 'line-b', 30);
  const graph = new ConstraintGraph(model);
  const scope = graph.scopeForSeeds({ entityIds: ['line-a'] });
  const beforeB = model.entity('line-b');

  const result = solveLevenbergMarquardt({
    model: graph.scopedModel(scope),
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
    tolerance: 1e-8,
  });

  assert.equal(result.status, 'converged');
  assert.deepEqual(result.changedEntityIds, ['line-a']);
  assert.ok(Math.abs(model.entity('line-a').start[1] - model.entity('line-a').end[1]) < 1e-8);
  assert.deepEqual(model.entity('line-b'), beforeB);
});

test('a free-floating component uses and releases a translation gauge during solving', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'gauge-line-a', type: 'line', start: [0, 0], end: [10, 0] });
  model.addEntity({ id: 'gauge-line-b', type: 'line', start: [20, 10], end: [30, 10] });
  model.addConstraint({
    id: 'gauge-horizontal-a',
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'gauge-line-a', index: 0 }],
  });
  model.addConstraint({
    id: 'gauge-horizontal-b',
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'gauge-line-b', index: 0 }],
  });
  model.addConstraint({
    id: 'gauge-vertical-distance',
    type: 'Vertical Distance',
    anchors: {
      start: { type: 'segment-start', recordId: 'gauge-line-a', index: 0 },
      end: { type: 'segment-start', recordId: 'gauge-line-b', index: 0 },
    },
    value: 1000,
    orientation: 1,
  });
  const graph = new ConstraintGraph(model);
  const scopedModel = graph.scopedModel(graph.scopeForSeeds({ constraintIds: ['gauge-vertical-distance'] }));
  const anchoredPoint = [...model.entity('gauge-line-a').start];
  const constraintIds = [...model.constraints.keys()];

  const result = solveConstraintScope({
    model: scopedModel,
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
    jacobianMode: 'blocks',
    matrixFreeVariableThreshold: 0,
    tolerance: 1e-8,
  });

  assert.equal(result.status, 'converged');
  assert.equal(result.jacobianStats.mode, 'matrix-free');
  assert.deepEqual(result.translationGaugeVariableIds, [
    'gauge-line-a:start.x',
    'gauge-line-a:start.y',
  ]);
  assert.deepEqual(model.entity('gauge-line-a').start, anchoredPoint);
  assert.ok(model.allVariables().every((variable) => variable.locked === false));
  assert.deepEqual([...model.constraints.keys()], constraintIds);
  assert.equal([...model.constraints.values()].some(({ type }) => type === 'Fixed'), false);
});

test('explicit drag locks take precedence over a temporary translation gauge', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'locked-point', type: 'point', point: [10, 20] });
  model.addEntity({ id: 'moving-point', type: 'point', point: [40, 50] });
  model.addConstraint({
    id: 'locked-coincident',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'locked-point', index: 0 },
      { kind: 'point', recordId: 'moving-point', index: 0 },
    ],
  });
  model.variableById('locked-point:point.x').locked = true;
  model.variableById('locked-point:point.y').locked = true;
  const graph = new ConstraintGraph(model);
  const result = solveConstraintScope({
    model: graph.scopedModel(graph.scopeForSeeds({ constraintIds: ['locked-coincident'] })),
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
    jacobianMode: 'blocks',
    matrixFreeVariableThreshold: 0,
    tolerance: 1e-8,
  });

  assert.equal(result.status, 'converged');
  assert.equal(result.translationGaugeVariableIds, undefined);
  assert.deepEqual(model.entity('locked-point').point, [10, 20]);
  assert.ok(Math.abs(model.entity('moving-point').point[0] - 10) < 1e-8);
  assert.ok(Math.abs(model.entity('moving-point').point[1] - 20) < 1e-8);
  assert.equal(model.variableById('locked-point:point.x').locked, true);
  assert.equal(model.variableById('locked-point:point.y').locked, true);
});

test('a canvas-origin relationship takes precedence over a temporary translation gauge', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'origin-point', type: 'point', point: [18, -11] });
  model.addConstraint({
    id: 'origin-coincident',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: CANVAS_ORIGIN_RECORD_ID, index: 0 },
      { kind: 'point', recordId: 'origin-point', index: 0 },
    ],
  });
  const graph = new ConstraintGraph(model);
  const result = solveConstraintScope({
    model: graph.scopedModel(graph.scopeForSeeds({ constraintIds: ['origin-coincident'] })),
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
    jacobianMode: 'blocks',
    matrixFreeVariableThreshold: 0,
    tolerance: 1e-8,
  });

  assert.equal(result.status, 'converged');
  assert.equal(result.translationGaugeVariableIds, undefined);
  assert.ok(Math.abs(model.entity('origin-point').point[0]) < 1e-8);
  assert.ok(Math.abs(model.entity('origin-point').point[1]) < 1e-8);
});

test('an explicit Fixed constraint takes precedence over a temporary translation gauge', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'fixed-line', type: 'line', start: [5, 7], end: [20, 14] });
  model.addConstraint({
    id: 'fixed-start',
    type: 'Fixed',
    featureRefs: [{ kind: 'point', recordId: 'fixed-line', index: 0 }],
  });
  model.addConstraint({
    id: 'fixed-horizontal',
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'fixed-line', index: 0 }],
  });
  const graph = new ConstraintGraph(model);
  const result = solveConstraintScope({
    model: graph.scopedModel(graph.scopeForSeeds({ constraintIds: ['fixed-horizontal'] })),
    registry: new ConstraintRegistry(),
    dimensions: new DimensionRepository(),
    jacobianMode: 'blocks',
    matrixFreeVariableThreshold: 0,
    tolerance: 1e-8,
  });

  assert.equal(result.status, 'converged');
  assert.equal(result.translationGaugeVariableIds, undefined);
  assert.deepEqual(model.entity('fixed-line').start, [5, 7]);
  assert.ok(Math.abs(model.entity('fixed-line').end[1] - 7) < 1e-8);
});

test('controller entity updates solve only the seeded connected component', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [10, 0] });
  controller.addEntity({ id: 'line-b', type: 'line', start: [30, 0], end: [40, 0] });
  controller.addConstraint({
    id: 'horizontal-a',
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'line-a', index: 0 }],
  });
  controller.addConstraint({
    id: 'horizontal-b',
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'line-b', index: 0 }],
  });

  controller.model.updateEntity({ id: 'line-b', type: 'line', start: [30, 0], end: [40, 4] });
  const beforeB = controller.getEntity('line-b');
  const snapshot = controller.model.snapshot.bind(controller.model);
  let fullSnapshotCount = 0;
  controller.model.snapshot = () => {
    fullSnapshotCount += 1;
    return snapshot();
  };
  const { result } = controller.updateEntities([
    { id: 'line-a', type: 'line', start: [0, 0], end: [10, 3] },
  ]);

  assert.equal(result.status, 'converged');
  assert.equal(result.solveScope.mode, 'component');
  assert.equal(result.solveScope.variableCount, 4);
  assert.deepEqual(result.changedEntityIds, ['line-a']);
  assert.deepEqual(controller.getEntity('line-b'), beforeB);
  assert.equal(fullSnapshotCount, 1, 'interactive output should use a delta; only emission may clone the full drawing');
});

test('dimension edits snapshot and solve only their affected component', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'circle-a', type: 'circle', center: [0, 0], radius: 10 });
  controller.addEntity({ id: 'circle-b', type: 'circle', center: [50, 0], radius: 12 });
  const dimensionA = controller.addDimension({
    type: 'radius-dimension',
    subtype: 'diameter',
    dimensionMode: 'driving',
    center: [0, 0],
    radius: 10,
    measuredValue: 20,
    anchors: {
      center: { type: 'center', recordId: 'circle-a' },
      radius: { type: 'radius', recordId: 'circle-a' },
    },
  });
  controller.addDimension({
    type: 'radius-dimension',
    subtype: 'diameter',
    dimensionMode: 'driving',
    center: [50, 0],
    radius: 12,
    measuredValue: 24,
    anchors: {
      center: { type: 'center', recordId: 'circle-b' },
      radius: { type: 'radius', recordId: 'circle-b' },
    },
  });
  const beforeB = controller.getEntity('circle-b');
  const snapshot = controller.model.snapshot.bind(controller.model);
  let fullSnapshotCount = 0;
  controller.model.snapshot = () => {
    fullSnapshotCount += 1;
    return snapshot();
  };

  const result = controller.setDimension(dimensionA.entity.dimensionId, '40 mm');

  assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
  assert.equal(result.solveScope.mode, 'component');
  assert.equal(result.solveScope.entityCount, 1);
  assert.ok(Math.abs(controller.getEntity('circle-a').radius - 20) < 20e-3);
  assert.deepEqual(controller.getEntity('circle-b'), beforeB);
  assert.equal(fullSnapshotCount, 1, 'only the emission snapshot should clone the full drawing');
});

test('global solves partition disconnected constrained geometry into independent components', () => {
  const controller = createSolverController({ jacobianMode: 'blocks' });
  const constraints = [];
  for (let index = 0; index < 80; index += 1) {
    const recordId = `partitioned-line-${index}`;
    controller.model.addEntity({
      id: recordId,
      type: 'line',
      start: [index * 20, 0],
      end: [index * 20 + 10, 3],
    });
    constraints.push({
      id: `partitioned-horizontal-${index}`,
      type: 'Horizontal',
      featureRefs: [{ kind: 'segment', recordId, index: 0 }],
    });
  }
  controller.model.addConstraints(constraints);

  const result = controller.solve({ fullSolve: true, tolerance: 1e-8 });

  assert.equal(result.status, 'converged');
  assert.equal(result.solveScope.mode, 'components');
  assert.equal(result.solveScope.constrainedComponentCount, 80);
  assert.equal(result.solveScope.largestVariableCount, 4);
  assert.equal(result.jacobianStats.mode, 'blocks');
  assert.equal(result.jacobianStats.analyticalBlocks, 80);
  for (let index = 0; index < 80; index += 1) {
    const line = controller.getEntity(`partitioned-line-${index}`);
    assert.ok(Math.abs(line.start[1] - line.end[1]) < 1e-8);
  }
});

test('global component solving rolls back earlier components when a later component fails', () => {
  const controller = createSolverController({ jacobianMode: 'blocks' });
  controller.model.addEntity({ id: 'rollback-line', type: 'line', start: [0, 0], end: [10, 3] });
  controller.model.addEntity({ id: 'rollback-point-a', type: 'point', point: [30, 0] });
  controller.model.addEntity({ id: 'rollback-point-b', type: 'point', point: [40, 0] });
  controller.model.addConstraints([
    {
      id: 'rollback-horizontal',
      type: 'Horizontal',
      featureRefs: [{ kind: 'segment', recordId: 'rollback-line', index: 0 }],
    },
    {
      id: 'rollback-fixed-a',
      type: 'Fixed',
      featureRefs: [{ kind: 'point', recordId: 'rollback-point-a', index: 0 }],
    },
    {
      id: 'rollback-fixed-b',
      type: 'Fixed',
      featureRefs: [{ kind: 'point', recordId: 'rollback-point-b', index: 0 }],
    },
    {
      id: 'rollback-conflict',
      type: 'Coincident',
      featureRefs: [
        { kind: 'point', recordId: 'rollback-point-a', index: 0 },
        { kind: 'point', recordId: 'rollback-point-b', index: 0 },
      ],
    },
  ]);
  const before = controller.getGeometrySnapshot();

  const result = controller.solve({ fullSolve: true });

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.changedEntityIds, []);
  assert.deepEqual(controller.getGeometrySnapshot(), before);
  assert.equal(result.solveScope.mode, 'components');
  assert.equal(result.solveScope.solvedComponentCount, 2);
});

test('drawing load restores constraints in bulk and indexes variables directly', () => {
  const controller = createSolverController({ jacobianMode: 'blocks' });
  const originalRefresh = controller.model.refreshFixedVariables.bind(controller.model);
  let refreshCount = 0;
  controller.model.refreshFixedVariables = (...args) => {
    refreshCount += 1;
    return originalRefresh(...args);
  };
  const entities = Array.from({ length: 200 }, (_, index) => ({
    id: `loaded-fixed-point-${index}`,
    type: 'point',
    point: [index, index % 5],
  }));
  const constraints = entities.map((entity, index) => ({
    id: `loaded-fixed-${index}`,
    type: 'Fixed',
    fixedPoint: [...entity.point],
    featureRefs: [{ kind: 'point', recordId: entity.id, index: 0 }],
  }));

  const result = controller.loadSketch({ entities, constraints });

  assert.equal(result.status, 'unchanged');
  assert.equal(result.solveScope.mode, 'components');
  assert.equal(result.solveScope.constrainedComponentCount, 200);
  assert.equal(refreshCount, 1);
  assert.equal(controller.model.variableById('loaded-fixed-point-199:point.x')?.owner, 'loaded-fixed-point-199');
});

test('the sketch model variable index tracks geometry variable additions and removals', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'indexed-curve', type: 'curve', points: [[0, 0], [5, 5], [10, 0]] });
  const stableVariable = model.variableById('indexed-curve:p2.x');

  model.updateEntity({ id: 'indexed-curve', type: 'curve', points: [[0, 0], [2, 3], [5, 5], [10, 0]] });
  assert.equal(model.variableById('indexed-curve:p2.x'), stableVariable);
  assert.equal(model.variableById('indexed-curve:p3.y')?.owner, 'indexed-curve');

  model.updateEntity({ id: 'indexed-curve', type: 'curve', points: [[0, 0], [10, 0]] });
  assert.equal(model.variableById('indexed-curve:p3.y'), null);
  model.removeEntity('indexed-curve');
  assert.equal(model.variableById('indexed-curve:p0.x'), null);
});
