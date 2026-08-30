# M26: The Graph (IDE Program v2)

Status: `open`
GitHub milestone: `26` (IDE program v2 — "The Graph")
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md)
Prerequisite: M25 completion bar met (verified by G1).

## Purpose

Ship the differentiator: the usage-graph webview (click a symbol, see its
graph), cross-language hover (Vue→TS→SQL-style chains where the index has
them), evidence badges on edges (structural / usage_contextual / inferred
with confidence), and bounded impact mode. One HTML/JS webview core, reused
across all IDEs — never per-IDE reimplementations.

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | Governance + v1-bar check | ledger; closure gate; M25 bar still green |
| W1 | Webview core | one HTML/JS graph renderer (canvas or SVG), node/edge model from GraphTraversalResult, bounded by budget (contract §3 render budget); render budget fixture pinned at 500 nodes / 2,000 edges |
| W2 | LSP transport for graph | custom request extension over the existing server (LSP `workspace/executeCommand` or custom notification) — declared, documented, versioned |
| W3 | Cross-language hover | is_cross_language + bridge_mechanism surfaced in hover text with declared evidence level |
| W4 | Evidence badges | edge tiers rendered from metadata.evidenceClass + confidence; inferred edges visually distinct (contract §2 honesty in UI) |
| W5 | Impact mode | bounded reverse-dependency set from the graph engine, truncation reported in-UI (never silent) |
| W6 | Webview security | CSP discipline for the webview, HTML-escaping of all repo-controlled strings (symbol names, paths, hover markdown), adversarial fixtures with hostile symbol names (`<script>`, quotes, unicode), mutation-gated |
| V1 | Verifier harness | headless webview render harness (DOM-level assertions), budget gate, mutation set incl. fabricated/dropped edges and wrong tier labels |
| D1 | Docs | webview documentation with claim levels; cross-language support declared per index reality, not aspiration |
| X1 | Gate | closure gate |

## Protocol

Same as M24/M25, plus:

1. Cross-language claims are per-pair, evidence-backed from brain_relationship
   rows — never "cross-language works" unscoped.
2. Every rendered edge must trace to a brain_relationship row id in evidence.
3. Truncation (budget-exhausted graphs) renders a visible marker; the
   mutation suite proves it.

## Completion bar for v2 (M27 may not start until ALL are true)

1. Graph webview live in VS Code at I3 with render budget met; at least one
   fork at I4 or honestly blocked.
2. Cross-language hover verified on at least one real cross-language fixture
   per launch-language pair that the index actually stores; absent pairs
   declared absent.
3. Evidence badges rendered for all four tiers; inferred never rendered as
   structural (mutation-proven).
4. Impact mode bounded, truncation visible, budget met.
5. Closure gate green; ledger clean.

## Negative list

- No claim that any language pair is cross-language-resolved without stored
  edges proving it.
- No unbounded graph renders; no silent truncation.
- No per-IDE webview forks.
- No JetBrains/Zed/Neovim work (M27).
