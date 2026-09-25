# @audroam/outline-fold

Pure TypeScript **outline language**: parse / serialize, `fold-` / `fold+`, toggle, icons, and `toHtml`.  
**MIT.** Host apps (e.g. Audroam) own real MFA, encryption, and database drivers.

```bash
npm i @audroam/outline-fold
npm test
```

## Locked grammar (v0)

| Rule | Meaning |
|------|---------|
| `<id:design>` | Typed id span (optional short `<design>` also OK) |
| `(+)` | **Collapsed** — click to expand. Expanded nodes show **no** `(+)` |
| Hyphens in ids | Legal (`todo-1`). **Do not** use `-` as a fold operator on ids |
| `fold-` | Default **expanded**; list = **collapsed** ids only |
| `fold+` | Default **collapsed**; list = **expanded** ids only — never both |
| Markers | Frontmatter `collapsedMarker` (default `(+)`), optional `expandedMarker` |

Threads `<t:…>` and task checkboxes `[ ]` are **out of v0**.

### Example

```text
---
fold-: design, todo-1
collapsedMarker: "(+)"
---
- <id:design> Designing updates for Markmap (+)
  - <id:todo-1> Wire fold state (+)
  - Child without id
- <id:open> Always open
```

### Optional kinds / flags (model only)

```text
- <id:secret> <private> Payroll notes
- <id:vault> <encrypted> Client keys
- <id:conn> <db:prod-pg> Schema map
- <id:feat> <kind:feature> New map layer
```

Icons include doc, ticket, globe, db, feature, form, bug, risk, lock, encrypted, mfa, system-link.  
`toHtml` can render locked chrome + Unlock/Decrypt buttons. Wire:

```ts
callbacks: { onUnlock(id) { /* host MFA */ }, onDecrypt(id) { /* host crypto */ } }
```

**No TOTP, keys, or DB drivers ship in this package.**

## API

```ts
import {
  parse,
  serialize,
  toggleFold,
  isCollapsed,
  toHtml,
  ICONS,
} from '@audroam/outline-fold';

const doc = parse(text);
isCollapsed(doc, 'design');      // boolean
const next = toggleFold(doc, 'design'); // pure
const text2 = serialize(next);
const html = toHtml(next);
```

### `OutlineFoldDoc` (lean)

```ts
{
  frontmatter?: { foldMode?: '-' | '+', foldIds?: string[], collapsedMarker?: string },
  nodes: Array<{ id?: string, title: string, children?: nodes[], depth: number, kind?: string, flags?: ('private'|'encrypted'|'db')[], dbRef?: string }>,
  fold: { mode: '-' | '+', ids: string[] }
}
```

## Outline format

**Indented markdown-ish** lines: 2 spaces or 1 tab per depth; optional `- ` / `* ` / `1. ` list markers. Fold truth lives in frontmatter (`fold-` / `fold+`); trailing `(+)` is UI chrome (also ingested under `fold-`).

## Angular dogfood (host)

1. `doc = parse(savedText)` once  
2. Bind UI to `doc` object  
3. On `(+)` click → `doc = toggleFold(doc, id)` — **do not re-parse every click**  
4. On save → `serialize(doc)`

## Examples

- `examples/canvas-2d/` — canvas map from the same doc object  
- `examples/3d/` — optional Three.js demo (not required for unit tests)

## Security boundary

| In this package | In the host (Audroam, etc.) |
|-----------------|-----------------------------|
| Grammar, fold state, icons, HTML chrome | MFA / TOTP challenge |
| `onUnlock` / `onDecrypt` **types** | Key management, decrypt |
| `db` flag + `dbRef` string | Connection pools, credentials |

## License

MIT © 2026 Colin Wirt / Audroam
