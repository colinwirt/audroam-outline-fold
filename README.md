# @audroam/outline-fold

Pure TypeScript **outline language** for LLM handoff and actionable outlines: parse / serialize, `fold-` / `fold+`, toggle, icons, and `toHtml`.  
**MIT.** Host apps (e.g. Audroam) own real MFA, encryption, and database drivers.

```bash
npm i   # from this repo
npm test
npm run build
npx serve -l 4173 .   # then open the live demos below
```

## Live demos (HTML + JS)

Open after `npm run build` and `npx serve -l 4173 .`:

| Demo | URL |
|------|-----|
| **Outline demo** — LLM actionable outline (approve/reject, P#, votes, fold) | [examples/outline-demo.html](./examples/outline-demo.html) → `http://127.0.0.1:4173/examples/outline-demo.html` |
| Canvas 2D map | [examples/canvas-2d/](./examples/canvas-2d/) → `http://127.0.0.1:4173/examples/canvas-2d/` |
| 3D example | [examples/3d/](./examples/3d/) → `http://127.0.0.1:4173/examples/3d/` |

Source outline for the demo: [examples/outline-demo.md](./examples/outline-demo.md).

### Screenshots

![Outline live HTML + fold state (tablet portrait)](docs/screenshots/outline-html.png)

![Outline tree (tablet portrait)](docs/screenshots/outline-tree.png)

![Canvas 2D map (tablet portrait)](docs/screenshots/canvas-2d.png)

## Sample (caption-first ids)

Bots and humans can share the same artifact — tasks to approve, priority and votes in captions, fold memory in frontmatter. **Ids trail the caption** so the title stays readable (`(+)` stays outermost):

```text
---
fold-: drafts, risk-mfa
collapsedMarker: "(+)"
---
- 📋 Launch checklist — LLM actionable outline <id:root>
  - ✅ Actions to approve <id:actions>
    - [ ] Ship fold docs · P1 · 👍 <id:a1>
    - [ ] Publish package README sample · P1 <id:a2>
  - 📦 Deliverables <id:deliverables>
    - Docs site · 🥇 P1 · 👍12 👎2 <id:d-docs>
    - Draft blog post · P3 · 👍3 👎6 <id:drafts> (+)
  - 🤖 LLM proposals <id:llm>
    - 🔒 MFA on private nodes · pros2 cons3 <id:risk-mfa> (+)
      - [ ] reject:risk-mfa defer MFA to host <id:risk-mfa-act>
```

Leading `<id:…>` is still accepted for backward compatibility; `serialize` always emits caption-first.

## Locked grammar (v0)

| Rule | Meaning |
|------|---------|
| `<id:design>` | Typed id span (optional short `<design>` also OK) — **leading or trailing** |
| `(+)` | **Collapsed** — click to expand. Expanded nodes show **no** `(+)` |
| Hyphens in ids | Legal (`todo-1`). **Do not** use `-` as a fold operator on ids |
| `fold-` | Default **expanded**; list = **collapsed** ids only |
| `fold+` | Default **collapsed**; list = **expanded** ids only — never both |
| Markers | Frontmatter `collapsedMarker` (default `(+)`), optional `expandedMarker` |

### Optional kinds / flags (model only)

```text
- Payroll notes <private> <id:secret>
- Client keys <encrypted> <id:vault>
- Schema map <db:prod-pg> <id:conn>
- New map layer <kind:feature> <id:feat>
```

Icons include doc, ticket, globe, db, feature, form, bug, risk, lock, encrypted, mfa, system-link.  
`toHtml` can render locked chrome + Unlock/Decrypt buttons. Wire host callbacks for real MFA/crypto — **none ship in this package.**

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
isCollapsed(doc, 'design');
const next = toggleFold(doc, 'design'); // pure — Angular binds the object, no re-parse on click
const html = toHtml(next);
```

## Angular dogfood (host)

1. `doc = parse(savedText)` once  
2. Bind UI to `doc`  
3. On `(+)` click → `doc = toggleFold(doc, id)`  
4. On save → `serialize(doc)`

## Security boundary

| In this package | In the host (Audroam, etc.) |
|-----------------|-----------------------------|
| Grammar, fold state, icons, HTML chrome | MFA / TOTP challenge |
| `onUnlock` / `onDecrypt` **types** | Key management, decrypt |
| `db` flag + `dbRef` string | Connection pools, credentials |

## License

MIT © 2026 Colin Wirt / Audroam
