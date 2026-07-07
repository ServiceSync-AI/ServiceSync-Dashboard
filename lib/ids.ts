/**
 * Id encoding — safe round-tripping of S3 keys through URLs
 * =========================================================
 * Transcript keys contain slashes and dots, so we base64url-encode the full key
 * into an opaque `id` for the /api/transcripts/[id] route and decode it back on
 * the server. Avoids brittle path-segment juggling.
 */
export function encodeKey(key: string): string {
  return Buffer.from(key, 'utf-8').toString('base64url');
}

export function decodeKey(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf-8');
}
