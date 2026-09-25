# React live parser (OSS example)

Online-parser style demo for `@audroam/outline-fold`: textarea source → live `parse` → `toHtml` preview; fold clicks use `toggleFold` only (no re-parse) and sync `serialize(doc)` back into the textarea.

This is an **OSS example only** — not the Audroam Angular SPA.

A small multi-doc library lives in this browser’s `localStorage` (`audroam-outline-fold-react-live-docs-v1`: list of `{ id, title, body, updatedAt }` + `activeId`). Outline / cafe text only — do not store secrets. Quota is limited (~5MB typical); oversized libraries may fail to save silently. An older single-string key is migrated once into one doc. Use **New / Rename / Delete / Duplicate**, the doc dropdown, and **Load cafe sample**.

**Download .md** exports the active textarea as a Markdown file named from the doc title (e.g. `cafe-ops.md`). **Download library** / **Import library** use the full localStorage JSON (client-side Blob only; import can merge or replace).



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
