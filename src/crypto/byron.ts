// Byron-era (bootstrap) address derivation: BIP44 path 44'/1815'/account'/role/index
// with Icarus-style addresses. This is the scheme Yoroi paper wallets were
// printed with, and it matches yoroi-extension's restoration/byron/scan.js
// (v2genAddressBatchFunc -> bootstrap_era_address + protocol_magic).
//
// The extension needs the legacy WalletV2 WASM for those addresses; the
// serialization lib's ByronAddress.icarus_from_key produces byte-identical
// output (locked by the golden vectors in byron.test.ts), so nothing here
// depends on WalletV2.
//
// Note: `WalletV2.bip44_chain(internal)` takes `false` for the external chain,
// which app/api/ada/index.js:1772 passes inverted. Here role 0 is external and
// role 1 is internal, per BIP44.
import type { Bip32PrivateKey, Bip32PublicKey } from '@emurgo/cardano-serialization-lib-nodejs';
import { RustModule } from './rust.js';
import { COIN_CARDANO, HARD, ROLE_EXTERNAL } from './derive.js';

export const PURPOSE_BIP44 = HARD + 44;

/** rootKey -> 44'/1815'/account' */
export function deriveByronAccountKey(rootKey: Bip32PrivateKey, account = 0): Bip32PrivateKey {
  return rootKey
    .derive(PURPOSE_BIP44)
    .derive(COIN_CARDANO)
    .derive(HARD + account);
}

export function deriveByronAccountPublic(rootKey: Bip32PrivateKey, account = 0): Bip32PublicKey {
  return deriveByronAccountKey(rootKey, account).to_public();
}

/** Human-readable derivation path, e.g. "44'/1815'/0'/0/3". */
export function byronAddressPath(account: number, role: number, index: number): string {
  return `44'/1815'/${account}'/${role}/${index}`;
}

export interface ByronAddressRange {
  /** 0 = external (receive), 1 = internal (change). Defaults to external. */
  role?: number;
  /** First address index. Defaults to 0. */
  from?: number;
  count: number;
  /** Byron protocol magic of the target network (see config/networks.ts). */
  protocolMagic: number;
}

/** Base58 Byron addresses for a contiguous index range of one chain. */
export function byronAddresses(accountPublic: Bip32PublicKey, opts: ByronAddressRange): string[] {
  const { count, protocolMagic } = opts;
  const role = opts.role ?? ROLE_EXTERNAL;
  const from = opts.from ?? 0;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('count must be a non-negative integer.');
  }
  if (!Number.isInteger(from) || from < 0) {
    throw new Error('from must be a non-negative integer.');
  }

  const chain = accountPublic.derive(role);
  return Array.from({ length: count }, (_unused, i) =>
    RustModule.CSL.ByronAddress.icarus_from_key(chain.derive(from + i), protocolMagic).to_base58(),
  );
}
