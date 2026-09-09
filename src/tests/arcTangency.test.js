import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { evaluateConstraint, solveLevenbergMarquardt } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { verifyJacobianBlock } from '../../packages/paramagic-core/src/modules/solver/JacobianBlocks.js';

const drawing = JSON.parse(readFileSync(new URL('./fixtures/rectangle-ottoman-tangent.paramagic', import.meta.url)));
const arcIds = ['007ed6ab-4cd2-41d4-819e-240806c0aeb5', '39cf8ea3-a795-44b5-9d35-e48c752c0bd0'];
const point = (recordId, index) => ({ kind: 'point', recordId, index });
const tangent = (ids = arcIds, tangentMode = 'external') => ({ type: 'Tangent', tangentMode,
  featureRefs: ids.map(recordId => ({ kind: 'arc', recordId })) });

for (const reverse of [false, true]) {
  test(`Ottoman joined arcs converge and survive save/load (${reverse ? 'reverse' : 'forward'} selection)`, () => {
    const controller = createSolverController();
    controller.loadSketch(drawing);
    const result = controller.addConstraint({ ...tangent(reverse ? [...arcIds].reverse() : arcIds),
      stackId: drawing.entities.find(e => e.id === arcIds[0]).stackId });
    assert.equal(result.result.status, 'converged', result.result.message);
    assert.ok(result.result.iterations < 50, `${result.result.iterations} iterations`);
    assert.ok(result.constraint.tangentPoint);
    const first = controller.model.resolveEntity({ recordId: arcIds[0] });
    const second = controller.model.resolveEntity({ recordId: arcIds[1] });
    assert.ok(Math.hypot(first.end[0] - second.start[0], first.end[1] - second.start[1]) < 1e-6);
    assert.ok(evaluateConstraint(controller.model, result.constraint, controller.dimensions).every(r => Math.abs(r) < 1e-6));
    const saved = controller.getSketchSnapshot();
    assert.equal(saved.constraints.filter(c => c.type === 'Fixed').length, drawing.constraints.filter(c => c.type === 'Fixed').length);
    const restored = createSolverController();
    restored.loadSketch(saved);
    assert.deepEqual(restored.model.constraints.get(result.constraint.id).tangentPoint, result.constraint.tangentPoint);
    assert.ok(['converged', 'unchanged'].includes(restored.solve().status));
  });
}

for (const mode of ['external', 'internal']) {
  for (const scale of [0.13, 1, 100]) {
    test(`joined arc ${mode} tangent at scale ${scale} retains contact and has correct derivatives`, () => {
      const model = new SketchModel();
      const scaled = p => p.map(v => v * scale);
      model.addEntity({ id: 'a', type: 'arc', start: scaled([-10, 10]), arcPoint: scaled([-3, 7]), end: [0, 0] });
      model.addEntity({ id: 'b', type: 'arc', start: [0, 0], arcPoint: scaled(mode === 'external' ? [3, -6] : [-2, -6]), end: scaled(mode === 'external' ? [10, -10] : [-10, -10]) });
      const constraint = { id: 'tangent', ...tangent(['a', 'b'], mode), tangentPoint: point('a', 2) };
      model.addConstraint(constraint);
      model.addConstraint({ id: 'joint', type: 'Coincident', featureRefs: [point('a', 2), point('b', 0)] });
      const registry = new ConstraintRegistry();
      const block = registry.blocks(model, null).blocks.find(b => b.constraintId === constraint.id);
      const verified = verifyJacobianBlock(block);
      assert.equal(verified.valid, true, JSON.stringify(verified.differences));
      const result = solveLevenbergMarquardt({ model, registry, dimensions: null, tolerance: 1e-8, jacobianMode: 'blocks' });
      assert.ok(['converged', 'unchanged'].includes(result.status), result.message);
      // Contact remains a tangent requirement after the separate Coincident is removed.
      model.constraints.delete('joint');
      assert.ok(evaluateConstraint(model, constraint).every(r => Math.abs(r) < 1e-6));
      const otherCenter = model.binding('b').variables.get('center.x');
      otherCenter.value += scale;
      assert.ok(evaluateConstraint(model, constraint).some(r => Math.abs(r) > 1e-4));
    });
  }
}

test('failure diagnostics retain small nonzero constraint errors and exclude intrinsic rows', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'p', type: 'point', point: [0, 0] });
  const registry = { evaluate: () => ({ values: [2e-7, 1e-7, 5e-8],
    equations: [{ constraintId: null }, { constraintId: 'tiny-error' }, { constraintId: 'tiny-error' }] }) };
  const result = solveLevenbergMarquardt({ model, registry, tolerance: 1e-10, maxIterations: 0 });
  assert.deepEqual(result.problematicConstraintIds, ['tiny-error']);
});

test('failed tangent creation names the attempted operation and preserves the drawing', () => {
  const controller = createSolverController();
  controller.loadSketch(drawing);
  const before = controller.getSketchSnapshot();
  controller.solve = () => ({ status: 'max-iterations', message: 'Solver did not converge; geometry was restored.' });
  const result = controller.addConstraint(tangent());
  assert.equal(result.constraint, null);
  assert.match(result.result.message, /^Could not add Tangent\./);
  assert.deepEqual(controller.getSketchSnapshot(), before);
});
