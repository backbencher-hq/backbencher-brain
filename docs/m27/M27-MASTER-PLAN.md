# M27: Everywhere (IDE Program v3)

Status: `open`
GitHub milestone: `27` (IDE program v3 — "Everywhere")
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md)
Prerequisite: M26 completion bar met (verified by G1).

## Purpose

One index, every IDE. JetBrains via LSP4IJ first (configuration, not native
plugin code — the native plugin is gated behind LSP4IJ evidence per the
decision record), then the LSP-native editors: Zed, Neovim, Helix. Each
editor is a separate claim level with its own pinned run; the graph webview
ships where the editor has a webview equivalent, and is declared absent where
it does not.

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | Governance + v2-bar check | ledger; closure gate; M26 bar still green |
| J1 | LSP4IJ configuration | server definition (launch `bb lsp`), capability mapping, documented install path |
| J2 | JetBrains verification | pinned IntelliJ IDEA version, scripted workspace run, per-feature assertions (I3-equivalent for JetBrains) |
| J3 | Native-plugin decision gate | evidence review: does LSP4IJ meet the claim levels we need? Written disposition (proceed native / stay LSP4IJ) recorded with reasons |
| Z1 | Zed verification | extension or external-server config; pinned Zed version; per-feature assertions |
| N1 | Neovim + Helix verification | reference configs; scripted headless assertions via a driver (e.g. nvim --headless); pinned versions |
| W1 | Graph parity decision | where a webview equivalent exists (Zed?), ship it; where not, declare absence per editor in docs and evidence |
| V1 | Verifier harness | per-editor runners with a shared assertion core (one feature-assertion library, many runners) |
| D1 | Docs | per-editor install/verification matrix; every editor's capability table states measured levels |
| X1 | Gate | closure gate |

## Protocol

Same as prior milestones, plus:

1. One shared feature-assertion core; per-editor runners adapt transport only.
   Divergent assertions per editor are a filed defect against the harness.
2. Editor availability is machine-dependent (JetBrains toolboxes, Zed
   channels) — unavailable editors are `blocked` with reason, recorded.
3. LSP4IJ limitations discovered are filed against our docs first (declared),
   and upstream only where they are upstream bugs.

## Completion bar for v3 (M28 may not start until ALL are true)

1. JetBrains (via LSP4IJ), Zed, Neovim verified at pinned versions for the
   core feature set, or honestly `blocked` with reasons recorded in the
   ledger — no silent omissions.
2. J3 disposition written and owner-reviewed (native plugin: proceed or not).
3. Per-editor capability matrix published; every cell is a claim level or
   `blocked`/`absent`, never blank.
4. Latency budgets re-measured per editor platform where the runner allows.
5. Closure gate green; ledger clean.

## Negative list

- No native JetBrains plugin inside this milestone (J3 only decides *whether*
  one is ever built).
- No editor claimed without a pinned run on this machine or a recorded
  blocked state.
- No graph-webview claims for editors without a webview equivalent.
