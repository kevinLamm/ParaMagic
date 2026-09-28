import { drawingMetadataFieldsMarkup, readDrawingMetadataFields } from './DrawingMetadataFields.js';
import { createPublishingDialog, loadAccountPanel } from './PublishingDialog.js';

export function openPublishDialog({ modal, canvas, client, getName, serialize, openMyDrawings }) {
  const view = createPublishingDialog(modal, 'Publish Drawing', `<section class="drawing-publish-modal-content">
    <h2>Publish Drawing</h2>
    <section class="publishing-account" aria-label="Publishing account"></section>
    ${drawingMetadataFieldsMarkup(canvas.getDocumentMetadata(), 'publish')}
    <label class="publishing-discovery"><input type="checkbox" name="searchable" /> Allow signed-in users to find and view this drawing</label>
    <p class="drawing-publish-note">Viewers can adjust your controls and export PNG or DXF. They cannot edit the drawing or save a ParaMagic file. You can change discovery or delete the stored copy in My drawings.</p>
    <p class="drawing-publish-status" role="status">Sign in to publish.</p>
    <div class="publishing-result" hidden></div>
    <div class="drawing-publish-actions">
      <button type="button" data-action="manage">My drawings</button>
      <button type="button" data-action="cancel" hidden>Cancel upload</button>
      <button type="button" data-action="publish" disabled>Publish drawing</button>
    </div>
  </section>`);
  const form = view.dialog.querySelector('.drawing-publish-modal-content');
  const status = form.querySelector('.drawing-publish-status');
  const accountPanel = form.querySelector('.publishing-account');
  const publishButton = form.querySelector('[data-action="publish"]');
  const cancelButton = form.querySelector('[data-action="cancel"]');
  const manageButton = form.querySelector('[data-action="manage"]');
  const result = form.querySelector('.publishing-result');
  let account;
  let inProgress = false;
  manageButton.onclick = () => { view.close(); openMyDrawings(); };
  loadAccountPanel(accountPanel, client, { signal: view.signal, onChange(value) {
    account = value;
    publishButton.disabled = !account?.user || !account?.publishingEnabled;
    status.textContent = !account ? 'Publishing is currently unavailable.' : !account.publishingEnabled
      ? 'Publishing is paused while storage is being configured.' : !account.user ? 'Sign in to publish.' : 'Ready to publish.';
    result.hidden = true;
  } });
  publishButton.addEventListener('click', async event => {
    event.preventDefault();
    if (inProgress || !account?.user || !account.publishingEnabled) return;
    inProgress = true;
    const upload = new AbortController();
    view.lock(true); publishButton.disabled = true; manageButton.disabled = true;
    accountPanel.inert = true;
    form.querySelectorAll('input, textarea').forEach(input => { input.disabled = true; });
    cancelButton.hidden = false; cancelButton.onclick = () => upload.abort(); result.hidden = true;
    let published = false;
    try {
      const details = readDrawingMetadataFields(form);
      const previous = canvas.getDocumentMetadata();
      if (Object.entries(details).some(([key, value]) => value !== previous[key])) {
        canvas.requestHistoryCheckpoint?.('publish-metadata'); canvas.setDocumentMetadata(details);
      }
      const name = getName();
      status.textContent = 'Preparing the drawing and its images…';
      const content = await serialize(name);
      if (upload.signal.aborted) throw new Error('Upload cancelled.');
      const searchable = form.querySelector('[name="searchable"]').checked;
      const drawing = await client.publish({ name, content, description: details.drawingDescription, searchable, signal: upload.signal,
        onProgress(bytes, total) { status.textContent = `Uploading… ${Math.round(bytes / total * 100)}%`; } });
      status.textContent = 'Drawing published.';
      const link = document.createElement('a'); link.href = drawing.url; link.textContent = 'Download your ParaMagic file';
      link.onclick = async event => {
        event.preventDefault();
        try { await client.download(drawing.id); } catch (error) { status.textContent = error.message; }
      };
      const share = document.createElement('input'); share.readOnly = true;
      share.setAttribute('aria-label', 'Drawing viewer link'); share.value = new URL(`/?view=${drawing.id}`, location.origin).href;
      share.addEventListener('focus', () => share.select());
      result.replaceChildren(link); if (searchable) result.append(share); result.hidden = false; published = true;
    } catch (error) { status.textContent = error.message; }
    finally {
      inProgress = false; view.lock(false); manageButton.disabled = false; accountPanel.inert = false;
      form.querySelectorAll('input, textarea').forEach(input => { input.disabled = false; });
      cancelButton.hidden = true; publishButton.disabled = published;
      if (published) publishButton.textContent = 'Published';
    }
  });
  form.querySelector('textarea').focus();
}
