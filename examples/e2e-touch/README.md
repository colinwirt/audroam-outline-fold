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
- `wrap-spaces.md` (`?doc=wrap-spaces.md`) has the same caption as plain,
  inline-code (with a stored `w: 200`) and tiny-HTML text for
  `e2e/map-wrap-spaces.spec.ts`, which sweeps each pill's `w` and checks the
  painted lines keep the spaces between words.
- `list-numbers.md` (`?doc=list-numbers.md`) has numbered captions (`1. `,
  `12. `), a task before a number and a box after one, for
  `e2e/list-numbers.spec.ts`: the Map pill and the Outline row (`?view=outline`)
  show the number as typed.
- `day-tweaks.md` (`?doc=day-tweaks.md`, fiction) is a small day map for the
  0.2.38 P1 tweaks (`e2e/map-p1-tweaks.spec.ts`, `e2e/touch-map-p1-tweaks.spec.ts`):
  open, in-progress and done tasks (K4), a folded node with five children (K6),
  a `<t:N>` chip and an `<r:id>` jump (K3), and an id-less `Reference shelf (+)`.
  `?parse=validate` renders `validateDocument(md).doc`; add `&ids=session` for
  `validateDocument(md, { sessionIds: true }).doc`.
- `copy-jump.md` (`?doc=copy-jump.md&nodemenu=1`) has lines with and without
  ids and a spaced `< r : glaze >` jump, for the node menu Copy jump / Copy
  link specs (`e2e/copy-jump.spec.ts`, `e2e/touch-copy-jump.spec.ts`).
  `?nodemenu=1` turns on the package node menu; `?nodeuri=<template>` sets
  `nodeUri` (`none` hides Copy link). `window.__copies` records `onCopy`, and
  `window.__sets` counts `setDoc` calls (the host's dirty mark).
- `time-leaves.md` (`?doc=time-leaves.md`, fiction) has `<kind:time>` and
  `<kind:session>` leaves (one spelled `<kind : time>`, one running `● open`,
  one long caption that is cut to one line), a note between two of them, and
  a time record with a child (a normal note pill), for the 0.2.40 time leaf
  specs (`e2e/time-leaves.spec.ts`, `e2e/touch-time-leaves.spec.ts`).
