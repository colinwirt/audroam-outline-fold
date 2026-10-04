# React live parser (OSS example)

Online-parser style demo for `@audroam/outline-fold`: textarea source → live `validateDocument` → **Outline** (`toHtml` + fold clicks) or **Map** (`createMapView`, same package renderer as 0.2.7+). Fold state is shared — `toggleFold` / Map fold sync via `serialize(doc)` back into the textarea.

Map mode uses **auto-pack** layout (no sidecar), pan/zoom (wheel / pinch / drag, plus − / + / Fit on the map), and package keyboard (no fold-on-Left; fold via `.` / Space / Enter; digits when selected). Package version is stamped in the header from the built `package.json`.

This is an **OSS example only** — not the Audroam Angular SPA.

A small multi-doc library lives in this browser’s `localStorage` (`audroam-outline-fold-react-live-docs-v1`: list of `{ id, title, body, updatedAt }` + `activeId`). Outline / cafe text only — do not store secrets. Quota is limited (~5MB typical); oversized libraries may fail to save silently. An older single-string key is migrated once into one doc. Use **New / Rename / Delete / Duplicate**, the doc dropdown, and **Cafe** (load cafe sample).

**.md** exports the active textarea as a Markdown file named from the doc title (e.g. `cafe-ops.md`). **Library** / **Import** use the full localStorage JSON (client-side Blob only; import can merge or replace).

## Run

From the package root:

```bash
npm run demo:react
# → http://127.0.0.1:5173/
```

Or:

```bash
npm run build
npm --prefix examples/react-live install
npm --prefix examples/react-live run dev
```

Production build of the demo: `npm run demo:react:build` (output under `examples/react-live/dist/`).

Seed content: `../outline-demo.md` (cafe fiction). Unlock/Decrypt buttons are stubs.

## Map FLIP (host wiring)

Map relocate animation (M11 FLIP, ~280ms) lives in the package (`createMapView` / `paint`). The host must **not double-paint** after a fold: `onChange → paint()` runs the FLIP; a second `paint()` from a React `useEffect` on the updated doc would rewrite `innerHTML` and kill the animation. This demo sets a skip flag in `setDoc` so the `renderDoc` effect skips that redundant paint (focus-only `onChange` still paints for the focus ring). Since 0.2.16 the Map host `<div>` is the single keyboard focus owner (`tabindex=0`, `aria-activedescendant`); repaint never drops focus. Real-browser e2e: `npm run build:site:e2e && npm run test:e2e` from the package root.

