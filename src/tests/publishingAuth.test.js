import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { publishingTestRuntime } from '../../scripts/publishing-test-runtime.mjs';
import { digest } from '../../worker/identity.js';

test('Firebase sessions accept verified Google/email users and enforce identity, revocation and origin', async t => {
  const { runtime, db, fetchMock } = await publishingTestRuntime(); t.after(() => runtime.dispose());
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: 'test-firebase', alg: 'RS256', use: 'sig' };
  fetchMock.get('https://www.googleapis.com').intercept({ path: '/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com' })
    .reply(200, { keys: [jwk] }, { headers: { 'Content-Type': 'application/json' } }).persist();
  const call = (body, { origin = 'http://localhost', cookie = '' } = {}) => runtime.dispatchFetch('http://localhost/api/auth/session', {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  async function token(overrides = {}, key = privateKey) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sub: 'stable-user', iss: 'https://securetoken.google.com/paramagic-test', aud: 'paramagic-test',
      iat: now, exp: now + 3600, auth_time: now - 20, email_verified: true, firebase: { sign_in_provider: 'password' }, ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(key);
  }
  function lookup(overrides = {}) {
    fetchMock.get('https://identitytoolkit.googleapis.com').intercept({ path: '/v1/accounts:lookup?key=test-public-api-key', method: 'POST' })
      .reply(200, { users: [{ localId: 'stable-user', email: 'owner@example.invalid', displayName: 'Owner',
        emailVerified: true, validSince: '1', ...overrides }] }, { headers: { 'Content-Type': 'application/json' } });
  }
  await t.test('server rejects missing verification, unsupported providers and invalid JWT claims', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const invalid of [{ aud: 'other-project' }, { iss: 'https://evil.example' }, { exp: now - 1 },
      { auth_time: now + 100 }, { iat: now + 100 }, { sub: '' }, { firebase: { sign_in_provider: 'github.com' } },
      { firebase: { sign_in_provider: 'anonymous' } }, { email_verified: false }]) {
      const response = await call({ idToken: await token(invalid) });
      assert.equal(response.status, invalid.email_verified === false ? 403 : 401, JSON.stringify(invalid));
    }
    const otherKey = (await generateKeyPair('RS256')).privateKey;
    assert.equal((await call({ idToken: await token({}, otherKey) })).status, 401);
    assert.equal((await call({ idToken: 'not-a-token' })).status, 401);
    assert.equal((await call({ idToken: await token() }, { origin: 'https://evil.example' })).status, 403);
    for (const provider of ['google', 'github']) {
      assert.equal((await runtime.dispatchFetch(`http://localhost/api/auth/${provider}/start`)).status, 404);
    }
  });
  let firstCookie; let userId;
  await t.test('email and Google for the same Firebase UID keep the same drawing owner and rotate sessions', async () => {
    lookup();
    const first = await call({ idToken: await token() }); assert.equal(first.status, 200, await first.clone().text());
    const result = await first.json(); userId = result.user.id;
    firstCookie = first.headers.get('Set-Cookie').split(';')[0];
    assert.match(first.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax; Max-Age=300/);
    const stored = await db.prepare('SELECT * FROM sessions WHERE user_id=?').bind(userId).first();
    assert.equal(stored.token_hash, await digest(firstCookie.split('=')[1]));
    assert.ok(result.expiresAt <= Date.now() + 300000);
    lookup();
    const second = await call({ idToken: await token({ firebase: { sign_in_provider: 'google.com' } }) }, { cookie: firstCookie });
    assert.equal(second.status, 200); assert.equal((await second.json()).user.id, userId);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM users').first()).count, 1);
    assert.equal(await db.prepare('SELECT * FROM sessions WHERE token_hash=?').bind(stored.token_hash).first(), null);
  });
  await t.test('current account state rejects disabled, changed verification, deleted and reset accounts', async () => {
    for (const [state, expected] of [[{ disabled: true }, 401], [{ emailVerified: false }, 403],
      [{ localId: 'another-user' }, 401], [{ validSince: String(Math.floor(Date.now() / 1000)) }, 401]]) {
      lookup(state); assert.equal((await call({ idToken: await token() })).status, expected);
    }
    const expired = await db.prepare('SELECT * FROM sessions WHERE user_id=?').bind(userId).first();
    await db.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').bind(expired.token_hash).run();
    assert.equal((await runtime.dispatchFetch('http://localhost/api/drawings', { headers: { Cookie: firstCookie } })).status, 401);
  });
  fetchMock.assertNoPendingInterceptors();
});
