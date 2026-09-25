import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  parse,
  serialize,
  toggleFold,
  toHtml,
  type OutlineFoldDoc,
} from '@audroam/outline-fold';
import seedMd from '../../outline-demo.md?raw';
import {
  type DocLibrary,
  getActive,
  loadLibrary,
  makeDoc,
  newId,
  saveLibrary,
  titleFromBody,
  upsertActiveBody,
} from './docsStorage';

type ParseOk = { ok: true; doc: OutlineFoldDoc };
type ParseErr = { ok: false; message: string };
type ParseState = ParseOk | ParseErr;

function tryParse(text: string): ParseState {
  try {
    return { ok: true, doc: parse(text) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Read-only fold view: edit in the textarea; clicks call toggleFold only
 * (no re-parse). After fold, serialize syncs fold-/fold+ back into the source.
 * Multi-doc library in localStorage (browser-only notetaker).
 */
export default function App() {
  const [library, setLibrary] = useState<DocLibrary>(() =>
    loadLibrary(seedMd),
  );
  const active = getActive(library);
  const [text, setText] = useState(active.body);
  const [parsed, setParsed] = useState<ParseState>(() =>
    tryParse(active.body),
  );
  const docRef = useRef<OutlineFoldDoc | null>(
    parsed.ok ? parsed.doc : null,
  );
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const textRef = useRef(text);
  textRef.current = text;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (parsed.ok) {
    docRef.current = parsed.doc;
  }

  const persistLibrary = useCallback((next: DocLibrary) => {
    setLibrary(next);
    libraryRef.current = next;
    saveLibrary(next);
  }, []);

  const flushBodyToLibrary = useCallback(
    (body: string, lib: DocLibrary = libraryRef.current) => {
      const next = upsertActiveBody(lib, body, { retitleIfUntitled: true });
      persistLibrary(next);
      return next;
    },
    [persistLibrary],
  );

  const scheduleAutosave = useCallback(
    (body: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        flushBodyToLibrary(body);
      }, 250);
    },
    [flushBodyToLibrary],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const loadDocBody = useCallback((body: string) => {
    setText(body);
    textRef.current = body;
    setParsed(tryParse(body));
  }, []);

  const onTextChange = useCallback(
    (next: string) => {
      setText(next);
      textRef.current = next;
      setParsed(tryParse(next));
      scheduleAutosave(next);
    },
    [scheduleAutosave],
  );

  const onToggleFold = useCallback(
    (id: string) => {
      const current = docRef.current;
      if (!current) return;
      const next = toggleFold(current, id);
      docRef.current = next;
      setParsed({ ok: true, doc: next });
      const synced = serialize(next);
      setText(synced);
      textRef.current = synced;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flushBodyToLibrary(synced);
    },
    [flushBodyToLibrary],
  );

  const switchDoc = useCallback(
    (nextId: string) => {
      if (nextId === libraryRef.current.activeId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      let lib = flushBodyToLibrary(textRef.current);
      const target = lib.docs.find((d) => d.id === nextId);
      if (!target) return;
      lib = { ...lib, activeId: nextId };
      persistLibrary(lib);
      loadDocBody(target.body);
    },
    [flushBodyToLibrary, persistLibrary, loadDocBody],
  );

  const onNewDoc = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    let lib = flushBodyToLibrary(textRef.current);
    const doc = makeDoc('', 'Untitled');
    lib = {
      version: 1,
      activeId: doc.id,
      docs: [...lib.docs, doc],
    };
    persistLibrary(lib);
    loadDocBody(doc.body);
  }, [flushBodyToLibrary, persistLibrary, loadDocBody]);

  const onRename = useCallback(() => {
    const cur = getActive(libraryRef.current);
    const nextTitle = window.prompt('Rename document', cur.title);
    if (nextTitle == null) return;
    const title = nextTitle.trim() || titleFromBody(textRef.current);
    const now = Date.now();
    const lib: DocLibrary = {
      ...libraryRef.current,
      docs: libraryRef.current.docs.map((d) =>
        d.id === cur.id ? { ...d, title, updatedAt: now } : d,
      ),
    };
    persistLibrary(lib);
  }, [persistLibrary]);

  const onDuplicate = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    let lib = flushBodyToLibrary(textRef.current);
    const cur = getActive(lib);
    const copy = makeDoc(cur.body, `${cur.title} (copy)`);
    lib = {
      version: 1,
      activeId: copy.id,
      docs: [...lib.docs, copy],
    };
    persistLibrary(lib);
    loadDocBody(copy.body);
  }, [flushBodyToLibrary, persistLibrary, loadDocBody]);

  const onDelete = useCallback(() => {
    const lib0 = libraryRef.current;
    const cur = getActive(lib0);
    if (
      !window.confirm(
        `Delete “${cur.title}”? This cannot be undone (browser draft only).`,
      )
    ) {
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    let docs = lib0.docs.filter((d) => d.id !== cur.id);
    if (docs.length === 0) {
      const cafe = makeDoc(seedMd, 'Cafe ops demo', newId());
      docs = [cafe];
      persistLibrary({ version: 1, activeId: cafe.id, docs });
      loadDocBody(cafe.body);
      return;
    }
    const activeId = docs[0].id;
    persistLibrary({ version: 1, activeId, docs });
    loadDocBody(docs[0].body);
  }, [persistLibrary, loadDocBody]);

  const onLoadCafe = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    let lib = flushBodyToLibrary(textRef.current);
    const cafe = makeDoc(seedMd, 'Cafe ops demo');
    lib = {
      version: 1,
      activeId: cafe.id,
      docs: [...lib.docs, cafe],
    };
    persistLibrary(lib);
    loadDocBody(cafe.body);
  }, [flushBodyToLibrary, persistLibrary, loadDocBody]);

  const html = useMemo(
    () => (parsed.ok ? toHtml(parsed.doc) : ''),
    [parsed],
  );

  const onTreeClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const foldBtn = target.closest(
        '[data-toggle-fold]',
      ) as HTMLElement | null;
      if (foldBtn) {
        e.preventDefault();
        const id = foldBtn.getAttribute('data-toggle-fold');
        if (id) onToggleFold(id);
        return;
      }
      const unlock = target.closest('[data-unlock]') as HTMLElement | null;
      if (unlock) {
        e.preventDefault();
        const id = unlock.getAttribute('data-unlock') ?? '';
        console.info(`[stub] Unlock (MFA) for id=${id} — host owns auth`);
        window.alert(
          `Unlock stub for “${id}”. Real MFA lives in the host app — not this OSS example.`,
        );
        return;
      }
      const decrypt = target.closest('[data-decrypt]') as HTMLElement | null;
      if (decrypt) {
        e.preventDefault();
        const id = decrypt.getAttribute('data-decrypt') ?? '';
        console.info(`[stub] Decrypt for id=${id} — host owns crypto`);
        window.alert(
          `Decrypt stub for “${id}”. Real crypto lives in the host app — not this OSS example.`,
        );
      }
    },
    [onToggleFold],
  );

  useEffect(() => {
    document.documentElement.style.colorScheme = 'dark';
  }, []);

  const sortedDocs = useMemo(
    () =>
      [...library.docs].sort((a, b) => b.updatedAt - a.updatedAt),
    [library.docs],
  );

  return (
    <div className="app">
      <header className="header">
        <h1>@audroam/outline-fold — React live parser</h1>
        <p className="meta">
          Edit outline source on the left · live <code>parse</code> →{' '}
          <code>toHtml</code> on the right. Click <kbd>(+)</kbd> to{' '}
          <code>toggleFold</code> (no re-parse); fold state syncs via{' '}
          <code>serialize</code>. Multiple drafts stay in this browser’s{' '}
          <code>localStorage</code> (outline text only — no secrets).
          Unlock/Decrypt are stubs. OSS example only — not the Audroam Angular
          SPA.
        </p>
      </header>

      <div className="doc-bar" role="toolbar" aria-label="Documents">
        <label className="doc-select-wrap">
          <span className="sr-only">Document</span>
          <select
            className="doc-select"
            value={library.activeId}
            onChange={(e) => switchDoc(e.target.value)}
            aria-label="Select document"
          >
            {sortedDocs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || 'Untitled'}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="doc-btn" onClick={onNewDoc}>
          New
        </button>
        <button type="button" className="doc-btn" onClick={onRename}>
          Rename
        </button>
        <button type="button" className="doc-btn" onClick={onDuplicate}>
          Duplicate
        </button>
        <button type="button" className="doc-btn" onClick={onDelete}>
          Delete
        </button>
        <button type="button" className="doc-btn doc-btn-accent" onClick={onLoadCafe}>
          Load cafe sample
        </button>
      </div>

      <div className="panes">
        <section className="pane source-pane">
          <div className="pane-label">Source</div>
          <textarea
            className="source"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            spellCheck={false}
            aria-label="Outline source"
          />
        </section>

        <section className="pane preview-pane">
          <div className="pane-label">Preview</div>
          {parsed.ok ? (
            <div
              className="tree"
              onClick={onTreeClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <div className="parse-error" role="alert">
              <strong>Parse error</strong>
              <pre>{parsed.message}</pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
