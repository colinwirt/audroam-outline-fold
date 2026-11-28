// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMapView, isCollapsed, parse, serialize, setExpandLevel, setTask } from '../src/index.js';
import type { OutlineFoldDoc, OutlineNode } from '../src/types.js';

/**
 * Fold lives only on the parsed node. `writtenId` is the `<id:>` on the line,
 * or null. `sessionKey` is runtime only. These names are the fields under test;
 * the current tree still uses one `id` string and a fold list, so this file fails.
 */
type ParsedNode = OutlineNode & {
  collapsed?: boolean;
  writtenId: string | null;
  sessionKey: string;
};

const NOTE = [
  '- Week',
  '  - Tuesday (+)',
  '    - lamp oil',
  '  - Wednesday',
  '    - market',
  '- Lamp room <id:4> (+)',
  '  - brass',
  '- [ ] Leaf task',
  '- Q1 <id:5>',
  '  - note',
  '',
].join('\n');

function walk(nodes: OutlineNode[] | undefined, out: ParsedNode[] = []): ParsedNode[] {
  for (const n of nodes ?? []) {
    out.push(n as ParsedNode);
    walk(n.children, out);
  }
  return out;
}

function byTitle(doc: OutlineFoldDoc, title: string): ParsedNode {
  const hit = walk(doc.nodes).find((n) => n.title === title);
  if (!hit) throw new Error(`missing ${title}`);
  return hit;
}

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...srcFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('parsed fold', () => {
  it('folds an id-less (+) line and keeps the written id off the session key', () => {
    const doc = parse(NOTE);
    const tue = byTitle(doc, 'Tuesday');
    const room = byTitle(doc, 'Lamp room');
    expect(tue.collapsed).toBe(true);
    expect(tue.writtenId).toBeNull();
    expect(tue.sessionKey).toEqual(expect.any(String));
    expect(tue.sessionKey).not.toBe(tue.writtenId);
    expect(isCollapsed(doc, tue.sessionKey)).toBe(true);
    expect(room.collapsed).toBe(true);
    expect(room.writtenId).toBe('4');
    expect(room.sessionKey).not.toBe('4');
    expect(isCollapsed(doc, room.sessionKey)).toBe(true);
    expect(isCollapsed(doc, '4')).toBe(false);
    expect(serialize(doc)).toContain('Tuesday (+)');
    expect(serialize(doc)).toContain('<id:4> (+)');
    expect(serialize(doc)).not.toContain(tue.sessionKey);
    expect(serialize(doc)).not.toContain(room.sessionKey);
  });

  it('keeps those folds across re-parse, a tick, and save then reload', () => {
    const doc = parse(NOTE);
    const room = byTitle(doc, 'Lamp room');
    const ticked = setTask(doc, byTitle(doc, 'Leaf task').sessionKey, 'done');
    expect(ticked).not.toBeNull();
    const saved = serialize(ticked!.doc);
    const again = parse(saved);
    expect(byTitle(again, 'Tuesday').collapsed).toBe(true);
    expect(byTitle(again, 'Lamp room').collapsed).toBe(true);
    expect(byTitle(again, 'Lamp room').writtenId).toBe('4');
    expect(byTitle(again, 'Q1').writtenId).toBe('5');
    expect(byTitle(again, 'Q1').collapsed).toBe(false);
    expect(saved).toContain('Tuesday (+)');
    expect(saved).toContain(`<id:${room.writtenId}> (+)`);
    expect(saved).toContain('[x] Leaf task');
    expect(again.fold).toBeUndefined();
    expect(again.frontmatter?.foldIds).toBeUndefined();
    expect(again.frontmatter?.foldMode).toBeUndefined();
  });

  it('does not fold a leaf', () => {
    const doc = parse('- Solo (+)\n- Parent (+)\n  - child\n');
    expect(byTitle(doc, 'Solo').collapsed).toBe(false);
    expect(byTitle(doc, 'Parent').collapsed).toBe(true);
    const out = serialize(doc);
    expect(out).not.toMatch(/Solo.*\(\+\)/);
    expect(out).toContain('Parent (+)');
  });

  it('folds every node at one depth the same way', () => {
    const doc = setExpandLevel(parse(NOTE), 2);
    const foldable = walk(doc.nodes).filter((n) => n.children?.length);
    const byDepth = new Map<number, boolean[]>();
    for (const n of foldable) {
      expect(typeof n.collapsed, n.title).toBe('boolean');
      const list = byDepth.get(n.depth) ?? [];
      list.push(n.collapsed === true);
      byDepth.set(n.depth, list);
    }
    for (const [depth, flags] of byDepth) {
      expect(new Set(flags), `depth ${depth}`).toEqual(new Set([flags[0]]));
    }
    expect(byTitle(doc, 'Week').collapsed).toBe(false);
    expect(byTitle(doc, 'Tuesday').collapsed).toBe(true);
    expect(byTitle(doc, 'Wednesday').collapsed).toBe(true);
    expect(byTitle(doc, 'Lamp room').collapsed).toBe(false);
    expect(byTitle(doc, 'Q1').collapsed).toBe(false);
    expect(byTitle(doc, 'lamp oil').collapsed).not.toBe(true);
    expect(byTitle(doc, 'Leaf task').collapsed).not.toBe(true);
  });

  it('zooms on a double-click', async () => {
    document.body.innerHTML = '';
    let doc = parse(NOTE, { sessionIds: true });
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 900 });
    Object.defineProperty(host, 'clientHeight', { value: 600 });
    host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, x: 0, y: 0, toJSON() { return {}; } }) as DOMRect;
    document.body.appendChild(host);
    const layout = { version: 1, nodes: {} as Record<string, unknown>, _source: 'auto-pack' };
    let focus = '';
    const mv = createMapView(host, {
      getDoc: () => doc,
      setDoc: (d) => { doc = d; },
      getLayout: () => layout as never,
      getFocusId: () => focus,
      setFocusId: (id) => { focus = id; },
      gestures: { labelTextSelect: () => false },
    });
    mv.paint();
    mv.bindGestures();
    const before = mv.cam.k;
    const fire = (type: string, x: number, y: number) =>
      host.dispatchEvent(new PointerEvent(type, {
        bubbles: true, clientX: x, clientY: y, button: 0,
        buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse',
      }));
    fire('pointerdown', 30, 30);
    fire('pointermove', 38, 30);
    await new Promise((r) => requestAnimationFrame(() => r(0)));
    fire('pointerup', 38, 30);
    await new Promise((r) => setTimeout(r, 30));
    fire('pointerdown', 32, 31);
    fire('pointermove', 40, 31);
    await new Promise((r) => requestAnimationFrame(() => r(0)));
    fire('pointerup', 40, 31);
    expect(mv.cam.k).toBeGreaterThan(before);
  });

  it('keeps fold state off every store except the node', () => {
    const banned = /\bfoldIds\b|\bfoldMode\b|\.fold\b|isSessionId\s*\(/;
    const hits: string[] = [];
    for (const path of srcFiles(join(__dirname, '../src'))) {
      const text = readFileSync(path, 'utf8');
      if (banned.test(text)) hits.push(path.replace(/\\/g, '/').split('/src/')[1] ?? path);
    }
    expect(hits).toEqual([]);
  });
});
