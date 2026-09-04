import { RustModule } from './rust.js';
import { mnemonicToRootKey } from './mnemonic.js';
import { plateFromRootKey } from './plate.js';

const FIXED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon address';

beforeAll(async () => {
  await RustModule.load();
});

describe('plate', () => {
  it('derives the golden CIP4 plate label', () => {
    const plate = plateFromRootKey(mnemonicToRootKey(FIXED));
    expect(plate.textPart).toBe('EHKL-5865');
    expect(typeof plate.imagePart).toBe('string');
    expect(plate.imagePart.length).toBeGreaterThan(0);
  });
});
