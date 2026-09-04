// `yacow paper-addresses` -- derive the first Byron (base58) receive addresses
// of a Yoroi paper wallet, so funds left on a paper wallet can be located
// without importing it anywhere.
//
// Read-only: nothing is written to disk and no keystore is touched.
//
// Secrets: the paper phrase and password are never accepted as CLI flags (argv
// is visible in `ps` and in shell history) -- they come from a TTY prompt,
// stdin, or a file. Buffers are wiped by the crypto layer; the unscrambled
// phrase exists only as a short-lived string (JS strings cannot be wiped) and
// is never printed or logged.
import { promises as fs } from 'node:fs';
import { getNetwork, isNetworkName, type NetworkName } from '../config/networks.js';
import { mnemonicToRootKey } from '../crypto/mnemonic.js';
import { plateFromRootKey } from '../crypto/plate.js';
import { PAPER_WORD_COUNT, unscramblePaperMnemonic } from '../crypto/paperWallet.js';
import { byronAddressPath, byronAddresses, deriveByronAccountPublic } from '../crypto/byron.js';
import { ROLE_EXTERNAL } from '../crypto/derive.js';
import { isInteractive, promptHidden, promptLine, readAllStdin } from './prompt.js';

export const DEFAULT_COUNT = 10;
export const MAX_COUNT = 100;
/** Paper wallets are a mainnet-era feature, so mainnet is the default here. */
export const DEFAULT_PAPER_NETWORK: NetworkName = 'mainnet';

/** A user mistake (bad flag, malformed input) rather than an internal failure. */
export class UsageError extends Error {}

/** Options exactly as commander hands them over (all strings/booleans). */
export interface RawPaperAddressesOptions {
  network?: string;
  count?: string;
  account?: string;
  json?: boolean;
  phraseFile?: string;
  stdin?: boolean;
}

export interface PaperAddressesOptions {
  network: NetworkName;
  count: number;
  account: number;
  json: boolean;
  phraseFile: string | null;
  stdin: boolean;
}

export interface DerivedAddress {
  index: number;
  role: number;
  path: string;
  address: string;
}

export interface PaperAddressesResult {
  network: NetworkName;
  account: number;
  /** CIP4 plate of the recovered wallet -- the extension shows the same one. */
  plate: string;
  addresses: DerivedAddress[];
}

function parseIntegerOption(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new UsageError(`--${name} must be a non-negative integer, got "${value}".`);
  }
  return Number.parseInt(value.trim(), 10);
}

export function resolvePaperAddressesOptions(raw: RawPaperAddressesOptions): PaperAddressesOptions {
  const networkName = (raw.network ?? DEFAULT_PAPER_NETWORK).trim();
  if (!isNetworkName(networkName)) {
    throw new UsageError(`--network must be "mainnet" or "preprod", got "${raw.network ?? ''}".`);
  }

  const count = parseIntegerOption(raw.count, 'count', DEFAULT_COUNT);
  if (count < 1 || count > MAX_COUNT) {
    throw new UsageError(`--count must be between 1 and ${MAX_COUNT}, got ${count}.`);
  }

  const account = parseIntegerOption(raw.account, 'account', 0);

  if (raw.stdin === true && raw.phraseFile !== undefined) {
    throw new UsageError('Use either --stdin or --phrase-file, not both.');
  }

  return {
    network: networkName,
    count,
    account,
    json: raw.json === true,
    phraseFile: raw.phraseFile ?? null,
    stdin: raw.stdin === true,
  };
}

export interface PaperAddressesInput {
  phrase: string;
  password: string;
  network: NetworkName;
  account: number;
  count: number;
}

/** Paper phrase + password -> the wallet's first external Byron addresses. */
export function paperAddresses(input: PaperAddressesInput): PaperAddressesResult {
  const mnemonic = unscramblePaperMnemonic(input.phrase, input.password);
  const rootKey = mnemonicToRootKey(mnemonic);
  const { byronProtocolMagic } = getNetwork(input.network);

  const addresses = byronAddresses(deriveByronAccountPublic(rootKey, input.account), {
    role: ROLE_EXTERNAL,
    count: input.count,
    protocolMagic: byronProtocolMagic,
  }).map((address, index) => ({
    index,
    role: ROLE_EXTERNAL,
    path: byronAddressPath(input.account, ROLE_EXTERNAL, index),
    address,
  }));

  return {
    network: input.network,
    account: input.account,
    plate: plateFromRootKey(rootKey, input.account).textPart,
    addresses,
  };
}

export function formatPaperAddresses(result: PaperAddressesResult, json: boolean): string {
  if (json) {
    return JSON.stringify(result, null, 2);
  }
  const header = [
    `network: ${result.network}   account: ${result.account}   path: 44'/1815'/${result.account}'/${ROLE_EXTERNAL}/i`,
    `plate:   ${result.plate}`,
    '',
  ];
  const rows = result.addresses.map(a => `${String(a.index).padStart(3)}  ${a.address}`);
  return [...header, ...rows].join('\n');
}

/**
 * Split two-line secret input: line 1 = paper phrase, line 2 = paper password.
 * The password may legitimately be an empty line, so only the phrase is required.
 */
export function splitSecretInput(text: string): { phrase: string; password: string | null } {
  const lines = text.split(/\r?\n/);
  const phrase = (lines[0] ?? '').trim();
  if (phrase === '') {
    throw new UsageError('Expected the 21-word paper phrase on the first line.');
  }
  return { phrase, password: lines.length > 1 ? lines[1] : null };
}

async function readSecrets(opts: PaperAddressesOptions): Promise<{ phrase: string; password: string }> {
  if (opts.stdin) {
    const { phrase, password } = splitSecretInput(await readAllStdin());
    if (password === null) {
      throw new UsageError('Expected the paper password on the second line of stdin.');
    }
    return { phrase, password };
  }

  if (opts.phraseFile !== null) {
    const { phrase, password } = splitSecretInput(await fs.readFile(opts.phraseFile, 'utf8'));
    if (password !== null) {
      return { phrase, password };
    }
    if (!isInteractive()) {
      throw new UsageError(`${opts.phraseFile} has no password on its second line, and there is no TTY to ask for one.`);
    }
    return { phrase, password: await promptHidden('Paper password: ') };
  }

  if (!isInteractive()) {
    throw new UsageError('No TTY available; pass the phrase and password via --stdin or --phrase-file.');
  }

  // The phrase is echoed: typing 21 words blind is unusable, and the extension
  // shows them too. `--stdin`/`--phrase-file` keep them out of the scrollback.
  process.stderr.write(`Enter your ${PAPER_WORD_COUNT}-word Yoroi paper wallet phrase (it will be visible).\n`);
  const phrase = await promptLine('Paper phrase: ');
  const password = await promptHidden('Paper password: ');
  return { phrase, password };
}

const WRONG_PASSWORD_NOTE =
  'Note: a wrong paper password still produces valid-looking addresses (of a different, empty wallet).\n' +
  'Cross-check the plate above against the one Yoroi shows when restoring the same paper wallet.\n';

export async function runPaperAddresses(raw: RawPaperAddressesOptions): Promise<void> {
  const opts = resolvePaperAddressesOptions(raw);
  const { phrase, password } = await readSecrets(opts);
  const result = paperAddresses({
    phrase,
    password,
    network: opts.network,
    account: opts.account,
    count: opts.count,
  });
  process.stdout.write(`${formatPaperAddresses(result, opts.json)}\n`);
  process.stderr.write(`\n${WRONG_PASSWORD_NOTE}`);
}
