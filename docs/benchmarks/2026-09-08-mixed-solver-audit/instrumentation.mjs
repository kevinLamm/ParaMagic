import { SolverController } from '/packages/paramagic-core/src/modules/solver/SolverController.js';
import { ConstraintGraph } from '/packages/paramagic-core/src/modules/solver/ConstraintGraph.js';
export const trace = { methods: [], solves: [], controllers: [], facade: null };
export function wrap(prototype, name, label = name, capture = null) {
  const original = prototype[name];
  if (typeof original !== 'function') return;
  prototype[name] = function (...args) {
    capture?.(this);
    const start = performance.now();
    try {
      const result = original.apply(this, args);
      if (label === 'solve') trace.solves.push({ start, elapsedMs: performance.now() - start,
        status: result?.status, iterations: result?.iterations, timings: result?.timings,
        scope: result?.solveScope, jacobian: result?.jacobianStats, message: result?.message });
      return result;
    } finally { trace.methods.push({ name: label, start, elapsedMs: performance.now() - start }); }
  };
}
for (const name of ['loadSketch', 'solve', 'solveLocal', 'updateParameter', 'setDimension', 'emit', 'getSketchSnapshot', 'applyConstraintBatch']) {
  wrap(SolverController.prototype, name, name, controller => {
    if (!trace.controllers.includes(controller)) trace.controllers.push(controller);
  });
}
for (const name of ['rebuild', 'rebuildComponentsForVariables', 'scopeForSeeds']) wrap(ConstraintGraph.prototype, name, `graph.${name}`);
export function clearTrace() { trace.methods.length = 0; trace.solves.length = 0; }
export function summarizedTrace() {
  const methods = {};
  for (const row of trace.methods) {
    const entry = methods[row.name] ||= { calls: 0, totalMs: 0, maxMs: 0 };
    entry.calls++; entry.totalMs += row.elapsedMs; entry.maxMs = Math.max(entry.maxMs, row.elapsedMs);
  }
  return { methods, solves: [...trace.solves] };
}
