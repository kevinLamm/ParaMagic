// Server identities and secrets have a single authority, separate from drawing IDs.
export const newIdentity = () => crypto.randomUUID();
export const newSecret = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function digest(value) {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
