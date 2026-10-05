# YACOW — Decisions Register

Every locked decision made in this project, extracted from the context log (`_context.md`,
canonical copy in ClaudeVault `YACOW-Cardano-Wallet-TUI/context.md`) and from session memory.

**Read this file before implementing anything.** If a change contradicts a decision here,
stop and confirm with the user first, then update this file in the same change.

Format: each decision has a rationale ("Why") and an operational consequence ("Apply").
Last updated: 2026-10-05.

---

## 1. Product scope

| # | Decision | Why | Apply |
|---|---|---|---|
| 1.1 | Base ops in v1: network switch, create/restore wallet, balance, **stake address + current pool delegation (read-only)**, 5 latest transactions, receive (address + QR), send (ADA + native tokens). | Lightweight terminal wallet. Stake display landed with the dashboard (2026-09-24); staking *actions* stay out — see 1.7. | Do not add features outside this list without asking. |
| 1.2 | Native-token sends are IN v1. | User decision. | Send flow needs an asset selector, min-ADA per output, multi-asset change. |
| 1.3 | Hardware wallets (Ledger/Trezor) are OUT of scope. | Keeps the transport layer to software keys only. | Never add HW branches to sign/derive paths. |
| 1.4 | Single account `0'`, one active wallet at a time, `w` switches wallets. | Simplicity; multi-account is a later milestone at best. | Derivation paths hardcode account 0 unless a flag exists. |
| 1.5 | Networks supported: mainnet + preprod only. | The two public networks that matter for a software wallet. | `NetworkName = 'mainnet' | 'preprod'`; do not add preview/sanchonet silently. |
| 1.6 | Default network for the TUI is **preprod**. | TUI is for experimenting. (The old `paper-addresses` default of mainnet died with the tool — §7 retired 2026-09-24.) | Do not silently change `DEFAULT_NETWORK`. |
| 1.7 | **No paper wallets.** The `paper-addresses` subcommand, Byron/Icarus derivation, WalletV2 unscramble, and `cardano-wallet` are out of the project. **No staking actions** in v1 (register, delegate, undelegate, withdraw rewards). | Paper tool was a one-off (T1) and was removed. Showing the stake key and pool is enough for v1. | Do not re-add `src/commands/`, `crypto/paperWallet.ts`, `crypto/byron.ts`, or `cardano-wallet`. Recoverable from git (`ff8f493`) if ever needed. |

## 2. Stack & tooling

| # | Decision | Why | Apply |
|---|---|---|---|
| 2.1 | TypeScript, ESM (`NodeNext`), **OpenTUI** (`@opentui/core` + `@opentui/react`) for the terminal UI; QR codes stay on the `qrcode` package (decision 6.10). React 19 stays as the view layer. The interactive app runs on **Bun 1.3+** (OpenTUI's native renderer). Engine tests still run on Node >= 18 via jest. | Replaces Ink (M12, 2026-09-24). OpenTUI is the library OpenCode ships; flexbox layout, selects, inputs. Its QR package was tried and dropped (6.10). Native Core needs Bun 1.3+ or Node 26.4+ with experimental FFI; YACOW launches with bun. | New UI is OpenTUI, not Ink. Do not add `ink` / `ink-*` APIs. No CJS modules in `src/`; import specifiers carry `.js`. `jsxImportSource` is `@opentui/react`. `bun run start` is `bun src/cli.tsx`. |
| 2.2 | Package manager is **bun** (`bun.lock`), not npm. | Switched at extraction (2026-09-04). | Use `bun run ...` / `bunx`; do not create `package-lock.json`. |
| 2.3 | Transaction building is **in-repo**, using only `@emurgo/cardano-serialization-lib-nodejs` (`TransactionBuilder`, coin selection, min-ADA, multi-asset change, signing). | No wallet-SDK tx helpers. CSL is the only Cardano serialization library allowed. | M5 lives in `wallet/tx.ts` + `crypto/sign.ts`. Do not add other Cardano tx/coin-selection packages. |
| 2.4 | WASM versions pinned exactly: `@emurgo/cardano-serialization-lib-nodejs@14.1.2`, `@emurgo/cip4-js@^1.0.5`. | Address/plate golden vectors are version-locked. (`cardano-wallet@1.2.2` was only for paper unscramble and is gone — retired 2.5.) | Never bump CSL/cip4 without re-running golden-vector tests. |
| 2.5 | **Retired (2026-09-24).** Legacy `cardano-wallet` WalletV2 WASM is not a dependency. | Paper wallets removed (1.7). | Do not re-add it. |
| 2.6 | Crypto and net cores are written in this repo against CSL, CIP-1852, CIP-4, and the provider APIs. Browser storage (lovefield), MobX stores, rustLoader, and a webpack `CONFIG` global are not used. | Browser-coupled, useless in a CLI. | Implement against specs and CSL; do not import another wallet's libraries. |
| 2.7 | **Prettier** is the formatter. Config in `.prettierrc.json`: 2 spaces, single quotes, semicolons, trailing commas `all`, print width 100, LF. JSX attributes stay double-quoted. | The tree mixed quotes and indent (e.g. `Delegation.tsx` vs the rest). One tool, one config. | `bun run format` writes; `bun run format:check` asserts. Do not restyle by hand. Markdown is ignored (tables in this file). |

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
| 4.1 | **Vendor wallet backends are forbidden.** Chain data is **Blockfrost** and **Koios** only. | Decided 2026-09-04. Supersedes the original M2 plan that called a hosted wallet API directly. | No new code may call a third-party wallet-hosted URL; `backendUrl` is removed from `config/networks.ts`. |
| 4.2 | Chain access goes through one provider-agnostic interface (`ChainProvider`); Blockfrost and Koios are adapters behind it. | Feature code must not know which backend is live. | Domain code (`wallet/`, pages) calls the provider, never `fetch` directly. |
| 4.3 | The user configures a **primary** provider and an optional **secondary**; the secondary is a fallback used when the primary is unavailable or rate-limited. | User requirement. | Failover is automatic and transparent; the UI shows which provider served the data. |
| 4.4 | Provider credentials are entered once and stored in user settings (`~/.yacow/providers.json`, 0600), never asked per request; env overrides `YACOW_BLOCKFROST_PROJECT_ID` / `YACOW_KOIOS_TOKEN` are supported. | User requirement: "the client should just request balance". | Keys are masked in all output and never logged. |
| 4.5 | Provider setup is a **gate**: with no usable provider configured, the app routes to the setup screen before any other action. | Nothing works without chain access. | The gate runs after the keystore check, before onboarding/dashboard. |
| 4.6 | Protocol parameters are fetched from the provider, not hardcoded. | The hardcoded `SHELLEY_PROTOCOL` block in `networks.ts` was a placeholder; a fee change on chain would have silently made every built transaction wrong. | `net/protocolParams.ts`: `fetchProtocolParams` with a per-network 1h cache, plus `FALLBACK_PROTOCOL_PARAMS` for offline tests only. `config/networks.ts` carries no protocol block and no backend URL. |
| 4.8 | Each provider is stored the way its API actually scopes credentials: **Blockfrost holds one project id per network** (both configured at once), **Koios holds a single account-wide token**. Switching network picks the matching Blockfrost key automatically and never clears, overwrites or re-prompts for the other network's key. | User requirement (2026-09-04): a network-agnostic wallet (3.8) crosses chains constantly and must not re-enter a key each time. Revised the same day after checking the Koios docs: its networks are separate hosts, but the JWT is issued per account on the Koios profile page and only sets the rate-limit tier — all three network specs in `cardano-community/koios-artifacts` carry an identical, network-agnostic security scheme. Asking for it twice would ask the user to paste one string into two boxes. | `ProviderSettings.keys` is `{blockfrost: {mainnet, preprod}, koios: string \| null}`; `isPerNetworkProvider()` is the single source of truth for the difference, and `keyOf()` the only reader. The Settings grid renders Blockfrost per network and Koios as one "All networks" cell. The reader still accepts the older per-network Koios shape and collapses it. |
| 4.11 | Quitting cancels chain work immediately: one process-wide shutdown signal aborts in-flight requests, and every timer the network layer creates (retry backoff, rate-limiter waits, request timeouts) is `unref`'d. A cancelled request is neither retried nor failed over. | Found 2026-09-04: pressing `q` during a balance refresh left the app hanging -- the TUI unmounted, but pending fetches and timers kept Node's event loop alive. | `net/provider/shutdown.ts` owns the signal; `http.ts` links every request to it and raises `ProviderShutdownError`; `cli.tsx` waits for OpenTUI `renderer.destroy`, then aborts in-flight requests and `process.exit`s, because keep-alive sockets can outlive the abort. |
| 4.10 | Every adapter shapes its requests to its backend's published limits: Blockfrost is client-side **rate limited** (token bucket, 8 req/s default under its 10 req/s free tier), Koios batches to a **byte budget** (5,120-byte body cap) rather than an item count. | Found live on 2026-09-04: a plain balance refresh failed on both providers at once -- Blockfrost HTTP 429 (5 concurrent requests is ~33/s), Koios HTTP 413 (50 addresses x 108 chars = 5,583 bytes). A concurrency cap bounds parallelism, not rate; an item count does not bound bytes. | `rateLimiter.ts` wraps every Blockfrost request; `chunkByBytes` builds every Koios batch. Both limits are constants at the top of their adapter, with the arithmetic in the comment. |
| 4.9 | When the newly selected network has no key for the active provider, the app does not fail silently and does not fall back to the other network's key — it shows a targeted prompt to add a key **for that network**, offering the fallback provider first if that one is configured for the network. | Switching to a chain you have not set up yet is normal, not an error state. | The gate (4.5) triggers per network, keeping the already-configured network working. |
| 4.7 | Address discovery uses BIP44 **gap limit 20** on both external (role 0) and internal (role 1) chains. **Amended (B12, done 2026-10-05):** the gap limit still governs how far addresses are DERIVED locally to find the next unused one, but the network lookup becomes a stake-address query where the provider supports one. | Standard BIP44 gap. Amended because every YACOW address shares one staking credential, so one account lookup answers what 67 per-address requests answered in 7.45s (decision 4.10), measured live on the preprod test wallet. | Both discovery paths run through one `walkChain()` helper in `net/discovery.ts`, so the gap rule and `nextUnused` cannot drift; a provider without an account address list (Koios) keeps the batched per-address scan. |
| 4.12 | Balances and address lists are read at **account level** through the wallet's reward address, via two OPTIONAL `ChainProvider` methods: `getAccountBalance` (both adapters) and `getAccountAddresses` (**Blockfrost only**). Spendable ADA is the UTxO figure: Blockfrost `controlled_amount - withdrawable_amount` (its `controlled_amount` includes unwithdrawn rewards — 5.6x over-statement measured live), Koios `account_info.utxo`. Koios's `account_addresses` is **never** used for discovery: it lists only addresses holding a UTxO right now (1 against Blockfrost's 170 for the same account), so a spent/change address would be invisible and the gap-limit walk could offer an already-used receive address. A missing or failed account lookup falls back to the per-address scan. | Measured live 2026-10-05 (§14.2): 67 requests / 7.45s -> 9 requests / 1.12s on Blockfrost, identical balance, used set and next-unused. The two providers are NOT interchangeable here, so the difference is pinned by a conformance test and by the method being optional. | Feature code must feature-detect (`provider.getAccountBalance != null`) and fall back; `fallback.ts` exposes the optional methods only when some backend implements them, because an empty answer is indistinguishable from a fresh wallet. Never add a `getAccountAddresses` to the Koios adapter. |

## 5. Testing

| # | Decision | Why | Apply |
|---|---|---|---|
| 5.1 | Engine (`config/ crypto/ net/ security/ wallet/`) on **jest** (`bun run test`). UI smoke is **`bun scripts/smoke.tsx`** using `@opentui/react/test-utils` `testRender` (in-memory OpenTUI renderer). There is **no** paper-wallet CLI smoke (retired with 1.7). | Jest still cannot load OpenTUI's native renderer. Ink and `ink-testing-library` are gone (M12). | `jest.config.cjs` `testMatch` is `**/*.test.ts` only. `test:all` is jest + UI smoke. |
| 5.2 | Keystroke-driven UI flows are NOT automated. | OpenTUI's `testRender` can drive `mockInput`, but v1 smoke still mounts pages via `initialRoute` and asserts the frame. | Until a node-pty e2e (M6): verify interactions manually (`bun run start`) or extend smoke with mock keys. |
| 5.3 | Network tests mock the HTTP boundary (undici `MockAgent`, `disableNetConnect`) with fixtures. | Deterministic, no real API keys in tests. | Never hit a real provider from jest. |
| 5.4 | Golden vectors are locks, not samples: plate `EHKL-5865` for mnemonic "abandon" x14 + "address" (and the matching Shelley address vectors in `crypto/derive.test.ts`). | A dependency bump that changes an address must fail loudly. The historical paper-wallet vector (`PDED-7795`) is retired with 1.7. | Never "fix" a golden test by editing the expectation. |
| 5.5 | Vitest is an accepted future option to unify runners, but would not fix the stdin limitation. | Recorded so it is not re-litigated as a fix for 5.2. | Migration is optional and post-v1. |

## 6. UX model

| # | Decision | Why | Apply |
|---|---|---|---|
| 6.1 | Full-screen interactive app (lazygit / Claude Code / OpenCode style): header + page body + footer hint bar. | Chosen at M0; renderer becomes OpenTUI (2.1). | Pages: Onboarding, Wallets, Create, Restore, Main (plate + balance + stake/delegation), Send, Receive, Network, Settings. |
| 6.2 | Arrow keys + Enter on every menu (`SelectInput`), single-letter shortcuts as an accelerator; the footer always renders. | Backlog #5. | New menus must be arrow-navigable, not letter-only. |
| 6.3 | Global shortcuts are suspended while a text field captures the keyboard — **except Esc**, which always leaves the flow. | Backlog #4: users were trapped in Create/Restore. | Handle Esc before the `capturing` guard. |
| 6.4 | During Create/Restore the footer shows only `esc back` / `q quit`. | Backlog #6: navigating away mid-flow abandons the generated phrase. | `hintsFor()` returns the minimal set for flow routes. |
| 6.5 | Footer hints use a composite `key:label` React key and drop the hint pointing at the current page. | Backlog #10: duplicate React key `r` (restore vs receive). | The smoke run fails on any duplicate-key `console.error`. |
| 6.6 | The recovery phrase is revealed in a fixed 3-column grid. | Backlog #1: readability. | Keep the alignment when changing the Create page. |
| 6.7 | Results go to **stdout**; prompts, notes, warnings and errors go to **stderr** in CLI subcommands. | `--json` must pipe cleanly into `jq`. | Applies to every future subcommand. |
| 6.8 | The interactive app runs in the terminal's **alternate screen buffer**: it takes the full screen on launch and the terminal returns to exactly its previous state on exit (scrollback and prompt untouched). Reference behaviour: the Claude Code CLI, vim, lazygit. | User decision 2026-09-04. A TUI that leaves its frames in the scrollback makes the shell unusable afterwards. OpenTUI's `createCliRenderer` defaults to `screenMode: "alternate-screen"`; M12 keeps that explicit. | Enter on start, leave on EVERY exit path (`renderer.destroy()`, Ctrl-C, signals). Only the interactive app does this -- non-interactive subcommands (6.7) must stay pipeable and emit no escape sequences. |
| 6.9 | The app fills the terminal viewport: content from the top, footer pinned to the bottom, re-laid-out on resize. | Half-height output inside a full-screen buffer looks broken. | Layout reads the live terminal size rather than assuming 80x24. |
| 6.10 | Receive shows the payment address, derivation path `m/1852'/1815'/0'/0/0`, and a terminal QR built from the `qrcode` package's matrix: **two cells per module**, black on white, 4-module quiet zone. **Enter** copies the address to the clipboard (OpenTUI host clipboard). | Implemented 2026-09-24 (M4). `@opentui/qrcode` draws one cell per module, which a terminal stretches 1:2 — the result did not scan, so M12's QR choice was reverted the same day to the pre-migration `qrcode` approach. Index 0 of the external chain is the address shown today — next-unused from discovery is a later refinement, not a silent change of this screen. | `pages/Receive.tsx` + `components/QrCode.tsx` + `components/qrMatrix.ts`; `copyReceiverAddress` in the store. Never render a QR module as a single cell. Colours are fixed black/white, not theme-aware — a scanner reads pixels. Do not prompt for a password on Receive (decision 3.3). |
| 6.12 | **No hardcoded white.** Anything that would otherwise use OpenTUI's default text colour takes `FG` from `components/theme.ts` (`RGBA.defaultForeground()`, emits SGR 39). Secondary text uses `MUTED`, selection uses `ACCENT`. Inputs go through `components/TextInput.tsx`, menus through `components/MenuSelect.tsx`; list rows are marked by colour, never a background fill. The text cursor is `ACCENT`, and `PasswordInput` draws its own caret. | OpenTUI defaults `<text>`, `<input>`/`<textarea>` text, `<select>` rows **and the text cursor** to a literal `#FFFFFF`, and `<select>` also fills a dark background. All of it is invisible or wrong on a light terminal theme — reported live 2026-09-24. | Never write `<input>` or a bare `<text>` that carries meaning; never reintroduce `#FFFFFF`. Colour only where the meaning is fixed (green ADA, red errors, the QR in 6.10). |
| 6.11 | The dashboard shows the wallet **stake/reward address** and **delegation status**: unregistered/not-delegating is just the stake address; when `getAccountState` reports a pool, show the pool id and `getPoolInfo` ticker/name. | User-added 2026-09-24. Uses the already-reserved provider methods. | `components/Delegation.tsx` via `WalletInfo`. Do not add register/delegate/withdraw UI (1.7). |

## 7. Paper wallets — **retired 2026-09-24**

The `yacow paper-addresses` tool (T1, context §11) is **removed**. Decisions 7.1–7.5 below are historical: they explain why the code once existed. Do not implement them. See 1.7. Recoverable from git `ff8f493`.

| # | Decision (historical) | Why it existed | Apply now |
|---|---|---|---|
| 7.1 | Non-interactive subcommand of the same binary. | One install. | No `src/commands/` in this project. |
| 7.2 | External chain only, mainnet + preprod, default 10, `--count` ≤ 100. | Locked with the user at T1. | — |
| 7.3 | Always print CIP4 plate + wrong-password warning. | Wrong paper password yields a different valid 15-word phrase. | — |
| 7.4 | Byron via CSL `ByronAddress.icarus_from_key`. | Icarus role 0 = external. | Do not re-add Byron derivation. |
| 7.5 | Daedalus 27-word paper wallets out of scope. | Different scheme. | Still true if the tool ever returns. |

## 8. Naming & repo conventions

| # | Decision | Why | Apply |
|---|---|---|---|
| 8.1 | Project name YACOW ("Yet Another Cardano Only Wallet"): package, bin `yacow`, keystore `~/.yacow`, header, onboarding, README. | Branding. | — |
| 8.2 | **Do not name other wallets**, their backends, or their libraries anywhere in this project (docs, comments, tests, dependencies, code). Transaction building is in-repo CSL (2.3). | This is a standalone wallet; other products are not a reference surface. | Grep for other wallet names before merging. Do not add their packages. Vendor-hosted APIs stay forbidden (4.1). |
| 8.3 | The implementation plan lives in `_context.md` (repo) with the canonical copy at `~/ClaudeVault/YACOW-Cardano-Wallet-TUI/context.md`. It is NOT referenced from the README. | User instruction. | Update both copies together. |
| 8.4 | No doc may contain literal ANSI escape sequences. | Bitdefender quarantines both as `Generic.CLIExploit` — confirmed kills of `PLAN.md` and an old CLI plan filename in repo and vault; it also ate `.claude/file-history`. | Describe escape codes in prose. |
| 8.5 | Git commits in this repo carry no `Co-Authored-By: Claude` trailer. | User's global rule. | — |
