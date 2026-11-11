/**
 * Map keys: an id-less node at 1-based place N must not share a key with `<id:N>`.
 * 40242 (10 Nov 2026) had that shape: place 11 was "assigned roles", the previous
 * sibling was "asked the candor team to try <cloud> <id:11>". 0.6.6: every node is
 * keyed by a session view key (`__sid-N`); there is no place-number key at all.
 */
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parse, createMapView, serialize, createSessionIndex, isViewKey } from '../src/index.js';

/** Pre-duplicate 40242 shape: 11th node is id-less "assigned roles"; 10th has <id:11>. */
function note40242() {
  return [
    '[-] Set up HashiCorp <id:1>',
    '  - [x] now changed to SAML',
    '  - [-] users need to create',
    '- Domains <cloud>',
    '  - `teamversa.ai` <id:2>',
    '  - `candorcx.ai`',
    '  - [-] add next domain <id:3>',
    '    - using SAML',
    '    - [-] confirm all users can sign in',
    '      - [x] asked the candor team to try <cloud> <id:11>',
    '      - [ ] assigned roles but check if they need more access',
    '    - @someone help <id:10>',
  ].join('\n') + '\n';
}

function walk(ns: any[], f: (n: any) => void) {
  for (const n of ns || []) { f(n); walk(n.children || [], f); }
}
const byTitle = (d: any, re: RegExp) => { let hit: any; walk(d.nodes, (n) => { if (!hit && re.test(n.title || '')) hit = n; }); return hit; };

async function paint(text: string) {
  // No sessionIds: the package path. Ids-less lines must still get unique keys.
  const doc = parse(text);
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 1600 });
  Object.defineProperty(host, 'clientHeight', { value: 1000 });
  document.body.appendChild(host);
  const layout: any = { version: 1, nodes: {}, _source: 'auto-pack' };
  let focus = '11';
  let cur = doc;
  const mv: any = (createMapView as any)(host, {
    getDoc: () => cur,
    setDoc: (d: any) => { cur = d; },
    getLayout: () => layout,
    getFocusId: () => focus,
    setFocusId: (id: string) => { focus = id; },
    nodeColours: true,
    nodeIcons: true,
    nodeClouds: true,
    canPersistWidths: true,
    canMintIds: () => true,
  });
  mv.paint();
  await new Promise((r) => setTimeout(r, 30));
  return { host, mv, layout, doc: () => cur, text: () => serialize(cur) };
}

describe('Map place-vs-id key collision (40242 shape)', () => {
  it('<id:11> and the id-less line at place 11 get distinct view keys; none is a place number', () => {
    const d = parse(note40242());
    const idx = createSessionIndex();
    idx.sync(d);
    const candor = byTitle(d, /asked the candor/);
    const assigned = byTitle(d, /assigned roles/);
    expect(candor.id).toBe('11');
    expect(assigned.id).toBeUndefined();
    const kc = idx.keyOf(candor);
    const ka = idx.keyOf(assigned);
    expect(isViewKey(kc)).toBe(true);
    expect(isViewKey(ka)).toBe(true);
    expect(ka).not.toBe(kc);
    expect(idx.resolve('11')).toBe(kc);
    expect(idx.refOf(kc)).toBe('11');
    expect(idx.refOf(ka)).toBeNull();
    const keys = idx.order();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(isViewKey)).toBe(true);
  });

  it('Map pills have unique view keys; style on 11 lands on the candor line only', async () => {
    const { host, mv, text, doc, layout } = await paint(note40242());
    const sids = [...host.querySelectorAll('.map-node[data-sid]')].map((el) => el.getAttribute('data-sid')!);
    expect(new Set(sids).size).toBe(sids.length);
    expect(sids.every(isViewKey)).toBe(true);
    // The host-facing data-id is the line's id when it has one, never a place number.
    const ids = [...host.querySelectorAll('.map-node[data-id]')].map((el) => el.getAttribute('data-id'));
    expect(ids.filter((id) => id === '11')).toHaveLength(1);

    const candorPill = host.querySelector('.map-node[data-id="11"]')!;
    const assignedKey = mv.viewKey(byTitle(doc(), /assigned roles/));
    const assignedPill = host.querySelector(`.map-node[data-sid="${assignedKey}"]`)!;
    expect(candorPill.textContent).toMatch(/asked the candor team to try/);
    expect(assignedPill.textContent).toMatch(/assigned roles/);
    expect(assignedPill.getAttribute('data-sid')).not.toBe(candorPill.getAttribute('data-sid'));

    mv.setNodeIcon('11', '🔑');
    mv.setNodeColour('11', 'lemon');
    const after = text();
    const candorLines = after.split('\n').filter((l) => /asked the candor/.test(l));
    expect(candorLines).toEqual(['      - [x] asked the candor team to try <cloud> <id:11>']);
    expect(after).toContain('      - [ ] assigned roles but check if they need more access');
    expect(after).toMatch(/11:\n  color: lemon\n  icon: 🔑/);
    expect(after).not.toMatch(/__sid-|__tmp-|__pos-/);

    const assigned = byTitle(doc(), /assigned roles/);
    expect(assigned.icon).toBeUndefined();
    expect(assigned.color).toBeUndefined();
    // The host layout keeps ids; a view key never reaches it.
    expect(Object.keys(layout.nodes).some((k) => /__sid-/.test(k))).toBe(false);
    mv.destroy?.();
  });

  it('a style on the id-less line by its view key lands on that line, not on <id:11>', async () => {
    const { mv, text, doc } = await paint(note40242());
    const key = mv.viewKey(byTitle(doc(), /assigned roles/));
    mv.setNodeColour(key, 'moss');
    const after = text();
    const assigned = byTitle(doc(), /assigned roles/);
    expect(assigned.id).toBeTruthy();
    expect(assigned.id).not.toBe('11');
    expect(after).toContain(`assigned roles but check if they need more access <id:${assigned.id}>`);
    expect(after).toMatch(new RegExp(`\\n${assigned.id}:\\n  color: moss`));
    expect(after).toContain('asked the candor team to try <cloud> <id:11>');
    expect(after).not.toMatch(/\n11:\n  colou?r/);
    expect(after).not.toMatch(/__sid-|__tmp-|__pos-/);
    // Same view key after the id was minted.
    expect(mv.viewKey(assigned)).toBe(key);
    mv.destroy?.();
  });
});
