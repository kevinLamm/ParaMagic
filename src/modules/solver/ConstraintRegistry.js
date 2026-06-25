import { evaluateConstraint, residualImplementations } from './residuals.js';

export class ConstraintRegistry {
  supports(type) {
    return Boolean(residualImplementations[type]);
  }

  evaluate(model, dimensions) {
    // Measurements are sampled before a solve and remain read-only while the
    // numerical Jacobian is built. Re-measuring here would let a driven
    // dimension's source geometry become an implicit solver variable.
    dimensions.evaluateAll?.({ strict: false, refreshComputed: false });
    const values = [];
    const equations = [];
    const intrinsic = model.intrinsicResiduals();
    intrinsic.forEach((value, index) => {
      values.push(value);
      equations.push({ constraintId: `intrinsic-${index}`, equationIndex: index });
    });
    for (const constraint of model.constraints.values()) {
      if (constraint.enabled === false || constraint.type === 'Fixed') continue;
      const residuals = evaluateConstraint(model, constraint, dimensions);
      residuals.forEach((value, equationIndex) => {
        values.push(value);
        equations.push({ constraintId: constraint.id, equationIndex });
      });
    }
    return { values, equations };
  }

  validate(model, constraint, dimensions) {
    if (!this.supports(constraint.type)) throw new Error(`Unsupported constraint type: ${constraint.type}`);
    for (const ref of constraint.featureRefs || []) {
      if (ref?.kind !== 'segment') continue;
      const segment = model.resolveSegment(ref);
      if (!segment || Math.hypot(segment.end[0] - segment.start[0], segment.end[1] - segment.start[1]) < 1e-8) {
        throw new Error(`${constraint.type} requires a non-degenerate segment.`);
      }
    }
    if (constraint.type !== 'Fixed') evaluateConstraint(model, constraint, dimensions);
    return true;
  }
}
