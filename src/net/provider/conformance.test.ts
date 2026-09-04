// The test that keeps the wrapper honest (plan §12.9 B5).
//
// One expectation per on-chain situation, run against BOTH adapters with the
// fixtures each backend would really return. If Blockfrost and Koios ever
// disagree about the normalised DTO, this fails -- which is the whole promise
// the provider layer makes to the wallet: the answer does not depend on who
// served it (decision 4.2).
//
// Where the fixtures deliberately differ in shape (per-address vs batched,
// different field names, different asset ordering) that IS the point: the
// expectation on the right stays identical.
import { MockAgent, fetch as undiciFetch } from 'undici';
import { createBlockfrostProvider } from './blockfrost.js';
import { createKoiosProvider } from './koios.js';
import type { ChainProvider, ProviderId } from './types.js';

const BF_ORIGIN = 'https://cardano-preprod.blockfrost.io';
const BF_PREFIX = '/api/v0';
const KO_ORIGIN = 'https://preprod.koios.rest';
const KO_PREFIX = '/api/v1';
const KO_PAGE = '?offset=0&limit=1000';

const POLICY_A = 'a'.repeat(56);
const POLICY_B = 'b'.repeat(56);
const MILK = `${POLICY_A}4d494c4b`;
const HOSKY = `${POLICY_B}484f534b59`;
const ADDR_A = 'addr_test_a';
const ADDR_B = 'addr_test_b';
const ADDR_FRESH = 'addr_test_fresh';

let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});

afterEach(async () => {
  await agent.close();
});

const mockFetch = ((url: string | URL | Request, init?: RequestInit) =>
  undiciFetch(url as string, {
    ...(init as Record<string, unknown>),
    dispatcher: agent,
  })) as unknown as typeof fetch;

/** Mock helpers shaped like each backend's real API. */
const bf = {
  get(path: string, body: unknown, statusCode = 200): void {
    agent
      .get(BF_ORIGIN)
      .intercept({ path: `${BF_PREFIX}${path}`, method: 'GET' })
      .reply(statusCode, body, { headers: { 'content-type': 'application/json' } });
  },
  page(path: string, rows: unknown[], order: 'asc' | 'desc'): void {
    bf.get(`${path}?order=${order}&count=100&page=1`, rows);
  },
};

const ko = {
  get(path: string, body: unknown, statusCode = 200): void {
    agent
      .get(KO_ORIGIN)
      .intercept({ path: `${KO_PREFIX}${path}`, method: 'GET' })
      .reply(statusCode, body, { headers: { 'content-type': 'application/json' } });
  },
  post(path: string, body: unknown): void {
    agent
      .get(KO_ORIGIN)
      .intercept({ path: `${KO_PREFIX}${path}${KO_PAGE}`, method: 'POST' })
      .reply(200, body, { headers: { 'content-type': 'application/json' } });
  },
};

interface Case {
  /** Arrange the fixtures this backend would return for the situation. */
  blockfrost: () => void;
  koios: () => void;
  run: (provider: ChainProvider) => Promise<unknown>;
  expected: unknown;
  /** Compare a subset -- only for fields that legitimately differ, like `provider`. */
  partial?: boolean;
}

const lovelace = (quantity: string) => ({ unit: 'lovelace', quantity });
const bfAsset = (unit: string, quantity: string) => ({ unit, quantity });
const koAsset = (unit: string, quantity: string) => ({
  policy_id: unit.slice(0, 56),
  asset_name: unit.slice(56),
  quantity,
});

const CASES: Record<string, Case> = {
  'chain tip': {
    blockfrost: () =>
      bf.get('/blocks/latest', {
        slot: 12345,
        height: 999,
        hash: 'block_hash',
        epoch: 42,
        time: 1_757_000_000,
      }),
    koios: () =>
      ko.get('/tip', [
        {
          hash: 'block_hash',
          epoch_no: 42,
          abs_slot: 12345,
          block_height: 999,
          block_time: 1_757_000_000,
        },
      ]),
    run: (p) => p.getTip(),
    expected: { slot: 12345, height: 999, hash: 'block_hash', epoch: 42, time: 1_757_000_000 },
  },

  'protocol parameters': {
    blockfrost: () =>
      bf.get('/epochs/latest/parameters', {
        epoch: 42,
        min_fee_a: 44,
        min_fee_b: 155381,
        pool_deposit: '500000000',
        key_deposit: '2000000',
        max_tx_size: 16384,
        max_val_size: '5000',
        coins_per_utxo_size: '4310',
      }),
    koios: () =>
      ko.get('/epoch_params', [
        {
          epoch_no: 42,
          min_fee_a: 44,
          min_fee_b: 155381,
          pool_deposit: '500000000',
          key_deposit: '2000000',
          max_tx_size: 16384,
          max_val_size: 5000,
          coins_per_utxo_size: '4310',
        },
      ]),
    run: (p) => p.getProtocolParams(),
    expected: {
      epoch: 42,
      linearFee: { coefficient: '44', constant: '155381' },
      coinsPerUtxoByte: '4310',
      poolDeposit: '500000000',
      keyDeposit: '2000000',
      maxTxSize: 16384,
      maxValueSize: 5000,
    },
  },

  'used-address filter': {
    // Blockfrost: one call per address, 404 = unused.
    blockfrost: () => {
      bf.get(`/addresses/${ADDR_A}`, { address: ADDR_A, amount: [lovelace('1')] });
      bf.get(`/addresses/${ADDR_FRESH}`, { error: 'Not Found' }, 404);
      bf.get(`/addresses/${ADDR_B}`, { address: ADDR_B, amount: [lovelace('2')] });
    },
    // Koios: one batched call, unused addresses are simply absent (and the rows
    // come back in a different order than we asked for).
    koios: () =>
      ko.post('/address_info', [
        { address: ADDR_B, balance: '2' },
        { address: ADDR_A, balance: '1' },
      ]),
    run: (p) => p.filterUsedAddresses([ADDR_A, ADDR_FRESH, ADDR_B]),
    expected: [ADDR_A, ADDR_B],
  },

  'balance across addresses with two tokens': {
    blockfrost: () => {
      bf.get(`/addresses/${ADDR_A}`, {
        address: ADDR_A,
        // Backend lists MILK first...
        amount: [lovelace('1500000'), bfAsset(MILK, '10'), bfAsset(HOSKY, '1')],
      });
      bf.get(`/addresses/${ADDR_B}`, {
        address: ADDR_B,
        amount: [lovelace('2500000'), bfAsset(MILK, '5')],
      });
    },
    koios: () =>
      ko.post('/address_utxos', [
        {
          tx_hash: 'u1',
          tx_index: 0,
          address: ADDR_A,
          value: '1500000',
          datum_hash: null,
          // ...Koios lists HOSKY first. Both must normalise to the same order.
          asset_list: [koAsset(HOSKY, '1'), koAsset(MILK, '10')],
        },
        {
          tx_hash: 'u2',
          tx_index: 0,
          address: ADDR_B,
          value: '2500000',
          datum_hash: null,
          asset_list: [koAsset(MILK, '5')],
        },
      ]),
    run: (p) => p.getBalanceForAddresses([ADDR_A, ADDR_B]),
    expected: {
      lovelace: '4000000',
      assets: [
        { unit: MILK, quantity: '15' },
        { unit: HOSKY, quantity: '1' },
      ],
    },
  },

  'fresh wallet holds nothing': {
    blockfrost: () => bf.get(`/addresses/${ADDR_FRESH}`, { error: 'Not Found' }, 404),
    koios: () => ko.post('/address_utxos', []),
    run: (p) => p.getBalanceForAddresses([ADDR_FRESH]),
    expected: { lovelace: '0', assets: [] },
  },

  'utxo set': {
    blockfrost: () =>
      bf.page(
        `/addresses/${ADDR_A}/utxos`,
        [
          {
            tx_hash: 'tx_utxo',
            output_index: 3,
            amount: [lovelace('2000000'), bfAsset(MILK, '7')],
            data_hash: 'datum1',
          },
        ],
        'asc',
      ),
    koios: () =>
      ko.post('/address_utxos', [
        {
          tx_hash: 'tx_utxo',
          tx_index: 3,
          address: ADDR_A,
          value: '2000000',
          datum_hash: 'datum1',
          asset_list: [koAsset(MILK, '7')],
        },
      ]),
    run: (p) => p.getUtxosForAddresses([ADDR_A]),
    expected: [
      {
        txHash: 'tx_utxo',
        outputIndex: 3,
        address: ADDR_A,
        lovelace: '2000000',
        assets: [{ unit: MILK, quantity: '7' }],
        datumHash: 'datum1',
      },
    ],
  },

  'utxos of an address the chain never saw': {
    blockfrost: () => bf.get(`/addresses/${ADDR_FRESH}/utxos?order=asc&count=100&page=1`, { error: 'Not Found' }, 404),
    koios: () => ko.post('/address_utxos', []),
    run: (p) => p.getUtxosForAddresses([ADDR_FRESH]),
    expected: [],
  },

  'history is deduped, newest first, with fees': {
    blockfrost: () => {
      bf.page(
        `/addresses/${ADDR_A}/transactions`,
        [
          { tx_hash: 'tx_new', tx_index: 1, block_height: 200, block_time: 2000 },
          { tx_hash: 'tx_shared', tx_index: 0, block_height: 100, block_time: 1000 },
        ],
        'desc',
      );
      bf.page(
        `/addresses/${ADDR_B}/transactions`,
        // The shared tx shows up again under the other address.
        [{ tx_hash: 'tx_shared', tx_index: 0, block_height: 100, block_time: 1000 }],
        'desc',
      );
      bf.get('/txs/tx_new', {
        hash: 'tx_new',
        block_height: 200,
        block_time: 2000,
        fees: '170000',
      });
      bf.get('/txs/tx_shared', {
        hash: 'tx_shared',
        block_height: 100,
        block_time: 1000,
        fees: '180000',
      });
    },
    koios: () => {
      ko.post('/address_txs', [
        { tx_hash: 'tx_shared', block_height: 100, block_time: 1000 },
        { tx_hash: 'tx_new', block_height: 200, block_time: 2000 },
        { tx_hash: 'tx_shared', block_height: 100, block_time: 1000 },
      ]);
      ko.post('/tx_info', [
        { tx_hash: 'tx_new', block_height: 200, tx_timestamp: 2000, fee: '170000' },
        { tx_hash: 'tx_shared', block_height: 100, tx_timestamp: 1000, fee: '180000' },
      ]);
    },
    run: (p) => p.getTransactionsForAddresses([ADDR_A, ADDR_B], { limit: 5 }),
    expected: [
      { hash: 'tx_new', blockHeight: 200, blockTime: 2000, fee: '170000' },
      { hash: 'tx_shared', blockHeight: 100, blockTime: 1000, fee: '180000' },
    ],
  },

  'transaction detail excludes collateral': {
    blockfrost: () => {
      bf.get('/txs/tx1', { hash: 'tx1', block_height: 10, block_time: 100, fees: '170000' });
      bf.get('/txs/tx1/utxos', {
        inputs: [
          { address: ADDR_A, amount: [lovelace('3000000')], collateral: false },
          // Blockfrost returns collateral inline and flagged; Koios keeps it in
          // a separate field, so neither DTO may contain it.
          { address: ADDR_B, amount: [lovelace('5000000')], collateral: true },
        ],
        outputs: [{ address: ADDR_B, amount: [lovelace('2830000'), bfAsset(MILK, '1')] }],
      });
    },
    koios: () =>
      ko.post('/tx_info', [
        {
          tx_hash: 'tx1',
          block_height: 10,
          tx_timestamp: 100,
          fee: '170000',
          inputs: [{ payment_addr: { bech32: ADDR_A }, value: '3000000', asset_list: [] }],
          collateral_inputs: [
            { payment_addr: { bech32: ADDR_B }, value: '5000000', asset_list: [] },
          ],
          outputs: [
            {
              payment_addr: { bech32: ADDR_B },
              value: '2830000',
              asset_list: [koAsset(MILK, '1')],
            },
          ],
        },
      ]),
    run: (p) => p.getTransaction('tx1'),
    expected: {
      hash: 'tx1',
      blockHeight: 10,
      blockTime: 100,
      fee: '170000',
      inputs: [{ address: ADDR_A, lovelace: '3000000', assets: [] }],
      outputs: [
        { address: ADDR_B, lovelace: '2830000', assets: [{ unit: MILK, quantity: '1' }] },
      ],
    },
  },

  'unknown transaction hash': {
    blockfrost: () => {
      bf.get('/txs/nope', { error: 'Not Found' }, 404);
      bf.get('/txs/nope/utxos', { error: 'Not Found' }, 404);
    },
    koios: () => ko.post('/tx_info', []),
    run: (p) => p.getTransaction('nope'),
    expected: null,
  },

  'asset metadata': {
    blockfrost: () =>
      bf.get(`/assets/${MILK}`, {
        asset: MILK,
        policy_id: POLICY_A,
        asset_name: '4d494c4b',
        metadata: { name: 'Milk Token', ticker: 'MILK', decimals: 6 },
        onchain_metadata: null,
      }),
    koios: () =>
      ko.post('/asset_info', [
        {
          policy_id: POLICY_A,
          asset_name: '4d494c4b',
          asset_name_ascii: 'MILK',
          token_registry_metadata: { name: 'Milk Token', ticker: 'MILK', decimals: 6 },
        },
      ]),
    run: (p) => p.getAssetInfo([MILK]),
    expected: [
      {
        unit: MILK,
        policyId: POLICY_A,
        assetNameHex: '4d494c4b',
        name: 'Milk Token',
        ticker: 'MILK',
        decimals: 6,
      },
    ],
  },

  'submitting a transaction returns the bare hash': {
    blockfrost: () =>
      agent
        .get(BF_ORIGIN)
        .intercept({ path: `${BF_PREFIX}/tx/submit`, method: 'POST' })
        .reply(200, '"txhash123"', { headers: { 'content-type': 'application/json' } }),
    koios: () =>
      agent
        .get(KO_ORIGIN)
        .intercept({ path: `${KO_PREFIX}/submittx`, method: 'POST' })
        .reply(202, 'txhash123', { headers: { 'content-type': 'text/plain' } }),
    run: (p) => p.submitTx(new Uint8Array([1, 2, 3])),
    expected: 'txhash123',
  },

  'backend outage is reported, not thrown': {
    blockfrost: () => bf.get('/blocks/latest', 'gateway down', 502),
    koios: () => ko.get('/tip', 'gateway down', 502),
    run: (p) => p.healthCheck(),
    // `provider` is the one field that must differ, so this case compares a subset.
    expected: { ok: false, tip: null, network: 'preprod' },
    partial: true,
  },
};

function build(id: ProviderId): ChainProvider {
  const shared = { retries: 0, sleep: async () => {}, fetchImpl: mockFetch } as const;
  return id === 'blockfrost'
    ? createBlockfrostProvider({ network: 'preprod', projectId: 'preprodTESTKEY', ...shared })
    : createKoiosProvider({ network: 'preprod', token: null, ...shared });
}

describe.each(Object.entries(CASES))('%s', (_name, testCase) => {
  it.each(['blockfrost', 'koios'] as const)('is identical via %s', async (id) => {
    testCase[id]();
    const result = await testCase.run(build(id));
    if (testCase.partial === true) {
      expect(result).toMatchObject(testCase.expected as Record<string, unknown>);
    } else {
      // Strict: an extra or missing field on one adapter is a parity break.
      expect(result).toEqual(testCase.expected);
    }
  });
});

// Documented divergence: Blockfrost knows a transaction's index within its
// block, Koios does not. For two transactions in the SAME block the adapters
// therefore order differently -- they agree on the set, not the sequence.
// Asserted here so it stays a known, bounded difference instead of drifting.
describe('same-block ordering', () => {
  it('agrees on which transactions are returned, not on their order', async () => {
    // tx_bbb sits LATER in the block, so Blockfrost puts it first while Koios,
    // which has no index, sorts by hash and puts tx_aaa first.
    bf.page(
      `/addresses/${ADDR_A}/transactions`,
      [
        { tx_hash: 'tx_bbb', tx_index: 4, block_height: 100, block_time: 1000 },
        { tx_hash: 'tx_aaa', tx_index: 0, block_height: 100, block_time: 1000 },
      ],
      'desc',
    );
    bf.get('/txs/tx_aaa', { hash: 'tx_aaa', block_height: 100, block_time: 1000, fees: '1' });
    bf.get('/txs/tx_bbb', { hash: 'tx_bbb', block_height: 100, block_time: 1000, fees: '2' });
    ko.post('/address_txs', [
      { tx_hash: 'tx_bbb', block_height: 100, block_time: 1000 },
      { tx_hash: 'tx_aaa', block_height: 100, block_time: 1000 },
    ]);
    ko.post('/tx_info', [
      { tx_hash: 'tx_aaa', block_height: 100, tx_timestamp: 1000, fee: '1' },
      { tx_hash: 'tx_bbb', block_height: 100, tx_timestamp: 1000, fee: '2' },
    ]);

    const fromBlockfrost = await build('blockfrost').getTransactionsForAddresses([ADDR_A]);
    const fromKoios = await build('koios').getTransactionsForAddresses([ADDR_A]);

    expect(new Set(fromBlockfrost.map((t) => t.hash))).toEqual(
      new Set(fromKoios.map((t) => t.hash)),
    );
    // The divergence itself, pinned: index-in-block vs hash ordering.
    expect(fromBlockfrost.map((t) => t.hash)).toEqual(['tx_bbb', 'tx_aaa']);
    expect(fromKoios.map((t) => t.hash)).toEqual(['tx_aaa', 'tx_bbb']);
  });
});
