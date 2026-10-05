import type { Bip32PublicKey } from '@emurgo/cardano-serialization-lib-nodejs';
import { RustModule } from './rust.js';
import {
  accountPublicKeyFromHex,
  deriveAccountKey,
  deriveBaseAddress,
  rewardAddressBech32FromAccountPublic,
} from './derive.js';
import { mnemonicToRootKey } from './mnemonic.js';

const FIXED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon address';

// Golden vectors (regression lock): recomputing after a dep bump must match.
const PREPROD_0 =
  'addr_test1qzz6hulv54gzf2suy2u5gkvmt6ysasfdlvvegy3fmf969y7r3y3kdut55a40jff00qmg74686vz44v6k363md06qkq0qy0adz0';
const MAINNET_0 =
  'addr1qxz6hulv54gzf2suy2u5gkvmt6ysasfdlvvegy3fmf969y7r3y3kdut55a40jff00qmg74686vz44v6k363md06qkq0q8eqdws';
// The reward (stake) address of the same account. Unlike the payment vectors
// above, this one was also verified against the chain: both providers report
// this account's stake address, and it is what B12's account lookups use.
const PREPROD_STAKE = 'stake_test1urpcjgmx7962w6hey5hhsd502araxp26kdtgagakhaqtq8s8ke268';
const MAINNET_STAKE = 'stake1u8pcjgmx7962w6hey5hhsd502araxp26kdtgagakhaqtq8squng76';

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

describe('rewardAddressBech32FromAccountPublic', () => {
  const accountPublic = (): Bip32PublicKey =>
    deriveAccountKey(mnemonicToRootKey(FIXED), 0).to_public();

  it('derives the golden preprod reward address', () => {
    expect(rewardAddressBech32FromAccountPublic(accountPublic(), 'preprod')).toBe(PREPROD_STAKE);
  });

  it('derives the golden mainnet reward address', () => {
    expect(rewardAddressBech32FromAccountPublic(accountPublic(), 'mainnet')).toBe(MAINNET_STAKE);
  });

  it('uses the right bech32 prefix per network', () => {
    expect(rewardAddressBech32FromAccountPublic(accountPublic(), 'preprod')).toMatch(
      /^stake_test1/,
    );
    expect(rewardAddressBech32FromAccountPublic(accountPublic(), 'mainnet')).toMatch(/^stake1/);
  });

  it('is derived from the staking key, not from a payment key', () => {
    // The stake address must not change when the payment path changes, which is
    // exactly why one account lookup can answer for every address (B12).
    const stake = rewardAddressBech32FromAccountPublic(accountPublic(), 'preprod');
    const otherPaymentAddress = deriveBaseAddress(FIXED, { index: 7, network: 'preprod' });
    expect(otherPaymentAddress).not.toContain(stake);
    expect(stake).toBe(PREPROD_STAKE);
  });

  it('round-trips through the stored account public key hex', () => {
    // This is how the dashboard and the balance component reach the stake
    // address: from the keystore's public metadata, never from a password.
    const hex = Buffer.from(accountPublic().as_bytes()).toString('hex');
    expect(rewardAddressBech32FromAccountPublic(accountPublicKeyFromHex(hex), 'preprod')).toBe(
      PREPROD_STAKE,
    );
  });
});
