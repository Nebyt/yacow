// Wallet balance (plan §12.7 / §3 Op 2), served by whichever provider is live.
//
// Nothing here knows about Blockfrost or Koios: it asks the registry for the
// network's provider and works on the normalised DTOs (decision 4.2).
import { discoverAddresses, type DiscoveryOptions } from '../net/discovery.js';
import type { AssetInfo, Balance, ChainProvider } from '../net/provider/types.js';
import { emptyBalance, splitAssetUnit } from '../net/provider/types.js';

export const LOVELACE_PER_ADA = 1_000_000n;

export interface TokenBalance {
  unit: string;
  quantity: string;
  /** Best available name: registry ticker, then name, then the hex asset name. */
  label: string;
  decimals: number;
  /** Quantity with the decimal point applied, ready to print. */
  display: string;
}

export interface WalletBalance {
  lovelace: string;
  /** ADA with 6 decimals, trailing zeros trimmed (e.g. "12.5"). */
  ada: string;
  tokens: TokenBalance[];
  /** Addresses the scan derived, so callers can reuse them (Receive, Send). */
  addresses: string[];
  /** The subset that has ever been used -- what the totals were read from. */
  usedAddresses: string[];
  nextUnusedAddress: string;
}

/** Apply a decimal exponent to an integer quantity without touching floats. */
export function formatQuantity(quantity: string, decimals: number): string {
  const negative = quantity.startsWith('-');
  const digits = (negative ? quantity.slice(1) : quantity).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? '' : digits.slice(digits.length - decimals).replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return fraction === '' ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

export function formatAda(lovelace: string): string {
  return formatQuantity(lovelace, 6);
}

function labelFor(unit: string, info: AssetInfo | undefined): string {
  if (info?.ticker != null && info.ticker !== '') return info.ticker;
  if (info?.name != null && info.name !== '') return info.name;
  const { assetNameHex } = splitAssetUnit(unit);
  if (assetNameHex === '') return `${unit.slice(0, 8)}…`;
  // Unknown token: show the decoded name when it is printable, else the hex.
  const text = Buffer.from(assetNameHex, 'hex').toString('utf8');
  return /^[\x20-\x7e]+$/.test(text) ? text : assetNameHex;
}

export function describeTokens(balance: Balance, metadata: AssetInfo[]): TokenBalance[] {
  const byUnit = new Map(metadata.map((info) => [info.unit, info]));
  return balance.assets.map((asset) => {
    const info = byUnit.get(asset.unit);
    const decimals = info?.decimals ?? 0;
    return {
      unit: asset.unit,
      quantity: asset.quantity,
      label: labelFor(asset.unit, info),
      decimals,
      display: formatQuantity(asset.quantity, decimals),
    };
  });
}

/** Discover the wallet's addresses, then total what they hold. */
export async function fetchWalletBalance(
  provider: ChainProvider,
  accountPubKeyHex: string,
  networkId: number,
  options: DiscoveryOptions = {},
): Promise<WalletBalance> {
  const addresses = await discoverAddresses(provider, accountPubKeyHex, networkId, options);
  // Only used addresses can hold anything, and on a per-address backend each
  // extra address is another request -- a fresh wallet needs no balance call at
  // all.
  const balance =
    addresses.used.length === 0
      ? emptyBalance()
      : await provider.getBalanceForAddresses(addresses.used);
  // Only ask about tokens the wallet actually holds.
  const metadata =
    balance.assets.length === 0
      ? []
      : await provider.getAssetInfo(balance.assets.map((asset) => asset.unit));

  return {
    lovelace: balance.lovelace,
    ada: formatAda(balance.lovelace),
    tokens: describeTokens(balance, metadata),
    addresses: addresses.all,
    usedAddresses: addresses.used,
    nextUnusedAddress: addresses.external.nextUnused,
  };
}
