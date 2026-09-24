import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, fetch as undiciFetch } from 'undici';
import { readProviders, setFallback, setPrimary, setProviderKey } from './providers.js';
import { makePrimary, saveProviderKey, setupChoices, testProviderKey } from './providerSetup.js';

const BF_MAINNET = 'mainnetABCDEFGHIJKLMNOPQRSTUV1234';
const BF_PREPROD = 'preprodABCDEFGHIJKLMNOPQRSTUV5678';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'yacow-setup-'));
}

const env = {};

describe('setupChoices', () => {
  it('offers a key for each provider on a fresh install', () => {
    const labels = setupChoices('preprod', { homeDir: tmp(), env }).map((c) => c.label);
    expect(labels).toEqual([
      'Use Koios (no key needed, lower rate limit)',
      'Add a Blockfrost key for Cardano Preprod',
      'Add a Koios token (works on all networks)',
    ]);
  });

  it('offers the provider that already has a key for THIS network first (decision 4.9)', () => {
    const home = tmp();
    setPrimary('blockfrost', home);
    setProviderKey('blockfrost', 'preprod', BF_PREPROD, home);
    setProviderKey('koios', 'mainnet', 'koios-mainnet-token', home);

    const choices = setupChoices('mainnet', { homeDir: home, env });
    expect(choices[0]).toMatchObject({ kind: 'use-provider', provider: 'koios' });
    // The Koios token is account-wide, so the label must not name a network.
    expect(choices[0].label).toContain('token already set');
    expect(choices[0].label).not.toContain('mainnet');
  });

  it('offers to switch back only when the other network actually works', () => {
    const configured = tmp();
    setPrimary('blockfrost', configured);
    setProviderKey('blockfrost', 'preprod', BF_PREPROD, configured);
    expect(
      setupChoices('mainnet', { homeDir: configured, env }).some(
        (c) => c.kind === 'switch-network',
      ),
    ).toBe(true);

    expect(
      setupChoices('mainnet', { homeDir: tmp(), env }).some((c) => c.kind === 'switch-network'),
    ).toBe(false);
  });

  it('does not offer a key for a network that already has one', () => {
    const home = tmp();
    setProviderKey('blockfrost', 'mainnet', BF_MAINNET, home);
    const kinds = setupChoices('mainnet', { homeDir: home, env }).map(
      (c) => `${c.kind}:${'provider' in c ? c.provider : ''}`,
    );
    expect(kinds).not.toContain('add-key:blockfrost');
    expect(kinds).toContain('add-key:koios');
  });

  it('stops offering the Koios token once it is set, on either network', () => {
    const home = tmp();
    setProviderKey('koios', 'mainnet', 'koios-account-token', home);
    for (const network of ['mainnet', 'preprod'] as const) {
      const kinds = setupChoices(network, { homeDir: home, env }).map(
        (c) => `${c.kind}:${'provider' in c ? c.provider : ''}`,
      );
      expect(kinds).not.toContain('add-key:koios');
    }
  });
});

describe('saveProviderKey', () => {
  it('stores the key for one network and claims the empty primary role', () => {
    const home = tmp();
    saveProviderKey('blockfrost', 'preprod', BF_PREPROD, { homeDir: home });
    expect(readProviders(home)).toMatchObject({
      primary: 'blockfrost',
      fallback: null,
      keys: { blockfrost: { preprod: BF_PREPROD, mainnet: null } },
    });
  });

  it('becomes the fallback when another provider already leads', () => {
    const home = tmp();
    setPrimary('koios', home);
    saveProviderKey('blockfrost', 'preprod', BF_PREPROD, { homeDir: home });
    expect(readProviders(home)).toMatchObject({ primary: 'koios', fallback: 'blockfrost' });
  });

  it('leaves the roles alone when both are already taken', () => {
    const home = tmp();
    setPrimary('koios', home);
    setFallback('blockfrost', home);
    saveProviderKey('blockfrost', 'mainnet', BF_MAINNET, { homeDir: home });
    expect(readProviders(home)).toMatchObject({ primary: 'koios', fallback: 'blockfrost' });
  });

  it('never disturbs the other network key (decision 4.8)', () => {
    const home = tmp();
    saveProviderKey('blockfrost', 'preprod', BF_PREPROD, { homeDir: home });
    saveProviderKey('blockfrost', 'mainnet', BF_MAINNET, { homeDir: home });
    expect(readProviders(home).keys.blockfrost).toEqual({
      mainnet: BF_MAINNET,
      preprod: BF_PREPROD,
    });
  });
});

describe('makePrimary', () => {
  it('demotes the provider it replaces to fallback rather than discarding it', () => {
    const home = tmp();
    setPrimary('blockfrost', home);
    makePrimary('koios', { homeDir: home });
    expect(readProviders(home)).toMatchObject({ primary: 'koios', fallback: 'blockfrost' });
  });

  it('keeps an existing fallback instead of overwriting it', () => {
    const home = tmp();
    setPrimary('blockfrost', home);
    setFallback('koios', home);
    makePrimary('koios', { homeDir: home });
    // koios cannot hold both roles; it leads and the slot is freed.
    expect(readProviders(home)).toMatchObject({ primary: 'koios', fallback: 'blockfrost' });
  });
});

describe('testProviderKey', () => {
  let agent: MockAgent;

  beforeEach(() => {
    agent = new MockAgent();
    agent.disableNetConnect();
  });

  afterEach(async () => {
    await agent.close();
  });

  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) =>
    undiciFetch(url as string, {
      ...(init as Record<string, unknown>),
      dispatcher: agent,
    })) as unknown as typeof fetch;

  it('reports the block height when the key works', async () => {
    agent
      .get('https://cardano-preprod.blockfrost.io')
      .intercept({ path: '/api/v0/blocks/latest', method: 'GET' })
      .reply(
        200,
        { slot: 1, height: 3_120_000, hash: 'h', epoch: 42, time: 5 },
        {
          headers: { 'content-type': 'application/json' },
        },
      );

    await expect(
      testProviderKey('blockfrost', 'preprod', BF_PREPROD, { fetchImpl }),
    ).resolves.toMatchObject({ ok: true, message: expect.stringContaining('3120000') });
  });

  it('names the chain mismatch when the key is for the other network', async () => {
    const result = await testProviderKey('blockfrost', 'preprod', BF_MAINNET, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('mainnet');
    expect(result.message).toContain('preprod');
  });

  it('reports a backend that will not answer', async () => {
    agent
      .get('https://preprod.koios.rest')
      .intercept({ path: '/api/v1/tip', method: 'GET' })
      .reply(502, 'gateway down');

    await expect(testProviderKey('koios', 'preprod', null, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      tip: null,
    });
  });
});
