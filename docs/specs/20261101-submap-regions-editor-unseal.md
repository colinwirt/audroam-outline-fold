# Spec: Sub-map regions, scoped ids, unseal lifecycle, CM6 editor, host API

Status: draft · 2026-11-01 · Owner: Colin · Package: `@audroam/outline-fold`
Builds on: `src/mapRegion.ts`, `src/sealedBranch.ts`, `src/sealedState.ts`, `docs/sealed-branches-approval.md`.

## 0. Problem
- Unsealed children get auto node ids that clash with visible nodes, so they overlap in Map.
- After unlock, the views disagree: Text still shows `<enc:KEYID>`, a "still locked" banner shows when the branch is open, and Decrypt fails.
- Hosts (Audroam `outline-view` mjs) wire events by hand, in an ad-hoc way, and the wiring breaks easily.

**Principle:** one sealed branch maps to one memory-only child instance, with one state machine and one source of truth. Every view (Map, Outline, Text, banner) renders from that state and never computes its own.

## R1. Region folding (requirement #1, top priority)
**Priority:** this is the #1 requirement of this spec (Colin, 1 Nov 2026). The package is `outline-fold`, so folding is the core feature. Region work in §1–§6 is not done until this section passes. Each phase in §6 must keep these checks green.

**What the code does today (P3, commit `bc8d602`):**
- Region nodes render through `regionCloudSvg()` as plain `<g class="map-region-node">` rect and text. They have no fold slot, no folded-count chip, no fold halo and no keyboard handling. The `foldHandleSvg` / `foldCountSvg` path in `mapView.ts` only runs for root-doc nodes.
- `layoutLocal` / `visibleKeyed` do skip children that `isCollapsed(childDoc, id)` reports as collapsed. But nothing in the UI can set that state, so inner folding cannot be reached.
- **Whole-region collapse works only through code, not in the UI.** `RegionHandle.setFolded(b)` (for regions mounted with `mountRegion`) and the `folded(region)` callback of `regionHostsFromSessions` both make `layoutLocal` return a single pill. Nothing calls them from a click, a tap or a key. The pill has no fold handle. Mounted fold state lives in the `mounted` map and is lost on unmount or remount. A locked session is always forced to fold (`folded: s.locked || …`). Outline has no region folding at all.

**(a) Same fold controls inside regions.** Every node inside a region that has children gets the same reserved fold slot, circle-+ handle, halo, folded-count chip, fold-to-level menu (right-click or hold) and keyboard fold keys as a node outside a region. It uses the same render helpers and key map, with no fork. Keyboard focus and selection move into, through and out of a region using the scoped id.

**(b) Whole-region collapse.** A region root (the cloud) has its own fold handle. Folding the root collapses the whole region to its root pill: a lock icon for `sealed`, a cloud icon for `record`, the label, and a count chip for the hidden nodes. Unfolding restores the inner fold state as it was. The anchor's fold key and handle act on the region the same way, and folding the anchor hides the region like any other subtree. "Fold all" and "fold to level N" count region levels as normal depth.

**(c) Fold state keyed by scoped id.** Fold state for region nodes is stored under the scoped id `regionId:nodeId`, and for the region root under `regionId`. It can never clash with root ids (region `""`) or with another region's ids. Fold state is never written into the child payload, so sealed ciphertext does not change when you fold. For `record` regions, fold state persists and resumes through the same per-view store and session resume path as normal fold state, keyed by scoped id.

**(d) Sealed regions.**
- A sealed region that is locked is always collapsed to its root pill and cannot be unfolded. Activating the handle asks the host to unlock (`unlock` event / `open` command).
- Fold state inside an unlocked sealed region is held in memory only, in the `SealSession`. It is never persisted. It is wiped together with the doc when the region locks again (Lock now, close, auto-lock, a parent lock or `pagehide`). On the next unlock the region opens with its default fold, not the previous one.
- An `<r:…>` link, `reveal` or `focus` that targets a node in a region unfolds every ancestor on the path. That includes the region root and any enclosing regions, which are unlocked first if needed (§8 Q3). The target ends up visible and selected. When the target region is still sealed, it unfolds only to the region root.

**(e) Map and Outline parity.** Outline renders regions as nested blocks with the same fold toggles, count chips and keys (including the `attachOutlineTree` expand-level keys and live-region announcements). Map and Outline read the same fold state by scoped id from one store. Text shows fold markers only for the root doc and never for sealed contents.

**(f) Acceptance (manual checks).**
| QA | Check |
|---|---|
| FOLD-1 | Unlock a sealed branch that has nested children. In Map, each inner parent node shows the fold slot. Clicking it collapses its children and shows a count chip, exactly like a node outside the region. |
| FOLD-2 | Select an inner region node and use the fold keys (collapse, expand, fold-to-level). The result matches the same keys on a root node, and focus never jumps out of the region. |
| FOLD-3 | Click the region root's fold handle. The cloud collapses to one pill with a count chip and the parent relayouts with no overlap. Unfolding brings back the earlier inner fold state. |
| FOLD-4 | Give a root node and a region node the same local id (e.g. `3` and `s:b7:3`). Folding one does not fold the other, in either Map or Outline. |
| FOLD-5 | Fold nodes in a `record` region, then reload. The fold state comes back the same as root fold state does. |
| FOLD-6 | Fold nodes in an unlocked sealed region, then Lock now and unlock again. The region opens with its default fold, and Text and the payload are unchanged by the fold. |
| FOLD-7 | While a sealed region is locked, its pill cannot be expanded, and clicking the handle prompts for unlock. |
| FOLD-8 | With the path collapsed (anchor, region root and inner parent all folded), follow `<r:REGION:N>`. Every level on the path unfolds and N is selected. If the region is sealed, the link stops at the region root. |
| FOLD-9 | Fold a region node in Map, then switch to Outline. The same node is folded there, and the reverse also holds. |

## 1. Sub-map cloud regions (renderer API)
```ts
interface RegionHost {
  id: RegionId;                       // stable, e.g. "s:<branchId>" or "n:<noteId>"
  kind: 'sealed' | 'record';
  anchor: NodeId;                     // parent node the cloud hangs from
  instance: OutlineFoldInstance;      // child instance (own doc, own ids)
  folded: boolean;
}
map.mountRegion(host: RegionHost): RegionHandle;
map.unmountRegion(id: RegionId): void;      // also wipes the child (see §3)
RegionHandle: { relayout(): void; setFolded(b: boolean): void; bbox(): RegionBox }
```
- **Layout:** each child lays out in its own local frame. The parent then treats the region's hull (`regionHull`, pad 14) as one oversized "virtual node" at the anchor, so parent layout reserves space for it. Parent nodes can never overlap the region, because packing is done once with real sizes.
- **Packing:** regions under the same parent are packed into a column in source order, with a gap equal to the node gap. Nested regions recurse, up to `MAX_SEAL_DEPTH` (4).
- **Fold:** a folded region collapses to a single pill showing a lock or cloud icon and a label. Unfolding triggers a relayout of the parent. Fold state is per region and per view, and it is never written into the payload.
- **Render:** the cloud is drawn with `regionSvg`. `sealed` is green (the secure zone); `record` is neutral.

## 2. Id space per region
- Each child instance assigns ids only inside its own space. The public, scoped id is `regionId:nodeId`, for example `s:b7:3`. The root region is `""`, so root ids stay unchanged.
- The child serialises its local ids only, so the payload never contains scoped ids. Scoping happens at mount time.
- **Link resolution for `<r:N>`:**
  1. Look up N in the link's own region.
  2. If it is not found there, look in the parent regions, going outward to the root.
  3. An explicit `<r:REGION:N>` targets that region directly.
  4. If the target is in a sealed region that is locked, the link renders as "🔒 locked target", and `reveal` asks the host to unlock first. The link never leaks the label.
- Links from root into a sealed region are discouraged. The validator warns, because the target is unreadable while sealed.

## 3. Unseal lifecycle (single state machine)
```
sealed ──open(pass)──▶ unlocking ──ok──▶ unlocked ──save──▶ saving ──ok──▶ unlocked
   ▲                       │fail                │lockNow / close        │fail
   │                       ▼                    ▼                        ▼
   └──────────── error ◀───┘         locked(=sealed, wiped)          error (edits kept in memory, retry)
```
- The state lives in `SealSession` (one per region) and is held by the parent instance. Views subscribe to it, and no view keeps a copy of the state.
- **Text view:** always shows the `<enc:KEYID>` line. When the session is `unlocked`, the CM6 secure-zone widget appears under that line (§4).
- **Banner:** derived only from `session.state`. Showing "locked" while the session is `unlocked` is impossible by construction.
- **Save:** re-seals the child doc into the parent payload using the same mode and kid. The AAD (v, kid, kdf, alg, map id, branch id) is rebuilt and the IV is fresh. The parent marks itself dirty, and the host saves the parent.
- **Lock now:** if the branch has unsaved edits, the user is asked to save or discard. The child is then wiped (doc, undo history, derived key, DOM) and the state becomes `sealed`.
- **Close or unmount** works like Lock now. Navigation and `pagehide` trigger a wipe.
- **Remove seal:** needs an explicit confirm. The child's children are inlined into the parent with re-issued ids, and the `<enc>` line is removed.
- **Rotate kid or mode:** a separate command, not part of save.
- **Nested sealed branches:** a nested branch is a region inside the child, with its own session. Locking the parent locks every descendant first.

## 4. Optional editor module: `@audroam/outline-fold/editor`
- CodeMirror 6 is a peer dependency, so the core package stays CM-free.
- Exports `outlineEditor({ instance, sessions })`, which returns a CM6 `Extension[]`. The bundle includes outline-fold syntax highlighting, fold, and the secure-zone widget.
- **Secure zone:** a block widget decoration placed after each `<enc>` line whose session is `unlocked`. The widget hosts a nested `EditorView` bound to the child doc, with a green frame and Save, Lock and Remove seal buttons. The main document holds only the `<enc>` tag, so copy, paste and undo in the main editor never contain plaintext.
- The `<enc>` line is atomic, so the user cannot edit it by hand. Deleting it requires Remove seal.

## 5. Typed host API
```ts
type OFEvent =
 | { type:'unlock'; region:RegionId } | { type:'lock'; region:RegionId; reason:'user'|'close'|'parent' }
 | { type:'save'; region:RegionId; payload:string } | { type:'select'; id:ScopedId }
 | { type:'change'; region:RegionId; dirty:boolean } | { type:'error'; region?:RegionId; code:string; message:string };
type OFCommand =
 | { cmd:'open'; region:RegionId; passphrase:string } | { cmd:'lock'; region:RegionId|'all' }
 | { cmd:'reveal'; id:ScopedId } | { cmd:'focus'; id:ScopedId; view?:'map'|'outline'|'text' };
instance.on<T extends OFEvent['type']>(t:T, fn): () => void;   // returns unsubscribe
instance.dispatch(c: OFCommand): Promise<void>;
```
- Events are emitted only after a state transition has been committed. Hosts never touch the DOM or session internals.
- Error codes: `bad-pass`, `aad-mismatch`, `too-large`, `depth`, `save-failed`.

## 6. Migration from Audroam mjs
1. **P1 – API shim:** add `on` and `dispatch` alongside the current exports. Audroam replaces its hand-wired listeners with `on(...)` while behaviour stays the same.
2. **P2 – Sessions:** move unlock state out of the mjs into `SealSession`. The banner and Text read from the session. This fixes the false banner and Decrypt.
3. **P3 – Regions and scoped ids:** unlocked children mount as region instances. This fixes the overlap and id clashes.
4. **P4 – Editor:** swap the textarea for `outline-fold/editor`, with the secure zone.
5. **P5 – Notes mode:** note records mount as `record` regions in the shared map.
6. **P6 – Delete:** remove the legacy mjs decrypt and wiring code.

Each phase ships behind a flag and can be reverted on its own.
Region folding (§R1) is requirement #1. P3 and later phases are not complete until FOLD-1 to FOLD-9 pass.

## 7. Acceptance (what the screen shows)
| QA | Check |
|---|---|
| SEAL-1 | Sealed branch: Map shows a green folded pill with a lock icon, Outline shows "Sealed branch", and Text shows the `<enc:KEYID>` line only. |
| SEAL-2 | After unlock with the right passphrase, a green cloud appears under the anchor. No child overlaps a parent node, and the banner disappears from all three views at the same time. |
| SEAL-3 | After a wrong passphrase, every view shows a single error ("Wrong passphrase") and the state stays sealed. |
| SEAL-4 | After editing a child and pressing Save, the secure zone shows "Saved", Text still shows only `<enc:KEYID>` (same kid), and a reload followed by unlock shows the edit. |
| SEAL-5 | After Lock now, the cloud collapses to the locked pill and the secure zone disappears. Copying the main text contains no plaintext. |
| SEAL-6 | With a nested sealed branch inside an unlocked one, a second cloud appears inside the first. Locking the outer branch locks both. |
| SEAL-7 | After Remove seal and confirm, the children appear as normal nodes with no duplicate ids, and the `<enc>` line is gone. |

**Proposed minimal tests (fast, under 2 s each, no browser, not added yet):**
- A state-machine transition table.
- Scoped-id uniqueness across two regions.
- `<r:N>` resolution order.
- A re-seal round trip that keeps the kid and mode.
- A Lock check that asserts the wipe (no references kept).
- One Playwright smoke test for SEAL-2, with a 10 s timeout.

## 8. Open questions
1. ~~Unlock across tabs~~ **Decided (Colin, 1 Nov 2026): per tab.** No BroadcastChannel sharing; each tab unlocks on its own.
2. ~~Auto-lock~~ **Decided (Colin, 1 Nov 2026): auto-lock after 5 min idle by default, configurable in the layout block.**
3. ~~Links into sealed regions~~ **Decided (Colin, 1 Nov 2026): allowed. `<r:REGION:N>` goes to the region root while it is sealed, and to the node itself once it is unsealed.** It still shows a locked placeholder and never reveals the label.
4. ~~CM6 bundle~~ **Decided (Colin, 1 Nov 2026): lazy import. The editor module loads only when the text editor is opened.**
5. ~~Passphrase cache for nested branches~~ **Decided (Colin, 1 Nov 2026): when the key for a nested sealed branch is already unlocked in this tab, ask "Unlock this branch too?" with no passphrase; a key that is not unlocked still needs its passphrase. Never unlock other branches silently.**
6. ~~Remove seal re-auth~~ **Decided (Colin, 1 Nov 2026): Remove seal always asks for the passphrase again, even when the key is already unlocked.**
