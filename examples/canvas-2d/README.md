# Canvas 2D example

Consumes the **same** `OutlineFoldDoc` object as core + `toHtml`. The outline is `../cafe-map.md`, shared with the 3D map.

```bash
cd ../.. && npm run build
# serve the repo root (any static server) so ES modules resolve to ../../dist
```

Click nodes to `toggleFold`. Locked rows show `🔒 locked`; click one, or **Unlock** for all, to open it with the demo password from `../demo-values.json`.
