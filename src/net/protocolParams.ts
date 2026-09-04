// Protocol parameters, from the live chain (decision 4.6).
//
// They used to be hardcoded next to the Yoroi backend URL, which meant a fee
// change on chain would silently make every transaction we build wrong. Now
// they come from the provider and are cached: they only move at an epoch
// boundary (5 days), so re-fetching them per transaction would be waste.
import type { NetworkName } from '../config/networks.js';
import type { ChainProvider, ProtocolParams } from './provider/types.js';

/** One hour: far shorter than an epoch, far longer than a session of sends. */
export const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Mainnet values as of 2026-09. Used by offline unit tests and as a last-resort
 * default; anything that actually builds a transaction must use the live values.
 */
export const FALLBACK_PROTOCOL_PARAMS: ProtocolParams = Object.freeze({
  epoch: 0,
  linearFee: { coefficient: '44', constant: '155381' },
  coinsPerUtxoByte: '4310',
  poolDeposit: '500000000',
  keyDeposit: '2000000',
  maxTxSize: 16384,
  maxValueSize: 5000,
});

interface CacheEntry {
  params: ProtocolParams;
  fetchedAt: number;
}

const cache = new Map<NetworkName, CacheEntry>();

export interface FetchOptions {
  ttlMs?: number;
  now?: () => number;
}

export async function fetchProtocolParams(
  provider: ChainProvider,
  { ttlMs = CACHE_TTL_MS, now = Date.now }: FetchOptions = {},
): Promise<ProtocolParams> {
  const cached = cache.get(provider.network);
  if (cached != null && now() - cached.fetchedAt < ttlMs) return cached.params;

  const params = await provider.getProtocolParams();
  cache.set(provider.network, { params, fetchedAt: now() });
  return params;
}

export function clearProtocolParamsCache(network?: NetworkName): void {
  if (network === undefined) cache.clear();
  else cache.delete(network);
}
