// CIP1852 key derivation + Shelley base-address construction.
// Ports the derivation used in yoroi-extension plate.js / numbersConfig.js.
import type {
  Bip32PrivateKey,
  Bip32PublicKey,
} from '@emurgo/cardano-serialization-lib-nodejs';
import { RustModule } from './rust.js';
import { mnemonicToRootKey } from './mnemonic.js';
import { getNetwork, type NetworkName } from '../config/networks.js';

export const HARD = 0x80000000; // 2^31, hardened-derivation offset
export const PURPOSE_CIP1852 = HARD + 1852;
export const COIN_CARDANO = HARD + 1815;

export const ROLE_EXTERNAL = 0; // receive addresses
export const ROLE_INTERNAL = 1; // change addresses
export const ROLE_STAKING = 2; // chimeric/staking
export const STAKING_INDEX = 0;

/** rootKey -> 1852'/1815'/account' */
export function deriveAccountKey(rootKey: Bip32PrivateKey, account = 0): Bip32PrivateKey {
  return rootKey
    .derive(PURPOSE_CIP1852)
    .derive(COIN_CARDANO)
    .derive(HARD + account);
}

/** Hex of the account-level Bip32 public key (64 bytes) — used for the plate and read-only ops. */
export function accountPublicKeyHex(rootKey: Bip32PrivateKey, account = 0): string {
  const pub = deriveAccountKey(rootKey, account).to_public();
  return Buffer.from(pub.as_bytes()).toString('hex');
}

export function accountPublicKeyFromHex(hex: string): Bip32PublicKey {
  return RustModule.CSL.Bip32PublicKey.from_bytes(Buffer.from(hex, 'hex'));
}

export function rewardAddressBech32FromAccountPublic(accountPublic: Bip32PublicKey, network: NetworkName): string {
  const CSL = RustModule.CSL;
  const stakeKey = accountPublic.derive(ROLE_STAKING).derive(STAKING_INDEX).to_raw_key();
  const stakeCred = CSL.Credential.from_keyhash(stakeKey.hash());
  const stakeAddr = CSL.RewardAddress.new(getNetwork(network).networkId, stakeCred);
  return stakeAddr.to_address().to_bech32();
}

/** Build a Shelley base address (payment + staking) as bech32 from an account public key. */
export function baseAddressFromAccountPublic(
  accountPublic: Bip32PublicKey,
  role: number,
  index: number,
  networkId: number,
): string {
  const CSL = RustModule.CSL;
  const paymentKey = accountPublic.derive(role).derive(index).to_raw_key();
  const stakeKey = accountPublic.derive(ROLE_STAKING).derive(STAKING_INDEX).to_raw_key();
  const payment = CSL.Credential.from_keyhash(paymentKey.hash());
  const stake = CSL.Credential.from_keyhash(stakeKey.hash());
  const addr = CSL.BaseAddress.new(networkId, payment, stake);
  return addr.to_address().to_bech32();
}

export interface DerivePathOpts {
  account?: number;
  role?: number;
  index: number;
  network: NetworkName;
}

/** Convenience: mnemonic -> external/internal address at a path (used by tests + Receive). */
export function deriveBaseAddress(mnemonic: string, opts: DerivePathOpts): string {
  const rootKey = mnemonicToRootKey(mnemonic);
  const accountPublic = deriveAccountKey(rootKey, opts.account ?? 0).to_public();
  return baseAddressFromAccountPublic(
    accountPublic,
    opts.role ?? ROLE_EXTERNAL,
    opts.index,
    getNetwork(opts.network).networkId,
  );
}
