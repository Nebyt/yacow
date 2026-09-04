import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV_VARS, getKey, readProviders, setFallback, setPrimary, setProviderKey } from './providers.js';
import {
  clearFallback,
  describeActiveProviders,
  providerRows,
  removeKey,
  swapRoles,
} from './providerStatus.js';

const BF_MAINNET = 'mainnetABCDEFGHIJKLMNOPQRSTUV1234';
const BF_PREPROD = 'preprodABCDEFGHIJKLMNOPQRSTUV5678';
const env = {};

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'yacow-status-'));
}

function configuredHome(): string {
  const home = tmp();
  setPrimary('blockfrost', home);
  setProviderKey('blockfrost', 'mainnet', BF_MAINNET, home);
  setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);
  setFallback('koios', home);
  return home;
}

describe('providerRows', () => {
  it('gives Blockfrost a cell per network and Koios a single account-wide cell', () => {
    const rows = providerRows({ homeDir: configuredHome(), env });
    expect(rows.map((r) => r.provider)).toEqual(['blockfrost', 'koios']);

    const [blockfrost, koios] = rows;
    expect(blockfrost.perNetwork).toBe(true);
    expect(blockfrost.cells.map((c) => c.scope)).toEqual(['mainnet', 'preprod']);

    // One token covers every host, so the grid must not ask for it twice.
    expect(koios.perNetwork).toBe(false);
    expect(koios.cells.map((c) => c.scope)).toEqual(['all']);
    expect(koios.cells[0].scopeLabel).toBe('All networks');
  });

  it('shows the Koios token as set on every network once stored', () => {
    const home = tmp();
    setProviderKey('koios', 'preprod', 'koios-account-token', home);
    const koios = providerRows({ homeDir: home, env }).find((r) => r.provider === 'koios');
    expect(koios?.cells).toHaveLength(1);
    expect(koios?.cells[0]).toMatchObject({ scope: 'all', isSet: true, usable: true });
  });

  it('masks every key it renders', () => {
    const rows = providerRows({ homeDir: configuredHome(), env });
    const rendered = JSON.stringify(rows);
    expect(rendered).not.toContain(BF_MAINNET);
    expect(rendered).not.toContain(BF_PREPROD);
    expect(rows[0].cells[0].masked).toBe(`mainnet****${BF_MAINNET.slice(-4)}`);
  });

  it('shows each Blockfrost network independently (decision 4.8)', () => {
    const home = tmp();
    setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);
    const [blockfrost] = providerRows({ homeDir: home, env });
    expect(blockfrost.cells.find((c) => c.scope === 'preprod')).toMatchObject({
      isSet: true,
      usable: true,
    });
    expect(blockfrost.cells.find((c) => c.scope === 'mainnet')).toMatchObject({
      isSet: false,
      usable: false,
      masked: '(not set)',
    });
  });

  it('marks Koios usable with no token at all (anonymous tier)', () => {
    const rows = providerRows({ homeDir: tmp(), env });
    const koios = rows.find((r) => r.provider === 'koios');
    expect(koios?.cells[0]).toMatchObject({ usable: true, isSet: false, masked: '(not set)' });
  });

  it('labels the roles in the user’s terms', () => {
    const rows = providerRows({ homeDir: configuredHome(), env });
    expect(rows[0].roleLabel).toBe('primary');
    expect(rows[1].roleLabel).toContain('fallback');
    expect(providerRows({ homeDir: tmp(), env })[0].roleLabel).toBe('not in use');
  });

  it('says when a key comes from the environment and still hides it', () => {
    const rows = providerRows({
      homeDir: tmp(),
      env: { [ENV_VARS.blockfrost]: BF_PREPROD },
    });
    const cell = rows[0].cells[0];
    expect(cell.fromEnv).toBe(true);
    expect(cell.masked).toContain(ENV_VARS.blockfrost);
    expect(cell.masked).not.toContain(BF_PREPROD);
  });
});

describe('describeActiveProviders', () => {
  it('names the primary and the fallback for the active network', () => {
    const text = describeActiveProviders('preprod', { homeDir: configuredHome(), env });
    expect(text).toContain('Blockfrost');
    expect(text).toContain('Koios as fallback');
  });

  it('says plainly when nothing can serve the network', () => {
    const home = tmp();
    setPrimary('blockfrost', home);
    setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);
    expect(describeActiveProviders('mainnet', { homeDir: home, env })).toContain('No provider');
  });
});

describe('actions', () => {
  it('swaps the two roles', () => {
    const home = configuredHome();
    swapRoles({ homeDir: home });
    expect(readProviders(home)).toMatchObject({ primary: 'koios', fallback: 'blockfrost' });
  });

  it('does nothing when there is no fallback to swap with', () => {
    const home = tmp();
    setPrimary('blockfrost', home);
    swapRoles({ homeDir: home });
    expect(readProviders(home)).toMatchObject({ primary: 'blockfrost', fallback: null });
  });

  it('clears the fallback without touching the primary', () => {
    const home = configuredHome();
    clearFallback({ homeDir: home });
    expect(readProviders(home)).toMatchObject({ primary: 'blockfrost', fallback: null });
  });

  it('removes one network key and keeps the other (decision 4.8)', () => {
    const home = configuredHome();
    removeKey('blockfrost', 'mainnet', { homeDir: home });
    expect(getKey('blockfrost', 'mainnet', home)).toBeNull();
    expect(getKey('blockfrost', 'preprod', home)).toBe(BF_PREPROD);
    expect(readProviders(home).primary).toBe('blockfrost'); // role survives
  });
});
