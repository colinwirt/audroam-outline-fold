/**
 * 0.6.2: package cloud write must not duplicate sibling lines (beta note 42107 shape).
 * Invented fixtures for setNodeCloud/commitView/mergeKeeping with identical MITRE titles
 * all stay green — package contract. Host applyStyle/graftShownDoc remains the suspect
 * when Map shows extra MITRE pills after a Cloud tap on beta.
 */
import { describe, expect, it } from 'vitest';
import { parse, serialize, mergeKeeping } from '../src/index.js';
// @ts-ignore
import { mountOutlineFold } from './_host.mjs';

const BETA = [
  '- Readings <id:1>',
  '  - Paper https://doi.org/10.3390/fi11030063 <id:3>',
  '    - collection of different organisations <id:4>',
  '    - MITRE https://www.mitre.org/capabilities/cybersecurity/threat-based-defense <id:5>',
  '    - MITRE https://www.mitre.org/capabilities/cybersecurity/threat-based-defense <id:6>',
  '    - MITRE https://www.mitre.org/capabilities/cybersecurity/threat-based-defense <id:7>',
  '    - MITRE https://www.mitre.org/capabilities/cybersecurity/threat-based-defense',
  '    - MITRE https://www.mitre.org/capabilities/cybersecurity/threat-based-defense <id:8>',
  '',
].join('\n');

function dropTmp(text: string) {
  return text.replace(/\s*<id:__tmp-\d+>/g, '');
}

function mitreCount(text: string): number {
  return text.split('\n').filter((l) => /MITRE/.test(l)).length;
}

describe('0.6.2 cloud write does not duplicate siblings (package contract)', () => {
  it('commitView cloud on top child (collection) keeps MITRE count and one cloud tag', () => {
    const fh = mountOutlineFold({
      text: BETA,
      debounceMs: 1e9,
      keep: { dropSessionIds: dropTmp },
    });
    const view = parse(fh.getText(), { sessionIds: true });
    const collection = view.nodes[0]!.children![0]!.children![0]!;
    expect(collection.title).toMatch(/collection/i);
    collection.cloud = 'default';
    fh.markView();
    expect(fh.commitView(view, 'map')).toBe(true);
    const text = fh.getText();
    expect(mitreCount(text)).toBe(5);
    expect(text.split('\n').filter((l) => /collection/.test(l)).length).toBe(1);
    expect(text).toMatch(/collection of different organisations <cloud> <id:4>/);
  });

  it('commitView cloud on Paper parent keeps MITRE count; <cloud> before <id:>', () => {
    const fh = mountOutlineFold({
      text: BETA,
      debounceMs: 1e9,
      keep: { dropSessionIds: dropTmp },
    });
    const view = parse(fh.getText(), { sessionIds: true });
    view.nodes[0]!.children![0]!.cloud = 'default';
    fh.markView();
    fh.commitView(view, 'map');
    const text = fh.getText();
    expect(mitreCount(text)).toBe(5);
    expect(text).toMatch(/Paper[^\n]*<cloud> <id:3>/);
  });

  it('mergeKeeping: prev has id-less MITREs, next adds cloud — no explosion', () => {
    const prev = BETA;
    const view = parse(prev, { sessionIds: true });
    const norm = dropTmp(serialize(view));
    view.nodes[0]!.children![0]!.children![0]!.cloud = 'default';
    const next = dropTmp(serialize(view));
    const merged = mergeKeeping(prev, norm, next);
    expect(mitreCount(merged)).toBe(5);
    expect(merged).toMatch(/collection of different organisations <cloud>/);
  });
});
