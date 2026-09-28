import { build } from 'esbuild';
import { Miniflare, createFetchMock } from 'miniflare';
import { newIdentity, newSecret, digest } from '../worker/identity.js';
import { ensureDatabase } from '../worker/database.js';

// Test-only dependencies and identities. This module is never part of the Worker build.
export async function publishingTestRuntime({ limit = 100_000_000, providers = true } = {}) {
  const bundle = await build({ entryPoints: ['worker/index.js'], bundle: true, write: false, format: 'esm', platform: 'browser' });
  const fetchMock = createFetchMock(); fetchMock.disableNetConnect();
  const runtime = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-05-22', d1Databases: ['DB'], r2Buckets: ['DRAWINGS'], fetchMock,
    bindings: { STORAGE_LIMIT_BYTES: String(limit), ...(providers ? {
      FIREBASE_PROJECT_ID: 'paramagic-test', FIREBASE_API_KEY: 'test-public-api-key',
      FIREBASE_AUTH_DOMAIN: 'paramagic-test.firebaseapp.com',
    } : {}) } });
  const db = await runtime.getD1Database('DB'); await ensureDatabase(db);
  async function sessionFor(id) {
    const token = newSecret();
    await db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
      .bind(await digest(token), id, Date.now() + 3600000).run();
    return { id, token, cookie: `paramagic_session=${token}` };
  }
  async function identity(name = 'Test owner', provider = 'firebase') {
    const id = newIdentity();
    await db.prepare('INSERT INTO users (id,provider,subject,name,created_at) VALUES (?,?,?,?,?)')
      .bind(id, provider, newIdentity(), name, Date.now()).run();
    return sessionFor(id);
  }
  return { runtime, db, identity, sessionFor, fetchMock, bucket: await runtime.getR2Bucket('DRAWINGS') };
}
