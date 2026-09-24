// Mnemonic generation/validation + root-key derivation.
// BIP39 mnemonic → CSL root key (`Bip32PrivateKey.from_bip39_entropy`).
import * as bip39 from 'bip39';
import type { Bip32PrivateKey } from '@emurgo/cardano-serialization-lib-nodejs';
import { RustModule } from './rust.js';

export type WordCount = 15 | 24;

const STRENGTH: Record<WordCount, number> = { 15: 160, 24: 256 };

const EMPTY_PASSWORD = Buffer.alloc(0);

export function generateMnemonic(words: WordCount = 15): string {
  return bip39.generateMnemonic(STRENGTH[words]);
}

export function wordCount(phrase: string): number {
  return phrase.trim().split(/\s+/).filter(Boolean).length;
}

/** Valid BIP39 English phrase of 15 or 24 words (wordlist + checksum). */
export function isValidMnemonic(phrase: string): boolean {
  const count = wordCount(phrase);
  if (count !== 15 && count !== 24) return false;
  return bip39.validateMnemonic(phrase.trim());
}

/**
 * Derive the CIP1852 Bip32 root private key from a mnemonic.
 * Caller owns the returned key's lifetime; wipe any bytes extracted from it.
 */
export function mnemonicToRootKey(phrase: string): Bip32PrivateKey {
  if (!isValidMnemonic(phrase)) {
    throw new Error('Invalid recovery phrase.');
  }
  const entropyHex = bip39.mnemonicToEntropy(phrase.trim());
  const entropy = Buffer.from(entropyHex, 'hex');
  try {
    return RustModule.CSL.Bip32PrivateKey.from_bip39_entropy(entropy, EMPTY_PASSWORD);
  } finally {
    entropy.fill(0);
  }
}
