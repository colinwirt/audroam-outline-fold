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
`cafe-map.md` ships no locked rows. A real sealed row (of-seal-v3 with a keyring) would show dark grey with a `🔒 locked` label; clicking it asks for that key's passphrase on an empty card.
