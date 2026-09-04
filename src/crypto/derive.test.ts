import { RustModule } from './rust.js';
import { deriveBaseAddress } from './derive.js';

const FIXED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon address';

// Golden vectors (regression lock): recomputing after a dep bump must match.
const PREPROD_0 =
  'addr_test1qzz6hulv54gzf2suy2u5gkvmt6ysasfdlvvegy3fmf969y7r3y3kdut55a40jff00qmg74686vz44v6k363md06qkq0qy0adz0';
const MAINNET_0 =
  'addr1qxz6hulv54gzf2suy2u5gkvmt6ysasfdlvvegy3fmf969y7r3y3kdut55a40jff00qmg74686vz44v6k363md06qkq0q8eqdws';

beforeAll(async () => {
  await RustModule.load();
});

describe('deriveBaseAddress', () => {
  it('derives the golden preprod external address (index 0)', () => {
    expect(deriveBaseAddress(FIXED, { index: 0, network: 'preprod' })).toBe(PREPROD_0);
  });

  it('derives the golden mainnet external address (index 0)', () => {
    expect(deriveBaseAddress(FIXED, { index: 0, network: 'mainnet' })).toBe(MAINNET_0);
  });

  it('uses the right bech32 prefix per network', () => {
    expect(deriveBaseAddress(FIXED, { index: 0, network: 'preprod' })).toMatch(/^addr_test1/);
    expect(deriveBaseAddress(FIXED, { index: 0, network: 'mainnet' })).toMatch(/^addr1/);
  });

  it('produces different addresses for different indices', () => {
    const a = deriveBaseAddress(FIXED, { index: 0, network: 'preprod' });
    const b = deriveBaseAddress(FIXED, { index: 1, network: 'preprod' });
    expect(a).not.toBe(b);
  });
});
