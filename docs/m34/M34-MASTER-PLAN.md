# M34 — Consumability Hardening — Master Plan

Milestone: M34 · GitHub milestone: 34 · Status: open
Authority: this document · Governing contract: `docs/M14-HONESTY-CONTRACT.md`

## Purpose

M30–M33 made bb's onboarding, diagnostics, and discovery real and verified —
but two blind spots remain:

1. **Nothing proves the INSTALLED copy works.** The verifiers all run from
   the repo (tsx on source, or `bin/bb` against a repo `dist/`). The npm
   tarball carries 103 dist/bin files, 8 runtime dependencies including two
   native modules (`better-sqlite3`, tree-sitter) — and no gate has ever
   installed the package and run it from the install prefix. "Works in the
   workspace, broken when installed" is the same defect class as M30's P0
   ("works under tsx, broken in the bundle").
2. **No machine control over output language.** The M33 language-origin
   research found the Turkish leak and cleaned it, but today's protection is
   a curated denylist plus string pins. A general script gate — any
   non-Latin script in built-binary output or user-facing tracked files is a
   gate failure — turns the lesson into a permanent control (with an
   allowlist for legitimate product names like `LÖVR`).

## Non-goals / ownership boundary

- No `src/mcp/` changes (M21), no analyzer work (M14), no LSP/IDE work
  (M24–M29), no tool-documentation work (M31), no behavior changes to
  M32/M33 commands (their gates pin the current strings).
- **No CI changes in M34.** A CI job running a verify-fast subset is
  explicitly parked until the owner approves touching shared workflow files.
- No new product features; this milestone only proves and guards what
  exists.

## Authority order

1. This master plan (`docs/m34/M34-MASTER-PLAN.md`).
2. The governing honesty contract (`docs/M14-HONESTY-CONTRACT.md`).
3. Executable implementation and its verifiers.

Where docs and behavior disagree, behavior wins and the docs gate must be
updated — never the reverse.

## Protocol (every issue)

Every issue carries machine-emitted evidence: `currentCommit`,
`verifierCommand`, `evidenceFile`, `positiveAndNegativeChecks`, fresh
timestamp, and `limitations`. A known-gap is recorded as `known-gap` and a
blocked issue as `blocked` — never silently skipped. `verified` is only
reachable with positive AND negative (adversarial) checks passing at the
current commit.

## GitHub issue numbers

M34's issues are filed on GitHub as milestone 34: G1=#575, S1=#576, S2=#577,
X1=#578. The ledger and `REAL_ISSUE_NUMBERS` in
`script/m34/verify-governance.ts` enforce these values exactly — a
placeholder or unknown number is a gate failure, so the ledger cannot drift
from GitHub.

## Issue order and dependencies

| Issue | Tool | Scope | Depends on |
|---|---|---|---|
| G1 | governance | master plan, ledger, chain wiring | — |
| S1 | packaging | install-path smoke: tarball → real install → bin/bb + man + help | G1 |
| S2 | gate | script gate: non-Latin scripts in user-facing surfaces fail the build | G1 |
| X1 | gate | closure gate | S1, S2 |

X1 closes last; no issue may close before the issue it depends on.

## Completion bar

1. `npm pack` → real `npm install` into a temp prefix → the INSTALLED
   `bin/bb` answers `--help`, `-v`, and `setup --help`; the man page lands in
   the prefix; the tarball leaks no dev-only files — proven with planted
   mutants (a leak planted into the files list must be caught).
2. Every built-binary command's output and every user-facing tracked file is
   Latin-script, with an explicit allowlist; a planted Russian or Chinese
   string must be caught by the gate.
3. All M34 gates are permanent parts of `npm run verify`, and the closure
   gate audits the whole milestone fail-closed.
