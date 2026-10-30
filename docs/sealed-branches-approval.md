# Sealed branches: approval criteria (format `of-seal-v1`)

Status: **draft for approval**. Audience: package maintainers, the security reviewer, and host-app owners.
This lists what outline-fold must provide, and pass, before a host app may use it for
per-branch passphrase encryption.

**Model.** Any node and its subtree can be sealed. A locked branch renders as a single
neutral node. Unlocking renders the inner branch in place. Sealing the whole body means
sealing the root. Sealing a single node means sealing a leaf. The package owns the payload
header, the salt, the nonce and the KDF parameters. The host supplies the passphrase (normally
generated and kept in a password manager; typing it is the exception) and the binding
context (note id, owner id).

---

## 1. MVP (ship first): for owner approval

| # | Item | State on this branch |
|---|---|---|
| M1 | Sealed-branch grammar: the line holds the public label or `Sealed branch` plus `<id:…>`. The material lives in `--- payloads ---` (`alg: of-seal-v1`, `kid`, `ct`, optional `pub`). Keys live in `--- keys ---`. | done |
| M2 | `createKey`, `unlockKey`, `sealBranch`, `unsealBranch`, `lockBranch`, `resealBranch`, `isBranchDirty`, `clearKeys` | done |
| M3 | KDF: **interim PBKDF2-SHA256 600k**, plus a hook for a pinned, self-hosted Argon2id WASM (`setArgon2Provider`). Argon2id m=64MiB t=3 p=1 is used automatically once a provider is registered. **⚠ Choice to flag:** the MVP ships PBKDF2 so it isn't held up waiting for the WASM. Bundling and pinning the Argon2 WASM is release gate G2. | hook done, WASM not bundled |
| M4 | AES-256-GCM via WebCrypto. Core generates a random salt and a fresh nonce on every seal. The AAD covers the header, kid, key header, note id, owner id, node id and parent sealed id. There is one uniform `SealError("Can't unlock")`. | done |
| M5 | Fail-closed serialize: an unlocked branch always writes its stored ciphertext and public label. Its caption, children and edits are never written until `resealBranch`. | done |
| M6 | Rendering: a locked placeholder (`data-sealed-branch="locked"` plus a Decrypt button), unlock in place, re-lock (`data-relock` → `onRelock`). This applies to both Outline (`toHtml`) and Map (which renders from the model). | done (Outline markup + hook; Map uses the model) |
| M7 | Byte-stable round trip. An untouched sealed doc, or an unchanged reseal, gives identical bytes. | done |
| M8 | Tests: an independent KAT (node:crypto reference); tamper tests on each header field; nonce uniqueness; a blob moved to another note, owner, node or parent fails; plaintext is never saved; kid swap; a kid in use cannot be removed; the key list has no verifier; HKDF KAT; the same kid gives different subkeys in two maps. | done (`tests/sealed-branch.test.ts`) |
| M9 | CSP-safe: no eval, no `new Function`, no inline script or handlers. Works under Trusted Types. | code complies; CSP e2e pending |
| M10 | Nested branches (encrypt-then-embed), with depth capped at 4 | done (format, validation, nested unlock) |
| M11 | `removeKey` is blocked while any branch references the kid, or while a locked branch could hide a reference | done |
| M12 | `exportKeyEntry` / `importKeyEntry` (cross-map reuse of a public entry) | done, **needs security-review confirmation** |

**Later (not MVP):** `rotateKey(kid)` (re-seal every branch under a new kid; the host lists
other maps that use the kid and offers to re-seal them, because rotation does not propagate
by itself); passphrase change by re-wrapping; key links (random 256-bit content key only);
mobile Argon2 tuning (measured 19MiB/t=2 floor); multiple recipients; a Map-specific
locked glyph; a demo page.

## 2. Required features

- **Grammar.** A sealed node is a normal outline line. Its caption is the public label
  (`pub`), or `Sealed branch` when there is none, followed by `<id:…>`. A locked branch has no
  plaintext children. Its payload entry has `alg: of-seal-v1`, `kid: <22-char b64url>`,
  `ct: …`, and an optional `pub: "…"` (JSON-quoted, and explicitly public). The real caption is
  **encrypted** along with the subtree.
- **Nesting.** The outer plaintext contains the inner branch still sealed (encrypt-then-embed).
  Opening the outer never opens the inner. By default each branch has its own kid. Reusing the
  outer kid is allowed but returns the warning `same-kid-as-parent: no extra protection`. The
  depth cap is 4. Errors are uniform.
- **APIs.** `parse` and `serialize` (which read and write `--- keys ---`);
  `validateSealedBranches(doc)` (structure only: unknown kid, bad or weak header, plaintext
  children on a locked branch, caption ≠ public label); the seal and unseal APIs from M2.
  `unlockKey` returns the count of visible branches that use the kid and decrypts nothing.
  Each branch is decrypted lazily when it is opened. There is no bulk decrypt into exported or
  serialized text.
- **Seal dialog (host).** Preselect only kids in `unlockedKids()` (unlocked in memory this
  session). Show the selected key's public label before sealing. "New key" stays one click
  away. The host may show "used in N maps" with the warning "one leaked passphrase opens all".
- **Render.** The locked placeholder shows a neutral label and a Decrypt button
  (`onDecrypt(id)`). The open branch is rendered in place with a Lock button
  (`onRelock(id)`). Fold, keyboard and treeitem a11y are unchanged. Only the `data-sealed-*`
  attributes reach the DOM, never ciphertext.
- **Round trip.** An unchanged sealed branch is byte-identical on save.

## 3. Payload format `of-seal-v1`

Key-list entry (`--- keys ---`, public data only, no key-check value or verifier):

```
--- keys ---
<kid>:
  kdf: kdf=argon2id&m=65536&t=3&p=1&salt=<b64url 16B>
  pub: "Optional public label"
---
```

- `kid`: random 128-bit, 22 base64url characters, never derived from the passphrase.
- `kdf`: canonical and strictly ordered. The accepted forms are
  `kdf=argon2id&m=<KiB>&t=<n>&p=<n>&salt=…` (floor m ≥ 19456 and t ≥ 2; default 65536/3/1) and
  `kdf=pbkdf2-sha256&i=<n>&salt=…` (i ≥ 600000, interim only). Anything unknown,
  non-canonical or below the floor is rejected.

Branch `ct` = `b64url(hdr) "." b64url(nonce 12B) "." b64url(ciphertext‖tag 16B)`, where
`hdr = v=1&alg=A256GCM&kdf=hkdf-sha256&salt=<b64url 16B branch salt>`.

- Master key: KDF(passphrase NFC, kid salt) → 32 bytes, computed **once per kid** and imported
  as a non-extractable HKDF key that is held in memory only.
- Branch key: HKDF-SHA256(master, salt = branch salt,
  info = `JSON["of-seal-v1", noteId, nodeId]`) → AES-256-GCM.
- AAD = UTF-8 `JSON["of-seal-aad-1", hdr, kid, kidKdfHeader, noteId, ownerId, nodeId, parentSealedId|""]`.
- Plaintext = `JSON{"v":1,"caption":…,"body":<serialized subtree>}`.
- Encoding: unpadded base64url only, and it must be canonical (re-encoding must give the same
  string). Bounds: salt 16, nonce 12, tag ≥ 16, `ct` ≤ 1.4M chars.
- Versioning: a new `v=` or `alg` means a new format id. Legacy formats (`demo-aes-gcm`) are
  decrypt-only. A header below the floor is rejected, or upgraded when it is next saved.

## 4. Security gates (release blockers)

- [x] G1 Core generates the salt (16B per kid and per branch) and a fresh 12B nonce on every seal. The host cannot pass either one in.
- [ ] G2 Argon2id m=64MiB t=3 p=1 through a **pinned, self-hosted** WASM (hash pinned in the package). The measured mobile fallback 19MiB/t=2 is the floor. PBKDF2-SHA256 600k is used only when Argon2 is unavailable.
- [x] G3 AES-256-GCM via WebCrypto. The full header, kid, note id, owner id, node id and parent id are in the AAD.
- [x] G4 Unknown or weak parameters are rejected. Encoding is canonical.
- [x] G5 One uniform "Can't unlock" error. Fail closed: plaintext is never emitted over existing ciphertext.
- [x] G6 No passphrase or key in logs, events or DOM. Derived keys stay in memory only (never in IndexedDB or storage). `clearKeys()` is available for idle lock and logout.
- [x] G7 The key list holds no verifier. A wrong key produces the uniform error.
- [x] G8 HKDF info binds the note id, so the same kid gives different subkeys in each map.
- [x] G9 The caption is encrypted. Serialize and exported text never contain sealed content.
- [ ] G10 Strict CSP plus Trusted Types e2e passes (no eval or inline).
- [ ] G11 Key links carry only a random 256-bit content key (post-MVP feature; the gate applies once it ships).
- [x] G12 Legacy formats are decrypt-only.
- [ ] G13 Security review confirms cross-map key-entry reuse (`exportKeyEntry`/`importKeyEntry`).

**Accepted residual leakage:** node position, the existence of a sealed branch, ciphertext
size (roughly the subtree size), the kid (and so key reuse across branches and maps), the
public label, and unlock timing. The fold state and layout widths of a branch's own id are
visible. Inner ids are not written while the branch is open.

## 5. Tests required

- Unit (vitest, in CI on every PR): everything in M8, plus weak or unknown header rejection,
  nested open and inner-still-sealed, the same-kid warning, `clearKeys`, and the removeKey
  guard.
- KAT: an independent reference (node:crypto PBKDF2 → HKDF → AES-GCM) with fixed salt and
  nonce, using test-only hooks that are not exported from the package entry, plus a pinned
  snapshot. Argon2id KATs (RFC 9106 vectors) are added together with the WASM.
- e2e (Playwright): seal → reload → placeholder only; unlock in place; re-lock; keyboard
  fold of the open branch; Map pill shows the placeholder; strict CSP plus Trusted Types page
  with no violations; no plaintext in `localStorage`, `IndexedDB` or network bodies after
  save. **Pending.**

## 6. Approval process

1. Maintainers land the work on a branch. CI is green (unit, e2e, build).
2. Tag a **minor** release (proposed `0.3.0`, the next minor after 0.2.42, because of the new
   format and API).
3. The host verifies before re-pinning: the tag's commit and the package integrity hash, the
   Argon2 WASM hash, the KAT vectors re-run on the host's CI, the CSP e2e on the host's real
   headers, and that serialized output contains no plaintext.
4. The release is approved in writing by **the security reviewer and the owner**. Only then
   does the host re-pin.

## 7. Open questions

1. Passphrase per branch vs per document. The current answer is one kid per sealed branch by
   default, with deliberate kid reuse supported. Is that confirmed?
2. Nested sealed branches: is the depth cap of 4 right? Should the host UI hide same-kid
   nesting?
3. Caption leakage to host search and history: the host must not index or log an open
   branch's caption, and must not keep plaintext in undo history after re-lock.
4. Key wrapping: a per-branch random content key wrapped by the passphrase-derived key
   (recommended, so a passphrase change re-wraps instead of re-encrypting). This is a v2
   format.
5. Multiple recipients (several wrapped content keys per branch).
6. Cross-map key reuse: rotation does not propagate. The host must track where a kid is used.
7. `removeKey` is conservative: it is blocked while any locked branch exists, because inner
   references cannot be seen. Is that acceptable, or should the host scan by unlocking?

## 8. Gap analysis (package 0.2.42 → MVP)

| Area | Existed at 0.2.42 | Added on this branch | Still missing | Size |
|---|---|---|---|---|
| Payload trailer | `--- payloads ---` with kid/alg/ct/uri; host crypto | `pub` field; `--- keys ---` block; fail-closed collect | — | S |
| Crypto | `demoCrypto` (PBKDF2 100k, no AAD), demo only | `sealedBranch.ts`: PBKDF2 600k / Argon2 hook, HKDF, AES-GCM, AAD, strict headers | Bundled, pinned Argon2id WASM plus KATs | M |
| Branch semantics | per-node secret payload; children stayed plaintext | caption and subtree encrypted; unlock in place; re-lock; reseal; nesting | rotateKey; re-wrap; key links | M–L |
| Render | locked chrome + Decrypt button | `data-sealed-branch`, Lock button, `onRelock` | Map locked glyph; demo page | S |
| Validation | payload diagnostics | `validateSealedBranches` | Merge it into `validate()` codes | S |
| Tests | `sealed.test.ts` (grammar, demo) | `sealed-branch.test.ts` (26 tests) | e2e and CSP/Trusted Types | M |
