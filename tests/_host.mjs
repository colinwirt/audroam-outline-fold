// Test copy of Audroam templates/outlineFoldHost.mjs (imports pointed at src) for host-flow tests.
// outlineFoldHost: the one module in Audroam that imports outline-fold
// (spec 20261101-outline-fold-regions-integration). outline-view.js talks to
// sealed regions only through mountOutlineFold(); the region docs, the fold
// store, scoped ids, unlock prompts and seal drafts all live in the package.
import * as OF from "../src/index.ts";
import { mountTextEditor } from "../src/editor/textEditor.ts";

// Core outline helpers outline-view.js still uses (parse, toHtml, map, keys).
export const {
  parse, serialize, toHtml, toggleFold, toggleTask, setExpandLevel, isCollapsed,
  createMapView, mountMapControls, peelTrailingSections, nextAutoId, isResumeStale,
  collectNodeIds, createKey, unlockKey, clearKeys, isKeyUnlocked, countKidRefs, sealBranch,
  parseScopedId, scopeId, promptPassphrase, versionLabels,
  applyAutosave, applySave, applyDiscard, applyRestore, draftStateOf,
} = OF;

const SEAL_CIPHER = "a256gcm";

/** 0.4.4: the stacked (<=720px) layout, where Text takes the full width above the Map. */
export function isStackedLayout() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 720px)").matches;
}

/** The layout block's autoWidth (parsed into frontmatter by outline-fold), or null when unset. */
export function layoutAutoWidth(doc) {
  const v = doc && doc.frontmatter && doc.frontmatter.autoWidth;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function walk(nodes, fn) {
  for (const n of nodes || []) { if (!n) continue; fn(n); walk(n.children, fn); }
}
function find(nodes, id) {
  let hit = null;
  walk(nodes, (n) => { if (!hit && n.id === id) hit = n; });
  return hit;
}
function replace(nodes, from, to) {
  if (!nodes) return false;
  const i = nodes.indexOf(from);
  if (i >= 0) { nodes[i] = to; return true; }
  return nodes.some((n) => n && replace(n.children, from, to));
}
// Region rows with no stored id get a session id. autoId ids are never serialized,
// so they stay out of the ciphertext.
function pinIds(doc) {
  const used = new Set();
  walk(doc && doc.nodes, (n) => { if (n.id) used.add(String(n.id)); });
  let seq = 1;
  walk(doc && doc.nodes, (n) => {
    if (n.id) return;
    while (used.has("z" + seq)) seq++;
    n.id = "z" + seq; n.autoId = true; used.add(n.id);
  });
}

/**
 * Mount sealed-region support on an outline view.
 * o.getRootDoc()   current root doc (may be replaced by the host at any time)
 * o.ctx()          { noteId, ownerId } bound into ciphertext AAD
 * o.onChange(evt)  repaint / mark the note edited (unlock, lock, change, save, error)
 * o.onSaved()      a region re-sealed into the root doc: write the note source
 * o.onFocus(id)    reveal / focus command for a scoped id
 */
export function mountOutlineFold(o) {
  const root = () => o.getRootDoc() || { nodes: [], fold: { mode: "-", ids: [] } };
  // The viewer keeps its host doc; a proxy keeps that pointing at the live root doc.
  const live = new Proxy({}, {
    get: (_t, k) => root()[k],
    set: (_t, k, v) => { root()[k] = v; return true; },
    has: (_t, k) => k in root(),
    ownKeys: () => Reflect.ownKeys(root()),
    getOwnPropertyDescriptor: (_t, k) => {
      const d = Reflect.getOwnPropertyDescriptor(root(), k);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
  const ctx = { get noteId() { return String((o.ctx && o.ctx().noteId) || ""); }, get ownerId() { return String((o.ctx && o.ctx().ownerId) || ""); } };
  const sessions = OF.createSealSessions({
    getDoc: () => live,
    ctx,
    onFocusCommand: (id) => o.onFocus && o.onFocus(id),
    confirmLockDirty: () => "save",
  });
  const store = OF.createRegionFoldStore();
  // One focus state for Map, Outline and the text editor (Follow in text).
  const focusLink = OF.createFocusLink();
  const offFold = OF.bindRegionFoldToSessions(store, sessions);
  // Branch node objects the open viewers hold; re-seated after the host re-parses.
  const pinned = new Map();
  const branchOf = (region) => sessions.get(region).branchId;
  const offs = [];
  const emit = (e) => { try { o.onChange && o.onChange(e); } catch (err) { /* host repaint */ } };
  offs.push(sessions.api.on("unlock", (e) => {
    const s = sessions.get(e.region);
    if (!s.parent) pinned.set(e.region, find(root().nodes, s.branchId));
    pinIds(s.doc);
    emit(e);
  }));
  offs.push(sessions.api.on("lock", (e) => { pinned.delete(e.region); emit(e); }));
  for (const t of ["change", "error"]) offs.push(sessions.api.on(t, emit));
  offs.push(sessions.api.on("save", (e) => { try { o.onSaved && o.onSaved(e); } catch (err) { /* host */ } emit(e); }));

  function rebind() {
    for (const [region, node] of [...pinned]) {
      const cur = find(root().nodes, branchOf(region));
      if (cur === node) continue;
      if (!cur || !cur.sealed || !node) { pinned.delete(region); sessions.lock(region, "user"); continue; }
      replace(root().nodes, cur, node);
    }
  }
  const open = () => sessions.list().filter((s) => !s.locked && !s.parent);
  const hosts = () => { rebind(); return OF.regionHostsFromSessions(sessions, root(), store); };

  const host = {
    sessions,
    store,
    regionFor: (branchId) => sessions.regionFor(String(branchId)),
    isOpen: (branchId) => !sessions.get(sessions.regionFor(String(branchId))).locked,
    openRegions: () => open().map((s) => ({ region: s.region, branchId: s.branchId, kid: s.kid, dirty: s.dirty })),
    regionHosts: hosts,
    /** Root doc plus open region rows under scoped ids, for toHtml. */
    outlineDoc(doc) {
      rebind();
      const h = OF.regionHostsFromSessions(sessions, doc || root(), store);
      return h.some((x) => x.doc) ? OF.composeOutlineDoc(doc || root(), h, store) : (doc || root());
    },
    /** Scoped id → { region, id } ("" region = root row). */
    scoped(id) {
      const p = OF.parseScopedId(String(id || ""));
      if (p.region) return p;
      if (/^s:/.test(String(id))) return { region: String(id), id: "" };
      return p;
    },
    /** The row of a region doc behind a scoped id, or null. */
    regionNode(id) {
      const p = host.scoped(id);
      if (!p.region) return null;
      const s = sessions.get(p.region);
      return s.doc ? (p.id ? find(s.doc.nodes, p.id) : s.doc.nodes[0] || null) : null;
    },
    hasRegionChildren(id) {
      const p = host.scoped(id);
      if (!p.region) {
        const s = sessions.get(sessions.regionFor(String(id)));
        return !!(s.doc && s.doc.nodes.length);
      }
      const n = host.regionNode(id);
      return !!(n && n.children && n.children.length) || (!p.id && !!sessions.get(p.region).doc);
    },
    toggleRegionFold(id) {
      const p = host.scoped(id);
      if (!p.region) return false;
      const s = sessions.get(p.region);
      if (!s.doc) return false;
      if (!p.id) store.setRegionFolded(p.region, !store.isRegionFolded(p.region));
      else store.setNodeCollapsed(p.region, p.id, !store.isNodeCollapsed(p.region, s.doc, p.id));
      sessions.touch();
      return true;
    },
    toggleRegionTask(id) {
      const n = host.regionNode(id);
      if (!n || !n.task) return false;
      n.task = n.task === "open" ? "pending" : n.task === "pending" ? "done" : "open";
      sessions.markChanged(host.scoped(id).region);
      return true;
    },
    /** Map options: regions drawn as clouds from the same sessions and fold store. */
    /**
     * Shared focus (Map ⇄ Outline ⇄ editor). The package editor's follow plugin
     * subscribes to it; the page sets it ('map' / 'outline' / 'editor').
     */
    focusLink,
    mapOptions(onUnlock, onMore) {
      return {
        getRegionHosts: hosts,
        regionFold: store,
        onRegionUnlock: (region) => onUnlock && onUnlock(region),
        // 0.4.3 (QA C): zone header 🔒 Lock and More ▾ (Remove seal lives there now).
        onRegionLock: (region) => { rebind(); sessions.lock(region, "user"); },
        onRegionMore: (region, rect) => onMore && onMore(branchOf(region), rect),
      };
    },
    /** Inline unlock card by the anchor; resolves true when the region opened. */
    unlock(branchId, anchorEl, opts = {}) {
      const region = sessions.regionFor(String(branchId));
      if (!sessions.get(region).locked) return Promise.resolve(true);
      const h = OF.mountUnlockPrompt({ sessions, region, anchorEl, label: opts.label, container: opts.container, inline: !!opts.inline });
      return h.done;
    },
    lock(branchId) {
      rebind();
      return sessions.lock(branchId === "all" ? "all" : sessions.regionFor(String(branchId)), "user");
    },
    async saveRegion(region) {
      rebind();
      const s = sessions.get(region);
      if (s.locked || !s.dirty) return;
      await sessions.save(region);
    },
    /** Re-seal every dirty open region into the root doc (before writing the note). */
    async saveAll() {
      for (const s of open()) await host.saveRegion(s.region);
    },
    async removeSeal(branchId, passphrase) {
      rebind();
      const region = sessions.regionFor(String(branchId));
      await sessions.removeSeal(region, passphrase);
      pinned.delete(region);
      return !find(root().nodes, String(branchId))?.sealed;
    },
    /** Seal a plain branch with an unlocked key (Save path for "Seal branch"). */
    sealNode(node, kid) {
      return OF.sealBranch(root(), node, kid, ctx, { cipher: SEAL_CIPHER });
    },
    touch: () => sessions.touch(),
    idleRemainingMs: () => sessions.idleRemainingMs(),
    /**
     * Text pane: the package CodeMirror editor over the note textarea, with a secure
     * zone (memory-only body) on each open region's <id:.> line. o.* are the host
     * hooks: onEnter, onTab, onEsc, onBlur, askPassphrase, autoWidth.
     */
    mountEditor(textarea, o2 = {}) {
      // Wrap secure zones at the layout's autoWidth only when the note sets one;
      // otherwise textWidthCh is undefined and the package default applies.
      let h = null;
      h = mountTextEditor(textarea, {
        ...o2,
        sessions,
        // 0.4.3 (QA D): click a locked <enc> line in Text to unlock it.
        onUnlockZone: (region, el) => o2.onUnlockBranch && o2.onUnlockBranch(branchOf(region), el),
        // Follow in text: the package follow plugin only runs with a FocusLink.
        focus: o2.focus || focusLink,
        followInText: typeof o2.followInText === "function" ? o2.followInText : () => true,
        textWidthCh: () => {
          // 0.4.4: stacked mobile layout: the pane is full width, no ch wrap from autoWidth.
          if (isStackedLayout()) return undefined;
          const v = layoutAutoWidth(root());
          if (!v) return undefined;
          return OF.autoWrapCh(v, { viewportW: h ? h.hostEl().clientWidth : null, fallback: OF.DEFAULT_WRAP_CH });
        },
      });
      return h;
    },
    unmount() {
      offs.forEach((f) => f());
      offFold();
      try { sessions.destroy(); } catch (err) { /* already gone */ }
      try { OF.clearKeys(); } catch (err) { /* keys already dropped */ }
      pinned.clear();
    },
  };
  return host;
}
