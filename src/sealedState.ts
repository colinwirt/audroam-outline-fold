import type { OutlineFoldDoc, OutlineNode, SealedPayload } from './types.js';

export const SEAL_ALG = 'of-seal-v1';
export const SEALED_PLACEHOLDER = 'Sealed branch';

export function isSealedBranchPayload(p: SealedPayload | undefined): boolean {
  return p?.alg === SEAL_ALG;
}

/** Thrown by serialize() when saving could leak plaintext or lose ciphertext. */
export class SealedSaveError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Refusing to save: sealed branch problem: ${problems.join('; ')}`);
    this.name = 'SealedSaveError';
  }
}

function walk(nodes: OutlineNode[], fn: (n: OutlineNode) => void): void {
  for (const n of nodes) {
    fn(n);
    if (n.children?.length) walk(n.children, fn);
  }
}

export function findSealedOrphans(
  nodes: OutlineNode[],
  payloads: Record<string, SealedPayload>,
): Record<string, SealedPayload> | undefined {
  const ids = new Set<string>();
  walk(nodes, (n) => n.id && ids.add(n.id));
  let out: Record<string, SealedPayload> | undefined;
  for (const [id, p] of Object.entries(payloads)) {
    if (isSealedBranchPayload(p) && !ids.has(id)) (out ??= {})[id] = { ...p };
  }
  return out;
}

/**
 * Structural problems that would make a save leak plaintext or lose ciphertext.
 * The main document only ever holds the sealed line (plaintext lives in a viewer),
 * so a sealed node must be a leaf whose caption is its public label.
 */
export function sealedSaveProblems(doc: OutlineFoldDoc): string[] {
  const errs: string[] = [];
  const seen = new Map<string, number>();
  walk(doc.nodes, (n) => {
    if (!isSealedBranchPayload(n.sealed)) return;
    const label = n.sealed!.pub ?? SEALED_PLACEHOLDER;
    const who = n.id ?? `"${label}"`;
    if (!n.id || n.autoId) errs.push(`${who}: sealed line has no persistent id`);
    else seen.set(n.id, (seen.get(n.id) ?? 0) + 1);
    if (n.children?.length) errs.push(`${who}: sealed line has children (would be saved in clear)`);
    if (n.title !== label) errs.push(`${who}: sealed line caption is not its public label`);
    if (!n.sealed!.ciphertext || !n.sealed!.kid) errs.push(`${who}: sealed line has no ciphertext or kid`);
  });
  for (const [id, c] of seen) if (c > 1) errs.push(`${id}: duplicate sealed id`);
  for (const id of Object.keys(doc.sealedOrphans ?? {})) {
    let back = false;
    walk(doc.nodes, (n) => {
      if (n.id === id && isSealedBranchPayload(n.sealed)) back = true;
    });
    if (!back) errs.push(`${id}: sealed payload has no line (id removed or broken); restore <id:${id}> or discard it explicitly`);
  }
  return errs;
}

export function assertSealedSafe(doc: OutlineFoldDoc): void {
  const errs = sealedSaveProblems(doc);
  if (errs.length) throw new SealedSaveError(errs);
}

/** Explicit, deliberate deletion of an orphaned sealed payload (the ciphertext is gone after save). */
export function discardSealedOrphan(doc: OutlineFoldDoc, id: string): boolean {
  if (!doc.sealedOrphans?.[id]) return false;
  delete doc.sealedOrphans[id];
  if (!Object.keys(doc.sealedOrphans).length) delete doc.sealedOrphans;
  return true;
}

/** Reattach an orphaned payload to a line (e.g. after the id was retyped wrongly). */
export function reattachSealedOrphan(doc: OutlineFoldDoc, id: string, node: OutlineNode): void {
  const p = doc.sealedOrphans?.[id];
  if (!p) throw new Error(`no orphaned sealed payload ${id}`);
  node.id = id;
  delete node.autoId;
  node.sealed = { ...p };
  node.title = p.pub ?? SEALED_PLACEHOLDER;
  node.children = [];
  discardSealedOrphan(doc, id);
}
