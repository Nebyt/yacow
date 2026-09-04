// The one thing feature code imports (plan §12.4 B7).
//
//     const balance = await getProvider(network).getBalanceForAddresses(addrs);
//
// Credentials come from user settings, the fallback provider is assembled if a
// secondary is configured, and the result is cached per network so switching
// mainnet <-> preprod does not rebuild anything (decision 4.8).
import {
  resolveProviders,
  type ProviderCredentials,
  type ReadOptions,
  type ResolvedProviders,
} from '../../config/providers.js';
import type { NetworkName } from '../../config/networks.js';
import { createBlockfrostProvider } from './blockfrost.js';
import { createKoiosProvider } from './koios.js';
import { createFallbackProvider } from './fallback.js';
import type { ChainProvider } from './types.js';

/** Raised when nothing usable is configured for a network (gate, decision 4.5). */
export class ProviderNotConfiguredError extends Error {
  readonly network: NetworkName;

  constructor(network: NetworkName) {
    super(`No chain data provider is configured for ${network}. Add an API key in Settings.`);
    this.name = 'ProviderNotConfiguredError';
    this.network = network;
  }
}

export interface RegistryOptions extends ReadOptions {
  /** Test seam; adapters use the global fetch otherwise. */
  fetchImpl?: typeof fetch;
}

function build(
  credentials: ProviderCredentials,
  network: NetworkName,
  options: RegistryOptions,
): ChainProvider {
  const shared = { network, fetchImpl: options.fetchImpl };
  return credentials.provider === 'blockfrost'
    ? createBlockfrostProvider({ ...shared, projectId: credentials.key ?? '' })
    : createKoiosProvider({ ...shared, token: credentials.key });
}

/** Assemble a provider from already-resolved credentials (no cache, no I/O). */
export function buildProvider(
  resolved: ResolvedProviders,
  options: RegistryOptions = {},
): ChainProvider {
  const { primary, fallback, network } = resolved;
  if (primary == null || !primary.usable) throw new ProviderNotConfiguredError(network);
  const primaryProvider = build(primary, network, options);
  // A fallback that cannot serve this network is worse than none: it would turn
  // every failover into a second, guaranteed failure.
  const fallbackProvider =
    fallback != null && fallback.usable ? build(fallback, network, options) : null;
  return createFallbackProvider(primaryProvider, fallbackProvider);
}

interface CacheEntry {
  fingerprint: string;
  provider: ChainProvider;
}

const cache = new Map<NetworkName, CacheEntry>();

/** Changes whenever the effective configuration for a network changes. */
function fingerprint(resolved: ResolvedProviders): string {
  const part = (c: ProviderCredentials | null): string =>
    c == null ? '-' : `${c.provider}:${c.key ?? ''}:${c.usable ? '1' : '0'}`;
  return `${part(resolved.primary)}|${part(resolved.fallback)}`;
}

/**
 * The provider for a network, built once and reused. A settings change is
 * picked up automatically (the fingerprint moves), so callers do not have to
 * remember to invalidate -- {@link invalidateProviderCache} exists for tests
 * and for an explicit "keys changed" signal from the Settings page.
 */
export function getProvider(network: NetworkName, options: RegistryOptions = {}): ChainProvider {
  const resolved = resolveProviders(network, options);
  const key = fingerprint(resolved);
  const cached = cache.get(network);
  if (cached != null && cached.fingerprint === key) return cached.provider;

  const provider = buildProvider(resolved, options);
  cache.set(network, { fingerprint: key, provider });
  return provider;
}

export function invalidateProviderCache(network?: NetworkName): void {
  if (network === undefined) cache.clear();
  else cache.delete(network);
}
