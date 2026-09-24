// Koios adapter (plan §12.3).
//
// The mirror image of Blockfrost: nearly every read is a POST that takes a list
// of addresses, so a gap-limit-20 discovery pass is one or two requests instead
// of forty. What it costs us instead is chunking (a single call may not carry an
// unbounded address list) and PostgREST-style offset paging.
//
// Auth is an optional bearer token: anonymous access works at a lower rate
// limit, so an empty key is a valid configuration, not a missing one.
import type { NetworkName } from '../../config/networks.js';
import { chunkByBytes } from './concurrency.js';
import { createHttpClient, unquote, type HttpClient, type HttpClientConfig } from './http.js';
import {
  assetUnit,
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

export const KOIOS_BASE_URLS: Readonly<Record<NetworkName, string>> = Object.freeze({
  mainnet: 'https://api.koios.rest/api/v1',
  preprod: 'https://preprod.koios.rest/api/v1',
});

/**
 * Koios rejects an oversized request body with HTTP 413 rather than truncating.
 * The documented ceiling is 5,120 bytes and a Shelley address is ~108 chars, so
 * a 50-address batch is 5,583 bytes and fails. Batches are therefore built to a
 * BYTE budget, not an item count, with headroom for the surrounding JSON.
 */
export const MAX_BODY_BYTES = 5120;
export const BODY_OVERHEAD_BYTES = 256;
/** Belt and braces: never send an absurd number of items even if they are tiny. */
export const MAX_BATCH = 40;
/** PostgREST page size; a short page ends the walk. */
export const PAGE_SIZE = 1000;
export const MAX_PAGES = 100;
export const DEFAULT_HISTORY_LIMIT = 20;

export interface KoiosConfig extends Omit<HttpClientConfig, 'provider' | 'baseUrl' | 'headers'> {
  network: NetworkName;
  /** Bearer JWT. Null/empty means anonymous access (decision 4.8 stores it per network). */
  token?: string | null;
  baseUrl?: string;
}

// --- raw response shapes (only the fields we consume) ----------------------

interface RawAssetEntry {
  policy_id: string;
  /** Hex-encoded, as Koios returns it. */
  asset_name: string | null;
  quantity: string;
}

interface RawTip {
  hash: string;
  epoch_no: number;
  abs_slot: number;
  block_height: number;
  block_time: number;
}

interface RawEpochParams {
  epoch_no: number;
  min_fee_a: number;
  min_fee_b: number;
  key_deposit: string;
  pool_deposit: string;
  max_tx_size: number;
  max_val_size: number;
  coins_per_utxo_size: string;
}

interface RawAddressInfo {
  address: string;
  balance: string;
}

interface RawAddressUtxo {
  tx_hash: string;
  tx_index: number;
  address: string;
  value: string;
  datum_hash: string | null;
  asset_list: RawAssetEntry[] | null;
}

interface RawAddressTx {
  tx_hash: string;
  block_height: number;
  block_time: number;
}

interface RawTxIo {
  payment_addr: { bech32: string };
  value: string;
  asset_list: RawAssetEntry[] | null;
}

interface RawTxInfo {
  tx_hash: string;
  block_height: number | null;
  tx_timestamp: number | null;
  fee: string;
  inputs?: RawTxIo[];
  outputs?: RawTxIo[];
}

interface RawAssetInfo {
  policy_id: string;
  asset_name: string | null;
  asset_name_ascii: string | null;
  decimals?: number | null;
  token_registry_metadata?: {
    name?: string | null;
    ticker?: string | null;
    decimals?: number | null;
  } | null;
}

interface RawAccountInfo {
  stake_address: string;
  status: string;
  delegated_pool: string | null;
  rewards_available: string;
  withdrawals: string;
}

interface RawPoolInfo {
  pool_id_bech32: string;
  margin: number | null;
  fixed_cost: string | null;
  meta_json?: { ticker?: string | null; name?: string | null } | null;
}

// --- mapping ---------------------------------------------------------------

function toAssets(list: RawAssetEntry[] | null | undefined): Asset[] {
  return sortAssets(
    (list ?? []).map((entry) => ({
      unit: assetUnit(entry.policy_id, entry.asset_name ?? ''),
      quantity: entry.quantity,
    })),
  );
}

function mergeBalance(entries: { value: string; asset_list: RawAssetEntry[] | null }[]): Balance {
  const totals = new Map<string, bigint>();
  let lovelace = 0n;
  for (const entry of entries) {
    lovelace += BigInt(entry.value);
    for (const asset of toAssets(entry.asset_list)) {
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

function toIo(entry: RawTxIo): TxIo {
  return {
    address: entry.payment_addr.bech32,
    lovelace: entry.value,
    assets: toAssets(entry.asset_list),
  };
}

// --- provider --------------------------------------------------------------

export function createKoiosProvider(config: KoiosConfig): ChainProvider {
  const { network, token, baseUrl, ...httpConfig } = config;
  const http: HttpClient = createHttpClient({
    ...httpConfig,
    provider: 'koios',
    baseUrl: baseUrl ?? KOIOS_BASE_URLS[network],
    headers: token != null && token !== '' ? { authorization: `Bearer ${token}` } : {},
  });

  /** POST a batched query, chunked and offset-paged, flattened back into one list. */
  async function postBatched<T, V = string>(
    path: string,
    key: string,
    values: readonly V[],
    extra: Record<string, unknown> = {},
  ): Promise<T[]> {
    const out: T[] = [];
    for (const batch of chunkByBytes(values, MAX_BODY_BYTES, BODY_OVERHEAD_BYTES, MAX_BATCH)) {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const rows = await http.postJson<T[]>(
          path,
          { [key]: batch, ...extra },
          { query: { offset: page * PAGE_SIZE, limit: PAGE_SIZE } },
        );
        const received = rows ?? [];
        out.push(...received);
        if (received.length < PAGE_SIZE) break;
      }
    }
    return out;
  }

  async function getTip(): Promise<Tip> {
    const rows = await http.getJson<RawTip[]>('/tip');
    const tip = (rows ?? [])[0];
    if (tip == null) throw new Error('Koios returned no tip.');
    return {
      slot: tip.abs_slot,
      height: tip.block_height,
      hash: tip.hash,
      epoch: tip.epoch_no,
      time: tip.block_time,
    };
  }

  async function txInfo(hashes: string[]): Promise<RawTxInfo[]> {
    if (hashes.length === 0) return [];
    return postBatched<RawTxInfo>('/tx_info', '_tx_hashes', hashes, {
      _inputs: true,
      _outputs: true,
    });
  }

  async function getUtxoRows(addresses: string[]): Promise<RawAddressUtxo[]> {
    return postBatched<RawAddressUtxo>('/address_utxos', '_addresses', addresses, {
      _extended: true,
    });
  }

  return {
    id: 'koios',
    network,

    getTip,

    async getProtocolParams(): Promise<ProtocolParams> {
      const rows = await http.getJson<RawEpochParams[]>('/epoch_params');
      const raw = (rows ?? [])[0];
      if (raw == null) throw new Error('Koios returned no epoch parameters.');
      return {
        epoch: raw.epoch_no,
        linearFee: { coefficient: String(raw.min_fee_a), constant: String(raw.min_fee_b) },
        coinsPerUtxoByte: raw.coins_per_utxo_size,
        poolDeposit: raw.pool_deposit,
        keyDeposit: raw.key_deposit,
        maxTxSize: raw.max_tx_size,
        maxValueSize: raw.max_val_size,
      };
    },

    async filterUsedAddresses(addresses: string[]): Promise<string[]> {
      // `address_info` simply omits addresses the chain has never seen, which is
      // the batched equivalent of Blockfrost's per-address 404.
      const rows = await postBatched<RawAddressInfo>('/address_info', '_addresses', addresses);
      const seen = new Set(rows.map((row) => row.address));
      return addresses.filter((address) => seen.has(address));
    },

    async getUtxosForAddresses(addresses: string[]): Promise<Utxo[]> {
      const rows = await getUtxoRows(addresses);
      return rows.map((row) => ({
        txHash: row.tx_hash,
        outputIndex: row.tx_index,
        address: row.address,
        lovelace: row.value,
        assets: toAssets(row.asset_list),
        datumHash: row.datum_hash ?? null,
      }));
    },

    async getBalanceForAddresses(addresses: string[]): Promise<Balance> {
      // `address_info.balance` counts lovelace only, so the UTxO set is the one
      // call that answers ADA and native tokens together.
      const rows = await getUtxoRows(addresses);
      return rows.length === 0 ? emptyBalance() : mergeBalance(rows);
    },

    async getTransactionsForAddresses(
      addresses: string[],
      query: HistoryQuery = {},
    ): Promise<TxSummary[]> {
      const limit = query.limit ?? DEFAULT_HISTORY_LIMIT;
      const rows = await postBatched<RawAddressTx>(
        '/address_txs',
        '_addresses',
        addresses,
        query.afterHeight === undefined ? {} : { _after_block_height: query.afterHeight },
      );

      const byHash = new Map<string, RawAddressTx>();
      for (const row of rows) {
        if (query.afterHeight !== undefined && row.block_height <= query.afterHeight) continue;
        if (!byHash.has(row.tx_hash)) byHash.set(row.tx_hash, row);
      }

      // Koios reports no index-within-block, so ties fall back to the hash --
      // arbitrary but stable, which is what a list needs.
      const newestFirst = [...byHash.values()]
        .sort(
          (a, b) =>
            b.block_height - a.block_height ||
            b.block_time - a.block_time ||
            a.tx_hash.localeCompare(b.tx_hash),
        )
        .slice(0, limit);

      const details = await txInfo(newestFirst.map((row) => row.tx_hash));
      const feeByHash = new Map(details.map((tx) => [tx.tx_hash, tx.fee ?? null]));

      return newestFirst.map((row) => ({
        hash: row.tx_hash,
        blockHeight: row.block_height,
        blockTime: row.block_time,
        fee: feeByHash.get(row.tx_hash) ?? null,
      }));
    },

    async getTransaction(hash: string): Promise<TxDetail | null> {
      const [tx] = await txInfo([hash]);
      if (tx == null) return null;
      return {
        hash: tx.tx_hash,
        blockHeight: tx.block_height ?? null,
        blockTime: tx.tx_timestamp ?? null,
        fee: tx.fee ?? null,
        // `inputs` excludes collateral -- Koios reports those separately, so
        // there is nothing to filter out here.
        inputs: (tx.inputs ?? []).map(toIo),
        outputs: (tx.outputs ?? []).map(toIo),
      };
    },

    async submitTx(cbor: Uint8Array): Promise<string> {
      const hash = await http.postCbor<string>('/submittx', cbor, { parse: 'text' });
      return unquote(hash as string);
    },

    async getAssetInfo(units: string[]): Promise<AssetInfo[]> {
      // `_asset_list` is a list of [policyId, assetNameHex] pairs.
      const pairs = units.map((unit) => [unit.slice(0, 56), unit.slice(56)]);
      const rows = await postBatched<RawAssetInfo, string[]>('/asset_info', '_asset_list', pairs);
      return rows.map((raw) => {
        const assetNameHex = raw.asset_name ?? '';
        const registry = raw.token_registry_metadata;
        return {
          unit: assetUnit(raw.policy_id, assetNameHex),
          policyId: raw.policy_id,
          assetNameHex,
          name: registry?.name ?? raw.asset_name_ascii ?? null,
          ticker: registry?.ticker ?? null,
          decimals: registry?.decimals ?? raw.decimals ?? 0,
        };
      });
    },

    async healthCheck(): Promise<HealthStatus> {
      // Nothing to validate about the key itself: a Koios token carries no
      // network marker, and an absent token is legitimate (anonymous tier).
      try {
        return { provider: 'koios', network, ok: true, tip: await getTip() };
      } catch {
        return { provider: 'koios', network, ok: false, tip: null };
      }
    },

    async getAccountState(stakeAddress: string): Promise<AccountState | null> {
      const rows = await postBatched<RawAccountInfo>('/account_info', '_stake_addresses', [
        stakeAddress,
      ]);
      const raw = rows[0];
      if (raw == null) return null;
      return {
        stakeAddress: raw.stake_address,
        registered: raw.status === 'registered',
        delegatedPool: raw.delegated_pool,
        rewardsAvailable: raw.rewards_available,
        rewardsWithdrawn: raw.withdrawals,
      };
    },

    async getPoolInfo(poolId: string): Promise<PoolInfo | null> {
      const rows = await postBatched<RawPoolInfo>('/pool_info', '_pool_bech32_ids', [poolId]);
      const raw = rows[0];
      if (raw == null) return null;
      return {
        poolId: raw.pool_id_bech32,
        ticker: raw.meta_json?.ticker ?? null,
        name: raw.meta_json?.name ?? null,
        margin: raw.margin,
        fixedCost: raw.fixed_cost,
      };
    },
  };
}
