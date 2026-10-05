// BIP44 address discovery (plan §12.7, decision 4.7).
//
// A wallet does not know which of its addresses it has ever used, so it derives
// them in order and asks the chain. The scan stops after GAP_LIMIT consecutive
// unused addresses -- the standard rule every Cardano wallet follows, so all of
// them agree on which addresses belong to a restored wallet.
//
// Addresses are derived locally from the account PUBLIC key: read-only work
// never needs the password (decision 3.3).
import {
  ROLE_EXTERNAL,
  ROLE_INTERNAL,
  accountPublicKeyFromHex,
  baseAddressFromAccountPublic,
} from '../crypto/derive.js';
import type { ChainProvider } from './provider/types.js';

export const GAP_LIMIT = 20;

export interface DiscoveryOptions {
  gapLimit?: number;
  /** Hard stop, so a corrupt "everything is used" answer cannot loop forever. */
  maxAddresses?: number;
  /**
   * The account's reward address. When it is set AND the provider can list the
   * account's addresses, discovery asks about the account once instead of about
   * every derived address (B12 / plan §14). Without it nothing changes.
   */
  stakeAddress?: string;
}

export interface ChainAddresses {
  role: number;
  /** Every address derived during the scan, in derivation order. */
  all: string[];
  used: string[];
  /** First address after the last used one -- what Receive should show. */
  nextUnused: string;
}

export interface WalletAddresses {
  external: ChainAddresses;
  internal: ChainAddresses;
  /** Every address derived during the scan, both chains. */
  all: string[];
  /**
   * Only the addresses the chain has actually seen, both chains.
   *
   * This is what balance and UTxO queries must use: an unused address holds
   * nothing by definition, so asking about it is pure waste -- and on
   * Blockfrost, which has no batch endpoint, it is a whole extra HTTP request
   * each. Measured on mainnet: querying all 80 derived addresses instead of the
   * handful of used ones took ~22s.
   */
  used: string[];
}

/**
 * Walk one chain in derivation order and stop after `gapLimit` consecutive
 * unused addresses.
 *
 * `usedIn` answers "which of these window addresses are used"; the only
 * difference between the account path and the per-address scan is where that
 * answer comes from (B12 §14.5). Everything else -- the gap rule, the window
 * size, `nextUnused` -- stays identical, which is what keeps the two paths
 * provably equivalent.
 */
async function walkChain(
  accountPubKeyHex: string,
  networkId: number,
  role: number,
  usedIn: (window: string[]) => Promise<Set<string>>,
  { gapLimit = GAP_LIMIT, maxAddresses = 1000 }: DiscoveryOptions,
): Promise<ChainAddresses> {
  const accountPublic = accountPublicKeyFromHex(accountPubKeyHex);
  const all: string[] = [];
  const used: string[] = [];
  let index = 0;
  let unusedTail = 0;

  while (unusedTail < gapLimit && index < maxAddresses) {
    // Derive a whole window at a time: Koios answers it in one request, and
    // Blockfrost's per-address fan-out is capped by its own concurrency limit.
    const window = Array.from({ length: gapLimit }, (_, offset) =>
      baseAddressFromAccountPublic(accountPublic, role, index + offset, networkId),
    );
    const usedInWindow = await usedIn(window);

    for (const address of window) {
      all.push(address);
      if (usedInWindow.has(address)) {
        used.push(address);
        unusedTail = 0;
      } else {
        unusedTail += 1;
      }
    }
    index += gapLimit;
  }

  const lastUsed = used.length === 0 ? -1 : all.lastIndexOf(used[used.length - 1]);
  return { role, all, used, nextUnused: all[lastUsed + 1] ?? all[0] };
}

/**
 * The account's complete used-address set, or `null` to scan per address.
 *
 * `null` covers two cases on purpose: the provider has no account-level method
 * (Koios, whose `account_addresses` lists current holdings only) and the
 * account call failing. The per-address scan is the proven path, so an
 * optimisation that did not work must not become an outage.
 */
async function accountUsedSet(
  provider: ChainProvider,
  stakeAddress: string | undefined,
): Promise<Set<string> | null> {
  if (stakeAddress == null || provider.getAccountAddresses == null) return null;
  try {
    return new Set(await provider.getAccountAddresses(stakeAddress));
  } catch {
    return null;
  }
}

/** Per-address scan for one chain, batched by the adapter where it can. */
function scanChain(
  provider: ChainProvider,
  accountPubKeyHex: string,
  networkId: number,
  role: number,
  options: DiscoveryOptions,
): Promise<ChainAddresses> {
  return walkChain(
    accountPubKeyHex,
    networkId,
    role,
    async (window) => new Set(await provider.filterUsedAddresses(window)),
    options,
  );
}

/** Scan both chains of an account. */
export async function discoverAddresses(
  provider: ChainProvider,
  accountPubKeyHex: string,
  networkId: number,
  options: DiscoveryOptions = {},
): Promise<WalletAddresses> {
  // One account lookup (when the provider supports it) replaces a request per
  // address; the local derivation still decides order and the next unused one.
  const accountUsed = await accountUsedSet(provider, options.stakeAddress);
  const chain = (role: number): Promise<ChainAddresses> =>
    accountUsed == null
      ? scanChain(provider, accountPubKeyHex, networkId, role, options)
      : walkChain(
          accountPubKeyHex,
          networkId,
          role,
          async (window) => new Set(window.filter((address) => accountUsed.has(address))),
          options,
        );

  const external = await chain(ROLE_EXTERNAL);
  const internal = await chain(ROLE_INTERNAL);
  return {
    external,
    internal,
    all: [...external.all, ...internal.all],
    used: [...external.used, ...internal.used],
  };
}
