import type { OutlineNode, SealedPayload } from './types.js';

/**
 * In-memory open state for sealed branches (never persisted).
 * serialize() consults this so an unlocked branch is always written back as
 * its stored ciphertext and public label, never as plaintext (fail closed).
 */
export interface OpenBranchState {
  payload: SealedPayload;
  lockedTitle: string;
  /** Plaintext snapshot of the inner text, memory only, for dirty checks. */
  snapshot: string;
  depth: number;
}

export const openBranches = new WeakMap<OutlineNode, OpenBranchState>();

export const SEAL_ALG = 'of-seal-v1';
export const SEALED_PLACEHOLDER = 'Sealed branch';

export function isSealedBranchPayload(p: SealedPayload | undefined): boolean {
  return p?.alg === SEAL_ALG;
}
