import test from 'node:test';
import assert from 'node:assert/strict';
import { createStackCanvasInteraction } from '../../packages/paramagic-core/src/modules/StackCanvasInteraction.js';

function fakeCanvas() {
  const listeners = new Map();
  const classes = new Set();
  return {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    captured: null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((candidate) => candidate !== listener));
    },
    setPointerCapture(pointerId) { this.captured = pointerId; },
    releasePointerCapture(pointerId) { if (this.captured === pointerId) this.captured = null; },
    dispatch(type, properties = {}) {
      const event = {
        type,
        button: 0,
        pointerId: 7,
        clientX: 0,
        clientY: 0,
        defaultPrevented: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.immediatePropagationStopped = true; },
        ...properties,
      };
      for (const listener of listeners.get(type) || []) {
        listener(event);
        if (event.immediatePropagationStopped) break;
      }
      return event;
    },
  };
}

function geometryTarget(recordId = 'edge-a') {
  const group = { dataset: { recordId } };
  return {
    closest(selector) {
      if (selector === '.canvas-record') return group;
      return null;
    },
  };
}

function stackTarget(stackId = 'stack-a') {
  const group = { dataset: { stackId } };
  return { closest: (selector) => selector === '[data-stack-id]' ? group : null };
}

function closedRegionTarget(parentIds = ['edge-a', 'edge-b']) {
  const region = { dataset: { parentIds: parentIds.join(','), stackId: 'stack-a' } };
  return {
    closest(selector) {
      if (selector === '.closed-constrained-region' || selector === '[data-stack-id]') return region;
      return null;
    },
  };
}

test('no-active-Stack geometry drag translates its Stack frame and commits once', () => {
  const canvas = fakeCanvas();
  const record = { id: 'edge-a', recordType: 'geometry', entity: { id: 'edge-a', stackId: 'stack-a' } };
  const frames = [];
  const commits = [];
  const hovered = [];
  createStackCanvasInteraction({
    canvasElement: canvas,
    getActiveStackId: () => null,
    getRecordById: (id) => id === record.id ? record : null,
    getStackFrame: () => ({ x: 10, y: 20, rotation: Math.PI / 6 }),
    canMoveStack: () => true,
    screenToWorld: (x, y) => [x / 2, y / 2],
    captureDragSnapshot: () => ({ frame: 'before' }),
    moveStackFrame: (_stackId, frame) => { frames.push(frame); return { changed: true }; },
    onCommit: (stackId) => commits.push(stackId),
    onHoveredStackChange: (stackId) => hovered.push(stackId),
  });

  const down = canvas.dispatch('pointerdown', { target: geometryTarget(), clientX: 100, clientY: 200 });
  assert.equal(down.defaultPrevented, true);
  assert.equal(canvas.captured, 7);
  canvas.dispatch('pointermove', { target: geometryTarget(), clientX: 102, clientY: 202 });
  assert.equal(frames.length, 0);
  canvas.dispatch('pointermove', { target: geometryTarget(), clientX: 112, clientY: 208 });
  assert.deepEqual(frames, [{ x: 16, y: 24, rotation: Math.PI / 6 }]);
  assert.deepEqual(hovered, ['stack-a']);
  assert.equal(canvas.classList.contains('stack-frame-dragging'), true);
  canvas.dispatch('pointerup', { target: geometryTarget(), clientX: 112, clientY: 208 });
  assert.deepEqual(commits, ['stack-a']);
  assert.equal(canvas.captured, null);
  assert.equal(canvas.classList.contains('stack-frame-dragging'), false);
  assert.equal(canvas.dispatch('click', { target: geometryTarget() }).defaultPrevented, true);
  assert.equal(canvas.dispatch('click', { target: geometryTarget() }).defaultPrevented, false);
});

test('dragging a closed geometry region translates its single owning Stack', () => {
  const canvas = fakeCanvas();
  const records = new Map([
    ['edge-a', { id: 'edge-a', recordType: 'geometry', entity: { stackId: 'stack-a' } }],
    ['edge-b', { id: 'edge-b', recordType: 'geometry', entity: { stackId: 'stack-a' } }],
  ]);
  const frames = [];
  createStackCanvasInteraction({
    canvasElement: canvas,
    getActiveStackId: () => null,
    getRecordById: (id) => records.get(id) || null,
    getStackFrame: () => ({ x: 0, y: 0, rotation: 0 }),
    canMoveStack: () => true,
    moveStackFrame: (_stackId, frame) => { frames.push(frame); return { changed: true }; },
  });

  canvas.dispatch('pointerdown', { target: closedRegionTarget(), clientX: 10, clientY: 20 });
  canvas.dispatch('pointermove', { target: closedRegionTarget(), clientX: 25, clientY: 30 });
  canvas.dispatch('pointerup', { target: closedRegionTarget(), clientX: 25, clientY: 30 });
  assert.deepEqual(frames, [{ x: 15, y: 10, rotation: 0 }]);
});

test('a closed region spanning multiple Stacks cannot choose an arbitrary Stack to drag', () => {
  const canvas = fakeCanvas();
  const records = new Map([
    ['edge-a', { id: 'edge-a', recordType: 'geometry', entity: { stackId: 'stack-a' } }],
    ['edge-b', { id: 'edge-b', recordType: 'geometry', entity: { stackId: 'stack-b' } }],
  ]);
  let moves = 0;
  createStackCanvasInteraction({
    canvasElement: canvas,
    getActiveStackId: () => null,
    getRecordById: (id) => records.get(id) || null,
    getStackFrame: () => ({ x: 0, y: 0, rotation: 0 }),
    canMoveStack: () => true,
    moveStackFrame: () => { moves += 1; return { changed: true }; },
  });

  assert.equal(canvas.dispatch('pointerdown', { target: closedRegionTarget() }).defaultPrevented, false);
  canvas.dispatch('pointermove', { target: closedRegionTarget(), clientX: 20, clientY: 20 });
  assert.equal(moves, 0);
});

test('Stack canvas drag stays unavailable while a Stack or another canvas tool is active', () => {
  const record = { id: 'edge-a', recordType: 'geometry', entity: { id: 'edge-a', stackId: 'stack-a' } };
  for (const setup of [
    { getActiveStackId: () => 'stack-a', isToolInteractionActive: () => false },
    { getActiveStackId: () => null, isToolInteractionActive: () => true },
  ]) {
    const canvas = fakeCanvas();
    let moves = 0;
    createStackCanvasInteraction({
      canvasElement: canvas,
      ...setup,
      getRecordById: () => record,
      getStackFrame: () => ({ x: 0, y: 0, rotation: 0 }),
      canMoveStack: () => true,
      moveStackFrame: () => { moves += 1; return { changed: true }; },
    });
    assert.equal(canvas.dispatch('pointerdown', { target: geometryTarget() }).defaultPrevented, false);
    canvas.dispatch('pointermove', { target: geometryTarget(), clientX: 20, clientY: 20 });
    assert.equal(moves, 0);
  }
});

test('hovering any Stack-owned canvas entity reports the whole Stack when none is active', () => {
  const canvas = fakeCanvas();
  const hovered = [];
  createStackCanvasInteraction({
    canvasElement: canvas,
    getActiveStackId: () => null,
    canMoveStack: () => true,
    onHoveredStackChange: (stackId) => hovered.push(stackId),
  });
  canvas.dispatch('pointermove', { target: stackTarget('stack-a') });
  canvas.dispatch('pointerleave', { target: stackTarget('stack-a') });
  assert.deepEqual(hovered, ['stack-a', null]);
});

test('cancelling a Stack canvas drag restores its placement snapshot without committing', () => {
  const canvas = fakeCanvas();
  const record = { id: 'edge-a', recordType: 'geometry', entity: { id: 'edge-a', stackId: 'stack-a' } };
  const restored = [];
  let commits = 0;
  createStackCanvasInteraction({
    canvasElement: canvas,
    getActiveStackId: () => null,
    getRecordById: () => record,
    getStackFrame: () => ({ x: 0, y: 0, rotation: 0 }),
    canMoveStack: () => true,
    captureDragSnapshot: () => ({ token: 42 }),
    moveStackFrame: () => ({ changed: true }),
    restoreDragSnapshot: (snapshot) => restored.push(snapshot),
    onCommit: () => { commits += 1; },
  });
  canvas.dispatch('pointerdown', { target: geometryTarget() });
  canvas.dispatch('pointermove', { target: geometryTarget(), clientX: 10, clientY: 0 });
  canvas.dispatch('pointercancel', { target: geometryTarget(), clientX: 10, clientY: 0 });
  assert.deepEqual(restored, [{ token: 42 }]);
  assert.equal(commits, 0);
});
