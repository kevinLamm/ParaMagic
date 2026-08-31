import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSolverWorkerClient, SolverWorkerClient } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerClient.js';
import {
  createSolverWorkerRequest,
  createSolverWorkerResult,
  validateSolverWorkerRequest,
  validateSolverWorkerResult,
} from '../../packages/paramagic-core/src/modules/solver/SolverWorkerProtocol.js';
import { SolverWorkerRuntime } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerRuntime.js';
import { DEFAULT_SOLVE_TOLERANCE } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { isUuid } from '../../packages/paramagic-core/src/modules/IdentitySystem.js';

const horizontalResidual = (line) => Math.abs(line.start[1] - line.end[1]) / Math.max(
  1,
  Math.hypot(line.end[0] - line.start[0], line.end[1] - line.start[1]),
);

test('solver worker protocol validates versioned request envelopes', () => {
  const request = createSolverWorkerRequest({
    requestToken: 4,
    generation: 7,
    type: 'solve',
    payload: { options: { fullSolve: true } },
  });
  assert.equal(validateSolverWorkerRequest(request), request);
  assert.throws(
    () => validateSolverWorkerRequest({ ...request, version: 99 }),
    /Unsupported solver worker protocol version/,
  );
  assert.throws(
    () => validateSolverWorkerRequest({ ...request, type: 'unknown-command' }),
    /Unsupported solver worker command/,
  );
  assert.throws(
    () => createSolverWorkerRequest({ requestToken: 5, generation: 7, type: 'drag-update', payload: {} }),
    /requires an entities array/,
  );
  assert.throws(
    () => createSolverWorkerRequest({
      requestToken: 6,
      generation: 7,
      type: 'drag-update',
      payload: { entities: [], previewConstraintTolerance: -1 },
    }),
    /previewConstraintTolerance must be a non-negative finite number/,
  );
  assert.doesNotThrow(() => createSolverWorkerRequest({
    requestToken: 7,
    generation: 7,
    type: 'set-enabled-stack-ids',
    payload: { stackIds: ['stack-a'] },
  }));
  assert.throws(() => createSolverWorkerRequest({
    requestToken: 8,
    generation: 7,
    type: 'set-enabled-stack-ids',
    payload: { stackIds: 'stack-a' },
  }), /stackIds array or null/);

  const result = createSolverWorkerResult(request, {
    status: 'completed',
    changedParameters: [{ id: 'parameter-1', name: 'width', expression: '10', value: 10 }],
    changedConstraints: [{ id: 'constraint-1', type: 'Horizontal' }],
    removedConstraintIds: ['constraint-2'],
  });
  assert.equal(validateSolverWorkerResult(result), result);
  assert.deepEqual(result.changedParameters.map(({ id }) => id), ['parameter-1']);
  assert.deepEqual(result.changedConstraints.map(({ id }) => id), ['constraint-1']);
  assert.deepEqual(result.removedConstraintIds, ['constraint-2']);
  assert.throws(
    () => validateSolverWorkerResult({ ...result, changedParameters: {} }),
    /changedParameters must be an array/,
  );
  assert.throws(
    () => validateSolverWorkerResult({ ...result, changedConstraints: {} }),
    /changedConstraints must be an array/,
  );
  assert.throws(
    () => validateSolverWorkerResult({ ...result, removedConstraintIds: {} }),
    /removedConstraintIds must be an array/,
  );
});

test('worker runtime applies guarded block Jacobians and returns usage diagnostics', () => {
  const runtime = new SolverWorkerRuntime({ jacobianMode: 'blocks' });
  const result = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 1,
    generation: 0,
    type: 'load-sketch',
    payload: {
      snapshot: {
        entities: [{ id: 'line', type: 'line', start: [0, 0], end: [10, 4] }],
        constraints: [{
          id: 'horizontal',
          type: 'Horizontal',
          featureRefs: [{ kind: 'segment', recordId: 'line', index: 0 }],
        }],
      },
    },
  }));

  assert.equal(result.status, 'converged');
  assert.equal(result.diagnostics.jacobianStats.mode, 'blocks');
  assert.equal(result.diagnostics.jacobianStats.analyticalBlocks, 1);
  assert.equal(result.diagnostics.jacobianStats.fallbackBlocks, 0);
});

test('browser worker client forwards block mode through the Worker module URL', () => {
  const OriginalWorker = globalThis.Worker;
  let createdUrl = null;
  class CapturingWorker {
    constructor(url) { createdUrl = url; }
    addEventListener() {}
    removeEventListener() {}
    postMessage() {}
    terminate() {}
  }
  globalThis.Worker = CapturingWorker;
  try {
    const client = createBrowserSolverWorkerClient({ jacobianMode: 'blocks' });
    assert.equal(createdUrl.searchParams.get('jacobianMode'), 'blocks');
    client.terminate();
  } finally {
    globalThis.Worker = OriginalWorker;
  }
});

test('solver worker returns every affected parameter after a rename', () => {
  const runtime = new SolverWorkerRuntime();
  runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 1,
    generation: 0,
    type: 'load-sketch',
    payload: {
      snapshot: {
        entities: [],
        parameters: [
          {
            id: 'source-parameter',
            name: 'sourceWidth',
            expression: '10',
            value: 10,
            kind: 'user',
            driving: false,
            computed: false,
            unit: null,
            error: null,
            order: 0,
          },
          {
            id: 'dependent-parameter',
            name: 'halfWidth',
            expression: 'sourceWidth / 2',
            value: 5,
            kind: 'user',
            driving: false,
            computed: false,
            unit: null,
            error: null,
            order: 1,
          },
        ],
      },
    },
  }));

  const updated = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 2,
    generation: 0,
    type: 'update-parameter',
    payload: {
      parameterId: 'source-parameter',
      patch: { name: 'plateWidth' },
    },
  }));

  assert.equal(updated.status, 'unchanged');
  assert.deepEqual(
    updated.changedParameters.map(({ id }) => id).sort(),
    ['dependent-parameter', 'source-parameter'],
  );
  const dependent = updated.changedParameters.find(({ id }) => id === 'dependent-parameter');
  assert.equal(dependent.expression, 'plateWidth / 2');
});

test('solver worker runtime owns sketch state and returns changed-entity deltas', () => {
  const runtime = new SolverWorkerRuntime();
  const loaded = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 1,
    generation: 0,
    type: 'load-sketch',
    payload: {
      snapshot: {
        entities: [
          { id: 'worker-line-a', type: 'line', start: [0, 0], end: [10, 0] },
          { id: 'worker-line-b', type: 'line', start: [30, 0], end: [40, 0] },
        ],
        constraints: [
          { id: 'worker-horizontal-a', type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId: 'worker-line-a', index: 0 }] },
          { id: 'worker-horizontal-b', type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId: 'worker-line-b', index: 0 }] },
        ],
      },
    },
  }));
  assert.ok(['converged', 'unchanged'].includes(loaded.status), loaded.message);

  const updated = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 2,
    generation: 1,
    type: 'update-entities',
    payload: {
      entities: [{ id: 'worker-line-a', type: 'line', start: [0, 0], end: [10, 3] }],
    },
  }));
  assert.equal(updated.status, 'converged');
  assert.deepEqual(updated.changedEntities.map((entity) => entity.id), ['worker-line-a']);
  assert.equal(Object.hasOwn(updated, 'snapshot'), false);
  assert.equal(updated.diagnostics.solveScope.mode, 'stack-set');
  assert.deepEqual(updated.diagnostics.solveScope.stackIds, [runtime.controller.defaultStackId()]);
  assert.equal(isUuid(updated.diagnostics.solveScope.stackIds[0]), true);

  const snapshot = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 3,
    generation: 1,
    type: 'get-snapshot',
    payload: {},
  }));
  assert.equal(snapshot.snapshot.entities.length, 2);
});

test('solver worker returns accepted and removed constraint deltas', () => {
  const runtime = new SolverWorkerRuntime();
  runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 1,
    generation: 0,
    type: 'load-sketch',
    payload: {
      snapshot: {
        entities: [{ id: 'constraint-line', type: 'line', start: [0, 0], end: [10, 3] }],
      },
    },
  }));

  const added = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 2,
    generation: 0,
    type: 'add-constraint',
    payload: {
      constraint: {
        id: 'worker-horizontal',
        type: 'Horizontal',
        featureRefs: [{ kind: 'segment', recordId: 'constraint-line', index: 0 }],
      },
    },
  }));
  assert.equal(added.status, 'converged');
  assert.deepEqual(added.changedConstraints.map(({ id }) => id), ['worker-horizontal']);
  assert.ok(horizontalResidual(added.changedEntities[0]) < DEFAULT_SOLVE_TOLERANCE);

  const removed = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 3,
    generation: 0,
    type: 'remove-constraint',
    payload: { constraintId: 'worker-horizontal' },
  }));
  assert.ok(['converged', 'unchanged'].includes(removed.status), removed.message);
  assert.deepEqual(removed.removedConstraintIds, ['worker-horizontal']);
  assert.deepEqual(removed.changedConstraints, []);
});

test('solver worker runtime rejects older interactive generations', () => {
  const runtime = new SolverWorkerRuntime();
  runtime.latestInteractiveGeneration = 8;
  const result = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 9,
    generation: 7,
    type: 'drag-update',
    payload: { entities: [] },
  }));
  assert.equal(result.status, 'stale');
});

test('solver worker runtime returns directly edited unconstrained geometry in its delta', () => {
  const runtime = new SolverWorkerRuntime();
  runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 1,
    generation: 0,
    type: 'load-sketch',
    payload: { snapshot: { entities: [{ id: 'free-point', type: 'point', point: [0, 0] }] } },
  }));
  const updated = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 2,
    generation: 1,
    type: 'drag-update',
    payload: { entities: [{ id: 'free-point', type: 'point', point: [7, 9] }] },
  }));
  assert.equal(updated.status, 'unchanged');
  assert.deepEqual(updated.changedEntities, [{ id: 'free-point', type: 'point', point: [7, 9] }]);
});

test('solver worker uses a bounded preview solve for drag and a normal final solve on commit', () => {
  const runtime = new SolverWorkerRuntime({ interactiveSolveOptions: { timeBudgetMs: 0 } });
  runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 1,
    generation: 0,
    type: 'load-sketch',
    payload: {
      snapshot: {
        entities: [{ id: 'budget-line', type: 'line', start: [0, 0], end: [10, 0] }],
        constraints: [{
          id: 'budget-horizontal',
          type: 'Horizontal',
          featureRefs: [{ kind: 'segment', recordId: 'budget-line', index: 0 }],
        }],
      },
    },
  }));
  const preview = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 2,
    generation: 1,
    type: 'drag-update',
    payload: { entities: [{ id: 'budget-line', type: 'line', start: [0, 0], end: [10, 5] }] },
  }));
  assert.equal(preview.status, 'preview');
  assert.equal(preview.diagnostics.solveMode, 'interactive');
  assert.equal(preview.diagnostics.cancellationReason, 'time-budget');
  assert.equal(preview.diagnostics.restoredInteractivePreview, true);
  assert.deepEqual(preview.changedEntities[0].end, [10, 0]);

  const final = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 3,
    generation: 1,
    type: 'solve',
    payload: { options: { seedEntityIds: ['budget-line'] } },
  }));
  assert.ok(['converged', 'unchanged'].includes(final.status));
  assert.equal(final.diagnostics.solveMode, 'final');
  assert.ok(horizontalResidual(final.changedEntities[0]) < DEFAULT_SOLVE_TOLERANCE);
});

test('solver worker restores the pre-drag baseline when the strict final solve fails', () => {
  let entity = { id: 'rollback-line', type: 'line', start: [0, 0], end: [10, 0] };
  const controller = {
    snapshotGeometryForSeeds: () => ({ entities: [structuredClone(entity)] }),
    updateEntities: (entities) => {
      entity = structuredClone(entities[0]);
      return { result: { status: 'preview', solveMode: 'interactive', changedEntityIds: [entity.id] } };
    },
    solve: () => ({ status: 'max-iterations', changedEntityIds: [], message: 'fixture failure' }),
    restoreGeometryTransaction: (transaction) => { [entity] = structuredClone(transaction.entities); },
    getEntity: () => structuredClone(entity),
  };
  const runtime = new SolverWorkerRuntime({ controller });
  runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 1,
    generation: 1,
    type: 'drag-update',
    payload: { entities: [{ ...entity, end: [10, 8] }] },
  }));
  const final = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 2,
    generation: 1,
    type: 'solve',
    payload: { options: {} },
  }));
  assert.equal(final.status, 'max-iterations');
  assert.equal(final.diagnostics.restoredInteractiveBaseline, true);
  assert.deepEqual(final.changedEntities, [{ id: 'rollback-line', type: 'line', start: [0, 0], end: [10, 0] }]);
});

test('solver worker final result resynchronizes every entity from the affected drag component', () => {
  let entities = [
    { id: 'direct-final', type: 'point', point: [0, 0] },
    { id: 'dependent-final', type: 'point', point: [5, 0] },
  ];
  const controller = {
    snapshotGeometryForSeeds: () => ({ entities: structuredClone(entities) }),
    updateEntities: ([direct]) => {
      entities[0] = structuredClone(direct);
      entities[1].point[0] += 0.05;
      return { result: { status: 'preview', solveMode: 'interactive', changedEntityIds: entities.map(({ id }) => id) } };
    },
    solve: () => ({ status: 'converged', changedEntityIds: [], message: 'fixture converged' }),
    restoreGeometryTransaction: () => {},
    getEntity: (id) => structuredClone(entities.find((entity) => entity.id === id)),
  };
  const runtime = new SolverWorkerRuntime({ controller });
  runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 1,
    generation: 1,
    type: 'drag-update',
    payload: { entities: [{ id: 'direct-final', type: 'point', point: [2, 0] }] },
  }));
  const final = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 2,
    generation: 1,
    type: 'solve',
    payload: { options: {} },
  }));
  assert.equal(final.status, 'converged');
  assert.deepEqual(final.changedEntities.map((entity) => entity.id), ['direct-final', 'dependent-final']);
});

class ManualWorker {
  constructor() {
    this.listeners = new Set();
    this.messages = [];
  }

  addEventListener(type, listener) {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === 'message') this.listeners.delete(listener);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  respond(message) {
    this.listeners.forEach((listener) => listener({ data: message }));
  }
}

test('solver worker client coalesces drag updates and suppresses superseded in-flight results', async () => {
  const worker = new ManualWorker();
  const client = new SolverWorkerClient(worker);
  const first = client.dragUpdate([{ id: 'drag-point', type: 'point', point: [1, 0] }]);
  const second = client.dragUpdate([{ id: 'drag-point', type: 'point', point: [2, 0] }]);
  const third = client.dragUpdate([{ id: 'drag-point', type: 'point', point: [3, 0] }]);

  assert.equal(worker.messages.length, 1);
  assert.equal((await second).status, 'stale');
  const firstRequest = worker.messages[0];
  worker.respond(createSolverWorkerResult(firstRequest, {
    status: 'converged',
    changedEntities: [{ id: 'drag-point', type: 'point', point: [1, 0] }],
  }));
  const stale = await first;
  assert.equal(stale.status, 'stale');
  assert.deepEqual(stale.changedEntities, []);
  assert.equal(stale.diagnostics.supersededByGeneration, worker.messages[1].generation);
  assert.equal(worker.messages.length, 2);
  assert.deepEqual(worker.messages[1].payload.entities[0].point, [3, 0]);

  const thirdRequest = worker.messages[1];
  worker.respond(createSolverWorkerResult(thirdRequest, {
    status: 'converged',
    changedEntities: [{ id: 'drag-point', type: 'point', point: [3, 0] }],
  }));
  const accepted = await third;
  assert.equal(accepted.status, 'converged');
  assert.deepEqual(accepted.changedEntities[0].point, [3, 0]);
  assert.ok(accepted.diagnostics.queueMs >= 0);
  assert.ok(accepted.diagnostics.roundTripMs >= 0);
  client.terminate();
});

test('solver worker client coalesces only explicitly keyed parameter updates', async () => {
  const worker = new ManualWorker();
  const client = new SolverWorkerClient(worker);
  const options = { coalesceKey: 'control-parameter:control-1' };
  const first = client.updateParameter('control-1', { expression: '1' }, options);
  const second = client.updateParameter('control-1', { expression: '2' }, options);
  const third = client.updateParameter('control-1', { expression: '3' }, options);

  assert.equal(worker.messages.length, 1);
  assert.equal((await second).status, 'superseded');
  worker.respond(createSolverWorkerResult(worker.messages[0], { status: 'unchanged' }));
  assert.equal((await first).status, 'unchanged');
  assert.equal(worker.messages.length, 2);
  assert.equal(worker.messages[1].payload.patch.expression, '3');

  worker.respond(createSolverWorkerResult(worker.messages[1], { status: 'unchanged' }));
  assert.equal((await third).status, 'unchanged');
  client.terminate();
});

test('solver worker client keeps committed mutations ordered and non-droppable', async () => {
  const worker = new ManualWorker();
  const client = new SolverWorkerClient(worker);
  const first = client.addEntity({ id: 'ordered-a', type: 'point', point: [0, 0] });
  const second = client.addEntity({ id: 'ordered-b', type: 'point', point: [1, 0] });
  assert.deepEqual(worker.messages.map((message) => message.payload.entity.id), ['ordered-a']);

  worker.respond(createSolverWorkerResult(worker.messages[0], { status: 'completed' }));
  assert.equal((await first).status, 'completed');
  assert.deepEqual(worker.messages.map((message) => message.payload.entity.id), ['ordered-a', 'ordered-b']);
  worker.respond(createSolverWorkerResult(worker.messages[1], { status: 'completed' }));
  assert.equal((await second).status, 'completed');
  client.terminate();
});
