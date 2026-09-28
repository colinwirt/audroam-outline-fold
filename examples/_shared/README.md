# Shared Pages demo core

**Colin rule:** one parser, one outline renderer, one map renderer, **one viewer shell**.

| Module | Role |
|--------|------|
| `parseDoc.js` | `parse(md) → doc` (+ validate) |
| `outlineView.js` | `createOutlineView` → `toHtml` + `attachOutlineTree` |
| `mapView.js` | `createMapView` → SVG L→R pills + pan/zoom |
| `layoutSidecar.js` | frontmatter pointer / sibling `*.layout.json` / **auto-pack** |
| `unlockStub.js` | PLACEHOLDER → stub unlock N/A; demo crypto unlock |

**Viewer:** [`../viewer/`](../viewer/) — `?doc=<md>` + optional `&layout=`. All Pages outline demos open here (old paths redirect).

Package (`dist/`) owns grammar: `parse`, `toHtml`, `attachOutlineTree`, `toggleFold`, `setExpandLevel`.

Demos import from here — no duplicated per-page parse/render logic.
