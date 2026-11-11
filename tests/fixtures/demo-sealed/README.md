# DEV-ONLY: demo-crypto fixtures

**Not a production pattern. Do not copy anything here into examples or apps.**

These are the 0.6.x example outlines with their old locked rows, kept only so the
test suite can check the legacy `demo-aes-gcm` grammar and the internal
`src/demoCrypto.ts` fixture. They use:

- demo crypto (`demo-aes-gcm`: PBKDF2-SHA256 100k + AES-GCM, no keyring, no AAD), and
- one fake shared password in [`dev-values.json`](./dev-values.json).

Both are exactly what a real deployment must not do. The production model is the
of-seal-v3 envelope plus a keyring wrapped by Argon2id from each reader's own
passphrase, with the unlock handled by the host app. See the README's
**Production model** and **Secure quick start**.

`src/demoCrypto.ts` is not exported from the package. A test
(`tests/no-demo-crypto-public.test.ts`) fails if `src/index.ts`, `examples/`,
`scripts/build-site.mjs`, or the README mention it.
