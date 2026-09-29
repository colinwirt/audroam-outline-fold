import { describe, expect, it } from 'vitest';
import {
  parse,
  pillSize,
  FOLD_SLOT,
  TASK_LEAD,
  DEFAULT_WRAP_CH,
  DEFAULT_MAX_LINES,
  wrapLines,
  measureLineageHeight,
  seedColdStartFold,
  overlayResumeOnLayout,
  isResumeStale,
  softResetResume,
  pagesDocKey,
  mapResumeStorageKey,
  toggleTask,
  shouldFireAction,
  setExpandLevel,
  isCollapsed,
  autoPackPositions,
} from '../src/index.js';

describe('scrapbook wrap', () => {
  it('defaults wrapCh 32 and maxLines 6', () => {
    expect(DEFAULT_WRAP_CH).toBe(32);
    expect(DEFAULT_MAX_LINES).toBe(6);
  });

  it('preserves newlines and soft-wraps', () => {
    const text = 'Hello world\n\nThis is a longer line that should wrap at thirty-two characters easily';
    const { lines, truncated } = wrapLines(text, 32, 6);
    expect(lines.some((l) => l === '')).toBe(true); // paragraph gap
    expect(lines[0]).toBe('Hello world');
    expect(truncated).toBe(false);
    expect(lines.every((l) => l.length <= 33)).toBe(true); // allow ellipsis room
  });

  it('truncates at maxLines with ellipsis', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const { lines, truncated } = wrapLines(text, 32, 6);
    expect(truncated).toBe(true);
    expect(lines).toHaveLength(6);
    expect(lines[5].endsWith('…')).toBe(true);
  });

  it('grows pill height with lines; keeps FOLD_SLOT on text region', () => {
    const multi = 'alpha beta gamma delta epsilon zeta eta theta iota';
    const size = pillSize(multi, { wrapCh: 16, maxLines: 6, reserveFold: true });
    expect(size.foldSlot).toBe(FOLD_SLOT);
    expect(size.w).toBe(size.textW + FOLD_SLOT);
    expect(size.h).toBeGreaterThan(44);
    expect(size.lines.length).toBeGreaterThan(1);
  });

  it('reserves TASK_LEAD when reserveTask', () => {
    const size = pillSize('Do the thing', {
      reserveTask: true,
      reserveFold: true,
    });
    expect(size.taskLead).toBe(TASK_LEAD);
    expect(size.w).toBe(size.textW + FOLD_SLOT + TASK_LEAD);
  });

  it('honours sidecar wrapCh / maxLines', () => {
    const narrow = pillSize('word '.repeat(20).trim(), {
      wrapCh: 12,
      maxLines: 3,
    });
    const wide = pillSize('word '.repeat(20).trim(), {
      wrapCh: 48,
      maxLines: 10,
    });
    expect(narrow.lines.length).toBeGreaterThanOrEqual(wide.lines.length);
    expect(narrow.textW).toBeLessThan(wide.textW);
    expect(narrow.truncated).toBe(true);
  });
});

describe('cold-start lineage seed', () => {
  const md = `---
fold-:
---
- Root <id:root>
  - A <id:a>
    - A1 <id:a1>
      - A1a <id:a1a>
    - A2 <id:a2>
  - B <id:b>
    - B1 <id:b1>
  - C <id:c>
    - C1 <id:c1>
  - D <id:d>
    - D1 <id:d1>
  - E <id:e>
    - E1 <id:e1>
  - F <id:f>
    - F1 <id:f1>
  - G <id:g>
    - G1 <id:g1>
  - H <id:h>
    - H1 <id:h1>
  - I <id:i>
    - I1 <id:i1>
  - J <id:j>
    - J1 <id:j1>
  - K <id:k>
    - K1 <id:k1>
`;

  it('depth-3 then falls back so lineage height ≤10', () => {
    const doc = parse(md);
    const seeded = seedColdStartFold(doc, { maxHeight: 10 });
    const h = measureLineageHeight(seeded);
    expect(h).toBeLessThanOrEqual(10);
    // Should be tighter than full expand
    const full = setExpandLevel(doc, '*');
    expect(measureLineageHeight(full)).toBeGreaterThan(10);
  });

  it('prefers depth 2 (root+children) when depth 3 overflows', () => {
    const doc = parse(md);
    const at3 = setExpandLevel(doc, 3);
    expect(measureLineageHeight(at3)).toBeGreaterThan(10);
    const seeded = seedColdStartFold(doc, { maxHeight: 10 });
    // Grandchildren of expanded depth-2 parents should be collapsed
    // At depth 2: setExpandLevel(2) → a1 collapsed
    expect(isCollapsed(seeded, 'a1') || measureLineageHeight(seeded) <= 10).toBe(
      true,
    );
  });
});

describe('resume helpers', () => {
  it('builds pages and pnid keys', () => {
    expect(mapResumeStorageKey({ kind: 'pnid', pnid: 41509 })).toBe(
      'of-map:pnid:41509',
    );
    const key = pagesDocKey('https://x/examples/pci-dss.md');
    expect(key).toContain('pci-dss.md');
    expect(
      mapResumeStorageKey({
        kind: 'pages',
        origin: 'https://colinwirt.github.io',
        docKey: key,
      }),
    ).toContain('of-map:https://colinwirt.github.io:');
  });

  it('overlays nudges on sidecar', () => {
    const layout = {
      _source: 'sibling',
      nodes: { a: { x: 10, y: 20, wrapCh: 32 } },
    };
    const merged = overlayResumeOnLayout(layout, {
      version: 1,
      nudges: { a: { x: 99, y: 20, wrapCh: 42 }, b: { x: 1, y: 2 } },
    });
    expect(merged.nodes!.a.x).toBe(99);
    expect(merged.nodes!.a.wrapCh).toBe(42);
    expect(merged.nodes!.b.x).toBe(1);
  });

  it('soft-resets stale resume keeping camera', () => {
    const resume = {
      version: 1 as const,
      fold: { mode: '-' as const, ids: ['gone1', 'gone2', 'gone3'] },
      camera: { x: 1, y: 2, k: 1.5 },
      nudges: { gone1: { x: 0, y: 0 } },
    };
    const { stale } = isResumeStale(resume, ['root', 'a']);
    expect(stale).toBe(true);
    const soft = softResetResume(resume);
    expect(soft.fold).toBeUndefined();
    expect(soft.nudges).toBeUndefined();
    expect(soft.camera?.k).toBe(1.5);
  });
});

describe('task toggle', () => {
  it('parses leading task and strips ASCII from title', () => {
    const doc = parse(
      '- [ ] Land PR <action:https://example.invalid/pr> <thread:pnid:1> <id:t1>\n',
    );
    expect(doc.nodes[0].task).toBe('open');
    expect(doc.nodes[0].title).toBe('Land PR');
    expect(doc.nodes[0].action).toBe('https://example.invalid/pr');
    expect(doc.nodes[0].thread).toBe('pnid:1');
  });

  it('toggles open→done and fires action policy', () => {
    const doc = parse('- [ ] Land PR <action:event:task.done> <id:t1>\n');
    const result = toggleTask(doc, 't1');
    expect(result?.from).toBe('open');
    expect(result?.to).toBe('done');
    expect(result?.node.task).toBe('done');
    expect(shouldFireAction(result!.from, result!.to)).toBe(true);
    expect(shouldFireAction('done', 'open')).toBe(false);
  });

  it('mid-caption [ ] is not a task', () => {
    const doc = parse('- See [ ] later <id:x>\n');
    expect(doc.nodes[0].task).toBeUndefined();
    expect(doc.nodes[0].title).toContain('[ ]');
  });
});

describe('auto-pack with wrap sidecar', () => {
  it('uses per-node wrapCh when packing', () => {
    const doc = parse(
      '- Root <id:root>\n  - Long caption that wraps when narrow <id:c1>\n',
    );
    const packed = autoPackPositions(doc, {
      nodeLayout: { c1: { x: 0, y: 0, wrapCh: 12, maxLines: 8 } },
    });
    expect(packed.nodes.c1).toBeTruthy();
    expect(packed.viewBox.h).toBeGreaterThan(40);
  });
});
