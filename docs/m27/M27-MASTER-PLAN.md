# M27 — Everywhere (JetBrains / Zed / Neovim / Helix) — Master Plan

> **STATUS: DRAFT — awaiting owner review.**
> Nothing below is a verified claim. Every claim becomes one only when an
> issue's ledger cell pins a verifier, a run, and a machine (contract §2).

Program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md) (v3 —
"One index, every IDE"). Governing contract:
[IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md). Parent status:
[IDE Program Status](../IDE-PROGRAM-STATUS.md).

## Purpose

v0 put the server up (M24), v1 put it in VS Code and its forks (M25), v2 put
the graph in the editor (M26). v3 removes the "VS Code-only" asterisk: the
same `bb_lsp` binary, the same `brain.db` index, the same honesty surface —
hover with evidence tiers, staleness markers, symbols — reachable from the
other major editor families.

**The one-sentence rule of this milestone:** an editor earns a claim level by
*running the real server*, never by intending to. Where an editor cannot be
driven headlessly on this machine, the record says so with a reason — it is
declared, not discovered missing later.

## The core architectural bet

All four adapters are **clients of the same binary**. No per-editor indexing,
no per-editor intelligence, no per-editor renderer. Every adapter ships:

1. a **launch configuration** (how the editor starts `bb_lsp`),
2. a **capability declaration** (which bb_lsp methods that editor surfaces),
3. a **verification leg** at the deepest level the editor permits:
   - `I3` — real editor, real server, real assertions, machine-driven,
   - `I2` — configuration + server verified against each other, editor launch
     not machine-driven here (reason recorded),
   - `blocked` — with the reason, per the standing rule.

The fork-capability matrix (v3) carries the honest per-editor feature delta.
Known going in, declared up front: **the graph webview is I3-VS Code only.**
LSP4IJ/Zed/Neovim/Helix get hover/definition/references/symbols/staleness —
the graph panel has no cross-editor story in v3, and the matrix will not
pretend otherwise.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D-1 | JetBrains via **LSP4IJ user-defined server template** (configuration, not a Kotlin plugin) | Zero plugin code to maintain; LSP4IJ templates are the declared transport. A custom IntelliJ plugin is a *later, separate* decision — not v3. |
| D-2 | Zed via a **minimal extension** (`extension.toml` + thin wasm shim that resolves the `bb_lsp` binary from settings) | Zed requires an extension to attach a language server; the shim owns binary resolution only — no logic. |
| D-3 | Neovim via **nvim-lspconfig-style config** and verified **headless**: `nvim --headless` drives the real LSP client against the fixture workspace | Neovim is fully scriptable headless — it is the strongest v3 evidence leg (I3) and goes first among the four. |
| D-4 | Helix via **`languages.toml`**; verified at configuration level against bb_lsp's declared capabilities; any deeper claim requires a driven session — recorded honestly if not achievable here | Helix has no headless assertion path on this machine class; honesty over aspiration. |
| D-5 | One **fixture workspace + one assertion vocabulary** shared by all four legs (the M25 fixture pattern, reused) | Differential honesty: the same questions asked of every editor, so the matrix compares like with like. |
| D-6 | The graph webview ships **VS Code-only in v3**; the matrix records the delta per editor | Declared scope, not a silent gap. |
| D-7 | Toolchain provisioning (owner decision, 2026-09-04): **Neovim + Helix + Zed** as portable binaries in git-ignored `.tools/`; **JetBrains is not downloaded** — its runIde leg is attempted only as a declared blocked-with-reason record, and J1 verifies at configuration level (I2) | Strongest I3 leg funded without a 1.2 GB IDE download; the bar's "≥1 I3 leg" is met by Neovim; honesty carried by the blocked record. |

## Issues (planned order)

| Code | Issue | Deliverable | Acceptance criteria (abridged) |
|---|---|---|---|
| G1 | [#616](https://github.com/backbencher-hq/backbencher-brain/issues/616) | Governance | Ledger, governance map, gate, ladder check (re-audits the M26 bar) |
| N1 | [#617](https://github.com/backbencher-hq/backbencher-brain/issues/617) | Neovim (I3) | init.lua adapter + headless driver + verifier |
| J1 | [#618](https://github.com/backbencher-hq/backbencher-brain/issues/618) | JetBrains / LSP4IJ (I2, stretch I3) | LSP4IJ user-defined template (JSON) + verifier |
| Z1 | [#619](https://github.com/backbencher-hq/backbencher-brain/issues/619) | Zed (I2) | Extension (`extension.toml` + wasm shim) + verifier |
| H1 | [#620](https://github.com/backbencher-hq/backbencher-brain/issues/620) | Helix (I2) | `languages.toml` fragment + verifier |
| V1 | [#621](https://github.com/backbencher-hq/backbencher-brain/issues/621) | Fork capability matrix v3 | `docs/m27/FORK-CAPABILITY-MATRIX.md` |
| X1 | [#622](https://github.com/backbencher-hq/backbencher-brain/issues/622) | Closure gate | Full-suite audit + v3 completion bar + regeneration |

## v3 completion bar (X1 audits this)

1. Every one of the four adapters has a committed launch configuration whose
   method set is proven a subset of bb_lsp's declared capabilities.
2. At least one adapter is **I3** (real editor session, machine-driven) — N1's
   slot; if it fails, the milestone does not close on I2s alone.
3. The capability matrix v3 exists, is drift-gated, and declares the graph
   delta per editor.
4. The M26 completion bar re-audit passes inside M27's gate (ladder).
5. Every unresolved leg carries a `blocked` record with a reason — none are
   silent.

## Non-goals (v3)

- No JetBrains-native plugin (Kotlin) — LSP4IJ config only (D-1).
- No graph rendering outside VS Code (D-6).
- No MCP/agent work (v4), no precision waves (v5).
- No changes to bb_lsp's surface. If an editor demands a server change, that
  is a new decision record — not a silent scope creep.

## Risks

- **runIde (J1 stretch)** may be infeasible on this machine (display, RAM,
  download size). Fallback: I2 with the attempt recorded — never a silent skip.
- **Zed shim API drift**: zed_extension_api moves; the shim is kept minimal so
  the surface is tiny.
- **Helix headlessness**: if `hx` cannot be driven here, H1 stays I2 and says
  why — the bar (item 2) does not depend on it.
