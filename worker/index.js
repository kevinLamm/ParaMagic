import { ensureDatabase } from './database.js';
import { authOrigin, authRoute, sessionUser } from './auth.js';
import { configuredProviders } from './providers.js';
import { drawingsRoute, storageLimit } from './drawings.js';
import { HttpError, json } from './http.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    try {
      const connected = Boolean(env.DB && env.DRAWINGS);
      if (pathname === '/api/account' && request.method === 'GET') {
        let originReady = false;
        try { authOrigin(request, env); originReady = true; } catch { /* Public editor needs no account configuration. */ }
        if (env.DB) await ensureDatabase(env.DB);
        return json({ user: env.DB ? await sessionUser(request, env.DB) : null,
          providers: connected && originReady ? configuredProviders(env) : [],
          publishingEnabled: connected && storageLimit(env) > 0 });
      }
      if (!connected) throw new HttpError(503, 'Storage publishing is not configured yet. You can continue drawing and saving locally.');
      await ensureDatabase(env.DB);
      return await authRoute(request, env, pathname)
        || await drawingsRoute(request, env, pathname)
        || json({ error: 'Not found.' }, 404);
    } catch (error) {
      return json({ error: error instanceof HttpError ? error.message : 'The storage service could not complete this action. Please try again.' },
        error instanceof HttpError ? error.status : 503);
    }
  },
};
