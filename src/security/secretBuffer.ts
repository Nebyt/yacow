// Zero-after-use handling for plaintext key material (plan §3.7b).
// Key bytes live in a Buffer (not a string) and are overwritten the instant
// they are no longer needed, minimising the plaintext-in-memory window.

/** Overwrite a buffer's contents with zeros. */
export function wipe(buf: Buffer): void {
  buf.fill(0);
}

/**
 * Run `fn` with a secret buffer, then wipe it — even if `fn` throws.
 * Return whatever `fn` returns. The buffer must NOT be retained by `fn`.
 */
export async function withSecret<T>(
  secret: Buffer,
  fn: (secret: Buffer) => T | Promise<T>,
): Promise<T> {
  try {
    return await fn(secret);
  } finally {
    wipe(secret);
  }
}

/** Synchronous variant of {@link withSecret}. */
export function withSecretSync<T>(secret: Buffer, fn: (secret: Buffer) => T): T {
  try {
    return fn(secret);
  } finally {
    wipe(secret);
  }
}
