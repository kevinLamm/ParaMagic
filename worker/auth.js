import { newIdentity, newSecret, digest } from './identity.js';
import { HttpError, json, readJson, sameOrigin } from './http.js';
import { verifiedFirebaseIdentity } from './firebaseIdentity.js';

// Renew through Firebase every five minutes to check account revocation.
const SESSION_SECONDS = 300;
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
  const expected = request.headers.get('X-ParaMagic-Account') || new URL(request.url).searchParams.get('account');
  return db.prepare(`SELECT u.id, u.name, u.provider FROM users u JOIN sessions s ON s.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.provider = 'firebase' AND (? IS NULL OR u.subject = ?)`)
    .bind(await digest(token), Date.now(), expected, expected).first();
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
export async function authRoute(request, env, path) {
  if (!['/api/auth/logout', '/api/auth/session'].includes(path) || request.method !== 'POST') return null;
  sameOrigin(request);
  const old = readCookie(request, 'session');
  if (path === '/api/auth/logout') {
    if (old) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(old)).run();
    return json({ signedOut: true }, 200, { 'Set-Cookie': cookie(request, 'session', '', 0) });
  }
  authOrigin(request, env);
  const { idToken } = await readJson(request);
  const identity = await verifiedFirebaseIdentity(idToken, env);
  // Firebase UID remains stable when a user links Google and email/password.
  const user = await env.DB.prepare(`INSERT INTO users (id,provider,subject,name,email,created_at)
    VALUES (?,'firebase',?,?,?,?) ON CONFLICT(provider,subject)
    DO UPDATE SET name=excluded.name,email=excluded.email RETURNING id,name,provider`)
    .bind(newIdentity(), identity.subject, identity.name, identity.email, Date.now()).first();
  const token = newSecret(); const expiresAt = Date.now() + SESSION_SECONDS * 1000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE token_hash = ? OR expires_at <= ?').bind(old ? await digest(old) : '', Date.now()),
    env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await digest(token), user.id, expiresAt),
  ]);
  return json({ user, expiresAt }, 200, { 'Set-Cookie': cookie(request, 'session', token, SESSION_SECONDS) });
}
