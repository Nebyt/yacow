# YACOW — Project Rules

## Always check DECISIONS.md first

Before implementing, refactoring, planning or reviewing **anything** in this repo, read
`/DECISIONS.md` (project root). It is the register of every locked decision: scope, stack,
wallet/security model, data providers, testing, UX and naming.

- If the task is already covered by a decision, follow it — do not re-litigate it.
- If the task **contradicts** a decision, stop and confirm with the user before writing code,
  quoting the decision number (e.g. "4.1 forbids vendor wallet backends").
- If the work **creates or changes** a decision, update `DECISIONS.md` in the same change and
  mirror it into the context log (`_context.md`).

## Always load the OpenTUI skill

Before implementing, reviewing, or debugging anything here — especially the TUI — read
`~/.agents/skills/opentui/SKILL.md` and the skill docs for the task. Do not guess OpenTUI
APIs from Ink habits. Cursor agents also have this as `.cursor/rules/opentui-skill.mdc`.

## Context log

The implementation plan and resume state live in `_context.md`, canonical copy at
`~/ClaudeVault/YACOW-Cardano-Wallet-TUI/context.md`. Update both together. Never name a doc
`*plan*.md` and never put literal ANSI escape sequences in a doc (see decision 8.4).
