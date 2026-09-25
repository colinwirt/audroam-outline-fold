import type { OutlineNode, SealedPayload } from './types.js';

/** True when the node carries a sealed payload with kid + (ciphertext or uri). */
export function hasSealed(node: OutlineNode): boolean {
  const s = node.sealed;
  if (!s?.kid) return false;
  return Boolean(s.ciphertext || s.uri);
}

/** True when sealed payload is remote (uri) rather than inline ct. */
export function isRemoteSealed(node: OutlineNode): boolean {
  return Boolean(node.sealed?.kid && node.sealed?.uri && !node.sealed?.ciphertext);
}

/**
 * Parse `<enc:kid=…;alg=…;ct=…>` or `<enc:kid=…;uri=…>` body into a SealedPayload.
 * Requires kid and exactly one of ct|uri.
 */
export function parseEncBody(body: string): SealedPayload | null {
  const parts = body.split(';').map((p) => p.trim()).filter(Boolean);
  const map = new Map<string, string>();
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    if (key && val) map.set(key, val);
  }
  const kid = map.get('kid');
  if (!kid) return null;
  const ciphertext = map.get('ct');
  const uri = map.get('uri');
  const hasCt = Boolean(ciphertext);
  const hasUri = Boolean(uri);
  if (hasCt === hasUri) return null; // need exactly one
  const alg = map.get('alg');
  const sealed: SealedPayload = { kid };
  if (ciphertext) sealed.ciphertext = ciphertext;
  if (uri) sealed.uri = uri;
  if (alg) sealed.alg = alg;
  return sealed;
}

/**
 * Format sealed payload as caption-first trailing tag:
 * `<enc:kid=…;alg=…;ct=…>` or `<enc:kid=…;alg=…;uri=…>`.
 */
export function formatEncTag(sealed: SealedPayload): string {
  const parts = [`kid=${sealed.kid}`];
  if (sealed.alg) parts.push(`alg=${sealed.alg}`);
  if (sealed.ciphertext) parts.push(`ct=${sealed.ciphertext}`);
  else if (sealed.uri) parts.push(`uri=${sealed.uri}`);
  return `<enc:${parts.join(';')}>`;
}
