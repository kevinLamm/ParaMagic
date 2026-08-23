import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveClosedBoundaries,
  resolveClosedBoundariesForRecordIds,
  resolvedBoundaryForHost,
} from '../../packages/paramagic-core/src/modules/BoundaryTopology.js';

test('incremental boundary resolution excludes unrelated geometry', () => {
  const entities = [
    { id: 'active-rect', type: 'rect', x: 0, y: 0, width: 10, height: 10 },
    { id: 'inactive-rect', type: 'rect', x: 30, y: 0, width: 10, height: 10 },
  ];
  const boundaries = resolveClosedBoundariesForRecordIds(entities, [], ['active-rect']);
  assert.deepEqual(boundaries.map(({ id }) => id), ['active-rect']);
});

test('a closed edge composite resolves to one ordered boundary with stable source references', () => {
  const composite = { id: 'panel', kind: 'rectangle', closed: true, count: 4 };
  const entities = [
    { id: 'top', type: 'line', start: [0, 0], end: [100, 0], composite: { ...composite, index: 0 } },
    { id: 'right', type: 'line', start: [100, 0], end: [100, 60], composite: { ...composite, index: 1 } },
    { id: 'bottom', type: 'line', start: [100, 60], end: [0, 60], composite: { ...composite, index: 2 } },
    { id: 'left', type: 'line', start: [0, 60], end: [0, 0], composite: { ...composite, index: 3 } },
  ];
  const first = resolveClosedBoundaries(entities);
  const moved = resolveClosedBoundaries(entities.map((entity) => ({
    ...entity,
    start: [entity.start[0] + 20, entity.start[1]],
    end: [entity.end[0] + 20, entity.end[1]],
  })));

  assert.equal(first.length, 1);
  assert.equal(first[0].id, 'panel');
  assert.deepEqual(new Set(first[0].recordIds), new Set(['top', 'right', 'bottom', 'left']));
  assert.equal(first[0].features.length, 4);
  assert.deepEqual(
    moved[0].features.map(({ stableKey }) => stableKey),
    first[0].features.map(({ stableKey }) => stableKey),
  );
  assert.equal(resolvedBoundaryForHost(first, { recordId: 'right' })?.id, 'panel');
});

test('fillets become analytic members of the same resolved physical boundary', () => {
  const composite = { id: 'rounded-panel', kind: 'rectangle', closed: true, count: 4 };
  const boundaries = resolveClosedBoundaries([
    { id: 'top', type: 'line', start: [0, 0], end: [100, 0], composite: { ...composite, index: 0 } },
    { id: 'right', type: 'line', start: [100, 0], end: [100, 60], composite: { ...composite, index: 1 } },
    { id: 'bottom', type: 'line', start: [100, 60], end: [0, 60], composite: { ...composite, index: 2 } },
    { id: 'left', type: 'line', start: [0, 60], end: [0, 0], composite: { ...composite, index: 3 } },
    {
      id: 'corner-fillet', type: 'fillet', radius: 10,
      sourceA: { recordId: 'top', index: 2 },
      sourceB: { recordId: 'right', index: 0 },
    },
  ]);

  assert.equal(boundaries.length, 1);
  assert.ok(boundaries[0].features.some((feature) => feature.kind === 'arc' && feature.recordId === 'corner-fillet'));
  assert.match(boundaries[0].d, /A 10 10/);
});

test('construction endpoints connect a resolved visible boundary without being included in it', () => {
  const point = (recordId, index) => ({ kind: 'point', recordId, index });
  const coincident = (id, first, second) => ({
    id,
    type: 'Coincident',
    featureRefs: [first, second],
    enabled: true,
  });
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

  const [boundary] = resolveClosedBoundaries(entities, constraints);

  assert.ok(boundary);
  assert.deepEqual(new Set(boundary.recordIds), new Set(['top', 'right', 'bottom', 'left']));
  assert.equal(boundary.features.some(({ recordId }) => recordId.startsWith('corner-')), false);
});

test('a circle resolves as a closed primitive boundary with sampled area', () => {
  const [boundary] = resolveClosedBoundaries([
    { id: 'circle', type: 'circle', center: [25, 30], radius: 20 },
  ]);

  assert.equal(boundary.id, 'circle');
  assert.equal(boundary.kind, 'primitive');
  assert.equal(boundary.features.length, 1);
  assert.equal(boundary.features[0].kind, 'circle');
  assert.equal(boundary.polygon.length, 48);
  assert.match(boundary.d, /^M 45 30 A 20 20/);
});
