import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSolverExecutionFacade,
  previewEntitiesForReplica,
  solverJacobianModeFromEnvironment,
  solverWorkerModeFromEnvironment,
} from '../../packages/paramagic-core/src/modules/solver/SolverExecutionFacade.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { SolverWorkerClient } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerClient.js';
import { SolverWorkerRuntime } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerRuntime.js';
import { DEFAULT_SOLVE_TOLERANCE } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';

const horizontalResidual = (line) => Math.abs(line.start[1] - line.end[1]) / Math.max(
  1,
  Math.hypot(line.end[0] - line.start[0], line.end[1] - line.start[1]),
);

class LoopbackWorker {
  constructor(runtime = new SolverWorkerRuntime()) {
    this.runtime = runtime;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message) {
    queueMicrotask(() => {
      const result = this.runtime.handleRequest(message);
      this.listeners.get('message')?.forEach((listener) => listener({ data: result }));
    });
  }

  terminate() {}
}

test('solver execution facade defaults to the synchronous controller path', () => {
  let workerCreations = 0;
  const facade = createSolverExecutionFacade({
    mode: 'sync',
    workerFactory: () => {
      workerCreations += 1;
      throw new Error('worker should not be created');
    },
  });
  const entity = facade.addEntity({ id: 'sync-point', type: 'point', point: [2, 3] });
  assert.equal(entity.id, 'sync-point');
  assert.deepEqual(facade.getEntity('sync-point').point, [2, 3]);
  assert.equal(workerCreations, 0);
  assert.equal(facade.executionStatus().state, 'disabled');
});

test('preview hysteresis preserves direct manipulation and suppresses only sub-threshold dependents', () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'direct-point', type: 'point', point: [0, 0] });
  controller.addEntity({ id: 'quiet-dependent', type: 'point', point: [5, 5] });
  controller.addEntity({ id: 'moving-dependent', type: 'point', point: [10, 10] });
  const filtered = previewEntitiesForReplica(controller, [
    { id: 'direct-point', type: 'point', point: [0.05, 0] },
    { id: 'quiet-dependent', type: 'point', point: [5.1, 5] },
    { id: 'moving-dependent', type: 'point', point: [10.3, 10] },
  ], ['direct-point'], 0.2);
  assert.deepEqual(filtered.map((entity) => entity.id), ['direct-point', 'moving-dependent']);
});

test('shadow facade mirrors committed and coalesced drag mutations with full parity', async () => {
  const worker = new LoopbackWorker();
  const facade = createSolverExecutionFacade({
    mode: 'shadow',
    workerClient: new SolverWorkerClient(worker),
  });
  facade.addEntity({ id: 'shadow-line', type: 'line', start: [0, 0], end: [10, 0] });
  const variableIds = facade.variableIdsForEntity('shadow-line');
  facade.beginDrag(variableIds);
  facade.updateEntities([{ id: 'shadow-line', type: 'line', start: [1, 2], end: [11, 2] }]);
  facade.updateEntities([{ id: 'shadow-line', type: 'line', start: [3, 4], end: [13, 4] }]);
  facade.endDrag();

  const parity = await facade.verifyWorkerParity();
  assert.equal(parity.matched, true);
  assert.equal(facade.executionStatus().state, 'ready');
  assert.equal(facade.executionStatus().parityError, null);
  facade.terminate();
});

test('worker-authoritative drag applies only the newest coalesced delta', async () => {
  const worker = new LoopbackWorker();
  const controller = createSolverController();
  const synchronousUpdate = controller.updateEntities.bind(controller);
  let synchronousSolveCount = 0;
  controller.updateEntities = (...args) => {
    synchronousSolveCount += 1;
    return synchronousUpdate(...args);
  };
  const facade = createSolverExecutionFacade({
    mode: 'worker-drag',
    controller,
    workerClient: new SolverWorkerClient(worker),
    checkpointInterval: 1,
  });
  facade.addEntity({ id: 'authoritative-point', type: 'point', point: [0, 0] });
  assert.equal((await facade.verifyWorkerParity()).matched, true);

  facade.beginDrag(facade.variableIdsForEntity('authoritative-point'));
  const first = facade.updateEntitiesInteractive([
    { id: 'authoritative-point', type: 'point', point: [1, 2] },
  ]);
  const second = facade.updateEntitiesInteractive([
    { id: 'authoritative-point', type: 'point', point: [3, 4] },
  ]);

  assert.deepEqual(facade.getEntity('authoritative-point').point, [0, 0]);
  const stale = await first;
  assert.equal(stale.result.status, 'stale');
  assert.equal(stale.snapshot, null);
  assert.deepEqual(facade.getEntity('authoritative-point').point, [0, 0]);
  const accepted = await second;
  assert.equal(accepted.result.status, 'unchanged');
  assert.deepEqual(facade.getEntity('authoritative-point').point, [3, 4]);
  assert.ok(facade.executionStatus().journal.checkpointRevision < facade.executionStatus().revision);
  await facade.endDragInteractive();
  assert.equal(synchronousSolveCount, 0);
  assert.equal(facade.executionStatus().journal.checkpointRevision, facade.executionStatus().revision);
  assert.equal((await facade.verifyWorkerParity()).matched, true);
  facade.terminate();
});

test('worker-authoritative constraint add and remove update the local replica without local solves', async () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'authoritative-constraint-line', type: 'line', start: [0, 0], end: [10, 3] });
  const synchronousAdd = controller.addConstraint.bind(controller);
  const synchronousRemove = controller.removeConstraint.bind(controller);
  let synchronousAddCount = 0;
  let synchronousRemoveCount = 0;
  controller.addConstraint = (...args) => {
    synchronousAddCount += 1;
    return synchronousAdd(...args);
  };
  controller.removeConstraint = (...args) => {
    synchronousRemoveCount += 1;
    return synchronousRemove(...args);
  };
  const facade = createSolverExecutionFacade({
    mode: 'worker-drag',
    controller,
    workerClient: new SolverWorkerClient(new LoopbackWorker()),
  });

  const added = await facade.addConstraintAuthoritative({
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'authoritative-constraint-line', index: 0 }],
    source: 'geometric',
  });
  assert.ok(added.constraint?.id);
  assert.equal(controller.constraints().some(({ id }) => id === added.constraint.id), true);
  const solvedLine = controller.getEntity('authoritative-constraint-line');
  assert.ok(horizontalResidual(solvedLine) < DEFAULT_SOLVE_TOLERANCE);
  assert.equal(synchronousAddCount, 0);
  assert.equal((await facade.verifyWorkerParity()).matched, true);

  const removed = await facade.removeConstraintAuthoritative(added.constraint.id);
  assert.equal(removed.removed, true);
  assert.equal(controller.constraints().some(({ id }) => id === added.constraint.id), false);
  assert.equal(synchronousRemoveCount, 0);
  assert.equal((await facade.verifyWorkerParity()).matched, true);
  facade.terminate();
});

test('constraint batches return immediately after one local solve and resynchronize the Worker', async () => {
  const controller = createSolverController();
  controller.addEntity({
    id: 'batch-rectangle',
    type: 'polygon',
    points: [[0, 0], [20, 0], [20, 10], [0, 10]],
  });
  const solve = controller.solve.bind(controller);
  let solveCount = 0;
  controller.solve = (...args) => {
    solveCount += 1;
    return solve(...args);
  };
  const facade = createSolverExecutionFacade({
    mode: 'worker-drag',
    controller,
    workerClient: new SolverWorkerClient(new LoopbackWorker()),
  });
  const segment = (index) => ({ kind: 'segment', recordId: 'batch-rectangle', index });

  const outcome = facade.applyConstraintBatch({
    constraints: [
      { type: 'Horizontal', featureRefs: [segment(0)], source: 'auto' },
      { type: 'Vertical', featureRefs: [segment(1)], source: 'auto' },
      { type: 'Horizontal', featureRefs: [segment(2)], source: 'auto' },
      { type: 'Vertical', featureRefs: [segment(3)], source: 'auto' },
    ],
  });

  assert.equal(typeof outcome?.then, 'undefined');
  assert.equal(outcome.committed, true);
  assert.equal(outcome.constraints.length, 4);
  assert.equal(solveCount, 1);
  assert.equal((await facade.verifyWorkerParity()).matched, true);
  facade.terminate();
});

test('worker-authoritative parameter updates synchronize renamed dependents without a local solve', async () => {
  const controller = createSolverController();
  const source = controller.createParameter({ name: 'sourceWidth', expression: '10' });
  const dependent = controller.createParameter({ name: 'halfWidth', expression: 'sourceWidth / 2' });
  const synchronousUpdate = controller.updateParameter.bind(controller);
  let synchronousUpdateCount = 0;
  controller.updateParameter = (...args) => {
    synchronousUpdateCount += 1;
    return synchronousUpdate(...args);
  };
  const facade = createSolverExecutionFacade({
    mode: 'worker-drag',
    controller,
    workerClient: new SolverWorkerClient(new LoopbackWorker()),
  });
  assert.equal((await facade.verifyWorkerParity()).matched, true);

  const outcome = await facade.updateParameterAuthoritative(source.id, { name: 'plateWidth' });
  assert.equal(outcome.result.status, 'unchanged');
  assert.equal(outcome.entry.name, 'plateWidth');
  assert.equal(controller.dimensions.get(dependent.id).expression, 'plateWidth / 2');
  assert.equal(synchronousUpdateCount, 0);
  assert.equal((await facade.verifyWorkerParity()).matched, true);
  facade.terminate();
});

test('worker-authoritative control updates coalesce to the newest absolute parameter value', async () => {
  const controller = createSolverController();
  const synchronousUpdate = controller.updateParameter.bind(controller);
  let synchronousUpdateCount = 0;
  controller.updateParameter = (...args) => {
    synchronousUpdateCount += 1;
    return synchronousUpdate(...args);
  };
  const facade = createSolverExecutionFacade({
    mode: 'worker-drag',
    controller,
    workerClient: new SolverWorkerClient(new LoopbackWorker()),
  });
  const control = facade.createControlParameter({ name: 'c1', expression: '0' });
  const options = { coalesceKey: `control-parameter:${control.id}` };

  const first = facade.updateParameterAuthoritative(control.id, { expression: '1' }, options);
  const second = facade.updateParameterAuthoritative(control.id, { expression: '2' }, options);
  const third = facade.updateParameterAuthoritative(control.id, { expression: '3' }, options);
  const outcomes = await Promise.all([first, second, third]);

  assert.deepEqual(outcomes.map(({ result }) => result.status), ['superseded', 'superseded', 'unchanged']);
  assert.equal(controller.dimensions.get(control.id).value, 3);
  assert.equal(synchronousUpdateCount, 0);
  assert.equal(facade.executionStatus().journal.entryCount, 2);
  assert.equal((await facade.verifyWorkerParity()).matched, true);
  facade.terminate();
});

test('worker-authoritative dimensions apply parameter and geometry deltas without a local solve', async () => {
  const controller = createSolverController();
  controller.addEntity({ id: 'authoritative-circle', type: 'circle', center: [0, 0], radius: 10 });
  const dimension = controller.addDimension({
    type: 'radius-dimension',
    subtype: 'diameter',
    dimensionMode: 'driving',
    center: [0, 0],
    radius: 10,
    measuredValue: 20,
    elbow: [20, -20],
    label: [40, -20],
    anchors: {
      center: { type: 'center', recordId: 'authoritative-circle' },
      radius: { type: 'radius', recordId: 'authoritative-circle' },
    },
  });
  const synchronousSetDimension = controller.setDimension.bind(controller);
  let synchronousSetDimensionCount = 0;
  controller.setDimension = (...args) => {
    synchronousSetDimensionCount += 1;
    return synchronousSetDimension(...args);
  };
  const facade = createSolverExecutionFacade({
    mode: 'worker-drag',
    controller,
    workerClient: new SolverWorkerClient(new LoopbackWorker()),
  });
  assert.equal((await facade.verifyWorkerParity()).matched, true);

  const result = await facade.setDimensionAuthoritative(dimension.entity.dimensionId, '50 mm');
  assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
  assert.ok(Math.abs(controller.getEntity('authoritative-circle').radius - 25) < 1e-3);
  assert.equal(controller.dimensions.get(dimension.entity.dimensionId).expression, '50 mm');
  assert.equal(synchronousSetDimensionCount, 0);
  assert.equal((await facade.verifyWorkerParity()).matched, true);
  facade.terminate();
});

function failingWorkerClient(message = 'worker crashed') {
  const worker = new LoopbackWorker();
  worker.postMessage = () => queueMicrotask(() => {
    worker.listeners.get('error')?.forEach((listener) => listener({ error: new Error(message) }));
  });
  return new SolverWorkerClient(worker);
}

test('shadow facade recreates a failed worker from the latest synchronous checkpoint', async () => {
  let workerCreations = 0;
  const facade = createSolverExecutionFacade({
    mode: 'shadow',
    workerClient: failingWorkerClient(),
    workerFactory: () => {
      workerCreations += 1;
      return new SolverWorkerClient(new LoopbackWorker());
    },
  });
  facade.addEntity({ id: 'recovered-point', type: 'point', point: [5, 6] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await facade.waitForWorkerReady();
  assert.equal(facade.executionStatus().state, 'ready');
  assert.equal(facade.executionStatus().restartCount, 1);
  assert.equal(facade.executionStatus().acceptedRevision, facade.executionStatus().revision);
  assert.equal(workerCreations, 1);
  assert.equal((await facade.verifyWorkerParity()).matched, true);
  facade.terminate();
});

test('shadow facade bounds restart attempts before retaining synchronous fallback', async () => {
  const facade = createSolverExecutionFacade({
    mode: 'shadow',
    workerClient: failingWorkerClient('initial worker crashed'),
    workerFactory: () => failingWorkerClient('replacement worker crashed'),
    maxRestartAttempts: 2,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await facade.waitForWorkerReady();
  assert.equal(facade.executionStatus().state, 'fallback');
  assert.equal(facade.executionStatus().restartCount, 2);
  assert.match(facade.executionStatus().error, /replacement worker crashed/);
  assert.equal(facade.addEntity({ id: 'fallback-point', type: 'point', point: [5, 6] }).id, 'fallback-point');
  assert.deepEqual(facade.getEntity('fallback-point').point, [5, 6]);
});

test('solver worker mode defaults to authoritative drag with explicit sync and shadow overrides', () => {
  assert.equal(solverWorkerModeFromEnvironment({}), 'worker-drag');
  assert.equal(solverWorkerModeFromEnvironment({ PARAMAGIC_SOLVER_WORKER_MODE: 'sync' }), 'sync');
  assert.equal(solverWorkerModeFromEnvironment({ PARAMAGIC_SOLVER_WORKER_MODE: 'shadow' }), 'shadow');
  assert.equal(solverWorkerModeFromEnvironment({ PARAMAGIC_SOLVER_WORKER_MODE: 'worker-drag' }), 'worker-drag');
  assert.equal(solverWorkerModeFromEnvironment({ location: { search: '?solverWorker=sync' } }), 'sync');
  assert.equal(solverWorkerModeFromEnvironment({ location: { search: '?solverWorker=shadow' } }), 'shadow');
  assert.equal(solverWorkerModeFromEnvironment({ location: { search: '?solverWorker=drag' } }), 'worker-drag');
  assert.equal(solverWorkerModeFromEnvironment({ location: { search: '?solverWorker=on' } }), 'worker-drag');
  assert.equal(solverJacobianModeFromEnvironment({}), 'blocks');
  assert.equal(solverJacobianModeFromEnvironment({ PARAMAGIC_SOLVER_JACOBIAN_MODE: 'dense' }), 'dense');
  assert.equal(solverJacobianModeFromEnvironment({ PARAMAGIC_SOLVER_JACOBIAN_MODE: 'blocks' }), 'blocks');
  assert.equal(solverJacobianModeFromEnvironment({ location: { search: '?solverJacobian=blocks' } }), 'blocks');
  assert.equal(solverJacobianModeFromEnvironment({ location: { search: '?solverJacobian=dense' } }), 'dense');
});

test('solver facade exposes guarded block Jacobian configuration without changing its execution mode', () => {
  const facade = createSolverExecutionFacade({ mode: 'sync', jacobianMode: 'blocks' });
  assert.equal(facade.executionStatus().mode, 'sync');
  assert.equal(facade.executionStatus().jacobianMode, 'blocks');
  assert.equal(facade.controller.jacobianMode, 'blocks');
});
