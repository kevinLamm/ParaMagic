import { hostedPublishingUrl } from './PublishingClient.js';

export function createPublishingDialog(modal, title, markup) {
  const previousFocus = document.activeElement;
  modal(markup);
  const backdrop = [...document.querySelectorAll('.modal-backdrop')].at(-1);
  const dialog = backdrop.querySelector('.modal');
  const closeButton = dialog.querySelector('.close');
  const lifecycle = new AbortController();
  dialog.classList.add('drawing-publish-modal');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', title);
  let locked = false;
  function close() {
    if (locked) return;
    lifecycle.abort(); backdrop.remove(); previousFocus?.focus();
  }
  closeButton.onclick = close;
  backdrop.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button, input, textarea, a[href]')]
        .filter(element => !element.disabled && !element.closest('[hidden]'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  return { dialog, signal: lifecycle.signal, close, lock(value) { locked = value; closeButton.disabled = value; } };
}

export async function loadAccountPanel(root, client, { signal, onChange = () => {} } = {}) {
  root.replaceChildren();
  const status = document.createElement('p'); status.role = 'status'; status.textContent = 'Checking sign-in…'; root.append(status);
  const refresh = async () => {
    try {
      const account = await client.account();
      if (signal?.aborted) return;
      root.replaceChildren();
      if (account.user) {
        const name = document.createElement('p');
        name.textContent = `Signed in as ${account.user.name} (${account.user.provider === 'google' ? 'Google' : 'GitHub'}).`;
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Sign out';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try { await client.signOut(); await refresh(); }
          catch (error) { name.textContent = error.message; button.disabled = false; }
        });
        root.append(name, button);
      } else {
        const note = document.createElement('p');
        note.textContent = 'Sign in to publish and manage your drawings. Your first sign-in creates a ParaMagic account. You can use the full editor without an account.';
        root.append(note);
        if (!account.providers.length) { status.textContent = 'Sign-in is not available yet. Please try again later.'; root.append(status); }
        for (const provider of account.providers) {
          const button = document.createElement('button'); button.type = 'button';
          button.textContent = `Continue with ${provider === 'google' ? 'Google' : 'GitHub'}`;
          button.addEventListener('click', async () => {
            const pending = new AbortController(); const abort = () => pending.abort();
            signal?.addEventListener('abort', abort, { once: true });
            root.querySelectorAll('button').forEach(item => { item.disabled = true; });
            status.textContent = 'Finish signing in in the new window. Your drawing will stay open.'; root.append(status);
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel sign-in';
            cancel.onclick = abort; root.append(cancel);
            try { await client.signIn(provider, pending.signal); await refresh(); }
            catch (error) {
              status.textContent = error.message; root.querySelectorAll('button').forEach(item => { item.disabled = false; });
            } finally { cancel.remove(); signal?.removeEventListener('abort', abort); }
          });
          root.append(button);
        }
      }
      onChange(account);
    } catch (error) {
      if (signal?.aborted) return;
      status.textContent = error.message;
      if (!client.available) {
        const link = document.createElement('a'); link.href = hostedPublishingUrl;
        link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open hosted ParaMagic'; root.append(link);
      }
      onChange(null);
    }
  };
  await refresh();
}
