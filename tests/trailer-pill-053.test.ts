// @vitest-environment happy-dom
// 0.5.3: the locked trailer is hidden behind one pill. Opening it shows the text and does not
// make it editable. Invented fixtures only.
import { it, beforeAll, expect } from 'vitest';
import { EditorView } from '@codemirror/view';
import { createOutlineDoc } from '../src/index.js';
import { mountTextEditor, trailerCut, trailerFenceFrom, trailerLabel } from '../src/editor/textEditor.js';

beforeAll(() => {
  const orig = document.dispatchEvent.bind(document);
  document.dispatchEvent = (e: Event) => { if (e.type === 'selectionchange') return true; return orig(e); };
});

const NOTE = '- A <id:1>\n- B <id:2>\n\n--- payloads ---\n1:\n  ct: SECRET\n---\n\n--- layout ---\nfold-: 1\n---\n';

it('names the fences in order', () => {
  expect(trailerCut(NOTE)).toBe(NOTE.indexOf('\n--- payloads ---'));
  expect(trailerFenceFrom(NOTE)).toBe(NOTE.indexOf('--- payloads ---'));
  expect(trailerLabel(NOTE)).toBe('Payloads · Layout');
  expect(trailerLabel('- A\n--- layout ---\nfontSize: 18\n---\n')).toBe('Layout');
  expect(trailerLabel('- A')).toBe('');
  expect(trailerFenceFrom('--- keys ---\nk1: x\n---\n')).toBe(0);
});

it('hides the trailer until the pill is opened, and a keystroke there does not change it', () => {
  document.body.innerHTML = '';
  const box = document.createElement('div');
  document.body.append(box);
  const doc = createOutlineDoc({ text: NOTE, ctx: () => ({ noteId: '9', ownerId: '' }), wipeOnPagehide: false });
  const ed = mountTextEditor(box, doc, {});
  const view = EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  const visible = () => [...view.contentDOM.querySelectorAll('.cm-line')].map((el) => el.textContent ?? '').join('\n');

  const pill = () => view.contentDOM.querySelector('.of-trailer-pill') as HTMLButtonElement;
  expect(pill().getAttribute('aria-expanded')).toBe('false');
  expect(pill().textContent).toContain('Payloads · Layout');
  expect(visible()).not.toContain('SECRET');
  expect(visible()).not.toContain('--- payloads ---');
  expect(view.state.doc.toString()).toBe(NOTE);

  const fence = trailerFenceFrom(view.state.doc.toString());
  view.dispatch({ changes: { from: fence, to: fence, insert: 'nope\n' }, userEvent: 'input' });
  expect(view.state.doc.toString()).toBe(NOTE);

  pill().click();
  expect(pill().getAttribute('aria-expanded')).toBe('true');
  expect(visible()).toContain('SECRET');
  expect(view.contentDOM.querySelector('.of-trailer-locked')).not.toBeNull();
  view.dispatch({ changes: { from: fence, to: view.state.doc.length, insert: 'replaced' }, userEvent: 'input' });
  expect(view.state.doc.toString()).toBe(NOTE);

  view.dispatch({ changes: { from: 0, to: 0, insert: 'Z' }, userEvent: 'input' });
  expect(view.state.doc.toString().startsWith('Z')).toBe(true);
  expect(view.state.doc.toString()).toContain('SECRET');

  pill().click();
  expect(pill().getAttribute('aria-expanded')).toBe('false');
  expect(visible()).not.toContain('SECRET');
  ed.destroy();
  doc.destroy();
});

it('a whole-note paste still leaves the locked trailer in place', () => {
  document.body.innerHTML = '';
  const box = document.createElement('div');
  document.body.append(box);
  const doc = createOutlineDoc({ text: NOTE, ctx: () => ({ noteId: '9', ownerId: '' }), wipeOnPagehide: false });
  const ed = mountTextEditor(box, doc, {});
  const view = EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  const pasted = '- only\n--- layout ---\nfontSize: 18\n---\n';
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: pasted }, userEvent: 'input.paste' });
  const next = view.state.doc.toString();
  expect(next).toContain('SECRET');
  expect(next).toContain('- only');
  expect(next.indexOf('fontSize: 18')).toBeLessThan(next.indexOf('SECRET'));
  ed.destroy();
  doc.destroy();
});

it('a host write replaces the trailer, and the pill stays closed over the new block', () => {
  document.body.innerHTML = '';
  const box = document.createElement('div');
  document.body.append(box);
  const doc = createOutlineDoc({ text: NOTE, ctx: () => ({ noteId: '9', ownerId: '' }), wipeOnPagehide: false });
  const ed = mountTextEditor(box, doc, {});
  const view = EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  view.dom.querySelector('.of-trailer-pill')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(view.contentDOM.querySelector('.of-trailer-pill')!.getAttribute('aria-expanded')).toBe('true');
  const next = '- C <id:3>\n--- layout ---\nw: 40\n---\n';
  doc.setText(next, { source: 'map', reason: 'map' });
  expect(view.state.doc.toString()).toBe(next);
  const pill = view.contentDOM.querySelector('.of-trailer-pill')!;
  expect(pill.getAttribute('aria-expanded')).toBe('true');
  expect(pill.textContent).toContain('Layout');
  ed.destroy();
  doc.destroy();
});

it('protectTrailer: false shows the trailer and no pill', () => {
  document.body.innerHTML = '';
  const box = document.createElement('div');
  document.body.append(box);
  const doc = createOutlineDoc({ text: NOTE, ctx: () => ({ noteId: '9', ownerId: '' }), wipeOnPagehide: false });
  const ed = mountTextEditor(box, doc, { protectTrailer: false });
  const view = EditorView.findFromDOM(box.querySelector('.cm-editor') as HTMLElement)!;
  expect(view.contentDOM.querySelector('.of-trailer-pill')).toBeNull();
  const visible = [...view.contentDOM.querySelectorAll('.cm-line')].map((el) => el.textContent ?? '').join('\n');
  expect(visible).toContain('SECRET');
  ed.destroy();
  doc.destroy();
});
