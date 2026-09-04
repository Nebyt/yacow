// Detects existing keystores so the app can choose its first page (plan §2).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_HOME_DIR } from '../security/fsPerms.js';

export function walletsDir(homeDir: string = DEFAULT_HOME_DIR): string {
  return join(homeDir, 'wallets');
}

/** Names (without .json) of keystores found in the wallets dir. */
export function listWallets(homeDir: string = DEFAULT_HOME_DIR): string[] {
  const dir = walletsDir(homeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

export function walletCount(homeDir: string = DEFAULT_HOME_DIR): number {
  return listWallets(homeDir).length;
}
