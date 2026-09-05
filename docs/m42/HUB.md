# The Hub — usages as list/tree (M42.H5)

The hub is the usage/connections center that opens from the hover's
**Open in graph** action (H4): the M26 webview extended into the v6 usage
surface. ONE renderer core (script/m26/graph-core.ts lineage), fork-banned
(decision record; §12.5). This document is the AUTHORED CONTRACT — the H5
verifier asserts the code against it, and the V1 harness extends its
lying-renderer suite over it.

## Query (bb/graph usages mode)

The hub queries `bb/graph` (schema v1) with an additive `mode`:

    { schemaVersion: 1, symbol: "<name>", mode: "usages" }

- `mode: "graph"` (default, unchanged) = the classic graph layout.
- `mode: "usages"` = the hub's declared query profile: `direction`
  defaults to `both`, `maxDepth` defaults to the hub depth cap (5 — the W5
  impact depth cap). Explicit direction/maxDepth may override; an invalid
  mode value is a LOUD `bb/graph:` declared error (same law as every other
  param). The response is the standard GraphTraversalResult — bounded per
  the engine budget, truncation declared in `summary` with real counts
  (never silent).
- Symbol resolution stays server-side and name-based (established M26
  transport semantics; documented limitation: a same-named symbol in
  another file resolves to the indexed match the engine picks).

## Rendered surfaces (all from ONE query, ONE core)

The panel pre-renders three sections from the single usages response and a
tiny nonce-bound local script toggles between them (CSP unchanged; no
postMessage — that contract is H6):

1. **List view — grouped by file** (default): usage rows grouped under
   their file. IntelliJ-style "usages in file".
2. **List view — grouped by caller**: the same rows grouped by the calling
   (or called) symbol.
3. **Tree view — call tree**: rows laid out by traversal depth (callers:
   who calls the symbol, recursively; callees: what it calls), indented by
   depth.

The whole panel carries the **staleness marker** (data from `bb/staleness`
for the root symbol's file — §12.2: a stale render is labeled stale).

## DOM contract (drift-gated by the H5 verifier + V1 harness)

Section roots:

- list by file:  `<div class="bb-hub" …><div class="bb-hub-list" data-group="file">`
- list by caller:`…<div class="bb-hub-list" data-group="caller">`
- call tree:     `…<div class="bb-hub-tree">`

Shared, deterministic, model-traceable:

- summary:      `<div class="bb-hub-summary" data-callers="N" data-callees="M">N callers · M callees</div>`
- truncation:   the standard `bb-truncation-marker` with declared
  shown/total when `summary.truncated`; NO marker when complete.
- empty:        zero edges render `<div class="bb-hub-empty">no indexed
  usages for this symbol</div>` — an honest empty state, never fabricated
  rows.
- group:        `<div class="bb-hub-group" data-group-name="App.java">`
  with `<span class="bb-hub-group-label">` and N rows.
- row:          `<div class="bb-hub-row" data-dir="caller|callee"
  data-row-id="<brain_relationship id>" data-depth="d">` containing
  `<span class="bb-hub-row-name">main</span>` and
  `<span class="bb-hub-row-meta">App.java:12</span>` (file:LINE where LINE
  is the node's indexed line).
- badge (W4):   every row carries exactly one
  `<span class="bb-hub-badge bb-badge-<tier>"
  data-badge-tier data-badge-confidence>` — tier resolution identical to
  edges (`tierForEdge`); a badge can never disagree with its row's tier.
- enrichment (H3): rows whose edge carries enrichment add
  `data-enriched="1"` + `<span class="bb-hub-enrichment">⌾ role · layer · …</span>`
  — an annotation, never a tier change.
- determinism: two renders of the same model are byte-identical.

## Budget

Hub open (usages query + render of the three sections) p95 ≤ 300 ms on the
wave-1 fixture scale (declared in G1/§12.7) — measured headless by the H5
verifier and in-editor by E5.

## Known limitations (declared, never silent)

- Name-based symbol resolution (above).
- No in-hub navigation yet (H6: click-to-reveal + refresh messaging).
- Group switching is local-visibility only; a group change re-renders by
  reopening (full refresh rides H6's requestRefresh).
