// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { createIconToolbarButton, currentIconPicker, openIconPicker } from '../src/emoji/picker.js';

afterEach(() => { currentIconPicker()?.close(false); document.body.innerHTML = ''; });

function firstCell(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="of-ep"] .of-ep-cell, [data-testid="of-ep"] [role="gridcell"]');
}

describe('0.5.30 toolbar Icon button is a toggle', () => {
  it('press opens with aria-pressed=true; press again closes with aria-pressed=false', () => {
    const b = createIconToolbarButton({ mode: 'node', onPick: () => {} });
    document.body.appendChild(b);
    expect(b.getAttribute('aria-pressed')).toBe('false');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    b.click();
    expect(currentIconPicker()).not.toBeNull();
    expect(b.getAttribute('aria-pressed')).toBe('true');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    b.click();
    expect(currentIconPicker()).toBeNull();
    expect(b.getAttribute('aria-pressed')).toBe('false');
  });
  it('stays open across several picks', () => {
    const picks: string[] = [];
    const b = createIconToolbarButton({ mode: 'node', onPick: (t) => picks.push(t) });
    document.body.appendChild(b);
    b.click();
    for (let i = 0; i < 3; i++) {
      const c = firstCell();
      expect(c).not.toBeNull();
      c!.click();
    }
    expect(picks.length).toBe(3);
    expect(currentIconPicker()).not.toBeNull();
    expect(b.getAttribute('aria-pressed')).toBe('true');
  });
  it('Esc closes it (from the panel) and clears the pressed state', () => {
    const b = createIconToolbarButton({ mode: 'node', onPick: () => {} });
    document.body.appendChild(b);
    b.click();
    const el = currentIconPicker()!.el;
    // Esc on the panel closes outright when opened as a toggle (no step back to the row).
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(currentIconPicker()).toBeNull();
    expect(b.getAttribute('aria-pressed')).toBe('false');
  });
  it('openIconPicker `toggle` element: a pointerdown on it does not close the picker first', () => {
    const t = document.createElement('button');
    const anchor = document.createElement('div');
    document.body.append(t, anchor);
    openIconPicker({ mode: 'node', anchor, expanded: true, stayOpen: true, toggle: t, onPick: () => {} });
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(currentIconPicker()).not.toBeNull();
  });
});
