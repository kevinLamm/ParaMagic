import { newIdentity } from './identity.js';
import { HttpError, json, readJson, boundedBody, sameOrigin } from './http.js';
import { requireUser } from './auth.js';

// Store independent chunks so a drawing is not constrained by a single HTTP request
// or R2 multipart part-count limit. Downloads stream the original bytes in order.
export const CHUNK_BYTES = 8 * 1024 * 1024;
const STALE_AFTER = 24 * 60 * 60 * 1000;
export function storageLimit(env) {
  const raw = String(env.STORAGE_LIMIT_BYTES || '');
  const value = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
function publicDrawing(row) {
  return { id: row.id, name: row.name, bytes: row.bytes, state: row.state,
    createdAt: row.created_at, url: row.state === 'published' ? `/api/drawings/${row.id}/download` : null };
}
const objectKey = (id, part) => `drawings/${id}/${part}`;

async function deleteObjects(env, row) {
  // Keep the reservation until every object is removed. Failed deletions can be retried.
  let cursor;
  do {
    const page = await env.DRAWINGS.list({ prefix: `drawings/${row.id}/`, limit: 1000, ...(cursor ? { cursor } : {}) });
    if (page.objects.length) await env.DRAWINGS.delete(page.objects.map(object => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await env.DB.prepare("DELETE FROM drawings WHERE id = ? AND state = 'deleting'").bind(row.id).run();
}
export async function cleanupStaleUploads(env) {
  const result = await env.DB.prepare(`UPDATE drawings SET state = 'deleting'
    WHERE id IN (SELECT id FROM drawings WHERE state != 'published' AND updated_at < ? LIMIT 5) RETURNING *`)
    .bind(Date.now() - STALE_AFTER).all();
  for (const row of result.results) await deleteObjects(env, row);
}
async function download(env, id, request) {
  const row = await env.DB.prepare("SELECT * FROM drawings WHERE id = ? AND state = 'published'").bind(id).first();
  if (!row) throw new HttpError(404, 'Drawing not found. It may have been deleted by its owner.');
  const headers = {
    'Content-Type': 'application/vnd.paramagic+json', 'Content-Length': String(row.bytes),
    'Content-Disposition': `attachment; filename="drawing.paramagic"; filename*=UTF-8''${encodeURIComponent(`${row.name}.paramagic`).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer',
  };
  if (request.method === 'HEAD') return new Response(null, { headers });
  let part = 0;
  let reader;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          if (!reader) {
            if (part >= row.parts) { controller.close(); return; }
            const object = await env.DRAWINGS.get(objectKey(id, part++));
            if (!object) throw new Error('Drawing was deleted or an upload part is unavailable.');
            reader = object.body.getReader();
          }
          const { value, done } = await reader.read();
          if (done) { reader.releaseLock(); reader = null; continue; }
          controller.enqueue(value);
          return;
        }
      } catch (error) { controller.error(error); }
    },
    async cancel() { await reader?.cancel(); },
  });
  return new Response(body, { headers });
}
export async function drawingsRoute(request, env, path) {
  const match = path.match(/^\/api\/drawings\/([a-f0-9-]{36})(?:\/(download|complete|parts\/(\d+)))?$/);
  if (match?.[2] === 'download' && ['GET', 'HEAD'].includes(request.method)) return download(env, match[1], request);
  if (path !== '/api/drawings' && !match) return null;
  const user = await requireUser(request, env.DB);
  if (!['GET', 'HEAD'].includes(request.method)) sameOrigin(request);
  if (path === '/api/drawings' && request.method === 'GET') {
    const cursor = new URL(request.url).searchParams.get('before') || '';
    const rows = await env.DB.prepare(`SELECT * FROM drawings WHERE owner_id = ? AND (? = '' OR id < ?)
      ORDER BY id DESC LIMIT 51`).bind(user.id, cursor, cursor).all();
    return json({ drawings: rows.results.slice(0, 50).map(publicDrawing),
      next: rows.results.length > 50 ? rows.results[49].id : null });
  }
  if (path === '/api/drawings' && request.method === 'POST') {
    const limit = storageLimit(env);
    if (!limit) throw new HttpError(503, 'Publishing is paused while storage is being configured.');
    await cleanupStaleUploads(env);
    const details = await readJson(request);
    if (!details || typeof details.name !== 'string' || !details.name.trim() || details.name.length > 200
      || !Number.isSafeInteger(details.bytes) || details.bytes <= 0) throw new HttpError(400, 'A drawing name and its size are required.');
    const id = newIdentity();
    const now = Date.now();
    // Admission and reservation are one SQL statement: concurrent users cannot overbook the cap.
    const inserted = await env.DB.prepare(`INSERT INTO drawings (id,owner_id,name,bytes,parts,state,created_at,updated_at)
      SELECT ?,?,?,?,?,'uploading',?,? WHERE ? <= ? - (SELECT COALESCE(SUM(bytes),0) FROM drawings)
      AND (SELECT COUNT(*) FROM drawings WHERE owner_id = ? AND state != 'published') < 3 RETURNING *`)
      .bind(id, user.id, details.name.trim(), details.bytes, Math.ceil(details.bytes / CHUNK_BYTES), now, now,
        details.bytes, limit, user.id).first();
    if (!inserted) throw new HttpError(409, 'There is not enough available storage, or you already have unfinished uploads. Remove a drawing or unfinished upload from My drawings and try again.');
    return json({ drawing: publicDrawing(inserted), chunkBytes: CHUNK_BYTES }, 201);
  }
  if (!match) return null;
  const [, id, action, partText] = match;
  const row = await env.DB.prepare('SELECT * FROM drawings WHERE id = ? AND owner_id = ?').bind(id, user.id).first();
  if (!row) throw new HttpError(404, 'Drawing not found.');
  if (partText !== undefined && request.method === 'PUT') {
    const part = Number(partText);
    if (!Number.isSafeInteger(part) || part < 0 || part >= row.parts) throw new HttpError(400, 'Invalid upload part.');
    if (row.state !== 'uploading') throw new HttpError(409, 'This drawing is not ready to accept an upload part.');
    if (part < row.next_part) return json({ nextPart: row.next_part });
    if (part !== row.next_part) throw new HttpError(409, 'Upload drawing parts in order.');
    const expected = Math.min(CHUNK_BYTES, row.bytes - part * CHUNK_BYTES);
    const bytes = await boundedBody(request, expected);
    if (bytes.byteLength !== expected) throw new HttpError(400, 'The upload part was incomplete. Please try again.');
    const locked = await env.DB.prepare(`UPDATE drawings SET state = 'writing', updated_at = ?
      WHERE id = ? AND state = 'uploading' AND next_part = ? RETURNING id`).bind(Date.now(), id, part).first();
    if (!locked) throw new HttpError(409, 'Another operation is using this drawing. Please try again.');
    try {
      await env.DRAWINGS.put(objectKey(id, part), bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
      await env.DB.prepare("UPDATE drawings SET next_part = ?, state = 'uploading', updated_at = ? WHERE id = ? AND state = 'writing'")
        .bind(part + 1, Date.now(), id).run();
    } catch (error) {
      // An uncertain write remains covered by the full reservation; a retry overwrites the same key.
      await env.DB.prepare("UPDATE drawings SET state = 'uploading', updated_at = ? WHERE id = ? AND state = 'writing'")
        .bind(Date.now(), id).run();
      throw error;
    }
    return json({ nextPart: part + 1 });
  }
  if (action === 'complete' && request.method === 'POST') {
    if (row.state === 'published') return json({ drawing: publicDrawing(row) });
    const published = await env.DB.prepare(`UPDATE drawings SET state = 'published', updated_at = ?
      WHERE id = ? AND state = 'uploading' AND next_part = parts RETURNING *`).bind(Date.now(), id).first();
    if (!published) throw new HttpError(409, 'The drawing has not finished uploading.');
    return json({ drawing: publicDrawing(published) });
  }
  if (!action && request.method === 'DELETE') {
    const deleting = await env.DB.prepare(`UPDATE drawings SET state = 'deleting', updated_at = ?
      WHERE id = ? AND (state != 'writing' OR updated_at < ?) RETURNING *`)
      .bind(Date.now(), id, Date.now() - STALE_AFTER).first();
    if (!deleting) throw new HttpError(409, 'A drawing part is still uploading. Please try deleting again shortly.');
    await deleteObjects(env, deleting);
    return json({ deleted: true });
  }
  return null;
}
