# 3D example (optional)

Lightweight Three.js demo consuming the same `OutlineFoldDoc` + fold state.

**Not required for `npm test`.** Core must stay green without this demo.

## Run

```bash
cd ../.. && npm run build
# open index.html via a static server, or:
npx serve .
```

Uses an import map CDN for `three` so the package does not depend on Three.js at publish time.

Nodes are spheres on a tree layout; gold = collapsed `(+)`. Click to toggle fold.  
Private/encrypted nodes render a “locked” darker material — host would call `onUnlock` / `onDecrypt`.
