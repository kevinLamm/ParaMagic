import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { DimensionRepository } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { ConstraintGraph } from '../../packages/paramagic-core/src/modules/solver/ConstraintGraph.js';

export const BASE_LENGTH = 84;
export const TARGET_LENGTH = 84.125;
export const FINAL_TOLERANCE = 1e-3; // Production default, applied to the entire residual L2 norm.
export const pointRef = (recordId, index = 0) => ({ kind: 'point', recordId, index });
export const segmentRef = recordId => ({ kind: 'segment', recordId, index: 0 });
export const dimensionEntry = (value = BASE_LENGTH) => ({
  id: 'baseline-width', name: 'd1', expression: String(value), value,
  kind: 'dimension', driving: true, computed: false, enabled: true, order: 0,
});

// A joined strip of horizontal panels. Only the first panel's dimension changes;
// every later panel must translate. No distant panel has a direct link to d1.
// At most two redundant horizontal constraints make the requested count exact.
export function connectedChain(constraintCount, { sharedTarget = false, floating = false } = {}) {
  if (!Number.isInteger(constraintCount) || constraintCount < 6) throw new Error('Expected at least six constraints.');
  const started = performance.now();
  const model = new SketchModel();
  const dimensions = new DimensionRepository();
  const lineCount = Math.floor(constraintCount / 3);
  const constraints = [];
  for (let i = 0; i < lineCount; i++) {
    const id = `panel-${i}`;
    model.addEntity({ id, type: 'line', start: [i * BASE_LENGTH, 0], end: [(i + 1) * BASE_LENGTH, 0] });
    constraints.push({ id: `horizontal-${i}`, type: 'Horizontal', featureRefs: [segmentRef(id)] });
    constraints.push({ id: `length-${i}`, type: 'Distance', featureRefs: [pointRef(id), pointRef(id, 2)],
      ...(i === 0 || sharedTarget ? { dimensionRef: 'baseline-width' } : { value: BASE_LENGTH }) });
    if (i) constraints.push({ id: `join-${i}`, type: 'Coincident',
      featureRefs: [pointRef(`panel-${i - 1}`, 2), pointRef(id)] });
  }
  if (!floating) constraints.push({ id: 'explicit-anchor', type: 'Fixed', featureRefs: [pointRef('panel-0')], fixedPoint: [0, 0] });
  while (constraints.length < constraintCount) constraints.push({ id: `redundant-${constraints.length}`, type: 'Horizontal', featureRefs: [segmentRef('panel-0')] });
  model.addConstraints(constraints);
  dimensions.restore([dimensionEntry()], { emit: false });
  dimensions.evaluateDirty({ strict: true });
  const buildMs = performance.now() - started;
  const graphStarted = performance.now();
  const graph = new ConstraintGraph(model);
  const graphMs = performance.now() - graphStarted;
  const scopeStarted = performance.now();
  const scope = graph.scopeForSeeds({ dimensionIds: ['baseline-width'] });
  const scopedModel = graph.scopedModel(scope);
  const scopeMs = performance.now() - scopeStarted;
  if (graph.components.size !== 1 || scope.constraintIds.size !== constraintCount) throw new Error('Fixture must be one fully selected connected component.');
  return { model, dimensions, graph, scopedModel, registry: new ConstraintRegistry(), lineCount,
    sharedTarget, floating, setup: { buildMs, graphMs, scopeMs } };
}

export function verify(fixture, target = TARGET_LENGTH) {
  const residuals = fixture.registry.evaluate(fixture.model, fixture.dimensions).values;
  let sumSquares = 0, maxResidual = 0, maxCoordinateError = 0, movedEntities = 0;
  for (const value of residuals) { sumSquares += value * value; maxResidual = Math.max(maxResidual, Math.abs(value)); }
  for (let i = 0; i < fixture.lineCount; i++) {
    const entity = fixture.model.entity(`panel-${i}`);
    const expectedStart = fixture.sharedTarget ? i * target : i * BASE_LENGTH + (i ? target - BASE_LENGTH : 0);
    const expectedEnd = fixture.sharedTarget ? (i + 1) * target : (i + 1) * BASE_LENGTH + target - BASE_LENGTH;
    maxCoordinateError = Math.max(maxCoordinateError, Math.abs(entity.start[0] - expectedStart), Math.abs(entity.end[0] - expectedEnd), Math.abs(entity.start[1]), Math.abs(entity.end[1]));
    if (Math.abs(entity.start[0] - i * BASE_LENGTH) > 1e-8 || Math.abs(entity.end[0] - (i + 1) * BASE_LENGTH) > 1e-8) movedEntities++;
  }
  return { residualL2: Math.sqrt(sumSquares), maxResidual, residualCount: residuals.length, maxCoordinateError,
    movedEntities, movedFraction: movedEntities / fixture.lineCount, parameterValue: fixture.dimensions.value('baseline-width') };
}

export function snapshot(fixture) {
  return { drawingUnit: 'mm', entities: fixture.model.snapshot(), derivedEntities: [...fixture.model.derivedEntities.values()], constraints: [...fixture.model.constraints.values()], parameters: fixture.dimensions.snapshot() };
}
