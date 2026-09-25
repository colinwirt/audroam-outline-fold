import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEMO_PASSPHRASE,
  demoOpen,
  demoSeal,
  hasSealed,
  isRemoteSealed,
  parse,
  serialize,
  toHtml,
  type OutlineNode,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cafeMd = readFileSync(
  join(__dirname, '../examples/outline-demo.md'),
  'utf8',
);
const fixtures = JSON.parse(
  readFileSync(join(__dirname, '../scripts/demo-plaintexts.json'), 'utf8'),
) as {
  passphrase: string;
  payloads: { id: string; plaintext: string }[];
  remoteStub: { id: string; uri: string; kid: string };
};

function findById(nodes: OutlineNode[], id: string): OutlineNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const hit = findById(n.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe('sealed / enc grammar (v0.2)', () => {
  it('parses inline enc tag → sealed fields (compat)', () => {
    const doc = parse(
      `- Notes <private> <enc:kid=k1;alg=demo-aes-gcm;ct=YWJjZA> <id:n1>\n`,
    );
    expect(doc.nodes[0].sealed).toEqual({
      kid: 'k1',
      ciphertext: 'YWJjZA',
      alg: 'demo-aes-gcm',
    });
    expect(doc.nodes[0].flags).toContain('private');
    expect(hasSealed(doc.nodes[0])).toBe(true);
  });

  it('lean line + trailer ct round-trip', () => {
    const text = `---
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
    const doc = parse(text);
    expect(doc.nodes[0].title).toBe('Secret caption');
    expect(doc.nodes[0].sealed).toEqual({
      kid: 'cafe-x',
      ciphertext: 'c2FtcGxlQ1Q',
      alg: 'demo-aes-gcm',
    });
    const out = serialize(doc);
    expect(out).toMatch(/- Secret caption <encrypted> <id:n1> \(\+\)/);
    expect(out).not.toMatch(/<enc:/);
    expect(out).toContain('--- payloads ---');
    expect(out).toContain('ct: c2FtcGxlQ1Q');
    expect(parse(out).nodes[0].sealed).toEqual(doc.nodes[0].sealed);
  });

  it('uri-only trailer entry', () => {
    const text = `- Cert <encrypted> <id:ins-remote>

--- payloads ---
ins-remote:
  kid: cafe-ins-1
  alg: demo-aes-gcm
  uri: https://example.invalid/sealed/cafe-ins-1.bin
---
`;
    const doc = parse(text);
    expect(isRemoteSealed(doc.nodes[0])).toBe(true);
    expect(doc.nodes[0].sealed?.uri).toBe(
      'https://example.invalid/sealed/cafe-ins-1.bin',
    );
    const out = serialize(doc);
    expect(out).toContain('uri: https://example.invalid/sealed/cafe-ins-1.bin');
    expect(out).not.toContain('ct:');
  });

  it('trailing frontmatter fold- works', () => {
    const text = `- Open <id:a>
- Closed <id:b>

---
fold-: b
collapsedMarker: "(+)"
---
`;
    const doc = parse(text);
    expect(doc.fold.mode).toBe('-');
    expect(doc.fold.ids).toContain('b');
    expect(doc.frontmatter?.collapsedMarker).toBe('(+)');
  });

  it('head+tail merge: tail wins', () => {
    const text = `---
fold-: a
collapsedMarker: "[+]"
---
- A <id:a>
- B <id:b>

---
fold-: b
collapsedMarker: "(+)"
---
`;
    const doc = parse(text);
    expect(doc.fold.ids).toEqual(['b']);
    expect(doc.frontmatter?.collapsedMarker).toBe('(+)');
  });

  it('infers encrypted flag when enc present without private/encrypted', () => {
    const doc = parse(`- Vault <enc:kid=k2;ct=eHl6> <id:vault-1>\n`);
    expect(doc.nodes[0].flags).toContain('encrypted');
    expect(doc.nodes[0].sealed?.kid).toBe('k2');
  });

  it('hyphen ids + trailer still work', () => {
    const doc = parse(
      `- Item <private> <id:todo-1> (+)

--- payloads ---
todo-1:
  kid: k-hy
  alg: demo-aes-gcm
  ct: YWJj
---
`,
    );
    expect(doc.nodes[0].id).toBe('todo-1');
    expect(doc.fold.ids).toContain('todo-1');
    expect(doc.nodes[0].sealed?.kid).toBe('k-hy');
  });
});

describe('demoSeal / demoOpen', () => {
  it('demoSeal → demoOpen recovers plaintext', async () => {
    const sealed = await demoSeal('hello cafe', DEMO_PASSPHRASE, 'kid-a');
    expect(sealed.ciphertext!.length).toBeGreaterThan(20);
    expect(await demoOpen(sealed, DEMO_PASSPHRASE)).toBe('hello cafe');
  });

  it('wrong passphrase fails', async () => {
    const sealed = await demoSeal('secret', DEMO_PASSPHRASE, 'kid-b');
    await expect(demoOpen(sealed, 'wrong-pass')).rejects.toThrow(/decrypt/i);
  });

  it('remote uri payload cannot demoOpen (host must fetch)', async () => {
    await expect(
      demoOpen(
        {
          kid: 'r1',
          uri: 'https://example.invalid/sealed/x.bin',
          alg: 'demo-aes-gcm',
        },
        DEMO_PASSPHRASE,
      ),
    ).rejects.toThrow(/remote/i);
  });
});

describe('cafe fixture (lean + trailer)', () => {
  it('outline lines have no inline ct=', () => {
    const body = cafeMd.split('--- payloads ---')[0] ?? cafeMd;
    expect(body).not.toMatch(/ct=/);
    expect(body).not.toMatch(/<enc:/);
  });

  it('each inline sealed id opens with demo passphrase', async () => {
    expect(fixtures.passphrase).toBe(DEMO_PASSPHRASE);
    const doc = parse(cafeMd);
    for (const p of fixtures.payloads) {
      const node = findById(doc.nodes, p.id);
      expect(node, p.id).toBeTruthy();
      expect(hasSealed(node!), p.id).toBe(true);
      expect(isRemoteSealed(node!), p.id).toBe(false);
      expect(await demoOpen(node!.sealed!, DEMO_PASSPHRASE)).toBe(p.plaintext);
    }
  });

  it('remote stub parses uri only (no live fetch)', () => {
    const doc = parse(cafeMd);
    const node = findById(doc.nodes, fixtures.remoteStub.id);
    expect(node).toBeTruthy();
    expect(isRemoteSealed(node!)).toBe(true);
    expect(node!.sealed?.uri).toBe(fixtures.remoteStub.uri);
    expect(node!.sealed?.ciphertext).toBeUndefined();
  });

  it('serialize round-trip keeps trailer, lean titles', () => {
    const doc = parse(cafeMd);
    const out = serialize(doc);
    expect(out).toContain('--- payloads ---');
    expect(out.split('--- payloads ---')[0]).not.toMatch(/ct=/);
    const doc2 = parse(out);
    for (const p of fixtures.payloads) {
      expect(findById(doc2.nodes, p.id)?.sealed?.ciphertext).toBe(
        findById(doc.nodes, p.id)?.sealed?.ciphertext,
      );
    }
  });
});

describe('toHtml sealed chrome', () => {
  it('includes locked chrome + data-kid; does not put raw ct in visible title', () => {
    const ct = 'SUPER_SECRET_CT_SHOULD_NOT_APPEAR_IN_TITLE';
    const doc = parse(
      `- Payroll notes <private> <id:payroll> (+)

--- payloads ---
payroll:
  kid: cafe-pay-1
  alg: demo-aes-gcm
  ct: ${ct}
---
`,
    );
    const html = toHtml(doc);
    expect(html).toContain('data-sealed="true"');
    expect(html).toContain('data-kid="cafe-pay-1"');
    expect(html).toContain('data-sealed-mode="inline"');
    expect(html).not.toContain(ct);
    const titleMatch = html.match(/class="of-title">([^<]*)<\/span>/);
    expect(titleMatch?.[1]).toBe('Payroll notes');
  });

  it('remote sealed emits data-sealed-uri + mode=remote', () => {
    const doc = parse(
      `- Cert <encrypted> <id:ins-remote>

--- payloads ---
ins-remote:
  kid: cafe-ins-1
  uri: https://example.invalid/sealed/x.bin
---
`,
    );
    const html = toHtml(doc);
    expect(html).toContain('data-sealed-mode="remote"');
    expect(html).toContain(
      'data-sealed-uri="https://example.invalid/sealed/x.bin"',
    );
  });
});
