// What the setup gate offers the user, and what happens when they choose
// (plan §12.5, decisions 4.5 / 4.9).
//
// Kept out of the Ink page so it can be tested under jest: the page renders
// these choices and calls these actions, and holds no policy of its own.
import { invalidateProviderCache } from '../net/provider/registry.js';
import { createBlockfrostProvider } from '../net/provider/blockfrost.js';
import { createKoiosProvider } from '../net/provider/koios.js';
import {
  ProviderAuthError,
  ProviderNetworkMismatchError,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  type ProviderId,
  type Tip,
} from '../net/provider/types.js';
import { NETWORKS, type NetworkName } from './networks.js';
import {
  isPerNetworkProvider,
  keyOf,
  readProviders,
  requiresKey,
  resolveProviders,
  setFallback,
  setPrimary,
  setProviderKey,
  type ReadOptions,
} from './providers.js';

export type SetupChoice =
  | { kind: 'add-key'; provider: ProviderId; network: NetworkName; label: string }
  | { kind: 'use-provider'; provider: ProviderId; network: NetworkName; label: string }
  | { kind: 'switch-network'; network: NetworkName; label: string };

const OTHER_NETWORK: Readonly<Record<NetworkName, NetworkName>> = Object.freeze({
  mainnet: 'preprod',
  preprod: 'mainnet',
});

/**
 * The options to show when `network` has no usable primary.
 *
 * Ordered by what is least work for the user: a provider that can already serve
 * this network (decision 4.9 -- typically the configured fallback) comes first,
 * then adding a key, then going back to the network that does work.
 */
export function setupChoices(network: NetworkName, options: ReadOptions = {}): SetupChoice[] {
  const settings = readProviders(options.homeDir);
  const { primary } = resolveProviders(network, options);
  const choices: SetupChoice[] = [];

  for (const provider of PROVIDER_IDS) {
    if (provider === primary?.provider) continue;
    const hasKey = keyOf(settings, provider, network) != null;
    if (hasKey || !requiresKey(provider)) {
      const how = hasKey
        ? isPerNetworkProvider(provider)
          ? `key already set for ${network}`
          : 'token already set'
        : 'no key needed, lower rate limit';
      choices.push({
        kind: 'use-provider',
        provider,
        network,
        label: `Use ${PROVIDER_LABELS[provider]} (${how})`,
      });
    }
  }

  for (const provider of PROVIDER_IDS) {
    if (keyOf(settings, provider, network) != null) continue;
    choices.push({
      kind: 'add-key',
      provider,
      network,
      // A Koios token is account-wide, so naming a network here would be a lie.
      label: isPerNetworkProvider(provider)
        ? `Add a ${PROVIDER_LABELS[provider]} key for ${NETWORKS[network].displayName}`
        : `Add a ${PROVIDER_LABELS[provider]} token (works on all networks)`,
    });
  }

  // Only worth offering when the other network actually works.
  const other = OTHER_NETWORK[network];
  if (resolveProviders(other, options).primary?.usable === true) {
    choices.push({
      kind: 'switch-network',
      network: other,
      label: `Switch back to ${NETWORKS[other].displayName}`,
    });
  }

  return choices;
}

export interface KeyTestResult {
  ok: boolean;
  tip: Tip | null;
  /** Ready to show: why it failed, in the user's terms. */
  message: string;
}

export interface TestOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Probe a key before it is saved, so a typo is caught here rather than on the
 * dashboard. A wrong-chain key is reported as such (decision 4.4).
 */
export async function testProviderKey(
  provider: ProviderId,
  network: NetworkName,
  key: string | null,
  { fetchImpl }: TestOptions = {},
): Promise<KeyTestResult> {
  const shared = { network, fetchImpl, retries: 0 };
  try {
    const chain =
      provider === 'blockfrost'
        ? createBlockfrostProvider({ ...shared, projectId: key ?? '' })
        : createKoiosProvider({ ...shared, token: key });
    const health = await chain.healthCheck();
    return {
      ok: health.ok,
      tip: health.tip,
      message: health.ok
        ? `Connected to ${NETWORKS[network].displayName} at block ${health.tip?.height ?? '?'}.`
        : `${PROVIDER_LABELS[provider]} did not answer. Check your connection and try again.`,
    };
  } catch (err) {
    if (err instanceof ProviderNetworkMismatchError)
      return { ok: false, tip: null, message: err.message };
    if (err instanceof ProviderAuthError) {
      return {
        ok: false,
        tip: null,
        message: `${PROVIDER_LABELS[provider]} rejected that key for ${network}.`,
      };
    }
    return {
      ok: false,
      tip: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Save a key for ONE network and give the provider a role if it has none.
 * The other network's key is untouched (decision 4.8).
 */
export function saveProviderKey(
  provider: ProviderId,
  network: NetworkName,
  key: string | null,
  { homeDir }: { homeDir?: string } = {},
): void {
  setProviderKey(provider, network, key, homeDir);
  const settings = readProviders(homeDir);
  if (settings.primary == null) setPrimary(provider, homeDir);
  else if (settings.primary !== provider && settings.fallback == null) {
    setFallback(provider, homeDir);
  }
  invalidateProviderCache(network);
}

/**
 * Promote a provider to primary. The provider it replaces becomes the fallback
 * when nothing else holds that role, so a working backend is never discarded.
 */
export function makePrimary(provider: ProviderId, { homeDir }: { homeDir?: string } = {}): void {
  const previous = readProviders(homeDir).primary;
  setPrimary(provider, homeDir);
  if (previous != null && previous !== provider && readProviders(homeDir).fallback == null) {
    setFallback(previous, homeDir);
  }
  invalidateProviderCache();
}
