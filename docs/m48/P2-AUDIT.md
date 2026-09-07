# M48.P2 honesty-field audit (#697)

Rule: a tool output field that claims completeness or absence ("truncated",
"declaredAbsent", "complete", "sampled", and any boolean that reads as "I
checked everything") must be able to be FALSE and must be set from real
measurements. A field that structurally cannot flip is hollow and is fixed or
removed — it is never called verified.

## How each state is proven

- **TRUE state**: fixture that makes the field true (e.g. >200 callers for
  impact truncation; a real annotation row for declaredAbsent:false).
- **FALSE state**: fixture that makes the field false (e.g. a small call
  graph; an empty annotation store).
- Static self-audit: `script/m48/verify-p2-honesty-fields.ts` scans every tool
  output builder for watchlist keys assigned only a single literal with no
  dynamic or opposite assignment anywhere in that builder — such a field is
  hollow and fails the gate.

## Audit table (16 tools)

| Tool | Completeness/absence fields | Can be false? | Proof |
| --- | --- | --- | --- |
| bb_search | `stale` per row (dynamic); freshness block counts (dynamic) | yes | freshness resolver (m35 chain) |
| bb_ask | provenance `truncated`/`sampled` optional (evidence defaults, overridden) | yes | quick-answer provenance |
| bb_health | freshness `sampled`/`complete` label; integrity check fields | yes | health-provider dynamic |
| bb_patterns | run history `truncated` where capped; findings caps | yes | run-history/patterns dynamic |
| bb_security | findings caps/truncation from analysis | yes | cross-language-security dynamic |
| bb_visualize | `truncated` + `truncationReason` | yes | visualization-engine dynamic |
| bb_migrate | `truncated` + reason (plans cap) | yes | migration-engine dynamic |
| bb_analyze | impact `truncated`/`depthCap`/`depthReached`/`totalSymbols` | **yes — proven** | M48.P1 gate: 250-caller fixture → truncated:true on both doors; small graph → false |
| bb_doc | citation/coverage counts; no hollow boolean | yes | doc-engine dynamic |
| bb_edit | `isError`/rollback state (write results) | yes | edit-engine dynamic |
| bb_index | counts (indexed/deleted/errors) | n/a counts | parallel-indexer real counts |
| bb_graph | summary `truncated` + `truncationReason` | yes | graph-engine summary dynamic |
| bb_impact | `truncated` + `totalCountIfKnown` (null declared unknown) | **yes — proven** | M48.P1 gate truncated case |
| bb_cross_language | declared absence (facts empty) | **yes — proven** | P2 fixture + real multi-lang repos (C1) |
| bb_annotate | n/a (write) | — | write returns rowId |
| bb_annotations | `declaredAbsent` | **yes — proven both states** | P2 gate: empty store → true; after bb_annotate → false |

## Resolved defects

1. **bb_analyze impact** (the original hollow field): `truncated:false` that
   could never be true while a depth-3 cap silently dropped dependents —
   FIXED in M48.P1 by aggregating the canonical `computeImpact` walk; the
   field now comes from the real result, can be true, and depth limits are
   declared. Evidence: `validation/m48/results/P1.json`.
2. **Legacy `analyzeImpact`** (no longer tool-reachable after P1): carries the
   same structural depth-cap limitation — DEPRECATED (never wire into a tool);
   the P2 gate fails if any handler imports it.

## Out of scope (honest note)

LSP/hub-side surfaces (`src/lsp/navigation.ts`, `call_hierarchy.ts`,
`symbols.ts`) contain constant `found`/`truncated` fields. They are editor
surfaces (hub lane, M47), not MCP tool outputs, and are not changed here.
