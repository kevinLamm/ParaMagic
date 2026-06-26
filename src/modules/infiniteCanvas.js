import {
  createDimensionRecord,
  dimensionHandles,
  isDimensionEntity,
  moveDimensionHandle,
  moveDimensionLine,
  updateDimensionNode,
} from './DimensionTools.js';
import { formatUnitValue } from './solver/Units.js';
import { mergeDrawingData } from './DrawingIO.js';
import { findClosedGeometryCycles } from './ClosedRegionTopology.js';
import { detectAutoConstraints } from './AutoConstraintDetector.js';
import { resolveColorExpression, resolveOpacityExpression } from './AppearanceExpressions.js';
import { createImageManipulation, imageAppearance, isImageEntity, normalizeImageEntity } from './ImageManipulation.js';

export function createInfiniteCanvas({ canvas, grid, svg, status, reset, entities, solver }) {
  const minZoom = 0.03;
  const maxZoom = 32;
  const defaultCamera = () => ({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2, scale: 1 });
  let camera = defaultCamera();
  let panStart = null;
  let windowSelect = null;
  let suppressNextCanvasClick = false;
  let hoveredId = null;
  let handleDrag = null;
  let dimensionLineDrag = null;
  let dimensionEdit = null;
  let shapeDrag = null;
  let suppressRecordClick = false;
  let drawingMode = false;
  let drawingDelegate = null;
  let featureCommandDelegate = null;
  let constraintOverlaySystem = null;
  let previewNode = null;
  let dimensionPreviewRecord = null;
  let smartDimensionDelegate = null;
  let solveFrame = null;
  let dimensionTextMode = 'named-value';
  let objectSnapEnabled = true;
  let autoConstrainEnabled = true;
  let objectSnapCandidate = null;
  const pendingSolveRecords = new Map();
  const selectedIds = new Set();
  const records = [];
  const objectChangeListeners = new Set();
  const selectionChangeListeners = new Set();
  let lastSelectionFingerprint = '';
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  const axisLayer = document.createElementNS(ns, 'g');
  const objectLayer = document.createElementNS(ns, 'g');
  const previewLayer = document.createElementNS(ns, 'g');
  const closedRegionNodes = new Set();
  const selectionBox = document.createElement('div');
  const dimensionEditPanel = document.createElement('div');

  selectionBox.className = 'selection-window';
  dimensionEditPanel.className = 'dimension-edit-panel';
  dimensionEditPanel.hidden = true;
  dimensionEditPanel.innerHTML = `
    <label class="dimension-edit-label">
      <span>Dimension</span>
      <input class="dimension-edit-input" list="dimensionEditParameterNames" autocomplete="off" spellcheck="false" />
    </label>
    <datalist id="dimensionEditParameterNames"></datalist>
    <p class="dimension-edit-error" role="alert" aria-live="polite"></p>
    <div class="dimension-edit-actions">
      <button type="button" class="dimension-edit-ok">OK</button>
      <button type="button" class="dimension-edit-cancel">Cancel</button>
    </div>
  `;
  canvas.appendChild(selectionBox);
  canvas.appendChild(dimensionEditPanel);
  svg.appendChild(g);
  g.append(axisLayer, objectLayer, previewLayer);

  const dimensionEditInput = dimensionEditPanel.querySelector('.dimension-edit-input');
  const dimensionEditOptions = dimensionEditPanel.querySelector('#dimensionEditParameterNames');
  const dimensionEditError = dimensionEditPanel.querySelector('.dimension-edit-error');
  const dimensionEditOk = dimensionEditPanel.querySelector('.dimension-edit-ok');
  const dimensionEditCancel = dimensionEditPanel.querySelector('.dimension-edit-cancel');

  const imageTools = createImageManipulation({
    addSvg: add,
    parent: objectLayer,
    screenToWorld,
    getScale: () => camera.scale,
    getDrawingUnit: () => solver.drawingUnit || 'in',
    evaluateNumeric: (expression) => solver.evaluateParameterExpression(expression),
    onSelect: selectOnly,
    onMoveStart: (event, record) => {
      if (event.button !== 0 || selectedIds.size < 2 || !selectedIds.has(record.id)) return false;
      event.preventDefault();
      event.stopPropagation();
      if (!record.entity.locked) beginRecordsDrag(event);
      record.group.setPointerCapture(event.pointerId);
      return true;
    },
    onChange: () => {
      syncGeometryStacking();
      syncState();
      notifyObjectChange();
    },
    onDelete: (id) => {
      selectOnly(id);
      deleteSelection();
    },
  });

  dimensionEditPanel.addEventListener('pointerdown', (event) => event.stopPropagation());
  dimensionEditPanel.addEventListener('click', (event) => event.stopPropagation());
  dimensionEditPanel.addEventListener('dblclick', (event) => event.stopPropagation());
  dimensionEditPanel.addEventListener('keydown', (event) => event.stopPropagation());
  dimensionEditOk.addEventListener('click', submitDimensionEditPanel);
  dimensionEditCancel.addEventListener('click', closeDimensionEditPanel);
  dimensionEditInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitDimensionEditPanel();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDimensionEditPanel();
    }
  });

  function add(parent, tag, attrs) {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    parent.appendChild(node);
    return node;
  }

  function midpoint(a, b) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }

  function pointList(points) {
    return points.map(([x, y]) => `${x},${y}`).join(' ');
  }

  function pathNumbers(d) {
    return d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  }

  function cloneEntity(entity) {
    return JSON.parse(JSON.stringify(entity));
  }

  function geometryAppearance(entity) {
    const strokeThickness = Number(entity.appearance?.strokeThickness);
    const rawZIndex = entity.appearance?.zIndex;
    const zIndex = Number(rawZIndex);
    const fillExpression = String(entity.appearance?.fillExpression ?? entity.appearance?.fillColor ?? '#ffffff');
    const fillOpacityExpression = String(entity.appearance?.fillOpacityExpression ?? ((entity.appearance?.fillOpacity ?? 1) * 100));
    const strokeOpacityExpression = String(entity.appearance?.strokeOpacityExpression ?? ((entity.appearance?.strokeOpacity ?? 1) * 100));
    let fillColor = /^#[0-9a-f]{6}$/i.test(entity.appearance?.fillColor || '') ? entity.appearance.fillColor : '#ffffff';
    let fillOpacity = Number.isFinite(Number(entity.appearance?.fillOpacity)) ? Number(entity.appearance.fillOpacity) : 1;
    let strokeOpacity = Number.isFinite(Number(entity.appearance?.strokeOpacity)) ? Number(entity.appearance.strokeOpacity) : 1;
    let fillError = null;
    let fillOpacityError = null;
    let strokeOpacityError = null;
    try { fillColor = resolveColorExpression(fillExpression, (expression) => solver.evaluateParameterExpression(expression)); } catch (error) { fillError = error.message; }
    try { fillOpacity = resolveOpacityExpression(fillOpacityExpression, (expression) => solver.evaluateParameterExpression(expression)); } catch (error) { fillOpacityError = error.message; }
    try { strokeOpacity = resolveOpacityExpression(strokeOpacityExpression, (expression) => solver.evaluateParameterExpression(expression)); } catch (error) { strokeOpacityError = error.message; }
    return {
      fillExpression,
      fillColor,
      fillOpacityExpression,
      fillOpacity: Math.min(1, Math.max(0, fillOpacity)),
      strokeOpacityExpression,
      strokeOpacity: Math.min(1, Math.max(0, strokeOpacity)),
      strokeThickness: Number.isFinite(strokeThickness) && strokeThickness > 0 ? strokeThickness : 1.5,
      zIndex: rawZIndex !== null && rawZIndex !== undefined && Number.isFinite(zIndex) ? zIndex : null,
      errors: { fill: fillError, fillOpacity: fillOpacityError, strokeOpacity: strokeOpacityError },
    };
  }

  function recordAppearance(record) {
    return record.recordType === 'image'
      ? imageAppearance(record.entity, (expression) => solver.evaluateParameterExpression(expression))
      : geometryAppearance(record.entity);
  }

  function editableStackOrder() {
    return records
      .map((record, originalIndex) => ({ record, originalIndex }))
      .filter(({ record }) => ['geometry', 'image'].includes(record.recordType) && !record.entity.construction)
      .sort((a, b) => {
        const aIndex = recordAppearance(a.record).zIndex;
        const bIndex = recordAppearance(b.record).zIndex;
        return (aIndex ?? a.originalIndex) - (bIndex ?? b.originalIndex) || a.originalIndex - b.originalIndex;
      })
      .map(({ record }) => record);
  }

  function syncGeometryStacking() {
    const editable = editableStackOrder();
    const construction = records.filter((record) => ['geometry', 'image'].includes(record.recordType) && record.entity.construction);
    const dimensions = records.filter((record) => record.recordType === 'dimension');
    const stackPositions = new Map(editable.map((record, index) => [record.id, index]));
    const regionsByPosition = new Map();
    closedRegionNodes.forEach((region) => {
      const positions = (region.dataset.parentIds || '').split(',').map((id) => stackPositions.get(id)).filter(Number.isFinite);
      const position = positions.length ? Math.min(...positions) : 0;
      if (!regionsByPosition.has(position)) regionsByPosition.set(position, []);
      regionsByPosition.get(position).push(region);
    });
    editable.forEach((record, index) => {
      (regionsByPosition.get(index) || []).forEach((region) => objectLayer.appendChild(region));
      objectLayer.appendChild(record.group);
    });
    [...construction, ...dimensions].forEach((record) => objectLayer.appendChild(record.group));
  }

  function isClosedGeometry(entity) {
    return ['circle', 'rect', 'polygon'].includes(entity.type);
  }

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return [(clientX - rect.left - camera.x) / camera.scale, (clientY - rect.top - camera.y) / camera.scale];
  }

  function worldToScreen(point) {
    return [point[0] * camera.scale + camera.x, point[1] * camera.scale + camera.y];
  }

  function circleFromThreePoints(a, b, c) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 0.0001) return null;
    const aa = a[0] ** 2 + a[1] ** 2;
    const bb = b[0] ** 2 + b[1] ** 2;
    const cc = c[0] ** 2 + c[1] ** 2;
    const center = [
      (aa * (b[1] - c[1]) + bb * (c[1] - a[1]) + cc * (a[1] - b[1])) / d,
      (aa * (c[0] - b[0]) + bb * (a[0] - c[0]) + cc * (b[0] - a[0])) / d,
    ];
    return { center, radius: Math.hypot(a[0] - center[0], a[1] - center[1]) };
  }

  function hasStoredArcCircle(entity) {
    return Array.isArray(entity.center)
      && entity.center.every(Number.isFinite)
      && Number.isFinite(entity.radius)
      && Math.abs(entity.radius) > 1e-8;
  }

  function arcCircle(entity) {
    if (hasStoredArcCircle(entity)) return { center: [...entity.center], radius: Math.abs(entity.radius) };
    return circleFromThreePoints(entity.start, entity.arcPoint, entity.end);
  }

  function refreshArcCircleMetadata(entity) {
    if (entity.type !== 'arc') return null;
    const circle = circleFromThreePoints(entity.start, entity.arcPoint, entity.end);
    if (!circle) return null;
    entity.center = circle.center;
    entity.radius = circle.radius;
    return circle;
  }

  function pointDistance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  function addPoints(a, b) {
    return [a[0] + b[0], a[1] + b[1]];
  }

  function subtractPoints(a, b) {
    return [a[0] - b[0], a[1] - b[1]];
  }

  function scalePoint(point, value) {
    return [point[0] * value, point[1] * value];
  }

  function pointLength(point) {
    return Math.hypot(point[0], point[1]);
  }

  function unitVector(point, fallback = [1, 0]) {
    const length = pointLength(point);
    return length > 0.0001 ? [point[0] / length, point[1] / length] : fallback;
  }

  const formatDrawingLength = (value) => formatUnitValue(value, solver.drawingUnit || 'in');

  function applyManagedDimensionText(entity) {
    if (!entity.dimensionId) return;
    const text = solver.getDimensionText(entity.dimensionId, dimensionTextMode);
    if (!text) return;
    entity.managedDimensionText = true;
    entity.text = text;
  }

  function syncDimensionPresentation(record) {
    const hideDriving = dimensionTextMode === 'value' && record.entity.dimensionMode === 'driving';
    record.group.style.display = hideDriving ? 'none' : '';
    record.group.setAttribute('aria-hidden', String(hideDriving));
  }

  function syncGeometryPresentation(record) {
    const hideConstruction = dimensionTextMode === 'value' && record.entity.construction === true;
    record.group.style.display = hideConstruction ? 'none' : '';
    record.group.setAttribute('aria-hidden', String(hideConstruction));
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
    if (!lengthSquared) return pointDistance(point, start);
    const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
    const projection = [start[0] + dx * t, start[1] + dy * t];
    return pointDistance(point, projection);
  }

  function arcPath(entity) {
    const circle = arcCircle(entity);
    if (!circle) return `M ${entity.start[0]} ${entity.start[1]} L ${entity.end[0]} ${entity.end[1]}`;
    const startAngle = Math.atan2(entity.start[1] - circle.center[1], entity.start[0] - circle.center[0]);
    const midAngle = Math.atan2(entity.arcPoint[1] - circle.center[1], entity.arcPoint[0] - circle.center[0]);
    const endAngle = Math.atan2(entity.end[1] - circle.center[1], entity.end[0] - circle.center[0]);
    const tau = Math.PI * 2;
    const normalize = (angle) => (angle + tau) % tau;
    const ccwSpan = normalize(endAngle - startAngle);
    const midOnCcw = normalize(midAngle - startAngle) <= ccwSpan;
    const span = midOnCcw ? ccwSpan : tau - ccwSpan;
    const largeArc = span > Math.PI ? 1 : 0;
    const sweep = midOnCcw ? 1 : 0;
    return `M ${entity.start[0]} ${entity.start[1]} A ${circle.radius} ${circle.radius} 0 ${largeArc} ${sweep} ${entity.end[0]} ${entity.end[1]}`;
  }

  function arcMidpoint(entity) {
    const circle = arcCircle(entity);
    if (!circle) return midpoint(entity.start, entity.end);
    const startAngle = Math.atan2(entity.start[1] - circle.center[1], entity.start[0] - circle.center[0]);
    const midAngle = Math.atan2(entity.arcPoint[1] - circle.center[1], entity.arcPoint[0] - circle.center[0]);
    const endAngle = Math.atan2(entity.end[1] - circle.center[1], entity.end[0] - circle.center[0]);
    const tau = Math.PI * 2;
    const normalize = (angle) => (angle + tau) % tau;
    const ccwSpan = normalize(endAngle - startAngle);
    const midOnCcw = normalize(midAngle - startAngle) <= ccwSpan;
    const span = midOnCcw ? ccwSpan : -(tau - ccwSpan);
    const angle = startAngle + span / 2;
    return [circle.center[0] + Math.cos(angle) * circle.radius, circle.center[1] + Math.sin(angle) * circle.radius];
  }

  function arcAngleDetails(entity) {
    const circle = arcCircle(entity);
    if (!circle) return null;
    const startAngle = Math.atan2(entity.start[1] - circle.center[1], entity.start[0] - circle.center[0]);
    const midAngle = Math.atan2(entity.arcPoint[1] - circle.center[1], entity.arcPoint[0] - circle.center[0]);
    const endAngle = Math.atan2(entity.end[1] - circle.center[1], entity.end[0] - circle.center[0]);
    const tau = Math.PI * 2;
    const normalize = (angle) => (angle + tau) % tau;
    const ccwSpan = normalize(endAngle - startAngle);
    const midOnCcw = normalize(midAngle - startAngle) <= ccwSpan;
    return { circle, startAngle, ccwSpan, midOnCcw, normalize };
  }

  function arcContainsAngle(details, angle) {
    const relative = details.normalize(angle - details.startAngle);
    const epsilon = 0.000001;
    return details.midOnCcw ? relative <= details.ccwSpan + epsilon : relative >= details.ccwSpan - epsilon;
  }

  function arcQuadrants(entity) {
    const details = arcAngleDetails(entity);
    if (!details) return [];
    return [0, Math.PI / 2, Math.PI, Math.PI * 1.5]
      .filter((angle) => arcContainsAngle(details, angle))
      .map((angle) => [
        details.circle.center[0] + Math.cos(angle) * details.circle.radius,
        details.circle.center[1] + Math.sin(angle) * details.circle.radius,
      ]);
  }

  function curvePath(points) {
    if (points.length < 2) return '';
    if (points.length === 2) return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
    const controlPoint = (current, previous, next, tension = 0.18) => [
      current[0] + (next[0] - previous[0]) * tension,
      current[1] + (next[1] - previous[1]) * tension,
    ];
    return points.slice(1).reduce((path, point, index) => {
      const currentIndex = index + 1;
      const previous = points[Math.max(0, currentIndex - 2)];
      const current = points[currentIndex - 1];
      const next = point;
      const after = points[Math.min(points.length - 1, currentIndex + 1)];
      const c1 = controlPoint(current, previous, next);
      const c2 = controlPoint(next, after, current);
      return `${path} C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${point[0]} ${point[1]}`;
    }, `M ${points[0][0]} ${points[0][1]}`);
  }

  function boundaryEndpoints(entity) {
    if (entity.type === 'line' || entity.type === 'arc') return [entity.start, entity.end];
    if (entity.type === 'polyline' || entity.type === 'curve') return [entity.points[0], entity.points[entity.points.length - 1]];
    return null;
  }

  function pathWithoutMove(path, start) {
    const prefix = `M ${start[0]} ${start[1]}`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
  }

  function boundaryPathPart(entity, reversed) {
    if (entity.type === 'line') {
      const target = reversed ? entity.start : entity.end;
      return `L ${target[0]} ${target[1]}`;
    }
    if (entity.type === 'polyline') {
      const points = reversed ? [...entity.points].reverse() : entity.points;
      return points.slice(1).map((point) => `L ${point[0]} ${point[1]}`).join(' ');
    }
    if (entity.type === 'curve') {
      const points = reversed ? [...entity.points].reverse() : entity.points;
      return pathWithoutMove(curvePath(points), points[0]);
    }
    if (entity.type === 'arc') {
      const oriented = reversed ? { ...entity, start: entity.end, end: entity.start } : entity;
      return pathWithoutMove(arcPath(oriented), oriented.start);
    }
    return '';
  }

  function renderClosedRegions() {
    closedRegionNodes.forEach((region) => region.remove());
    closedRegionNodes.clear();
    const geometryRecords = records.filter((record) => record.recordType === 'geometry');
    const byId = new Map(geometryRecords.map((record) => [record.id, record.entity]));
    const stackPositions = new Map(editableStackOrder().map((record, index) => [record.id, index]));
    const cycles = findClosedGeometryCycles(geometryRecords.map((record) => record.entity), solver.constraints())
      .sort((a, b) => (
        Math.max(...a.map(({ entityId }) => stackPositions.get(entityId) ?? -1))
        - Math.max(...b.map(({ entityId }) => stackPositions.get(entityId) ?? -1))
      ));
    cycles.forEach((cycle, index) => {
      const firstEntity = byId.get(cycle[0]?.entityId);
      const endpoints = firstEntity && boundaryEndpoints(firstEntity);
      if (!endpoints) return;
      const start = cycle[0].reversed ? endpoints[1] : endpoints[0];
      const parts = cycle.map(({ entityId, reversed }) => {
        const entity = byId.get(entityId);
        return entity ? boundaryPathPart(entity, reversed) : '';
      });
      const parentIds = [...new Set(cycle.map(({ entityId }) => entityId))];
      const regionAppearance = geometryAppearance(byId.get(parentIds[0]) || {});
      const fillColor = regionAppearance.fillColor;
      const region = add(objectLayer, 'path', {
        d: `M ${start[0]} ${start[1]} ${parts.join(' ')} Z`,
        class: 'closed-constrained-region',
        'data-region-index': index,
        'data-parent-ids': parentIds.join(','),
        fill: fillColor,
        'fill-opacity': regionAppearance.fillOpacity,
        role: 'button',
        'aria-label': `Select filled shape with ${parentIds.length} object${parentIds.length === 1 ? '' : 's'}`,
      });
      closedRegionNodes.add(region);
      region.style.setProperty('--region-fill', fillColor);
      region.classList.toggle('selected', parentIds.every((id) => selectedIds.has(id)));
      region.addEventListener('pointerdown', (event) => {
        startRegionDrag(event, parentIds);
      });
      region.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (suppressRecordClick) {
          suppressRecordClick = false;
          return;
        }
        selectRecords(parentIds);
      });
    });
    syncGeometryStacking();
  }

  function legacyPathToCurve(entity) {
    const values = pathNumbers(entity.d);
    if (values.length >= 8) return { type: 'curve', points: [[values[0], values[1]], [values[2], values[3]], [values[4], values[5]], [values[6], values[7]]] };
    if (values.length >= 4) return { type: 'polyline', points: [[values[0], values[1]], [values[values.length - 2], values[values.length - 1]]] };
    return { type: 'polyline', points: [] };
  }

  function normalizeEntity(entity) {
    if (entity.type === 'path') return legacyPathToCurve(entity);
    return cloneEntity(entity);
  }

  function recordHandles(entity) {
    if (entity.type === 'line') return [entity.start, midpoint(entity.start, entity.end), entity.end];
    if (entity.type === 'circle') {
      const [cx, cy] = entity.center;
      const r = entity.radius;
      return [[cx, cy], [cx - r, cy], [cx, cy - r], [cx + r, cy], [cx, cy + r]];
    }
    if (entity.type === 'rect') {
      const x1 = entity.x;
      const y1 = entity.y;
      const x2 = entity.x + entity.width;
      const y2 = entity.y + entity.height;
      return [[x1, y1], midpoint([x1, y1], [x2, y1]), [x2, y1], midpoint([x2, y1], [x2, y2]), [x2, y2], midpoint([x2, y2], [x1, y2]), [x1, y2], midpoint([x1, y2], [x1, y1])];
    }
    if (entity.type === 'polygon' || entity.type === 'polyline' || entity.type === 'curve') return entity.points;
    if (entity.type === 'arc') {
      const circle = arcCircle(entity);
      return circle ? [entity.start, arcMidpoint(entity), entity.end, circle.center] : [entity.start, arcMidpoint(entity), entity.end];
    }
    if (isDimensionEntity(entity)) return dimensionHandles(entity, camera.scale);
    return [];
  }

  function recordSegments(entity) {
    if (entity.type === 'line') return [{ start: entity.start, end: entity.end, index: 0 }];
    if (entity.type === 'rect') {
      const x1 = entity.x;
      const y1 = entity.y;
      const x2 = entity.x + entity.width;
      const y2 = entity.y + entity.height;
      const points = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      return points.map((point, index) => ({ start: point, end: points[(index + 1) % points.length], index }));
    }
    if (entity.type === 'polyline' || entity.type === 'polygon') {
      const limit = entity.type === 'polygon' ? entity.points.length : entity.points.length - 1;
      return Array.from({ length: Math.max(0, limit) }, (_, index) => ({
        start: entity.points[index],
        end: entity.points[(index + 1) % entity.points.length],
        index,
      }));
    }
    return [];
  }

  function recordSnapPoints(record) {
    if (record.recordType !== 'geometry') return [];
    const snapPoints = recordHandles(record.entity).map((point, index) => ({ point: [...point], kind: 'handle', index }));
    recordSegments(record.entity).forEach((segment) => {
      snapPoints.push({ point: midpoint(segment.start, segment.end), kind: 'midpoint', index: segment.index });
    });
    if (record.entity.type === 'arc') {
      arcQuadrants(record.entity).forEach((point, index) => snapPoints.push({ point, kind: 'quadrant', index }));
    }
    return snapPoints.reduce((unique, candidate) => {
      const key = `${candidate.point[0].toFixed(4)},${candidate.point[1].toFixed(4)}`;
      if (!unique.keys.has(key)) {
        unique.keys.add(key);
        unique.points.push(candidate);
      }
      return unique;
    }, { keys: new Set(), points: [] }).points;
  }

  function nearestSnapPoint(world, screenTolerance = 12) {
    const tolerance = screenTolerance / camera.scale;
    return records.reduce((best, record) => {
      if (record.recordType !== 'geometry' || record.group.style.display === 'none') return best;
      return recordSnapPoints(record).reduce((innerBest, candidate) => {
        const distance = pointDistance(world, candidate.point);
        if (distance > tolerance || (innerBest && distance >= innerBest.distance)) return innerBest;
        return {
          ...candidate,
          point: [...candidate.point],
          distance,
          recordId: record.id,
          entityType: record.entity.type,
        };
      }, best);
    }, null);
  }

  function nearestObjectPoint(world, screenTolerance = 14) {
    if (!objectSnapEnabled) return null;
    const tolerance = screenTolerance / camera.scale;
    return records.reduce((best, record) => {
      if (record.recordType !== 'geometry' || record.group.style.display === 'none') return best;
      return recordHandles(record.entity).reduce((innerBest, point, index) => {
        const distance = pointDistance(world, point);
        if (distance > tolerance || (innerBest && distance >= innerBest.distance)) return innerBest;
        return { kind: 'point', recordId: record.id, entityType: record.entity.type, index, point: [...point], distance };
      }, best);
    }, null);
  }

  function setObjectSnapCandidate(candidate) {
    objectLayer.querySelectorAll('.object-snap-target').forEach((handle) => handle.classList.remove('object-snap-target'));
    objectSnapCandidate = candidate || null;
    if (!objectSnapCandidate) return;
    const record = records.find((item) => item.recordType === 'geometry' && item.id === objectSnapCandidate.recordId);
    record?.handles?.[objectSnapCandidate.index]?.classList.add('object-snap-target');
  }

  function createGeometryNode(parent, entity, className = 'selectable-entity') {
    const geometryClass = (closed = false, accent = false) => [
      entity.construction ? 'construction' : 'entity',
      closed && !entity.construction ? 'closed-entity' : '',
      accent && !entity.construction ? 'accent' : '',
      className,
    ].filter(Boolean).join(' ');
    if (entity.type === 'line') return add(parent, 'line', { x1: entity.start[0], y1: entity.start[1], x2: entity.end[0], y2: entity.end[1], class: geometryClass() });
    if (entity.type === 'circle') return add(parent, 'circle', { cx: entity.center[0], cy: entity.center[1], r: entity.radius, class: geometryClass(true) });
    if (entity.type === 'rect') return add(parent, 'rect', { x: entity.x, y: entity.y, width: entity.width, height: entity.height, rx: 18, class: geometryClass(true) });
    if (entity.type === 'polygon') return add(parent, 'polygon', { points: pointList(entity.points), class: geometryClass(true) });
    if (entity.type === 'polyline') return add(parent, 'polyline', { points: pointList(entity.points), class: geometryClass(), fill: 'none' });
    if (entity.type === 'curve') return add(parent, 'path', { d: curvePath(entity.points), class: geometryClass(false, true), fill: 'none' });
    if (entity.type === 'arc') return add(parent, 'path', { d: arcPath(entity), class: geometryClass(false, true), fill: 'none' });
    return null;
  }

  function updateGeometryNode(record) {
    const entity = record.entity;
    const nodes = [record.node, record.hitNode].filter(Boolean);
    if (entity.type === 'line') {
      nodes.forEach((node) => {
        node.setAttribute('x1', entity.start[0]);
        node.setAttribute('y1', entity.start[1]);
        node.setAttribute('x2', entity.end[0]);
        node.setAttribute('y2', entity.end[1]);
      });
    }
    if (entity.type === 'circle') {
      nodes.forEach((node) => {
        node.setAttribute('cx', entity.center[0]);
        node.setAttribute('cy', entity.center[1]);
        node.setAttribute('r', entity.radius);
      });
    }
    if (entity.type === 'rect') {
      nodes.forEach((node) => {
        node.setAttribute('x', entity.x);
        node.setAttribute('y', entity.y);
        node.setAttribute('width', entity.width);
        node.setAttribute('height', entity.height);
      });
    }
    if (entity.type === 'polygon' || entity.type === 'polyline') nodes.forEach((node) => node.setAttribute('points', pointList(entity.points)));
    if (entity.type === 'curve') nodes.forEach((node) => node.setAttribute('d', curvePath(entity.points)));
    if (entity.type === 'arc') nodes.forEach((node) => node.setAttribute('d', arcPath(entity)));
    syncGeometryClasses(record);
    applyGeometryAppearance(record);
    updateSegmentNodes(record);
  }

  function applyGeometryAppearance(record) {
    if (!record?.node) return;
    if (record.entity.construction) {
      ['stroke-width', 'stroke-opacity', 'fill', 'fill-opacity'].forEach((attribute) => record.node.removeAttribute(attribute));
      ['strokeWidth', 'strokeOpacity', 'fill', 'fillOpacity'].forEach((property) => { record.node.style[property] = ''; });
      record.node.style.removeProperty('--entity-fill');
      return;
    }
    const appearance = geometryAppearance(record.entity);
    record.node.setAttribute('stroke-width', appearance.strokeThickness);
    record.node.setAttribute('stroke-opacity', appearance.strokeOpacity);
    record.node.style.strokeWidth = `${appearance.strokeThickness}px`;
    record.node.style.strokeOpacity = String(appearance.strokeOpacity);
    if (isClosedGeometry(record.entity)) {
      record.node.style.setProperty('--entity-fill', appearance.fillColor);
      record.node.setAttribute('fill', appearance.fillColor);
      record.node.setAttribute('fill-opacity', appearance.fillOpacity);
      record.node.style.setProperty('fill', appearance.fillColor, 'important');
      record.node.style.fillOpacity = String(appearance.fillOpacity);
    }
  }

  function syncGeometryClasses(record) {
    if (record.recordType !== 'geometry') return;
    const isConstruction = record.entity.construction === true;
    [record.node, record.hitNode].filter(Boolean).forEach((node) => {
      node.classList.toggle('construction', isConstruction);
      node.classList.toggle('entity', !isConstruction);
      node.classList.toggle('closed-entity', isClosedGeometry(record.entity) && !isConstruction);
      node.classList.toggle('accent', ['arc', 'curve'].includes(record.entity.type) && !isConstruction);
    });
  }

  function updateSegmentNodes(record) {
    if (!record.segmentGroup) return;
    record.segmentGroup.replaceChildren();
    record.segmentNodes = recordSegments(record.entity).map((segment) => {
      const node = add(record.segmentGroup, 'line', {
        x1: segment.start[0],
        y1: segment.start[1],
        x2: segment.end[0],
        y2: segment.end[1],
        class: 'segment-select-line selectable-entity',
        'data-segment-index': segment.index,
      });
      return node;
    });
  }

  function updateRecordNode(record) {
    if (record.recordType === 'dimension') updateDimensionNode(record, camera.scale);
    else updateGeometryNode(record);
  }

  function updateRecordHandles(record) {
    record.handles.forEach((handle) => handle.remove());
    record.handles = recordHandles(record.entity).map(([cx, cy], index) => {
      const handle = add(record.handleGroup, 'circle', { cx, cy, r: 6, class: 'point-handle', 'data-handle-index': index });
      handle.addEventListener('pointerdown', (event) => startHandleDrag(event, record, index));
      return handle;
    });
    syncScreenInvariantSizing();
  }

  function createGeometryRecord(inputEntity, index = records.length) {
    const entity = normalizeEntity(inputEntity);
    const group = add(objectLayer, 'g', { class: 'canvas-record entity-record geometry-record', 'data-record-id': entity.id, 'data-entity-type': entity.type });
    const node = createGeometryNode(group, entity);
    if (!node) {
      group.remove();
      return null;
    }
    const hitNode = createGeometryNode(group, entity, 'selectable-entity hit-target');
    const segmentGroup = add(group, 'g', { class: 'segment-selection-layer' });
    const handleGroup = add(group, 'g', { class: 'handle-group' });
    const record = { id: group.dataset.recordId, recordType: 'geometry', entity, group, node, hitNode, segmentGroup, segmentNodes: [], handleGroup, handles: [] };
    updateSegmentNodes(record);
    updateRecordHandles(record);
    bindRecordEvents(record);
    syncGeometryClasses(record);
    applyGeometryAppearance(record);
    syncGeometryPresentation(record);
    return record;
  }

  function bindRecordEvents(record) {
    const handlePointerDown = (event) => {
      event.stopPropagation();
      if (drawingMode || smartDimensionDelegate || featureCommandDelegate) return;
      if (
        event.button === 0
        && record.recordType === 'dimension'
        && record.entity.dimensionMode === 'driving'
        && record.entity.dimensionId
        && event.target.closest?.('.dimension-text')
      ) {
        event.preventDefault();
        selectOnly(record.id);
        return;
      }
      if (
        event.button === 0
        && record.recordType === 'dimension'
        && ['dimension-line', 'angle-dimension', 'radius-dimension', 'multi-curve-length-dimension'].includes(record.entity.type)
        && event.target.closest?.('.dimension-path')
      ) {
        startDimensionLineDrag(event, record);
        return;
      }
      if (event.target.dataset?.segmentIndex !== undefined && startSegmentDrag(event, record)) return;
      if (record.recordType === 'geometry') startObjectDrag(event, record);
    };
    const handleClick = (event) => {
      event.stopPropagation();
      if (suppressRecordClick) {
        suppressRecordClick = false;
        return;
      }
      selectOnly(record.id);
    };
    record.group.addEventListener('pointerdown', handlePointerDown);
    record.group.addEventListener('click', handleClick);
    record.group.querySelectorAll('.selectable-entity').forEach((node) => {
      node.addEventListener('pointerdown', handlePointerDown);
      node.addEventListener('click', handleClick);
    });
    if (record.recordType === 'dimension' && record.entity.dimensionMode === 'driving' && record.entity.dimensionId) {
      record.text.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDimensionEditPanel(record);
      });
    }
  }

  function addObject(entity, { snapRefs = [] } = {}) {
    const existingEntities = records
      .filter((record) => record.recordType === 'geometry' && record.group.style.display !== 'none')
      .map((record) => cloneEntity(record.entity));
    const modelEntity = solver.addEntity(entity);
    const record = createGeometryRecord(modelEntity);
    if (!record) return null;
    records.push(record);
    if (autoConstrainEnabled) {
      let solvedSnapshot = null;
      detectAutoConstraints({
        entity: modelEntity,
        recordId: modelEntity.id,
        snapRefs,
        existingEntities,
        worldTolerance: 14 / camera.scale,
      }).forEach((constraint) => {
        const outcome = solver.addConstraint(constraint);
        if (outcome.constraint) solvedSnapshot = outcome.snapshot;
      });
      if (solvedSnapshot) applySolverSnapshot(solvedSnapshot);
    }
    syncGeometryStacking();
    selectOnly(record.id);
    setObjectSnapCandidate(null);
    notifyObjectChange();
    return record;
  }

  function addImage(inputEntity) {
    const record = imageTools.createRecord(normalizeImageEntity(inputEntity));
    records.push(record);
    syncGeometryStacking();
    selectOnly(record.id);
    notifyObjectChange();
    return record;
  }

  function addDimension(entity) {
    const dimensionResult = solver.addDimension(entity);
    applyManagedDimensionText(dimensionResult.entity);
    const record = createDimensionRecord({
      add,
      objectLayer,
      entity: cloneEntity(dimensionResult.entity),
      index: records.length,
      scale: camera.scale,
      updateRecordHandles,
      bindRecordEvents,
    });
    syncDimensionPresentation(record);
    records.push(record);
    applySolverSnapshot();
    selectOnly(record.id);
    notifyObjectChange();
    return record;
  }

  function notifyObjectChange() {
    records.filter((record) => record.recordType === 'geometry').forEach(applyGeometryAppearance);
    renderClosedRegions();
    syncState();
    objectChangeListeners.forEach((listener) => listener(records.length));
  }

  function setPreview(entity) {
    clearPreview();
    previewNode = createGeometryNode(previewLayer, entity, 'preview-entity');
  }

  function clearPreview() {
    if (previewNode) {
      previewNode.remove();
      previewNode = null;
    }
    if (dimensionPreviewRecord) {
      dimensionPreviewRecord.group.remove();
      dimensionPreviewRecord = null;
    }
  }

  function setDimensionPreview(entity) {
    if (dimensionPreviewRecord) dimensionPreviewRecord.group.remove();
    dimensionPreviewRecord = createDimensionRecord({
      add,
      objectLayer: previewLayer,
      entity: cloneEntity(entity),
      index: 'preview',
      scale: camera.scale,
      updateRecordHandles: () => {},
      bindRecordEvents: () => {},
    });
    dimensionPreviewRecord.group.classList.add('smart-dimension-preview');
  }

  function setSmartDimensionFeatureSelection(features) {
    objectLayer.querySelectorAll('.smart-selected').forEach((node) => {
      node.classList.remove('smart-selected');
      if (node.classList.contains('point-handle') && !node.classList.contains('selected')) setHandleHighlight(node, false);
      if (node.classList.contains('segment-select-line')) setSegmentHighlight(node, false);
    });
    features.forEach((feature) => {
      feature.node?.classList?.add('smart-selected');
      if (feature.node?.classList?.contains('point-handle')) setHandleHighlight(feature.node, true);
      if (feature.node?.classList?.contains('segment-select-line')) setSegmentHighlight(feature.node, true);
    });
  }

  function nearestSegmentFeature(record, world, sourceNode = null) {
    const segments = recordSegments(record.entity);
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

  function segmentFeatureFromRecord(record, index = 0) {
    const segments = recordSegments(record.entity);
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

  function entityFeatureFromRecord(record) {
    if (!record || record.recordType !== 'geometry') return null;
    if (record.entity.type === 'circle') {
      return { kind: 'circle', recordId: record.id, center: [...record.entity.center], radius: record.entity.radius, node: record.node };
    }
    if (record.entity.type === 'arc') {
      const circle = arcCircle(record.entity);
      if (!circle) return null;
      return {
        kind: 'arc',
        recordId: record.id,
        center: circle.center,
        radius: circle.radius,
        start: [...record.entity.start],
        arcPoint: [...record.entity.arcPoint],
        end: [...record.entity.end],
        node: record.node,
      };
    }
    return null;
  }

  function featureFromEvent(event) {
    const recordElement = event.target.closest?.('.canvas-record');
    if (!recordElement) return null;
    const record = records.find((item) => item.id === recordElement.dataset.recordId);
    if (!record || record.recordType !== 'geometry') return null;
    const world = screenToWorld(event.clientX, event.clientY);
    if (event.target.classList?.contains('point-handle')) {
      const index = Number(event.target.dataset.handleIndex);
      const point = recordHandles(record.entity)[index];
      return point ? { kind: 'point', recordId: record.id, entityType: record.entity.type, index, point: [...point], node: event.target } : null;
    }
    if (event.target.dataset?.segmentIndex !== undefined) return nearestSegmentFeature(record, world, event.target);
    if (record.entity.type === 'line') return { ...nearestSegmentFeature(record, world, record.node), node: event.target };
    if (record.entity.type === 'rect' || record.entity.type === 'polyline' || record.entity.type === 'polygon') return nearestSegmentFeature(record, world, event.target);
    if (record.entity.type === 'circle') {
      return { kind: 'circle', recordId: record.id, center: [...record.entity.center], radius: record.entity.radius, node: event.target };
    }
    if (record.entity.type === 'arc') {
      const circle = arcCircle(record.entity);
      if (!circle) return null;
      return { kind: 'arc', recordId: record.id, center: circle.center, radius: circle.radius, start: [...record.entity.start], arcPoint: [...record.entity.arcPoint], end: [...record.entity.end], node: event.target };
    }
    if (record.entity.type === 'curve') {
      return { kind: 'curve', recordId: record.id, points: record.entity.points.map((point) => [...point]), node: event.target };
    }
    return null;
  }

  function syncState() {
    records.forEach((record) => {
      const isSelected = selectedIds.has(record.id);
      record.group.classList.toggle('selected', isSelected);
      record.group.classList.toggle('hovered', hoveredId === record.id);
      if (record.recordType === 'image') {
        imageTools.syncRecord(record, isSelected);
        return;
      }
      record.group.querySelectorAll('.selectable-entity').forEach((node) => {
        node.classList.toggle('selected', isSelected);
        node.classList.toggle('hovered', hoveredId === record.id);
      });
      record.handles.forEach((handle) => {
        handle.classList.toggle('selected', isSelected);
        setHandleHighlight(handle, isSelected || handle.classList.contains('smart-selected'));
      });
    });
    objectLayer.querySelectorAll('.closed-constrained-region').forEach((region) => {
      const parentIds = (region.dataset.parentIds || '').split(',').filter(Boolean);
      region.classList.toggle('selected', parentIds.length > 0 && parentIds.every((id) => selectedIds.has(id)));
    });
    emitSelectionChange();
    positionDimensionEditPanel();
  }

  function dimensionParameterOptions(excludeId = null) {
    return solver.parameters()
      .filter((entry) => entry.name && entry.id !== excludeId && !entry.error)
      .map((entry) => ({
        name: entry.name,
        label: entry.kind === 'dimension' ? `${entry.name} (dimension)` : entry.name,
      }));
  }

  function positionDimensionEditPanel() {
    if (!dimensionEdit || dimensionEditPanel.hidden) return;
    const label = dimensionEdit.record?.entity?.label;
    if (!label) return;
    const [screenX, screenY] = worldToScreen(label);
    const padding = 8;
    const panelWidth = dimensionEditPanel.offsetWidth || 260;
    const panelHeight = dimensionEditPanel.offsetHeight || 92;
    const fitsRight = screenX + 14 + panelWidth <= canvas.clientWidth - padding;
    const rawLeft = fitsRight ? screenX + 14 : screenX - panelWidth - 14;
    const left = Math.max(padding, Math.min(canvas.clientWidth - panelWidth - padding, rawLeft));
    const top = Math.max(padding, Math.min(canvas.clientHeight - panelHeight - padding, screenY - panelHeight / 2));
    dimensionEditPanel.style.left = `${left}px`;
    dimensionEditPanel.style.top = `${top}px`;
  }

  function closeDimensionEditPanel() {
    dimensionEdit = null;
    dimensionEditPanel.hidden = true;
    dimensionEditPanel.classList.remove('invalid');
    dimensionEditInput.value = '';
    dimensionEditError.textContent = '';
  }

  function openDimensionEditPanel(record) {
    if (!record || record.recordType !== 'dimension' || record.entity.dimensionMode !== 'driving' || !record.entity.dimensionId) return;
    const current = solver.dimensions.get(record.entity.dimensionId);
    if (!current) return;
    selectOnly(record.id);
    dimensionEdit = { record, dimensionId: record.entity.dimensionId };
    dimensionEditOptions.replaceChildren(...dimensionParameterOptions(record.entity.dimensionId).map((entry) => {
      const option = document.createElement('option');
      option.value = entry.name;
      option.label = entry.label;
      return option;
    }));
    dimensionEditInput.value = current.expression || '';
    dimensionEditError.textContent = '';
    dimensionEditPanel.classList.remove('invalid');
    dimensionEditPanel.hidden = false;
    positionDimensionEditPanel();
    requestAnimationFrame(() => {
      positionDimensionEditPanel();
      dimensionEditInput.focus();
      dimensionEditInput.select();
    });
  }

  function submitDimensionEditPanel() {
    if (!dimensionEdit) return;
    const current = solver.dimensions.get(dimensionEdit.dimensionId);
    const expression = dimensionEditInput.value.trim();
    if (!expression) {
      dimensionEditPanel.classList.add('invalid');
      dimensionEditError.textContent = 'Enter a value, expression, or parameter name.';
      return;
    }
    if (expression === current?.expression) {
      closeDimensionEditPanel();
      return;
    }
    const result = solver.setDimension(dimensionEdit.dimensionId, expression);
    if (result.status === 'converged' || result.status === 'unchanged') {
      applySolverSnapshot();
      const record = dimensionEdit.record;
      applyManagedDimensionText(record.entity);
      record.text.textContent = record.entity.text;
      updateDimensionNode(record, camera.scale);
      closeDimensionEditPanel();
      notifyObjectChange();
      return;
    }
    dimensionEditPanel.classList.add('invalid');
    dimensionEditError.textContent = result.message || 'Dimension could not be applied.';
  }

  function selectionProperties() {
    const allSelectedGeometry = records.filter((record) => (
      selectedIds.has(record.id)
      && record.recordType === 'geometry'
    ));
    const allSelectedImages = records.filter((record) => selectedIds.has(record.id) && record.recordType === 'image');
    const selectedGeometry = allSelectedGeometry.filter((record) => !record.entity.construction);
    const selectedImages = allSelectedImages.filter((record) => !record.entity.construction);
    const geometryAppearances = selectedGeometry.map((record) => geometryAppearance(record.entity));
    const imageAppearances = selectedImages.map((record) => imageAppearance(record.entity, (expression) => solver.evaluateParameterExpression(expression)));
    const opacityAppearances = [...geometryAppearances, ...imageAppearances];
    const fillColors = new Set(geometryAppearances.map(({ fillColor }) => fillColor.toLowerCase()));
    const fillExpressions = new Set(geometryAppearances.map(({ fillExpression }) => fillExpression));
    const fillOpacityExpressions = new Set(opacityAppearances.map(({ fillOpacityExpression }) => fillOpacityExpression));
    const fillOpacities = new Set(opacityAppearances.map(({ fillOpacity }) => fillOpacity));
    const strokeOpacityExpressions = new Set(geometryAppearances.map(({ strokeOpacityExpression }) => strokeOpacityExpression));
    const strokeOpacities = new Set(geometryAppearances.map(({ strokeOpacity }) => strokeOpacity));
    const strokeThicknesses = new Set(geometryAppearances.map(({ strokeThickness }) => strokeThickness));
    const allSelectedObjects = [...allSelectedGeometry, ...allSelectedImages];
    const constructionCount = allSelectedObjects.filter((record) => record.entity.construction).length;
    return {
      selectionCount: selectedIds.size,
      geometryCount: allSelectedGeometry.length,
      imageCount: allSelectedImages.length,
      supportedCount: selectedGeometry.length + selectedImages.length,
      ids: [...selectedGeometry, ...selectedImages].map((record) => record.id),
      fillColor: fillColors.size === 1 ? geometryAppearances[0].fillColor : null,
      fillExpression: fillExpressions.size === 1 ? geometryAppearances[0].fillExpression : null,
      fillOpacityExpression: fillOpacityExpressions.size === 1 ? opacityAppearances[0].fillOpacityExpression : null,
      fillOpacity: fillOpacities.size === 1 ? opacityAppearances[0].fillOpacity : null,
      strokeOpacityExpression: strokeOpacityExpressions.size === 1 ? geometryAppearances[0].strokeOpacityExpression : null,
      strokeOpacity: strokeOpacities.size === 1 ? geometryAppearances[0].strokeOpacity : null,
      strokeThickness: strokeThicknesses.size === 1 ? geometryAppearances[0].strokeThickness : null,
      construction: allSelectedObjects.length > 0 && constructionCount === allSelectedObjects.length,
      mixedConstruction: constructionCount > 0 && constructionCount < allSelectedObjects.length,
      canEditFill: selectedGeometry.length > 0,
      canEditStroke: selectedGeometry.length > 0,
      canEditOpacity: selectedGeometry.length + selectedImages.length > 0,
      canEditConstruction: allSelectedGeometry.length > 0 && allSelectedImages.length === 0,
      locked: allSelectedImages.length > 0 && allSelectedImages.every((record) => record.entity.locked),
      errors: {
        fill: geometryAppearances.find(({ errors }) => errors.fill)?.errors.fill || null,
        fillOpacity: geometryAppearances.find(({ errors }) => errors.fillOpacity)?.errors.fillOpacity || imageAppearances.find(({ error }) => error)?.error || null,
        strokeOpacity: geometryAppearances.find(({ errors }) => errors.strokeOpacity)?.errors.strokeOpacity || null,
      },
      mixedFill: fillExpressions.size > 1,
      mixedFillOpacity: fillOpacityExpressions.size > 1,
      mixedStrokeOpacity: strokeOpacityExpressions.size > 1,
      mixedStroke: strokeThicknesses.size > 1,
    };
  }

  function emitSelectionChange() {
    const properties = selectionProperties();
    const fingerprint = JSON.stringify(properties);
    if (fingerprint === lastSelectionFingerprint) return;
    lastSelectionFingerprint = fingerprint;
    selectionChangeListeners.forEach((listener) => listener(cloneEntity(properties)));
  }

  function setHandleHighlight(handle, value) {
    handle.style.stroke = value ? '#38bdf8' : '';
    handle.style.filter = value ? 'drop-shadow(0 0 4px rgba(56,189,248,.3))' : '';
    handle.style.fill = value ? 'transparent' : '';
    if (value) {
      handle.setAttribute('stroke', '#38bdf8');
      handle.setAttribute('fill', 'transparent');
    } else {
      handle.removeAttribute('stroke');
      handle.removeAttribute('fill');
    }
  }

  function setSegmentHighlight(segment, value) {
    if (value) {
      segment.setAttribute('stroke', 'rgba(56,189,248,.58)');
      segment.setAttribute('stroke-width', '1.5');
      segment.style.stroke = 'rgba(56,189,248,.58)';
      segment.style.strokeWidth = '1.5px';
      segment.style.filter = 'drop-shadow(0 .75px 0 rgba(56,189,248,.22)) drop-shadow(0 -.75px 0 rgba(56,189,248,.22))';
    } else {
      segment.removeAttribute('stroke');
      segment.removeAttribute('stroke-width');
      segment.style.stroke = '';
      segment.style.strokeWidth = '';
      segment.style.filter = '';
    }
  }

  function selectOnly(id) {
    if (dimensionEdit && dimensionEdit.record.id !== id) closeDimensionEditPanel();
    selectedIds.clear();
    selectedIds.add(id);
    syncState();
  }

  function selectRecords(ids = []) {
    selectedIds.clear();
    ids.forEach((id) => {
      if (records.some((record) => record.id === id)) selectedIds.add(id);
    });
    syncState();
  }

  function clearSelection() {
    closeDimensionEditPanel();
    selectedIds.clear();
    syncState();
  }

  function setSelectedGeometryAppearance(patch = {}) {
    const selectedGeometry = records.filter((record) => (
      selectedIds.has(record.id)
      && record.recordType === 'geometry'
      && !record.entity.construction
    ));
    const selectedImages = records.filter((record) => (
      selectedIds.has(record.id)
      && record.recordType === 'image'
      && !record.entity.construction
    ));
    if (!selectedGeometry.length && !selectedImages.length) return { success: false, error: 'No editable object selected.' };
    const fillExpression = patch.fillExpression ?? patch.fillColor;
    const fillOpacityExpression = patch.fillOpacityExpression;
    const strokeOpacityExpression = patch.strokeOpacityExpression;
    const requestedStroke = Number(patch.strokeThickness);
    const strokeThickness = Number.isFinite(requestedStroke) ? Math.min(40, Math.max(0.1, requestedStroke)) : null;
    const errors = [];
    const updates = selectedGeometry.map((record) => {
      const current = geometryAppearance(record.entity);
      const appearance = {
        ...(record.entity.appearance || {}),
        fillColor: current.fillColor,
        fillOpacity: current.fillOpacity,
        strokeOpacity: current.strokeOpacity,
        strokeThickness: strokeThickness || current.strokeThickness,
      };
      if (fillExpression !== undefined) {
        appearance.fillExpression = String(fillExpression);
        try { appearance.fillColor = resolveColorExpression(fillExpression, (expression) => solver.evaluateParameterExpression(expression)); } catch (error) { errors.push(error.message); }
      }
      if (fillOpacityExpression !== undefined) {
        appearance.fillOpacityExpression = String(fillOpacityExpression);
        try { appearance.fillOpacity = resolveOpacityExpression(fillOpacityExpression, (expression) => solver.evaluateParameterExpression(expression)); } catch (error) { errors.push(error.message); }
      }
      if (strokeOpacityExpression !== undefined) {
        appearance.strokeOpacityExpression = String(strokeOpacityExpression);
        try { appearance.strokeOpacity = resolveOpacityExpression(strokeOpacityExpression, (expression) => solver.evaluateParameterExpression(expression)); } catch (error) { errors.push(error.message); }
      }
      return {
        id: record.id,
        appearance,
      };
    });
    const changed = solver.updateEntityAppearances(updates);
    changed.forEach((entity) => {
      const record = records.find((candidate) => candidate.id === entity.id);
      if (!record) return;
      record.entity = cloneEntity(entity);
      applyGeometryAppearance(record);
    });
    if (fillOpacityExpression !== undefined) selectedImages.forEach((record) => imageTools.setAppearance(record, { fillOpacityExpression }));
    notifyObjectChange();
    return { success: errors.length === 0, error: errors[0] || null };
  }

  function setSelectedConstruction(construction) {
    const selectedGeometry = records.filter((record) => selectedIds.has(record.id) && record.recordType === 'geometry');
    if (!selectedGeometry.length) return false;
    const changed = solver.updateEntityConstruction(selectedGeometry.map((record) => record.id), construction);
    changed.forEach((entity) => {
      const record = records.find((candidate) => candidate.id === entity.id);
      if (!record) return;
      record.entity = cloneEntity(entity);
      syncGeometryClasses(record);
      applyGeometryAppearance(record);
      syncGeometryPresentation(record);
    });
    syncGeometryStacking();
    notifyObjectChange();
    return true;
  }

  function arrangeSelectedGeometry(action) {
    const order = editableStackOrder();
    const selected = new Set(order.filter((record) => selectedIds.has(record.id)).map((record) => record.id));
    if (!selected.size) return false;
    let arranged = [...order];
    if (action === 'front') arranged = [...arranged.filter((record) => !selected.has(record.id)), ...arranged.filter((record) => selected.has(record.id))];
    if (action === 'back') arranged = [...arranged.filter((record) => selected.has(record.id)), ...arranged.filter((record) => !selected.has(record.id))];
    if (action === 'forward') {
      for (let index = arranged.length - 2; index >= 0; index -= 1) {
        if (!selected.has(arranged[index].id) || selected.has(arranged[index + 1].id)) continue;
        [arranged[index], arranged[index + 1]] = [arranged[index + 1], arranged[index]];
      }
    }
    if (action === 'backward') {
      for (let index = 1; index < arranged.length; index += 1) {
        if (!selected.has(arranged[index].id) || selected.has(arranged[index - 1].id)) continue;
        [arranged[index - 1], arranged[index]] = [arranged[index], arranged[index - 1]];
      }
    }
    if (!['front', 'back', 'forward', 'backward'].includes(action)) return false;
    if (arranged.every((record, index) => record.id === order[index].id)) return false;
    const updates = arranged.map((record, zIndex) => ({ record, zIndex, appearance: { ...(record.entity.appearance || {}), zIndex } }));
    const changed = solver.updateEntityAppearances(updates
      .filter(({ record }) => record.recordType === 'geometry')
      .map(({ record, appearance }) => ({ id: record.id, appearance })));
    changed.forEach((entity) => {
      const record = records.find((candidate) => candidate.id === entity.id);
      if (record) record.entity = cloneEntity(entity);
    });
    updates.filter(({ record }) => record.recordType === 'image').forEach(({ record, appearance }) => {
      record.entity.appearance = appearance;
      imageTools.updateRecord(record);
    });
    syncGeometryStacking();
    notifyObjectChange();
    syncState();
    return true;
  }

  function deleteSelection() {
    if (!selectedIds.size) return;
    const selectedGeometryIds = new Set(records.filter((record) => selectedIds.has(record.id) && record.recordType === 'geometry').map((record) => record.id));
    const deletionIds = new Set([...selectedIds].filter((id) => {
      const record = records.find((candidate) => candidate.id === id);
      return !(record?.recordType === 'image' && record.entity.locked);
    }));
    if (!deletionIds.size) return;
    records.forEach((record) => {
      if (dimensionReferencesAny(record, selectedGeometryIds)) deletionIds.add(record.id);
    });
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (!deletionIds.has(records[index].id)) continue;
      if (records[index].recordType === 'geometry') solver.removeEntity(records[index].id);
      if (records[index].recordType === 'dimension' && records[index].entity.dimensionId) solver.removeDimension(records[index].entity.dimensionId);
      records[index].group.remove();
      records.splice(index, 1);
    }
    constraintOverlaySystem?.prune?.();
    deletionIds.forEach((id) => selectedIds.delete(id));
    hoveredId = null;
    syncState();
    notifyObjectChange();
  }

  function clearDrawing() {
    if (solveFrame !== null) cancelAnimationFrame(solveFrame);
    solveFrame = null;
    closeDimensionEditPanel();
    pendingSolveRecords.clear();
    records.splice(0).forEach((record) => record.group.remove());
    solver.clear();
    constraintOverlaySystem?.clear?.();
    selectedIds.clear();
    hoveredId = null;
    clearPreview();
    setObjectSnapCandidate(null);
    constraintOverlaySystem?.render?.();
    syncState();
    notifyObjectChange();
  }

  function loadDrawingData(snapshot, { zoomToFit = true } = {}) {
    if (solveFrame !== null) cancelAnimationFrame(solveFrame);
    solveFrame = null;
    closeDimensionEditPanel();
    pendingSolveRecords.clear();
    records.splice(0).forEach((record) => record.group.remove());
    selectedIds.clear();
    hoveredId = null;
    clearPreview();
    objectSnapCandidate = null;
    constraintOverlaySystem?.clear?.();
    const sourceEntities = snapshot?.entities || [];
    solver.loadSketch({ ...snapshot, entities: sourceEntities.filter((entity) => entity.type !== 'image') });
    const geometryEntities = solver.getGeometrySnapshot();
    let geometryIndex = 0;
    sourceEntities.forEach((entity, index) => {
      const record = isImageEntity(entity)
        ? imageTools.createRecord(entity)
        : createGeometryRecord(geometryEntities[geometryIndex++], index);
      if (record) records.push(record);
    });
    solver.getSketchSnapshot().dimensionAnnotations.forEach((entity) => {
      applyManagedDimensionText(entity);
      const record = createDimensionRecord({
        add,
        objectLayer,
        entity: cloneEntity(entity),
        index: records.length,
        scale: camera.scale,
        updateRecordHandles,
        bindRecordEvents,
      });
      syncDimensionPresentation(record);
      records.push(record);
    });
    syncGeometryStacking();
    refreshLinkedDimensions();
    renderClosedRegions();
    constraintOverlaySystem?.render?.();
    if (zoomToFit) zoomAll();
    else render();
    syncState();
    notifyObjectChange();
    return records.length;
  }

  function insertDrawingData(snapshot) {
    return loadDrawingData(mergeDrawingData(drawingSnapshot(), snapshot));
  }

  function drawingSnapshot() {
    const snapshot = solver.getSketchSnapshot();
    return {
      ...snapshot,
      entities: records
        .filter((record) => ['geometry', 'image'].includes(record.recordType))
        .map((record) => cloneEntity(record.entity)),
    };
  }

  function isWholeObjectHandle(record, handleIndex) {
    if (record.recordType !== 'geometry') return false;
    if (record.entity.type === 'line') return handleIndex === 1;
    if (record.entity.type === 'circle') return handleIndex === 0;
    if (record.entity.type === 'arc') return handleIndex === 3;
    return false;
  }

  function startSelectionDragFromHandle(event, record) {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedIds.has(record.id)) selectOnly(record.id);
    shapeDrag = {
      mode: 'records',
      moved: false,
      startWorld: screenToWorld(event.clientX, event.clientY),
      items: dragRecordsForSelection().map((item) => ({ record: item, startEntity: cloneEntity(item.entity) })),
    };
    solver.beginDrag(shapeDrag.items.flatMap(({ record: item }) => item.recordType === 'geometry' ? solver.variableIdsForEntity(item.id) : []));
    record.group.setPointerCapture(event.pointerId);
  }

  function startHandleDrag(event, record, handleIndex) {
    if (featureCommandDelegate?.pointerDown?.(event)) return;
    if (smartDimensionDelegate?.pointerDown?.(event)) return;
    if (selectedIds.size > 1 && selectedIds.has(record.id) && isWholeObjectHandle(record, handleIndex)) {
      startSelectionDragFromHandle(event, record);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    selectOnly(record.id);
    handleDrag = {
      record,
      handleIndex,
      startWorld: screenToWorld(event.clientX, event.clientY),
      startEntity: cloneEntity(record.entity),
    };
    if (record.recordType === 'geometry') solver.beginDrag(solver.variableIdsForFeature({ kind: 'point', recordId: record.id, index: handleIndex }));
    record.group.setPointerCapture(event.pointerId);
  }

  function startDimensionLineDrag(event, record) {
    event.preventDefault();
    event.stopPropagation();
    selectOnly(record.id);
    dimensionLineDrag = {
      record,
      startWorld: screenToWorld(event.clientX, event.clientY),
      startEntity: cloneEntity(record.entity),
    };
    record.group.setPointerCapture(event.pointerId);
  }

  function moveGeometryHandle(record, handleIndex, world, startWorld, startEntity = handleDrag?.startEntity || cloneEntity(record.entity)) {
    const entity = record.entity;
    const dx = world[0] - startWorld[0];
    const dy = world[1] - startWorld[1];
    const start = startEntity;
    if (entity.type === 'line') {
      if (handleIndex === 0) entity.start = world;
      if (handleIndex === 2) entity.end = world;
      if (handleIndex === 1) {
        entity.start = [start.start[0] + dx, start.start[1] + dy];
        entity.end = [start.end[0] + dx, start.end[1] + dy];
      }
    }
    if (entity.type === 'circle') {
      if (handleIndex === 0) entity.center = world;
      if (handleIndex > 0) entity.radius = Math.max(6, Math.hypot(world[0] - entity.center[0], world[1] - entity.center[1]));
    }
    if (entity.type === 'rect') {
      const left = start.x;
      const right = start.x + start.width;
      const top = start.y;
      const bottom = start.y + start.height;
      if (handleIndex === 0) Object.assign(entity, { x: world[0], y: world[1], width: right - world[0], height: bottom - world[1] });
      if (handleIndex === 1) Object.assign(entity, { x: left, y: world[1], width: start.width, height: bottom - world[1] });
      if (handleIndex === 2) Object.assign(entity, { x: left, y: world[1], width: world[0] - left, height: bottom - world[1] });
      if (handleIndex === 3) Object.assign(entity, { x: left, y: top, width: world[0] - left, height: start.height });
      if (handleIndex === 4) Object.assign(entity, { x: left, y: top, width: world[0] - left, height: world[1] - top });
      if (handleIndex === 5) Object.assign(entity, { x: left, y: top, width: start.width, height: world[1] - top });
      if (handleIndex === 6) Object.assign(entity, { x: world[0], y: top, width: right - world[0], height: world[1] - top });
      if (handleIndex === 7) Object.assign(entity, { x: world[0], y: top, width: right - world[0], height: start.height });
      if (entity.width < 0) Object.assign(entity, { x: entity.x + entity.width, width: Math.abs(entity.width) });
      if (entity.height < 0) Object.assign(entity, { y: entity.y + entity.height, height: Math.abs(entity.height) });
    }
    if (entity.type === 'polygon' || entity.type === 'polyline' || entity.type === 'curve') entity.points[handleIndex] = world;
    if (entity.type === 'arc') {
      if (handleIndex === 0) entity.start = world;
      if (handleIndex === 1) entity.arcPoint = world;
      if (handleIndex === 2) entity.end = world;
      if (handleIndex === 3) {
        entity.start = [start.start[0] + dx, start.start[1] + dy];
        entity.arcPoint = [start.arcPoint[0] + dx, start.arcPoint[1] + dy];
        entity.end = [start.end[0] + dx, start.end[1] + dy];
        if (hasStoredArcCircle(start)) {
          entity.center = [start.center[0] + dx, start.center[1] + dy];
          entity.radius = start.radius;
        }
      } else {
        refreshArcCircleMetadata(entity);
      }
    }
    updateGeometryNode(record);
  }

  function recordById(recordId) {
    return records.find((record) => record.id === recordId && record.recordType === 'geometry') || null;
  }

  function applySolverSnapshot(snapshot = solver.getGeometrySnapshot()) {
    const byId = new Map(snapshot.map((entity) => [entity.id, entity]));
    const changedIds = new Set();
    records.forEach((record) => {
      if (record.recordType !== 'geometry') return;
      const next = byId.get(record.id);
      if (!next) return;
      record.entity = cloneEntity(next);
      updateGeometryNode(record);
      updateRecordHandles(record);
      changedIds.add(record.id);
    });
    refreshLinkedDimensions();
    constraintOverlaySystem?.render?.();
    syncState();
    return changedIds;
  }

  function updateDimensionParameterName(dimensionId, name) {
    records.forEach((record) => {
      if (record.recordType !== 'dimension' || record.entity.dimensionId !== dimensionId) return;
      record.entity.dimensionName = name;
      applyManagedDimensionText(record.entity);
      updateDimensionNode(record, camera.scale);
      syncDimensionPresentation(record);
    });
  }

  function setDimensionTextMode(mode) {
    if (!['expression', 'named-value', 'value'].includes(mode)) return;
    dimensionTextMode = mode;
    records.forEach((record) => {
      if (record.recordType === 'geometry') {
        syncGeometryPresentation(record);
        return;
      }
      if (record.recordType === 'dimension') {
        applyManagedDimensionText(record.entity);
        updateDimensionNode(record, camera.scale);
        syncDimensionPresentation(record);
      }
    });
    syncScreenInvariantSizing();
  }

  function solveEditedRecords(editedRecords, lockedVariableIds = []) {
    const entitiesToUpdate = editedRecords.filter((record) => record.recordType === 'geometry').map((record) => cloneEntity(record.entity));
    if (!entitiesToUpdate.length) return new Set();
    const outcome = solver.updateEntities(entitiesToUpdate, { lockedVariableIds });
    return applySolverSnapshot(outcome.snapshot);
  }

  function flushScheduledSolve() {
    if (solveFrame !== null) {
      cancelAnimationFrame(solveFrame);
      solveFrame = null;
    }
    const editedRecords = [...pendingSolveRecords.values()];
    pendingSolveRecords.clear();
    if (editedRecords.length) solveEditedRecords(editedRecords);
  }

  function scheduleGeometrySolve(editedRecords) {
    editedRecords.forEach((record) => pendingSolveRecords.set(record.id, record));
    if (solveFrame !== null) return;
    solveFrame = requestAnimationFrame(() => {
      solveFrame = null;
      const pending = [...pendingSolveRecords.values()];
      pendingSolveRecords.clear();
      if (pending.length) solveEditedRecords(pending);
    });
  }

  function getEntityFeature(recordId) {
    return entityFeatureFromRecord(recordById(recordId));
  }

  function getSegmentFeature(recordId, index = 0) {
    const record = recordById(recordId);
    return record ? segmentFeatureFromRecord(record, index) : null;
  }

  function getPointFeature(recordId, index = 0) {
    const record = recordById(recordId);
    const point = record ? recordHandles(record.entity)[index] : null;
    return point ? { kind: 'point', recordId: record.id, entityType: record.entity.type, index, point: [...point] } : null;
  }

  function dimensionAnchorRecordIds(entity) {
    const ids = new Set();
    const visit = (value) => {
      if (!value || typeof value !== 'object') return;
      if (value.recordId) ids.add(value.recordId);
      Object.values(value).forEach(visit);
    };
    visit(entity.anchors);
    return ids;
  }

  function resolveAnchor(anchor) {
    if (!anchor) return null;
    const record = recordById(anchor.recordId);
    if (!record) return null;
    if (anchor.type === 'point') return recordHandles(record.entity)[anchor.index]?.slice() || null;
    if (anchor.type === 'segment-start' || anchor.type === 'segment-end') {
      const segment = segmentFeatureFromRecord(record, anchor.index);
      if (!segment) return null;
      return anchor.type === 'segment-start' ? [...segment.start] : [...segment.end];
    }
    if (anchor.type === 'center') return entityFeatureFromRecord(record)?.center?.slice() || null;
    if (anchor.type === 'radius') return entityFeatureFromRecord(record)?.radius || null;
    return null;
  }

  function resolveFeatureFromAnchor(featureAnchor) {
    const record = recordById(featureAnchor?.recordId);
    if (!record) return null;
    if (featureAnchor.kind === 'segment') return segmentFeatureFromRecord(record, featureAnchor.index);
    if (featureAnchor.kind === 'circle' || featureAnchor.kind === 'arc') return entityFeatureFromRecord(record);
    if (featureAnchor.kind === 'curve') {
      return record.entity.type === 'curve'
        ? { kind: 'curve', recordId: record.id, points: record.entity.points.map((point) => [...point]) }
        : null;
    }
    return null;
  }

  function featureLength(feature) {
    if (!feature) return 0;
    if (feature.kind === 'segment') return pointDistance(feature.start, feature.end);
    if (feature.kind === 'circle') return Math.PI * 2 * feature.radius;
    if (feature.kind === 'arc') {
      const startAngle = Math.atan2(feature.start[1] - feature.center[1], feature.start[0] - feature.center[0]);
      const midAngle = Math.atan2(feature.arcPoint[1] - feature.center[1], feature.arcPoint[0] - feature.center[0]);
      const endAngle = Math.atan2(feature.end[1] - feature.center[1], feature.end[0] - feature.center[0]);
      const tau = Math.PI * 2;
      const normalize = (angle) => (angle + tau) % tau;
      const ccwSpan = normalize(endAngle - startAngle);
      return feature.radius * (normalize(midAngle - startAngle) <= ccwSpan ? ccwSpan : tau - ccwSpan);
    }
    if (feature.kind === 'curve') {
      return feature.points.slice(1).reduce((total, point, index) => total + pointDistance(feature.points[index], point), 0);
    }
    return 0;
  }

  function dimensionLineText(entity) {
    const sourceStart = entity.measureStart || entity.start;
    const sourceEnd = entity.measureEnd || entity.end;
    const measured = entity.subtype === 'horizontal'
      ? Math.abs(sourceEnd[0] - sourceStart[0])
      : entity.subtype === 'vertical'
        ? Math.abs(sourceEnd[1] - sourceStart[1])
        : pointDistance(entity.start, entity.end);
    return formatDrawingLength(measured);
  }

  function updateLinkedDimensionEntity(entity) {
    if (!entity.anchors) return false;
    if (entity.type === 'dimension-line') {
      const oldMid = midpoint(entity.measureStart || entity.start, entity.measureEnd || entity.end);
      const nextStart = resolveAnchor(entity.anchors.start) || entity.start;
      const nextEnd = resolveAnchor(entity.anchors.end) || entity.end;
      const nextMeasureStart = resolveAnchor(entity.anchors.measureStart) || nextStart;
      const nextMeasureEnd = resolveAnchor(entity.anchors.measureEnd) || nextEnd;
      const nextMid = midpoint(nextMeasureStart, nextMeasureEnd);
      const delta = subtractPoints(nextMid, oldMid);
      entity.start = nextStart;
      entity.end = nextEnd;
      entity.measureStart = nextMeasureStart;
      entity.measureEnd = nextMeasureEnd;
      entity.label = addPoints(entity.label, delta);
      entity.text = dimensionLineText(entity);
      return true;
    }
    if (entity.type === 'radius-dimension') {
      const oldCenter = entity.center;
      const center = resolveAnchor(entity.anchors.center);
      const radius = resolveAnchor(entity.anchors.radius);
      if (!center) return false;
      const delta = subtractPoints(center, oldCenter);
      entity.center = center;
      if (radius) entity.radius = radius;
      entity.elbow = addPoints(entity.elbow || entity.label, delta);
      entity.label = addPoints(entity.label, delta);
      entity.text = formatDrawingLength(entity.radius);
      return true;
    }
    if (entity.type === 'angle-dimension') {
      const first = entity.anchors.firstSegment;
      const second = entity.anchors.secondSegment;
      const firstSegment = first?.start && first?.end ? { start: resolveAnchor(first.start), end: resolveAnchor(first.end) } : null;
      const secondSegment = second?.start && second?.end ? { start: resolveAnchor(second.start), end: resolveAnchor(second.end) } : null;
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
      return true;
    }
    if (entity.type === 'multi-curve-length-dimension') {
      const features = entity.anchors.features?.map(resolveFeatureFromAnchor).filter(Boolean) || [];
      if (!features.length) return false;
      const first = features[0];
      const target = first.kind === 'segment'
        ? midpoint(first.start, first.end)
        : first.kind === 'curve'
          ? first.points[Math.floor(first.points.length / 2)]
          : addPoints(first.center, [first.radius, 0]);
      const delta = subtractPoints(target, entity.target);
      entity.target = target;
      entity.elbow = addPoints(entity.elbow || entity.label, delta);
      entity.label = addPoints(entity.label, delta);
      entity.text = formatDrawingLength(features.reduce((total, feature) => total + featureLength(feature), 0));
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
      applyManagedDimensionText(record.entity);
      updateDimensionNode(record, camera.scale);
      updateRecordHandles(record);
    });
    syncScreenInvariantSizing();
  }

  function translateGeometryEntity(entity, startEntity, delta) {
    if (entity.type === 'line') {
      entity.start = addPoints(startEntity.start, delta);
      entity.end = addPoints(startEntity.end, delta);
    }
    if (entity.type === 'circle') entity.center = addPoints(startEntity.center, delta);
    if (entity.type === 'rect') {
      entity.x = startEntity.x + delta[0];
      entity.y = startEntity.y + delta[1];
    }
    if (entity.type === 'polygon' || entity.type === 'polyline' || entity.type === 'curve') {
      entity.points = startEntity.points.map((point) => addPoints(point, delta));
    }
    if (entity.type === 'arc') {
      entity.start = addPoints(startEntity.start, delta);
      entity.arcPoint = addPoints(startEntity.arcPoint, delta);
      entity.end = addPoints(startEntity.end, delta);
      if (hasStoredArcCircle(startEntity)) {
        entity.center = addPoints(startEntity.center, delta);
        entity.radius = startEntity.radius;
      } else {
        refreshArcCircleMetadata(entity);
      }
    }
  }

  function translateDimensionEntity(entity, startEntity, delta) {
    if (entity.type === 'dimension-line') {
      entity.start = addPoints(startEntity.start, delta);
      entity.end = addPoints(startEntity.end, delta);
      entity.measureStart = addPoints(startEntity.measureStart || startEntity.start, delta);
      entity.measureEnd = addPoints(startEntity.measureEnd || startEntity.end, delta);
      entity.label = addPoints(startEntity.label, delta);
    }
    if (entity.type === 'radius-dimension') {
      entity.center = addPoints(startEntity.center, delta);
      if (startEntity.target) entity.target = addPoints(startEntity.target, delta);
      entity.elbow = addPoints(startEntity.elbow || startEntity.label, delta);
      entity.label = addPoints(startEntity.label, delta);
    }
    if (entity.type === 'angle-dimension') {
      entity.vertex = addPoints(startEntity.vertex, delta);
      entity.start = addPoints(startEntity.start, delta);
      entity.end = addPoints(startEntity.end, delta);
      entity.label = addPoints(startEntity.label, delta);
    }
    if (entity.type === 'multi-curve-length-dimension') {
      entity.target = addPoints(startEntity.target, delta);
      entity.elbow = addPoints(startEntity.elbow || startEntity.label, delta);
      entity.label = addPoints(startEntity.label, delta);
    }
    if (entity.type === 'dimension-text') entity.label = addPoints(startEntity.label, delta);
  }

  function moveSegmentFromStart(record, segmentIndex, startEntity, delta) {
    const entity = record.entity;
    if (entity.type !== 'polyline' && entity.type !== 'polygon') return;
    const nextIndex = (segmentIndex + 1) % startEntity.points.length;
    entity.points = startEntity.points.map((point) => [...point]);
    entity.points[segmentIndex] = addPoints(startEntity.points[segmentIndex], delta);
    entity.points[nextIndex] = addPoints(startEntity.points[nextIndex], delta);
  }

  function dimensionReferencesAny(record, geometryIds) {
    if (record.recordType !== 'dimension') return false;
    const anchorIds = dimensionAnchorRecordIds(record.entity);
    return [...geometryIds].some((id) => anchorIds.has(id));
  }

  function dragRecordsForSelection() {
    const selectedRecords = records.filter((record) => selectedIds.has(record.id));
    const selectedGeometryIds = new Set(selectedRecords.filter((record) => record.recordType === 'geometry').map((record) => record.id));
    return selectedRecords.filter((record) => {
      if (record.recordType === 'geometry') return true;
      if (record.recordType === 'image') return !record.entity.locked;
      return !dimensionReferencesAny(record, selectedGeometryIds);
    });
  }

  function beginRecordsDrag(event) {
    shapeDrag = {
      mode: 'records',
      moved: false,
      startWorld: screenToWorld(event.clientX, event.clientY),
      items: dragRecordsForSelection().map((item) => ({ record: item, startEntity: cloneEntity(item.entity) })),
    };
    solver.beginDrag(shapeDrag.items.flatMap(({ record: item }) => item.recordType === 'geometry' ? solver.variableIdsForEntity(item.id) : []));
  }

  function startRegionDrag(event, parentIds) {
    if (event.button !== 0) return false;
    event.preventDefault();
    event.stopPropagation();
    if (!parentIds.every((id) => selectedIds.has(id))) selectRecords(parentIds);
    beginRecordsDrag(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    return true;
  }

  function startObjectDrag(event, record) {
    if (event.button !== 0 || event.target.closest?.('.point-handle')) return false;
    event.preventDefault();
    event.stopPropagation();
    if (!selectedIds.has(record.id)) selectOnly(record.id);
    beginRecordsDrag(event);
    record.group.setPointerCapture(event.pointerId);
    return true;
  }

  function startSegmentDrag(event, record) {
    if (event.button !== 0 || (record.entity.type !== 'polyline' && record.entity.type !== 'polygon')) return false;
    const segmentIndex = Number(event.target.dataset.segmentIndex);
    if (!Number.isInteger(segmentIndex)) return false;
    event.preventDefault();
    event.stopPropagation();
    selectOnly(record.id);
    shapeDrag = {
      mode: 'segment',
      moved: false,
      record,
      segmentIndex,
      startWorld: screenToWorld(event.clientX, event.clientY),
      startEntity: cloneEntity(record.entity),
    };
    solver.beginDrag(solver.variableIdsForFeature({ kind: 'segment', recordId: record.id, index: segmentIndex }));
    record.group.setPointerCapture(event.pointerId);
    return true;
  }

  function moveShapeDrag(event) {
    const world = screenToWorld(event.clientX, event.clientY);
    const delta = subtractPoints(world, shapeDrag.startWorld);
    if (pointLength(delta) > 0.001) shapeDrag.moved = true;
    const changedIds = new Set();
    if (shapeDrag.mode === 'segment') {
      moveSegmentFromStart(shapeDrag.record, shapeDrag.segmentIndex, shapeDrag.startEntity, delta);
      updateGeometryNode(shapeDrag.record);
      updateRecordHandles(shapeDrag.record);
      changedIds.add(shapeDrag.record.id);
    }
    if (shapeDrag.mode === 'records') {
      shapeDrag.items.forEach(({ record, startEntity }) => {
        if (record.recordType === 'geometry') {
          translateGeometryEntity(record.entity, startEntity, delta);
          updateGeometryNode(record);
          updateRecordHandles(record);
          changedIds.add(record.id);
        } else if (record.recordType === 'image') {
          record.entity.x = startEntity.x + delta[0];
          record.entity.y = startEntity.y + delta[1];
          imageTools.updateRecord(record);
        } else {
          translateDimensionEntity(record.entity, startEntity, delta);
          updateDimensionNode(record, camera.scale);
          updateRecordHandles(record);
        }
      });
    }
    if (changedIds.size) {
      scheduleGeometrySolve([...changedIds].map(recordById).filter(Boolean));
    }
    renderClosedRegions();
    constraintOverlaySystem?.render?.();
    syncState();
  }

  function moveHandle(event) {
    const world = screenToWorld(event.clientX, event.clientY);
    const { record, handleIndex, startWorld } = handleDrag;
    if (record.recordType === 'dimension') moveDimensionHandle(record, handleIndex, world, startWorld, handleDrag.startEntity, camera.scale);
    else moveGeometryHandle(record, handleIndex, world, startWorld);
    updateRecordHandles(record);
    if (record.recordType === 'geometry') {
      scheduleGeometrySolve([record]);
      renderClosedRegions();
    }
    constraintOverlaySystem?.render?.();
    syncState();
  }

  const axisX = add(axisLayer, 'line', { x1: 0, y1: 0, x2: 0, y2: 0, class: 'axis x' });
  const axisY = add(axisLayer, 'line', { x1: 0, y1: 0, x2: 0, y2: 0, class: 'axis y' });

  entities.forEach((entity, index) => {
    const record = createGeometryRecord(solver.addEntity(entity), index);
    if (record) records.push(record);
  });

  function render() {
    g.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.scale})`);
    const worldLeft = -camera.x / camera.scale;
    const worldRight = (canvas.clientWidth - camera.x) / camera.scale;
    const worldTop = -camera.y / camera.scale;
    const worldBottom = (canvas.clientHeight - camera.y) / camera.scale;
    axisX.setAttribute('x1', worldLeft);
    axisX.setAttribute('x2', worldRight);
    axisY.setAttribute('y1', worldTop);
    axisY.setAttribute('y2', worldBottom);
    records.forEach((record) => {
      if (record.recordType === 'dimension') {
        applyManagedDimensionText(record.entity);
        updateDimensionNode(record, camera.scale);
      }
      if (record.recordType === 'image') imageTools.updateRecord(record);
    });
    constraintOverlaySystem?.render?.();
    syncScreenInvariantSizing();
    positionDimensionEditPanel();
    if (status) status.textContent = `Zoom ${(camera.scale * 100).toFixed(0)}% - Alt/Middle drag to pan - Wheel to zoom`;
  }

  function syncScreenInvariantSizing() {
    const handleRadius = 6 / camera.scale;
    const handleStrokeWidth = 2 / camera.scale;
    const textSize = 14 / camera.scale;
    const textStrokeWidth = 0;
    objectLayer.querySelectorAll('.point-handle').forEach((handle) => {
      handle.setAttribute('r', handleRadius);
      handle.setAttribute('stroke-width', handleStrokeWidth);
    });
    objectLayer.querySelectorAll('.dimension-text').forEach((text) => {
      text.setAttribute('font-size', textSize);
      text.setAttribute('stroke-width', textStrokeWidth);
      text.style.fontSize = `${textSize}px`;
      text.style.strokeWidth = '0px';
    });
  }

  function updateSelectionBox(event) {
    const left = Math.min(windowSelect.startX, event.clientX);
    const top = Math.min(windowSelect.startY, event.clientY);
    const width = Math.abs(event.clientX - windowSelect.startX);
    const height = Math.abs(event.clientY - windowSelect.startY);
    const canvasRect = canvas.getBoundingClientRect();
    Object.assign(selectionBox.style, {
      display: 'block',
      left: `${left - canvasRect.left}px`,
      top: `${top - canvasRect.top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    windowSelect.rect = { left, top, right: left + width, bottom: top + height, width, height };
  }

  function intersects(a, b) {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
  }

  function finishWindowSelect() {
    selectionBox.style.display = 'none';
    if (!windowSelect?.rect || windowSelect.rect.width < 4 || windowSelect.rect.height < 4) {
      windowSelect = null;
      return;
    }
    selectedIds.clear();
    records.forEach((record) => {
      const targets = [...record.group.querySelectorAll('.selectable-entity')];
      if (targets.some((target) => intersects(target.getBoundingClientRect(), windowSelect.rect))) selectedIds.add(record.id);
    });
    windowSelect = null;
    suppressNextCanvasClick = true;
    syncState();
  }

  function updateHover(event) {
    if (panStart || windowSelect || handleDrag || dimensionLineDrag || shapeDrag || imageTools.isDragging()) return;
    const previousHoveredId = hoveredId;
    hoveredId = document.elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest?.('.canvas-record'))
      .find(Boolean)?.dataset.recordId || null;
    records.forEach((record) => {
      const isVisible = hoveredId === record.id || selectedIds.has(record.id);
      record.handles.forEach((handle) => {
        handle.classList.remove('hovered');
        if (!isVisible) return;
        const rect = handle.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        if (Math.hypot(dx, dy) <= 8) handle.classList.add('hovered');
      });
    });
    if (previousHoveredId !== hoveredId || document.querySelector('.point-handle.hovered')) syncState();
  }

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const zoom = Math.exp(-event.deltaY * 0.0012);
    const nextScale = Math.min(maxZoom, Math.max(minZoom, camera.scale * zoom));
    const worldX = (cursor.x - camera.x) / camera.scale;
    const worldY = (cursor.y - camera.y) / camera.scale;
    camera = { scale: nextScale, x: cursor.x - worldX * nextScale, y: cursor.y - worldY * nextScale };
    render();
  }, { passive: false });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.target.closest?.('.dimension-edit-panel')) return;
    if (event.target.closest?.('.canvas-overlay-button')) return;
    if (featureCommandDelegate?.pointerDown?.(event)) return;
    if (smartDimensionDelegate?.pointerDown?.(event)) return;
    if (drawingMode && drawingDelegate?.pointerDown?.(event)) {
      if (event.target.closest?.('.canvas-record, .point-handle')) suppressRecordClick = true;
      event.stopPropagation();
      return;
    }
    if (event.button === 1 || event.button === 2 || event.altKey) {
      panStart = { x: event.clientX, y: event.clientY, camera: { ...camera } };
      canvas.classList.add('panning');
      return;
    }
    if (event.button === 0 && !event.target.closest?.('.canvas-record, .point-handle, .closed-constrained-region, .dimension-edit-panel')) {
      windowSelect = { startX: event.clientX, startY: event.clientY, rect: null };
      canvas.setPointerCapture(event.pointerId);
      updateSelectionBox(event);
    }
  }, { capture: true });

  canvas.addEventListener('pointermove', (event) => {
    if (imageTools.pointerMove(event)) {
      syncState();
      return;
    }
    if (shapeDrag) {
      moveShapeDrag(event);
      return;
    }
    if (handleDrag) {
      moveHandle(event);
      return;
    }
    if (dimensionLineDrag) {
      moveDimensionLine(
        dimensionLineDrag.record,
        screenToWorld(event.clientX, event.clientY),
        dimensionLineDrag.startWorld,
        dimensionLineDrag.startEntity,
        camera.scale,
      );
      syncState();
      return;
    }
    if (drawingMode && drawingDelegate?.pointerMove?.(event)) return;
    featureCommandDelegate?.pointerMove?.(event);
    smartDimensionDelegate?.pointerMove?.(event);
    if (panStart) {
      camera = { ...panStart.camera, x: panStart.camera.x + event.clientX - panStart.x, y: panStart.camera.y + event.clientY - panStart.y };
      render();
    }
    if (windowSelect) updateSelectionBox(event);
    updateHover(event);
  });

  canvas.addEventListener('pointerup', () => {
    if (imageTools.pointerUp()) {
      syncState();
      return;
    }
    flushScheduledSolve();
    let geometryDragEnded = false;
    if (shapeDrag) {
      suppressRecordClick = shapeDrag.moved;
      if (shapeDrag.moved) suppressNextCanvasClick = true;
      if (shapeDrag.moved) notifyObjectChange();
      shapeDrag = null;
      geometryDragEnded = true;
      syncState();
    }
    if (handleDrag) {
      geometryDragEnded = handleDrag.record.recordType === 'geometry' || geometryDragEnded;
      handleDrag = null;
      syncState();
    }
    if (dimensionLineDrag) {
      dimensionLineDrag = null;
      syncState();
    }
    panStart = null;
    canvas.classList.remove('panning');
    if (windowSelect) finishWindowSelect();
    if (geometryDragEnded) {
      solver.endDrag();
      applySolverSnapshot();
    }
  });

  canvas.addEventListener('dblclick', (event) => {
    if (drawingMode) drawingDelegate?.doubleClick?.(event);
  });

  canvas.addEventListener('click', (event) => {
    if (suppressNextCanvasClick) {
      suppressNextCanvasClick = false;
      return;
    }
    if (!drawingMode && !event.target.closest?.('.canvas-record, .canvas-overlay-button, .dimension-edit-panel')) clearSelection();
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  document.addEventListener('keydown', (event) => {
    if (featureCommandDelegate?.keyDown?.(event)) return;
    if (smartDimensionDelegate?.keyDown?.(event)) return;
    if (drawingMode) return;
    if (event.key === 'Escape') clearSelection();
    if (event.key === 'Delete' || event.key === 'Backspace') deleteSelection();
  });

  function zoomAll() {
    if (!records.length) {
      camera = defaultCamera();
      render();
      return;
    }
    records.forEach((record) => {
      if (record.recordType === 'dimension') updateDimensionNode(record, camera.scale);
    });
    let bounds;
    try {
      bounds = objectLayer.getBBox();
    } catch {
      bounds = null;
    }
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      camera = defaultCamera();
      render();
      return;
    }
    const fitScale = Math.min(canvas.clientWidth / bounds.width, canvas.clientHeight / bounds.height) * 0.9;
    const nextScale = Math.min(maxZoom, Math.max(minZoom, fitScale));
    camera = {
      scale: nextScale,
      x: canvas.clientWidth / 2 - (bounds.x + bounds.width / 2) * nextScale,
      y: canvas.clientHeight / 2 - (bounds.y + bounds.height / 2) * nextScale,
    };
    render();
  }

  reset.onclick = zoomAll;

  render();

  return {
    addObject,
    addImage,
    addDimension,
    clearDrawing,
    getDrawingData: drawingSnapshot,
    loadDrawingData,
    insertDrawingData,
    clearPreview,
    screenToWorld,
    worldToScreen,
    getCanvasElement() {
      return canvas;
    },
    getNearestSnapPoint: nearestSnapPoint,
    getNearestObjectPoint: nearestObjectPoint,
    setObjectSnapCandidate,
    clearObjectSnapCandidate: () => setObjectSnapCandidate(null),
    setObjectSnapEnabled(value) {
      objectSnapEnabled = Boolean(value);
      if (!objectSnapEnabled) setObjectSnapCandidate(null);
    },
    setAutoConstrainEnabled(value) {
      autoConstrainEnabled = Boolean(value);
    },
    getWorldTolerance(screenPixels) {
      return screenPixels / camera.scale;
    },
    getObjectCount() {
      return records.length;
    },
    onObjectsChange(listener) {
      objectChangeListeners.add(listener);
      return () => objectChangeListeners.delete(listener);
    },
    onSelectionChange(listener) {
      selectionChangeListeners.add(listener);
      listener(cloneEntity(selectionProperties()));
      return () => selectionChangeListeners.delete(listener);
    },
    getSelectionProperties: selectionProperties,
    clearSelection,
    setSelectedGeometryAppearance,
    setSelectedConstruction,
    arrangeSelectedGeometry,
    setDrawingMode(value) {
      drawingMode = value;
      if (!drawingMode) clearPreview();
    },
    setDrawingToolDelegate(delegate) {
      drawingDelegate = delegate;
    },
    setFeatureCommandDelegate(delegate) {
      featureCommandDelegate = delegate;
      if (!featureCommandDelegate) setSmartDimensionFeatureSelection([]);
    },
    setConstraintOverlaySystem(system) {
      constraintOverlaySystem = system;
      constraintOverlaySystem?.render?.();
    },
    setPreview,
    setDimensionPreview,
    setSmartDimensionDelegate(delegate) {
      smartDimensionDelegate = delegate;
      if (!smartDimensionDelegate) {
        setSmartDimensionFeatureSelection([]);
        clearPreview();
      }
    },
    setSmartDimensionFeatureSelection,
    setFeatureSelection: setSmartDimensionFeatureSelection,
    getFeatureFromEvent: featureFromEvent,
    getEntityFeature,
    getSegmentFeature,
    getPointFeature,
    applySolverSnapshot,
    updateDimensionParameterName,
    setDimensionTextMode,
    refreshLinkedDimensions,
    syncState,
    notifyObjectChange,
  };
}
