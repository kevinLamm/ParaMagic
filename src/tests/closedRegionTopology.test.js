import test from 'node:test';
import assert from 'node:assert/strict';
import { findClosedGeometryCycles } from '../modules/ClosedRegionTopology.js';

const point = (recordId, index) => ({ kind: 'point', recordId, index });
const coincident = (id, a, b) => ({ id, type: 'Coincident', featureRefs: [a, b], enabled: true });

test('coincident endpoint constraints turn connected open objects into a closed cycle', () => {
  const entities = [
    { id: 'top', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'right', type: 'line', start: [100, 0], end: [100, 100] },
    { id: 'bottom', type: 'line', start: [100, 100], end: [0, 100] },
    { id: 'left', type: 'line', start: [0, 100], end: [0, 0] },
  ];
  const constraints = [
    coincident('a', point('top', 2), point('right', 0)),
    coincident('b', point('right', 2), point('bottom', 0)),
    coincident('c', point('bottom', 2), point('left', 0)),
    coincident('d', point('left', 2), point('top', 0)),
  ];
  const cycles = findClosedGeometryCycles(entities, constraints);
  assert.equal(cycles.length, 1);
  assert.deepEqual(new Set(cycles[0].map(({ entityId }) => entityId)), new Set(['top', 'right', 'bottom', 'left']));
});

test('an unconstrained gap prevents closed-region classification', () => {
  const entities = [
    { id: 'a', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'b', type: 'line', start: [100, 0], end: [50, 100] },
    { id: 'c', type: 'line', start: [50, 100], end: [0, 0] },
  ];
  const constraints = [
    coincident('ab', point('a', 2), point('b', 0)),
    coincident('bc', point('b', 2), point('c', 0)),
  ];
  assert.deepEqual(findClosedGeometryCycles(entities, constraints), []);
});

test('construction objects are excluded from closed-region topology', () => {
  const entities = [
    { id: 'a', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'b', type: 'line', start: [100, 0], end: [50, 100], construction: true },
    { id: 'c', type: 'line', start: [50, 100], end: [0, 0] },
  ];
  const constraints = [
    coincident('ab', point('a', 2), point('b', 0)),
    coincident('bc', point('b', 2), point('c', 0)),
    coincident('ca', point('c', 2), point('a', 0)),
  ];
  assert.deepEqual(findClosedGeometryCycles(entities, constraints), []);
});

test('arcs and curves can form a constrained compound closed cycle', () => {
  const entities = [
    { id: 'arc', type: 'arc', start: [-50, 0], arcPoint: [0, -50], end: [50, 0] },
    { id: 'curve', type: 'curve', points: [[50, 0], [0, 50], [-50, 0]] },
  ];
  const constraints = [
    coincident('first', point('arc', 2), point('curve', 0)),
    coincident('second', point('curve', 2), point('arc', 0)),
  ];
  assert.equal(findClosedGeometryCycles(entities, constraints).length, 1);
});

test('a constrained branch does not prevent its connected loop from being closed', () => {
  const entities = [
    { id: 'a', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'b', type: 'line', start: [100, 0], end: [50, 100] },
    { id: 'c', type: 'line', start: [50, 100], end: [0, 0] },
    { id: 'branch', type: 'line', start: [100, 0], end: [160, 40] },
  ];
  const constraints = [
    coincident('ab', point('a', 2), point('b', 0)),
    coincident('bc', point('b', 2), point('c', 0)),
    coincident('ca', point('c', 2), point('a', 0)),
    coincident('branch-join', point('a', 2), point('branch', 0)),
  ];
  const cycles = findClosedGeometryCycles(entities, constraints);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].some(({ entityId }) => entityId === 'branch'), false);
});

test('a closed line composite fills without requiring auto constraints', () => {
  const composite = (index) => ({ id: 'rectangle-a', kind: 'rectangle', closed: true, index, count: 4 });
  const entities = [
    { id: 'top', type: 'line', start: [0, 0], end: [100, 0], composite: composite(0) },
    { id: 'right', type: 'line', start: [100, 0], end: [100, 80], composite: composite(1) },
    { id: 'bottom', type: 'line', start: [100, 80], end: [0, 80], composite: composite(2) },
    { id: 'left', type: 'line', start: [0, 80], end: [0, 0], composite: composite(3) },
  ];
  const cycles = findClosedGeometryCycles(entities, []);
  assert.equal(cycles.length, 1);
  assert.deepEqual(new Set(cycles[0].map(({ entityId }) => entityId)), new Set(['top', 'right', 'bottom', 'left']));
});

test('a broken or incomplete line composite does not fill', () => {
  const composite = (index) => ({ id: 'polyline-a', kind: 'polyline', closed: true, index, count: 3 });
  const broken = [
    { id: 'a', type: 'line', start: [0, 0], end: [100, 0], composite: composite(0) },
    { id: 'b', type: 'line', start: [105, 0], end: [50, 80], composite: composite(1) },
    { id: 'c', type: 'line', start: [50, 80], end: [0, 0], composite: composite(2) },
  ];
  assert.deepEqual(findClosedGeometryCycles(broken, []), []);
  assert.deepEqual(findClosedGeometryCycles(broken.slice(0, 2), []), []);
});
