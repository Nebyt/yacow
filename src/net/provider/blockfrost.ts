// Blockfrost adapter (plan §12.2).
//
// Blockfrost is per-address and paginated: there is no batch endpoint, so a
// gap-limit-20 discovery pass costs ~40 requests. Everything that keeps that
// affordable -- the concurrency limiter, page walking, per-call 404 handling --
// lives here so the rest of the app never sees it.
//
// Auth is the `project_id` header, and the key itself is network-scoped: a
// mainnet key is rejected by the preprod host, so we check the prefix before
// spending a request on it.
import type { NetworkName } from '../../config/networks.js';
import { mapWithConcurrency } from './concurrency.js';
import { createRateLimiter } from './rateLimiter.js';
import { createHttpClient, unquote, type HttpClient, type HttpClientConfig } from './http.js';
import {
  ProviderNetworkMismatchError,
  emptyBalance,
  sortAssets,
  type AccountState,
  type Asset,
  type AssetInfo,
  type Balance,
  type ChainProvider,
  type HealthStatus,
  type HistoryQuery,
  type PoolInfo,
  type ProtocolParams,
  type Tip,
  type TxDetail,
  type TxIo,
  type TxSummary,
  type Utxo,
} from './types.js';

export const BLOCKFROST_BASE_URLS: Readonly<Record<NetworkName, string>> = Object.freeze({
  mainnet: 'https://cardano-mainnet.blockfrost.io/api/v0',
  preprod: 'https://cardano-preprod.blockfrost.io/api/v0',
});

/** Project ids are prefixed with the chain they are valid for. */
export const BLOCKFROST_KEY_PREFIXES: Readonly<Record<NetworkName, string>> = Object.freeze({
  mainnet: 'mainnet',
  preprod: 'preprod',
});

/** Blockfrost's own maximum for `count`. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_CONCURRENCY = 5;
/**
 * Blockfrost's free tier allows 10 requests/second. Five concurrent requests
 * that each take ~150ms is roughly 33/second, which is how a plain balance
 * refresh collected an HTTP 429. Stay under the line rather than paying for
 * rejections and retries.
 */
export const DEFAULT_REQUESTS_PER_SECOND = 8;
/** Safety net so a misbehaving endpoint cannot spin the page walker forever. */
export const MAX_PAGES = 100;
export const DEFAULT_HISTORY_LIMIT = 20;

export interface BlockfrostConfig extends Omit<
  HttpClientConfig,
  'provider' | 'baseUrl' | 'headers'
> {
  network: NetworkName;
  projectId: string;
  /** Requests in flight at once. */
  concurrency?: number;
  /** Sustained request rate; keep it under the plan's limit. */
  requestsPerSecond?: number;
  /** Override for tests pointing at a local mock host. */
  baseUrl?: string;
}

// --- raw response shapes (only the fields we consume) ----------------------

interface RawAmount {
  unit: string;
  quantity: string;
}

interface RawBlock {
  slot: number;
  height: number;
  hash: string;
  epoch: number;
  time: number;
}

interface RawEpochParams {
  epoch: number;
  min_fee_a: number;
  min_fee_b: number;
  pool_deposit: string;
  key_deposit: string;
  max_tx_size: number;
  max_val_size: string;
  coins_per_utxo_size?: string;
  coins_per_utxo_word?: string;
}

interface RawAddress {
  address: string;
  amount: RawAmount[];
}

interface RawUtxo {
  tx_hash: string;
  output_index: number;
  address?: string;
  amount: RawAmount[];
  data_hash: string | null;
}

interface RawAddressTx {
  tx_hash: string;
  tx_index: number;
  block_height: number;
  block_time: number;
}

interface RawTx {
  hash: string;
  block_height: number;
  block_time: number;
  fees: string;
}

interface RawTxUtxos {
  inputs: { address: string; amount: RawAmount[]; collateral: boolean }[];
  outputs: { address: string; amount: RawAmount[] }[];
}

interface RawAsset {
  asset: string;
  policy_id: string;
  asset_name: string | null;
  metadata: { name?: string | null; ticker?: string | null; decimals?: number | null } | null;
  onchain_metadata: { name?: string | null; ticker?: string | null } | null;
}

interface RawAccount {
  stake_address: string;
  active: boolean;
  pool_id: string | null;
  withdrawable_amount: string;
  withdrawals_sum: string;
}

interface RawPool {
  pool_id: string;
  margin_cost: number;
  fixed_cost: string;
  metadata?: { ticker?: string | null; name?: string | null } | null;
}

// --- mapping ---------------------------------------------------------------

/** Blockfrost's `amount[]` uses our unit format already; just split off ADA. */
function toBalance(amounts: RawAmount[]): Balance {
  const balance = emptyBalance();
  for (const { unit, quantity } of amounts) {
    if (unit === 'lovelace') {
      balance.lovelace = addDecimal(balance.lovelace, quantity);
    } else {
      balance.assets.push({ unit, quantity });
    }
  }
  balance.assets = sortAssets(balance.assets);
  return balance;
}

function addDecimal(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

function mergeBalances(balances: Balance[]): Balance {
  const totals = new Map<string, bigint>();
  let lovelace = 0n;
  for (const balance of balances) {
    lovelace += BigInt(balance.lovelace);
    for (const asset of balance.assets) {
      totals.set(asset.unit, (totals.get(asset.unit) ?? 0n) + BigInt(asset.quantity));
    }
  }
  const assets = sortAssets(
    [...totals.entries()]
      .filter(([, quantity]) => quantity !== 0n)
      .map(([unit, quantity]): Asset => ({ unit, quantity: quantity.toString() })),
  );
  return { lovelace: lovelace.toString(), assets };
}

function toTip(block: RawBlock): Tip {
  return {
    slot: block.slot,
    height: block.height,
    hash: block.hash,
    epoch: block.epoch,
    time: block.time,
  };
}

function toProtocolParams(raw: RawEpochParams): ProtocolParams {
  return {
    epoch: raw.epoch,
    linearFee: { coefficient: String(raw.min_fee_a), constant: String(raw.min_fee_b) },
    // `coins_per_utxo_word` is the pre-Babbage name; keep reading it so an old
    // response shape degrades instead of producing NaN min-ADA later.
    coinsPerUtxoByte: raw.coins_per_utxo_size ?? raw.coins_per_utxo_word ?? '0',
    poolDeposit: raw.pool_deposit,
    keyDeposit: raw.key_deposit,
    maxTxSize: raw.max_tx_size,
    maxValueSize: Number.parseInt(raw.max_val_size, 10),
  };
}

function toIo(entry: { address: string; amount: RawAmount[] }): TxIo {
  const balance = toBalance(entry.amount);
  return { address: entry.address, lovelace: balance.lovelace, assets: balance.assets };
}

function hexToUtf8Name(assetNameHex: string): string | null {
  if (assetNameHex === '') return null;
  try {
    const text = Buffer.from(assetNameHex, 'hex').toString('utf8');
    // Reject control characters and lossy decodes -- CIP-68 reference tokens
    // carry binary names that must not be shown as mojibake.
    return /^[\x20-\x7e -￿]+$/u.test(text) ? text : null;
  } catch {
    return null;
  }
}

function toAssetInfo(raw: RawAsset): AssetInfo {
  const assetNameHex = raw.asset_name ?? '';
  return {
    unit: raw.asset,
    policyId: raw.policy_id,
    assetNameHex,
    name: raw.metadata?.name ?? raw.onchain_metadata?.name ?? hexToUtf8Name(assetNameHex),
    ticker: raw.metadata?.ticker ?? raw.onchain_metadata?.ticker ?? null,
    decimals: raw.metadata?.decimals ?? 0,
  };
}

// --- provider --------------------------------------------------------------

export function createBlockfrostProvider(config: BlockfrostConfig): ChainProvider {
  const {
    network,
    projectId,
    concurrency = DEFAULT_CONCURRENCY,
    requestsPerSecond = DEFAULT_REQUESTS_PER_SECOND,
    baseUrl,
    ...httpConfig
  } = config;
  const limiter = createRateLimiter({
    ratePerSecond: requestsPerSecond,
    sleep: httpConfig.sleep,
    now: httpConfig.now,
  });
  const client: HttpClient = createHttpClient({
    ...httpConfig,
    provider: 'blockfrost',
    baseUrl: baseUrl ?? BLOCKFROST_BASE_URLS[network],
    headers: { project_id: projectId },
  });

  // Every request passes the token bucket first, including retries inside the
  // http layer's callers -- there is no way to reach the network around it.
  const http: HttpClient = {
    provider: client.provider,
    baseUrl: client.baseUrl,
    request: async (path, options) => {
      await limiter.acquire();
      return client.request(path, options);
    },
    getJson: async (path, options) => {
      await limiter.acquire();
      return client.getJson(path, options);
    },
    postJson: async (path, body, options) => {
      await limiter.acquire();
      return client.postJson(path, body, options);
    },
    postCbor: async (path, body, options) => {
      await limiter.acquire();
      return client.postCbor(path, body, options);
    },
  };

  /** Walk `?page=` until a short page comes back. */
  async function allPages<T>(
    path: string,
    query: Record<string, string | number> = {},
  ): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const rows = await http.getJson<T[]>(path, {
        query: { ...query, count: MAX_PAGE_SIZE, page },
        notFoundAsNull: true,
      });
      if (rows == null) return out; // address never used
      out.push(...rows);
      if (rows.length < MAX_PAGE_SIZE) return out;
    }
    return out;
  }

  const forEachAddress = async <T>(
    addresses: string[],
    fn: (address: string) => Promise<T>,
  ): Promise<T[]> => mapWithConcurrency(addresses, concurrency, fn);

  async function getTip(): Promise<Tip> {
    const block = await http.getJson<RawBlock>('/blocks/latest');
    return toTip(block as RawBlock);
  }

  async function getTransaction(hash: string): Promise<TxDetail | null> {
    const [tx, utxos] = await Promise.all([
      http.getJson<RawTx>(`/txs/${hash}`, { notFoundAsNull: true }),
      http.getJson<RawTxUtxos>(`/txs/${hash}/utxos`, { notFoundAsNull: true }),
    ]);
    if (tx == null) return null;
    return {
      hash: tx.hash,
      blockHeight: tx.block_height ?? null,
      blockTime: tx.block_time ?? null,
      fee: tx.fees ?? null,
      // Collateral inputs are only spent when a script fails; they are not part
      // of the transaction's normal balance change.
      inputs: (utxos?.inputs ?? []).filter((i) => !i.collateral).map(toIo),
      outputs: (utxos?.outputs ?? []).map(toIo),
    };
  }

  return {
    id: 'blockfrost',
    network,

    getTip,

    async getProtocolParams(): Promise<ProtocolParams> {
      const raw = await http.getJson<RawEpochParams>('/epochs/latest/parameters');
      return toProtocolParams(raw as RawEpochParams);
    },

    async filterUsedAddresses(addresses: string[]): Promise<string[]> {
      // No batch endpoint: an address that was never seen answers 404, which is
      // the "unused" signal rather than a failure.
      const seen = await forEachAddress(addresses, async (address) => {
        const info = await http.getJson<RawAddress>(`/addresses/${address}`, {
          notFoundAsNull: true,
        });
        return info != null;
      });
      return addresses.filter((_, i) => seen[i]);
    },

    async getUtxosForAddresses(addresses: string[]): Promise<Utxo[]> {
      const perAddress = await forEachAddress(addresses, async (address) => {
        const rows = await allPages<RawUtxo>(`/addresses/${address}/utxos`, { order: 'asc' });
        return rows.map((row): Utxo => {
          const balance = toBalance(row.amount);
          return {
            txHash: row.tx_hash,
            outputIndex: row.output_index,
            address: row.address ?? address,
            lovelace: balance.lovelace,
            assets: balance.assets,
            datumHash: row.data_hash ?? null,
          };
        });
      });
      return perAddress.flat();
    },

    async getBalanceForAddresses(addresses: string[]): Promise<Balance> {
      // `/addresses/{addr}` reports the totals directly -- one request per
      // address instead of walking every UTxO page.
      const balances = await forEachAddress(addresses, async (address) => {
        const info = await http.getJson<RawAddress>(`/addresses/${address}`, {
          notFoundAsNull: true,
        });
        return info == null ? emptyBalance() : toBalance(info.amount);
      });
      return mergeBalances(balances);
    },

    async getTransactionsForAddresses(
      addresses: string[],
      query: HistoryQuery = {},
    ): Promise<TxSummary[]> {
      const limit = query.limit ?? DEFAULT_HISTORY_LIMIT;
      const perAddress = await forEachAddress(addresses, async (address) =>
        allPages<RawAddressTx>(`/addresses/${address}/transactions`, { order: 'desc' }),
      );

      // The same transaction shows up under every address it touches.
      const byHash = new Map<string, RawAddressTx>();
      for (const row of perAddress.flat()) {
        if (query.afterHeight !== undefined && row.block_height <= query.afterHeight) continue;
        if (!byHash.has(row.tx_hash)) byHash.set(row.tx_hash, row);
      }

      const newestFirst = [...byHash.values()]
        .sort((a, b) => b.block_height - a.block_height || b.tx_index - a.tx_index)
        .slice(0, limit);

      // Fees are not part of the address-transactions rows, so fill them in for
      // the page we actually return (5 rows on the dashboard, not thousands).
      const fees = await mapWithConcurrency(newestFirst, concurrency, async (row) => {
        const tx = await http.getJson<RawTx>(`/txs/${row.tx_hash}`, { notFoundAsNull: true });
        return tx?.fees ?? null;
      });

      return newestFirst.map((row, i) => ({
        hash: row.tx_hash,
        blockHeight: row.block_height,
        blockTime: row.block_time,
        fee: fees[i],
      }));
    },

    getTransaction,

    async submitTx(cbor: Uint8Array): Promise<string> {
      // Answers with the bare tx hash; quoted, so read it as text and unquote.
      const hash = await http.postCbor<string>('/tx/submit', cbor, { parse: 'text' });
      return unquote(hash as string);
    },

    async getAssetInfo(units: string[]): Promise<AssetInfo[]> {
      const rows = await mapWithConcurrency(units, concurrency, async (unit) =>
        http.getJson<RawAsset>(`/assets/${unit}`, { notFoundAsNull: true }),
      );
      return rows.filter((row): row is RawAsset => row != null).map(toAssetInfo);
    },

    async healthCheck(): Promise<HealthStatus> {
      // A wrong-chain key is a configuration mistake, not an outage: it throws
      // so the setup wizard can say exactly what is wrong (decision 4.4).
      assertKeyMatchesNetwork(projectId, network);
      try {
        return { provider: 'blockfrost', network, ok: true, tip: await getTip() };
      } catch {
        return { provider: 'blockfrost', network, ok: false, tip: null };
      }
    },

    async getAccountState(stakeAddress: string): Promise<AccountState | null> {
      const raw = await http.getJson<RawAccount>(`/accounts/${stakeAddress}`, {
        notFoundAsNull: true,
      });
      if (raw == null) return null;
      return {
        stakeAddress: raw.stake_address,
        registered: raw.active,
        delegatedPool: raw.pool_id,
        rewardsAvailable: raw.withdrawable_amount,
        rewardsWithdrawn: raw.withdrawals_sum,
      };
    },

    async getPoolInfo(poolId: string): Promise<PoolInfo | null> {
      const raw = await http.getJson<RawPool>(`/pools/${poolId}`, { notFoundAsNull: true });
      if (raw == null) return null;
      return {
        poolId: raw.pool_id,
        ticker: raw.metadata?.ticker ?? null,
        name: raw.metadata?.name ?? null,
        margin: raw.margin_cost,
        fixedCost: raw.fixed_cost,
      };
    },
  };
}

/** Reject a mainnet key on preprod (and vice versa) before spending a request. */
export function assertKeyMatchesNetwork(projectId: string, network: NetworkName): void {
  const expected = BLOCKFROST_KEY_PREFIXES[network];
  if (projectId.startsWith(expected)) return;
  const actual =
    Object.entries(BLOCKFROST_KEY_PREFIXES).find(([, prefix]) =>
      projectId.startsWith(prefix),
    )?.[0] ?? 'unknown';
  throw new ProviderNetworkMismatchError({ provider: 'blockfrost', expected: network, actual });
}
