// Process-wide cancellation for chain requests.
//
// Quitting during a balance refresh used to hang the app: Ink unmounted, but
// the in-flight fetches, the retry backoff timers and the rate limiter's sleeps
// all kept Node's event loop alive, so the process never exited and the
// terminal never came back.
//
// A single shutdown signal lets every layer stop at once. It is deliberately
// module-global: "the user is quitting" is a property of the process, not of
// any one request, and threading a signal through every call site would put the
// burden on code that has nothing to do with shutdown.
let controller = new AbortController();

/** Aborts when the app is shutting down. Safe to attach listeners to. */
export function shutdownSignal(): AbortSignal {
  return controller.signal;
}

export function isShuttingDown(): boolean {
  return controller.signal.aborted;
}

/** Cancel every in-flight and future chain request. Idempotent. */
export function abortInFlightRequests(): void {
  if (!controller.signal.aborted) controller.abort();
}

/** Start over -- for tests, which must not leak an aborted state between cases. */
export function resetShutdown(): void {
  controller = new AbortController();
}
