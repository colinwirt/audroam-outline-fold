# Shared Pages demo core

**Colin rule:** one parser, one outline renderer, one map renderer.

| Module | Role |
|--------|------|
| `parseDoc.js` | `parse(md) → doc` (+ validate) |
| `outlineView.js` | `createOutlineView` → `toHtml` + `attachOutlineTree` |
| `mapView.js` | `createMapView` → SVG L→R pills + pan/zoom |
| `layoutSidecar.js` | frontmatter pointer / sibling `*.layout.json` |
| `unlockStub.js` | PLACEHOLDER → stub unlock N/A; demo crypto unlock |

Package (`dist/`) owns grammar: `parse`, `toHtml`, `attachOutlineTree`, `toggleFold`, `setExpandLevel`.

Demos import from here — no duplicated per-page parse/render logic.
