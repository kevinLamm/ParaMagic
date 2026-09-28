import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublishingClient } from '../PublishingClient.js';

test('the client chunks UTF-8 bytes without losing data and only reports confirmed completion', async () => {
  const parts = []; let complete = false;
  const content = 'Hello ✂️ drawing '.repeat(3);
  const progress = [];
  const client = createPublishingClient({ fetchImpl: async (path, options) => {
    assert.equal(options.credentials, 'same-origin');
    if (path === '/api/drawings') {
      assert.equal(JSON.parse(options.body).bytes, new Blob([content]).size);
      return Response.json({ drawing: { id: 'test' }, chunkBytes: 7 });
    }
    if (path.endsWith('/complete')) { complete = true; return Response.json({ drawing: { id: 'test', state: 'published' } }); }
    parts.push(new Uint8Array(await options.body.arrayBuffer())); return Response.json({});
  } });
  const result = await client.publish({ name: 'Test', content, onProgress: bytes => progress.push(bytes) });
  assert.equal(new TextDecoder().decode(await new Blob(parts).arrayBuffer()), content);
  assert.equal(result.state, 'published'); assert.ok(complete);
  assert.equal(progress.at(-1), new Blob([content]).size);
});

test('network failure leaves an uncertain upload visible and cancellation removes it', async () => {
  for (const cancel of [false, true]) {
    const abort = new AbortController(); let removed = false;
    const client = createPublishingClient({ fetchImpl: async (path, options) => {
      if (path === '/api/drawings') return Response.json({ drawing: { id: 'test' }, chunkBytes: 7 });
      if (options.method === 'DELETE') { removed = true; return Response.json({ deleted: true }); }
      if (cancel) abort.abort();
      throw new Error('Connection lost');
    } });
    await assert.rejects(client.publish({ name: 'Test', content: 'data', signal: abort.signal }),
      cancel ? /Upload cancelled/ : /Check My drawings/);
    assert.equal(removed, cancel);
  }
});

test('static hosting explains where publishing is available without touching the network', async () => {
  const client = createPublishingClient({ available: false, fetchImpl: () => { throw new Error('Unexpected fetch'); } });
  await assert.rejects(client.account(), /hosted ParaMagic/);
});

test('verified accounts restore a short session, renew after expiry, and sign out of both services', async () => {
  let user = { uid: 'firebase-user', emailVerified: true }; let cookie = false; let exchanges = 0; let retry = false;
  const auth = { currentUser: () => user, token: async () => 'verified-token', signOut: async () => { user = null; } };
  const client = createPublishingClient({ authFactory: async () => auth, fetchImpl: async (path, options) => {
    if (path === '/api/account') return Response.json({ authConfig: { projectId: 'test' }, user: cookie ? { id: 'owner' } : null });
    if (path === '/api/auth/session') {
      assert.equal(JSON.parse(options.body).idToken, 'verified-token'); exchanges++; cookie = true;
      return Response.json({ expiresAt: Date.now() + 300000 });
    }
    if (path === '/api/auth/logout') { cookie = false; return Response.json({}); }
    assert.equal(options.headers['X-ParaMagic-Account'], 'firebase-user');
    if (!retry) { retry = true; return Response.json({ error: 'Expired session' }, { status: 401 }); }
    return Response.json({ drawings: [] });
  } });
  assert.equal((await client.account()).user.id, 'owner'); assert.equal(exchanges, 1);
  assert.deepEqual((await client.list()).drawings, []); assert.equal(exchanges, 2);
  await client.signOut(); assert.equal(user, null); assert.equal(cookie, false);
});

test('unverified signup exposes verification actions but never receives a publishing session', async () => {
  let user = null; let sent = 0; let exchanges = 0;
  const auth = { currentUser: () => user, token: async () => 'verified-token',
    register: async details => { user = { uid: 'email-user', email: details.email, emailVerified: false }; sent++; },
    resend: async () => { sent++; }, verify: async () => { user.emailVerified = true; }, reset: async () => { sent++; } };
  const client = createPublishingClient({ authFactory: async () => auth, fetchImpl: async path => {
    if (path === '/api/account') return Response.json({ authConfig: { projectId: 'test' }, user: exchanges ? { id: 'owner' } : null });
    if (path === '/api/auth/session') { exchanges++; return Response.json({ expiresAt: Date.now() + 300000 }); }
    throw new Error('Unexpected storage request');
  } });
  await client.account();
  await client.register({ email: 'test@example.invalid', password: 'not-a-real-password', name: 'Test' });
  assert.equal((await client.account()).verificationEmail, 'test@example.invalid');
  await assert.rejects(client.list(), /verify your email/); assert.equal(exchanges, 0);
  await client.resendVerification(); assert.equal(sent, 2);
  await client.checkVerification(); assert.equal((await client.account()).user.id, 'owner');
  await client.resetPassword('test@example.invalid'); assert.equal(sent, 3);
  await assert.rejects(client.signIn('github'), /Unknown/);
});
