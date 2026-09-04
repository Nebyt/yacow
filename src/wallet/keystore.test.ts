import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RustModule } from '../crypto/rust.js';
import { mnemonicToRootKey } from '../crypto/mnemonic.js';
import { accountPublicKeyHex } from '../crypto/derive.js';
import { plateFromRootKey } from '../crypto/plate.js';
import { permsOf } from '../security/fsPerms.js';
import { buildKeystore, decryptRootKey } from './keystore.js';
import { createSoftwareWallet } from './createWallet.js';

const FIXED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon address';
const PASSWORD = 'correct horse battery staple 42!';

beforeAll(async () => {
  await RustModule.load();
});

function fixtureInput() {
  const rootKey = mnemonicToRootKey(FIXED);
  return {
    name: 'test',
    accountPubKey: accountPublicKeyHex(rootKey),
    plate: plateFromRootKey(rootKey),
    rootKeyBytes: Buffer.from(rootKey.as_bytes()),
  };
}

describe('keystore', () => {
  it('round-trips the root key, wipes the input, and rejects a wrong password', () => {
    const input = fixtureInput();
    const expected = Buffer.from(input.rootKeyBytes); // copy before build wipes it
    const ks = buildKeystore(input, PASSWORD);

    // input bytes are wiped after encryption
    expect(input.rootKeyBytes.every((b) => b === 0)).toBe(true);

    const decrypted = decryptRootKey(ks, PASSWORD);
    expect(decrypted.equals(expected)).toBe(true);

    expect(() => decryptRootKey(ks, 'wrong-password-123')).toThrow(/password|authentication/i);
  });
});

describe('createSoftwareWallet', () => {
  it('writes a 0600 keystore, computes the plate, and refuses duplicates', () => {
    const home = mkdtempSync(join(tmpdir(), 'yacow-'));
    const w = createSoftwareWallet({
      name: 'my wallet',
      mnemonic: FIXED,
      password: PASSWORD,
      homeDir: home,
    });

    expect(permsOf(w.path)).toBe(0o600);
    expect(w.plate.textPart).toBe('EHKL-5865');
    expect(w.name).toBe('my-wallet');

    expect(() =>
      createSoftwareWallet({
        name: 'my wallet',
          mnemonic: FIXED,
        password: PASSWORD,
        homeDir: home,
      }),
    ).toThrow(/already exists/);
  });
});
