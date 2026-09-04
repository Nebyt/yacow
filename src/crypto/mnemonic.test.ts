import { RustModule } from './rust.js';
import { generateMnemonic, isValidMnemonic, mnemonicToRootKey, wordCount } from './mnemonic.js';

// Deterministic 15-word phrase from all-zero entropy (bip39.entropyToMnemonic).
const FIXED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon address';

beforeAll(async () => {
  await RustModule.load();
});

describe('mnemonic', () => {
  it('generates 15-word (default) and 24-word phrases', () => {
    expect(wordCount(generateMnemonic())).toBe(15);
    expect(wordCount(generateMnemonic(24))).toBe(24);
  });

  it('validates a good phrase and rejects bad ones', () => {
    expect(isValidMnemonic(FIXED)).toBe(true);
    expect(isValidMnemonic('not a real mnemonic phrase at all here nope')).toBe(false);
    // right words, wrong checksum
    expect(isValidMnemonic(FIXED.replace(/address$/, 'abandon'))).toBe(false);
    // wrong length (14 words)
    expect(isValidMnemonic(FIXED.split(' ').slice(0, 14).join(' '))).toBe(false);
  });

  it('derives a deterministic root key and throws on an invalid phrase', () => {
    const a = Buffer.from(mnemonicToRootKey(FIXED).as_bytes()).toString('hex');
    const b = Buffer.from(mnemonicToRootKey(FIXED).as_bytes()).toString('hex');
    expect(a).toBe(b);
    expect(() => mnemonicToRootKey('garbage phrase')).toThrow(/Invalid recovery phrase/);
  });
});
