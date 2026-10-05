import { RustModule } from '../crypto/rust.js';
import { accountPublicKeyHex } from '../crypto/derive.js';
import { mnemonicToRootKey } from '../crypto/mnemonic.js';
import { describeTokens, fetchWalletBalance, formatAda, formatQuantity } from './balance.js';
import type { AssetInfo, Balance, ChainProvider } from '../net/provider/types.js';

const MNEMONIC = `${'abandon '.repeat(14)}address`.trim();
const POLICY = 'a'.repeat(56);
const MILK = `${POLICY}4d494c4b`; // "MILK"
const RAW = `${POLICY}00ff`; // unprintable asset name
let accountPubKey: string;

beforeAll(async () => {
  await RustModule.load();
  accountPubKey = accountPublicKeyHex(mnemonicToRootKey(MNEMONIC));
});

describe('formatQuantity', () => {
  it('places the decimal point without floating point', () => {
    expect(formatQuantity('123456789', 6)).toBe('123.456789');
    expect(formatQuantity('1500000', 6)).toBe('1.5');
    expect(formatQuantity('1000000', 6)).toBe('1');
  });

  it('pads a quantity smaller than one unit', () => {
    expect(formatQuantity('42', 6)).toBe('0.000042');
  });

  it('leaves an integer token alone', () => {
    expect(formatQuantity('7', 0)).toBe('7');
  });

  it('keeps precision beyond what a double can hold', () => {
    expect(formatAda('9007199254740993')).toBe('9007199254.740993');
  });

  it('handles zero and negatives', () => {
    expect(formatAda('0')).toBe('0');
    expect(formatQuantity('-1500000', 6)).toBe('-1.5');
  });
});

describe('describeTokens', () => {
  const balance: Balance = {
    lovelace: '0',
    assets: [
      { unit: MILK, quantity: '12345678' },
      { unit: RAW, quantity: '3' },
    ],
  };

  it('prefers the registry ticker and applies its decimals', () => {
    const metadata: AssetInfo[] = [
      {
        unit: MILK,
        policyId: POLICY,
        assetNameHex: '4d494c4b',
        name: 'Milk Token',
        ticker: 'MILK',
        decimals: 6,
      },
    ];
    const [milk] = describeTokens(balance, metadata);
    expect(milk).toMatchObject({ label: 'MILK', decimals: 6, display: '12.345678' });
  });

  it('falls back to the registry name when there is no ticker', () => {
    const metadata: AssetInfo[] = [
      {
        unit: MILK,
        policyId: POLICY,
        assetNameHex: '4d494c4b',
        name: 'Milk Token',
        ticker: null,
        decimals: 0,
      },
    ];
    expect(describeTokens(balance, metadata)[0].label).toBe('Milk Token');
  });

  it('decodes a printable asset name when the token is unknown', () => {
    expect(describeTokens(balance, [])[0].label).toBe('MILK');
  });

  it('shows the hex name rather than mojibake for a binary asset name', () => {
    expect(describeTokens(balance, [])[1].label).toBe('00ff');
  });

  it('treats an unknown token as having no decimals', () => {
    expect(describeTokens(balance, [])[0].display).toBe('12345678');
  });
});

describe('fetchWalletBalance', () => {
  // A wallet that holds something must have a used address -- an unused one
  // holds nothing by definition, and the balance call is skipped for it. The
  // used set is fixed (not "first of each window"), so the gap actually closes.
  function provider(
    overrides: Partial<ChainProvider> = {},
    used: Set<string> = new Set(),
  ): ChainProvider {
    return {
      id: 'blockfrost',
      network: 'preprod',
      filterUsedAddresses: async (addresses: string[]) => addresses.filter((a) => used.has(a)),
      getBalanceForAddresses: async () => ({ lovelace: '0', assets: [] }),
      getAssetInfo: async () => [],
      ...overrides,
    } as unknown as ChainProvider;
  }

  /** The addresses a fresh scan derives, so a test can mark one of them used. */
  async function derivedAddresses(): Promise<string[]> {
    return (await fetchWalletBalance(provider(), accountPubKey, 0, { gapLimit: 3 })).addresses;
  }

  it('totals what the used addresses hold', async () => {
    const usedAddress = (await derivedAddresses())[0];
    const seen: string[][] = [];
    const result = await fetchWalletBalance(
      provider(
        {
          getBalanceForAddresses: async (addresses: string[]) => {
            seen.push(addresses);
            return { lovelace: '4500000', assets: [] };
          },
        },
        new Set([usedAddress]),
      ),
      accountPubKey,
      0,
      { gapLimit: 3 },
    );

    expect(result).toMatchObject({ lovelace: '4500000', ada: '4.5', tokens: [] });
    // Only the used address is queried, though many more were derived.
    expect(seen).toEqual([[usedAddress]]);
    expect(result.addresses.length).toBeGreaterThan(1);
  });

  it('does not ask about token metadata when the wallet holds no tokens', async () => {
    const usedAddress = (await derivedAddresses())[0];
    const getAssetInfo = jest.fn(async () => []);
    await fetchWalletBalance(
      provider(
        { getAssetInfo, getBalanceForAddresses: async () => ({ lovelace: '1', assets: [] }) },
        new Set([usedAddress]),
      ),
      accountPubKey,
      0,
      { gapLimit: 3 },
    );
    expect(getAssetInfo).not.toHaveBeenCalled();
  });

  it('labels the tokens it does hold', async () => {
    const usedAddress = (await derivedAddresses())[0];
    const result = await fetchWalletBalance(
      provider(
        {
          getBalanceForAddresses: async () => ({
            lovelace: '2000000',
            assets: [{ unit: MILK, quantity: '5000000' }],
          }),
          getAssetInfo: async () => [
            {
              unit: MILK,
              policyId: POLICY,
              assetNameHex: '4d494c4b',
              name: 'Milk Token',
              ticker: 'MILK',
              decimals: 6,
            },
          ],
        },
        new Set([usedAddress]),
      ),
      accountPubKey,
      0,
      { gapLimit: 3 },
    );
    expect(result.tokens).toEqual([
      { unit: MILK, quantity: '5000000', label: 'MILK', decimals: 6, display: '5' },
    ]);
  });

  it('reports the first unused receive address for the Receive page', async () => {
    const result = await fetchWalletBalance(provider(), accountPubKey, 0, { gapLimit: 3 });
    expect(result.nextUnusedAddress).toBe(result.addresses[0]);
  });
});

describe('request economy', () => {
  function counting(used: string[]) {
    const calls: { balance: string[][] } = { balance: [] };
    const provider = {
      id: 'blockfrost',
      network: 'preprod',
      filterUsedAddresses: async (addresses: string[]) => addresses.filter((a) => used.includes(a)),
      getBalanceForAddresses: async (addresses: string[]) => {
        calls.balance.push(addresses);
        return { lovelace: '1000000', assets: [] };
      },
      getAssetInfo: async () => [],
    } as unknown as ChainProvider;
    return { provider, calls };
  }

  it('never asks about a fresh wallet at all: unused addresses hold nothing', async () => {
    const { provider, calls } = counting([]);
    const result = await fetchWalletBalance(provider, accountPubKey, 0, { gapLimit: 3 });
    expect(calls.balance).toEqual([]); // no request made
    expect(result).toMatchObject({ lovelace: '0', ada: '0', usedAddresses: [] });
  });

  it('asks only about the used addresses, not every derived one', async () => {
    // Discover once to learn what the scan derives, then mark one as used.
    const { provider: probe } = counting([]);
    const derived = await fetchWalletBalance(probe, accountPubKey, 0, { gapLimit: 3 });
    const usedAddress = derived.addresses[1];

    const { provider, calls } = counting([usedAddress]);
    const result = await fetchWalletBalance(provider, accountPubKey, 0, { gapLimit: 3 });

    expect(calls.balance).toEqual([[usedAddress]]);
    expect(result.addresses.length).toBeGreaterThan(1); // many derived...
    expect(result.usedAddresses).toEqual([usedAddress]); // ...one queried
  });
});

// B12 (plan §14.6): prefer the account-level balance, and never let a failed
// optimisation turn into a broken dashboard.
describe('account-level balance', () => {
  const STAKE = 'stake_test1account';

  it('uses one account lookup instead of a request per address', async () => {
    const asked: { account: string[]; perAddress: string[][] } = { account: [], perAddress: [] };
    const chain = {
      id: 'blockfrost',
      network: 'preprod',
      filterUsedAddresses: async () => [],
      getBalanceForAddresses: async (addresses: string[]) => {
        asked.perAddress.push(addresses);
        return { lovelace: '1', assets: [] };
      },
      getAssetInfo: async () => [],
      getAccountBalance: async (stakeAddress: string) => {
        asked.account.push(stakeAddress);
        return { lovelace: '96227191', assets: [] };
      },
    } as unknown as ChainProvider;

    const result = await fetchWalletBalance(chain, accountPubKey, 0, { stakeAddress: STAKE });

    expect(asked.account).toEqual([STAKE]);
    expect(asked.perAddress).toEqual([]);
    expect(result.ada).toBe('96.227191');
  });

  it('reads "the chain has never seen it" as an empty wallet, with no request', async () => {
    const chain = {
      id: 'blockfrost',
      network: 'preprod',
      filterUsedAddresses: async () => [],
      getBalanceForAddresses: async () => {
        throw new Error('a fresh wallet must not need a balance call');
      },
      getAssetInfo: async () => [],
      getAccountBalance: async () => null,
    } as unknown as ChainProvider;

    const result = await fetchWalletBalance(chain, accountPubKey, 0, {
      stakeAddress: STAKE,
      gapLimit: 3,
    });
    expect(result).toMatchObject({ lovelace: '0', ada: '0', usedAddresses: [] });
  });

  it('falls back to the per-address total when the account call fails', async () => {
    // Learn the first derived address so exactly one address counts as used.
    const derived = await fetchWalletBalance(
      {
        id: 'koios',
        network: 'preprod',
        filterUsedAddresses: async () => [],
        getBalanceForAddresses: async () => ({ lovelace: '0', assets: [] }),
        getAssetInfo: async () => [],
      } as unknown as ChainProvider,
      accountPubKey,
      0,
      { gapLimit: 3 },
    );
    const usedAddress = derived.addresses[0];

    const chain = {
      id: 'blockfrost',
      network: 'preprod',
      filterUsedAddresses: async (addresses: string[]) =>
        addresses.filter((address) => address === usedAddress),
      getBalanceForAddresses: async () => ({ lovelace: '2000000', assets: [] }),
      getAssetInfo: async () => [],
      getAccountBalance: async () => {
        throw new Error('429 Too Many Requests');
      },
    } as unknown as ChainProvider;

    const result = await fetchWalletBalance(chain, accountPubKey, 0, {
      stakeAddress: STAKE,
      gapLimit: 3,
    });
    expect(result).toMatchObject({ lovelace: '2000000', ada: '2' });
  });

  it('uses the per-address path when the provider has no account method', async () => {
    // Koios today: its account address list is not a used set, so discovery and
    // the total stay per address (batched).
    const chain = {
      id: 'koios',
      network: 'preprod',
      filterUsedAddresses: async () => [],
      getBalanceForAddresses: async () => ({ lovelace: '1', assets: [] }),
      getAssetInfo: async () => [],
    } as unknown as ChainProvider;
    expect(chain.getAccountBalance).toBeUndefined();
    const result = await fetchWalletBalance(chain, accountPubKey, 0, {
      stakeAddress: STAKE,
      gapLimit: 3,
    });
    expect(result.lovelace).toBe('0'); // fresh wallet: nothing used, nothing asked
  });
});
