// The one HTTP path every adapter uses (plan §12.4 B2).
//
// Responsibilities, kept here so Blockfrost and Koios cannot drift apart:
//   - build the URL (base + path + query) and send the provider's auth headers;
//   - time each request out (a hung backend must not hang the TUI);
//   - map status codes onto the error taxonomy in ./types.ts;
//   - retry the SAME provider on transient failures with exponential backoff,
//     honouring `Retry-After` -- failing over to the other provider is the
//     fallback wrapper's job (B7), not ours;
//   - never let a credential reach an error message, a log line or a stack.
//
// `fetchImpl`, `sleep`, `random` and `now` are injectable so tests are
// deterministic and never touch the network (decision 5.3).
import { shutdownSignal } from './shutdown.js';
import {
  ProviderAuthError,
  ProviderBannedError,
  ProviderRateLimitError,
  ProviderRequestError,
  ProviderShutdownError,
  ProviderUnavailableError,
  type ProviderId,
} from './types.js';

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRIES = 2;
export const DEFAULT_BACKOFF_MS = 500;
/** Cap a single backoff wait; a `Retry-After` of an hour must not freeze the UI. */
export const MAX_BACKOFF_MS = 10_000;

/** Header names whose value is a credential. Compared lowercased. */
const SECRET_HEADERS = new Set(['project_id', 'authorization', 'api-key', 'x-api-key']);
/** Query parameters that carry a credential on other backends; scrubbed defensively. */
const SECRET_QUERY_PARAMS = new Set(['project_id', 'api_key', 'apikey', 'token', 'key']);

/** Placeholder for a masked credential. Kept alphanumeric so it survives URL encoding intact. */
export const REDACTED = 'REDACTED';

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST';
  query?: Record<string, QueryValue>;
  /** JSON request body. Mutually exclusive with `cbor`. */
  json?: unknown;
  /** Raw CBOR request body (tx submission). */
  cbor?: Uint8Array;
  headers?: Record<string, string>;
  /** Resolve `null` on HTTP 404 instead of throwing (Blockfrost's "never used"). */
  notFoundAsNull?: boolean;
  /**
   * How to read the response body. Tx submission is the reason `text` exists:
   * the submit APIs answer with the bare tx hash, quoted by some backends and
   * not by others, so the adapters read it as text and unquote it themselves.
   */
  parse?: 'json' | 'text';
  timeoutMs?: number;
  retries?: number;
}

export interface HttpClientConfig {
  provider: ProviderId;
  /** Without a trailing slash, e.g. `https://cardano-preprod.blockfrost.io/api/v0`. */
  baseUrl: string;
  /** Auth headers; values are redacted everywhere they could be printed. */
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export interface HttpClient {
  readonly provider: ProviderId;
  readonly baseUrl: string;
  /** Parsed JSON body, or `null` when `notFoundAsNull` swallowed a 404. */
  request<T>(path: string, options?: RequestOptions): Promise<T | null>;
  getJson<T>(path: string, options?: RequestOptions): Promise<T | null>;
  postJson<T>(path: string, body: unknown, options?: RequestOptions): Promise<T | null>;
  /** POST raw CBOR; providers answer with a quoted string (the tx hash). */
  postCbor<T>(path: string, body: Uint8Array, options?: RequestOptions): Promise<T | null>;
}

/** Replace credential header values. Use before logging or serialising headers. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SECRET_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

/** Strip credential-looking query values so a URL is safe to put in a message. */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (SECRET_QUERY_PARAMS.has(name.toLowerCase())) {
      parsed.searchParams.set(name, REDACTED);
    }
  }
  return parsed.toString();
}

/** Strip one pair of surrounding double quotes, if present. */
export function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

export function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, QueryValue> = {},
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${base}${suffix}`);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  return url.toString();
}

/**
 * `Retry-After` is either delta-seconds or an HTTP-date (RFC 9110). Returns
 * null for a missing/unparsable header, and never a negative delay.
 */
export function parseRetryAfter(header: string | null, nowMs: number): number | null {
  if (header == null) return null;
  const value = header.trim();
  if (value === '') return null;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10) * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - nowMs);
}

interface ErrorContext {
  provider: ProviderId;
  status: number;
  method: string;
  url: string;
  body: string;
  retryAfterMs: number | null;
}

/** Status -> error taxonomy (plan §12.2/§12.3 status tables). */
function errorForStatus(ctx: ErrorContext): Error {
  // Bodies can be long HTML error pages; one line is enough to debug with.
  const detail = ctx.body.trim().slice(0, 200).replace(/\s+/g, ' ');
  const where = `${ctx.method} ${redactUrl(ctx.url)}`;
  const message = `${where} failed with HTTP ${ctx.status}${detail === '' ? '' : `: ${detail}`}`;
  const base = { provider: ctx.provider, status: ctx.status };

  if (ctx.status === 401 || ctx.status === 403) {
    return new ProviderAuthError(`${message} (check the API key for this network)`, base);
  }
  if (ctx.status === 418) {
    return new ProviderBannedError(`${message} (client temporarily banned)`, base);
  }
  // Blockfrost answers 402 when the daily quota is spent: not a credential
  // problem, just "no more requests today" -- same handling as a rate limit.
  if (ctx.status === 402 || ctx.status === 429) {
    return new ProviderRateLimitError(message, { ...base, retryAfterMs: ctx.retryAfterMs });
  }
  if (ctx.status >= 500) {
    return new ProviderUnavailableError(message, base);
  }
  return new ProviderRequestError(message, base);
}

function backoffFor(attempt: number, baseMs: number, random: () => number): number {
  // Exponential with full jitter, so parallel discovery requests do not retry
  // in lockstep and re-trigger the rate limit they just hit.
  const ceiling = Math.min(baseMs * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(ceiling * (0.5 + 0.5 * random()));
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    // unref: a pending backoff must never be the reason the process stays alive
    // when the user has quit.
    setTimeout(resolve, ms).unref();
  });

export function createHttpClient(config: HttpClientConfig): HttpClient {
  const {
    provider,
    baseUrl,
    headers: authHeaders = {},
    timeoutMs: defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    retries: defaultRetries = DEFAULT_RETRIES,
    backoffMs = DEFAULT_BACKOFF_MS,
    fetchImpl,
    sleep = realSleep,
    random = Math.random,
    now = Date.now,
  } = config;

  // Bound late so a test that swaps globalThis.fetch still works.
  const doFetch: typeof fetch = (input, init) => (fetchImpl ?? globalThis.fetch)(input, init);

  async function attempt<T>(
    method: 'GET' | 'POST',
    url: string,
    options: RequestOptions,
  ): Promise<T | null> {
    const headers: Record<string, string> = { accept: 'application/json', ...authHeaders };
    let body: RequestInit['body'];
    if (options.cbor !== undefined) {
      headers['content-type'] = 'application/cbor';
      body = options.cbor;
    } else if (options.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    Object.assign(headers, options.headers ?? {});

    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    const controller = new AbortController();
    // Quitting cancels the request; so does the timeout. Whichever comes first.
    const shutdown = shutdownSignal();
    if (shutdown.aborted) throw new ProviderShutdownError(provider);
    const onShutdown = (): void => controller.abort();
    shutdown.addEventListener('abort', onShutdown, { once: true });
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timer.unref();
    let response: Response;
    try {
      response = await doFetch(url, { method, headers, body, signal: controller.signal });
    } catch (cause) {
      // A shutdown abort is not a backend problem and must not be retried or
      // failed over -- the user is leaving.
      if (shutdown.aborted) throw new ProviderShutdownError(provider);
      // Abort and connection failures look the same to callers: the backend did
      // not answer, so retry it and, if it keeps failing, fail over.
      const aborted = controller.signal.aborted;
      throw new ProviderUnavailableError(
        aborted
          ? `${method} ${redactUrl(url)} timed out after ${timeoutMs}ms`
          : `${method} ${redactUrl(url)} could not be reached`,
        { provider, cause },
      );
    } finally {
      clearTimeout(timer);
      shutdown.removeEventListener('abort', onShutdown);
    }

    if (response.status === 404 && options.notFoundAsNull === true) return null;

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw errorForStatus({
        provider,
        status: response.status,
        method,
        url,
        body: text,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after'), now()),
      });
    }

    const text = await response.text();
    if (options.parse === 'text') return text.trim() as T;
    if (text.trim() === '') {
      throw new ProviderRequestError(
        `${method} ${redactUrl(url)} returned an empty body where JSON was expected`,
        { provider, status: response.status },
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new ProviderRequestError(
        `${method} ${redactUrl(url)} returned a body that is not JSON`,
        { provider, status: response.status, cause },
      );
    }
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T | null> {
    const method = options.method ?? (options.json === undefined && options.cbor === undefined ? 'GET' : 'POST');
    const url = buildUrl(baseUrl, path, options.query);
    const retries = options.retries ?? defaultRetries;

    let lastError: unknown;
    for (let tryIndex = 0; tryIndex <= retries; tryIndex += 1) {
      try {
        return await attempt<T>(method, url, options);
      } catch (err) {
        if (err instanceof ProviderShutdownError) throw err; // stop immediately
        lastError = err;
        const retryable =
          err instanceof ProviderRateLimitError || err instanceof ProviderUnavailableError;
        if (!retryable || tryIndex === retries) throw err;
        const retryAfter = err instanceof ProviderRateLimitError ? err.retryAfterMs : null;
        // The server's own hint wins when it asks for a longer pause than ours.
        const wait = Math.min(
          Math.max(backoffFor(tryIndex, backoffMs, random), retryAfter ?? 0),
          MAX_BACKOFF_MS,
        );
        await sleep(wait);
      }
    }
    /* istanbul ignore next -- the loop either returns or throws */
    throw lastError;
  }

  return {
    provider,
    baseUrl,
    request,
    getJson: (path, options = {}) => request(path, { ...options, method: 'GET' }),
    postJson: (path, body, options = {}) => request(path, { ...options, method: 'POST', json: body }),
    postCbor: (path, body, options = {}) => request(path, { ...options, method: 'POST', cbor: body }),
  };
}
