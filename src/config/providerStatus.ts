// What the Settings page shows and does (plan §12.6, decisions 4.8 / 4.9).
//
// The provider section is a `provider x network` grid: both providers hold a
// mainnet AND a preprod key at the same time, and editing one cell never
// touches another. This module builds the rows and performs the actions; the
// page is only rendering and keystrokes.
import { invalidateProviderCache } from '../net/provider/registry.js';
import { PROVIDER_IDS, PROVIDER_LABELS, type ProviderId } from '../net/provider/types.js';
import { NETWORKS, type NetworkName } from './networks.js';
import {
  ENV_VARS,
  clearProviderKey,
  isPerNetworkProvider,
  keyOf,
  maskKey,
  readProviders,
  requiresKey,
  setFallback,
  setPrimary,
  type ReadOptions,
} from './providers.js';

export const NETWORK_ORDER: readonly NetworkName[] = ['mainnet', 'preprod'] as const;

export type ProviderRole = 'primary' | 'fallback' | null;

/**
 * What a key covers: one network (Blockfrost project ids) or every network at
 * once (a Koios account token). The grid renders one cell per scope, so Koios
 * shows a single row entry instead of asking for the same string twice.
 */
export type KeyScope = NetworkName | 'all';

export interface KeyCell {
  scope: KeyScope;
  /** How to name the scope in the UI. */
  scopeLabel: string;
  /** The network to pass when editing this cell (any network for 'all'). */
  network: NetworkName;
  /** Rendered, never the real key. */
  masked: string;
  isSet: boolean;
  /** True when an env var supplies the key, which overrides the stored one. */
  fromEnv: boolean;
  /** Can this provider serve this scope as things stand? */
  usable: boolean;
}

export interface ProviderRow {
  provider: ProviderId;
  label: string;
  role: ProviderRole;
  /** "primary" / "fallback (used when primary is unavailable)" / "not in use". */
  roleLabel: string;
  /** False when one key covers every network (Koios). */
  perNetwork: boolean;
  cells: KeyCell[];
}

function roleLabelFor(role: ProviderRole): string {
  if (role === 'primary') return 'primary';
  if (role === 'fallback') return 'fallback (used when primary is unavailable)';
  return 'not in use';
}

/**
 * One row per provider. Blockfrost gets a cell per network; Koios gets a single
 * account-wide cell. `activeNetwork` is not filtered out -- the page highlights
 * it, because seeing the other chain's key is the point of the grid.
 */
export function providerRows(options: ReadOptions = {}): ProviderRow[] {
  const settings = readProviders(options.homeDir);
  const env = options.env ?? process.env;

  return PROVIDER_IDS.map((provider) => {
    const role: ProviderRole =
      settings.primary === provider ? 'primary' : settings.fallback === provider ? 'fallback' : null;
    const envValue = env[ENV_VARS[provider]];
    const fromEnv = envValue != null && envValue.trim() !== '';
    const perNetwork = isPerNetworkProvider(provider);

    const cellFor = (scope: KeyScope, network: NetworkName): KeyCell => {
      const stored = keyOf(settings, provider, network);
      const effective = fromEnv ? envValue.trim() : stored;
      return {
        scope,
        scopeLabel: scope === 'all' ? 'All networks' : NETWORKS[scope].displayName,
        network,
        masked: fromEnv ? `${maskKey(effective)} (from ${ENV_VARS[provider]})` : maskKey(stored),
        isSet: effective != null,
        fromEnv,
        usable: effective != null || !requiresKey(provider),
      };
    };

    return {
      provider,
      label: PROVIDER_LABELS[provider],
      role,
      roleLabel: roleLabelFor(role),
      perNetwork,
      cells: perNetwork
        ? NETWORK_ORDER.map((network) => cellFor(network, network))
        : [cellFor('all', NETWORK_ORDER[0])],
    };
  });
}

/** One-line summary for the page header: who serves the active network. */
export function describeActiveProviders(network: NetworkName, options: ReadOptions = {}): string {
  const rows = providerRows(options);
  const cellFor = (row: ProviderRow): KeyCell =>
    (row.cells.find((cell) => cell.scope === network) ?? row.cells[0]) as KeyCell;
  const primary = rows.find((row) => row.role === 'primary');
  const fallback = rows.find((row) => row.role === 'fallback');

  if (primary == null || !cellFor(primary).usable) {
    return `No provider can serve ${NETWORKS[network].displayName} yet.`;
  }
  const stand = fallback != null && cellFor(fallback).usable ? `, ${fallback.label} as fallback` : '';
  return `${NETWORKS[network].displayName} served by ${primary.label}${stand}.`;
}

/** Exchange the two roles. A no-op unless both are filled. */
export function swapRoles({ homeDir }: { homeDir?: string } = {}): void {
  const { primary, fallback } = readProviders(homeDir);
  if (primary == null || fallback == null) return;
  setPrimary(fallback, homeDir); // clears the fallback slot if it held this one
  setFallback(primary, homeDir);
  invalidateProviderCache();
}

export function clearFallback({ homeDir }: { homeDir?: string } = {}): void {
  setFallback(null, homeDir);
  invalidateProviderCache();
}

/**
 * Remove a stored key: one network's project id for Blockfrost (the other
 * network keeps its own), or the account-wide token for Koios.
 */
export function removeKey(
  provider: ProviderId,
  network: NetworkName,
  { homeDir }: { homeDir?: string } = {},
): void {
  clearProviderKey(provider, network, homeDir);
  invalidateProviderCache(network);
}
