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
