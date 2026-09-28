// Additive schema initialization also works on Sites, where bindings are provisioned at deployment.
export const schema = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, subject TEXT NOT NULL,
    name TEXT NOT NULL, email TEXT, created_at INTEGER NOT NULL,
    UNIQUE(provider, subject)
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS oauth_attempts (
    state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, provider TEXT NOT NULL,
    verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS oauth_expiry ON oauth_attempts(expires_at)`,
  `CREATE TABLE IF NOT EXISTS drawings (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK(bytes > 0), parts INTEGER NOT NULL, next_part INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL CHECK(state IN ('uploading','writing','published','deleting')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS drawings_owner ON drawings(owner_id, created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS drawing_discovery (
    drawing_id TEXT PRIMARY KEY REFERENCES drawings(id) ON DELETE CASCADE,
    allowed INTEGER NOT NULL DEFAULT 0 CHECK(allowed IN (0,1)),
    description_chars INTEGER NOT NULL, next_part INTEGER NOT NULL DEFAULT 0, preview TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS drawing_descriptions (
    drawing_id TEXT NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    part INTEGER NOT NULL, search_text TEXT NOT NULL, PRIMARY KEY(drawing_id, part)
  )`,
];
const initialized = new WeakMap();
export async function ensureDatabase(db) {
  if (!initialized.has(db)) {
    initialized.set(db, db.batch(schema.map(sql => db.prepare(sql))).catch(error => {
      initialized.delete(db);
      throw error;
    }));
  }
  await initialized.get(db);
}
