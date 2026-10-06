import { describe, expect, it } from 'vitest';
import {
  parse,
  pillSize,
  FOLD_SLOT,
  TASK_LEAD,
  PILL_PAD_X,
  noteChipSpan,
  DEFAULT_WRAP_CH,
  DEFAULT_MAX_LINES,
  SOFT_SAFETY_MAX_LINES,
  SOFT_SAFETY_MAX_CHARS,
  wrapLines,
  measurePill,
  measureLineageHeight,
  seedColdStartFold,
  overlayResumeOnLayout,
  isResumeStale,
  softResetResume,
  pagesDocKey,
  mapResumeStorageKey,
  toggleTask,
  nextTaskState,
  shouldFireAction,
  setExpandLevel,
  isCollapsed,
  autoPackPositions,
  toggleFold,
  mapNodeKeepsTextSelection,
  mapBackgroundPanSelection,
  clearSelectionForMapPan,
  mapPaintShouldRestoreFocus,
  mapKeyboardShouldHandle,
  mapNodeClassNames,
} from '../src/index.js';

describe('scrapbook wrap (~30 + more/less)', () => {
  it('defaults wrapCh 32 and product maxLines 30', () => {
    expect(DEFAULT_WRAP_CH).toBe(32);
    expect(DEFAULT_MAX_LINES).toBe(30);
    expect(SOFT_SAFETY_MAX_LINES).toBe(500);
    expect(SOFT_SAFETY_MAX_CHARS).toBe(50_000);
  });

  it('does not cut an http URL at the column width', () => {
    const url = 'https://example.com/some/very/long/path/that/exceeds/thirty/two/chars';
    const { lines } = wrapLines(`See ${url} please`, 32, 10);
    expect(lines.some((line) => line.includes(url))).toBe(true);
  });

  it('preserves newlines; clips at ~30 by default', () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const { lines, truncated } = wrapLines(text, 32, DEFAULT_MAX_LINES);
    expect(truncated).toBe(true);
    expect(lines).toHaveLength(30);
    expect(lines[29].endsWith('…')).toBe(true);
  });

  it('bodyExpanded measures full body up to soft safety', () => {
    const text = Array.from({ length: 80 }, (_, i) => `line ${i} of journal`).join(
      '\n',
    );
    const skim = measurePill(text, { wrapCh: 32 });
    expect(skim.showMore).toBe(true);
    expect(skim.showLess).toBe(false);
    expect(skim.lines.length).toBe(30);

    const expanded = measurePill(text, { wrapCh: 32, bodyExpanded: true });
    expect(expanded.bodyExpanded).toBe(true);
    expect(expanded.showMore).toBe(false);
    expect(expanded.showLess).toBe(true);
    expect(expanded.lines.length).toBe(80);
    expect(expanded.h).toBeGreaterThan(skim.h);
  });

  it('≥400 words: first ~30 lines on skim, rest via expand', () => {
    const words = Array.from({ length: 420 }, (_, i) => `w${i}`).join(' ');
    const skim = pillSize(words, { wrapCh: 32 });
    expect(skim.showMore).toBe(true);
    expect(skim.truncated).toBe(true);
    expect(skim.lines.length).toBe(DEFAULT_MAX_LINES);

    const full = pillSize(words, { wrapCh: 32, bodyExpanded: true });
    expect(full.showMore).toBe(false);
    expect(full.lines.join(' ')).toContain('w0');
    expect(full.lines.join(' ')).toContain('w419');
    expect(full.lines.length).toBeGreaterThan(30);
  });

  it('soft-safety clips pathological flood above product clip', () => {
    const text = Array.from(
      { length: SOFT_SAFETY_MAX_LINES + 80 },
      (_, i) => `x${i}`,
    ).join('\n');
    const { lines, truncated, softSafetyHit } = wrapLines(text, 32, null);
    expect(truncated).toBe(true);
    expect(softSafetyHit).toBe(true);
    expect(lines.length).toBe(SOFT_SAFETY_MAX_LINES);
  });

  it('grows height with lines; FOLD_SLOT + TASK_LEAD stable', () => {
    const multi = 'alpha beta gamma delta epsilon zeta eta theta iota';
    const size = pillSize(multi, { wrapCh: 16, reserveFold: true });
    expect(size.foldSlot).toBe(FOLD_SLOT);
    expect(size.w).toBe(size.textW + FOLD_SLOT);
    const withTask = pillSize('Do the thing', {
      reserveTask: true,
      reserveFold: true,
    });
    expect(withTask.taskLead).toBe(TASK_LEAD);
    expect(withTask.w).toBe(withTask.textW + FOLD_SLOT + TASK_LEAD);
    const plain = pillSize('can edit');
    const task = pillSize('can edit', { reserveTask: true });
    expect(task.textW).toBe(plain.textW - PILL_PAD_X);
    expect(task.w).toBe(plain.w + TASK_LEAD - PILL_PAD_X);
    const linked = pillSize('Seed swap list', { noteLinks: ['1001'] });
    const bare = pillSize('Seed swap list');
    const chip = noteChipSpan(['1001']);
    expect(linked.textW).toBe(bare.textW);
    expect(linked.w - bare.w).toBeGreaterThanOrEqual(chip - PILL_PAD_X);
    expect(linked.w - bare.w).toBeLessThanOrEqual(chip - PILL_PAD_X + 1);
  });

  it('honours sidecar wrapCh; bodyExpanded orthogonal to fold ids', () => {
    const body = Array.from({ length: 50 }, (_, i) => `row ${i}`).join('\n');
    const doc = parse(
      `- Root <id:root>\n  - ${body.replace(/\n/g, ' ')} <id:c1>\n    - kid <id:c1a>\n`,
    );
    // Use multi-line title via direct node mutation for pack measure
    doc.nodes[0].children![0].title = body;
    const packedSkim = autoPackPositions(doc, {
      nodeLayout: { c1: { x: 0, y: 0, wrapCh: 32 } },
      isNodeCollapsed: (id) => isCollapsed(doc, id),
    });
    const packedExp = autoPackPositions(doc, {
      nodeLayout: {
        c1: { x: 0, y: 0, wrapCh: 32, bodyExpanded: true },
      },
      isNodeCollapsed: (id) => isCollapsed(doc, id),
    });
    expect(packedExp.viewBox.h).toBeGreaterThan(packedSkim.viewBox.h);

    // Expanding body does not change fold state
    const folded = toggleFold(doc, 'c1');
    expect(isCollapsed(folded, 'c1')).toBe(true);
    expect(isCollapsed(doc, 'c1')).toBe(false);
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
    expect(measureLineageHeight(seeded)).toBeLessThanOrEqual(10);
    expect(measureLineageHeight(setExpandLevel(doc, '*'))).toBeGreaterThan(10);
  });
});

describe('resume helpers', () => {
  it('overlays bodyExpanded nudges', () => {
    const layout = {
      _source: 'sibling',
      nodes: { a: { x: 10, y: 20, wrapCh: 32 } },
    };
    const merged = overlayResumeOnLayout(layout, {
      version: 1,
      nudges: {
        a: { x: 99, y: 20, wrapCh: 42, bodyExpanded: true, maxLines: 30 },
      },
    });
    expect(merged.nodes!.a.x).toBe(99);
    expect(merged.nodes!.a.bodyExpanded).toBe(true);
    expect(merged.nodes!.a.wrapCh).toBe(42);
  });

  it('soft-resets stale resume keeping camera', () => {
    const resume = {
      version: 1 as const,
      fold: { mode: '-' as const, ids: ['gone1', 'gone2', 'gone3'] },
      camera: { x: 1, y: 2, k: 1.5 },
      nudges: { gone1: { x: 0, y: 0, bodyExpanded: true } },
    };
    expect(isResumeStale(resume, ['root', 'a']).stale).toBe(true);
    const soft = softResetResume(resume);
    expect(soft.fold).toBeUndefined();
    expect(soft.nudges).toBeUndefined();
    expect(soft.camera?.k).toBe(1.5);
  });

  it('pages keys', () => {
    expect(mapResumeStorageKey({ kind: 'pnid', pnid: 1 })).toBe('of-map:pnid:1');
    expect(pagesDocKey('/x/pci-dss.md')).toContain('pci-dss.md');
  });
});

describe('task toggle', () => {
  it('parses leading task; mid-caption [ ] ignored', () => {
    const doc = parse(
      '- [ ] Land PR <action:event:task.done> <thread:pnid:1> <id:t1>\n',
    );
    expect(doc.nodes[0].task).toBe('open');
    expect(doc.nodes[0].title).toBe('Land PR');
    expect(nextTaskState('open')).toBe('pending');
    expect(nextTaskState('pending')).toBe('done');
    expect(nextTaskState('done')).toBe('open');
    const r = toggleTask(doc, 't1');
    expect(r?.to).toBe('pending');
    expect(shouldFireAction(r!.from, r!.to)).toBe(false);
    const done = toggleTask(r!.doc, 't1');
    expect(done?.to).toBe('done');
    expect(shouldFireAction(done!.from, done!.to)).toBe(true);
    const mid = parse('- See [ ] later <id:x>\n');
    expect(mid.nodes[0].task).toBeUndefined();
  });
});

describe('mapNodeKeepsTextSelection (label copy)', () => {
  it('is false for null / collapsed selection', () => {
    const el = { contains: () => true } as unknown as Element;
    expect(mapNodeKeepsTextSelection(el, null)).toBe(false);
    expect(
      mapNodeKeepsTextSelection(el, {
        isCollapsed: true,
        anchorNode: {} as Node,
        focusNode: {} as Node,
      }),
    ).toBe(false);
  });

  it('is true when anchor or focus is inside the node', () => {
    const inside = { id: 'in' } as unknown as Node;
    const outside = { id: 'out' } as unknown as Node;
    const el = {
      contains: (n: Node) => n === inside,
    } as unknown as Element;
    expect(
      mapNodeKeepsTextSelection(el, {
        isCollapsed: false,
        anchorNode: inside,
        focusNode: outside,
      }),
    ).toBe(true);
    expect(
      mapNodeKeepsTextSelection(el, {
        isCollapsed: false,
        anchorNode: outside,
        focusNode: inside,
      }),
    ).toBe(true);
    expect(
      mapNodeKeepsTextSelection(el, {
        isCollapsed: false,
        anchorNode: outside,
        focusNode: outside,
      }),
    ).toBe(false);
  });
});

describe('mapBackgroundPanSelection', () => {
  it('leaves a label press alone so drag-select still works', () => {
    expect(
      mapBackgroundPanSelection({
        onLabel: true,
        onNode: true,
        clickDetail: 2,
        selectionOutside: true,
      }),
    ).toBe('ignore');
  });

  it('prevents a double-click on empty canvas from selecting text outside the map', () => {
    expect(
      mapBackgroundPanSelection({
        onLabel: false,
        onNode: false,
        clickDetail: 2,
        selectionOutside: false,
      }),
    ).toBe('prevent-and-clear');
  });

  it('prevents a normal canvas pan from drag-selecting map text', () => {
    expect(
      mapBackgroundPanSelection({
        onLabel: false,
        onNode: false,
        clickDetail: 1,
        selectionOutside: false,
      }),
    ).toBe('prevent-and-clear');
  });

  it('prevents a canvas pan from extending a selection that already sits outside the map', () => {
    expect(
      mapBackgroundPanSelection({
        onLabel: false,
        onNode: false,
        clickDetail: 1,
        selectionOutside: true,
      }),
    ).toBe('prevent-and-clear');
  });

  it('clears selection on a node click without swallowing the click', () => {
    expect(
      mapBackgroundPanSelection({
        onLabel: false,
        onNode: true,
        clickDetail: 1,
        selectionOutside: true,
      }),
    ).toBe('clear');
  });
});

describe('clearSelectionForMapPan (pan vs label copy)', () => {
  it('calls removeAllRanges when a selection is present', () => {
    let cleared = 0;
    clearSelectionForMapPan({
      removeAllRanges: () => {
        cleared += 1;
      },
    });
    expect(cleared).toBe(1);
  });

  it('is a no-op for null / undefined selection', () => {
    expect(() => clearSelectionForMapPan(null)).not.toThrow();
    expect(() => clearSelectionForMapPan(undefined)).not.toThrow();
  });

  it('swallows Selection API errors', () => {
    expect(() =>
      clearSelectionForMapPan({
        removeAllRanges: () => {
          throw new Error('boom');
        },
      }),
    ).not.toThrow();
  });
});

describe('mapPaintShouldRestoreFocus', () => {
  it('is true only when activeElement is inside the map host', () => {
    const inside = { id: 'node' } as unknown as Node;
    const outside = { id: 'textarea' } as unknown as Node;
    const host = {
      contains: (n: Node | null) => n === inside,
    };
    expect(mapPaintShouldRestoreFocus(host, inside)).toBe(true);
    expect(mapPaintShouldRestoreFocus(host, outside)).toBe(false);
    expect(mapPaintShouldRestoreFocus(host, null)).toBe(false);
  });
});

describe('mapKeyboardShouldHandle', () => {
  const inside = { id: 'node' } as unknown as Node;
  const outside = { id: 'editor' } as unknown as Node;
  const modeBtn = { id: 'map-btn' } as unknown as Node;
  const host = {
    contains: (n: Node | null) => n === inside,
  };

  it('rejects when inactive or typing in textarea/input', () => {
    expect(
      mapKeyboardShouldHandle({
        isActive: false,
        target: { tagName: 'DIV' },
        activeElement: inside,
        host,
      }),
    ).toBe(false);
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'TEXTAREA' },
        activeElement: outside,
        host,
      }),
    ).toBe(false);
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'INPUT' },
        activeElement: outside,
        host,
      }),
    ).toBe(false);
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'DIV', isContentEditable: true },
        activeElement: outside,
        host,
      }),
    ).toBe(false);
  });

  it('accepts focus inside map host or on mode button', () => {
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'DIV' },
        activeElement: inside,
        host,
      }),
    ).toBe(true);
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'BUTTON' },
        activeElement: modeBtn,
        host,
        modeButton: modeBtn,
      }),
    ).toBe(true);
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'DIV' },
        activeElement: outside,
        host,
      }),
    ).toBe(false);
  });

  it('does not treat document.body alone as in-map', () => {
    const body = { id: 'body' } as unknown as Node;
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'BODY' },
        activeElement: body,
        host,
      }),
    ).toBe(false);
  });
});

describe('map keyboard focus contract (0.2.13)', () => {
  it('still rejects TEXTAREA/INPUT; accepts host-contained focus', () => {
    const inside = { id: 'host-child' } as unknown as Node;
    const host = { contains: (n: Node | null) => n === inside };
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'TEXTAREA' },
        activeElement: inside,
        host,
      }),
    ).toBe(false);
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'DIV' },
        activeElement: inside,
        host,
      }),
    ).toBe(true);
  });

  it('paint restore still requires prior focus inside host (no editor steal)', () => {
    const inside = { id: 'pill' } as unknown as Node;
    const editor = { id: 'ta' } as unknown as Node;
    const host = { contains: (n: Node | null) => n === inside };
    expect(mapPaintShouldRestoreFocus(host, editor)).toBe(false);
    expect(mapPaintShouldRestoreFocus(host, inside)).toBe(true);
  });
});

describe('map selection chrome is-focused (0.2.15)', () => {
  it('adds is-focused when focused; keeps collapsed/cue/leaf flags', () => {
    expect(mapNodeClassNames({ foldable: true, focused: true })).toBe(
      'map-node is-focused',
    );
    expect(mapNodeClassNames({ foldable: false, focused: false })).toBe(
      'map-node leaf',
    );
    expect(
      mapNodeClassNames({
        foldable: true,
        collapsed: true,
        cue: true,
        focused: true,
      }),
    ).toBe('map-node collapsed cue is-focused');
    expect(mapNodeClassNames({ foldable: true, task: 'done' })).toContain(
      'task-done',
    );
    expect(mapNodeClassNames({ foldable: true, focused: false })).not.toContain(
      'is-focused',
    );
  });
});
