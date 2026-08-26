import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFillet,
  evaluateFilletedGeometry,
  evaluateLineLineFillet,
  filletTopologyConstraints,
  findFilletCorner,
  findLineLineCorner,
  regularFilletConstraints,
  filletPresentationRecordIds,
  inheritSwellFilletArc,
} from '../../packages/paramagic-core/src/modules/FilletSystem.js';
import { isSwellEntity, withSwellDefinition } from '../../packages/paramagic-core/src/modules/SwellGeometry.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { findClosedGeometryCycles } from '../../packages/paramagic-core/src/modules/BoundaryTopology.js';

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not within ${tolerance} of ${expected}`);
const lines = [
  { id: 'horizontal', type: 'line', start: [0, 0], end: [100, 0] },
  { id: 'vertical', type: 'line', start: [0, 0], end: [0, 100] },
];
const fillet = {
  id: 'fillet-a',
  type: 'fillet',
  sourceA: { recordId: 'horizontal', index: 0 },
  sourceB: { recordId: 'vertical', index: 0 },
  radius: 10,
  radiusExpression: '10 mm',
};

test('fillet presentation updates only changed sources and their dependent fillets', () => {
  const records = [
    { id: 'horizontal', recordType: 'geometry', entity: lines[0] },
    { id: 'vertical', recordType: 'geometry', entity: lines[1] },
    { id: 'unrelated', recordType: 'geometry', entity: { id: 'unrelated', type: 'line' } },
    { id: 'fillet-a', recordType: 'fillet', entity: fillet },
  ];

  assert.deepEqual(
    [...filletPresentationRecordIds(records, new Set(['horizontal']))].sort(),
    ['fillet-a', 'horizontal', 'vertical'],
  );
  assert.deepEqual(
    [...filletPresentationRecordIds(records, new Set(['unrelated']))],
    ['unrelated'],
  );
});

test('line-line fillet derives tangent points without changing source endpoints', () => {
  const source = structuredClone(lines);
  const evaluated = evaluateLineLineFillet(fillet, new Map(source.map((entity) => [entity.id, entity])));

  assert.equal(evaluated.valid, true);
  near(evaluated.tangentA[0], 10);
  near(evaluated.tangentA[1], 0);
  near(evaluated.tangentB[0], 0);
  near(evaluated.tangentB[1], 10);
  assert.deepEqual(source, lines);
});

test('regular fillet constraints convert a line corner into a solved arc', () => {
  const solver = createSolverController();
  lines.forEach((entity) => solver.addEntity(entity));
  solver.addConstraint({
    id: 'corner',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'horizontal', index: 0 },
      { kind: 'point', recordId: 'vertical', index: 0 },
    ],
  });
  const evaluated = evaluateLineLineFillet(fillet, new Map(lines.map((entity) => [entity.id, entity])));
  assert.equal(evaluated.valid, true);
  const arc = { ...evaluated.arc, type: 'arc' };
  solver.removeConstraint('corner');
  solver.updateEntity({ ...lines[0], start: evaluated.tangentA });
  solver.updateEntity({ ...lines[1], start: evaluated.tangentB });
  solver.addEntity(arc);
  const constraints = regularFilletConstraints({
    arcId: arc.id,
    firstEntity: lines[0],
    firstRecordId: lines[0].id,
    firstIndex: 0,
    secondEntity: lines[1],
    secondRecordId: lines[1].id,
    secondIndex: 0,
  });
  const outcomes = constraints.map((constraint) => solver.addConstraint(constraint));

  assert.equal(constraints.length, 4);
  assert.ok(outcomes.every(({ constraint }) => constraint));
  const solved = new Map(solver.getGeometrySnapshot().map((entity) => [entity.id, entity]));
  near(solved.get('horizontal').start[0], 10);
  near(solved.get('vertical').start[1], 10);
  near(solved.get(arc.id).radius, 10);
  assert.deepEqual(solver.constraints().map(({ type }) => type), ['Coincident', 'Coincident', 'Tangent', 'Tangent']);
});

test('evaluated fillet geometry trims display lines and adds an arc', () => {
  const evaluated = evaluateFilletedGeometry([...lines, fillet]);
  const horizontal = evaluated.find(({ id }) => id === 'horizontal');
  const vertical = evaluated.find(({ id }) => id === 'vertical');
  const arc = evaluated.find(({ id }) => id === 'fillet-a');

  near(horizontal.start[0], 10);
  near(horizontal.start[1], 0);
  near(vertical.start[0], 0);
  near(vertical.start[1], 10);
  near(arc.radius, 10);
});

test('evaluated fillet geometry preserves construction fillets as construction arcs', () => {
  const evaluated = evaluateFilletedGeometry([...lines, { ...fillet, construction: true }]);
  const arc = evaluated.find(({ id }) => id === 'fillet-a');

  assert.equal(arc.construction, true);
});

test('a fillet touching a Swell source inherits its Swell definition', () => {
  const source = withSwellDefinition(lines[0], {
    offsetExpression: '0.75 in',
    swellOffsetExpression: '2 in',
    startTransitionExpression: '3 in',
    endTransitionExpression: '5 in',
  });
  const arc = inheritSwellFilletArc({
    id: 'fillet-swell',
    type: 'arc',
    center: [10, 10],
    radius: 10,
    start: [10, 0],
    arcPoint: [17.071, 2.929],
    end: [20, 10],
  }, [lines[1], source], {
    sourceEndpoints: [
      { recordId: 'vertical', index: 0 },
      { recordId: 'horizontal', index: 2 },
    ],
  });

  assert.equal(isSwellEntity(arc), true);
  assert.equal(arc.construction, true);
  assert.equal(arc.composite.swell.offsetExpression, '0.75 in');
  assert.deepEqual(arc.composite.swellFillet.sourceEndpoints, [
    { recordId: 'vertical', index: 0 },
    { recordId: 'horizontal', index: 2 },
  ]);
});

test('fillet source endpoints can remain connected by their original Coincident constraint', () => {
  const constraint = {
    id: 'corner',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'horizontal', index: 0 },
      { kind: 'point', recordId: 'vertical', index: 0 },
    ],
  };
  const corner = findLineLineCorner(lines[0], lines[1], [constraint]);
  const topology = filletTopologyConstraints([constraint], [fillet]);

  assert.deepEqual(corner, { indexA: 0, indexB: 0, gap: 0, constrained: true });
  assert.equal(topology.some(({ id }) => id === 'corner'), false);
  assert.equal(topology.filter(({ type }) => type === 'Coincident').length, 2);
});

test('fillet rejects radii that consume either source line', () => {
  const evaluated = evaluateLineLineFillet(
    { ...fillet, radius: 200 },
    new Map(lines.map((entity) => [entity.id, entity])),
  );
  assert.equal(evaluated.valid, false);
  assert.match(evaluated.error, /too large/i);
});

test('fillet topology replaces the virtual sharp corner with the derived arc', () => {
  const square = [
    { id: 'bottom', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'right', type: 'line', start: [100, 0], end: [100, 100] },
    { id: 'top', type: 'line', start: [100, 100], end: [0, 100] },
    { id: 'left', type: 'line', start: [0, 100], end: [0, 0] },
  ];
  const cornerFillet = {
    ...fillet,
    sourceA: { recordId: 'bottom', index: 0 },
    sourceB: { recordId: 'left', index: 2 },
  };
  const coincident = (id, a, b) => ({ id, type: 'Coincident', featureRefs: [a, b] });
  const point = (recordId, index) => ({ kind: 'point', recordId, index });
  const constraints = [
    coincident('br', point('bottom', 2), point('right', 0)),
    coincident('rt', point('right', 2), point('top', 0)),
    coincident('tl', point('top', 2), point('left', 0)),
    coincident('lb', point('left', 2), point('bottom', 0)),
  ];
  const evaluated = evaluateFilletedGeometry([...square, cornerFillet]);
  const topology = filletTopologyConstraints(constraints, [cornerFillet]);
  const cycles = findClosedGeometryCycles(evaluated, topology);

  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].length, 5);
  assert.ok(cycles[0].some(({ entityId }) => entityId === cornerFillet.id));
});

test('line-arc fillet trims the line and arc from their shared corner', () => {
  const entities = [
    { id: 'line', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'arc', type: 'arc', start: [0, 0], arcPoint: [14.64466094067263, 35.35533905932737], end: [50, 50], center: [50, 0], radius: 50, ccw: false },
  ];
  const corner = findFilletCorner(entities[0], entities[1]);
  const filletEntity = {
    id: 'fillet-la',
    type: 'fillet',
    sourceA: { recordId: 'line', index: corner.indexA },
    sourceB: { recordId: 'arc', index: corner.indexB },
    radius: 10,
  };

  const evaluated = evaluateFillet(filletEntity, new Map(entities.map((entity) => [entity.id, structuredClone(entity)])));
  const trimmed = evaluateFilletedGeometry([...entities, filletEntity]);
  const line = trimmed.find(({ id }) => id === 'line');
  const arc = trimmed.find(({ id }) => id === 'arc');

  assert.equal(evaluated.valid, true);
  assert.ok(line.start[0] > 0);
  assert.notDeepEqual(arc.start, [0, 0]);
});

test('line-arc fillet keeps the source arc internally tangent to the fillet arc', () => {
  const entities = [
    { id: 'line', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'arc', type: 'arc', start: [0, 0], arcPoint: [14.64466094067263, 35.35533905932737], end: [50, 50], center: [50, 0], radius: 50, ccw: false },
  ];
  const filletEntity = {
    id: 'fillet-la-constraints',
    type: 'fillet',
    sourceA: { recordId: 'line', index: 0 },
    sourceB: { recordId: 'arc', index: 0 },
    radius: 10,
  };
  const evaluated = evaluateFillet(
    filletEntity,
    new Map(entities.map((entity) => [entity.id, structuredClone(entity)])),
  );
  assert.equal(evaluated.valid, true);

  const solver = createSolverController();
  entities.forEach((entity) => solver.addEntity(entity));
  const trimmedLine = { ...entities[0], start: evaluated.tangentA };
  const trimmedArc = { ...entities[1], start: evaluated.tangentB };
  const constraints = regularFilletConstraints({
    arcId: evaluated.arc.id,
    filletArc: evaluated.arc,
    firstEntity: entities[0],
    firstRecordId: entities[0].id,
    firstIndex: 0,
    secondEntity: entities[1],
    secondRecordId: entities[1].id,
    secondIndex: 0,
  });
  const outcome = solver.applyConstraintBatch({
    entities: [trimmedLine, trimmedArc, evaluated.arc],
    constraints,
  });
  const solved = new Map(outcome.snapshot.map((entity) => [entity.id, entity]));

  assert.equal(constraints.length, 4);
  assert.deepEqual(constraints.filter(({ type }) => type === 'Tangent').map(({ tangentMode }) => tangentMode), [undefined, 'internal']);
  assert.equal(outcome.committed, true);
  assert.equal(outcome.constraints.length, 4);
  near(solved.get('arc').radius, 50);
  near(solved.get(evaluated.arc.id).radius, 10);
  assert.deepEqual(solver.constraints().map(({ type }) => type), ['Coincident', 'Coincident', 'Tangent', 'Tangent']);
});

test('curve-line fillet trims the curve endpoint along its tangent', () => {
  const entities = [
    { id: 'curve', type: 'curve', points: [[0, 0], [0, 40], [40, 80]] },
    { id: 'line', type: 'line', start: [0, 0], end: [100, 0] },
  ];
  const corner = findFilletCorner(entities[0], entities[1]);
  const filletEntity = {
    id: 'fillet-cl',
    type: 'fillet',
    sourceA: { recordId: 'curve', index: corner.indexA },
    sourceB: { recordId: 'line', index: corner.indexB },
    radius: 10,
  };

  const evaluated = evaluateFilletedGeometry([...entities, filletEntity]);
  const curve = evaluated.find(({ id }) => id === 'curve');
  const line = evaluated.find(({ id }) => id === 'line');

  assert.ok(curve.points[0][1] > 0);
  near(line.start[0], 10);
});

test('arc-arc fillet trims both arcs from the shared corner', () => {
  const entities = [
    { id: 'arc-a', type: 'arc', start: [0, 0], arcPoint: [14.64466094067263, 35.35533905932737], end: [50, 50], center: [50, 0], radius: 50, ccw: false },
    { id: 'arc-b', type: 'arc', start: [0, 0], arcPoint: [35.35533905932738, 14.64466094067262], end: [50, 50], center: [0, 50], radius: 50, ccw: true },
  ];
  const corner = findFilletCorner(entities[0], entities[1]);
  const filletEntity = {
    id: 'fillet-aa',
    type: 'fillet',
    sourceA: { recordId: 'arc-a', index: corner.indexA },
    sourceB: { recordId: 'arc-b', index: corner.indexB },
    radius: 10,
  };

  const evaluated = evaluateFilletedGeometry([...entities, filletEntity]);
  const arcA = evaluated.find(({ id }) => id === 'arc-a');
  const arcB = evaluated.find(({ id }) => id === 'arc-b');
  const filletArc = evaluated.find(({ id }) => id === 'fillet-aa');

  assert.ok(arcA.start[0] > 0 || arcA.start[1] > 0);
  assert.ok(arcB.start[0] > 0 || arcB.start[1] > 0);
  near(filletArc.radius, 10);
});

test('arc-curve fillet trims both sources from the shared corner', () => {
  const entities = [
    { id: 'arc', type: 'arc', start: [0, 0], arcPoint: [14.64466094067263, 35.35533905932737], end: [50, 50], center: [50, 0], radius: 50, ccw: false },
    { id: 'curve', type: 'curve', points: [[0, 0], [40, 0], [80, 40]] },
  ];
  const corner = findFilletCorner(entities[0], entities[1]);
  const filletEntity = {
    id: 'fillet-ac',
    type: 'fillet',
    sourceA: { recordId: 'arc', index: corner.indexA },
    sourceB: { recordId: 'curve', index: corner.indexB },
    radius: 10,
  };

  const evaluated = evaluateFilletedGeometry([...entities, filletEntity]);
  const arc = evaluated.find(({ id }) => id === 'arc');
  const curve = evaluated.find(({ id }) => id === 'curve');

  assert.notDeepEqual(arc.start, [0, 0]);
  assert.notDeepEqual(curve.points[0], [0, 0]);
});

test('curve-curve fillet trims both curve endpoints along their tangents', () => {
  const entities = [
    { id: 'curve-a', type: 'curve', points: [[0, 0], [0, 40], [40, 80]] },
    { id: 'curve-b', type: 'curve', points: [[0, 0], [40, 0], [80, 40]] },
  ];
  const corner = findFilletCorner(entities[0], entities[1]);
  const filletEntity = {
    id: 'fillet-cc',
    type: 'fillet',
    sourceA: { recordId: 'curve-a', index: corner.indexA },
    sourceB: { recordId: 'curve-b', index: corner.indexB },
    radius: 10,
  };

  const evaluated = evaluateFilletedGeometry([...entities, filletEntity]);
  const curveA = evaluated.find(({ id }) => id === 'curve-a');
  const curveB = evaluated.find(({ id }) => id === 'curve-b');

  assert.ok(curveA.points[0][1] > 0);
  assert.ok(curveB.points[0][0] > 0);
});
