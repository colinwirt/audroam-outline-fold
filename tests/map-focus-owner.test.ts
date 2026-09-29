import { describe, it, expect } from 'vitest';
import {
  mapHostOwnsFocus,
  mapPaintFocusAction,
  mapPaintShouldRestoreFocus,
  mapKeyboardShouldHandle,
  mapNodeDomId,
} from '../src/index.js';

/**
 * 0.2.16 single stable focus owner. Root cause of the 0.2.12–0.2.15 regression:
 * click focused a per-node <g>; paint() rewrote host.innerHTML, detaching it
 * (focus → <body>), and the post-paint check `host.contains(oldNode)` was
 * false for the detached node, so focus was never restored and every Map key
 * was rejected by the gate.
 */

type FakeNode = { name: string; isConnected: boolean; parent?: FakeNode | null };

function makeTree() {
  const host: FakeNode & { contains: (n: Node | null) => boolean } = {
    name: 'host',
    isConnected: true,
    contains(n: Node | null) {
      let cur = n as unknown as FakeNode | null;
      while (cur) {
        if (cur === (host as FakeNode)) return true;
        cur = cur.parent ?? null;
      }
      return false;
    },
  };
  const node: FakeNode = { name: 'g', isConnected: true, parent: host };
  const body: FakeNode = { name: 'body', isConnected: true, parent: null };
  const textarea: FakeNode = { name: 'textarea', isConnected: true, parent: null };
  /** simulate host.innerHTML = … : old child detached */
  const detach = () => {
    node.parent = null;
    node.isConnected = false;
  };
  return { host, node, body, textarea, detach };
}

const N = (x: unknown) => x as Node;

describe('mapHostOwnsFocus', () => {
  it('true for host itself or a descendant; false for outside/null', () => {
    const { host, node, body, textarea } = makeTree();
    expect(mapHostOwnsFocus(host, N(host))).toBe(true);
    expect(mapHostOwnsFocus(host, N(node))).toBe(true);
    expect(mapHostOwnsFocus(host, N(body))).toBe(false);
    expect(mapHostOwnsFocus(host, N(textarea))).toBe(false);
    expect(mapHostOwnsFocus(host, null)).toBe(false);
  });

  it('regression: a node detached by paint no longer counts (why a pre-paint snapshot is required)', () => {
    const { host, node, detach } = makeTree();
    const before = mapHostOwnsFocus(host, N(node));
    detach();
    expect(before).toBe(true);
    expect(mapHostOwnsFocus(host, N(node))).toBe(false);
    // deprecated alias shares semantics
    expect(mapPaintShouldRestoreFocus(host, N(node))).toBe(false);
  });
});

describe('mapPaintFocusAction', () => {
  it('never steals focus when the map did not own it before paint (textarea typing)', () => {
    const { host, textarea, body } = makeTree();
    expect(
      mapPaintFocusAction({ hadFocus: false, isActive: true, host, activeElementAfter: N(textarea) }),
    ).toBe('none');
    expect(
      mapPaintFocusAction({ hadFocus: false, isActive: true, host, activeElementAfter: N(body) }),
    ).toBe('none');
  });

  it('keeps focus when the stable host still owns it after paint', () => {
    const { host } = makeTree();
    expect(
      mapPaintFocusAction({ hadFocus: true, isActive: true, host, activeElementAfter: N(host) }),
    ).toBe('keep');
  });

  it('re-focuses the HOST (not a node) when paint dropped focus to body', () => {
    const { host, body } = makeTree();
    expect(
      mapPaintFocusAction({ hadFocus: true, isActive: true, host, activeElementAfter: N(body) }),
    ).toBe('focus-host');
    expect(
      mapPaintFocusAction({ hadFocus: true, isActive: true, host, activeElementAfter: null }),
    ).toBe('focus-host');
  });

  it('treats a detached former child as lost focus', () => {
    const { host, node, detach } = makeTree();
    const hadFocus = mapHostOwnsFocus(host, N(node));
    detach();
    expect(
      mapPaintFocusAction({ hadFocus, isActive: true, host, activeElementAfter: N(node) }),
    ).toBe('focus-host');
  });

  it('does nothing while Map is inactive (Outline mode)', () => {
    const { host, body } = makeTree();
    expect(
      mapPaintFocusAction({ hadFocus: true, isActive: false, host, activeElementAfter: N(body) }),
    ).toBe('none');
  });
});

describe('mapKeyboardShouldHandle with host as focus owner', () => {
  it('accepts keys when the host itself is focused (target = host)', () => {
    const { host } = makeTree();
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'DIV' },
        activeElement: N(host),
        host,
      }),
    ).toBe(true);
  });

  it('rejects modifier chords (copy, tab switch) and textarea targets', () => {
    const { host, textarea } = makeTree();
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'DIV' },
        activeElement: N(host),
        host,
        modifier: true,
      }),
    ).toBe(false);
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'TEXTAREA' },
        activeElement: N(textarea),
        host,
      }),
    ).toBe(false);
  });

  it('rejects body focus (no global fallback)', () => {
    const { host, body } = makeTree();
    expect(
      mapKeyboardShouldHandle({
        isActive: true,
        target: { tagName: 'BODY' },
        activeElement: N(body),
        host,
      }),
    ).toBe(false);
  });
});

describe('mapNodeDomId', () => {
  it('is stable, prefix-scoped and a valid id token', () => {
    expect(mapNodeDomId('ofmap1', 'menu')).toBe('ofmap1-n-menu');
    expect(mapNodeDomId('ofmap1', 'menu')).toBe(mapNodeDomId('ofmap1', 'menu'));
    expect(mapNodeDomId('ofmap1', 'menu')).not.toBe(mapNodeDomId('ofmap2', 'menu'));
    const odd = mapNodeDomId('ofmap1', 'a b/"c"');
    expect(odd).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(odd).not.toBe(mapNodeDomId('ofmap1', 'a_b_c'));
  });
});
