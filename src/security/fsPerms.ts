// File-permission hardening (plan §3.7c).
// Keystore dir is 0700, files are 0600, writes are atomic (temp + rename).
import { chmodSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_HOME_DIR = join(homedir(), '.yacow');

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

/** Create a directory owner-only (0700), idempotently. Returns the path. */
export function ensureSecureDir(dir: string = DEFAULT_HOME_DIR): string {
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  // recursive:true does not re-chmod an existing dir, so enforce it explicitly.
  chmodSync(dir, DIR_MODE);
  return dir;
}

/** Atomically write a file as owner-only (0600). */
export function writeSecureFile(path: string, data: string | Buffer): void {
  ensureSecureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data, { mode: FILE_MODE });
  chmodSync(tmp, FILE_MODE);
  renameSync(tmp, path);
}

/** The permission bits of a path (e.g. 0o600). */
export function permsOf(path: string): number {
  return statSync(path).mode & 0o777;
}

/** True when a path is owner-only readable/writable (no group/other access). */
export function isOwnerOnly(path: string): boolean {
  return (permsOf(path) & 0o077) === 0;
}

/** Throw if a keystore file is group/world-accessible (plan §3.7c startup check). */
export function assertSecureFile(path: string): void {
  if (!isOwnerOnly(path)) {
    throw new Error(
      `Insecure permissions on ${path}: expected owner-only (0600), got 0${permsOf(path).toString(8)}.`,
    );
  }
}
