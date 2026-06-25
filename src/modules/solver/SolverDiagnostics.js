export function isSuccessfulSolve(result) {
  return result?.status === 'converged' || result?.status === 'unchanged';
}

export function solverMessage(result) {
  if (!result) return 'Solver did not return a result.';
  return result.message || `Solver status: ${result.status}`;
}
