import { createFallbackProvider, DEFAULT_COOLDOWN_MS } from './fallback.js';
import {
  AllProvidersFailedError,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderUnavailableError,
  type ChainProvider,
  type ProviderId,
  type Tip,
} from './types.js';

const TIP: Tip = { slot: 1, height: 2, hash: 'h', epoch: 3, time: 4 };

/** A ChainProvider whose every method is a spy, so we can see who was called. */
function stub(id: ProviderId): jest.Mocked<ChainProvider> {
  return {
    id,
    network: 'preprod',
    getTip: jest.fn(async () => TIP),
    getProtocolParams: jest.fn(),
    filterUsedAddresses: jest.fn(async () => []),
    getUtxosForAddresses: jest.fn(async () => []),
    getBalanceForAddresses: jest.fn(async () => ({ lovelace: '0', assets: [] })),
    getTransactionsForAddresses: jest.fn(async () => []),
    getTransaction: jest.fn(async () => null),
    submitTx: jest.fn(async () => `${id}-hash`),
    getAssetInfo: jest.fn(async () => []),
    healthCheck: jest.fn(async () => ({ provider: id, network: 'preprod', ok: true, tip: TIP })),
  } as unknown as jest.Mocked<ChainProvider>;
}

/** A clock we move by hand, so cooldown tests do not depend on wall time. */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let value = start;
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

describe('failover', () => {
  it.each([
    ['unavailable', new ProviderUnavailableError('down', { provider: 'blockfrost' })],
    ['rate-limited', new ProviderRateLimitError('429', { provider: 'blockfrost' })],
    ['auth-rejected', new ProviderAuthError('403', { provider: 'blockfrost' })],
  ])('serves from the secondary when the primary is %s', async (_label, error) => {
    const primary = stub('blockfrost');
    const secondary = stub('koios');
    primary.getBalanceForAddresses.mockRejectedValueOnce(error);
    secondary.getBalanceForAddresses.mockResolvedValueOnce({ lovelace: '42', assets: [] });

    const provider = createFallbackProvider(primary, secondary);
    await expect(provider.getBalanceForAddresses(['addr'])).resolves.toEqual({
      lovelace: '42',
      assets: [],
    });
    expect(secondary.getBalanceForAddresses).toHaveBeenCalledWith(['addr']);
    expect(provider.lastServedBy).toBe('koios');
  });

  it('flags the primary as needing attention only for a rejected credential', async () => {
    const authPrimary = stub('blockfrost');
    authPrimary.getTip.mockRejectedValueOnce(
      new ProviderAuthError('403', { provider: 'blockfrost' }),
    );
    const authProvider = createFallbackProvider(authPrimary, stub('koios'));
    await authProvider.getTip();
    expect(authProvider.primaryNeedsAttention).toBe(true);

    const downPrimary = stub('blockfrost');
    downPrimary.getTip.mockRejectedValueOnce(
      new ProviderUnavailableError('down', { provider: 'blockfrost' }),
    );
    const downProvider = createFallbackProvider(downPrimary, stub('koios'));
    await downProvider.getTip();
    expect(downProvider.primaryNeedsAttention).toBe(false);
  });

  it('does not fail over on a request error, which would fail identically', async () => {
    const primary = stub('blockfrost');
    const secondary = stub('koios');
    primary.getTransaction.mockRejectedValueOnce(
      new ProviderRequestError('malformed hash', { provider: 'blockfrost' }),
    );

    const provider = createFallbackProvider(primary, secondary);
    await expect(provider.getTransaction('nope')).rejects.toBeInstanceOf(ProviderRequestError);
    expect(secondary.getTransaction).not.toHaveBeenCalled();
  });

  it('reports what both backends said when neither can answer', async () => {
    const primary = stub('blockfrost');
    const secondary = stub('koios');
    primary.getTip.mockRejectedValue(
      new ProviderRateLimitError('quota spent', { provider: 'blockfrost' }),
    );
    secondary.getTip.mockRejectedValue(
      new ProviderUnavailableError('timeout', { provider: 'koios' }),
    );

    const provider = createFallbackProvider(primary, secondary);
    const err = await provider.getTip().catch((e: unknown) => e as AllProvidersFailedError);
    expect(err).toBeInstanceOf(AllProvidersFailedError);
    expect(err.message).toContain('Blockfrost: quota spent');
    expect(err.message).toContain('Koios: timeout');
    expect(err.failures).toHaveLength(2);
  });

  it('propagates the error unchanged when no secondary is configured', async () => {
    const primary = stub('blockfrost');
    primary.getTip.mockRejectedValueOnce(
      new ProviderUnavailableError('down', { provider: 'blockfrost' }),
    );
    const provider = createFallbackProvider(primary, null);
    await expect(provider.getTip()).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('records which backend served a successful call', async () => {
    const provider = createFallbackProvider(stub('blockfrost'), stub('koios'));
    expect(provider.lastServedBy).toBeNull();
    await provider.getTip();
    expect(provider.lastServedBy).toBe('blockfrost');
  });
});

describe('cooldown', () => {
  it('stops re-probing a dead primary until the window expires', async () => {
    const time = clock();
    const primary = stub('blockfrost');
    const secondary = stub('koios');
    primary.getTip.mockRejectedValueOnce(
      new ProviderUnavailableError('down', { provider: 'blockfrost' }),
    );

    const provider = createFallbackProvider(primary, secondary, { now: time.now });
    await provider.getTip(); // fails over, primary enters cooldown
    expect(provider.primaryCoolingDown).toBe(true);

    await provider.getTip();
    await provider.getTip();
    expect(primary.getTip).toHaveBeenCalledTimes(1); // not retried while cooling
    expect(secondary.getTip).toHaveBeenCalledTimes(3);
  });

  it('tries the primary again once the cooldown has passed', async () => {
    const time = clock();
    const primary = stub('blockfrost');
    primary.getTip.mockRejectedValueOnce(
      new ProviderUnavailableError('down', { provider: 'blockfrost' }),
    );

    const provider = createFallbackProvider(primary, stub('koios'), { now: time.now });
    await provider.getTip();
    time.advance(DEFAULT_COOLDOWN_MS + 1);

    expect(provider.primaryCoolingDown).toBe(false);
    await expect(provider.getTip()).resolves.toEqual(TIP);
    expect(primary.getTip).toHaveBeenCalledTimes(2);
    expect(provider.lastServedBy).toBe('blockfrost');
  });

  it('clears the cooldown as soon as the primary answers again', async () => {
    const time = clock();
    const primary = stub('blockfrost');
    primary.getTip
      .mockRejectedValueOnce(new ProviderUnavailableError('down', { provider: 'blockfrost' }))
      .mockResolvedValueOnce(TIP);

    const provider = createFallbackProvider(primary, stub('koios'), {
      cooldownMs: 10,
      now: time.now,
    });
    await provider.getTip();
    time.advance(11);
    await provider.getTip();
    expect(provider.primaryCoolingDown).toBe(false);
  });

  it('lets a successful health check bring the primary back early', async () => {
    const time = clock();
    const primary = stub('blockfrost');
    primary.getTip.mockRejectedValueOnce(new ProviderAuthError('403', { provider: 'blockfrost' }));

    const provider = createFallbackProvider(primary, stub('koios'), { now: time.now });
    await provider.getTip();
    expect(provider.primaryCoolingDown).toBe(true);

    await provider.healthCheck(); // key fixed in Settings, probe succeeds
    expect(provider.primaryCoolingDown).toBe(false);
    expect(provider.primaryNeedsAttention).toBe(false);
  });
});

describe('submitTx', () => {
  it('never re-submits through the secondary after a failed attempt', async () => {
    const primary = stub('blockfrost');
    const secondary = stub('koios');
    primary.submitTx.mockRejectedValueOnce(
      new ProviderUnavailableError('timed out', { provider: 'blockfrost' }),
    );

    const provider = createFallbackProvider(primary, secondary);
    await expect(provider.submitTx(new Uint8Array([1]))).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    // A timed-out submit may still have reached the chain; a second broadcast
    // would risk a duplicate transaction.
    expect(secondary.submitTx).not.toHaveBeenCalled();
  });

  it('uses the secondary when the primary is already known to be down', async () => {
    const time = clock();
    const primary = stub('blockfrost');
    const secondary = stub('koios');
    primary.getTip.mockRejectedValueOnce(
      new ProviderUnavailableError('down', { provider: 'blockfrost' }),
    );

    const provider = createFallbackProvider(primary, secondary, { now: time.now });
    await provider.getTip(); // primary enters cooldown before any submit happens

    await expect(provider.submitTx(new Uint8Array([1]))).resolves.toBe('koios-hash');
    expect(primary.submitTx).not.toHaveBeenCalled();
  });

  it('puts the primary in cooldown after its own submit failure', async () => {
    const time = clock();
    const primary = stub('blockfrost');
    primary.submitTx.mockRejectedValueOnce(
      new ProviderUnavailableError('down', { provider: 'blockfrost' }),
    );
    const provider = createFallbackProvider(primary, stub('koios'), { now: time.now });
    await provider.submitTx(new Uint8Array([1])).catch(() => undefined);
    expect(provider.primaryCoolingDown).toBe(true);
  });
});

describe('optional staking methods', () => {
  it('falls back for account state like any other read', async () => {
    const primary = stub('blockfrost');
    const secondary = stub('koios');
    primary.getAccountState = jest.fn(async () => {
      throw new ProviderUnavailableError('down', { provider: 'blockfrost' });
    });
    secondary.getAccountState = jest.fn(async () => ({
      stakeAddress: 'stake1',
      registered: true,
      delegatedPool: null,
      rewardsAvailable: '0',
      rewardsWithdrawn: '0',
    }));

    const provider = createFallbackProvider(primary, secondary);
    await expect(provider.getAccountState?.('stake1')).resolves.toMatchObject({
      stakeAddress: 'stake1',
    });
  });

  it('answers null when neither backend implements it', async () => {
    const provider = createFallbackProvider(stub('blockfrost'), stub('koios'));
    await expect(provider.getPoolInfo?.('pool1')).resolves.toBeNull();
  });
});

// B12: the account-level methods are optional, and the wrapper must not pretend
// a backend can answer when it cannot -- an empty address list is
// indistinguishable from a fresh wallet, which is the one wrong answer here.
describe('optional account methods', () => {
  const STAKE = 'stake_test1account';

  it('are absent when no provider implements them', () => {
    const provider = createFallbackProvider(stub('blockfrost'), stub('koios'));
    expect(provider.getAccountAddresses).toBeUndefined();
    expect(provider.getAccountBalance).toBeUndefined();
  });

  it('are served by the secondary alone when only it implements them', async () => {
    const primary = stub('blockfrost');
    const secondary = stub('koios');
    secondary.getAccountBalance = jest.fn(async () => ({ lovelace: '7', assets: [] }));

    const provider = createFallbackProvider(primary, secondary);
    await expect(provider.getAccountBalance?.(STAKE)).resolves.toEqual({
      lovelace: '7',
      assets: [],
    });
    expect(provider.lastServedBy).toBe('koios');
  });

  it('do not send the primary into cooldown when only the secondary failed', async () => {
    // The primary never had a say in this request, so its health is unchanged.
    const primary = stub('blockfrost');
    const secondary = stub('koios');
    secondary.getAccountBalance = jest.fn(async () => {
      throw new ProviderUnavailableError('down', { provider: 'koios' });
    });

    const provider = createFallbackProvider(primary, secondary);
    await expect(provider.getAccountBalance?.(STAKE)).rejects.toThrow(ProviderUnavailableError);
    expect(provider.primaryCoolingDown).toBe(false);
  });

  it('fail over to a secondary that also implements the method', async () => {
    const primary = stub('blockfrost');
    const secondary = stub('koios');
    primary.getAccountAddresses = jest.fn(async () => {
      throw new ProviderRateLimitError('429', { provider: 'blockfrost' });
    });
    secondary.getAccountAddresses = jest.fn(async () => ['addr_a']);

    const provider = createFallbackProvider(primary, secondary);
    await expect(provider.getAccountAddresses?.(STAKE)).resolves.toEqual(['addr_a']);
    expect(provider.lastServedBy).toBe('koios');
  });

  it('propagate the failure when the only capable provider is down', async () => {
    const primary = stub('blockfrost');
    primary.getAccountBalance = jest.fn(async () => {
      throw new ProviderUnavailableError('down', { provider: 'blockfrost' });
    });

    const provider = createFallbackProvider(primary, stub('koios'));
    await expect(provider.getAccountBalance?.(STAKE)).rejects.toThrow(ProviderUnavailableError);
  });
});
