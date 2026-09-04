# YACOW — Decisions Register

Every locked decision made in this project, extracted from the context log (`_context.md`,
canonical copy in ClaudeVault `YACOW-Cardano-Wallet-TUI/context.md`) and from session memory.

**Read this file before implementing anything.** If a change contradicts a decision here,
stop and confirm with the user first, then update this file in the same change.

Format: each decision has a rationale ("Why") and an operational consequence ("Apply").
Last updated: 2026-09-04.

---

## 1. Product scope

| # | Decision | Why | Apply |
|---|---|---|---|
| 1.1 | Base ops only in v1: network switch, create/restore wallet, balance, 5 latest transactions, receive (address + QR), send (ADA + native tokens). | Lightweight terminal wallet, not a Yoroi clone. | Do not add features outside this list without asking. |
| 1.2 | Native-token sends are IN v1. | User decision. | Send flow needs an asset selector, min-ADA per output, multi-asset change. |
| 1.3 | Hardware wallets (Ledger/Trezor) are OUT of scope. | Keeps the transport layer to software keys only. | Never add HW branches to sign/derive paths. |
| 1.4 | Single account `0'`, one active wallet at a time, `w` switches wallets. | Simplicity; multi-account is a later milestone at best. | Derivation paths hardcode account 0 unless a flag exists. |
| 1.5 | Networks supported: mainnet + preprod only. | Matches the extension's prepackaged networks that matter. | `NetworkName = 'mainnet' | 'preprod'`; do not add preview/sanchonet silently. |
| 1.6 | Default network for the TUI is **preprod**; default for the `paper-addresses` CLI tool is **mainnet**. | TUI is for experimenting; paper wallets are mainnet-era artefacts. | Keep the two defaults deliberately different. |

## 2. Stack & tooling

| # | Decision | Why | Apply |
|---|---|---|---|
| 2.1 | TypeScript, ESM (`NodeNext`), Ink 5 (React for terminal), Node >= 18. | Chosen at M0. | No CJS modules in `src/`; import specifiers carry `.js`. |
| 2.2 | Package manager is **bun** (`bun.lock`), not npm. | Switched at extraction (2026-09-04). | Use `bun run ...` / `bunx`; do not create `package-lock.json`. |
| 2.3 | Transaction building uses `@emurgo/yoroi-eutxo-txs`. | Reuses the extension's coin selection instead of hand-rolling. | Planned for M5; do not write a custom selector. |
| 2.4 | WASM versions pinned exactly: `@emurgo/cardano-serialization-lib-nodejs@14.1.2`, `cardano-wallet@1.2.2`, `@emurgo/cip4-js@^1.0.5`. | Address/plate golden vectors are version-locked. | Never bump these without re-running golden-vector tests. |
| 2.5 | `cardano-wallet@1.2.2` (legacy WalletV2 WASM, CommonJS) is loaded **lazily** via `createRequire(import.meta.url)`, only for paper-wallet unscrambling. | The TUI must not pay the load cost of a legacy WASM blob. | Never import it at module top level. |
| 2.6 | Ported from `yoroi-extension` crypto/net cores only. `lib/storage` (lovefield), MobX stores, `rustLoader` browser imports and the webpack `CONFIG` global are NOT reused. | Browser-coupled, useless in a CLI. | Port logic by hand; keep the attribution comments naming source files. |

## 3. Wallet & security model

| # | Decision | Why | Apply |
|---|---|---|---|
| 3.1 | The keystore encrypts the **root private key**; the recovery phrase is never persisted. | Phrase on disk is the worst failure mode. | `wallets/<name>.json` = `{name, accountPubKey, plate, cipher, kdf}`. |
| 3.2 | AES-256-GCM over scrypt(N=2^17, r=8, p=1); KDF params stored in the file. | Slow KDF vs a stolen keystore file. | Wrong password must fail on the GCM tag, never silently. |
| 3.3 | `accountPubKey` and `plate` are stored in clear. | Read-only ops (balance, history, receive) must not prompt for a password. | Only **Send** decrypts; never cache the decrypted key. |
| 3.4 | File permissions: `~/.yacow` dir 0700, files 0600, atomic temp+rename, startup verification refuses group/world-readable files. | Local-attacker hardening. | All writes go through `security/fsPerms.ts` (`writeSecureFile`, `ensureSecureDir`). |
| 3.5 | Secret bytes live in `Buffer`, never `string`, and are zeroed in a `finally` (`security/secretBuffer.ts`). | Shrinks the in-memory exposure window. | Use `withSecret`/`withSecretSync`; wipe on throw too. |
| 3.6 | Threat model: protects a *stolen keystore file* and shrinks in-memory exposure. It does NOT protect against malware/keyloggers on an unlocked machine. | Stated honestly to the user. | Do not advertise stronger guarantees in UI or docs. |
| 3.7 | Password policy: zxcvbn score >= 3 **and** length >= 10. | Cheap, meaningful strength gate. | `security/password.ts` is the single source of truth. |
| 3.8 | Wallets are **network-agnostic**: no `network` field in the keystore. Root key, account pubkey and CIP4 plate are network-independent; the active network is a global setting (`config/settings.ts` -> `~/.yacow/config.json`). | Same wallet works on both networks; switching keeps the active wallet and only re-derives addresses/balance. | Never re-add a per-wallet network field. Header shows the global network. |
| 3.9 | Secrets are never passed in `argv`. | `ps` / shell history leak. | Accept secrets via TTY prompt, `--stdin`, or `--phrase-file`. |
| 3.10 | Wallet names are capped at 20 characters, enforced in both UI and engine (`sanitizeName`). | Long names break the terminal layout. | Validate in both layers, not just the field. |

## 4. Backend / data providers

| # | Decision | Why | Apply |
|---|---|---|---|
| 4.1 | **The Yoroi backend is forbidden** (`api.yoroiwallet.com`, `preprod-backend.yoroiwallet.com`) — it is being shut down. Replacement: **Blockfrost** and **Koios**. | Decided 2026-09-04. Supersedes the original M2 plan that called those endpoints directly. | No new code may call a `yoroiwallet.com` URL; `backendUrl` is removed from `config/networks.ts`. |
| 4.2 | Chain access goes through one provider-agnostic interface (`ChainProvider`); Blockfrost and Koios are adapters behind it. | Feature code must not know which backend is live. | Domain code (`wallet/`, pages) calls the provider, never `fetch` directly. |
| 4.3 | The user configures a **primary** provider and an optional **secondary**; the secondary is a fallback used when the primary is unavailable or rate-limited. | User requirement. | Failover is automatic and transparent; the UI shows which provider served the data. |
| 4.4 | Provider credentials are entered once and stored in user settings (`~/.yacow/providers.json`, 0600), never asked per request; env overrides `YACOW_BLOCKFROST_PROJECT_ID` / `YACOW_KOIOS_TOKEN` are supported. | User requirement: "the client should just request balance". | Keys are masked in all output and never logged. |
| 4.5 | Provider setup is a **gate**: with no usable provider configured, the app routes to the setup screen before any other action. | Nothing works without chain access. | The gate runs after the keystore check, before onboarding/dashboard. |
| 4.6 | Protocol parameters are fetched from the provider, not hardcoded. | The hardcoded `SHELLEY_PROTOCOL` block in `networks.ts` was a placeholder tied to the Yoroi backend era; a fee change on chain would have silently made every built transaction wrong. | `net/protocolParams.ts`: `fetchProtocolParams` with a per-network 1h cache, plus `FALLBACK_PROTOCOL_PARAMS` for offline tests only. `config/networks.ts` carries no protocol block and no backend URL. |
| 4.8 | Each provider is stored the way its API actually scopes credentials: **Blockfrost holds one project id per network** (both configured at once), **Koios holds a single account-wide token**. Switching network picks the matching Blockfrost key automatically and never clears, overwrites or re-prompts for the other network's key. | User requirement (2026-09-04): a network-agnostic wallet (3.8) crosses chains constantly and must not re-enter a key each time. Revised the same day after checking the Koios docs: its networks are separate hosts, but the JWT is issued per account on the Koios profile page and only sets the rate-limit tier — all three network specs in `cardano-community/koios-artifacts` carry an identical, network-agnostic security scheme. Asking for it twice would ask the user to paste one string into two boxes. | `ProviderSettings.keys` is `{blockfrost: {mainnet, preprod}, koios: string \| null}`; `isPerNetworkProvider()` is the single source of truth for the difference, and `keyOf()` the only reader. The Settings grid renders Blockfrost per network and Koios as one "All networks" cell. The reader still accepts the older per-network Koios shape and collapses it. |
| 4.11 | Quitting cancels chain work immediately: one process-wide shutdown signal aborts in-flight requests, and every timer the network layer creates (retry backoff, rate-limiter waits, request timeouts) is `unref`'d. A cancelled request is neither retried nor failed over. | Found 2026-09-04: pressing `q` during a balance refresh left the app hanging -- Ink unmounted, but pending fetches and timers kept Node's event loop alive, so the process never exited and the terminal never came back. | `net/provider/shutdown.ts` owns the signal; `http.ts` links every request to it and raises `ProviderShutdownError`; `cli.tsx` aborts after `waitUntilExit()` and then exits explicitly, because keep-alive sockets can outlive the abort. |
| 4.10 | Every adapter shapes its requests to its backend's published limits: Blockfrost is client-side **rate limited** (token bucket, 8 req/s default under its 10 req/s free tier), Koios batches to a **byte budget** (5,120-byte body cap) rather than an item count. | Found live on 2026-09-04: a plain balance refresh failed on both providers at once -- Blockfrost HTTP 429 (5 concurrent requests is ~33/s), Koios HTTP 413 (50 addresses x 108 chars = 5,583 bytes). A concurrency cap bounds parallelism, not rate; an item count does not bound bytes. | `rateLimiter.ts` wraps every Blockfrost request; `chunkByBytes` builds every Koios batch. Both limits are constants at the top of their adapter, with the arithmetic in the comment. |
| 4.9 | When the newly selected network has no key for the active provider, the app does not fail silently and does not fall back to the other network's key — it shows a targeted prompt to add a key **for that network**, offering the fallback provider first if that one is configured for the network. | Switching to a chain you have not set up yet is normal, not an error state. | The gate (4.5) triggers per network, keeping the already-configured network working. |
| 4.7 | Address discovery uses BIP44 **gap limit 20** on both external (role 0) and internal (role 1) chains. **Amended (B12, §14, planned):** the gap limit still governs how far addresses are DERIVED locally to find the next unused one, but the network lookup becomes a single stake-address query instead of one request per address. | Standard, matches the extension. Amended because every YACOW address shares one staking credential, so one account lookup answers what 112 per-address requests answered in 13.1s (decision 4.10). | Batch where the provider supports it (Koios), throttle where it does not (Blockfrost). Keep the per-address scan as the fallback for providers that cannot answer by account. |

## 5. Testing

| # | Decision | Why | Apply |
|---|---|---|---|
| 5.1 | Two runners by layer: engine (`config/ crypto/ net/ security/ wallet/ commands/`) on **jest** (`bun run test`); Ink UI on a **node-native ESM smoke** script (`bun run smoke`) against the `dist/` build; CLI subcommands via `bun run smoke:cli` (spawns `dist/cli.js`). | Ink 5's `yoga-layout` is ESM-only (top-level await + `import.meta`) and cannot run under babel-jest's CJS. | `jest.config.cjs` `testMatch` is `**/*.test.ts` only; UI assertions live in `scripts/smoke*.mjs`. |
| 5.2 | Keystroke-driven UI flows are NOT automated. | `ink-testing-library`'s mock stdin does not reach Ink 5's `useInput` here (verified). | Mount pages via `initialRoute` and assert `lastFrame`; verify interactions manually or with a future node-pty e2e. |
| 5.3 | Network tests mock the HTTP boundary (undici `MockAgent`, `disableNetConnect`) with fixtures. | Deterministic, no real API keys in tests. | Never hit a real provider from jest. |
| 5.4 | Golden vectors are locks, not samples: plate `EHKL-5865` for mnemonic "abandon" x14 + "address"; paper vector 21w "air comic label ... cushion beach" + `testpasswordtest` -> plate `PDED-7795`. | A dependency bump that changes an address must fail loudly. | Never "fix" a golden test by editing the expectation. |
| 5.5 | Vitest is an accepted future option to unify runners, but would not fix the stdin limitation. | Recorded so it is not re-litigated as a fix for 5.2. | Migration is optional and post-v1. |

## 6. UX model

| # | Decision | Why | Apply |
|---|---|---|---|
| 6.1 | Full-screen interactive app (lazygit / Claude Code style): header + page body + footer hint bar. | Chosen at M0. | Pages: Onboarding, Wallets, Create, Restore, Main, Send, Receive, Network, Settings. |
| 6.2 | Arrow keys + Enter on every menu (`SelectInput`), single-letter shortcuts as an accelerator; the footer always renders. | Backlog #5. | New menus must be arrow-navigable, not letter-only. |
| 6.3 | Global shortcuts are suspended while a text field captures the keyboard — **except Esc**, which always leaves the flow. | Backlog #4: users were trapped in Create/Restore. | Handle Esc before the `capturing` guard. |
| 6.4 | During Create/Restore the footer shows only `esc back` / `q quit`. | Backlog #6: navigating away mid-flow abandons the generated phrase. | `hintsFor()` returns the minimal set for flow routes. |
| 6.5 | Footer hints use a composite `key:label` React key and drop the hint pointing at the current page. | Backlog #10: duplicate React key `r` (restore vs receive). | The smoke run fails on any duplicate-key `console.error`. |
| 6.6 | The recovery phrase is revealed in a fixed 3-column grid. | Backlog #1: readability. | Keep the alignment when changing the Create page. |
| 6.7 | Results go to **stdout**; prompts, notes, warnings and errors go to **stderr** in CLI subcommands. | `--json` must pipe cleanly into `jq`. | Applies to every future subcommand. |
| 6.8 | The interactive app runs in the terminal's **alternate screen buffer**: it takes the full screen on launch and the terminal returns to exactly its previous state on exit (scrollback and prompt untouched). Reference behaviour: the Claude Code CLI, vim, lazygit. | User decision 2026-09-04. A TUI that leaves its frames in the scrollback makes the shell unusable afterwards. | Enter on start, leave on EVERY exit path (quit, Ctrl-C, signal, uncaught error). Only the interactive app does this -- non-interactive subcommands (6.7) must stay pipeable and emit no escape sequences. |
| 6.9 | The app fills the terminal viewport: content from the top, footer pinned to the bottom, re-laid-out on resize. | Half-height output inside a full-screen buffer looks broken. | Layout reads the live terminal size rather than assuming 80x24. |

## 7. Paper wallets (`paper-addresses`)

| # | Decision | Why | Apply |
|---|---|---|---|
| 7.1 | Delivered as a non-interactive subcommand of the same binary, not a separate tool. | Reuses networks/plate/secret-buffer/test infra; one install. | New tools follow the same commander wiring in `src/commands/`. |
| 7.2 | Scope: external chain (role 0) only, mainnet + preprod, default 10 addresses, `--count` capped at 100. | Locked with the user. | `--role both` is a documented follow-up, not a silent addition. |
| 7.3 | The CIP4 plate and a wrong-password warning are **always** printed. | A wrong paper password never errors — it yields a valid 15-word phrase for a different, empty wallet. The plate is the only offline cross-check. | Never remove the warning; the only real detector is an on-chain used-address check (now via the provider layer). |
| 7.4 | Byron addresses are derived with CSL `ByronAddress.icarus_from_key`; no WalletV2 needed. | Byte-identical to the extension's `bootstrap_era_address` (verified). | Do not copy the extension's `bip44_chain(true)` for the external chain — that is an upstream bug; role 0 = external. |
| 7.5 | Daedalus 27-word paper wallets are out of scope. | Different scheme. | Reject, do not half-support. |

## 8. Naming & repo conventions

| # | Decision | Why | Apply |
|---|---|---|---|
| 8.1 | Project renamed YACOW ("Yet Another Cardano Only Wallet"): package, bin `yacow`, keystore `~/.yacow`, header, onboarding, README. | Branding-only rename at extraction from `yoroi-frontend`. | — |
| 8.2 | These "Yoroi" references deliberately STAY: the domain term "Yoroi paper wallet", and the `yoroi-extension` attribution comments in `src/crypto/*` and `src/config/networks.ts`. | Renaming them would be factually wrong. | Before `sed`-ing "yoroi", check whether the hit is branding or fact. (The backend URLs, previously in this list, are removed by decision 4.1.) |
| 8.3 | The implementation plan lives in `_context.md` (repo) with the canonical copy at `~/ClaudeVault/YACOW-Cardano-Wallet-TUI/context.md`. It is NOT referenced from the README. | User instruction. | Update both copies together. |
| 8.4 | No doc may contain literal ANSI escape sequences. | Bitdefender quarantines both as `Generic.CLIExploit` — confirmed kills of `PLAN.md` and `_yoroi_cli_plan.md` in repo and vault; it also ate `.claude/file-history`. | Describe escape codes in prose. |
| 8.5 | Git commits in this repo carry no `Co-Authored-By: Claude` trailer. | User's global rule. | — |
