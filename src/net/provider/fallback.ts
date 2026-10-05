// Primary provider with an automatic stand-in (plan §12.4 B5, decision 4.3).
//
// Everything above this layer just asks for a balance. If the primary backend
// is rate-limited, down, or holding a key that no longer works, the request is
// re-run against the secondary instead of failing in the user's face.
//
// Two rules keep that from doing harm:
//   - a failing primary goes into a cooldown, so a dead backend is probed once
//     a minute rather than on every keystroke;
//   - `submitTx` picks its provider BEFORE it sends and never re-sends after an
//     attempt: a submit that timed out may still have reached the chain, and
//     broadcasting the same transaction twice through another backend is a far
//     worse outcome than showing an error.
import {
  AllProvidersFailedError,
  ProviderAuthError,
  ProviderError,
  shouldFailover,
  type AccountState,
  type AssetInfo,
  type Balance,
  type ChainProvider,
  type HealthStatus,
  type HistoryQuery,
  type PoolInfo,
  type ProtocolParams,
  type ProviderId,
  type Tip,
  type TxDetail,
  type TxSummary,
  type Utxo,
} from './types.js';

export const DEFAULT_COOLDOWN_MS = 60_000;

export interface FallbackOptions {
  /** How long a failing primary is skipped before it is tried again. */
  cooldownMs?: number;
  now?: () => number;
}

export interface FallbackProvider extends ChainProvider {
  /** Which backend answered the last successful call (for the "via X" marker). */
  readonly lastServedBy: ProviderId | null;
  /** True once the primary has rejected our credential -- the UI should nag. */
  readonly primaryNeedsAttention: boolean;
  /** True while the primary is in its cooldown window. */
  readonly primaryCoolingDown: boolean;
}

export function createFallbackProvider(
  primary: ChainProvider,
  secondary: ChainProvider | null = null,
  { cooldownMs = DEFAULT_COOLDOWN_MS, now = Date.now }: FallbackOptions = {},
): FallbackProvider {
  let cooldownUntil = 0;
  let lastServedBy: ProviderId | null = null;
  let primaryNeedsAttention = false;

  const coolingDown = (): boolean => now() < cooldownUntil;

  function noteFailure(err: unknown): void {
    cooldownUntil = now() + cooldownMs;
    if (err instanceof ProviderAuthError) primaryNeedsAttention = true;
  }

  /** The provider a send-once operation should use, decided before sending. */
  function chooseForSubmit(): ChainProvider {
    return coolingDown() && secondary != null ? secondary : primary;
  }

  async function run<T>(
    call: (provider: ChainProvider) => Promise<T>,
    candidates: readonly ChainProvider[] = secondary == null ? [primary] : [primary, secondary],
  ): Promise<T> {
    const [first, second = null] = candidates;
    if (first == null) throw new Error('No provider can serve this request.');

    // Known-bad primary: skip straight to the stand-in, no wasted round trip.
    if (coolingDown() && second != null) {
      const result = await call(second);
      lastServedBy = second.id;
      return result;
    }

    try {
      const result = await call(first);
      lastServedBy = first.id;
      cooldownUntil = 0; // it answered, so stop skipping it
      return result;
    } catch (err) {
      if (!shouldFailover(err)) throw err; // our own bad request: the other backend would fail too
      // Only the primary has a cooldown to enter: an optional account-level
      // method may be served by the secondary alone, and cooling the primary
      // down for that would be wrong.
      if (first === primary) noteFailure(err);
      if (second == null) throw err;

      try {
        const result = await call(second);
        lastServedBy = second.id;
        return result;
      } catch (secondaryErr) {
        if (err instanceof ProviderError && secondaryErr instanceof ProviderError) {
          throw new AllProvidersFailedError([err, secondaryErr]);
        }
        throw secondaryErr;
      }
    }
  }

  const provider: FallbackProvider = {
    id: primary.id,
    network: primary.network,

    get lastServedBy() {
      return lastServedBy;
    },
    get primaryNeedsAttention() {
      return primaryNeedsAttention;
    },
    get primaryCoolingDown() {
      return coolingDown();
    },

    getTip: (): Promise<Tip> => run((p) => p.getTip()),
    getProtocolParams: (): Promise<ProtocolParams> => run((p) => p.getProtocolParams()),
    filterUsedAddresses: (addresses: string[]): Promise<string[]> =>
      run((p) => p.filterUsedAddresses(addresses)),
    getUtxosForAddresses: (addresses: string[]): Promise<Utxo[]> =>
      run((p) => p.getUtxosForAddresses(addresses)),
    getBalanceForAddresses: (addresses: string[]): Promise<Balance> =>
      run((p) => p.getBalanceForAddresses(addresses)),
    getTransactionsForAddresses: (
      addresses: string[],
      query?: HistoryQuery,
    ): Promise<TxSummary[]> => run((p) => p.getTransactionsForAddresses(addresses, query)),
    getTransaction: (hash: string): Promise<TxDetail | null> => run((p) => p.getTransaction(hash)),
    getAssetInfo: (units: string[]): Promise<AssetInfo[]> => run((p) => p.getAssetInfo(units)),

    async submitTx(cbor: Uint8Array): Promise<string> {
      const chosen = chooseForSubmit();
      try {
        const hash = await chosen.submitTx(cbor);
        lastServedBy = chosen.id;
        return hash;
      } catch (err) {
        // Deliberately no second attempt: see the note at the top of the file.
        if (chosen === primary) noteFailure(err);
        throw err;
      }
    },

    async healthCheck(): Promise<HealthStatus> {
      const health = await primary.healthCheck();
      if (health.ok) {
        cooldownUntil = 0;
        primaryNeedsAttention = false;
      }
      return health;
    },

    async getAccountState(stakeAddress: string): Promise<AccountState | null> {
      return run((p) => p.getAccountState?.(stakeAddress) ?? Promise.resolve(null));
    },

    async getPoolInfo(poolId: string): Promise<PoolInfo | null> {
      return run((p) => p.getPoolInfo?.(poolId) ?? Promise.resolve(null));
    },
  };

  // Optional account-level methods (B12) are exposed only when a backend can
  // actually serve them. A wrapper that answered "no addresses" for a backend
  // that cannot answer would look exactly like a fresh wallet, which is the one
  // mistake this layer must not make.
  const addressCandidates = providerCandidates(primary, secondary, 'getAccountAddresses');
  if (addressCandidates.length > 0) {
    provider.getAccountAddresses = (stakeAddress: string): Promise<string[]> =>
      run((p) => p.getAccountAddresses?.(stakeAddress) ?? Promise.resolve([]), addressCandidates);
  }

  const balanceCandidates = providerCandidates(primary, secondary, 'getAccountBalance');
  if (balanceCandidates.length > 0) {
    provider.getAccountBalance = (stakeAddress: string): Promise<Balance | null> =>
      run((p) => p.getAccountBalance?.(stakeAddress) ?? Promise.resolve(null), balanceCandidates);
  }

  return provider;
}

/** The providers, primary first, that implement an optional method. */
function providerCandidates(
  primary: ChainProvider,
  secondary: ChainProvider | null,
  method: 'getAccountAddresses' | 'getAccountBalance',
): ChainProvider[] {
  return [primary, secondary].filter(
    (provider): provider is ChainProvider =>
      provider != null && typeof provider[method] === 'function',
  );
}
