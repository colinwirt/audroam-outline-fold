# 3D example (optional)

Lightweight Three.js demo consuming the same `OutlineFoldDoc` + fold state.

**Not required for `npm test`.** Core must stay green without this demo.

## Run

```bash
cd ../.. && npm run build
# serve the repo root with any static server, then open examples/3d/
npx serve .
```

Uses an import map CDN for `three` (and its `CSS2DRenderer` addon) so the package does not depend on Three.js at publish time.

The outline is `../cafe-map.md`, shared with the 2D map. Nodes are spheres on a tree layout; gold = collapsed `(+)`. Each sphere has an HTML caption label (`CSS2DRenderer`). Click a sphere to toggle fold.
Locked rows are dark grey with a `🔒 locked` label. Click one, or **Unlock** for all, to open it with the demo password from `../demo-values.json`.
