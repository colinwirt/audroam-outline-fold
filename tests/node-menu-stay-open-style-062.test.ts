// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, createMapView } from '../src/index.js';

/**
 * t2498u / t2499u (Colin): style picks keep the package node menu open for preview;
 * each colour/fill/cloud/icon apply is one undo step; existing Ctrl/⌘+Z and
 * Shift+Ctrl/⌘+Z redo binding replays them in order (also after several colours
 * while the menu stayed open). Escape / outside click still dismiss. Non-style
 * actions still close the menu.
 */

async function mount(text = '- Colour me <id:c>\n  - Child <id:k>\n') {
  const parsed = parse(text);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1000 });
  Object.defineProperty(host, 'clientHeight', { value: 800 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let focus = 'c';
  let cur = parsed;
  const mv: any = createMapView(host, {
    getDoc: () => cur,
    setDoc: (d: any) => { cur = d; },
    getLayout: () => layout,
    getFocusId: () => focus,
    setFocusId: (id: string) => { focus = id; },
    nodeMenu: true,
    nodeColours: true,
    nodeIcons: true,
    nodeClouds: true,
    canPersistWidths: true,
    onChange: () => { try { mv.paint(); } catch { /* */ } },
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 20));
  return { host, mv, doc: () => cur };
}

function menuItems(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll('.map-node-menu button')] as HTMLElement[];
}

function tap(el: HTMLElement) {
  // bindTap activates mouse targets on click (not pointerup).
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

function fireUndo(host: HTMLElement, shift = false) {
  host.focus();
  host.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: shift ? 'Z' : 'z',
      code: 'KeyZ',
      ctrlKey: true,
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

afterEach(() => {
  // Drop open menus so document capture listeners abort (avoid Escape pollution).
  document.querySelectorAll('.map-node-menu').forEach((el) => el.remove());
  document.body.replaceChildren();
});

describe('t2498u stay-open style menu', () => {
  it('source: style picks stay open; Escape/outside still close; non-style closes', () => {
    const src = readFileSync(join(__dirname, '../src/mapView.ts'), 'utf8');
    const fn = src.slice(src.indexOf('function pickNodeMenuItem'), src.indexOf('function zoneNode'));
    // Style keys must not close (or close with false / stay-open helper).
    expect(fn).toMatch(/styleStayOpen|stayOpenStyle|isStyleMenuPick|STYLE_MENU_STAY/);
    expect(fn).toMatch(/colour-fill|cloud|icon-remove|swatch/);
    // Still closes for icon picker / copy / levels etc.
    expect(fn).toMatch(/closeNodeMenu/);
  });

  it('clicking a colour swatch applies colour and leaves .map-node-menu mounted', async () => {
    const { host, mv, doc } = await mount();
    expect(mv.openNodeMenu('c', { clientX: 40, clientY: 40 }, { pointerType: 'mouse' })).toBe(true);
    const entries = mv.nodeMenuEntries('c') as Array<{ key: string }>;
    const mossIdx = entries.findIndex((e) => e.key === 'color:moss');
    expect(mossIdx).toBeGreaterThanOrEqual(0);
    tap(menuItems(host)[mossIdx]!);
    await new Promise((r) => setTimeout(r, 40));
    expect(doc().nodes[0]!.color).toBe('moss');
    expect(host.querySelector('.map-node-menu')).toBeTruthy();
    // Checked state refreshed for moss
    const after = mv.nodeMenuEntries('c') as Array<{ key: string; checked?: boolean }>;
    expect(after.find((e) => e.key === 'color:moss')?.checked).toBe(true);
  });

  it('Fill and Cloud toggles keep the menu open', async () => {
    const { host, mv, doc } = await mount();
    mv.openNodeMenu('c', { clientX: 40, clientY: 40 }, { pointerType: 'mouse' });
    const entries = () => mv.nodeMenuEntries('c') as Array<{ key: string }>;
    const fillIdx = entries().findIndex((e) => e.key === 'colour-fill');
    tap(menuItems(host)[fillIdx]!);
    await new Promise((r) => setTimeout(r, 40));
    expect(host.querySelector('.map-node-menu')).toBeTruthy();
    expect(doc().nodes[0]!.colorFill || doc().nodes[0]!.color).toBeTruthy();

    const cloudIdx = entries().findIndex((e) => e.key === 'cloud');
    tap(menuItems(host)[cloudIdx]!);
    await new Promise((r) => setTimeout(r, 40));
    expect(doc().nodes[0]!.cloud).toBeTruthy();
    expect(host.querySelector('.map-node-menu')).toBeTruthy();
  });

  it('Copy (non-style) closes the menu', async () => {
    const { host, mv } = await mount();
    mv.openNodeMenu('c', { clientX: 40, clientY: 40 }, { pointerType: 'mouse' });
    const entries = mv.nodeMenuEntries('c') as Array<{ key: string }>;
    const copyIdx = entries.findIndex((e) => e.key === 'copy-link' || e.key === 'copy' || e.key.startsWith('copy'));
    expect(copyIdx).toBeGreaterThanOrEqual(0);
    // Avoid clipboard failures: spy by checking close after activate path via source + direct close contract
    // Behavioral: fire the button; menu should go away even if copy rejects.
    tap(menuItems(host)[copyIdx]!);
    await new Promise((r) => setTimeout(r, 40));
    expect(host.querySelector('.map-node-menu')).toBeNull();
  });

  it('Escape dismisses an open menu', async () => {
    const { host, mv } = await mount();
    mv.openNodeMenu('c', { clientX: 40, clientY: 40 }, { pointerType: 'mouse' });
    expect(host.querySelector('.map-node-menu')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(host.querySelector('.map-node-menu')).toBeNull();
  });
});

describe('t2499u style undo/redo on existing Ctrl/⌘+Z binding', () => {
  it('source: keybinding undoes/redoes map edits (width or style), not width-only', () => {
    const src = readFileSync(join(__dirname, '../src/mapView.ts'), 'utf8');
    // Must call a unified undo/redo (name flexible) from the Ctrl/⌘+Z handler.
    expect(src).toMatch(/e\.shiftKey\s*\?\s*redo(MapEdit|Edit|Width)\(\)\s*:\s*undo(MapEdit|Edit|Width)\(\)/);
    // Style setters must push undo steps.
    expect(src).toMatch(/commitStyleStep|pushStyleStep|styleUndoStack|type:\s*'style'/);
  });

  it('several colour applies undo and redo in order', async () => {
    const { mv, doc, host } = await mount();
    mv.setNodeColour('c', 'moss');
    mv.setNodeColour('c', 'ember');
    mv.setNodeColour('c', 'creek');
    expect(doc().nodes[0]!.color).toBe('creek');

    expect(mv.undoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.color).toBe('ember');
    expect(mv.undoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.color).toBe('moss');
    expect(mv.undoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.color).toBeUndefined();

    expect(mv.redoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.color).toBe('moss');
    expect(mv.redoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.color).toBe('ember');
    expect(mv.redoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.color).toBe('creek');
  });

  it('fill, cloud and icon are undoable steps too', async () => {
    const { mv, doc } = await mount();
    mv.setNodeColour('c', 'moss');
    mv.setNodeColourFill('c', true);
    mv.setNodeCloud('c', 'default');
    mv.setNodeIcon('c', ':star:');
    expect(doc().nodes[0]!.icon).toBe(':star:');
    expect(doc().nodes[0]!.cloud).toBeTruthy();
    expect(doc().nodes[0]!.colorFill).toBe(true);

    expect(mv.undoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.icon).toBeUndefined();
    expect(mv.undoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.cloud).toBeUndefined();
    expect(mv.undoMapEdit()).toBe(true);
    expect(!!doc().nodes[0]!.colorFill).toBe(false);
    expect(mv.redoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.colorFill).toBe(true);
  });

  it('interleaved width + style undo in chronological order; redo restores both', async () => {
    const { mv, doc } = await mount('- Long enough caption for a one-line width pick here <id:c>\n');
    mv.setNodeColour('c', 'moss');
    const wStep = mv.applyWidthPick('c', 'line');
    expect(wStep).toBeTruthy();
    const w = doc().nodes[0]!.layout?.w;
    expect(w).toBeGreaterThan(0);
    mv.setNodeColour('c', 'ember');

    // Undo colour ember → moss
    expect(mv.undoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.color).toBe('moss');
    // Undo width
    expect(mv.undoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.layout?.w ?? null).not.toBe(w);
    // Undo colour moss
    expect(mv.undoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.color).toBeUndefined();

    // Redo all three
    expect(mv.redoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.color).toBe('moss');
    expect(mv.redoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.layout?.w).toBe(w);
    expect(mv.redoMapEdit()).toBe(true);
    expect(doc().nodes[0]!.color).toBe('ember');
  });

  it('Ctrl+Z / Shift+Ctrl+Z while the node menu is focused still undo/redo style steps', async () => {
    const { mv, doc, host } = await mount();
    mv.setNodeColour('c', 'moss');
    mv.setNodeColour('c', 'ember');
    mv.openNodeMenu('c', { clientX: 40, clientY: 40 }, { pointerType: 'mouse' });
    const menu = host.querySelector('.map-node-menu') as HTMLElement;
    expect(menu).toBeTruthy();
    // Focus a swatch so the early-return / stopPropagation paths are exercised.
    menuItems(host)[0]?.focus();
    fireUndo(host, false);
    // Also fire on the menu itself (stopPropagation used to swallow this).
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(doc().nodes[0]!.color).toBe('moss');
    fireUndo(host, true);
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(doc().nodes[0]!.color).toBe('ember');
    // Menu can stay open across undo/redo of styles
    expect(host.querySelector('.map-node-menu')).toBeTruthy();
  });

  it('undoWidth still undoes a width step (toast / API); redoWidth redoes it', async () => {
    const { mv, doc } = await mount('- Long enough caption for a one-line width pick here <id:c>\n');
    mv.applyWidthPick('c', 'line');
    const w = doc().nodes[0]!.layout?.w;
    expect(mv.undoWidth()).toBe(true);
    expect(doc().nodes[0]!.layout?.w ?? null).not.toBe(w);
    expect(mv.redoWidth()).toBe(true);
    expect(doc().nodes[0]!.layout?.w).toBe(w);
  });
});
