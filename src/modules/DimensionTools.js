import { featureLength, featureTargetPoint } from './DimensionFeatureGeometry.js';

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function addPoints(a, b) {
  return [a[0] + b[0], a[1] + b[1]];
}

function subtractPoints(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function scalePoint(point, scale) {
  return [point[0] * scale, point[1] * scale];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

function pointLength(point) {
  return Math.hypot(point[0], point[1]);
}

function unitVector(point, fallback = [1, 0]) {
  const length = pointLength(point);
  return length > 0.0001 ? [point[0] / length, point[1] / length] : fallback;
}

function lineIntersection(a, b) {
  const r = subtractPoints(a.end, a.start);
  const s = subtractPoints(b.end, b.start);
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denominator) < 0.0001) return null;
  const delta = subtractPoints(b.start, a.start);
  const t = (delta[0] * s[1] - delta[1] * s[0]) / denominator;
  return addPoints(a.start, scalePoint(r, t));
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return pointLength(subtractPoints(point, start));
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  const projection = [start[0] + dx * t, start[1] + dy * t];
  return pointLength(subtractPoints(point, projection));
}

function perpendicular(point) {
  return [-point[1], point[0]];
}

function readableAngleDegrees(vector) {
  let angle = Math.atan2(vector[1], vector[0]) * 180 / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

function normalizeAngle(angle) {
  const tau = Math.PI * 2;
  return (angle + tau) % tau;
}

function angleDistance(a, b) {
  const difference = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(difference, Math.PI * 2 - difference);
}

function arrowPath(tip, direction, scale, size = 12 / scale) {
  const axis = unitVector(direction);
  const wing = perpendicular(axis);
  const base = addPoints(tip, scalePoint(axis, size));
  const halfWidth = size * 0.42;
  const a = addPoints(base, scalePoint(wing, halfWidth));
  const b = addPoints(base, scalePoint(wing, -halfWidth));
  return `M ${tip[0]} ${tip[1]} L ${a[0]} ${a[1]} L ${b[0]} ${b[1]} Z`;
}

function distanceDimensionLayout(entity, scale) {
  const measureStart = entity.measureStart || entity.start;
  const measureEnd = entity.measureEnd || entity.end;
  let dimensionBaseStart = entity.start;
  let dimensionBaseEnd = entity.end;
  if (entity.subtype === 'horizontal') {
    dimensionBaseStart = [measureStart[0], measureStart[1]];
    dimensionBaseEnd = [measureEnd[0], measureStart[1]];
  }
  if (entity.subtype === 'vertical') {
    dimensionBaseStart = [measureStart[0], measureStart[1]];
    dimensionBaseEnd = [measureStart[0], measureEnd[1]];
  }
  const measured = subtractPoints(dimensionBaseEnd, dimensionBaseStart);
  const axis = unitVector(measured);
  const normal = perpendicular(axis);
  const measuredMid = midpoint(dimensionBaseStart, dimensionBaseEnd);
  let offset = dot(subtractPoints(entity.label, measuredMid), normal);
  if (Math.abs(offset) < 14 / scale) offset = offset < 0 ? -28 / scale : 28 / scale;
  const side = offset < 0 ? -1 : 1;
  const offsetVector = scalePoint(normal, offset);
  const extensionGap = 6 / scale;
  const extensionOvershoot = 10 / scale;
  const dimensionStart = addPoints(dimensionBaseStart, offsetVector);
  const dimensionEnd = addPoints(dimensionBaseEnd, offsetVector);
  const dimensionMid = midpoint(dimensionStart, dimensionEnd);
  const textPoint = addPoints(dimensionMid, scalePoint(normal, side * 14 / scale));
  return {
    dimensionStart,
    dimensionEnd,
    dimensionMid,
    textPoint,
    angle: readableAngleDegrees(axis),
    extensionA: {
      start: addPoints(measureStart, scalePoint(normal, extensionGap * side)),
      end: addPoints(dimensionStart, scalePoint(normal, extensionOvershoot * side)),
    },
    extensionB: {
      start: addPoints(measureEnd, scalePoint(normal, extensionGap * side)),
      end: addPoints(dimensionEnd, scalePoint(normal, extensionOvershoot * side)),
    },
    arrowA: arrowPath(dimensionStart, axis, scale),
    arrowB: arrowPath(dimensionEnd, scalePoint(axis, -1), scale),
  };
}

function radiusDimensionLayout(entity, scale) {
  const center = entity.center;
  const elbow = entity.elbow || entity.label || addPoints(center, [-72, -48]);
  const radius = entity.radius || pointLength(subtractPoints(entity.target || center, center)) || 72;
  const radialDirection = unitVector(subtractPoints(elbow, center), [1, 0]);
  const target = addPoints(center, scalePoint(radialDirection, radius));
  const textSide = elbow[0] >= center[0] ? 1 : -1;
  const landingLength = 32 / scale;
  const labelGap = 8 / scale;
  const landingEnd = addPoints(elbow, [landingLength * textSide, 0]);
  const label = entity.label ? [entity.label[0], elbow[1]] : addPoints(landingEnd, [labelGap * textSide, 0]);
  return {
    center,
    target,
    elbow,
    landingEnd,
    label,
    leaderPath: `M ${target[0]} ${target[1]} L ${elbow[0]} ${elbow[1]} L ${landingEnd[0]} ${landingEnd[1]}`,
    arrow: arrowPath(target, radialDirection, scale),
    textAnchor: textSide > 0 ? 'start' : 'end',
  };
}

function angleDimensionLayout(entity, scale) {
  const vertex = entity.vertex;
  const startVector = unitVector(subtractPoints(entity.start, vertex), [1, 0]);
  const endVector = unitVector(subtractPoints(entity.end, vertex), [0, 1]);
  const radius = entity.radius || Math.max(36 / scale, pointLength(subtractPoints(entity.label, vertex)) || 58);
  const labelAngle = Math.atan2((entity.label || vertex)[1] - vertex[1], (entity.label || vertex)[0] - vertex[0]);
  const options = [1, -1].flatMap((startSign) => [1, -1].map((endSign) => {
    const optionStartVector = scalePoint(startVector, startSign);
    const optionEndVector = scalePoint(endVector, endSign);
    const startAngle = Math.atan2(optionStartVector[1], optionStartVector[0]);
    const endAngle = Math.atan2(optionEndVector[1], optionEndVector[0]);
    const ccwSpan = normalizeAngle(endAngle - startAngle);
    const sweep = ccwSpan <= Math.PI ? 1 : 0;
    const span = sweep ? ccwSpan : -(Math.PI * 2 - ccwSpan);
    const middleAngle = startAngle + span / 2;
    return {
      startVector: optionStartVector,
      endVector: optionEndVector,
      sweep,
      span,
      middleAngle,
      score: angleDistance(labelAngle, middleAngle),
    };
  }));
  const selected = options.reduce((best, option) => (option.score < best.score ? option : best), options[0]);
  const arcStart = addPoints(vertex, scalePoint(selected.startVector, radius));
  const arcEnd = addPoints(vertex, scalePoint(selected.endVector, radius));
  const largeArc = Math.abs(selected.span) > Math.PI ? 1 : 0;
  const textRadius = radius + 16 / scale;
  const textPoint = addPoints(vertex, [Math.cos(selected.middleAngle) * textRadius, Math.sin(selected.middleAngle) * textRadius]);
  const tangentStart = selected.sweep ? perpendicular(selected.startVector) : scalePoint(perpendicular(selected.startVector), -1);
  const tangentEnd = selected.sweep ? scalePoint(perpendicular(selected.endVector), -1) : perpendicular(selected.endVector);
  const extensionLength = radius + 16 / scale;
  return {
    vertex,
    arcStart,
    arcEnd,
    textPoint,
    angleDegrees: Math.abs(selected.span) * 180 / Math.PI,
    arcPath: `M ${arcStart[0]} ${arcStart[1]} A ${radius} ${radius} 0 ${largeArc} ${selected.sweep} ${arcEnd[0]} ${arcEnd[1]}`,
    extensionA: {
      start: vertex,
      end: addPoints(vertex, scalePoint(selected.startVector, extensionLength)),
    },
    extensionB: {
      start: vertex,
      end: addPoints(vertex, scalePoint(selected.endVector, extensionLength)),
    },
    arrowA: arrowPath(arcStart, tangentStart, scale),
    arrowB: arrowPath(arcEnd, tangentEnd, scale),
  };
}

function mclDimensionLayout(entity, scale) {
  const target = entity.target;
  const elbow = entity.elbow || entity.label || addPoints(target, [54, -42]);
  const textSide = elbow[0] >= target[0] ? 1 : -1;
  const landingLength = 34 / scale;
  const labelGap = 8 / scale;
  const landingEnd = addPoints(elbow, [landingLength * textSide, 0]);
  const label = entity.label ? [entity.label[0], elbow[1]] : addPoints(landingEnd, [labelGap * textSide, 0]);
  const leaderDirection = unitVector(subtractPoints(elbow, target), [1, 0]);
  return {
    target,
    elbow,
    landingEnd,
    label,
    leaderPath: `M ${target[0]} ${target[1]} L ${elbow[0]} ${elbow[1]} L ${landingEnd[0]} ${landingEnd[1]}`,
    arrow: arrowPath(target, leaderDirection, scale),
    textAnchor: textSide > 0 ? 'start' : 'end',
  };
}

export function dimensionDisplayText(entity, text = entity.text || '') {
  if (entity.managedDimensionText) return text;
  if (!entity.dimensionName) return text;
  let measurement = String(text).replace(/^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*/, '');
  measurement = measurement.replace(/^MCL\s*=\s*/i, '');
  return `${entity.dimensionName} = ${measurement}`;
}

export function isDimensionEntity(entity) {
  return ['dimension-line', 'radius-dimension', 'angle-dimension', 'multi-curve-length-dimension', 'dimension-text'].includes(entity.type);
}

export function dimensionMode(entity) {
  return entity.dimensionMode || (entity.text?.toLowerCase().includes('driven') ? 'driven' : 'driving');
}

export function dimensionHandles(entity, scale) {
  if (entity.type === 'dimension-text') return [entity.label];
  return [];
}

export function updateDimensionNode(record, scale) {
  const entity = record.entity;
  if (entity.text) entity.text = dimensionDisplayText(entity, entity.text);
  if (record.text && entity.text) record.text.textContent = entity.text;
  if (entity.type === 'dimension-line') {
    const layout = distanceDimensionLayout(entity, scale);
    record.extensionA.setAttribute('d', `M ${layout.extensionA.start[0]} ${layout.extensionA.start[1]} L ${layout.extensionA.end[0]} ${layout.extensionA.end[1]}`);
    record.extensionB.setAttribute('d', `M ${layout.extensionB.start[0]} ${layout.extensionB.start[1]} L ${layout.extensionB.end[0]} ${layout.extensionB.end[1]}`);
    record.path.setAttribute('d', `M ${layout.dimensionStart[0]} ${layout.dimensionStart[1]} L ${layout.dimensionEnd[0]} ${layout.dimensionEnd[1]}`);
    record.pathHit.setAttribute('d', record.path.getAttribute('d'));
    record.arrowA.setAttribute('d', layout.arrowA);
    record.arrowB.setAttribute('d', layout.arrowB);
    record.text.setAttribute('x', layout.textPoint[0]);
    record.text.setAttribute('y', layout.textPoint[1]);
    record.text.setAttribute('transform', `rotate(${layout.angle} ${layout.textPoint[0]} ${layout.textPoint[1]})`);
    record.text.setAttribute('text-anchor', 'middle');
    record.text.setAttribute('dominant-baseline', 'central');
  }
  if (entity.type === 'radius-dimension') {
    const layout = radiusDimensionLayout(entity, scale);
    entity.target = layout.target;
    entity.label = layout.label;
    record.path.setAttribute('d', layout.leaderPath);
    record.pathHit.setAttribute('d', layout.leaderPath);
    record.arrowA.setAttribute('d', layout.arrow);
    record.text.setAttribute('x', layout.label[0]);
    record.text.setAttribute('y', layout.label[1]);
    record.text.setAttribute('transform', '');
    record.text.setAttribute('text-anchor', layout.textAnchor);
    record.text.setAttribute('dominant-baseline', 'central');
  }
  if (entity.type === 'angle-dimension') {
    const layout = angleDimensionLayout(entity, scale);
    record.extensionA.setAttribute('d', `M ${layout.extensionA.start[0]} ${layout.extensionA.start[1]} L ${layout.extensionA.end[0]} ${layout.extensionA.end[1]}`);
    record.extensionB.setAttribute('d', `M ${layout.extensionB.start[0]} ${layout.extensionB.start[1]} L ${layout.extensionB.end[0]} ${layout.extensionB.end[1]}`);
    record.path.setAttribute('d', layout.arcPath);
    record.pathHit.setAttribute('d', layout.arcPath);
    record.arrowA.setAttribute('d', layout.arrowA);
    record.arrowB.setAttribute('d', layout.arrowB);
    record.text.setAttribute('x', layout.textPoint[0]);
    record.text.setAttribute('y', layout.textPoint[1]);
    record.text.setAttribute('transform', '');
    record.text.setAttribute('text-anchor', 'middle');
    record.text.setAttribute('dominant-baseline', 'central');
    if (!entity.managedDimensionText) {
      entity.text = dimensionDisplayText(entity, `${Math.round(layout.angleDegrees * 10) / 10} deg`);
      record.text.textContent = entity.text;
    }
  }
  if (entity.type === 'multi-curve-length-dimension') {
    const layout = mclDimensionLayout(entity, scale);
    entity.label = layout.label;
    record.path.setAttribute('d', layout.leaderPath);
    record.pathHit.setAttribute('d', layout.leaderPath);
    record.arrowA.setAttribute('d', layout.arrow);
    record.text.setAttribute('x', layout.label[0]);
    record.text.setAttribute('y', layout.label[1]);
    record.text.setAttribute('transform', '');
    record.text.setAttribute('text-anchor', layout.textAnchor);
    record.text.setAttribute('dominant-baseline', 'central');
  }
  if (entity.type === 'dimension-text') {
    record.text.setAttribute('x', entity.label[0]);
    record.text.setAttribute('y', entity.label[1]);
    record.text.setAttribute('transform', '');
  }
}

export function createDimensionRecord({ add, objectLayer, entity, index, scale, updateRecordHandles, bindRecordEvents }) {
  const group = add(objectLayer, 'g', { class: `canvas-record entity-record dimension-record dimension-${dimensionMode(entity)}`, 'data-record-id': entity.id || `dimension-${index}` });
  let path = null;
  let extensionA = null;
  let extensionB = null;
  let arrowA = null;
  let arrowB = null;
  let pathHit = null;
  if (entity.type === 'dimension-line') {
    extensionA = add(group, 'path', { class: 'dimension-extension selectable-entity' });
    extensionB = add(group, 'path', { class: 'dimension-extension selectable-entity' });
    path = add(group, 'path', { class: 'dimension-path selectable-entity' });
    arrowA = add(group, 'path', { class: 'dimension-arrow selectable-entity' });
    arrowB = add(group, 'path', { class: 'dimension-arrow selectable-entity' });
    pathHit = add(group, 'path', { class: 'dimension-path selectable-entity hit-target' });
  }
  if (entity.type === 'angle-dimension') {
    extensionA = add(group, 'path', { class: 'dimension-extension dimension-angle-leg selectable-entity' });
    extensionB = add(group, 'path', { class: 'dimension-extension dimension-angle-leg selectable-entity' });
    path = add(group, 'path', { class: 'dimension-path dimension-angle-arc selectable-entity' });
    arrowA = add(group, 'path', { class: 'dimension-arrow selectable-entity' });
    arrowB = add(group, 'path', { class: 'dimension-arrow selectable-entity' });
    pathHit = add(group, 'path', { class: 'dimension-path dimension-angle-arc selectable-entity hit-target' });
  }
  if (entity.type === 'radius-dimension') {
    path = add(group, 'path', { class: 'dimension-path dimension-leader selectable-entity' });
    arrowA = add(group, 'path', { class: 'dimension-arrow selectable-entity' });
    pathHit = add(group, 'path', { class: 'dimension-path dimension-leader selectable-entity hit-target' });
  }
  if (entity.type === 'multi-curve-length-dimension') {
    path = add(group, 'path', { class: 'dimension-path dimension-leader dimension-mcl-leader selectable-entity' });
    arrowA = add(group, 'path', { class: 'dimension-arrow selectable-entity' });
    pathHit = add(group, 'path', { class: 'dimension-path dimension-leader dimension-mcl-leader selectable-entity hit-target' });
  }
  const text = add(group, 'text', { x: entity.label[0], y: entity.label[1], class: 'dimension-text selectable-entity' });
  text.textContent = entity.text;
  const handleGroup = add(group, 'g', { class: 'handle-group' });
  const record = { id: group.dataset.recordId, recordType: 'dimension', entity, group, node: path || text, path, pathHit, extensionA, extensionB, arrowA, arrowB, text, handleGroup, handles: [] };
  updateDimensionNode(record, scale);
  updateRecordHandles(record);
  bindRecordEvents(record);
  return record;
}

export function moveDimensionHandle(record, handleIndex, world, startWorld, startEntity, scale) {
  const entity = record.entity;
  const dx = world[0] - startWorld[0];
  const dy = world[1] - startWorld[1];
  if (entity.type === 'radius-dimension' && handleIndex === 0) {
    entity.elbow = world;
    const textSide = world[0] >= entity.center[0] ? 1 : -1;
    entity.label = [world[0] + (32 / scale + 8 / scale) * textSide, world[1]];
  }
  if (entity.type === 'multi-curve-length-dimension' && handleIndex === 0) {
    entity.elbow = world;
    const textSide = world[0] >= entity.target[0] ? 1 : -1;
    entity.label = [world[0] + (34 / scale + 8 / scale) * textSide, world[1]];
  }
  if (entity.type === 'dimension-text') entity.label = world;
  updateDimensionNode(record, scale);
}

export function moveDimensionLine(record, world, startWorld, startEntity, scale) {
  const entity = record.entity;
  const dx = world[0] - startWorld[0];
  const dy = world[1] - startWorld[1];
  if (entity.type === 'dimension-line') {
    entity.label = [startEntity.label[0] + dx, startEntity.label[1] + dy];
  }
  if (entity.type === 'angle-dimension') {
    entity.radius = Math.max(18, pointLength(subtractPoints(world, entity.vertex)));
    entity.label = world;
  }
  if (entity.type === 'radius-dimension') {
    const startElbow = startEntity.elbow || startEntity.label || addPoints(startEntity.center, [-72, -48]);
    entity.elbow = [startElbow[0] + dx, startElbow[1] + dy];
    const textSide = entity.elbow[0] >= entity.center[0] ? 1 : -1;
    entity.label = [entity.elbow[0] + (32 / scale + 8 / scale) * textSide, entity.elbow[1]];
  }
  if (entity.type === 'multi-curve-length-dimension') {
    const startElbow = startEntity.elbow || startEntity.label || addPoints(startEntity.target, [54, -42]);
    entity.elbow = [startElbow[0] + dx, startElbow[1] + dy];
    const textSide = entity.elbow[0] >= entity.target[0] ? 1 : -1;
    entity.label = [entity.elbow[0] + (34 / scale + 8 / scale) * textSide, entity.elbow[1]];
  }
  updateDimensionNode(record, scale);
}

export function dimensionAnchorRecordIds(entity) {
  const ids = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.recordId) ids.add(value.recordId);
    Object.values(value).forEach(visit);
  };
  visit(entity.anchors);
  return ids;
}

export function createDimensionLinkManager({
  records,
  recordById,
  recordHandles,
  recordSegments,
  renderedEntityForRecord,
  filletEvaluation,
  arcCircle,
  screenToWorld,
  formatDrawingLength,
  solver,
  applyManagedDimensionText,
  updateRecordHandles,
  syncScreenInvariantSizing,
  getScale,
}) {
  function resolveRecordEntity(record, rendered = false) {
    return (rendered ? renderedEntityForRecord(record) : null) || record?.entity || null;
  }

  function nearestSegmentFeature(record, world, sourceNode = null, { rendered = false } = {}) {
    const segments = recordSegments(resolveRecordEntity(record, rendered));
    if (!segments.length) return null;
    const requestedIndex = sourceNode?.dataset?.segmentIndex;
    const segment = requestedIndex === undefined
      ? segments.reduce((best, current) => {
        const distance = distanceToSegment(world, current.start, current.end);
        return !best || distance < best.distance ? { ...current, distance } : best;
      }, null)
      : segments.find((item) => String(item.index) === requestedIndex);
    if (!segment) return null;
    return {
      kind: 'segment',
      recordId: record.id,
      entityType: record.entity.type,
      start: [...segment.start],
      end: [...segment.end],
      index: segment.index,
      node: record.segmentNodes?.[segment.index] || sourceNode || record.node,
    };
  }

  function segmentFeatureFromRecord(record, index = 0, { rendered = false } = {}) {
    const segments = recordSegments(resolveRecordEntity(record, rendered));
    const segment = segments[Math.max(0, Math.min(index, segments.length - 1))];
    if (!segment) return null;
    return {
      kind: 'segment',
      recordId: record.id,
      entityType: record.entity.type,
      start: [...segment.start],
      end: [...segment.end],
      index: segment.index,
      node: record.segmentNodes?.[segment.index] || record.node,
    };
  }

  function entityFeatureFromRecord(record, { rendered = false } = {}) {
    if (!record || !['geometry', 'fillet'].includes(record.recordType)) return null;
    if (record.recordType === 'fillet') {
      const evaluated = filletEvaluation(record);
      if (!evaluated.valid) return null;
      return {
        kind: 'arc',
        recordId: record.id,
        entityType: 'fillet',
        center: [...evaluated.arc.center],
        radius: evaluated.arc.radius,
        start: [...evaluated.arc.start],
        arcPoint: [...evaluated.arc.arcPoint],
        end: [...evaluated.arc.end],
        node: record.node,
        derivedFromFillet: true,
      };
    }
    const entity = resolveRecordEntity(record, rendered);
    if (entity?.type === 'circle') {
      return { kind: 'circle', recordId: record.id, center: [...entity.center], radius: entity.radius, node: record.node };
    }
    if (entity?.type === 'arc') {
      const circle = arcCircle(entity);
      if (!circle) return null;
      return {
        kind: 'arc',
        recordId: record.id,
        center: circle.center,
        radius: circle.radius,
        start: [...entity.start],
        arcPoint: [...entity.arcPoint],
        end: [...entity.end],
        node: record.node,
      };
    }
    return null;
  }

  function getFeatureFromEvent(event, { rendered = false } = {}) {
    const recordElement = event.target.closest?.('.canvas-record');
    if (!recordElement) return null;
    const record = records.find((item) => item.id === recordElement.dataset.recordId);
    if (!record || !['geometry', 'fillet'].includes(record.recordType)) return null;
    if (record.recordType === 'fillet') {
      const feature = entityFeatureFromRecord(record, { rendered: true });
      return feature ? { ...feature, node: event.target } : null;
    }
    const world = screenToWorld(event.clientX, event.clientY);
    if (event.target.classList?.contains('point-handle')) {
      const index = Number(event.target.dataset.handleIndex);
      const entity = resolveRecordEntity(record, rendered);
      const point = recordHandles(entity)[index];
      return point ? { kind: 'point', recordId: record.id, entityType: record.entity.type, index, point: [...point], node: event.target } : null;
    }
    if (event.target.dataset?.segmentIndex !== undefined) return nearestSegmentFeature(record, world, event.target, { rendered });
    if (record.entity.type === 'line') return { ...nearestSegmentFeature(record, world, record.node, { rendered }), node: event.target };
    if (record.entity.type === 'rect' || record.entity.type === 'polyline' || record.entity.type === 'polygon') return nearestSegmentFeature(record, world, event.target, { rendered });
    if (record.entity.type === 'circle') {
      const entity = resolveRecordEntity(record, rendered);
      return { kind: 'circle', recordId: record.id, center: [...entity.center], radius: entity.radius, node: event.target };
    }
    if (record.entity.type === 'arc') {
      const entity = resolveRecordEntity(record, rendered);
      const circle = arcCircle(entity);
      if (!circle) return null;
      return {
        kind: 'arc',
        recordId: record.id,
        entityType: record.entity.type,
        center: circle.center,
        radius: circle.radius,
        start: [...entity.start],
        arcPoint: [...entity.arcPoint],
        end: [...entity.end],
        node: event.target,
      };
    }
    if (record.entity.type === 'curve') {
      const entity = resolveRecordEntity(record, rendered);
      return {
        kind: 'curve',
        recordId: record.id,
        entityType: record.entity.type,
        points: entity.points.map((point) => [...point]),
        node: event.target,
      };
    }
    return null;
  }

  function getEntityFeature(recordId, options = {}) {
    return entityFeatureFromRecord(recordById(recordId, { includeFillets: true }), options);
  }

  function getSegmentFeature(recordId, index = 0, options = {}) {
    const record = recordById(recordId);
    return record ? segmentFeatureFromRecord(record, index, options) : null;
  }

  function getPointFeature(recordId, index = 0, { rendered = false } = {}) {
    const record = recordById(recordId);
    const entity = resolveRecordEntity(record, rendered);
    const point = entity ? recordHandles(entity)[index] : null;
    return point ? { kind: 'point', recordId: record.id, entityType: record.entity.type, index, point: [...point] } : null;
  }

  function resolveAnchor(anchor, { rendered = false } = {}) {
    if (!anchor) return null;
    const record = recordById(anchor.recordId, { includeFillets: true });
    if (!record) return null;
    const entity = resolveRecordEntity(record, rendered && record.recordType !== 'fillet');
    if (anchor.type === 'point') return recordHandles(entity)[anchor.index]?.slice() || null;
    if (anchor.type === 'segment-start' || anchor.type === 'segment-end') {
      const segment = segmentFeatureFromRecord(record, anchor.index, { rendered });
      if (!segment) return null;
      return anchor.type === 'segment-start' ? [...segment.start] : [...segment.end];
    }
    if (anchor.type === 'center') return entityFeatureFromRecord(record, { rendered })?.center?.slice() || null;
    if (anchor.type === 'radius') return entityFeatureFromRecord(record, { rendered })?.radius || null;
    return null;
  }

  function resolveFeatureFromAnchor(featureAnchor, { rendered = false } = {}) {
    const record = recordById(featureAnchor?.recordId, { includeFillets: true });
    if (!record) return null;
    if (featureAnchor.kind === 'segment') return segmentFeatureFromRecord(record, featureAnchor.index, { rendered });
    if (featureAnchor.kind === 'circle' || featureAnchor.kind === 'arc') return entityFeatureFromRecord(record, { rendered });
    if (featureAnchor.kind === 'curve') {
      const entity = resolveRecordEntity(record, rendered && record.recordType !== 'fillet');
      return entity?.type === 'curve'
        ? { kind: 'curve', recordId: record.id, points: entity.points.map((point) => [...point]) }
        : null;
    }
    return null;
  }

  function computedDimensionValue(entity) {
    if (entity.useRenderedMeasurement && Number.isFinite(entity.measuredValue)) return Number(entity.measuredValue);
    if (entity.type === 'dimension-line') {
      const a = entity.measureStart || entity.start;
      const b = entity.measureEnd || entity.end;
      if (entity.subtype === 'horizontal') return Math.abs(b[0] - a[0]);
      if (entity.subtype === 'vertical') return Math.abs(b[1] - a[1]);
      return pointLength(subtractPoints(a, b));
    }
    if (entity.type === 'radius-dimension') return entity.radius;
    if (entity.type === 'angle-dimension') {
      const first = subtractPoints(entity.start, entity.vertex);
      const second = subtractPoints(entity.end, entity.vertex);
      return Math.abs(Math.atan2(first[0] * second[1] - first[1] * second[0], first[0] * second[0] + first[1] * second[1])) * 180 / Math.PI;
    }
    if (entity.type === 'multi-curve-length-dimension') {
      const features = entity.anchors?.features?.map(resolveFeatureFromAnchor).filter(Boolean) || [];
      return features.reduce((total, feature) => total + featureLength(feature), 0);
    }
    return 0;
  }

  function computedDimensionUnit(entity) {
    return entity.type === 'angle-dimension' ? 'deg' : solver.drawingUnit;
  }

  function dimensionLineText(entity) {
    const sourceStart = entity.measureStart || entity.start;
    const sourceEnd = entity.measureEnd || entity.end;
    const measured = entity.subtype === 'horizontal'
      ? Math.abs(sourceEnd[0] - sourceStart[0])
      : entity.subtype === 'vertical'
        ? Math.abs(sourceEnd[1] - sourceStart[1])
        : pointLength(subtractPoints(entity.start, entity.end));
    return formatDrawingLength(measured);
  }

  function updateLinkedDimensionEntity(entity) {
    if (!entity.anchors) return false;
    const useRendered = entity.dimensionMode === 'driven';
    if (entity.type === 'dimension-line') {
      const oldMid = midpoint(entity.measureStart || entity.start, entity.measureEnd || entity.end);
      const nextStart = resolveAnchor(entity.anchors.start, { rendered: useRendered }) || entity.start;
      const nextEnd = resolveAnchor(entity.anchors.end, { rendered: useRendered }) || entity.end;
      const nextMeasureStart = resolveAnchor(entity.anchors.measureStart, { rendered: useRendered }) || nextStart;
      const nextMeasureEnd = resolveAnchor(entity.anchors.measureEnd, { rendered: useRendered }) || nextEnd;
      const nextMid = midpoint(nextMeasureStart, nextMeasureEnd);
      const delta = subtractPoints(nextMid, oldMid);
      entity.start = nextStart;
      entity.end = nextEnd;
      entity.measureStart = nextMeasureStart;
      entity.measureEnd = nextMeasureEnd;
      entity.label = addPoints(entity.label, delta);
      entity.text = dimensionLineText(entity);
      entity.measuredValue = computedDimensionValue(entity);
      return true;
    }
    if (entity.type === 'radius-dimension') {
      const oldCenter = entity.center;
      const center = resolveAnchor(entity.anchors.center, { rendered: useRendered });
      const radius = resolveAnchor(entity.anchors.radius, { rendered: useRendered });
      if (!center) return false;
      const delta = subtractPoints(center, oldCenter);
      entity.center = center;
      if (radius) entity.radius = radius;
      entity.elbow = addPoints(entity.elbow || entity.label, delta);
      entity.label = addPoints(entity.label, delta);
      entity.text = formatDrawingLength(entity.radius);
      entity.measuredValue = computedDimensionValue(entity);
      return true;
    }
    if (entity.type === 'angle-dimension') {
      const first = entity.anchors.firstSegment;
      const second = entity.anchors.secondSegment;
      const firstSegment = first?.start && first?.end ? {
        start: resolveAnchor(first.start, { rendered: useRendered }),
        end: resolveAnchor(first.end, { rendered: useRendered }),
      } : null;
      const secondSegment = second?.start && second?.end ? {
        start: resolveAnchor(second.start, { rendered: useRendered }),
        end: resolveAnchor(second.end, { rendered: useRendered }),
      } : null;
      if (!firstSegment?.start || !firstSegment?.end || !secondSegment?.start || !secondSegment?.end) return false;
      const oldVertex = entity.vertex;
      const vertex = lineIntersection(firstSegment, secondSegment) || firstSegment.end;
      const firstVector = unitVector(subtractPoints(firstSegment.end, firstSegment.start));
      const secondVector = unitVector(subtractPoints(secondSegment.end, secondSegment.start), [0, 1]);
      const delta = subtractPoints(vertex, oldVertex);
      entity.vertex = vertex;
      entity.start = addPoints(vertex, scalePoint(firstVector, 80));
      entity.end = addPoints(vertex, scalePoint(secondVector, 80));
      entity.label = addPoints(entity.label, delta);
      entity.measuredValue = computedDimensionValue(entity);
      return true;
    }
    if (entity.type === 'multi-curve-length-dimension') {
      const features = entity.anchors.features?.map((featureAnchor) => resolveFeatureFromAnchor(featureAnchor, { rendered: useRendered })).filter(Boolean) || [];
      if (!features.length) return false;
      const first = features[0];
      const target = featureTargetPoint(first);
      if (!target) return false;
      const delta = subtractPoints(target, entity.target);
      entity.target = target;
      entity.elbow = addPoints(entity.elbow || entity.label, delta);
      entity.label = addPoints(entity.label, delta);
      entity.measuredValue = features.reduce((total, feature) => total + featureLength(feature), 0);
      entity.text = formatDrawingLength(entity.measuredValue);
      return true;
    }
    return false;
  }

  function refreshLinkedDimensions(changedRecordIds = null) {
    records.forEach((record) => {
      if (record.recordType !== 'dimension' || !record.entity.anchors) return;
      const anchorIds = dimensionAnchorRecordIds(record.entity);
      if (changedRecordIds && ![...anchorIds].some((id) => changedRecordIds.has(id))) return;
      if (!updateLinkedDimensionEntity(record.entity)) return;
      if (record.entity.dimensionId) solver.updateDimensionAnnotation?.(record.entity.dimensionId, record.entity);
      if (record.entity.dimensionMode === 'driven' && record.entity.dimensionId) {
        solver.dimensions.setComputedValue(
          record.entity.dimensionId,
          computedDimensionValue(record.entity),
          computedDimensionUnit(record.entity),
        );
      }
      applyManagedDimensionText(record.entity);
      updateDimensionNode(record, getScale());
      updateRecordHandles(record);
    });
    syncScreenInvariantSizing?.();
  }

  return {
    getEntityFeature,
    getSegmentFeature,
    getPointFeature,
    getFeatureFromEvent,
    refreshLinkedDimensions,
  };
}
