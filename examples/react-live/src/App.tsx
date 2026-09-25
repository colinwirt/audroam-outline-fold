import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  serialize,
  toggleFold,
  toHtml,
  isCollapsed,
  hasSealed,
  isRemoteSealed,
  demoOpen,
  DEMO_PASSPHRASE,
  validateDocument,
  type OutlineFoldDoc,
  type OutlineNode,
  type ValidationResult,
} from '@audroam/outline-fold';
import seedMd from '../../outline-demo.md?raw';
import {
  type DocLibrary,
  downloadActiveDoc,
  downloadLibraryJson,
  getActive,
  loadLibrary,
  makeDoc,
  mergeLibraries,
  newId,
  parseLibraryJson,
  saveLibrary,
  titleFromBody,
  upsertActiveBody,
} from './docsStorage';

function findNode(nodes: OutlineNode[], id: string): OutlineNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

function runValidate(text: string): ValidationResult {
  return validateDocument(text);
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
  const [validation, setValidation] = useState<ValidationResult>(() =>
    runValidate(active.body),
  );
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const docRef = useRef<OutlineFoldDoc | null>(
    validation.doc ?? null,
  );
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const textRef = useRef(text);
  textRef.current = text;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  if (validation.doc) {
    docRef.current = validation.doc;
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
    setValidation(runValidate(body));
  }, []);

  const onTextChange = useCallback(
    (next: string) => {
      setText(next);
      textRef.current = next;
      setValidation(runValidate(next));
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
      const synced = serialize(next);
      setValidation(runValidate(synced));
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


  const onDownloadDoc = useCallback(() => {
    const gate = runValidate(textRef.current);
    if (!gate.ok) {
      window.alert(
        'Document has validation errors — fix them before download/share.\n\n' +
          gate.issues
            .filter((i) => i.severity === 'error')
            .map((i) => `• [${i.code}] ${i.message}`)
            .join('\n'),
      );
      setValidation(gate);
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const lib = flushBodyToLibrary(textRef.current);
    const cur = getActive(lib);
    downloadActiveDoc(cur.title, textRef.current);
  }, [flushBodyToLibrary]);

  const onDownloadLibrary = useCallback(() => {
    const gate = runValidate(textRef.current);
    if (!gate.ok) {
      window.alert(
        'Active document has validation errors — fix them before download/share.',
      );
      setValidation(gate);
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const lib = flushBodyToLibrary(textRef.current);
    downloadLibraryJson(lib);
  }, [flushBodyToLibrary]);

  const onImportClick = useCallback(() => {
    importFileRef.current?.click();
  }, []);

  const onImportFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      const raw = await file.text();
      const incoming = parseLibraryJson(raw);
      if (!incoming) {
        window.alert(
          'Could not import: expected a library JSON with version 1 and at least one doc.',
        );
        return;
      }
      if (
        !window.confirm(
          `Import ${incoming.docs.length} doc(s) from “${file.name}”?`,
        )
      ) {
        if (importFileRef.current) importFileRef.current.value = '';
        return;
      }
      const merge = window.confirm(
        'OK = merge into current library\nCancel = replace library entirely',
      );
      if (saveTimer.current) clearTimeout(saveTimer.current);
      let next: DocLibrary;
      if (merge) {
        const current = flushBodyToLibrary(textRef.current);
        next = mergeLibraries(current, incoming);
      } else {
        next = incoming;
      }
      persistLibrary(next);
      loadDocBody(getActive(next).body);
      if (importFileRef.current) importFileRef.current.value = '';
    },
    [flushBodyToLibrary, persistLibrary, loadDocBody],
  );

  const renderDoc = validation.doc ?? docRef.current;
  const html = useMemo(
    () => (renderDoc ? toHtml(renderDoc) : ''),
    [renderDoc, validation],
  );


  const trySessionReveal = useCallback(
    async (id: string) => {
      const current = docRef.current;
      if (!current) return;
      const node = findNode(current.nodes, id);
      if (!node || !hasSealed(node)) {
        window.alert(
          `No sealed payload on “${id}”. Host MFA/crypto is out of this package.`,
        );
        return;
      }
      if (isRemoteSealed(node)) {
        window.alert(
          `Remote sealed blob (kid=${node.sealed?.kid}).\nURI: ${node.sealed?.uri}\n\nDemo does not fetch — host would fetch after key release.`,
        );
        return;
      }
      const source = window.prompt(
        [
          'Key source for cafe demo:',
          '1 = browser session (sample passphrase)',
          '2 = paste from password manager',
          '3 = pageant / OS agent (stub)',
          '4 = server after MFA (stub → sample key)',
          '',
          'Enter 1–4:',
        ].join('\n'),
        '1',
      );
      if (source == null) return;
      let pass: string | null = null;
      switch (source.trim()) {
        case '1':
          pass = window.prompt(
            `Session passphrase (hint: ${DEMO_PASSPHRASE})`,
            DEMO_PASSPHRASE,
          );
          break;
        case '2':
          pass = window.prompt(
            'Paste passphrase from password manager (demo field):',
            '',
          );
          break;
        case '3':
          window.alert(
            'Pageant / OS agent is not wired in this browser demo. Use 1 or 2, or see README.',
          );
          return;
        case '4':
          window.alert(
            'Stub: MFA OK → host would release DEK. Demo falls through to sample passphrase.',
          );
          pass = DEMO_PASSPHRASE;
          break;
        default:
          window.alert('Unknown key source — use 1–4.');
          return;
      }
      if (pass == null) return;
      try {
        const plaintext = await demoOpen(node.sealed!, pass);
        setRevealed((r) => ({ ...r, [id]: plaintext }));
        if (isCollapsed(current, id)) onToggleFold(id);
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'Decrypt failed (wrong key?)',
        );
      }
    },
    [onToggleFold],
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
      const decrypt = target.closest('[data-decrypt]') as HTMLElement | null;
      const btn = unlock ?? decrypt;
      if (btn) {
        e.preventDefault();
        const id =
          btn.getAttribute('data-unlock') ??
          btn.getAttribute('data-decrypt') ??
          '';
        void trySessionReveal(id);
      }
    },
    [onToggleFold, trySessionReveal],
  );


  useEffect(() => {
    const tree = document.querySelector('.preview-pane .tree, .tree');
    if (!tree) return;
    for (const [id, plaintext] of Object.entries(revealed)) {
      const li = tree.querySelector(
        '.of-node[data-id="' + CSS.escape(id) + '"]',
      ) as HTMLElement | null;
      if (!li) continue;
      const locked = li.querySelector(':scope > .of-locked-chrome');
      if (locked) locked.remove();
      let panel = li.querySelector(':scope > .of-reveal') as HTMLElement | null;
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'of-reveal';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', 'Session reveal');
        const row = li.querySelector(':scope > .of-row');
        if (row) row.insertAdjacentElement('afterend', panel);
        else li.prepend(panel);
      }
      panel.innerHTML =
        '<span class="of-reveal-label">Session reveal (demo) · not written to editor</span>' +
        plaintext
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
    }
  }, [revealed, html]);

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
          Edit outline source on the left · live <code>validateDocument</code> +{' '}
          <code>toHtml</code> on the right. Invalid docs still render what parse can build;
          issues appear under the editor. Download/share is gated when <code>!ok</code>.
          Click <kbd>(+)</kbd> to <code>toggleFold</code>; fold state syncs via{' '}
          <code>serialize</code>. Drafts stay in this browser’s <code>localStorage</code>{' '}
          (outline text only — no secrets). Unlock/Decrypt uses demo key sources.
          OSS example only — not production MFA.
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
        <span className="doc-bar-sep" aria-hidden="true" />
        <button type="button" className="doc-btn" onClick={onDownloadDoc} title="Download active doc as .md">
          Download .md
        </button>
        <button type="button" className="doc-btn" onClick={onDownloadLibrary} title="Download full library as .json">
          Download library
        </button>
        <button type="button" className="doc-btn" onClick={onImportClick} title="Import library JSON (merge or replace)">
          Import library
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => void onImportFile(e.target.files?.[0] ?? null)}
        />
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
          {validation.issues.length > 0 ? (
            <div
              className={
                'validation-panel' +
                (validation.ok ? ' validation-panel-warn' : ' validation-panel-error')
              }
              role="status"
              aria-live="polite"
            >
              <div className="validation-panel-title">
                {validation.ok
                  ? `Warnings (${validation.issues.length}) — outline still renders`
                  : `Errors (${validation.issues.filter((i) => i.severity === 'error').length}) — download/share gated; outline still renders when parseable`}
              </div>
              <ul className="validation-list">
                {validation.issues.map((iss, idx) => (
                  <li key={idx} className={'validation-item severity-' + iss.severity}>
                    <span className="validation-sev">{iss.severity}</span>
                    <code className="validation-code">{iss.code}</code>
                    <span className="validation-msg">{iss.message}</span>
                    {iss.line != null ? (
                      <span className="validation-meta">line {iss.line}</span>
                    ) : null}
                    {iss.nodeId ? (
                      <span className="validation-meta">#{iss.nodeId}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="pane preview-pane">
          <div className="pane-label">Preview</div>
          {html ? (
            <div
              className="tree"
              onClick={onTreeClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <div className="parse-error" role="alert">
              <strong>Nothing to render yet</strong>
              <pre>
                {validation.issues.map((i) => `[${i.code}] ${i.message}`).join('\n') ||
                  'Empty document'}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
