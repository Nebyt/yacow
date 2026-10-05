import { MockAgent, fetch as undiciFetch } from 'undici';
import { createKoiosProvider, MAX_BATCH, MAX_BODY_BYTES, PAGE_SIZE } from './koios.js';
import { ProviderRateLimitError, type ChainProvider } from './types.js';

const ORIGIN = 'https://preprod.koios.rest';
const PREFIX = '/api/v1';
const POLICY = 'a'.repeat(56);
const NAME_HEX = '4d494c4b'; // "MILK"
const UNIT = `${POLICY}${NAME_HEX}`;
const PAGE_QUERY = '?offset=0&limit=1000';

let agent: MockAgent;

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect(); // decision 5.3
});

afterEach(async () => {
  await agent.close();
});

// See _TESTS_provider.md: setGlobalDispatcher does not reach Node's built-in
// fetch inside jest's sandboxed global, so the dispatcher is passed explicitly.
const mockFetch = ((url: string | URL | Request, init?: RequestInit) =>
  undiciFetch(url as string, {
    ...(init as Record<string, unknown>),
    dispatcher: agent,
  })) as unknown as typeof fetch;

function provider(overrides: { token?: string | null } = {}): ChainProvider {
  return createKoiosProvider({
    network: 'preprod',
    token: overrides.token ?? null,
    retries: 0,
    sleep: async () => {},
    fetchImpl: mockFetch,
  });
}

function get(path: string, body: unknown, status = 200): void {
  agent
    .get(ORIGIN)
    .intercept({ path: `${PREFIX}${path}`, method: 'GET' })
    .reply(status, body, { headers: { 'content-type': 'application/json' } });
}

/** Intercept a batched POST and record the request body it was called with. */
function post(
  path: string,
  body: unknown,
  options: {
    status?: number;
    query?: string;
    capture?: (json: Record<string, unknown>) => void;
  } = {},
): void {
  agent
    .get(ORIGIN)
    .intercept({ path: `${PREFIX}${path}${options.query ?? PAGE_QUERY}`, method: 'POST' })
    .reply(
      options.status ?? 200,
      // Capture here, not in a body matcher: undici re-runs matchers while it
      // looks for the right interceptor, which would count a call many times.
      (opts: { body?: unknown }) => {
        options.capture?.(JSON.parse(String(opts.body)) as Record<string, unknown>);
        return body;
      },
      { headers: { 'content-type': 'application/json' } },
    );
}

describe('chain', () => {
  it('maps the tip out of the single-row array Koios returns', async () => {
    get('/tip', [
      { hash: 'abc', epoch_no: 42, abs_slot: 12345, block_height: 999, block_time: 1_757_000_000 },
    ]);
    await expect(provider().getTip()).resolves.toEqual({
      slot: 12345,
      height: 999,
      hash: 'abc',
      epoch: 42,
      time: 1_757_000_000,
    });
  });

  it('maps epoch parameters onto the same names the Blockfrost adapter produces', async () => {
    get('/epoch_params', [
      {
        epoch_no: 42,
        min_fee_a: 44,
        min_fee_b: 155381,
        key_deposit: '2000000',
        pool_deposit: '500000000',
        max_tx_size: 16384,
        max_val_size: 5000,
        coins_per_utxo_size: '4310',
      },
    ]);
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

  it('surfaces a rate limit through the shared taxonomy', async () => {
    get('/tip', { error: 'rate limited' }, 429);
    await expect(provider().getTip()).rejects.toBeInstanceOf(ProviderRateLimitError);
  });
});

describe('auth', () => {
  it('sends a bearer token when one is configured', async () => {
    agent
      .get(ORIGIN)
      .intercept({
        path: `${PREFIX}/tip`,
        method: 'GET',
        headers: { authorization: 'Bearer tok123' },
      })
      .reply(200, [{ hash: 'h', epoch_no: 1, abs_slot: 2, block_height: 3, block_time: 4 }], {
        headers: { 'content-type': 'application/json' },
      });
    await expect(provider({ token: 'tok123' }).getTip()).resolves.toMatchObject({ height: 3 });
  });

  it('works anonymously when no token is set', async () => {
    get('/tip', [{ hash: 'h', epoch_no: 1, abs_slot: 2, block_height: 3, block_time: 4 }]);
    await expect(provider({ token: null }).getTip()).resolves.toMatchObject({ height: 3 });
  });
});

describe('addresses', () => {
  it('treats an omitted address as never used and keeps input order', async () => {
    post('/address_info', [
      { address: 'addr_b', balance: '1' },
      { address: 'addr_a', balance: '2' },
    ]);
    await expect(
      provider().filterUsedAddresses(['addr_a', 'addr_unused', 'addr_b']),
    ).resolves.toEqual(['addr_a', 'addr_b']);
  });

  it('splits an address list larger than one batch into several calls', () => {
    // Covered in detail by the byte-budget tests below and in concurrency.test.ts.
    expect(MAX_BATCH).toBeLessThanOrEqual(40);
  });

  it('keeps every request body under the 5120-byte limit Koios enforces', async () => {
    // Real bech32 length: 50 of these is 5583 bytes, which Koios answers with
    // HTTP 413 -- the bug this test exists for.
    const real =
      'addr_test1qqh6cswdjfaxz7f2ldpl9c0xzxv5ss403vnhz2dznuyltxcuv6hm9vhl7207qs0e4pcw5ctajfk37mz43kjegxqel0wsfkxdy7';
    const addresses = Array.from(
      { length: 100 },
      (_, i) => `${real.slice(0, -2)}${i.toString().padStart(2, '0')}`,
    );
    const bodies: string[] = [];
    const capture = (json: Record<string, unknown>) => {
      bodies.push(JSON.stringify(json));
    };
    // Three batches at ~40 addresses each.
    post('/address_info', [], { capture });
    post('/address_info', [], { capture });
    post('/address_info', [{ address: addresses[99], balance: '1' }], { capture });

    await expect(provider().filterUsedAddresses(addresses)).resolves.toEqual([addresses[99]]);
    expect(bodies.length).toBeGreaterThan(1);
    for (const body of bodies) {
      expect(body.length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    }
    // Every address was asked about exactly once, none silently dropped.
    const sent = bodies.flatMap((b) => (JSON.parse(b) as { _addresses: string[] })._addresses);
    expect(sent).toEqual(addresses);
  });

  it('asks for extended utxos and maps assets, datum hash and output index', async () => {
    let sent: Record<string, unknown> | undefined;
    post(
      '/address_utxos',
      [
        {
          tx_hash: 'abc',
          tx_index: 3,
          address: 'addr_a',
          value: '2000000',
          datum_hash: 'datum1',
          asset_list: [{ policy_id: POLICY, asset_name: NAME_HEX, quantity: '7' }],
        },
      ],
      {
        capture: (json) => {
          sent = json;
        },
      },
    );

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
    expect(sent).toMatchObject({ _extended: true, _addresses: ['addr_a'] });
  });

  it('walks offset pages until a short one comes back', async () => {
    const row = (i: number) => ({
      tx_hash: `hash${i}`,
      tx_index: 0,
      address: 'addr_a',
      value: '1000000',
      datum_hash: null,
      asset_list: null,
    });
    post(
      '/address_utxos',
      Array.from({ length: PAGE_SIZE }, (_, i) => row(i)),
    );
    post('/address_utxos', [row(PAGE_SIZE)], { query: `?offset=${PAGE_SIZE}&limit=${PAGE_SIZE}` });

    const utxos = await provider().getUtxosForAddresses(['addr_a']);
    expect(utxos).toHaveLength(PAGE_SIZE + 1);
    expect(utxos[PAGE_SIZE].txHash).toBe(`hash${PAGE_SIZE}`);
  });

  it('sums the utxo set into ADA plus tokens, exactly beyond 2^53', async () => {
    post('/address_utxos', [
      {
        tx_hash: 'a',
        tx_index: 0,
        address: 'addr_a',
        value: '9007199254740993',
        datum_hash: null,
        asset_list: [{ policy_id: POLICY, asset_name: NAME_HEX, quantity: '10' }],
      },
      {
        tx_hash: 'b',
        tx_index: 1,
        address: 'addr_b',
        value: '2',
        datum_hash: null,
        asset_list: [{ policy_id: POLICY, asset_name: NAME_HEX, quantity: '5' }],
      },
    ]);
    await expect(provider().getBalanceForAddresses(['addr_a', 'addr_b'])).resolves.toEqual({
      lovelace: '9007199254740995',
      assets: [{ unit: UNIT, quantity: '15' }],
    });
  });

  it('reports a fresh wallet as an empty balance', async () => {
    post('/address_utxos', []);
    await expect(provider().getBalanceForAddresses(['addr_fresh'])).resolves.toEqual({
      lovelace: '0',
      assets: [],
    });
  });
});

describe('transactions', () => {
  const row = (hash: string, height: number) => ({
    tx_hash: hash,
    block_height: height,
    block_time: height * 10,
  });

  it('dedupes, sorts newest first and fills fees from one batched tx_info call', async () => {
    post('/address_txs', [row('tx_new', 200), row('tx_shared', 100), row('tx_shared', 100)]);
    let sent: Record<string, unknown> | undefined;
    post(
      '/tx_info',
      [
        { tx_hash: 'tx_new', block_height: 200, tx_timestamp: 2000, fee: '170000' },
        { tx_hash: 'tx_shared', block_height: 100, tx_timestamp: 1000, fee: '180000' },
      ],
      {
        capture: (json) => {
          sent = json;
        },
      },
    );

    await expect(
      provider().getTransactionsForAddresses(['addr_a', 'addr_b'], { limit: 2 }),
    ).resolves.toEqual([
      { hash: 'tx_new', blockHeight: 200, blockTime: 2000, fee: '170000' },
      { hash: 'tx_shared', blockHeight: 100, blockTime: 1000, fee: '180000' },
    ]);
    expect(sent).toMatchObject({
      _tx_hashes: ['tx_new', 'tx_shared'],
      _inputs: true,
      _outputs: true,
    });
  });

  it('breaks same-block ties by hash so the list is stable', async () => {
    post('/address_txs', [row('tx_bbb', 100), row('tx_aaa', 100)]);
    post('/tx_info', [
      { tx_hash: 'tx_aaa', block_height: 100, tx_timestamp: 1000, fee: '1' },
      { tx_hash: 'tx_bbb', block_height: 100, tx_timestamp: 1000, fee: '2' },
    ]);
    const txs = await provider().getTransactionsForAddresses(['addr_a']);
    expect(txs.map((t) => t.hash)).toEqual(['tx_aaa', 'tx_bbb']);
  });

  it('passes afterHeight to the backend and filters what still slips through', async () => {
    let sent: Record<string, unknown> | undefined;
    post('/address_txs', [row('tx_new', 200), row('tx_seen', 100)], {
      capture: (json) => {
        sent = json;
      },
    });
    post('/tx_info', [{ tx_hash: 'tx_new', block_height: 200, tx_timestamp: 2000, fee: '1' }]);

    const txs = await provider().getTransactionsForAddresses(['addr_a'], { afterHeight: 100 });
    expect(txs.map((t) => t.hash)).toEqual(['tx_new']);
    expect(sent).toMatchObject({ _after_block_height: 100 });
  });

  it('maps a transaction detail', async () => {
    post('/tx_info', [
      {
        tx_hash: 'tx1',
        block_height: 10,
        tx_timestamp: 100,
        fee: '170000',
        inputs: [{ payment_addr: { bech32: 'addr_in' }, value: '3000000', asset_list: [] }],
        outputs: [
          {
            payment_addr: { bech32: 'addr_out' },
            value: '2830000',
            asset_list: [{ policy_id: POLICY, asset_name: NAME_HEX, quantity: '1' }],
          },
        ],
      },
    ]);
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

  it('returns null for an unknown hash', async () => {
    post('/tx_info', []);
    await expect(provider().getTransaction('nope')).resolves.toBeNull();
  });

  it('submits CBOR and unquotes the returned hash', async () => {
    agent
      .get(ORIGIN)
      .intercept({ path: `${PREFIX}/submittx`, method: 'POST' })
      .reply(202, '"txhash123"', { headers: { 'content-type': 'application/json' } });
    await expect(provider().submitTx(new Uint8Array([1, 2, 3]))).resolves.toBe('txhash123');
  });

  it('accepts an unquoted submit response too', async () => {
    agent
      .get(ORIGIN)
      .intercept({ path: `${PREFIX}/submittx`, method: 'POST' })
      .reply(202, 'txhash123', { headers: { 'content-type': 'text/plain' } });
    await expect(provider().submitTx(new Uint8Array([1]))).resolves.toBe('txhash123');
  });
});

describe('assets', () => {
  it('sends [policy, nameHex] pairs and prefers registry metadata', async () => {
    let sent: Record<string, unknown> | undefined;
    post(
      '/asset_info',
      [
        {
          policy_id: POLICY,
          asset_name: NAME_HEX,
          asset_name_ascii: 'MILK',
          token_registry_metadata: { name: 'Milk Token', ticker: 'MILK', decimals: 6 },
        },
      ],
      {
        capture: (json) => {
          sent = json;
        },
      },
    );

    await expect(provider().getAssetInfo([UNIT])).resolves.toEqual([
      {
        unit: UNIT,
        policyId: POLICY,
        assetNameHex: NAME_HEX,
        name: 'Milk Token',
        ticker: 'MILK',
        decimals: 6,
      },
    ]);
    expect(sent).toMatchObject({ _asset_list: [[POLICY, NAME_HEX]] });
  });

  it('falls back to the ascii name and zero decimals without registry metadata', async () => {
    post('/asset_info', [
      {
        policy_id: POLICY,
        asset_name: NAME_HEX,
        asset_name_ascii: 'MILK',
        token_registry_metadata: null,
      },
    ]);
    await expect(provider().getAssetInfo([UNIT])).resolves.toEqual([
      {
        unit: UNIT,
        policyId: POLICY,
        assetNameHex: NAME_HEX,
        name: 'MILK',
        ticker: null,
        decimals: 0,
      },
    ]);
  });
});

describe('healthCheck', () => {
  it('reports ok with the tip', async () => {
    get('/tip', [{ hash: 'h', epoch_no: 3, abs_slot: 1, block_height: 2, block_time: 4 }]);
    await expect(provider().healthCheck()).resolves.toEqual({
      provider: 'koios',
      network: 'preprod',
      ok: true,
      tip: { slot: 1, height: 2, hash: 'h', epoch: 3, time: 4 },
    });
  });

  it('reports not-ok instead of throwing when the backend is down', async () => {
    get('/tip', 'bad gateway', 502);
    await expect(provider().healthCheck()).resolves.toMatchObject({ ok: false, tip: null });
  });

  it('reports not-ok when the backend answers with no rows', async () => {
    get('/tip', []);
    await expect(provider().healthCheck()).resolves.toMatchObject({ ok: false, tip: null });
  });
});

describe('staking (reserved)', () => {
  it('maps account state', async () => {
    post('/account_info', [
      {
        stake_address: 'stake_test1',
        status: 'registered',
        delegated_pool: 'pool1abc',
        rewards_available: '1234',
        withdrawals: '99',
      },
    ]);
    await expect(provider().getAccountState?.('stake_test1')).resolves.toEqual({
      stakeAddress: 'stake_test1',
      registered: true,
      delegatedPool: 'pool1abc',
      rewardsAvailable: '1234',
      rewardsWithdrawn: '99',
    });
  });

  it('returns null for a stake address Koios does not know', async () => {
    post('/account_info', []);
    await expect(provider().getAccountState?.('stake_none')).resolves.toBeNull();
  });
});

// B12 (plan §14): the account path. Koios answers the spendable balance in two
// aggregated requests, but deliberately has no account address list.
describe('account balance', () => {
  const STAKE = 'stake_test1account';
  const accountInfo = (overrides: Record<string, unknown> = {}) => ({
    stake_address: STAKE,
    status: 'registered',
    delegated_pool: null,
    utxo: '96227191',
    rewards_available: '440440166',
    withdrawals: '0',
    ...overrides,
  });

  it('reports the UTxO figure, never utxo + rewards', async () => {
    // Live 2026-10-05: total_balance 536667357 = utxo 96227191 + rewards
    // 440440166. Only the UTxO part is spendable.
    post('/account_info', [accountInfo()]);
    post('/account_assets', [{ policy_id: POLICY, asset_name: NAME_HEX, quantity: '7' }]);

    await expect(provider().getAccountBalance?.(STAKE)).resolves.toEqual({
      lovelace: '96227191',
      assets: [{ unit: UNIT, quantity: '7' }],
    });
  });

  it('answers for an account that holds funds but was never registered', async () => {
    post('/account_info', [
      accountInfo({ status: 'not registered', utxo: '2500000', rewards_available: '0' }),
    ]);
    post('/account_assets', []);

    await expect(provider().getAccountBalance?.(STAKE)).resolves.toEqual({
      lovelace: '2500000',
      assets: [],
    });
  });

  it('returns null for an account the chain has never seen, without asking for assets', async () => {
    post('/account_info', []);
    await expect(provider().getAccountBalance?.(STAKE)).resolves.toBeNull();
  });

  it('has no account address list on purpose', () => {
    // `account_addresses` returns only the addresses holding a UTxO right now
    // (1 against Blockfrost's 170 for the same account, live 2026-10-05), so
    // using it for discovery could hand back an already-used receive address.
    expect(provider().getAccountAddresses).toBeUndefined();
  });
});
