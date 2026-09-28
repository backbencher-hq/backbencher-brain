# M42: The Interactive Hover (IDE Program v6)

Status: `open` (planning — not yet filed on GitHub)
GitHub milestone: `42` (free slot confirmed against the live board; M30–M41 are taken)
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md) (extended by the Hover Interaction Rules below)
Prerequisite: M29 completion bar met (verified 9/9, X1 32/32, 2026-09-05).

Name note: "Interactive Hover" — no banned vocabulary; the ambition is the
mission's front door, the vocabulary stays governed.

## Mission first

Deep code intelligence was locked inside one vendor's IDE for thirty years.
We are taking it out of the cage: every editor, every language, one honest
index. The hover is where a developer first *feels* that mission. Today our
hover is honest but a dead end: "1 usage" and nowhere to go. IntelliJ's hover
is a portal. M42 makes ours a portal — **built on data no other tool has**:

- **Enrichment, finally visible** — the index already computes role, pattern,
  layerFlow, criticality, frequency on every relationship (verified live:
  `role: consumer, layerFlow: core→core` in the java demo db) — and nothing in
  `src/lsp/` consumes it. The moat is sleeping. M42 wakes it.
- **Cross-language, on the surface** — usages of a Java symbol called from
  TypeScript, on hover, with evidence labels. Per-language servers cannot
  follow; they don't have the index.
- **The one-flow rule** — hover → see everything → get anywhere: usages as
  clickable links, the connections tree, the graph, impact — one click each,
  every step evidence-labeled.

## Hover Interaction Rules (contract extension, gated from G1)

1. **Nothing unclickable.** A hover that names a symbol, file, or usage
   without a working navigation link to it is a defect, not a limitation.
2. **Stale is visible everywhere.** Every interactive surface (highlight,
   hover body, hub, graph) carries the staleness marker with its claim level.
   A stale graph is *labeled* stale, never silently rendered fresh.
3. **Enrichment is labeled as enrichment.** Role/pattern/layerFlow render
   with their inference origin — the hover never presents an inferred pattern
   as a parser fact (existing tier vocabulary, no new claims).
4. **The complement stance holds.** No completion, no diagnostics, no rename
   (contract §7.1 unchanged). We add understanding, not another linter.
5. **The hub is generated, not hand-drawn.** Hub grouping/tree rendering
   comes from the ONE renderer core (M26 W1 rule); forks are banned.

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | [#648](https://github.com/backbencher-hq/backbencher-brain/issues/648) Governance + v5-bar check | ledger; closure gate; M29 bar still green; Hover Interaction Rules added to the contract doc and machine-gated |
| H1 | [#649](https://github.com/backbencher-hq/backbencher-brain/issues/649) Hoverable affordance | semantic DocumentHighlight on cursor rest; evidence: fixture-first, editor leg, mutant "highlights a non-reference" |
| H2 | [#650](https://github.com/backbencher-hq/backbencher-brain/issues/650) Rich hover body | connected-summary, top-3 usages as clickable file:line links, "N more" → native references tree, definition link |
| H3 | [#651](https://github.com/backbencher-hq/backbencher-brain/issues/651) LSP consumes enrichment | role/pattern/layerFlow/criticality/frequency surfaced in hover + graph edges; presence-gated; no schema change |
| H4 | [#652](https://github.com/backbencher-hq/backbencher-brain/issues/652) Hover actions | open-in-graph, impact, call hierarchy as command URIs; honest error surface when un-indexed |
| H5 | [#653](https://github.com/backbencher-hq/backbencher-brain/issues/653) The hub | webview list↔tree toggle, grouping by file/caller/call-tree over bb/graph; ONE renderer core, fork-banned |
| H6 | [#654](https://github.com/backbencher-hq/backbencher-brain/issues/654) Hub → editor | versioned postMessage contract, click-to-reveal; strict CSP unchanged |
| X1 | [#655](https://github.com/backbencher-hq/backbencher-brain/issues/655) Gate + launch bar | M42 closure gate (full-ladder audit at HEAD); launch bar executed: OS matrix via CI, OpenVSX publish, every known gap fixed or owner-waived |

Parallel tracks (not M42 issues, riding alongside):
- **Wave 2 (zig)**: analyzer already indexes zig (probed live: functions
  extracted cleanly). Fixtures + approval record + S5/S6 legs run as the
  standing M29 protocol; zig joins the launch set when green.
- **Wave 3 (C/C++)**: opens the day M37 lands the analyzers; same protocol.

## Verification protocol (same law as M24–M29)

1. Fixture-first: every feature lands with a failing test BEFORE the fix (F7 rule).
2. Can-fail proof: every verifier plants its own mutants; a suite that cannot
   fail is not evidence (contract §6).
3. Editor legs are real: highlights, hover links, hub clicks are asserted in
   real editor sessions (the E5 blind spot — the never-activating extension —
   is the standing warning; every M42 editor leg must test the WAKE-UP path,
   not just the activated path).
4. Docs are generated, drift-gated (byte-identical regeneration).
5. Budgets: the §3 warm budgets extend to the hub interactions; any miss is a
   filed defect, not a footnote. New budgets declared in G1 (hub open ≤ 300ms
   p95; highlight ≤ 25ms p95; enrich-read adds ≤ 5ms to hover).

## Completion bar for v6 (launch)

1. H1–H6 verified with editor legs; Hover Interaction Rules machine-gated.
2. Enrichment visible on hover + hub for at least the wave-1 languages.
3. Launch bar: OS matrix green via CI (or owner-waived per-OS with reason),
   OpenVSX published, marketplace listing regenerated from the ledger,
   placeholder milestones closed, every known gap fixed or owner-waived.
4. X1 full-ladder audit green at current HEAD; owner spot-check (§8.5)
   recorded — the achieved/not-achieved verdict stays with the owner.

## Negative list

- No lexical-highlight shortcut (token match ≠ semantic reference).
- No hover link that navigates to a guess (absence is declared, not invented).
- No enrichment row upgraded to parser-fact tier, ever.
- No second tree renderer; the hub extends the ONE core.
- No launch with a silent gap: fixed or waived with a recorded reason, in writing.
