import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import {
  parse,
  serialize,
  createKey,
  sealBranch,
  clearKeys,
  setSealCipher,
  createSealSessions,
  createRegionFoldStore,
  bindRegionFoldToSessions,
  createFocusLink,
  wireFocus,
  draftStatus,
  formatIdle,
  clampPromptBox,
  wrapPlain,
  autoWrapCh,
  resolveFollowInText,
  setFollowInText,
  type OFEvent,
  type OutlineFoldDoc,
  type OutlineNode,
  type SealState,
} from '../src/index.js';
import { setArgon2Provider } from '../src/sealedBranch.js';

const PASS = 'correct horse battery staple';
const CTX = { noteId: 'note-1', ownerId: 'owner-1' };
const SRC = `- Root <id:r>
  - Vault <id:v>
    - Secret child <id:c1>
      - deeper <id:c2>
    - Second <id:c3>
  - Public <id:s>

--- layout ---
autoWidth: 20ch
---
`;

// Fake KDF: the test hook takes Argon2 off the clock (params in the header are ignored).
beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
afterAll(() => setArgon2Provider(null));
beforeEach(() => { clearKeys(); setSealCipher('a256gcm'); });

function find(nodes: OutlineNode[] | undefined, id: string): OutlineNode | undefined {
  for (const n of nodes ?? []) { if (n.id === id) return n; const h = find(n.children, id); if (h) return h; }
  return undefined;
}

async function setup() {
  let doc: OutlineFoldDoc = parse(SRC);
  const key = await createKey(doc, PASS, { kid: 'k1' });
  await sealBranch(doc, find(doc.nodes, 'v')!, key.kid, CTX);
  doc = parse(serialize(doc)); // reload from text, as a host would
  clearKeys();
  const events: OFEvent[] = [];
  const sessions = createSealSessions({ getDoc: () => doc, ctx: CTX, autoLockMs: 60_000, backoffMs: () => 0, wipeOnPagehide: false });
  for (const t of ['unlock', 'lock', 'save', 'change', 'error', 'focusChange'] as const) sessions.api.on(t, (e) => events.push(e));
  const region = sessions.regionFor('v');
  const states: SealState[] = [];
  sessions.get(region).subscribe((s) => states.push(s.state));
  return { getDoc: () => doc, sessions, region, events, states };
}

const payload = (doc: OutlineFoldDoc) => find(doc.nodes, 'v')!.sealed!.ciphertext!;
const ivOf = (ct: string) => ct.split('.').slice(-2, -1)[0];

describe('unsealed editing', () => {
  it('(a) unseal: sealed → unlocking → unlocked; wrong passphrase → error → sealed, retry works', async () => {
    const { sessions, region, states, events } = await setup();
    expect(sessions.get(region).kid).toBe('k1');
    await sessions.open(region, 'nope');
    expect(states).toEqual(['unlocking', 'error', 'sealed']);
    expect(events.find((e) => e.type === 'error')).toMatchObject({ code: 'bad-pass', message: 'Wrong passphrase', retryAfterMs: 0 });
    expect(sessions.get(region).locked).toBe(true);
    states.length = 0;
    await sessions.open(region, PASS);
    expect(states).toEqual(['unlocking', 'unlocked']);
    expect(sessions.get(region).doc!.nodes[0]!.title).toContain('Vault');
    expect(sessions.idleRemainingMs()).toBeGreaterThan(59_000);
    expect(formatIdle(sessions.idleRemainingMs()!)).toMatch(/^(1:00|0:59)$/);
    sessions.destroy();
  });

  it('(a2) back-off: retry is refused until the timer recovers the state', async () => {
    const { getDoc } = await setup();
    const s2 = createSealSessions({ getDoc, ctx: CTX, backoffMs: () => 30, wipeOnPagehide: false });
    const r = s2.regionFor('v');
    await s2.open(r, 'bad');
    expect(s2.get(r).state).toBe('error');
    expect(s2.get(r).retryAfterMs).toBeGreaterThan(0);
    await s2.open(r, PASS); // ignored while backing off
    expect(s2.get(r).state).toBe('error');
    await new Promise((res) => setTimeout(res, 45));
    expect(s2.get(r).state).toBe('sealed');
    await s2.open(r, PASS);
    expect(s2.get(r).state).toBe('unlocked');
    s2.destroy();
  });

  it('(b,c) edit inner text: dirty draft, state machine, unsaved → saved', async () => {
    const { sessions, region, states } = await setup();
    await sessions.open(region, PASS);
    expect(draftStatus(sessions.get(region))).toBe('');
    const d = sessions.get(region).doc!;
    find(d.nodes, 'c1')!.title = 'Edited child';
    sessions.markChanged(region);
    const s = sessions.get(region);
    expect(s.state).toBe('unlocked');
    expect(s.dirty).toBe(true);
    expect(draftStatus(s)).toBe('unsaved');
    states.length = 0;
    await sessions.save(region);
    expect(states).toEqual(['saving', 'unlocked']);
    expect(sessions.get(region).dirty).toBe(false);
    expect(draftStatus(sessions.get(region))).toBe('saved');
    find(sessions.get(region).doc!.nodes, 'c3')!.title = 'again';
    sessions.markChanged(region);
    expect(draftStatus(sessions.get(region))).toBe('unsaved');
    sessions.destroy();
  });

  it('(d) fold state by scoped id survives an edit and is wiped on lock', async () => {
    const { sessions, region } = await setup();
    const store = createRegionFoldStore();
    const unbind = bindRegionFoldToSessions(store, sessions);
    await sessions.open(region, PASS);
    const d = () => sessions.get(region).doc!;
    store.setNodeCollapsed(region, 'c1', true);
    expect(store.entries()[`${region}:c1`]).toBe(true);
    find(d().nodes, 'c3')!.title = 'edited';
    sessions.markChanged(region);
    expect(store.isNodeCollapsed(region, d(), 'c1')).toBe(true);
    expect(store.exportPersistent()).toEqual({}); // sealed fold never persisted
    await sessions.lock(region, 'idle'); // dirty + non-user lock: saves, then wipes
    expect(Object.keys(store.entries()).filter((k) => k.startsWith(region))).toEqual([]);
    await sessions.open(region, PASS);
    expect(store.isNodeCollapsed(region, d(), 'c1')).toBe(false);
    unbind();
    sessions.destroy();
  });

  it('(e,f) save re-seals into the parent; outer text holds only the tag; two saves, fresh IVs', async () => {
    const { sessions, region, getDoc, events } = await setup();
    const ct0 = payload(getDoc());
    await sessions.open(region, PASS);
    find(sessions.get(region).doc!.nodes, 'c1')!.title = 'First edit';
    sessions.markChanged(region);
    await sessions.save(region);
    const ct1 = payload(getDoc());
    expect(ct1).not.toBe(ct0);
    const saved = events.filter((e) => e.type === 'save') as Extract<OFEvent, { type: 'save' }>[];
    expect(saved).toHaveLength(1);
    const body = saved[0]!.payload.split('--- payloads ---')[0]!;
    expect(body).toMatch(/<enc:k1>/);
    expect(saved[0]!.payload).not.toContain('First edit');
    expect(saved[0]!.payload).not.toContain('Secret child');
    // Reload from the saved text and decrypt with a fresh session.
    clearKeys();
    let reloaded = parse(saved[0]!.payload);
    const s2 = createSealSessions({ getDoc: () => reloaded, ctx: CTX, wipeOnPagehide: false });
    await s2.open(region, PASS);
    expect(find(s2.get(region).doc!.nodes, 'c1')!.title).toBe('First edit');
    // (f) second edit + resave: fresh IV, decrypts to the newest text.
    find(s2.get(region).doc!.nodes, 'c3')!.title = 'Second edit';
    s2.markChanged(region);
    await s2.save(region);
    const ct2 = payload(reloaded);
    expect(ct2).not.toBe(ct1);
    expect(ivOf(ct2)).not.toBe(ivOf(ct1));
    const text2 = serialize(reloaded);
    clearKeys();
    reloaded = parse(text2);
    const s3 = createSealSessions({ getDoc: () => reloaded, ctx: CTX, wipeOnPagehide: false });
    await s3.open(region, PASS);
    expect(find(s3.get(region).doc!.nodes, 'c1')!.title).toBe('First edit');
    expect(find(s3.get(region).doc!.nodes, 'c3')!.title).toBe('Second edit');
    for (const s of [sessions, s2, s3]) s.destroy();
  });

  it('textWidth: region captions wrap at the host autoWidth; re-seal keeps the layout block', async () => {
    const { sessions, region, getDoc } = await setup();
    const ch = autoWrapCh(getDoc().frontmatter?.autoWidth, { fallback: 32 });
    expect(ch).toBe(20);
    await sessions.open(region, PASS);
    const inner = sessions.get(region).doc!;
    find(inner.nodes, 'c1')!.title = 'A long caption that has to wrap inside the cloud';
    const lines = wrapPlain(find(inner.nodes, 'c1')!.title, ch);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.length <= ch)).toBe(true);
    sessions.markChanged(region);
    await sessions.save(region);
    const text = serialize(getDoc());
    expect(text).toMatch(/--- layout ---[\s\S]*autoWidth: 20ch/);
    expect(parse(text).frontmatter?.autoWidth).toBe('20ch');
    sessions.destroy();
  });

  it('focus: one shared state, two-way Map ⇄ Outline, setFocus moves both, no loops', () => {
    const link = createFocusLink();
    const w = wireFocus(link);
    const mapCalls: string[] = [];
    const outCalls: string[] = [];
    w.attachMap({ setFocus: (id) => { mapCalls.push(id); w.onMapFocus(id); return id; } });
    w.attachOutline({ focus: (id) => { outCalls.push(id); w.onOutlineFocus(id); } });
    w.onMapFocus('s:v:c1');
    expect(outCalls).toEqual(['s:v:c1']);
    expect(mapCalls).toEqual([]);
    w.onOutlineFocus('s');
    expect(mapCalls).toEqual(['s']);
    expect(w.setFocus('s:v:c3')).toBe('s:v:c3');
    expect(outCalls.at(-1)).toBe('s:v:c3');
    expect(link.get()).toBe('s:v:c3');
    expect(mapCalls.length + outCalls.length).toBe(4);
  });

  it('follow in text: resume beats layout block, default on; toggle writes the layout block', () => {
    expect(resolveFollowInText(undefined, null)).toBe(true);
    expect(resolveFollowInText({ followText: false }, null)).toBe(false);
    expect(resolveFollowInText({ followText: false }, { version: 1, follow: true })).toBe(true);
    const fm = setFollowInText({}, false);
    const doc = parse('- a\n');
    doc.frontmatter = { ...(doc.frontmatter ?? {}), ...fm };
    expect(serialize(doc)).toContain('follow: off');
    expect(parse(serialize(doc)).frontmatter?.followText).toBe(false);
  });

  it('unlock prompt geometry stays on screen at 390px', () => {
    const b = clampPromptBox({ left: 300, top: 100, bottom: 130 }, { w: 320, h: 170 }, { w: 390, h: 700 });
    expect(b.left).toBeGreaterThanOrEqual(8);
    expect(b.left + b.width).toBeLessThanOrEqual(382);
    const wide = clampPromptBox({ left: 1200, top: 100, bottom: 130 }, { w: 320, h: 170 }, { w: 1280, h: 800 });
    expect(wide.left + wide.width).toBeLessThanOrEqual(1272);
    expect(wide.sheet).toBe(false);
  });
});
