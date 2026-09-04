import { createRateLimiter } from './rateLimiter.js';

/** A clock and sleep that advance together, so no test waits on real time. */
function fakeClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    advance: (ms: number) => {
      time += ms;
    },
    get time() {
      return time;
    },
  };
}

describe('createRateLimiter', () => {
  it('lets the initial burst through without waiting', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ ratePerSecond: 10, burst: 5, ...clock });
    for (let i = 0; i < 5; i += 1) await limiter.acquire();
    expect(clock.time).toBe(0);
  });

  it('spaces requests once the burst is spent', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ ratePerSecond: 10, burst: 1, ...clock });
    await limiter.acquire(); // free
    await limiter.acquire();
    await limiter.acquire();
    // 10/second means one per 100ms.
    expect(clock.time).toBe(200);
  });

  it('keeps a burst of concurrent callers under the allowed rate', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ ratePerSecond: 8, burst: 8, ...clock });
    // 40 requests, the size of one gap-limit discovery window on Blockfrost.
    await Promise.all(Array.from({ length: 40 }, () => limiter.acquire()));
    // 8 free, 32 spaced at 125ms => 4000ms; anything much less would be a burst
    // that earns an HTTP 429.
    expect(clock.time).toBe(4000);
    expect(40 / (clock.time / 1000 + 1)).toBeLessThanOrEqual(8);
  });

  it('refills over time, so a later call is free again', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ ratePerSecond: 10, burst: 2, ...clock });
    await limiter.acquire();
    await limiter.acquire();
    clock.advance(1000); // idle for a second
    await limiter.acquire();
    expect(clock.time).toBe(1000); // no extra wait
  });

  it('never hands out more than the burst after a long idle', async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ ratePerSecond: 10, burst: 3, ...clock });
    clock.advance(60_000);
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.time).toBe(60_000);
    await limiter.acquire(); // the fourth must wait
    expect(clock.time).toBe(60_100);
  });

  it('rejects a nonsensical rate', () => {
    expect(() => createRateLimiter({ ratePerSecond: 0 })).toThrow(RangeError);
  });
});
