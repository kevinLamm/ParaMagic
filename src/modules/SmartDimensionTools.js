const pointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (point, value) => [point[0] * value, point[1] * value];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const length = (point) => Math.hypot(point[0], point[1]);
const unit = (point, fallback = [1, 0]) => {
  const size = length(point);
  return size > 0.0001 ? [point[0] / size, point[1] / size] : fallback;
};

const formatDrawingLength = (value) => formatUnitValue(value, 'in');

function pointAnchor(feature) {
  return feature?.kind === 'point' ? { type: 'point', recordId: feature.recordId, index: feature.index } : null;
}

function segmentEndpointAnchors(feature) {
  if (feature?.kind !== 'segment') return null;
  return {
    start: { type: 'segment-start', recordId: feature.recordId, index: feature.index },
    end: { type: 'segment-end', recordId: feature.recordId, index: feature.index },
  };
}

function entityCenterAnchor(feature) {
  return ['circle', 'arc'].includes(feature?.kind) ? { type: 'center', recordId: feature.recordId } : null;
}

function entityRadiusAnchor(feature) {
  return ['circle', 'arc'].includes(feature?.kind) ? { type: 'radius', recordId: feature.recordId } : null;
}

function curveControlPoint(current, previous, next, tension = 0.18) {
  return [
    current[0] + (next[0] - previous[0]) * tension,
    current[1] + (next[1] - previous[1]) * tension,
  ];
}

function cubicPoint(a, b, c, d, t) {
  const mt = 1 - t;
  return [
    mt ** 3 * a[0] + 3 * mt ** 2 * t * b[0] + 3 * mt * t ** 2 * c[0] + t ** 3 * d[0],
    mt ** 3 * a[1] + 3 * mt ** 2 * t * b[1] + 3 * mt * t ** 2 * c[1] + t ** 3 * d[1],
  ];
}

function curveLength(points) {
  if (points.length < 2) return 0;
  if (points.length === 2) return pointDistance(points[0], points[1]);
  return points.slice(1).reduce((total, point, index) => {
    const currentIndex = index + 1;
    const previous = points[Math.max(0, currentIndex - 2)];
    const current = points[currentIndex - 1];
    const next = point;
    const after = points[Math.min(points.length - 1, currentIndex + 1)];
    const c1 = curveControlPoint(current, previous, next);
    const c2 = curveControlPoint(next, after, current);
    let segmentTotal = 0;
    let last = current;
    for (let step = 1; step <= 24; step += 1) {
      const sampled = cubicPoint(current, c1, c2, next, step / 24);
      segmentTotal += pointDistance(last, sampled);
      last = sampled;
    }
    return total + segmentTotal;
  }, 0);
}

function featureEndpoints(feature) {
  if (feature.kind === 'segment' || feature.kind === 'arc') return [feature.start, feature.end];
  if (feature.kind === 'curve') return [feature.points[0], feature.points[feature.points.length - 1]];
  return [];
}

function segmentLength(feature) {
  if (feature.kind === 'segment') return pointDistance(feature.start, feature.end);
  if (feature.kind === 'circle') return Math.PI * 2 * feature.radius;
  if (feature.kind === 'arc') {
    const startAngle = Math.atan2(feature.start[1] - feature.center[1], feature.start[0] - feature.center[0]);
    const midAngle = Math.atan2(feature.arcPoint[1] - feature.center[1], feature.arcPoint[0] - feature.center[0]);
    const endAngle = Math.atan2(feature.end[1] - feature.center[1], feature.end[0] - feature.center[0]);
    const tau = Math.PI * 2;
    const normalize = (angle) => (angle + tau) % tau;
    const ccwSpan = normalize(endAngle - startAngle);
    const midOnCcw = normalize(midAngle - startAngle) <= ccwSpan;
    return feature.radius * (midOnCcw ? ccwSpan : tau - ccwSpan);
  }
  if (feature.kind === 'curve') return curveLength(feature.points);
  return 0;
}

function projectionOnSegment(point, segment) {
  const vector = subtract(segment.end, segment.start);
  const sizeSquared = dot(vector, vector);
  if (!sizeSquared) return segment.start;
  const t = Math.max(0, Math.min(1, dot(subtract(point, segment.start), vector) / sizeSquared));
  return add(segment.start, scale(vector, t));
}

function projectionOnLine(point, segment) {
  const vector = subtract(segment.end, segment.start);
  const sizeSquared = dot(vector, vector);
  if (!sizeSquared) return segment.start;
  const t = dot(subtract(point, segment.start), vector) / sizeSquared;
  return add(segment.start, scale(vector, t));
}

function parallelEndpointDimension(first, second, pointer, mode) {
  const firstAnchors = segmentEndpointAnchors(first);
  const secondAnchors = segmentEndpointAnchors(second);
  const firstEndpoints = [
    { point: first.start, anchor: firstAnchors?.start },
    { point: first.end, anchor: firstAnchors?.end },
  ];
  const secondEndpoints = [
    { point: second.start, anchor: secondAnchors?.start },
    { point: second.end, anchor: secondAnchors?.end },
  ];
  const candidates = firstEndpoints.flatMap((firstEndpoint) => secondEndpoints.map((secondEndpoint) => {
    const projected = projectionOnLine(secondEndpoint.point, first);
    const anchorMid = midpoint(firstEndpoint.point, secondEndpoint.point);
    return {
      firstEndpoint: firstEndpoint.point,
      secondEndpoint: secondEndpoint.point,
      firstAnchor: firstEndpoint.anchor,
      secondAnchor: secondEndpoint.anchor,
      projected,
      score: pointDistance(firstEndpoint.point, projected) + pointDistance(anchorMid, pointer) * 0.03,
    };
  }));
  const best = candidates.reduce((winner, candidate) => (candidate.score < winner.score ? candidate : winner), candidates[0]);
  return distanceDimension(best.projected, best.secondEndpoint, pointer, mode, best.firstEndpoint, best.secondEndpoint, {
    measureStart: best.firstAnchor,
    measureEnd: best.secondAnchor,
  });
}

function linesIntersection(a, b) {
  const r = subtract(a.end, a.start);
  const s = subtract(b.end, b.start);
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denominator) < 0.0001) return null;
  const delta = subtract(b.start, a.start);
  const t = (delta[0] * s[1] - delta[1] * s[0]) / denominator;
  return add(a.start, scale(r, t));
}

function areParallel(a, b) {
  const first = unit(subtract(a.end, a.start));
  const second = unit(subtract(b.end, b.start));
  return Math.abs(cross(first, second)) < 0.08;
}

function featuresTouch(a, b) {
  const tolerance = 8;
  const firstPoints = featureEndpoints(a);
  const secondPoints = featureEndpoints(b);
  if (!firstPoints.length || !secondPoints.length) return true;
  return firstPoints.some((first) => secondPoints.some((second) => pointDistance(first, second) <= tolerance));
}

function isSameFeature(a, b) {
  return a.kind === b.kind && a.recordId === b.recordId && a.index === b.index;
}

function distanceSubtype(start, end, pointer) {
  const center = midpoint(start, end);
  const dx = Math.abs(pointer[0] - center[0]);
  const dy = Math.abs(pointer[1] - center[1]);
  if (dx > dy * 1.55) return 'vertical';
  if (dy > dx * 1.55) return 'horizontal';
  return 'aligned';
}

function distanceDimension(start, end, pointer, mode, sourceStart = start, sourceEnd = end, anchors = null) {
  const subtype = distanceSubtype(start, end, pointer);
  const measured = subtype === 'horizontal'
    ? Math.abs(sourceEnd[0] - sourceStart[0])
    : subtype === 'vertical'
      ? Math.abs(sourceEnd[1] - sourceStart[1])
      : pointDistance(start, end);
  return {
    type: 'dimension-line',
    dimensionMode: mode,
    subtype,
    start,
    end,
    measureStart: sourceStart,
    measureEnd: sourceEnd,
    label: pointer,
    text: formatDrawingLength(measured),
    anchors,
  };
}

function angleBetweenSegments(first, second, pointer, mode) {
  const vertex = linesIntersection(first, second) || first.end;
  const firstVector = unit(subtract(first.end, first.start));
  const secondVector = unit(subtract(second.end, second.start));
  return {
    type: 'angle-dimension',
    dimensionMode: mode,
    vertex,
    start: add(vertex, scale(firstVector, 80)),
    end: add(vertex, scale(secondVector, 80)),
    radius: Math.max(24, pointDistance(vertex, pointer)),
    label: pointer,
    text: '0 deg',
    anchors: {
      firstSegment: segmentEndpointAnchors(first),
      secondSegment: segmentEndpointAnchors(second),
    },
  };
}

function radiusDimension(feature, pointer, mode) {
  return {
    type: 'radius-dimension',
    dimensionMode: mode,
    center: feature.center,
    radius: feature.radius,
    elbow: pointer,
    label: pointer,
    text: formatDrawingLength(feature.radius),
    anchors: {
      center: entityCenterAnchor(feature),
      radius: entityRadiusAnchor(feature),
    },
  };
}

function mclDimension(features, pointer) {
  const targetFeature = features[0];
  const target = targetFeature.kind === 'segment'
    ? midpoint(targetFeature.start, targetFeature.end)
    : targetFeature.kind === 'curve'
      ? targetFeature.points[Math.floor(targetFeature.points.length / 2)]
      : add(targetFeature.center, [targetFeature.radius, 0]);
  const total = features.reduce((sum, feature) => sum + segmentLength(feature), 0);
  return {
    type: 'multi-curve-length-dimension',
    dimensionMode: 'driven',
    target,
    elbow: pointer,
    label: pointer,
    text: formatDrawingLength(total),
    anchors: {
      features: features.map((feature) => ({
        kind: feature.kind,
        recordId: feature.recordId,
        index: feature.index,
      })),
    },
  };
}

function candidateFromSelections(selections, pointer, mode, ctrlMcl) {
  if (ctrlMcl && mode === 'driven' && selections.length) return mclDimension(selections, pointer);
  if (selections.length === 1) {
    const [feature] = selections;
    if (feature.kind === 'circle' || feature.kind === 'arc') return radiusDimension(feature, pointer, mode);
    if (feature.kind === 'segment') {
      const anchors = segmentEndpointAnchors(feature);
      return distanceDimension(feature.start, feature.end, pointer, mode, feature.start, feature.end, {
        start: anchors?.start,
        end: anchors?.end,
        measureStart: anchors?.start,
        measureEnd: anchors?.end,
      });
    }
  }
  if (selections.length === 2) {
    const [first, second] = selections;
    if (first.kind === 'point' && second.kind === 'point') return distanceDimension(first.point, second.point, pointer, mode, first.point, second.point, {
      start: pointAnchor(first),
      end: pointAnchor(second),
      measureStart: pointAnchor(first),
      measureEnd: pointAnchor(second),
    });
    if (first.kind === 'point' && second.kind === 'segment') {
      const projected = projectionOnSegment(first.point, second);
      return distanceDimension(projected, first.point, pointer, mode, projected, first.point);
    }
    if (first.kind === 'segment' && second.kind === 'point') {
      const projected = projectionOnSegment(second.point, first);
      return distanceDimension(projected, second.point, pointer, mode, projected, second.point);
    }
    if (first.kind === 'segment' && second.kind === 'segment') {
      if (areParallel(first, second)) {
        return parallelEndpointDimension(first, second, pointer, mode);
      }
      return angleBetweenSegments(first, second, pointer, mode);
    }
  }
  return null;
}

export function createSmartDimensionTools({ toolbar, canvas }) {
  let activeMode = null;
  let selections = [];
  let candidate = null;
  let ctrlMcl = false;
  const buttons = [...toolbar.querySelectorAll('[data-dimension-tool]')];

  function clearSelections() {
    selections = [];
    candidate = null;
    ctrlMcl = false;
    canvas.setSmartDimensionFeatureSelection([]);
    canvas.clearPreview();
  }

  function deactivate() {
    activeMode = null;
    clearSelections();
    buttons.forEach((button) => {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    });
    canvas.setSmartDimensionDelegate(null);
  }

  function setActiveMode(mode) {
    const nextMode = activeMode === mode ? null : mode;
    if (!nextMode) {
      deactivate();
      return;
    }
    activeMode = nextMode;
    clearSelections();
    buttons.forEach((button) => {
      const isActive = (button.dataset.dimensionTool.includes('Driven') ? 'driven' : 'driving') === activeMode;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    canvas.setSmartDimensionDelegate(delegate);
    window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'dimension' } }));
  }

  function updateCandidate(pointer) {
    candidate = candidateFromSelections(selections, pointer, activeMode, ctrlMcl);
    if (candidate) canvas.setDimensionPreview(candidate);
    else canvas.clearPreview();
  }

  function addSelection(feature, event) {
    if (!feature) return;
    const shouldUseMcl = activeMode === 'driven' && (event.ctrlKey || ctrlMcl);
    if (shouldUseMcl) {
      ctrlMcl = true;
      if (!['segment', 'arc', 'circle', 'curve'].includes(feature.kind)) return;
      selections = selections.filter((selected) => ['segment', 'arc', 'circle', 'curve'].includes(selected.kind));
      if (selections.some((selected) => isSameFeature(selected, feature))) return;
      if (!selections.length || selections.some((selected) => featuresTouch(selected, feature))) selections.push(feature);
      return;
    }
    ctrlMcl = false;
    if (selections.some((selected) => isSameFeature(selected, feature))) {
      selections = selections.filter((selected) => !isSameFeature(selected, feature));
      return;
    }
    selections = selections.length >= 2 ? [feature] : [...selections, feature];
  }

  function placeCandidate() {
    if (!candidate) return false;
    canvas.addDimension(candidate);
    clearSelections();
    return true;
  }

  const delegate = {
    pointerDown(event) {
      if (!activeMode || event.button !== 0) return false;
      const feature = canvas.getFeatureFromEvent(event);
      const pointer = canvas.screenToWorld(event.clientX, event.clientY);
      if (!feature && placeCandidate()) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      if (!feature) return true;
      event.preventDefault();
      event.stopPropagation();
      addSelection(feature, event);
      canvas.setSmartDimensionFeatureSelection(selections);
      updateCandidate(pointer);
      return true;
    },
    pointerMove(event) {
      if (!activeMode || !selections.length) return false;
      updateCandidate(canvas.screenToWorld(event.clientX, event.clientY));
      return false;
    },
    keyDown(event) {
      if (!activeMode) return false;
      if (event.key === 'Escape') {
        clearSelections();
        event.preventDefault();
        return true;
      }
      if (event.key === 'Enter' && placeCandidate()) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      setActiveMode(button.dataset.dimensionTool.includes('Driven') ? 'driven' : 'driving');
    });
  });

  window.addEventListener('paramagic:tool-activated', (event) => {
    if (event.detail?.source !== 'dimension') deactivate();
  });

  return { clearSelections, deactivate };
}
import { formatUnitValue } from './solver/Units.js';
