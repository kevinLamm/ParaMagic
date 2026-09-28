import { newIdentity, newSecret, digest } from './identity.js';
import { HttpError, json, sameOrigin } from './http.js';
import { configuredProviders, authorizationUrl, exchangeIdentity } from './providers.js';

const SESSION_SECONDS = 60 * 60 * 24 * 7;
function cookieName(request, purpose) {
  return `${new URL(request.url).protocol === 'https:' ? '__Host-' : ''}paramagic_${purpose}`;
}
function cookie(request, purpose, value, maxAge) {
  return `${cookieName(request, purpose)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function readCookie(request, purpose) {
  const name = cookieName(request, purpose);
  const values = (request.headers.get('Cookie') || '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${name}=`)).map(part => part.slice(name.length + 1));
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]) ? values[0] : null;
}
export async function sessionUser(request, db) {
  const token = readCookie(request, 'session');
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.name, u.provider FROM users u JOIN sessions s ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?`).bind(await digest(token), Date.now()).first();
}
export async function requireUser(request, db) {
  const user = await sessionUser(request, db);
  if (!user) throw new HttpError(401, 'Sign in to publish and manage your drawings.');
  return user;
}
export function authOrigin(request, env) {
  const actual = new URL(request.url);
  const expected = env.APP_ORIGIN;
  if (expected) {
    const configured = new URL(expected);
    if (configured.origin !== expected || configured.origin !== actual.origin || configured.protocol !== 'https:') {
      throw new HttpError(503, 'Sign-in is not available at this address.');
    }
    return configured.origin;
  }
  if (actual.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(actual.hostname)) return actual.origin;
  throw new HttpError(503, 'Sign-in is not configured yet.');
}
function resultPage(request, success, headers = {}) {
  const message = success ? 'You are signed in. Return to your drawing.' : 'Sign-in was not completed. Return to ParaMagic and try again.';
  // No provider response, token, or user-controlled text is interpolated into this page.
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ParaMagic sign-in</title><body><h1>${success ? 'Signed in' : 'Sign-in unsuccessful'}</h1><p>${message}</p><a href="/">Open ParaMagic</a><script>if(window.opener){window.opener.postMessage({type:'paramagic-auth',success:${success}},location.origin);window.close()}</script></body></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      ...headers },
  });
}
export async function authRoute(request, env, path) {
  if (path === '/api/auth/logout' && request.method === 'POST') {
    sameOrigin(request);
    const token = readCookie(request, 'session');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(token)).run();
    return json({ signedOut: true }, 200, { 'Set-Cookie': cookie(request, 'session', '', 0) });
  }
  const match = path.match(/^\/api\/auth\/(google|github)\/(start|callback)$/);
  if (!match || request.method !== 'GET') return null;
  const [, provider, action] = match;
  const origin = authOrigin(request, env);
  if (!configuredProviders(env).includes(provider)) throw new HttpError(503, 'This sign-in provider is not configured yet.');
  const callback = `${origin}/api/auth/${provider}/callback`;
  if (action === 'start') {
    if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, 'Start sign-in from ParaMagic.');
    const state = newSecret();
    const browser = newSecret();
    const attempt = { verifier: newSecret(), nonce: newSecret() };
    await env.DB.batch([
      env.DB.prepare('DELETE FROM oauth_attempts WHERE expires_at <= ?').bind(Date.now()),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()),
      env.DB.prepare(`INSERT INTO oauth_attempts (state_hash,browser_hash,provider,verifier,nonce,expires_at)
        VALUES (?,?,?,?,?,?)`).bind(await digest(state), await digest(browser), provider, attempt.verifier, attempt.nonce, Date.now() + 600000),
    ]);
    return new Response(null, { status: 302, headers: {
      Location: await authorizationUrl(provider, env, callback, attempt, state),
      'Set-Cookie': cookie(request, `oauth_${provider}`, browser, 600), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    } });
  }
  const clear = { 'Set-Cookie': cookie(request, `oauth_${provider}`, '', 0) };
  let stage = 'state';
  try {
    const url = new URL(request.url);
    const state = url.searchParams.get('state');
    const browser = readCookie(request, `oauth_${provider}`);
    if (!state || !browser || state.length !== 43) return resultPage(request, false, clear);
    const attempt = await env.DB.prepare(`DELETE FROM oauth_attempts
      WHERE state_hash = ? AND browser_hash = ? AND provider = ? AND expires_at > ? RETURNING *`)
      .bind(await digest(state), await digest(browser), provider, Date.now()).first();
    const code = url.searchParams.get('code');
    if (!attempt || !code || code.length > 2048 || url.searchParams.has('error')) return resultPage(request, false, clear);
    stage = 'provider';
    const identity = await exchangeIdentity(provider, env, callback, attempt, code);
    if (typeof identity.subject !== 'string' || !identity.subject || identity.subject.length > 255) return resultPage(request, false, clear);
    stage = 'account';
    const user = await env.DB.prepare(`INSERT INTO users (id,provider,subject,name,email,created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(provider,subject) DO UPDATE SET name=excluded.name,email=excluded.email RETURNING id`)
      .bind(newIdentity(), provider, identity.subject, identity.name, identity.email, Date.now()).first();
    stage = 'session';
    const token = newSecret();
    const old = readCookie(request, 'session');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(old ? await digest(old) : ''),
      env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
        .bind(await digest(token), user.id, Date.now() + SESSION_SECONDS * 1000),
    ]);
    const response = resultPage(request, true, clear);
    response.headers.append('Set-Cookie', cookie(request, 'session', token, SESSION_SECONDS));
    return response;
  } catch (error) {
    // Never log authorization codes, provider tokens, or claims.
    console.warn('Sign-in failed', provider, stage, error instanceof HttpError ? error.status : error.name);
    return resultPage(request, false, clear);
  }
}
