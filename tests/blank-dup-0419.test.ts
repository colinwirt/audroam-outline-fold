// 0.4.19: a Map tick (whole-doc write through mergeKeeping) must never add blank nodes. Invented data.
import { it, expect } from 'vitest';
import { parse, serialize, mergeKeeping } from '../src/index.js';
it('ticking repeatedly keeps the blank-line count and text unchanged except the box', () => {
  const start = `- node 4 <id:1>\n  - [ ] Blank nodes <id:2>\n    - before <id:3>\n      - \n      - \n    - \n  - \n  - after <id:4>\n    - \n`;
  let t = start;
  for (let k = 0; k < 4; k++) {
    const view = parse(t);
    const all: any[] = []; const walk = (a: any[]) => a.forEach((x) => { all.push(x); walk(x.children || []); }); walk(view.nodes as any[]);
    const n = all.find((x) => x.id === '2'); n.task = n.task === 'done' ? 'open' : 'done';
    t = mergeKeeping(t, serialize(parse(t)), serialize(view));
  }
  expect(t).toBe(start);
});
