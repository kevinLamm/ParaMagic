import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { DEFAULT_SOLVE_TOLERANCE, evaluateConstraint, isSuccessfulSolve } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { deriveSwellGeometry, withSwellDefinition } from '../../packages/paramagic-core/src/modules/SwellGeometry.js';
import { SolverWorkerRuntime } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerRuntime.js';
import { createSolverWorkerRequest } from '../../packages/paramagic-core/src/modules/solver/SolverWorkerProtocol.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/swell-front-view.paramagic', import.meta.url), 'utf8'));
const near = (actual, expected, tolerance = DEFAULT_SOLVE_TOLERANCE) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
function verifyFront(controller, width = 50) {
  assert.ok(isSuccessfulSolve(controller.lastResult), controller.lastResult?.message);
  assert.equal(controller.constraints().length, 84);
  assert.ok(controller.constraints().every((constraint) => constraint.enabled !== false && !constraint.loadError));
  const data = controller.getSketchSnapshot();
  const derived = deriveSwellGeometry({
    entities: data.entities, constraints: data.constraints,
    evaluateLength: (expression, entity) => controller.evaluateDrawingLengthExpression(expression, entity),
  });
  for (const constraint of data.constraints) {
    const residuals = evaluateConstraint(controller.model.constraintModel(constraint), constraint, controller.dimensions);
    assert.ok(Math.hypot(...residuals) < DEFAULT_SOLVE_TOLERANCE, `${constraint.type}: ${residuals}`);
    if (constraint.type !== 'Coincident' || !constraint.featureRefs.some((ref) => ref.derivedFeature)) continue;
    const ref = constraint.featureRefs.find((entry) => entry.derivedFeature);
    const other = constraint.featureRefs.find((entry) => !entry.derivedFeature);
    const piece = derived.get(ref.recordId).pieces.find(({ role }) => role === ref.derivedFeature.role);
    const point = ref.index === 0 ? piece.entity.start : piece.entity.end;
    const endpoint = controller.model.resolvePoint(other);
    near(Math.hypot(point[0] - endpoint[0], point[1] - endpoint[1]), 0);
  }
  const d10 = data.parameters.find(({ name }) => name === 'd10');
  const d7 = data.parameters.find(({ name }) => name === 'd7');
  const widthLine = data.entities.find(({ id }) => id === 'e00ba7d1-23a4-46bf-8014-b9cb8e6b54dc');
  near(Math.hypot(widthLine.start[0] - widthLine.end[0], widthLine.start[1] - widthLine.end[1]) / 25.4, width, width * DEFAULT_SOLVE_TOLERANCE);
  const height = data.constraints.find(({ dimensionRef }) => dimensionRef === d7.id);
  const selector = height.anchors.start.derivedFeature;
  const swell = derived.get(height.anchors.start.recordId).pieces.find(({ role }) => role === selector.role);
  near(Math.abs(swell.entity.end[1] - controller.model.resolvePoint(height.anchors.end)[1]) / 25.4, 20);
  assert.equal(controller.model.allVariables().filter((variable) => variable.fixed || variable.locked).length, 0);
  return d10.id;
}

for (const jacobianMode of ['dense', 'blocks']) {
  test(`Swell front view solves all dimensions and derived coincidences together (${jacobianMode})`, () => {
    const controller = createSolverController({ jacobianMode });
    controller.loadSketch(fixture());
    const dimensionId = verifyFront(controller);
    controller.updateParameter(dimensionId, { expression: '52' });
    verifyFront(controller, 52);
    const reopened = createSolverController({ jacobianMode });
    reopened.loadSketch(controller.getSketchSnapshot());
    verifyFront(reopened, 52);
    const reversed = fixture();
    reversed.entities.reverse();
    reversed.constraints.reverse();
    reversed.extensions.swell.constraints.reverse();
    controller.loadSketch(reversed);
    verifyFront(controller);
  });
}

test('worker loads legacy Swell relationships and edits d10 without losing derived dependencies', () => {
  const runtime = new SolverWorkerRuntime({ jacobianMode: 'blocks' });
  const loaded = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 1, generation: 0, type: 'load-sketch', payload: { snapshot: fixture() },
  }));
  assert.ok(isSuccessfulSolve(loaded), loaded.message);
  const dimensionId = verifyFront(runtime.controller);
  const updated = runtime.handleRequest(createSolverWorkerRequest({
    requestToken: 2, generation: 1, type: 'update-parameter', payload: { parameterId: dimensionId, patch: { expression: '52' } },
  }));
  assert.ok(isSuccessfulSolve(updated), updated.message);
  verifyFront(runtime.controller, 52);
});

test('legacy transient Swell point-on-line selectors migrate and stay attached after an offset parameter edit', () => {
  const source = withSwellDefinition({ id: 'source', type: 'line', start: [0, 0], end: [80, 0] }, { swellEnabled: false, offsetExpression: 'offset' });
  const movable = { id: 'movable', type: 'line', start: [30, 25], end: [55, 25] };
  const piece = deriveSwellGeometry({ entities: [source], evaluateLength: () => 10 }).get(source.id).pieces[0];
  const controller = createSolverController({ jacobianMode: 'blocks' });
  const loaded = controller.loadSketch({
    drawingUnit: 'mm', entities: [source, movable],
    parameters: [{ id: 'offset-param', name: 'offset', kind: 'user', expression: '10', value: 10, unit: 'mm' }],
    extensions: { swell: { version: 1, constraints: [{
      id: 'on-line', type: 'Point-on Line', externalTarget: {
        type: 'swell-derived', sourceId: source.id,
        derivedRef: { kind: 'segment', recordId: piece.id, index: 0 },
        movableRef: { kind: 'point', recordId: movable.id, index: 0 },
      },
    }] } },
  });
  assert.ok(isSuccessfulSolve(loaded), loaded.message);
  const constraint = controller.constraints()[0];
  assert.equal(constraint.enabled, true);
  assert.equal(constraint.featureRefs[1].recordId, source.id);
  assert.equal(constraint.featureRefs[1].derivedFeature.provider, 'swell');
  const before = controller.model.entity(movable.id);
  const updated = controller.updateParameter('offset-param', { expression: '20' });
  assert.ok(isSuccessfulSolve(updated.result), updated.result.message);
  assert.notDeepEqual(controller.model.entity(movable.id), before);
  near(Math.hypot(...evaluateConstraint(controller.model, constraint, controller.dimensions)), 0);
});
