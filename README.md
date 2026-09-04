# YACOW

**Yet Another Cardano Only Wallet.**

A lightweight interactive terminal wallet for Cardano, built with [Ink](https://github.com/vadimdemedes/ink). Run `yacow` and navigate pages (Onboarding / Wallets / Dashboard / Send / Receive / Network) with arrow keys and single-key shortcuts — like Claude Code or lazygit.

> Status: app shell, wallet create/restore, keystore, network switching, the chain-data provider layer (Blockfrost / Koios) and the dashboard balance are in place, plus the `paper-addresses` tool below. Transactions, receive and send are still to come.

## Run

YACOW is a full-screen interactive app — run it in a **real terminal** (it needs a TTY; it will not work when piped or run from a non-interactive shell).

```bash
cd ~/yacow
bun install        # first time only
bun run start      # builds are cached in dist/; runs `node dist/cli.js`
```

Other ways to launch:

```bash
bun run dev        # rebuild (tsc) then run — use after changing source
bun run build && node dist/cli.js
```

Install it as a global `yacow` command (from this checkout):

```bash
bun link           # then, from anywhere:
yacow
```

**First run:** creates `~/.yacow/` (mode `0700`) for config and keystores, then asks you to connect a chain-data provider (see below) before anything else. Once that is set, you land on onboarding (no wallet yet). The active network defaults to **preprod**. Press `q` or `Ctrl-C` to quit.

## Chain data: Blockfrost or Koios

YACOW reads the chain through **[Blockfrost](https://blockfrost.io)** or **[Koios](https://koios.rest)** — pick one on first run and paste its key. (The Yoroi backend YACOW used to call is being shut down and is no longer supported.)

- **Blockfrost keys are per network.** A project id is scoped to one chain (`mainnet…` / `preprod…`), so YACOW holds both at once and switching network picks the right one with no re-prompting. Switching to a chain you have not set up yet offers to add a key for it, leaving the configured one alone.
- **Koios uses one account-wide token.** Its networks are separate hosts, but the token is issued per account and only sets your rate-limit tier, so you enter it once and it works on both chains. Koios also works with **no token at all** (anonymous tier, lower rate limit); Blockfrost does not.
- **Set a second provider as a fallback.** If the primary is rate-limited, down, or holding a key that stopped working, requests are served by the other one automatically, and the dashboard says which backend answered. A transaction submit is never re-sent through the fallback.
- Keys live in `~/.yacow/providers.json` (mode `0600`) and are always shown masked. `YACOW_BLOCKFROST_PROJECT_ID`, `YACOW_KOIOS_TOKEN` and `YACOW_PROVIDER_PRIMARY` override the stored values for the active network and are never written to disk.

Press `,` at any time for **Settings**, which shows every key as a masked cell — Blockfrost per network, Koios as one "All networks" entry — and lets you add, replace or remove a single key, swap primary and fallback, or test the connection.

Prefer not to build? `bun run smoke` prints the rendered screens non-interactively (used by the tests).

## Tools (non-interactive commands)

`yacow <command>` runs a one-shot tool instead of the full-screen app, so it works over pipes, in scripts and over SSH. `yacow --help` lists the commands.

### `paper-addresses` — Byron addresses of a Yoroi paper wallet

Recovers the first Byron (base58, `Ae2…` / `FHnt…`) receive addresses of a **Yoroi paper wallet** (the 21-word phrase + paper password printed on the paper), so you can look up what is still sitting on it — in an explorer, or with any other tool — without importing it into a wallet.

Read-only: nothing is written to disk, and no keystore is created or touched.

```bash
yacow paper-addresses                          # prompts, 10 mainnet addresses
yacow paper-addresses --count 20               # more addresses
yacow paper-addresses --network preprod        # testnet encoding
yacow paper-addresses --json                   # machine-readable
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `-n, --network <name>` | `mainnet` | `mainnet` or `preprod`. Paper wallets are mainnet-era; the same keys just encode differently per network. |
| `-c, --count <n>` | `10` | How many addresses (1–100). |
| `-a, --account <n>` | `0` | BIP44 account index (`44'/1815'/<n>'`). |
| `--json` | off | Print JSON on stdout instead of a table. |
| `--phrase-file <path>` | — | Read phrase (line 1) and paper password (line 2) from a file. |
| `--stdin` | — | Read phrase (line 1) and paper password (line 2) from stdin. |

The phrase and password are **never** taken as command-line flags — argv is visible to `ps` and lands in shell history. Interactively, the phrase is echoed (typing 21 words blind is unusable) and the password is masked; use `--stdin` or `--phrase-file` to keep both out of the terminal scrollback. The recovered 15-word phrase is never printed.

Prompts, warnings and errors go to **stderr**; the result goes to **stdout**, so `--json` pipes cleanly:

```bash
printf '%s\n%s\n' "$PAPER_PHRASE" "$PAPER_PASSWORD" \
  | yacow paper-addresses --stdin --json --count 5 \
  | jq -r '.addresses[].address'
```

**A wrong paper password does not fail.** Unscrambling succeeds with any password and hands back a different (empty) wallet, so the addresses will look perfectly valid. The command prints the wallet's CIP4 plate (e.g. `PDED-7795`) for exactly this reason — it is the same plate Yoroi shows when restoring that paper wallet, so compare the two before trusting the addresses.

Addresses follow `44'/1815'/account'/0/i` (external chain). Change addresses (`…/1/i`) are not printed.

## Develop

```bash
bun install
bun run build      # tsc -> dist/
bun run start      # run the built CLI
bun run test       # jest (engine tests)
bun run smoke      # build + pure-node Ink render smoke
bun run smoke:cli  # build + subcommand end-to-end checks (spawns dist/cli.js)
bun run test:all   # all three
```

## Layout

- `src/config/` — network definitions (mainnet / preprod), app settings, provider credentials
- `src/crypto/` — CSL (WASM) loader; mnemonic, CIP1852 + Byron derivation, plate, paper wallets
- `src/net/` — the provider layer (`provider/`: Blockfrost + Koios adapters behind one `ChainProvider`, with failover), address discovery, protocol parameters
- `src/security/` — password strength, secret buffers, file permissions
- `src/wallet/` — keystore, balance, history (M3), tx building (M5)
- `src/commands/` — non-interactive subcommands (see Tools above)
- `src/pages/`, `src/components/`, `src/state/` — the Ink UI

Engine modules (`config/ crypto/ net/ security/ wallet/`) are UI-independent and unit-tested with Jest; pages/components are tested with `ink-testing-library`.

## Shortcuts

`↑↓` move · `Enter` confirm · `Esc` back · `m` main · `s` send · `r` receive · `w` wallets · `n` network · `,` settings · `R` refresh · `q` quit
