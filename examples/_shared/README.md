# Shared Pages demo core

**Colin rule:** one parser, one outline renderer, one map renderer, **one viewer shell**.

| Module | Role |
|--------|------|
| `parseDoc.js` | `parse(md) → doc` (+ validate) |
| `outlineView.js` | `createOutlineView` → `toHtml` + `attachOutlineTree` |
| `mapView.js` | **Re-exports** package `createMapView` / `autoPackPositions` / `pillSize` / `FOLD_SLOT` / scrapbook seed+resume helpers |
| `layoutSidecar.js` | frontmatter pointer / sibling `*.layout.json` / **auto-pack** flag (Pages-only) |
| `unlockStub.js` | PLACEHOLDER → stub unlock N/A; demo crypto unlock |

**Viewer:** [`../viewer/`](../viewer/) — `?doc=<md>` + optional `&layout=`. All Pages outline demos open here (old paths redirect).

Package (`dist/` / `@audroam/outline-fold`) owns grammar + Map: `parse`, `toHtml`, `attachOutlineTree`, `toggleFold`, `setExpandLevel`, **`createMapView`**, **`autoPackPositions`**.

Demos may import Map from here (thin re-export) or directly from `../../dist/index.js` — one source of truth.
