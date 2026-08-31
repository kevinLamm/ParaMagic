import test from 'node:test';
import assert from 'node:assert/strict';
import { ParameterRepository } from '../../packages/paramagic-core/src/modules/solver/ParameterRepository.js';
import {
  createStackActivationCoordinator,
  createStackActivationSystem,
  effectiveEnabledStackIds,
} from '../../packages/paramagic-core/src/modules/StackActivationSystem.js';
import { fixtureUuid } from './helpers/fixtureUuid.js';

const id = (label) => fixtureUuid(`stack-activation:${label}`);

function activationFixture({ expressions = {} } = {}) {
  const defaultId = id('default');
  const structureId = id('structure');
  const railId = id('rail');
  const childId = id('rail-child');
  const stackState = {
    version: 3,
    activeStackId: structureId,
    stacks: [
      { id: defaultId, name: 'Default', systemRole: 'default-stack' },
      { id: structureId, name: 'Structure', enabledExpression: expressions.structure || 'TRUE' },
      { id: railId, name: 'Support Rail', enabledExpression: expressions.rail || 'd1@Structure >= Threshold' },
      { id: childId, name: 'Rail Child', parentStackId: railId, enabledExpression: expressions.child || 'TRUE' },
    ],
  };
  const repository = new ParameterRepository();
  repository.setStackState(stackState, { emit: false });
  repository.restore([
    {
      id: id('length'), kind: 'dimension', name: 'd1', stackId: structureId,
      value: 120, expression: '120', computed: true, driving: false, order: 0,
    },
    {
      id: id('threshold'), kind: 'user', name: 'Threshold', value: 100,
      expression: '100', computed: false, order: 1,
    },
  ], { emit: false });
  const system = createStackActivationSystem({
    getStackState: () => stackState,
    expressionSymbols: (options) => repository.expressionSymbols(options),
    expressionEntries: (options) => repository.expressionEntries(options),
    evaluateExpression: (expression, options) => repository.evaluateExpression(expression, options),
  });
  return { system, repository, stackState, defaultId, structureId, railId, childId };
}

test('effective activation is inherited through ancestors without creating hierarchy dependencies', () => {
  const parentId = id('effective-parent');
  const childId = id('effective-child');
  const defaultId = id('effective-default');
  const enabled = effectiveEnabledStackIds({ version: 3, stacks: [
    { id: defaultId, name: 'Default', systemRole: 'default-stack' },
    { id: parentId, name: 'Parent' },
    { id: childId, name: 'Child', parentStackId: parentId },
  ] }, new Map([
    [parentId, { localEnabled: false }],
    [childId, { localEnabled: true }],
  ]));
  assert.equal(enabled.has(parentId), false);
  assert.equal(enabled.has(childId), false);
  assert.equal(enabled.has(defaultId), true);
});

test('driven dimensions evaluate Stack enablement and dirty only reverse dependents', () => {
  const fixture = activationFixture();
  const first = fixture.system.evaluateDirtyStackExpressions({
    refreshedDimensionIds: [id('length')],
  });
  assert.equal(first.states.get(fixture.railId).localEnabled, true);
  assert.equal(first.states.get(fixture.childId).effectiveEnabled, true);

  fixture.repository.restoreEntries([{
    ...fixture.repository.get(id('length')), value: 80,
  }], { emit: false });
  fixture.system.markActivationDependentsDirty([id('length')]);
  const second = fixture.system.evaluateDirtyStackExpressions({
    refreshedDimensionIds: [id('length')],
  });
  assert.deepEqual(second.evaluatedStackIds, [fixture.railId]);
  assert.equal(second.states.get(fixture.railId).localEnabled, false);
  assert.equal(second.states.get(fixture.childId).effectiveEnabled, false);
  assert.equal(fixture.system.stats().lastEvaluationCount, 1);
});

test('manual enablement bypasses a preserved expression while blank expressions evaluate false', () => {
  const defaultId = id('manual-default');
  const manualId = id('manual-on');
  const blankId = id('manual-off-blank');
  const conditionalId = id('manual-off-conditional');
  const stackState = { version: 3, stacks: [
    { id: defaultId, name: 'Default', systemRole: 'default-stack' },
    { id: manualId, name: 'Manual', enabled: true, enabledExpression: 'Unknown Symbol > 0' },
    { id: blankId, name: 'Blank', enabled: false, enabledExpression: '' },
    { id: conditionalId, name: 'Conditional', enabled: false, enabledExpression: '1 < 2' },
  ] };
  const repository = new ParameterRepository();
  repository.setStackState(stackState, { emit: false });
  const system = createStackActivationSystem({
    getStackState: () => stackState,
    expressionSymbols: (options) => repository.expressionSymbols(options),
    expressionEntries: (options) => repository.expressionEntries(options),
    evaluateExpression: (expression, options) => repository.evaluateExpression(expression, options),
  });

  assert.deepEqual(system.activationDiagnostics(), []);
  const result = system.evaluateDirtyStackExpressions();
  assert.equal(result.states.get(manualId).localEnabled, true);
  assert.equal(result.states.get(blankId).localEnabled, false);
  assert.equal(result.states.get(conditionalId).localEnabled, true);
});

test('a disabled driven-dimension source fails closed with exact Stack and dimension names', () => {
  const fixture = activationFixture();
  fixture.system.evaluateDirtyStackExpressions({ refreshedDimensionIds: [id('length')] });
  fixture.system.markStacksDirty([fixture.structureId, fixture.railId]);
  const result = fixture.system.evaluateDirtyStackExpressions({ availableDimensionIds: [] });
  const diagnostic = result.diagnostics.find(({ code }) => code === 'unavailable-source');
  assert.equal(result.states.get(fixture.railId).localEnabled, false);
  assert.match(diagnostic.message, /Support Rail/);
  assert.match(diagnostic.message, /d1@Structure/);
  assert.match(diagnostic.message, /Structure/);
});

test('static activation cycles include every participating Stack and dimension', () => {
  const stackAId = id('cycle-a');
  const stackBId = id('cycle-b');
  const defaultId = id('cycle-default');
  const dimensionAId = id('cycle-dimension-a');
  const dimensionBId = id('cycle-dimension-b');
  const stackState = { version: 3, stacks: [
    { id: defaultId, name: 'Default', systemRole: 'default-stack' },
    { id: stackAId, name: 'Support A', enabledExpression: 'd1@Support B > 10' },
    { id: stackBId, name: 'Support B', enabledExpression: 'd1@Support A > 10' },
  ] };
  const repository = new ParameterRepository();
  repository.setStackState(stackState, { emit: false });
  repository.restore([
    { id: dimensionAId, kind: 'dimension', name: 'd1', stackId: stackAId, value: 20, computed: true, driving: false, order: 0 },
    { id: dimensionBId, kind: 'dimension', name: 'd1', stackId: stackBId, value: 20, computed: true, driving: false, order: 1 },
  ], { emit: false });
  const system = createStackActivationSystem({
    getStackState: () => stackState,
    expressionSymbols: (options) => repository.expressionSymbols(options),
    expressionEntries: (options) => repository.expressionEntries(options),
    evaluateExpression: (expression, options) => repository.evaluateExpression(expression, options),
  });
  const diagnostic = system.activationDiagnostics().find(({ code }) => code === 'activation-cycle');
  assert.deepEqual(new Set(diagnostic.stackIds), new Set([stackAId, stackBId]));
  assert.deepEqual(new Set(diagnostic.dimensionIds), new Set([dimensionAId, dimensionBId]));
  assert.match(diagnostic.message, /Support A/);
  assert.match(diagnostic.message, /Support B/);
  assert.match(diagnostic.message, /d1@Support A/);
  assert.match(diagnostic.message, /d1@Support B/);
});

test('activation expression evaluation delegates mixed-unit Boolean semantics to the parameter engine', () => {
  const fixture = activationFixture({ expressions: { rail: 'd1@Structure >= 10 cm' } });
  fixture.repository.setDefaultLengthUnit('mm');
  const result = fixture.system.evaluateDirtyStackExpressions({ refreshedDimensionIds: [id('length')] });
  assert.equal(result.states.get(fixture.railId).localEnabled, true);
});

test('runtime activation signatures detect repetition and restore the last accepted state', () => {
  const fixture = activationFixture();
  fixture.system.evaluateDirtyStackExpressions({ refreshedDimensionIds: [id('length')] });
  fixture.system.beginStabilization();
  assert.equal(fixture.system.recordActivationRound(1).oscillating, false);
  assert.equal(fixture.system.recordActivationRound(2).oscillating, true);
  assert.match(fixture.system.activationDiagnostics().at(-1).message, /round 1/);
  assert.equal(fixture.system.restoreAcceptedState().get(fixture.railId).effectiveEnabled, true);
});

test('activation coordinator rejects invalid expression edits without committing Stack or solver state', () => {
  const stackId = id('coordinator-invalid');
  let stackState = { version: 3, stacks: [{ id: stackId, name: 'Rail', enabledExpression: 'TRUE' }] };
  let runtime = new Map([[stackId, {
    localEnabled: true, effectiveEnabled: true, error: null, awaiting: false,
  }]]);
  let diagnostics = [];
  let restoredSolverCount = 0;
  const coordinator = createStackActivationCoordinator({
    activationSystem: {
      compileStackExpressions(state) {
        if (state.stacks[0].enabledExpression === 'TRUE') {
          diagnostics = [];
          runtime = new Map([[stackId, {
            localEnabled: true, effectiveEnabled: true, error: null, awaiting: false,
          }]]);
        } else {
          diagnostics = [{
            code: 'invalid-expression', stackIds: [stackId], dimensionIds: [],
            message: 'Stack "Rail" enable expression failed: unknown symbol.',
          }];
          runtime = new Map([[stackId, {
            localEnabled: false, effectiveEnabled: false,
            error: diagnostics[0].message, awaiting: false,
          }]]);
        }
        return { diagnostics };
      },
      runtimeStates: () => runtime,
      activationDiagnostics: () => diagnostics,
      effectiveEnabledStackIds: () => new Set(
        [...runtime].filter(([, value]) => value.effectiveEnabled).map(([key]) => key),
      ),
      markActivationDependentsDirty() {},
      beginStabilization() {},
      evaluateDirtyStackExpressions: () => ({
        states: runtime, effectiveEnabledStackIds: new Set([stackId]),
      }),
      stats: () => ({ dirtyStackCount: 0 }),
      recordActivationRound: () => ({ oscillating: false }),
    },
    getStackState: () => stackState,
    getStackRuntimeState: () => ({ stacks: [...runtime].map(([idValue, value]) => ({ id: idValue, ...value })) }),
    restoreStackState: (value) => { stackState = structuredClone(value); },
    applyStackRuntimeStates: (value) => { runtime = new Map(value); },
    setEnabledStackIds: () => ({ changed: false, enabled: [], disabled: [] }),
    getSolverSnapshot: () => ({ geometry: 'accepted' }),
    restoreSolverSnapshot: () => { restoredSolverCount += 1; },
  });

  stackState.stacks[0].enabledExpression = 'Unknown Dimension > 0';
  const result = coordinator.refresh({ compile: true, allowRollback: true });

  assert.equal(result.status, 'failed');
  assert.equal(stackState.stacks[0].enabledExpression, 'TRUE');
  assert.equal(runtime.get(stackId).effectiveEnabled, true);
  assert.equal(restoredSolverCount, 1);
  assert.match(result.message, /Rail/);
});

test('activation coordinator preserves canonical cycle errors when loading without rollback', () => {
  const stackId = id('coordinator-load-cycle');
  const message = 'Stack activation cycle: "Rail" depends on d1@Rail from "Rail".';
  const failedRuntime = new Map([[stackId, {
    localEnabled: false, effectiveEnabled: false, error: message, awaiting: false,
  }]]);
  let appliedRuntime = null;
  let enabledIds = null;
  const coordinator = createStackActivationCoordinator({
    activationSystem: {
      compileStackExpressions: () => ({ diagnostics: [{
        code: 'activation-cycle', stackIds: [stackId], dimensionIds: [id('cycle-source')], message,
      }] }),
      runtimeStates: () => failedRuntime,
      activationDiagnostics: () => [{ code: 'activation-cycle', stackIds: [stackId], message }],
    },
    getStackState: () => ({ version: 3, stacks: [{ id: stackId, name: 'Rail', enabledExpression: 'd1@Rail > 0' }] }),
    getStackRuntimeState: () => ({ stacks: [] }),
    applyStackRuntimeStates: (value) => { appliedRuntime = new Map(value); },
    setEnabledStackIds: (value) => { enabledIds = [...value]; return { changed: true, enabled: [], disabled: [stackId] }; },
  });

  const result = coordinator.refresh({ compile: true, allowRollback: false });

  assert.equal(result.status, 'failed');
  assert.equal(appliedRuntime.get(stackId).error, message);
  assert.deepEqual(enabledIds, []);
});

test('activation coordinator detects runtime oscillation and restores the accepted state', () => {
  const stackId = id('coordinator-oscillation');
  let runtime = new Map([[stackId, {
    localEnabled: true, effectiveEnabled: true, error: null, awaiting: false,
  }]]);
  let enabled = new Set([stackId]);
  let evaluationCount = 0;
  let restoredSolverCount = 0;
  const signatures = new Map();
  const activationSystem = {
    compileStackExpressions: () => ({ diagnostics: [] }),
    runtimeStates: () => runtime,
    activationDiagnostics: () => [],
    effectiveEnabledStackIds: () => new Set(enabled),
    markActivationDependentsDirty() {},
    beginStabilization() { signatures.clear(); },
    evaluateDirtyStackExpressions() {
      evaluationCount += 1;
      const isEnabled = evaluationCount % 2 === 0;
      runtime = new Map([[stackId, {
        localEnabled: isEnabled, effectiveEnabled: isEnabled, error: null, awaiting: false,
      }]]);
      return { states: runtime, effectiveEnabledStackIds: new Set(isEnabled ? [stackId] : []) };
    },
    stats: () => ({ dirtyStackCount: 1 }),
    recordActivationRound(round) {
      const signature = [...runtime].filter(([, value]) => value.effectiveEnabled).map(([key]) => key).join('|');
      if (signatures.has(signature)) {
        return { oscillating: true, message: `Stack activation oscillation repeated at round ${round}.` };
      }
      signatures.set(signature, round);
      return { oscillating: false };
    },
  };
  const coordinator = createStackActivationCoordinator({
    activationSystem,
    getStackState: () => ({ version: 3, stacks: [{ id: stackId, name: 'Rail', enabledExpression: 'TRUE' }] }),
    getStackRuntimeState: () => ({ stacks: [{ id: stackId, ...runtime.get(stackId) }] }),
    restoreStackState() {},
    applyStackRuntimeStates: (value) => { runtime = new Map(value); },
    setEnabledStackIds(value) {
      const next = new Set(value);
      const transition = {
        changed: next.has(stackId) !== enabled.has(stackId),
        enabled: next.has(stackId) && !enabled.has(stackId) ? [stackId] : [],
        disabled: !next.has(stackId) && enabled.has(stackId) ? [stackId] : [],
      };
      enabled = next;
      return transition;
    },
    getSolverSnapshot: () => ({ geometry: 'accepted' }),
    restoreSolverSnapshot: () => { restoredSolverCount += 1; },
    solve: () => ({ status: 'unchanged', changedEntityIds: [] }),
  });

  const result = coordinator.refresh({ compile: true, maximumRounds: 8 });

  assert.equal(result.status, 'failed');
  assert.match(result.message, /oscillation/);
  assert.equal(runtime.get(stackId).effectiveEnabled, true);
  assert.equal(enabled.has(stackId), true);
  assert.equal(restoredSolverCount, 1);
});
