import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  currentWholeMapLevel,
  foldLevelPicker,
  levelConfirmLabel,
  levelContextAction,
  levelHoldAt,
  levelHoldCancel,
  levelHoldMoved,
  levelHoldRelease,
  levelHoldSlop,
  levelItemCount,
  levelItemLabel,
  levelKeepVisibleShift,
  levelMenuInitialIndex,
  levelMenuKeyAction,
  parse,
  placeLevelMenu,
  setExpandLevel,
  startLevelHold,
  toggleFold,
  wholeMapLevelDoc,
  LEVEL_HOLD_MS,
  LEVEL_MENU_INSET,
  LEVEL_RING_MS,
  WHOLE_MAP_LEVELS,
} from '../src/index.js';
import { isCollapsed } from '../src/fold.js';
import { shownBelow, levelPickNeedsConfirm } from '../src/foldLevelMenu.js';

// Fold-to-level menu: gesture, placement, keys (Design UX 2026-10-06). Fiction only.

const LOG = `- Harbour log <id:root>
  - Monday <id:mon>
    - Tide tables <id:tide>
      - High water <id:hw>
      - Low water <id:lw>
    - Lamp check <id:lamp>
  - Tuesday <id:tue>
    - Storm shutters <id:storm>
  - Notes <id:notes>
`;

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/mapView.ts'), 'utf8');

const hold = (pointerType = 'touch') =>
  startLevelHold({ pointerId: 1, pointerType, id: 'mon', x: 100, y: 100, t: 1000 });

describe('hold timing and slop (L4)', () => {
  it('rings at 150 ms and opens at 450 ms', () => {
    expect(LEVEL_RING_MS).toBe(150);
    expect(LEVEL_HOLD_MS).toBe(450);
    const h = hold();
    expect(levelHoldAt(h, 1149).phase).toBe('arming');
    expect(levelHoldAt(h, 1150).phase).toBe('ring');
    expect(levelHoldAt(h, 1449).phase).toBe('ring');
    expect(levelHoldAt(h, 1450).phase).toBe('open');
  });

  it('slop is 10 px on touch and pen, 4 px on mouse', () => {
    expect(levelHoldSlop('touch')).toBe(10);
    expect(levelHoldSlop('pen')).toBe(10);
    expect(levelHoldSlop('mouse')).toBe(4);
    expect(levelHoldMoved(hold('touch'), 110, 100).phase).toBe('arming');
    expect(levelHoldMoved(hold('touch'), 108, 108).phase).toBe('cancelled');
    expect(levelHoldMoved(hold('mouse'), 104, 100).phase).toBe('arming');
    expect(levelHoldMoved(hold('mouse'), 105, 100).phase).toBe('cancelled');
  });

  it('a cancelled hold never opens; a second pointer, pan or pinch cancels', () => {
    const c = levelHoldCancel(levelHoldAt(hold(), 1200));
    expect(c.phase).toBe('cancelled');
    expect(levelHoldAt(c, 2000).phase).toBe('cancelled');
    expect(levelHoldRelease(c)).toBe('none');
  });

  it('a short tap toggles; an opened hold uses up its release; movement after opening only slides', () => {
    expect(levelHoldRelease(hold())).toBe('toggle');
    expect(levelHoldRelease(levelHoldAt(hold(), 1200))).toBe('toggle');
    const open = levelHoldAt(hold(), 1500);
    expect(levelHoldRelease(open)).toBe('consume');
    expect(levelHoldMoved(open, 300, 300).phase).toBe('open');
    expect(levelHoldCancel(open).phase).toBe('open');
  });
});

describe('right-click opens it from the fold handle only (L9 amended, node menu M1)', () => {
  const at = (over: Partial<Parameters<typeof levelContextAction>[0]> = {}) =>
    levelContextAction({
      inMenu: false,
      onHandle: false,
      foldable: false,
      menuOpen: false,
      holding: false,
      pointerType: 'mouse',
      ...over,
    });

  it('a mouse right-click on a foldable handle opens it', () => {
    expect(at({ onHandle: true, foldable: true })).toBe('open');
    // Engines without pointerType on contextmenu count as a mouse.
    expect(at({ onHandle: true, foldable: true, pointerType: '' })).toBe('open');
  });

  it('a right-click elsewhere on the node, the label or the canvas is left to the host', () => {
    expect(at()).toBe('pass');
    expect(at({ pointerType: 'touch' })).toBe('pass');
    expect(at({ pointerType: 'pen' })).toBe('pass');
  });

  it('a right-click elsewhere closes an open menu and still goes to the host', () => {
    expect(at({ menuOpen: true })).toBe('close');
    expect(at({ menuOpen: true, holding: true })).toBe('close');
  });

  it('touch and pen long-press on a handle: the hold opens it, the platform menu is swallowed', () => {
    expect(at({ onHandle: true, foldable: true, pointerType: 'touch' })).toBe('own');
    expect(at({ onHandle: true, foldable: true, pointerType: 'pen' })).toBe('own');
    expect(at({ onHandle: true, foldable: true, holding: true })).toBe('own');
    expect(at({ onHandle: true, foldable: true, menuOpen: true, pointerType: 'touch' })).toBe('own');
  });

  it('inside the open menu the package keeps the event', () => {
    expect(at({ inMenu: true, menuOpen: true })).toBe('own');
  });

  it('inside the link or width popover or the map controls the event is left alone', () => {
    expect(at({ inOverlay: true })).toBe('pass');
    expect(at({ inOverlay: true, menuOpen: true })).toBe('pass');
  });

  it('a handle without a picker opens nothing and is left to the host', () => {
    expect(at({ onHandle: true, foldable: false })).toBe('pass');
  });
});

describe('placement (L6)', () => {
  const panel = { w: 400, h: 600 };
  const menu = { w: 260, h: 90 };

  it('opens above the handle, centred on it', () => {
    const p = placeLevelMenu({ anchor: { x: 184, y: 300, w: 32, h: 32 }, panel, menu });
    expect(p.below).toBe(false);
    expect(p.top + menu.h).toBeLessThanOrEqual(300);
    expect(p.left + menu.w / 2).toBe(200);
  });

  it('flips below near the top and stays 8 px inside the panel', () => {
    expect(LEVEL_MENU_INSET).toBe(8);
    const p = placeLevelMenu({ anchor: { x: 2, y: 20, w: 32, h: 32 }, panel, menu });
    expect(p.below).toBe(true);
    expect(p.top).toBeGreaterThanOrEqual(52);
    expect(p.left).toBe(8);
    const r = placeLevelMenu({ anchor: { x: 390, y: 580, w: 32, h: 32 }, panel, menu });
    expect(r.left + menu.w).toBe(panel.w - 8);
    expect(r.top + menu.h).toBeLessThanOrEqual(panel.h - 8);
  });
});

describe('menu keys (L9, L13)', () => {
  const items = [
    { hint: '0' },
    { hint: '1' },
    { hint: '2' },
    { hint: '3', disabled: true },
    { hint: '*' },
  ];

  it('arrows move between enabled items and wrap; Home / End', () => {
    expect(levelMenuKeyAction('ArrowDown', 2, items)).toEqual({ type: 'move', index: 4 });
    expect(levelMenuKeyAction('ArrowRight', 4, items)).toEqual({ type: 'move', index: 0 });
    expect(levelMenuKeyAction('ArrowUp', 0, items)).toEqual({ type: 'move', index: 4 });
    expect(levelMenuKeyAction('ArrowLeft', 4, items)).toEqual({ type: 'move', index: 2 });
    expect(levelMenuKeyAction('Home', 2, items)).toEqual({ type: 'move', index: 0 });
    expect(levelMenuKeyAction('End', 0, items)).toEqual({ type: 'move', index: 4 });
  });

  it('Enter / Space apply, Esc and Tab close, a key hint applies its item', () => {
    expect(levelMenuKeyAction('Enter', 1, items)).toEqual({ type: 'apply', index: 1 });
    expect(levelMenuKeyAction(' ', 2, items)).toEqual({ type: 'apply', index: 2 });
    expect(levelMenuKeyAction('Escape', 1, items)).toEqual({ type: 'close' });
    expect(levelMenuKeyAction('Tab', 1, items)).toEqual({ type: 'close' });
    expect(levelMenuKeyAction('*', 0, items)).toEqual({ type: 'apply', index: 4 });
    expect(levelMenuKeyAction('0', 2, items)).toEqual({ type: 'apply', index: 0 });
    expect(levelMenuKeyAction('3', 0, items)).toBeNull();
    expect(levelMenuKeyAction('x', 0, items)).toBeNull();
  });

  it('focus opens on the checked item, else the first enabled one', () => {
    expect(levelMenuInitialIndex([{ checked: false, disabled: false }, { checked: true, disabled: false }])).toBe(1);
    expect(levelMenuInitialIndex([{ checked: false, disabled: true }, { checked: false, disabled: false }])).toBe(1);
  });
});

describe('labels and counts (L3, Colin: labels only)', () => {
  it('rows read Fold, Level 1–3, All; touch tiles read Fold, 1–3, All', () => {
    expect([0, 1, 2, 3, '*'].map((k) => levelItemLabel(k as 0, true))).toEqual(['Fold', 'Level 1', 'Level 2', 'Level 3', 'All']);
    expect([0, 1, 2, 3, '*'].map((k) => levelItemLabel(k as 0, false))).toEqual(['Fold', '1', '2', '3', 'All']);
  });

  it('counts read "hides N" for Fold and "N shown" otherwise', () => {
    const p = foldLevelPicker(parse(LOG), 'root')!;
    expect(p.items.map(levelItemCount)).toEqual(['hides 8', '3 shown', '6 shown', '8 shown', '8 shown']);
    expect(levelConfirmLabel({ total: 1641 })).toBe('Show all 1,641');
  });

  it('All asks first only above 1,500 nodes (L14)', () => {
    const p = foldLevelPicker(parse(LOG), 'root')!;
    expect(levelPickNeedsConfirm(p, '*')).toBe(false);
    expect(levelPickNeedsConfirm({ ...p, total: 1501 }, '*')).toBe(true);
    expect(levelPickNeedsConfirm({ ...p, total: 1501 }, 3)).toBe(false);
  });
});

describe('applying a pick (L16) and whole-map levels (L8)', () => {
  it('after 1 on a node with a remembered 3-deep expansion, + on a child shows only its children', () => {
    const doc = setExpandLevel(parse(LOG), '*', { under: 'root' });
    const one = setExpandLevel(doc, 1, { under: 'root' });
    expect(isCollapsed(one, 'mon')).toBe(true);
    expect(isCollapsed(one, 'tide')).toBe(true);
    const plus = toggleFold(one, 'mon');
    // Tide tables and Lamp check; Tide tables stays folded.
    expect(shownBelow(plus, 'mon')).toBe(2);
  });

  it('shownBelow counts visible nodes under a node', () => {
    const doc = parse(LOG);
    expect(shownBelow(doc, 'root')).toBe(8);
    expect(shownBelow(setExpandLevel(doc, 1, { under: 'root' }), 'root')).toBe(3);
    expect(shownBelow(doc, 'missing')).toBe(0);
  });

  it('toolbar levels count from each root and mark the current one (All wins)', () => {
    expect(WHOLE_MAP_LEVELS).toEqual([1, 2, 3, '*']);
    const doc = parse(LOG);
    expect(currentWholeMapLevel(doc)).toBe('*');
    const one = wholeMapLevelDoc(doc, 1);
    expect(shownBelow(one, 'root')).toBe(3);
    expect(currentWholeMapLevel(one)).toBe(1);
    expect(currentWholeMapLevel(wholeMapLevelDoc(doc, 2))).toBe(2);
    expect(currentWholeMapLevel(toggleFold(one, 'mon'))).toBeNull();
    // Same as long-pressing the root handle and picking the level.
    expect(wholeMapLevelDoc(doc, 2).fold).toEqual(setExpandLevel(doc, 2, { under: 'root' }).fold);
  });
});

describe('camera keep-visible after an expand (L10)', () => {
  const viewport = { w: 800, h: 600 };
  const anchor = { x: 100, y: 280, w: 160, h: 40 };

  it('does nothing when the shown subtree is mostly on screen', () => {
    expect(levelKeepVisibleShift({ viewport, anchor, shown: { x: 300, y: 100, w: 300, h: 400 } })).toEqual({ dx: 0, dy: 0 });
    expect(levelKeepVisibleShift({ viewport, anchor, shown: null })).toEqual({ dx: 0, dy: 0 });
  });

  it('pans (never zooms) the subtree into view, but keeps the handle inside the padding', () => {
    const s = levelKeepVisibleShift({ viewport, anchor, shown: { x: 500, y: 250, w: 900, h: 100 } });
    expect(s.dy).toBe(0);
    expect(s.dx).toBeLessThan(0);
    // The anchor's left edge stays at or right of the 56 px padding.
    expect(anchor.x + s.dx).toBeGreaterThanOrEqual(56);
  });
});

describe('mapView wiring (source checks)', () => {
  it('a fired hold uses up its release: swallow armed, no toggle path', () => {
    const end = src.slice(src.indexOf('const endPointer = (e: PointerEvent): void => {'));
    const branch = end.slice(0, end.indexOf('if (widthDrag && e.pointerId === widthDrag.pointerId)'));
    expect(branch).toContain('levelMenu.dragPointer === e.pointerId');
    expect(branch).toContain('swallow = armSwallow(');
    expect(branch).toContain('return;');
    expect(branch).not.toContain('activateNodeHit');
  });

  it('pan, pinch, a second pointer and reset cancel the hold', () => {
    const recognise = src.slice(src.indexOf('function recognise('), src.indexOf('function clearTouchSelect('));
    expect(recognise).toContain('clearLevelHold()');
    const reset = src.slice(src.indexOf('function resetPointers('), src.indexOf('function schedule('));
    expect(reset).toContain('clearLevelHold()');
    expect(src).toMatch(/A second pointer cancels a fold-handle hold[\s\S]{0,60}clearLevelHold\(\)/);
  });

  it('label hold and width grip keep their own paths', () => {
    // The hold arms only on the fold handle, never on the label or the grip.
    expect(src).toContain("control?.matches('.map-fold-hit, .map-fold-indicator')");
    expect(src).toContain('labelTextHold = true;');
  });

  it('contextmenu: capture phase on the host, handle-only hit, the kept event never reaches the host', () => {
    const start = src.indexOf("host.addEventListener('contextmenu'");
    const body = src.slice(start, src.indexOf("window.addEventListener('blur'", start));
    expect(body).toContain('}, { capture: true, signal });');
    expect(body).toContain('levelContextAction(');
    // The hit is the fold handle; the node is only found through it.
    expect(body).toContain("t?.closest?.('.map-fold-hit, .map-fold-indicator')");
    expect(body).toContain("handle?.closest?.('.map-node')");
    expect(body).not.toContain("t?.closest?.('.map-node')");
    // Pass and close return before preventDefault, so the host still sees them.
    const pass = body.indexOf("if (act === 'pass') return;");
    const close = body.indexOf('closeMenus();');
    const pd = body.indexOf('e.preventDefault();');
    expect(pass).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(pass);
    expect(pd).toBeGreaterThan(close);
    expect(body).toContain('e.stopPropagation();');
    expect(body).toContain('e.stopImmediatePropagation();');
    expect(body.match(/openLevelMenu\(/g)?.length).toBe(1);
  });

  it('a host can open the picker for a node and close every package menu', () => {
    expect(src).toContain('openLevelMenu: (id?: string) => boolean;');
    expect(src).toContain('closeLevelMenu: () => closeLevelMenu(false),');
    expect(src).toContain('closeMenus: () => void;');
    const close = src.slice(src.indexOf('function closeMenus('), src.indexOf('function nodeEl('));
    expect(close).toContain('closeLevelMenu(false)');
    expect(close).toContain('dismissLinkPop(false)');
    expect(close).toContain('dismissWidthPopHook?.()');
    expect(src).toContain('dismissWidthPopHook = dismissWidthPop;');
  });

  it('one menu at a time: opening the picker closes the link and width popovers', () => {
    const open = src.slice(src.indexOf('function openLevelMenu('), src.indexOf('function pickLevelItem('));
    expect(open).toContain('dismissLinkPop(false)');
    expect(open).toContain('dismissWidthPopHook?.()');
    const cm = src.slice(src.indexOf("host.addEventListener('contextmenu'"));
    expect(cm.slice(0, cm.indexOf("window.addEventListener('blur'"))).toContain('menuOpen: packageMenuOpen(),');
  });

  it('ContextMenu and Shift+F10 are left to the host (L9 amended); treeitems say aria-haspopup', () => {
    expect(src).toContain("host.addEventListener('contextmenu'");
    // Left to the host unless it turned on the package node menu (0.2.39): no preventDefault otherwise.
    const keys = src.slice(src.indexOf("if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {"));
    expect(keys.slice(0, keys.indexOf('return;\n      }'))).toMatch(
      /if \(nodeMenuOn && focusId && openNodeMenu\(focusId, null, \{ fine: true \}\)\) \{\s+e\.preventDefault\(\);/,
    );
    const kb = src.slice(src.indexOf('function bindKeyboard('));
    expect(kb.slice(0, kb.indexOf('host.addEventListener(\'keydown\', onKey)'))).not.toMatch(/(?<!map\.)openLevelMenu\(/);
    expect(src).toContain('aria-haspopup="menu"');
  });

  it('a pick goes through setExpandLevel under the node and never mints ids', () => {
    const apply = src.slice(src.indexOf('function applyFoldLevel('), src.indexOf('function setWholeMapLevel('));
    expect(apply).toContain('setExpandLevel(doc, level, { under: id })');
    expect(apply).not.toContain('assignPersistentId');
    expect(apply.match(/setDoc\(/g)?.length).toBe(1);
  });

  it('the menu, ring and live region survive paint', () => {
    expect(src).toContain("'.map-width-pop, .of-map-controls, .map-level-menu, .map-level-ring, .map-live, .map-link-pop, .map-toast, .map-node-menu, .map-node-ring, .map-copied'");
  });
});
