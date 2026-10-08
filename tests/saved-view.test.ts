import { describe, expect, it } from 'vitest';
import {
  anchoredFitViewCam,
  captureSavedView,
  chooseViewFocus,
  clearUserMapState,
  exactViewCam,
  forgetSavedViews,
  isSameViewShape,
  loadSavedViews,
  loadViewPrefs,
  migrateResumeToV2,
  parse,
  pickSavedView,
  resolveViewAnchor,
  saveSavedView,
  saveViewPrefs,
  savedViewStorageKey,
  toggleFold,
  viewPrefsStorageKey,
  viewRestoreAnnouncement,
  viewSlotFor,
  viewStartSource,
  type SavedView,
} from '../src/index.js';

// Saved map view, phase 1 package side (Design UX 2026-10-08). Fiction only.

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const mem = () => new MemStorage() as unknown as Storage;

const DESK = { w: 1280, h: 800 };
const PHONE = { w: 390, h: 760 };
const pill = { x: 400, y: 300, w: 120, h: 40 };

function screenOf(rect: typeof pill, cam: { x: number; y: number; k: number }) {
  return { left: rect.x * cam.k + cam.x, midY: (rect.y + rect.h / 2) * cam.k + cam.y };
}

describe('keys and slots (V2, V7)', () => {
  it('keys personal views by user and note, prefs by user', () => {
    expect(savedViewStorageKey(7, 12345)).toBe('of-map:u7:pnid:12345');
    expect(viewPrefsStorageKey('7')).toBe('of-map:u7:prefs');
  });

  it('wide is width ≥ 600 and aspect ≥ 0.8, else narrow', () => {
    expect(viewSlotFor(DESK)).toBe('wide');
    expect(viewSlotFor(PHONE)).toBe('narrow');
    expect(viewSlotFor({ w: 760, h: 390 })).toBe('wide'); // phone turned
    expect(viewSlotFor({ w: 600, h: 750 })).toBe('wide');
    expect(viewSlotFor({ w: 600, h: 751 })).toBe('narrow');
    expect(viewSlotFor({ w: 599, h: 300 })).toBe('narrow');
  });
});

describe('same shape (V5)', () => {
  const saved = { vw: 1280, vh: 800 };
  it('is exact within aspect ±15% and width ±25%', () => {
    expect(isSameViewShape(saved, DESK)).toBe(true);
    expect(isSameViewShape(saved, { w: 1600, h: 1000 })).toBe(true); // +25% width, same aspect
    expect(isSameViewShape(saved, { w: 1601, h: 1000 })).toBe(false);
    expect(isSameViewShape(saved, { w: 1280, h: 696 })).toBe(true); // aspect +15%
    expect(isSameViewShape(saved, { w: 1280, h: 690 })).toBe(false);
    expect(isSameViewShape(saved, PHONE)).toBe(false);
  });
});

describe('capture and exact restore (V1, V5)', () => {
  it('a reload puts the focus pill back on the same point at the same zoom', () => {
    const cam = { x: -120, y: 40, k: 1.25 };
    const view = captureSavedView(cam, DESK, { id: 'code', path: ['root', 'prog'], rect: pill }, 1000);
    expect(view).toEqual({
      focus: 'code', path: ['root', 'prog'], fx: (400 * 1.25 - 120) / 1280, fy: ((320) * 1.25 + 40) / 800,
      k: 1.25, vw: 1280, vh: 800, at: 1000,
    });
    const back = exactViewCam(view, pill, DESK);
    expect(back.k).toBe(1.25);
    expect(back.x).toBeCloseTo(cam.x, 9);
    expect(back.y).toBeCloseTo(cam.y, 9);
  });

  it('stays exact when the pill moved (another branch was folded or edited)', () => {
    const view = captureSavedView({ x: 0, y: 0, k: 1 }, DESK, { id: 'code', path: [], rect: pill });
    const moved = { ...pill, x: 900, y: -200 };
    const cam = exactViewCam(view, moved, DESK);
    const s = screenOf(moved, cam);
    expect(s.left).toBeCloseTo(400, 6);
    expect(s.midY).toBeCloseTo(320, 6);
  });

  it('clamps the zoom to 0.35–3.5', () => {
    const view: SavedView = { focus: 'a', path: [], fx: 0.3, fy: 0.45, k: 9, vw: 1280, vh: 800, at: 0 };
    expect(exactViewCam(view, pill, DESK).k).toBe(3.5);
    expect(exactViewCam({ ...view, k: 0.1 }, pill, DESK).k).toBe(0.35);
  });

  it('marks a selected focus so the restore re-selects it', () => {
    expect(captureSavedView({ x: 0, y: 0, k: 1 }, DESK, { id: 'a', path: [], rect: pill, selected: true }).sel).toBe(true);
  });
});

describe('anchored fit on a different shape (V6)', () => {
  const view: SavedView = { focus: 'code', path: [], fx: 0.3, fy: 0.45, k: 1.25, vw: 1280, vh: 800, at: 0 };

  it('mockup check: phone 390×760 from 1280×800, fit 0.55, floor 0.75, so zoom 0.75 and fy stays 0.45', () => {
    const frame = { x: 400, y: 260, w: 278 / 0.55, h: 120 };
    const focus = { x: 400, y: 300, w: 120, h: 40 };
    const cam = anchoredFitViewCam(view, focus, frame, PHONE);
    expect(cam.k).toBe(0.75);
    const s = screenOf(focus, cam);
    expect(s.midY / PHONE.h).toBeCloseTo(0.45, 9);
    // Frame wider than the screen: its left edge goes to 16 px.
    expect(frame.x * cam.k + cam.x).toBeCloseTo(16, 9);
  });

  it('keeps the saved zoom when the frame fits, and never zooms in past it', () => {
    const frame = { x: 400, y: 280, w: 200, h: 120 };
    expect(anchoredFitViewCam(view, pill, frame, PHONE).k).toBe(1.25);
    expect(anchoredFitViewCam({ ...view, k: 0.5 }, pill, frame, PHONE).k).toBe(0.5);
  });

  it('zooms out to fit between min(k, 0.75) and k', () => {
    const frame = { x: 400, y: 280, w: 278 / 0.9, h: 100 };
    expect(anchoredFitViewCam(view, pill, frame, PHONE).k).toBeCloseTo(0.9, 9);
  });

  it('shifts the frame inside the 56 px padding', () => {
    const frame = { x: 400, y: 280, w: 200, h: 120 };
    const right = { ...view, fx: 0.95 };
    const cam = anchoredFitViewCam(right, pill, frame, PHONE);
    expect((frame.x + frame.w) * cam.k + cam.x).toBeCloseTo(PHONE.w - 56, 9);
    const low = { ...view, fy: 0.99 };
    const cam2 = anchoredFitViewCam(low, pill, frame, PHONE);
    expect((frame.y + frame.h) * cam2.k + cam2.y).toBeCloseTo(PHONE.h - 56, 9);
  });
});

describe('picking the slot (V7)', () => {
  const v = (vw: number, vh: number): SavedView => ({ focus: 'a', path: [], fx: 0.3, fy: 0.4, k: 1, vw, vh, at: 0 });
  it('uses the matching slot, exact when the shape matches', () => {
    expect(pickSavedView({ views: { wide: v(1280, 800), narrow: v(390, 760) } }, DESK)).toMatchObject({ slot: 'wide', exact: true });
    expect(pickSavedView({ views: { wide: v(1280, 800), narrow: v(390, 760) } }, PHONE)).toMatchObject({ slot: 'narrow', exact: true });
    expect(pickSavedView({ views: { wide: v(1920, 1080) } }, DESK)).toMatchObject({ slot: 'wide', exact: false });
  });
  it('falls back to the other slot, never exact', () => {
    expect(pickSavedView({ views: { wide: v(1280, 800) } }, PHONE)).toMatchObject({ slot: 'wide', exact: false });
    expect(pickSavedView({ views: {} }, PHONE)).toBeNull();
    expect(pickSavedView(null, PHONE)).toBeNull();
  });
});

describe('choosing the focus (V8)', () => {
  const pills = [
    { id: 'a', rect: { x: 0, y: 0, w: 100, h: 40 } },
    { id: 'b', rect: { x: 600, y: 380, w: 100, h: 40 } },
    { id: 'c', rect: { x: 1250, y: 0, w: 100, h: 40 } },
  ];
  const cam = { x: 0, y: 0, k: 1 };
  it('takes the selected node when at least 60% of it shows', () => {
    expect(chooseViewFocus(cam, DESK, pills, 'a')).toEqual({ id: 'a', selected: true });
  });
  it('else the pill nearest the viewport centre', () => {
    expect(chooseViewFocus(cam, DESK, pills, 'c')).toEqual({ id: 'b', selected: false }); // c is 30% visible
    expect(chooseViewFocus(cam, DESK, pills, null)).toEqual({ id: 'b', selected: false });
    expect(chooseViewFocus(cam, DESK, [], null)).toBeNull();
  });
});

describe('focus gone or folded away (V9)', () => {
  const DOC = `- Club <id:root>
  - Programs <id:prog>
    - Code club <id:code>
      - Week 1 <id:w1>
  - Rooms <id:rooms>
`;
  it('anchors the focus itself when it shows', () => {
    expect(resolveViewAnchor(parse(DOC), { focus: 'code', path: ['root', 'prog'] })).toEqual({ kind: 'focus', id: 'code' });
  });
  it('anchors the nearest visible ancestor when folded away, without opening folds', () => {
    const doc = toggleFold(parse(DOC), 'prog');
    expect(resolveViewAnchor(doc, { focus: 'code', path: ['root', 'prog'] })).toEqual({ kind: 'hidden', id: 'prog', hiddenId: 'code' });
    expect(resolveViewAnchor(toggleFold(doc, 'root'), { focus: 'w1', path: ['root', 'prog', 'code'] })).toEqual({ kind: 'hidden', id: 'root', hiddenId: 'w1' });
  });
  it('walks path when the focus was deleted, or now sits under different ancestors', () => {
    const gone = DOC.replace('    - Code club <id:code>\n      - Week 1 <id:w1>\n', '');
    expect(resolveViewAnchor(parse(gone), { focus: 'code', path: ['root', 'prog'] })).toEqual({ kind: 'moved', id: 'prog' });
    expect(resolveViewAnchor(parse(DOC), { focus: 'code', path: ['root', 'rooms'] })).toEqual({ kind: 'moved', id: 'rooms' });
  });
  it('Fits when nothing survives', () => {
    expect(resolveViewAnchor(parse(DOC), { focus: 'x', path: ['y', 'z'] })).toEqual({ kind: 'fit' });
  });
});

describe('start source and live text (V4, V12, V14)', () => {
  it('last view, then author view, then Fit', () => {
    expect(viewStartSource('last', { personal: true, author: true })).toBe('last');
    expect(viewStartSource('last', { personal: false, author: true })).toBe('author');
    expect(viewStartSource('last', { personal: false, author: false })).toBe('fit');
    expect(viewStartSource('fitted', { personal: true, author: true })).toBe('fit');
    expect(viewStartSource('author', { personal: true, author: false })).toBe('last');
  });
  it('uses the spec wording', () => {
    expect(viewRestoreAnnouncement('exact', 'Code club')).toBe('Last view restored. Code club.');
    expect(viewRestoreAnnouncement('fitted', 'Code club')).toBe('Last view, fitted to this screen. Code club.');
    expect(viewRestoreAnnouncement('author', 'Code club')).toBe("Author's view. Code club.");
    expect(viewRestoreAnnouncement('hidden', 'Code club', 'Programs')).toBe('Code club is hidden. Showing Programs.');
  });
});

describe('the v2 record in localStorage (V2, V7, V10, V11, V13)', () => {
  const key = savedViewStorageKey(7, 12345);
  const view: SavedView = { focus: 'code', path: ['root'], fx: 0.3, fy: 0.45, k: 1.25, vw: 1280, vh: 800, at: 5 };

  it('saves one slot and keeps the other', () => {
    const s = mem();
    saveSavedView(key, 'wide', view, { storage: s, now: 10 });
    saveSavedView(key, 'narrow', { ...view, vw: 390, vh: 760 }, { storage: s, now: 11 });
    saveSavedView(key, 'narrow', { ...view, vw: 400, vh: 780 }, { storage: s, now: 12 });
    const rec = loadSavedViews(key, s)!;
    expect(rec.version).toBe(2);
    expect(rec.views!.wide!.vw).toBe(1280);
    expect(rec.views!.narrow!.vw).toBe(400);
  });

  it('holds ids and numbers only', () => {
    const s = mem();
    saveSavedView(key, 'wide', { ...view, title: 'Secret caption' } as unknown as SavedView, { storage: s });
    expect(s.getItem(key)).not.toContain('Secret');
    expect(Object.keys(loadSavedViews(key, s)!.views!.wide!).sort()).toEqual(['at', 'focus', 'fx', 'fy', 'k', 'path', 'vh', 'vw']);
  });

  it('reads a v1 record as v2: folds kept, camera dropped', () => {
    const s = mem();
    s.setItem(key, JSON.stringify({ version: 1, fold: { mode: '-', ids: ['prog'] }, camera: { x: 1, y: 2, k: 3 }, savedAt: 9 }));
    expect(loadSavedViews(key, s)).toEqual({ version: 2, fold: { mode: '-', ids: ['prog'] }, savedAt: 9 });
    expect(migrateResumeToV2({ version: 1, camera: { x: 1, y: 2, k: 3 } })).toEqual({ version: 2 });
  });

  it('Forget my views drops both slots and keeps folds', () => {
    const s = mem();
    saveSavedView(key, 'wide', view, { storage: s, fold: { mode: '-', ids: ['prog'] } });
    forgetSavedViews(key, s);
    const rec = loadSavedViews(key, s)!;
    expect(rec.views).toBeUndefined();
    expect(rec.fold).toEqual({ mode: '-', ids: ['prog'] });
  });

  it('sign-out clears of-map:u{userId}:* and nothing else', () => {
    const s = mem();
    saveSavedView(key, 'wide', view, { storage: s });
    saveViewPrefs(7, { startWith: 'fitted' }, s);
    s.setItem('of-map:u70:pnid:1', '{}');
    s.setItem('of-map:pnid:12345', '{}');
    expect(clearUserMapState(7, s)).toBe(2);
    expect(s.getItem(key)).toBeNull();
    expect(s.getItem('of-map:u70:pnid:1')).toBe('{}');
    expect(s.getItem('of-map:pnid:12345')).toBe('{}');
  });

  it('Start with defaults to Last view and round-trips', () => {
    const s = mem();
    expect(loadViewPrefs(7, s)).toEqual({ startWith: 'last' });
    saveViewPrefs(7, { startWith: 'fitted' }, s);
    expect(loadViewPrefs(7, s)).toEqual({ startWith: 'fitted' });
    s.setItem(viewPrefsStorageKey(7), '{"startWith":"bogus"}');
    expect(loadViewPrefs(7, s)).toEqual({ startWith: 'last' });
  });
});
