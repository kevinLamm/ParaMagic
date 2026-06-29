import { featureLength, featureTargetPoint } from './DimensionFeatureGeometry.js';
import { formatUnitlessValue } from './solver/Units.js';

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

const formatDrawingLength = (value, drawingUnit) => formatUnitlessValue(value, drawingUnit || 'in');

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

function featureEndpoints(feature) {
  if (feature.kind === 'segment' || feature.kind === 'arc') return [feature.start, feature.end];
  if (feature.kind === 'curve') return [feature.points[0], feature.points[feature.points.length - 1]];
  return [];
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

function parallelEndpointDimension(first, second, pointer, mode, drawingUnit) {
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
  }, drawingUnit);
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

function distanceDimension(start, end, pointer, mode, sourceStart = start, sourceEnd = end, anchors = null, drawingUnit = 'in') {
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
    text: formatDrawingLength(measured, drawingUnit),
    anchors,
    measuredValue: measured,
    useRenderedMeasurement: mode === 'driven',
  };
}

function angleBetweenSegments(first, second, pointer, mode) {
  const vertex = linesIntersection(first, second) || first.end;
  const firstVector = unit(subtract(first.end, first.start));
  const secondVector = unit(subtract(second.end, second.start));
  const measuredValue = Math.abs(Math.atan2(cross(firstVector, secondVector), dot(firstVector, secondVector))) * 180 / Math.PI;
  return {
    type: 'angle-dimension',
    dimensionMode: mode,
    vertex,
    start: add(vertex, scale(firstVector, 80)),
    end: add(vertex, scale(secondVector, 80)),
    radius: Math.max(24, pointDistance(vertex, pointer)),
    label: pointer,
    text: '0 deg',
    measuredValue,
    useRenderedMeasurement: mode === 'driven',
    anchors: {
      firstSegment: segmentEndpointAnchors(first),
      secondSegment: segmentEndpointAnchors(second),
    },
  };
}

function radiusDimension(feature, pointer, mode, drawingUnit) {
  return {
    type: 'radius-dimension',
    dimensionMode: mode,
    center: feature.center,
    radius: feature.radius,
    elbow: pointer,
    label: pointer,
    text: formatDrawingLength(feature.radius, drawingUnit),
    measuredValue: feature.radius,
    useRenderedMeasurement: mode === 'driven',
    anchors: {
      center: entityCenterAnchor(feature),
      radius: entityRadiusAnchor(feature),
    },
  };
}

function mclDimension(features, pointer, drawingUnit) {
  const targetFeature = features[0];
  const target = featureTargetPoint(targetFeature);
  const total = features.reduce((sum, feature) => sum + featureLength(feature), 0);
  return {
    type: 'multi-curve-length-dimension',
    dimensionMode: 'driven',
    target,
    elbow: pointer,
    label: pointer,
    text: formatDrawingLength(total, drawingUnit),
    measuredValue: total,
    useRenderedMeasurement: true,
    anchors: {
      features: features.map((feature) => ({
        kind: feature.kind,
        recordId: feature.recordId,
        index: feature.index,
      })),
    },
  };
}

function candidateFromSelections(selections, pointer, mode, ctrlMcl, drawingUnit) {
  if (ctrlMcl && mode === 'driven' && selections.length) return mclDimension(selections, pointer, drawingUnit);
  if (selections.length === 1) {
    const [feature] = selections;
    if (feature.kind === 'circle' || feature.kind === 'arc') return radiusDimension(feature, pointer, mode, drawingUnit);
    if (feature.kind === 'segment') {
      const anchors = segmentEndpointAnchors(feature);
      return distanceDimension(feature.start, feature.end, pointer, mode, feature.start, feature.end, {
        start: anchors?.start,
        end: anchors?.end,
        measureStart: anchors?.start,
        measureEnd: anchors?.end,
      }, drawingUnit);
    }
  }
  if (selections.length === 2) {
    const [first, second] = selections;
    if (first.kind === 'point' && second.kind === 'point') return distanceDimension(first.point, second.point, pointer, mode, first.point, second.point, {
      start: pointAnchor(first),
      end: pointAnchor(second),
      measureStart: pointAnchor(first),
      measureEnd: pointAnchor(second),
    }, drawingUnit);
    if (first.kind === 'point' && second.kind === 'segment') {
      const projected = projectionOnSegment(first.point, second);
      return distanceDimension(projected, first.point, pointer, mode, projected, first.point, null, drawingUnit);
    }
    if (first.kind === 'segment' && second.kind === 'point') {
      const projected = projectionOnSegment(second.point, first);
      return distanceDimension(projected, second.point, pointer, mode, projected, second.point, null, drawingUnit);
    }
    if (first.kind === 'segment' && second.kind === 'segment') {
      if (areParallel(first, second)) {
        return parallelEndpointDimension(first, second, pointer, mode, drawingUnit);
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
    candidate = candidateFromSelections(selections, pointer, activeMode, ctrlMcl, canvas.getDrawingUnit?.() || 'in');
    if (candidate) canvas.setDimensionPreview(candidate);
    else canvas.clearPreview();
  }

  function addSelection(feature, event) {
    if (!feature) return;
    if (feature.derivedFromFillet && activeMode !== 'driven') return;
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
      const feature = canvas.getFeatureFromEvent(event, { rendered: activeMode === 'driven' });
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
