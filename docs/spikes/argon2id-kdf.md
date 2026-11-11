# Spike: Argon2id passphrase KDF

**Branch:** `spike/argon2id-kdf` (local only; do not push, tag, or publish)
**Against:** `@audroam/outline-fold` 0.6.5 (`8149a08`)
**Status:** design + working prototype. Not a release.

This spike covers release gate G2 from [sealed-branches-approval.md](../sealed-branches-approval.md): bundle a pinned, self-hosted Argon2id implementation for passphrase-based key derivation, keep old seals readable, and keep the envelope portable.

## 1. How seals derive keys today

There are three layers. Only the keyring (and the v1 key list) is passphrase-based. The payload itself never runs Argon2 or PBKDF2.

### 1.1 Demo payloads (`demo-aes-gcm`) — not production

[`src/demoCrypto.ts`](../../src/demoCrypto.ts) is demo-only (example outlines, Pages viewer).

| Item | Value | Where |
|---|---|---|
| KDF | PBKDF2-SHA-256 | `deriveKey`, lines 46–71 |
| Iterations | 100_000 | `PBKDF2_ITERS`, line 16 |
| Salt | 16 random bytes, CSPRNG (`crypto.getRandomValues`) | lines 14, 83 |
| Layout | `base64url(salt ‖ iv ‖ ct+tag)` | lines 92–99 |
| Cipher | AES-256-GCM, 12-byte IV, via Web Crypto | lines 86–90 |
| Runtime | Browser WebCrypto, or Node ≥18 `globalThis.crypto` / `webcrypto` | `webCrypto()`, lines 18–27 |

A wrong password or corrupt ciphertext raises a single demo error; this path is not the production envelope.

### 1.2 Production envelope: of-seal-v3 (writes), v2 and v1 (decrypt only)

New seals are of-seal-v3 ([`docs/seal-v3.md`](../seal-v3.md), [`src/sealEnvelope.ts`](../../src/sealEnvelope.ts), [`src/sealedBranch.ts`](../../src/sealedBranch.ts)).

**Payload header (AAD, uint16-length prefixed, fixed order)** — `sealV3Aad` in `sealEnvelope.ts` lines 100–117; parsed by `parseSealV3` lines 149–183:

1. magic `OFSEAL`
2. version `3`
3. alg `a256gcm` or `xc20p`
4. KDF id **`hkdf-sha256`** (not Argon2)
5. salt, 16 raw bytes
6. kid, ASCII
7. seal id, 16 raw bytes, random per seal
8. role `0:body` or `1:autosave`

HKDF-SHA256 (the unwrapped kid secret, the header salt, info `of-seal-v3/wrap`) wraps a fresh 256-bit DEK. Content is AES-256-GCM (96-bit IV) or XChaCha20-Poly1305 (192-bit IV, `@noble/ciphers` 2.4.0). The header is AAD for both wraps. There is no note id, owner id, node id, parent id, or caption in the header, the HKDF info, or the keyring.

**Text layout** (`armorSeal` / `openSealArmor`, `sealEnvelope.ts` 189–231):

```text
-----BEGIN OUTLINE-FOLD SEAL-----
<base64url of the binary, one line>
<crc32, 8 lowercase hex>
-----END OUTLINE-FOLD SEAL-----
```

base64url is RFC 4648, no padding. The CRC-32 (ISO-HDLC) is over the base64url with whitespace removed. Readers first check the CRC: a miss raises `DamagedSealError` (`"damaged in transit"`). A checksum that matches and a tag that does not raises `SealError` (`"Can't unlock"`). Readers ignore spaces, tabs, CR, LF, indentation, and a leading `>` on a line. Writers emit one fixed layout.

### 1.3 Passphrase KDF: the keyring, not the payload

The passphrase is used only to wrap the 256-bit kid secret in `--- keyring ---`.

| Item | Value | Where |
|---|---|---|
| Hook | `setArgon2Provider` — **no implementation is bundled in 0.6.5** | `sealedBranch.ts` 83–104 |
| Default write (no provider) | PBKDF2-SHA-256, **600_000** iterations, 16-byte CSPRNG salt | `PBKDF2_ITERS` line 98; `newKdfParams` 336–338; `kdfBits` 307–321 |
| Default write (provider set) | Argon2id **m=65536 (64 MiB), t=3, p=1**, 16-byte CSPRNG salt | `ARGON2_DEFAULT` line 95; `newKdfParams` 336–338 |
| Writer form (Argon2id) | `$argon2id$v=19$m=<m>,t=<t>,p=<p>$<base64url salt>` | `formatKdfHeader` 143–148 |
| Reader also accepts | legacy `kdf=argon2id&m=…&t=…&p=…&salt=…` | `parseKdfHeader` 161–185 |
| PBKDF2 form | `kdf=pbkdf2-sha256&i=600000&salt=…` | same |
| Accepted Argon2id profiles | default: m≥65536 and t≥3; **or** mobile fallback: m≥32768 and t≥4; p≥1 | `acceptArgon2` 150–159 |
| Rejected | weaker than both profiles, including the OWASP row **m=19456 t=2**; salt ≠ 16 bytes | tests in `tests/sealed-branch.test.ts` 89–95 and `tests/seal-v3.test.ts` 160–166 |
| Caps today | m ≤ 1_048_576 (1 GiB), t ≤ 10, p is a single digit (1–9), salt exactly 16 bytes | `acceptArgon2` 156; PBKDF2 i ≤ 10_000_000 |
| Passphrase encoding | NFC, then the KDF | `kdfBits` line 308 |
| Keyring AAD (v3 wraps) | magic `OFKR`, version `3`, alg `a256gcm`, the kdf string, the salt, the kid | `keyringV3Aad` in `sealEnvelope.ts` 119–129 |
| Legacy wrap AAD still accepted on unwrap | `["of-keyring-v2", "a256gcm", kid, kdf]` | `wrapAad` / `unwrapSecret` 344–397 |

v1 used a `--- keys ---` list (no wrap verifier): `KDF(passphrase NFC, kid salt) → 32 bytes` imported as a non-extractable HKDF key, then per-branch HKDF with note/node binding. v2 used the keyring plus the same kind of host binding. v1 and v2 still decrypt; the next save writes v3. New seals are v3 only.

**Encrypt / decrypt runtime.** AES-GCM and HKDF/PBKDF2 go through Web Crypto (`sealedBranch.ts` `wc()`, 110–115) in the browser or Node. XChaCha20-Poly1305 is pure JS via `@noble/ciphers`. There is no Argon2 in Web Crypto, which is why the provider hook exists.

### 1.4 Bundling / offline viewer constraints

- The package must work **offline**, with **no CDN**.
- The static site (`scripts/build-site.mjs`) copies `dist/` and vendors `@noble/ciphers` into `site/vendor`, then rewrites bare specifiers, because GitHub Pages examples have no bundler or import map.
- `dist/editor.bundle.js` is an esbuild bundle (CodeMirror inlined). An Argon2 dependency that needs a separate `.wasm` fetch would break `file://` and the vendored Pages build unless the WASM is inlined and copied too.
- Gate G10 asks for a strict CSP (no `eval` / `new Function`). A WASM loader that needs `'wasm-unsafe-eval'` is a problem. Pure JS does not.
- Tests today call `setArgon2Provider` with a **SHA-256 stub** so the suite is not blocked on a 64 MiB KDF. `tests/seal-v3.test.ts` does not stub it and therefore writes PBKDF2.

## 2. Library evaluation

Measured 11 Nov 2026 on this box: Node v24.22.1, 8-core Intel Xeon. One derivation, passphrase `"passphrase-for-timing"`, 16-byte salt, `dkLen=32`. Times are wall-clock for **m=65536 t=3 p=1** unless noted.

| | **@noble/hashes 2.4.0** (recommended) | hash-wasm 4.13.0 | argon2-browser 1.18.0 |
|---|---|---|---|
| Licence | MIT | MIT | MIT |
| Last publish | 2026-08-27 | 2026-11-07 | **2021-06-05** (unmaintained) |
| Impl | Pure JS | WASM, often inlined | Official C compiled to WASM; **separate `.wasm` fetch** |
| Browser + Node, offline, no CDN | Yes | Yes, if WASM is inlined and vendored | Poor fit for the static viewer |
| tree-shaken / minified size (esbuild, argon2id only) | **14.0 KiB** | 28.4 KiB | n/a (loader + wasm) |
| npm unpacked size (whole package) | 692 KiB | 1.8 MiB (all hashes) | 132 KiB |
| RFC 9106 §5.3 vector (with secret K and AD X) | **Match** (`key` + `personalization`) | **Cannot**: API has `secret` but no associated-data field | Not evaluated; stale |
| PHC `password`/`somesalt` m=65536 t=2 p=1 | Match, agrees with hash-wasm | Match | — |
| Timing 64 MiB t=3 p=1 | **792 ms sync / 960 ms async** | **197 ms** | — |
| Timing 32 MiB t=4 p=1 (current mobile floor) | 510 ms | 121 ms | — |
| Timing 19 MiB t=2 p=1 (OWASP floor) | 163 ms | 43 ms | — |
| Progress / yielding | `argon2idAsync`, `asyncTick`, `onProgress` (helps OF-32) | Promise only | — |
| Fit with this package | Same maintainer and pin pattern as `@noble/ciphers` 2.4.0, already a runtime dependency | Faster, but extra vendor/CSP surface and no RFC AD | Reject |

**Recommendation: pin `@noble/hashes` at exactly `2.4.0`.** Reasons, in order:

1. Pure JS satisfies the offline static viewer and CSP gate without a WASM story.
2. It reproduces the official RFC 9106 §5.3 tag, including K and X, which is gate 7b.
3. It is already in the noble family this package vendors; site vendoring is the same rewrite already used for ciphers.
4. 0.8 s for the default profile, once per unlock (not per seal), is acceptable on this desktop-class CPU. Mobile may be several times slower; that is what the 32 MiB / t=4 fallback is for.
5. hash-wasm stays a documented alternative if a later mobile measurement shows noble is too slow. It must not be chosen only for the 4× desktop speed-up, given the RFC-vector and WASM costs.

This spike prototypes the noble path and vendors `@noble/hashes` in `scripts/build-site.mjs` the same way as ciphers.

## 3. Design (for the eventual landing, not only the prototype)

The format stays portable and self-describing. KDF parameters live in the **keyring header** as plain ASCII in a fixed order. The transit checksum is checked before decryption. Readers decode tolerantly; writers use one layout. There is no app binding inside the block. Old seals stay readable.

### 3.1 No new payload version

of-seal-v3 already stores `kdf=hkdf-sha256` on the **payload**. The passphrase KDF is a field on the **keyring entry**. Switching writes from PBKDF2 to Argon2id does **not** need of-seal-v4. Old PBKDF2 keyrings keep decrypting; new wraps write Argon2id once a provider is installed.

### 3.2 Parameter floors and defaults

OWASP Password Storage Cheat Sheet (current, confirmed 2026) treats these Argon2id rows as a **minimum**, all with p=1: m=47104 t=1; **m=19456 (19 MiB) t=2**; m=12288 t=3; m=9216 t=4; m=7168 t=5.

This package already ships a **tighter** policy, and tests enforce it:

| Role | Params | Notes |
|---|---|---|
| **Write default** | m=65536 (64 MiB), t=3, p=1 | Already `ARGON2_DEFAULT`. RFC 9106 second recommendation is 64 MiB / t=3 / p=4; we keep **p=1** (one lane, predictable on shared devices). |
| **Mobile fallback (accepted on read; not auto-selected on write)** | m=32768 (32 MiB), t=4, p=1 | Already `ARGON2_FLOOR`. Stronger than OWASP 19 MiB / t=2. |
| **Rejected on read** | Anything weaker than both profiles, including **m=19456 t=2** | Already tested. G2 text still mentions 19 MiB / t=2 as the measured mobile floor; the code moved on. **Open decision** whether to keep the tighter floor (recommended) or re-open 19 MiB / t=2. |

`m` is in KiB in the header, as in RFC 9106 and the PHC string.

### 3.3 Hostile-header caps (DoS)

Today a well-formed header with m=1_048_576 (1 GiB) and t=10 is accepted. That can freeze a tab. Recommend tightening on read **and** in the KDF module, as a follow-up (not changed in this prototype, so existing parser tests stay stable):

| Param | Proposed cap | Today |
|---|---|---|
| m | ≤ 131072 (128 MiB), preferably ≤ 65536 unless a documented profile needs more | 1_048_576 |
| t | ≤ 6 | 10 |
| p | ≤ 4 | 9 (single digit in the regex) |

Below-floor and above-cap headers raise `SealError` (`"Can't unlock"`), not a distinct “weak params” error, so a hostile file cannot be used as an oracle.

### 3.4 Salt

Write **16 bytes** from `crypto.getRandomValues`. Colin’s rule is “16 bytes or more”. The parser today requires **exactly** 16 (`salt.length !== SALT_LEN`). Recommended follow-up: accept 16–64 bytes on read, keep writing 16. **Open decision.**

### 3.5 Keyring follows the same rules

The KDF string is stored on each keyring entry and bound as AAD (`OFKR` / v3). Changing the passphrase re-wraps the keyring and leaves payloads alone. The same floors, caps, salt rules, and PHC writer form apply. A v1 `--- keys ---` entry that still decrypts is not rewritten until a deliberate key change.

### 3.6 Public test vectors (gate 7b)

- RFC 9106 §5.3 Argon2id, including secret K and associated data X, is in `tests/vectors/rfc9106-argon2id.json` and is checked by `tests/kdf-argon2id.test.ts`.
- The PHC `password` / `somesalt` Argon2id vector (m=65536 t=2 p=1, no K/X) is in the same test file.
- Seal-level known-answer vectors (fixed salt, passphrase, header, ct, pt) need a **test-only hook to inject the keyring salt**. That hook is not in this spike. A functional encrypt/decrypt round trip with the real Argon2id default profile is included. A follow-up should add published seal-level vectors once a fixed-salt hook exists (similar to `__encryptForKat`).

### 3.7 Errors

Unchanged, and already distinct:

| Condition | Error | Message |
|---|---|---|
| CRC mismatch, non-canonical base64, missing markers, oversize | `DamagedSealError` | `damaged in transit` |
| Intact envelope, wrong passphrase, tampered header, weak/unknown KDF, missing provider for an Argon2id header | `SealError` | `Can't unlock` |

Check the CRC before any KDF or decrypt. Do not return a more specific “wrong passphrase” from the envelope layer (session UI may say “Wrong passphrase” after a `SealError`, which is a host/session concern).

### 3.8 Installation / default writes

This spike **does not auto-install** the provider, so existing tests that rely on fast PBKDF2 writes stay fast.

- `installDefaultArgon2Provider()` registers the bundled implementation.
- After that, `createKey` / re-wrap writes `$argon2id$v=19$m=65536,t=3,p=1$…`.
- PBKDF2 remains the write fallback only when no provider is registered, and remains valid on decrypt forever (until a later decision to refuse it).

**Open decision:** auto-install from `src/index.ts` when this lands, so hosts and the viewer get Argon2id without a call. Tests that need speed already stub `setArgon2Provider`.

### 3.9 Mobile fallback selection

The parser accepts the 32 MiB / t=4 profile, but `newKdfParams()` always writes the 64 MiB / t=3 default when a provider is set. There is no API yet for a host or the library to choose the mobile profile at wrap time. **Open decision.**

## 4. Prototype (this branch)

Local only. No push, tag, or publish. Audroam and prod are not touched. No secrets in the repo.

| Path | What |
|---|---|
| `src/kdf.ts` | `argon2idDerive`, `createArgon2Provider`, `installDefaultArgon2Provider` |
| `src/index.ts` | re-exports the above |
| `scripts/build-site.mjs` | also vendors `@noble/hashes` for the offline site |
| `tests/kdf-argon2id.test.ts` | RFC + PHC vectors, PBKDF2 still the default write, Argon2id round trip, error split |
| `tests/vectors/rfc9106-argon2id.json` | RFC 9106 §5.3 public vector |
| `package.json` / lockfile | exact dependency `@noble/hashes` `2.4.0` |

The provider matches the existing `Argon2Provider` hook. Optional `key` / `associatedData` exist only so the RFC vector can be checked; the seal path never sets them and must not use them for app binding.

## 5. Open decisions for Colin and the product owner

1. **Library.** Land `@noble/hashes` 2.4.0, or switch to hash-wasm for speed after a mobile timing? Recommendation: noble.
2. **Write default.** Keep m=65536 t=3 p=1? Recommendation: yes.
3. **Read floor.** Keep 32 MiB / t=4 (reject OWASP 19 MiB / t=2), or relax to the OWASP floor as original G2 text said? Recommendation: keep the tighter floor already tested.
4. **Auto-install.** Should the package register the provider itself in a landing PR? Recommendation: yes, when landing, with the SHA-256 stub left in heavy tests.
5. **Version bump.** No of-seal-v4. Package: treat as a **minor** (0.7.0) when G2 lands, or a patch (0.6.6) if you see it as filling a hook already advertised. Recommendation: minor, because new writes change the keyring KDF and a new runtime dependency is added.
6. **Audroam vendored copy.** Do not bump as part of this spike. After a release: re-pin, run the RFC and seal vectors on the host CI, and only then roll the copy that is still on 0.2.40 / 0.4.0 in some hosts.
7. **Salt length.** Keep exact 16, or accept ≥16 (up to 64) on read?
8. **DoS caps.** Tighten m/t/p as in §3.3?
9. **Mobile profile picker.** Add an opt-in to write 32 MiB / t=4, and if so, who decides (library heuristic vs host flag)?
10. **PBKDF2 after G2.** Keep writing it when no provider is installed; always decrypt it. Refuse new PBKDF2 writes once the provider is bundled?

## 6. DevSecOps positions (11 Nov 2026), proposed defaults awaiting Colin's confirmation

| # | Decision | Proposed |
|---|---|---|
| 1 | Library | Land `@noble/hashes` 2.4.0 (MIT, pure JS, about 14 KiB, passes the RFC 9106 §5.3 vector). Look at hash-wasm only if real mobile timing is bad, since it needs a WASM CSP allowance. |
| 2 | Write default | m=65536 (64 MiB), t=3, p=1. |
| 3 | Read floor | Keep the tighter floor: accept only the default profile or the 32 MiB/t=4 mobile profile. Reject OWASP 19 MiB/t=2. |
| 4 | Auto-install | Yes, from `src/index.ts` in the landing PR. Heavy tests keep the stub. |
| 5 | Version | Minor bump, **0.7.0**. Order: the pending 0.6.6 (session ids, branch `fix/map-trailing-url-query`) releases first, then 0.7.0 rebases on it. |
| 6 | Audroam vendored copy | No re-pin in the spike. Re-pin only after a release, with the RFC and seal vectors re-run on the host CI (covers gate 7b). |
| 7 | Salt | Exactly 16 bytes on read and write (strict parser). |
| 8 | DoS caps | Tighten on read and in the KDF to m ≤ 262144 (256 MiB), t ≤ 8, p ≤ 4. Out-of-range values raise the same `"Can't unlock"` SealError (no oracle). Expose progress or cancel through `onProgress`. Note: §3.3 suggested 128 MiB/t≤6; the DevSecOps caps take precedence if Colin agrees. |
| 9 | Mobile profile | An explicit host option at wrap time (for example `kdfProfile: 'default' \| 'mobile'`), no library heuristic. The default stays 64 MiB. |
| 10 | PBKDF2 | Once the provider is auto-installed, stop writing PBKDF2. Keep PBKDF2 decrypt forever for old keyrings. |

Process: DevSecOps reviews the landing PR diff before any push. Push, tag and publish happen only on Colin's "push".

Nothing here is approval to push, tag, publish, or change production.
