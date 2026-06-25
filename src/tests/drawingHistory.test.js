import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingHistory } from '../modules/DrawingHistory.js';

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
