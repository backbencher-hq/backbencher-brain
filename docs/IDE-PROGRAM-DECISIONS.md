# IDE Program Decision Record

Status: **RATIFIED — the constitution for the Backbencher IDE program.**
Decisions below were made with the owner on 2026-08-30 and bind all IDE
milestones (M24–M29). Changing any of them requires a written amendment here.

## The bet

IntelliJ-grade navigation took 30 years because it was built per-IDE,
per-language. We build once at the protocol layer (LSP) over the index we
already have (40+ Tree-sitter analyzers, brain.db, M19-measured scale at
273k files). Every editor that speaks LSP — or forks VS Code — inherits the
result.

## The version ladder (one version = one milestone)

| Version | Milestone | Name | Ships | Differentiator |
|---|---|---|---|---|
| v0 | M24 | The Server | `bb lsp` — LSP 3.18 over brain.db: hover (signature + usage count + evidence class), definition, references, document/workspace symbols, call hierarchy in/out | The only server whose hover states how much to trust it |
| v1 | M25 | The Extension | VS Code extension (thin client), auto-index on open, OpenVSX publish, fork-verification gates (I3/I4) | 40+ languages, one install, zero per-language setup |
| v2 | M26 | The Graph | Usage-graph webview, cross-language hover, evidence badges on edges, bounded impact mode | The graph IntelliJ cannot show: cross-language + honest confidence |
| v3 | M27 | Everywhere | JetBrains via LSP4IJ (configuration, not code) first; Zed, Neovim, Helix verified | One index, every IDE |
| v4 | M28 | The Union | MCP tools expose what the IDE shows; agent annotates the human's graph | Agent and developer share one truth |
| v5 | M29 | Precision Waves | Per-language precision climbing into the IDE (M14-style waves); giant-repo latency budgets in-editor; published precision ledger | We publish our precision numbers per language |

Note: v5 is named **Precision Waves** (not "Perfection Waves") because
"perfection" is banned vocabulary under the M14 contract. The ambition is
unchanged; the word was the problem.

Each version is closed only by its completion bar — never by calendar.

## Locked decisions

1. **Stance — Complement.** We layer graph, navigation, cross-language, and
   evidence on top of gopls, rust-analyzer, tsserver, jdtls, etc. No
   completion, no diagnostics, no rename. (Contract §7.)
2. **First target — VS Code + forks.** One VSIX covers VS Code, Cursor,
   Windsurf, Antigravity via OpenVSX. Each fork is a separate verified claim
   level (I4) with its own pinned run; a claim for one fork never implies
   another.
3. **v0 languages — java, groovy, kotlin, scala, typescript**, chosen
   because they are #419-CONFORMANT. **Extension rule:** the five are the
   opening set, never the ceiling; language N+1 joins by passing the standing
   gates as a routine wave, not a redesign. (Contract §9.)
4. **Repo — same repository.** `src/lsp/`, `ide/`, `script/mXX/`,
   `validation/mXX/`, wired into `npm run verify` like every other
   milestone. The existing evidence machinery applies unchanged.
5. **Numbering — next free GitHub milestone numbers, parallel track.** The
   IDE program runs alongside the in-flight M14 work; no gating of one on
   the other except where evidence dependencies exist (e.g. a language below
   #419 CONFORMANT joins the IDE with a declared lower evidence level).
6. **Governance — dedicated IDE Honesty Contract**
   (`docs/IDE-HONESTY-CONTRACT.md`), stricter than M14's because hover text
   is a user-facing claim. Core lie-catchers: latency budgets as gates,
   fork/editor claim levels (I0–I5), UI mutation gates, stale results
   labeled in-UI (never silent), owner spot-checks as closure authority.

## The two blood-tested foundations

These are the failure classes that would kill the product silently. Both are
gated inside v0 before any feature may close:

1. **Freshness.** A persisted index must never lie about a file the user
   just edited. File-watcher → incremental reindex → honest stale labels.
   (Contract §4.)
2. **Position mapping.** LSP positions are 0-based UTF-16 code units; the
   index stores 1-based lines and byte ranges (the CC1 bug class). One
   off-by-one poisons every feature. A dedicated mapping component with its
   own mutation suite, built first, tested hardest. (Contract §5.)

## What we deliberately do NOT compete on

Type inference, completion, diagnostics, rename — the domain of gopls,
rust-analyzer, tsserver, jdtls. Fighting them is the 30-year trap. We
complement: graph, navigation, cross-language, evidence — layered on top of
whatever language server the user already runs.

## Honest risks (recorded at planning time)

- **LSP has no graph-view primitive** → the v2 webview is one HTML/JS core
  reused across IDEs; never per-IDE reimplementations.
- **Keystroke-freshness** → debounce + stale labels, never block the user.
- **JetBrains native plugin is a rabbit hole** → gated behind LSP4IJ
  evidence; only if LSP4IJ proves insufficient for the claim level sought.
- **Editor churn** costs weeks, not years, because clients are thin and the
  server is protocol-bound.
- **Fork verification availability** — a fork we cannot run locally is
  recorded `blocked`, never claimed.

## Research base (2026-08-30)

Findings that ground the decisions above, with sources recorded in the
session research: LSP 3.17/3.18 standardizes hover, references, call
hierarchy, type hierarchy (microsoft.github.io/language-server-protocol);
VS Code exposes providers programmatically
(code.visualstudio.com/api/language-extensions/programmatic-language-features);
Cursor, Windsurf, Antigravity are VS Code forks distributing via OpenVSX or
VSIX (open-vsx.org; antigravity.google/docs; forum.cursor.com) — one VSIX
reaches all forks, each verified separately; JetBrains supports LSP servers
including call hierarchy via LSP4IJ (plugins.jetbrains.com/plugin/23257);
Zed and Neovim/Helix are LSP-native (zed.dev/docs/extensions/languages).
