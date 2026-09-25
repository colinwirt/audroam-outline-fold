import { describe, expect, it } from 'vitest';
import { parse, validateDocument } from '../src/index.js';

const HAPPY = `---
fold-: n1
collapsedMarker: "(+)"
---
- Secret caption <encrypted> <id:n1> (+)

--- payloads ---
n1:
  kid: cafe-x
  alg: demo-aes-gcm
  ct: c2FtcGxlQ1Q
---
`;

describe('validateDocument', () => {
  it('happy path: ok with no issues', () => {
    const r = validateDocument(HAPPY);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.doc?.nodes[0]?.id).toBe('n1');
  });

  it('accepts OutlineFoldDoc for re-validate', () => {
    const doc = parse(HAPPY);
    const r = validateDocument(doc);
    expect(r.ok).toBe(true);
    expect(r.doc).toBe(doc);
  });

  it('fold_mode_conflict → ok:false, no doc', () => {
    const r = validateDocument(`---
fold-: a
fold+: b
---
- A <id:a>
`);
    expect(r.ok).toBe(false);
    expect(r.doc).toBeUndefined();
    expect(r.issues.some((i) => i.code === 'fold_mode_conflict')).toBe(true);
    expect(r.issues[0]?.severity).toBe('error');
  });

  it('payload_missing_ct_uri when neither ct nor uri', () => {
    const r = validateDocument(`- Vault <encrypted> <id:v1>

--- payloads ---
v1:
  kid: k1
---
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'payload_missing_ct_uri')).toBe(
      true,
    );
  });

  it('payload_missing_ct_uri when both ct and uri', () => {
    const r = validateDocument(`- Vault <encrypted> <id:v1>

--- payloads ---
v1:
  kid: k1
  ct: YWJj
  uri: https://example.invalid/x.bin
---
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'payload_missing_ct_uri')).toBe(
      true,
    );
  });

  it('payload_missing_kid error by default', () => {
    const r = validateDocument(`- Vault <encrypted> <id:v1>

--- payloads ---
v1:
  ct: YWJj
---
`);
    expect(r.ok).toBe(false);
    const hit = r.issues.find((i) => i.code === 'payload_missing_kid');
    expect(hit?.severity).toBe('error');
    expect(r.doc?.nodes[0]?.sealed?.ciphertext).toBe('YWJj');
  });

  it('singleKeyFallback → warning payload_kid_omitted_single_key', () => {
    const r = validateDocument(
      `- A <encrypted> <id:a>
- B <encrypted> <id:b>

--- payloads ---
a:
  alg: demo-aes-gcm
  ct: YWJj
b:
  alg: demo-aes-gcm
  ct: ZGVm
---
`,
      { singleKeyFallback: true },
    );
    expect(r.ok).toBe(true);
    expect(
      r.issues.filter((i) => i.code === 'payload_kid_omitted_single_key'),
    ).toHaveLength(2);
    expect(r.issues.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('alg_mixed_without_kid under singleKeyFallback', () => {
    const r = validateDocument(
      `- A <encrypted> <id:a>
- B <encrypted> <id:b>

--- payloads ---
a:
  alg: demo-aes-gcm
  ct: YWJj
b:
  alg: other-alg
  ct: ZGVm
---
`,
      { singleKeyFallback: true },
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'alg_mixed_without_kid')).toBe(
      true,
    );
  });

  it('payload_orphan warning', () => {
    const r = validateDocument(`- Only <id:keep>

--- payloads ---
ghost:
  kid: k1
  ct: YWJj
---
`);
    expect(r.ok).toBe(true);
    const hit = r.issues.find((i) => i.code === 'payload_orphan');
    expect(hit?.severity).toBe('warning');
    expect(hit?.nodeId).toBe('ghost');
  });

  it('payload_node_missing_id error', () => {
    const r = validateDocument(
      `- No id but enc <enc:kid=k1;ct=YWJj>\n`,
    );
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'payload_node_missing_id')).toBe(
      true,
    );
  });

  it('duplicate_node_id error', () => {
    const r = validateDocument(`- One <id:dup>
- Two <id:dup>
`);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'duplicate_node_id')).toBe(true);
  });

  it('empty_title warning', () => {
    const r = validateDocument(`- <id:blank>
`);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.code === 'empty_title')).toBe(true);
  });

  it('enc_tag_ignored warning for malformed enc', () => {
    const r = validateDocument(`- Weird <enc:not-a-payload> <id:w1>\n`);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.code === 'enc_tag_ignored')).toBe(true);
  });

  it('warnings do not flip ok', () => {
    const r = validateDocument(`- <id:blank>

--- payloads ---
orphan:
  kid: k1
  ct: YWJj
---
`);
    expect(r.ok).toBe(true);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.every((i) => i.severity === 'warning')).toBe(true);
  });
});
