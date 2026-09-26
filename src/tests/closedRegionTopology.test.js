import test from 'node:test';
import assert from 'node:assert/strict';
import { findClosedGeometryCycles } from '../../packages/paramagic-core/src/modules/BoundaryTopology.js';
import { sharedPointRegions, touchingComposites } from './fixtures/sharedPointRegions.js';

const point = (recordId, index) => ({ kind: 'point', recordId, index });
const coincident = (id, a, b) => ({ id, type: 'Coincident', featureRefs: [a, b], enabled: true });

const members = (cycles) => cycles.map((cycle) => cycle.map(({ entityId }) => entityId).sort().join(',')).sort();

test('shared line/arc/curve junctions produce bounded faces rather than a spanning-tree cycle basis', () => {
  const entities = sharedPointRegions();
  for (const order of [entities, [...entities].reverse(), [entities[1], entities[0], entities[2]]]) {
    assert.deepEqual(members(findClosedGeometryCycles(order)), ['divider,lower-curve', 'divider,upper-arc']);
  }
});

test('touching closed composites retain their own edges and produce no extra regions', () => {
  const entities = touchingComposites();
  const expected = ['left-panel-0,left-panel-1,left-panel-2,left-panel-3', 'right-panel-0,right-panel-1,right-panel-2,right-panel-3'];
  assert.deepEqual(members(findClosedGeometryCycles(entities)), expected);
  assert.deepEqual(members(findClosedGeometryCycles([...entities].reverse())), expected);
});

test('an interior dangling branch does not become part of a fill boundary', () => {
  const entities = [...sharedPointRegions(), { id: 'branch', type: 'line', start: [-60, 0], end: [0, -20] }];
  assert.deepEqual(members(findClosedGeometryCycles(entities)), ['divider,lower-curve', 'divider,upper-arc']);
});

test('loose line loops sharing a divider stay separate when edge direction and order change', () => {
  const entities = [
    { id: 'divider', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'upper-a', type: 'line', start: [100, 0], end: [50, -50] },
    { id: 'upper-b', type: 'line', start: [50, -50], end: [0, 0] },
    { id: 'lower-a', type: 'line', start: [100, 0], end: [50, 50] },
    { id: 'lower-b', type: 'line', start: [50, 50], end: [0, 0] },
  ];
  const expected = ['divider,lower-a,lower-b', 'divider,upper-a,upper-b'];
  assert.deepEqual(members(findClosedGeometryCycles(entities)), expected);
  assert.deepEqual(members(findClosedGeometryCycles(entities.reverse().map((entity) => ({
    ...entity, start: entity.end, end: entity.start,
  })))), expected);
});

test('tangent arc loops meeting at a single point do not exchange their boundaries', () => {
  const entities = [
    { id: 'left-top', type: 'arc', start: [-100, 0], arcPoint: [-50, -50], end: [0, 0] },
    { id: 'right-top', type: 'arc', start: [0, 0], arcPoint: [50, -50], end: [100, 0] },
    { id: 'left-bottom', type: 'arc', start: [0, 0], arcPoint: [-50, 50], end: [-100, 0] },
    { id: 'right-bottom', type: 'arc', start: [100, 0], arcPoint: [50, 50], end: [0, 0] },
  ];
  assert.deepEqual(members(findClosedGeometryCycles(entities)), ['left-bottom,left-top', 'right-bottom,right-top']);
});

test('loose geometry and a closed composite may share both endpoints without borrowing edges', () => {
  const panel = touchingComposites().slice(0, 4);
  const loose = [
    { id: 'loose-line', type: 'line', start: [100, 0], end: [100, 80] },
    { id: 'loose-curve', type: 'curve', points: [[100, 80], [150, 40], [100, 0]] },
  ];
  assert.deepEqual(members(findClosedGeometryCycles([...panel, ...loose])), [
    'left-panel-0,left-panel-1,left-panel-2,left-panel-3', 'loose-curve,loose-line',
  ]);
});

test('a bridge between nested outlines does not concatenate their fill boundaries', () => {
  const outline = (prefix, points) => points.map((start, index) => ({
    id: `${prefix}-${index}`, type: 'line', start, end: points[(index + 1) % points.length],
  }));
  const entities = [
    ...outline('outer', [[0, 0], [100, 0], [100, 100], [0, 100]]),
    ...outline('inner', [[25, 25], [75, 25], [75, 75], [25, 75]]),
    { id: 'bridge', type: 'line', start: [0, 0], end: [25, 25] },
  ];
  assert.deepEqual(members(findClosedGeometryCycles(entities)), [
    'inner-0,inner-1,inner-2,inner-3', 'outer-0,outer-1,outer-2,outer-3',
  ]);
});

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
    { id: 'c', type: 'line', start: [50, 100], end: [0, 0.01] },
  ];
  const constraints = [
    coincident('ab', point('a', 2), point('b', 0)),
    coincident('bc', point('b', 2), point('c', 0)),
  ];
  assert.deepEqual(findClosedGeometryCycles(entities, constraints), []);
});

test('shared endpoint coordinates join visible geometry without Coincident constraints', () => {
  const entities = [
    { id: 'top', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'right', type: 'line', start: [100, 0], end: [100, 100] },
    { id: 'bottom', type: 'line', start: [100, 100], end: [0, 100] },
    { id: 'left', type: 'line', start: [0, 100], end: [0, 0] },
  ];

  const cycles = findClosedGeometryCycles(entities, []);

  assert.equal(cycles.length, 1);
  assert.deepEqual(new Set(cycles[0].map(({ entityId }) => entityId)), new Set(['top', 'right', 'bottom', 'left']));
});

test('construction endpoints can provide shared topology nodes without becoming boundary edges', () => {
  const entities = [
    { id: 'top', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'right', type: 'line', start: [101, 0], end: [100, 100] },
    { id: 'bottom', type: 'line', start: [100, 101], end: [0, 100] },
    { id: 'left', type: 'line', start: [-1, 100], end: [0, 0] },
    { id: 'corner-br', type: 'line', construction: true, start: [100, 0], end: [100, 1] },
    { id: 'corner-tr', type: 'line', construction: true, start: [100, 100], end: [100, 101] },
    { id: 'corner-tl', type: 'line', construction: true, start: [0, 100], end: [0, 101] },
    { id: 'corner-bl', type: 'line', construction: true, start: [0, 0], end: [0, 1] },
  ];
  const constraints = [
    coincident('br-top', point('top', 2), point('corner-br', 0)),
    coincident('br-right', point('right', 0), point('corner-br', 0)),
    coincident('tr-right', point('right', 2), point('corner-tr', 0)),
    coincident('tr-bottom', point('bottom', 0), point('corner-tr', 0)),
    coincident('tl-bottom', point('bottom', 2), point('corner-tl', 0)),
    coincident('tl-left', point('left', 0), point('corner-tl', 0)),
    coincident('bl-left', point('left', 2), point('corner-bl', 0)),
    coincident('bl-top', point('top', 0), point('corner-bl', 0)),
  ];

  const cycles = findClosedGeometryCycles(entities, constraints);

  assert.equal(cycles.length, 1);
  assert.deepEqual(new Set(cycles[0].map(({ entityId }) => entityId)), new Set(['top', 'right', 'bottom', 'left']));
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
