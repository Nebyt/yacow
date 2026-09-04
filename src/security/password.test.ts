import { checkPassword, MIN_LENGTH } from './password.js';

describe('checkPassword', () => {
  it('rejects weak passwords', () => {
    expect(checkPassword('password').ok).toBe(false);
    expect(checkPassword('12345678').ok).toBe(false);
    expect(checkPassword('abc').ok).toBe(false);
  });

  it('rejects short-but-complex passwords below the length floor', () => {
    const short = 'aB3$xY'; // < MIN_LENGTH
    expect(short.length).toBeLessThan(MIN_LENGTH);
    const r = checkPassword(short);
    expect(r.ok).toBe(false);
    expect(r.suggestions.some((s) => s.includes(`${MIN_LENGTH}`))).toBe(true);
  });

  it('accepts a strong password and reports a score + label', () => {
    const r = checkPassword('correct horse battery staple 42!');
    expect(r.ok).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(3);
    expect(typeof r.label).toBe('string');
  });
});
