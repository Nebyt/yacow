# YACOW

**Yet Another Cardano Only Wallet.**

A lightweight interactive terminal wallet for Cardano. The locked UI stack is [OpenTUI](https://github.com/anomalyco/opentui) (`@opentui/react`); the current tree still runs on Ink until that migration. Run `yacow` and navigate pages (Onboarding / Wallets / Dashboard / Send / Receive / Network / Settings) with arrow keys and single-key shortcuts — like Claude Code, lazygit or OpenCode.

> Status: app shell, wallet create/restore, keystore, network switching, Blockfrost / Koios provider layer, dashboard **balance + stake address + pool delegation**, and **Receive** (address + QR + clipboard copy) are in place. Transactions list and send are still to come. There is **no** paper-wallet tool.

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

## Develop

```bash
bun install
bun run build      # tsc -> dist/
bun run start      # run the built CLI
bun run test       # jest (engine tests)
bun run smoke      # build + UI render smoke
bun run test:all      # jest + smoke
bun run format        # Prettier write (decision 2.7)
bun run format:check  # Prettier check, no writes
```

## Layout

- `src/config/` — network definitions (mainnet / preprod), app settings, provider credentials
- `src/crypto/` — CSL (WASM) loader; mnemonic, CIP1852 derivation, plate
- `src/net/` — the provider layer (`provider/`: Blockfrost + Koios adapters behind one `ChainProvider`, with failover), address discovery, protocol parameters
- `src/security/` — password strength, secret buffers, file permissions
- `src/wallet/` — keystore, balance; history (M3) and tx building (M5) still planned
- `src/pages/`, `src/components/`, `src/state/` — the TUI (Ink today; OpenTUI per decision 2.1)

Engine modules (`config/ crypto/ net/ security/ wallet/`) are UI-independent and unit-tested with Jest; pages/components are covered by the render smoke while the Ink tree remains.

## Shortcuts

`↑↓` move · `Enter` confirm (on Receive: copy address) · `Esc` back · `m` main · `s` send · `r` receive · `w` wallets · `n` network · `,` settings · `R` refresh · `q` quit
