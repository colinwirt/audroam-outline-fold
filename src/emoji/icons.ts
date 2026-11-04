/**
 * 0.5.18 node icons, shortcodes and the `:` typeahead (Design UX 2026-11-04 EP-1…EP-30).
 *
 * Storage (EP-22, EP-25): a Unicode emoji is stored as the character; built-in clipart as a
 * `:name:` shortcode. `<icon:name>` (thumbnails T14) is read as an alias and written back as
 * typed (Q10 default). The node icon is a leading token after the task marker:
 * `- [ ] :compass: Route review`. The title holds only the text after it (EP-1).
 *
 * Emoji names and keywords come from Unicode CLDR data in a lazily loaded module
 * (`loadEmojiData`). Glyphs are drawn by the system emoji font (EMOJI_RENDERING, Q8 open).
 */
import { CLIPART, clipartByName, isReservedIconName, type ClipartEntry } from './clipart.js';

/** Q8 default: native system emoji, no bundled image set. Switch when a set is chosen. */
export const EMOJI_RENDERING: 'native' = 'native';
/**
 * Q10 default: the canonical saved form for clipart. `'shortcode'` writes `:name:`; the alias
 * `<icon:name>` is kept exactly as typed on round-trip (only new picks use this form).
 */
export const CLIPART_SAVE_FORM: 'shortcode' | 'icon-tag' = 'shortcode';

export type EmojiCategory = 'smileys' | 'people' | 'nature' | 'food' | 'objects' | 'symbols';

export interface EmojiEntry {
  char: string;
  /** Shortcode name (`grinning_face`). */
  code: string;
  keywords: string[];
  category: EmojiCategory;
}

export type ResolvedIcon =
  | { kind: 'emoji'; char: string; name?: string }
  | { kind: 'clipart'; name: string; entry: ClipartEntry; alias: boolean }
  | { kind: 'text'; text: string };

export interface IconItem {
  kind: 'emoji' | 'clipart';
  /** Glyph to show (emoji, or the clipart's fallback). */
  char: string;
  code: string;
  /** Display name (`Compass`, `pizza`). */
  name: string;
  keywords: string[];
  /** Text inserted / stored: the character, or `:name:`. */
  insert: string;
  category: EmojiCategory | 'map';
  svg?: string;
  recent?: boolean;
  pinned?: boolean;
}

// ── Emoji data (lazy) ──────────────────────────────────────────────────────

let emojiList: EmojiEntry[] | null = null;
let byChar: Map<string, EmojiEntry> | null = null;
let byCode: Map<string, EmojiEntry> | null = null;
let loading: Promise<EmojiEntry[]> | null = null;

/** Loads the CLDR name/keyword module once (EP-11). Safe to call repeatedly. */
export function loadEmojiData(): Promise<EmojiEntry[]> {
  if (emojiList) return Promise.resolve(emojiList);
  loading ??= import('./emojiData.js').then((m) => {
    emojiList = m.EMOJI_ROWS.map((row) => {
      const [char, code, kw, category] = row.split('|');
      return { char: char!, code: code!, keywords: kw ? kw.split(' ') : [], category: category as EmojiCategory };
    });
    byChar = new Map(emojiList.map((e) => [e.char, e]));
    byCode = new Map(emojiList.map((e) => [e.code, e]));
    return emojiList;
  });
  return loading;
}

/** The loaded list, or null before `loadEmojiData` resolves. */
export function emojiData(): EmojiEntry[] | null {
  return emojiList;
}

export function emojiByCode(code: string): EmojiEntry | undefined {
  return byCode?.get(code.toLowerCase());
}

function emojiName(e: EmojiEntry): string {
  return e.code.replace(/_/g, ' ');
}

// ── Tokens ─────────────────────────────────────────────────────────────────

const SHORTCODE = /^:([a-z0-9][a-z0-9_+-]*):$/i;
const ICON_TAG = /^<icon:\s*([a-z0-9][a-z0-9_-]*)\s*>$/i;
const SKIN = '[\\u{1F3FB}-\\u{1F3FF}]';
const PICT = `(?:\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F)${SKIN}?`;
/** One emoji grapheme: flag pair, keycap, or a pictograph with optional ZWJ sequence. */
const EMOJI_SRC = `(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|${PICT}(?:\\u200D(?:\\p{Extended_Pictographic}\\uFE0F?)${SKIN}?)*)`;
const LEADING_EMOJI = new RegExp(`^(${EMOJI_SRC})[ \\t]+(?=\\S)`, 'u');
const LEADING_CODE = /^(:[a-z0-9][a-z0-9_+-]*:|<icon:\s*[a-z0-9][a-z0-9_-]*\s*>)[ \t]+(?=\S)/i;
const ONLY_EMOJI = new RegExp(`^${EMOJI_SRC}$`, 'u');

export function isEmojiChar(s: string): boolean {
  return ONLY_EMOJI.test(s);
}

/** Built-in clipart name for `:name:` / `<icon:name>`, or null (unknown / reserved). */
function clipartToken(token: string): { entry: ClipartEntry; alias: boolean } | null {
  const m = token.match(SHORTCODE) ?? token.match(ICON_TAG);
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  if (isReservedIconName(name)) return null;
  const entry = clipartByName(name);
  return entry ? { entry, alias: token.startsWith('<') } : null;
}

/**
 * The leading node icon of a caption (after the task marker), or null. Only a known clipart
 * token, its `<icon:name>` alias, or one emoji followed by more text counts, so an emoji-only
 * title and `:unknown:` stay text.
 */
export function parseLeadingIcon(text: string): { icon: string; rest: string } | null {
  const s = String(text);
  const c = s.match(LEADING_CODE);
  if (c && clipartToken(c[1]!)) return { icon: c[1]!, rest: s.slice(c[0].length) };
  const e = s.match(LEADING_EMOJI);
  if (e) return { icon: e[1]!, rest: s.slice(e[0].length) };
  return null;
}

/** EP-24 lookup: clipart (built-in name) → emoji → the token as plain text. */
export function resolveIcon(token: string): ResolvedIcon {
  const t = String(token ?? '');
  const clip = clipartToken(t);
  if (clip) return { kind: 'clipart', name: clip.entry.name, entry: clip.entry, alias: clip.alias };
  if (isEmojiChar(t)) {
    const e = byChar?.get(t) ?? byChar?.get(t.replace(/\uFE0F/g, ''));
    return e ? { kind: 'emoji', char: t, name: emojiName(e) } : { kind: 'emoji', char: t };
  }
  return { kind: 'text', text: t };
}

/** The stored token for a pick (EP-22, EP-29). */
export function iconTokenFor(pick: { kind: 'clipart'; name: string } | { kind: 'emoji'; char: string }): string {
  if (pick.kind === 'emoji') return pick.char;
  return CLIPART_SAVE_FORM === 'icon-tag' ? `<icon:${pick.name}>` : `:${pick.name}:`;
}

/** EP-25: export keeps tokens, or swaps in each clipart's fallback emoji. */
export function exportIconToken(token: string, mode: 'keep' | 'fallback'): string {
  if (mode === 'keep') return token;
  const r = resolveIcon(token);
  return r.kind === 'clipart' ? r.entry.fallback : token;
}

/** Name for assistive tech and the footer (`Compass · clipart`). */
export function iconLabel(token: string): string {
  const r = resolveIcon(token);
  if (r.kind === 'clipart') return r.entry.label;
  if (r.kind === 'emoji') return r.name ?? r.char;
  return r.text;
}

/** Map pill glyph (text layer): clipart shows its fallback emoji there. */
export function iconGlyph(token: string): string {
  const r = resolveIcon(token);
  if (r.kind === 'clipart') return r.entry.fallback;
  if (r.kind === 'emoji') return r.char;
  return r.text;
}

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Outline row markup for the EP-1 slot. Never an image URL (EP-24: never a broken image). */
export function nodeIconHtml(token: string, prefix = 'of'): string {
  const r = resolveIcon(token);
  const label = escHtml(iconLabel(token));
  if (r.kind === 'clipart') {
    return `<span class="${prefix}-node-icon ${prefix}-node-icon-clipart" role="img" aria-label="${label}" data-icon="${escHtml(r.name)}">${r.entry.svg}</span>`;
  }
  if (r.kind === 'emoji') {
    return `<span class="${prefix}-node-icon" role="img" aria-label="${label}">${escHtml(r.char)}</span>`;
  }
  return `<span class="${prefix}-node-icon ${prefix}-node-icon-text">${escHtml(r.text)}</span>`;
}

// ── Items, search, typeahead ──────────────────────────────────────────────

export function clipartItem(c: ClipartEntry): IconItem {
  return { kind: 'clipart', char: c.fallback, code: c.name, name: c.label, keywords: c.keywords, insert: iconTokenFor({ kind: 'clipart', name: c.name }), category: 'map', svg: c.svg };
}

export function emojiItem(e: EmojiEntry): IconItem {
  return { kind: 'emoji', char: e.char, code: e.code, name: emojiName(e), keywords: e.keywords, insert: e.char, category: e.category };
}

/** Item for a stored token (recent / pinned rows), or null when it no longer resolves. */
export function itemForToken(token: string): IconItem | null {
  const r = resolveIcon(token);
  if (r.kind === 'clipart') return clipartItem(r.entry);
  if (r.kind === 'emoji') {
    const e = byChar?.get(r.char);
    return e ? emojiItem(e) : { kind: 'emoji', char: r.char, code: r.char, name: r.char, keywords: [], insert: r.char, category: 'symbols' };
  }
  return null;
}

export function allIconItems(): IconItem[] {
  const clip = CLIPART.map(clipartItem);
  return emojiList ? clip.concat(emojiList.map(emojiItem)) : clip;
}

/** 0 exact, 1 code prefix, 2 word / keyword prefix, 3 substring; -1 no match. */
function score(it: IconItem, q: string): number {
  if (it.code === q) return 0;
  if (it.code.startsWith(q)) return 1;
  if (it.code.split('_').some((w) => w.startsWith(q))) return 2;
  if (it.name.toLowerCase().split(' ').some((w) => w.startsWith(q))) return 2;
  if (it.keywords.some((k) => k.startsWith(q) || k.split(' ').some((w) => w.startsWith(q)))) return 2;
  if (it.code.includes(q)) return 3;
  return -1;
}

function normQuery(q: string): string {
  return q.trim().toLowerCase().replace(/^:|:$/g, '').replace(/\s+/g, '_');
}

/** EP-11 / EP-26: one flat result list over names, shortcodes and keywords. */
export function searchIcons(query: string, opts: { prefs?: IconPrefs; limit?: number } = {}): IconItem[] {
  const q = normQuery(query);
  if (!q) return [];
  const recent = new Set(opts.prefs?.recent() ?? []);
  const hits: { it: IconItem; s: number; r: number; i: number }[] = [];
  allIconItems().forEach((it, i) => {
    const qs = q.replace(/_/g, ' ');
    let s = score(it, q);
    if (s < 0 && qs !== q && it.name.toLowerCase().includes(qs)) s = 3;
    if (s >= 0) hits.push({ it, s, r: recent.has(it.insert) ? 0 : 1, i });
  });
  hits.sort((a, b) => a.r - b.r || a.s - b.s || a.i - b.i);
  const out = hits.map((h) => (h.r === 0 ? { ...h.it, recent: true } : h.it));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** EP-27: about 6 rows, recent first, then name and keyword matches. */
export function typeaheadMatches(query: string, opts: { prefs?: IconPrefs; limit?: number } = {}): IconItem[] {
  return searchIcons(query, { prefs: opts.prefs, limit: opts.limit ?? TYPEAHEAD_ROWS });
}

export const TYPEAHEAD_ROWS = 6;

/**
 * EP-27: the `:query` before the caret, or null. Opens on `:` + 1 letter at a word start
 * (`10:30` does not open); a space or a second `:` ends it.
 */
export function colonQuery(text: string, caret: number): { from: number; query: string } | null {
  const before = String(text).slice(0, caret);
  const m = before.match(/(?:^|[\s([{"'])(:([a-z0-9_+-]+))$/i);
  if (!m) return null;
  return { from: before.length - m[1]!.length, query: m[2]! };
}

/**
 * EP-29: a typed `:name:` that matches resolves like a pick: an emoji code becomes its
 * character, a clipart name stays `:name:`. Returns the replacement or null.
 */
export function resolveTypedShortcode(text: string, caret: number): { from: number; to: number; insert: string } | null {
  const before = String(text).slice(0, caret);
  const m = before.match(/(?:^|[\s([{"'])(:([a-z0-9_+-]+):)$/i);
  if (!m) return null;
  const code = m[2]!.toLowerCase();
  const from = before.length - m[1]!.length;
  const clip = clipartByName(code);
  if (clip && !isReservedIconName(code)) return { from, to: caret, insert: m[1]! };
  const e = emojiByCode(code);
  return e ? { from, to: caret, insert: e.char } : null;
}

/**
 * 0.5.26: display form of stored text. A known emoji `:code:` (on a word boundary, outside
 * backtick code) shows as its character; clipart names, unknown codes and code spans stay
 * as typed. The stored text is never rewritten. Needs `loadEmojiData()` first (else a no-op).
 */
export function displayShortcodes(text: string): string {
  const s = String(text ?? '');
  if (!byCode || !s.includes(':')) return s;
  return s
    .split(/(```[\s\S]*?```|`[^`\n]+`)/)
    .map((seg, i) => (i % 2 ? seg : seg.replace(/(^|[\s([{"'>])(:([a-z0-9][a-z0-9_+-]*):)(?=$|[\s.,;:!?)\]}"'<])/gi, (all, pre: string, _tok: string, code: string) => {
      const c = code.toLowerCase();
      if (clipartByName(c) && !isReservedIconName(c)) return all;
      const e = byCode!.get(c);
      return e ? pre + e.char : all;
    })))
    .join('');
}

// ── Pinned / recent (EP-9) ─────────────────────────────────────────────────

export const MAX_PINNED = 8;
export const MAX_RECENT = 16;
/** Q6 default: per device (localStorage). */
export const PREFS_KEY = 'of-icon-prefs';

export interface IconPrefs {
  pinned(): string[];
  recent(): string[];
  isPinned(token: string): boolean;
  togglePin(token: string): boolean;
  useRecent(token: string): void;
  /** EP-4: 6 quick-row tokens, pinned first then recent. */
  quickRow(): string[];
}

const DEFAULT_QUICK = ['👍', '✅', '🔥', '💡', '📌', '⭐'];

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function createIconPrefs(storage?: StorageLike | null): IconPrefs {
  const store: StorageLike | null =
    storage === undefined ? ((globalThis as { localStorage?: StorageLike }).localStorage ?? null) : storage;
  let state: { pinned: string[]; recent: string[] } = { pinned: [], recent: [] };
  try {
    const raw = store?.getItem(PREFS_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      state = { pinned: Array.isArray(v.pinned) ? v.pinned.slice(0, MAX_PINNED) : [], recent: Array.isArray(v.recent) ? v.recent.slice(0, MAX_RECENT) : [] };
    }
  } catch {
    /* corrupt or blocked storage: start empty */
  }
  const save = () => {
    try {
      store?.setItem(PREFS_KEY, JSON.stringify(state));
    } catch {
      /* quota / private mode */
    }
  };
  return {
    pinned: () => state.pinned.slice(),
    recent: () => state.recent.slice(),
    isPinned: (t) => state.pinned.includes(t),
    togglePin(t) {
      if (state.pinned.includes(t)) {
        state.pinned = state.pinned.filter((x) => x !== t);
        save();
        return false;
      }
      state.pinned = [...state.pinned, t].slice(-MAX_PINNED);
      save();
      return true;
    },
    useRecent(t) {
      state.recent = [t, ...state.recent.filter((x) => x !== t)].slice(0, MAX_RECENT);
      save();
    },
    quickRow() {
      const out: string[] = [];
      for (const t of [...state.pinned, ...state.recent, ...DEFAULT_QUICK]) {
        if (!out.includes(t)) out.push(t);
        if (out.length === 6) break;
      }
      return out;
    },
  };
}
