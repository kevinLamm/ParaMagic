import { drawingTools, constraintGroups, dimensionTools, directories, sampleEntities } from './modules/config.js';
import { createInfiniteCanvas } from './modules/infiniteCanvas.js';
import { createDrawingTools } from './modules/DrawingTools.js';
import { createSmartDimensionTools } from './modules/SmartDimensionTools.js';
import { createConstraintHandlers } from './modules/ConstraintHandlers.js';
import { createSolverController } from './modules/solver/SolverController.js';
import { parseDrawingText, serializeDxf, serializeDrawingJson } from './modules/DrawingIO.js';
import { DrawingHistory } from './modules/DrawingHistory.js';
import { createImageEntityFromFile } from './modules/ImageManipulation.js';

const iconPaths = {
  New: '<path d="M12 5v14M5 12h14"/>',
  Undo: '<path d="M9 7l-5 5 5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/>',
  Redo: '<path d="M15 7l5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/>',
  Open: '<path d="M4 8h6l2 2h8v8H4z"/><path d="M4 8v-2h6l2 2"/>',
  Import: '<path d="M12 4v11"/><path d="M8 8l4-4 4 4"/><path d="M5 19h14"/>',
  Insert: '<path d="M12 5v14M5 12h14"/><path d="M4 4h5M4 4v5M20 20h-5M20 20v-5"/>',
  'Duplicate Drawing': '<rect x="8" y="8" width="11" height="11"/><path d="M5 16V5h11"/>',
  Parameters: '<path d="M6 7h12M6 12h12M6 17h12"/><circle cx="10" cy="7" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="12" cy="17" r="1.8"/>',
  Export: '<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  Print: '<path d="M7 8V4h10v4"/><path d="M6 17H4v-7h16v7h-2"/><path d="M7 14h10v6H7z"/>',
  'Zoom All': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/><path d="M10.5 7v7M7 10.5h7"/>',
  Select: '<path d="M6 4l10 8-5 1 3 6-3 1-3-6-4 3z"/>',
  Line: '<path d="M5 19L19 5"/>',
  Arc: '<path d="M6 16a8 8 0 0 1 12 0"/>',
  Polyline: '<path d="M4 17l5-8 5 4 6-7"/>',
  Polygon: '<path d="M12 4l7 5v8l-7 4-7-4V9z"/>',
  Circle: '<circle cx="12" cy="12" r="7"/>',
  Rectangle: '<rect x="5" y="7" width="14" height="10" rx="1"/>',
  'Curve / Spline': '<path d="M4 15c4-8 8 8 16-3"/>',
  Construction: '<path d="M12 4l8 8-8 8-8-8z"/><path d="M4 12h16" stroke-dasharray="2 2"/>',
  'Insert Image': '<rect x="4" y="5" width="16" height="14"/><circle cx="9" cy="10" r="2"/><path d="M5 17l5-5 3 3 2-2 4 4"/>',
  'Auto Constrain': '<path d="M5 12h14"/><path d="M12 5v14"/><circle cx="12" cy="12" r="7" stroke-dasharray="2 2"/>',
  'Object Snap': '<path d="M5 12h14M12 5v14"/><circle cx="12" cy="12" r="3"/><path d="M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4"/>',
  Properties: '<path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="17" r="2"/>',
  Constraints: '<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/><path d="M10 12h4"/>',
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
  'Point-on': '<path d="M5 16l14-8"/><circle cx="12" cy="12" r="2.5"/>',
  'Smart Driving Dimension': '<path d="M5 12h14"/><path d="M8 8l-3 4 3 4M16 8l3 4-3 4"/><circle cx="12" cy="12" r="1.5"/>',
  'Smart Driven Dimension': '<path d="M12 5v14"/><path d="M8 8l4-3 4 3M8 16l4 3 4-3"/><circle cx="12" cy="12" r="1.5"/>',
  'Dimension Text: Expression': '<path d="M4 7h16M4 12h10M4 17h13"/><path d="M17 10l3 2-3 2"/>',
  'Dimension Text: Named Value': '<path d="M4 8h6M4 16h6M13 8h7M13 16h7"/><path d="M10 12h4"/>',
  'Dimension Text: Value Only': '<path d="M5 7h14M5 12h14M5 17h14"/>',
  DXF: '<path d="M5 6h6a6 6 0 0 1 0 12H5z"/><path d="M15 7l5 10M20 7l-5 10"/>',
  JSON: '<path d="M9 6H7a3 3 0 0 0 0 6 3 3 0 0 1 0 6h2M15 6h2a3 3 0 0 1 0 6 3 3 0 0 0 0 6h-2"/>',
};

const icon = (label) => `<span class="tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${iconPaths[label] || '<circle cx="12" cy="12" r="5"/>'}</svg></span>`;
const iconButton = (label, attrs = '') => `<button class="icon-button" title="${label}" aria-label="${label}" ${attrs}>${icon(label)}</button>`;
const drawingName = (name) => name.replace(/\.json$/i, '');
const app = document.getElementById('root');

app.innerHTML = `
  <div class="app-shell">
    <header class="header-bar">
      <div class="brand">
        <span class="brand-logo" id="brandLogo" aria-label="ParaMagic"></span>
        <input class="filename" value="" placeholder="Untitled Drawing" aria-label="Editable drawing name" />
      </div>
      <nav class="file-actions" aria-label="File actions">
        ${iconButton('New', 'id="newButton"')}
        ${iconButton('Open', 'id="openButton"')}
        ${iconButton('Import', 'id="importButton"')}
        ${iconButton('Insert', 'id="insertButton" data-requires-drawing disabled')}
        ${iconButton('Duplicate Drawing')}
      </nav>
      <div class="header-spacer"></div>
      ${iconButton('Zoom All', 'id="resetView"')}
      ${iconButton('Parameters', 'id="parametersButton" data-requires-drawing disabled')}
      <div class="dropdown export-dropdown disabled">
        ${iconButton('Export', 'id="exportButton" data-requires-drawing disabled')}
        <div class="dropdown-menu">
          ${iconButton('DXF', 'data-export-format="dxf" data-requires-drawing disabled')}
          ${iconButton('JSON', 'data-export-format="json" data-requires-drawing disabled')}
        </div>
      </div>
      ${iconButton('Print', 'id="printButton" data-requires-drawing disabled')}
    </header>
    <main class="canvas" id="canvas" data-canvas="true">
      <div class="grid" id="grid" data-canvas="true"></div>
      <svg class="drawing-plane" id="drawingPlane" data-canvas="true"></svg>
      <div class="solver-status" id="solverStatus" role="status" hidden></div>
    </main>
    <input type="file" id="importFileInput" accept=".json,.dxf,application/json,application/dxf" hidden />
    <input type="file" id="insertFileInput" accept=".json,.dxf,application/json,application/dxf" hidden />
    <input type="file" id="imageFileInput" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden />
    ${panel(`${drawingToolbar()}<span class="toolbar-divider"></span>${constraintToolbar()}<span class="toolbar-divider"></span>${dimensionToolbar()}`, 'class="floating-panel unified-toolbar"')}
    ${propertiesPanel()}
  </div>`;

fetch(new URL('./assets/ParaMagic-Logo.svg', import.meta.url))
  .then((response) => response.text())
  .then((svg) => {
    document.getElementById('brandLogo').innerHTML = svg;
  })
  .catch(() => {});

const filenameInput = document.querySelector('.filename');
function resizeFilenameInput() {
  filenameInput.value = drawingName(filenameInput.value);
  filenameInput.style.width = '150px';
  filenameInput.style.width = `${Math.max(150, filenameInput.scrollWidth + 2)}px`;
}
filenameInput.addEventListener('input', resizeFilenameInput);
filenameInput.addEventListener('blur', resizeFilenameInput);
resizeFilenameInput();
const constraintTool = document.querySelector('.menu-tool');
const constraintMenu = document.querySelector('.constraint-menu');
document.body.appendChild(constraintMenu);
let constraintController = null;

function updateDrawingActionState() {
  const hasName = filenameInput.value.trim().length > 0;
  const hasObjects = canvasController.getObjectCount() > 0;
  const shouldEnable = hasName || hasObjects;
  document.querySelectorAll('[data-requires-drawing]').forEach((button) => {
    button.disabled = !shouldEnable;
  });
  document.querySelector('.export-dropdown').classList.toggle('disabled', !shouldEnable);
}

function panel(body, attrs = '') {
  const attributes = attrs.includes('class=') ? attrs : `class="floating-panel" ${attrs}`;
  return `<section ${attributes}>${body}</section>`;
}

function drawingToolbar() {
  return `<div class="toolbar-section history-tools">${iconButton('Undo', 'id="undoButton" disabled')}${iconButton('Redo', 'id="redoButton" disabled')}</div><span class="toolbar-divider"></span><div class="toolbar-section drawing-tools">${drawingTools.filter((label) => label !== 'Select').map((label) => iconButton(label, `data-drawing-tool="${label}" aria-pressed="false"`)).join('')}${iconButton('Construction', 'data-toggle-button aria-pressed="false"')}${iconButton('Insert Image', 'id="insertImageButton"')}</div><span class="toolbar-divider"></span><div class="toolbar-section drawing-aids">${iconButton('Auto Constrain', 'data-drawing-aid="auto-constrain" aria-pressed="true"')}${iconButton('Object Snap', 'data-drawing-aid="object-snap" aria-pressed="true"')}${iconButton('Properties', 'id="propertiesToggle" aria-pressed="false"')}</div>`;
}

function constraintToolbar() {
  const constraints = constraintGroups.flatMap((group) => group.items).filter((item) => !item.startsWith('Point-on')).concat('Point-on');
  return `<div class="menu-tool">
    <button class="icon-button menu-toggle" title="Coincident" aria-label="Coincident constraint" aria-expanded="false" aria-pressed="false" data-selected-constraint="Coincident">${icon('Coincident')}</button>
    <div class="constraint-menu">${constraints.map((item) => iconButton(item, `data-constraint="${item}" ${item === 'Coincident' ? 'aria-current="true"' : ''}`)).join('')}</div>
  </div>`;
}

function dimensionToolbar() {
  return `<div class="toolbar-section dimension-toggles">${dimensionTools.map((tool) => iconButton(tool.label, `data-dimension-tool="${tool.label}" aria-pressed="false"`)).join('')}${iconButton('Dimension Text: Named Value', 'id="dimensionTextMode" data-dimension-text-mode="named-value"')}</div>`;
}

function propertiesPanel() {
  return panel(`<h2>Properties</h2>
    <p class="properties-selection-status" id="propertiesSelectionStatus">No objects selected</p>
    <div class="property-row"><span>Fill Color</span><div class="property-inline property-color-controls"><input id="fillColorProperty" aria-label="Fill color picker" type="color" value="#ffffff" disabled /><input id="fillExpressionProperty" aria-label="Fill hex or expression" type="text" value="#ffffff" spellcheck="false" disabled /></div></div>
    <div class="property-row"><span>Fill Opacity</span><div class="property-inline opacity-controls"><input id="fillOpacitySlider" aria-label="Fill opacity slider" type="range" min="0" max="100" step="1" value="100" disabled /><input id="fillOpacityExpression" aria-label="Fill opacity expression" type="text" value="100" spellcheck="false" disabled /></div></div>
    <label class="property-row" for="strokeThicknessProperty"><span>Stroke Thickness</span><input id="strokeThicknessProperty" type="number" min="0.1" max="40" step="0.1" value="1.5" disabled /></label>
    <div class="property-row"><span>Stroke Opacity</span><div class="property-inline opacity-controls"><input id="strokeOpacitySlider" aria-label="Stroke opacity slider" type="range" min="0" max="100" step="1" value="100" disabled /><input id="strokeOpacityExpression" aria-label="Stroke opacity expression" type="text" value="100" spellcheck="false" disabled /></div></div>
    <label class="property-row" for="zIndexProperty"><span>Z-Index</span><select id="zIndexProperty" disabled>
      <option value="">Arrange...</option>
      <option value="front">Bring to Front</option>
      <option value="back">Send to Back</option>
      <option value="forward">Bring Forward</option>
      <option value="backward">Send Backward</option>
    </select></label>
    <label class="property-row construction-property-row" for="constructionProperty"><span>Construction</span><input id="constructionProperty" type="checkbox" disabled /></label>`, 'class="floating-panel properties-panel" id="propertiesPanel" aria-label="Properties" hidden');
}

function modal(html) {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop"><div class="modal"><button class="close" aria-label="Close" title="Close">x</button>${html}</div></div>`);
  document.querySelector('.close').onclick = () => document.querySelector('.modal-backdrop').remove();
}

document.getElementById('openButton').onclick = () => modal(`<h2>Open Drawing</h2><p>JSON represented drawings are partitioned by SQL-backed directories.</p>${directories.map((dir) => `<section><h3>${dir.name}</h3><div class="file-cards">${dir.files.map((f) => `<article class="file-card"><div class="thumb">${icon(f.thumbnail)}</div><strong>${drawingName(f.name)}</strong><span>${f.entities} entities - Updated ${f.updatedAt}</span></article>`).join('')}</div></section>`).join('')}`);
document.getElementById('parametersButton').onclick = () => openParametersModal(solverController, canvasController);

function safeFileName(name, extension) {
  const base = drawingName(name || 'Untitled Drawing').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'Untitled Drawing';
  return `${base}.${extension}`;
}

function downloadText(content, fileName, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

async function readDrawingFile(file, mode) {
  if (!file) return;
  try {
    const drawing = parseDrawingText(file.name, await file.text());
    if (mode === 'import') {
      canvasController.loadDrawingData(drawing);
      filenameInput.value = drawingName(file.name.replace(/\.(json|dxf)$/i, ''));
      resizeFilenameInput();
    } else {
      canvasController.insertDrawingData(drawing);
    }
    updateDrawingActionState();
  } catch (error) {
    modal(`<h2>${mode === 'import' ? 'Import' : 'Insert'} failed</h2><p>${escapeHtml(error.message)}</p>`);
  }
}

document.getElementById('importButton').addEventListener('click', () => document.getElementById('importFileInput').click());
document.getElementById('insertButton').addEventListener('click', () => document.getElementById('insertFileInput').click());
document.getElementById('importFileInput').addEventListener('change', async (event) => {
  await readDrawingFile(event.target.files[0], 'import');
  event.target.value = '';
});
document.getElementById('insertFileInput').addEventListener('change', async (event) => {
  await readDrawingFile(event.target.files[0], 'insert');
  event.target.value = '';
});
document.getElementById('insertImageButton').addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'image' } }));
  document.getElementById('imageFileInput').click();
});
document.getElementById('imageFileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const canvasElement = canvasController.getCanvasElement();
    const bounds = canvasElement.getBoundingClientRect();
    const center = canvasController.screenToWorld(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    canvasController.addImage(await createImageEntityFromFile(file, { center }));
    updateDrawingActionState();
  } catch (error) {
    modal(`<h2>Insert image failed</h2><p>${escapeHtml(error.message)}</p>`);
  }
});

document.querySelectorAll('[data-export-format]').forEach((button) => {
  button.addEventListener('click', () => {
    const snapshot = canvasController.getDrawingData();
    const name = filenameInput.value || 'Untitled Drawing';
    if (button.dataset.exportFormat === 'json') {
      downloadText(serializeDrawingJson(snapshot, name), safeFileName(name, 'json'), 'application/json');
    } else {
      downloadText(serializeDxf(snapshot), safeFileName(name, 'dxf'), 'application/dxf');
    }
  });
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function openParametersModal(solver, canvas) {
  modal(`<div class="parameters-modal-content">
    <div class="parameters-heading"><h2>Parameters</h2><button type="button" class="parameters-help-button" aria-label="Expression help" title="Expression help">?</button></div>
    <p class="parameters-note">Local to this drawing. Dimensions are added automatically as d1, d2, d3, and can be referenced from expressions.</p>
    <div class="parameters-table-scroll" tabindex="0" aria-label="Scrollable drawing parameters">
      <table class="parameters-table" aria-label="Drawing parameters">
        <thead><tr><th>Name</th><th>Type</th><th>Expression</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <p class="parameters-help">Operators: + - * / ^, comparisons, &&, ||, !. Functions: min, max, abs, round, sqrt, pow, clamp, if, and degree-based trig. Units: mm, cm, m, in, deg.</p>
  </div>`);
  const backdrop = document.querySelector('.modal-backdrop');
  backdrop.querySelector('.modal').classList.add('parameters-modal');
  const tableBody = backdrop.querySelector('.parameters-table tbody');
  let selectedId = null;
  let draggingId = null;
  backdrop.querySelector('.parameters-help-button').addEventListener('click', openExpressionHelpModal);

  function rowMarkup(entry) {
    const dimension = entry.kind === 'dimension';
    const computed = dimension && !entry.driving;
    const yesNo = entry.type === 'Yes/No' && !dimension;
    const rowClass = [dimension ? 'dimension-parameter-row' : '', computed ? 'computed-parameter-row' : '', entry.error ? 'invalid-parameter-row' : '', entry.id === selectedId ? 'selected-parameter-row' : ''].filter(Boolean).join(' ');
    const valueText = typeof entry.value === 'boolean' ? (entry.value ? 'Yes' : 'No') : solver.dimensions.formatValue(entry.value, entry.unit);
    const expressionControl = yesNo
      ? `<label class="parameter-boolean-control"><input type="checkbox" class="parameter-boolean" aria-label="${escapeHtml(entry.name)} value" ${entry.value ? 'checked' : ''} /><span>${entry.value ? 'Yes' : 'No'}</span></label>`
      : `<input class="parameter-expression" aria-label="Parameter expression" value="${escapeHtml(entry.expression)}" ${computed ? 'readonly' : ''} aria-invalid="${entry.error ? 'true' : 'false'}" />`;
    return `<tr tabindex="0" class="${rowClass}" data-parameter-id="${escapeHtml(entry.id)}" title="${escapeHtml(entry.error || `Value: ${valueText}`)}">
      <td><input type="hidden" value="${escapeHtml(entry.id)}" /><span class="row-drag-handle" draggable="true" aria-hidden="true" title="Drag to reorder">&#8942;&#8942;</span><input class="parameter-name" aria-label="Parameter name" value="${escapeHtml(entry.name)}" /></td>
      <td><select class="parameter-type" aria-label="Parameter type" ${dimension ? 'disabled' : ''}><option ${entry.type === 'Expression' ? 'selected' : ''}>Expression</option><option ${entry.type === 'Yes/No' ? 'selected' : ''}>Yes/No</option></select></td>
      <td>${expressionControl}</td>
    </tr>`;
  }

  function draftMarkup() {
    return `<tr class="draft-parameter-row" data-draft-parameter>
      <td><span class="row-drag-handle placeholder" aria-hidden="true">&#8942;&#8942;</span><input class="parameter-name" aria-label="New parameter name" placeholder="New parameter" /></td>
      <td><select class="parameter-type" aria-label="New parameter type"><option>Expression</option><option>Yes/No</option></select></td>
      <td><input class="parameter-expression" aria-label="New parameter expression" placeholder="Start typing to add a row" /></td>
    </tr>`;
  }

  function render(focus = null) {
    tableBody.innerHTML = `${solver.parameters().map(rowMarkup).join('')}${draftMarkup()}`;
    bindRows();
    if (focus?.id) {
      const row = tableBody.querySelector(`[data-parameter-id="${CSS.escape(focus.id)}"]`);
      const field = row?.querySelector(focus.selector);
      field?.focus();
      if (field?.setSelectionRange) field.setSelectionRange(field.value.length, field.value.length);
    }
  }

  function updateRowState(row, outcome) {
    if (['converged', 'unchanged'].includes(outcome.result?.status)) canvas.applySolverSnapshot();
    if (outcome.entry?.kind === 'dimension') canvas.updateDimensionParameterName(outcome.entry.id, outcome.entry.name);
    row.classList.toggle('invalid-parameter-row', Boolean(outcome.entry?.error));
    row.title = outcome.entry?.error || `Value: ${solver.dimensions.formatValue(outcome.entry?.value, outcome.entry?.unit)}`;
    row.querySelector('.parameter-expression')?.setAttribute('aria-invalid', String(Boolean(outcome.entry?.error)));
    canvas.notifyObjectChange();
  }

  function syncDependentExpressions(activeId) {
    const entries = new Map(solver.parameters().map((entry) => [entry.id, entry]));
    tableBody.querySelectorAll('[data-parameter-id]').forEach((candidate) => {
      if (candidate.dataset.parameterId === activeId) return;
      const input = candidate.querySelector('.parameter-expression');
      const entry = entries.get(candidate.dataset.parameterId);
      if (input && entry && document.activeElement !== input) input.value = entry.expression;
    });
  }

  function bindRows() {
    tableBody.querySelectorAll('[data-parameter-id]').forEach((row) => {
      const id = row.dataset.parameterId;
      row.addEventListener('pointerdown', (event) => {
        selectedId = id;
        tableBody.querySelectorAll('.selected-parameter-row').forEach((candidate) => candidate.classList.remove('selected-parameter-row'));
        row.classList.add('selected-parameter-row');
        if (!event.target.closest('input, select')) row.focus();
      });
      row.addEventListener('focus', () => {
        selectedId = id;
        row.classList.add('selected-parameter-row');
      });
      row.querySelector('.parameter-name').addEventListener('input', (event) => {
        updateRowState(row, solver.updateParameter(id, { name: event.target.value }));
        syncDependentExpressions(id);
      });
      row.querySelector('.parameter-type').addEventListener('change', (event) => {
        updateRowState(row, solver.updateParameter(id, { type: event.target.value }));
        render({ id, selector: '.parameter-type' });
      });
      const expressionInput = row.querySelector('.parameter-expression');
      if (expressionInput && !expressionInput.readOnly) {
        expressionInput.addEventListener('input', (event) => updateRowState(row, solver.updateParameter(id, { expression: event.target.value })));
      }
      const booleanInput = row.querySelector('.parameter-boolean');
      booleanInput?.addEventListener('change', (event) => {
        const outcome = solver.updateParameter(id, { expression: event.target.checked ? 'yes' : 'no' });
        booleanInput.nextElementSibling.textContent = event.target.checked ? 'Yes' : 'No';
        updateRowState(row, outcome);
      });
      row.addEventListener('dragstart', (event) => {
        if (!event.target.closest('.row-drag-handle')) {
          event.preventDefault();
          return;
        }
        draggingId = id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
        row.classList.add('dragging-parameter-row');
      });
      row.addEventListener('dragend', () => {
        draggingId = null;
        row.classList.remove('dragging-parameter-row');
      });
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const movingId = draggingId || event.dataTransfer.getData('text/plain');
        if (movingId && movingId !== id) {
          solver.reorderParameter(movingId, id);
          canvas.notifyObjectChange();
        }
        render();
      });
    });

    const draftRow = tableBody.querySelector('[data-draft-parameter]');
    const draftName = draftRow.querySelector('.parameter-name');
    const draftType = draftRow.querySelector('.parameter-type');
    const draftExpression = draftRow.querySelector('.parameter-expression');
    const createFromDraft = (source) => {
      if (!draftName.value.trim() && !draftExpression.value.trim()) return;
      const entry = solver.createParameter({ name: draftName.value.trim(), type: draftType.value, expression: draftExpression.value || (draftType.value === 'Yes/No' ? 'no' : '') });
      canvas.notifyObjectChange();
      selectedId = entry.id;
      render({ id: entry.id, selector: source === draftName ? '.parameter-name' : '.parameter-expression' });
    };
    draftName.addEventListener('input', () => createFromDraft(draftName), { once: true });
    draftExpression.addEventListener('input', () => createFromDraft(draftExpression), { once: true });
  }

  backdrop.addEventListener('keydown', (event) => {
    if ((event.key !== 'Delete' && event.key !== 'Backspace') || !selectedId) return;
    if (event.target.closest('input, select')) return;
    const entry = solver.dimensions.get(selectedId);
    if (entry?.kind === 'dimension') return;
    event.preventDefault();
    solver.removeParameter(selectedId);
    canvas.notifyObjectChange();
    selectedId = null;
    render();
  });

  render();
}

function openExpressionHelpModal() {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop expression-help-backdrop">
    <div class="modal expression-help-modal" role="dialog" aria-modal="true" aria-labelledby="expressionHelpTitle">
      <button class="close expression-help-close" aria-label="Close" title="Close">x</button>
      <h2 id="expressionHelpTitle">Expression examples</h2>
      <section><h3>Conditional values</h3><p><code>if(condition, value_when_true, value_when_false)</code></p><pre>if(test_YN, 600 mm, 50 mm)</pre><p>If <code>test_YN</code> is checked, the result is 600 mm; otherwise it is 50 mm.</p></section>
      <section><h3>Parameter references and arithmetic</h3><pre>plate_width / 2 + 10 mm</pre><pre>d1 - 25 mm</pre></section>
      <section><h3>Comparisons and logic</h3><pre>width &gt;= 100 mm</pre><pre>enabled &amp;&amp; width &lt; 500 mm</pre><pre>!disabled</pre></section>
      <section><h3>Functions</h3><pre>max(25 mm, width / 4)</pre><pre>clamp(width, 100 mm, 600 mm)</pre><pre>round(sqrt(area))</pre><pre>sin(30) * 100 mm</pre></section>
      <section><h3>Units and constants</h3><p>Units: <code>mm</code>, <code>cm</code>, <code>m</code>, <code>in</code>, <code>deg</code>. Constants: <code>pi</code>, <code>e</code>, <code>yes</code>, <code>no</code>, <code>true</code>, <code>false</code>.</p></section>
    </div>
  </div>`);
  const helpBackdrop = document.querySelector('.expression-help-backdrop');
  const close = () => helpBackdrop.remove();
  helpBackdrop.querySelector('.expression-help-close').addEventListener('click', close);
  helpBackdrop.addEventListener('pointerdown', (event) => { if (event.target === helpBackdrop) close(); });
  helpBackdrop.querySelector('.expression-help-close').focus();
}

const constraintToggle = constraintTool.querySelector('.menu-toggle');
let constraintMenuCloseTimer = null;
constraintMenu.querySelector('[data-constraint="Coincident"]')?.classList.add('stored-constraint');

function showConstraintMenu() {
  clearTimeout(constraintMenuCloseTimer);
  const rect = constraintToggle.getBoundingClientRect();
  constraintMenu.style.left = `${rect.left}px`;
  constraintMenu.style.top = `${rect.bottom + 4}px`;
  constraintTool.classList.add('open');
  constraintMenu.classList.add('open');
  constraintToggle.setAttribute('aria-expanded', 'true');
}

function hideConstraintMenu() {
  clearTimeout(constraintMenuCloseTimer);
  constraintTool.classList.remove('open');
  constraintMenu.classList.remove('open');
  constraintToggle.setAttribute('aria-expanded', 'false');
}

function scheduleConstraintMenuClose() {
  clearTimeout(constraintMenuCloseTimer);
  constraintMenuCloseTimer = setTimeout(hideConstraintMenu, 120);
}

constraintToggle.addEventListener('pointerenter', showConstraintMenu);
constraintToggle.addEventListener('pointerleave', scheduleConstraintMenuClose);
constraintMenu.addEventListener('pointerenter', () => clearTimeout(constraintMenuCloseTimer));
constraintMenu.addEventListener('pointerleave', scheduleConstraintMenuClose);
constraintToggle.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown') return;
  event.preventDefault();
  showConstraintMenu();
  constraintMenu.querySelector('button')?.focus();
});

function deactivateConstraintSelection() {
  constraintController?.deactivate();
  constraintToggle.setAttribute('aria-pressed', 'false');
  constraintToggle.classList.remove('active');
}

function activateStoredConstraint() {
  const selected = constraintToggle.dataset.selectedConstraint || 'Coincident';
  constraintToggle.setAttribute('aria-pressed', 'true');
  constraintToggle.classList.add('active');
  constraintController?.setActiveConstraint(selected);
  window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'constraint' } }));
}

constraintToggle.addEventListener('click', () => {
  if (constraintToggle.getAttribute('aria-pressed') === 'true') deactivateConstraintSelection();
  else activateStoredConstraint();
});

document.querySelectorAll('[data-constraint]').forEach((button) => {
  button.addEventListener('click', (event) => {
    const selected = event.currentTarget.getAttribute('data-constraint');
    hideConstraintMenu();
    constraintToggle.innerHTML = icon(selected);
    constraintToggle.title = selected;
    constraintToggle.setAttribute('aria-label', `${selected} constraint`);
    constraintToggle.setAttribute('data-selected-constraint', selected);
    constraintMenu.querySelectorAll('[data-constraint]').forEach((candidate) => {
      const stored = candidate.dataset.constraint === selected;
      candidate.classList.toggle('stored-constraint', stored);
      if (stored) candidate.setAttribute('aria-current', 'true');
      else candidate.removeAttribute('aria-current');
    });
    activateStoredConstraint();
  });
});

window.addEventListener('paramagic:tool-activated', (event) => {
  if (event.detail?.source !== 'constraint') deactivateConstraintSelection();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('button');
  if (!button || button === constraintToggle || constraintMenu.contains(button)) return;
  deactivateConstraintSelection();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  hideConstraintMenu();
  deactivateConstraintSelection();
});

document.querySelectorAll('[data-toggle-button]').forEach((button) => {
  button.addEventListener('click', () => {
    const isPressed = button.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-pressed', String(!isPressed));
    button.classList.toggle('active', !isPressed);
    window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'drawing' } }));
  });
});

document.querySelectorAll('.floating-panel').forEach((panelElement) => {
  let drag;
  panelElement.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button, input, select, textarea, label')) return;
    drag = { x: event.clientX, y: event.clientY, transform: new DOMMatrix(getComputedStyle(panelElement).transform) };
    panelElement.setPointerCapture(event.pointerId);
  });
  panelElement.addEventListener('pointermove', (event) => {
    if (!drag) return;
    panelElement.style.transform = `translate(${drag.transform.e + event.clientX - drag.x}px, ${drag.transform.f + event.clientY - drag.y}px)`;
  });
  panelElement.addEventListener('pointerup', () => {
    drag = null;
  });
});

const solverController = createSolverController();
const solverStatus = document.getElementById('solverStatus');
solverController.subscribe((_snapshot, result) => {
  const failed = result && !['converged', 'unchanged'].includes(result.status);
  solverStatus.hidden = !failed;
  solverStatus.textContent = failed ? result.message : '';
});
const canvasController = createInfiniteCanvas({
  canvas: document.getElementById('canvas'),
  grid: document.getElementById('grid'),
  svg: document.getElementById('drawingPlane'),
  status: document.getElementById('statusPill'),
  reset: document.getElementById('resetView'),
  entities: sampleEntities,
  solver: solverController,
});
document.querySelectorAll('[data-drawing-aid]').forEach((button) => {
  button.classList.add('active');
  button.addEventListener('click', () => {
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    button.classList.toggle('active', enabled);
    if (button.dataset.drawingAid === 'auto-constrain') canvasController.setAutoConstrainEnabled(enabled);
    if (button.dataset.drawingAid === 'object-snap') canvasController.setObjectSnapEnabled(enabled);
  });
});
const propertiesToggle = document.getElementById('propertiesToggle');
const propertiesPanelElement = document.getElementById('propertiesPanel');
const propertiesSelectionStatus = document.getElementById('propertiesSelectionStatus');
const fillColorProperty = document.getElementById('fillColorProperty');
const fillExpressionProperty = document.getElementById('fillExpressionProperty');
const fillOpacitySlider = document.getElementById('fillOpacitySlider');
const fillOpacityExpression = document.getElementById('fillOpacityExpression');
const strokeThicknessProperty = document.getElementById('strokeThicknessProperty');
const strokeOpacitySlider = document.getElementById('strokeOpacitySlider');
const strokeOpacityExpression = document.getElementById('strokeOpacityExpression');
const zIndexProperty = document.getElementById('zIndexProperty');
const constructionProperty = document.getElementById('constructionProperty');

propertiesToggle.addEventListener('click', () => {
  const visible = propertiesPanelElement.hidden;
  propertiesPanelElement.hidden = !visible;
  propertiesToggle.classList.toggle('active', visible);
  propertiesToggle.setAttribute('aria-pressed', String(visible));
});

canvasController.onSelectionChange((properties) => {
  const editable = properties.supportedCount > 0;
  [fillColorProperty, fillExpressionProperty].forEach((control) => { control.disabled = !properties.canEditFill; });
  [fillOpacitySlider, fillOpacityExpression].forEach((control) => { control.disabled = !properties.canEditOpacity; });
  [strokeThicknessProperty, strokeOpacitySlider, strokeOpacityExpression].forEach((control) => { control.disabled = !properties.canEditStroke; });
  zIndexProperty.disabled = !editable;
  constructionProperty.disabled = !properties.canEditConstruction;
  if (!properties.selectionCount) propertiesSelectionStatus.textContent = 'No objects selected';
  else if (properties.imageCount === 1 && !properties.geometryCount) propertiesSelectionStatus.textContent = `Image selected${properties.locked ? ' (locked)' : ''}`;
  else if (!properties.geometryCount && !properties.imageCount) propertiesSelectionStatus.textContent = 'No editable objects selected';
  else {
    const objectCount = properties.geometryCount + properties.imageCount;
    propertiesSelectionStatus.textContent = `${objectCount} object${objectCount === 1 ? '' : 's'} selected`;
  }
  fillColorProperty.value = properties.fillColor || '#ffffff';
  fillColorProperty.dataset.mixed = String(properties.mixedFill);
  fillColorProperty.title = properties.mixedFill ? 'Mixed fill colors' : 'Fill Color';
  if (document.activeElement !== fillExpressionProperty) fillExpressionProperty.value = properties.fillExpression ?? '';
  fillExpressionProperty.placeholder = properties.mixedFill ? 'Mixed' : '#ffffff or expression';
  fillExpressionProperty.setAttribute('aria-invalid', String(Boolean(properties.errors?.fill)));
  fillExpressionProperty.title = properties.errors?.fill || 'Hex color, numeric expression, or parameter name';
  fillOpacitySlider.value = properties.fillOpacity === null ? 100 : Math.round(properties.fillOpacity * 100);
  if (document.activeElement !== fillOpacityExpression) fillOpacityExpression.value = properties.fillOpacityExpression ?? '';
  fillOpacityExpression.placeholder = properties.mixedFillOpacity ? 'Mixed' : '0–100';
  fillOpacityExpression.setAttribute('aria-invalid', String(Boolean(properties.errors?.fillOpacity)));
  fillOpacityExpression.title = properties.errors?.fillOpacity || 'Expression or parameter name from 0 to 100';
  strokeThicknessProperty.value = properties.strokeThickness ?? '';
  strokeThicknessProperty.placeholder = properties.mixedStroke ? 'Mixed' : '';
  strokeThicknessProperty.title = properties.mixedStroke ? 'Mixed stroke thicknesses' : 'Stroke Thickness';
  strokeOpacitySlider.value = properties.strokeOpacity === null ? 100 : Math.round(properties.strokeOpacity * 100);
  if (document.activeElement !== strokeOpacityExpression) strokeOpacityExpression.value = properties.strokeOpacityExpression ?? '';
  strokeOpacityExpression.placeholder = properties.mixedStrokeOpacity ? 'Mixed' : '0–100';
  strokeOpacityExpression.setAttribute('aria-invalid', String(Boolean(properties.errors?.strokeOpacity)));
  strokeOpacityExpression.title = properties.errors?.strokeOpacity || 'Expression or parameter name from 0 to 100';
  constructionProperty.checked = properties.construction;
  constructionProperty.indeterminate = properties.mixedConstruction;
});

fillColorProperty.addEventListener('input', () => {
  fillExpressionProperty.value = fillColorProperty.value;
  canvasController.setSelectedGeometryAppearance({ fillExpression: fillColorProperty.value });
});
fillExpressionProperty.addEventListener('change', () => canvasController.setSelectedGeometryAppearance({ fillExpression: fillExpressionProperty.value }));
fillExpressionProperty.addEventListener('keydown', (event) => { if (event.key === 'Enter') fillExpressionProperty.blur(); });
fillOpacitySlider.addEventListener('input', () => {
  fillOpacityExpression.value = fillOpacitySlider.value;
  canvasController.setSelectedGeometryAppearance({ fillOpacityExpression: fillOpacitySlider.value });
});
fillOpacityExpression.addEventListener('change', () => canvasController.setSelectedGeometryAppearance({ fillOpacityExpression: fillOpacityExpression.value }));
fillOpacityExpression.addEventListener('keydown', (event) => { if (event.key === 'Enter') fillOpacityExpression.blur(); });
strokeThicknessProperty.addEventListener('input', () => {
  if (!strokeThicknessProperty.value) return;
  canvasController.setSelectedGeometryAppearance({ strokeThickness: Number(strokeThicknessProperty.value) });
});
strokeOpacitySlider.addEventListener('input', () => {
  strokeOpacityExpression.value = strokeOpacitySlider.value;
  canvasController.setSelectedGeometryAppearance({ strokeOpacityExpression: strokeOpacitySlider.value });
});
strokeOpacityExpression.addEventListener('change', () => canvasController.setSelectedGeometryAppearance({ strokeOpacityExpression: strokeOpacityExpression.value }));
strokeOpacityExpression.addEventListener('keydown', (event) => { if (event.key === 'Enter') strokeOpacityExpression.blur(); });
zIndexProperty.addEventListener('change', () => {
  if (zIndexProperty.value) canvasController.arrangeSelectedGeometry(zIndexProperty.value);
  zIndexProperty.value = '';
});
constructionProperty.addEventListener('change', () => {
  constructionProperty.indeterminate = false;
  canvasController.setSelectedConstruction(constructionProperty.checked);
});
const dimensionTextModeButton = document.getElementById('dimensionTextMode');
const dimensionTextModes = [
  { mode: 'named-value', label: 'Dimension Text: Named Value' },
  { mode: 'value', label: 'Dimension Text: Value Only' },
  { mode: 'expression', label: 'Dimension Text: Expression' },
];
dimensionTextModeButton.addEventListener('click', () => {
  const current = dimensionTextModes.findIndex(({ mode }) => mode === dimensionTextModeButton.dataset.dimensionTextMode);
  const next = dimensionTextModes[(current + 1) % dimensionTextModes.length];
  const accessibleLabel = next.mode === 'value' ? 'Dimension Text: Value Only (Hide Driving)' : next.label;
  dimensionTextModeButton.dataset.dimensionTextMode = next.mode;
  dimensionTextModeButton.title = accessibleLabel;
  dimensionTextModeButton.setAttribute('aria-label', accessibleLabel);
  dimensionTextModeButton.innerHTML = icon(next.label);
  canvasController.setDimensionTextMode(next.mode);
  constraintController?.setHelpersVisible(next.mode !== 'value');
});
canvasController.setDimensionTextMode('named-value');
constraintController = createConstraintHandlers({
  canvas: canvasController,
  solver: solverController,
});
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
const drawingHistory = new DrawingHistory({
  capture: () => ({ name: filenameInput.value, drawing: canvasController.getDrawingData() }),
  restore: (state) => {
    filenameInput.value = state.name || '';
    resizeFilenameInput();
    canvasController.loadDrawingData(state.drawing, { zoomToFit: false });
    const mode = dimensionTextModeButton.dataset.dimensionTextMode;
    canvasController.setDimensionTextMode(mode);
    constraintController.setHelpersVisible(mode !== 'value');
    updateDrawingActionState();
  },
  onChange: ({ canUndo, canRedo }) => {
    undoButton.disabled = !canUndo;
    redoButton.disabled = !canRedo;
  },
});
function runHistoryAction(action) {
  window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'history' } }));
  return action === 'undo' ? drawingHistory.undo() : drawingHistory.redo();
}
undoButton.addEventListener('click', () => runHistoryAction('undo'));
redoButton.addEventListener('click', () => runHistoryAction('redo'));
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (document.querySelector('.modal-backdrop')) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) {
    if (runHistoryAction('undo')) event.preventDefault();
    return;
  }
  if ((key === 'z' && event.shiftKey) || key === 'y') {
    if (runHistoryAction('redo')) event.preventDefault();
  }
});
document.getElementById('newButton').onclick = () => {
  window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'new' } }));
  filenameInput.value = '';
  resizeFilenameInput();
  canvasController.clearDrawing();
  updateDrawingActionState();
};
canvasController.onObjectsChange(() => {
  updateDrawingActionState();
  drawingHistory.recordSoon();
});
filenameInput.addEventListener('input', updateDrawingActionState);
filenameInput.addEventListener('blur', updateDrawingActionState);
filenameInput.addEventListener('input', () => drawingHistory.recordSoon());
updateDrawingActionState();

createDrawingTools({
  toolbar: document.querySelector('.drawing-tools'),
  canvas: canvasController,
});

createSmartDimensionTools({
  toolbar: document.querySelector('.dimension-toggles'),
  canvas: canvasController,
});
