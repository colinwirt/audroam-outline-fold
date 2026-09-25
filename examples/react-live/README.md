# React live parser (OSS example)

Online-parser style demo for `@audroam/outline-fold`: textarea source → live `parse` → `toHtml` preview; fold clicks use `toggleFold` only (no re-parse) and sync `serialize(doc)` back into the textarea.

This is an **OSS example only** — not the Audroam Angular SPA.

Edits persist in the browser via `localStorage` key `audroam-outline-fold-react-live-v1` (outline text only — do not store secrets); use **Reset to cafe demo** to clear the draft and reload the seed.


## Run

From the package root (`packages/outline-fold`):

```bash
npm run demo:react
# → http://127.0.0.1:5173/
```

Or:

```bash
npm run build
npm --prefix examples/react-live install
npm --prefix examples/react-live run dev
# equivalent: npx vite --config examples/react-live/vite.config.ts
```

Production build of the demo: `npm run demo:react:build` (output under `examples/react-live/dist/`).

Seed content: `../outline-demo.md` (cafe fiction). Unlock/Decrypt buttons are stubs.
