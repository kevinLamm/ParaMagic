import { descriptionParts } from './PublishingDescription.js';
export const hostedPublishingUrl = 'https://paramagic-testing.essdog.chatgpt.site';

export function createPublishingClient({ fetchImpl = globalThis.fetch, browser = globalThis.window,
  authFactory = async config => (await import('./PublishingAuth.js')).createPublishingAuth(config),
  available = import.meta.env?.MODE !== 'github-pages' } = {}) {
  let auth; let authLoading; let expiresAt = 0; let sessionUid; let syncing;
  const authHeaders = () => auth?.currentUser()?.uid ? { 'X-ParaMagic-Account': auth.currentUser().uid } : {};
  async function rawRequest(path, options = {}) {
    if (!available) throw new Error('Storage publishing is available in hosted ParaMagic. Save your drawing, then open it there.');
    const response = await fetchImpl(path, { credentials: 'same-origin', ...options, headers: { ...authHeaders(), ...options.headers } });
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
  async function syncSession(force = false) {
    if (!auth) return;
    const user = auth.currentUser();
    if (!user?.emailVerified) throw new Error('Sign in and verify your email before using drawing storage.');
    if (!force && sessionUid === user.uid && expiresAt > Date.now() + 30000) return;
    if (!syncing) syncing = (async () => {
      const result = await rawRequest('/api/auth/session', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: await auth.token() }) });
      expiresAt = result.expiresAt;
      sessionUid = user.uid;
    })().finally(() => { syncing = null; });
    await syncing;
  }
  async function request(path, options = {}) {
    await syncSession();
    try { return await rawRequest(path, options); }
    catch (error) {
      if (!auth || error.status !== 401) throw error;
      await syncSession(true);
      return rawRequest(path, options);
    }
  }
  async function account() {
    let value = await rawRequest('/api/account');
    if (value.authConfig) {
      if (!authLoading) authLoading = authFactory(value.authConfig).catch(error => { authLoading = null; throw error; });
      auth = await authLoading;
      if (auth.currentUser()?.emailVerified) {
        try { await syncSession(!value.user); }
        catch (error) {
          if (![401, 403].includes(error.status)) throw error;
          await auth.signOut(); expiresAt = 0;
          await rawRequest('/api/auth/logout', { method: 'POST' });
        }
        value = await rawRequest('/api/account');
      } else {
        if (value.user) await rawRequest('/api/auth/logout', { method: 'POST' });
        value.user = null;
      }
      value.verificationEmail = auth.currentUser()?.emailVerified === false ? auth.currentUser().email : null;
    }
    return value;
  }
  async function authAction(action, ...args) {
    if (!auth) throw new Error('Sign-in is not configured yet. Please try again later.');
    expiresAt = 0;
    try {
      await auth[action](...args);
      if (auth.currentUser()?.emailVerified) await syncSession();
    } catch (error) {
      if (error.code) throw (await import('./PublishingAuth.js')).accountError(error);
      throw error;
    }
  }

  return {
    available, account,
    signIn: provider => provider === 'google' ? authAction('google') : Promise.reject(new Error('Unknown sign-in provider.')),
    signInEmail: (email, password) => authAction('email', email, password),
    register: details => authAction('register', details),
    resendVerification: () => authAction('resend'),
    checkVerification: () => authAction('verify'),
    resetPassword: email => authAction('reset', email),
    async signOut() {
      expiresAt = 0;
      try { await auth?.signOut(); }
      finally { await rawRequest('/api/auth/logout', { method: 'POST' }); }
    },
    async download(id) {
      await syncSession();
      const who = auth?.currentUser()?.uid;
      browser.location.assign('/api/drawings/' + encodeURIComponent(id) + '/download' + (who ? '?account=' + encodeURIComponent(who) : ''));
    },
    list: (before = '') => request(`/api/drawings${before ? `?before=${encodeURIComponent(before)}` : ''}`),
    search: (query, before = '') => request(`/api/drawings/search?q=${encodeURIComponent(query)}&before=${encodeURIComponent(before)}`),
    setDiscoverable: (id, allowed) => request(`/api/drawings/${encodeURIComponent(id)}/discovery`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed }),
    }),
    async loadForViewing(id) {
      await syncSession();
      const response = await fetchImpl(`/api/drawings/${encodeURIComponent(id)}/open`, { credentials: 'same-origin', headers: authHeaders() });
      if (!response.ok) {
        const value = await response.json(); throw new Error(value.error || 'This drawing cannot be opened.');
      }
      return { content: await response.text(), name: decodeURIComponent(response.headers.get('X-ParaMagic-Drawing-Name') || 'Shared drawing') };
    },
    async checkViewingAccess(id) {
      await syncSession();
      const response = await fetchImpl(`/api/drawings/${encodeURIComponent(id)}/open`, { method: 'HEAD', credentials: 'same-origin', headers: authHeaders() });
      if (!response.ok) throw new Error('This drawing is no longer available to your account.');
    },
    remove: id => request(`/api/drawings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
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
