import test from 'node:test';
import assert from 'node:assert/strict';
import { pairAllowed } from '../../packages/paramagic-core/src/modules/ConstraintSystem.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';

const point = (recordId, index) => ({ kind: 'point', recordId, index });

test('the constraint picker rejects coincident points from the same entity', () => {
  for (const entityType of ['line', 'arc', 'table']) {
    assert.equal(pairAllowed('Coincident', [point(entityType, 0), point(entityType, 1)]), false);
  }
  assert.equal(pairAllowed('Coincident', [point('line-a', 1), point('line-b', 0)]), true);
});

test('the solver rejects self-coincident line, arc, and table points', () => {
  const entities = [
    { id: 'line', type: 'line', start: [0, 0], end: [10, 0] },
    {
      id: 'arc',
      type: 'arc',
      center: [0, 0],
      start: [10, 0],
      arcPoint: [7.0710678118654755, 7.0710678118654755],
      end: [0, 10],
      ccw: true,
    },
    { id: 'table', type: 'table', x: 0, y: 0, width: 100, height: 60 },
  ];
  for (const entity of entities) {
    const solver = createSolverController();
    solver.addEntity(entity);
    const outcome = solver.addConstraint({
      type: 'Coincident',
      featureRefs: [point(entity.id, 0), point(entity.id, 1)],
    });
    assert.equal(outcome.constraint, null, entity.type);
    assert.match(outcome.result.message, /two different entities/);
    assert.equal(solver.constraints().length, 0, entity.type);
  }
});

test('rigid-first coincident placement preserves table size and arc shape', () => {
  const tableSolver = createSolverController();
  tableSolver.addEntity({ id: 'table', type: 'table', x: 10, y: 20, width: 150, height: 70 });
  tableSolver.addEntity({ id: 'target', type: 'point', point: [200, 300] });
  const tableOutcome = tableSolver.addConstraint({
    type: 'Coincident',
    featureRefs: [point('table', 2), point('target', 0)],
  });
  const table = tableSolver.getEntity('table');
  assert.equal(tableOutcome.result.rigidFirstSolveAccepted, true);
  assert.deepEqual(tableOutcome.result.changedEntityIds, ['table']);
  assert.equal(table.x, 50);
  assert.equal(table.y, 230);
  assert.equal(table.width, 150);
  assert.equal(table.height, 70);

  const arcSolver = createSolverController();
  arcSolver.addEntity({
    id: 'arc',
    type: 'arc',
    center: [0, 0],
    start: [10, 0],
    arcPoint: [7.0710678118654755, 7.0710678118654755],
    end: [0, 10],
    ccw: true,
  });
  arcSolver.addEntity({ id: 'target', type: 'point', point: [20, 20] });
  const arcOutcome = arcSolver.addConstraint({
    type: 'Coincident',
    featureRefs: [point('arc', 0), point('target', 0)],
  });
  const arc = arcSolver.getEntity('arc');
  assert.equal(arcOutcome.result.rigidFirstSolveAccepted, true);
  assert.ok(Math.hypot(arc.start[0] - 20, arc.start[1] - 20) < 1e-8);
  assert.ok(Math.hypot(arc.center[0] - 10, arc.center[1] - 20) < 1e-8);
  assert.ok(Math.abs(arc.radius - 10) < 1e-8);
});

test('rigid-first falls back to the unrestricted solve when placement is blocked', () => {
  const solver = createSolverController();
  solver.addEntity({ id: 'table', type: 'table', x: 10, y: 20, width: 150, height: 70 });
  solver.addConstraint({ type: 'Fixed', featureRefs: [point('table', 0)] });
  solver.addEntity({ id: 'target', type: 'point', point: [200, 300] });
  solver.addConstraint({ type: 'Fixed', featureRefs: [point('target', 0)] });

  const outcome = solver.addConstraint({
    type: 'Coincident',
    featureRefs: [point('table', 2), point('target', 0)],
  });
  const table = solver.getEntity('table');
  assert.equal(outcome.result.rigidFirstSolveAttempted, true);
  assert.equal(outcome.result.rigidFirstSolveAccepted, false);
  assert.equal(outcome.result.rigidFirstSolveFallback, true);
  assert.ok(Math.abs(table.width - 150) > 1e-6 || Math.abs(table.height - 70) > 1e-6);
});

test('the rigid-first trial can be disabled without changing constraint behavior elsewhere', () => {
  const solver = createSolverController({ rigidFirstConstraintSolve: false });
  solver.addEntity({ id: 'table', type: 'table', x: 10, y: 20, width: 150, height: 70 });
  solver.addEntity({ id: 'target', type: 'point', point: [200, 300] });
  const outcome = solver.addConstraint({
    type: 'Coincident',
    featureRefs: [point('table', 2), point('target', 0)],
  });
  const table = solver.getEntity('table');
  assert.equal(outcome.result.rigidFirstSolveAttempted, undefined);
  assert.ok(Math.abs(table.width - 150) > 1e-6 || Math.abs(table.height - 70) > 1e-6);
});
