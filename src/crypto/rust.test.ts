import { RustModule } from './rust.js';

describe('RustModule', () => {
  it('throws if used before load()', () => {
    expect(() => RustModule.CSL).toThrow(/load\(\)/);
  });

  it('exposes the CSL after load()', async () => {
    await RustModule.load();
    expect(RustModule.isLoaded).toBe(true);
    // Sanity: a real CSL call round-trips.
    const n = RustModule.CSL.BigNum.from_str('1000000');
    expect(n.to_str()).toBe('1000000');
  });
});
