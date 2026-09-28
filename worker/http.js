export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const json = (value, status = 200, headers = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
export function sameOrigin(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    throw new HttpError(403, 'This action must come from ParaMagic. Reload the app and try again.');
  }
}
export async function boundedBody(request, limit) {
  if (!request.body) throw new HttpError(400, 'A request body is required.');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(413, 'This upload part is larger than expected.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export async function readJson(request) {
  try { return JSON.parse(new TextDecoder().decode(await boundedBody(request, 32 * 1024))); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid request.');
  }
}
