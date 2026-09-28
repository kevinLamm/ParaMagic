import assert from 'node:assert/strict';
import test from 'node:test';
import { publishingTestRuntime } from '../../scripts/publishing-test-runtime.mjs';
import { CHUNK_BYTES } from '../../worker/drawings.js';
import { digest } from '../../worker/identity.js';
import { descriptionParts } from '../PublishingDescription.js';

test('publishing authorization, chunk integrity, quotas, cleanup and sessions', async t => {
  const { runtime, db, identity, bucket } = await publishingTestRuntime({ limit: CHUNK_BYTES * 2 });
  t.after(() => runtime.dispose());
  const owner = await identity(); const stranger = await identity('Another user');
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
    assert.equal((await (await call('/api/account', 'GET', undefined, null)).json()).authConfig.projectId, 'paramagic-test');
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
  await t.test('logout and expiry revoke server-side access', async () => {
    await db.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').bind(await digest(stranger.token)).run();
    assert.equal((await call('/api/drawings', 'GET', undefined, stranger)).status, 401);
    const response = await call('/api/auth/logout', 'POST');
    assert.equal(response.status, 200); assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.equal((await call('/api/drawings')).status, 401);
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
