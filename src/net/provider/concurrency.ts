// Small request-shaping helpers shared by the adapters (plan §12.2/§12.3).
//
// Blockfrost has no batch endpoints, so a gap-limit-20 discovery pass fans out
// into ~40 requests; firing them all at once trips the rate limit. Koios does
// batch, but caps how many addresses one call may carry. Hence: a concurrency
// limiter and a chunker.

/**
 * Map `items` through `fn` with at most `limit` calls in flight.
 * Results keep the input order; the first rejection propagates.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit < 1) throw new RangeError(`Concurrency limit must be >= 1, got ${limit}.`);
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** Split into fixed-size chunks; the last chunk may be shorter. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new RangeError(`Chunk size must be >= 1, got ${size}.`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Split into chunks whose serialised JSON stays under `maxBytes`.
 *
 * Koios rejects an oversized request body outright (HTTP 413), and a Cardano
 * address is ~108 characters, so "50 addresses" silently became 5,583 bytes
 * against a 5,120-byte limit. Counting items is guesswork; counting bytes is
 * not. `overheadBytes` covers the surrounding JSON (field names, flags).
 *
 * An item too large to fit alone still gets its own chunk -- the caller finds
 * out from the backend rather than from a silently dropped entry.
 */
export function chunkByBytes<T>(
  items: readonly T[],
  maxBytes: number,
  overheadBytes = 0,
  maxItems = Number.MAX_SAFE_INTEGER,
): T[][] {
  if (maxBytes < 1) throw new RangeError(`Byte budget must be >= 1, got ${maxBytes}.`);
  const budget = Math.max(1, maxBytes - overheadBytes);
  const out: T[][] = [];
  let current: T[] = [];
  let size = 2; // the enclosing [] of the JSON array

  for (const item of items) {
    // +1 for the separating comma.
    const itemSize = JSON.stringify(item).length + 1;
    if (current.length > 0 && (size + itemSize > budget || current.length >= maxItems)) {
      out.push(current);
      current = [];
      size = 2;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) out.push(current);
  return out;
}
