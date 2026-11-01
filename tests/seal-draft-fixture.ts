// Shared fixture for SEAL-DRAFT tests: fake KDF via __installSecretForKat (no Argon2/PBKDF2 cost).
import { parse, sealBranch, setSealCipher, openSealedBranch, type OutlineFoldDoc, type OutlineNode, type SealedPayload, type SealedViewerHooks } from '../src/index.js';
import { __installSecretForKat } from '../src/sealedBranch.js';

export const CTX = { noteId: 'note-1', ownerId: 'owner-1' };
export const MARK = 'PLAINTEXT-MARKER-7f3a';
export const SRC = `- Root <id:r>
  - Vault <id:v>
    - ${MARK} line one <id:c1>
    - line two <id:c2>
  - Public <id:s>
`;
const SECRET = new Uint8Array(32).map((_, i) => i + 1) as Uint8Array<ArrayBuffer>;
export const RING = { kid: 'k1', kdf: 'kdf=argon2id&m=65536&t=3&p=1&salt=AAAAAAAAAAAAAAAAAAAAAA', wrap: 'a256gcm.AAAAAAAAAAAAAAAA.' + 'A'.repeat(64) };

export function find(nodes: OutlineNode[] | undefined, id: string): OutlineNode | undefined {
  for (const n of nodes ?? []) { if (n.id === id) return n; const h = find(n.children, id); if (h) return h; }
  return undefined;
}

export async function unlock(): Promise<void> {
  await __installSecretForKat('k1', SECRET);
}

/** A doc with branch `v` sealed under k1 (key unlocked). */
export async function sealedDoc(): Promise<OutlineFoldDoc> {
  setSealCipher('a256gcm');
  await unlock();
  const doc = parse(SRC);
  doc.keyring = [{ ...RING }];
  await sealBranch(doc, find(doc.nodes, 'v')!, 'k1', CTX);
  return doc;
}

export function payload(doc: OutlineFoldDoc): SealedPayload {
  return find(doc.nodes, 'v')!.sealed!;
}

/** Fake clock that advances one minute per read unless set. */
export function fakeNow(start = Date.parse('2026-11-01T01:40:00Z')) {
  let t = start;
  return { now: () => new Date(t), set: (iso: string | number) => { t = typeof iso === 'number' ? iso : Date.parse(iso); }, add: (ms: number) => { t += ms; } };
}

export async function open(doc: OutlineFoldDoc, hooks: SealedViewerHooks = {}) {
  return openSealedBranch(doc, 'v', CTX, hooks);
}

/** Edit the viewer: append a child line under the root. */
export function addLine(v: { doc: OutlineFoldDoc }, title: string): void {
  const r = v.doc.nodes[0]!;
  (r.children ??= []).push({ title, depth: 1 } as OutlineNode);
}

export function rootLines(v: { doc: OutlineFoldDoc }): string[] {
  return (v.doc.nodes[0]!.children ?? []).map((c) => c.title);
}
