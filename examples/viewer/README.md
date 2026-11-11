# Shared Outline | Map viewer

One Pages shell for every outline fixture / demo.

```
examples/viewer/?doc=../fixtures/pci-dss.md
examples/viewer/?doc=../solar-system/solar-system.md&layout=../solar-system/solar-system.layout.json
examples/viewer/?doc=../outline-demo.md
```

| Query | Role |
|-------|------|
| `doc` (or `md`) | Markdown outline URL (same-origin, under `examples/`) |
| `layout` | Optional sidecar JSON; else frontmatter `layoutSidecar:` / sibling `*.layout.json`; else **auto-pack** |
| `focus` | Optional node id: selects it and unfolds its ancestors (what **Copy link** copies) |

## Node menu (0.2.39)

Right-click a pill (not its ± handle), hold it on a phone, or press `Shift+F10` / `ContextMenu` on the selected node: **Levels…** (nodes with children) · **Copy jump** (`<r:id>`, paste it into another caption for a jump chip) · **Copy link** (this page with `&focus=<id>`). A line without an id gets a short one on its first copy, shown in **Handoff text**.

Uses shared core (`../_shared/`): `parseDoc` → `createOutlineView` → `createMapView` (package Map, re-exported) → `resolveLayout` (Pages-only).

An outline doesn't need `<id:…>` tags. Lines without one get session ids on load, so they fold, tick and take focus, and **Handoff text** writes them back without ids.

## Locked rows

The example outlines ship no ciphertext. If you load an outline that has real sealed rows
(of-seal-v3 with a `--- keyring ---`), a row's lock opens the empty unlock card: type the
passphrase for that key, or let the browser or password manager fill it. Nothing is prefilled
or shown. The branch opens in memory only; **Lock all** drops every key. Rows that use the old
demo crypto cannot be opened here.

See the [Secure quick start](../secure-quickstart/) for create key → seal → unlock.

## Versions on the page

When JS loads, the title row shows three build stamps:

| Label | Source |
|-------|--------|
| **Package** | `@audroam/outline-fold` version from `package.json` |
| **Viewer** | site-build id for `examples/_shared` + `examples/viewer` (written by `scripts/build-site.mjs`) |
| **Git** | short SHA of the commit that built the site |

`examples/viewer/build-info.js` is a local fallback (`Package` starts as `local`). A dev open then reads `package.json`. Pages overwrites that file in `site/` at build time so the strip matches the deployed commit.

### Force-fresh (bypass cache)

Hard-refresh the viewer (`Ctrl+Shift+R` / `Cmd+Shift+R`) or open the URL in a private window so you are not looking at a cached `main.js` / `build-info.js`.
