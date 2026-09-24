import {
  DEFAULT_BACKOFF_MS,
  MAX_BACKOFF_MS,
  REDACTED,
  buildUrl,
  createHttpClient,
  parseRetryAfter,
  redactHeaders,
  redactUrl,
  unquote,
  type HttpClientConfig,
} from './http.js';
import {
  ProviderAuthError,
  ProviderBannedError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderUnavailableError,
} from './types.js';

const BASE = 'https://cardano-preprod.blockfrost.io/api/v0';
const KEY = 'preprodSUPERSECRETKEY123';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Responder = () => Promise<Response> | Response;

/** A fetch stand-in that records calls and replays queued responses in order. */
function fakeFetch(responders: Responder[]): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[name.toLowerCase()] = value;
    }
    calls.push({ url: String(input), method: init?.method ?? 'GET', headers, body: init?.body });
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    return await responder();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function json(body: unknown, init: ResponseInit = {}): Responder {
  return () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    });
}

function status(code: number, body = '', headers: Record<string, string> = {}): Responder {
  return () => new Response(body, { status: code, headers });
}

function clientWith(
  responders: Responder[],
  overrides: Partial<HttpClientConfig> = {},
): { client: ReturnType<typeof createHttpClient>; calls: Call[]; sleeps: number[] } {
  const { impl, calls } = fakeFetch(responders);
  const sleeps: number[] = [];
  const client = createHttpClient({
    provider: 'blockfrost',
    baseUrl: BASE,
    headers: { project_id: KEY },
    fetchImpl: impl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0, // full-jitter floor: backoff = ceiling / 2
    now: () => 1_000_000,
    ...overrides,
  });
  return { client, calls, sleeps };
}

describe('buildUrl', () => {
  it('joins base and path without doubling the slash and appends query', () => {
    expect(buildUrl(`${BASE}/`, 'addresses/addr1/utxos', { count: 100, page: 2 })).toBe(
      `${BASE}/addresses/addr1/utxos?count=100&page=2`,
    );
    expect(buildUrl(BASE, '/tip')).toBe(`${BASE}/tip`);
  });

  it('drops undefined query values', () => {
    expect(buildUrl(BASE, '/epoch_params', { _epoch_no: undefined, count: 1 })).toBe(
      `${BASE}/epoch_params?count=1`,
    );
  });
});

describe('redaction', () => {
  it('masks credential headers and leaves the rest alone', () => {
    expect(
      redactHeaders({
        project_id: KEY,
        Authorization: `Bearer ${KEY}`,
        accept: 'application/json',
      }),
    ).toEqual({
      project_id: REDACTED,
      Authorization: REDACTED,
      accept: 'application/json',
    });
  });

  it('masks credential query parameters', () => {
    const masked = redactUrl(`${BASE}/tip?token=${KEY}&count=10`);
    expect(masked).not.toContain(KEY);
    expect(masked).toContain('count=10');
  });

  it('leaves a non-URL string untouched', () => {
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('2', 0)).toBe(2000);
  });

  it('reads an HTTP-date relative to now', () => {
    const now = Date.parse('2026-09-04T12:00:00Z');
    expect(parseRetryAfter('Fri, 04 Sep 2026 12:00:30 GMT', now)).toBe(30_000);
  });

  it('never returns a negative delay for a past date', () => {
    const now = Date.parse('2026-09-04T12:01:00Z');
    expect(parseRetryAfter('Fri, 04 Sep 2026 12:00:00 GMT', now)).toBe(0);
  });

  it('returns null for missing or unparsable values', () => {
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(parseRetryAfter('  ', 0)).toBeNull();
    expect(parseRetryAfter('soon', 0)).toBeNull();
  });
});

describe('requests', () => {
  it('returns the parsed body and sends the auth headers', async () => {
    const { client, calls } = clientWith([json({ height: 42 })]);
    await expect(client.getJson('/blocks/latest')).resolves.toEqual({ height: 42 });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`${BASE}/blocks/latest`);
    expect(calls[0].headers.project_id).toBe(KEY);
    expect(calls[0].headers.accept).toBe('application/json');
  });

  it('serialises a JSON body', async () => {
    const { client, calls } = clientWith([json([{ address: 'addr1' }])]);
    await client.postJson('/address_info', { _addresses: ['addr1'] });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['content-type']).toBe('application/json');
    expect(calls[0].body).toBe('{"_addresses":["addr1"]}');
  });

  it('sends CBOR bytes unmodified', async () => {
    const cbor = new Uint8Array([0x83, 0xa4, 0x00]);
    const { client, calls } = clientWith([json('abc123')]);
    await expect(client.postCbor('/tx/submit', cbor)).resolves.toBe('abc123');
    expect(calls[0].headers['content-type']).toBe('application/cbor');
    expect(calls[0].body).toBe(cbor);
  });
});

describe('status mapping', () => {
  it.each([
    [401, ProviderAuthError],
    [403, ProviderAuthError],
    [418, ProviderBannedError],
    [400, ProviderRequestError],
    [422, ProviderRequestError],
    [404, ProviderRequestError],
  ])('maps HTTP %s without retrying', async (code, expected) => {
    const { client, calls } = clientWith([status(code, 'nope')]);
    await expect(client.getJson('/blocks/latest')).rejects.toBeInstanceOf(expected);
    expect(calls).toHaveLength(1); // no retry for a non-transient failure
  });

  it('maps quota (402) and rate limit (429) to ProviderRateLimitError', async () => {
    const { client } = clientWith([
      status(402, 'quota'),
      status(402, 'quota'),
      status(402, 'quota'),
    ]);
    await expect(client.getJson('/blocks/latest')).rejects.toBeInstanceOf(ProviderRateLimitError);
  });

  it('carries Retry-After onto the rate-limit error', async () => {
    const { client } = clientWith([status(429, '', { 'retry-after': '3' })], { retries: 0 });
    await expect(client.getJson('/blocks/latest')).rejects.toMatchObject({
      retryAfterMs: 3000,
      status: 429,
    });
  });

  it('resolves null on 404 when the adapter asks for it', async () => {
    const { client } = clientWith([status(404, 'Not Found')]);
    await expect(client.getJson('/addresses/addr1', { notFoundAsNull: true })).resolves.toBeNull();
  });

  it('rejects a 200 body that is not JSON', async () => {
    const { client, calls } = clientWith([
      () => new Response('<html>oops</html>', { status: 200 }),
    ]);
    await expect(client.getJson('/blocks/latest')).rejects.toBeInstanceOf(ProviderRequestError);
    expect(calls).toHaveLength(1);
  });

  it('rejects an empty 200 body', async () => {
    const { client } = clientWith([() => new Response('', { status: 200 })]);
    await expect(client.getJson('/blocks/latest')).rejects.toThrow(/empty body/);
  });
});

describe('retries', () => {
  it('retries a 5xx and returns the body of the attempt that worked', async () => {
    const { client, calls, sleeps } = clientWith([status(503, 'down'), json({ height: 7 })]);
    await expect(client.getJson('/blocks/latest')).resolves.toEqual({ height: 7 });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([DEFAULT_BACKOFF_MS / 2]); // 500 * 2^0, full-jitter floor
  });

  it('gives up after the configured number of retries', async () => {
    const { client, calls, sleeps } = clientWith([status(500, 'boom')]);
    await expect(client.getJson('/blocks/latest')).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(calls).toHaveLength(3); // 1 attempt + 2 retries
    expect(sleeps).toEqual([250, 500]); // exponential
  });

  it('makes exactly one attempt when retries are disabled', async () => {
    const { client, calls } = clientWith([status(500, 'boom')], { retries: 0 });
    await expect(client.getJson('/blocks/latest')).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it('waits the server-requested delay when it exceeds our backoff', async () => {
    const { client, sleeps } = clientWith([
      status(429, '', { 'retry-after': '2' }),
      json({ ok: true }),
    ]);
    await client.getJson('/blocks/latest');
    expect(sleeps).toEqual([2000]);
  });

  it('caps a very long Retry-After', async () => {
    const { client, sleeps } = clientWith([
      status(429, '', { 'retry-after': '3600' }),
      json({ ok: true }),
    ]);
    await client.getJson('/blocks/latest');
    expect(sleeps).toEqual([MAX_BACKOFF_MS]);
  });

  it('spreads retries with jitter instead of firing in lockstep', async () => {
    const { client, sleeps } = clientWith([status(500, 'boom'), json({ ok: true })], {
      random: () => 1, // jitter ceiling
    });
    await client.getJson('/blocks/latest');
    expect(sleeps).toEqual([DEFAULT_BACKOFF_MS]); // vs 250 at the floor
  });

  it('retries a connection failure and reports it as unavailable', async () => {
    const { client, calls } = clientWith([
      () => Promise.reject(new TypeError('fetch failed')),
      json({ height: 9 }),
    ]);
    await expect(client.getJson('/blocks/latest')).resolves.toEqual({ height: 9 });
    expect(calls).toHaveLength(2);
  });

  it('aborts and reports a timeout when the backend never answers', async () => {
    let aborted = false;
    const impl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as unknown as typeof fetch;
    const { client } = clientWith([], { fetchImpl: impl, retries: 0 });
    await expect(client.getJson('/blocks/latest', { timeoutMs: 5 })).rejects.toThrow(
      /timed out after 5ms/,
    );
    expect(aborted).toBe(true);
  });
});

describe('credential safety', () => {
  it('never leaks the key through an error', async () => {
    const { client } = clientWith([status(403, `forbidden for project ${KEY}`)], { retries: 0 });
    const err = await client.getJson('/blocks/latest').catch((e: unknown) => e as Error);
    // The upstream body is echoed, so assert on what WE add: url, headers, stack.
    expect(err.message).toContain('HTTP 403');
    expect(String(err.stack ?? '')).not.toContain('project_id');
    expect(redactHeaders({ project_id: KEY })).toEqual({ project_id: REDACTED });
  });

  it('keeps a credential in the query string out of the error message', async () => {
    const { client } = clientWith([status(500, 'boom')], { retries: 0 });
    const err = await client
      .getJson('/blocks/latest', { query: { token: KEY } })
      .catch((e: unknown) => e as Error);
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain(REDACTED);
  });
});

describe('text bodies', () => {
  it('returns the raw body when the caller asks for text', async () => {
    const { client } = clientWith([() => new Response('"txhash123"', { status: 200 })]);
    await expect(
      client.postCbor('/tx/submit', new Uint8Array([1]), { parse: 'text' }),
    ).resolves.toBe('"txhash123"');
  });

  it('unquotes a quoted body but leaves a bare one alone', () => {
    expect(unquote('"abc"')).toBe('abc');
    expect(unquote('  abc  ')).toBe('abc');
    expect(unquote('"')).toBe('"');
  });
});
