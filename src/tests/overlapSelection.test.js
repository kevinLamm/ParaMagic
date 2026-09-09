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

test('overlap cycling tolerates hand jitter and can reverse without drifting its anchor', () => {
  const start = advanceOverlapCycle(null, candidates, { x: 100, y: 120 });
  const next = advanceOverlapCycle(start, candidates, { x: 105, y: 122 });
  assert.equal(next.index, 1);
  assert.deepEqual([next.x, next.y], [100, 120]);
  assert.equal(advanceOverlapCycle(next, candidates, { x: 102, y: 120 }, 8, -1).index, 0);
});

test('hidden overlapping points preview without selecting; Enter accepts the exact handle', () => {
  const previousDocument = globalThis.document;
  const previousStyle = globalThis.getComputedStyle;
  const handles = candidates.filter(c => c.kind === 'handle').map(c => ({
    dataset: { handleIndex: String(c.handleIndex) },
    closest: selector => selector.includes('.canvas-record') ? { dataset: { recordId: c.recordId } } : null,
    getBoundingClientRect: () => ({ left: 94, top: 114, width: 12, height: 12 }),
    classList: { add() {}, remove() {} },
  }));
  const layer = { querySelectorAll: selector => selector === '.point-handle' ? handles : [] };
  const accepted = [];
  globalThis.document = { elementsFromPoint: () => [] };
  globalThis.getComputedStyle = () => ({ pointerEvents: 'none' });
  try {
    const cycler = createOverlapSelectionCycler({
      objectLayer: layer,
      records: [{ id: 'line-a' }, { id: 'line-b' }],
      selectCandidate: (candidate) => accepted.push(candidate),
    });
    const first = cycler.cycle({ clientX: 100, clientY: 120 });
    assert.equal(first.kind, 'handle');
    const second = cycler.cycle({ clientX: 104, clientY: 121 });
    assert.notEqual(first.recordId, second.recordId);
    assert.equal(accepted.length, 0);
    assert.equal(cycler.keyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }), true);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].handleIndex, second.handleIndex);
    assert.equal(accepted[0].recordId, second.recordId);
    assert.equal(cycler.commit(), null);
    cycler.cycle({ clientX: 100, clientY: 120 });
    cycler.keyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(cycler.commit(), null);
    assert.equal(accepted.length, 1);
  } finally {
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousStyle;
  }
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
