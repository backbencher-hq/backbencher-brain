# M25: The Extension (IDE Program v1)

Status: `open`
GitHub milestone: `25` (IDE program v1 — "The Extension")
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md)
Prerequisite: M24 completion bar met (the M24 gate, checked by this
milestone's G1 verifier — a claim of "v1 started" without v0 closed is a
contract violation).

## Purpose

Ship the thin VS Code extension that makes `bb lsp` a product: install, open
a workspace, and the five launch languages get hover, definition, references,
symbols, and call hierarchy — with auto-index on open and honest status
surfaces. Publish to OpenVSX. Verify in VS Code first; fork claims (Cursor,
Windsurf, Antigravity) are separate I4 badges, each with its own pinned run.

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | Governance + v0-bar check | verify M24 completion bar still green; ledger; closure gate |
| E1 | Extension skeleton | activation events, LSP client wiring to `bb lsp`, activation budget gate (contract §7.3) |
| E2 | Auto-index on open | index-present detection, `bb index` invocation with consent surface, progress reporting, no blocking of editor startup |
| E3 | Status surface | indexing state, staleness indicators, per-language evidence levels visible to the user (contract §4) |
| E4 | Packaging | VSIX build, OpenVSX publish pipeline, version pinning, changelog discipline |
| E5 | VS Code end-to-end | I3 verification: pinned VS Code version, scripted workspace fixture, assertions per feature |
| E6 | Fork verification | I4 runs in Cursor, Windsurf, Antigravity at pinned versions; unavailable fork = `blocked` recorded |
| E7 | Cross-platform verification | OS-matrix runs (Linux + macOS + Windows runners) of the extension end-to-end; each claim records OS per contract §10; path/BDATA_DIR platform bugs get their own mutation cases |
| V1 | Verifier harness | extension host test harness (vscode-test) + fork runner; latency budgets re-measured in-editor (contract §3) |
| D1 | Docs | marketplace listing truthful per contract §1; claim levels and limitations on the listing itself |
| X1 | Gate | closure gate + UI mutation set (contract §6) |

## Protocol

Same as M24 (verifier first, machine-emitted evidence, blocked-not-silent,
closure comments quote runs). Additions:

1. Editor/fork runs record editor version, OS, workspace fixture, timestamp.
2. Marketplace listing text is a governed artifact — the D1 verifier lints it
   with the contract vocabulary.
3. No fork claim without a pinned run; claiming a fork by assumption is
   banned vocabulary under contract §1.

## Completion bar for v1 (M26 may not start until ALL are true)

1. VSIX published on OpenVSX; install → open workspace → features live, at
   I3 for VS Code (pinned version) and I4 for at least one fork, with any
   other fork honestly `blocked` or verified. If every candidate fork is
   unavailable on the hardware, the bar may be met by recording all forks
   `blocked` with reasons, plus owner approval of the waiver — the blocked
   record itself is the honest deliverable.
2. Auto-index path verified: fresh clone → open → index builds → features
   activate; editor startup not degraded (activation budget met).
3. Status surface proves staleness rendering (mutation-tested).
4. Latency budgets met in-editor, evidence recorded with machine + versions
   + OS (contract §10); cross-platform E7 runs recorded for at least two
   OSes or declared `blocked` with reasons.
5. Closure gate green including contract §6 mutants; ledger clean.

## Negative list

- No claims for editors outside the verified set.
- No fork claim by inheritance ("it's a VS Code fork so it works" is banned).
- No marketplace listing language beyond measured claim levels.
- No JetBrains/Zed/Neovim work (M27).
