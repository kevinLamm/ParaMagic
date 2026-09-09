import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingHistory } from '../../packages/paramagic-core/src/modules/DrawingHistory.js';
import { createDrawingUpdateCoordinator } from '../../packages/paramagic-core/src/modules/DrawingUpdateCoordinator.js';

test('a coordinated restore publishes inside the history boundary and preserves Redo', async () => {
  let state = { width: 63.5, derivedWidth: 63.5 };
  const updates = createDrawingUpdateCoordinator({ publish: () => history.record() });
  updates.register('dependent', () => { state.derivedWidth = state.width; });
  const history = new DrawingHistory({ capture: () => state, restore: snapshot => {
    state = snapshot;
    updates.invalidate();
    updates.flush();
  } });
  state.width = 74;
  updates.invalidate();
  updates.flush();
  assert.equal(history.past.length, 1);
  assert.equal(history.undo(), true);
  await Promise.resolve();
  assert.deepEqual(state, { width: 63.5, derivedWidth: 63.5 });
  assert.equal(history.future.length, 1);
  assert.equal(history.redo(), true);
  await Promise.resolve();
  assert.deepEqual(state, { width: 74, derivedWidth: 74 });
  assert.equal(history.past.length, 1);
});

test('drawing history restores complete snapshots through undo and redo', () => {
  let state = { name: '', drawing: { entities: [], parameters: [] } };
  const changes = [];
  const history = new DrawingHistory({
    capture: () => state,
    restore: (snapshot) => { state = snapshot; },
    onChange: (change) => changes.push(change),
  });

  state = { name: 'First', drawing: { entities: [{ id: 'line-1' }], parameters: [{ name: 'width', expression: '10 in' }] } };
  history.record();
  state = { name: 'Second', drawing: { entities: [{ id: 'line-1' }, { id: 'circle-1' }], parameters: [{ name: 'width', expression: '12 in' }] } };
  history.record();

  assert.equal(history.undo(), true);
  assert.equal(state.name, 'First');
  assert.equal(state.drawing.entities.length, 1);
  assert.equal(state.drawing.parameters[0].expression, '10 in');
  assert.equal(history.redo(), true);
  assert.equal(state.name, 'Second');
  assert.equal(state.drawing.entities.length, 2);
  assert.deepEqual(changes.at(-1), { canUndo: true, canRedo: false });
});

test('a new edit after undo clears redo history and duplicate snapshots are ignored', () => {
  let state = { value: 0 };
  const history = new DrawingHistory({ capture: () => state, restore: (snapshot) => { state = snapshot; } });
  assert.equal(history.record(), false);
  state = { value: 1 };
  history.record();
  state = { value: 2 };
  history.record();
  history.undo();
  state = { value: 3 };
  history.record();
  assert.equal(history.redo(), false);
  assert.equal(state.value, 3);
});

test('drawing history round-trips fillet entities alongside source geometry', () => {
  let state = {
    name: 'Fillet Sketch',
    drawing: {
      entities: [
        { id: 'line-a', type: 'line', start: [0, 0], end: [100, 0] },
        { id: 'line-b', type: 'line', start: [0, 0], end: [0, 100] },
      ],
      parameters: [],
    },
  };
  const history = new DrawingHistory({
    capture: () => state,
    restore: (snapshot) => { state = snapshot; },
  });

  state = {
    name: 'Fillet Sketch',
    drawing: {
      entities: [
        { id: 'line-a', type: 'line', start: [0, 0], end: [100, 0] },
        { id: 'line-b', type: 'line', start: [0, 0], end: [0, 100] },
        {
          id: 'fillet-a',
          type: 'fillet',
          sourceA: { recordId: 'line-a', index: 0 },
          sourceB: { recordId: 'line-b', index: 0 },
          radius: 12,
          radiusExpression: '12',
        },
      ],
      parameters: [],
    },
  };
  assert.equal(history.record(), true);

  assert.equal(history.undo(), true);
  assert.equal(state.drawing.entities.some(({ type }) => type === 'fillet'), false);

  assert.equal(history.redo(), true);
  const fillet = state.drawing.entities.find(({ type }) => type === 'fillet');
  assert.ok(fillet);
  assert.equal(fillet.radius, 12);
  assert.deepEqual(fillet.sourceA, { recordId: 'line-a', index: 0 });
  assert.deepEqual(fillet.sourceB, { recordId: 'line-b', index: 0 });
});

test('flushing a pending coalesced change before a discrete commit preserves both undo steps', () => {
  let state = { value: 0 };
  const history = new DrawingHistory({
    capture: () => state,
    restore: (snapshot) => { state = snapshot; },
  });

  state = { value: 1 };
  history.recordSoon();
  history.flush();

  state = { value: 2 };
  history.record();

  assert.equal(history.undo(), true);
  assert.equal(state.value, 1);
  assert.equal(history.undo(), true);
  assert.equal(state.value, 0);
});

test('reset adopts an asynchronously loaded drawing as the new history baseline', () => {
  let state = { extensions: {} };
  const history = new DrawingHistory({
    capture: () => state,
    restore: (snapshot) => { state = snapshot; },
  });

  state = { extensions: { controls: { items: [{ id: 'control-1' }] } } };
  history.reset();
  state = { extensions: { controls: { items: [{ id: 'control-1', label: 'Speed' }] } } };
  history.record();

  assert.equal(history.undo(), true);
  assert.equal(state.extensions.controls.items.length, 1);
  assert.equal(state.extensions.controls.items[0].id, 'control-1');
  assert.equal(history.undo(), false);
});
