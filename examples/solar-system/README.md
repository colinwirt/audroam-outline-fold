# Solar System — Outline | Map

Cleartext spatial Pages demo for `@audroam/outline-fold`.

- **Outline** — cafe calm ARIA tree (`parse` / `toHtml` / `attachOutlineTree`)
- **Map** — iThoughts-inspired L→R pills; positions from sidecar JSON
- **Shared fold** across Outline | Map
- **Pan/zoom** on Map (wheel / drag / pinch)
- **No unlock UI** (chrome-free)

## Sidecar discovery

1. Frontmatter `layoutSidecar:` pointer (wins if both exist)
2. Sibling `*.layout.json` beside the `.md` (`solar-system.md` → `solar-system.layout.json`)

Missing node ids fall back to a deterministic L→R pack.

## Files

| File | Role |
|------|------|
| `index.html` | Page chrome |
| `main.js` | Wire package + map |
| `solar-system.md` | Hero fixture (cleartext) |
| `solar-system.layout.json` | Authored node positions |
