import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { permsOf } from '../security/fsPerms.js';
import {
  ENV_VARS,
  clearProviderKey,
  configuredNetworks,
  defaultProviderSettings,
  getKey,
  isConfigured,
  isPerNetworkProvider,
  maskKey,
  providersPath,
  readProviders,
  resolveProviders,
  setFallback,
  setPrimary,
  setProviderKey,
  suggestedProviderFor,
  writeProviders,
} from './providers.js';

const BF_MAINNET = 'mainnetABCDEFGHIJKLMNOPQRSTUV1234';
const BF_PREPROD = 'preprodABCDEFGHIJKLMNOPQRSTUV5678';
const KOIOS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.koios';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'yacow-providers-'));
}

/** A home with Blockfrost keys for both networks and Koios as fallback. */
function configuredHome(): string {
  const home = tmp();
  setPrimary('blockfrost', home);
  setProviderKey('blockfrost', 'mainnet', BF_MAINNET, home);
  setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);
  setFallback('koios', home);
  return home;
}

describe('file handling', () => {
  it('returns empty defaults when nothing has been configured', () => {
    expect(readProviders(tmp())).toEqual(defaultProviderSettings());
  });

  it('writes the file owner-only (0600)', () => {
    const home = tmp();
    setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);
    expect(permsOf(providersPath(home))).toBe(0o600);
  });

  it('falls back to defaults on a corrupt file instead of crashing the app', () => {
    const home = tmp();
    writeProviders(defaultProviderSettings(), home);
    writeFileSync(providersPath(home), '{ not json');
    expect(readProviders(home)).toEqual(defaultProviderSettings());
  });

  it('drops unknown providers, unknown networks and non-string keys', () => {
    const home = tmp();
    writeProviders(defaultProviderSettings(), home);
    writeFileSync(
      providersPath(home),
      JSON.stringify({
        primary: 'not-a-provider',
        fallback: 'koios',
        keys: {
          blockfrost: { preprod: BF_PREPROD, preview: 'nope', mainnet: 42 },
          nonsense: { mainnet: 'x' },
        },
      }),
    );
    const settings = readProviders(home);
    expect(settings.primary).toBeNull();
    expect(settings.fallback).toBe('koios');
    expect(settings.keys.blockfrost).toEqual({ preprod: BF_PREPROD, mainnet: null });
    expect(settings.keys.koios).toBeNull();
    expect(Object.keys(settings.keys).sort()).toEqual(['blockfrost', 'koios']);
  });

  it('never lets one provider hold both roles', () => {
    const home = tmp();
    setPrimary('koios', home);
    setFallback('koios', home);
    expect(readProviders(home).fallback).toBeNull();

    setFallback('blockfrost', home);
    setPrimary('blockfrost', home); // promoting the fallback clears the old role
    expect(readProviders(home)).toMatchObject({ primary: 'blockfrost', fallback: null });
  });
});

describe('per-network keys (decision 4.8)', () => {
  it('holds a mainnet and a preprod Blockfrost key at once', () => {
    const home = tmp();
    setProviderKey('blockfrost', 'mainnet', BF_MAINNET, home);
    setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);

    expect(getKey('blockfrost', 'mainnet', home)).toBe(BF_MAINNET);
    expect(getKey('blockfrost', 'preprod', home)).toBe(BF_PREPROD);
  });

  it('serves one Koios token on every network: the JWT is account-wide', () => {
    const home = tmp();
    setProviderKey('koios', 'mainnet', KOIOS_TOKEN, home);

    // Stored once under either network, read back under both.
    expect(getKey('koios', 'mainnet', home)).toBe(KOIOS_TOKEN);
    expect(getKey('koios', 'preprod', home)).toBe(KOIOS_TOKEN);
    expect(configuredNetworks('koios', home)).toEqual(['mainnet', 'preprod']);
  });

  it('says which providers are network-scoped', () => {
    expect(isPerNetworkProvider('blockfrost')).toBe(true);
    expect(isPerNetworkProvider('koios')).toBe(false);
  });

  it('clears the Koios token for every network at once', () => {
    const home = tmp();
    setProviderKey('koios', 'preprod', KOIOS_TOKEN, home);
    clearProviderKey('koios', 'mainnet', home);
    expect(getKey('koios', 'preprod', home)).toBeNull();
    expect(configuredNetworks('koios', home)).toEqual([]);
  });

  it('migrates the older per-network Koios shape to the single token', () => {
    const home = tmp();
    writeProviders(defaultProviderSettings(), home);
    writeFileSync(
      providersPath(home),
      JSON.stringify({
        primary: 'koios',
        keys: { koios: { mainnet: KOIOS_TOKEN, preprod: null }, blockfrost: {} },
      }),
    );
    expect(readProviders(home).keys.koios).toBe(KOIOS_TOKEN);
    expect(getKey('koios', 'preprod', home)).toBe(KOIOS_TOKEN);
  });

  it('never returns one network key when asked for the other', () => {
    const home = tmp();
    setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);
    expect(getKey('blockfrost', 'mainnet', home)).toBeNull();
    expect(resolveProviders('mainnet', { homeDir: home, env: {} }).primary).toBeNull();
  });

  it('setting one network key leaves the other untouched', () => {
    const home = configuredHome();
    setProviderKey('blockfrost', 'mainnet', 'mainnetREPLACEMENTKEY9999', home);
    expect(getKey('blockfrost', 'preprod', home)).toBe(BF_PREPROD);
  });

  it('clearing one network key keeps the other (decision 4.8)', () => {
    const home = configuredHome();
    clearProviderKey('blockfrost', 'mainnet', home);
    expect(getKey('blockfrost', 'mainnet', home)).toBeNull();
    expect(getKey('blockfrost', 'preprod', home)).toBe(BF_PREPROD);
    expect(isConfigured('preprod', { homeDir: home, env: {} })).toBe(true);
    expect(isConfigured('mainnet', { homeDir: home, env: {} })).toBe(false);
  });

  it('lists which networks a provider is configured for', () => {
    const home = configuredHome();
    expect(configuredNetworks('blockfrost', home)).toEqual(['mainnet', 'preprod']);
    expect(configuredNetworks('koios', home)).toEqual([]);
  });

  it('treats a blank key as "not set"', () => {
    const home = tmp();
    setProviderKey('blockfrost', 'preprod', '   ', home);
    expect(getKey('blockfrost', 'preprod', home)).toBeNull();
  });

  it('trims a pasted key', () => {
    const home = tmp();
    setProviderKey('blockfrost', 'preprod', `  ${BF_PREPROD}\n`, home);
    expect(getKey('blockfrost', 'preprod', home)).toBe(BF_PREPROD);
  });
});

describe('resolution', () => {
  it('resolves the key matching the active network', () => {
    const home = configuredHome();
    expect(resolveProviders('mainnet', { homeDir: home, env: {} }).primary).toMatchObject({
      provider: 'blockfrost',
      key: BF_MAINNET,
      fromEnv: false,
      usable: true,
    });
    expect(resolveProviders('preprod', { homeDir: home, env: {} }).primary?.key).toBe(BF_PREPROD);
  });

  it('counts Koios without a token as usable, because anonymous access works', () => {
    const home = tmp();
    setPrimary('koios', home);
    const resolved = resolveProviders('mainnet', { homeDir: home, env: {} });
    expect(resolved.primary).toMatchObject({ provider: 'koios', key: null, usable: true });
    expect(isConfigured('mainnet', { homeDir: home, env: {} })).toBe(true);
  });

  it('counts Blockfrost without a key as unusable', () => {
    const home = tmp();
    setPrimary('blockfrost', home);
    expect(isConfigured('preprod', { homeDir: home, env: {} })).toBe(false);
  });

  it('reports nothing configured on a fresh install', () => {
    expect(isConfigured('preprod', { homeDir: tmp(), env: {} })).toBe(false);
  });
});

describe('environment overrides', () => {
  it('beats the stored key and is flagged as coming from the env', () => {
    const home = configuredHome();
    const resolved = resolveProviders('preprod', {
      homeDir: home,
      env: { [ENV_VARS.blockfrost]: 'preprodFROMENV0000000000000000' },
    });
    expect(resolved.primary).toMatchObject({
      key: 'preprodFROMENV0000000000000000',
      fromEnv: true,
    });
  });

  it('is never written back to the file', () => {
    const home = configuredHome();
    resolveProviders('preprod', {
      homeDir: home,
      env: { [ENV_VARS.blockfrost]: 'preprodFROMENV0000000000000000' },
    });
    expect(readFileSync(providersPath(home), 'utf8')).not.toContain('FROMENV');
    expect(getKey('blockfrost', 'preprod', home)).toBe(BF_PREPROD);
  });

  it('supplies a primary on a machine with no config file at all', () => {
    const home = tmp();
    const resolved = resolveProviders('mainnet', {
      homeDir: home,
      env: { [ENV_VARS.koios]: KOIOS_TOKEN },
    });
    expect(resolved.primary).toMatchObject({ provider: 'koios', key: KOIOS_TOKEN, usable: true });
  });

  it('lets YACOW_PROVIDER_PRIMARY pick which stored provider leads', () => {
    const home = configuredHome();
    const resolved = resolveProviders('preprod', {
      homeDir: home,
      env: { [ENV_VARS.primary]: 'koios' },
    });
    expect(resolved.primary?.provider).toBe('koios');
    expect(resolved.fallback).toBeNull(); // koios cannot be both roles
  });

  it('ignores a nonsense provider name in the env', () => {
    const home = configuredHome();
    expect(
      resolveProviders('preprod', { homeDir: home, env: { [ENV_VARS.primary]: 'not-a-provider' } }).primary
        ?.provider,
    ).toBe('blockfrost');
  });
});

describe('fallback suggestion (decision 4.9)', () => {
  it('suggests the fallback when it can serve the network the primary cannot', () => {
    const home = tmp();
    setPrimary('blockfrost', home);
    setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);
    setFallback('koios', home); // koios works anonymously on any network
    expect(isConfigured('mainnet', { homeDir: home, env: {} })).toBe(false);
    expect(suggestedProviderFor('mainnet', { homeDir: home, env: {} })).toBe('koios');
  });

  it('suggests nothing when the fallback cannot serve the network either', () => {
    const home = tmp();
    setPrimary('koios', home);
    setFallback('blockfrost', home); // no blockfrost key for mainnet
    expect(suggestedProviderFor('mainnet', { homeDir: home, env: {} })).toBeNull();
  });

  it('suggests nothing when no fallback is configured', () => {
    expect(suggestedProviderFor('preprod', { homeDir: tmp(), env: {} })).toBeNull();
  });
});

describe('maskKey', () => {
  it('never returns the whole key', () => {
    const masked = maskKey(BF_MAINNET);
    expect(masked).not.toContain(BF_MAINNET);
    expect(masked).not.toContain(BF_MAINNET.slice(7, -4));
  });

  it('keeps the network prefix and the last characters so a key is recognisable', () => {
    expect(maskKey(BF_PREPROD)).toBe(`preprod****${BF_PREPROD.slice(-4)}`);
  });

  it('masks a short key completely', () => {
    expect(maskKey('short')).toBe('*****');
  });

  it('renders an absent key as text, not as an empty string', () => {
    expect(maskKey(null)).toBe('(not set)');
    expect(maskKey('')).toBe('(not set)');
  });
});
