import { RustModule } from '../crypto/rust.js';
import { accountPublicKeyHex, deriveAccountKey } from '../crypto/derive.js';
import { mnemonicToRootKey } from '../crypto/mnemonic.js';
import { GAP_LIMIT, discoverAddresses } from './discovery.js';
import type { ChainProvider } from './provider/types.js';

const MNEMONIC = `${'abandon '.repeat(14)}address`.trim();
const PREPROD_ID = 0;
let accountPubKey: string;

beforeAll(async () => {
  await RustModule.load();
  const rootKey = mnemonicToRootKey(MNEMONIC);
  accountPubKey = accountPublicKeyHex(rootKey);
  deriveAccountKey(rootKey); // sanity: derivation works before the scans below
});

/** A provider that considers exactly the listed addresses used. */
function providerWithUsed(used: Set<string>): { provider: ChainProvider; calls: string[][] } {
  const calls: string[][] = [];
  const provider = {
    id: 'koios',
    network: 'preprod',
    filterUsedAddresses: async (addresses: string[]) => {
      calls.push(addresses);
      return addresses.filter((address) => used.has(address));
    },
  } as unknown as ChainProvider;
  return { provider, calls };
}

describe('discoverAddresses', () => {
  it('stops after one empty window on a fresh wallet', async () => {
    const { provider, calls } = providerWithUsed(new Set());
    const result = await discoverAddresses(provider, accountPubKey, PREPROD_ID);

    expect(result.external.all).toHaveLength(GAP_LIMIT);
    expect(result.external.used).toEqual([]);
    expect(calls).toHaveLength(2); // one window per chain, nothing more
    expect(result.all).toHaveLength(GAP_LIMIT * 2);
  });

  it('offers the first address as next-unused on a fresh wallet', async () => {
    const { provider } = providerWithUsed(new Set());
    const result = await discoverAddresses(provider, accountPubKey, PREPROD_ID);
    expect(result.external.nextUnused).toBe(result.external.all[0]);
  });

  it('keeps scanning while used addresses keep appearing', async () => {
    // Use an address inside the second window, so one window is not enough.
    const { provider: probe } = providerWithUsed(new Set());
    const first = await discoverAddresses(probe, accountPubKey, PREPROD_ID);
    const windowTwoAddress = first.external.all[GAP_LIMIT - 1];

    const { provider, calls } = providerWithUsed(new Set([windowTwoAddress]));
    const result = await discoverAddresses(provider, accountPubKey, PREPROD_ID);

    expect(result.external.used).toEqual([windowTwoAddress]);
    expect(result.external.all.length).toBe(GAP_LIMIT * 2);
    // The gap only resets from the used address, so a second window is needed.
    expect(calls[0]).toHaveLength(GAP_LIMIT);
    expect(result.external.nextUnused).toBe(result.external.all[GAP_LIMIT]);
  });

  it('scans the internal chain too, and the two differ', async () => {
    const { provider } = providerWithUsed(new Set());
    const result = await discoverAddresses(provider, accountPubKey, PREPROD_ID);
    expect(result.internal.role).toBe(1);
    expect(result.internal.all[0]).not.toBe(result.external.all[0]);
    expect(result.all).toEqual([...result.external.all, ...result.internal.all]);
  });

  it('honours a smaller gap limit', async () => {
    const { provider } = providerWithUsed(new Set());
    const result = await discoverAddresses(provider, accountPubKey, PREPROD_ID, { gapLimit: 5 });
    expect(result.external.all).toHaveLength(5);
  });

  it('gives up at maxAddresses when the backend claims everything is used', async () => {
    const provider = {
      filterUsedAddresses: async (addresses: string[]) => addresses,
    } as unknown as ChainProvider;
    const result = await discoverAddresses(provider, accountPubKey, PREPROD_ID, {
      maxAddresses: 40,
    });
    expect(result.external.all).toHaveLength(40);
  });

  it('derives the same addresses the wallet shows elsewhere', async () => {
    const { provider } = providerWithUsed(new Set());
    const result = await discoverAddresses(provider, accountPubKey, PREPROD_ID);
    // Golden vector from the M1 derivation tests (decision 5.4).
    expect(result.external.all[0]).toBe(
      'addr_test1qzz6hulv54gzf2suy2u5gkvmt6ysasfdlvvegy3fmf969y7r3y3kdut55a40jff00qmg74686vz44v6k363md06qkq0qy0adz0',
    );
  });
});

describe('used addresses', () => {
  it('collects the used addresses of both chains for balance queries', async () => {
    const { provider: probe } = providerWithUsed(new Set());
    const derived = await discoverAddresses(probe, accountPubKey, PREPROD_ID);
    const usedOne = derived.external.all[0];
    const usedTwo = derived.internal.all[2];

    const { provider } = providerWithUsed(new Set([usedOne, usedTwo]));
    const result = await discoverAddresses(provider, accountPubKey, PREPROD_ID);
    expect(result.used).toEqual([usedOne, usedTwo]);
  });

  it('is empty for a fresh wallet', async () => {
    const { provider } = providerWithUsed(new Set());
    expect((await discoverAddresses(provider, accountPubKey, PREPROD_ID)).used).toEqual([]);
  });
});

// B12 (plan §14.5): the account path must be indistinguishable from the scan it
// replaces, and it must never become a single point of failure.
describe('account-level discovery', () => {
  const STAKE = 'stake_test1account';

  it('is equivalent to the per-address scan, without asking per address', async () => {
    const { provider: probe } = providerWithUsed(new Set());
    const derived = await discoverAddresses(probe, accountPubKey, PREPROD_ID, { gapLimit: 5 });
    const usedExternal = derived.external.all[1];
    const usedInternal = derived.internal.all[0];

    const { provider: scanning } = providerWithUsed(new Set([usedExternal, usedInternal]));
    const scanned = await discoverAddresses(scanning, accountPubKey, PREPROD_ID, { gapLimit: 5 });

    let perAddressCalls = 0;
    const accountProvider = {
      id: 'blockfrost',
      network: 'preprod',
      filterUsedAddresses: async () => {
        perAddressCalls += 1;
        return [];
      },
      // The account list also carries an address from another derivation path,
      // which must be ignored rather than counted (plan §14.5).
      getAccountAddresses: async () => [usedInternal, 'addr_not_ours', usedExternal],
    } as unknown as ChainProvider;

    const fromAccount = await discoverAddresses(accountProvider, accountPubKey, PREPROD_ID, {
      gapLimit: 5,
      stakeAddress: STAKE,
    });

    expect(perAddressCalls).toBe(0);
    expect(fromAccount.all).toEqual(scanned.all);
    expect(fromAccount.used).toEqual(scanned.used);
    expect(fromAccount.external.nextUnused).toBe(scanned.external.nextUnused);
    expect(fromAccount.internal.nextUnused).toBe(scanned.internal.nextUnused);
  });

  it('falls back to the scan when the account lookup fails', async () => {
    const { provider: probe } = providerWithUsed(new Set());
    const usedOne = (await discoverAddresses(probe, accountPubKey, PREPROD_ID, { gapLimit: 5 }))
      .external.all[0];

    const provider = {
      id: 'blockfrost',
      network: 'preprod',
      filterUsedAddresses: async (addresses: string[]) =>
        addresses.filter((address) => address === usedOne),
      getAccountAddresses: async () => {
        throw new Error('429');
      },
    } as unknown as ChainProvider;

    const result = await discoverAddresses(provider, accountPubKey, PREPROD_ID, {
      gapLimit: 5,
      stakeAddress: STAKE,
    });
    expect(result.external.used).toEqual([usedOne]);
  });

  it('never asks about the account when no stake address is known', async () => {
    let asked = false;
    const provider = {
      filterUsedAddresses: async () => [],
      getAccountAddresses: async () => {
        asked = true;
        return [];
      },
    } as unknown as ChainProvider;
    await discoverAddresses(provider, accountPubKey, PREPROD_ID, { gapLimit: 3 });
    expect(asked).toBe(false);
  });

  it('treats an empty account list as a fresh wallet', async () => {
    const provider = {
      id: 'blockfrost',
      network: 'preprod',
      filterUsedAddresses: async () => {
        throw new Error('must not be called');
      },
      getAccountAddresses: async () => [],
    } as unknown as ChainProvider;
    const result = await discoverAddresses(provider, accountPubKey, PREPROD_ID, {
      gapLimit: 3,
      stakeAddress: STAKE,
    });
    expect(result.used).toEqual([]);
    expect(result.external.all).toHaveLength(3);
  });
});
