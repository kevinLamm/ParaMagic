import { requireUser } from './auth.js';
import { HttpError, json, readJson, sameOrigin } from './http.js';
import { descriptionPartCount, descriptionPartLength, SEARCH_QUERY_CHARS, searchableText, searchKeywords } from '../src/PublishingDescription.js';

export async function searchDrawings(request, env) {
  await requireUser(request, env.DB);
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || '';
  if (query.length > SEARCH_QUERY_CHARS) throw new HttpError(400, 'Use a shorter search, up to 500 characters.');
  const words = searchKeywords(query);
  if (!words.length || words.length > 20) throw new HttpError(400, 'Enter between 1 and 20 keywords.');
  const before = url.searchParams.get('before') || '';
  const patterns = words.map(word => `%${word.replace(/[\\%_]/g, '\\$&')}%`);
  const rows = await env.DB.prepare(`SELECT d.id,d.name,d.bytes,d.created_at,v.preview FROM drawings d
    JOIN drawing_discovery v ON v.drawing_id=d.id WHERE d.state='published' AND v.allowed=1
    AND (?='' OR d.id < ?) AND EXISTS (SELECT 1 FROM drawing_descriptions p WHERE p.drawing_id=d.id
      AND (${patterns.map(() => "p.search_text LIKE ? ESCAPE '\\'").join(' OR ')}))
    ORDER BY d.id DESC LIMIT 26`).bind(before, before, ...patterns).all();
  return json({ drawings: rows.results.slice(0, 25).map(row => ({ id: row.id, name: row.name,
    bytes: row.bytes, description: row.preview, createdAt: row.created_at })),
    next: rows.results.length > 25 ? rows.results[24].id : null });
}
export async function discoveryRoute(request, env, id, action, row) {
  if (action === 'discovery' && request.method === 'PATCH') {
    sameOrigin(request);
    const value = await readJson(request);
    if (typeof value?.allowed !== 'boolean') throw new HttpError(400, 'Choose whether this drawing can appear in search.');
    const changed = await env.DB.prepare(`UPDATE drawing_discovery SET allowed=? WHERE drawing_id=?
      AND EXISTS (SELECT 1 FROM drawings WHERE id=? AND state='published')
      AND next_part = (description_chars + 3999) / 4000 RETURNING drawing_id`)
      .bind(value.allowed ? 1 : 0, id, id).first();
    if (!changed) throw new HttpError(409, 'This drawing is not ready for discovery. Publish a new copy with a description.');
    return json({ searchable: value.allowed });
  }
  const match = action?.match(/^description\/(\d+)$/);
  if (!match || request.method !== 'PUT') return null;
  const part = Number(match[1]);
  const details = await env.DB.prepare('SELECT * FROM drawing_discovery WHERE drawing_id=?').bind(id).first();
  if (!details || row.state !== 'uploading' || !Number.isSafeInteger(part) || part < 0
    || part >= descriptionPartCount(details.description_chars)) throw new HttpError(409, 'This drawing is not ready for a description part.');
  if (part < details.next_part) return json({ nextPart: details.next_part });
  if (part !== details.next_part) throw new HttpError(409, 'Upload description parts in order.');
  const value = await readJson(request);
  if (typeof value?.text !== 'string' || value.text.length !== descriptionPartLength(details.description_chars, part)) throw new HttpError(400, 'The description part was incomplete.');
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO drawing_descriptions (drawing_id,part,search_text)
      SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM drawings WHERE id=? AND state='uploading')
      AND EXISTS (SELECT 1 FROM drawing_discovery WHERE drawing_id=? AND next_part=?)`)
      .bind(id, part, searchableText(value.text), id, id, part),
    env.DB.prepare(`UPDATE drawing_discovery SET next_part=next_part+1, preview=CASE WHEN ?=0 THEN ? ELSE preview END
      WHERE drawing_id=? AND next_part=? AND EXISTS (SELECT 1 FROM drawing_descriptions WHERE drawing_id=? AND part=?) RETURNING next_part`)
      .bind(part, value.text.slice(0, 400), id, part, id, part),
    env.DB.prepare("UPDATE drawings SET updated_at=? WHERE id=? AND state='uploading'").bind(Date.now(), id),
  ]);
  if (!results[1].results.length) throw new HttpError(409, 'The drawing changed during upload. Please try again.');
  return json({ nextPart: results[1].results[0].next_part });
}
