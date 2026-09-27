import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { createSolverExecutionFacade } from '../../packages/paramagic-core/src/modules/solver/SolverExecutionFacade.js';
import { SolverWorkerClient } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerClient.js';
import { SolverWorkerRuntime } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerRuntime.js';
import { WasmSolverBackend } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';

const module = new WebAssembly.Module(readFileSync(new URL('../../packages/paramagic-core/src/modules/solver/wasm/solver.wasm', import.meta.url)));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const point = id => ({ kind: 'point', recordId: id, index: 0 });
async function parity(facade) {
  const result = await facade.verifyWorkerParity();
  assert.equal(result.matched, true, JSON.stringify({ local: facade.getSketchSnapshot(), remote: result.result?.snapshot }));
}

class Worker {
  constructor(backend) {
    this.controller = new SolverController({ jacobianMode: 'blocks', numericBackend: backend });
    this.runtime = new SolverWorkerRuntime({ controller: this.controller });
    this.listeners = new Map(); this.messages = [];
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  postMessage(message) {
    this.messages.push(structuredClone(message));
    queueMicrotask(() => this.listeners.get('message')?.({ data: this.runtime.handleRequest(message) }));
  }
  terminate() {}
}

function drawing() {
  const controller = new SolverController({ jacobianMode: 'blocks' });
  controller.setDrawingProperties({ drawingUnit: 'mm' });
  controller.setStackState({ version: 6, activeStackId: null, stacks: [
    { id: 'a', name: 'A', frame: { x: 0, y: 0, rotation: 0 } },
    { id: 'b', name: 'B', frame: { x: 0, y: 0, rotation: 0 } },
  ] });
  controller.addEntity({ id: 'edge-a', type: 'line', stackId: 'a', start: [0, 0], end: [10, 0] });
  controller.addEntity({ id: 'edge-b', type: 'line', stackId: 'b', start: [0, 0], end: [0, 10] });
  controller.addEntity({ id: 'circle', type: 'circle', stackId: 'a', center: [5, 5], radius: 10 });
  assert.ok(controller.addConstraint({ type: 'Coincident', featureRefs: [point('edge-a'), point('edge-b')] }).constraint);
  const control = controller.createControlParameter({ name: 'c1', expression: '10', stackId: 'a' });
  const dimension = controller.addDimension({ type: 'radius-dimension', subtype: 'radius', stackId: 'a',
    dimensionMode: 'driving', expression: 'c1', center: [5, 5], radius: 10, measuredValue: 10,
    elbow: [20, 20], label: [30, 20], anchors: { center: { type: 'center', recordId: 'circle' }, radius: { type: 'radius', recordId: 'circle' } } });
  assert.ok(dimension.entity);
  controller.setDimension(dimension.entity.dimensionId, 'c1');
  return { controller, control };
}

for (const backendName of ['javascript', 'wasm']) {
  test(`${backendName}: collective relocation survives an immediate control edit without reloading the Worker`, async () => {
    const { controller, control } = drawing();
    const backend = backendName === 'wasm' ? new WasmSolverBackend(module) : null;
    const worker = new Worker(backend);
    const facade = createSolverExecutionFacade({ controller, mode: 'worker-drag', workerClient: new SolverWorkerClient(worker) });
    try {
      assert.equal((await facade.verifyWorkerParity()).matched, true);
      assert.equal(controller.stackState.activeStackId, null);
      const graph = worker.controller.constraintGraph;
      const localGeometry = controller.model.binding('edge-a').toEntity();
      const frame = structuredClone(controller.stackState.stacks.find(s => s.id === 'a').frame);
      const before = controller.getEntity('circle').center;
      const oldLabel = controller.dimensionAnnotations.values().next().value.label;
      const previousLoads = worker.messages.filter(m => m.type === 'load-sketch').length;
      const sessionCount = backend?.sessions.size;
      const sessions = backend ? [...backend.sessions.values()].map(s => [s, s.native.memory.buffer, s.topologyBuilds]) : [];
      for (const dx of [20, 40, 80]) facade.setStackFrame('a', { ...frame, x: frame.x + dx, y: frame.y - 30 });
      const moved = facade.captureStackPlacementState();
      const result = await facade.updateParameterAuthoritative(control.id, { expression: '12' });
      assert.equal(result.result.status, 'converged');
      near(controller.getEntity('circle').center[0], before[0] + 80);
      near(controller.getEntity('circle').center[1], before[1] - 30);
      assert.ok(Math.abs(controller.getEntity('circle').radius - 12) < 1e-3);
      near(controller.dimensionAnnotations.values().next().value.label[0], oldLabel[0] + 80);
      assert.deepEqual(controller.captureStackPlacementState().frames, moved.frames);
      assert.deepEqual(controller.model.binding('edge-a').toEntity(), localGeometry);
      await parity(facade);
      assert.equal(worker.messages.filter(m => m.type === 'load-sketch').length, previousLoads);
      assert.equal(worker.controller.constraintGraph, graph);
      const updates = worker.messages.filter(m => m.type === 'update-model').flatMap(m => m.payload.updates);
      assert.equal(updates.length, 1, 'Frame updates in one event turn coalesce');
      assert.equal(updates[0].method, 'restoreStackPlacementState');
      assert.equal('entities' in updates[0].args[0], false, 'Placement mutation does not transfer geometry');
      if (backend) {
        assert.equal(backend.sessions.size, sessionCount);
        for (const [session, memory, builds] of sessions) {
          assert.equal(session.native.memory.buffer, memory);
          assert.equal(session.topologyBuilds, builds);
        }
      }
    } finally { facade.terminate(); }
  });

  test(`${backendName}: cancelled placement and journal recovery retain the accepted canvas location`, async () => {
    const { controller, control } = drawing();
    const makeWorker = () => new Worker(backendName === 'wasm' ? new WasmSolverBackend(module) : null);
    const worker = makeWorker();
    const facade = createSolverExecutionFacade({ controller, mode: 'worker-drag',
      workerClient: new SolverWorkerClient(worker), workerFactory: () => new SolverWorkerClient(makeWorker()) });
    try {
      await facade.verifyWorkerParity();
      facade.setStackFrame('a', { x: 50, y: -25, rotation: 0 });
      await parity(facade);
      const accepted = facade.captureStackPlacementState();
      facade.setStackFrame('b', { x: 150, y: 25, rotation: 0 });
      await facade.verifyWorkerParity();
      facade.restoreStackPlacementState(accepted);
      assert.equal((await facade.verifyWorkerParity()).matched, true);
      assert.equal(await facade.restartWorker(new Error('test restart after a cancelled relocation')), true);
      assert.equal((await facade.verifyWorkerParity()).matched, true);
      const result = await facade.updateParameterAuthoritative(control.id, { expression: '11' });
      assert.equal(result.result.status, 'converged');
      assert.deepEqual(controller.captureStackPlacementState().frames, accepted.frames);
      near(controller.getEntity('circle').center[0], 55);
      near(controller.getEntity('circle').center[1], -20);
      assert.equal((await facade.verifyWorkerParity()).matched, true);
    } finally { facade.terminate(); }
  });

  test(`${backendName}: geometry edits between collective moves use the correct frame`, async () => {
    const { controller } = drawing();
    const worker = new Worker(backendName === 'wasm' ? new WasmSolverBackend(module) : null);
    const facade = createSolverExecutionFacade({ controller, mode: 'worker-drag', workerClient: new SolverWorkerClient(worker) });
    try {
      await parity(facade);
      facade.setStackFrame('a', { x: 10, y: 0, rotation: 0 });
      facade.updateEntity({ ...facade.getEntity('circle'), center: [20, 10] });
      facade.setStackFrame('b', { x: 40, y: 0, rotation: 0 });
      await parity(facade);
      near(controller.getEntity('circle').center[0], 50);
      near(controller.getEntity('circle').center[1], 10);
      const revision = facade.executionStatus().revision;
      assert.equal(facade.setStackFrame('missing', { x: 100, y: 0 }).changed, false);
      await parity(facade);
      assert.equal(facade.executionStatus().revision, revision, 'Rejected moves do not mutate the Worker');
    } finally { facade.terminate(); }
  });
}
