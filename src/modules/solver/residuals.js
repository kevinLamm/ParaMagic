const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const length2 = (v) => dot(v, v);
const length = (v) => Math.hypot(v[0], v[1]);
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const pointDistance2 = (a, b) => length2(subtract(a, b));
const safeScale = (...values) => Math.max(1, ...values.map((value) => Math.abs(value)));
const tau = Math.PI * 2;
const normalizeAngle = (angle) => (angle + tau) % tau;
const angleDistance = (a, b) => Math.min(normalizeAngle(a - b), normalizeAngle(b - a));

function required(value, message) {
  if (!value || (Array.isArray(value) && value.some((item) => !Number.isFinite(item)))) throw new Error(message);
  return value;
}

function point(model, ref) {
  return required(model.resolvePoint(ref), 'Constraint requires a valid point feature.');
}

function segment(model, ref) {
  return required(model.resolveSegment(ref), 'Constraint requires a valid segment feature.');
}

function entity(model, ref) {
  return required(model.resolveEntity(ref), 'Constraint requires a valid circle, arc, or curve feature.');
}

function target(constraint, dimensions) {
  if (constraint.dimensionRef) return dimensions.value(constraint.dimensionRef);
  if (Number.isFinite(constraint.value)) return constraint.value;
  throw new Error('Dimensional constraint requires a finite target.');
}

function normalizedLineCross(pointValue, line) {
  const direction = subtract(line.end, line.start);
  return cross(subtract(pointValue, line.start), direction) / safeScale(length(direction));
}

export const residualImplementations = {
  Coincident(model, constraint) {
    const [a, b] = constraint.featureRefs.map((ref) => point(model, ref));
    return [a[0] - b[0], a[1] - b[1]];
  },
  Horizontal(model, constraint) {
    const line = segment(model, constraint.featureRefs[0]);
    return [line.start[1] - line.end[1]];
  },
  Vertical(model, constraint) {
    const line = segment(model, constraint.featureRefs[0]);
    return [line.start[0] - line.end[0]];
  },
  Parallel(model, constraint) {
    const [a, b] = constraint.featureRefs.map((ref) => segment(model, ref));
    const av = subtract(a.end, a.start);
    const bv = subtract(b.end, b.start);
    return [cross(av, bv) / safeScale(length(av) * length(bv))];
  },
  Perpendicular(model, constraint) {
    const [a, b] = constraint.featureRefs.map((ref) => segment(model, ref));
    const av = subtract(a.end, a.start);
    const bv = subtract(b.end, b.start);
    return [dot(av, bv) / safeScale(length(av) * length(bv))];
  },
  'Point-on Line'(model, constraint) {
    return [normalizedLineCross(point(model, constraint.featureRefs[0]), segment(model, constraint.featureRefs[1]))];
  },
  Collinear(model, constraint) {
    const [driver, follower] = constraint.featureRefs.map((ref) => segment(model, ref));
    return [normalizedLineCross(follower.start, driver), normalizedLineCross(follower.end, driver)];
  },
  Equal(model, constraint) {
    const [a, b] = constraint.featureRefs.map((ref) => segment(model, ref));
    const a2 = pointDistance2(a.start, a.end);
    const b2 = pointDistance2(b.start, b.end);
    return [(a2 - b2) / safeScale(a2, b2)];
  },
  Midpoint(model, constraint) {
    const p = point(model, constraint.featureRefs[0]);
    const line = segment(model, constraint.featureRefs[1]);
    const middle = midpoint(line.start, line.end);
    return [p[0] - middle[0], p[1] - middle[1]];
  },
  Concentric(model, constraint) {
    const [a, b] = constraint.featureRefs.map((ref) => entity(model, ref));
    return [a.center[0] - b.center[0], a.center[1] - b.center[1]];
  },
  Tangent(model, constraint) {
    const lineRef = constraint.featureRefs.find((ref) => ref.kind === 'segment');
    const roundRefs = constraint.featureRefs.filter((ref) => ref.kind === 'circle' || ref.kind === 'arc');
    if (lineRef && roundRefs.length === 1) {
      const line = segment(model, lineRef);
      const round = entity(model, roundRefs[0]);
      const direction = subtract(line.end, line.start);
      const denominator = Math.max(1e-12, length2(direction));
      const area = cross(direction, subtract(round.center, line.start));
      const distanceSquared = (area * area) / denominator;
      return [(distanceSquared - round.radius ** 2) / safeScale(distanceSquared, round.radius ** 2)];
    }
    if (!lineRef && roundRefs.length === 2) {
      const [a, b] = roundRefs.map((ref) => entity(model, ref));
      const centerDistanceSquared = pointDistance2(a.center, b.center);
      const targetDistance = constraint.tangentMode === 'internal'
        ? Math.abs(a.radius - b.radius)
        : a.radius + b.radius;
      const targetDistanceSquared = targetDistance ** 2;
      return [(centerDistanceSquared - targetDistanceSquared) / safeScale(centerDistanceSquared, targetDistanceSquared)];
    }
    throw new Error('Tangent requires a line and a circle/arc, or two circles/arcs.');
  },
  'Point-on Circle'(model, constraint) {
    const p = point(model, constraint.featureRefs[0]);
    const round = entity(model, constraint.featureRefs[1]);
    const measured = pointDistance2(p, round.center);
    return [(measured - round.radius ** 2) / safeScale(measured, round.radius ** 2)];
  },
  'Point-on Arc'(model, constraint) {
    const radial = residualImplementations['Point-on Circle'](model, constraint)[0];
    const p = point(model, constraint.featureRefs[0]);
    const arc = entity(model, constraint.featureRefs[1]);
    const startAngle = Math.atan2(arc.start[1] - arc.center[1], arc.start[0] - arc.center[0]);
    const endAngle = Math.atan2(arc.end[1] - arc.center[1], arc.end[0] - arc.center[0]);
    const pointAngle = Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]);
    const span = arc.ccw ? normalizeAngle(endAngle - startAngle) : normalizeAngle(startAngle - endAngle);
    const traveled = arc.ccw ? normalizeAngle(pointAngle - startAngle) : normalizeAngle(startAngle - pointAngle);
    const domain = traveled <= span + 1e-9 ? 0 : Math.min(angleDistance(pointAngle, startAngle), angleDistance(pointAngle, endAngle));
    return [radial, domain];
  },
  Distance(model, constraint, dimensions) {
    const a = point(model, constraint.anchors?.start || constraint.featureRefs[0]);
    const b = point(model, constraint.anchors?.end || constraint.featureRefs[1]);
    const desired = target(constraint, dimensions);
    const measured2 = pointDistance2(a, b);
    return [(measured2 - desired ** 2) / safeScale(measured2, desired ** 2)];
  },
  'Horizontal Distance'(model, constraint, dimensions) {
    const a = point(model, constraint.anchors?.start || constraint.featureRefs[0]);
    const b = point(model, constraint.anchors?.end || constraint.featureRefs[1]);
    const desired = target(constraint, dimensions);
    const sign = constraint.orientation || Math.sign(b[0] - a[0]) || 1;
    return [b[0] - a[0] - sign * desired];
  },
  'Vertical Distance'(model, constraint, dimensions) {
    const a = point(model, constraint.anchors?.start || constraint.featureRefs[0]);
    const b = point(model, constraint.anchors?.end || constraint.featureRefs[1]);
    const desired = target(constraint, dimensions);
    const sign = constraint.orientation || Math.sign(b[1] - a[1]) || 1;
    return [b[1] - a[1] - sign * desired];
  },
  Radius(model, constraint, dimensions) {
    const round = entity(model, constraint.featureRefs[0]);
    return [round.radius - target(constraint, dimensions)];
  },
  Angle(model, constraint, dimensions) {
    const [a, b] = constraint.featureRefs.map((ref) => segment(model, ref));
    const av = subtract(a.end, a.start);
    const bv = subtract(b.end, b.start);
    const measured = Math.atan2(cross(av, bv), dot(av, bv));
    const desired = target(constraint, dimensions) * Math.PI / 180;
    return [Math.atan2(Math.sin(measured - desired), Math.cos(measured - desired))];
  },
  Meta(model, constraint, dimensions) {
    const variable = model.variableById(constraint.parameterRef);
    if (!variable) throw new Error(`Unknown meta-constraint variable: ${constraint.parameterRef}`);
    return [variable.value - target(constraint, dimensions)];
  },
  Fixed() {
    return [];
  },
};

export function evaluateConstraint(model, constraint, dimensions) {
  const implementation = residualImplementations[constraint.type];
  if (!implementation) throw new Error(`Unsupported constraint type: ${constraint.type}`);
  const values = implementation(model, constraint, dimensions);
  if (!values.every(Number.isFinite)) throw new Error(`Constraint ${constraint.id} produced a non-finite residual.`);
  return values;
}
