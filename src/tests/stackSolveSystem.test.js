import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateStackSolveResults,
  buildStackParticipationGraph,
  stackParticipationGroups,
  transitiveParticipantStackIds,
} from '../../packages/paramagic-core/src/modules/solver/StackSolveSystem.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';

test('independent Stacks remain separate solver contexts', () => {
  const graph = buildStackParticipationGraph({
    stackIds: ['a', 'b', 'c'],
    entities: [{ id: 'a1', stackId: 'a' }, { id: 'b1', stackId: 'b' }, { id: 'c1', stackId: 'c' }],
  });
  assert.deepEqual(stackParticipationGroups(graph).map((group) => [...group]), [['a'], ['b'], ['c']]);
});

test('cross-Stack relationships merge their full transitive participant set', () => {
  const graph = buildStackParticipationGraph({
    stackIds: ['a', 'b', 'c', 'd'],
    constraints: [
      { stackId: 'a', participantStackIds: ['b'] },
      { stackId: 'b', participantStackIds: ['c'] },
    ],
  });
  assert.deepEqual([...transitiveParticipantStackIds(graph, ['a'])].sort(), ['a', 'b', 'c']);
  assert.deepEqual(stackParticipationGroups(graph).map((group) => [...group].sort()), [['a', 'b', 'c'], ['d']]);
});

test('disabled Stacks and touching relationships contribute no participation nodes', () => {
  const graph = buildStackParticipationGraph({
    stackIds: ['a', 'b', 'c'],
    enabledStackIds: new Set(['a', 'c']),
    entities: [{ id: 'a1', stackId: 'a' }, { id: 'b1', stackId: 'b' }, { id: 'c1', stackId: 'c' }],
    constraints: [
      { id: 'cross-ab', stackId: 'a', participantStackIds: ['b'] },
      { id: 'cross-ac', stackId: 'a', participantStackIds: ['c'] },
    ],
  });
  assert.deepEqual([...graph.keys()], ['a', 'c']);
  assert.deepEqual([...graph.get('a')], ['c']);
  assert.deepEqual([...graph.get('c')], ['a']);
});

test('Stack solve aggregation reports one affected-set failure without losing prior independent results', () => {
  const result = aggregateStackSolveResults([
    { stackIds: new Set(['a']), result: { status: 'converged', iterations: 2, changedEntityIds: ['a1'] } },
    { stackIds: new Set(['b', 'c']), result: { status: 'rejected', iterations: 4, problematicConstraintIds: ['cross'] } },
  ]);
  assert.equal(result.status, 'rejected');
  assert.deepEqual(result.changedEntityIds, ['a1']);
  assert.deepEqual(result.problematicConstraintIds, ['cross']);
  assert.equal(result.stackResults.length, 2);
});

test('interactive Stack partition previews remain previews instead of being decorated as failures', () => {
  const result = aggregateStackSolveResults([
    { stackIds: new Set(['a']), result: { status: 'preview', finalError: 1e-10, changedEntityIds: ['a1'] } },
    { stackIds: new Set(['b']), result: { status: 'unchanged', finalError: 0, changedEntityIds: [] } },
  ]);
  assert.equal(result.status, 'preview');
  assert.deepEqual(result.changedEntityIds, ['a1']);
});

test('controller edits solve only the edited Stack while preserving duplicate local dimension names', () => {
  const controller = createSolverController();
  controller.loadSketch({
    stackState: {
      activeStackId: 'stack-a',
      stacks: [{ id: 'stack-a', name: 'Stack A', systemRole: 'default-stack' }, { id: 'stack-b', name: 'Stack B' }],
    },
    entities: [
      { id: 'line-a', type: 'line', stackId: 'stack-a', start: [0, 0], end: [10, 0] },
      { id: 'line-b', type: 'line', stackId: 'stack-b', start: [20, 0], end: [30, 0] },
    ],
    constraints: [
      { id: 'horizontal-a', type: 'Horizontal', stackId: 'stack-a', featureRefs: [{ kind: 'segment', recordId: 'line-a', index: 0 }] },
      { id: 'horizontal-b', type: 'Horizontal', stackId: 'stack-b', featureRefs: [{ kind: 'segment', recordId: 'line-b', index: 0 }] },
    ],
    parameters: [
      { id: 'dimension-a', name: 'd1', kind: 'dimension', stackId: 'stack-a', expression: '10', value: 10 },
      { id: 'dimension-b', name: 'd1', kind: 'dimension', stackId: 'stack-b', expression: '10', value: 10 },
    ],
  });

  const beforeB = controller.getEntity('line-b');
  const outcome = controller.updateEntities([{
    ...controller.getEntity('line-a'),
    end: [10, 3],
  }]);

  assert.equal(outcome.result.solveScope.mode, 'stack-set');
  assert.deepEqual(outcome.result.solveScope.stackIds, ['stack-a']);
  assert.deepEqual(controller.getEntity('line-b'), beforeB);
  assert.deepEqual(controller.parameters().filter(({ kind }) => kind === 'dimension').map(({ name }) => name), ['d1', 'd1']);
});

test('controller follows transitive cross-Stack participants as one affected solve set', () => {
  const controller = createSolverController();
  controller.loadSketch({
    stackState: {
      activeStackId: 'stack-a',
      stacks: [
        { id: 'stack-a', name: 'Stack A' },
        { id: 'stack-b', name: 'Stack B' },
        { id: 'stack-c', name: 'Stack C' },
      ],
    },
    entities: [
      { id: 'point-a', type: 'point', stackId: 'stack-a', point: [0, 0] },
      { id: 'point-b', type: 'point', stackId: 'stack-b', point: [0, 0] },
      { id: 'point-c', type: 'point', stackId: 'stack-c', point: [0, 0] },
    ],
    constraints: [
      {
        id: 'cross-ab', type: 'Coincident', stackId: 'stack-a', participantStackIds: ['stack-b'],
        featureRefs: [{ kind: 'point', recordId: 'point-a', index: 0 }, { kind: 'point', recordId: 'point-b', index: 0 }],
      },
      {
        id: 'cross-bc', type: 'Coincident', stackId: 'stack-b', participantStackIds: ['stack-c'],
        featureRefs: [{ kind: 'point', recordId: 'point-b', index: 0 }, { kind: 'point', recordId: 'point-c', index: 0 }],
      },
    ],
  });

  const outcome = controller.updateEntities([{ id: 'point-a', type: 'point', stackId: 'stack-a', point: [5, 5] }]);
  assert.deepEqual(new Set(outcome.result.solveScope.stackIds), new Set(['stack-a', 'stack-b', 'stack-c']));
});

test('controller excludes disabled Stack variables and cross-Stack residuals from solve diagnostics', () => {
  const controller = createSolverController();
  controller.loadSketch({
    stackState: {
      activeStackId: 'stack-a',
      stacks: [{ id: 'stack-a', name: 'Stack A', systemRole: 'default-stack' }, { id: 'stack-b', name: 'Stack B' }],
    },
    entities: [
      { id: 'point-a', type: 'point', stackId: 'stack-a', point: [0, 0] },
      { id: 'point-b', type: 'point', stackId: 'stack-b', point: [10, 0] },
    ],
    constraints: [{
      id: 'cross-ab', type: 'Coincident', stackId: 'stack-a', participantStackIds: ['stack-b'],
      featureRefs: [{ kind: 'point', recordId: 'point-a', index: 0 }, { kind: 'point', recordId: 'point-b', index: 0 }],
    }],
  });
  const transition = controller.setEnabledStackIds(['stack-a']);
  const result = controller.solve({ fullSolve: true });

  assert.deepEqual(transition.disabled, ['stack-b']);
  assert.equal(result.solveScope.variableCount, 2);
  assert.equal(result.solveScope.constraintCount, 0);
  assert.equal(result.solveScope.entityCount, 1);
  assert.deepEqual(result.stackResults.map(({ stackIds }) => stackIds), [['stack-a']]);
});

test('subtree data removal accepts multiple owner Stacks as one operation', () => {
  const controller = createSolverController();
  controller.loadSketch({
    stackState: {
      activeStackId: 'stack-a',
      stacks: [
        { id: 'stack-a', name: 'Stack A' },
        { id: 'stack-b', name: 'Stack B' },
        { id: 'stack-c', name: 'Stack C', parentStackId: 'stack-b' },
      ],
    },
    entities: [
      { id: 'point-a', type: 'point', stackId: 'stack-a', point: [0, 0] },
      { id: 'point-b', type: 'point', stackId: 'stack-b', point: [10, 0] },
      { id: 'point-c', type: 'point', stackId: 'stack-c', point: [20, 0] },
    ],
    constraints: [{
      id: 'cross-ac', type: 'Coincident', stackId: 'stack-a', participantStackIds: ['stack-c'],
      featureRefs: [{ kind: 'point', recordId: 'point-a', index: 0 }, { kind: 'point', recordId: 'point-c', index: 0 }],
    }],
    parameters: [
      { id: 'dimension-b', name: 'd1', kind: 'dimension', stackId: 'stack-b', expression: '10', value: 10 },
      { id: 'dimension-c', name: 'd1', kind: 'dimension', stackId: 'stack-c', expression: '10', value: 10 },
    ],
  });
  const removed = controller.removeStackDataMany(['stack-b', 'stack-c'], ['point-b', 'point-c']);
  assert.deepEqual(new Set(removed.dimensionIds), new Set(['dimension-b', 'dimension-c']));
  assert.deepEqual(removed.constraintIds, ['cross-ac']);
});

test('Stack deletion removes touching dimensions and constraints while leaving a global dangling-reference error', () => {
  const controller = createSolverController();
  controller.loadSketch({
    stackState: {
      activeStackId: 'stack-a',
      stacks: [{ id: 'stack-a', name: 'Stack A' }, { id: 'stack-b', name: 'Stack B' }],
    },
    entities: [
      { id: 'point-a', type: 'point', stackId: 'stack-a', point: [0, 0] },
      { id: 'point-b', type: 'point', stackId: 'stack-b', point: [10, 0] },
    ],
    constraints: [{
      id: 'cross-ab', type: 'Coincident', stackId: 'stack-a', participantStackIds: ['stack-b'],
      featureRefs: [{ kind: 'point', recordId: 'point-a', index: 0 }, { kind: 'point', recordId: 'point-b', index: 0 }],
    }],
    parameters: [
      { id: 'dimension-b', name: 'd1', kind: 'dimension', stackId: 'stack-b', expression: '10', value: 10 },
      { id: 'global-width', name: 'Global Width', kind: 'user', expression: 'd1@Stack B + 2', value: 12 },
    ],
    dimensionAnnotations: [{
      id: 'annotation-b', dimensionId: 'dimension-b', dimensionName: 'd1', stackId: 'stack-b',
      anchors: { start: { kind: 'point', recordId: 'point-b', index: 0 } },
    }],
  });

  const removed = controller.removeStackData('stack-b', ['point-b']);
  const parameters = controller.parameters();
  assert.deepEqual(removed.dimensionIds, ['dimension-b']);
  assert.deepEqual(removed.constraintIds, ['cross-ab']);
  assert.equal(parameters.some(({ id }) => id === 'dimension-b'), false);
  assert.match(parameters.find(({ id }) => id === 'global-width').error, /Unknown parameter/i);
});

test('failed Stack solves identify the participating Stack names and offending relationship', () => {
  const controller = createSolverController();
  controller.loadSketch({
    stackState: {
      activeStackId: 'stack-a',
      stacks: [{ id: 'stack-a', name: 'Bodice Front' }, { id: 'stack-b', name: 'Bodice Back' }],
    },
    entities: [
      { id: 'point-a', type: 'point', stackId: 'stack-a', point: [0, 0] },
      { id: 'point-b', type: 'point', stackId: 'stack-b', point: [10, 0] },
    ],
    constraints: [{
      id: 'cross-ab', type: 'Coincident', stackId: 'stack-a', participantStackIds: ['stack-b'],
      featureRefs: [{ kind: 'point', recordId: 'point-a', index: 0 }, { kind: 'point', recordId: 'point-b', index: 0 }],
    }],
  });

  const failure = controller.decorateStackFailure({
    status: 'rejected',
    message: 'The relationship could not be satisfied.',
    problematicConstraintIds: ['cross-ab'],
  }, new Set(['stack-a', 'stack-b']));

  assert.match(failure.message, /Bodice Front/);
  assert.match(failure.message, /Bodice Back/);
  assert.match(failure.message, /Coincident \(cross-ab\)/);
  assert.deepEqual(failure.offender, {
    stackIds: ['stack-a', 'stack-b'],
    constraintId: 'cross-ab',
    dimensionId: null,
  });
});
