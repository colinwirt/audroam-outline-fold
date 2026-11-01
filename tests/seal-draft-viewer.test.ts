import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse, serialize, clearKeys, unlockKey, openSealedBranch, SealError, type OutlineFoldDoc } from '../src/index.js';
import { __setSaveVerifyTamperForTest } from '../src/sealedBranch.js';
import { ctHash } from '../src/sealDraft.js';
import { CTX, MARK, sealedDoc, payload, open, addLine, rootLines, unlock, fakeNow, find } from './seal-draft-fixture.js';

const V1 = JSON.parse(readFileSync(new URL('./vectors/of-seal-v1-fixture.json', import.meta.url), 'utf8'));

beforeEach(() => clearKeys());
afterEach(() => __setSaveVerifyTamperForTest(null));

/** Reload from text (as a host would) and reopen after a lock. */
async function relock(doc: OutlineFoldDoc): Promise<OutlineFoldDoc> {
  const text = serialize(doc);
  clearKeys();
  await unlock();
  const d = parse(text);
  d.keyring = doc.keyring;
  return d;
}

describe('SD-4 guard compares the loaded ct only', () => {
  it('autosave x3, then save, succeeds', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    for (const t of ['a', 'b', 'c']) { addLine(v, t); expect(await v.autosave()).toBe(true); }
    await v.save();
    expect(payload(doc).autosave).toBeUndefined();
  });
  it('an external change to the loaded ct throws the existing message', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    const other = await sealedDoc();
    find(doc.nodes, 'v')!.sealed = { ...payload(doc), ciphertext: payload(other).ciphertext };
    addLine(v, 'x');
    await expect(v.save()).rejects.toThrow(/payload changed outside the viewer/);
    await expect(v.autosave()).rejects.toThrow(/payload changed outside the viewer/);
  });
  it('an external change to auto-ct only does not throw', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'x');
    await v.autosave();
    const p = payload(doc);
    find(doc.nodes, 'v')!.sealed = { ...p, autosave: { ...p.autosave!, at: '2026-01-01T00:00:00Z' }, discarded: { ciphertext: p.ciphertext! } };
    addLine(v, 'y');
    await expect(v.autosave()).resolves.toBe(true);
    await expect(v.save()).resolves.toBeUndefined();
  });
});

describe('SD-5 autosave writes ciphertext only', () => {
  it('three autosaves leave one auto-ct and the loaded ct unchanged', async () => {
    const doc = await sealedDoc();
    const ct0 = payload(doc).ciphertext;
    const v = await open(doc);
    const seen = new Set<string>();
    for (const t of ['a', 'b', 'c']) { addLine(v, t); await v.autosave(); seen.add(payload(doc).autosave!.ciphertext); }
    expect(seen.size).toBe(3);
    expect(payload(doc).ciphertext).toBe(ct0);
    expect(payload(doc).autosave!.base).toBe(ctHash(ct0!));
    expect(serialize(doc).match(/auto-ct:/g)).toHaveLength(1);
  });
  it('autosave after clearKeys() throws locked', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'a');
    clearKeys();
    const e = await v.autosave().catch((x) => x);
    expect(e).toBeInstanceOf(SealError);
    expect(e.code).toBe('locked');
  });
  it('an unchanged text does not write', async () => {
    const doc = await sealedDoc();
    const calls: unknown[] = [];
    const v = await open(doc, { onChange: (p) => calls.push(p) });
    expect(await v.autosave()).toBe(false);
    addLine(v, 'a');
    expect(await v.autosave()).toBe(true);
    expect(await v.autosave()).toBe(false);
    expect(calls).toHaveLength(1);
  });
  it('no serialized output or onChange arg contains the plaintext marker', async () => {
    const doc = await sealedDoc();
    const args: string[] = [];
    const v = await open(doc, { onChange: (p) => args.push(JSON.stringify(p)) });
    addLine(v, `${MARK} new`);
    await v.autosave();
    await v.save();
    addLine(v, `${MARK} again`);
    await v.autosave();
    await v.discardAutosave();
    await v.restoreDiscarded();
    expect(args.length).toBe(5);
    for (const a of args) expect(a).not.toContain(MARK);
    expect(serialize(doc)).not.toContain(MARK);
    expect(rootLines(v).join('\n')).toContain(MARK); // only the in-memory viewer holds it
  });
});

describe('SD-6 unlock with an autosave present', () => {
  it('edit, autosave, lock, unlock: shows the edited text, unconfirmed', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'edited');
    await v.autosave();
    const d2 = await relock(doc);
    const v2 = await open(d2);
    expect(rootLines(v2)).toContain('edited');
    expect(v2.draftState).toBe('unconfirmed');
    expect(v2.autosaveWrittenHere).toBe(false);
  });
  it('with no autosave the state is clean', async () => {
    const v = await open(await sealedDoc());
    expect(v.draftState).toBe('clean');
    expect(v.draftError).toBeUndefined();
  });
  it('a corrupt auto-ct opens the loaded text and sets draftError', async () => {
    const doc = await sealedDoc();
    const p = payload(doc);
    find(doc.nodes, 'v')!.sealed = { ...p, autosave: { ciphertext: p.ciphertext!.slice(0, -4) + 'AAAA', base: ctHash(p.ciphertext!) } };
    const v = await open(doc);
    expect(rootLines(v)).toEqual([`${MARK} line one`, 'line two']);
    expect(v.draftError).toMatch(/Autosave/);
  });
  it('a base mismatch gives the state conflict', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'edited');
    await v.autosave();
    const p = payload(doc);
    find(doc.nodes, 'v')!.sealed = { ...p, autosave: { ...p.autosave!, base: ctHash('something else') } };
    const v2 = await open(doc);
    expect(v2.draftState).toBe('conflict');
    expect(await v2.autosave()).toBe(false); // never rebases a version it can't place
  });
});

describe('SD-7 confirmed save', () => {
  it('after save, loaded is the new ct and autosave is gone; old ct is in gone-ct and decrypts', async () => {
    const clock = fakeNow();
    const doc = await sealedDoc();
    const ct0 = payload(doc).ciphertext!;
    const v = await open(doc, { now: clock.now });
    addLine(v, 'new');
    await v.autosave();
    clock.add(60_000);
    await v.save();
    const p = payload(doc);
    expect(p.ciphertext).not.toBe(ct0);
    expect(p.autosave).toBeUndefined();
    expect(p).toMatchObject({ base: ctHash(ct0), at: '2026-11-01T01:41:00Z', discarded: { ciphertext: ct0, replacedBy: 'save', from: 'loaded' } });
    await v.restoreDiscarded();
    expect(rootLines(v)).toEqual([`${MARK} line one`, 'line two']);
  });
  it('a forced verify failure leaves the payload deep-equal to before', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'new');
    await v.autosave();
    const before = structuredClone(payload(doc));
    __setSaveVerifyTamperForTest((t) => t.replace('new', 'nex'));
    const e = await v.save().catch((x) => x);
    expect(e).toBeInstanceOf(SealError);
    expect(e.code).toBe('verify');
    expect(payload(doc)).toEqual(before);
  });
  it('a save with no change still returns early', async () => {
    const doc = await sealedDoc();
    const before = structuredClone(payload(doc));
    const v = await open(doc);
    await v.save();
    expect(payload(doc)).toEqual(before);
  });
  it('rejects options other than resolve', async () => {
    const v = await open(await sealedDoc());
    await expect(v.save({ kid: 'k2' })).rejects.toThrow(/fixed/);
  });
});

describe('SD-8 discard', () => {
  it('loaded ct unchanged and the viewer shows the loaded text', async () => {
    const doc = await sealedDoc();
    const ct0 = payload(doc).ciphertext;
    const v = await open(doc);
    addLine(v, 'draft');
    await v.autosave();
    await v.discardAutosave();
    expect(payload(doc).ciphertext).toBe(ct0);
    expect(payload(doc).autosave).toBeUndefined();
    expect(rootLines(v)).toEqual([`${MARK} line one`, 'line two']);
    expect(v.draftState).toBe('clean');
  });
  it('a second discard of a newer autosave replaces the gone slot', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'one');
    await v.autosave();
    await v.discardAutosave();
    const g1 = payload(doc).discarded!.ciphertext;
    addLine(v, 'two');
    await v.autosave();
    const a2 = payload(doc).autosave!.ciphertext;
    await v.discardAutosave();
    expect(payload(doc).discarded!.ciphertext).toBe(a2);
    expect(payload(doc).discarded!.ciphertext).not.toBe(g1);
  });
});

describe('SD-9 restore discarded', () => {
  it('discard then restore round-trips the text, unconfirmed', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'draft');
    await v.autosave();
    await v.discardAutosave();
    await v.restoreDiscarded();
    expect(rootLines(v)).toContain('draft');
    expect(v.draftState).toBe('unconfirmed');
    expect(payload(doc).discarded).toBeUndefined();
    expect(payload(doc).autosave!.base).toBe(ctHash(payload(doc).ciphertext!));
  });
  it('save, restore, save again brings back the previous loaded text', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'v2');
    await v.save();
    await v.restoreDiscarded();
    await v.save();
    const d2 = await relock(doc);
    expect(rootLines(await open(d2))).toEqual([`${MARK} line one`, 'line two']);
  });
  it('restore with an existing autosave swaps', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'old');
    await v.autosave();
    await v.discardAutosave();
    const gone = payload(doc).discarded!.ciphertext;
    addLine(v, 'newer');
    await v.autosave();
    const auto = payload(doc).autosave!.ciphertext;
    await v.restoreDiscarded();
    expect(payload(doc).autosave!.ciphertext).toBe(gone);
    expect(payload(doc).discarded).toMatchObject({ ciphertext: auto, from: 'autosave' });
    expect(rootLines(v)).toContain('old');
  });
  it('restoring with no slot throws', async () => {
    const v = await open(await sealedDoc());
    await expect(v.restoreDiscarded()).rejects.toThrow(/no discarded/);
  });
});

describe('SD-10 conflict save needs an explicit choice', () => {
  it('a plain save in conflict throws; resolve keep-autosave saves with gone holding the old loaded', async () => {
    const doc = await sealedDoc();
    const ct0 = payload(doc).ciphertext!;
    const v = await open(doc);
    addLine(v, 'edited');
    await v.autosave();
    const p = payload(doc);
    delete find(doc.nodes, 'v')!.sealed!.autosave!.base; // legacy / unknown base
    void p;
    const v2 = await open(doc);
    expect(v2.draftState).toBe('conflict');
    await expect(v2.save()).rejects.toThrow(/can't tell which version is newer/);
    await v2.save({ resolve: 'keep-autosave' });
    expect(payload(doc).discarded).toMatchObject({ ciphertext: ct0, from: 'loaded' });
    expect(payload(doc).autosave).toBeUndefined();
  });
  it('resolve keep-loaded discards the autosave (still restorable)', async () => {
    const doc = await sealedDoc();
    const ct0 = payload(doc).ciphertext;
    const v = await open(doc);
    addLine(v, 'edited');
    await v.autosave();
    delete find(doc.nodes, 'v')!.sealed!.autosave!.base;
    const v2 = await open(doc);
    await v2.save({ resolve: 'keep-loaded' });
    expect(payload(doc).ciphertext).toBe(ct0);
    expect(payload(doc).discarded?.from).toBe('autosave');
  });
});

describe('SD-11 hold until the next confirmed save', () => {
  it('a slot 30 days old is still restorable', async () => {
    const clock = fakeNow();
    const doc = await sealedDoc();
    const v = await open(doc, { now: clock.now });
    addLine(v, 'draft');
    await v.autosave();
    await v.discardAutosave();
    clock.add(30 * 86_400_000);
    await v.restoreDiscarded();
    expect(rootLines(v)).toContain('draft');
  });
  it('after the next confirmed save the earlier slot is replaced by the one that save creates', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'draft');
    await v.autosave();
    await v.discardAutosave();
    const g1 = payload(doc).discarded!.ciphertext;
    const loaded = payload(doc).ciphertext;
    addLine(v, 'saved');
    await v.save();
    expect(payload(doc).discarded!.ciphertext).not.toBe(g1);
    expect(payload(doc).discarded).toMatchObject({ ciphertext: loaded, replacedBy: 'save' });
  });
  it('discard then autosave x3 leaves the slot unchanged', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'draft');
    await v.autosave();
    await v.discardAutosave();
    const g = structuredClone(payload(doc).discarded);
    for (const t of ['a', 'b', 'c']) { addLine(v, t); await v.autosave(); }
    expect(payload(doc).discarded).toEqual(g);
  });
});

describe('SD-12 backward compatibility', () => {
  it('a legacy ct-only note opens, saves and round-trips', async () => {
    const doc = await sealedDoc();
    expect(Object.keys(payload(doc)).sort()).toEqual(['alg', 'ciphertext', 'kid']);
    const d = parse(serialize(doc));
    d.keyring = doc.keyring;
    const v = await open(d);
    expect(v.draftState).toBe('clean');
    addLine(v, 'more');
    await v.save();
    expect(Object.keys(payload(d)).sort()).toEqual(['alg', 'at', 'base', 'ciphertext', 'discarded', 'kid']);
    const d2 = await relock(d);
    expect(rootLines(await open(d2))).toContain('more');
  });
  it('an old reader (auto-*/gone-* stripped) still yields the loaded ct', async () => {
    const doc = await sealedDoc();
    const v = await open(doc);
    addLine(v, 'saved');
    await v.save();
    addLine(v, 'unconfirmed');
    await v.autosave();
    const old = serialize(doc).split('\n').filter((l) => !/^\s+(auto|gone)-/.test(l)).join('\n');
    const d = parse(old);
    d.keyring = doc.keyring;
    expect(payload(d).ciphertext).toBe(payload(doc).ciphertext);
    const lines = rootLines(await open(d));
    expect(lines).toContain('saved');
    expect(lines).not.toContain('unconfirmed');
  });
  it('of-seal-v1 autosave and restore throw the migrate error', async () => {
    const doc = parse(V1.text);
    const kid = doc.keys![0]!.kid;
    await unlockKey(doc, kid, V1.passphrase);
    const v = await openSealedBranch(doc, 'v', V1.ctx);
    addLine(v, 'x');
    await expect(v.autosave()).rejects.toThrow(/migrate/);
    await expect(v.restoreDiscarded()).rejects.toThrow(/migrate/);
  });
  it('uri notes are unaffected', () => {
    const text = '- Remote <id:u>\n\n--- payloads ---\nu:\n  kid: k9\n  uri: https://x.test/blob\n---\n';
    const d = parse(text);
    expect(find(d.nodes, 'u')!.sealed).toEqual({ kid: 'k9', uri: 'https://x.test/blob' });
    expect(serialize(d)).toBe(serialize(parse(serialize(d))));
    void CTX;
  });
});
