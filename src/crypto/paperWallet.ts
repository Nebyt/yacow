// Yoroi paper wallet (21-word) support.
// Ports yoroi-extension app/api/ada/lib/cardanoCrypto/paperWallet.js.
//
// A Yoroi paper wallet is a 21-word phrase whose entropy is a *scrambled*
// 15-word wallet phrase; the paper password is the scrambling key. Unscrambling
// needs the legacy WalletV2 WASM (`cardano-wallet`, js-cardano-wasm) that the
// extension also uses -- the serialization lib has no equivalent. That package
// is a CommonJS wasm-bindgen build, so it comes in through createRequire, and
// only the first time a paper wallet is actually processed (the TUI never pays
// for loading it).
import { createRequire } from 'node:module';
import * as bip39 from 'bip39';
import { isValidMnemonic, wordCount } from './mnemonic.js';
import { withSecretSync } from '../security/secretBuffer.js';

export const PAPER_WORD_COUNT = 21;
export const PAPER_UNSCRAMBLED_WORD_COUNT = 15;

/**
 * Unscrambling never fails on a wrong password -- *any* password yields some
 * valid 15-word phrase (just a different wallet). So validation can only check
 * the shape of the paper phrase, using a throwaway password.
 */
const VALIDATION_PASSWORD = 'xxx';

type WalletV2 = typeof import('cardano-wallet');

let cachedWalletV2: WalletV2 | undefined;

function walletV2(): WalletV2 {
  if (cachedWalletV2 === undefined) {
    cachedWalletV2 = createRequire(import.meta.url)('cardano-wallet') as WalletV2;
  }
  return cachedWalletV2;
}

/** Collapse whitespace so pasted phrases (newlines, double spaces) work. */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Recover the 15-word wallet phrase from a 21-word paper phrase + paper password.
 *
 * Throws if the paper phrase is malformed, but NOT on a wrong password: the
 * returned phrase is then a valid phrase for a different (empty) wallet. The
 * caller must surface that to the user -- see the plate check in the
 * `paper-addresses` command.
 */
export function unscramblePaperMnemonic(phrase: string, password: string): string {
  const paper = normalizePhrase(phrase);
  const count = wordCount(paper);
  if (count !== PAPER_WORD_COUNT) {
    throw new Error(`A Yoroi paper wallet phrase has ${PAPER_WORD_COUNT} words, got ${count}.`);
  }
  if (!bip39.validateMnemonic(paper)) {
    throw new Error('Invalid paper wallet phrase: unknown word or bad checksum.');
  }

  const scrambled = Buffer.from(bip39.mnemonicToEntropy(paper), 'hex');
  const mnemonic = withSecretSync(scrambled, bytes => {
    const entropy = walletV2().paper_wallet_unscramble(bytes, password);
    try {
      return entropy.to_english_mnemonics();
    } finally {
      entropy.free();
    }
  });

  if (!isValidMnemonic(mnemonic)) {
    throw new Error('Unscrambling produced an invalid recovery phrase.');
  }
  return mnemonic;
}

/** Shape check only (21 words, wordlist, checksum, unscrambles to a valid phrase). */
export function isValidPaperMnemonic(phrase: string): boolean {
  try {
    unscramblePaperMnemonic(phrase, VALIDATION_PASSWORD);
    return true;
  } catch {
    return false;
  }
}
