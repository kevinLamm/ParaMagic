import assert from 'node:assert/strict';
import test from 'node:test';
import { publishingTestRuntime } from '../../scripts/publishing-test-runtime.mjs';
import { CHUNK_BYTES } from '../../worker/drawings.js';
import { digest } from '../../worker/identity.js';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { descriptionParts } from '../PublishingDescription.js';

test('publishing authorization, chunk integrity, quotas, cleanup and sessions', async t => {
  const { runtime, db, identity, bucket, fetchMock } = await publishingTestRuntime({ limit: CHUNK_BYTES * 2 });
  t.after(() => runtime.dispose());
  const owner = await identity(); const stranger = await identity('Another user', 'github');
  const call = (path, method = 'GET', body, who = owner, origin = 'http://localhost') => runtime.dispatchFetch(`http://localhost${path}`, {
    method, redirect: 'manual', headers: { ...(who ? { Cookie: who.cookie } : {}), ...(origin ? { Origin: origin } : {}),
      ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const begin = async (bytes, name = 'Test drawing') => {
    const response = await call('/api/drawings', 'POST', { bytes, name });
    assert.equal(response.status, 201, await response.clone().text()); return (await response.json()).drawing;
  };
  await t.test('anonymous editor status is public but publishing and listing require a session', async () => {
    assert.deepEqual((await (await call('/api/account', 'GET', undefined, null)).json()).providers, ['google', 'github']);
    for (const method of ['GET', 'POST']) assert.equal((await call('/api/drawings', method, method === 'POST' ? {} : undefined, null)).status, 401);
    for (const origin of ['https://evil.example', null]) assert.equal((await call('/api/drawings', 'POST', { bytes: 10, name: 'CSRF' }, owner, origin)).status, 403);
  });
  let drawing;
  const content = new Uint8Array(CHUNK_BYTES + 31).fill(97); content[CHUNK_BYTES] = 98;
  await t.test('chunked upload downloads exactly the original bytes and rejects another owner', async () => {
    drawing = await begin(content.length, 'Portable "drawing"');
    for (const [suffix, method, body] of [['', 'DELETE'], ['/parts/0', 'PUT', content.slice(0, 1)], ['/complete', 'POST']]) {
      assert.equal((await call(`/api/drawings/${drawing.id}${suffix}`, method, body, stranger)).status, 404);
    }
    assert.equal((await call(`/api/drawings/${drawing.id}/download`, 'GET', undefined, null)).status, 401);
    assert.equal((await call(`/api/drawings/${drawing.id}/complete`, 'POST')).status, 409);
    assert.equal((await call(`/api/drawings/${drawing.id}/parts/1`, 'PUT', content.slice(CHUNK_BYTES))).status, 409);
    assert.equal((await call(`/api/drawings/${drawing.id}/parts/0`, 'PUT', content.slice(0, 10))).status, 400);
    assert.equal((await call(`/api/drawings/${drawing.id}/parts/0`, 'PUT', content.slice(0, CHUNK_BYTES))).status, 200);
    assert.equal((await call(`/api/drawings/${drawing.id}/parts/1`, 'PUT', new Uint8Array(32))).status, 413);
    assert.equal((await call(`/api/drawings/${drawing.id}/parts/1`, 'PUT', content.slice(CHUNK_BYTES))).status, 200);
    assert.equal((await call(`/api/drawings/${drawing.id}/complete`, 'POST')).status, 200);
    assert.equal((await call(`/api/drawings/${drawing.id}/download`, 'GET', undefined, stranger)).status, 404);
    const response = await call(`/api/drawings/${drawing.id}/download`);
    assert.equal(response.status, 200); assert.match(response.headers.get('Content-Disposition'), /attachment/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), content);
    assert.equal((await (await call('/api/drawings', 'GET', undefined, stranger)).json()).drawings.length, 0);
  });
  await t.test('a total cap rejects overbooking, includes reservations and releases only after deletion', async () => {
    const replies = await Promise.all([1, 2].map(i => call('/api/drawings', 'POST', { name: `Concurrent ${i}`, bytes: CHUNK_BYTES - 31 })));
    assert.deepEqual(replies.map(r => r.status).sort(), [201, 409]);
    const pending = (await replies.find(r => r.status === 201).json()).drawing;
    assert.equal((await call('/api/drawings', 'POST', { bytes: 1, name: 'Full' })).status, 409);
    assert.equal((await call(`/api/drawings/${pending.id}`, 'DELETE')).status, 200);
    assert.equal((await call(`/api/drawings/${drawing.id}`, 'DELETE')).status, 200);
    assert.equal((await call(`/api/drawings/${drawing.id}/download`)).status, 404);
    assert.equal((await bucket.list()).objects.length, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM drawings').first()).total, 0);
  });
  await t.test('unfinished writes remain reserved and stale uploads are cleaned up', async () => {
    const old = await begin(20);
    await call(`/api/drawings/${old.id}/parts/0`, 'PUT', new Uint8Array(20));
    await db.prepare("UPDATE drawings SET state='writing' WHERE id=?").bind(old.id).run();
    assert.equal((await call(`/api/drawings/${old.id}`, 'DELETE')).status, 409);
    await db.prepare('UPDATE drawings SET updated_at=? WHERE id=?').bind(Date.now() - 25 * 3600000, old.id).run();
    const fresh = await begin(1);
    assert.equal((await bucket.list()).objects.length, 0);
    assert.equal(await db.prepare('SELECT id FROM drawings WHERE id=?').bind(old.id).first(), null);
    await call(`/api/drawings/${fresh.id}`, 'DELETE');
  });
  await t.test('discovery is opt-in, searches descriptions with any keyword, and only grants viewing', async () => {
    const description = 'Private pattern ' + '.'.repeat(3980) + 'SeamAllowance ' + 'x '.repeat(21000) + 'Red OTTOMAN';
    const bytes = new TextEncoder().encode(JSON.stringify({ description }));
    const started = await call('/api/drawings', 'POST', { name: 'NameOnlyKeyword', bytes: bytes.length,
      descriptionChars: description.length, searchable: false });
    const item = (await started.json()).drawing;
    await call(`/api/drawings/${item.id}/parts/0`, 'PUT', bytes);
    assert.equal((await call(`/api/drawings/${item.id}/complete`, 'POST')).status, 409);
    let part = 0;
    for (const text of descriptionParts(description)) {
      const response = await call(`/api/drawings/${item.id}/description/${part++}`, 'PUT', { text });
      assert.equal(response.status, 200, await response.clone().text());
    }
    assert.equal((await call(`/api/drawings/${item.id}/complete`, 'POST')).status, 200);
    const search = async query => (await (await call(`/api/drawings/search?q=${encodeURIComponent(query)}`, 'GET', undefined, stranger)).json()).drawings;
    assert.equal((await call('/api/drawings/search?q=red', 'GET', undefined, null)).status, 401);
    assert.equal((await search('red')).length, 0);
    assert.equal((await call(`/api/drawings/${item.id}/open`, 'GET', undefined, stranger)).status, 404);
    assert.equal((await call(`/api/drawings/${item.id}/discovery`, 'PATCH', { allowed: true }, stranger)).status, 404);
    assert.equal((await call(`/api/drawings/${item.id}/discovery`, 'PATCH', { allowed: true })).status, 200);
    for (const query of ['red no-match', 'ottoman', 'SeamAllowance']) assert.equal((await search(query))[0].id, item.id);
    assert.equal((await search('NameOnlyKeyword')).length, 0);
    assert.equal((await call(`/api/drawings/${item.id}/open`, 'GET', undefined, stranger)).status, 200);
    assert.equal((await call(`/api/drawings/${item.id}/open`, 'HEAD', undefined, stranger)).status, 200);
    assert.equal((await call(`/api/drawings/${item.id}/download`, 'GET', undefined, stranger)).status, 404);
    assert.equal((await call(`/api/drawings/${item.id}`, 'DELETE', undefined, stranger)).status, 404);
    assert.equal((await call(`/api/drawings/${item.id}/parts/0`, 'PUT', bytes, stranger)).status, 404);
    assert.equal((await call(`/api/drawings/${item.id}/discovery`, 'PATCH', { allowed: false })).status, 200);
    assert.equal((await search('red')).length, 0);
    assert.equal((await call(`/api/drawings/${item.id}/open`, 'HEAD', undefined, stranger)).status, 404);
    assert.equal((await call(`/api/drawings/${item.id}`, 'DELETE')).status, 200);
    assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM drawing_descriptions WHERE drawing_id=?').bind(item.id).first()).total, 0);
  });
  await t.test('OAuth binds state to the browser, consumes it once, and creates a provider account', async () => {
    const start = await call('/api/auth/github/start', 'GET', undefined, null);
    assert.equal(start.status, 302);
    const url = new URL(start.headers.get('Location'));
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), 'read:user');
    const callback = `/api/auth/github/callback?state=${url.searchParams.get('state')}&code=test-code`;
    const wrongBrowser = await call(callback, 'GET', undefined, null);
    assert.match(await wrongBrowser.text(), /Sign-in unsuccessful/);
    fetchMock.get('https://github.com').intercept({ path: '/login/oauth/access_token', method: 'POST' })
      .reply(200, { access_token: 'test-provider-token' }, { headers: { 'Content-Type': 'application/json' } });
    fetchMock.get('https://api.github.com').intercept({ path: '/user' })
      .reply(200, { id: 12345, login: 'test-user', name: 'Test GitHub owner' }, { headers: { 'Content-Type': 'application/json' } });
    const cookie = start.headers.get('Set-Cookie').split(';')[0];
    const result = await call(callback, 'GET', undefined, { cookie });
    fetchMock.assertNoPendingInterceptors();
    assert.match(await result.text(), /You are signed in/);
    assert.match(result.headers.get('Set-Cookie'), /HttpOnly/);
    const repeat = await call(callback, 'GET', undefined, { cookie });
    assert.match(await repeat.text(), /Sign-in unsuccessful/);
    const user = await db.prepare("SELECT * FROM users WHERE provider='github' AND subject='12345'").first();
    assert.equal(user.name, 'Test GitHub owner');
    assert.equal(await db.prepare('SELECT * FROM sessions WHERE token_hash=?').bind('test-provider-token').first(), null);
    fetchMock.assertNoPendingInterceptors();
  });
  await t.test('logout and expiry revoke server-side access', async () => {
    await db.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').bind(await digest(stranger.token)).run();
    assert.equal((await call('/api/drawings', 'GET', undefined, stranger)).status, 401);
    const response = await call('/api/auth/logout', 'POST');
    assert.equal(response.status, 200); assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.equal((await call('/api/drawings')).status, 401);
  });
  await t.test('Google verifies signed identity, audience, nonce and expiry', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const key = { ...await exportJWK(publicKey), kid: 'fixture-google', alg: 'RS256', use: 'sig' };
    fetchMock.get('https://www.googleapis.com').intercept({ path: '/oauth2/v3/certs' })
      .reply(200, { keys: [key] }, { headers: { 'Content-Type': 'application/json' } }).persist();
    for (const invalid of ['', 'nonce', 'audience', 'issuer', 'expired', 'signature']) {
      const start = await call('/api/auth/google/start', 'GET', undefined, null);
      const authorization = new URL(start.headers.get('Location'));
      const nonce = authorization.searchParams.get('nonce');
      const signingKey = invalid === 'signature' ? (await generateKeyPair('RS256')).privateKey : privateKey;
      const token = await new SignJWT({ nonce: invalid === 'nonce' ? 'wrong' : nonce,
        name: 'Google fixture', email: 'test@example.invalid', email_verified: true })
        .setProtectedHeader({ alg: 'RS256', kid: key.kid }).setSubject('google-fixture-user')
        .setIssuer(invalid === 'issuer' ? 'https://evil.example' : 'https://accounts.google.com')
        .setAudience(invalid === 'audience' ? 'another-app' : 'test-google').setIssuedAt()
        .setExpirationTime(invalid === 'expired' ? '0s' : '5m').sign(signingKey);
      fetchMock.get('https://oauth2.googleapis.com').intercept({ path: '/token', method: 'POST' })
        .reply(200, { id_token: token }, { headers: { 'Content-Type': 'application/json' } });
      const response = await call(`/api/auth/google/callback?state=${authorization.searchParams.get('state')}&code=fixture`,
        'GET', undefined, { cookie: start.headers.get('Set-Cookie').split(';')[0] });
      assert.match(await response.text(), invalid ? /Sign-in unsuccessful/ : /You are signed in/, invalid);
    }
    assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM users WHERE subject='google-fixture-user'").first()).total, 1);
  });
});

test('missing cap pauses publishing while owner deletion remains available', async t => {
  const { runtime, identity } = await publishingTestRuntime({ limit: 0 }); t.after(() => runtime.dispose());
  const owner = await identity();
  const account = await (await runtime.dispatchFetch('http://localhost/api/account')).json();
  assert.equal(account.publishingEnabled, false);
  const response = await runtime.dispatchFetch('http://localhost/api/drawings', {
    method: 'POST', headers: { Cookie: owner.cookie, Origin: 'http://localhost' }, body: JSON.stringify({ name: 'Test', bytes: 1 }),
  });
  assert.equal(response.status, 503);
});
