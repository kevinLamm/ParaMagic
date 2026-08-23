import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  DimensionRepository,
  solveLevenbergMarquardt,
} from '../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { ConstraintRegistry } from '../packages/paramagic-core/src/modules/solver/ConstraintRegistry.js';
import { ConstraintGraph } from '../packages/paramagic-core/src/modules/solver/ConstraintGraph.js';
import { solveConstraintComponents } from '../packages/paramagic-core/src/modules/solver/ComponentSolver.js';
import { ParameterRepository } from '../packages/paramagic-core/src/modules/solver/ParameterRepository.js';
import { SketchModel } from '../packages/paramagic-core/src/modules/solver/SolverModel.js';
import { SolverWorkerRuntime } from '../packages/paramagic-core/src/modules/solver/SolverWorkerRuntime.js';
import { SolverWorkerClient } from '../packages/paramagic-core/src/modules/solver/SolverWorkerClient.js';
import { createSolverWorkerRequest } from '../packages/paramagic-core/src/modules/solver/SolverWorkerProtocol.js';

const profiles = {
  quick: {
    parameterCount: 1_000,
    disconnectedLines: 30,
    connectedLines: 18,
    arcs: 8,
    snapshotEntities: 2_000,
    dragUpdates: 60,
    samples: 3,
  },
  standard: {
    parameterCount: 5_000,
    disconnectedLines: 75,
    connectedLines: 45,
    arcs: 20,
    snapshotEntities: 10_000,
    dragUpdates: 300,
    samples: 5,
  },
  stress: {
    parameterCount: 10_000,
    disconnectedLines: 200,
    connectedLines: 120,
    arcs: 60,
    snapshotEntities: 50_000,
    dragUpdates: 300,
    samples: 3,
  },
};

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((argument) => argument.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function percentile(values, ratio) {
  const ordered = [...values].sort((a, b) => a - b);
  if (!ordered.length) return 0;
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1))];
}

function rounded(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function memoryMb() {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

function parameterEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `parameter-${index}`,
    name: `p${index}`,
    expression: index === 0 ? '1' : `p${index - 1}+1`,
    value: index + 1,
    kind: 'user',
    driving: false,
    computed: false,
    enabled: true,
    unit: null,
    error: null,
    order: index,
  }));
}

function parameterFixture(count) {
  const repository = new ParameterRepository();
  repository.restore(parameterEntries(count), { emit: false });
  return repository;
}

function parameterForestFixture(count) {
  const repository = new ParameterRepository();
  const entries = Array.from({ length: count }, (_, index) => {
    const rootIndex = index - (index % 2);
    return {
      id: `forest-parameter-${index}`,
      name: `f${index}`,
      expression: index % 2 === 0 ? String(rootIndex + 1) : `f${rootIndex}+1`,
      value: index % 2 === 0 ? rootIndex + 1 : rootIndex + 2,
      kind: 'user',
      driving: false,
      computed: false,
      enabled: true,
      unit: null,
      error: null,
      order: index,
    };
  });
  repository.restore(entries, { emit: false });
  repository.evaluateAll({ strict: true });
  return repository;
}

function installConstraints(model, constraints) {
  constraints.forEach((constraint, index) => {
    model.constraints.set(constraint.id || `benchmark-constraint-${index}`, {
      enabled: true,
      ...constraint,
      id: constraint.id || `benchmark-constraint-${index}`,
    });
  });
  model.refreshFixedVariables();
}

function disconnectedLineFixture(count) {
  const model = new SketchModel();
  const constraints = [];
  for (let index = 0; index < count; index += 1) {
    const id = `disconnected-line-${index}`;
    const x = index * 12;
    model.addEntity({ id, type: 'line', start: [x, 0], end: [x + 8, 1 + (index % 3) * 0.1] });
    constraints.push({
      id: `horizontal-${index}`,
      type: 'Horizontal',
      featureRefs: [{ kind: 'segment', recordId: id, index: 0 }],
    });
  }
  installConstraints(model, constraints);
  return { model, dimensions: new DimensionRepository() };
}

function connectedLineFixture(count) {
  const model = new SketchModel();
  const constraints = [];
  for (let index = 0; index < count; index += 1) {
    const id = `connected-line-${index}`;
    const startX = index * 10;
    model.addEntity({
      id,
      type: 'line',
      start: [startX, index === 0 ? 0 : 0.35 + (index % 2) * 0.05],
      end: [startX + 10, 0.8 + (index % 3) * 0.08],
    });
    constraints.push({
      id: `connected-horizontal-${index}`,
      type: 'Horizontal',
      featureRefs: [{ kind: 'segment', recordId: id, index: 0 }],
    });
    if (index > 0) {
      constraints.push({
        id: `connected-coincident-${index}`,
        type: 'Coincident',
        featureRefs: [
          { kind: 'point', recordId: `connected-line-${index - 1}`, index: 2 },
          { kind: 'point', recordId: id, index: 0 },
        ],
      });
    }
  }
  constraints.push({
    id: 'connected-origin-fix',
    type: 'Fixed',
    featureRefs: [{ kind: 'point', recordId: 'connected-line-0', index: 0 }],
    fixedPoint: [0, 0],
  });
  installConstraints(model, constraints);
  return { model, dimensions: new DimensionRepository() };
}

function arcFixture(count) {
  const model = new SketchModel();
  const dimensions = new DimensionRepository();
  const constraints = [];
  const dimensionEntries = [];
  for (let index = 0; index < count; index += 1) {
    const id = `benchmark-arc-${index}`;
    const dimensionId = `arc-radius-${index}`;
    const centerX = index * 16;
    model.addEntity({
      id,
      type: 'arc',
      start: [centerX - 5, 0],
      arcPoint: [centerX, -3.5 - (index % 2) * 0.2],
      end: [centerX + 5, 0],
    });
    constraints.push(
      {
        id: `arc-start-fixed-${index}`,
        type: 'Fixed',
        featureRefs: [{ kind: 'point', recordId: id, index: 0 }],
        fixedPoint: [centerX - 5, 0],
      },
      {
        id: `arc-end-fixed-${index}`,
        type: 'Fixed',
        featureRefs: [{ kind: 'point', recordId: id, index: 2 }],
        fixedPoint: [centerX + 5, 0],
      },
      {
        id: `arc-radius-constraint-${index}`,
        type: 'Radius',
        featureRefs: [{ kind: 'arc', recordId: id }],
        dimensionRef: dimensionId,
      },
    );
    dimensionEntries.push({
      id: dimensionId,
      name: `d${index + 1}`,
      expression: '7 mm',
      value: 7,
      kind: 'dimension',
      driving: true,
      computed: false,
      enabled: true,
      unit: 'mm',
      error: null,
      order: index,
    });
  }
  dimensions.restore(dimensionEntries, { emit: false });
  dimensions.setDefaultLengthUnit('mm');
  installConstraints(model, constraints);
  return { model, dimensions };
}

function snapshotFixture(count) {
  const model = new SketchModel();
  for (let index = 0; index < count; index += 1) {
    model.addEntity({
      id: `snapshot-line-${index}`,
      type: 'line',
      start: [index * 2, index % 7],
      end: [index * 2 + 1, (index % 7) + 1],
    });
  }
  return model;
}

class BenchmarkLoopbackWorker {
  constructor(runtime) {
    this.runtime = runtime;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message) {
    queueMicrotask(() => {
      const result = this.runtime.handleRequest(structuredClone(message));
      this.listeners.get('message')?.forEach((listener) => listener({ data: structuredClone(result) }));
    });
  }

  terminate() {}
}

function modelCounts(model, registry, dimensions) {
  let residuals = null;
  try {
    residuals = registry.evaluate(model, dimensions).values.length;
  } catch {
    residuals = null;
  }
  return {
    entities: model.entities.size,
    variables: model.allVariables().length,
    activeVariables: model.activeVariables().length,
    constraints: model.constraints.size,
    residuals,
  };
}

function aggregateSamples(name, samples, counts = {}) {
  const numericKeys = [
    'elapsedMs',
    'residualMs',
    'jacobianMs',
    'linearSolveMs',
    'solverTotalMs',
    'iterations',
    'heapDeltaMb',
    'analyticalBlocks',
    'fallbackBlocks',
  ];
  const medians = Object.fromEntries(numericKeys.map((key) => [
    key,
    rounded(median(samples.map((sample) => Number(sample[key]) || 0))),
  ]));
  return {
    name,
    status: samples.at(-1)?.status || 'completed',
    ...counts,
    ...medians,
    sampleCount: samples.length,
  };
}

function runTimedSamples(name, sampleCount, createOperation, counts = {}) {
  const samples = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const operation = createOperation(sampleIndex);
    const beforeHeap = memoryMb();
    const startedAt = performance.now();
    const result = operation();
    const elapsedMs = performance.now() - startedAt;
    samples.push({
      elapsedMs,
      residualMs: result?.timings?.residualMs || 0,
      jacobianMs: result?.timings?.jacobianMs || 0,
      linearSolveMs: result?.timings?.linearSolveMs || 0,
      solverTotalMs: result?.timings?.totalMs || 0,
      iterations: result?.iterations || 0,
      analyticalBlocks: result?.jacobianStats?.analyticalBlocks || 0,
      fallbackBlocks: result?.jacobianStats?.fallbackBlocks || 0,
      status: result?.status || 'completed',
      heapDeltaMb: memoryMb() - beforeHeap,
    });
  }
  return aggregateSamples(name, samples, counts);
}

function parameterBenchmarks(config) {
  const count = config.parameterCount;
  const evaluate = runTimedSamples(
    'parameter-chain-evaluate',
    config.samples,
    () => {
      const repository = parameterFixture(count);
      return () => {
        repository.evaluateAll({ strict: true });
        return { status: 'completed' };
      };
    },
    { parameters: count },
  );
  const repeatEvaluate = runTimedSamples(
    'parameter-chain-repeat-evaluate',
    config.samples,
    () => {
      const repository = parameterFixture(count);
      repository.evaluateAll({ strict: true });
      return () => {
        repository.evaluateAll({ strict: true });
        return { status: 'completed' };
      };
    },
    { parameters: count },
  );
  const updateRoot = runTimedSamples(
    'parameter-chain-update-root',
    config.samples,
    (sampleIndex) => {
      const repository = parameterFixture(count);
      return () => {
        repository.update('parameter-0', { expression: String(2 + sampleIndex) }, { strict: true });
        return { status: 'completed' };
      };
    },
    { parameters: count },
  );
  const warmedUpdateRoot = runTimedSamples(
    'parameter-chain-warm-update-root',
    config.samples,
    (sampleIndex) => {
      const repository = parameterFixture(count);
      repository.evaluateAll({ strict: true });
      return () => {
        repository.update('parameter-0', { expression: String(2 + sampleIndex) }, { strict: true });
        return { status: 'completed' };
      };
    },
    { parameters: count },
  );
  const updateOneDisconnectedBranch = runTimedSamples(
    'parameter-forest-update-one-branch',
    config.samples,
    (sampleIndex) => {
      const repository = parameterForestFixture(count);
      return () => {
        repository.update('forest-parameter-0', { expression: String(2 + sampleIndex) }, { strict: true });
        return { status: 'completed' };
      };
    },
    { parameters: count },
  );
  return [evaluate, repeatEvaluate, updateRoot, warmedUpdateRoot, updateOneDisconnectedBranch];
}

function solverBenchmark(name, count, sampleCount, fixtureFactory, jacobianMode = 'dense') {
  const registry = new ConstraintRegistry();
  const firstFixture = fixtureFactory(count);
  const counts = modelCounts(firstFixture.model, registry, firstFixture.dimensions);
  let firstAvailable = firstFixture;
  return runTimedSamples(name, sampleCount, () => {
    const fixture = firstAvailable || fixtureFactory(count);
    firstAvailable = null;
    return () => solveLevenbergMarquardt({
      model: fixture.model,
      registry,
      dimensions: fixture.dimensions,
      maxIterations: 500,
      jacobianMode,
    });
  }, counts);
}

function localDisconnectedSolverBenchmark(count, sampleCount, jacobianMode = 'dense') {
  const registry = new ConstraintRegistry();
  return runTimedSamples(
    'local-disconnected-horizontal-line',
    sampleCount,
    () => {
      const fixture = disconnectedLineFixture(count);
      const graph = new ConstraintGraph(fixture.model);
      const scope = graph.scopeForSeeds({ entityIds: ['disconnected-line-0'] });
      return () => solveLevenbergMarquardt({
        model: graph.scopedModel(scope),
        registry,
        dimensions: fixture.dimensions,
        maxIterations: 500,
        jacobianMode,
      });
    },
    {
      entities: count,
      variables: 4,
      constraints: 1,
      residuals: 1,
      components: count,
    },
  );
}

function partitionedGlobalSolverBenchmark(count, sampleCount, jacobianMode = 'dense') {
  const registry = new ConstraintRegistry();
  return runTimedSamples(
    'partitioned-global-disconnected-lines',
    sampleCount,
    () => {
      const fixture = disconnectedLineFixture(count);
      const graph = new ConstraintGraph(fixture.model);
      return () => solveConstraintComponents({
        model: fixture.model,
        graph,
        registry,
        dimensions: fixture.dimensions,
        maxIterations: 500,
        jacobianMode,
      });
    },
    {
      entities: count,
      variables: count * 4,
      constraints: count,
      residuals: count,
      components: count,
    },
  );
}

function constraintGraphBuildBenchmark(count, sampleCount) {
  return runTimedSamples(
    'constraint-graph-build',
    sampleCount,
    () => {
      const fixture = disconnectedLineFixture(count);
      return () => {
        const graph = new ConstraintGraph(fixture.model);
        return { status: 'completed', componentCount: graph.components.size };
      };
    },
    {
      entities: count,
      variables: count * 4,
      constraints: count,
      residuals: count,
      components: count,
    },
  );
}

function constraintGraphConstraintAddBenchmark(count, sampleCount) {
  return runTimedSamples(
    'constraint-graph-add-bridge',
    sampleCount,
    () => {
      const fixture = disconnectedLineFixture(count);
      const graph = new ConstraintGraph(fixture.model);
      fixture.model.constraints.set('benchmark-bridge', {
        id: 'benchmark-bridge',
        type: 'Coincident',
        enabled: true,
        featureRefs: [
          { kind: 'point', recordId: 'disconnected-line-0', index: 2 },
          { kind: 'point', recordId: `disconnected-line-${count - 1}`, index: 0 },
        ],
      });
      return () => ({
        status: graph.addConstraint('benchmark-bridge') ? 'completed' : 'failed',
      });
    },
    {
      entities: count,
      variables: 8,
      constraints: 3,
      residuals: 4,
      components: count - 1,
    },
  );
}

function constraintGraphConstraintRemoveBenchmark(count, sampleCount) {
  return runTimedSamples(
    'constraint-graph-remove-bridge',
    sampleCount,
    () => {
      const fixture = disconnectedLineFixture(count);
      fixture.model.constraints.set('benchmark-bridge', {
        id: 'benchmark-bridge',
        type: 'Coincident',
        enabled: true,
        featureRefs: [
          { kind: 'point', recordId: 'disconnected-line-0', index: 2 },
          { kind: 'point', recordId: `disconnected-line-${count - 1}`, index: 0 },
        ],
      });
      const graph = new ConstraintGraph(fixture.model);
      return () => {
        fixture.model.constraints.delete('benchmark-bridge');
        return {
          status: graph.removeConstraint('benchmark-bridge').size ? 'completed' : 'failed',
        };
      };
    },
    {
      entities: count,
      variables: 8,
      constraints: 2,
      residuals: 2,
      components: count,
    },
  );
}

function constraintGraphEntityRemoveBenchmark(count, sampleCount) {
  return runTimedSamples(
    'constraint-graph-remove-entity',
    sampleCount,
    () => {
      const fixture = disconnectedLineFixture(count);
      const graph = new ConstraintGraph(fixture.model);
      const entityId = `disconnected-line-${count - 1}`;
      const variableIds = graph.variableIdsForEntity(entityId);
      const constraintIds = graph.constraintIdsForEntity(entityId);
      return () => {
        const removed = fixture.model.removeEntity(entityId, { constraintIds });
        graph.removeEntity(entityId, constraintIds, variableIds);
        return { status: removed ? 'completed' : 'failed' };
      };
    },
    {
      entities: count - 1,
      variables: (count - 1) * 4,
      constraints: count - 1,
      residuals: count - 1,
      components: count - 1,
    },
  );
}

function constraintGraphCurveRemapBenchmark(count, sampleCount) {
  return runTimedSamples(
    'constraint-graph-remap-curve',
    sampleCount,
    () => {
      const fixture = disconnectedLineFixture(count);
      fixture.model.addEntity({ id: 'benchmark-curve', type: 'curve', points: [[0, 20], [5, 25], [10, 20]] });
      fixture.model.addEntity({ id: 'benchmark-marker', type: 'point', point: [10, 20] });
      fixture.model.addConstraint({
        id: 'benchmark-curve-link',
        type: 'Coincident',
        featureRefs: [
          { kind: 'point', recordId: 'benchmark-curve', index: 2 },
          { kind: 'point', recordId: 'benchmark-marker', index: 0 },
        ],
      });
      const graph = new ConstraintGraph(fixture.model);
      const variableIds = graph.variableIdsForEntity('benchmark-curve');
      const constraintIds = graph.constraintIdsForRecord('benchmark-curve');
      return () => {
        const constraint = fixture.model.constraints.get('benchmark-curve-link');
        constraint.featureRefs[0].index = 3;
        fixture.model.updateEntity({
          id: 'benchmark-curve',
          type: 'curve',
          points: [[0, 20], [2, 23], [5, 25], [10, 20]],
        });
        graph.updateEntity('benchmark-curve', variableIds, constraintIds);
        return { status: graph.variablesById.has('benchmark-curve:p3.x') ? 'completed' : 'failed' };
      };
    },
    {
      entities: count + 2,
      variables: 10,
      constraints: 1,
      residuals: 2,
      components: count + 1,
    },
  );
}

function constraintGraphDerivedRemapBenchmark(count, sampleCount) {
  return runTimedSamples(
    'constraint-graph-remap-derived',
    sampleCount,
    () => {
      const fixture = disconnectedLineFixture(count);
      fixture.model.setDerivedEntity({
        id: 'benchmark-fillet',
        type: 'fillet',
        sourceA: { recordId: 'disconnected-line-0', index: 0 },
        sourceB: { recordId: 'disconnected-line-1', index: 0 },
        radius: 2,
      });
      fixture.model.addConstraint({
        id: 'benchmark-fillet-link',
        type: 'Point-on Fillet',
        featureRefs: [
          { kind: 'point', recordId: 'disconnected-line-2', index: 0 },
          { kind: 'arc', recordId: 'benchmark-fillet' },
        ],
      });
      const graph = new ConstraintGraph(fixture.model);
      return () => {
        fixture.model.setDerivedEntity({
          id: 'benchmark-fillet',
          type: 'fillet',
          sourceA: { recordId: 'disconnected-line-0', index: 0 },
          sourceB: { recordId: `disconnected-line-${count - 1}`, index: 0 },
          radius: 3,
        });
        const affected = graph.updateDerivedEntity('benchmark-fillet');
        return { status: affected.size ? 'completed' : 'failed' };
      };
    },
    {
      entities: count,
      variables: 12,
      constraints: 4,
      residuals: 5,
      components: count - 2,
    },
  );
}

function snapshotBenchmark(config) {
  const count = config.snapshotEntities;
  return runTimedSamples(
    'geometry-snapshot',
    config.samples,
    () => {
      const model = snapshotFixture(count);
      return () => {
        const snapshot = model.snapshot();
        return { status: snapshot.length === count ? 'completed' : 'invalid' };
      };
    },
    { entities: count },
  );
}

async function dragStreamBenchmark(config) {
  const registry = new ConstraintRegistry();
  const fixtureForCounts = connectedLineFixture(config.connectedLines);
  const counts = modelCounts(fixtureForCounts.model, registry, fixtureForCounts.dimensions);
  const streams = [];
  const updateDurations = [];
  const workerDurations = [];
  const queueDurations = [];
  const roundTripDurations = [];
  const transferDurations = [];
  const payloadSizes = [];
  const finalDurations = [];
  for (let sampleIndex = 0; sampleIndex < config.samples; sampleIndex += 1) {
    const fixture = connectedLineFixture(config.connectedLines);
    const runtime = new SolverWorkerRuntime();
    const client = new SolverWorkerClient(new BenchmarkLoopbackWorker(runtime));
    await client.loadSketch({
      entities: fixture.model.snapshot(),
      constraints: [...fixture.model.constraints.values()],
      parameters: fixture.dimensions.snapshot(),
    });
    const targetId = `connected-line-${config.connectedLines - 1}`;
    const baseline = runtime.controller.getEntity(targetId);
    const lockedVariableIds = runtime.controller.variableIdsForFeature({ kind: 'point', recordId: targetId, index: 2 });
    let budgetExpirations = 0;
    let previewCount = 0;
    const streamStartedAt = performance.now();
    for (let updateIndex = 0; updateIndex < config.dragUpdates; updateIndex += 1) {
      const phase = (updateIndex + 1) / config.dragUpdates;
      const entities = [{
        ...baseline,
        end: [baseline.end[0] + phase * 12, baseline.end[1] + Math.sin(phase * Math.PI * 2) * 4],
      }];
      const payloadSample = createSolverWorkerRequest({
        requestId: updateIndex + 2,
        generation: updateIndex + 1,
        type: 'drag-update',
        payload: { entities, lockedVariableIds },
      });
      payloadSizes.push(Buffer.byteLength(JSON.stringify(payloadSample)));
      const updateStartedAt = performance.now();
      const result = await client.dragUpdate(entities, { lockedVariableIds });
      updateDurations.push(performance.now() - updateStartedAt);
      const workerDuration = Number(result.diagnostics.durationMs) || 0;
      const roundTripDuration = Number(result.diagnostics.roundTripMs) || 0;
      workerDurations.push(workerDuration);
      queueDurations.push(Number(result.diagnostics.queueMs) || 0);
      roundTripDurations.push(roundTripDuration);
      transferDurations.push(Math.max(0, roundTripDuration - workerDuration));
      if (result.status === 'preview') previewCount += 1;
      if (result.diagnostics.cancellationReason === 'time-budget') budgetExpirations += 1;
    }
    const streamElapsedMs = performance.now() - streamStartedAt;
    const finalStartedAt = performance.now();
    const final = await client.solve({ seedVariableIds: lockedVariableIds });
    const finalSolveMs = performance.now() - finalStartedAt;
    client.terminate();
    finalDurations.push(finalSolveMs);
    streams.push({
      elapsedMs: streamElapsedMs,
      status: final.status,
      previewCount,
      budgetExpirations,
      finalSolveMs,
    });
  }
  return {
    name: 'worker-drag-stream',
    status: streams.at(-1)?.status || 'completed',
    ...counts,
    updates: config.dragUpdates,
    elapsedMs: rounded(median(streams.map((sample) => sample.elapsedMs))),
    updateMedianMs: rounded(median(updateDurations)),
    updateP95Ms: rounded(percentile(updateDurations, 0.95)),
    updateMaxMs: rounded(Math.max(...updateDurations)),
    workerMedianMs: rounded(median(workerDurations)),
    workerP95Ms: rounded(percentile(workerDurations, 0.95)),
    queueMedianMs: rounded(median(queueDurations)),
    roundTripP95Ms: rounded(percentile(roundTripDurations, 0.95)),
    transferMedianMs: rounded(median(transferDurations)),
    finalSolveMs: rounded(median(finalDurations)),
    payloadBytes: rounded(median(payloadSizes), 0),
    previewCount: rounded(median(streams.map((sample) => sample.previewCount)), 0),
    budgetExpirations: rounded(median(streams.map((sample) => sample.budgetExpirations)), 0),
    sampleCount: config.samples,
  };
}

function printSummary(report) {
  const rows = report.results.map((result) => ({
    benchmark: result.name,
    status: result.status,
    parameters: result.parameters ?? '',
    entities: result.entities ?? '',
    variables: result.variables ?? '',
    constraints: result.constraints ?? '',
    residuals: result.residuals ?? '',
    iterations: result.iterations,
    'elapsed ms': result.elapsedMs,
    'jacobian ms': result.jacobianMs,
    analytical: result.analyticalBlocks,
    fallback: result.fallbackBlocks,
    'linear ms': result.linearSolveMs,
    'update p95 ms': result.updateP95Ms ?? '',
    'roundtrip p95': result.roundTripP95Ms ?? '',
    'queue ms': result.queueMedianMs ?? '',
    'final ms': result.finalSolveMs ?? '',
    previews: result.previewCount ?? '',
    'budget hits': result.budgetExpirations ?? '',
    'heap MB': result.heapDeltaMb,
  }));
  console.log(`ParaMagic solver benchmark (${report.profile})`);
  console.table(rows);
}

async function main() {
  const profileName = option('profile', 'quick');
  if (!profiles[profileName]) throw new Error(`Unknown benchmark profile: ${profileName}`);
  const requestedSamples = Number(option('samples'));
  const requestedDragUpdates = Number(option('drag-updates'));
  const jacobianMode = option('jacobian-mode', 'dense');
  if (jacobianMode !== 'dense' && jacobianMode !== 'blocks') throw new Error(`Unknown Jacobian mode: ${jacobianMode}`);
  const config = {
    ...profiles[profileName],
    ...(Number.isInteger(requestedSamples) && requestedSamples > 0 ? { samples: requestedSamples } : {}),
    ...(Number.isInteger(requestedDragUpdates) && requestedDragUpdates > 0 ? { dragUpdates: requestedDragUpdates } : {}),
    jacobianMode,
  };
  const startedAt = new Date().toISOString();
  const requestedGraphCount = Number(option('graph-count'));
  const graphOnly = Number.isInteger(requestedGraphCount) && requestedGraphCount > 0;
  const dragOnly = hasFlag('drag-only');
  const results = graphOnly
    ? [
      constraintGraphBuildBenchmark(requestedGraphCount, config.samples),
      constraintGraphConstraintAddBenchmark(requestedGraphCount, config.samples),
      constraintGraphConstraintRemoveBenchmark(requestedGraphCount, config.samples),
      constraintGraphEntityRemoveBenchmark(requestedGraphCount, config.samples),
      constraintGraphCurveRemapBenchmark(requestedGraphCount, config.samples),
      constraintGraphDerivedRemapBenchmark(requestedGraphCount, config.samples),
    ]
    : dragOnly
      ? [await dragStreamBenchmark(config)]
    : [
      ...parameterBenchmarks(config),
      solverBenchmark('disconnected-horizontal-lines', config.disconnectedLines, config.samples, disconnectedLineFixture, jacobianMode),
      partitionedGlobalSolverBenchmark(config.disconnectedLines, config.samples, jacobianMode),
      constraintGraphBuildBenchmark(config.disconnectedLines, config.samples),
      constraintGraphConstraintAddBenchmark(config.disconnectedLines, config.samples),
      constraintGraphConstraintRemoveBenchmark(config.disconnectedLines, config.samples),
      constraintGraphEntityRemoveBenchmark(config.disconnectedLines, config.samples),
      constraintGraphCurveRemapBenchmark(config.disconnectedLines, config.samples),
      constraintGraphDerivedRemapBenchmark(config.disconnectedLines, config.samples),
      localDisconnectedSolverBenchmark(config.disconnectedLines, config.samples, jacobianMode),
      solverBenchmark('connected-line-chain', config.connectedLines, config.samples, connectedLineFixture, jacobianMode),
      solverBenchmark('fixed-endpoint-arcs', config.arcs, config.samples, arcFixture, jacobianMode),
      await dragStreamBenchmark(config),
      snapshotBenchmark(config),
    ];
  const report = {
    schemaVersion: 1,
    startedAt,
    profile: profileName,
    configuration: config,
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: cpus().length,
    },
    results,
  };
  const outputPath = option('output');
  if (outputPath) writeFileSync(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (hasFlag('json')) console.log(JSON.stringify(report, null, 2));
  else printSummary(report);
}

await main();
