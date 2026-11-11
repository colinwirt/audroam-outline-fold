# Secure quick start

The simplest supported way to use sealed branches, with real exports only:

1. `mountCreateKeyPrompt` asks for a new passphrase (`autocomplete="new-password"`, at least 16 characters, optional generator).
2. `createKey(doc, pass)` makes a random key and wraps it with Argon2id (64 MiB, t=3, p=1) into `--- keyring ---`.
3. `sealBranch(doc, node, kid)` writes an of-seal-v3 payload (AES-256-GCM by default).
4. `serialize(doc)` is what a host stores: public label, ciphertext, wrapped keyring. No passphrase, no plaintext.
5. `clearKeys()` locks. `promptPassphrase` shows an empty unlock card (autofill-friendly), `unlockKey` unwraps, `openSealedBranch` reads the branch in memory.

Nothing is written to storage, and no password ships with the page. Same envelope and keyring as production; the host app owns where the text is stored and who may unlock.
