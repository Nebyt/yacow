# YACOW

**Yet Another Cardano Only Wallet.**

A lightweight interactive terminal wallet for Cardano. The TUI is [OpenTUI](https://github.com/anomalyco/opentui) (`@opentui/react`). Run `yacow` and navigate pages (Onboarding / Wallets / Dashboard / Send / Receive / Network / Settings) with arrow keys and single-key shortcuts — like Claude Code, lazygit or OpenCode.

> Status: app shell, wallet create/restore, keystore, network switching, Blockfrost / Koios provider layer, dashboard **balance + stake address + pool delegation**, and **Receive** (address + QR + clipboard copy) are in place. Transactions list and send are still to come. There is **no** paper-wallet tool.

## Run

YACOW is a full-screen interactive app — run it in a **real terminal** (it needs a TTY; it will not work when piped or run from a non-interactive shell).

```bash
cd ~/yacow
bun install        # first time only
bun run start      # bun src/cli.tsx (needs Bun 1.3+)
```

Other ways to launch:

```bash
bun run dev        # same as start
bun src/cli.tsx
```

Install it as a global `yacow` command (from this checkout):

```bash
bun link           # then, from anywhere:
yacow
```

**First run:** creates `~/.yacow/` (mode `0700`) for config and keystores, then asks you to connect a chain-data provider (see below) before anything else. Once that is set, you land on onboarding (no wallet yet). The active network defaults to **preprod**. Press `q` or `Ctrl-C` to quit.

## Chain data: Blockfrost or Koios

YACOW reads the chain through **[Blockfrost](https://blockfrost.io)** or **[Koios](https://koios.rest)** — pick one on first run and paste its key.

- **Blockfrost keys are per network.** A project id is scoped to one chain (`mainnet…` / `preprod…`), so YACOW holds both at once and switching network picks the right one with no re-prompting. Switching to a chain you have not set up yet offers to add a key for it, leaving the configured one alone.
- **Koios uses one account-wide token.** Its networks are separate hosts, but the token is issued per account and only sets your rate-limit tier, so you enter it once and it works on both chains. Koios also works with **no token at all** (anonymous tier, lower rate limit); Blockfrost does not.
- **Set a second provider as a fallback.** If the primary is rate-limited, down, or holding a key that stopped working, requests are served by the other one automatically, and the dashboard says which backend answered. A transaction submit is never re-sent through the fallback.
- Keys live in `~/.yacow/providers.json` (mode `0600`) and are always shown masked. `YACOW_BLOCKFROST_PROJECT_ID`, `YACOW_KOIOS_TOKEN` and `YACOW_PROVIDER_PRIMARY` override the stored values for the active network and are never written to disk.

Press `,` at any time for **Settings**, which shows every key as a masked cell — Blockfrost per network, Koios as one "All networks" entry — and lets you add, replace or remove a single key, swap primary and fallback, or test the connection.

### How the dashboard reads your wallet

Every address YACOW derives shares one staking credential, so the balance is read **once per account** through the wallet's reward address instead of once per address (decision 4.12). On Blockfrost that is three requests — the used-address list, the account totals and the token totals — where the old per-address scan cost 67 requests and 7.5 seconds on a wallet holding six tokens; the same wallet now loads in about one second. Koios answers the account totals in two requests and keeps a batched per-address scan for the address list, because its `account_addresses` endpoint lists only the addresses that currently hold funds, which is not enough to find the next unused receive address.

Only the **spendable** figure is shown: rewards that have not been withdrawn are not part of the balance.

Prefer not to build? `bun run smoke` prints the rendered screens non-interactively (used by the tests).

## Develop

```bash
bun install
bun run typecheck  # tsc --noEmit
bun run start      # OpenTUI app via bun
bun run test       # jest (engine tests)
bun run smoke      # OpenTUI test renderer
bun run test:all   # jest + smoke
bun run format        # Prettier write (decision 2.7)
bun run format:check  # Prettier check, no writes
```

## Layout

- `src/config/` — network definitions (mainnet / preprod), app settings, provider credentials
- `src/crypto/` — CSL (WASM) loader; mnemonic, CIP1852 derivation, plate
- `src/net/` — the provider layer (`provider/`: Blockfrost + Koios adapters behind one `ChainProvider`, with failover), address discovery (account lookup with a per-address scan fallback), protocol parameters
- `src/security/` — password strength, secret buffers, file permissions
- `src/wallet/` — keystore, balance; history (M3) and tx building (M5) still planned
- `src/pages/`, `src/components/`, `src/state/` — the OpenTUI app

Engine modules (`config/ crypto/ net/ security/ wallet/`) are UI-independent and unit-tested with Jest; pages/components are covered by `bun run smoke` (`@opentui/react/test-utils`).

## Shortcuts

`↑↓` move · `Enter` confirm (on Receive: copy address) · `Esc` back · `m` main · `s` send · `r` receive · `w` wallets · `n` network · `,` settings · `R` refresh · `q` quit

## License

**GNU Affero General Public License v3.0 or later** — `AGPL-3.0-or-later`. The full text is in [LICENSE](LICENSE).

Copyright (C) 2026 Nebyt.

You are free to use, study, share and modify YACOW — **including commercially**. What the AGPL asks in return is that if you distribute it, or run a modified version as a network service, you offer the corresponding source to those users under the same license. Section 13 is the one that covers the network case.

> **No warranty.** YACOW is early-stage software that handles real keys and real funds. It ships with no warranty of any kind. Read the source, test on preprod, and do not point it at funds you cannot afford to lose.
