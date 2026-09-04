import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSecureFile,
  ensureSecureDir,
  isOwnerOnly,
  permsOf,
  writeSecureFile,
} from './fsPerms.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'yacow-'));
}

describe('fsPerms', () => {
  it('creates a directory owner-only (0700)', () => {
    const dir = join(tmp(), 'home');
    ensureSecureDir(dir);
    expect(permsOf(dir)).toBe(0o700);
  });

  it('writes a file owner-only (0600)', () => {
    const path = join(tmp(), 'wallets', 'w.json');
    writeSecureFile(path, '{"secret":true}');
    expect(permsOf(path)).toBe(0o600);
    expect(isOwnerOnly(path)).toBe(true);
    expect(() => assertSecureFile(path)).not.toThrow();
  });
});
