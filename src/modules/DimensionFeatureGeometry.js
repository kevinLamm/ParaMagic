const pointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function arcAngles(feature) {
  const startAngle = Math.atan2(feature.start[1] - feature.center[1], feature.start[0] - feature.center[0]);
  const midAngle = Math.atan2(feature.arcPoint[1] - feature.center[1], feature.arcPoint[0] - feature.center[0]);
  const endAngle = Math.atan2(feature.end[1] - feature.center[1], feature.end[0] - feature.center[0]);
  const tau = Math.PI * 2;
  const normalize = (angle) => (angle + tau) % tau;
  const ccwSpan = normalize(endAngle - startAngle);
  const midOnCcw = normalize(midAngle - startAngle) <= ccwSpan;
  return {
    startAngle,
    ccwSpan,
    span: midOnCcw ? ccwSpan : -(tau - ccwSpan),
  };
}

export function featureLength(feature) {
  if (!feature) return 0;
  if (feature.kind === 'segment') return pointDistance(feature.start, feature.end);
  if (feature.kind === 'circle') return Math.PI * 2 * feature.radius;
  if (feature.kind === 'arc') return Math.abs(arcAngles(feature).span) * feature.radius;
  if (feature.kind === 'curve') {
    return feature.points.slice(1).reduce((total, point, index) => total + pointDistance(feature.points[index], point), 0);
  }
  return 0;
}

export function featureTargetPoint(feature) {
  if (!feature) return null;
  if (feature.kind === 'segment') return [(feature.start[0] + feature.end[0]) / 2, (feature.start[1] + feature.end[1]) / 2];
  if (feature.kind === 'curve') return feature.points[Math.floor(feature.points.length / 2)];
  if (feature.kind === 'arc') {
    const { startAngle, span } = arcAngles(feature);
    const angle = startAngle + span / 2;
    return [feature.center[0] + Math.cos(angle) * feature.radius, feature.center[1] + Math.sin(angle) * feature.radius];
  }
  if (feature.kind === 'circle') return [feature.center[0] + feature.radius, feature.center[1]];
  return null;
}
