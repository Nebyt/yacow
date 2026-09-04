import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setFallback, setPrimary, setProviderKey } from '../../config/providers.js';
import {
  ProviderNotConfiguredError,
  getProvider,
  invalidateProviderCache,
} from './registry.js';
import { BLOCKFROST_BASE_URLS } from './blockfrost.js';
import type { FallbackProvider } from './fallback.js';

const BF_MAINNET = 'mainnetABCDEFGHIJKLMNOPQRSTUV1234';
const BF_PREPROD = 'preprodABCDEFGHIJKLMNOPQRSTUV5678';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'yacow-registry-'));
}

/** Both networks configured with Blockfrost, Koios as the stand-in. */
function configuredHome(): string {
  const home = tmp();
  setPrimary('blockfrost', home);
  setProviderKey('blockfrost', 'mainnet', BF_MAINNET, home);
  setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);
  setFallback('koios', home);
  return home;
}

beforeEach(() => {
  invalidateProviderCache();
});

describe('building', () => {
  it('refuses to build when nothing is configured for the network', () => {
    expect(() => getProvider('preprod', { homeDir: tmp(), env: {} })).toThrow(
      ProviderNotConfiguredError,
    );
  });

  it('builds the configured primary', () => {
    const home = configuredHome();
    expect(getProvider('preprod', { homeDir: home, env: {} }).id).toBe('blockfrost');
  });

  it('builds Koios when it leads, even with no token', () => {
    const home = tmp();
    setPrimary('koios', home);
    expect(getProvider('mainnet', { homeDir: home, env: {} }).id).toBe('koios');
  });

  it('serves each network from its own key (decision 4.8)', () => {
    const home = configuredHome();
    const mainnet = getProvider('mainnet', { homeDir: home, env: {} });
    const preprod = getProvider('preprod', { homeDir: home, env: {} });
    expect(mainnet).not.toBe(preprod);
    expect(mainnet.network).toBe('mainnet');
    expect(preprod.network).toBe('preprod');
  });

  it('is unconfigured for the network whose key is missing, not for both', () => {
    const home = tmp();
    setPrimary('blockfrost', home);
    setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);
    expect(getProvider('preprod', { homeDir: home, env: {} }).id).toBe('blockfrost');
    expect(() => getProvider('mainnet', { homeDir: home, env: {} })).toThrow(
      ProviderNotConfiguredError,
    );
  });

  it('drops a fallback that cannot serve this network', () => {
    const home = tmp();
    setPrimary('koios', home);
    setFallback('blockfrost', home); // no blockfrost key at all
    const provider = getProvider('mainnet', { homeDir: home, env: {} }) as FallbackProvider;
    // With no usable stand-in the wrapper simply propagates the primary's errors;
    // there is nothing to fail over to.
    expect(provider.primaryCoolingDown).toBe(false);
    expect(provider.id).toBe('koios');
  });
});

describe('caching', () => {
  it('returns the same instance for repeated calls', () => {
    const home = configuredHome();
    const first = getProvider('preprod', { homeDir: home, env: {} });
    expect(getProvider('preprod', { homeDir: home, env: {} })).toBe(first);
  });

  it('rebuilds when the stored key changes', () => {
    const home = configuredHome();
    const before = getProvider('preprod', { homeDir: home, env: {} });
    setProviderKey('blockfrost', 'preprod', 'preprodROTATEDKEY123456789', home);
    expect(getProvider('preprod', { homeDir: home, env: {} })).not.toBe(before);
  });

  it('rebuilds when the roles change', () => {
    const home = configuredHome();
    const before = getProvider('preprod', { homeDir: home, env: {} });
    setFallback(null, home);
    expect(getProvider('preprod', { homeDir: home, env: {} })).not.toBe(before);
  });

  it('keeps the other network cached when one network is invalidated', () => {
    const home = configuredHome();
    const mainnet = getProvider('mainnet', { homeDir: home, env: {} });
    const preprod = getProvider('preprod', { homeDir: home, env: {} });
    invalidateProviderCache('mainnet');
    expect(getProvider('mainnet', { homeDir: home, env: {} })).not.toBe(mainnet);
    expect(getProvider('preprod', { homeDir: home, env: {} })).toBe(preprod);
  });

  it('picks up an env override without an explicit invalidation', () => {
    const home = configuredHome();
    const before = getProvider('preprod', { homeDir: home, env: {} });
    const after = getProvider('preprod', {
      homeDir: home,
      env: { YACOW_BLOCKFROST_PROJECT_ID: 'preprodFROMENV000000000000' },
    });
    expect(after).not.toBe(before);
  });
});

describe('wiring', () => {
  it('points the Blockfrost adapter at the host for the selected network', () => {
    expect(BLOCKFROST_BASE_URLS.preprod).toContain('preprod');
    expect(BLOCKFROST_BASE_URLS.mainnet).toContain('mainnet');
  });

  it('exposes the fallback surface the UI reads', () => {
    const home = configuredHome();
    const provider = getProvider('preprod', { homeDir: home, env: {} }) as FallbackProvider;
    expect(provider.lastServedBy).toBeNull();
    expect(provider.primaryNeedsAttention).toBe(false);
  });
});
