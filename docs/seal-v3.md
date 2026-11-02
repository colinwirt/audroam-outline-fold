# of-seal-v3

outline-fold owns this envelope. A host stores the block unchanged. It adds no field and no binding inside it. A block copied out of a host opens with outline-fold and the key alone.

v1 and v2 still decrypt. v1 uses the legacy key list and its original note, owner, and node binding. v2 uses the keyring and the same kind of binding. The next save of either writes v3. New seals are v3 only.

## What is bound

The payload header is the AAD. Fields are uint16-length prefixed, in this order:

| Order | Field | Value |
|---|---|---|
| 1 | magic | `OFSEAL` |
| 2 | version | `3` |
| 3 | alg | `a256gcm` or `xc20p` |
| 4 | KDF id | `hkdf-sha256` |
| 5 | salt | 16 raw bytes |
| 6 | kid | key id, ASCII |
| 7 | seal id | 16 raw bytes, random per seal |
| 8 | role | `0:body` or `1:autosave` |

There is no note id, owner id, node id, parent id, or caption in the header, the HKDF info, or the keyring.

HKDF-SHA256 (the kid secret, the header salt, info `of-seal-v3/wrap`) produces the key that wraps a fresh 256-bit DEK. The wrap is AES-256-GCM, 96-bit IV, header as AAD. The content is encrypted under the DEK with a second fresh IV: AES-256-GCM (96-bit) or XChaCha20-Poly1305 (192-bit), same header as AAD. A new seal or re-seal mints a new seal id, DEK, and both IVs.

## Text

Writers use one layout:

```text
-----BEGIN OUTLINE-FOLD SEAL-----
<base64url of the binary, one line>
<crc32, 8 lowercase hex>
-----END OUTLINE-FOLD SEAL-----
```

base64url is RFC 4648, no padding. The CRC-32 (ISO-HDLC) is over the base64url with whitespace removed. It is not the GCM tag. Check it first. A mismatch raises `DamagedSealError` ("damaged in transit"). A checksum that matches and a tag that does not raises `SealError` ("Can't unlock").

Readers ignore spaces, tabs, CR, LF, indentation, and a leading `>` on a line. They take the bytes between the marker lines when the markers are present. Unknown versions, unknown algorithms, and salts under 16 bytes are rejected. Argon2id below m=32768 (32 MiB) and t=4 is rejected, except a header that meets the default profile m=65536 and t=3.

## Keyring

A key id is random or `k1`, `k2`, … It is not a user, account, device, or host id. Argon2id parameters are a PHC-style string with a base64url salt:

```text
$argon2id$v=19$m=65536,t=3,p=1$<salt>
```

The only smaller profile is `$argon2id$v=19$m=32768,t=4,p=1$<salt>`. PBKDF2-SHA256 at 600000 iterations remains the registered fallback when Argon2 is unavailable, in the legacy `kdf=pbkdf2-sha256&i=600000&salt=` form. Legacy Argon2 query headers still parse. A new wrap's AAD is magic `OFKR`, version `3`, alg `a256gcm`, the kdf string, the salt, and the kid. Changing the passphrase re-wraps the keyring and leaves payloads as they are.

## Copies

`portableCopy(doc)` is the note text with payloads and the keyring. `cleanCopy(doc)` is the visible outline: public labels, no ciphertext, no keyring.

## Vectors

`tests/seal-v3.test.ts` is the public vector suite: move, copy, and caption edit; wrapping, CRLF, indentation, and `>` quoting; a changed character (damaged) against a tampered header (wrong key); a KDF below the floor; a short salt; swapped payloads; and one fixed AES-256-GCM seal checked with Node's HKDF and GCM, not with this package's decrypt. v2 known answers stay in `tests/vectors/of-seal-v2-kat.json`. v2 still refuses a move to another note. v3 does not.
