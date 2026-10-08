/**
 * URL templates for note links (0.2.34). One shape for every key: a string with
 * `{id}` (or `{pnid}`) for the note number, read from the document's layout block
 * first, then a host option, then a built-in default. `noteLinkHref` fills it in.
 *
 * Keys today: `noteUri` (Open #N, no built-in default), `noteMapUri` (Open map) and
 * `noteDetailsUri` (Open details).
 */
import { noteLinkHref } from './taskChrome.js';
import type { OutlineFrontmatter } from './types.js';

/** Open map when neither the layout block nor the host sets `noteMapUri`. */
export const DEFAULT_NOTE_MAP_URI = '/notes/{id}/map';
/** Open details when neither the layout block nor the host sets `noteDetailsUri`. */
export const DEFAULT_NOTE_DETAILS_URI = '/notes/{id}/details';

export type NoteUriKey = 'noteUri' | 'noteMapUri' | 'noteDetailsUri';

/** Host options for the same keys. `null` or `''` turns a built-in default off. */
export type NoteUriOptions = Partial<Record<NoteUriKey, string | null>>;

const BUILT_IN: Record<NoteUriKey, string | null> = {
  noteUri: null,
  noteMapUri: DEFAULT_NOTE_MAP_URI,
  noteDetailsUri: DEFAULT_NOTE_DETAILS_URI,
};

/** A layout value of `none` (any case) turns the row off for this document. */
const OFF = /^none$/i;

/**
 * The template for `key`: the layout block's value, else the host option, else the
 * built-in default. Null when the winner is `none`, `null` or empty (no row).
 */
export function noteUriTemplate(
  key: NoteUriKey,
  frontmatter?: OutlineFrontmatter | null,
  options?: NoteUriOptions | null,
): string | null {
  const fromLayout = frontmatter?.[key];
  if (typeof fromLayout === 'string' && fromLayout.trim()) {
    return OFF.test(fromLayout.trim()) ? null : fromLayout.trim();
  }
  if (options && key in options && options[key] !== undefined) {
    const v = options[key];
    return typeof v === 'string' && v.trim() && !OFF.test(v.trim()) ? v.trim() : null;
  }
  return BUILT_IN[key];
}

/** Every note-link href for `pnid`; a key whose template does not resolve is null. */
export function noteLinkHrefs(
  pnid: string,
  frontmatter?: OutlineFrontmatter | null,
  options?: NoteUriOptions | null,
): { note: string | null; map: string | null; details: string | null } {
  const href = (key: NoteUriKey) => noteLinkHref(noteUriTemplate(key, frontmatter, options) ?? undefined, pnid);
  return { note: href('noteUri'), map: href('noteMapUri'), details: href('noteDetailsUri') };
}
