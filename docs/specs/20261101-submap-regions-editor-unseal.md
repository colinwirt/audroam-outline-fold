# Spec: Sub-map regions, scoped ids, unseal lifecycle, CM6 editor, host API

Status: draft · 2026-11-01 · Owner: Colin · Package: `@audroam/outline-fold`
Builds on: `src/mapRegion.ts`, `src/sealedBranch.ts`, `src/sealedState.ts`, `docs/sealed-branches-approval.md`.

## 0. Problem
- Unsealed children get auto node ids that clash with visible nodes, so they overlap in Map.
- After unlock, the views disagree: Text still shows `<enc:KEYID>`, a "still locked" banner shows when the branch is open, and Decrypt fails.
- Hosts (Audroam `outline-view` mjs) wire events by hand, in an ad-hoc way, and the wiring breaks easily.

**Principle:** one sealed branch maps to one memory-only child instance, with one state machine and one source of truth. Every view (Map, Outline, Text, banner) renders from that state and never computes its own.

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
