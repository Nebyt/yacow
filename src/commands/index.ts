// Non-interactive subcommands of the `yacow` binary.
//
// `yacow` with no arguments (or only flags) starts the Ink TUI; a leading
// non-flag argument is treated as a subcommand and handled here, so scripted
// use never mounts a full-screen app.
import { Command } from 'commander';
import { DEFAULT_COUNT, DEFAULT_PAPER_NETWORK, MAX_COUNT, runPaperAddresses } from './paperAddresses.js';

/** `-h`/`--help` list the commands instead of starting the TUI. */
const HELP_FLAGS = new Set(['-h', '--help']);

export function looksLikeCommand(argv: string[]): boolean {
  const first = argv[0];
  if (first === undefined) return false;
  return !first.startsWith('-') || HELP_FLAGS.has(first);
}

export async function runCommand(argv: string[]): Promise<void> {
  const program = new Command();
  program.name('yacow').description('YACOW -- Yet Another Cardano Only Wallet. Run without arguments for the interactive app.');

  program
    .command('paper-addresses')
    .description('Derive the first Byron addresses of a Yoroi paper wallet (read-only)')
    .option('-n, --network <name>', 'mainnet or preprod', DEFAULT_PAPER_NETWORK)
    .option('-c, --count <n>', `how many addresses to print (1-${MAX_COUNT})`, String(DEFAULT_COUNT))
    .option('-a, --account <n>', "BIP44 account index (44'/1815'/<n>')", '0')
    .option('--json', 'print the result as JSON')
    .option('--phrase-file <path>', 'read phrase (line 1) and password (line 2) from a file')
    .option('--stdin', 'read phrase (line 1) and password (line 2) from stdin')
    .action(runPaperAddresses);

  await program.parseAsync(argv, { from: 'user' });
}
