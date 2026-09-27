const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function drawingMetadataFieldsMarkup(metadata = {}, prefix = 'drawing') {
  return `<label class="drawing-description-field" for="${prefix}DescriptionProperty">
    <span>Drawing Description</span>
    <textarea id="${prefix}DescriptionProperty" name="drawingDescription" rows="4" placeholder="Describe this drawing…">${escapeHtml(metadata.drawingDescription)}</textarea>
  </label>
  <label class="drawing-developers-field" for="${prefix}DevelopersProperty">
    <span>Developer(s)</span>
    <input id="${prefix}DevelopersProperty" name="developers" type="text" value="${escapeHtml(metadata.developers)}" />
  </label>`;
}

export function readDrawingMetadataFields(root) {
  return Object.fromEntries(['drawingDescription', 'developers'].map((key) => (
    [key, root.querySelector(`[name="${key}"]`).value]
  )));
}
