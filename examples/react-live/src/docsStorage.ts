/**
 * Browser-only multi-doc library for the React live demo.
 * Outline text only — do not store secrets. localStorage quota applies.
 */

export const LIB_KEY = 'audroam-outline-fold-react-live-docs-v1';
/** Superseded by LIB_KEY; migrated once then removed. */
export const OLD_SINGLE_KEY = 'audroam-outline-fold-react-live-v1';

export type StoredDoc = {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
};

export type DocLibrary = {
  version: 1;
  activeId: string;
  docs: StoredDoc[];
};

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** First non-empty outline caption line, stripped of leading `- ` / markers. */
export function titleFromBody(body: string, fallback = 'Untitled'): string {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === '---') continue;
    if (line.startsWith('fold-') || line.startsWith('fold+')) continue;
    if (/^[a-zA-Z][\w]*:/.test(line) && !line.startsWith('-')) continue; // frontmatter keys
    let t = line.replace(/^[-*+]\s+/, '').replace(/\s*<[^>]+>\s*/g, ' ').trim();
    t = t.replace(/\(\+\)$/, '').trim();
    if (t) return t.length > 48 ? `${t.slice(0, 45)}…` : t;
  }
  return fallback;
}

export function makeDoc(
  body: string,
  title?: string,
  id?: string,
): StoredDoc {
  const now = Date.now();
  return {
    id: id ?? newId(),
    title: (title?.trim() || titleFromBody(body)).trim() || 'Untitled',
    body,
    updatedAt: now,
  };
}

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function defaultLibrary(seedBody: string): DocLibrary {
  const cafe = makeDoc(seedBody, 'Cafe ops demo');
  return { version: 1, activeId: cafe.id, docs: [cafe] };
}

export function loadLibrary(seedBody: string): DocLibrary {
  const raw = lsGet(LIB_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DocLibrary;
      if (
        parsed?.version === 1 &&
        Array.isArray(parsed.docs) &&
        parsed.docs.length > 0 &&
        typeof parsed.activeId === 'string'
      ) {
        const active =
          parsed.docs.find((d) => d.id === parsed.activeId) ?? parsed.docs[0];
        return { version: 1, activeId: active.id, docs: parsed.docs };
      }
    } catch {
      /* fall through */
    }
  }

  const old = lsGet(OLD_SINGLE_KEY);
  if (old != null && old.length > 0) {
    const doc = makeDoc(old, titleFromBody(old, 'Imported draft'));
    const lib: DocLibrary = { version: 1, activeId: doc.id, docs: [doc] };
    saveLibrary(lib);
    lsRemove(OLD_SINGLE_KEY);
    return lib;
  }

  const lib = defaultLibrary(seedBody);
  saveLibrary(lib);
  return lib;
}

export function saveLibrary(lib: DocLibrary): void {
  lsSet(LIB_KEY, JSON.stringify(lib));
}

export function getActive(lib: DocLibrary): StoredDoc {
  return lib.docs.find((d) => d.id === lib.activeId) ?? lib.docs[0];
}

export function upsertActiveBody(
  lib: DocLibrary,
  body: string,
  opts?: { retitleIfUntitled?: boolean },
): DocLibrary {
  const now = Date.now();
  const docs = lib.docs.map((d) => {
    if (d.id !== lib.activeId) return d;
    let title = d.title;
    if (
      opts?.retitleIfUntitled &&
      (!title || title === 'Untitled' || title === 'New outline')
    ) {
      title = titleFromBody(body);
    }
    return { ...d, body, title, updatedAt: now };
  });
  return { ...lib, docs };
}

export function sanitizeFilename(title: string, fallback = 'outline'): string {
  const s = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
  return s || fallback;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(filename: string, text: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadLibraryJson(lib: DocLibrary): void {
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(
    `outline-fold-library-${stamp}.json`,
    JSON.stringify(lib, null, 2),
    'application/json;charset=utf-8',
  );
}

export function downloadActiveDoc(title: string, body: string): void {
  const base = sanitizeFilename(title);
  downloadTextFile(`${base}.md`, body, 'text/markdown;charset=utf-8');
}

/** Validate and normalize an imported library JSON payload. */
export function parseLibraryJson(raw: string): DocLibrary | null {
  try {
    const parsed = JSON.parse(raw) as DocLibrary;
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.docs) ||
      parsed.docs.length === 0 ||
      typeof parsed.activeId !== 'string'
    ) {
      return null;
    }
    for (const d of parsed.docs) {
      if (
        !d ||
        typeof d.id !== 'string' ||
        typeof d.title !== 'string' ||
        typeof d.body !== 'string' ||
        typeof d.updatedAt !== 'number'
      ) {
        return null;
      }
    }
    const active =
      parsed.docs.find((d) => d.id === parsed.activeId) ?? parsed.docs[0];
    return { version: 1, activeId: active.id, docs: parsed.docs };
  } catch {
    return null;
  }
}

/** Merge imported docs into existing (new ids on collision). */
export function mergeLibraries(current: DocLibrary, incoming: DocLibrary): DocLibrary {
  const ids = new Set(current.docs.map((d) => d.id));
  const merged = [...current.docs];
  for (const d of incoming.docs) {
    if (ids.has(d.id)) {
      const copy = { ...d, id: newId(), title: `${d.title} (import)`, updatedAt: Date.now() };
      merged.push(copy);
      ids.add(copy.id);
    } else {
      merged.push(d);
      ids.add(d.id);
    }
  }
  return { version: 1, activeId: current.activeId, docs: merged };
}
