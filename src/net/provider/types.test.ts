import {
  AllProvidersFailedError,
  ProviderAuthError,
  ProviderError,
  ProviderNetworkMismatchError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderUnavailableError,
  assetUnit,
  emptyBalance,
  isProviderId,
  isRetryableProviderError,
  shouldFailover,
  splitAssetUnit,
} from './types.js';

const POLICY = 'a'.repeat(56);

describe('provider ids', () => {
  it('accepts the shipped adapters and rejects anything else', () => {
    expect(isProviderId('blockfrost')).toBe(true);
    expect(isProviderId('koios')).toBe(true);
    expect(isProviderId('yoroi')).toBe(false); // forbidden backend (decision 4.1)
    expect(isProviderId('')).toBe(false);
  });
});

describe('asset units', () => {
  it('concatenates policy id and asset name, lowercased', () => {
    expect(assetUnit(POLICY.toUpperCase(), '4D494C4B')).toBe(`${POLICY}4d494c4b`);
  });

  it('round-trips through splitAssetUnit', () => {
    const unit = assetUnit(POLICY, '4d494c4b');
    expect(splitAssetUnit(unit)).toEqual({ policyId: POLICY, assetNameHex: '4d494c4b' });
  });

  it('treats a bare policy id as a unit with an empty asset name', () => {
    expect(splitAssetUnit(POLICY)).toEqual({ policyId: POLICY, assetNameHex: '' });
  });

  it('rejects short or non-hex input', () => {
    expect(() => splitAssetUnit('abcd')).toThrow(TypeError);
    expect(() => splitAssetUnit(`${'z'.repeat(56)}00`)).toThrow(TypeError);
  });
});

describe('error taxonomy', () => {
  it('marks rate-limit and unavailable as retryable, auth and request as not', () => {
    expect(
      isRetryableProviderError(new ProviderRateLimitError('slow down', { provider: 'blockfrost' })),
    ).toBe(true);
    expect(
      isRetryableProviderError(new ProviderUnavailableError('502', { provider: 'koios' })),
    ).toBe(true);
    expect(isRetryableProviderError(new ProviderAuthError('bad key', { provider: 'blockfrost' })))
      .toBe(false);
    expect(isRetryableProviderError(new ProviderRequestError('bad address', { provider: 'koios' })))
      .toBe(false);
    expect(isRetryableProviderError(new Error('unrelated'))).toBe(false);
  });

  it('fails over on rate-limit, unavailable and auth, but not on our own bad request', () => {
    expect(shouldFailover(new ProviderRateLimitError('429', { provider: 'blockfrost' }))).toBe(true);
    expect(shouldFailover(new ProviderUnavailableError('down', { provider: 'blockfrost' }))).toBe(
      true,
    );
    // Decision 4.3: an expired key must not stop the wallet from reading chain data.
    expect(shouldFailover(new ProviderAuthError('403', { provider: 'blockfrost' }))).toBe(true);
    expect(shouldFailover(new ProviderRequestError('malformed', { provider: 'koios' }))).toBe(false);
    expect(shouldFailover(new Error('unrelated'))).toBe(false);
  });

  it('keeps provider, status, name and cause on the error', () => {
    const cause = new Error('socket hang up');
    const err = new ProviderUnavailableError('backend down', {
      provider: 'koios',
      status: 503,
      cause,
    });
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe('ProviderUnavailableError');
    expect(err.provider).toBe('koios');
    expect(err.status).toBe(503);
    expect(err.cause).toBe(cause);
  });

  it('exposes Retry-After on a rate-limit error and defaults it to null', () => {
    expect(
      new ProviderRateLimitError('429', { provider: 'blockfrost', retryAfterMs: 2000 })
        .retryAfterMs,
    ).toBe(2000);
    expect(new ProviderRateLimitError('429', { provider: 'blockfrost' }).retryAfterMs).toBeNull();
  });

  it('names both chains in a network mismatch', () => {
    const err = new ProviderNetworkMismatchError({
      provider: 'blockfrost',
      expected: 'preprod',
      actual: 'mainnet',
    });
    expect(err.message).toContain('Blockfrost');
    expect(err.message).toContain('mainnet');
    expect(err.message).toContain('preprod');
    expect(err.expected).toBe('preprod');
    expect(shouldFailover(err)).toBe(false); // a wrong-chain key is a config bug
  });

  it('aggregates what every provider said when all of them fail', () => {
    const failures = [
      new ProviderRateLimitError('quota exhausted', { provider: 'blockfrost' }),
      new ProviderUnavailableError('timeout after 15000ms', { provider: 'koios' }),
    ];
    const err = new AllProvidersFailedError(failures);
    expect(err.message).toContain('Blockfrost: quota exhausted');
    expect(err.message).toContain('Koios: timeout after 15000ms');
    expect(err.failures).toHaveLength(2);
  });
});

describe('emptyBalance', () => {
  it('returns a fresh, independent value each call', () => {
    const a = emptyBalance();
    const b = emptyBalance();
    a.assets.push({ unit: POLICY, quantity: '1' });
    expect(b).toEqual({ lovelace: '0', assets: [] });
  });
});
