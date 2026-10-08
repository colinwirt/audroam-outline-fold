/**
 * Note-link URL templates (0.2.34): layout block, then the host option, then the
 * built-in default. `{id}` / `{pnid}` is the note number.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTE_DETAILS_URI,
  DEFAULT_NOTE_MAP_URI,
  noteLinkHrefs,
  noteUriTemplate,
  parse,
  serialize,
} from '../src/index.js';

const fmOf = (text: string) => parse(text).frontmatter;

describe('template resolution order', () => {
  it('built-in defaults when neither the layout nor the host sets one; noteUri has none', () => {
    expect(noteUriTemplate('noteMapUri')).toBe(DEFAULT_NOTE_MAP_URI);
    expect(noteUriTemplate('noteDetailsUri')).toBe(DEFAULT_NOTE_DETAILS_URI);
    expect(noteUriTemplate('noteUri')).toBeNull();
    expect(noteLinkHrefs('41')).toEqual({ note: null, map: '/notes/41/map', details: '/notes/41/details' });
  });

  it('the host option beats the default; null or empty turns the row off', () => {
    const opts = { noteMapUri: '/outline-view?id={id}&map=1', noteDetailsUri: null };
    expect(noteLinkHrefs('41', undefined, opts)).toEqual({ note: null, map: '/outline-view?id=41&map=1', details: null });
    expect(noteLinkHrefs('41', undefined, { noteMapUri: '' }).map).toBeNull();
    expect(noteLinkHrefs('41', undefined, { noteMapUri: undefined }).map).toBe('/notes/41/map');
  });

  it('the layout block beats the host option; none turns the row off for that document', () => {
    const fm = fmOf('- Row\n\n--- layout ---\nnoteMapUri: https://maps.example.org/m/{pnid}\nnoteDetailsUri: none\n---\n');
    const opts = { noteMapUri: '/host/{id}', noteDetailsUri: '/host/d/{id}', noteUri: '/view/{id}' };
    expect(noteLinkHrefs('41', fm, opts)).toEqual({
      note: '/view/41',
      map: 'https://maps.example.org/m/41',
      details: null,
    });
  });

  it('leading frontmatter and trailing YAML carry the keys too (layout block wins)', () => {
    expect(fmOf('---\nnoteMapUri: /a/{id}\n---\n- Row\n')?.noteMapUri).toBe('/a/{id}');
    const both = fmOf('---\nnoteDetailsUri: /a/{id}\n---\n- Row\n\n--- layout ---\nnoteDetailsUri: "/b/{id}"\n---\n');
    expect(both?.noteDetailsUri).toBe('/b/{id}');
  });

  it('a template that does not resolve gives no row: no {id}, or not http(s) / root-relative', () => {
    expect(noteLinkHrefs('41', { noteMapUri: '/static/map' }).map).toBeNull();
    expect(noteLinkHrefs('41', { noteMapUri: 'javascript:alert({id})' }).map).toBeNull();
    expect(noteLinkHrefs('41', { noteDetailsUri: '//evil.example/{id}' }).details).toBeNull();
  });

  it('serialize writes the keys in the layout block and they round-trip', () => {
    const text = '- Row <t:41>\n\n--- layout ---\nfold-: \ncollapsedMarker: "(+)"\nnoteUri: /view/pnid/{id}\nnoteMapUri: /outline-view?id={id}&map=1\nnoteDetailsUri: none\n---\n';
    expect(serialize(parse(text))).toBe(text);
  });
});
