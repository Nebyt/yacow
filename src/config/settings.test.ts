import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { permsOf } from '../security/fsPerms.js';
import { readSettings, setNetworkSetting, settingsPath, writeSettings } from './settings.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'yacow-'));
}

describe('settings', () => {
  it('defaults to preprod when no file exists', () => {
    expect(readSettings(tmp()).network).toBe('preprod');
  });

  it('persists and reads back the network (0600 file)', () => {
    const home = tmp();
    setNetworkSetting('mainnet', home);
    expect(readSettings(home).network).toBe('mainnet');
    expect(permsOf(settingsPath(home))).toBe(0o600);
  });

  it('falls back to default on a bad network value', () => {
    const home = tmp();
    // @ts-expect-error deliberately writing an invalid value
    writeSettings({ network: 'preview' }, home);
    expect(readSettings(home).network).toBe('preprod');
  });
});
