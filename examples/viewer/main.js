/**
 * Shared Outline | Map viewer.
 * Query: ?doc=<md url> [&layout=<sidecar json>]
 * Shared core only: parseDoc → createOutlineView + createMapView + layoutSidecar.
 */
import { loadDoc } from '../_shared/parseDoc.js';
import { createOutlineView } from '../_shared/outlineView.js';
import {
  createMapView,
  seedColdStartFold,
  mapResumeStorageKey,
  pagesDocKey,
  loadMapResume,
  overlayResumeOnLayout,
  softResetResume,
  isResumeStale,
  collectNodeIds,
  createDebouncedResumeSave,
} from '../_shared/mapView.js';
import { resolveLayout } from '../_shared/layoutSidecar.js';
import {
  tryUnlock,
  findNode,
  isPlaceholderSealed,
} from '../_shared/unlockStub.js';
import { packageVersion, viewerBuild, gitShort } from './build-info.js';

const params = new URLSearchParams(window.location.search);
const docParam = params.get('doc') || params.get('md');
const layoutParam = params.get('layout');

const outlineHost = document.getElementById('outlineHost');
const mapHost = document.getElementById('mapHost');
const panel = document.getElementById('panel');
const btnOutline = document.getElementById('btnOutline');
const btnMap = document.getElementById('btnMap');
const mapTools = document.getElementById('mapTools');
const loadErr = document.getElementById('loadErr');
const validationEl = document.getElementById('validation');
const foldOut = document.getElementById('foldOut');
const pageTitle = document.getElementById('pageTitle');
const pageSub = document.getElementById('pageSub');
const banner = document.getElementById('banner');
const btnZoomIn = document.getElementById('btnZoomIn');
const btnZoomOut = document.getElementById('btnZoomOut');
const btnResetView = document.getElementById('btnResetView');
const buildMeta = document.getElementById('buildMeta');

function renderBuildMeta(version) {
  if (!buildMeta) return;
  buildMeta.innerHTML =
    '<span><strong>Package</strong> <code>@audroam/outline-fold@' +
    version +
    '</code></span>' +
    '<span><strong>Viewer</strong> <code>' +
    viewerBuild +
    '</code></span>' +
    '<span><strong>Git</strong> <code>' +
    gitShort +
    '</code></span>';
}

renderBuildMeta(packageVersion);

// Checked-in build-info is only a local fallback. Pages overwrites it with
// the real version. A dev open reads package.json so the stamp cannot sit
// on an old number such as 0.2.4.
if (viewerBuild === 'dev') {
  fetch(new URL('../../package.json', import.meta.url))
    .then((res) => (res.ok ? res.json() : null))
    .then((pkg) => {
      if (pkg && typeof pkg.version === 'string' && pkg.version) {
        renderBuildMeta(pkg.version);
      }
    })
    .catch(() => {});
}

/** @type {import('../../dist/index.js').OutlineFoldDoc} */
let doc;
/** @type {object} */
let layout;
let mode = 'outline';
let focusId = 'root';
/** @type {ReturnType<typeof createOutlineView> | null} */
let outline = null;
/** @type {ReturnType<typeof createMapView> | null} */
let map = null;
/** @type {Record<string, string>} */
const revealed = Object.create(null);

function showError(msg) {
  loadErr.hidden = false;
  loadErr.textContent = msg;
}

function showValidation(v) {
  if (!validationEl || !v) return;
  if (v.ok && v.issues.length === 0) {
    validationEl.hidden = true;
    validationEl.textContent = '';
    return;
  }
  validationEl.hidden = false;
  validationEl.className = 'validation ' + (v.ok ? 'ok' : 'bad');
  const errorCount = v.issues.filter((i) => i.severity === 'error').length;
  const title = v.ok
    ? 'Warnings (' + v.issues.length + ')'
    : 'Errors (' + errorCount + ')';
  validationEl.innerHTML =
    '<strong>' +
    title +
    '</strong><ul>' +
    v.issues
      .map(
        (i) =>
          '<li><code>' +
          i.severity +
          '</code> <code>' +
          i.code +
          '</code> ' +
          i.message +
          (i.line != null ? ' · line ' + i.line : '') +
          (i.nodeId ? ' · #' + i.nodeId : '') +
          '</li>',
      )
      .join('') +
    '</ul>';
}

/**
 * Allow only same-origin URLs under this Pages site (prevent path escape).
 * @param {string} raw
 * @param {string} label
 */
function resolveSafeUrl(raw, label) {
  let url;
  try {
    url = new URL(raw, window.location.href);
  } catch {
    throw new Error('Invalid ' + label + ' URL: ' + raw);
  }
  if (url.origin !== window.location.origin) {
    throw new Error(label + ' must be same-origin (got ' + url.origin + ')');
  }
  // Must stay under the repo Pages root (…/audroam-outline-fold/ or local /)
  const here = window.location.pathname;
  const examplesIdx = here.indexOf('/examples/');
  const rootPrefix =
    examplesIdx >= 0 ? here.slice(0, examplesIdx + '/examples/'.length) : '/';
  if (!url.pathname.startsWith(rootPrefix) && !url.pathname.includes('/examples/')) {
    // Local serve from package root: /examples/...
    if (!url.pathname.includes('/examples/') && !url.pathname.endsWith('.md') && !url.pathname.endsWith('.json')) {
      throw new Error(label + ' path outside examples/: ' + url.pathname);
    }
  }
  return url;
}

function walkSealed(nodes, fn) {
  for (const n of nodes) {
    if (n.sealed) fn(n);
    if (n.children?.length) walkSealed(n.children, fn);
  }
}

function detectStubUnlock(d) {
  let stub = false;
  walkSealed(d.nodes, (n) => {
    if (isPlaceholderSealed(n.sealed)) stub = true;
  });
  return stub;
}

function hasAnySealed(d) {
  let hit = false;
  walkSealed(d.nodes, () => {
    hit = true;
  });
  return hit;
}

function paint() {
  if (mode === 'outline') {
    outlineHost.hidden = false;
    mapHost.hidden = true;
    mapTools.hidden = true;
    panel.classList.remove('map-mode');
    panel.dataset.mode = 'outline';
    outline?.refresh(focusId);
  } else {
    outlineHost.hidden = true;
    mapHost.hidden = false;
    mapTools.hidden = false;
    panel.classList.add('map-mode');
    panel.dataset.mode = 'map';
    map?.paint();
  }
}

function setMode(next) {
  mode = next;
  btnOutline.setAttribute('aria-pressed', mode === 'outline' ? 'true' : 'false');
  btnMap.setAttribute('aria-pressed', mode === 'map' ? 'true' : 'false');
  paint();
  // The host is display:none until this turn, so the first paint can see a
  // zero height. Paint again after layout so the canvas fills the window.
  if (next === 'map') {
    requestAnimationFrame(() => {
      if (mode === 'map') map?.paint();
    });
  }
}

btnOutline.addEventListener('click', () => setMode('outline'));
btnMap.addEventListener('click', () => setMode('map'));

btnZoomIn.addEventListener('click', () => {
  const r = mapHost.getBoundingClientRect();
  map?.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
});
btnZoomOut.addEventListener('click', () => {
  const r = mapHost.getBoundingClientRect();
  map?.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2);
});
btnResetView.addEventListener('click', () => map?.resetCam());

async function boot() {
  if (!docParam) {
    showError(
      'Missing ?doc= — pass a markdown path, e.g. ?doc=../fixtures/pci-dss.md or ?doc=../solar-system/solar-system.md&layout=../solar-system/solar-system.layout.json',
    );
    pageSub.hidden = false;
    pageSub.innerHTML =
      'Open from the <a href="../../">landing page</a>. Example: ' +
      '<a href="?doc=../solar-system/solar-system.md&layout=../solar-system/solar-system.layout.json"><code>?doc=../solar-system/…</code></a>';
    return;
  }

  let mdUrl;
  try {
    mdUrl = resolveSafeUrl(docParam, 'doc');
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return;
  }

  let loaded;
  try {
    loaded = await loadDoc(mdUrl, { validate: true });
  } catch (err) {
    showError(
      'Could not load ' +
        mdUrl.pathname +
        ' — open via a static server (Pages / npx serve), not file://. ' +
        (err instanceof Error ? err.message : String(err)),
    );
    return;
  }

  doc = loaded.doc;
  showValidation(loaded.validation);

  let layoutUrl = null;
  if (layoutParam) {
    try {
      layoutUrl = resolveSafeUrl(layoutParam, 'layout');
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
      return;
    }
  }

  layout = await resolveLayout(loaded.raw, mdUrl, layoutUrl || undefined);

  // Resume (localStorage) → overlays sidecar; else cold-start fold seed.
  const resumeKey = mapResumeStorageKey({
    kind: 'pages',
    origin: window.location.origin,
    docKey: pagesDocKey(
      mdUrl.pathname,
      layoutUrl ? layoutUrl.pathname : null,
    ),
  });
  let resume = loadMapResume(resumeKey);
  const knownIds = collectNodeIds(doc.nodes);
  if (resume) {
    const stale = isResumeStale(resume, knownIds);
    if (stale.stale) {
      resume = softResetResume(resume, { keepCamera: true });
    }
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
  layout = overlayResumeOnLayout(layout, resume);
  if (resume?.focusId && findNode(doc.nodes, resume.focusId)) {
    focusId = resume.focusId;
  }
  const scheduleResume = createDebouncedResumeSave(resumeKey, 400);

  const root = doc.nodes[0];
  const rootTitle = root?.title || 'Outline';
  pageTitle.textContent = rootTitle + ' · Outline | Map';
  document.title = rootTitle + ' · @audroam/outline-fold';

  if (!findNode(doc.nodes, 'root') && root?.id) {
    focusId = root.id;
  }

  const stubUnlock = detectStubUnlock(doc);
  const sealed = hasAnySealed(doc);

  if (stubUnlock) {
    banner.hidden = false;
    banner.textContent = 'Sealed stub. Unlock is not available.';
  } else if (sealed) {
    banner.hidden = false;
    banner.textContent = 'Sealed demo. Unlock stays in this tab.';
  } else {
    banner.hidden = true;
    banner.textContent = '';
  }

  const layoutSrc = layout._source || 'auto-pack';
  const shortDoc = mdUrl.pathname.split('/').slice(-2).join('/');
  pageSub.hidden = false;
  pageSub.innerHTML =
    '<a href="' +
    mdUrl.href +
    '"><code>' +
    shortDoc +
    '</code></a>' +
    (layoutUrl
      ? ' · <a href="' +
        layoutUrl.href +
        '"><code>' +
        layoutUrl.pathname.split('/').pop() +
        '</code></a>'
      : '') +
    ' · <code>' +
    layoutSrc +
    '</code>';

  outline = createOutlineView(outlineHost, {
    getDoc: () => doc,
    setDoc: (d) => {
      doc = d;
    },
    ariaLabel: rootTitle + ' outline',
    lockedChrome: true,
    markCues: true,
    revealed,
    serializeTarget: foldOut,
    onUnlock: (id) => {
      void tryUnlock({
        getDoc: () => doc,
        setDoc: (d) => {
          doc = d;
        },
        id,
        revealed,
        refresh: () => {
          outline?.refresh(id);
          if (mode === 'map') map?.paint();
        },
        stubUnlock,
      });
    },
    onDecrypt: (id) => {
      void tryUnlock({
        getDoc: () => doc,
        setDoc: (d) => {
          doc = d;
        },
        id,
        revealed,
        refresh: () => {
          outline?.refresh(id);
          if (mode === 'map') map?.paint();
        },
        stubUnlock,
      });
    },
  });

  function persistMapResume() {
    const nudges = {};
    if (layout?.nodes) {
      for (const [id, pos] of Object.entries(layout.nodes)) {
        if (
          pos &&
          (typeof pos.wrapCh === 'number' ||
            typeof pos.maxLines === 'number' ||
            pos.maxLines === null ||
            pos.bodyExpanded === true ||
            layout._source !== 'auto-pack')
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
    }
    scheduleResume({
      version: 1,
      fold: { mode: doc.fold.mode, ids: [...doc.fold.ids] },
      camera: map
        ? { x: map.cam.x, y: map.cam.y, k: map.cam.k }
        : undefined,
      nudges: Object.keys(nudges).length ? nudges : undefined,
      focusId,
    });
  }

  map = createMapView(mapHost, {
    getDoc: () => doc,
    setDoc: (d) => {
      doc = d;
    },
    getLayout: () => layout,
    getFocusId: () => focusId,
    setFocusId: (id) => {
      focusId = id;
    },
    onChange: () => {
      paint();
      persistMapResume();
    },
    onTaskToggle: () => {
      /* session-local; serialize panel shows task via outline refresh */
    },
    isActive: () => mode === 'map',
    ariaLabel: rootTitle + ' mind map, left to right. Pan and zoom enabled.',
  });
  map.ensurePositions();
  map.bindGestures();
  map.bindKeyboard({ panel, modeButton: btnMap });
  if (resume?.camera && typeof resume.camera.k === 'number') {
    map.cam.x = resume.camera.x;
    map.cam.y = resume.camera.y;
    map.cam.k = resume.camera.k;
    map.applyCam();
  }
  // Persist camera after pan/zoom settles
  mapHost.addEventListener('pointerup', () => persistMapResume());
  mapHost.addEventListener('wheel', () => persistMapResume(), { passive: true });

  outlineHost.addEventListener('click', (e) => {
    const li = e.target.closest?.('[role="treeitem"]');
    if (li?.getAttribute('data-id')) focusId = li.getAttribute('data-id');
  });

  setMode('outline');
}

boot();
