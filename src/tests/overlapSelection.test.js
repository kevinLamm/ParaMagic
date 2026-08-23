import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceOverlapCycle,
  createOverlapSelectionCycler,
} from '../../packages/paramagic-core/src/modules/CanvasViewport.js';

const candidates = [
  { kind: 'handle', recordId: 'line-a', handleIndex: 0 },
  { kind: 'handle', recordId: 'line-b', handleIndex: 2 },
  { kind: 'stroke', recordId: 'line-a' },
  { kind: 'stroke', recordId: 'line-b' },
];

test('Alt overlap selection cycles through handles and strokes at one location', () => {
  let state = advanceOverlapCycle(null, candidates, { x: 100, y: 120 });
  assert.equal(state.index, 0);
  state = advanceOverlapCycle(state, candidates, { x: 100, y: 120 });
  assert.equal(state.index, 1);
  state = advanceOverlapCycle(state, candidates, { x: 100, y: 120 });
  assert.equal(state.index, 2);
  state = advanceOverlapCycle(state, candidates, { x: 100, y: 120 });
  assert.equal(state.index, 3);
  state = advanceOverlapCycle(state, candidates, { x: 100, y: 120 });
  assert.equal(state.index, 0);
});

test('overlap selection restarts when the pointer or candidate stack changes', () => {
  const state = advanceOverlapCycle(null, candidates, { x: 100, y: 120 });
  assert.equal(advanceOverlapCycle(state, candidates, { x: 110, y: 120 }).index, 0);
  assert.equal(advanceOverlapCycle(state, candidates.slice(1), { x: 100, y: 120 }).index, 0);
});

test('overlap hit testing skips records disabled by the active Stack', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { elementsFromPoint: () => [] };
  const classList = () => ({ add() {}, remove() {} });
  const segmentNode = (segmentIndex) => ({
    classList: classList(),
    dataset: { segmentIndex: String(segmentIndex) },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 20, bottom: 20 }),
  });
  const activeNode = segmentNode(0);
  const inactiveNode = segmentNode(1);
  const layer = { querySelectorAll: () => [] };
  const records = [
    { id: 'active', recordType: 'geometry', segmentNodes: [activeNode] },
    { id: 'inactive', recordType: 'geometry', segmentNodes: [inactiveNode] },
  ];

  try {
    const cycler = createOverlapSelectionCycler({
      objectLayer: layer,
      records,
      isRecordCandidate: (record) => record.id === 'active',
      selectRecord() {},
    });
    assert.equal(cycler.cycle({ clientX: 10, clientY: 10 }).recordId, 'active');
  } finally {
    globalThis.document = previousDocument;
  }
});
