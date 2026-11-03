// @vitest-environment happy-dom
// 0.5.16: seal v3 unlock-screen fixes (Design UX spec, locked by Colin). Invented fixtures only.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  parse, serialize, createKey, sealBranch, clearKeys, setSealCipher, createSealSessions,
  mountUnlockPrompt, secureZoneChrome, mountSealStatusChip, mountRenameForm,
  sealErrorCode, SealError, DamagedSealError,
  MIN_NEW_PASSPHRASE, passphraseStrength, generatePassphrase, EFF_LARGE_WORDLIST,
  idleLockText, looksLikeSecret,
  type OutlineFoldDoc, type OutlineNode,
} from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';

const PASS = 'correct horse battery staple';
const CTX = { noteId: 'note-1', ownerId: 'owner-1' };
const SRC = `- Root <id:r>\n  - Vault <id:v>\n    - Secret child <id:c1>\n  - Public <id:s>\n`;

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
afterAll(() => setArgon2Provider(null));
beforeEach(() => { clearKeys(); setSealCipher('a256gcm'); document.body.innerHTML = ''; });

function find(nodes: OutlineNode[] | undefined, id: string): OutlineNode | undefined {
  for (const n of nodes ?? []) { if (n.id === id) return n; const h = find(n.children, id); if (h) return h; }
  return undefined;
}
async function sealed(pass = PASS, src = SRC): Promise<OutlineFoldDoc> {
  let doc = parse(src);
  const key = await createKey(doc, pass, { kid: 'k1' });
  await sealBranch(doc, find(doc.nodes, 'v')!, key.kid, CTX);
  doc = parse(serialize(doc));
  clearKeys();
  return doc;
}
/** Flip one base64url character in the armored body: the CRC line no longer matches. */
function damage(doc: OutlineFoldDoc) {
  const p = find(doc.nodes, 'v')!.sealed!;
  const lines = p.ciphertext!.split('\n');
  const i = lines.findIndex((l) => l.length > 40 && !l.startsWith('-----'));
  const c = lines[i]![20]!;
  lines[i] = lines[i]!.slice(0, 20) + (c === 'A' ? 'B' : 'A') + lines[i]!.slice(21);
  p.ciphertext = lines.join('\n');
}

describe('1. wrong key vs damaged', () => {
  it('sealErrorCode maps DamagedSealError to damaged (root cause: it does not extend SealError)', () => {
    expect(sealErrorCode(new DamagedSealError())).toBe('damaged');
    expect(sealErrorCode(new SealError())).toBe('bad-pass');
    expect(sealErrorCode('x')).toBe('bad-pass');
  });
  it('damaged seal: state error code damaged, no backoff, failures not counted', async () => {
    const doc = await sealed();
    damage(doc);
    const s = createSealSessions({ getDoc: () => doc, ctx: CTX, backoffMs: () => 10_000, wipeOnPagehide: false });
    const r = s.regionFor('v');
    await s.open(r, PASS);
    expect(s.get(r).error?.code).toBe('damaged');
    expect(s.get(r).error?.message).toBe('Seal is damaged');
    expect(s.get(r).retryAfterMs).toBe(0);
    expect(s.get(r).state).toBe('error');
    s.destroy();
  });
  it('wrong key still backs off with "Wrong passphrase"', async () => {
    const doc = await sealed();
    const s = createSealSessions({ getDoc: () => doc, ctx: CTX, backoffMs: () => 12_000, wipeOnPagehide: false });
    const r = s.regionFor('v');
    await s.open(r, 'nope');
    expect(s.get(r).error?.code).toBe('bad-pass');
    expect(s.get(r).retryAfterMs).toBeGreaterThan(11_000);
    s.destroy();
  });
  it('card: wrong key keeps the field and shows the backoff', async () => {
    const doc = await sealed();
    const s = createSealSessions({ getDoc: () => doc, ctx: CTX, backoffMs: () => 12_000, wipeOnPagehide: false });
    const r = s.regionFor('v');
    const h = mountUnlockPrompt({ sessions: s, region: r });
    await s.open(r, 'nope');
    const msg = h.el.querySelector('.of-unlock-msg')!.textContent!;
    expect(msg).toContain('Wrong passphrase');
    expect(msg).toMatch(/Try again in 1[12]s/);
    expect((h.el.querySelector('.of-unlock-pass') as HTMLElement).hidden).toBe(false);
    h.close(); s.destroy();
  });
  it('card: damaged has no retry, no backoff, Restore only with history, details behind ?', async () => {
    const doc = await sealed();
    damage(doc);
    const s = createSealSessions({ getDoc: () => doc, ctx: CTX, backoffMs: () => 12_000, wipeOnPagehide: false });
    const r = s.regionFor('v');
    let restored = 0;
    const h = mountUnlockPrompt({ sessions: s, region: r, restoreEarlier: { available: () => true, run: () => { restored++; } } });
    await s.open(r, PASS);
    await new Promise((res) => setTimeout(res, 0));
    const msg = h.el.querySelector('.of-unlock-msg')!.textContent!;
    expect(msg).toBe('Seal is damaged');
    expect(msg).not.toMatch(/Try again/);
    expect((h.el.querySelector('.of-unlock-pass') as HTMLElement).hidden).toBe(true);
    expect((h.el.querySelector('.of-unlock-ok') as HTMLElement).hidden).toBe(true);
    const rb = h.el.querySelector('.of-unlock-restore') as HTMLButtonElement;
    expect(rb.hidden).toBe(false);
    expect(rb.textContent).toBe('Restore earlier version');
    rb.click();
    expect(restored).toBe(1);
    expect((h.el.querySelector('.of-unlock-damaged-note') as HTMLElement).hidden).toBe(true);
    h.close();
    const h2 = mountUnlockPrompt({ sessions: s, region: r });
    expect((h2.el.querySelector('.of-unlock-restore') as HTMLElement | null)?.hidden ?? true).toBe(true);
    h2.close(); s.destroy();
  });
});

describe('2. new keys', () => {
  it('one 16-character minimum and a strength line', () => {
    expect(MIN_NEW_PASSPHRASE).toBe(16);
    expect(passphraseStrength('')).toBe('');
    expect(passphraseStrength('x'.repeat(15))).toBe('Too short');
    expect(passphraseStrength('x'.repeat(16))).toBe('OK');
  });
  it('existing shorter passphrases still unlock (no check on unlock)', async () => {
    const doc = await sealed('short1');
    const s = createSealSessions({ getDoc: () => doc, ctx: CTX, wipeOnPagehide: false });
    const r = s.regionFor('v');
    await s.open(r, 'short1');
    expect(s.get(r).state).toBe('unlocked');
    s.destroy();
  });
  it('generator: 5 words from the EFF large list via getRandomValues, unbiased index', () => {
    expect(EFF_LARGE_WORDLIST.length).toBe(7776);
    expect(EFF_LARGE_WORDLIST[0]).toBe('abacus');
    let calls = 0;
    const rnd = (a: Uint32Array) => { calls++; a.fill(calls === 1 ? 0xffffffff : 7); return a; };
    const p = generatePassphrase({ getRandomValues: rnd });
    expect(p.split(' ')).toHaveLength(5);
    expect(calls).toBeGreaterThan(1); // the top of the range is rejected, not folded
    for (const w of generatePassphrase().split(' ')) expect(EFF_LARGE_WORDLIST).toContain(w);
    expect(generatePassphrase().length).toBeGreaterThanOrEqual(MIN_NEW_PASSPHRASE);
  });
});

describe('3. idle lock text', () => {
  it('uses the real autoLockMs', () => {
    expect(idleLockText(5 * 60_000)).toBe('Locked after 5 min idle');
    expect(idleLockText(15 * 60_000)).toBe('Locked after 15 min idle');
    expect(idleLockText(90_000)).toBe('Locked after 1.5 min idle');
  });
  it('the frontmatter autoLock drives the countdown', async () => {
    const doc = await sealed(PASS, SRC + '\n--- layout ---\nautoLock: 15m\n---\n');
    const s = createSealSessions({ getDoc: () => doc, ctx: CTX, wipeOnPagehide: false });
    expect(s.autoLockMs()).toBe(15 * 60_000);
    s.destroy();
  });
});

describe('4. shorter wording, labels, rename', () => {
  async function zone(keyLabel?: (k: string) => string | null, onRename?: (kid: string) => void) {
    const doc = await sealed();
    const s = createSealSessions({ getDoc: () => doc, ctx: CTX, wipeOnPagehide: false });
    const r = s.regionFor('v');
    await s.open(r, PASS);
    const z = secureZoneChrome(document.createElement('div'), { sessions: s, region: r, keyLabel, onRename });
    document.body.append(z.el);
    return { s, r, z };
  }
  it('zone header is "🔓 {kid}" with no Secure zone / memory only; note behind ?', async () => {
    const { z, s } = await zone();
    const head = z.el.querySelector('.of-secure-zone-bar')!.textContent!;
    expect(head).not.toMatch(/Secure zone|memory only/);
    expect(z.el.querySelector('.of-secure-zone-title')!.textContent).toBe('🔓 k1');
    expect(z.el.querySelector('.of-secure-zone-sub')!.textContent).toBe('Unlocked · this tab only');
    const note = z.el.querySelector('.of-secure-zone-note') as HTMLElement;
    expect(note.hidden).toBe(true);
    expect(note.textContent).toMatch(/Plaintext lives in this tab only/);
    z.destroy(); s.destroy();
  });
  it('label replaces the kid outside the map; falls back to kid', async () => {
    const { z, s, r } = await zone((k) => (k === 'k1' ? 'Bank' : null));
    expect(z.el.querySelector('.of-secure-zone-title')!.textContent).toBe('🔓 Bank');
    const h = mountUnlockPrompt({ sessions: s, region: r, keyLabel: () => 'Bank' });
    expect(h.el.querySelector('.of-unlock-title b')!.textContent).toBe('Unlock Bank');
    h.close();
    const host = document.createElement('div');
    mountSealStatusChip(host, s, { keyLabel: () => 'Bank' });
    expect(host.textContent).toContain('Bank');
    z.destroy(); s.destroy();
  });
  it('Remove seal confirm focuses Keep sealed', async () => {
    const { z, s } = await zone();
    (z.el.querySelector('.of-sz-remove') as HTMLButtonElement).click();
    expect((document.activeElement as HTMLElement).textContent).toBe('Keep sealed');
    z.destroy(); s.destroy();
  });
  it('More menu has Rename… when the host supports it', async () => {
    let got = '';
    const { z, s } = await zone(undefined, (k) => { got = k; });
    const item = z.el.querySelector('.of-sz-rename') as HTMLButtonElement;
    expect(item.textContent).toBe('Rename…');
    item.click();
    expect(got).toBe('k1');
    z.destroy(); s.destroy();
  });
  it('rename form: empty fields, not-encrypted note, secret warning, submit', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    let saved: unknown = null;
    const f = mountRenameForm({ container: host, kid: 'k1', onSubmit: (v) => { saved = v; } });
    const label = f.el.querySelector('input.of-rename-label') as HTMLInputElement;
    const search = f.el.querySelector('textarea.of-rename-search') as HTMLTextAreaElement;
    expect(label.value).toBe('');
    expect(search.value).toBe('');
    expect(f.el.textContent).toContain('Not encrypted · searchable by the server');
    const warn = f.el.querySelector('.of-rename-warn') as HTMLElement;
    expect(warn.hidden).toBe(true);
    search.value = 'password: hunter2hunter2';
    search.dispatchEvent(new Event('input'));
    expect(warn.hidden).toBe(false);
    label.value = 'Bank';
    (f.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(saved).toEqual({ label: 'Bank', search: 'password: hunter2hunter2' });
  });
  it('looksLikeSecret', () => {
    expect(looksLikeSecret('sk-live_abcdef0123456789abcdef')).toBe(true);
    expect(looksLikeSecret('ghp_0123456789abcdefABCDEF0123456789abcd')).toBe(true);
    expect(looksLikeSecret('-----BEGIN PRIVATE KEY-----')).toBe(true);
    expect(looksLikeSecret('pin 4821')).toBe(true);
    expect(looksLikeSecret('Bank accounts and super')).toBe(false);
    expect(looksLikeSecret('')).toBe(false);
  });
});
