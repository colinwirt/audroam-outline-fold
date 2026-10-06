import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type ButtonHTMLAttributes,
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
  createMapView,
  seedColdStartFold,
  mapResumeStorageKey,
  loadMapResume,
  overlayResumeOnLayout,
  softResetResume,
  isResumeStale,
  collectNodeIds,
  createDebouncedResumeSave,
  bindTap,
  type OutlineFoldDoc,
  type OutlineNode,
  type ValidationResult,
  type MapLayout,
  type MapViewHandle,
  type MapResumeState,
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

/** Signature of the fold state authored in the source text. */
function foldSig(d: OutlineFoldDoc | null | undefined): string {
  if (!d) return '';
  return d.fold.mode + ':' + [...d.fold.ids].sort().join(',');
}

/**
 * Live parser: edit in the textarea; Outline preview via toHtml + toggleFold;
 * Map preview via package createMapView (auto-pack). Shared fold state —
 * serialize syncs fold-/fold+ back into the source. Multi-doc library in
 * localStorage (browser-only notetaker).
 */

/**
 * Toolbar button wired through the package's bindTap (0.2.30): touch activates
 * on pointerup, mouse and keyboard keep click, one activation per tap.
 */
function TapButton({
  onTap,
  children,
  ...rest
}: { onTap: () => void; children: ReactNode } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick' | 'type' | 'children'
>) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return bindTap(el, () => tapRef.current());
  }, []);
  return (
    <button ref={ref} type="button" {...rest}>
      {children}
    </button>
  );
}

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
  const [previewMode, setPreviewMode] = useState<'outline' | 'map'>('outline');
  const previewModeRef = useRef(previewMode);
  previewModeRef.current = previewMode;
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapBtnRef = useRef<HTMLButtonElement | null>(null);
  const previewPaneRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<MapViewHandle | null>(null);
  const layoutRef = useRef<MapLayout>({ _source: 'auto-pack', nodes: {} });
  const focusIdRef = useRef('root');
  const resumeKeyRef = useRef(
    mapResumeStorageKey({
      kind: 'pages',
      origin: typeof window !== 'undefined' ? window.location.origin : 'local',
      docKey: 'react-live',
    }),
  );
  const scheduleResumeRef = useRef(
    createDebouncedResumeSave(resumeKeyRef.current, 400),
  );
  const applyDocFromMapRef = useRef<(d: OutlineFoldDoc) => void>(() => {});
  /** When Map setDoc already painted via onChange, skip the renderDoc effect paint (keeps M11 FLIP). */
  const skipNextMapPaintRef = useRef(false);
  const prevPreviewModeRef = useRef(previewMode);
  /** Fold signature parsed from the current source text (before resume/seed overlay). */
  const textFoldSigRef = useRef(foldSig(validation.doc));

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
      scheduleResumeRef.current.flush();
    };
  }, []);

  // Cold-start / resume once for the initial active doc.
  useEffect(() => {
    loadDocBody(textRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDocBody = useCallback((body: string) => {
    setText(body);
    textRef.current = body;
    let next = runValidate(body);
    textFoldSigRef.current = foldSig(next.doc);
    let doc = next.doc;
    let layout: MapLayout = { _source: 'auto-pack', nodes: {} };
    const docKey =
      'react-live:' +
      (getActive(libraryRef.current)?.id || 'active');
    resumeKeyRef.current = mapResumeStorageKey({
      kind: 'pages',
      origin: window.location.origin,
      docKey,
    });
    scheduleResumeRef.current = createDebouncedResumeSave(
      resumeKeyRef.current,
      400,
    );
    let resume = loadMapResume(resumeKeyRef.current);
    if (doc) {
      const known = collectNodeIds(doc.nodes);
      if (resume) {
        const stale = isResumeStale(resume, known);
        if (stale.stale) resume = softResetResume(resume, { keepCamera: true });
      }
      if (resume?.fold?.ids) {
        doc = {
          ...doc,
          fold: {
            mode: resume.fold.mode || doc.fold.mode,
            ids: [...resume.fold.ids],
          },
          frontmatter: doc.frontmatter
            ? { ...doc.frontmatter, foldIds: [...resume.fold.ids] }
            : doc.frontmatter,
        };
      } else {
        doc = seedColdStartFold(doc);
      }
      layout = overlayResumeOnLayout(layout as Parameters<typeof overlayResumeOnLayout>[0], resume) as MapLayout;
      next = { ...next, doc };
      docRef.current = doc;
    }
    setValidation(next);
    layoutRef.current = layout;
    const rootId = doc?.nodes?.[0]?.id;
    focusIdRef.current =
      (resume?.focusId && doc && collectNodeIds(doc.nodes).includes(resume.focusId)
        ? resume.focusId
        : rootId) || 'root';
  }, []);

  const onTextChange = useCallback(
    (next: string) => {
      setText(next);
      textRef.current = next;
      let result = runValidate(next);
      const sig = foldSig(result.doc);
      // Typing a caption must not reset Map/Outline fold to the text's
      // frontmatter when the user did not edit the fold line (cold-start seed /
      // resume fold lives in memory only until the next fold action serializes).
      const cur = docRef.current;
      if (result.doc && cur && sig === textFoldSigRef.current && foldSig(cur) !== sig) {
        const ids = [...cur.fold.ids];
        result = {
          ...result,
          doc: {
            ...result.doc,
            fold: { mode: cur.fold.mode, ids },
            frontmatter: result.doc.frontmatter
              ? { ...result.doc.frontmatter, foldIds: [...ids] }
              : result.doc.frontmatter,
          },
        };
      }
      textFoldSigRef.current = sig;
      setValidation(result);
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
      const syncedResult = runValidate(synced);
      textFoldSigRef.current = foldSig(syncedResult.doc);
      setValidation(syncedResult);
      setText(synced);
      textRef.current = synced;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flushBodyToLibrary(synced);
    },
    [flushBodyToLibrary],
  );

  const applyDocFromMap = useCallback(
    (next: OutlineFoldDoc) => {
      docRef.current = next;
      const synced = serialize(next);
      const syncedResult = runValidate(synced);
      textFoldSigRef.current = foldSig(syncedResult.doc);
      setValidation(syncedResult);
      setText(synced);
      textRef.current = synced;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flushBodyToLibrary(synced);
    },
    [flushBodyToLibrary],
  );
  applyDocFromMapRef.current = applyDocFromMap;

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


  // Mount package Map once; Outline|Map share docRef + serialize via setDoc.
  useEffect(() => {
    const host = mapHostRef.current;
    if (!host || mapRef.current) return;
    const emptyDoc: OutlineFoldDoc = {
      nodes: [],
      fold: { mode: '-', ids: [] },
    };
    const map = createMapView(host, {
      getDoc: () => docRef.current ?? emptyDoc,
      setDoc: (d) => {
        // Mark before React state flush so renderDoc useEffect skips — onChange paints once (FLIP).
        skipNextMapPaintRef.current = true;
        applyDocFromMapRef.current(d);
      },
      getLayout: () => layoutRef.current,
      getFocusId: () => focusIdRef.current,
      setFocusId: (id) => {
        focusIdRef.current = id;
      },
      onChange: () => {
        // Focus-only changes also paint here (no setDoc / no renderDoc change).
        mapRef.current?.paint();
        const m = mapRef.current;
        const d = docRef.current;
        if (!m || !d) return;
        const nudges: Record<
          string,
          {
            x: number;
            y: number;
            wrapCh?: number;
            maxLines?: number | null;
            bodyExpanded?: boolean;
          }
        > = {};
        const nodes = layoutRef.current.nodes || {};
        for (const [id, pos] of Object.entries(nodes)) {
          if (
            pos &&
            (typeof pos.wrapCh === 'number' ||
              typeof pos.maxLines === 'number' ||
              pos.maxLines === null ||
              pos.bodyExpanded === true)
          ) {
            nudges[id] = {
              x: pos.x,
              y: pos.y,
              wrapCh: pos.wrapCh,
              maxLines: pos.maxLines,
              bodyExpanded: pos.bodyExpanded,
            };
          }
        }
        const state: MapResumeState = {
          version: 1,
          fold: { mode: d.fold.mode, ids: [...d.fold.ids] },
          camera: { x: m.cam.x, y: m.cam.y, k: m.cam.k },
          nudges: Object.keys(nudges).length ? nudges : undefined,
          focusId: focusIdRef.current,
        };
        scheduleResumeRef.current(state);
      },
      isActive: () => previewModeRef.current === 'map',
      ariaLabel:
        'Outline mind map, left to right. Pan and zoom enabled. Fold via circle-+ or . / Space / Enter. Text click selects; fold only via circle-+.',
    });
    map.bindGestures();
    map.bindKeyboard({
      panel: previewPaneRef.current,
      modeButton: mapBtnRef.current,
    });
    mapRef.current = map;
    if (previewModeRef.current === 'map') {
      map.ensurePositions();
      map.paint();
      const resume = loadMapResume(resumeKeyRef.current);
      if (resume?.camera && typeof resume.camera.k === 'number') {
        map.cam.x = resume.camera.x;
        map.cam.y = resume.camera.y;
        map.cam.k = resume.camera.k;
        map.applyCam();
      } else {
        map.resetCam();
      }
    }
    return () => {
      host.innerHTML = '';
      mapRef.current = null;
    };
  }, []);

  // Entering Map: skip the sync renderDoc paint below; this effect paints once after layout.
  if (previewMode === 'map' && prevPreviewModeRef.current !== 'map') {
    skipNextMapPaintRef.current = true;
  }
  prevPreviewModeRef.current = previewMode;

  // Repaint Map when doc changes while Map mode is active.
  // Skip when Map already painted via onChange after setDoc (fold) or enter-Map rAF will paint.
  useEffect(() => {
    if (previewMode !== 'map') return;
    const map = mapRef.current;
    if (!map) return;
    if (skipNextMapPaintRef.current) {
      skipNextMapPaintRef.current = false;
      return;
    }
    map.paint();
  }, [previewMode, renderDoc, validation]);

  // When entering Map mode, fit camera once the host is visible (single paint).
  useEffect(() => {
    if (previewMode !== 'map') return;
    const map = mapRef.current;
    if (!map) return;
    // rAF so host has non-zero size after un-hiding
    const id = requestAnimationFrame(() => {
      map.ensurePositions();
      map.paint();
      map.resetCam();
    });
    return () => cancelAnimationFrame(id);
  }, [previewMode]);

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
        <div className="title-row">
          <h1>React live parser</h1>
          <p className="pkg-stamp" aria-label="Package version" data-testid="pkg-stamp">
            <code>@audroam/outline-fold@{__OUTLINE_FOLD_VERSION__}</code>
            {' · '}
            <span className="pkg-git">
              git <code data-testid="pkg-git">{__OUTLINE_FOLD_GIT__}</code>
            </span>
          </p>
        </div>
      </header>

      <div className="doc-bar" role="toolbar" aria-label="Documents">
        <div className="doc-group">
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
          <button
            type="button"
            className="doc-btn doc-btn-accent"
            onClick={onLoadCafe}
            title="Load cafe sample"
            aria-label="Load cafe sample"
          >
            Cafe
          </button>
        </div>
        <div className="doc-group doc-group-file">
          <button
            type="button"
            className="doc-btn"
            onClick={onDownloadDoc}
            title="Download active doc as .md"
            aria-label="Download active doc as .md"
          >
            .md
          </button>
          <button
            type="button"
            className="doc-btn"
            onClick={onDownloadLibrary}
            title="Download full library as .json"
            aria-label="Download library"
          >
            Library
          </button>
          <button
            type="button"
            className="doc-btn"
            onClick={onImportClick}
            title="Import library JSON (merge or replace)"
            aria-label="Import library"
          >
            Import
          </button>
        </div>
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
                  ? `Warnings (${validation.issues.length})`
                  : `Errors (${validation.issues.filter((i) => i.severity === 'error').length})`}
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

        <section
          className={
            'pane preview-pane' + (previewMode === 'map' ? ' preview-pane-map' : '')
          }
          ref={(el) => {
            previewPaneRef.current = el;
          }}
        >
          <div className="pane-label pane-label-row">
            <span>Preview</span>
            <div className="seg" role="group" aria-label="Preview mode">
              <button
                type="button"
                aria-pressed={previewMode === 'outline'}
                onClick={() => setPreviewMode('outline')}
              >
                Outline
              </button>
              <button
                type="button"
                ref={mapBtnRef}
                aria-pressed={previewMode === 'map'}
                onClick={() => setPreviewMode('map')}
              >
                Map
              </button>
            </div>
          </div>
          {!html ? (
            <div className="parse-error" role="alert">
              <strong>Nothing to render yet</strong>
              <pre>
                {validation.issues.map((i) => `[${i.code}] ${i.message}`).join('\n') ||
                  'Empty document'}
              </pre>
            </div>
          ) : null}
          <div
            className="tree"
            hidden={!html || previewMode !== 'outline'}
            onClick={onTreeClick}
            dangerouslySetInnerHTML={{ __html: html || '' }}
          />
          <div
            ref={mapHostRef}
            className="map-wrap"
            hidden={!html || previewMode !== 'map'}
            aria-label="Map preview"
          />
          {html && previewMode === 'map' ? (
            <div className="map-tools of-map-controls" role="toolbar" aria-label="Map view tools">
              <TapButton
                aria-label="Zoom out"
                onTap={() => {
                  const host = mapHostRef.current;
                  const map = mapRef.current;
                  if (!host || !map) return;
                  const r = host.getBoundingClientRect();
                  map.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2);
                }}
              >
                −
              </TapButton>
              <TapButton
                aria-label="Zoom in"
                onTap={() => {
                  const host = mapHostRef.current;
                  const map = mapRef.current;
                  if (!host || !map) return;
                  const r = host.getBoundingClientRect();
                  map.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
                }}
              >
                +
              </TapButton>
              <TapButton
                aria-label="Fit"
                title="Fit the outline in the window"
                onTap={() => mapRef.current?.resetCam()}
              >
                Fit
              </TapButton>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
