const angleTolerance = 7.5 * Math.PI / 180;

function segments(entity) {
  if (entity.type === 'line') return [{ index: 0, start: entity.start, end: entity.end }];
  if (entity.type === 'polyline' || entity.type === 'polygon') {
    const count = entity.type === 'polygon' ? entity.points.length : entity.points.length - 1;
    return Array.from({ length: Math.max(0, count) }, (_, index) => ({
      index,
      start: entity.points[index],
      end: entity.points[(index + 1) % entity.points.length],
    }));
  }
  return [];
}

function segmentAngle(segment) {
  const angle = Math.atan2(segment.end[1] - segment.start[1], segment.end[0] - segment.start[0]);
  return (angle + Math.PI) % Math.PI;
}

function parallelError(a, b) {
  const delta = Math.abs(a - b);
  return Math.min(delta, Math.PI - delta);
}

function perpendicularError(a, b) {
  return Math.abs(parallelError(a, b) - Math.PI / 2);
}

function circleCenterFromThreePoints(a, b, c) {
  const denominator = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(denominator) < 0.0001) return null;
  const aa = a[0] ** 2 + a[1] ** 2;
  const bb = b[0] ** 2 + b[1] ** 2;
  const cc = c[0] ** 2 + c[1] ** 2;
  return [
    (aa * (b[1] - c[1]) + bb * (c[1] - a[1]) + cc * (a[1] - b[1])) / denominator,
    (aa * (c[0] - b[0]) + bb * (a[0] - c[0]) + cc * (b[0] - a[0])) / denominator,
  ];
}

function roundFeature(entity) {
  if (entity.type === 'circle') return { kind: 'circle', center: entity.center };
  if (entity.type === 'arc') {
    const center = entity.center || circleCenterFromThreePoints(entity.start, entity.arcPoint, entity.end);
    if (center) return { kind: 'arc', center };
  }
  return null;
}

function newPointIndex(entity, clickIndex, snapCount) {
  if (entity.type === 'line') return [0, 2][clickIndex];
  if (entity.type === 'circle') return clickIndex === 0 ? 0 : undefined;
  if (entity.type === 'arc') return clickIndex <= 2 ? clickIndex : undefined;
  if (entity.type === 'polygon' && entity.points.length === 4 && snapCount === 2) return [0, 2][clickIndex];
  if (entity.type === 'polygon' || entity.type === 'polyline' || entity.type === 'curve') return clickIndex < entity.points.length ? clickIndex : undefined;
  return undefined;
}

function descriptorKey(constraint) {
  return JSON.stringify(constraint);
}

export function detectAutoConstraints({ entity, recordId, snapRefs = [], existingEntities = [], worldTolerance = 1 }) {
  const constraints = [];
  const keys = new Set();
  const add = (constraint) => {
    const key = descriptorKey(constraint);
    if (keys.has(key)) return;
    keys.add(key);
    constraints.push(constraint);
  };

  snapRefs.forEach((snap, clickIndex) => {
    if (!snap?.recordId || snap.recordId === recordId) return;
    const pointIndex = newPointIndex(entity, clickIndex, snapRefs.length);
    if (pointIndex === undefined) return;
    const target = existingEntities.find((candidate) => candidate.id === snap.recordId);
    const newRound = roundFeature(entity);
    const targetRound = target && roundFeature(target);
    const newCenterIndex = entity.type === 'circle' ? 0 : 3;
    const targetCenterIndex = target?.type === 'circle' ? 0 : 3;
    if (newRound && targetRound && pointIndex === newCenterIndex && snap.index === targetCenterIndex) {
      add({ type: 'Concentric', featureRefs: [{ kind: entity.type, recordId }, { kind: target.type, recordId: target.id }], source: 'auto' });
      return;
    }
    add({
      type: 'Coincident',
      featureRefs: [{ kind: 'point', recordId, index: pointIndex }, { kind: 'point', recordId: snap.recordId, index: snap.index }],
      source: 'auto',
    });
  });

  const existingSegments = existingEntities.flatMap((candidate) => segments(candidate).map((segment) => ({ ...segment, recordId: candidate.id })));
  segments(entity).forEach((segment) => {
    const angle = segmentAngle(segment);
    const horizontalError = Math.min(angle, Math.PI - angle);
    const verticalError = Math.abs(angle - Math.PI / 2);
    if (horizontalError <= angleTolerance) {
      add({ type: 'Horizontal', featureRefs: [{ kind: 'segment', recordId, index: segment.index }], source: 'auto' });
      return;
    }
    if (verticalError <= angleTolerance) {
      add({ type: 'Vertical', featureRefs: [{ kind: 'segment', recordId, index: segment.index }], source: 'auto' });
      return;
    }
    let best = null;
    existingSegments.forEach((candidate) => {
      const candidateAngle = segmentAngle(candidate);
      const options = [
        { type: 'Parallel', error: parallelError(angle, candidateAngle) },
        { type: 'Perpendicular', error: perpendicularError(angle, candidateAngle) },
      ];
      options.forEach((option) => {
        if (option.error > angleTolerance || (best && option.error >= best.error)) return;
        best = { ...option, candidate };
      });
    });
    if (best) add({
      type: best.type,
      featureRefs: [{ kind: 'segment', recordId, index: segment.index }, { kind: 'segment', recordId: best.candidate.recordId, index: best.candidate.index }],
      source: 'auto',
    });
  });

  const newRound = roundFeature(entity);
  if (newRound) {
    let closest = null;
    existingEntities.forEach((candidate) => {
      const targetRound = roundFeature(candidate);
      if (!targetRound) return;
      const distance = Math.hypot(newRound.center[0] - targetRound.center[0], newRound.center[1] - targetRound.center[1]);
      if (distance <= worldTolerance && (!closest || distance < closest.distance)) closest = { entity: candidate, distance };
    });
    if (closest) add({
      type: 'Concentric',
      featureRefs: [{ kind: entity.type, recordId }, { kind: closest.entity.type, recordId: closest.entity.id }],
      source: 'auto',
    });
  }
  return constraints;
}
