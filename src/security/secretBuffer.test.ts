import { wipe, withSecret, withSecretSync } from './secretBuffer.js';

describe('secretBuffer', () => {
  it('wipe zeroes a buffer', () => {
    const b = Buffer.from([1, 2, 3, 4]);
    wipe(b);
    expect([...b]).toEqual([0, 0, 0, 0]);
  });

  it('withSecretSync wipes after use and returns the result', () => {
    const secret = Buffer.from('deadbeef', 'hex');
    const len = withSecretSync(secret, (s) => s.length);
    expect(len).toBe(4);
    expect(secret.every((x) => x === 0)).toBe(true);
  });

  it('withSecret wipes even when the callback throws', async () => {
    const secret = Buffer.from('cafebabe', 'hex');
    await expect(
      withSecret(secret, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(secret.every((x) => x === 0)).toBe(true);
  });
});
