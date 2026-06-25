const pointDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angleSnapStep = Math.PI / 6;
const angleSnapTolerance = Math.PI / 24;
let compositeSerial = 0;

function rectanglePoints(a, b) {
  return [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ];
}

function createCompositeId(kind) {
  if (globalThis.crypto?.randomUUID) return `${kind}-${globalThis.crypto.randomUUID()}`;
  compositeSerial += 1;
  return `${kind}-${compositeSerial}`;
}

function curveFromPoints(points) {
  if (points.length < 3) return { type: 'polyline', points };
  return { type: 'curve', points };
}

export function createDrawingTools({ toolbar, canvas }) {
  let activeTool = null;
  let points = [];
  let pointSnaps = [];
  const constructionButton = toolbar.querySelector('[title="Construction"]');

  function resetSequence() {
    points = [];
    pointSnaps = [];
    canvas.clearPreview();
    canvas.clearObjectSnapCandidate?.();
  }

  function setActiveTool(tool) {
    activeTool = activeTool === tool ? null : tool;
    resetSequence();
    toolbar.querySelectorAll('[data-drawing-tool]').forEach((button) => {
      const isActive = button.dataset.drawingTool === activeTool;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    canvas.setDrawingMode(Boolean(activeTool));
    if (activeTool) window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'drawing' } }));
  }

  function deactivate() {
    activeTool = null;
    resetSequence();
    toolbar.querySelectorAll('[data-drawing-tool]').forEach((button) => {
      button.classList.remove('active');
      button.setAttribute('aria-pressed', 'false');
    });
    canvas.setDrawingMode(false);
  }

  function addPoint(point, snap = null) {
    points.push(point);
    pointSnaps.push(snap);
  }

  function isConstructionMode() {
    return constructionButton?.getAttribute('aria-pressed') === 'true';
  }

  function withConstruction(entity) {
    return isConstructionMode() ? { ...entity, construction: true } : entity;
  }

  function addDrawingObject(entity) {
    canvas.addObject(withConstruction(entity), { snapRefs: [...pointSnaps] });
  }

  function addLineChain(chainPoints, { closed = false, kind = 'polyline', snaps = pointSnaps } = {}) {
    if (chainPoints.length < 2) return [];
    const compositeId = createCompositeId(kind);
    const segmentCount = closed ? chainPoints.length : chainPoints.length - 1;
    const records = [];
    for (let index = 0; index < segmentCount; index += 1) {
      const nextIndex = (index + 1) % chainPoints.length;
      const start = chainPoints[index];
      const end = chainPoints[nextIndex];
      const previousRecord = records[index - 1];
      const firstRecord = records[0];
      const startSnap = previousRecord
        ? { kind: 'point', recordId: previousRecord.id, entityType: 'line', index: 2, point: [...start] }
        : snaps[index] || null;
      const endSnap = closed && index === segmentCount - 1 && firstRecord
        ? { kind: 'point', recordId: firstRecord.id, entityType: 'line', index: 0, point: [...end] }
        : snaps[nextIndex] || null;
      const record = canvas.addObject(withConstruction({
        type: 'line',
        start: [...start],
        end: [...end],
        composite: { id: compositeId, kind, closed, index, count: segmentCount },
      }), { snapRefs: [startSnap, endSnap] });
      if (record) records.push(record);
    }
    return records;
  }

  function setDrawingPreview(entity) {
    canvas.setPreview(withConstruction(entity));
  }

  function finishOpenPointTool(minPoints, factory) {
    if (points.length < minPoints) return false;
    addDrawingObject(factory([...points]));
    deactivate();
    return true;
  }

  function normalizeAngleDelta(delta) {
    return Math.atan2(Math.sin(delta), Math.cos(delta));
  }

  function snapToAngle(anchor, point) {
    const dx = point[0] - anchor[0];
    const dy = point[1] - anchor[1];
    const length = Math.hypot(dx, dy);
    if (length < 0.0001) return point;
    const angle = Math.atan2(dy, dx);
    const snappedAngle = Math.round(angle / angleSnapStep) * angleSnapStep;
    if (Math.abs(normalizeAngleDelta(angle - snappedAngle)) > angleSnapTolerance) return point;
    return [anchor[0] + Math.cos(snappedAngle) * length, anchor[1] + Math.sin(snappedAngle) * length];
  }

  function usesAngleSnap(tool) {
    return tool === 'Line' || tool === 'Polyline';
  }

  function resolvePointResult(rawPoint, anchor = null) {
    const snap = canvas.getNearestObjectPoint?.(rawPoint, 14) || null;
    if (snap) return { point: [...snap.point], snap };
    if (anchor && usesAngleSnap(activeTool)) return { point: snapToAngle(anchor, rawPoint), snap: null };
    return { point: rawPoint, snap: null };
  }

  function pointerPoint(event, anchor = null) {
    return resolvePointResult(canvas.screenToWorld(event.clientX, event.clientY), anchor);
  }

  function closesPolyline(point) {
    return points.length >= 3 && pointDistance(point, points[0]) <= canvas.getWorldTolerance(14);
  }

  function handlePointerDown(event) {
    if (!activeTool || event.button !== 0) return false;
    const rawPoint = canvas.screenToWorld(event.clientX, event.clientY);

    if (activeTool === 'Line') {
      const result = resolvePointResult(rawPoint, points[points.length - 1]);
      addPoint(result.point, result.snap);
      if (points.length === 2) finishOpenPointTool(2, ([start, end]) => ({ type: 'line', start, end }));
      return true;
    }

    if (activeTool === 'Circle') {
      const result = resolvePointResult(rawPoint);
      addPoint(result.point, result.snap);
      if (points.length === 2) {
        const [center, radiusPoint] = points;
        addDrawingObject({ type: 'circle', center, radius: Math.max(8, pointDistance(center, radiusPoint)) });
        deactivate();
      }
      return true;
    }

    if (activeTool === 'Rectangle') {
      const result = resolvePointResult(rawPoint);
      addPoint(result.point, result.snap);
      if (points.length === 2) {
        addLineChain(rectanglePoints(points[0], points[1]), {
          closed: true,
          kind: 'rectangle',
          snaps: [pointSnaps[0], null, pointSnaps[1], null],
        });
        deactivate();
      }
      return true;
    }

    if (activeTool === 'Arc') {
      const result = resolvePointResult(rawPoint);
      addPoint(result.point, result.snap);
      if (points.length === 3) finishOpenPointTool(3, ([start, arcPoint, end]) => ({ type: 'arc', start, arcPoint, end }));
      return true;
    }

    if (activeTool === 'Polyline') {
      const result = resolvePointResult(rawPoint, points[points.length - 1]);
      const point = closesPolyline(rawPoint) ? points[0] : result.point;
      if (closesPolyline(point)) {
        addLineChain([...points], { closed: true, kind: 'polyline' });
        deactivate();
        return true;
      }
      addPoint(point, result.snap);
      return true;
    }

    if (activeTool === 'Curve / Spline') {
      const result = resolvePointResult(rawPoint);
      addPoint(result.point, result.snap);
      return true;
    }

    return false;
  }

  function handlePointerMove(event) {
    if (!activeTool) {
      canvas.clearPreview();
      canvas.clearObjectSnapCandidate?.();
      return false;
    }
    const rawPoint = canvas.screenToWorld(event.clientX, event.clientY);
    const result = pointerPoint(event, points[points.length - 1]);
    canvas.setObjectSnapCandidate?.(result.snap);
    if (points.length === 0) {
      canvas.clearPreview();
      return true;
    }
    const point = result.point;
    if (activeTool === 'Line') setDrawingPreview({ type: 'line', start: points[0], end: point });
    if (activeTool === 'Circle') setDrawingPreview({ type: 'circle', center: points[0], radius: Math.max(8, pointDistance(points[0], point)) });
    if (activeTool === 'Rectangle') setDrawingPreview({ type: 'polygon', points: rectanglePoints(points[0], point) });
    if (activeTool === 'Arc' && points.length === 1) setDrawingPreview({ type: 'polyline', points: [points[0], point] });
    if (activeTool === 'Arc' && points.length === 2) setDrawingPreview({ type: 'arc', start: points[0], arcPoint: points[1], end: point });
    if (activeTool === 'Polyline') {
      const previewPoint = closesPolyline(rawPoint) ? points[0] : point;
      setDrawingPreview({ type: closesPolyline(previewPoint) ? 'polygon' : 'polyline', points: closesPolyline(previewPoint) ? [...points] : [...points, previewPoint] });
    }
    if (activeTool === 'Curve / Spline') setDrawingPreview(curveFromPoints([...points, point]));
    return true;
  }

  function finishActiveSequence() {
    if (activeTool === 'Polyline' && points.length >= 2) {
      addLineChain([...points], { kind: 'polyline' });
      deactivate();
      return true;
    }
    if (activeTool === 'Curve / Spline') return finishOpenPointTool(2, curveFromPoints);
    return false;
  }

  toolbar.querySelectorAll('[data-drawing-tool]').forEach((button) => {
    button.addEventListener('click', () => setActiveTool(button.dataset.drawingTool));
  });

  document.addEventListener('keydown', (event) => {
    if (!activeTool) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      deactivate();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      finishActiveSequence();
    }
  });

  window.addEventListener('paramagic:tool-activated', (event) => {
    if (event.detail?.source !== 'drawing') deactivate();
  });

  canvas.setDrawingToolDelegate({
    pointerDown: handlePointerDown,
    pointerMove: handlePointerMove,
    doubleClick: finishActiveSequence,
  });

  return { setActiveTool, deactivate };
}
