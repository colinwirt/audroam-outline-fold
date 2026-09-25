import type { OutlineNode, SealedPayload } from './types.js';

/** True when the node carries ciphertext or uri (kid optional under single-key fallback). */
export function hasSealed(node: OutlineNode): boolean {
  const s = node.sealed;
  if (!s) return false;
  return Boolean(s.ciphertext || s.uri);
}

/** True when sealed payload is remote (uri) rather than inline ct. */
export function isRemoteSealed(node: OutlineNode): boolean {
  return Boolean(node.sealed?.uri && !node.sealed?.ciphertext);
}

/**
 * Parse `<enc:kid=…;alg=…;ct=…>` or `<enc:…;ct=…>` body into a SealedPayload.
 * Requires exactly one of ct|uri. Kid is optional (single-key fallback).
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
  const ciphertext = map.get('ct');
  const uri = map.get('uri');
  const hasCt = Boolean(ciphertext);
  const hasUri = Boolean(uri);
  if (hasCt === hasUri) return null; // need exactly one
  const sealed: SealedPayload = {};
  const kid = map.get('kid');
  if (kid) sealed.kid = kid;
  if (ciphertext) sealed.ciphertext = ciphertext;
  if (uri) sealed.uri = uri;
  const alg = map.get('alg');
  if (alg) sealed.alg = alg;
  return sealed;
}

/**
 * Format sealed payload as caption-first trailing tag:
 * `<enc:kid=…;alg=…;ct=…>` or `<enc:…;ct=…>` (kid optional).
 */
export function formatEncTag(sealed: SealedPayload): string {
  const parts: string[] = [];
  if (sealed.kid) parts.push(`kid=${sealed.kid}`);
  if (sealed.alg) parts.push(`alg=${sealed.alg}`);
  if (sealed.ciphertext) parts.push(`ct=${sealed.ciphertext}`);
  else if (sealed.uri) parts.push(`uri=${sealed.uri}`);
  return `<enc:${parts.join(';')}>`;
}
