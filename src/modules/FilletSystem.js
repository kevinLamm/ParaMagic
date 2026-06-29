import {
  createFilletId,
  defaultFilletRadius,
  evaluateFillet,
  findFilletCorner,
} from './FilletFeatures.js';

export function createFilletSystem({
  canvas,
  records,
  addSvg,
  objectLayer,
  arcPath,
  bindRecordEvents,
  cloneEntity,
  applyGeometryAppearance,
  updateGeometryNode,
  worldToScreen,
  closeDimensionEditPanel,
  selectOnly,
  populateExpressionOptions,
  expressionWithoutUnits,
  formatDrawingNumber,
  evaluateDrawingLengthExpression,
  requestHistoryCheckpoint,
  notifyObjectChange,
  syncGeometryStacking,
  renderClosedRegions,
  refreshLinkedDimensions,
  status,
  solver,
}) {
  let filletEdit = null;

  function syncFilletClasses(record) {
    const isConstruction = record?.entity?.construction === true;
    [record?.node, record?.hitNode].filter(Boolean).forEach((node) => {
      node.classList.toggle('construction', isConstruction);
      node.classList.toggle('entity', !isConstruction);
      node.classList.toggle('accent', !isConstruction);
    });
  }

  const filletEditPanel = document.createElement('div');
  filletEditPanel.className = 'dimension-edit-panel fillet-edit-panel';
  filletEditPanel.hidden = true;
  filletEditPanel.innerHTML = `
    <label class="dimension-edit-label">
      <span>Fillet Radius</span>
      <input class="dimension-edit-input fillet-edit-input" list="filletEditParameterNames" autocomplete="off" spellcheck="false" />
    </label>
    <datalist id="filletEditParameterNames"></datalist>
    <p class="dimension-edit-error fillet-edit-error" role="alert" aria-live="polite"></p>
  `;
  canvas.appendChild(filletEditPanel);

  const filletEditInput = filletEditPanel.querySelector('.fillet-edit-input');
  const filletEditOptions = filletEditPanel.querySelector('#filletEditParameterNames');
  const filletEditError = filletEditPanel.querySelector('.fillet-edit-error');

  filletEditPanel.addEventListener('pointerdown', (event) => event.stopPropagation());
  filletEditPanel.addEventListener('click', (event) => event.stopPropagation());
  filletEditPanel.addEventListener('dblclick', (event) => event.stopPropagation());
  filletEditPanel.addEventListener('keydown', (event) => event.stopPropagation());
  filletEditInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitEditPanel();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeEditPanel();
    }
  });

  function showStatusMessage(message) {
    if (!status) return;
    status.hidden = false;
    status.textContent = message;
  }

  function sourceGeometryMap() {
    return new Map(records
      .filter((record) => record.recordType === 'geometry')
      .map((record) => [record.id, record.entity]));
  }

  function evaluateRecord(record) {
    return evaluateFillet(record.entity, sourceGeometryMap());
  }

  function updateRecord(record) {
    const evaluated = evaluateRecord(record);
    record.group.hidden = !evaluated.valid;
    syncFilletClasses(record);
    if (!evaluated.valid) {
      record.renderEntity = null;
      return false;
    }
    record.renderEntity = evaluated.arc;
    [record.node, record.hitNode].filter(Boolean).forEach((node) => node.setAttribute('d', arcPath(evaluated.arc)));
    applyGeometryAppearance(record);
    return true;
  }

  function refreshPresentation({ renderRegions = true } = {}) {
    records.filter((record) => record.recordType === 'geometry' && ['line', 'arc', 'curve'].includes(record.entity.type)).forEach(updateGeometryNode);
    records.filter((record) => record.recordType === 'fillet').forEach(updateRecord);
    if (renderRegions) renderClosedRegions();
    syncGeometryStacking();
    if (filletEdit) positionEditPanel();
  }

  function createRecord(inputEntity) {
    const entity = cloneEntity(inputEntity);
    const group = addSvg(objectLayer, 'g', {
      class: 'canvas-record entity-record geometry-record fillet-record',
      'data-record-id': entity.id,
      'data-entity-type': 'fillet',
      'aria-label': 'Fillet. Double-click to edit radius.',
    });
    const node = addSvg(group, 'path', { class: 'entity accent selectable-entity', fill: 'none' });
    const hitNode = addSvg(group, 'path', { class: 'entity accent selectable-entity hit-target', fill: 'none' });
    const record = {
      id: entity.id,
      recordType: 'fillet',
      entity,
      group,
      node,
      hitNode,
      segmentGroup: null,
      segmentNodes: [],
      handleGroup: addSvg(group, 'g', { class: 'handle-group' }),
      handles: [],
    };
    bindRecordEvents(record);
    record.group.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openEditPanel(record);
    });
    syncFilletClasses(record);
    updateRecord(record);
    return record;
  }

  function addFillet(firstFeature, secondFeature, options = {}) {
    const first = records.find((record) => record.id === firstFeature?.recordId && record.recordType === 'geometry');
    const second = records.find((record) => record.id === secondFeature?.recordId && record.recordType === 'geometry');
    if (!first || !second || first.id === second.id) {
      showStatusMessage('Select two different lines, arcs, or curves.');
      return null;
    }
    const corner = findFilletCorner(first.entity, second.entity, solver.constraints());
    if (!corner) {
      showStatusMessage('The selected geometry must share a coincident endpoint.');
      return null;
    }
    const occupied = records.some((record) => record.recordType === 'fillet' && (
      (record.entity.sourceA.recordId === first.id && record.entity.sourceA.index === corner.indexA)
      || (record.entity.sourceB.recordId === first.id && record.entity.sourceB.index === corner.indexA)
      || (record.entity.sourceA.recordId === second.id && record.entity.sourceA.index === corner.indexB)
      || (record.entity.sourceB.recordId === second.id && record.entity.sourceB.index === corner.indexB)
    ));
    if (occupied) {
      showStatusMessage('That corner already has a fillet.');
      return null;
    }
    const radius = defaultFilletRadius(first.entity, corner.indexA, second.entity, corner.indexB);
    const fillet = {
      id: createFilletId(),
      type: 'fillet',
      sourceA: { recordId: first.id, index: corner.indexA },
      sourceB: { recordId: second.id, index: corner.indexB },
      radius,
      radiusExpression: formatDrawingNumber(radius),
      construction: options.construction ?? Boolean(first.entity.construction),
      appearance: cloneEntity(first.entity.appearance || {}),
    };
    requestHistoryCheckpoint('fillet-add');
    const record = createRecord(fillet);
    records.push(record);
    showStatusMessage('Fillet created. Double-click the arc to edit its radius.');
    refreshPresentation();
    refreshLinkedDimensions();
    selectOnly(record.id);
    notifyObjectChange({ history: 'commit' });
    return record;
  }

  function closeEditPanel() {
    filletEdit = null;
    filletEditPanel.hidden = true;
    filletEditPanel.classList.remove('invalid');
    filletEditInput.value = '';
    filletEditError.textContent = '';
  }

  function positionEditPanel() {
    if (!filletEdit) return;
    const evaluated = evaluateRecord(filletEdit.record);
    if (!evaluated.valid) return;
    const [screenX, screenY] = worldToScreen(evaluated.arc.arcPoint);
    const padding = 8;
    const panelWidth = filletEditPanel.offsetWidth || 260;
    const panelHeight = filletEditPanel.offsetHeight || 92;
    const left = Math.max(padding, Math.min(canvas.clientWidth - panelWidth - padding, screenX + 14));
    const top = Math.max(padding, Math.min(canvas.clientHeight - panelHeight - padding, screenY - panelHeight / 2));
    filletEditPanel.style.left = `${left}px`;
    filletEditPanel.style.top = `${top}px`;
  }

  function openEditPanel(record) {
    if (!record || record.recordType !== 'fillet') return;
    closeDimensionEditPanel();
    selectOnly(record.id);
    filletEdit = { record };
    populateExpressionOptions(filletEditOptions);
    filletEditInput.value = record.entity.radiusExpression
      ? expressionWithoutUnits(record.entity.radiusExpression)
      : formatDrawingNumber(record.entity.radius);
    filletEditError.textContent = '';
    filletEditPanel.classList.remove('invalid');
    filletEditPanel.hidden = false;
    positionEditPanel();
    requestAnimationFrame(() => {
      positionEditPanel();
      filletEditInput.focus();
      filletEditInput.select();
    });
  }

  function submitEditPanel() {
    if (!filletEdit) return;
    const expression = filletEditInput.value.trim();
    let radius;
    try {
      radius = evaluateDrawingLengthExpression(expression);
    } catch (error) {
      filletEditPanel.classList.add('invalid');
      filletEditError.textContent = error.message;
      return;
    }
    const candidate = { ...filletEdit.record.entity, radius, radiusExpression: expression };
    const evaluated = evaluateFillet(candidate, sourceGeometryMap());
    if (!evaluated.valid) {
      filletEditPanel.classList.add('invalid');
      filletEditError.textContent = evaluated.error;
      return;
    }
    requestHistoryCheckpoint('fillet-edit');
    filletEdit.record.entity = candidate;
    closeEditPanel();
    refreshPresentation();
    refreshLinkedDimensions();
    notifyObjectChange({ history: 'commit' });
  }

  function closeEditorIfDifferent(selectedId) {
    if (filletEdit && filletEdit.record.id !== selectedId) closeEditPanel();
  }

  function handleDeletedIds(deletionIds) {
    if (filletEdit && deletionIds.has(filletEdit.record.id)) closeEditPanel();
  }

  return {
    addFillet,
    closeEditPanel,
    closeEditorIfDifferent,
    createRecord,
    evaluateRecord,
    handleDeletedIds,
    openEditPanel,
    refreshPresentation,
    updateRecord,
  };
}
