import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearKeys, versionLabels, versionDiff, diffCounts, sealMenuItems, scheduleSealAutosave, SealError, CANT_TELL_LABEL, type SealedViewer } from '../src/index.js';
import { sealedDoc, payload, open, addLine, fakeNow, find } from './seal-draft-fixture.js';

beforeEach(() => clearKeys());

const LBL = { locale: 'en-US', timeZone: 'UTC' };

describe('SD-10 labels and diff', () => {
  it('label strings are exact with a fixed clock', async () => {
    const clock = fakeNow(Date.parse('2026-11-01T13:40:00Z'));
    const doc = await sealedDoc();
    let v = await open(doc, { now: clock.now });
    await v.save(); // no change: early return, legacy has no `at`
    expect(versionLabels(v, LBL).saved).toBe('Saved');
    addLine(v, 'a');
    await v.save();
    clock.set('2026-11-01T14:12:00Z');
    for (const t of ['b', 'c', 'd']) addLine(v, t);
    await v.autosave();
    expect(versionLabels(v, LBL)).toEqual({ saved: 'Saved · 1:40pm', autosave: 'Autosave · 2:12pm · this device · +3 lines', discarded: 'Discarded · 1:40pm', conflict: false });
    v = await open(doc, { now: clock.now });
    expect(versionLabels(v, { ...LBL, otherDeviceLabel: () => 'other device' }).autosave).toBe('Autosave · 2:12pm · other device · +3 lines');
  });
  it('+3/−1 counts', () => {
    const a = JSON.stringify({ v: 1, caption: 'C', body: '- one\n- two\n' });
    const b = JSON.stringify({ v: 1, caption: 'C', body: '- one\n- 2\n- three\n- four\n' });
    expect(diffCounts(a, b)).toEqual({ add: 3, del: 1 });
  });
  it('diff ops for a simple edit', () => {
    expect(versionDiff('a\nb\nc', 'a\nB\nc')).toEqual([
      { op: 'same', line: 'a' },
      { op: 'del', line: 'b' },
      { op: 'add', line: 'B' },
      { op: 'same', line: 'c' },
    ]);
  });
  it('missing base gives "Can\'t tell which is newer" on both versions', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'x');
    await v.autosave();
    delete find(doc.nodes, 'v')!.sealed!.autosave!.base;
    const l = versionLabels(await open(doc), LBL);
    expect(l.conflict).toBe(true);
    expect(l.saved).toContain(CANT_TELL_LABEL);
    expect(l.autosave).toContain(CANT_TELL_LABEL);
  });
  it('a mismatched base gives the same label', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'x');
    await v.autosave();
    find(doc.nodes, 'v')!.sealed!.autosave!.base = 'h:AAAAAAAAAAAAAAAAAAAAAA';
    const l = versionLabels(await open(doc), LBL);
    expect(l.autosave).toBe(`Autosave · ${versionLabels(v, LBL).autosave!.split(' · ')[1]} · ${CANT_TELL_LABEL}`);
    expect(l.saved).toBe(`Saved · ${CANT_TELL_LABEL}`);
  });
});

describe('SD-9 More ▾ menu', () => {
  it('Restore discarded version is hidden with no slot and shown with one', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    expect(sealMenuItems(v)).toEqual([]);
    addLine(v, 'x');
    await v.autosave();
    expect(sealMenuItems(v).map((i) => i.id)).toEqual(['discard-autosave']);
    await sealMenuItems(v)[0]!.run();
    const items = sealMenuItems(v);
    expect(items.map((i) => i.label)).toEqual(['Restore discarded version']);
    await items[0]!.run();
    expect(payload(doc).discarded).toBeUndefined();
    expect(sealMenuItems(v).map((i) => i.id)).not.toContain('restore-discarded');
  });
});

/** A stand-in viewer that counts autosave() calls. */
function fakeViewer(opts: { fail?: () => unknown } = {}) {
  const calls: number[] = [];
  const v = {
    async autosave() {
      calls.push(Date.now());
      const e = opts.fail?.();
      if (e) throw e;
      return true;
    },
  } as unknown as SealedViewer;
  return { v, calls };
}

describe('SD-5 autosave cadence (adaptive)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it('idle 1500 ms after a typing pause flushes once', async () => {
    const { v, calls } = fakeViewer();
    const s = scheduleSealAutosave(v);
    s.edit(); await tick(500); s.edit();
    await tick(1499);
    expect(calls).toHaveLength(0);
    await tick(1);
    expect(calls).toEqual([2000]);
    await tick(20_000);
    expect(calls).toHaveLength(1);
  });
  it('continuous typing flushes at the 10 s cap, then no sooner than the 5 s gap', async () => {
    const { v, calls } = fakeViewer();
    const s = scheduleSealAutosave(v);
    for (let t = 0; t < 16_000; t += 500) { s.edit(); await tick(500); }
    expect(calls[0]).toBe(10_000);
    expect(calls.length).toBe(1); // next is due at the cap again (20 s)
    for (let i = 1; i < calls.length; i++) expect(calls[i]! - calls[i - 1]!).toBeGreaterThanOrEqual(5000);
  });
  it('the gap is ~5 s when saves are fast and backs off to 30 s on slow or failed saves', async () => {
    const { v, calls } = fakeViewer();
    const s = scheduleSealAutosave(v);
    expect(s.gapMs).toBe(5000);
    s.edit(); await tick(1500);
    s.edit(); await tick(1500);
    expect(calls).toEqual([1500]); // held by the 5 s gap
    await tick(3499);
    expect(calls).toEqual([1500]);
    await tick(1);
    expect(calls).toEqual([1500, 6500]);
    s.reportSaveResult(4000, true); s.reportSaveResult(0, false); s.reportSaveResult(9000, true); s.reportSaveResult(9000, true);
    expect(s.gapMs).toBe(30_000);
    s.edit(); await tick(1500);
    expect(calls).toHaveLength(2);
    await tick(35_000);
    expect(calls).toEqual([1500, 6500, 36_500]);
    for (let i = 0; i < 4; i++) s.reportSaveResult(80, true);
    expect(s.gapMs).toBe(5000);
  });
  it('a failed autosave backs off by itself; locked stops the scheduler', async () => {
    let mode: 'err' | 'locked' = 'err';
    const { v } = fakeViewer({ fail: () => (mode === 'err' ? new Error('net') : new SealError('locked')) });
    const errors: unknown[] = [];
    const s = scheduleSealAutosave(v, { onError: (e) => errors.push(e) });
    s.edit(); await tick(1500);
    expect(s.gapMs).toBe(10_000);
    mode = 'locked';
    await s.flush();
    expect(s.stopped).toBe(true);
    expect(errors).toHaveLength(2);
  });
  it('pagehide and a hidden tab flush at once', async () => {
    const { v, calls } = fakeViewer();
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const s = scheduleSealAutosave(v, { win, doc });
    s.edit();
    win.dispatchEvent(new Event('pagehide')); await tick(0);
    expect(calls).toHaveLength(1);
    s.edit();
    doc.dispatchEvent(new Event('visibilitychange')); await tick(0);
    expect(calls).toHaveLength(1); // still visible
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange')); await tick(0);
    expect(calls).toHaveLength(2);
    s.stop();
  });
  it('lock flushes and then stops (real viewer, then clearKeys)', async () => {
    vi.useRealTimers();
    const doc = await sealedDoc();
    const v = await open(doc);
    const s = scheduleSealAutosave(v);
    addLine(v, 'typed before lock');
    s.edit();
    await s.lock();
    clearKeys();
    expect(payload(doc).autosave).toBeDefined();
    expect(s.stopped).toBe(true);
    s.edit();
    await s.flush(); // no-op once stopped
  });
});
