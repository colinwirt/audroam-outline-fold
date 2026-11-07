# Secure zones as full nested maps

Status: proposed, not implemented. Audit baseline: `c823118` on
`fix/map-trailing-url-query`, 7 November 2026 (Australia/Sydney).
Request: Colin t2561u. No release, push, tag or Audroam re-pin is part of this plan.

## 1. Scope and recommendation

An unlocked secure zone should be a full nested **map instance**, with the same
node model, renderer, measurement, commands and capability-driven menus as the
outer map. Do not grow a second list of features inside `regionCloudSvg()`.
Use the decrypted subtree shared with the secure editor widget, **not** text
scraped from its DOM, and never insert it into the root document.

The session remains the data/lifetime owner. The editor widget and nested map are
peer views of that session, not competing stores. A hidden or virtualised Text
pane must not be needed to keep Map working. CodeMirror must remain optional/lazy
for a Map-only host. “Rendered from the editor widgets” should mean a reusable
secure-zone controller/adapter used by the widgets, not nesting an editor in every
SVG pill or requiring a mounted editor to supply the data.

This updates the historical observations in
[the submap spec](20261101-submap-regions-editor-unseal.md); its November 1 statement
that region folding is absent is no longer true. Existing folding is substantial.

## 2. Current parity (not acceptance of future behaviour)

Citations are to the audited baseline, not speculative new APIs. Yes means the
named primitive works for unlocked inner nodes; partial means a restricted path
exists, not full normal-node parity. Host-specific Audroam menus are outside this
checkout and cannot be certified by this audit.

| Main-pill feature | Zone now | Evidence and remaining gap |
|---|---|---|
| Rich text / inline code | **Yes** | Shared `multiLineText` / rich lines in [mapView.ts:4919–4927](../../src/mapView.ts#L4919-L4927); regression [zone-rich-link-066.test.ts:28–37](../../tests/zone-rich-link-066.test.ts#L28-L37). |
| External links / globe / preview | **Yes** | Globe [4928–4930](../../src/mapView.ts#L4928-L4930), zone click uses `showLinkPop` [4479–4486](../../src/mapView.ts#L4479-L4486), shared preview [2372–2388](../../src/mapView.ts#L2372-L2388). Note-link and jump chips are separate missing features below. |
| Icons | **Partial** | Shared label measurement uses `withNodeIcon` [4735–4746](../../src/mapView.ts#L4735-L4746); zone setters/picker exist [3199–3236](../../src/mapView.ts#L3199-L3236), [3542–3545](../../src/mapView.ts#L3542-L3545). Built-in node menu entry/removal still looks up only root nodes [3060–3063](../../src/mapView.ts#L3060-L3063), and its context-menu target excludes region pills [7335–7336](../../src/mapView.ts#L7335-L7336). |
| Fill / border / inherited colour | **Partial** | Own colour/fill classes only [4932–4935](../../src/mapView.ts#L4932-L4935), zone clouds [4852–4876](../../src/mapView.ts#L4852-L4876). Main walker propagates nearest ancestor colour/fill [5328–5331](../../src/mapView.ts#L5328-L5331), main has colour ring [5554](../../src/mapView.ts#L5554); zone does neither equivalently. Style setters exist but built-in swatches are root-gated [3064–3071](../../src/mapView.ts#L3064-L3071). |
| Width / wrapping / more–less | **Partial** | Child width writes [4554–4574](../../src/mapView.ts#L4554-L4574), menu picks [4199–4254](../../src/mapView.ts#L4199-L4254), measurement/wrap [4900–4918](../../src/mapView.ts#L4900-L4918). `nodeMeasure` omits `bodyExpanded` and node chips [4735–4746](../../src/mapView.ts#L4735-L4746); no zone more/less chrome, unlike main [5484–5489](../../src/mapView.ts#L5484-L5489). |
| Fold / unfold | **Partial** | Inner/root toggles, lock-to-unlock and announcements [4577–4604](../../src/mapView.ts#L4577-L4604); keys/levels [4662–4719](../../src/mapView.ts#L4662-L4719); fold-handle context-menu supports scoped ids [7389–7414](../../src/mapView.ts#L7389-L7414). Not absent! General pill menu is still root-only [7335](../../src/mapView.ts#L7335), and `foldCtx` returns null for a region root [4517–4522](../../src/mapView.ts#L4517-L4522), so root level-menu parity is incomplete. |
| Focus / keys | **Partial** | Scoped focus and aria active descendant [4525–4541](../../src/mapView.ts#L4525-L4541), arrows/Home/End/fold/Escape handoff [4639–4720](../../src/mapView.ts#L4639-L4720). Separate key path, not the whole root command/menu surface; stale `aria-selected` is not explicitly reset by `syncRegionFocus` for previously selected region elements [4531–4539](../../src/mapView.ts#L4531-L4539). |
| Camera follow | **Partial** | Explicit `setFocus` centres a scoped box [7693–7700](../../src/mapView.ts#L7693-L7700); fit includes regions [1895](../../src/mapView.ts#L1895). Ordinary region selection only updates focus [4525–4529](../../src/mapView.ts#L4525-L4529), unlike pending root focus/expand follow [2092–2153](../../src/mapView.ts#L2092-L2153). |
| Copy jump / Copy link | **No** | `copyItemsFor`, `ensureNodeId`, `copyNode` use root-only `nodeByKey` [2934–2968](../../src/mapView.ts#L2934-L2968), [3005–3027](../../src/mapView.ts#L3005-L3027); lookup scans only `getDoc().nodes` [3775–3780](../../src/mapView.ts#L3775-L3780). Need scoped addresses and child-local minting. |
| Start / Create | **No** (zone menu) | Library Image creation is root-gated [3057–3059](../../src/mapView.ts#L3057-L3059). No general Start action is implemented in this package's menu [3057–3080](../../src/mapView.ts#L3057-L3080); inventory the Audroam host's Start/Create actions before claiming parity. |
| View in text / Show in text | **Partial** | Scoped editor follow already locates real child rows [editor/index.ts:971–1038](../../src/editor/index.ts#L971-L1038); follow toggle exists [mapView.ts:3074](../../src/mapView.ts#L3074). No one-shot View/Show row in the library menu [3057–3080](../../src/mapView.ts#L3057-L3080). Root range reveal is not enough: [outlineDoc.ts:119–120](../../src/outlineDoc.ts#L119-L120), [501](../../src/outlineDoc.ts#L501). Host menu not audited here. |
| Details | **Partial** | Shared details class [7660–7662](../../src/mapView.ts#L7660-L7662) and count/key CSS [outline-fold.css:978–986](../../src/outline-fold.css#L978-L986) cover existing fold chrome. Zone omits main chip row, metadata and normal full-caption tooltip [mapView.ts:5511–5563](../../src/mapView.ts#L5511-L5563), versus [4877–4935](../../src/mapView.ts#L4877-L4935). |
| Thumbnails | **No** | Main paints `thumbSvg` / frame [5563–5564](../../src/mapView.ts#L5563-L5564); region measurement/render has no thumbnail path [4735–4746](../../src/mapView.ts#L4735-L4746), [4900–4935](../../src/mapView.ts#L4900-L4935). |
| Task leaves | **Yes** | Shared task lead [4910–4915](../../src/mapView.ts#L4910-L4915), scoped toggle [4488–4492](../../src/mapView.ts#L4488-L4492), editor/session bridge [outlineDoc.ts:576–602](../../src/outlineDoc.ts#L576-L602). See [map-region-task-0412.test.ts](../../tests/map-region-task-0412.test.ts). |
| Time / session leaves | **No** | Main special measurement, task suppression and kind letter [5337–5378](../../src/mapView.ts#L5337-L5378), [5503–5506](../../src/mapView.ts#L5503-L5506); zone instead always uses ordinary measurement/task [4900–4915](../../src/mapView.ts#L4900-L4915), [regionLayout.ts:203–209](../../src/regionLayout.ts#L203-L209). |
| `<id:…>` | **Partial** | Child ids are scoped for layout/focus [regionLayout.ts:200–212](../../src/regionLayout.ts#L200-L212), editor can locate written/session ids [editor/index.ts:976–1005](../../src/editor/index.ts#L976-L1005). Copy/mint does not use child context (above). |
| `<r:…>` | **Partial** | Root jump chips can target regions and reveal them [mapView.ts:5218](../../src/mapView.ts#L5218), [5527–5535](../../src/mapView.ts#L5527-L5535), [7703–7722](../../src/mapView.ts#L7703-L7722); region renderer emits no jump chips [4877–4935](../../src/mapView.ts#L4877-L4935). Targets into a region work, authored jumps inside it lack full Map support. |
| `<t:…>` | **No** (zone chip/action) | Main resolves thread and emits clickable chip [5351–5352](../../src/mapView.ts#L5351-L5352), [5520–5525](../../src/mapView.ts#L5520-L5525); zone does not [4877–4935](../../src/mapView.ts#L4877-L4935). Parsing/hiding a tag is not rendering/action parity. |

## 3. Locked-zone security contract (release gate)

**Required:** a locked zone has only the lock glyph as visible zone content.
Accessible name/title may say only a generic “Locked secure zone / Unlock”; no
private caption, local id, count, key nickname, URL or previous focus may appear.
No plaintext in attached/detached DOM owned by the package, data attributes,
aria, titles, hover/preview surfaces, live regions, menus, copy buffers, history,
serialized root/layout/resume state, diagnostics or logs. Existing explicitly
public text on the *outer anchor* is not decrypted zone text and remains outside
this boundary; confirm that UX distinction before rollout.

### What is and is not guaranteed today

- Locked sessions expose no doc, and layout returns only a root placeholder:
  [sealSession.ts:186–200](../../src/sealSession.ts#L186-L200),
  [regionLayout.ts:167–177](../../src/regionLayout.ts#L167-L177).
- The present visual output is **not literally lock-only**: region rendering
  includes public label/kid in accessible strings, key chip and fold chrome
  [mapView.ts:4883–4909](../../src/mapView.ts#L4883-L4909), and cloud chrome
  [4826–4828](../../src/mapView.ts#L4826-L4828). These are public metadata, not
  evidence of decrypted-text leakage, but they fail the stricter proposed UX.
- Session close wipes doc nodes [sealedBranch.ts:1281–1286](../../src/sealedBranch.ts#L1281-L1286);
  sealed fold entries are filtered/wiped [regionFold.ts:156–178](../../src/regionFold.ts#L156-L178),
  [196–198](../../src/regionFold.ts#L196-L198). Text widget destruction destroys
  its nested editor/history [editor/index.ts:790–806](../../src/editor/index.ts#L790-L806).
  This is a good foundation, not proof of a synchronous whole-view scrub.
- **Confirmed security gap by inspection:** removing a missing globe calls
  `dismissLinkPop`, which leaves its plaintext-bearing DOM attached for a 180ms
  fade [mapView.ts:2219–2222](../../src/mapView.ts#L2219-L2222),
  [2249–2260](../../src/mapView.ts#L2249-L2260). Lock requires immediate removal,
  not this normal dismissal. Paint also deliberately preserves overlay nodes
  [5570–5575](../../src/mapView.ts#L5570-L5575).
- **Retention/race risks, not yet fully reproduced:** width undo entries retain
  child node references; style undo retains private metadata, with no per-lock
  purge in `unmountRegion` [3737–3764](../../src/mapView.ts#L3737-L3764),
  [4176–4193](../../src/mapView.ts#L4176-L4193), [7682–7687](../../src/mapView.ts#L7682-L7687).
  Queued open/save work has no session-generation check at its final commit
  [sealSession.ts:315–349](../../src/sealSession.ts#L315-L349),
  [352–378](../../src/sealSession.ts#L352-L378); lock during unlock can see no
  viewer and return without invalidating pending open [274–278](../../src/sealSession.ts#L274-L278).
  Test and fix these before extending async preview/image/clipboard paths.
- Dirty lock may await save/confirmation or be cancelled
  [sealSession.ts:274–299](../../src/sealSession.ts#L274-L299). Do not announce a
  successful lock until it commits. Offer separate synchronous privacy conceal
  at lock request if save is pending; failure must not silently discard edits.

No claim is made that the current commit meets the full contract. This document
adds no runtime security fixes.

### Atomic lock/dispose protocol

At lock request, invalidate a monotonically increasing session epoch and conceal
all private views immediately. Resolve dirty save/discard/cancel policy without
pretending that a pending/failed save is a completed lock. At **committed lock**,
before returning control to event dispatch or emitting “locked”:

1. Revoke the session view lease and every descendant lease, deepest first;
   abort fetches, observers, RAFs, timers, image decoding, previews and commands.
   Cancellation is insufficient: every async continuation must compare its lease
   epoch and current unlocked status before any DOM/state/clipboard side effect.
2. Synchronously clear selections, active descendant, aria/title/live messages;
   remove private overlays and portal nodes without animations; replace both Map
   and Text widgets with generic locked chrome. Destroy child renderer/controllers
   and editor views, unregister listeners and clear map/layout/measurement caches.
3. Purge child undo/redo, fold, image/blob URLs and preview data; revoke object
   URLs; remove plaintext-bearing callbacks/references from root/host histories.
   Wipe owned mutable buffers/tree and release immutable strings/references.
4. Publish locked status and hand focus to the public lock/anchor. A delayed open,
   save, image load or copy completion from any previous epoch cannot remount it.

JavaScript cannot promise forensic zeroisation of immutable strings, browser
memory, screenshots, OS clipboard history or already delivered network requests.
The guarantee is no retained *application-accessible* private view/state after
commit and no stale action that recreates it. Copy jump/link while unlocked copies
only scoped addresses, not captions. Prevent any new private clipboard write once
locking begins. A previously completed user copy cannot reliably be revoked; do
not request clipboard-read access or overwrite unrelated clipboard content to
pretend otherwise. Test pending write ordering and document this limitation.

## 4. Target architecture

### 4.1 Session-backed subtree and shared renderer

Extract a core, CodeMirror-independent `SecureZoneController` (proposed name) from
shared lifecycle needs, not a second decryption layer. It owns a revocable session
lease, command context and view registrations. `SecureZone` in the editor and the
Map region widget obtain the same current child doc through it. Existing editor
writes already preserve viewer identity and mark the session dirty
[editor/index.ts:580–590](../../src/editor/index.ts#L580-L590); reuse that path.
No parsing DOM, root serialization merge or separate editor-derived snapshot.

A nested `MapInstance` uses the **same** measured node presentation, SVG painter,
interaction/commands, menu definitions and capability checks as the root map.
Extract root presentation/measurement first; do not recursively call today's
`createMapView` with all global camera/listener/storage defaults intact. Embedded
mode supplies a child-local doc adapter, a scoped-id adapter, memory-only view
state, shared command router and parent camera adapter. Cloud/lock chrome belongs
to the region wrapper, not the node renderer. Scope both DOM ids and lookups;
identical local ids in two zones and the root must never collide.

The renderer takes one explicit context: current doc, region/epoch, local/scoped
id conversions, fold store, theme/details/icons settings, permission capabilities,
command dispatcher, child bounds callback and parent-coordinate transforms.
Each capability resolves the current node at execution time; menus cannot retain
a previous child reference or bypass lock by holding an old callback.

### 4.2 Commands and menus

One command registry serves root, inner pills and region roots. Same enabled,
disabled and hidden rules, adapted only for secure-context safety or permissions.
Include fold/levels; width/wrap/body more-less; icons/colour/fill/cloud; details;
copy jump/link with local-id minting; links/thread/note preview; task/time actions;
thumbnail create/resize; and host Start/Create actions where applicable.

Expose a scoped `showInText(id, { select, focus })` host/editor command, reusing
existing child-row location. One-shot Show/View in text is independent of the
persistent Follow toggle and its typing pause. It reveals the actual nested text
widget, not the root `<enc>` line, and can focus it only on explicit request.
A locked target stops at the lock and asks to unlock; it never renders its label.
Avoid exposing library menu rows for host actions that were not supplied.

`<id>` remains local in encrypted payloads; exported navigation addresses are
scoped. Resolve `<r:local>` in the current subtree, then enclosing regions/root;
explicit scoped references are honoured subject to locked barriers. `<t:>` uses
the same thread-chip renderer/action and security restrictions as main nodes.
Any outside reference to a locked descendant must show only a generic target.

### 4.3 Focus, keyboard, camera

Use one focus coordinator and scoped active-node address. Only the innermost
active map handles a key/gesture; menu, input and CodeMirror editing contexts win
before map shortcuts. Arrow/fold/Home/End navigation and ContextMenu/Shift+F10
match root behaviour. Escape returns to the containing anchor (one level), not
an arbitrary root node. Root/global shortcuts execute once; never install one
window shortcut handler per nested instance. Update both old/new aria-selected.

Keep one page camera, with nested maps in local coordinates. Transform child
focus/expand/edit rectangles through ancestors and send them to the same parent
follow policy (gentle ensure-visible, user-pan suppression, reduced motion).
No independently scrolling/panning child viewport in the initial design. Focus
and editor-follow loop guards must remain active across Map/Text/Outline.

### 4.4 Layout and packing

Each embedded map reports its measured visible content bounds including rich
text, icons, chips, thumbnails, more-less and nested regions. The parent packs the
whole region hull plus chrome/padding as one reserved block under its anchor.
Reuse source-order sibling stacking, depth limits and no-overlap constraints from
[regionLayout.ts:104–163](../../src/regionLayout.ts#L104-L163), with the child's
shared measurement as the *only* source of node sizes. Child fold/unfold,
width/body change, font or loaded image size invalidates bounds bottom-up, then
re-packs parent once per frame. Lock removes DOM synchronously; geometry can be
re-packed afterwards. Clamp feedback loops and test authored layouts separately:
never silently overwrite author coordinates just to reserve an automatic band.

### 4.5 Fold state, editing and undo

Retain shared `RegionFoldStore` semantics: fold is view state, not an edit to
ciphertext; whole-zone collapse retains inner fold state while unlocked. Sealed
state, including record regions nested inside sealed regions, remains memory-only
and resets on lock. Normal record regions can retain their existing persistence.
No hidden subtree titles/counts in persisted view state.

Use a session-scoped transaction/undo owner shared by the child's Map commands
and Text widget. Map mutations must update the current child and notify the text
view without overwriting newer edits. No duplicate undo steps for a Map mutation
and the editor's synchronization transaction. Specify which history owns each
operation; text/style/width/task edit undo must round-trip coherently. Fold view
undo, if offered, is a separate memory-only stack. Destroy **all** private history
and revocable host undo handles on lock; root undo/redo cannot restore it. Save
re-seals child-local data only, with fresh cryptographic envelope as today.

## 5. Phases and sizes

Sizes are engineering estimates in focused person-days including tests/review,
not delivery promises. S = 1–2 days, M = 3–5, L = 6–8. Land reviewable commits;
no release or re-pin without separate approval.

| Phase | Size | Outcome / exit gate |
|---|---|---|
| P0: executable audit and host inventory | S, 1–2d | Parameterised identical root/zone fixtures for the table; inventory Audroam host menu callbacks, especially Start/Create and Show in text. Snapshot actual gaps; don't encode accidental differences as desired behaviour. |
| P1: privacy boundary before new features | M, 3–5d | Epoch/lease and synchronous privacy conceal/dispose; strict lock-only chrome; immediate overlay scrub, per-zone history/cache cleanup; pending open/save/copy guards. Full adversarial security matrix passes. Not contingent on the renderer migration. |
| P2: shared presentation and commands | M, 3–5d | Extract root measure/paint/command context with unchanged root snapshots; capability-driven menu registry and scoped Show in text. Existing root behaviours and permissions stay green. No new second zone painter. |
| P3: embedded full maps | L, 6–8d | Session-backed Map region widget using shared renderer; focus/key/camera handoff; nested bounds packing; scoped undo and fold synchronization. Opt-in development flag only; no private-state persistence. |
| P4: parity closure and host integration | M, 3–5d | All applicable table rows Yes; inherited fill/rings, more-less, chips/tags, thumbnail/time leaf support and host menu integration. Include sibling/nested security tests and whole-suite/browser validation. |
| P5: remove fork and rollout | S, 1–2d | Delete simplified region pill renderer after acceptance; shared tests permanently cover root + zone. Documentation, consumer verification and deliberate release/re-pin approval. Never retain a flag that bypasses P1 security. |

Total: approximately **17–27 focused person-days**. No large refactor or optional
menu-only patch was attempted in this audit: fold already works via handles/keys,
and simply adding menu selectors would route other commands to the wrong doc.

## 6. Test strategy and acceptance gates

### Shared parity suite

Run a common node fixture/command suite with contexts: root, unlocked zone,
zone inside zone, two sibling zones, locked zone and read-only zone. Use invented
canary captions/URLs/ids. Assert rendering structure, measurement and command
outcome rather than CSS selectors alone. Cover each row of §2 plus note chips,
missing targets, no-id/session-id minting, Unicode/code, long lines, icon toggles,
colour inheritance/noFill, theme and details modes. A locked case can only unlock;
read-only cases retain safe navigation/fold but no mutation.

Keep existing zone-rich-link/task/style/fold regression suites. Add browser
coverage for measured text/image geometry, no-overlap, touch hold/right-click,
keyboard-only focus/aria, reduced-motion camera follow, nested Text caret,
virtualised or unmounted editor, font/image load reflow and authored layout.
Verify root behaviour and package bundle/lazy-editor entry points do not regress.

### Security matrix (blocking, not best-effort)

For each lock cause (manual clean/dirty, idle, parent, pagehide, unmount/close),
check the following **in the same task as committed lock**, then after microtasks,
RAFs, timers and delayed promises have all been flushed; repeat lock/unlock cycles.

| Surface | Required test |
|---|---|
| DOM | Inspect full document including portals, hidden nodes and package-retained detached elements. Canary text/URL/id must be absent. No SVG text/image/link except generic lock chrome in zone; public outer anchor tested separately. |
| aria/title/data/live | Scan every attribute, title and live region plus browser accessibility snapshot. Old active descendant and selected state must be removed; only generic locked wording remains. No kid chip or private count. |
| Hover/preview/menu | Open link list + preview, tooltip, width/style/level menu, drag/selection and toast before lock. Lock synchronously removes their private data with no fade delay; later hover/menu callbacks cannot reopen them. |
| Clipboard | Spy clipboard API and fallback textarea + copy events. Locked copy/keyboard/context menu must produce no private text or side effect. Queue a copy, lock before continuation, assert no subsequent private write or toast. Copies already completed while unlocked are an explicit non-revocable exception. |
| Stale async | Delay decryption, save, attachment resolve, image decode/load, preview fetch and RAF/ResizeObserver callbacks. Lock/reopen same region with new epoch, then resolve old work. No resurrection, wrong-session edits, external side effects or private error/log text. |
| Undo/redo | Make text, style, width, task, id and image edits; hold host undo handles; lock; invoke every root/zone/host undo and redo path. No plaintext return or stale child mutation. Fresh unlock starts new history; no old handles affect it. |
| Serialised state | Inspect root serialize, encrypted-save output structure, layout/resume/saved-view stores, local/session storage, IndexedDB, event payloads and diagnostics. No canaries or private node ids/widths/fold state outside encryption. Sealed descendants of record regions receive same treatment. |
| Nested isolation | Lock one sibling without disturbing another, then lock parent and ensure all descendants are disposed; two equal local ids must never route cross-zone. Fail-closed render/attachment errors stay generic. |

Also exercise dirty save success/failure/cancel: a cancelled lock is visibly still
open, a pending save is not mislabelled “locked”, and a failed save does not lose
edits or silently re-expose a privacy-concealed view. Test unload/pagehide without
waiting for an asynchronous save to scrub private views.

Run `npm test`, `npm run build` and relevant Playwright suites at each runtime
phase. Record pre-existing failures separately; new security tests must all pass.
For a documentation-only audit, run the full unit baseline and report it without
claiming new implementation coverage. Heap/reference probes supplement the
observable tests; they cannot prove forensic browser-memory erasure.

## 7. Decisions still needed / integration boundaries

1. Confirm “only lock icon” removes current **public** key chip/cloud label/fold
   handle, while preserving an accessible generic unlock button and public outer
   anchor text. This spec defaults to that strict interpretation.
2. Choose dirty-lock privacy UX: recommended immediate conceal with a safe
   save/discard/cancel surface, explicit reopen after cancellation/error; no
   silent data loss and no false locked success.
3. Audroam host audit: what exactly are Start/Create, View in text and Details
   actions, and which need record/backend permissions? This checkout cannot
   certify or change those host menus. Supply typed callbacks, not DOM selectors.
4. Approve one shared parent camera (recommended), rather than independent
   embedded zoom/scroll surfaces. Confirm authored-layout overflow/packing UX.
5. Agree session transaction/history ownership and undo granularity across Map
   and Text; no plaintext undo object may escape into the host's root history.
6. Attachment previews/thumbnails may contact remote services. Default private
   zones to no new remote request without an explicit permitted source/action;
   determine caching/export policy before enabling full thumbnail parity.
7. Link export can reveal the existence/address of a private node even without a
   caption. Confirm permission policy for Copy jump/link; root-to-locked targets
   must remain generic. No external search indexing or plaintext telemetry.

## 8. Audit validation record

Documentation-only change; no runtime patch, push, tag or re-pin. `npm test` at
the unchanged runtime baseline completed in 19.59s: **1500 passed, 2 failed**
(127 test files passed, 2 failed). The failures are existing source/CSS assertions:

- `tests/text-zone-task-line-044.test.ts` — “unlocked anchor CSS tints only the
  pill, never every rect”.
- `tests/time-leaves.test.ts` — “no width grip, no width popover, no fit pick,
  no auto width on a time leaf”.

No new tests or runtime changes were added; this is a baseline run, not evidence
that the proposed security guarantees are implemented. Build/browser acceptance
remains required for runtime phases. Existing untracked scripts in the working
tree are unrelated and are not included in this commit.
