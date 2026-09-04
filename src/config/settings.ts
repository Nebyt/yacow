// Persisted app settings (plan §3 Op 0) — currently just the active network.
// Stored at ~/.yacow/config.json.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_HOME_DIR, writeSecureFile } from '../security/fsPerms.js';
import { DEFAULT_NETWORK, isNetworkName, type NetworkName } from './networks.js';

export interface Settings {
  network: NetworkName;
}

export function settingsPath(homeDir: string = DEFAULT_HOME_DIR): string {
  return join(homeDir, 'config.json');
}

export function readSettings(homeDir?: string): Settings {
  const path = settingsPath(homeDir);
  if (!existsSync(path)) return { network: DEFAULT_NETWORK };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Settings>;
    return { network: isNetworkName(raw.network ?? '') ? (raw.network as NetworkName) : DEFAULT_NETWORK };
  } catch {
    return { network: DEFAULT_NETWORK };
  }
}

export function writeSettings(settings: Settings, homeDir?: string): void {
  writeSecureFile(settingsPath(homeDir), JSON.stringify(settings, null, 2));
}

export function setNetworkSetting(network: NetworkName, homeDir?: string): void {
  writeSettings({ ...readSettings(homeDir), network }, homeDir);
}
