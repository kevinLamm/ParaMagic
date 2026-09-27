import { clearTrace, summarizedTrace } from './instrumentation.mjs';
import { SolverWorkerRuntime } from '/packages/paramagic-core/src/modules/solver/SolverWorkerRuntime.js';
const original = SolverWorkerRuntime.prototype.handleRequest;
SolverWorkerRuntime.prototype.handleRequest = function (request) {
  clearTrace();
  const result = original.call(this, request);
  result.auditTrace = summarizedTrace();
  return result;
};
await import('/packages/paramagic-core/src/modules/solver/SolverWorker.js');
