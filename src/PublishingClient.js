import { descriptionParts } from './PublishingDescription.js';
export const hostedPublishingUrl = 'https://paramagic-testing.essdog.chatgpt.site';

export function createPublishingClient({ fetchImpl = globalThis.fetch, browser = globalThis.window,
  available = import.meta.env?.MODE !== 'github-pages' } = {}) {
  async function request(path, options = {}) {
    if (!available) throw new Error('Storage publishing is available in hosted ParaMagic. Save your drawing, then open it there.');
    const response = await fetchImpl(path, { credentials: 'same-origin', ...options });
    if (!response.headers.get('Content-Type')?.includes('application/json')) {
      throw new Error('Storage publishing is not available on this server. You can continue drawing and saving locally.');
    }
    const value = await response.json();
    if (!response.ok) {
      const error = new Error(value.error || 'The storage service could not complete this action.');
      error.status = response.status; throw error;
    }
    return value;
  }
  const account = () => request('/api/account');
  return {
    available, account,
    signOut: () => request('/api/auth/logout', { method: 'POST' }),
    list: (before = '') => request(`/api/drawings${before ? `?before=${encodeURIComponent(before)}` : ''}`),
    search: (query, before = '') => request(`/api/drawings/search?q=${encodeURIComponent(query)}&before=${encodeURIComponent(before)}`),
    setDiscoverable: (id, allowed) => request(`/api/drawings/${encodeURIComponent(id)}/discovery`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed }),
    }),
    async loadForViewing(id) {
      const response = await fetchImpl(`/api/drawings/${encodeURIComponent(id)}/open`, { credentials: 'same-origin' });
      if (!response.ok) {
        const value = await response.json(); throw new Error(value.error || 'This drawing cannot be opened.');
      }
      return { content: await response.text(), name: decodeURIComponent(response.headers.get('X-ParaMagic-Drawing-Name') || 'Shared drawing') };
    },
    async checkViewingAccess(id) {
      const response = await fetchImpl(`/api/drawings/${encodeURIComponent(id)}/open`, { method: 'HEAD', credentials: 'same-origin' });
      if (!response.ok) throw new Error('This drawing is no longer available to your account.');
    },
    remove: id => request(`/api/drawings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    signIn(provider, signal) {
      if (!['google', 'github'].includes(provider)) return Promise.reject(new Error('Unknown sign-in provider.'));
      const popup = browser.open(`/api/auth/${provider}/start`, 'paramagic-sign-in', 'popup,width=520,height=700');
      if (!popup) return Promise.reject(new Error('Allow pop-up windows for ParaMagic, then try signing in again. Your drawing will stay open.'));
      return new Promise((resolve, reject) => {
        let checking = false;
        let finished = false;
        const finish = (error, value) => {
          if (finished) return;
          finished = true;
          clearInterval(interval); clearTimeout(timeout);
          browser.removeEventListener('message', onMessage);
          signal?.removeEventListener('abort', onAbort);
          try { popup.close(); } catch { /* Some providers isolate their window. */ }
          if (error) reject(error); else resolve(value);
        };
        const check = async () => {
          if (checking || finished) return;
          checking = true;
          try { const value = await account(); if (value.user) finish(null, value); }
          catch { /* A network failure should not discard an in-progress sign-in. */ }
          finally { checking = false; }
        };
        const onMessage = event => {
          if (event.origin !== browser.location.origin || event.source !== popup || event.data?.type !== 'paramagic-auth') return;
          if (event.data.success) check(); else finish(new Error('Sign-in was not completed. Please try again.'));
        };
        const onAbort = () => finish(new Error('Sign-in cancelled.'));
        const interval = setInterval(check, 1500);
        const timeout = setTimeout(() => finish(new Error('Sign-in timed out. Please try again.')), 10 * 60 * 1000);
        browser.addEventListener('message', onMessage);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    },
    async publish({ name, content, description = '', searchable = false, signal, onProgress = () => {} }) {
      const blob = new Blob([content], { type: 'application/vnd.paramagic+json' });
      const { drawing, chunkBytes } = await request('/api/drawings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bytes: blob.size, descriptionChars: description.length, searchable }), signal,
      });
      try {
        let descriptionPart = 0;
        for (const text of descriptionParts(description)) {
          await request(`/api/drawings/${drawing.id}/description/${descriptionPart++}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal,
          });
        }
        for (let offset = 0, part = 0; offset < blob.size; offset += chunkBytes, part++) {
          await request(`/api/drawings/${drawing.id}/parts/${part}`, {
            method: 'PUT', body: blob.slice(offset, offset + chunkBytes), signal,
          });
          onProgress(Math.min(offset + chunkBytes, blob.size), blob.size);
        }
        return (await request(`/api/drawings/${drawing.id}/complete`, { method: 'POST', signal })).drawing;
      } catch (error) {
        // Keep an uncertain publication visible if its completion response was lost.
        if (signal?.aborted) {
          try { await request(`/api/drawings/${drawing.id}`, { method: 'DELETE' }); }
          catch { throw new Error('Upload cancelled. Remove the unfinished upload from My drawings to release its storage.'); }
          throw new Error('Upload cancelled.');
        }
        throw new Error(`${error.message} Check My drawings before trying again; the upload may need to be removed there.`);
      }
    },
  };
}
