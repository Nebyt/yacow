// Golden vector taken from yoroi-extension
// app/api/ada/lib/cardanoCrypto/paperWallet.test.js, so a dependency bump that
// changes unscrambling fails here loudly.
import * as bip39 from 'bip39';
import {
  PAPER_WORD_COUNT,
  isValidPaperMnemonic,
  normalizePhrase,
  unscramblePaperMnemonic,
} from './paperWallet.js';

const PAPER = {
  scrambled:
    'air comic label visual scale twist sell build ankle copy expect rocket crystal allow tissue eager jaguar crouch million cushion beach',
  password: 'testpasswordtest',
  words: 'business sight another write gadget near where hollow insane dynamic grain hurt slim clip require',
};

// Same 21 words but with a broken checksum (last word repeated).
const BAD_CHECKSUM =
  'air comic label visual scale twist sell build ankle copy expect rocket crystal allow tissue eager jaguar crouch million cushion cushion';

test('unscrambles the golden paper wallet', () => {
  expect(unscramblePaperMnemonic(PAPER.scrambled, PAPER.password)).toEqual(PAPER.words);
});

test('tolerates sloppy whitespace in the pasted phrase', () => {
  const messy = `  ${PAPER.scrambled.replace(/ /g, '\n  ')}\n`;
  expect(unscramblePaperMnemonic(messy, PAPER.password)).toEqual(PAPER.words);
  expect(normalizePhrase(messy)).toEqual(PAPER.scrambled);
});

test('rejects a phrase that is not 21 words', () => {
  const words = PAPER.scrambled.split(' ');
  expect(() => unscramblePaperMnemonic(words.slice(0, 20).join(' '), PAPER.password)).toThrow(
    `has ${PAPER_WORD_COUNT} words, got 20`,
  );
  expect(() => unscramblePaperMnemonic(`${PAPER.scrambled} beach`, PAPER.password)).toThrow('got 22');
  expect(() => unscramblePaperMnemonic('', PAPER.password)).toThrow('got 0');
});

test('rejects a phrase with a bad checksum or an unknown word', () => {
  expect(() => unscramblePaperMnemonic(BAD_CHECKSUM, PAPER.password)).toThrow('bad checksum');
  const unknownWord = PAPER.scrambled.replace('comic', 'zzzz');
  expect(() => unscramblePaperMnemonic(unknownWord, PAPER.password)).toThrow('bad checksum');
});

// This is the tool's central hazard: unscrambling cannot detect a wrong
// password, it just hands back a different wallet. Locked in a test so the
// behaviour is never mistaken for a bug (see WRONG_PASSWORD_NOTE in the command).
test('a wrong password yields a different, still-valid recovery phrase', () => {
  const other = unscramblePaperMnemonic(PAPER.scrambled, 'not-the-password');
  expect(other).not.toEqual(PAPER.words);
  expect(other.split(' ')).toHaveLength(15);
  expect(bip39.validateMnemonic(other)).toBe(true);
});

test('isValidPaperMnemonic checks the paper phrase shape only', () => {
  expect(isValidPaperMnemonic(PAPER.scrambled)).toBe(true);
  // Valid regardless of password, because the password cannot be verified.
  expect(isValidPaperMnemonic(BAD_CHECKSUM)).toBe(false);
  expect(isValidPaperMnemonic(PAPER.words)).toBe(false); // 15 words, not a paper phrase
  expect(isValidPaperMnemonic('')).toBe(false);
});
