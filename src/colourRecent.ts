/** Session + localStorage list of recently picked node colours (compact menus, toolbar). */
const KEY = 'of-colour-recent';
/** One compact strip is 2×6, so 12 is a natural cap. */
export const RECENT_COLOUR_MAX = 12;

let memory: string[] = [];

function readStore(): string[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0 && x !== 'none');
  } catch {
    return null;
  }
}

/** Recently picked colour roles, most recent first. */
export function recentColours(): string[] {
  const stored = readStore();
  if (stored) return stored.slice(0, RECENT_COLOUR_MAX);
  return memory.slice(0, RECENT_COLOUR_MAX);
}

/** Move `name` to the front of the recent list (ignores `none` / empty). */
export function rememberColour(name: string | undefined | null): void {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || n === 'none') return;
  const next = [n, ...recentColours().filter((c) => c !== n)].slice(0, RECENT_COLOUR_MAX);
  memory = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / SSR */
  }
}

export function clearRecentColours(): void {
  memory = [];
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* */
  }
}
