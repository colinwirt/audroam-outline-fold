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
| `<private>` / `<encrypted>` | Lock chrome (Unlock vs Decrypt) |
| `--- payloads ---` | Trailer map keyed by node **id** → `{ kid, ct? \| uri?, alg? }` |
| Fence aliases | `payloads` / `sealed` / `enc` accepted on parse |
| Inline `<enc:…>` | Still parsed (compat); **serialize writes trailer only** |
| Exactly one of `ct` \| `uri` | Inline ciphertext **or** remote blob URI |
| Trailing YAML `---` | Same fold-/marker keys as leading frontmatter |
| `--- layout ---` | Per-node `w:` widths, and the same document keys (`fold-` / `fold+`, markers, `fontSize`, `noteUri`) |
| Head + tail frontmatter | **Merged; tail wins** on conflicts. Keys in `--- layout ---` win over both |
| Serialize | Writes those document keys in `--- layout ---`, not a leading `---` fence |

**Key identity:** Every sealed node is expected to carry its own `kid`. The default is one key per node; sharing a `kid` across nodes is supported when the user deliberately judges their sensitivity the same. The trailer stays keyed by node id, with each entry carrying its own `kid`.

**Single-key fallback (host unlock):** If sealed nodes omit `kid` and the unlock context has exactly one key, the host may use that key for all sealed nodes and assume one shared algorithm. With zero or multiple keys, do not guess: require explicit `kid`, plus `alg` when it is not the demo default. This is only a whole-document convenience; per-node `kid`s remain the expected path.

`serialize` always emits lean lines + a `--- payloads ---` trailer when any node has `sealed`.

### Optional kinds / flags

```text
- Payroll portal notes <private> <id:payroll>
- Alarm arming notes <encrypted> <id:alarm>
- Cafe supplier account <kind:ticket> <id:supplier-account>
- Menu change awaiting sign-off <kind:pending-approve> <id:menu-signoff>
```

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

const doc = parse(md);
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

**Map keyboard (when a node is selected):** `.` / Space / Enter toggle fold on the focus node; digits `0`–`9` / `*` call `setExpandLevel(doc, n, { under: focusId })` — depth **under the selection** (`1` = show that node’s children). Digits are no-ops with no selection. Outline `attachOutlineTree` digits stay tree-absolute.
| `pillSize(label, opts?)` / `FOLD_SLOT` / `TASK_LEAD` | Pill measure (multi-line wrap; foldable end-cap always reserved; `FOLD_SLOT=34`; task lead when task set) |


**Map camera follow (0.2.14):** visible-fraction keep ~0.6 / recentre ≲0.25; `cameraRecentre` (default on); edit mode gentle ensure; viewport clamp + manual-pan-wins unchanged. **Caption rich text (Outline + Map, 0.2.13+; literal escapes 0.2.15):** break tokens (real LF/CR, literal `\n`/`\r`/`\r\n`, `<br>`/`<nr>`) normalize before wrap; tiny HTML allowlist `<b>`/`<strong>`/`<i>`/`<em>` (no attrs); `captionToHtml` also turns markdown `![alt](url)` / `[label](url)` / bare `https://` into allowlisted `<img>` / `<a>` (https + safe relative; rejects `javascript:`/`data:`/`//`/etc). Inline SVG in captions is never emitted — pack icons stay via `kind` → `iconForNode` only. **Map pills (0.2.10 scrapbook):** multi-line wrap (`wrapCh` default **32**, product `maxLines` **~30** + **more/less**; soft safety ~500/50k); newlines preserved; `FOLD_SLOT` (≥34) on text region only; optional task lead SVG for a leading `[ ]` / `[]` / `[-]` / `[x]` or `☐` / `☑`. Text/label click = select/focus only; **label text is selectable/copyable** (pan clears selection so canvas drag does not select; Map keys only when Map focused; selected pill gets `is-focused` accent ring from `focusId` (0.2.15); single stable focus owner (0.2.16): the map host (`tabindex=0`, `role=tree`) keeps DOM focus across paint with `aria-activedescendant` → selected node and keydown on the host; node/canvas click focuses the host; editor typing never steals focus on paint); **fold only via circle-+** (keyboard `.` / Space / Enter; **digits / `*` when selected** = depth under that node via `setExpandLevel(..., { under })`). Map does not render caption images yet.

### Scrapbook pack (0.2.8)

| Export | Role |
|--------|------|
| `wrapLines` / `pillSize` / `DEFAULT_WRAP_CH` / `DEFAULT_MAX_LINES` | Multi-line measure; default maxLines **30** + more/less (`bodyExpanded`); soft safety 500/50k; sidecar `wrapCh` / `maxLines` / `bodyExpanded` |
| `seedColdStartFold` / `measureLineageHeight` | Cold-start: try depth 3 → depth 2 → trim root children so visible lineage height ≤10 |
| `mapResumeStorageKey` / `loadMapResume` / `createDebouncedResumeSave` | localStorage resume of fold + camera + nudges (`of-map:{origin}:{docKey}` / `of-map:pnid:{pnid}`) |
| `overlayResumeOnLayout` / `isResumeStale` / `softResetResume` | Resume overlays authored sidecar; stale soft-reset |
| `toggleTask` / `onTaskToggle` / `resolveTask` | Task SVG lead; host owns persist; `<action:…>` on open→done; `<thread:…>` chip |

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

## License

MIT © 2026 Colin Wirt / Audroam
