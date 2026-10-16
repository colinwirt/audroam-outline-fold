import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALT_HOLD_MS,
  altArbiterAllowsDrag,
  altArbiterCancel,
  altArbiterMove,
  altArbiterRelease,
  altArbiterStart,
  altArbiterTick,
  altHoldSlop,
  altHoldsOpenMenu,
  altPressKind,
  LEVEL_HOLD_MS,
  levelHoldSlop,
} from '../src/index.js';
import { slopPx } from '../src/mapGesture.js';
import { altDragCommits } from '../src/altGesture.js';

const start = (pointerType: string, holdable = true) =>
  altArbiterStart({ pointerType, x: 100, y: 100, t: 1000, holdable });

describe('alt gesture arbiter (0.2.44)', () => {
  it('one hold time and one slop for every handler', () => {
    expect(ALT_HOLD_MS).toBe(500);
    expect(LEVEL_HOLD_MS).toBe(ALT_HOLD_MS);
    for (const t of ['touch', 'pen', 'mouse']) {
      expect(slopPx(t)).toBe(altHoldSlop(t));
      expect(levelHoldSlop(t)).toBe(altHoldSlop(t));
    }
    expect(altHoldSlop('touch')).toBe(10);
    expect(altHoldSlop('pen')).toBe(8);
    expect(altHoldSlop('mouse')).toBe(4);
  });

  it('right button and pen barrel are alt presses; primary is primary', () => {
    expect(altPressKind({ button: 2, pointerType: 'mouse' })).toBe('alt');
    expect(altPressKind({ button: 0, buttons: 2, pointerType: 'pen' })).toBe('alt');
    expect(altPressKind({ button: 0, buttons: 1, pointerType: 'mouse' })).toBe('primary');
    expect(altPressKind({ button: 0, pointerType: 'touch' })).toBe('primary');
    expect(altPressKind({ button: 1, pointerType: 'mouse' })).toBe('other');
  });

  it('only touch and pen hold for menus; mouse uses right-click', () => {
    expect(altHoldsOpenMenu('touch')).toBe(true);
    expect(altHoldsOpenMenu('pen')).toBe(true);
    expect(altHoldsOpenMenu('mouse')).toBe(false);
    expect(altArbiterTick(start('mouse'), 5000).phase).toBe('pending');
  });

  it('a still long press becomes the menu and never a drag', () => {
    let a = start('touch');
    a = altArbiterMove(a, 106, 104); // inside 10 px
    a = altArbiterTick(a, 1499);
    expect(a.phase).toBe('pending');
    a = altArbiterTick(a, 1500);
    expect(a.phase).toBe('menu');
    a = altArbiterMove(a, 300, 300); // moves after the menu only slide
    expect(altArbiterAllowsDrag(a)).toBe(false);
    expect(altArbiterRelease(a)).toBe('consume');
  });

  it('a move past the slop before the timer is a drag and never the menu', () => {
    let a = start('touch');
    a = altArbiterMove(a, 111, 100);
    expect(altArbiterAllowsDrag(a)).toBe(true);
    a = altArbiterTick(a, 5000);
    expect(a.phase).toBe('drag');
    expect(altArbiterRelease(a)).toBe('none');
  });

  it('a short still press is a tap; cancel (second finger) never opens', () => {
    expect(altArbiterRelease(altArbiterTick(start('pen'), 1200))).toBe('tap');
    const c = altArbiterCancel(start('touch'));
    expect(altArbiterTick(c, 9999).phase).toBe('cancelled');
    expect(altArbiterTick(start('touch', false), 9999).phase).toBe('pending');
  });
});

describe('direction test: jitter vs deliberate drag', () => {
  const jitter = (pointerType: string, amp: number, n: number) => {
    let a = altArbiterMove(start(pointerType), 100 - amp / 2, 100); // jitter starts small
    for (let i = 0; i < n; i++) a = altArbiterMove(a, 100 + (i % 2 ? -amp : amp), 100 + (i % 3 === 0 ? 2 : 0));
    return a;
  };
  it('back-and-forth wobble past the slop is not a drag and keeps the hold', () => {
    const a = jitter('touch', 12, 30); // 12 px swings > 10 px slop, path ~700 px
    expect(a.phase).toBe('pending');
    expect(altArbiterTick(a, 1500).phase).toBe('menu');
  });
  it('wobble that strays past the cap commits to a drag', () => {
    let a = jitter('touch', 8, 10);
    a = altArbiterMove(a, 130, 100); // 30 px > 2.5 x 10
    expect(a.phase).toBe('drag');
  });
  it('a straight drag commits just past the slop', () => {
    let a = start('touch');
    for (let x = 102; x <= 112; x += 2) a = altArbiterMove(a, x, 101);
    expect(a.phase).toBe('drag');
  });
  it('a curved but consistent drag (within ~45 deg) commits; a reversal does not', () => {
    expect(altDragCommits({ dx: 11, dy: 4, path: 14, pointerType: 'touch' })).toBe(true);
    expect(altDragCommits({ dx: 11, dy: 0, path: 40, pointerType: 'touch' })).toBe(false);
    expect(altDragCommits({ dx: 5, dy: 0, path: 5, pointerType: 'mouse' })).toBe(true);
    expect(altDragCommits({ dx: 3, dy: 0, path: 3, pointerType: 'mouse' })).toBe(false);
  });
});

describe('mapView wiring (source checks)', () => {
  const src = readFileSync(new URL('../src/mapView.ts', import.meta.url), 'utf8');
  it('right / barrel press never starts a pan, drag or resize', () => {
    const down = src.indexOf("host.addEventListener('pointerdown', (e) => {\n      trackDown(e);");
    const body = src.slice(down, down + 4000);
    const guard = body.indexOf("altPressKind({ button: e.button, buttons: e.buttons, pointerType: type }) === 'alt'");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(body.indexOf('widthDrag = {'));
  });
  it('every handler asks the shared arbiter', () => {
    expect(src).toContain('if (committed(p.id, p.type)) startPan(p);');
    expect(src).toContain('levelHold = levelHoldCancel(levelHold)');
    expect(src).toContain('if (committed(e.pointerId)) clearNodeHold();');
    expect(src).toContain("const deliberate = committed(e.pointerId, 'touch');");
    expect(src).toContain('if (!committed(e.pointerId)) return;');
  });
  it('width corner: click opens nothing; right-click and hold open the menu', () => {
    expect(src).toContain('function beginWidthHold(');
    expect(src).toContain('}, ALT_HOLD_MS);');
    const cm = src.indexOf("host.addEventListener('contextmenu'");
    const body = src.slice(cm, cm + 2000);
    expect(body).toContain('rightEdgeKey(e.clientX, e.clientY');
    expect(body).toContain('showWidthPop(');
  });
  it('width handles block native callout / selection', () => {
    const css = readFileSync(new URL('../src/outline-fold.css', import.meta.url), 'utf8');
    const i = css.indexOf('.map-width-hit {');
    expect(css.slice(i, i + 300)).toContain('-webkit-touch-callout: none');
  });
});
