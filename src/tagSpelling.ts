/**
 * Tag spelling. Readers accept optional whitespace around the colon and just inside
 * the brackets; writers emit `<name:value>`; an edit keeps the spelling a tag had.
 */

/** `< id : x >` -> `<id:x>` (name lower-cased, edge spaces dropped, the value kept). */
export function canonTag(token: string): string {
  const m = /^<\s*([A-Za-z][A-Za-z0-9-]*)\s*:\s*([^>]*?)\s*>$/.exec(String(token).trim());
  return m ? `<${m[1]!.toLowerCase()}:${m[2]}>` : String(token).trim();
}

/** The spelling to write for `<name:value>`: the kept one while it still names that value. */
export function spelledTag(kept: string | undefined, plain: string): string {
  return typeof kept === 'string' && canonTag(kept) === plain ? kept : plain;
}
