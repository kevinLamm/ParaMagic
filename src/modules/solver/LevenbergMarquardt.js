import { computeJacobian } from './Jacobian.js';
import { multiply, multiplyMatrixVector, solveLinearSystem, squaredNorm, transpose } from './LinearAlgebra.js';

function diagnosticConstraints(evaluation) {
  return evaluation.values
    .map((value, index) => ({ value: Math.abs(value), constraintId: evaluation.equations[index]?.constraintId }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .filter((item) => item.value > 1e-6)
    .map((item) => item.constraintId);
}

export function solveLevenbergMarquardt({ model, registry, dimensions, maxIterations = 100, tolerance = 1e-8 }) {
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const startedAt = now();
  const timings = { residualMs: 0, jacobianMs: 0, linearSolveMs: 0, totalMs: 0 };
  const finish = (result) => {
    timings.totalMs = now() - startedAt;
    return { ...result, timings: { ...timings } };
  };
  const allVariables = model.allVariables();
  const activeVariables = model.activeVariables();
  const initialValues = allVariables.map((variable) => variable.value);
  const evaluate = () => {
    const started = now();
    try {
      return registry.evaluate(model, dimensions);
    } finally {
      timings.residualMs += now() - started;
    }
  };
  let evaluation;
  try {
    evaluation = evaluate();
  } catch (error) {
    return finish({ status: 'invalid', iterations: 0, initialError: Infinity, finalError: Infinity, acceptedSteps: 0, rejectedSteps: 0, changedEntityIds: [], problematicConstraintIds: [], message: error.message });
  }
  const initialError = squaredNorm(evaluation.values);
  if (initialError < tolerance) return finish({ status: 'unchanged', iterations: 0, initialError, finalError: initialError, acceptedSteps: 0, rejectedSteps: 0, changedEntityIds: [], problematicConstraintIds: [], message: 'Constraints already satisfied.' });
  if (!activeVariables.length) return finish({ status: 'failed', iterations: 0, initialError, finalError: initialError, acceptedSteps: 0, rejectedSteps: 0, changedEntityIds: [], problematicConstraintIds: diagnosticConstraints(evaluation), message: 'No free variables are available to satisfy the constraints.' });

  let lambda = 0.01;
  let acceptedSteps = 0;
  let rejectedSteps = 0;
  let error = initialError;
  let lastIteration = 0;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    lastIteration = iteration;
    const errors = evaluation.values;
    let jacobian;
    const jacobianStarted = now();
    try {
      jacobian = computeJacobian(activeVariables, () => evaluate().values, errors);
    } catch (jacobianError) {
      allVariables.forEach((variable, index) => { variable.value = initialValues[index]; });
      return finish({ status: 'invalid', iterations: iteration, initialError, finalError: initialError, acceptedSteps, rejectedSteps, changedEntityIds: [], problematicConstraintIds: diagnosticConstraints(evaluation), message: jacobianError.message });
    } finally {
      timings.jacobianMs += now() - jacobianStarted;
    }
    const jt = transpose(jacobian);
    const normal = multiply(jt, jacobian);
    for (let index = 0; index < normal.length; index += 1) normal[index][index] += lambda * Math.max(Math.abs(normal[index][index]), 1) + 1e-7;
    const gradient = multiplyMatrixVector(jt, errors).map((value) => -value);
    let step;
    const linearStarted = now();
    try {
      step = solveLinearSystem(normal, gradient);
    } catch {
      lambda *= 10;
      rejectedSteps += 1;
      continue;
    } finally {
      timings.linearSolveMs += now() - linearStarted;
    }
    const previous = activeVariables.map((variable) => variable.value);
    activeVariables.forEach((variable, index) => { variable.value += step[index]; });
    let candidate;
    try {
      candidate = evaluate();
    } catch {
      candidate = null;
    }
    const candidateError = candidate ? squaredNorm(candidate.values) : Infinity;
    if (Number.isFinite(candidateError) && candidateError < error) {
      evaluation = candidate;
      error = candidateError;
      acceptedSteps += 1;
      lambda = Math.max(1e-12, lambda / 10);
      if (error < tolerance) {
        const changedEntityIds = [...new Set(activeVariables.filter((variable, index) => Math.abs(variable.value - initialValues[allVariables.indexOf(variable)]) > 1e-10).map((variable) => variable.owner))];
        return finish({ status: 'converged', iterations: iteration, initialError, finalError: error, acceptedSteps, rejectedSteps, changedEntityIds, problematicConstraintIds: [], message: 'Constraints converged.' });
      }
      if (squaredNorm(step) < 1e-18) break;
    } else {
      activeVariables.forEach((variable, index) => { variable.value = previous[index]; });
      rejectedSteps += 1;
      lambda *= 10;
    }
  }
  allVariables.forEach((variable, index) => { variable.value = initialValues[index]; });
  return finish({ status: 'max-iterations', iterations: lastIteration, initialError, finalError: initialError, acceptedSteps, rejectedSteps, changedEntityIds: [], problematicConstraintIds: diagnosticConstraints(evaluation), message: 'Solver did not converge; geometry was restored.' });
}
