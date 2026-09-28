# M33 — CLI Discoverability — Master Plan

Milestone: M33 · GitHub milestone: 33 · Status: open
Authority: this document · Governing contract: `docs/M14-HONESTY-CONTRACT.md`

## Purpose

Users can only consume what they can discover. M30/M32 made the embedding
setup, `bb setup show`, and `bb doctor` real and verified — but a user who
never sees them in `bb --help`, mistypes a command and gets a dead end, or
runs `bb -v` (the near-universal muscle-memory form) and gets an error, never
benefits. This milestone makes the CLI's *discovery surface* honest and
complete:

1. **Version parity** — `bb -v`, `bb version`, and `bb --version` all work
   and print the same version string.
2. **Unknown-command UX** — mistyped commands produce did-you-mean
   suggestions and a pointer to `bb --help`; never a bare dead end; exit 1;
   never hang.
3. **Man page** — a real roff `bb(1)` manual shipped through `package.json`
   `man` so npm installs expose it; `man bb` works.
4. **Help language unification** — all CLI-facing strings in English; the
   Turkish descriptions in the M30/M32 commands move to docs where a human
   translator can own them.
5. **Help↔implementation parity gate** — every command and flag listed in
   help exists in the implementation, and every implementation command and
   flag appears in help, machine-checked in both directions against the
   compiled CLI's parsed surface.

## Non-goals / ownership boundary

- No `src/mcp/` changes (M21's surface), no analyzer work (M14), no LSP/IDE
  work (M24–M29, M25 in progress), no tool-documentation work (M31), no
  diagnostics behavior changes (M32 — only its *descriptions* are
  re-worded to English, semantics untouched).
- No new providers, no embedding behavior changes.

## Authority order

1. This master plan (`docs/m33/M33-MASTER-PLAN.md`).
2. The governing honesty contract (`docs/M14-HONESTY-CONTRACT.md`).
3. Executable implementation and its verifiers.

Where docs and behavior disagree, behavior wins and the docs gate (H1) must
be updated — never the reverse.

## Protocol (every issue)

Every issue carries machine-emitted evidence: `currentCommit`,
`sourceFingerprint`, `verifierCommand`, `evidenceFile`,
`positiveAndNegativeChecks`, fresh timestamp, and `limitations`. A
known-gap is recorded as `known-gap` and a blocked issue as `blocked` —
never silently skipped. `verified` is only reachable with positive AND
negative (adversarial) checks passing at the current commit.

## GitHub issue numbers

M33's issues are filed on GitHub as milestone 33: G1=#568, S1=#569, S2=#570,
S3=#571, S4=#572, H1=#573, X1=#574. The ledger and `REAL_ISSUE_NUMBERS` in
`script/m33/verify-governance.ts` enforce these values exactly — a
placeholder or unknown number is a gate failure, so the ledger cannot drift
from GitHub.

## Issue order and dependencies

| Issue | Tool | Scope | Depends on |
|---|---|---|---|
| G1 | governance | master plan, ledger, chain wiring, banned-vocab lint | — |
| S1 | cli | `bb -v` + `bb version` parity | G1 |
| S2 | cli | unknown-command suggestions + help pointer | G1 |
| S3 | docs | `docs/man/bb.1` + `package.json` `man` wiring | S4 wording frozen |
| S4 | cli | English help unification + help↔implementation parity gate | G1 |
| H1 | docs | README/EMBEDDINGS truth for the new surfaces | S1–S4 output final |
| X1 | gate | closure gate: combined mutant audit + completion bar | all of the above |

X1 closes last; no issue may close before the issue it depends on.

## Completion bar

1. `bb -v`, `bb version`, and `bb --version` all print the same version and
   exit 0, verified against the built binary.
2. A mistyped command (`bb docter`) suggests `doctor` and points to
   `bb --help`; a nonsense command (`bb frobnicate`) still exits 1 with a
   help pointer; verified on the built binary with mutants.
3. `man bb` renders a real manual with NAME/SYNOPSIS/DESCRIPTION/COMMANDS/
   OPTIONS/EMBEDDING SETUP/EXIT STATUS sections, and npm exposes it via the
   `man` field.
4. Every string rendered by `bb --help` (all commands, subcommands, flags,
   descriptions) is English, and help matches the implementation exactly in
   both directions (no help-only or code-only commands/flags).
5. README and EMBEDDINGS document the discovery surfaces with verbatim
   strings and pass the docs-truth gate.
