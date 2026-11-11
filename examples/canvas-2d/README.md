# Canvas 2D example

Consumes the **same** `OutlineFoldDoc` object as core + `toHtml`. The outline is `../cafe-map.md`, shared with the 3D map.

```bash
cd ../.. && npm run build
# serve the repo root (any static server) so ES modules resolve to ../../dist
```

Click nodes to `toggleFold`. `cafe-map.md` ships no locked rows; a real sealed row would show `🔒 locked` and ask for its key's passphrase on an empty card.
