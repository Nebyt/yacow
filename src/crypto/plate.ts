// Wallet "plate" (CIP4 checksum): the HADA-1234 style icon/label shown per
// wallet (`walletChecksum` over the account public key bytes).
import { walletChecksum, type WalletChecksum } from '@emurgo/cip4-js';
import type { Bip32PrivateKey } from '@emurgo/cardano-serialization-lib-nodejs';
import { accountPublicKeyHex } from './derive.js';

export interface Plate {
  /** e.g. "HADA-1234" */
  textPart: string;
  /** CIP4 image seed (for a future graphical icon); kept for parity. */
  imagePart: string;
}

function toPlate(cs: WalletChecksum): Plate {
  return { textPart: cs.TextPart, imagePart: cs.ImagePart };
}

/** Plate from the account public key hex (what we store in the keystore). */
export function plateFromAccountPublicKeyHex(hex: string): Plate {
  return toPlate(walletChecksum(hex));
}

/** Plate from a root key (create/restore flow). */
export function plateFromRootKey(rootKey: Bip32PrivateKey, account = 0): Plate {
  return plateFromAccountPublicKeyHex(accountPublicKeyHex(rootKey, account));
}
