import { MAX_NAME_LEN, sanitizeName } from './createWallet.js';

describe('sanitizeName', () => {
  it('slugifies spaces and strips invalid characters', () => {
    expect(sanitizeName('  My Wallet!!  ')).toBe('My-Wallet');
  });

  it('rejects empty names', () => {
    expect(() => sanitizeName('   ')).toThrow(/contain letters or digits/);
    expect(() => sanitizeName('%%%')).toThrow(/contain letters or digits/);
  });

  it(`rejects names longer than ${MAX_NAME_LEN} characters`, () => {
    expect(() => sanitizeName('a'.repeat(MAX_NAME_LEN + 1))).toThrow(
      new RegExp(`${MAX_NAME_LEN} characters or fewer`),
    );
    expect(sanitizeName('a'.repeat(MAX_NAME_LEN))).toHaveLength(MAX_NAME_LEN);
  });
});
