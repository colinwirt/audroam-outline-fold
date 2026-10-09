# @audroam/outline-fold

Pure TypeScript **outline language** for structured operational handoffs: parse / serialize, `fold-` / `fold+`, toggle, icons, `toHtml`, and **sealed payloads** (demo crypto only).

**MIT.** Host apps own production authentication, encryption, and database drivers.

```bash
npm i   # from this repo
npm test
npm run build
npm run demo:seal   # re-seal the example payloads with the demo password
npx serve -l 4173 .   # then open the live demos below
```

## Live demos (HTML + JS + React)

**Hosted on GitHub Pages:** [https://colinwirt.github.io/audroam-outline-fold/](https://colinwirt.github.io/audroam-outline-fold/)

**One shared viewer** ([`examples/viewer/`](./examples/viewer/)): `?doc=<md>` + optional `&layout=<sidecar.json>`. Without a sidecar, map positions **auto-pack**. Old per-demo paths redirect here.

| Demo | Pages URL |
|------|-----------|
| Landing | [https://colinwirt.github.io/audroam-outline-fold/](https://colinwirt.github.io/audroam-outline-fold/) |
| Demos index (Map) | […/examples/viewer/?doc=../demos-index/demos-index.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../demos-index/demos-index.md) |
| Shared Outline \| Map viewer | […/examples/viewer/](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/) |
| Cafe ops | […/viewer/?doc=../outline-demo.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../outline-demo.md) |
| Solar System (+ layout) | […/viewer/?doc=…/solar-system.md&layout=…](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../solar-system/solar-system.md&layout=../solar-system/solar-system.layout.json) |
| Lighthouse keeper's week | […/viewer/?doc=…/lighthouse.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../lighthouse/lighthouse.md) |
| Teacher ↔ parent | […/viewer/?doc=…/teacher-parent.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../teacher-parent/teacher-parent.md) |
| Streetlamps | […/viewer/?doc=…/streetlamps.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../streetlamps/streetlamps.md) |
| Potholes | […/viewer/?doc=…/potholes.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../potholes/potholes.md) |
| Student study | […/viewer/?doc=…/student-study.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../student-study/student-study.md) |
| Work notes | […/viewer/?doc=…/work-notes.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../work-notes/work-notes.md) |
| ISO/IEC 27001 study | […/viewer/?doc=…/iso27001.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../iso27001/iso27001.md) |
| SOC 2 study | […/viewer/?doc=…/soc2.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../soc2/soc2.md) |
| PCI DSS study | […/viewer/?doc=…/pci-dss.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../pci-dss/pci-dss.md) |
| NIST CSF study | […/viewer/?doc=…/nist.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../nist/nist.md) |
| AU gov cyber study | […/viewer/?doc=…/aust-gov-cyber.md](https://colinwirt.github.io/audroam-outline-fold/examples/viewer/?doc=../aust-gov-cyber/aust-gov-cyber.md) |
| Fixtures (md + viewer links) | […/examples/fixtures/](https://colinwirt.github.io/audroam-outline-fold/examples/fixtures/) |
| React live parser (Outline \| Map) | […/react-live/](https://colinwirt.github.io/audroam-outline-fold/react-live/) |
| Cafe ops 2D map | […/examples/canvas-2d/](https://colinwirt.github.io/audroam-outline-fold/examples/canvas-2d/) |
| Cafe ops 3D map | […/examples/3d/](https://colinwirt.github.io/audroam-outline-fold/examples/3d/) |

Shared Pages helpers: [`examples/_shared/`](./examples/_shared/) — `parseDoc` → `createOutlineView` → Map (re-exports package). Package owns `parse` / `toHtml` / `attachOutlineTree` / `toggleFold` / **`createMapView`** / **`autoPackPositions`**. No per-page map forks.

The viewer chrome shows **Package** / **Viewer** / **Git** build stamps (injected at site build). Hard-refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) or use a private window to bypass cache and confirm you have the latest Pages build.

Locked rows in the examples hold real demo ciphertext. When an outline has them, the viewer shows **Unlock** and `Demo password: 123`. The password comes from [`examples/demo-values.json`](./examples/demo-values.json), never from the outline text. See [Demo crypto](#demo-crypto-not-production-mfa). All example names, places and numbers are made up.

Source outlines: [examples/outline-demo.md](./examples/outline-demo.md) · [examples/solar-system/solar-system.md](./examples/solar-system/solar-system.md) (+ [layout sidecar](./examples/solar-system/solar-system.layout.json)) · [examples/fixtures/](./examples/fixtures/).

## Grammar (v0.2) — lean lines + trailer payloads

**Cleartext on the outline line:** lossy caption + flags + id (safe to show a partially trusted LLM).

**Secret material:** a **sealed payload** attached to the node — **not** plaintext children. Prefer a trailing payload map so titles stay readable:

```text
---
fold-: alarm, staff-private, ins-remote
collapsedMarker: "(+)"
---
- ☕ Northside Corner Cafe — ops handoff <id:root>
  - Alarm code / arming notes <encrypted> <id:alarm> (+)
  - Full staff list + emergency contacts <private> <id:staff-private> (+)
  - Vendor insurance certificate <encrypted> <id:ins-remote> (+)

--- payloads ---
alarm:
  kid: cafe-alarm-1
  alg: demo-aes-gcm
  ct: BASE64URL…
staff-private:
  kid: cafe-staff-1
  ct: …
ins-remote:
  kid: cafe-ins-1
  uri: https://example.invalid/sealed/cafe-ins-1.bin
---
```

### Rules

| Rule | Meaning |
|------|---------|
| Caption-first tags | `title <flag>* <id:…> (+)?` — serialize always emits this shape |
| Known tags only | `<id:N>`, `<t:N>`, `<r:id>`, `<kind:…>`, `<enc:…>`, `<action:…>`, `<thread:…>`, `<db:…>` and the flag/kind words (`<private>`, `<encrypted>`, `<doc>`, …). Any other bare `<word>` (`<design>`, `<script>`, `<br>`) is caption text and round-trips unchanged; there is no short id form (removed in 0.2.31) |
| Tag spacing (0.2.32) | Readers accept optional whitespace around the colon and just inside the brackets: `<id : craft-lab>`, `< t: 41609 >`, `<kind : doc>`, `<action: https://… >`. Serialize writes `<name:value>` (a new note link is `<t:N>`) and keeps a spaced tag as written while it still names the same value, so a fold or a tick does not respell it and a typed tag is stored exactly as typed. Display is clean: `toHtml` and Map pill text show `<name:value>` whatever the stored spelling (`displayTags(text)`, render only). Bare words stay exact: `< doc >` is caption text |
| Bullets and numbers (0.2.37) | One leading `- `, `* ` or `+ ` bullet is line syntax and is dropped. A list number is caption text: `- 1. Rake the leaves` and `1. Rake the leaves` both read as `1. Rake the leaves`, serialize writes `- 1. Rake the leaves`, and Map pills and the Outline show the number as typed (never an ordered list). Task boxes are leading only: `- [ ] 2. Prune the roses` is a task with caption `2. Prune the roses`; `- 3. [ ] Oil the gate` is plain text |
| Inline code | Nothing between backticks is read as a tag, id, note link or fold marker |
| `<private>` / `<encrypted>` | Lock chrome (Unlock vs Decrypt) |
| `--- payloads ---` | Trailer map keyed by node **id** → `{ kid, ct? \| uri?, alg? }` |
| Fence aliases | `payloads` / `sealed` / `enc` accepted on parse |
| Inline `<enc:…>` | Still parsed (compat); **serialize writes trailer only** |
| Exactly one of `ct` \| `uri` | Inline ciphertext **or** remote blob URI |
| Trailing YAML `---` | Same fold-/marker keys as leading frontmatter |
| `--- layout ---` | Per-node `w:` widths (plus `w-auto: single-line` from the width popover's **1 line**), and the same document keys (`fold-` / `fold+`, markers, `fontSize`, `noteUri`, `noteMapUri`, `noteDetailsUri`) |
| Head + tail frontmatter | **Merged; tail wins** on conflicts. Keys in `--- layout ---` win over both |
| Serialize | Writes those document keys in `--- layout ---`, not a leading `---` fence |

### Links (0.2.34)

Two kinds of link, each in a tag form and a markdown form:

| Written | Kind | Means |
|---------|------|-------|
| `<t:N>` | note | A note outside this map, by number (digits). In Audroam N is a pnid. It is never a node id. |
| `[label](#pnid:N)` | note | The same note link, with a label in the caption. |
| `<r:id>` | jump | A node in this map, by its `<id:…>`. |
| `[label](#id:id)` | jump | The same jump, with a label in the caption (the hop link, since 0.2.8). |

```text
- Water rota <t:1004> <r:plants> <id:rota>
- Seeds: [swap list](#pnid:1006) and the [plant list](#id:plants)
- Plant list <id:plants>
  - Tomatoes
```

- **Tags.** `<t:…>` takes digits; `<r:…>` takes the `<id:>` characters (`[A-Za-z0-9][A-Za-z0-9_-]*`). Like every tag they read with optional spaces (`<r : plants>`, `<r: plants>`, `< R:plants >`), anywhere on the line. A tag typed at the start or in the middle of the caption (`ask <t:41> about rota`) stays there, spelling and spaces included: it is part of `node.title`, and `displayCaption` / `stripLinkTags` leave it out of the shown caption (it draws as a chip). Tags after the caption are the tag group, after `<thread:…>` (`title <t:…|r:…>* <kind:…> <flag>* <id:…>`), written back in the order they were read, each with its spelling. A tag the software adds (a number pushed to `noteLinks`, a link pushed to `links`) goes into the tag group as `<t:N>` / `<r:id>`. Taking N out of `noteLinks` drops its `<t:N>` wherever it was typed; a tag the host types into `title` is kept.
- **Markdown.** `#pnid:` takes digits and `#id:` the `<id:>` characters (0.2.34: `#id:` used to accept `.` and `:`, which no id can contain). Both stay in the caption and round-trip as written. Inside backticks nothing is a link.
- **Model.** `node.links` lists every link: the tags in source order, then the caption's markdown links, as `{ kind: 'note' | 'jump', target, form: 'tag' | 'markdown', source, label? }`. `node.noteLinks` / `noteLinkTags` are unchanged (the `<t:N>` numbers); taking a number out of `noteLinks` drops its tag. `resolveJumps(node)` gives the `<r:…>` targets.
- **Ids stay lazy.** The parser never writes an id. A jump does not give its own line an id; the line it points at needs an explicit `<id:…>`. Session ids (`parse(text, { sessionIds: true })`) never take an id a jump names, and `serialize` writes a session id only when a jump points at it.
- **Unresolved.** A jump to an id that is not in the document is kept and shown muted (`of-link-broken`, `.map-jump-hit.is-broken`, a muted globe row); it does nothing when clicked.
- **Map.** `<t:N>` and `[label](#pnid:N)` draw a `#N` chip; `<r:id>` draws a `→ caption` chip (the target's first caption line, 24 characters; `→ id` when it is not in the map). A `[label](#pnid:N)` keeps its label on the pill. A jump chip, or a hop row in the globe popover, selects the node, unfolds its folded ancestors and pans to it (`onHop`).
- **Outline.** `toHtml` draws `<r:id>` as `a.of-jump[data-hop-id]` after the `#N` chips, and `[label](#pnid:N)` as an `of-note-link` with the noteUri href. `attachOutlineTree` follows `a.of-hop` and `a.of-jump` without changing the location hash: it unfolds the ancestors, focuses the row, scrolls it into view and calls `onHop(id, node, from)`.

#### `#N` popover and URL templates

A `#N` chip opens the link popover with up to three rows:

| Row | Template key | Default |
|-----|--------------|---------|
| `Open #N` | `noteUri` | none: the row only fires `onNoteLink` |
| `Open map` | `noteMapUri` | `/notes/{id}/map` |
| `Open details` | `noteDetailsUri` | `/notes/{id}/details` |

Each template is a URL with `{id}` (or `{pnid}`) for the note number, http(s) or root-relative. It is taken from, in order: the document's `--- layout ---` block (or frontmatter), then the `createMapView` option of the same name, then the default. `Open #N` always shows (without a URL it only fires `onNoteLink`); `Open map` and `Open details` show only when their template gives a URL: `none` in the layout block, or `null` / `''` as the option, turns a row off, and a template without `{id}` gives none. Each row opens in a new tab and fires `onNoteLink({ id, pnid, node, open: 'note' | 'map' | 'details' })`. A row that opens a new tab ends in a muted `↗` (`.map-link-ext`, `aria-hidden`) and its accessible name ends ", opens in new window" (0.2.38, as node menu M4); a globe row to an external link gets it too. `Open #N` without a `noteUri` opens nothing, so it has no `↗`, and in-map jumps (hop rows, `→ caption` chips) never do. A host that wants `Open #N` to open the note sets `noteUri`, for example `/view/pnid/{id}`. There is no in-map row: N is a note number, not a node id.

```text
--- layout ---
noteUri: /view/pnid/{id}
noteMapUri: /outline-view?id={id}&map=1
noteDetailsUri: none
---
```

`noteUriTemplate(key, frontmatter, options)` and `noteLinkHrefs(pnid, frontmatter, options)` resolve them for a host.

**Key identity:** Every sealed node is expected to carry its own `kid`. The default is one key per node; sharing a `kid` across nodes is supported when the user deliberately judges their sensitivity the same. The trailer stays keyed by node id, with each entry carrying its own `kid`.

**Single-key fallback (host unlock):** If sealed nodes omit `kid` and the unlock context has exactly one key, the host may use that key for all sealed nodes and assume one shared algorithm. With zero or multiple keys, do not guess: require explicit `kid`, plus `alg` when it is not the demo default. This is only a whole-document convenience; per-node `kid`s remain the expected path.

`serialize` always emits lean lines + a `--- payloads ---` trailer when any node has `sealed`.

### Optional kinds / flags

```text
- Payroll portal notes <private> <id:payroll>
- Alarm arming notes <encrypted> <id:alarm>
- Cafe supplier account <kind:ticket> <id:supplier-account>
- Menu change awaiting sign-off <kind:pending-approve> <id:menu-signoff>
- Thu 8 Oct · 1:25 <kind:time> <id:wheel-t1>
- Sat 3 Oct · 2:40 <kind:session> <id:glaze-s1>
```

`<kind:time>` and `<kind:session>` (0.2.40) mark time records; on the Map a leaf with one is a [time leaf](#time-leaves-0240). They are colon-form only: a bare `<time>` or `<session>` stays caption text.

## Demo crypto (not production MFA)

```ts
import {
  demoSeal,
  demoOpen,
  DEMO_PASSPHRASE,
  DEMO_ALG,
} from '@audroam/outline-fold';

const sealed = await demoSeal('Arm code 4821', DEMO_PASSPHRASE, 'cafe-alarm-1');
const plain = await demoOpen(sealed, DEMO_PASSPHRASE);
```

| | |
|--|--|
| **Example password** | `123`, from `examples/demo-values.json` (the demo values provider the viewer reads) |
| **`DEMO_PASSPHRASE`** | `northside-demo`, a sample constant for your own tests |
| **Key per payload** | PBKDF2-SHA-256 (100k) from the password + a random 16-byte salt stored in the ciphertext (`salt ‖ iv ‖ ct+tag`) |
| **Alg label** | `demo-aes-gcm` (AES-GCM + PBKDF2 via Web Crypto) |
| **Regenerate fixtures** | `npm run demo:seal` ← plaintexts in `scripts/demo-plaintexts.json`, password in `examples/demo-values.json` |

Remote `uri` entries **cannot** be opened by `demoOpen` — the host must fetch after key release.

### Key sources (host's choice)

The **key is never in the outline string**. Session / user supplies it:

1. **Browser session** — passphrase or DEK in memory after unlock (`sessionStorage` OK for demo; avoid `localStorage` for demo DEKs)
2. **Password manager** — paste field labeled “from password manager” (future: Web Credentials / 1Password)
3. **Pageant / OS agent** — not wired in the browser examples
4. **Server after MFA** — `onDecrypt(id, kid)` → host returns the DEK

The Pages examples use a password prompt prefilled with the demo password.

Unlock reveals **session-only** plaintext under the node (default: do **not** write plaintext back into the editor).

## Security boundary

| In this package | In the host app |
|-----------------|-----------------|
| Grammar, fold state, icons, HTML chrome, Map SVG | Authentication / MFA challenge |
| Trailer / inline sealed fields | Key management, remote blob fetch |
| `demoSeal` / `demoOpen` (**demo only**) | Production crypto / ACL key release |
| `onUnlock` / `onDecrypt` **types** | Real key release callbacks |
| `db` flag + `dbRef` string | Connection pools, credentials |

**Demo ≠ production MFA.** The Pages examples unlock with the demo password so they work offline.

Link `dist/outline-fold.css` before any host stylesheet. The export is `@audroam/outline-fold/outline-fold.css`. It paints `toHtml` rows and the map. A collapsed fold circle is solid gold; an expanded one is a gold ring you can see through. Override only chrome that belongs to the host.

## API

```ts
import {
  parse,
  serialize,
  toggleFold,
  setExpandLevel,
  isCollapsed,
  hasSealed,
  isRemoteSealed,
  toHtml,
  attachOutlineTree,
  validateDocument,
  createMapView,
  autoPackPositions,
  pillSize,
  FOLD_SLOT,
  demoSeal,
  demoOpen,
  DEMO_PASSPHRASE,
} from '@audroam/outline-fold';

const doc = parse(text);
const { ok, issues } = validateDocument(text);
hasSealed(doc.nodes[0]);
const next = toggleFold(doc, 'alarm');
const through2 = setExpandLevel(doc, 2); // iThoughts-style; 0–9 or '*'/'all'
const html = toHtml(next);

// Cafe / host: bind click + keyboard fold/nav (session-local)
const root = document.getElementById('tree');
let current = next;
function paint() {
  root.innerHTML = toHtml(current);
}
const tree = attachOutlineTree(root, {
  getDoc: () => current,
  setDoc: (d) => { current = d; },
  render: paint,
});
paint();
tree.refresh();
```

### Keyboard / expand level (read-only fold)

Wired by **`attachOutlineTree`** (cafe demo + host outline-view). Tab enters/leaves the tree as one stop; arrows move among **visible** rows (roving `tabindex`). Session-local only — does not write `pnBody`.

| Key | Behaviour |
|-----|-----------|
| `Tab` / `Shift+Tab` | Enter or leave the tree as a whole |
| `↑` / `↓` | Previous / next **visible** row |
| `Home` / `End` | First / last **visible** row |
| `→` | Expand if collapsed; else move to first visible child |
| `←` | Collapse if expanded; else move to parent |
| Enter / Space / `.` | Toggle fold when the row has children |
| `0`–`9` | `setExpandLevel` — show through depth **N** (1-based; roots = 1). `0` = top level only |
| `*` | Expand all foldable nodes |

`setExpandLevel(doc, n)` is pure: same fold-/fold+ ids model as `toggleFold`. Polite live region (`data-testid="of-live"`) announces expand/collapse and level changes — not every arrow move.

**0.2.3:** `attachOutlineTree` + ARIA `tree` / `treeitem` / `group` markup from `toHtml` (children stay in the DOM when collapsed; CSS hides).




## Map (`createMapView` / `autoPackPositions`)

SVG left-to-right mind map for a parsed outline. **No auth.** MIT-clean drop-in for hosts (e.g. Audroam `/outline-view`).

```ts
import {
  parse,
  createMapView,
  autoPackPositions,
  isCollapsed,
} from '@audroam/outline-fold';

// Session ids let lines without <id:…> fold, tick and take focus, and make
// an authored `(+)` on such a line load folded. See "Lines without an id".
const doc = parse(md, { sessionIds: true });
const layout = {
  version: 1,
  layout: 'ithoughts-lr',
  viewBox: { w: 1200, h: 960 },
  nodes: {},
  _source: 'auto-pack', // full recompute each paint; omit / set sidecar to keep authored x,y
};

const map = createMapView(hostEl, {
  getDoc: () => doc,
  setDoc: (d) => { doc = d; },
  getLayout: () => layout,
  getFocusId: () => focusId,
  setFocusId: (id) => { focusId = id; },
  onChange: () => map.paint(),
});
map.bindGestures();
map.bindKeyboard({ panel: mapPanel });
map.paint();

// Headless layout only (tests / server):
const packed = autoPackPositions(doc, {
  isNodeCollapsed: (id) => isCollapsed(doc, id),
});
```

| Export | Role |
|--------|------|
| `createMapView(host, opts)` | Interactive SVG pills + pan/zoom + Map orientation keyboard |
| `autoPackPositions(doc, opts?)` | Deterministic L→R positions for the fold-visible tree |
| `resolveMapFocus(doc, focusId, dir, opts?)` | Map L→R focus resolver (↑↓ siblings · → child · ← parent; no fold-on-arrow) |

**Map keyboard (when a node is selected):** `.` / Space / Enter toggle fold on the focus node; digits `0`–`9` / `*` call `setExpandLevel(doc, n, { under: focusId })` — depth **under the selection** (`1` = show that node’s children). Digits are no-ops with no selection. `ContextMenu` / `Shift+F10` are left to the host (its node menu), unless `nodeMenu: true` (0.2.39), when they open the package node menu; a host reaches the fold-to-level picker with `map.openLevelMenu(id)`. `w` opens the width popover for the selected node (mnemonics `t` Fit text, `l` 1 line, `s` 1 line siblings, `a` Auto); in view mode `Ctrl/⌘+Z` / `Shift+Ctrl/⌘+Z` undo / redo width steps. Outline `attachOutlineTree` digits stay tree-absolute.
| `pillSize(label, opts?)` / `FOLD_SLOT` / `TASK_LEAD` | Pill measure (multi-line wrap; foldable end-cap always reserved; `FOLD_SLOT=34`; task lead when task set) |


**Map camera follow (0.2.14):** visible-fraction keep ~0.6 / recentre ≲0.25; `cameraRecentre` (default on); edit mode gentle ensure; viewport clamp + manual-pan-wins unchanged. **Caption rich text (Outline + Map, 0.2.13+; literal escapes 0.2.15):** break tokens (real LF/CR, literal `\n`/`\r`/`\r\n`, `<br>`/`<nr>`) normalize before wrap; tiny HTML allowlist `<b>`/`<strong>`/`<i>`/`<em>` (no attrs); `captionToHtml` also turns markdown `![alt](url)` / `[label](url)` / bare `https://` into allowlisted `<img>` / `<a>` (https + safe relative; rejects `javascript:`/`data:`/`//`/etc). Inline SVG in captions is never emitted — pack icons stay via `kind` → `iconForNode` only. **Map pills (0.2.10 scrapbook):** multi-line wrap (`wrapCh` default **32**, product `maxLines` **~30** + **more/less**; soft safety ~500/50k); newlines preserved; `FOLD_SLOT` (≥34) on text region only; optional task lead SVG for a leading `[ ]` / `[]` / `[-]` / `[x]` or `☐` / `☑`. Text/label click = select/focus only; **label text is selectable/copyable** (pan clears selection so canvas drag does not select; Map keys only when Map focused; selected pill gets `is-focused` accent ring from `focusId` (0.2.15); single stable focus owner (0.2.16): the map host (`tabindex=0`, `role=tree`) keeps DOM focus across paint with `aria-activedescendant` → selected node and keydown on the host; node/canvas click focuses the host; editor typing never steals focus on paint); **fold only via circle-+** (keyboard `.` / Space / Enter; **digits / `*` when selected** = depth under that node via `setExpandLevel(..., { under })`). Map does not render caption images yet.

### Scrapbook pack (0.2.8)

| Export | Role |
|--------|------|
| `wrapLines` / `pillSize` / `DEFAULT_WRAP_CH` / `DEFAULT_MAX_LINES` | Multi-line measure; default maxLines **30** + more/less (`bodyExpanded`); soft safety 500/50k; sidecar `wrapCh` / `maxLines` / `bodyExpanded` |
| `seedColdStartFold` / `measureLineageHeight` | Cold-start: try depth 3 → depth 2 → trim root children so visible lineage height ≤10 |
| `seedDefaultFold(doc, { rule? })` / `hasSavedFold(doc)` | First view with no saved fold state (0.2.32). Default `level1`: each root and its children. `cold-start` = `seedColdStartFold`, `all` = no change. A doc with `(+)` markers or a `fold-`/`fold+` list comes back untouched. Call once on load, after resume and before the first paint. |
| `foldLevelPicker(doc, id)` / `currentFoldLevel` | Fold-to-level model (0.2.32): items Fold · 1 · 2 · 3 · All with key hints, shown/hidden counts, levels equal to or deeper than the subtree flagged, current level checked. Apply with `setExpandLevel(doc, key, { under: id })`, which resets the whole subtree. The Map picker below uses it. |
| Map fold-to-level picker (0.2.32) | Built into `createMapView` after `bindGestures()` / `bindKeyboard()`. Open: hold a fold handle 450 ms (ring from 150 ms; 10 px touch / 4 px mouse slop, a second finger cancels), right-click the handle itself, or `map.openLevelMenu(id)` (a host node menu's `Levels…` item). A right-click or long-press anywhere else on the node, and `ContextMenu` / `Shift+F10`, are left to the host and close any open package menu. A right-click or long-press the package handles gets `preventDefault` and `stopPropagation` in the capture phase on the map host, so a host `contextmenu` listener (bubble phase) never sees it; a host that opens its own menu calls `map.closeMenus()` first. Touch: slide onto an item and lift to apply; lift elsewhere keeps it open. Keys in the menu: arrows, `Home` / `End`, `Enter` / `Space`, the hint key (`0` `1` `2` `3` `*`), `Esc`. All above 1,500 nodes asks `Show all N` / `Cancel` first. The handle stays put (L10); the result goes to a polite `.map-live` region. Fold state only: no id is written into a caption. A short tap or click on the handle still toggles once. |
| Map link popover (0.2.33) | The globe badge opens `.map-link-pop` (`role=menu`): one `.map-link-item` row per caption link, label plus muted destination (`linkPopWhere`: host for external URLs, file or folder for same-site links, nothing for hops). Styled like the level menu through `--map-menu-bg`, `--map-menu-stroke`, `--map-menu-hover`, `--map-menu-shadow`. Opens right of the globe (`placeLinkPop`: 8 px gap, centred; the camera pans to fit it 8 px inside, zoom unchanged) and follows pan and zoom; closes on a tap outside without a drag, `Esc`, `Tab` or a followed link. Arrows, `Enter` / `Space`, `Esc` back to the map. `renderLinkPop(links, { fine, base })` builds it. |
| Chip popovers (0.2.34) | `#N` note chips and thread chips open the same `.map-link-pop`: `Open #N`, `Open map`, `Open details` (destination muted; new tab + `onNoteLink`; see [`#N` popover and URL templates](#n-popover-and-url-templates)), or `Open thread` (`onThread`). Middle-click / Ctrl-click on a `#N` chip still opens the note directly. Rows: `noteLinkRows`, `threadRows`, `captionLinkRows`; `renderLinkPopRows` draws any of them. |
| Chip row (0.2.34) | After the caption's widest line, centred on it, inside the node: the thread pill, `#N` chips, then `→ caption` jump chips. `pillSize` reserves their width (`thread`, `noteLinks`, `jumps`; `mapChipPieces`, `mapChipSpan`). The thread pill uses `--map-menu-bg`, `--map-menu-stroke` and the muted text colour. |
| `onHop` | `createMapView` option: a jump chip or hop row selected node `id` from node `from`. |
| `map.openLevelMenu(id?)` / `closeLevelMenu()` / `applyFoldLevel(id, level)` | Open the picker on a node (default: the selected one), close it, or apply a level (`0` = Fold, `1`–`3`, `'*'`) with the same anchor and announcement. |
| `map.closeMenus()` | Close every package menu (level picker, link popover, width popover). Call it before a host menu opens, so only one menu is open. |
| Map pill widths (hold-to-fit P1) | A tap (or click) on a selected pill's bottom-right corner opens `.map-width-pop` (`role=menu`) with two `role=group` rows: **Fit** (`Fit text`, `1 line`, `1 line siblings`) over **Width** (`Slim`, `Wider`, `Auto`); `✓` marks the current one. `Fit text` = the widest line wrapped at 60ch + pads (deleted within 4 px of Auto). `1 line` = the longest authored line unwrapped + pads, capped at min(1400, map width − 48); authored breaks keep their rows, never `…`; saved as `w: N` + `w-auto: single-line`, re-measured on every paint (held while that caption is being edited). `1 line siblings` does that for every child of the same parent (forest roots count), each its own width. Slim, Wider, Fit text and a drag drop `w-auto`; Auto drops both. One pick = one batched `setDoc` + `onChange` and one undo step; ids are minted only for pills actually written. Toast `N widths changed · Undo` (`role=status`, ~8 s, pauses on hover/focus, ✕). Polite `.map-live` announcements. The camera keeps the pill's left edge. Coarse items ≥ 46×52, fine 32 px rows. |
| `canPersistWidths` / `onWidthStep` | `createMapView` options. `canPersistWidths: false` (or a function returning false): widths are session-only (layout object only; no ids, no `setDoc` / `onChange`). `onWidthStep(step)`: every width step (`kind`, `keys`, `label`, `undo()`, `redo()`); return `true` to keep it on the host's own undo stack (then the package shows no toast and leaves `Ctrl/⌘+Z` alone). |
| `map.openWidthMenu(id?)` / `applyWidthPick(id, kind)` / `undoWidth()` / `redoWidth()` | Open the width popover on a node (default: the selected one, focus on its current item), apply `fit` / `line` / `siblings` / `slim` / `wider` / `auto` as the popover does, or undo / redo the package's last width step. |
| `naturalLineWidth` / `fitTextWidth` / `autoTextWidth` / `mapFit` helpers | Width measures (caption column px, pads included) and the pure decisions: `oneLineEntry`, `fitTextEntry`, `singleLineCap`, `siblingScope`, `widthPickAnnouncement`, `widthToastText`, `WIDTH_MENU_KEYS`, `WIDTH_HELP_LINES` (the `?` help lines, F13 P1). |
| `map.setWholeMapLevel(level)` / `currentWholeMapLevel()` / `onPaint(fn)` | Whole-map level 1, 2, 3 or `'*'` (`setExpandLevel(doc, level + 1)`), the level the map is at now (or `null`), and a paint listener (returns an unsubscribe). |
| `mountMapLevels(map, container)` / `mountMapControls(map, el, { levels: true })` | Levels toolbar: `Levels 1 2 3 All`, 44 px buttons, `aria-pressed` on the current level. Opt-in. |
| `foldLevelMenu` helpers | `LEVEL_HOLD_MS`, `LEVEL_RING_MS`, `levelHoldSlop`, `startLevelHold` / `levelHoldMoved` / `levelHoldAt` / `levelHoldCancel` / `levelHoldRelease` (hold state), `placeLevelMenu` (above the handle, flip below, 8 px inset), `levelMenuKeyAction`, `levelItemLabel` / `levelItemCount` / `levelConfirmLabel`, `levelKeepVisibleShift`, `renderLevelMenu`, `wholeMapLevelDoc` / `currentWholeMapLevel` / `WHOLE_MAP_LEVELS`. |
| `captureSavedView` / `exactViewCam` / `anchoredFitViewCam` / `pickSavedView` / `resolveViewAnchor` | Saved view maths (0.2.32): a view is anchored to a node (left edge and centre as viewport fractions, zoom, viewport size). Same shape restores exactly; a different shape fits around the same node. v2 record `of-map:u{userId}:pnid:{pnid}` with `wide` / `narrow` slots: `loadSavedViews`, `saveSavedView`, `forgetSavedViews`, `clearUserMapState`. |
| `mapResumeStorageKey` / `loadMapResume` / `createDebouncedResumeSave` | localStorage resume of fold + camera + nudges (`of-map:{origin}:{docKey}` / `of-map:pnid:{pnid}`) |
| `overlayResumeOnLayout` / `isResumeStale` / `softResetResume` | Resume overlays authored sidecar; stale soft-reset |
| `toggleTask` / `onTaskToggle` / `resolveTask` | Task SVG lead; host owns persist; `<action:…>` on open→done; `<thread:…>` chip |

### Day-map tweaks (0.2.38)

- **Open tasks stand out (K4).** An open `[ ]` or in-progress `[-]` task pill gets a 2 px stroke and a semibold (600) label; done `[x]` drops to 1 px with the muted text colour (`#8b9bab` on the pill, 5.8:1). The task box, its colours and its toggle are unchanged. A folded pill keeps its gold 2.25 px stroke and a selected pill its 2.5 px focus ring; a cue keeps its own text colour. The label is measured at 600 too (`pillSize(…, { semibold })`, `naturalLineWidth` / `fitTextWidth` / `autoTextWidth` `{ semibold }`), so the pill fits it. Classes: `.map-node.task-open`, `.task-pending`, `.task-done`. `isTaskEmphasis(state)` says which states are emphasised.
- **Folded count (K6).** A folded node shows how many direct children it hides, beside the gold `+`: `.map-fold-count`, 11 px on the menu surface (`--map-menu-bg`, `--map-menu-stroke`, text colour), `role="img"` with `aria-label` "5 hidden"; the pill's label reads "…, collapsed, 5 hidden". It starts past the handle's 32 px hit target and takes no pointer events, so it is never part of the hit area. Gone when the node is open. `foldCountLabel(n)`.
- **`↗` on new-window rows (K3).** See [`#N` popover and URL templates](#n-popover-and-url-templates).

#### Lines without an id

Fold state is keyed by id. A line without `<id:…>` has no id after `parse(md)` or `validateDocument(md).doc`, so the map can draw it but cannot fold it, and an authored `(+)` on it stays on the line (`node.foldMark`) instead of folding it: the node loads open, and its handle does nothing. Parse with session ids and both work: `parse(md, { sessionIds: true })`, or `validateDocument(md, { sessionIds: true }).doc` (0.2.38). Session ids are never written back by `serialize` (unless a jump names one), so the text round-trips. The map does not apply an id-less `(+)` on its own: without an id it could fold the node but never unfold it.

### Node menu: Copy jump and Copy link (0.2.39)

Two items in the node menu's **Open** group (node menu M2–M4, M11). Neither opens a window, so they are plain labels: no icon and no `↗`.

- **Copy jump** copies the in-map jump tag for the node, `<r:id>`, written the way the package writes it (no spaces). Paste it into another caption and that line gets a `→ caption` jump chip.
- **Copy link** copies the full URL that opens the map focused on the node. The host decides the address with `nodeUri`; without it, it is the current page with `focus=<id>` (other query keys kept, the hash dropped). Copy link is hidden when no safe http(s) URL can be built (a `file:` page, `nodeUri: null`, a template without `{id}`, a callback that returns nothing).

**A line without an id** gets one on its first copy: `assignPersistentId`, the rule widths already use (a session id is written as it is; otherwise the free 1-based position, or the next number), so it is short and the tag has no spaces. Only ` <id:N>` is added to that line, through `setDoc` + `onChange`, so the host marks the document dirty and its save keeps the id. An existing id, and the spelling and spacing of every tag the user typed, are never changed. A second copy writes nothing.

**Read-only** (`canMintIds: false`, or `canPersistWidths: false` when `canMintIds` is unset): nothing is minted, and on a line without an id the two items are **hidden** (M11: show only what applies; `map.nodeCopyItems(id)` still gives each item's `reason` for a host that would rather show it disabled with a tooltip). A line that already has an id copies as usual.

The copy uses `navigator.clipboard.writeText`, falling back to a hidden textarea and `document.execCommand('copy')`. A brief **Copied jump** / **Copied link** (or **Couldn't copy**) shows at the top of the map in a `role="status"` polite live region (`.map-copied`, about 1.6 s).

```js
// Fiction: a pottery open day.
const doc = parse(`- Pottery open day <id:openday>
  - Glaze table <id:glaze>
  - Kiln corner
    - Check the cones  < r : glaze >  before firing
  - Front desk <id:desk>
`);
const map = createMapView(host, {
  getDoc: () => doc,
  setDoc: (d) => { doc = d; markDirty(); },   // a minted id arrives here
  getLayout: () => layout,
  getFocusId: () => focusId,
  setFocusId: (id) => { focusId = id; },
  onChange: () => map.paint(),
  nodeMenu: true,                              // the package's own node menu
  nodeUri: '/maps/pottery-open-day?focus={id}', // or ({ id, node }) => url; null hides Copy link
  canMintIds: () => userCanEdit,               // false: read-only, nothing minted
  onCopy: (ev) => console.log(ev.kind, ev.text, ev.minted),
});
// Copy jump on "Front desk" copies <r:desk> and writes nothing.
// Copy jump on "Kiln corner" (position 3) writes `  - Kiln corner <id:3>` and copies <r:3>.
// Copy link on "Front desk" copies https://<this host>/maps/pottery-open-day?focus=desk
```

**The package node menu** (`nodeMenu: true`, off by default) holds `Levels…` (View group, nodes with children; opens the level picker) and the Open group. It opens on a right-click on the pill (not the ± handle, which keeps the level picker; a label with a text selection keeps the browser menu), a 450 ms touch or pen hold on the pill chrome (ring from 150 ms, 10 px slop, not the label, which keeps text select), and `ContextMenu` / `Shift+F10` for the selected node. `role="menu"` named by the caption, `role="group"` per group labelled by its muted 11 px label, `role="separator"` between groups, `role="menuitem"` rows (32 px, 44 px on coarse pointers). Keys: focus starts on the first item; `↑` / `↓` wrap, `Home` / `End`, type-ahead by first letter (`c` cycles Copy jump → Copy link), `Enter` / `Space`, `→` on `Levels…`, `Esc` (focus back to the map), `Tab` closes. One menu at a time: it closes the level picker and the link and width popovers, and they close it. Nothing in it applies (a read-only leaf without an id): no menu, and the event is left to the host.

**A host with its own node menu** (outline-view's `#row-menu`) leaves `nodeMenu` off and builds the two items itself:

| | |
|---|---|
| `nodeUri` | `createMapView` option. `'…{id}…'` template (http(s) or root-relative, made absolute against the page), or `({ id, node }) => url`. Unset: current page + `focus=<id>`. `null` / `''` / `none`: no Copy link. |
| `canMintIds` | `createMapView` option, `boolean` or `() => boolean`. Default: `canPersistWidths` (true when unset). |
| `onCopy(ev)` | `createMapView` option: every copy, `{ kind: 'jump' \| 'link', key, id, text, minted, ok, reason? }`. |
| `nodeMenu` | `createMapView` option: the package's own node menu (above). Default false. |
| `map.nodeCopyItems(id?)` | `[{ kind, label, hidden, reason?, text? }]` for Copy jump and Copy link, in menu order. |
| `map.copyJump(id?)` / `map.copyLink(id?)` | Mint if needed and allowed, copy, confirm. Call them straight from the click (clipboard needs the user activation). Resolve to the `onCopy` event. |
| `map.ensureNodeId(id?)` | The written id, minting one when allowed; null when read-only and there is none. |
| `map.openNodeMenu(id?, { clientX, clientY }?)` / `map.closeNodeMenu()` | The package node menu (needs `nodeMenu: true`). `map.closeMenus()` closes it too. |
| `map.focusNode(id)` | Select a node, unfold its ancestors, camera follows: for `?focus=<id>` on load. |
| helpers | `jumpTagFor`, `nodeFocusHref`, `nodeCopyItems`, `copyText`, `copyTextFallback`, `copiedText`, `mintNodeId`, `previewPersistentId`, `writtenId`, `nodeMenuKeyAction`, `placeNodeMenu`, `renderNodeMenu`, `FOCUS_PARAM`, `NODE_HOLD_SLOP`, `READ_ONLY_REASON`, `NO_LINK_REASON`. |

The viewer example turns the package node menu on and reads `?focus=<id>`.

### Time leaves (0.2.40)

A line with `<kind:time>` or `<kind:session>` and **no children** draws on the Map as a compact green record pill (Design UX 2026-10-09, TL1–TL8). A record with children stays a normal note pill.

```text
- Pottery course <id:course>
  - Glaze lab <id:glaze>
    - Sat 3 Oct · 2:40 <kind:session> <id:s1>
    - Glaze checklist <id:check>
    - Mon 5 Oct · 1:10 <kind:time> <id:t2>
  - Kiln evening <id:kiln>
    - Fri 9 Oct · ● open <kind:time> <id:t3>
```

- **Grammar.** `time` and `session` are kinds, read with optional spaces (`<kind : time>`, `< kind:session >`), written as `<kind:time>` / `<kind:session>`, and a typed spelling is kept while the kind is unchanged. Bare `<time>` / `<session>` are caption text (so existing text that reads that way is never turned into a kind on save).
- **Size (TL1).** 0.85× the map font (13.5 px on 16, rounded to 0.5 px; a per-node layout `fontSize` is used as written), one line that hugs the caption, and the height that follows from that (no 44 px minimum). No wrap, no more/less, and a stored `w` / `w-auto` does not apply. No width grip, and they are left out of hold-to-fit: the width popover and `w` do nothing on them, `applyWidthPick` returns false, and `1 line siblings` skips them.
- **Colour (TL2, TL4, TL7).** Fill `--time-fill` `#0e2a22`, border `--time-stroke` `#2ea043` at 1.25 px (light theme `#2b8a3e`), text `#e7ecf1`, kind letter `--time-letter` `#3fb950` bold. The connector into a time leaf is `.map-edge.edge-time`, 1 px `--time-edge` `#2b8a3e`, no opacity. They stay green under any branch colour.
- **Stacking (TL5).** Two consecutive time leaves under one parent are 6 px apart; next to a note the usual gap applies.
- **States (TL6).** A tap selects (no new tap meaning); hover brightens the border to `--time-stroke-hover` `#3fb950`; focus keeps the standard ring. No fold handle and no task box. Keyboard navigation, the node menu (right-click, hold, `Shift+F10`) and a host's own `contextmenu` (Open note) work as on any pill.
- **Classes.** `.map-node.leaf.time-leaf.kind-time` / `.kind-session`; the kind letter is `text.map-kind-letter`.

**What the package draws and what the host writes (TL3).** The package draws the kind letter (`T` for time, `S` for session) from the kind, so the caption must **not** start with it. Everything else is the host's caption, shown as written: the compact date (`Thu 8 Oct`, the year only when it isn't this year), the duration as `h:mm`, or `● open` for a running record, then any real caption after it. The package's own formatting is limited to:

- the letter, `role="img"` with `aria-label` "Time record" / "Session record";
- the node's accessible name, "Time record, Thu 8 Oct · 1:25" (the caption as written; spoken expansions such as "1 hour 25 minutes" are not generated);
- one line: line breaks become spaces, and a caption over 48 characters (`TIME_LEAF_MAX_CH`) is cut with `…` (the full caption stays in the tooltip);
- a `●` in the caption painted in the letter's green.

Helpers: `timeLeafKind(node)`, `timeKindOf(kind)`, `timeLeafFontPx(px)`, `timeLeafCaption(text)`, `timeLeafAriaLabel(kind, caption)`, `timeLeafNodeFontPx`, `timeLeafPadLeft`, `timeLeafLetterW`, `mapEdgeSvg(d, { timeLeaf })`, `mapNodeClassNames({ timeLeaf })`, `pillSize(label, { timeLeaf, fontSize })`, constants `TIME_LEAF_FONT_SCALE`, `TIME_LEAF_GAP_Y`, `TIME_LEAF_PAD_X`, `TIME_LEAF_PAD_Y`, `TIME_LEAF_LETTER_GAP`, `TIME_LEAF_MAX_CH`, `TIME_LEAF_LETTER`, `TIME_LEAF_NAME`, type `TimeLeafKind`.

### Map paint tokens (0.2.32)

Set these on the map host or an ancestor. Defaults are the dark theme.

| Token | Default | Role |
|-------|---------|------|
| `--map-bg` | `#0a1f28` | Canvas |
| `--connector` | `#9bb0d0` | Edges and stems, no opacity. Keep ≥ 3:1 against the canvas. |
| `--gold` | `#c9a227` | Fold handle ring and + disc |
| `--map-handle-glyph-on-gold` | `#0a1f28` | The + glyph on the gold disc |
| `--map-handle-bg` | `transparent` | Fill inside the − ring. Set a solid colour only if you know the canvas. |
| `--map-halo` | `--map-bg` at 85% | Thin casing under the − ring and dash, so it reads on a pattern or image |
| `--connector-casing` | `transparent` | When set, every edge and stem gets a 3.2 px casing underneath. Doubles the edge DOM; leave unset above ~2,000 edges. |
| `--time-fill` | `#0e2a22` | Time leaf fill (0.2.40) |
| `--time-stroke` | `#2ea043` (light `#2b8a3e`) | Time leaf border, 1.25 px. 5.0:1 on the dark canvas, 4.5:1 on the fill. |
| `--time-stroke-hover` | `#3fb950` | Time leaf border on hover |
| `--time-letter` | `#3fb950` | `T` / `S` kind letter and the `●` of `● open` (6.0:1 on the fill) |
| `--time-text` | `#e7ecf1` | Time leaf caption (12.9:1 on the fill) |
| `--time-edge` | `#2b8a3e` | 1 px connector into a time leaf (≥ 3:1 on both canvases) |

`class="of-theme-light"` on the host (or an ancestor) switches to the light tokens: `--map-bg #f3f6f9`, `--connector #62778f`, `--gold #9a7400`, `--map-handle-glyph-on-gold #ffffff`. Map pill and text colours are not part of the light set yet. The Outline (`toHtml`) under it gets light text, muted, accent, stroke and link colours (`--of-text #1d2a36`, `--of-muted #566676`, `--of-accent #0b5cad`, `--of-stroke #c9d3dd`, `--of-hop #0b5cad`). Its `#N`, `→ caption` and Thread chips are small bold labels in `--of-accent`, `--of-hop` and `--of-muted`.

**Click vs fold:** text/label (and non-handle chrome) → select only; circle-+ → fold; task SVG → `onTaskToggle`. Space stays fold.

Layout sidecar discovery (`resolveLayout` / frontmatter `layoutSidecar:`) stays in [`examples/_shared/layoutSidecar.js`](./examples/_shared/layoutSidecar.js) — fetch-oriented Pages helper, not a package export. `examples/_shared/mapView.js` **re-exports** the package Map so existing demo imports keep working.

**Host / Build vendor import** (after `npm i @audroam/outline-fold@0.2.8` or copy `dist/` / SHA pin):

```ts
import { createMapView, autoPackPositions } from '@audroam/outline-fold';
// or from vendor dist:
import { createMapView, autoPackPositions } from './vendor/outline-fold/index.js';
```

## Document validation

`parse` stays lenient (it only throws for conflicting `fold-` / `fold+`). Hosts that need a hard gate call **`validateDocument`**, which never throws for document problems — it returns a structured result:

```ts
import { validateDocument } from '@audroam/outline-fold';

const { ok, issues, doc } = validateDocument(source);
// ok === false only when some issue.severity === 'error'
// warnings (orphan trailer id, blank caption, …) leave ok true
```

**Render what you can:** keep showing the outline from `parse` / `doc` even when there are errors. Surface `issues` in an editor panel (severity, code, message, optional `line` / `nodeId`). Refuse save / share / Invite to Beta when `!ok`.

| Code | Severity | Meaning |
|------|----------|---------|
| `fold_mode_conflict` | error | both `fold-` and `fold+` |
| `payload_missing_ct_uri` | error | sealed needs exactly one of `ct` \| `uri` |
| `payload_missing_kid` | error | sealed without `kid` (strict default) |
| `payload_kid_omitted_single_key` | warning | omitted `kid` with `{ singleKeyFallback: true }` |
| `alg_mixed_without_kid` | error | mixed algs across unkeyed sealed under single-key fallback |
| `payload_node_missing_id` | error | sealed node has no id |
| `duplicate_node_id` | error | two outline nodes share an id |
| `payload_orphan` | warning | trailer id with no outline node |
| `empty_title` | warning | blank caption after strip |
| `enc_tag_ignored` | warning | malformed inline `<enc:…>` dropped by parse |

Pass `{ singleKeyFallback: true }` when the unlock context has exactly one key (missing `kid` → warnings, not errors).

Pass `{ sessionIds: true }` (or `{ sessionIds: { prefix } }`) when you render `result.doc` in the map or the Outline: it parses with session ids, so lines without `<id:…>` can fold and an authored `(+)` on them loads folded (0.2.38). See [Lines without an id](#lines-without-an-id). It is ignored when you pass a parsed doc.

## License

MIT © 2026 Colin Wirt / Audroam
