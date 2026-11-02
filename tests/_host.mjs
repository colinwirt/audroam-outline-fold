// Test copy of Audroam templates/outlineFoldHost.mjs (imports pointed at src) for host-flow tests.
// outlineFoldHost: the one module in Audroam that imports outline-fold (0.4.8 boundary).
// outline-view.js never touches the editor, CodeMirror or the doc text directly: it reads
// and writes the note through this adapter. The package's createOutlineDoc owns the text,
// the parsed root and the seal sessions; this file adds Audroam's policy around it:
//   save-needed → serialise() → local draft; Save → serialise() → PUT pnBody → saved/failed;
//   note-tag / width preserving serialisation, clean ids, the passphrase dialog and theme.
import * as OF from "../src/index.ts";
import { mountTextEditor } from "../src/editor/textEditor.ts";

// Core outline helpers outline-view.js still uses (parse, toHtml, map, keys).
export const {
  parse, serialize, toHtml, toggleFold, toggleTask, setExpandLevel, isCollapsed,
  createMapView, mountMapControls, peelTrailingSections, nextAutoId, isResumeStale,
  collectNodeIds, createKey, unlockKey, clearKeys, isKeyUnlocked, countKidRefs, sealBranch,
  parseScopedId, scopeId, promptPassphrase, versionLabels,
  applyAutosave, applySave, applyDiscard, applyRestore, draftStateOf, SealedStateError,
} = OF;

export const SEAL_CIPHER = "a256gcm";

/** 0.4.4: the stacked (<=720px) layout, where Text takes the full width above the Map. */
export function isStackedLayout() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 720px)").matches;
}

/** The layout block's autoWidth (parsed into frontmatter by outline-fold), or null when unset. */
export function layoutAutoWidth(doc) {
  const v = doc && doc.frontmatter && doc.frontmatter.autoWidth;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Text for a doc, keeping what the note text already had: each <t:N> spelling
 * (keepNoteTags) and the layout textWidth (outline-fold drops layout keys it does not know).
 * h: { dropSessionIds?, keepNoteTags?, readTextWidth?, writeTextWidth?, fallbackText? }
 * fallbackText(): what to keep from while the doc text is still empty (the server copy).
 */
export function serializeKeeping(d, prev, h = {}) {
  if (!prev && h.fallbackText) prev = h.fallbackText() || "";
  let next = OF.serialize(d);
  if (h.dropSessionIds) next = h.dropSessionIds(next);
  if (h.keepNoteTags) next = h.keepNoteTags(prev || "", next);
  if (h.writeTextWidth && h.readTextWidth) next = h.writeTextWidth(next, h.readTextWidth(prev || ""));
  return next;
}

/**
 * Mount the note. o:
 *   text            the note text to start from
 *   ctx()           { noteId, ownerId } bound into ciphertext AAD
 *   keep            serialiser helpers (see serializeKeeping)
 *   onChange(e)     { text, rev, source } — every text change, whoever made it
 *   onSeal(e)       seal session events (unlock, lock, save, change, error)
 *   onStatus(s)     save status (rev, savedRev, dirty, inflight, error, regions)
 *   onDraft(text)   save-needed: the serialised text for the local draft store
 *   onHold(err)     serialise refused (SealedStateError): hold drafts and saves
 *   onFocus(id)     reveal / focus command for a scoped id
 *   debounceMs, timers, autoLockMs   (tests)
 */
export function mountOutlineFold(o = {}) {
  const keep = o.keep || {};
  const doc = OF.createOutlineDoc({
    text: o.text || "",
    ctx: () => (o.ctx ? o.ctx() : {}),
    serializeRoot: (root, prev) => serializeKeeping(root, prev, { keepNoteTags: keep.keepNoteTags, readTextWidth: keep.readTextWidth, writeTextWidth: keep.writeTextWidth }),
    debounceMs: o.debounceMs,
    timers: o.timers,
    autoLockMs: o.autoLockMs,
    wipeOnPagehide: o.wipeOnPagehide,
    onFocus: (id) => o.onFocus && o.onFocus(id),
    sealCipher: SEAL_CIPHER,
  });
  const safe = (fn, e) => { try { if (fn) fn(e); } catch (err) { /* host repaint */ } };
  const offs = [
    doc.on("change", (e) => { if (e.source === "text") viewStale = true; safe(o.onChange, e); }),
    doc.on("seal", (e) => safe(o.onSeal, e)),
    doc.on("status", (e) => safe(o.onStatus, e)),
    doc.on("save-needed", () => { void drafting(); }),
  ];
  let editor = null;
  // 0.4.11 (bug D): a view doc parsed before the latest typing must never write back.
  let viewStale = false;

  async function drafting() {
    try {
      const snap = await doc.serialise();
      safe(o.onDraft, snap.text);
      return snap;
    } catch (err) {
      safe(o.onHold, err);
      return null;
    }
  }

  const fold = {
    doc,
    sessions: doc.sessions,
    store: doc.store,
    focusLink: doc.focusLink,
    // --- text ---------------------------------------------------------------
    getText: () => doc.getText(),
    /** source: 'host' (default), 'map', 'load' (new server copy: clean baseline). */
    setText: (text, source = "host") => doc.setText(text, { source }),
    /** A view doc (Map / Outline tick, fold, seal) written back into the text. */
    /** The host rendered its view doc from the current text (call after each parse). */
    markView() { viewStale = false; },
    /**
     * 0.4.11 (bugs D/E): only the lines the view change touched are written; the user's empty
     * nodes and whitespace stay. Refused when the view predates the latest typing (stale).
     */
    commitView(viewDoc, source = "map") {
      if (!viewDoc || viewStale) return false;
      const cur = doc.getText();
      let next;
      // 0.4.15: a refused serialise (sealed guard) is reported, never thrown into the Map's click.
      try { next = serializeKeeping(viewDoc, cur, keep); } catch (err) { safe(o.onHold, err); return false; }
      if (next === cur) return false;
      let norm = next;
      try { norm = serializeKeeping(OF.parse(cur), cur, keep); } catch (err) { /* take next */ }
      const merged = OF.mergeKeeping(cur, norm, next);
      if (merged === cur) return false;
      doc.setText(merged, { source });
      return true;
    },
    serializeView: (viewDoc) => serializeKeeping(viewDoc, doc.getText(), keep),
    /** Layout textWidth (A± / split drag), as a normal text edit. */
    setTextWidth(ch) {
      if (!keep.writeTextWidth) return false;
      const next = keep.writeTextWidth(doc.getText(), ch);
      if (next === doc.getText()) return false;
      doc.setText(next, { source: "host" });
      return true;
    },
    readTextWidth: () => (keep.readTextWidth ? keep.readTextWidth(doc.getText()) : null),
    /** Clean ids: clean(text) → { text, removed }. */
    cleanIds(clean) {
      const r = clean(doc.getText());
      if (r && r.removed && r.removed.length) doc.setText(r.text, { source: "host" });
      return r;
    },
    caret: () => doc.caret(),
    reveal: (from, to, select) => doc.reveal(from, to, { select: !!select }),
    status: () => doc.status(),
    // --- save ----------------------------------------------------------------
    serialise: () => doc.serialise(),
    draftNow: () => drafting(),
    /**
     * Save to the server. p: { url, bearer, base, fetch?, confirm?(text) }.
     * Returns { held } | { cancelled } | { status, payload, text, rev }.
     * saved(rev) only on an OK reply; anything else → failed(rev): the doc stays dirty,
     * the re-sealed payloads stay in the text and a retry save-needed follows.
     */
    async saveNow(p) {
      let snap;
      try { snap = await doc.serialise(); } catch (err) { return { held: err }; }
      if (p.confirm && !p.confirm(snap.text)) { doc.failed(snap.rev, new Error("cancelled")); return { cancelled: true }; }
      const f = p.fetch || fetch;
      let status = 0;
      let payload = {};
      try {
        const res = await f(p.url, {
          method: "PUT",
          headers: { Authorization: "Bearer " + p.bearer, "Content-Type": "application/json" },
          body: JSON.stringify({ pnBody: snap.text, base: p.base }),
        });
        status = res.status;
        try { payload = await res.json(); } catch (err) { payload = {}; }
        const ok = res.ok && !(payload.Result && payload.Result !== "OK");
        if (ok) doc.saved(snap.rev);
        else doc.failed(snap.rev, new Error(payload.Message || payload.error || "HTTP " + status));
        return { status, ok, payload, text: snap.text, rev: snap.rev };
      } catch (err) {
        doc.failed(snap.rev, err);
        return { status: 0, ok: false, payload: {}, error: err, text: snap.text, rev: snap.rev };
      }
    },
    // --- sealed regions ----------------------------------------------------------
    regionFor: (b) => doc.regionFor(b),
    isOpen: (b) => doc.isOpen(b),
    openRegions: () => doc.openRegions(),
    regionHosts: () => doc.regionHosts(),
    outlineDoc: (view) => doc.outlineDoc(view),
    scoped: (id) => doc.scoped(id),
    regionNode: (id) => doc.regionNode(id),
    hasRegionChildren: (id) => doc.hasRegionChildren(id),
    toggleRegionFold: (id) => doc.toggleRegionFold(id),
    toggleRegionTask: (id) => doc.toggleRegionTask(id),
    branchOfRegion: (region) => doc.branchOf(region),
    mapOptions: (onUnlock, onMore) => doc.mapOptions(onUnlock, onMore),
    unlock: (branchId, anchorEl, opts = {}) => doc.unlock(branchId, anchorEl, opts),
    lock: (branchId) => doc.lock(branchId),
    saveRegion: (region) => doc.saveRegion(region),
    async removeSeal(branchId, passphrase) { return doc.removeSeal(branchId, passphrase); },
    /** Seal a plain branch of the view doc, then write the view into the text. */
    async sealNode(viewDoc, node, kid) {
      await doc.sealNode(node, kid, viewDoc);
    },
    touch: () => doc.touch(),
    idleRemainingMs: () => doc.idleRemainingMs(),
    // --- text pane ----------------------------------------------------------------
    /**
     * Mount the package editor in container (no textarea). h: onEnter(text, from, to),
     * onTab(text, from, to, shift) → edit | null; onEsc, onBlur, onKey(e), onPointerUp,
     * askPassphrase, onUnlockBranch(branchId, el), followInText(), dark.
     */
    mountEditor(container, h = {}) {
      if (editor) editor.destroy();
      let ed = null;
      ed = mountTextEditor(container, doc, {
        onEnter: h.onEnter,
        onTab: h.onTab,
        onEsc: h.onEsc,
        onBlur: h.onBlur,
        onKey: h.onKey,
        onPointerUp: h.onPointerUp,
        askPassphrase: h.askPassphrase,
        dark: h.dark,
        onUnlockZone: (region, el) => h.onUnlockBranch && h.onUnlockBranch(doc.branchOf(region), el),
        readOnly: !!h.readOnly,
        followInText: typeof h.followInText === "function" ? h.followInText : () => true,
        textWidthCh: () => {
          if (isStackedLayout()) return undefined;
          const v = layoutAutoWidth(doc.root());
          if (!v) return undefined;
          return OF.autoWrapCh(v, { viewportW: ed ? ed.hostEl().clientWidth : null, fallback: OF.DEFAULT_WRAP_CH });
        },
      });
      editor = ed;
      return {
        show: (on) => ed.show(on),
        isShown: () => ed.isShown(),
        hasFocus: () => ed.hasFocus(),
        focus: () => ed.view.focus(),
        hostEl: () => ed.hostEl(),
        scrollerEl: () => ed.scrollerEl(),
        selection: () => ed.selection(),
        selectionEnd: () => ed.selectionEnd(),
        lineBox: (pos) => ed.lineBox(pos),
        markLine: (from, to) => ed.markLine(from, to),
        selectRange: (from, to) => ed.selectRange(from, to),
        refresh: () => ed.refresh(),
        setReadOnly: (on) => ed.setReadOnly(on),
        zoneProblems: () => ed.zoneProblems(),
        destroy: () => { ed.destroy(); if (editor === ed) editor = null; },
      };
    },
    unmount() {
      offs.forEach((f) => f());
      if (editor) { editor.destroy(); editor = null; }
      doc.destroy();
      try { OF.clearKeys(); } catch (err) { /* keys already dropped */ }
    },
  };
  return fold;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The seal passphrase dialog. hooks: onOpen(), onClose(). Resolves the passphrase or null. */
export function askPassphrase(title, confirmIt, hooks = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "seal-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    const h = el("h2", "", title);
    const one = el("input");
    one.type = "password";
    one.autocomplete = confirmIt ? "new-password" : "current-password";
    one.placeholder = "Passphrase";
    one.setAttribute("aria-label", "Passphrase");
    const two = el("input");
    two.type = "password";
    two.autocomplete = "new-password";
    two.placeholder = "Confirm passphrase";
    two.setAttribute("aria-label", "Confirm passphrase");
    const err = el("p", "seal-error", "");
    const note = el("p", "seal-note", confirmIt
      ? "New key for this note. There is no recovery: a lost passphrase means the branch cannot be opened."
      : "");
    const ok = el("button", "", "OK");
    ok.type = "submit";
    const cancel = el("button", "", "Cancel");
    cancel.type = "button";
    const row = el("div", "seal-buttons");
    row.append(cancel, ok);
    form.append(h, one);
    if (confirmIt) form.append(two);
    if (note.textContent) form.append(note);
    form.append(err, row);
    dlg.append(form);
    document.body.append(dlg);
    if (hooks.onOpen) hooks.onOpen();
    const placeDlg = () => {
      if (!dlg.isConnected) return;
      const vv = window.visualViewport;
      const vw = vv ? vv.width : window.innerWidth;
      const vh = vv ? vv.height : window.innerHeight;
      const ox = vv ? vv.offsetLeft : 0;
      const oy = vv ? vv.offsetTop : 0;
      const box = dlg.getBoundingClientRect();
      dlg.style.left = ox + Math.max(8, (vw - box.width) / 2) + "px";
      dlg.style.top = oy + Math.max(8, (vh - box.height) / 2) + "px";
    };
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      if (window.visualViewport) window.visualViewport.removeEventListener("resize", placeDlg);
      one.value = "";
      two.value = "";
      if (dlg.open) dlg.close();
      dlg.remove();
      if (hooks.onClose) hooks.onClose();
      resolve(value);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const pass = one.value;
      if (!pass) { err.textContent = "Enter a passphrase."; return; }
      if (confirmIt && pass.length < 8) { err.textContent = "Use at least 8 characters."; return; }
      if (confirmIt && pass !== two.value) { err.textContent = "The passphrases do not match."; return; }
      finish(pass);
    });
    cancel.addEventListener("click", () => finish(null));
    dlg.addEventListener("cancel", () => finish(null));
    dlg.showModal();
    placeDlg();
    if (window.visualViewport) window.visualViewport.addEventListener("resize", placeDlg);
    one.focus();
  });
}
