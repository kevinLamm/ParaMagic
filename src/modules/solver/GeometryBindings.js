import { Variable, createStableId } from './Variable.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const tau = Math.PI * 2;
const normalizeAngle = (angle) => (angle + tau) % tau;
const isFinitePoint = (point) => Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite);

export function circleFromThreePoints(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-10) return null;
  const aa = a[0] ** 2 + a[1] ** 2;
  const bb = b[0] ** 2 + b[1] ** 2;
  const cc = c[0] ** 2 + c[1] ** 2;
  const center = [
    (aa * (b[1] - c[1]) + bb * (c[1] - a[1]) + cc * (a[1] - b[1])) / d,
    (aa * (c[0] - b[0]) + bb * (a[0] - c[0]) + cc * (b[0] - a[0])) / d,
  ];
  return { center, radius: distance(a, center) };
}

function circleFromArcEntity(entity) {
  if (isFinitePoint(entity.center) && Number.isFinite(entity.radius) && Math.abs(entity.radius) > 1e-8) {
    return { center: [...entity.center], radius: Math.abs(entity.radius) };
  }
  return circleFromThreePoints(entity.start, entity.arcPoint, entity.end);
}

function arcMetadata(entity, circle) {
  const startAngle = Math.atan2(entity.start[1] - circle.center[1], entity.start[0] - circle.center[0]);
  const middleAngle = Math.atan2(entity.arcPoint[1] - circle.center[1], entity.arcPoint[0] - circle.center[0]);
  const endAngle = Math.atan2(entity.end[1] - circle.center[1], entity.end[0] - circle.center[0]);
  const ccwSpan = normalizeAngle(endAngle - startAngle);
  const middleRelative = normalizeAngle(middleAngle - startAngle);
  const ccw = middleRelative <= ccwSpan;
  const span = ccw ? ccwSpan : tau - ccwSpan;
  const traveled = ccw ? middleRelative : normalizeAngle(startAngle - middleAngle);
  return { ccw, middleRatio: span > 1e-9 ? Math.max(0.05, Math.min(0.95, traveled / span)) : 0.5 };
}

function pointKeys(prefix, point) {
  return [[`${prefix}.x`, point[0]], [`${prefix}.y`, point[1]]];
}

export class GeometryBinding {
  constructor(inputEntity) {
    const entity = clone(inputEntity);
    this.id = entity.id || createStableId('entity');
    this.type = entity.type;
    this.construction = Boolean(entity.construction);
    this.composite = entity.composite ? clone(entity.composite) : null;
    this.appearance = entity.appearance ? clone(entity.appearance) : null;
    this.metadata = {};
    this.variables = new Map();
    this.load(entity);
  }

  setVariable(name, value) {
    const current = this.variables.get(name);
    if (current) current.value = Number(value);
    else this.variables.set(name, new Variable({ id: `${this.id}:${name}`, value, owner: this.id, parameter: name }));
  }

  setPoints(points) {
    points.forEach((point, index) => pointKeys(`p${index}`, point).forEach(([name, value]) => this.setVariable(name, value)));
    this.metadata.pointCount = points.length;
  }

  load(entity) {
    this.type = entity.type;
    this.construction = Boolean(entity.construction);
    this.composite = entity.composite ? clone(entity.composite) : null;
    this.appearance = entity.appearance ? clone(entity.appearance) : null;
    if (entity.type === 'line') {
      pointKeys('start', entity.start).concat(pointKeys('end', entity.end)).forEach(([name, value]) => this.setVariable(name, value));
      return;
    }
    if (entity.type === 'circle') {
      pointKeys('center', entity.center).forEach(([name, value]) => this.setVariable(name, value));
      this.setVariable('radius', Math.max(1e-8, entity.radius));
      return;
    }
    if (entity.type === 'rect') {
      this.type = 'polygon';
      this.setPoints([
        [entity.x, entity.y],
        [entity.x + entity.width, entity.y],
        [entity.x + entity.width, entity.y + entity.height],
        [entity.x, entity.y + entity.height],
      ]);
      return;
    }
    if (['polygon', 'polyline', 'curve'].includes(entity.type)) {
      this.setPoints(entity.points || []);
      return;
    }
    if (entity.type === 'arc') {
      const circle = circleFromArcEntity(entity);
      if (!circle) throw new Error('Arc points must define a finite circle.');
      pointKeys('center', circle.center)
        .concat(pointKeys('start', entity.start), pointKeys('end', entity.end))
        .forEach(([name, value]) => this.setVariable(name, value));
      this.metadata = { ...this.metadata, ...arcMetadata(entity, circle) };
      return;
    }
    throw new Error(`Unsupported geometry type: ${entity.type}`);
  }

  value(name) {
    return this.variables.get(name)?.value;
  }

  point(prefix) {
    return [this.value(`${prefix}.x`), this.value(`${prefix}.y`)];
  }

  indexedPoint(index) {
    return this.point(`p${index}`);
  }

  arcPoints() {
    const center = this.point('center');
    const start = this.point('start');
    const end = this.point('end');
    const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
    const span = this.metadata.ccw ? normalizeAngle(endAngle - startAngle) : -normalizeAngle(startAngle - endAngle);
    const radius = (distance(start, center) + distance(end, center)) / 2;
    const middleAngle = startAngle + span * (this.metadata.middleRatio ?? 0.5);
    return {
      center,
      start,
      end,
      arcPoint: [center[0] + Math.cos(middleAngle) * radius, center[1] + Math.sin(middleAngle) * radius],
      radius,
      ccw: this.metadata.ccw,
    };
  }

  toEntity() {
    const base = { id: this.id, type: this.type };
    if (this.construction) base.construction = true;
    if (this.composite) base.composite = clone(this.composite);
    if (this.appearance) base.appearance = clone(this.appearance);
    if (this.type === 'line') return { ...base, start: this.point('start'), end: this.point('end') };
    if (this.type === 'circle') return { ...base, center: this.point('center'), radius: Math.abs(this.value('radius')) };
    if (['polygon', 'polyline', 'curve'].includes(this.type)) {
      return { ...base, points: Array.from({ length: this.metadata.pointCount }, (_, index) => this.indexedPoint(index)) };
    }
    if (this.type === 'arc') {
      const arc = this.arcPoints();
      return { ...base, start: arc.start, arcPoint: arc.arcPoint, end: arc.end, center: arc.center, radius: arc.radius, ccw: arc.ccw };
    }
    return base;
  }

  updateFromEntity(entity) {
    this.construction = Boolean(entity.construction);
    this.composite = entity.composite ? clone(entity.composite) : null;
    this.appearance = entity.appearance ? clone(entity.appearance) : null;
    if (entity.type === 'arc') {
      const circle = circleFromArcEntity(entity);
      if (!circle) return false;
      pointKeys('center', circle.center)
        .concat(pointKeys('start', entity.start), pointKeys('end', entity.end))
        .forEach(([name, value]) => this.setVariable(name, value));
      this.metadata = { ...this.metadata, ...arcMetadata(entity, circle) };
      return true;
    }
    this.load({ ...entity, id: this.id });
    return true;
  }

  allVariables() {
    return [...this.variables.values()];
  }

  pointFeature(index = 0) {
    if (this.type === 'line') {
      if (index === 0) return this.point('start');
      if (index === 1) return midpoint(this.point('start'), this.point('end'));
      if (index === 2) return this.point('end');
    }
    if (this.type === 'circle') {
      const center = this.point('center');
      const radius = Math.abs(this.value('radius'));
      return [center, [center[0] - radius, center[1]], [center[0], center[1] - radius], [center[0] + radius, center[1]], [center[0], center[1] + radius]][index] || null;
    }
    if (['polygon', 'polyline', 'curve'].includes(this.type)) return index < this.metadata.pointCount ? this.indexedPoint(index) : null;
    if (this.type === 'arc') {
      const arc = this.arcPoints();
      return [arc.start, arc.arcPoint, arc.end, arc.center][index] || null;
    }
    return null;
  }

  segmentFeature(index = 0) {
    if (this.type === 'line' && index === 0) return { start: this.point('start'), end: this.point('end'), index };
    if (this.type === 'polygon' || this.type === 'polyline') {
      const closed = this.type === 'polygon';
      const limit = closed ? this.metadata.pointCount : this.metadata.pointCount - 1;
      if (index < 0 || index >= limit) return null;
      return { start: this.indexedPoint(index), end: this.indexedPoint((index + 1) % this.metadata.pointCount), index };
    }
    return null;
  }

  entityFeature() {
    if (this.type === 'circle') return { kind: 'circle', center: this.point('center'), radius: Math.abs(this.value('radius')) };
    if (this.type === 'arc') return { kind: 'arc', ...this.arcPoints() };
    if (this.type === 'curve') return { kind: 'curve', points: Array.from({ length: this.metadata.pointCount }, (_, index) => this.indexedPoint(index)) };
    return null;
  }

  variableIdsForPoint(index = 0) {
    const ids = (...names) => names.map((name) => this.variables.get(name)?.id).filter(Boolean);
    if (this.type === 'line') {
      if (index === 0) return ids('start.x', 'start.y');
      if (index === 2) return ids('end.x', 'end.y');
      return this.allVariables().map((variable) => variable.id);
    }
    if (this.type === 'circle') return index === 0 ? ids('center.x', 'center.y') : ids('radius');
    if (['polygon', 'polyline', 'curve'].includes(this.type)) return ids(`p${index}.x`, `p${index}.y`);
    if (this.type === 'arc') {
      if (index === 0) return ids('start.x', 'start.y');
      if (index === 2) return ids('end.x', 'end.y');
      return this.allVariables().map((variable) => variable.id);
    }
    return [];
  }

  variableIdsForSegment(index = 0) {
    if (this.type === 'line') return this.allVariables().map((variable) => variable.id);
    if (this.type === 'polygon' || this.type === 'polyline') {
      return [...this.variableIdsForPoint(index), ...this.variableIdsForPoint((index + 1) % this.metadata.pointCount)];
    }
    return [];
  }

  intrinsicResiduals() {
    if (this.type !== 'arc') return [];
    const center = this.point('center');
    const start = this.point('start');
    const end = this.point('end');
    const startRadius2 = (start[0] - center[0]) ** 2 + (start[1] - center[1]) ** 2;
    const endRadius2 = (end[0] - center[0]) ** 2 + (end[1] - center[1]) ** 2;
    const scale = Math.max(1, startRadius2, endRadius2);
    return [(startRadius2 - endRadius2) / scale];
  }
}

export function createGeometryBinding(entity) {
  return new GeometryBinding(entity);
}
