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
