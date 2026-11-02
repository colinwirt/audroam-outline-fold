// Unseal rewrites the layout trailer through mergeKeeping. An empty fold-: line does not
// round-trip, so a later fold-: 12 used to be inserted beside it. Invented fixture.
import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { parse, serialize, mergeKeeping, toggleFold } from '../src/index.js';

const require = createRequire(import.meta.url);
const Text = require('C:/code/audroam/audroam-api/templates/outlineViewText.js');

function hostSerialize(root: Parameters<typeof serialize>[0], prev: string): string {
  return Text.writeTextWidth(serialize(root), Text.readTextWidth(prev || ''));
}

const PREFIX = '- Garden <id:1>\n- Vault <id:12>\n  - seeds <id:13>\n';

it('a stale empty fold pair is replaced when a real fold id is written', () => {
  const prev = PREFIX + '\n--- keyring ---\nk1:\n  kdf: kdf=pbkdf2-sha256&i=600000&salt=FsbqGP9XtDRj8_ea6JzJVA\n  wrap: a256gcm.LSPWDbZv7dd5qa51.KV0A6cAedVt68VpGc8JMk\n---\n\n--- layout ---\nfold-: \ncollapsedMarker: "(+)"\ntextWidth: 59\n---\n';
  const norm = hostSerialize(parse(prev), prev);
  const next = hostSerialize(toggleFold(parse(prev), '12'), prev);
  const merged = mergeKeeping(prev, norm, next);
  expect(merged.split('\n').filter((l) => /^fold-/.test(l))).toEqual(['fold-: 12']);
  expect(merged.split('\n').filter((l) => /^collapsedMarker:/.test(l))).toHaveLength(1);
  expect(merged).toContain('textWidth: 59');
  expect(merged).toContain('kdf=pbkdf2-sha256&i=600000&salt=FsbqGP9XtDRj8_ea6JzJVA');
  expect(merged).not.toMatch(/\n---\n\n---\n/);
});

it('keeps an outline blank line, and a fold-shaped outline line, on a later edit', () => {
  const prev = '- a <id:1>\n\n- fold-: 12\n- b <id:2>\n';
  const norm = serialize(parse(prev));
  const view = parse(prev);
  view.nodes.push({ id: '3', title: 'c', depth: 0 });
  const merged = mergeKeeping(prev, norm, serialize(view));
  expect(merged).toContain('- a <id:1>\n\n- fold-: 12\n- b <id:2>\n- c <id:3>\n');
});
