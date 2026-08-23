import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAutoConstraints } from '../../packages/paramagic-core/src/modules/ConstraintSystem.js';
import { ARC_MIDPOINT_ROLE } from '../../packages/paramagic-core/src/modules/ArcGeometry.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';

const arc = {
  id: 'arc',
  type: 'arc',
  start: [10, 0],
  arcPoint: [8.660254037844386, 5],
  end: [-5, 8.660254037844386],
  center: [0, 0],
  radius: 10,
  ccw: true,
};

const midpoint = [5, 8.660254037844386];

test('arc midpoint references resolve to the true half-sweep point', () => {
  const model = new SketchModel();
  model.addEntity(arc);

  assert.deepEqual(
    model.resolvePoint({ kind: 'point', recordId: arc.id, pointRole: ARC_MIDPOINT_ROLE }).map((value) => Number(value.toFixed(8))),
    midpoint.map((value) => Number(value.toFixed(8))),
  );
  assert.notDeepEqual(
    model.resolvePoint({ kind: 'point', recordId: arc.id, index: 1 }).map((value) => Number(value.toFixed(8))),
    midpoint.map((value) => Number(value.toFixed(8))),
  );
  assert.ok(model.variableIdsForFeature({ kind: 'point', recordId: arc.id, pointRole: ARC_MIDPOINT_ROLE }).length > 0);
});

test('coincident constraints can solve against an arc midpoint reference', () => {
  const solver = createSolverController();
  solver.addEntity(arc);
  solver.addEntity({ id: 'line', type: 'line', start: midpoint, end: [5, 20] });

  const outcome = solver.addConstraint({
    id: 'arc-midpoint-coincident',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'arc', pointRole: ARC_MIDPOINT_ROLE },
      { kind: 'point', recordId: 'line', index: 0 },
    ],
  });

  assert.ok(outcome.constraint);
  const solvedLine = solver.getGeometrySnapshot().find((entity) => entity.id === 'line');
  assert.deepEqual(solvedLine.start.map((value) => Number(value.toFixed(8))), midpoint.map((value) => Number(value.toFixed(8))));
});

test('auto constraints preserve an arc midpoint snap role', () => {
  const constraints = detectAutoConstraints({
    entity: { id: 'line', type: 'line', start: [0, 0], end: [0, 20] },
    recordId: 'line',
    snapRefs: [{ recordId: 'arc', index: 1, pointRole: ARC_MIDPOINT_ROLE }],
    existingEntities: [arc],
  });
  const coincident = constraints.find((constraint) => constraint.type === 'Coincident');

  assert.equal(coincident.featureRefs[1].pointRole, ARC_MIDPOINT_ROLE);
});
