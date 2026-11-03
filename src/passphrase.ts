/**
 * 0.5.16 new-key rules (Design UX spec). Only new keys are checked: unlock never checks
 * length, so existing shorter passphrases keep opening.
 */
import { EFF_LARGE_WORDLIST } from './effWordlist.js';

export { EFF_LARGE_WORDLIST };

/** The one minimum for a new key passphrase. */
export const MIN_NEW_PASSPHRASE = 16;

/** Inline strength line for the new-key dialog: '' (empty), 'Too short', or 'OK'. */
export function passphraseStrength(pass: string): '' | 'Too short' | 'OK' {
  if (!pass) return '';
  return [...pass].length < MIN_NEW_PASSPHRASE ? 'Too short' : 'OK';
}

/** "Use at least 16 characters." */
export const MIN_NEW_PASSPHRASE_TEXT = `Use at least ${MIN_NEW_PASSPHRASE} characters.`;

export interface GenerateOptions {
  words?: number;
  getRandomValues?: (a: Uint32Array) => Uint32Array;
}

/** N (default 5) random words from the EFF large list, unbiased (rejection sampling). */
export function generatePassphrase(o: GenerateOptions = {}): string {
  const n = o.words ?? 5;
  const rnd = o.getRandomValues ?? ((a: Uint32Array) => globalThis.crypto.getRandomValues(a));
  const list = EFF_LARGE_WORDLIST;
  const limit = Math.floor(0x1_0000_0000 / list.length) * list.length;
  const out: string[] = [];
  const buf = new Uint32Array(1);
  while (out.length < n) {
    rnd(buf);
    const v = buf[0]!;
    if (v >= limit) continue;
    out.push(list[v % list.length]!);
  }
  buf.fill(0);
  return out.join(' ');
}

/** "Locked after 5 min idle" from the note's real autoLockMs. */
export function idleLockText(ms: number): string {
  const min = Math.round((ms / 60_000) * 10) / 10;
  return `Locked after ${min} min idle`;
}

/**
 * Device-side hint only: true when text looks like a secret (keys, passwords, tokens, PINs).
 * Never sent anywhere; the host shows a warning next to the unencrypted field.
 */
export function looksLikeSecret(text: string): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (/-----BEGIN [A-Z ]*(PRIVATE KEY|SEAL)/.test(t)) return true;
  if (/\b(pass(word|phrase|wd)?|pwd|pin|secret|token|api[_ -]?key|seed|mnemonic|otp|cvv|cvc)\b\s*[:=]?\s*\S+/i.test(t)) return true;
  if (/\b(sk|pk|rk)[-_](live|test)[-_]\w{8,}/i.test(t) || /\b(ghp|gho|ghs|github_pat|xox[abp]|AKIA)[A-Za-z0-9_]{8,}/.test(t)) return true;
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(t)) return true; // JWT
  // A long run with mixed classes and no spaces (random key material).
  for (const w of t.split(/\s+/)) {
    if (w.length >= 24 && /[A-Z]/.test(w) && /[a-z]/.test(w) && /\d/.test(w)) return true;
    if (/^[0-9a-f]{32,}$/i.test(w)) return true;
  }
  return false;
}
