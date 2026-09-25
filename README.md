# @audroam/outline-fold

Pure TypeScript **outline language** for structured operational handoffs: parse / serialize, `fold-` / `fold+`, toggle, icons, `toHtml`, and **sealed payloads** (demo crypto only).

**MIT.** Host apps own production authentication, encryption, and database drivers.

```bash
npm i   # from this repo
npm test
npm run build
npm run demo:seal   # regenerate cafe trailer payloads from fictional plaintexts
npx serve -l 4173 .   # then open the live demos below
```

## Live demos (HTML + JS + React)

**Hosted on GitHub Pages:** [https://colinwirt.github.io/audroam-outline-fold/](https://colinwirt.github.io/audroam-outline-fold/)

| Demo | Pages URL |
|------|-----------|
| Landing | [https://colinwirt.github.io/audroam-outline-fold/](https://colinwirt.github.io/audroam-outline-fold/) |
| Cafe ops outline (HTML) | […/examples/outline-demo.html](https://colinwirt.github.io/audroam-outline-fold/examples/outline-demo.html) |
| React live parser | […/react-live/](https://colinwirt.github.io/audroam-outline-fold/react-live/) |
| Cafe ops 2D map | […/examples/canvas-2d/](https://colinwirt.github.io/audroam-outline-fold/examples/canvas-2d/) |
| Cafe ops 3D map | […/examples/3d/](https://colinwirt.github.io/audroam-outline-fold/examples/3d/) |

Source outline: [examples/outline-demo.md](./examples/outline-demo.md).

## Grammar (v0.2) — lean lines + trailer payloads

**Cleartext on the outline line:** lossy caption + flags + id (safe to show a partially trusted LLM).

**Secret material:** a **sealed payload** attached to the node — **not** plaintext children. Prefer a trailing payload map so titles stay readable:

```text
---
fold-: alarm, staff-private, payroll, ins-remote
collapsedMarker: "(+)"
---
- ☕ Northside Corner Cafe — ops handoff <id:root>
  - Alarm code / arming notes <encrypted> <id:alarm> (+)
  - Full staff list + emergency contacts <private> <id:staff-private> (+)
  - Vendor insurance cert (remote blob) <encrypted> <id:ins-remote> (+)

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
| Head + tail frontmatter | **Merged; tail wins** on conflicts |

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

const sealed = await demoSeal('Arm code 0000 (fiction)', DEMO_PASSPHRASE, 'cafe-alarm-1');
const plain = await demoOpen(sealed, DEMO_PASSPHRASE);
```

| | |
|--|--|
| **Sample passphrase** | `northside-demo` (fictional cafe fixtures only) |
| **Alg label** | `demo-aes-gcm` (AES-GCM + PBKDF2 via Web Crypto) |
| **Regenerate fixtures** | `npm run demo:seal` ← reads `scripts/demo-plaintexts.json` |

Remote `uri` entries **cannot** be opened by `demoOpen` — the host must fetch after key release.

### Key sources (BYO ladder — demos stub all four)

The **key is never in the outline string**. Session / user supplies it:

1. **Browser session** — passphrase or DEK in memory after unlock (`sessionStorage` OK for demo; avoid `localStorage` for demo DEKs)
2. **Password manager** — paste field labeled “from password manager” (future: Web Credentials / 1Password)
3. **Pageant / OS agent** — stub “Use agent” (not wired in browser demos)
4. **Server after MFA** — stub `onDecrypt(id, kid)` → host returns DEK; demo can fake “MFA OK” then use the sample key

Unlock reveals **session-only** plaintext under the node (default: do **not** write plaintext back into the editor).

## Security boundary

| In this package | In the host app |
|-----------------|-----------------|
| Grammar, fold state, icons, HTML chrome | Authentication / MFA challenge |
| Trailer / inline sealed fields | Key management, remote blob fetch |
| `demoSeal` / `demoOpen` (**demo only**) | Production crypto / ACL key release |
| `onUnlock` / `onDecrypt` **types** | Real key release callbacks |
| `db` flag + `dbRef` string | Connection pools, credentials |

**Demo ≠ production MFA.** Pages cafe unlock uses the documented sample passphrase so the fiction works offline.

## API

```ts
import {
  parse,
  serialize,
  toggleFold,
  isCollapsed,
  hasSealed,
  isRemoteSealed,
  toHtml,
  demoSeal,
  demoOpen,
  DEMO_PASSPHRASE,
} from '@audroam/outline-fold';

const doc = parse(text);
hasSealed(doc.nodes[0]);
const next = toggleFold(doc, 'alarm');
const html = toHtml(next);
```

## License

MIT © 2026 Colin Wirt / Audroam
