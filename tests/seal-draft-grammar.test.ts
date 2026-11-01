import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse, serialize, validateDocument, type SealedPayload } from '../src/index.js';
import { parsePayloadMap, formatPayloadsBlock } from '../src/payloads.js';
import { ctHash } from '../src/sealDraft.js';

const V1 = JSON.parse(readFileSync(new URL('./vectors/of-seal-v1-fixture.json', import.meta.url), 'utf8'));
const CT = 'ZHVtbXk.AAAAAAAAAAAAAAAA.bG9hZGVk';
const ACT = 'ZHVtbXk.AAAAAAAAAAAAAAAA.YXV0bw';
const GCT = 'ZHVtbXk.AAAAAAAAAAAAAAAA.Z29uZQ';
const H = ctHash(CT);
const FULL = `vault:
  kid: k1
  alg: of-seal-v2
  pub: "Alarm codes"
  ct: ${CT}
  at: 2026-11-01T01:40:00Z
  base: ${ctHash('older')}
  auto-ct: ${ACT}
  auto-at: 2026-11-01T03:12:00Z
  auto-base: ${H}
  gone-ct: ${GCT}
  gone-at: 2026-11-01T03:20:00Z
  gone-by: save
  gone-from: loaded`;

describe('SD-1 payload grammar', () => {
  it('a full entry parses to the in-memory shape', () => {
    expect(parsePayloadMap(FULL).vault).toEqual({
      kid: 'k1', alg: 'of-seal-v2', pub: 'Alarm codes', ciphertext: CT, at: '2026-11-01T01:40:00Z', base: ctHash('older'),
      autosave: { ciphertext: ACT, at: '2026-11-01T03:12:00Z', base: H },
      discarded: { ciphertext: GCT, at: '2026-11-01T03:20:00Z', replacedBy: 'save', from: 'loaded' },
    });
  });
  it('ct only parses to {kid, alg, ciphertext} with no extra keys', () => {
    const p = parsePayloadMap(`v:\n  kid: k1\n  alg: of-seal-v2\n  ct: ${CT}`).v!;
    expect(Object.keys(p).sort()).toEqual(['alg', 'ciphertext', 'kid']);
  });
  it('auto-ct without auto-base parses with base undefined', () => {
    const p = parsePayloadMap(`v:\n  kid: k1\n  alg: of-seal-v2\n  ct: ${CT}\n  auto-ct: ${ACT}`).v!;
    expect(p.autosave).toEqual({ ciphertext: ACT });
    expect(p.autosave!.base).toBeUndefined();
  });
  it('an unknown gone-by is dropped by parse and flagged by the validator', () => {
    const block = `v:\n  kid: k1\n  alg: of-seal-v2\n  ct: ${CT}\n  gone-ct: ${GCT}\n  gone-by: lost`;
    expect(parsePayloadMap(block).v!.discarded).toEqual({ ciphertext: GCT });
    const r = validateDocument(`- Vault <id:v>\n\n--- payloads ---\n${block}\n---\n`);
    expect(r.issues.map((i) => i.code)).toContain('payload_draft_bad_reason');
  });
  it('a uri entry with auto-ct is flagged (and gets no slot)', () => {
    const block = `v:\n  kid: k1\n  uri: https://x.test/blob\n  auto-ct: ${ACT}`;
    expect(parsePayloadMap(block).v).toEqual({ kid: 'k1', uri: 'https://x.test/blob' });
    const r = validateDocument(`- Vault <id:v>\n\n--- payloads ---\n${block}\n---\n`);
    expect(r.issues.find((i) => i.code === 'payload_draft_on_uri')?.severity).toBe('warning');
  });
  it('pub is quoted the same way as today', () => {
    const out = formatPayloadsBlock({ v: { kid: 'k1', alg: 'of-seal-v2', pub: 'Say "hi"', ciphertext: CT, autosave: { ciphertext: ACT, base: H } } });
    expect(out).toContain('  pub: "Say \\"hi\\""');
    expect(parsePayloadMap(out.split('\n').slice(1, -1).join('\n')).v!.pub).toBe('Say "hi"');
  });
});

describe('SD-2 serialize round-trip', () => {
  const L: SealedPayload = { kid: 'k1', alg: 'of-seal-v2', ciphertext: CT, at: '2026-11-01T01:40:00Z', base: ctHash('older') };
  const A = { ciphertext: ACT, at: '2026-11-01T03:12:00Z', base: H };
  const D = { ciphertext: GCT, at: '2026-11-01T03:20:00Z', replacedBy: 'discard' as const, from: 'autosave' as const };
  const legacyL: SealedPayload = { kid: 'k1', alg: 'of-seal-v2', ciphertext: CT };
  const cases: [string, SealedPayload][] = [
    ['L', L],
    ['L+A', { ...L, autosave: A }],
    ['L+D', { ...L, discarded: D }],
    ['L+A+D', { ...L, autosave: A, discarded: D }],
    ['A+D on a legacy loaded (no at/base)', { ...legacyL, autosave: A, discarded: D }],
  ];
  it.each(cases)('%s: parse(serialize(doc)) is deep-equal', (_n, p) => {
    const doc = parse('- Vault <id:v>\n');
    doc.nodes[0]!.sealed = structuredClone(p);
    doc.nodes[0]!.title = 'Sealed branch';
    const text = serialize(doc);
    expect(parse(text).nodes[0]!.sealed).toEqual(p);
    expect(serialize(parse(text))).toBe(text); // byte-stable when run twice
  });
  it('keys are written in the fixed order', () => {
    const out = formatPayloadsBlock({ v: { ...L, autosave: A, discarded: D } });
    const keys = out.split('\n').filter((l) => l.startsWith('  ')).map((l) => l.trim().split(':')[0]);
    expect(keys).toEqual(['kid', 'alg', 'ct', 'at', 'base', 'auto-ct', 'auto-at', 'auto-base', 'gone-ct', 'gone-at', 'gone-by', 'gone-from']);
  });
  it('a ct-only note serializes byte-identical to the committed vector', () => {
    const text: string = V1.text;
    const block = (s: string) => s.slice(s.indexOf('--- payloads ---'), s.indexOf('---\n', s.indexOf('--- payloads ---') + 17) + 3);
    expect(block(serialize(parse(text)))).toBe(block(text));
  });
});
