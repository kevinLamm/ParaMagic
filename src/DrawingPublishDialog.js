import { drawingMetadataFieldsMarkup, readDrawingMetadataFields } from './DrawingMetadataFields.js';

export function openPublishDialog({ modal, canvas }) {
  modal(`<form class="drawing-publish-modal-content">
    <h2>Publish Drawing</h2>
    ${drawingMetadataFieldsMarkup(canvas.getDocumentMetadata(), 'publish')}
    <p class="drawing-publish-note">Review the drawing details before submitting. Server publishing is not connected yet.</p>
    <p class="drawing-publish-status" role="status" hidden></p>
    <div class="drawing-publish-actions"><button type="submit">Submit</button></div>
  </form>`);
  const backdrop = document.querySelector('.modal-backdrop');
  const dialog = backdrop.querySelector('.modal');
  dialog.classList.add('drawing-publish-modal');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Publish Drawing');
  const form = dialog.querySelector('form');
  const status = form.querySelector('.drawing-publish-status');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const details = readDrawingMetadataFields(form);
    const previous = canvas.getDocumentMetadata();
    if (Object.entries(details).some(([key, value]) => value !== previous[key])) {
      canvas.requestHistoryCheckpoint?.('publish-metadata');
      canvas.setDocumentMetadata(details);
    }
    // The future server integration belongs here, after the metadata is committed.
    // Do not report a publication until the server has actually accepted a drawing.
    status.textContent = 'These details are kept in your drawing. It has not been published because the drawing server is not connected yet.';
    status.hidden = false;
  });
  form.addEventListener('input', () => { status.hidden = true; });
  form.querySelector('textarea').focus();
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') backdrop.remove();
  });
}
