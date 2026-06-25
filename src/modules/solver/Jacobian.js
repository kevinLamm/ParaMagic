export function computeJacobian(variables, evaluate, baseErrors = evaluate(), baseDelta = 1e-6) {
  const jacobian = Array.from({ length: baseErrors.length }, () => Array(variables.length).fill(0));
  variables.forEach((variable, column) => {
    const original = variable.value;
    const delta = baseDelta * Math.max(1, Math.abs(original));
    try {
      variable.value = original + delta;
      const perturbed = evaluate();
      if (perturbed.length !== baseErrors.length) throw new Error('Residual count changed during Jacobian evaluation.');
      perturbed.forEach((value, row) => { jacobian[row][column] = (value - baseErrors[row]) / delta; });
    } finally {
      variable.value = original;
    }
  });
  return jacobian;
}
