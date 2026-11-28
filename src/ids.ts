declare const writtenIdBrand: unique symbol;
declare const sessionKeyBrand: unique symbol;

/** The `<id:>` written on a line. Never a session key. */
export type WrittenId = string & { readonly [writtenIdBrand]: true };

/** Runtime identity. Never serialized. */
export type SessionKey = string & { readonly [sessionKeyBrand]: true };

const SESSION_KEY_PREFIX = '__sid-';

export function writtenId(value: string): WrittenId {
  return value as WrittenId;
}

/** The session key for preorder position `n` (1-based). */
export function sessionKey(n: number): SessionKey {
  return `${SESSION_KEY_PREFIX}${n}` as SessionKey;
}

/** A session key read back from a DOM attribute this package wrote. */
export function sessionKeyFromAttribute(value: string): SessionKey {
  return value as SessionKey;
}
