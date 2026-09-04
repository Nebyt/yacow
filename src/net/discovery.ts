// BIP44 address discovery (plan §12.7, decision 4.7).
//
// A wallet does not know which of its addresses it has ever used, so it derives
// them in order and asks the chain. The scan stops after GAP_LIMIT consecutive
// unused addresses -- the standard rule every Cardano wallet follows, so all of
// them agree on which addresses belong to a restored wallet.
//
// Addresses are derived locally from the account PUBLIC key: read-only work
// never needs the password (decision 3.3).
import { ROLE_EXTERNAL, ROLE_INTERNAL, accountPublicKeyFromHex, baseAddressFromAccountPublic } from '../crypto/derive.js';
import type { ChainProvider } from './provider/types.js';

export const GAP_LIMIT = 20;

export interface DiscoveryOptions {
  gapLimit?: number;
  /** Hard stop, so a corrupt "everything is used" answer cannot loop forever. */
  maxAddresses?: number;
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

async function scanChain(
  provider: ChainProvider,
  accountPubKeyHex: string,
  networkId: number,
  role: number,
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
    const usedInWindow = new Set(await provider.filterUsedAddresses(window));

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

/** Scan both chains of an account. */
export async function discoverAddresses(
  provider: ChainProvider,
  accountPubKeyHex: string,
  networkId: number,
  options: DiscoveryOptions = {},
): Promise<WalletAddresses> {
  const external = await scanChain(provider, accountPubKeyHex, networkId, ROLE_EXTERNAL, options);
  const internal = await scanChain(provider, accountPubKeyHex, networkId, ROLE_INTERNAL, options);
  return {
    external,
    internal,
    all: [...external.all, ...internal.all],
    used: [...external.used, ...internal.used],
  };
}
