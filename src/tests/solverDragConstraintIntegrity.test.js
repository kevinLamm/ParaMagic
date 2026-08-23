import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { SolverWorkerRuntime } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerRuntime.js';
import { createSolverWorkerRequest } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerProtocol.js';

test('interactive drag never presents partially satisfied constraints', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'drag-line', type: 'line', start: [0, 0], end: [10, 0] });
  assert.ok(controller.addConstraint({
    id: 'drag-horizontal',
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'drag-line', index: 0 }],
  }).constraint);

  const lockedEnd = controller.variableIdsForFeature({
    kind: 'point',
    recordId: 'drag-line',
    index: 2,
  });
  controller.beginDrag(lockedEnd);
  const preview = controller.updateEntities([{
    id: 'drag-line',
    type: 'line',
    start: [0, 0],
    end: [10, 10],
  }], {
    solveOptions: {
      solveMode: 'interactive',
      maxIterations: 1,
      timeBudgetMs: Infinity,
    },
  });

  assert.equal(preview.result.status, 'preview');
  assert.equal(preview.result.restoredInteractivePreview, true);
  assert.deepEqual(controller.getEntity('drag-line'), {
    id: 'drag-line',
    type: 'line',
    start: [0, 0],
    end: [10, 0],
  });

  const committed = controller.endDrag();
  assert.ok(['converged', 'unchanged'].includes(committed.status), committed.message);
  const line = controller.getEntity('drag-line');
  assert.ok(Math.abs(line.start[1] - line.end[1]) < 1e-8);
  assert.deepEqual(line.end, [10, 10]);
});

test('worker drag finalization strictly solves the latest requested geometry', () => {
  const runtime = new SolverWorkerRuntime({
    interactiveSolveOptions: { maxIterations: 1, timeBudgetMs: Infinity },
  });
  runtime.handleRequest(createSolverWorkerRequest({
    requestId: 1,
    generation: 0,
    type: 'load-sketch',
    payload: {
      snapshot: {
        entities: [{ id: 'worker-drag-line', type: 'line', start: [0, 0], end: [10, 0] }],
        constraints: [{
          id: 'worker-drag-horizontal',
          type: 'Horizontal',
          featureRefs: [{ kind: 'segment', recordId: 'worker-drag-line', index: 0 }],
        }],
      },
    },
  }));
  const lockedVariableIds = [
    'worker-drag-line:end.x',
    'worker-drag-line:end.y',
  ];
  const preview = runtime.handleRequest(createSolverWorkerRequest({
    requestId: 2,
    generation: 1,
    type: 'drag-update',
    payload: {
      entities: [{ id: 'worker-drag-line', type: 'line', start: [0, 0], end: [10, 10] }],
      lockedVariableIds,
      previewConstraintTolerance: 0.2,
    },
  }));
  assert.equal(preview.status, 'preview');
  assert.equal(preview.diagnostics.restoredInteractivePreview, false);
  const [previewLine] = preview.changedEntities;
  const previewResidual = Math.abs(previewLine.start[1] - previewLine.end[1]);
  assert.ok(previewResidual > 1e-4, 'fixture must exercise an approximate preview');
  assert.ok(previewResidual < 0.2, `preview residual ${previewResidual} exceeded its presentation tolerance`);
  assert.deepEqual(previewLine.end, [10, 10]);

  const committed = runtime.handleRequest(createSolverWorkerRequest({
    requestId: 3,
    generation: 1,
    type: 'solve',
    payload: { options: { seedVariableIds: lockedVariableIds } },
  }));
  assert.ok(['converged', 'unchanged'].includes(committed.status), committed.message);
  assert.equal(committed.diagnostics.solveMode, 'final');
  assert.equal(committed.changedEntities.length, 1);
  const [line] = committed.changedEntities;
  assert.ok(Math.abs(line.start[1] - line.end[1]) < 1e-8);
  assert.deepEqual(line.end, [10, 10]);
});

test('drag finalization restores valid geometry when the requested move conflicts with constraints', () => {
  const controller = createSolverController();
  controller.loadSketch({
    entities: [
      { id: 'fixed-anchor', type: 'point', point: [0, 0] },
      { id: 'blocked-drag-point', type: 'point', point: [0, 0] },
    ],
    constraints: [
      {
        id: 'fixed-anchor-position',
        type: 'Fixed',
        fixedPoint: [0, 0],
        featureRefs: [{ kind: 'point', recordId: 'fixed-anchor', index: 0 }],
      },
      {
        id: 'blocked-drag-coincident',
        type: 'Coincident',
        featureRefs: [
          { kind: 'point', recordId: 'fixed-anchor', index: 0 },
          { kind: 'point', recordId: 'blocked-drag-point', index: 0 },
        ],
      },
    ],
  });
  const lockedPoint = controller.variableIdsForEntity('blocked-drag-point');
  controller.beginDrag(lockedPoint);
  const preview = controller.updateEntities([{
    id: 'blocked-drag-point',
    type: 'point',
    point: [20, 20],
  }], {
    solveOptions: { solveMode: 'interactive', maxIterations: 1, timeBudgetMs: Infinity },
  });
  assert.ok(!['converged', 'unchanged'].includes(preview.result.status));

  const committed = controller.endDrag();
  assert.ok(!['converged', 'unchanged'].includes(committed.status));
  assert.deepEqual(controller.getEntity('blocked-drag-point').point, [0, 0]);
  assert.deepEqual(controller.getEntity('fixed-anchor').point, [0, 0]);
});
