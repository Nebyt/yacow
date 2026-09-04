import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RustModule } from '../crypto/rust.js';
import { createSoftwareWallet } from './createWallet.js';
import { deleteWallet } from './deleteWallet.js';

const FIXED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon address';
const PASSWORD = 'correct horse battery staple 42!';

beforeAll(async () => {
  await RustModule.load();
});

describe('deleteWallet', () => {
  it('removes an existing keystore and reports success', () => {
    const home = mkdtempSync(join(tmpdir(), 'yacow-'));
    const w = createSoftwareWallet({
      name: 'doomed',
      mnemonic: FIXED,
      password: PASSWORD,
      homeDir: home,
    });
    expect(existsSync(w.path)).toBe(true);
    expect(deleteWallet('doomed', home)).toBe(true);
    expect(existsSync(w.path)).toBe(false);
  });

  it('returns false when the wallet does not exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'yacow-'));
    expect(deleteWallet('ghost', home)).toBe(false);
  });
});
