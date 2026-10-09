# Student study

Pages demo for `@audroam/outline-fold`.

- Fixture: `student-study.md`
- Viewer: shared [`../viewer/`](../viewer/)?doc=../student-study/student-study.md
- Old `index.html` redirects here (stable Pages URL).

Locked rows are real demo ciphertext. They open with the demo password from [`../demo-values.json`](../demo-values.json) (shown next to **Unlock** in the viewer). Plaintexts live in `scripts/demo-plaintexts.json`; `npm run demo:seal` re-seals them.

Study time is logged as time leaves (0.2.40): `<kind:time>` / `<kind:session>` lines such as `Thu 24 Sep · 1:25 <kind:time>` draw as compact green `T` / `S` pills on the Map.

All names, places and numbers are made up.
