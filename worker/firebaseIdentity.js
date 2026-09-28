import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './http.js';

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export function firebaseConfig(env) {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY || !env.FIREBASE_AUTH_DOMAIN) return null;
  return { projectId: env.FIREBASE_PROJECT_ID, apiKey: env.FIREBASE_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN };
}
export async function verifiedFirebaseIdentity(idToken, env) {
  const config = firebaseConfig(env);
  if (!config) throw new HttpError(503, 'Account sign-in is not configured yet.');
  if (typeof idToken !== 'string' || idToken.length > 16000) throw new HttpError(401, 'Please sign in again.');
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      algorithms: ['RS256'], issuer: `https://securetoken.google.com/${config.projectId}`,
      audience: config.projectId, requiredClaims: ['sub', 'exp', 'iat', 'auth_time'], maxTokenAge: '1h',
    }));
  } catch { throw new HttpError(401, 'Please sign in again.'); }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 || payload.aud !== config.projectId || !Number.isSafeInteger(payload.auth_time)
    || payload.auth_time > now || payload.auth_time > payload.iat || payload.iat > now
    || !['google.com', 'password'].includes(payload.firebase?.sign_in_provider)) {
    throw new HttpError(401, 'Please sign in with Google or your ParaMagic account.');
  }
  if (payload.email_verified !== true) throw new HttpError(403, 'Verify your email address before using drawing storage.');
  // Check current verification, deletion, disabling and password-reset revocation before issuing a cookie.
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(config.apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }),
    redirect: 'manual', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new HttpError(response.status >= 500 || response.status === 429 ? 503 : 401,
    response.status >= 500 || response.status === 429 ? 'Sign-in is temporarily unavailable. Please try again.' : 'Please sign in again.');
  const user = (await response.json()).users?.find(item => item.localId === payload.sub);
  if (!user || user.disabled || Number(user.validSince || 0) > payload.auth_time) throw new HttpError(401, 'Please sign in again.');
  if (user.emailVerified !== true || typeof user.email !== 'string') throw new HttpError(403, 'Verify your email address before using drawing storage.');
  return { subject: payload.sub, email: user.email, name: String(user.displayName || user.email).slice(0, 200) };
}
