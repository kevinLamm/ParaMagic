import {
  createSolverExecutionFacade, solverWorkerModeFromEnvironment, solverJacobianModeFromEnvironment,
} from '@paramagic/core/solver';

export function createAppSolver() {
  const solver = createSolverExecutionFacade({
    mode: solverWorkerModeFromEnvironment(),
    jacobianMode: solverJacobianModeFromEnvironment(),
  });
  solver.subscribeExecution(({ mode, state, jacobianMode }) => {
    document.documentElement.dataset.solverExecutionMode = mode;
    document.documentElement.dataset.solverExecutionState = state;
    document.documentElement.dataset.solverJacobianMode = jacobianMode;
  });
  return solver;
}
