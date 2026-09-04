# YACOW — Project Rules

## Always check DECISIONS.md first

Before implementing, refactoring, planning or reviewing **anything** in this repo, read
`/DECISIONS.md` (project root). It is the register of every locked decision: scope, stack,
wallet/security model, data providers, testing, UX and naming.

- If the task is already covered by a decision, follow it — do not re-litigate it.
- If the task **contradicts** a decision, stop and confirm with the user before writing code,
  quoting the decision number (e.g. "4.1 forbids the Yoroi backend").
- If the work **creates or changes** a decision, update `DECISIONS.md` in the same change and
  mirror it into the context log (`_context.md`).

## Context log

The implementation plan and resume state live in `_context.md`, canonical copy at
`~/ClaudeVault/YACOW-Cardano-Wallet-TUI/context.md`. Update both together. Never name a doc
`*plan*.md` and never put literal ANSI escape sequences in a doc (see decision 8.4).
