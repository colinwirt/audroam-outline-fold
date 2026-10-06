/**
 * Shared parse entry: markdown → OutlineFoldDoc (+ validation).
 * All Pages demos must use this (or package parse) — no per-page parsers.
 */
import { parse, validateDocument } from '../../dist/index.js';

/**
 * @param {string} md
 * @param {{ validate?: boolean }} [opts]
 * @returns {{ doc: import('../../dist/index.js').OutlineFoldDoc, validation: import('../../dist/index.js').ValidationResult | null, raw: string }}
 */
export function parseDoc(md, opts = {}) {
  const validate = opts.validate !== false;
  const validation = validate ? validateDocument(md) : null;
  // Session ids let lines without <id:…> fold, tick and take map focus.
  const doc = parse(md, { sessionIds: true });
  return { doc, validation, raw: md };
}

/**
 * Fetch markdown and parse.
 * @param {string | URL} url
 * @param {{ validate?: boolean }} [opts]
 */
export async function loadDoc(url, opts = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${String(url)}`);
  const raw = await res.text();
  return parseDoc(raw, opts);
}

export { parse, validateDocument };
