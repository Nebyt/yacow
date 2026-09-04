// Golden Byron address vectors for the paper wallet from
// yoroi-extension's paperWallet.test.js. Index 0 on mainnet is the exact
// address that test asserts, which pins our CSL-based derivation to the
// extension's WalletV2 (bootstrap_era_address) output.
import { RustModule } from './rust.js';
import { mnemonicToRootKey } from './mnemonic.js';
import { ROLE_EXTERNAL, ROLE_INTERNAL } from './derive.js';
import { byronAddressPath, byronAddresses, deriveByronAccountPublic } from './byron.js';
import { NETWORKS } from '../config/networks.js';

const WORDS = 'business sight another write gadget near where hollow insane dynamic grain hurt slim clip require';

const MAINNET_EXTERNAL_10 = [
  'Ae2tdPwUPEZ5WTs87mbEwJjbW7pmkigLfBnLp3eKfGehapUMKiewwMn5yxh',
  'Ae2tdPwUPEZ7dzsSVQous8yxSw4DeCVzoiu4QaZYnADtd3Dn51Pt8J1F4w7',
  'Ae2tdPwUPEZFxF7N9TvKu8KbQUncsfYUGerURGcRhUXN1FtFNQKjD849FVN',
  'Ae2tdPwUPEZGTa45vWggsaYkmKn1hPEDZNNsX2u8iTmqEPEW4J3os8fRZsP',
  'Ae2tdPwUPEZ5RBQK8GUF3S9rQMuijT1ZDLU4pFWPQxa96bnypJhMGQavA4w',
  'Ae2tdPwUPEZCjZfsmuZv2gJtka9QwmBBBzWoSkZGkP8TUcWGVWZP5p8XZ9e',
  'Ae2tdPwUPEZJWW4f8E8DintUoHWs4oCNuw4WvKJ93CJP11B1zDqKuJgBrcN',
  'Ae2tdPwUPEZ5Jd798owPaHU6TaUPyndHGxj55JJvGWd6t9bbuywGjDHxVf6',
  'Ae2tdPwUPEZEuAV6Qqn8WivrCxDLWSDj6RkJMxrkRn1KRmMcCUDPNa11dcy',
  'Ae2tdPwUPEZ6nWKcwSxhbwt42RiC3XWtgFBBCb74RtLeLL9EZ17Z24WePX2',
];

const PREPROD_EXTERNAL_10 = [
  'FHnt4NL7yPXuTx86MN8hrgDkzFD5bW5DzuhpmGzJ6N52omwxYQ5NvfAoxULSfM8',
  'FHnt4NL7yPXhM5841vs4AHQ8prE9njLXAsrNCgi25hUMs6Ru2aGEyUb4kAPMmiw',
  'FHnt4NL7yPYE3LGYXTfJnwASWgFsnhNQKqqqyM5PKcuCEwvwzH73ZxMib9Dw4s7',
  'FHnt4NL7yPY7Tbecjp2SXewNVj86E77xQWt4g1kMmGLnRRT1iJXtMhSbFjayqfE',
  'FHnt4NL7yPY9kT2yWbD2ZnHbx2oi7Qk5h8VTT6BhhpWoxjShN7ki4XpiFKDi7h4',
  'FHnt4NL7yPY2yqMzcHmHAr4cNQRairkf1Y4okua9LM9W2JqzaGFU55HRCADDift',
  'FHnt4NL7yPYDgRbra7urvXmGrX2H3nwwgRXvwTvbAV3hGPyUdGfeeggEBzUHUTP',
  'FHnt4NL7yPY1QHj9YKhZ8HGmRuSgscBXQwahnon7yNuCyCUhZZ9rY9zXygz1MAJ',
  'FHnt4NL7yPY18wUNczndRicxhvPnKcDz1rg9pR1RD8zaJb1U6j8Cui74RQEUyh9',
  'FHnt4NL7yPY2ApVptQRzcGkXcyThkLBAXmZKfQS9LBfaXoMUuYwV7NimZz3QB14',
];

/** First change address -- proves the role argument is not ignored. */
const MAINNET_INTERNAL_0 = 'Ae2tdPwUPEZHaYQnFQZjWhCiztzAuWjL56Cca3DcJQbATpZv7wEaQqdArJH';

beforeAll(async () => {
  await RustModule.load();
});

function external(network: 'mainnet' | 'preprod', count: number): string[] {
  const accountPublic = deriveByronAccountPublic(mnemonicToRootKey(WORDS), 0);
  return byronAddresses(accountPublic, {
    role: ROLE_EXTERNAL,
    count,
    protocolMagic: NETWORKS[network].byronProtocolMagic,
  });
}

test('first 10 external mainnet addresses match the extension', () => {
  expect(external('mainnet', 10)).toEqual(MAINNET_EXTERNAL_10);
});

test('first 10 external preprod addresses are stable', () => {
  expect(external('preprod', 10)).toEqual(PREPROD_EXTERNAL_10);
});

test('the internal chain derives different addresses', () => {
  const accountPublic = deriveByronAccountPublic(mnemonicToRootKey(WORDS), 0);
  const [internal0] = byronAddresses(accountPublic, {
    role: ROLE_INTERNAL,
    count: 1,
    protocolMagic: NETWORKS.mainnet.byronProtocolMagic,
  });
  expect(internal0).toEqual(MAINNET_INTERNAL_0);
  expect(internal0).not.toEqual(MAINNET_EXTERNAL_10[0]);
});

test('`from` offsets into the same chain', () => {
  const accountPublic = deriveByronAccountPublic(mnemonicToRootKey(WORDS), 0);
  const addresses = byronAddresses(accountPublic, {
    from: 7,
    count: 3,
    protocolMagic: NETWORKS.mainnet.byronProtocolMagic,
  });
  expect(addresses).toEqual(MAINNET_EXTERNAL_10.slice(7, 10));
});

test('a different account index derives different addresses', () => {
  const rootKey = mnemonicToRootKey(WORDS);
  const [account1First] = byronAddresses(deriveByronAccountPublic(rootKey, 1), {
    count: 1,
    protocolMagic: NETWORKS.mainnet.byronProtocolMagic,
  });
  expect(account1First).not.toEqual(MAINNET_EXTERNAL_10[0]);
});

test('count 0 returns nothing and negative input is rejected', () => {
  const accountPublic = deriveByronAccountPublic(mnemonicToRootKey(WORDS), 0);
  const magic = NETWORKS.mainnet.byronProtocolMagic;
  expect(byronAddresses(accountPublic, { count: 0, protocolMagic: magic })).toEqual([]);
  expect(() => byronAddresses(accountPublic, { count: -1, protocolMagic: magic })).toThrow('non-negative');
  expect(() => byronAddresses(accountPublic, { count: 1, from: -1, protocolMagic: magic })).toThrow('non-negative');
  expect(() => byronAddresses(accountPublic, { count: 1.5, protocolMagic: magic })).toThrow('integer');
});

test('byronAddressPath renders the BIP44 path', () => {
  expect(byronAddressPath(0, ROLE_EXTERNAL, 3)).toEqual("44'/1815'/0'/0/3");
  expect(byronAddressPath(2, ROLE_INTERNAL, 0)).toEqual("44'/1815'/2'/1/0");
});
