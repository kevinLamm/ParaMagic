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
