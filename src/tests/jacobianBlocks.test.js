import test from 'node:test';
import assert from 'node:assert/strict';
import { ConstraintRegistry } from '../../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import {
  assembleJacobianBlocks,
  centralDifferenceJacobianBlock,
  createMatrixFreeJacobian,
  createVariableColumnMap,
  evaluateJacobianBlock,
  verifyJacobianBlock,
} from '../../packages/paramagic-core/src/modules/solver/JacobianBlocks.js';
import { DimensionRepository } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { SketchModel, Variable } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { evaluateFillet } from '../../packages/paramagic-core/src/modules/FilletSystem.js';

test('constraint blocks map touched variables into component-local columns', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'arc', type: 'arc', start: [5, 0], arcPoint: [0, 5], end: [-5, 0] });
  model.addEntity({ id: 'line', type: 'line', start: [0, 2], end: [10, 4] });
  model.addConstraint({
    id: 'horizontal-line',
    type: 'Horizontal',
    featureRefs: [{ kind: 'segment', recordId: 'line', index: 0 }],
  });
  const binding = model.binding('line');
  const endY = binding.variables.get('end.y');
  const startY = binding.variables.get('start.y');
  const registry = new ConstraintRegistry();

  const contract = registry.blocks(model, new DimensionRepository(), {
    variables: [endY, startY],
  });

  assert.deepEqual([...contract.columnByVariableId], [[endY.id, 0], [startY.id, 1]]);
  const intrinsic = contract.blocks.find((block) => block.runtimeKey === 'intrinsic:arc');
  assert.ok(intrinsic);
  assert.deepEqual(intrinsic.variableIds, []);
  const horizontal = contract.blocks.find((block) => block.constraintId === 'horizontal-line');
  assert.deepEqual(horizontal.variableIds, [startY.id, endY.id]);
  assert.deepEqual(horizontal.columnIndexes, [1, 0]);
  assert.deepEqual(horizontal.evaluateResiduals(), [-2]);
});

test('finite-difference fallback evaluates only a block and restores variables', () => {
  const x = new Variable({ id: 'x', value: 4 });
  const y = new Variable({ id: 'y', value: -2 });
  let evaluations = 0;
  const block = {
    id: 'synthetic:fallback',
    variables: [x, y],
    evaluateResiduals() {
      evaluations += 1;
      return [x.value ** 2 + 3 * y.value, x.value - y.value ** 2];
    },
    evaluateAnalyticalJacobian: null,
  };

  const result = evaluateJacobianBlock(block);

  assert.equal(result.kind, 'finite-difference');
  assert.equal(evaluations, 5);
  assert.ok(Math.abs(result.matrix[0][0] - 8) < 1e-8);
  assert.ok(Math.abs(result.matrix[0][1] - 3) < 1e-8);
  assert.ok(Math.abs(result.matrix[1][0] - 1) < 1e-8);
  assert.ok(Math.abs(result.matrix[1][1] - 4) < 1e-8);
  assert.equal(x.value, 4);
  assert.equal(y.value, -2);
});

test('central verification detects incorrect analytical block derivatives', () => {
  const x = new Variable({ id: 'x', value: 4 });
  const y = new Variable({ id: 'y', value: -2 });
  const block = {
    id: 'synthetic:analytical',
    variables: [x, y],
    evaluateResiduals: () => [x.value ** 2 + 3 * y.value, x.value - y.value ** 2],
    evaluateAnalyticalJacobian: () => [[2 * x.value, 3], [1, -2 * y.value]],
  };

  const valid = verifyJacobianBlock(block);
  assert.equal(valid.valid, true);
  assert.equal(valid.differences.length, 0);

  block.evaluateAnalyticalJacobian = () => [[2 * x.value, 30], [1, -2 * y.value]];
  const invalid = verifyJacobianBlock(block);
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.differences.map(({ row, column }) => [row, column]), [[0, 1]]);
});

test('first analytical constraint blocks match scaled central differences', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'line-a', type: 'line', start: [1, 2], end: [8, 5] });
  model.addEntity({ id: 'line-b', type: 'line', start: [-3, 7], end: [4, 11] });
  model.addEntity({ id: 'circle-a', type: 'circle', center: [3, -2], radius: 6 });
  model.addEntity({ id: 'circle-b', type: 'circle', center: [12, 9], radius: 4 });
  model.addEntity({ id: 'arc-a', type: 'arc', start: [25, 0], arcPoint: [20, 5], end: [15, 0] });
  const constraints = [
    {
      id: 'coincident',
      type: 'Coincident',
      featureRefs: [
        { kind: 'point', recordId: 'line-a', index: 1 },
        { kind: 'point', recordId: 'line-b', index: 0 },
      ],
    },
    { id: 'horizontal', type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId: 'line-a', index: 0 }] },
    { id: 'vertical', type: 'Vertical', featureRefs: [{ kind: 'segment', recordId: 'line-b', index: 0 }] },
    {
      id: 'distance',
      type: 'Distance',
      anchors: {
        start: { type: 'segment-point', recordId: 'line-a', index: 0, ratio: 0.25 },
        end: { type: 'segment-end', recordId: 'line-b', index: 0 },
      },
      featureRefs: [],
      value: 9,
    },
    { id: 'circle-radius', type: 'Radius', featureRefs: [{ kind: 'circle', recordId: 'circle-a' }], value: 5 },
    { id: 'arc-radius', type: 'Radius', featureRefs: [{ kind: 'arc', recordId: 'arc-a' }], value: 8 },
    { id: 'diameter', type: 'Diameter', featureRefs: [{ kind: 'circle', recordId: 'circle-b' }], value: 10 },
    {
      id: 'concentric',
      type: 'Concentric',
      featureRefs: [{ kind: 'circle', recordId: 'circle-a' }, { kind: 'arc', recordId: 'arc-a' }],
    },
  ];
  constraints.forEach((constraint) => model.addConstraint(constraint));
  const registry = new ConstraintRegistry();
  const contract = registry.blocks(model, new DimensionRepository());

  constraints.forEach((constraint) => {
    const block = contract.blocks.find(({ constraintId }) => constraintId === constraint.id);
    assert.equal(typeof block.evaluateAnalyticalJacobian, 'function', constraint.type);
    const verification = verifyJacobianBlock(block, { absoluteTolerance: 2e-7, relativeTolerance: 2e-5 });
    assert.equal(
      verification.valid,
      true,
      `${constraint.type} derivative mismatch: ${JSON.stringify(verification.differences)}`,
    );
  });
});

test('analytical blocks fall back numerically for unsupported point mappings', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'arc', type: 'arc', start: [5, 0], arcPoint: [0, 5], end: [-5, 0] });
  model.addEntity({ id: 'line', type: 'line', start: [3, 8], end: [10, 8] });
  model.addConstraint({
    id: 'arc-middle-coincident',
    type: 'Coincident',
    featureRefs: [
      { kind: 'point', recordId: 'arc', index: 1 },
      { kind: 'point', recordId: 'line', index: 0 },
    ],
  });
  const block = new ConstraintRegistry()
    .blocks(model, new DimensionRepository())
    .blocks.find(({ constraintId }) => constraintId === 'arc-middle-coincident');

  assert.equal(evaluateJacobianBlock(block).kind, 'finite-difference');
  assert.throws(() => verifyJacobianBlock(block), /does not support analytical derivatives/i);
});

test('remaining algebraic constraint blocks match central differences', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'driver', type: 'line', start: [2, 3], end: [14, 8] });
  model.addEntity({ id: 'follower', type: 'line', start: [-4, 7], end: [5, 16] });
  model.addEntity({ id: 'marker', type: 'point', point: [6, -3] });
  model.addEntity({ id: 'circle-a', type: 'circle', center: [0, 0], radius: 5 });
  model.addEntity({ id: 'circle-b', type: 'circle', center: [20, 0], radius: 9 });
  model.addEntity({ id: 'arc-a', type: 'arc', start: [5, 0], arcPoint: [0, 5], end: [-5, 0] });
  model.addEntity({
    id: 'arc-b',
    type: 'arc',
    start: [18, 1],
    arcPoint: [14 + 4 * Math.SQRT1_2, 1 + 4 * Math.SQRT1_2],
    end: [14, 5],
  });
  const constraints = [
    {
      id: 'parallel',
      type: 'Parallel',
      featureRefs: [{ kind: 'segment', recordId: 'driver' }, { kind: 'segment', recordId: 'follower' }],
    },
    {
      id: 'perpendicular',
      type: 'Perpendicular',
      featureRefs: [{ kind: 'segment', recordId: 'driver' }, { kind: 'segment', recordId: 'follower' }],
    },
    {
      id: 'equal-segment',
      type: 'Equal',
      featureRefs: [{ kind: 'segment', recordId: 'driver' }, { kind: 'segment', recordId: 'follower' }],
    },
    {
      id: 'equal-circle',
      type: 'Equal',
      featureRefs: [{ kind: 'circle', recordId: 'circle-a' }, { kind: 'circle', recordId: 'circle-b' }],
    },
    {
      id: 'equal-arc',
      type: 'Equal',
      featureRefs: [{ kind: 'arc', recordId: 'arc-a' }, { kind: 'arc', recordId: 'arc-b' }],
    },
    {
      id: 'collinear',
      type: 'Collinear',
      featureRefs: [{ kind: 'segment', recordId: 'driver' }, { kind: 'segment', recordId: 'follower' }],
    },
    {
      id: 'midpoint',
      type: 'Midpoint',
      featureRefs: [{ kind: 'point', recordId: 'marker', index: 0 }, { kind: 'segment', recordId: 'driver' }],
    },
  ];
  constraints.forEach((constraint) => model.addConstraint(constraint));
  const blocks = new ConstraintRegistry().blocks(model, new DimensionRepository()).blocks;

  constraints.forEach((constraint) => {
    const block = blocks.find(({ constraintId }) => constraintId === constraint.id);
    const verification = verifyJacobianBlock(block, { absoluteTolerance: 3e-7, relativeTolerance: 3e-5 });
    assert.equal(
      verification.valid,
      true,
      `${constraint.id} derivative mismatch: ${JSON.stringify(verification.differences)}`,
    );
  });
});

test('arc Length and dimension-distance blocks use verified analytical derivatives', () => {
  const model = new SketchModel();
  model.addEntity({
    id: 'length-arc',
    type: 'arc',
    start: [5, 0],
    arcPoint: [5 * Math.SQRT1_2, 5 * Math.SQRT1_2],
    end: [0, 5],
  });
  model.addEntity({ id: 'baseline', type: 'line', start: [0, 0], end: [10, 0] });
  model.addEntity({ id: 'marker', type: 'point', point: [4, 7] });
  model.addEntity({ id: 'outside-marker', type: 'point', point: [14, 7] });
  const constraints = [
    {
      id: 'arc-length',
      type: 'Length',
      featureRefs: [{ kind: 'arc', recordId: 'length-arc' }],
      value: 7.5,
    },
    {
      id: 'horizontal-distance',
      type: 'Horizontal Distance',
      anchors: {
        start: { type: 'segment-start', recordId: 'baseline', index: 0 },
        end: { type: 'segment-end', recordId: 'baseline', index: 0 },
      },
      featureRefs: [],
      value: 8,
      orientation: 1,
    },
    {
      id: 'vertical-distance',
      type: 'Vertical Distance',
      featureRefs: [
        { kind: 'point', recordId: 'baseline', index: 0 },
        { kind: 'point', recordId: 'marker', index: 0 },
      ],
      value: 6,
      orientation: 1,
    },
    {
      id: 'point-line-distance',
      type: 'Point Line Distance',
      subtype: 'vertical',
      featureRefs: [
        { kind: 'point', recordId: 'marker', index: 0 },
        { kind: 'segment', recordId: 'baseline', index: 0 },
      ],
      value: 6,
      orientation: 1,
    },
    {
      id: 'supporting-line-distance',
      type: 'Point Line Distance',
      subtype: 'aligned',
      projectionMode: 'line',
      featureRefs: [
        { kind: 'point', recordId: 'outside-marker', index: 0 },
        { kind: 'segment', recordId: 'baseline', index: 0 },
      ],
      value: 7,
    },
  ];
  constraints.forEach((constraint) => model.addConstraint(constraint));
  const blocks = new ConstraintRegistry().blocks(model, new DimensionRepository()).blocks;

  constraints.forEach((constraint) => {
    const block = blocks.find(({ constraintId }) => constraintId === constraint.id);
    assert.equal(evaluateJacobianBlock(block).kind, 'analytical', constraint.type);
    const verification = verifyJacobianBlock(block, { absoluteTolerance: 4e-7, relativeTolerance: 4e-5 });
    assert.equal(
      verification.valid,
      true,
      `${constraint.type} derivative mismatch: ${JSON.stringify(verification.differences)}`,
    );
  });
});

test('variable column maps reject unstable or duplicate IDs', () => {
  assert.throws(() => createVariableColumnMap([{ value: 1 }]), /stable IDs/i);
  assert.throws(
    () => createVariableColumnMap([new Variable({ id: 'same' }), new Variable({ id: 'same' })]),
    /duplicate Jacobian variable ID/i,
  );
});

test('central finite differences reject changing residual shapes', () => {
  const x = new Variable({ id: 'x', value: 0 });
  const block = {
    id: 'synthetic:shape-change',
    variables: [x],
    evaluateResiduals: () => (x.value < 0 ? [x.value, x.value] : [x.value]),
  };
  assert.throws(() => centralDifferenceJacobianBlock(block), /residual count changed/i);
  assert.equal(x.value, 0);
});

test('mixed block assembly scatters local columns and reports derivative usage', () => {
  const x = new Variable({ id: 'x', value: 2 });
  const y = new Variable({ id: 'y', value: 3 });
  const z = new Variable({ id: 'z', value: 5 });
  const contract = {
    variables: [x, y, z],
    blocks: [
      {
        id: 'analytical',
        variables: [z, x],
        columnIndexes: [2, 0],
        equations: [{}],
        evaluateResiduals: () => [z.value + 2 * x.value],
        evaluateAnalyticalJacobian: () => [[1, 2]],
      },
      {
        id: 'fallback',
        variables: [y],
        columnIndexes: [1],
        equations: [{}],
        evaluateResiduals: () => [y.value ** 2],
        evaluateAnalyticalJacobian: null,
      },
    ],
  };

  const assembled = assembleJacobianBlocks(contract);

  assert.deepEqual(assembled.matrix[0], [2, 0, 1]);
  assert.ok(Math.abs(assembled.matrix[1][1] - 6) < 1e-8);
  assert.deepEqual(assembled.diagnostics, {
    totalBlocks: 2,
    analyticalBlocks: 1,
    fallbackBlocks: 1,
    residualRows: 2,
  });
});

test('matrix-free blocks apply Jacobian and transpose products without global expansion', () => {
  const x = new Variable({ id: 'x', value: 2 });
  const y = new Variable({ id: 'y', value: 3 });
  const z = new Variable({ id: 'z', value: 5 });
  const contract = {
    variables: [x, y, z],
    blocks: [
      {
        id: 'first',
        variables: [z, x],
        columnIndexes: [2, 0],
        equations: [{}],
        evaluateResiduals: () => [z.value + 2 * x.value],
        evaluateAnalyticalJacobian: () => [[1, 2]],
      },
      {
        id: 'second',
        variables: [y, z],
        columnIndexes: [1, 2],
        equations: [{}, {}],
        evaluateResiduals: () => [3 * y.value - z.value, y.value + 4 * z.value],
        evaluateAnalyticalJacobian: () => [[3, -1], [1, 4]],
      },
    ],
  };
  const dense = assembleJacobianBlocks(contract).matrix;
  const operator = createMatrixFreeJacobian(contract);
  const variables = Float64Array.from([7, 11, 13]);
  const residuals = Float64Array.from([17, 19, 23]);
  const expectedProduct = dense.map((row) => row.reduce(
    (sum, value, column) => sum + value * variables[column],
    0,
  ));
  const expectedTransposeProduct = dense[0].map((_, column) => dense.reduce(
    (sum, row, index) => sum + row[column] * residuals[index],
    0,
  ));

  assert.deepEqual([...operator.applyJacobian(variables)], expectedProduct);
  assert.deepEqual([...operator.applyJacobianTranspose(residuals)], expectedTransposeProduct);
  assert.deepEqual([...operator.diagonal], [4, 10, 18]);
  assert.equal(operator.diagnostics.derivativeEntries, 6);
});

test('native point-on, tangent, and intrinsic arc blocks match central differences', () => {
  const model = new SketchModel();
  model.addEntity({ id: 'marker', type: 'point', point: [0.5, 7] });
  model.addEntity({ id: 'line', type: 'line', start: [-9, 6], end: [11, 8] });
  model.addEntity({ id: 'arc', type: 'arc', start: [5, 0], arcPoint: [0, 5], end: [-5, 0] });
  model.addEntity({ id: 'circle-a', type: 'circle', center: [2, -3], radius: 4 });
  model.addEntity({ id: 'circle-b', type: 'circle', center: [13, 2], radius: 7 });
  const constraints = [
    {
      id: 'point-line',
      type: 'Point-on Line',
      featureRefs: [{ kind: 'point', recordId: 'marker', index: 0 }, { kind: 'segment', recordId: 'line' }],
    },
    {
      id: 'point-circle',
      type: 'Point-on Circle',
      featureRefs: [{ kind: 'point', recordId: 'marker', index: 0 }, { kind: 'circle', recordId: 'circle-a' }],
    },
    {
      id: 'point-arc',
      type: 'Point-on Arc',
      featureRefs: [{ kind: 'point', recordId: 'marker', index: 0 }, { kind: 'arc', recordId: 'arc' }],
    },
    {
      id: 'line-circle-tangent',
      type: 'Tangent',
      featureRefs: [{ kind: 'segment', recordId: 'line' }, { kind: 'circle', recordId: 'circle-a' }],
      tangentOrientation: -1,
    },
    {
      id: 'endpoint-tangent',
      type: 'Tangent',
      featureRefs: [{ kind: 'segment', recordId: 'line' }, { kind: 'arc', recordId: 'arc' }],
      tangentPoint: { kind: 'point', recordId: 'arc', index: 0 },
      tangentOrientation: 1,
    },
    {
      id: 'external-tangent',
      type: 'Tangent',
      featureRefs: [{ kind: 'circle', recordId: 'circle-a' }, { kind: 'circle', recordId: 'circle-b' }],
      tangentMode: 'external',
    },
    {
      id: 'internal-tangent',
      type: 'Tangent',
      featureRefs: [{ kind: 'circle', recordId: 'circle-a' }, { kind: 'circle', recordId: 'circle-b' }],
      tangentMode: 'internal',
    },
  ];
  constraints.forEach((constraint) => model.addConstraint(constraint));
  const blocks = new ConstraintRegistry().blocks(model, new DimensionRepository()).blocks;

  const intrinsic = blocks.find(({ runtimeKey }) => runtimeKey === 'intrinsic:arc');
  assert.equal(verifyJacobianBlock(intrinsic).valid, true);
  constraints.forEach((constraint) => {
    const block = blocks.find(({ constraintId }) => constraintId === constraint.id);
    const verification = verifyJacobianBlock(block, { absoluteTolerance: 4e-7, relativeTolerance: 4e-5 });
    assert.equal(
      verification.valid,
      true,
      `${constraint.id} derivative mismatch: ${JSON.stringify(verification.differences)}`,
    );
  });
});

test('derived Point-on Fillet blocks match central differences for line, curve, and arc source combinations', () => {
  const fixtures = [
    {
      name: 'line-line',
      sources: [
        { id: 'horizontal', type: 'line', start: [0, 0], end: [100, 0] },
        { id: 'vertical', type: 'line', start: [0, 0], end: [0, 100] },
      ],
    },
    {
      name: 'line-arc',
      sources: [
        { id: 'line', type: 'line', start: [0, 0], end: [100, 0] },
        {
          id: 'arc', type: 'arc', start: [0, 0], arcPoint: [14.64466094067263, 35.35533905932737],
          end: [50, 50], center: [50, 0], radius: 50, ccw: false,
        },
      ],
    },
    {
      name: 'curve-line',
      sources: [
        { id: 'curve', type: 'curve', points: [[0, 0], [0, 40], [40, 80]] },
        { id: 'curve-line', type: 'line', start: [0, 0], end: [100, 0] },
      ],
    },
    {
      name: 'curve-curve',
      sources: [
        { id: 'curve-a', type: 'curve', points: [[0, 0], [0, 40], [40, 80]] },
        { id: 'curve-b', type: 'curve', points: [[0, 0], [40, 0], [80, 40]] },
      ],
    },
    {
      name: 'arc-arc',
      sources: [
        {
          id: 'arc-a', type: 'arc', start: [0, 0], arcPoint: [14.64466094067263, 35.35533905932737],
          end: [50, 50], center: [50, 0], radius: 50, ccw: false,
        },
        {
          id: 'arc-b', type: 'arc', start: [0, 0], arcPoint: [35.35533905932738, 14.64466094067262],
          end: [50, 50], center: [0, 50], radius: 50, ccw: true,
        },
      ],
    },
  ];

  for (const fixture of fixtures) {
    const model = new SketchModel();
    fixture.sources.forEach((source) => model.addEntity(source));
    const fillet = {
      id: `${fixture.name}-fillet`,
      type: 'fillet',
      sourceA: { recordId: fixture.sources[0].id, index: 0 },
      sourceB: { recordId: fixture.sources[1].id, index: 0 },
      radius: 10,
    };
    const evaluated = evaluateFillet(
      fillet,
      new Map(fixture.sources.map(({ id }) => [id, model.entity(id)])),
    );
    assert.equal(evaluated.valid, true, `${fixture.name}: ${evaluated.error}`);
    model.addEntity({ id: `${fixture.name}-marker`, type: 'point', point: evaluated.arc.arcPoint });
    model.setDerivedEntity(fillet);
    model.addConstraint({
      id: `${fixture.name}-point-on-fillet`,
      type: 'Point-on Fillet',
      featureRefs: [
        { kind: 'point', recordId: `${fixture.name}-marker`, index: 0 },
        { kind: 'arc', recordId: fillet.id },
      ],
    });
    const block = new ConstraintRegistry()
      .blocks(model, new DimensionRepository())
      .blocks.find(({ constraintId }) => constraintId === `${fixture.name}-point-on-fillet`);
    assert.equal(evaluateJacobianBlock(block).kind, 'analytical', fixture.name);
    const verification = verifyJacobianBlock(block, { absoluteTolerance: 8e-7, relativeTolerance: 8e-5 });
    assert.equal(
      verification.valid,
      true,
      `${fixture.name} derivative mismatch: ${JSON.stringify(verification.differences)}`,
    );
  }
});

test('derived Point-on Fillet retains finite differences at an arc-domain boundary', () => {
  const model = new SketchModel();
  const sources = [
    { id: 'boundary-horizontal', type: 'line', start: [0, 0], end: [100, 0] },
    { id: 'boundary-vertical', type: 'line', start: [0, 0], end: [0, 100] },
  ];
  sources.forEach((source) => model.addEntity(source));
  const fillet = {
    id: 'boundary-fillet',
    type: 'fillet',
    sourceA: { recordId: sources[0].id, index: 0 },
    sourceB: { recordId: sources[1].id, index: 0 },
    radius: 10,
  };
  const evaluated = evaluateFillet(fillet, new Map(sources.map(({ id }) => [id, model.entity(id)])));
  assert.equal(evaluated.valid, true);
  model.addEntity({ id: 'boundary-marker', type: 'point', point: evaluated.arc.start });
  model.setDerivedEntity(fillet);
  model.addConstraint({
    id: 'boundary-point-on-fillet',
    type: 'Point-on Fillet',
    featureRefs: [
      { kind: 'point', recordId: 'boundary-marker', index: 0 },
      { kind: 'arc', recordId: fillet.id },
    ],
  });
  const block = new ConstraintRegistry()
    .blocks(model, new DimensionRepository())
    .blocks.find(({ constraintId }) => constraintId === 'boundary-point-on-fillet');

  assert.equal(evaluateJacobianBlock(block).kind, 'finite-difference');
});
