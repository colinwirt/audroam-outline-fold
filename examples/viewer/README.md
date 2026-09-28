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

Uses shared core only (`../_shared/`): `parseDoc` → `createOutlineView` → `createMapView` → `resolveLayout`.

## Versions on the page

When JS loads, the chrome strip under the gold rule shows three build stamps:

| Label | Source |
|-------|--------|
| **Package** | `@audroam/outline-fold` version from `package.json` |
| **Viewer** | site-build id for `examples/_shared` + `examples/viewer` (written by `scripts/build-site.mjs`) |
| **Git** | short SHA of the commit that built the site |

`examples/viewer/build-info.js` is a local fallback; Pages overwrites it in `site/` at build time so the strip matches the deployed commit.

### Force-fresh (bypass cache)

Hard-refresh the viewer (`Ctrl+Shift+R` / `Cmd+Shift+R`) or open the URL in a private window so you are not looking at a cached `main.js` / `build-info.js`.
