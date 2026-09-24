// The chain-data contract (plan §12.1, decision 4.2).
//
// Every backend YACOW talks to -- Blockfrost, Koios, anything added later --
// is an adapter behind `ChainProvider`. Feature code (wallet/, pages/) calls
// the interface and never learns which backend answered, never sees an API key
// and never issues a `fetch` of its own.
//
// Vendor wallet backends are forbidden (decision 4.1). Adapters talk only to
// Blockfrost and Koios.
//
// Normalisation rules every adapter must honour:
//   - amounts (lovelace and asset quantities) are DECIMAL STRINGS, never
//     `number` -- a 64-bit lovelace value does not survive an IEEE double;
//   - an asset `unit` is `policyIdHex + assetNameHex` (concatenated, lowercase),
//     the same shape Blockfrost and CIP-14 use;
//   - timestamps are unix SECONDS;
//   - "this address has never been seen on chain" is an empty result, not an
//     error -- a fresh wallet is the normal case, not a failure.
import type { NetworkName } from '../../config/networks.js';

/** Backends we ship an adapter for. */
export type ProviderId = 'blockfrost' | 'koios';

export const PROVIDER_IDS: readonly ProviderId[] = ['blockfrost', 'koios'] as const;

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Human label for UI (setup wizard, settings, "served by" marker). */
export const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = Object.freeze({
  blockfrost: 'Blockfrost',
  koios: 'Koios',
});

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

/** A native token amount. `unit` is policyIdHex + assetNameHex. */
export interface Asset {
  unit: string;
  /** Decimal string; never a number (quantities exceed 2^53). */
  quantity: string;
}

/** Lovelace + native tokens held by an address, a UTxO or a whole wallet. */
export interface Balance {
  /** Decimal string of lovelace (1 ADA = 1_000_000). */
  lovelace: string;
  assets: Asset[];
}

export interface Utxo {
  txHash: string;
  outputIndex: number;
  address: string;
  lovelace: string;
  assets: Asset[];
  /** Present on script outputs; the wallet only spends plain key outputs. */
  datumHash: string | null;
}

export interface Tip {
  slot: number;
  height: number;
  hash: string;
  epoch: number;
  /** Unix seconds. */
  time: number;
}

/** Protocol parameters needed to build a transaction (decision 4.6). */
export interface ProtocolParams {
  epoch: number;
  linearFee: { coefficient: string; constant: string };
  coinsPerUtxoByte: string;
  poolDeposit: string;
  keyDeposit: string;
  maxTxSize: number;
  maxValueSize: number;
}

/** One side of a transaction, as reported by the backend. */
export interface TxIo {
  address: string;
  lovelace: string;
  assets: Asset[];
}

/** Enough to render a history row; details need {@link TxDetail}. */
export interface TxSummary {
  hash: string;
  /** Null while the tx is still in the mempool. */
  blockHeight: number | null;
  /** Unix seconds; null while unconfirmed. */
  blockTime: number | null;
  /** Decimal lovelace; null when the backend does not report it. */
  fee: string | null;
}

export interface TxDetail extends TxSummary {
  inputs: TxIo[];
  outputs: TxIo[];
}

/** Registry / CIP-25 / CIP-68 metadata for a native token. */
export interface AssetInfo {
  unit: string;
  policyId: string;
  assetNameHex: string;
  /** Decoded name when the bytes are printable UTF-8, else null. */
  name: string | null;
  ticker: string | null;
  /** Display decimals; 0 when unknown. */
  decimals: number;
}

/** Staking state of a reward address (reserved -- see {@link ChainProvider}). */
export interface AccountState {
  stakeAddress: string;
  registered: boolean;
  /** Bech32 pool id, or null when not delegating. */
  delegatedPool: string | null;
  rewardsAvailable: string;
  rewardsWithdrawn: string;
}

export interface PoolInfo {
  poolId: string;
  ticker: string | null;
  name: string | null;
  /** Fraction 0..1. */
  margin: number | null;
  fixedCost: string | null;
}

/** Result of a provider reachability probe (setup wizard + failover health). */
export interface HealthStatus {
  provider: ProviderId;
  network: NetworkName;
  ok: boolean;
  tip: Tip | null;
}

export interface HistoryQuery {
  /** Only transactions in blocks above this height (incremental refresh). */
  afterHeight?: number;
  /** Newest first; adapters must not return more than this. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

/**
 * Chain access for one network. Instances are built by the registry
 * (`getProvider(network)`) and are safe to reuse; they hold no wallet state.
 */
export interface ChainProvider {
  readonly id: ProviderId;
  readonly network: NetworkName;

  /** Chain tip -- confirmation counts and the health probe. */
  getTip(): Promise<Tip>;

  /** Current epoch's protocol parameters (cache per epoch). */
  getProtocolParams(): Promise<ProtocolParams>;

  /**
   * Subset of `addresses` that has ever appeared on chain, order irrelevant.
   * Drives gap-limit-20 discovery on both chains (decision 4.7).
   */
  filterUsedAddresses(addresses: string[]): Promise<string[]>;

  /** Every unspent output of the given addresses. Empty array = nothing held. */
  getUtxosForAddresses(addresses: string[]): Promise<Utxo[]>;

  /**
   * Aggregate holdings of the given addresses. Adapters that cannot answer
   * directly derive it by summing {@link getUtxosForAddresses}.
   */
  getBalanceForAddresses(addresses: string[]): Promise<Balance>;

  /** Transactions touching the given addresses, newest first. */
  getTransactionsForAddresses(addresses: string[], query?: HistoryQuery): Promise<TxSummary[]>;

  /** Full transaction, or null when the backend has never seen the hash. */
  getTransaction(hash: string): Promise<TxDetail | null>;

  /** Submit a signed transaction. Takes CBOR bytes, returns the tx hash. */
  submitTx(cbor: Uint8Array): Promise<string>;

  /** Metadata for the given units; unknown units are simply absent. */
  getAssetInfo(units: string[]): Promise<AssetInfo[]>;

  /** Reachability + credential + network check. Never throws on a down backend. */
  healthCheck(): Promise<HealthStatus>;

  // Staking is out of v1 scope (decision 1.1) but the contract reserves it so
  // the adapters can grow into it without a breaking change. Optional: callers
  // must feature-detect before use.
  getAccountState(stakeAddress: string): Promise<AccountState | null>;
  getPoolInfo(poolId: string): Promise<PoolInfo | null>;
}

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

/**
 * Base class for anything an adapter throws. `retryable` says whether the SAME
 * provider may be retried after a backoff (the http layer's concern);
 * {@link shouldFailover} says whether the fallback provider should take over
 * (the fallback wrapper's concern). They are deliberately different questions.
 *
 * Messages must never contain a credential -- the http layer redacts headers
 * before an error is constructed (plan §12.4 B2).
 */
export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { provider: ProviderId; status?: number | null; retryable?: boolean; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.provider = options.provider;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/** Missing, malformed or rejected credential (HTTP 401/403). */
export class ProviderAuthError extends ProviderError {}

/** Rate limit or quota (HTTP 402/429). `retryAfterMs` mirrors `Retry-After`. */
export class ProviderRateLimitError extends ProviderError {
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    options: {
      provider: ProviderId;
      status?: number | null;
      retryAfterMs?: number | null;
      cause?: unknown;
    },
  ) {
    super(message, { ...options, retryable: true });
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/**
 * The client is temporarily banned (Blockfrost answers HTTP 418 after flooding).
 * Retrying would dig the hole deeper, so this never retries -- it fails over.
 */
export class ProviderBannedError extends ProviderError {}

/** Backend down, timed out, or answered 5xx -- try again or fail over. */
export class ProviderUnavailableError extends ProviderError {
  constructor(
    message: string,
    options: { provider: ProviderId; status?: number | null; cause?: unknown },
  ) {
    super(message, { ...options, retryable: true });
  }
}

/**
 * The app is quitting and cancelled this request. Not a backend failure: it is
 * never retried and never failed over, because there is nobody left to serve.
 */
export class ProviderShutdownError extends ProviderError {
  constructor(provider: ProviderId) {
    super('Request cancelled: YACOW is shutting down.', { provider });
  }
}

/** We asked wrongly (bad address, 4xx, unparsable body) -- our bug, not theirs. */
export class ProviderRequestError extends ProviderError {}

/** The credential is valid but points at the wrong chain (decision 4.4). */
export class ProviderNetworkMismatchError extends ProviderError {
  readonly expected: NetworkName;
  readonly actual: string;

  constructor(options: {
    provider: ProviderId;
    expected: NetworkName;
    actual: string;
    cause?: unknown;
  }) {
    super(
      `${PROVIDER_LABELS[options.provider]} key is for "${options.actual}", but the selected network is "${options.expected}".`,
      { provider: options.provider, cause: options.cause },
    );
    this.expected = options.expected;
    this.actual = options.actual;
  }
}

/** Both providers failed; carries what each one said. */
export class AllProvidersFailedError extends Error {
  readonly failures: readonly ProviderError[];

  constructor(failures: readonly ProviderError[]) {
    super(
      `No provider could serve the request (${failures
        .map((f) => `${PROVIDER_LABELS[f.provider]}: ${f.message}`)
        .join('; ')}).`,
    );
    this.name = 'AllProvidersFailedError';
    this.failures = failures;
  }
}

/** Retry the same provider after a backoff? (429 / 5xx / network blip.) */
export function isRetryableProviderError(err: unknown): boolean {
  return err instanceof ProviderError && err.retryable;
}

/**
 * Hand the request to the fallback provider?
 *
 * Auth failures DO fail over (decision 4.3) -- a wallet must keep working while
 * a key is expired or mistyped -- but the wrapper flags the primary as needing
 * attention so the UI can nag. A request error is our own bug and would fail
 * identically on the other backend, so it does not fail over.
 */
export function shouldFailover(err: unknown): boolean {
  return (
    err instanceof ProviderRateLimitError ||
    err instanceof ProviderUnavailableError ||
    err instanceof ProviderAuthError ||
    err instanceof ProviderBannedError
  );
}

// ---------------------------------------------------------------------------
// Unit helpers
// ---------------------------------------------------------------------------

const POLICY_ID_HEX_LENGTH = 56; // 28-byte blake2b-224 hash

/** Build the canonical `policyIdHex + assetNameHex` unit string. */
export function assetUnit(policyId: string, assetNameHex: string): string {
  return `${policyId.toLowerCase()}${assetNameHex.toLowerCase()}`;
}

/** Split a unit back into its parts. Throws on anything that is not a unit. */
export function splitAssetUnit(unit: string): { policyId: string; assetNameHex: string } {
  const normalised = unit.toLowerCase();
  if (normalised.length < POLICY_ID_HEX_LENGTH || !/^[0-9a-f]*$/.test(normalised)) {
    throw new TypeError(`Not an asset unit: "${unit}".`);
  }
  return {
    policyId: normalised.slice(0, POLICY_ID_HEX_LENGTH),
    assetNameHex: normalised.slice(POLICY_ID_HEX_LENGTH),
  };
}

/** ADA is not a native token; adapters report it as `lovelace`, not a unit. */
export const LOVELACE_UNIT = 'lovelace';

export function emptyBalance(): Balance {
  return { lovelace: '0', assets: [] };
}

/**
 * Sort assets by unit. Backends list a UTxO's tokens in whatever order their
 * own storage yields, so adapters normalise it -- otherwise the same wallet
 * renders in a different order depending on which provider answered.
 */
export function sortAssets(assets: Asset[]): Asset[] {
  return [...assets].sort((a, b) => a.unit.localeCompare(b.unit));
}
