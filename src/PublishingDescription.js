export const DESCRIPTION_CHARS = 4000;
export const SEARCH_QUERY_CHARS = 500;
export const descriptionPartCount = length => Math.ceil(length / DESCRIPTION_CHARS);
export function descriptionPartLength(length, part) {
  const start = part * DESCRIPTION_CHARS;
  return Math.min(length, start + DESCRIPTION_CHARS + SEARCH_QUERY_CHARS) - start;
}
// Overlap preserves keyword matches across stored text boundaries without a drawing-size limit.
export function* descriptionParts(text) {
  for (let start = 0; start < text.length; start += DESCRIPTION_CHARS) yield text.slice(start, start + DESCRIPTION_CHARS + SEARCH_QUERY_CHARS);
}
export const searchableText = value => value.normalize('NFKC').toLowerCase();
export const searchKeywords = value => [...new Set(searchableText(value).match(/[\p{L}\p{N}_-]+/gu) || [])];
