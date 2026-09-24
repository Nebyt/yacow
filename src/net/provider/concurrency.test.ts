import { chunk, chunkByBytes, mapWithConcurrency } from './concurrency.js';

describe('mapWithConcurrency', () => {
  it('keeps input order regardless of completion order', async () => {
    const delays = [30, 0, 15, 5];
    const result = await mapWithConcurrency(delays, 2, async (ms, i) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `${i}:${ms}`;
    });
    expect(result).toEqual(['0:30', '1:0', '2:15', '3:5']);
  });

  it('never exceeds the limit of in-flight calls', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return n;
      },
    );
    expect(peak).toBe(3);
  });

  it('handles an empty list without calling the mapper', async () => {
    const fn = jest.fn();
    await expect(mapWithConcurrency([], 5, fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('propagates the first rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('rejects a nonsensical limit', async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toBeInstanceOf(RangeError);
  });
});

describe('chunk', () => {
  it('splits evenly and leaves a short tail', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns one chunk when the list is smaller than the size', () => {
    expect(chunk([1, 2], 50)).toEqual([[1, 2]]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('rejects a nonsensical size', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });
});

describe('chunkByBytes', () => {
  // A real preprod address: 108 characters, so 50 of them exceed Koios's
  // 5120-byte body limit -- the regression this guards.
  const ADDRESS =
    'addr_test1qqh6cswdjfaxz7f2ldpl9c0xzxv5ss403vnhz2dznuyltxcuv6hm9vhl7207qs0e4pcw5ctajfk37mz43kjegxqel0wsfkxdy7';

  it('keeps each chunk under the byte budget', () => {
    const addresses = Array.from({ length: 100 }, () => ADDRESS);
    for (const batch of chunkByBytes(addresses, 5120, 256)) {
      expect(JSON.stringify(batch).length).toBeLessThanOrEqual(5120 - 256);
    }
  });

  it('loses nothing and preserves order', () => {
    const items = Array.from({ length: 57 }, (_, i) => `item-${i}`);
    expect(chunkByBytes(items, 200).flat()).toEqual(items);
  });

  it('also honours an item cap for small items', () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    const chunks = chunkByBytes(items, 100_000, 0, 40);
    expect(chunks.map((c) => c.length)).toEqual([40, 5]);
  });

  it('gives an oversized item its own chunk rather than dropping it', () => {
    const chunks = chunkByBytes(['x', 'y'.repeat(500), 'z'], 100);
    expect(chunks.flat()).toEqual(['x', 'y'.repeat(500), 'z']);
    expect(chunks).toHaveLength(3);
  });

  it('returns nothing for an empty list and rejects a nonsense budget', () => {
    expect(chunkByBytes([], 100)).toEqual([]);
    expect(() => chunkByBytes([1], 0)).toThrow(RangeError);
  });
});
