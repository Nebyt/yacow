import { MockAgent, fetch as undiciFetch } from 'undici';
import { createBlockfrostProvider, assertKeyMatchesNetwork, MAX_PAGE_SIZE } from './blockfrost.js';
import { ProviderAuthError, ProviderNetworkMismatchError, type ChainProvider } from './types.js';

const ORIGIN = 'https://cardano-preprod.blockfrost.io';
const PREFIX = '/api/v0';
const KEY = 'preprodTESTKEY';
const POLICY = 'a'.repeat(56);
const UNIT = `${POLICY}4d494c4b`; // "MILK"

let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect(); // decision 5.3: no test may reach the real network
});

afterEach(async () => {
  await agent.close();
});

// jest's `node` environment hands the test a sandboxed globalThis, so
// setGlobalDispatcher() does NOT reach Node's built-in fetch -- requests would
// escape to the real Blockfrost. Passing undici's fetch with the mock agent as
// its dispatcher keeps everything inside this module instance.
const mockFetch = ((url: string | URL | Request, init?: RequestInit) =>
  undiciFetch(url as string, { ...(init as Record<string, unknown>), dispatcher: agent })) as unknown as typeof fetch;

function mock(): ReturnType<MockAgent['get']> {
  return agent.get(ORIGIN);
}

function reply(path: string, body: unknown, status = 200): void {
  mock()
    .intercept({ path: `${PREFIX}${path}`, method: 'GET' })
    .reply(status, body, { headers: { 'content-type': 'application/json' } });
}

function provider(overrides: { projectId?: string } = {}): ChainProvider {
  return createBlockfrostProvider({
    network: 'preprod',
    projectId: overrides.projectId ?? KEY,
    retries: 0,
    sleep: async () => {},
    fetchImpl: mockFetch,
  });
}

const lovelace = (quantity: string) => ({ unit: 'lovelace', quantity });

describe('key / network guard', () => {
  it('rejects a mainnet key on preprod and names both chains', () => {
    expect(() => assertKeyMatchesNetwork('mainnetABC', 'preprod')).toThrow(
      ProviderNetworkMismatchError,
    );
    try {
      assertKeyMatchesNetwork('mainnetABC', 'preprod');
    } catch (err) {
      expect((err as ProviderNetworkMismatchError).actual).toBe('mainnet');
      expect((err as ProviderNetworkMismatchError).expected).toBe('preprod');
    }
  });

  it('reports an unrecognised key shape as "unknown"', () => {
    try {
      assertKeyMatchesNetwork('garbage', 'mainnet');
    } catch (err) {
      expect((err as ProviderNetworkMismatchError).actual).toBe('unknown');
    }
  });

  it('accepts a matching key', () => {
    expect(() => assertKeyMatchesNetwork(KEY, 'preprod')).not.toThrow();
  });
});

describe('chain', () => {
  it('maps the tip', async () => {
    reply('/blocks/latest', {
      slot: 12345,
      height: 999,
      hash: 'deadbeef',
      epoch: 42,
      time: 1_757_000_000,
      confirmations: 0,
    });
    await expect(provider().getTip()).resolves.toEqual({
      slot: 12345,
      height: 999,
      hash: 'deadbeef',
      epoch: 42,
      time: 1_757_000_000,
    });
  });

  it('maps protocol parameters onto the CSL-shaped names', async () => {
    reply('/epochs/latest/parameters', {
      epoch: 42,
      min_fee_a: 44,
      min_fee_b: 155381,
      pool_deposit: '500000000',
      key_deposit: '2000000',
      max_tx_size: 16384,
      max_val_size: '5000',
      coins_per_utxo_size: '4310',
    });
    await expect(provider().getProtocolParams()).resolves.toEqual({
      epoch: 42,
      linearFee: { coefficient: '44', constant: '155381' },
      coinsPerUtxoByte: '4310',
      poolDeposit: '500000000',
      keyDeposit: '2000000',
      maxTxSize: 16384,
      maxValueSize: 5000,
    });
  });

  it('falls back to the pre-Babbage coins_per_utxo_word name', async () => {
    reply('/epochs/latest/parameters', {
      epoch: 1,
      min_fee_a: 44,
      min_fee_b: 155381,
      pool_deposit: '500000000',
      key_deposit: '2000000',
      max_tx_size: 16384,
      max_val_size: '5000',
      coins_per_utxo_word: '34482',
    });
    await expect(provider().getProtocolParams()).resolves.toMatchObject({
      coinsPerUtxoByte: '34482',
    });
  });

  it('surfaces a rejected key as ProviderAuthError', async () => {
    reply('/blocks/latest', { error: 'Forbidden' }, 403);
    await expect(provider().getTip()).rejects.toBeInstanceOf(ProviderAuthError);
  });
});

describe('addresses', () => {
  it('treats a 404 as "never used" and keeps input order', async () => {
    reply('/addresses/addr_used_1', { address: 'addr_used_1', amount: [lovelace('1')] });
    reply('/addresses/addr_unused', { error: 'Not Found' }, 404);
    reply('/addresses/addr_used_2', { address: 'addr_used_2', amount: [lovelace('2')] });

    await expect(
      provider().filterUsedAddresses(['addr_used_1', 'addr_unused', 'addr_used_2']),
    ).resolves.toEqual(['addr_used_1', 'addr_used_2']);
  });

  it('sums lovelace and native tokens across addresses', async () => {
    reply('/addresses/addr_a', {
      address: 'addr_a',
      amount: [lovelace('1500000'), { unit: UNIT, quantity: '10' }],
    });
    reply('/addresses/addr_b', {
      address: 'addr_b',
      amount: [lovelace('2500000'), { unit: UNIT, quantity: '5' }],
    });

    await expect(provider().getBalanceForAddresses(['addr_a', 'addr_b'])).resolves.toEqual({
      lovelace: '4000000',
      assets: [{ unit: UNIT, quantity: '15' }],
    });
  });

  it('reports an all-unused wallet as an empty balance, not an error', async () => {
    reply('/addresses/addr_fresh', { error: 'Not Found' }, 404);
    await expect(provider().getBalanceForAddresses(['addr_fresh'])).resolves.toEqual({
      lovelace: '0',
      assets: [],
    });
  });

  it('sums quantities beyond Number.MAX_SAFE_INTEGER exactly', async () => {
    reply('/addresses/addr_whale', { address: 'addr_whale', amount: [lovelace('9007199254740993')] });
    reply('/addresses/addr_whale2', { address: 'addr_whale2', amount: [lovelace('2')] });
    await expect(
      provider().getBalanceForAddresses(['addr_whale', 'addr_whale2']),
    ).resolves.toMatchObject({ lovelace: '9007199254740995' });
  });
});

describe('utxos', () => {
  const utxo = (i: number) => ({
    tx_hash: `hash${i}`,
    output_index: 0,
    amount: [lovelace('1000000')],
    data_hash: null,
  });

  it('walks every page until a short one comes back', async () => {
    const full = Array.from({ length: MAX_PAGE_SIZE }, (_, i) => utxo(i));
    reply('/addresses/addr_a/utxos?order=asc&count=100&page=1', full);
    reply('/addresses/addr_a/utxos?order=asc&count=100&page=2', [utxo(100), utxo(101)]);

    const utxos = await provider().getUtxosForAddresses(['addr_a']);
    expect(utxos).toHaveLength(102);
    expect(utxos[101].txHash).toBe('hash101');
  });

  it('maps assets, datum hash and the owning address', async () => {
    reply('/addresses/addr_a/utxos?order=asc&count=100&page=1', [
      {
        tx_hash: 'abc',
        output_index: 3,
        amount: [lovelace('2000000'), { unit: UNIT, quantity: '7' }],
        data_hash: 'datum1',
      },
    ]);
    await expect(provider().getUtxosForAddresses(['addr_a'])).resolves.toEqual([
      {
        txHash: 'abc',
        outputIndex: 3,
        address: 'addr_a',
        lovelace: '2000000',
        assets: [{ unit: UNIT, quantity: '7' }],
        datumHash: 'datum1',
      },
    ]);
  });

  it('returns nothing for an address the chain has never seen', async () => {
    reply('/addresses/addr_fresh/utxos?order=asc&count=100&page=1', { error: 'Not Found' }, 404);
    await expect(provider().getUtxosForAddresses(['addr_fresh'])).resolves.toEqual([]);
  });
});

describe('transactions', () => {
  const row = (hash: string, height: number, index: number) => ({
    tx_hash: hash,
    tx_index: index,
    block_height: height,
    block_time: height * 10,
  });

  it('dedupes across addresses, sorts newest first and fills in fees', async () => {
    reply('/addresses/addr_a/transactions?order=desc&count=100&page=1', [
      row('tx_new', 200, 1),
      row('tx_shared', 100, 0),
    ]);
    reply('/addresses/addr_b/transactions?order=desc&count=100&page=1', [
      row('tx_shared', 100, 0), // same tx, other side
      row('tx_old', 50, 0),
    ]);
    reply('/txs/tx_new', { hash: 'tx_new', block_height: 200, block_time: 2000, fees: '170000' });
    reply('/txs/tx_shared', {
      hash: 'tx_shared',
      block_height: 100,
      block_time: 1000,
      fees: '180000',
    });

    const txs = await provider().getTransactionsForAddresses(['addr_a', 'addr_b'], { limit: 2 });
    expect(txs).toEqual([
      { hash: 'tx_new', blockHeight: 200, blockTime: 2000, fee: '170000' },
      { hash: 'tx_shared', blockHeight: 100, blockTime: 1000, fee: '180000' },
    ]);
  });

  it('orders same-block transactions by their index within the block', async () => {
    reply('/addresses/addr_a/transactions?order=desc&count=100&page=1', [
      row('tx_first', 100, 0),
      row('tx_second', 100, 4),
    ]);
    reply('/txs/tx_second', { hash: 'tx_second', block_height: 100, block_time: 1000, fees: '1' });
    reply('/txs/tx_first', { hash: 'tx_first', block_height: 100, block_time: 1000, fees: '2' });

    const txs = await provider().getTransactionsForAddresses(['addr_a']);
    expect(txs.map((t) => t.hash)).toEqual(['tx_second', 'tx_first']);
  });

  it('drops anything at or below afterHeight', async () => {
    reply('/addresses/addr_a/transactions?order=desc&count=100&page=1', [
      row('tx_new', 200, 0),
      row('tx_seen', 100, 0),
    ]);
    reply('/txs/tx_new', { hash: 'tx_new', block_height: 200, block_time: 2000, fees: '1' });

    const txs = await provider().getTransactionsForAddresses(['addr_a'], { afterHeight: 100 });
    expect(txs.map((t) => t.hash)).toEqual(['tx_new']);
  });

  it('maps a transaction and ignores collateral inputs', async () => {
    reply('/txs/tx1', { hash: 'tx1', block_height: 10, block_time: 100, fees: '170000' });
    reply('/txs/tx1/utxos', {
      inputs: [
        { address: 'addr_in', amount: [lovelace('3000000')], collateral: false },
        { address: 'addr_collateral', amount: [lovelace('5000000')], collateral: true },
      ],
      outputs: [{ address: 'addr_out', amount: [lovelace('2830000'), { unit: UNIT, quantity: '1' }] }],
    });

    await expect(provider().getTransaction('tx1')).resolves.toEqual({
      hash: 'tx1',
      blockHeight: 10,
      blockTime: 100,
      fee: '170000',
      inputs: [{ address: 'addr_in', lovelace: '3000000', assets: [] }],
      outputs: [
        { address: 'addr_out', lovelace: '2830000', assets: [{ unit: UNIT, quantity: '1' }] },
      ],
    });
  });

  it('returns null for a hash the backend has never seen', async () => {
    reply('/txs/nope', { error: 'Not Found' }, 404);
    reply('/txs/nope/utxos', { error: 'Not Found' }, 404);
    await expect(provider().getTransaction('nope')).resolves.toBeNull();
  });

  it('submits CBOR and returns the tx hash', async () => {
    const cbor = new Uint8Array([1, 2, 3]);
    let sentBody: unknown;
    mock()
      .intercept({
        path: `${PREFIX}/tx/submit`,
        method: 'POST',
        body: (body) => {
          sentBody = body;
          return true;
        },
      })
      .reply(200, JSON.stringify('txhash123'), {
        headers: { 'content-type': 'application/json' },
      })
      .times(1);

    await expect(provider().submitTx(cbor)).resolves.toBe('txhash123');
    expect(sentBody).toBeDefined(); // header assertions live in http.test.ts
  });
});

describe('assets', () => {
  it('prefers registry metadata and skips unknown units', async () => {
    reply(`/assets/${UNIT}`, {
      asset: UNIT,
      policy_id: POLICY,
      asset_name: '4d494c4b',
      metadata: { name: 'Milk Token', ticker: 'MILK', decimals: 6 },
      onchain_metadata: { name: 'ignored' },
    });
    reply(`/assets/${POLICY}00`, { error: 'Not Found' }, 404);

    await expect(provider().getAssetInfo([UNIT, `${POLICY}00`])).resolves.toEqual([
      {
        unit: UNIT,
        policyId: POLICY,
        assetNameHex: '4d494c4b',
        name: 'Milk Token',
        ticker: 'MILK',
        decimals: 6,
      },
    ]);
  });

  it('decodes the asset name from hex when there is no metadata', async () => {
    reply(`/assets/${UNIT}`, {
      asset: UNIT,
      policy_id: POLICY,
      asset_name: '4d494c4b',
      metadata: null,
      onchain_metadata: null,
    });
    await expect(provider().getAssetInfo([UNIT])).resolves.toEqual([
      {
        unit: UNIT,
        policyId: POLICY,
        assetNameHex: '4d494c4b',
        name: 'MILK',
        ticker: null,
        decimals: 0,
      },
    ]);
  });
});

describe('healthCheck', () => {
  it('reports ok with the tip when the backend answers', async () => {
    reply('/blocks/latest', { slot: 1, height: 2, hash: 'h', epoch: 3, time: 4 });
    await expect(provider().healthCheck()).resolves.toEqual({
      provider: 'blockfrost',
      network: 'preprod',
      ok: true,
      tip: { slot: 1, height: 2, hash: 'h', epoch: 3, time: 4 },
    });
  });

  it('reports not-ok instead of throwing when the backend is down', async () => {
    reply('/blocks/latest', 'gateway down', 502);
    await expect(provider().healthCheck()).resolves.toEqual({
      provider: 'blockfrost',
      network: 'preprod',
      ok: false,
      tip: null,
    });
  });

  it('throws on a wrong-network key, because that is a config bug not an outage', async () => {
    await expect(provider({ projectId: 'mainnetKEY' }).healthCheck()).rejects.toBeInstanceOf(
      ProviderNetworkMismatchError,
    );
  });
});

describe('staking (reserved)', () => {
  it('maps account state', async () => {
    reply('/accounts/stake_test1', {
      stake_address: 'stake_test1',
      active: true,
      pool_id: 'pool1abc',
      withdrawable_amount: '1234',
      withdrawals_sum: '99',
    });
    await expect(provider().getAccountState?.('stake_test1')).resolves.toEqual({
      stakeAddress: 'stake_test1',
      registered: true,
      delegatedPool: 'pool1abc',
      rewardsAvailable: '1234',
      rewardsWithdrawn: '99',
    });
  });

  it('returns null for an unregistered stake address', async () => {
    reply('/accounts/stake_test_none', { error: 'Not Found' }, 404);
    await expect(provider().getAccountState?.('stake_test_none')).resolves.toBeNull();
  });
});

describe('rate limiting', () => {
  it('spaces requests instead of bursting into an HTTP 429', async () => {
    // Blockfrost has no batch endpoint, so a discovery window is 20 separate
    // requests. Unthrottled, five in flight is ~33/second against a 10/second
    // allowance -- which is exactly how a balance refresh earned a 429.
    const addresses = Array.from({ length: 20 }, (_, i) => `addr_rate_${i}`);
    for (const address of addresses) {
      reply(`/addresses/${address}`, { address, amount: [lovelace('1')] });
    }

    let clock = 0;
    const waits: number[] = [];
    const provider = createBlockfrostProvider({
      network: 'preprod',
      projectId: KEY,
      retries: 0,
      fetchImpl: mockFetch,
      requestsPerSecond: 8,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });

    await provider.filterUsedAddresses(addresses);

    // 8 free, the remaining 12 spaced at 125ms.
    expect(waits.length).toBe(12);
    expect(clock).toBe(1500);
  });
});
