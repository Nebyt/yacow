// Orchestrates create/restore: mnemonic -> root key -> keystore, wiping the
// root-key bytes as soon as they are encrypted (plan §3.7b).
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mnemonicToRootKey } from '../crypto/mnemonic.js';
import { accountPublicKeyHex } from '../crypto/derive.js';
import { plateFromAccountPublicKeyHex, type Plate } from '../crypto/plate.js';
import { readKeystore, writeKeystore } from './keystore.js';
import { walletsDir } from './discoverWallets.js';

export interface CreatedWallet {
  name: string;
  accountPubKey: string;
  plate: Plate;
  path: string;
}

export interface CreateWalletInput {
  name: string;
  mnemonic: string;
  password: string;
  homeDir?: string;
}

/** True if a keystore with this name already exists. */
export function walletExists(name: string, homeDir?: string): boolean {
  return existsSync(keystorePath(name, homeDir));
}

export function keystorePath(name: string, homeDir?: string): string {
  return join(walletsDir(homeDir), `${sanitizeName(name)}.json`);
}

export const MAX_NAME_LEN = 20;

export function sanitizeName(name: string): string {
  const clean = name
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-');
  if (clean.length === 0) throw new Error('Wallet name must contain letters or digits.');
  if (clean.length > MAX_NAME_LEN) {
    throw new Error(`Wallet name must be ${MAX_NAME_LEN} characters or fewer.`);
  }
  return clean;
}

/**
 * Create (or restore — same path) a software wallet from a mnemonic.
 * The mnemonic is validated inside mnemonicToRootKey. The root-key bytes are
 * wiped by writeKeystore. Refuses to overwrite an existing wallet.
 */
export function createSoftwareWallet(input: CreateWalletInput): CreatedWallet {
  const name = sanitizeName(input.name);
  const path = keystorePath(name, input.homeDir);
  if (existsSync(path)) {
    throw new Error(`A wallet named "${name}" already exists.`);
  }

  const rootKey = mnemonicToRootKey(input.mnemonic);
  const accountPubKey = accountPublicKeyHex(rootKey, 0);
  const plate = plateFromAccountPublicKeyHex(accountPubKey);
  const rootKeyBytes = Buffer.from(rootKey.as_bytes());

  writeKeystore(path, { name, accountPubKey, plate, rootKeyBytes }, input.password);

  return { name, accountPubKey, plate, path };
}

export interface WalletMeta {
  name: string;
  accountPubKey: string;
  plate: Plate;
}

/** Load a wallet's public metadata (no password needed). Network-independent. */
export function loadWallet(name: string, homeDir?: string): WalletMeta {
  const ks = readKeystore(keystorePath(name, homeDir));
  return {
    name: ks.name,
    accountPubKey: ks.accountPubKey,
    plate: ks.plate,
  };
}
