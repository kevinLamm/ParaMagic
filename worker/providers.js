import { createRemoteJWKSet, jwtVerify } from 'jose';
import { digest } from './identity.js';
import { HttpError } from './http.js';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export function configuredProviders(env) {
  return ['google', 'github'].filter(provider => {
    const prefix = provider.toUpperCase();
    return env[`${prefix}_CLIENT_ID`] && env[`${prefix}_CLIENT_SECRET`];
  });
}
export async function authorizationUrl(provider, env, callback, attempt, state) {
  const url = new URL(provider === 'google'
    ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://github.com/login/oauth/authorize');
  const parameters = {
    client_id: env[`${provider.toUpperCase()}_CLIENT_ID`], redirect_uri: callback,
    response_type: 'code', scope: provider === 'google' ? 'openid email profile' : 'read:user',
    state, code_challenge: await digest(attempt.verifier), code_challenge_method: 'S256',
  };
  if (provider === 'google') { parameters.nonce = attempt.nonce; parameters.prompt = 'select_account'; }
  url.search = new URLSearchParams(parameters).toString();
  return url.href;
}
async function providerJson(url, options) {
  const response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new HttpError(502, 'The sign-in provider could not finish signing you in. Please try again.');
  return response.json();
}
export async function exchangeIdentity(provider, env, callback, attempt, code) {
  const tokens = await providerJson(provider === 'google'
    ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: env[`${provider.toUpperCase()}_CLIENT_ID`],
      client_secret: env[`${provider.toUpperCase()}_CLIENT_SECRET`],
      redirect_uri: callback, grant_type: 'authorization_code', code, code_verifier: attempt.verifier,
    }),
  });
  if (provider === 'google') {
    const { payload } = await jwtVerify(tokens.id_token, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: env.GOOGLE_CLIENT_ID,
      algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat', 'nonce'], maxTokenAge: '10m',
    });
    if (payload.nonce !== attempt.nonce || (payload.azp && payload.azp !== env.GOOGLE_CLIENT_ID)) {
      throw new HttpError(401, 'Sign-in verification failed. Please try again.');
    }
    return {
      subject: payload.sub, name: String(payload.name || 'Google user').slice(0, 200),
      email: payload.email_verified === true ? payload.email : null,
    };
  }
  if (!tokens.access_token || tokens.error) throw new HttpError(401, 'GitHub sign-in was not completed.');
  const profile = await providerJson('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ParaMagic' },
  });
  if (!Number.isSafeInteger(profile.id) || profile.id <= 0) throw new HttpError(401, 'GitHub sign-in verification failed.');
  // Provider ID, never email, determines ownership. GitHub requires no private email scope.
  return { subject: String(profile.id), name: String(profile.name || profile.login || 'GitHub user').slice(0, 200), email: null };
}
