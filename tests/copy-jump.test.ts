import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COPY_JUMP_LABEL,
  COPY_LINK_LABEL,
  NO_LINK_REASON,
  READ_ONLY_REASON,
  copiedText,
  copyText,
  jumpTagFor,
  mintNodeId,
  nodeCopyItems,
  nodeFocusHref,
  nodeMenuKeyAction,
  parse,
  placeNodeMenu,
  previewPersistentId,
  resolveJumps,
  serialize,
  writtenId,
} from '../src/index.js';
import type { OutlineNode } from '../src/types.js';

// Node menu Copy jump / Copy link (0.2.39). Fiction only.

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(here, '../examples/e2e-touch/copy-jump.md'), 'utf8');
const mapSrc = readFileSync(join(here, '../src/mapView.ts'), 'utf8');
const menuSrc = readFileSync(join(here, '../src/nodeMenu.ts'), 'utf8');

function byTitle(nodes: OutlineNode[], start: string): OutlineNode {
  for (const n of nodes) {
    if (n.title.startsWith(start)) return n;
    if (n.children?.length) {
      const hit = byTitle(n.children, start);
      if (hit) return hit;
    }
  }
  return undefined as unknown as OutlineNode;
}

describe('jump tag', () => {
  it('is <r:id> with no spaces, as the package writes it', () => {
    expect(jumpTagFor('glaze')).toBe('<r:glaze>');
    expect(jumpTagFor('5')).toBe('<r:5>');
    expect(jumpTagFor('kiln_2-b')).toBe('<r:kiln_2-b>');
  });
  it('refuses ids the parser would not read', () => {
    expect(jumpTagFor('')).toBeNull();
    expect(jumpTagFor('-x')).toBeNull();
    expect(jumpTagFor('a b')).toBeNull();
    expect(jumpTagFor('a:b')).toBeNull();
  });
  it('pasted into another caption becomes a jump to that node', () => {
    const doc = parse(FIXTURE);
    const desk = byTitle(doc.nodes, 'Front desk');
    const pasted = parse(`- Ask about firing times ${jumpTagFor('glaze')}\n`);
    expect(resolveJumps(pasted.nodes[0]!)).toEqual(['glaze']);
    expect(desk.id).toBe('desk');
  });
});

describe('minting an id (mintNodeId)', () => {
  it('writes a short id on a line without one, through the same rules as widths', () => {
    const doc = parse(FIXTURE);
    const kiln = byTitle(doc.nodes, 'Kiln corner');
    expect(writtenId(kiln)).toBeNull();
    const preview = previewPersistentId(doc, kiln);
    const r = mintNodeId(doc, kiln, { canMint: true });
    expect(r).toEqual({ id: preview, minted: true });
    // The free 1-based position: no prefix, no spaces.
    expect(r.id).toBe('5');
    expect(r.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
    const out = serialize(doc);
    expect(out).toContain('  - Kiln corner <id:5>\n');
    // The copied jump resolves to the new id after a save and re-parse.
    const again = parse(out + `- Back to the kiln ${jumpTagFor(r.id!)}\n`);
    expect(resolveJumps(again.nodes[1]!)).toEqual(['5']);
    expect(byTitle(again.nodes, 'Kiln corner').id).toBe('5');
  });

  it('takes the next number when the position is taken', () => {
    const doc = parse('- Shelf <id:2>\n- Clay bin\n- Wheel\n');
    const bin = byTitle(doc.nodes, 'Clay bin');
    expect(mintNodeId(doc, bin, { canMint: true })).toEqual({ id: '3', minted: true });
    const wheel = byTitle(doc.nodes, 'Wheel');
    expect(mintNodeId(doc, wheel, { canMint: true })).toEqual({ id: '4', minted: true });
  });

  it('writes a session id as it is (parse with sessionIds)', () => {
    const doc = parse(FIXTURE, { sessionIds: true });
    const kiln = byTitle(doc.nodes, 'Kiln corner');
    const session = kiln.id!;
    expect(kiln.autoId).toBe(true);
    expect(writtenId(kiln)).toBeNull();
    expect(mintNodeId(doc, kiln, { canMint: true })).toEqual({ id: session, minted: true });
    expect(kiln.autoId).toBeUndefined();
    expect(serialize(doc)).toContain(`  - Kiln corner <id:${session}>\n`);
  });

  it('is a no-op when the line already has an id: same id, nothing written', () => {
    const doc = parse(FIXTURE);
    const before = serialize(doc);
    const glaze = byTitle(doc.nodes, 'Glaze table');
    expect(mintNodeId(doc, glaze, { canMint: true })).toEqual({ id: 'glaze', minted: false });
    expect(mintNodeId(doc, glaze, { canMint: false })).toEqual({ id: 'glaze', minted: false });
    expect(serialize(doc)).toBe(before);
  });

  it('never changes an existing id or its spelling', () => {
    const src = '- Wedging bench < id : bench >\n- Slip bucket <id: slip>\n';
    const doc = parse(src);
    const before = serialize(doc);
    for (const n of doc.nodes) expect(mintNodeId(doc, n, { canMint: true }).minted).toBe(false);
    expect(serialize(doc)).toBe(before);
    expect(doc.nodes.map((n) => n.id)).toEqual(['bench', 'slip']);
  });

  it('keeps user-typed tags, their spelling and their spaces', () => {
    const doc = parse(FIXTURE);
    const cones = byTitle(doc.nodes, 'Check the cones');
    const titleBefore = cones.title;
    const r = mintNodeId(doc, cones, { canMint: true });
    expect(r.minted).toBe(true);
    expect(cones.title).toBe(titleBefore);
    const out = serialize(doc);
    expect(out).toContain(`    - Check the cones  < r : glaze >  before firing <id:${r.id}>\n`);
    // Every other line is byte for byte as it was.
    const a = FIXTURE.split('\n');
    const b = out.split('\n');
    expect(b.length).toBe(a.length);
    a.forEach((line, i) => {
      if (!line.includes('Check the cones')) expect(b[i]).toBe(line);
    });
  });

  it('read-only: mints nothing and leaves the document alone', () => {
    const doc = parse(FIXTURE);
    const before = serialize(doc);
    const kiln = byTitle(doc.nodes, 'Kiln corner');
    expect(mintNodeId(doc, kiln, { canMint: false })).toEqual({ id: null, minted: false });
    expect(kiln.id).toBeUndefined();
    expect(serialize(doc)).toBe(before);
    // A session id that is not written yet counts as no id.
    const s = parse(FIXTURE, { sessionIds: true });
    const k2 = byTitle(s.nodes, 'Kiln corner');
    expect(mintNodeId(s, k2, { canMint: false })).toEqual({ id: null, minted: false });
    expect(k2.autoId).toBe(true);
  });
});

describe('Copy link URL (nodeFocusHref)', () => {
  const base = 'https://maps.example.org/view/pottery?doc=open-day.md#id:glaze';
  it('defaults to the current page with focus=<id>, other keys kept, hash dropped', () => {
    expect(nodeFocusHref('desk', { base })).toBe('https://maps.example.org/view/pottery?doc=open-day.md&focus=desk');
    expect(nodeFocusHref('desk', { base: 'https://maps.example.org/m?focus=old' })).toBe(
      'https://maps.example.org/m?focus=desk',
    );
  });
  it('hides itself when the page is not http(s) or there is none', () => {
    expect(nodeFocusHref('desk', { base: 'file:///home/x/map.html' })).toBeNull();
    expect(nodeFocusHref('desk', { base: 'about:blank' })).toBeNull();
    expect(nodeFocusHref('desk', { base: null })).toBeNull();
  });
  it('fills a {id} template; root-relative becomes absolute against the page', () => {
    expect(nodeFocusHref('desk', { base, nodeUri: '/maps/7/view?focus={id}' })).toBe(
      'https://maps.example.org/maps/7/view?focus=desk',
    );
    expect(nodeFocusHref('desk', { base: null, nodeUri: 'https://maps.example.org/m#node={id}' })).toBe(
      'https://maps.example.org/m#node=desk',
    );
    expect(nodeFocusHref('desk', { base: null, nodeUri: '/maps/7?focus={id}' })).toBeNull();
  });
  it('turns off for null, empty, none, a template without {id}, or an unsafe scheme', () => {
    for (const nodeUri of [null, '', 'none', 'NONE', '/maps/7', 'javascript:alert({id})', '//evil.example/{id}']) {
      expect(nodeFocusHref('desk', { base, nodeUri })).toBeNull();
    }
  });
  it('takes a callback, and hides when it returns nothing or throws', () => {
    expect(nodeFocusHref('desk', { base, nodeUri: ({ id }) => `/m/${id}` })).toBe('https://maps.example.org/m/desk');
    expect(nodeFocusHref('desk', { base, nodeUri: () => null })).toBeNull();
    expect(nodeFocusHref('desk', { base, nodeUri: () => 'data:text/html,x' })).toBeNull();
    expect(
      nodeFocusHref('desk', {
        base,
        nodeUri: () => {
          throw new Error('no');
        },
      }),
    ).toBeNull();
  });
});

describe('which items show (nodeCopyItems, M11)', () => {
  const href = (id: string) => `https://maps.example.org/m?focus=${id}`;
  it('a line with an id shows both, with the text known', () => {
    const items = nodeCopyItems({ id: 'desk', canMint: false, href });
    expect(items.map((i) => [i.label, i.hidden, i.text])).toEqual([
      [COPY_JUMP_LABEL, false, '<r:desk>'],
      [COPY_LINK_LABEL, false, 'https://maps.example.org/m?focus=desk'],
    ]);
  });
  it('a line without an id shows both when the host can edit', () => {
    const items = nodeCopyItems({ id: null, canMint: true, previewId: '5', href });
    expect(items.map((i) => i.hidden)).toEqual([false, false]);
    expect(items.every((i) => i.text === undefined)).toBe(true);
  });
  it('read-only and no id: both hidden, with the reason', () => {
    const items = nodeCopyItems({ id: null, canMint: false, previewId: '5', href });
    expect(items.map((i) => [i.hidden, i.reason])).toEqual([
      [true, READ_ONLY_REASON],
      [true, READ_ONLY_REASON],
    ]);
  });
  it('no safe URL: Copy link hidden, Copy jump stays', () => {
    const items = nodeCopyItems({ id: 'desk', canMint: true, href: () => null });
    expect(items.map((i) => [i.kind, i.hidden, i.reason])).toEqual([
      ['jump', false, undefined],
      ['link', true, NO_LINK_REASON],
    ]);
  });
  it('labels only: no icons and no new-window arrow', () => {
    for (const it of nodeCopyItems({ id: 'desk', canMint: true, href })) expect(it.label).toMatch(/^Copy (jump|link)$/);
  });
});

describe('copy with fallback (copyText)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  function fakeDocument(execResult: boolean) {
    const calls: string[] = [];
    const ta = {
      value: '',
      style: {} as Record<string, string>,
      tabIndex: 0,
      setAttribute() {},
      select() {},
      setSelectionRange() {},
      remove() {
        calls.push('remove');
      },
    };
    const doc = {
      body: { appendChild: () => calls.push('append') },
      activeElement: null,
      createElement: () => ta,
      execCommand: (cmd: string) => {
        calls.push(`exec:${cmd}:${ta.value}`);
        return execResult;
      },
    };
    return { doc, calls };
  }
  it('uses navigator.clipboard.writeText when it works', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('<r:desk>')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('<r:desk>');
  });
  it('falls back to execCommand copy when the Clipboard API refuses', async () => {
    const { doc, calls } = fakeDocument(true);
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    vi.stubGlobal('document', doc);
    expect(await copyText('<r:glaze>')).toBe(true);
    expect(calls).toEqual(['append', 'exec:copy:<r:glaze>', 'remove']);
  });
  it('falls back when there is no Clipboard API, and reports a failure', async () => {
    const { doc } = fakeDocument(false);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', doc);
    expect(await copyText('x')).toBe(false);
  });
  it('confirmation text starts with Copied', () => {
    expect(copiedText('jump', true)).toBe('Copied jump');
    expect(copiedText('link', true)).toBe('Copied link');
    expect(copiedText('link', false)).toBe("Couldn't copy");
  });
});

describe('menu keys and placement (M8, M7)', () => {
  const items = [
    { label: 'Levels…', popup: true },
    { label: 'Copy jump' },
    { label: 'Copy link' },
  ];
  it('arrows wrap, Home / End jump, Esc returns focus, Tab closes', () => {
    expect(nodeMenuKeyAction('ArrowDown', 2, items)).toEqual({ type: 'move', index: 0 });
    expect(nodeMenuKeyAction('ArrowUp', 0, items)).toEqual({ type: 'move', index: 2 });
    expect(nodeMenuKeyAction('Home', 1, items)).toEqual({ type: 'move', index: 0 });
    expect(nodeMenuKeyAction('End', 0, items)).toEqual({ type: 'move', index: 2 });
    expect(nodeMenuKeyAction('Escape', 1, items)).toEqual({ type: 'close', returnFocus: true });
    expect(nodeMenuKeyAction('Tab', 1, items)).toEqual({ type: 'close', returnFocus: false });
  });
  it('type-ahead cycles items with the same first letter; → opens Levels…', () => {
    expect(nodeMenuKeyAction('c', 0, items)).toEqual({ type: 'move', index: 1 });
    expect(nodeMenuKeyAction('c', 1, items)).toEqual({ type: 'move', index: 2 });
    expect(nodeMenuKeyAction('C', 2, items)).toEqual({ type: 'move', index: 1 });
    expect(nodeMenuKeyAction('l', 2, items)).toEqual({ type: 'move', index: 0 });
    expect(nodeMenuKeyAction('ArrowRight', 0, items)).toEqual({ type: 'activate', index: 0 });
    expect(nodeMenuKeyAction('ArrowRight', 1, items)).toBeNull();
    expect(nodeMenuKeyAction('Enter', 1, items)).toEqual({ type: 'activate', index: 1 });
  });
  it('opens at the press point and stays 8 px inside the map', () => {
    expect(placeNodeMenu({ at: { x: 100, y: 100 }, panel: { w: 800, h: 600 }, menu: { w: 180, h: 120 } })).toEqual({
      left: 100,
      top: 100,
    });
    expect(placeNodeMenu({ at: { x: 790, y: 590 }, panel: { w: 800, h: 600 }, menu: { w: 180, h: 120 } })).toEqual({
      left: 610,
      top: 470,
    });
    expect(placeNodeMenu({ at: { x: 2, y: 2 }, panel: { w: 150, h: 100 }, menu: { w: 180, h: 120 } })).toEqual({
      left: 8,
      top: 8,
    });
  });
});

describe('map wiring (source)', () => {
  it('a mint goes through setDoc + onChange (the host marks the document dirty)', () => {
    const fn = mapSrc.slice(mapSrc.indexOf('function ensureNodeId('), mapSrc.indexOf('function dismissCopied('));
    expect(fn).toContain('mintNodeId(doc, node, { canMint: idsMintable() })');
    expect(fn).toContain('setDoc(doc);');
    expect(fn).toContain('onChange?.();');
    expect(fn.indexOf('if (!id || !minted) return')).toBeLessThan(fn.indexOf('setDoc(doc);'));
  });
  it('read-only follows canMintIds, else canPersistWidths', () => {
    const fn = mapSrc.slice(mapSrc.indexOf('function idsMintable('), mapSrc.indexOf('function focusHref('));
    expect(fn).toContain('canMintIdsOpt');
    expect(fn).toContain('return widthsPersist();');
  });
  it('the confirmation is a polite live region', () => {
    const fn = mapSrc.slice(mapSrc.indexOf('function showCopied('), mapSrc.indexOf('function copyNode('));
    expect(fn).toContain("setAttribute('role', 'status')");
    expect(fn).toContain("setAttribute('aria-live', 'polite')");
  });
  it('the package node menu is opt-in and opens from the pill, the hold and the keys', () => {
    expect(mapSrc).toContain('nodeMenu: nodeMenuOn = false');
    expect(mapSrc).toContain('beginNodeHold(e, nodeEl.getAttribute');
    expect(mapSrc).toMatch(/nodeMenuOn && focusId && openNodeMenu\(focusId/);
  });
  it('the menu is a WAI-ARIA menu with labelled groups and no new-window marks', () => {
    expect(menuSrc).toContain("el.setAttribute('role', 'menu')");
    expect(menuSrc).toContain("group.setAttribute('aria-labelledby', labelId)");
    expect(menuSrc).toContain("sep.setAttribute('role', 'separator')");
    expect(menuSrc).toContain("b.setAttribute('role', 'menuitem')");
    const view = menuSrc.slice(menuSrc.indexOf('export function renderNodeMenu'));
    expect(view).not.toContain('↗');
    expect(view).not.toContain('target');
  });
});
