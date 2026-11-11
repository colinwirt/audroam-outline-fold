// @vitest-environment happy-dom
// 0.7.0: new-key card (autofill-friendly) and an unlock card with no prefill.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parse, serialize, createKey, unlockKeyring, sealBranch, openSealedBranch, clearKeys,
  mountCreateKeyPrompt, promptPassphrase, MIN_NEW_PASSPHRASE,
} from '../src/index.js';
import { setArgon2Provider, installDefaultArgon2Provider } from '../src/sealedBranch.js';

beforeAll(() => setArgon2Provider(async (pw, salt) => new Uint8Array(createHash('sha256').update(pw).update(salt).digest()) as Uint8Array<ArrayBuffer>));
afterAll(() => installDefaultArgon2Provider());
beforeEach(() => { clearKeys(); document.body.innerHTML = ''; });

const flush = () => new Promise((r) => setTimeout(r, 0));
const type = (input: HTMLInputElement, v: string) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); };

describe('mountCreateKeyPrompt', () => {
  it('empty new-password field, strength line, Create disabled under the minimum', () => {
    const h = mountCreateKeyPrompt({ create: async () => {} });
    const input = h.el.querySelector('input.of-newkey-pass') as HTMLInputElement;
    const ok = h.el.querySelector('.of-unlock-ok') as HTMLButtonElement;
    const strength = h.el.querySelector('.of-newkey-strength') as HTMLElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('new-password');
    expect(input.value).toBe('');
    expect(input.minLength).toBe(MIN_NEW_PASSPHRASE);
    expect(ok.disabled).toBe(true);
    type(input, 'x'.repeat(MIN_NEW_PASSPHRASE - 1));
    expect(strength.textContent).toBe('Strength: Too short');
    expect(ok.disabled).toBe(true);
    type(input, 'x'.repeat(MIN_NEW_PASSPHRASE));
    expect(strength.textContent).toBe('Strength: OK');
    expect(ok.disabled).toBe(false);
    h.close();
  });

  it('account adds a username field for the password manager; Generate fills a word passphrase', () => {
    const h = mountCreateKeyPrompt({ create: async () => {}, account: 'Cafe handoff' });
    const user = h.el.querySelector('input.of-newkey-user') as HTMLInputElement;
    expect(user.getAttribute('autocomplete')).toBe('username');
    expect(user.value).toBe('Cafe handoff');
    const gen = h.el.querySelector('.of-newkey-gen') as HTMLButtonElement;
    gen.click();
    const input = h.el.querySelector('input.of-newkey-pass') as HTMLInputElement;
    expect(input.value.split(' ').length).toBe(5);
    expect((h.el.querySelector('.of-unlock-ok') as HTMLButtonElement).disabled).toBe(false);
    h.close();
    expect(mountCreateKeyPrompt({ create: async () => {}, allowGenerate: false }).el.querySelector('.of-newkey-gen')).toBeNull();
  });

  it('create -> seal -> unlock with the real API; the field is cleared and nothing is kept', async () => {
    const doc = parse('- Root <id:r>\n  - Supplier accounts <id:sup>\n    - Account list goes here <id:a>');
    const pass = 'tidy otter lantern maple rocket';
    const h = mountCreateKeyPrompt({ create: async (p) => { await createKey(doc, p); } });
    const input = h.el.querySelector('input.of-newkey-pass') as HTMLInputElement;
    type(input, pass);
    (h.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(await h.done).toBe(true);
    expect(input.value).toBe('');
    expect(document.body.contains(h.el)).toBe(false);
    await sealBranch(doc, doc.nodes[0]!.children![0]!, doc.keyring![0]!.kid);
    const text = serialize(doc);
    expect(text).not.toContain(pass);
    expect(text).not.toContain('Account list goes here');
    expect(text).toContain('--- keyring ---');

    clearKeys();
    const back = parse(text);
    const done = promptPassphrase({ kid: 'k1', attempt: async (p) => { await unlockKeyring(back, p); return true; } });
    const card = document.querySelector('.of-unlock') as HTMLElement;
    const unlock = card.querySelector('input.of-unlock-pass') as HTMLInputElement;
    expect(unlock.value).toBe(''); // never prefilled
    expect(unlock.getAttribute('autocomplete')).toBe('current-password');
    unlock.value = pass;
    (card.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    expect(await done).toBe(true);
    const v = await openSealedBranch(back, 'sup');
    expect(v.doc.nodes[0]!.children![0]!.title).toBe('Account list goes here');
  });

  it('a failed create keeps the card open with an error', async () => {
    const h = mountCreateKeyPrompt({ create: async () => { throw new Error('nope'); } });
    type(h.el.querySelector('input.of-newkey-pass') as HTMLInputElement, 'y'.repeat(20));
    (h.el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await flush(); await flush();
    expect(h.el.classList.contains('is-error')).toBe(true);
    expect(h.el.querySelector('.of-unlock-msg')!.textContent).toBe("Couldn't create the key");
    h.close();
  });
});

describe('promptPassphrase has no prefill option', () => {
  it('the `initial` option is gone from the source', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/sealUi.ts'), 'utf8');
    const block = src.slice(src.indexOf('export interface PassphrasePromptOptions'), src.indexOf('export function promptPassphrase'));
    expect(block).not.toMatch(/\binitial\b/);
  });
});
