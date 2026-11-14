// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parse, createMapView } from '../src/index.js';
import { serialize } from '../src/serialize.js';

async function paint(text: string) {
  const doc = parse(text);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let focus = 'a';
  let cur = doc;
  const mv: any = (createMapView as any)(host, {
    getDoc: () => cur,
    setDoc: (d: any) => { cur = d; },
    getLayout: () => layout,
    getFocusId: () => focus,
    setFocusId: (id: string) => { focus = id; },
    canPersistWidths: true,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  return { mv, doc: () => cur };
}

describe('Style menu Code writes font: code into the layout block', () => {
  it('lists Code on the node menu, checked only when this node is code', async () => {
    const { mv } = await paint('- Parent <font:code> <id:a>\n  - Child <id:b>\n');
    const parent = mv.nodeMenuEntries('a') as Array<{ key: string; label: string; checked?: boolean }>;
    const child = mv.nodeMenuEntries('b') as Array<{ key: string; checked?: boolean }>;
    expect(parent.find((e) => e.key === 'font-code')).toMatchObject({ label: 'Code', checked: true });
    expect(child.find((e) => e.key === 'font-code')?.checked).toBe(false);
    mv.destroy?.();
  });

  it('turning Code on writes font: code under the node id and drops the line tag', async () => {
    const { mv, doc } = await paint('- Parent <font:code> <id:a>\n  - Child\n');
    const key = mv.viewKey(doc().nodes[0]!.children![0]!) as string;
    mv.setNodeFont(key, 'code');
    const child = doc().nodes[0]!.children![0]!;
    expect(child.id).toMatch(/^[A-Za-z0-9]/);
    expect(child.font).toBe('code');
    const out = serialize(doc());
    expect(out).toContain('- Parent <font:code> <id:a>');
    expect(out).toContain(`${child.id}:\n  font: code`);
    expect(out).not.toContain(`<font:code> <id:${child.id}>`);
    expect(serialize(parse(out))).toBe(out);
    mv.destroy?.();
  });

  it('turning Code off writes font: auto so the node follows its parent', async () => {
    const { mv, doc } = await paint('- Parent <id:a>\n  - Child <id:b>\n\n--- layout ---\na:\n  font: code\nb:\n  font: code\n---\n');
    mv.setNodeFont('b', 'auto');
    const out = serialize(doc());
    expect(out).toContain('a:\n  font: code');
    expect(out).toContain('b:\n  font: auto');
    expect(doc().nodes[0]!.children![0]!.font).toBe('auto');
    const again = parse(out);
    expect(again.nodes[0]!.font).toBe('code');
    expect(again.nodes[0]!.children![0]!.font).toBe('auto');
    mv.setNodeFont('a', 'auto');
    expect(serialize(doc())).toContain('a:\n  font: auto');
    expect(serialize(doc())).toContain('b:\n  font: auto');
    mv.destroy?.();
  });

  it('undo puts the layout entry back', async () => {
    const { mv, doc } = await paint('- Item <id:a>\n');
    mv.setNodeFont('a', 'code');
    expect(serialize(doc())).toContain('a:\n  font: code');
    expect(mv.undoMapEdit()).toBe(true);
    expect(serialize(doc())).toBe('- Item <id:a>\n');
    expect(mv.redoMapEdit()).toBe(true);
    expect(serialize(doc())).toContain('a:\n  font: code');
    mv.destroy?.();
  });
});
