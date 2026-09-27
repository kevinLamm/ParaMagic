import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { DimensionRepository } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { ConstraintGraph } from '../../packages/paramagic-core/src/modules/solver/ConstraintGraph.js';
import { pointRef, segmentRef, dimensionEntry } from './fixtures.js';

// A connected row of panels with parallel tops, perpendicular sides, circles
// tangent to the bases, diameter-chord arcs and derived corner fillets. Every
// base is driven by d1, so one edit affects the whole drawing.
export function mixedConnectedChain(requestedCount, { includeMeta = true } = {}) {
  const model = new SketchModel(), dimensions = new DimensionRepository(), registry = new ConstraintRegistry();
  const constraints = [], countPerPanel = includeMeta ? 29 : 28;
  const lineCount = Math.max(1, Math.floor(requestedCount / countPerPanel));
  for (let i = 0; i < lineCount; i++) {
    const x = i * 84, id = suffix => `${suffix}-${i}`, P = (suffix, index = 0) => pointRef(id(suffix), index), S = suffix => segmentRef(id(suffix));
    const R = suffix => ({ kind: suffix === 'circle' ? 'circle' : 'arc', recordId: id(suffix) });
    const entities = [
      { id: id('panel'), type: 'line', start: [x, 0], end: [x + 84, 0] },
      { id: id('top'), type: 'line', start: [x, 10], end: [x + 84, 10] },
      { id: id('side'), type: 'line', start: [x, 0], end: [x, 10] },
      { id: id('marker'), type: 'point', point: [x + 42, 10] },
      { id: id('circle'), type: 'circle', center: [x + 42, 2], radius: 2 },
      { id: id('arc'), type: 'arc', start: [x, 0], arcPoint: [x + 42, 42], end: [x + 84, 0], center: [x + 42, 0], radius: 42, ccw: false },
      { id: id('arc-marker'), type: 'point', point: [x + 42, 42] },
      { id: id('fillet-marker'), type: 'point', point: [x + 2 - Math.SQRT2, 2 - Math.SQRT2] },
    ];
    entities.forEach(e => model.addEntity(e));
    model.setDerivedEntity({ id: id('fillet'), type: 'fillet', sourceA: { recordId: id('panel'), index: 0 }, sourceB: { recordId: id('side'), index: 0 }, radius: 2 });
    const add = (type, featureRefs, rest = {}) => constraints.push({ id: `c${constraints.length}`, type, featureRefs, ...rest });
    add('Horizontal', [S('panel')]); add('Distance', [P('panel'), P('panel', 2)], { dimensionRef: 'baseline-width' });
    if (i) add('Coincident', [pointRef(`panel-${i - 1}`, 2), P('panel')]);
    else add('Fixed', [P('panel')], { fixedPoint: [0, 0] });
    add('Parallel', [S('panel'), S('top')]); add('Perpendicular', [S('panel'), S('side')]);
    add('Coincident', [P('panel'), P('side')]); add('Coincident', [P('side', 2), P('top')]);
    add('Equal', [S('panel'), S('top')]); add('Length', [S('side')], { value: 10 });
    add('Angle', [S('panel'), S('side')], { value: 90 });
    add('Line Line Distance', [S('panel'), S('top')], { value: 10, orientation: 1 });
    add('Midpoint', [P('marker'), S('top')]); add('Point-on Line', [P('marker'), S('top')]);
    add('Point Line Distance', [P('marker'), S('panel')], { value: 10, projectionMode: 'line' });
    add('Collinear', [S('panel'), i ? segmentRef(`panel-${i - 1}`) : S('panel')]);
    add('Tangent', [S('panel'), R('circle')], { tangentOrientation: 1 }); add('Radius', [R('circle')], { value: 2 });
    add('Horizontal Distance', [P('circle'), P('marker')], { value: 0, orientation: 1 });
    add('Vertical Distance', [P('circle'), P('marker')], { value: 8, orientation: 1 });
    add('Coincident', [P('arc'), P('panel')]); add('Coincident', [P('arc', 2), P('panel', 2)]);
    add('Radius', [R('arc')], { dimensionRef: 'mixed-radius' });
    add('Point-on Arc', [P('arc-marker'), R('arc')]);
    add('Coincident', [P('arc-marker'), { ...P('arc'), pointRole: 'arc-midpoint' }]);
    add('Point-on Fillet', [P('fillet-marker'), R('fillet')]);
    add('Vertical', [S('side')]); add('Horizontal', [S('top')]);
    add('Diameter', [R('circle')], { value: 4 });
    if (includeMeta) add('Meta', [], { parameterRef: model.binding(id('panel')).variables.get('start.y').id, value: 0 });
  }
  while (constraints.length < requestedCount) constraints.push({ id: `c${constraints.length}`, type: 'Parallel', featureRefs: [segmentRef('panel-0'), segmentRef('top-0')] });
  model.addConstraints(constraints);
  dimensions.restore([dimensionEntry(), { ...dimensionEntry(42), id: 'mixed-radius', name: 'd2', expression: 'd1/2', order: 1 }], { emit: false });
  dimensions.evaluateDirty({ strict: true });
  const graph = new ConstraintGraph(model), scope = graph.scopeForSeeds({ dimensionIds: ['baseline-width'] });
  if (scope.constraintIds.size !== constraints.length) throw Error(`Mixed fixture is disconnected: ${scope.constraintIds.size} / ${constraints.length}`);
  return { model, dimensions, registry, graph, scopedModel: graph.scopedModel(scope), lineCount, sharedTarget: true };
}
