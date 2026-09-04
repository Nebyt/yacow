// Fully remove an existing wallet (plan backlog #3).
import { existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { keystorePath } from './createWallet.js';

/**
 * Permanently delete a wallet's keystore. The file is overwritten with random
 * bytes before unlinking (the contents are already encrypted, this is defence
 * in depth). Returns true if a file was removed, false if none existed.
 */
export function deleteWallet(name: string, homeDir?: string): boolean {
  const path = keystorePath(name, homeDir);
  if (!existsSync(path)) return false;
  try {
    const size = statSync(path).size;
    writeFileSync(path, randomBytes(Math.max(size, 1)));
  } catch {
    // best-effort scrub; fall through to unlink regardless
  }
  unlinkSync(path);
  return true;
}
