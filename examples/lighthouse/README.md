# Lighthouse keeper's week

Pages demo for `@audroam/outline-fold`.

- Fixture: `lighthouse.md`
- Viewer: shared [`../viewer/`](../viewer/)?doc=../lighthouse/lighthouse.md
- `index.html` redirects there, so `examples/lighthouse/` works too.

A week of jobs with task boxes, written without `<id:…>` tags. Tuesday carries `(+)`. The viewer gives each line a session id when it loads (`parse(md, { sessionIds: true })`), so Tuesday loads folded with a `2` beside its `+` (0.2.38), and **Handoff text** writes the outline back without ids. Open `[ ]` and in-progress `[-]` jobs (Paint the gallery rail) have a 2 px stroke and a semibold label; done `[x]` jobs are muted.

All names and places are made up.
