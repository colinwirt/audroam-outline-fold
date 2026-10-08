# e2e-touch harness

Playwright touch harness for the Map (0.2.30+). Not a demo.

- `fixture.md` mirrors the 2026-10-05 fresh-review repro (fold handles, task
  boxes, a link globe, a `#N` note chip, a thread chip, a pill that sits on the right edge).
- The package controls (`mountMapControls`, − / + / Fit) are mounted **inside**
  the map host by default (`?controls=outside` puts them beside it), so the
  specs also cover a host that keeps its toolbar inside `.map-wrap`.
- `onChange` repaints, like the example hosts.
- `window.__map`, `__zooms`, `__fits`, `__tasks`, `__notes`, `__threads`, `__setFocus`
  are test hooks used by `e2e/touch-*.spec.ts` and `e2e/map-controls.spec.ts`.
- `levels.md` (`?doc=levels.md`) is four levels deep for the fold-to-level
  specs (`e2e/fold-level.spec.ts`, `e2e/touch-fold-level.spec.ts`).
  `?seed=level1` runs `seedDefaultFold` before the first paint; `?levels=1`
  adds the toolbar Levels group (`mountMapControls(..., { levels: true })`).
- `notes.md` (`?doc=notes.md`) has `#N` note chips and thread chips for the
  chip popover specs; its layout block sets `noteMapUri`, and `noteDetailsUri`
  falls back to the built-in default.
- `jumps.md` (`?doc=jumps.md`) has `<r:id>` jumps (one unresolved), hop links
  (one unresolved), a `[label](#pnid:N)` note link and a thread chip, for
  `e2e/jumps.spec.ts` and `e2e/touch-jumps.spec.ts`. `?view=outline` renders
  the same document with `toHtml` + `attachOutlineTree` instead of the Map.
  `window.__hops` records `onHop` calls from either view.
- `?theme=light` puts `of-theme-light` on the page (Map and Outline);
  `jumps.spec.ts` checks the Outline chips in both themes.
- `widths.md` (`?doc=widths.md`) has long id-less leaves under an id-less
  parent, a leaf with an authored line break, short leaves that already fit,
  and one leaf with a stored `w`, for the hold-to-fit P1 specs
  (`e2e/map-widths.spec.ts`, `e2e/touch-map-widths.spec.ts`). `?readonly=1`
  passes `canPersistWidths: false` (session-only widths); `?hoststack=1`
  makes `onWidthStep` take the steps (host-owned undo). `window.__serialize`
  returns the document text, `__changes` counts `onChange`, `__widthSteps`
  records `onWidthStep`.
