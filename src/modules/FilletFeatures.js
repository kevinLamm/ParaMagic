const clone = (value) => JSON.parse(JSON.stringify(value));
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (point, amount) => [point[0] * amount, point[1] * amount];
const length = (point) => Math.hypot(point[0], point[1]);
const distance = (a, b) => length(subtract(a, b));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const midpoint = (a, b) => scale(add(a, b), 0.5);
const perpendicular = (point) => [-point[1], point[0]];
const EPSILON = 1e-8;

function unit(point) {
  const size = length(point);
  return size > EPSILON ? scale(point, 1 / size) : null;
}

function normalizeAngle(angle) {
  const tau = Math.PI * 2;
  return (angle + tau) % tau;
}

function circleFromThreePoints(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < EPSILON) return null;
  const aa = a[0] ** 2 + a[1] ** 2;
  const bb = b[0] ** 2 + b[1] ** 2;
  const cc = c[0] ** 2 + c[1] ** 2;
  const center = [
    (aa * (b[1] - c[1]) + bb * (c[1] - a[1]) + cc * (a[1] - b[1])) / d,
    (aa * (c[0] - b[0]) + bb * (a[0] - c[0]) + cc * (b[0] - a[0])) / d,
  ];
  return { center, radius: Math.hypot(a[0] - center[0], a[1] - center[1]) };
}

function endpointKey(ref) {
  return `${ref.recordId}:${ref.index}`;
}

function coincidentGroups(constraints = []) {
  const parent = new Map();
  const find = (key) => {
    if (!parent.has(key)) parent.set(key, key);
    let root = parent.get(key);
    while (root !== parent.get(root)) root = parent.get(root);
    let current = key;
    while (parent.get(current) !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  constraints.forEach((constraint) => {
    if (constraint.enabled === false || constraint.type !== 'Coincident') return;
    const keys = (constraint.featureRefs || [])
      .filter((ref) => ref.kind === 'point')
      .map(endpointKey);
    keys.slice(1).forEach((key) => union(keys[0], key));
  });
  return { connected: (a, b) => find(endpointKey(a)) === find(endpointKey(b)) };
}

function isSupportedFilletSource(entity) {
  return ['line', 'arc', 'curve'].includes(entity?.type);
}

function endpointIndices(entity) {
  if (entity?.type === 'line' || entity?.type === 'arc') return [0, 2];
  if (entity?.type === 'curve' && entity.points?.length >= 2) return [0, entity.points.length - 1];
  return [];
}

function endpointPoint(entity, index) {
  if (entity?.type === 'line' || entity?.type === 'arc') return index === 0 ? entity.start : entity.end;
  if (entity?.type === 'curve') return entity.points[index];
  return null;
}

function interiorReferencePoint(entity, index) {
  if (entity?.type === 'line') return index === 0 ? entity.end : entity.start;
  if (entity?.type === 'curve') return index === 0 ? entity.points[1] : entity.points[entity.points.length - 2];
  return null;
}

function arcDetails(entity) {
  if (entity?.type !== 'arc') return null;
  const stored = Array.isArray(entity.center) && entity.center.every(Number.isFinite) && Number.isFinite(entity.radius)
    ? { center: [...entity.center], radius: Math.abs(entity.radius) }
    : circleFromThreePoints(entity.start, entity.arcPoint, entity.end);
  if (!stored) return null;
  const startAngle = Math.atan2(entity.start[1] - stored.center[1], entity.start[0] - stored.center[0]);
  const midAngle = Math.atan2(entity.arcPoint[1] - stored.center[1], entity.arcPoint[0] - stored.center[0]);
  const endAngle = Math.atan2(entity.end[1] - stored.center[1], entity.end[0] - stored.center[0]);
  const ccwSpan = normalizeAngle(endAngle - startAngle);
  const midOnCcw = normalizeAngle(midAngle - startAngle) <= ccwSpan;
  return {
    circle: stored,
    startAngle,
    endAngle,
    ccw: midOnCcw,
    totalSpan: midOnCcw ? ccwSpan : Math.PI * 2 - ccwSpan,
  };
}

function tangentRay(entity, index) {
  if (entity?.type === 'line' || entity?.type === 'curve') {
    const endpoint = endpointPoint(entity, index);
    const inner = interiorReferencePoint(entity, index);
    return endpoint && inner ? unit(subtract(inner, endpoint)) : null;
  }
  if (entity?.type === 'arc') {
    const details = arcDetails(entity);
    const endpoint = endpointPoint(entity, index);
    if (!details || !endpoint) return null;
    const radiusDirection = unit(subtract(endpoint, details.circle.center));
    if (!radiusDirection) return null;
    const forward = details.ccw ? perpendicular(radiusDirection) : scale(perpendicular(radiusDirection), -1);
    return index === 0 ? forward : scale(forward, -1);
  }
  return null;
}

function approximateAvailableTrim(entity, index) {
  if (entity?.type === 'line' || entity?.type === 'curve') {
    const endpoint = endpointPoint(entity, index);
    const inner = interiorReferencePoint(entity, index);
    return endpoint && inner ? distance(endpoint, inner) : 0;
  }
  if (entity?.type === 'arc') {
    const details = arcDetails(entity);
    const endpoint = endpointPoint(entity, index);
    const opposite = endpointPoint(entity, index === 0 ? 2 : 0);
    if (!details || !endpoint || !opposite) return 0;
    return Math.min(details.totalSpan * details.circle.radius, distance(endpoint, opposite));
  }
  return 0;
}

function projectionOnLine(point, linePoint, lineDirection) {
  const axis = unit(lineDirection);
  if (!axis) return null;
  const t = dot(subtract(point, linePoint), axis);
  return { point: add(linePoint, scale(axis, t)), t, axis };
}

function lineIntersection(first, second) {
  const denominator = cross(first.dir, second.dir);
  if (Math.abs(denominator) < EPSILON) return null;
  const delta = subtract(second.point, first.point);
  const t = cross(delta, second.dir) / denominator;
  return add(first.point, scale(first.dir, t));
}

function lineCircleIntersections(line, circle) {
  const axis = unit(line.dir);
  if (!axis) return [];
  const relative = subtract(line.point, circle.center);
  const b = 2 * dot(axis, relative);
  const c = dot(relative, relative) - circle.radius ** 2;
  const discriminant = b * b - 4 * c;
  if (discriminant < -EPSILON) return [];
  if (Math.abs(discriminant) <= EPSILON) return [add(line.point, scale(axis, -b / 2))];
  const sqrtDiscriminant = Math.sqrt(discriminant);
  return [
    add(line.point, scale(axis, (-b + sqrtDiscriminant) / 2)),
    add(line.point, scale(axis, (-b - sqrtDiscriminant) / 2)),
  ];
}

function circleCircleIntersections(first, second) {
  const between = subtract(second.center, first.center);
  const d = length(between);
  if (d < EPSILON) return [];
  if (d > first.radius + second.radius + EPSILON) return [];
  if (d < Math.abs(first.radius - second.radius) - EPSILON) return [];
  const a = (first.radius ** 2 - second.radius ** 2 + d ** 2) / (2 * d);
  const hSquared = first.radius ** 2 - a ** 2;
  if (hSquared < -EPSILON) return [];
  const axis = scale(between, 1 / d);
  const base = add(first.center, scale(axis, a));
  if (Math.abs(hSquared) <= EPSILON) return [base];
  const h = Math.sqrt(Math.max(0, hSquared));
  const offset = scale(perpendicular(axis), h);
  return [add(base, offset), subtract(base, offset)];
}

function centerCandidates(entity, index, radius) {
  if (entity?.type === 'line' || entity?.type === 'curve') {
    const endpoint = endpointPoint(entity, index);
    const ray = tangentRay(entity, index);
    if (!endpoint || !ray) return [];
    const normal = perpendicular(ray);
    return [
      { kind: 'line', point: add(endpoint, scale(normal, radius)), dir: ray },
      { kind: 'line', point: add(endpoint, scale(normal, -radius)), dir: ray },
    ];
  }
  if (entity?.type === 'arc') {
    const details = arcDetails(entity);
    if (!details) return [];
    const options = [details.circle.radius + radius];
    if (details.circle.radius - radius > EPSILON) options.push(details.circle.radius - radius);
    return [...new Set(options.map((value) => value.toFixed(9)))].map((value) => ({
      kind: 'circle',
      center: details.circle.center,
      radius: Number(value),
    }));
  }
  return [];
}

function intersectCandidates(first, second) {
  if (first.kind === 'line' && second.kind === 'line') {
    const point = lineIntersection(first, second);
    return point ? [point] : [];
  }
  if (first.kind === 'line' && second.kind === 'circle') return lineCircleIntersections(first, second);
  if (first.kind === 'circle' && second.kind === 'line') return lineCircleIntersections(second, first);
  return circleCircleIntersections(first, second);
}

function evaluateSourceTangency(entity, index, center) {
  if (entity?.type === 'line' || entity?.type === 'curve') {
    const endpoint = endpointPoint(entity, index);
    const ray = tangentRay(entity, index);
    const available = approximateAvailableTrim(entity, index);
    if (!endpoint || !ray) return { valid: false };
    const projected = projectionOnLine(center, endpoint, ray);
    if (!projected || projected.t <= EPSILON || projected.t >= available - 1e-7) return { valid: false };
    return { valid: true, point: projected.point, trim: projected.t };
  }
  if (entity?.type === 'arc') {
    const details = arcDetails(entity);
    if (!details) return { valid: false };
    const direction = unit(subtract(center, details.circle.center));
    if (!direction) return { valid: false };
    const point = add(details.circle.center, scale(direction, details.circle.radius));
    const angle = Math.atan2(point[1] - details.circle.center[1], point[0] - details.circle.center[0]);
    const travel = index === 0
      ? (details.ccw ? normalizeAngle(angle - details.startAngle) : normalizeAngle(details.startAngle - angle))
      : (details.ccw ? normalizeAngle(details.endAngle - angle) : normalizeAngle(angle - details.endAngle));
    if (travel <= 1e-6 || travel >= details.totalSpan - 1e-6) return { valid: false };
    return { valid: true, point, trim: travel * details.circle.radius };
  }
  return { valid: false };
}

function trimArcEndpoint(entity, index, point) {
  const details = arcDetails(entity);
  if (!details) return;
  const next = index === 0 ? { start: point, end: entity.end } : { start: entity.start, end: point };
  const startAngle = Math.atan2(next.start[1] - details.circle.center[1], next.start[0] - details.circle.center[0]);
  const endAngle = Math.atan2(next.end[1] - details.circle.center[1], next.end[0] - details.circle.center[0]);
  const span = details.ccw ? normalizeAngle(endAngle - startAngle) : -normalizeAngle(startAngle - endAngle);
  const midAngle = startAngle + span / 2;
  entity.start = next.start;
  entity.end = next.end;
  entity.center = [...details.circle.center];
  entity.radius = details.circle.radius;
  entity.ccw = details.ccw;
  entity.arcPoint = [
    details.circle.center[0] + Math.cos(midAngle) * details.circle.radius,
    details.circle.center[1] + Math.sin(midAngle) * details.circle.radius,
  ];
}

function trimEntityEndpoint(entity, index, point) {
  if (entity?.type === 'line') {
    if (index === 0) entity.start = point;
    else entity.end = point;
  }
  if (entity?.type === 'curve') {
    entity.points[index] = point;
  }
  if (entity?.type === 'arc') trimArcEndpoint(entity, index, point);
}

function evaluateGenericFillet(fillet, entitiesById) {
  if (!isFilletEntity(fillet)) return { valid: false, error: 'Invalid fillet definition.' };
  const entityA = entitiesById.get(fillet.sourceA.recordId);
  const entityB = entitiesById.get(fillet.sourceB.recordId);
  if (!isSupportedFilletSource(entityA) || !isSupportedFilletSource(entityB) || entityA.id === entityB.id) {
    return { valid: false, error: 'Fillet source geometry is missing.' };
  }
  const indexA = Number(fillet.sourceA.index);
  const indexB = Number(fillet.sourceB.index);
  if (!endpointIndices(entityA).includes(indexA) || !endpointIndices(entityB).includes(indexB)) {
    return { valid: false, error: 'Fillet source endpoints are invalid.' };
  }
  const radius = Number(fillet.radius);
  if (!Number.isFinite(radius) || radius <= EPSILON) return { valid: false, error: 'Fillet radius must be greater than zero.' };

  const vertexA = endpointPoint(entityA, indexA);
  const vertexB = endpointPoint(entityB, indexB);
  const rayA = tangentRay(entityA, indexA);
  const rayB = tangentRay(entityB, indexB);
  if (!vertexA || !vertexB || !rayA || !rayB) return { valid: false, error: 'Fillet source geometry must have a valid endpoint tangent.' };
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(rayA, rayB))));
  if (angle <= 1e-5 || Math.PI - angle <= 1e-5) {
    return { valid: false, error: 'Fillet source geometry must form a corner.' };
  }

  const candidates = centerCandidates(entityA, indexA, radius)
    .flatMap((first) => centerCandidates(entityB, indexB, radius)
      .flatMap((second) => intersectCandidates(first, second)));

  const evaluatedCandidates = candidates
    .map((center) => {
      const first = evaluateSourceTangency(entityA, indexA, center);
      const second = evaluateSourceTangency(entityB, indexB, center);
      if (!first.valid || !second.valid) return null;
      const centerToA = subtract(first.point, center);
      const centerToB = subtract(second.point, center);
      const middleDirection = unit(add(centerToA, centerToB));
      if (!middleDirection) return null;
      return {
        center,
        tangentA: first.point,
        tangentB: second.point,
        score: first.trim + second.trim + distance(center, midpoint(vertexA, vertexB)) * 0.01,
        arcPoint: add(center, scale(middleDirection, radius)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score);

  const selected = evaluatedCandidates[0];
  if (!selected) return { valid: false, error: 'Fillet radius is too large for the selected geometry.' };
  const ccw = cross(subtract(selected.tangentA, selected.center), subtract(selected.arcPoint, selected.center)) > 0;

  return {
    valid: true,
    vertex: midpoint(vertexA, vertexB),
    tangentA: selected.tangentA,
    tangentB: selected.tangentB,
    arc: {
      id: fillet.id,
      type: 'arc',
      start: selected.tangentA,
      arcPoint: selected.arcPoint,
      end: selected.tangentB,
      center: selected.center,
      radius,
      ccw,
      construction: Boolean(fillet.construction),
      appearance: clone(fillet.appearance || entityA.appearance || {}),
      derivedFromFillet: true,
    },
  };
}

export function isFilletEntity(entity) {
  return entity?.type === 'fillet'
    && entity.sourceA?.recordId
    && entity.sourceB?.recordId;
}

export function findFilletCorner(entityA, entityB, constraints = [], tolerance = 1e-4) {
  if (!isSupportedFilletSource(entityA) || !isSupportedFilletSource(entityB) || entityA.id === entityB.id) return null;
  const groups = coincidentGroups(constraints);
  const candidates = endpointIndices(entityA).flatMap((indexA) => endpointIndices(entityB).map((indexB) => {
    const refA = { kind: 'point', recordId: entityA.id, index: indexA };
    const refB = { kind: 'point', recordId: entityB.id, index: indexB };
    const gap = distance(endpointPoint(entityA, indexA), endpointPoint(entityB, indexB));
    return { indexA, indexB, gap, constrained: groups.connected(refA, refB) };
  }));
  return candidates
    .filter((candidate) => candidate.constrained || candidate.gap <= tolerance)
    .sort((a, b) => a.gap - b.gap)[0] || null;
}

export function findLineLineCorner(lineA, lineB, constraints = [], tolerance = 1e-4) {
  if (lineA?.type !== 'line' || lineB?.type !== 'line') return null;
  return findFilletCorner(lineA, lineB, constraints, tolerance);
}

export function defaultFilletRadius(entityA, indexA, entityB, indexB) {
  const vertexA = endpointPoint(entityA, indexA);
  const vertexB = endpointPoint(entityB, indexB);
  const rayA = tangentRay(entityA, indexA);
  const rayB = tangentRay(entityB, indexB);
  if (!vertexA || !vertexB || !rayA || !rayB) return 0;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(rayA, rayB))));
  const tangent = Math.min(
    approximateAvailableTrim(entityA, indexA),
    approximateAvailableTrim(entityB, indexB),
  ) * 0.2;
  return Math.max(1e-6, tangent * Math.tan(angle / 2));
}

export function defaultLineLineFilletRadius(lineA, indexA, lineB, indexB) {
  return defaultFilletRadius(lineA, indexA, lineB, indexB);
}

export function evaluateFillet(fillet, entitiesById) {
  return evaluateGenericFillet(fillet, entitiesById);
}

export function evaluateLineLineFillet(fillet, entitiesById) {
  const first = entitiesById.get(fillet?.sourceA?.recordId);
  const second = entitiesById.get(fillet?.sourceB?.recordId);
  if (first?.type !== 'line' || second?.type !== 'line') {
    return { valid: false, error: 'Fillet source lines are missing.' };
  }
  return evaluateGenericFillet(fillet, entitiesById);
}

export function evaluateFilletedGeometry(entities = []) {
  const sourceEntities = entities.filter((entity) => !isFilletEntity(entity));
  const byId = new Map(sourceEntities.map((entity) => [entity.id, clone(entity)]));
  const evaluatedFillets = [];
  entities.filter(isFilletEntity).forEach((fillet) => {
    const evaluated = evaluateFillet(fillet, byId);
    if (!evaluated.valid) return;
    trimEntityEndpoint(byId.get(fillet.sourceA.recordId), fillet.sourceA.index, evaluated.tangentA);
    trimEntityEndpoint(byId.get(fillet.sourceB.recordId), fillet.sourceB.index, evaluated.tangentB);
    evaluatedFillets.push(evaluated.arc);
  });
  return [...sourceEntities.map((entity) => byId.get(entity.id)), ...evaluatedFillets];
}

export function filletTopologyConstraints(constraints = [], fillets = []) {
  const trimmedKeys = new Set(fillets.flatMap((fillet) => [endpointKey(fillet.sourceA), endpointKey(fillet.sourceB)]));
  const retained = constraints.filter((constraint) => {
    if (constraint.type !== 'Coincident') return true;
    return !(constraint.featureRefs || []).some((ref) => trimmedKeys.has(endpointKey(ref)));
  });
  const synthetic = fillets.flatMap((fillet) => [
    {
      id: `${fillet.id}:start`,
      type: 'Coincident',
      featureRefs: [
        { kind: 'point', recordId: fillet.sourceA.recordId, index: fillet.sourceA.index },
        { kind: 'point', recordId: fillet.id, index: 0 },
      ],
    },
    {
      id: `${fillet.id}:end`,
      type: 'Coincident',
      featureRefs: [
        { kind: 'point', recordId: fillet.sourceB.recordId, index: fillet.sourceB.index },
        { kind: 'point', recordId: fillet.id, index: 2 },
      ],
    },
  ]);
  return [...retained, ...synthetic];
}

export function createFilletId() {
  if (globalThis.crypto?.randomUUID) return `fillet-${globalThis.crypto.randomUUID()}`;
  return `fillet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
