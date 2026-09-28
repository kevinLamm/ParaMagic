import { createPublishingDialog, loadAccountPanel } from './PublishingDialog.js';

export function openFindDrawingsDialog({ modal, client }) {
  const view = createPublishingDialog(modal, 'Find drawings', `<section class="drawing-publish-modal-content">
    <h2>Find drawings</h2><section class="publishing-account" aria-label="Publishing account"></section>
    <p>Search descriptions shared by their owners. A match on any keyword is enough. Viewers can adjust controls and export PNG or DXF.</p>
    <form class="drawing-search"><label for="drawingKeywords">Keywords</label>
      <input id="drawingKeywords" type="search" maxlength="500" placeholder="For example: chair ottoman" required />
      <button type="submit" disabled>Search</button></form>
    <p role="status" data-status></p><ul class="published-drawings"></ul><button type="button" data-more hidden>Load more</button>
  </section>`);
  const form = view.dialog.querySelector('form'); const input = form.querySelector('input');
  const submit = form.querySelector('button'); const list = view.dialog.querySelector('ul');
  const status = view.dialog.querySelector('[data-status]'); const more = view.dialog.querySelector('[data-more]');
  let next = null; let query = ''; let generation = 0; let signedIn = false;
  async function search(append) {
    const current = ++generation; submit.disabled = true; more.disabled = true;
    if (!append) { list.replaceChildren(); query = input.value.trim(); }
    status.textContent = 'Searching descriptions…';
    try {
      const result = await client.search(query, append ? next : '');
      if (view.signal.aborted || current !== generation) return;
      for (const drawing of result.drawings) {
        const item = document.createElement('li'); const name = document.createElement('strong'); name.textContent = drawing.name;
        const description = document.createElement('p'); description.textContent = drawing.description;
        const open = document.createElement('a'); open.href = `/?view=${drawing.id}`; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Open viewer';
        item.append(name, description, open); list.append(item);
      }
      next = result.next; more.hidden = !next;
      status.textContent = list.children.length ? `${list.children.length} matching drawing${list.children.length === 1 ? '' : 's'} shown.` : 'No shared descriptions match these keywords.';
    } catch (error) { if (current === generation) status.textContent = error.message; }
    finally { if (current === generation) { submit.disabled = !signedIn; more.disabled = false; } }
  }
  form.onsubmit = event => { event.preventDefault(); if (signedIn) search(false); };
  more.onclick = () => search(true);
  loadAccountPanel(view.dialog.querySelector('.publishing-account'), client, { signal: view.signal, onChange(account) {
    generation++; signedIn = Boolean(account?.user); submit.disabled = !signedIn; list.replaceChildren(); more.hidden = true;
    status.textContent = signedIn ? 'Enter keywords from a drawing description.' : 'Sign in to search shared drawings.';
  } });
  input.focus();
}
