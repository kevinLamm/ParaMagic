import { createPublishingDialog, loadAccountPanel } from './PublishingDialog.js';

export function openMyDrawingsDialog({ modal, client }) {
  const view = createPublishingDialog(modal, 'My drawings', `<section class="drawing-publish-modal-content">
    <h2>My drawings</h2><section class="publishing-account" aria-label="Publishing account"></section>
    <p>Manage your published copies and choose which ones signed-in users can find and view.</p>
    <p role="status" data-status></p><ul class="published-drawings"></ul>
    <button type="button" data-more hidden>Load more</button>
  </section>`);
  const list = view.dialog.querySelector('ul'); const status = view.dialog.querySelector('[data-status]');
  const more = view.dialog.querySelector('[data-more]');
  let next = null; let generation = 0;
  async function load(append = false) {
    const current = generation;
    status.textContent = 'Loading your drawings…'; more.disabled = true;
    try {
      const response = await client.list(append ? next : '');
      if (view.signal.aborted || generation !== current) return;
      if (!append) list.replaceChildren();
      for (const drawing of response.drawings) {
        const item = document.createElement('li');
        const title = document.createElement('strong'); title.textContent = drawing.name;
        const details = document.createElement('span');
        details.textContent = `${new Intl.NumberFormat().format(drawing.bytes)} bytes · ${new Date(drawing.createdAt).toLocaleDateString()}${drawing.state !== 'published' ? ' · Unfinished upload' : ''}`;
        const actions = document.createElement('div'); actions.className = 'published-drawing-actions';
        if (drawing.url) {
          const link = document.createElement('a'); link.href = drawing.url; link.textContent = 'Download ParaMagic'; actions.append(link);
          const share = document.createElement('button'); share.type = 'button'; share.textContent = 'Show link';
          share.onclick = () => {
            const input = document.createElement('input'); input.readOnly = true;
            input.setAttribute('aria-label', `Viewer link for ${drawing.name}`); input.value = new URL(`/?view=${drawing.id}`, location.origin).href;
            actions.append(input); input.focus(); input.select(); share.remove();
          }; actions.append(share);
          const visibility = document.createElement('label'); visibility.className = 'publishing-discovery';
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = drawing.searchable;
          checkbox.setAttribute('aria-label', `Allow discovery of ${drawing.name}`);
          visibility.append(checkbox, document.createTextNode('Allow signed-in users to find and view'));
          checkbox.onchange = async () => {
            checkbox.disabled = true;
            try {
              const saved = await client.setDiscoverable(drawing.id, checkbox.checked); checkbox.checked = saved.searchable;
              status.textContent = saved.searchable ? 'Discovery enabled. Viewers can adjust controls and export PNG or DXF.' : 'Discovery disabled. New viewing requests will be denied.';
            } catch (error) { checkbox.checked = !checkbox.checked; status.textContent = error.message; }
            finally { checkbox.disabled = false; }
          };
          item.append(visibility);
        }
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete';
        remove.setAttribute('aria-label', `Delete ${drawing.name}`);
        remove.onclick = () => {
          const confirm = document.createElement('div'); confirm.className = 'published-delete-confirm';
          const warning = document.createElement('p'); warning.textContent = `Delete “${drawing.name}” from storage? This cannot be undone. Your open drawing and downloaded copies are kept.`;
          const yes = document.createElement('button'); yes.type = 'button'; yes.textContent = 'Delete from storage';
          const no = document.createElement('button'); no.type = 'button'; no.textContent = 'Keep drawing';
          no.onclick = () => { confirm.remove(); remove.disabled = false; remove.focus(); };
          yes.onclick = async () => {
            yes.disabled = true; no.disabled = true; status.textContent = 'Deleting stored drawing…';
            try { await client.remove(drawing.id); item.remove(); status.textContent = list.children.length ? 'Stored drawing deleted.' : 'You have no stored drawings.'; }
            catch (error) { status.textContent = error.message; yes.disabled = false; no.disabled = false; }
          };
          remove.disabled = true; confirm.append(warning, yes, no); item.append(confirm); no.focus();
        };
        actions.append(remove); item.append(title, details, actions); list.append(item);
      }
      next = response.next; more.hidden = !next; status.textContent = list.children.length ? '' : 'You have no stored drawings yet.';
    } catch (error) { if (generation === current) status.textContent = error.message; }
    finally { more.disabled = false; }
  }
  more.onclick = () => load(true);
  loadAccountPanel(view.dialog.querySelector('.publishing-account'), client, { signal: view.signal, onChange(account) {
    generation++; list.replaceChildren(); more.hidden = true;
    if (account?.user) load(); else status.textContent = account ? 'Sign in to see your drawings.' : '';
  } });
  view.dialog.querySelector('.close').focus();
}
