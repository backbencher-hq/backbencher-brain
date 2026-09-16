# The Graph surface — what renders and what it claims (M26.D1)

This document is **GENERATED** by `script/m26/verify-graph-docs.ts` from
live code and stored evidence — never hand-edit it. Every number below
is imported from the module that owns it, and the drift gate fails the
suite if this file stops matching a fresh generation.

## What renders

The webview renders the `bb/graph` result through ONE renderer
(`script/m26/graph-core.ts`): nodes, edges with per-edge evidence
badges, the tier legend, and truncation markers. The transport is the
versioned custom LSP request `bb/graph` (schema v2, declared in
`docs/m26/GRAPH-TRANSPORT.md`).

## Edge evidence tiers (generated from TIER_MEANINGS — the W4 UI law)

| tier | meaning in UI terms |
| --- | --- |
| **structural** | stored or derived structure (calls/extends/implements/overrides/contains/exports/instantiates at confidence >= 0.7) — safe to trust for navigation |
| **import_based** | derived from import statements — the module relationship is real, the use may be indirect |
| **usage_contextual** | usage-site evidence — the name appears in context, not guaranteed to be a call |
| **reference_qualified** | reference with qualifier evidence — stronger than usage_contextual, weaker than structure |
| **inferred** | a guess or an unrecognized relationship kind (heuristic, or confidence < 0.7) — treat as a hint, never as fact |

Derivation: stored `metadata.evidenceClass` wins; otherwise a structural
edge below the 0.7 confidence floor renders as inferred. The hover gloss
(`src/lsp/cross_language_hover.ts`) uses the same rule.

## Truncation policy (generated from RENDER_BUDGET — the W1 law)

The renderer budget is `500` nodes / `2000` edges. Anything
beyond the budget is NOT silently dropped: the webview shows a marker
with real counts ("Showing X of Y") and machine-readable `data-shown` /
`data-total-if-known` attributes. The impact surface has its own
declared budget: `200` reverse-dependency nodes at traversal depth
`5` (src/lsp/impact.ts).

## Per-pair cross-language reality (generated from stored rows)

From stored `brain_relationship` rows only (`is_cross_language = 1`).
Launch languages: java, groovy, kotlin, scala, typescript. A pair not
listed is **declared absent** — no stored rows, no cross-language UI
text, no claimed bridge.

| source language | target language | stored edges | bridge (sample) | origin |
| --- | --- | --- | --- | --- |
| typescript | json | 1 | name-resolution | real project index |
| json | typescript | 246 | name-resolution | real project index |
| typescript | json | 3 | name-resolution | real project index |

Real project dbs scanned: 67 (skipped/unreadable: 3).

## Verification status (generated from the M26 evidence ledger)

| issue | claim level |
| --- | --- |
| G1 | verified |
| W1 | verified |
| W2 | verified |
| W3 | verified |
| W4 | verified |
| W5 | verified |
| W6 | verified |
| V1 | verified |
| D1 | verified |
| A1 | verified |
| X1 | verified |

Claim levels are the ledger's statuses at generation time. `verified`
means the issue's own mutation-gated verifier passed at the pinned
commit — it is not a promise about code written after that commit.

## Declared limitations

- Per-pair cross-language coverage is generated from what is actually
  stored; an unindexed language pair is absent, not broken.
- The table reflects this machine's `~/.bb/projects` dbs at generation
  time; other machines regenerate from their own reality.
- "Showing X of Y" is honest per render; the underlying traversal
  budgets are documented above and enforced in code.
- The webview harness verifies rendered DOM, not a live editor; the
  editor legs (M25 E5/E6) cover the in-editor regime.

