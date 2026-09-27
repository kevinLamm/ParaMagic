import { DOCUMENT_VARIABLE_SPECS } from '@paramagic/core/editor';
import { formatUnitlessValue } from '@paramagic/core/solver';
import { drawingMetadataFieldsMarkup } from './DrawingMetadataFields.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function createDrawingPropertiesDialogs({ canvas, modal, mountAdditionalProperties = () => {} }) {
  const drawingUnitOptions = [
    ['in', 'Inches'],
    ['mm', 'Millimeters'],
    ['cm', 'Centimeters'],
    ['m', 'Meters'],
    ['ft', 'Feet'],
  ];

  function openDrawingPropertiesModal() {
    const properties = canvas.getDrawingProperties();
    const metadata = canvas.getDocumentMetadata();
    const options = (selected) => drawingUnitOptions
      .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`)
      .join('');
    modal(`<div class="drawing-properties-modal-content">
      <h2>Drawing Properties</h2>
      ${drawingMetadataFieldsMarkup(metadata)}
      <p class="drawing-properties-note">Dimension and parameter expressions use the drawing unit automatically. Unit suffixes are not required.</p>
      <label class="drawing-property-field" for="drawingUnitProperty">
        <span>Drawing Units</span>
        <select id="drawingUnitProperty">${options(properties.drawingUnit)}</select>
      </label>
      <label class="drawing-property-field" for="dxfExportUnitProperty">
        <span>DXF Export Unit</span>
        <select id="dxfExportUnitProperty">${options(properties.dxfExportUnit)}</select>
      </label>
      <label class="drawing-property-field" for="filletRadiusProperty">
        <span>Fillet Radius</span>
        <input id="filletRadiusProperty" type="number" min="0.000001" step="any" value="${escapeHtml(properties.filletRadius)}" />
      </label>
      <button type="button" class="document-variables-button" id="documentVariablesButton">Document Variables…</button>
      <p class="drawing-properties-footnote">The DXF setting changes exported coordinates only; it does not resize the drawing.</p>
    </div>`);
    const backdrop = document.querySelector('.modal-backdrop');
    backdrop.querySelector('.modal').classList.add('drawing-properties-modal');
    const drawingUnit = backdrop.querySelector('#drawingUnitProperty');
    const dxfExportUnit = backdrop.querySelector('#dxfExportUnitProperty');
    const filletRadius = backdrop.querySelector('#filletRadiusProperty');
    ['drawingDescription', 'developers'].forEach((key) => {
      backdrop.querySelector(`[name="${key}"]`).addEventListener('input', (event) => {
        canvas.setDocumentMetadata({ [key]: event.target.value });
      });
    });
    backdrop.querySelector('#documentVariablesButton').addEventListener('click', () => {
      backdrop.remove();
      openDocumentVariablesModal();
    });
    mountAdditionalProperties(backdrop.querySelector('.drawing-properties-modal-content'));
    const apply = () => canvas.setDrawingProperties({
      drawingUnit: drawingUnit.value,
      dxfExportUnit: dxfExportUnit.value,
      filletRadius: filletRadius.value,
    });
    drawingUnit.addEventListener('change', apply);
    dxfExportUnit.addEventListener('change', apply);
    const applyFilletRadius = () => {
      const value = Number(filletRadius.value);
      if (Number.isFinite(value) && value > 0) apply();
    };
    filletRadius.addEventListener('input', applyFilletRadius);
    filletRadius.addEventListener('change', () => {
      if (Number(filletRadius.value) > 0) return;
      filletRadius.value = canvas.getDrawingProperties().filletRadius;
    });
    drawingUnit.focus();
  }

  function openDocumentVariablesModal() {
    const values = new Map(canvas.getDocumentVariables().map((entry) => [entry.name, entry]));
    const specs = DOCUMENT_VARIABLE_SPECS.map((spec) => {
      const entry = values.get(spec.name);
      const value = typeof entry?.value === 'number'
        ? formatUnitlessValue(entry.value, entry.unit)
        : entry?.value ?? '';
      return { ...spec, value };
    });
    const rows = specs.map((spec) => `
      <tr data-document-variable="${escapeHtml(spec.name)}">
        <td><code>${escapeHtml(spec.name)}</code><small>${escapeHtml(spec.label)}</small></td>
        <td>${spec.multiline
    ? `<textarea class="document-variable-value" aria-label="${escapeHtml(spec.label)}" rows="4">${escapeHtml(spec.value)}</textarea>`
    : `<input class="document-variable-value" aria-label="${escapeHtml(spec.label)}" value="${escapeHtml(spec.value)}" ${spec.readOnly ? 'readonly' : ''} />`}</td>
        <td><span class="document-variable-state">${spec.readOnly ? 'Automatic' : 'Editable'}</span></td>
      </tr>`).join('');
    modal(`<div class="document-variables-modal-content">
      <div class="document-variables-heading"><button type="button" id="documentVariablesBack" class="document-variables-back">‹ Drawing Properties</button><h2>Document Variables</h2></div>
      <p class="drawing-properties-note">Use variables such as <code>[DrawingNumber]</code> and <code>[CurrentDate]</code> in text fields and parameter expressions.</p>
      <div class="document-variables-table-scroll">
        <table class="document-variables-table" aria-label="Document variables">
          <thead><tr><th>Variable</th><th>Value</th><th>Source</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`);
    const backdrop = document.querySelector('.modal-backdrop');
    backdrop.querySelector('.modal').classList.add('document-variables-modal');
    const specByName = new Map(specs.map((spec) => [spec.name, spec]));
    backdrop.querySelectorAll('[data-document-variable]').forEach((row) => {
      const spec = specByName.get(row.dataset.documentVariable);
      if (!spec || spec.readOnly) return;
      row.querySelector('.document-variable-value').addEventListener('input', (event) => {
        canvas.setDocumentMetadata({ [spec.key]: event.target.value });
      });
    });
    backdrop.querySelector('#documentVariablesBack').addEventListener('click', () => {
      backdrop.remove();
      openDrawingPropertiesModal();
    });
  }

  return { openProperties: openDrawingPropertiesModal, openVariables: openDocumentVariablesModal };
}
