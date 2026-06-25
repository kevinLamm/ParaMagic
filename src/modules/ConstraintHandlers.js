const supportedConstraints = [
  'Coincident',
  'Concentric',
  'Collinear',
  'Midpoint',
  'Fixed',
  'Parallel',
  'Perpendicular',
  'Horizontal',
  'Vertical',
  'Equal',
  'Tangent',
  'Point-on',
];

const constraintIconPaths = {
  Coincident: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  Concentric: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  Collinear: '<path d="M4 12h16"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>',
  Midpoint: '<path d="M5 12h14"/><path d="M12 7l4 5-4 5-4-5z"/>',
  Fixed: '<path d="M12 4v16M4 12h16"/><circle cx="12" cy="12" r="5"/>',
  Parallel: '<path d="M8 5v14M16 5v14"/>',
  Perpendicular: '<path d="M7 5v12h12"/>',
  Horizontal: '<path d="M5 12h14"/>',
  Vertical: '<path d="M12 5v14"/>',
  Equal: '<path d="M6 9h12M6 15h12"/>',
  Tangent: '<circle cx="9" cy="13" r="5"/><path d="M14 8l5-5"/>',
  'Point-on Line': '<path d="M5 16l14-8"/><circle cx="12" cy="12" r="2.5"/>',
  'Point-on Circle': '<circle cx="12" cy="12" r="7"/><circle cx="17" cy="12" r="2"/>',
  'Point-on Arc': '<path d="M6 16a8 8 0 0 1 12 0"/><circle cx="12" cy="8" r="2"/>',
};

const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function isSameFeature(a, b) {
  return a.recordId === b.recordId && a.kind === b.kind && a.index === b.index;
}

function requiredSelectionCount(constraint) {
  return ['Horizontal', 'Vertical', 'Fixed'].includes(constraint) ? 1 : 2;
}

function featureAllowed(constraint, feature) {
  if (!feature) return false;
  if (constraint === 'Coincident') return feature.kind === 'point';
  if (constraint === 'Concentric') return feature.kind === 'circle' || feature.kind === 'arc';
  if (['Collinear', 'Parallel', 'Perpendicular', 'Horizontal', 'Vertical', 'Equal'].includes(constraint)) return feature.kind === 'segment';
  if (constraint === 'Midpoint') return feature.kind === 'point' || feature.kind === 'segment';
  if (constraint === 'Tangent') return feature.kind === 'segment' || feature.kind === 'circle' || feature.kind === 'arc';
  if (constraint === 'Point-on') return feature.kind === 'point' || feature.kind === 'segment' || feature.kind === 'circle' || feature.kind === 'arc';
  if (constraint === 'Fixed') return ['point', 'segment', 'circle', 'arc'].includes(feature.kind);
  return false;
}

function pairAllowed(constraint, features) {
  if (features.length < 2) return true;
  const kinds = features.map((feature) => feature.kind);
  if (constraint === 'Midpoint' || constraint === 'Point-on') return kinds.includes('point') && kinds.some((kind) => kind !== 'point');
  if (constraint === 'Tangent') {
    const roundCount = kinds.filter((kind) => kind === 'circle' || kind === 'arc').length;
    const segmentCount = kinds.filter((kind) => kind === 'segment').length;
    return (roundCount === 1 && segmentCount === 1) || roundCount === 2;
  }
  return true;
}

function tangentMode(features) {
  const rounds = features.filter((feature) => feature.kind === 'circle' || feature.kind === 'arc');
  if (rounds.length !== 2) return null;
  const centerDistance = Math.hypot(
    rounds[1].center[0] - rounds[0].center[0],
    rounds[1].center[1] - rounds[0].center[1],
  );
  const externalDistance = rounds[0].radius + rounds[1].radius;
  const internalDistance = Math.abs(rounds[0].radius - rounds[1].radius);
  return Math.abs(centerDistance - internalDistance) < Math.abs(centerDistance - externalDistance) ? 'internal' : 'external';
}

function orderedFeatures(constraint, features) {
  if (constraint === 'Midpoint' || constraint === 'Point-on') return [...features].sort((a) => (a.kind === 'point' ? -1 : 1));
  return features;
}

function solverConstraintType(constraint, features) {
  if (constraint !== 'Point-on') return constraint;
  const target = features.find((feature) => feature.kind !== 'point');
  if (target?.kind === 'segment') return 'Point-on Line';
  if (target?.kind === 'circle') return 'Point-on Circle';
  if (target?.kind === 'arc') return 'Point-on Arc';
  return null;
}

function featureRef(feature) {
  return { kind: feature.kind, recordId: feature.recordId, entityType: feature.entityType, index: feature.index };
}

export function createConstraintHandlers({ canvas, solver }) {
  let activeConstraint = null;
  let selections = [];
  const helperLayer = document.createElement('div');
  helperLayer.className = 'constraint-helper-layer';
  canvas.getCanvasElement().appendChild(helperLayer);

  function normalizeFeature(constraint, feature) {
    if (!feature) return null;
    if (constraint === 'Concentric' && feature.kind === 'point') return canvas.getEntityFeature(feature.recordId);
    if (constraint === 'Tangent' && feature.kind === 'point') {
      const entityFeature = canvas.getEntityFeature(feature.recordId);
      if (entityFeature?.kind === 'circle' || entityFeature?.kind === 'arc') return entityFeature;
      return canvas.getSegmentFeature(feature.recordId, feature.index);
    }
    if (['Collinear', 'Parallel', 'Perpendicular', 'Horizontal', 'Vertical', 'Equal'].includes(constraint) && feature.kind === 'point') {
      return canvas.getSegmentFeature(feature.recordId, feature.index);
    }
    return feature;
  }

  function featureWorldPoint(ref) {
    if (ref.kind === 'point') return canvas.getPointFeature(ref.recordId, ref.index)?.point || null;
    if (ref.kind === 'segment') {
      const segment = canvas.getSegmentFeature(ref.recordId, ref.index);
      return segment ? midpoint(segment.start, segment.end) : null;
    }
    return canvas.getEntityFeature(ref.recordId)?.center || null;
  }

  function geometricConstraints() {
    return solver.constraints().filter((constraint) => constraint.source !== 'dimension' && constraint.featureRefs?.length && constraintIconPaths[constraint.type]);
  }

  function renderConstraintHelpers() {
    helperLayer.replaceChildren();
    const occupied = new Map();
    geometricConstraints().forEach((constraint) => {
      const helperFeatures = constraint.type === 'Coincident' ? constraint.featureRefs.slice(0, 1) : constraint.featureRefs;
      const coincidentPoints = constraint.type === 'Coincident'
        ? constraint.featureRefs.map(featureWorldPoint).filter(Boolean)
        : [];
      helperFeatures.forEach((feature, featureIndex) => {
        const world = coincidentPoints.length
          ? coincidentPoints.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map((value) => value / coincidentPoints.length)
          : featureWorldPoint(feature);
        if (!world) return;
        const [screenX, screenY] = canvas.worldToScreen(world);
        const key = `${Math.round(screenX / 24)},${Math.round(screenY / 24)}`;
        const stackIndex = occupied.get(key) || 0;
        occupied.set(key, stackIndex + 1);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'canvas-overlay-button constraint-helper-button';
        button.title = `${constraint.type} constraint`;
        button.setAttribute('aria-label', `Remove ${constraint.type} constraint`);
        button.dataset.constraintId = constraint.id;
        button.dataset.featureIndex = String(featureIndex);
        button.style.left = `${screenX + 10 + stackIndex * 22}px`;
        button.style.top = `${screenY - 28}px`;
        button.innerHTML = `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${constraintIconPaths[constraint.type]}</svg>`;
        button.addEventListener('pointerdown', (event) => event.stopPropagation());
        const remove = (event) => {
          event.preventDefault();
          event.stopPropagation();
          window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'constraint-helper' } }));
          solver.removeConstraint(constraint.id);
          canvas.applySolverSnapshot();
          renderConstraintHelpers();
          canvas.notifyObjectChange();
        };
        button.addEventListener('pointerup', remove);
        button.addEventListener('click', remove);
        helperLayer.appendChild(button);
      });
    });
  }

  function setHelpersVisible(visible) {
    helperLayer.hidden = !visible;
  }

  function clearSelections() {
    selections = [];
    canvas.setFeatureSelection([]);
  }

  function deactivate() {
    activeConstraint = null;
    clearSelections();
    canvas.setFeatureCommandDelegate(null);
  }

  function setActiveConstraint(constraint) {
    if (!supportedConstraints.includes(constraint)) {
      deactivate();
      return false;
    }
    activeConstraint = constraint;
    clearSelections();
    canvas.setFeatureCommandDelegate(delegate);
    return true;
  }

  function addSelection(rawFeature) {
    const feature = normalizeFeature(activeConstraint, rawFeature);
    if (!featureAllowed(activeConstraint, feature)) return false;
    if (selections.some((selected) => isSameFeature(selected, feature))) {
      selections = selections.filter((selected) => !isSameFeature(selected, feature));
      canvas.setFeatureSelection(selections);
      return false;
    }
    const candidate = selections.length >= 2 ? [feature] : [...selections, feature];
    if (!pairAllowed(activeConstraint, candidate)) return false;
    selections = candidate;
    canvas.setFeatureSelection(selections);
    if (selections.length < requiredSelectionCount(activeConstraint)) return true;
    const ordered = orderedFeatures(activeConstraint, selections);
    const type = solverConstraintType(activeConstraint, ordered);
    if (type) {
      const mode = type === 'Tangent' ? tangentMode(ordered) : null;
      const outcome = solver.addConstraint({
        type,
        featureRefs: ordered.map(featureRef),
        source: 'geometric',
        ...(mode ? { tangentMode: mode } : {}),
      });
      if (outcome.constraint) {
        canvas.applySolverSnapshot(outcome.snapshot);
        canvas.notifyObjectChange();
      }
    }
    clearSelections();
    renderConstraintHelpers();
    return true;
  }

  const delegate = {
    pointerDown(event) {
      if (!activeConstraint || event.button !== 0) return false;
      const feature = canvas.getFeatureFromEvent(event);
      event.preventDefault();
      event.stopPropagation();
      addSelection(feature);
      return true;
    },
    pointerMove() {
      return false;
    },
    keyDown(event) {
      if (!activeConstraint) return false;
      if (event.key === 'Escape') {
        clearSelections();
        event.preventDefault();
        return true;
      }
      return false;
    },
  };

  canvas.setConstraintOverlaySystem({
    prune: renderConstraintHelpers,
    clear() { helperLayer.replaceChildren(); },
    render: renderConstraintHelpers,
  });

  window.addEventListener('paramagic:tool-activated', (event) => {
    if (event.detail?.source !== 'constraint') deactivate();
  });

  return { setActiveConstraint, clearSelections, deactivate, setHelpersVisible };
}
