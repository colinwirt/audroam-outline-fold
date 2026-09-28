# Solar System — Outline | Map

Cleartext spatial Pages demo for `@audroam/outline-fold`.

Uses **shared core** (`examples/_shared/`):

- `parseDoc` / `loadDoc` → doc model
- `createOutlineView` → cafe ARIA tree (`toHtml` + `attachOutlineTree`)
- `createMapView` → iThoughts-inspired L→R pills + pan/zoom
- `resolveLayout` → sidecar discovery

## Sidecar discovery

1. Frontmatter `layoutSidecar:` pointer (wins if both exist)
2. Sibling `*.layout.json` beside the `.md`

## Files

| File | Role |
|------|------|
| `index.html` | Page chrome |
| `main.js` | Thin wire to shared core |
| `solar-system.md` | Hero fixture (cleartext) |
| `solar-system.layout.json` | Authored node positions |
