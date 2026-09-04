// Client-side rate limiting (plan §12.2).
//
// Blockfrost has no batch endpoints, so discovery fans out dozens of requests.
// A concurrency cap alone does not bound the RATE: five in flight, each taking
// ~150ms, is ~33 requests/second against a 10/second allowance -- which is how
// a plain balance refresh earned an HTTP 429 on the free tier.
//
// A token bucket bounds the rate directly while still allowing a short burst,
// and it is cheaper than paying for 429s and their retries.
export interface RateLimiterOptions {
  /** Sustained requests per second. */
  ratePerSecond: number;
  /** How many may go at once before the sustained rate applies. */
  burst?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RateLimiter {
  /** Resolves when the caller may send. */
  acquire(): Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    // unref: a queued request waiting its turn must not keep a quitting process
    // alive (the rate limiter can hold callers for seconds).
    setTimeout(resolve, ms).unref();
  });

export function createRateLimiter({
  ratePerSecond,
  burst = Math.max(1, Math.floor(ratePerSecond)),
  now = Date.now,
  sleep = realSleep,
}: RateLimiterOptions): RateLimiter {
  if (ratePerSecond <= 0) throw new RangeError(`Rate must be > 0, got ${ratePerSecond}.`);
  const intervalMs = 1000 / ratePerSecond;
  let tokens = burst;
  let lastRefill = now();
  // Serialises waiters, so concurrent callers queue instead of all reading the
  // same token count and sending together.
  let queue: Promise<void> = Promise.resolve();

  const take = async (): Promise<void> => {
    const elapsed = now() - lastRefill;
    if (elapsed > 0) {
      tokens = Math.min(burst, tokens + elapsed / intervalMs);
      lastRefill = now();
    }
    if (tokens < 1) {
      const wait = Math.ceil((1 - tokens) * intervalMs);
      await sleep(wait);
      tokens = Math.min(burst, tokens + (now() - lastRefill) / intervalMs);
      lastRefill = now();
    }
    tokens -= 1;
  };

  return {
    acquire(): Promise<void> {
      const next = queue.then(take, take);
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
