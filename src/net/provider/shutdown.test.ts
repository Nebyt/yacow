import { createHttpClient } from './http.js';
import {
  abortInFlightRequests,
  isShuttingDown,
  resetShutdown,
  shutdownSignal,
} from './shutdown.js';
import { ProviderShutdownError, ProviderUnavailableError } from './types.js';

beforeEach(() => {
  resetShutdown();
});

afterAll(() => {
  resetShutdown();
});

describe('shutdown signal', () => {
  it('starts inactive and aborts once', () => {
    expect(isShuttingDown()).toBe(false);
    const signal = shutdownSignal();
    abortInFlightRequests();
    abortInFlightRequests(); // idempotent
    expect(signal.aborted).toBe(true);
    expect(isShuttingDown()).toBe(true);
  });

  it('resets cleanly for a fresh run', () => {
    abortInFlightRequests();
    resetShutdown();
    expect(isShuttingDown()).toBe(false);
  });
});

describe('requests during shutdown', () => {
  /** A fetch that never settles unless its abort signal fires. */
  function hangingFetch(): { impl: typeof fetch; started: () => number } {
    let started = 0;
    const impl = ((_url: string | URL | Request, init?: RequestInit) => {
      started += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }) as unknown as typeof fetch;
    return { impl, started: () => started };
  }

  it('cancels an in-flight request instead of hanging', async () => {
    const { impl } = hangingFetch();
    const client = createHttpClient({
      provider: 'blockfrost',
      baseUrl: 'https://example.test',
      fetchImpl: impl,
      sleep: async () => {},
    });

    const pending = client.getJson('/blocks/latest');
    abortInFlightRequests(); // the user pressed q
    await expect(pending).rejects.toBeInstanceOf(ProviderShutdownError);
  });

  it('does not retry or fail over a cancelled request', async () => {
    const { impl, started } = hangingFetch();
    const sleeps: number[] = [];
    const client = createHttpClient({
      provider: 'koios',
      baseUrl: 'https://example.test',
      fetchImpl: impl,
      retries: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const pending = client.getJson('/tip');
    abortInFlightRequests();
    await expect(pending).rejects.toBeInstanceOf(ProviderShutdownError);
    expect(started()).toBe(1); // no second attempt
    expect(sleeps).toEqual([]); // no backoff wait
  });

  it('refuses a request started after shutdown began', async () => {
    const { impl, started } = hangingFetch();
    const client = createHttpClient({
      provider: 'blockfrost',
      baseUrl: 'https://example.test',
      fetchImpl: impl,
      sleep: async () => {},
    });

    abortInFlightRequests();
    await expect(client.getJson('/blocks/latest')).rejects.toBeInstanceOf(ProviderShutdownError);
    expect(started()).toBe(0); // never even opened a socket
  });

  it('keeps a shutdown error out of the retryable and failover paths', () => {
    const err = new ProviderShutdownError('koios');
    expect(err.retryable).toBe(false);
    expect(err).not.toBeInstanceOf(ProviderUnavailableError);
  });
});
