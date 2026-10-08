/**
 * Tag spelling. Readers accept optional whitespace around the colon and just inside
 * the brackets. Storage keeps every tag as the author typed it, spaces included; only
 * a tag the software generates is written `<name:value>`. Display shows the clean form.
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

const DISPLAY_TAG = /<\s*(id|t|r|kind|enc|action|thread|db)\s*:\s*([^>\n]*?)\s*>/gi;

/**
 * Display form of caption text: every colon tag in the clean `<name:value>` spelling
 * (`<t: 41609 >` -> `<t:41609>`, `<Kind : doc>` -> `<kind:doc>`). Text inside backticks is
 * code and stays literal. For rendering only: never write the result back to storage.
 */
export function displayTags(text: string): string {
  return String(text ?? '')
    .split(/(`[^`\n]+`)/)
    .map((part, i) =>
      i % 2 ? part : part.replace(DISPLAY_TAG, (_m, name: string, value: string) => `<${name.toLowerCase()}:${value}>`)
    )
    .join('');
}
