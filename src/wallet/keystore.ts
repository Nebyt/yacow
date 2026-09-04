// Encrypted keystore (plan §3.7). Stores the derived Bip32 root private key
// encrypted with AES-256-GCM; the key is derived from the spending password via
// scrypt. The recovery phrase is NEVER persisted. accountPubKey + plate are
// stored in clear so read-only operations need no password.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plate } from '../crypto/plate.js';
import { assertSecureFile, writeSecureFile } from '../security/fsPerms.js';
import { wipe } from '../security/secretBuffer.js';

export interface KdfParams {
  algo: 'scrypt';
  n: number;
  r: number;
  p: number;
  keylen: number;
  salt: string; // hex
}

export interface CipherParams {
  algo: 'aes-256-gcm';
  iv: string; // hex
  tag: string; // hex
  data: string; // hex (ciphertext of the root private key bytes)
}

export interface Keystore {
  version: 1;
  name: string;
  // No network field: the root key / account public key / plate are all
  // network-independent, so one keystore works on both mainnet and preprod.
  accountPubKey: string; // hex, in clear
  plate: Plate; // in clear
  kdf: KdfParams;
  cipher: CipherParams;
}

// ~250ms on a typical laptop; memory ≈ 128 * N * r bytes ≈ 134 MB.
const DEFAULT_KDF = { n: 2 ** 17, r: 8, p: 1, keylen: 32 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer, kdf: Omit<KdfParams, 'algo' | 'salt'>): Buffer {
  return scryptSync(password, salt, kdf.keylen, {
    N: kdf.n,
    r: kdf.r,
    p: kdf.p,
    maxmem: SCRYPT_MAXMEM,
  });
}

export interface NewKeystoreInput {
  name: string;
  accountPubKey: string;
  plate: Plate;
  /** Root private key bytes; wiped by this function before returning. */
  rootKeyBytes: Buffer;
}

/** Encrypt the root key under `password` and return the keystore object. */
export function buildKeystore(input: NewKeystoreInput, password: string): Keystore {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt, DEFAULT_KDF);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(input.rootKeyBytes), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      version: 1,
      name: input.name,
      accountPubKey: input.accountPubKey,
      plate: input.plate,
      kdf: { algo: 'scrypt', salt: salt.toString('hex'), ...DEFAULT_KDF },
      cipher: {
        algo: 'aes-256-gcm',
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: data.toString('hex'),
      },
    };
  } finally {
    wipe(key);
    wipe(input.rootKeyBytes);
  }
}

/** Encrypt + atomically write a keystore file (0600). */
export function writeKeystore(path: string, input: NewKeystoreInput, password: string): Keystore {
  const keystore = buildKeystore(input, password);
  writeSecureFile(path, JSON.stringify(keystore, null, 2));
  return keystore;
}

export function readKeystore(path: string): Keystore {
  assertSecureFile(path);
  return JSON.parse(readFileSync(path, 'utf8')) as Keystore;
}

/**
 * Decrypt the root private key bytes. Throws on a wrong password (the GCM auth
 * tag fails). Caller MUST wipe the returned buffer after use.
 */
export function decryptRootKey(keystore: Keystore, password: string): Buffer {
  const salt = Buffer.from(keystore.kdf.salt, 'hex');
  const key = deriveKey(password, salt, keystore.kdf);
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(keystore.cipher.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(keystore.cipher.tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(keystore.cipher.data, 'hex')),
      decipher.final(),
    ]);
  } catch {
    throw new Error('Incorrect password or corrupted keystore (authentication failed).');
  } finally {
    wipe(key);
  }
}
