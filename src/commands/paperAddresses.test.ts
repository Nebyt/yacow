import { RustModule } from '../crypto/rust.js';
import type { PaperAddressesResult } from './paperAddresses.js';
import {
  DEFAULT_COUNT,
  MAX_COUNT,
  UsageError,
  formatPaperAddresses,
  paperAddresses,
  resolvePaperAddressesOptions,
  splitSecretInput,
} from './paperAddresses.js';

const PAPER = {
  scrambled:
    'air comic label visual scale twist sell build ankle copy expect rocket crystal allow tissue eager jaguar crouch million cushion beach',
  password: 'testpasswordtest',
  /** CIP4 plate of the recovered wallet -- what Yoroi shows on restore. */
  plate: 'PDED-7795',
  mainnetFirst: 'Ae2tdPwUPEZ5WTs87mbEwJjbW7pmkigLfBnLp3eKfGehapUMKiewwMn5yxh',
};

beforeAll(async () => {
  await RustModule.load();
});

describe('resolvePaperAddressesOptions', () => {
  test('applies the documented defaults', () => {
    expect(resolvePaperAddressesOptions({})).toEqual({
      network: 'mainnet',
      count: DEFAULT_COUNT,
      account: 0,
      json: false,
      phraseFile: null,
      stdin: false,
    });
  });

  test('parses supplied values', () => {
    expect(resolvePaperAddressesOptions({ network: 'preprod', count: '3', account: '2', json: true })).toMatchObject({
      network: 'preprod',
      count: 3,
      account: 2,
      json: true,
    });
  });

  test('rejects an unknown network', () => {
    expect(() => resolvePaperAddressesOptions({ network: 'sancho' })).toThrow(UsageError);
    expect(() => resolvePaperAddressesOptions({ network: '' })).toThrow('mainnet');
  });

  test('rejects counts outside 1..MAX_COUNT and non-numbers', () => {
    expect(() => resolvePaperAddressesOptions({ count: '0' })).toThrow(`between 1 and ${MAX_COUNT}`);
    expect(() => resolvePaperAddressesOptions({ count: String(MAX_COUNT + 1) })).toThrow(`between 1 and ${MAX_COUNT}`);
    expect(() => resolvePaperAddressesOptions({ count: 'ten' })).toThrow('non-negative integer');
    expect(() => resolvePaperAddressesOptions({ count: '-1' })).toThrow('non-negative integer');
    expect(resolvePaperAddressesOptions({ count: String(MAX_COUNT) }).count).toEqual(MAX_COUNT);
  });

  test('rejects a non-numeric account', () => {
    expect(() => resolvePaperAddressesOptions({ account: '1.5' })).toThrow('non-negative integer');
  });

  test('rejects --stdin together with --phrase-file', () => {
    expect(() => resolvePaperAddressesOptions({ stdin: true, phraseFile: '/tmp/p.txt' })).toThrow('not both');
  });
});

describe('splitSecretInput', () => {
  test('reads phrase then password', () => {
    expect(splitSecretInput('word one two\nsecret\n')).toEqual({ phrase: 'word one two', password: 'secret' });
  });

  test('keeps an empty password line as an empty password', () => {
    expect(splitSecretInput('phrase here\n')).toEqual({ phrase: 'phrase here', password: '' });
  });

  test('reports a missing password line as absent', () => {
    expect(splitSecretInput('phrase here')).toEqual({ phrase: 'phrase here', password: null });
  });

  test('handles CRLF input', () => {
    expect(splitSecretInput('phrase here\r\nsecret\r\n')).toEqual({ phrase: 'phrase here', password: 'secret' });
  });

  test('rejects empty input', () => {
    expect(() => splitSecretInput('')).toThrow(UsageError);
    expect(() => splitSecretInput('\nsecret')).toThrow('first line');
  });
});

describe('paperAddresses', () => {
  test('derives the golden wallet plate and addresses', () => {
    const result = paperAddresses({
      phrase: PAPER.scrambled,
      password: PAPER.password,
      network: 'mainnet',
      account: 0,
      count: 10,
    });
    expect(result.plate).toEqual(PAPER.plate);
    expect(result.network).toEqual('mainnet');
    expect(result.addresses).toHaveLength(10);
    expect(result.addresses[0]).toEqual({
      index: 0,
      role: 0,
      path: "44'/1815'/0'/0/0",
      address: PAPER.mainnetFirst,
    });
    expect(new Set(result.addresses.map(a => a.address)).size).toEqual(10);
  });

  test('a wrong password produces a different plate and different addresses', () => {
    const wrong = paperAddresses({
      phrase: PAPER.scrambled,
      password: 'not-the-password',
      network: 'mainnet',
      account: 0,
      count: 1,
    });
    expect(wrong.plate).not.toEqual(PAPER.plate);
    expect(wrong.addresses[0].address).not.toEqual(PAPER.mainnetFirst);
  });

  test('preprod addresses differ from mainnet for the same wallet', () => {
    const preprod = paperAddresses({
      phrase: PAPER.scrambled,
      password: PAPER.password,
      network: 'preprod',
      account: 0,
      count: 1,
    });
    expect(preprod.plate).toEqual(PAPER.plate); // the plate is network-independent
    expect(preprod.addresses[0].address).not.toEqual(PAPER.mainnetFirst);
  });

  test('propagates a malformed paper phrase', () => {
    expect(() =>
      paperAddresses({ phrase: 'too few words', password: PAPER.password, network: 'mainnet', account: 0, count: 1 }),
    ).toThrow('21 words');
  });
});

describe('formatPaperAddresses', () => {
  // Built in beforeAll, not at describe time: the CSL is only usable once
  // RustModule.load() has run.
  let result: PaperAddressesResult;

  beforeAll(() => {
    result = paperAddresses({
      phrase: PAPER.scrambled,
      password: PAPER.password,
      network: 'mainnet',
      account: 0,
      count: 2,
    });
  });

  test('table output carries the plate, path and indexed addresses', () => {
    const text = formatPaperAddresses(result, false);
    expect(text).toContain(`plate:   ${PAPER.plate}`);
    expect(text).toContain("path: 44'/1815'/0'/0/i");
    expect(text).toContain(`  0  ${PAPER.mainnetFirst}`);
    expect(text.split('\n')).toHaveLength(5); // 2 header lines + blank + 2 rows
  });

  test('json output round-trips the result', () => {
    expect(JSON.parse(formatPaperAddresses(result, true))).toEqual(result);
  });

  test('neither format leaks the recovery phrase', () => {
    for (const text of [formatPaperAddresses(result, false), formatPaperAddresses(result, true)]) {
      expect(text).not.toContain('business sight');
      expect(text).not.toContain(PAPER.password);
    }
  });
});
