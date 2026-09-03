# Edge evidence tiers — the UI legend contract (M26.W4)

Every edge in the graph webview renders a **badge** (`bb-edge-badge`) with its
tier and confidence, and every graph ships the **legend** (`renderLegend`)
below. The tier is resolved once per edge — the badge can never disagree with
the edge it sits on. Owner: `script/m26/graph-core.ts` (`TIER_MEANINGS`,
`tierForEdge`, `renderLegend`); drift-gated by
`script/m26/verify-evidence-badges.ts`.

## The five tiers, in UI terms

| tier | class | meaning shown to the user |
|---|---|---|
| structural | `bb-badge-structural` | stored or derived structure (calls/extends/implements/overrides at confidence >= 0.7) — safe to trust for navigation |
| import_based | `bb-badge-import_based` | derived from import statements — the module relationship is real, the use may be indirect |
| usage_contextual | `bb-badge-usage_contextual` | usage-site evidence — the name appears in context, not guaranteed to be a call |
| reference_qualified | `bb-badge-reference_qualified` | reference with qualifier evidence — stronger than usage_contextual, weaker than structure |
| inferred | `bb-badge-inferred` | a guess (heuristic or confidence < 0.7) — treat as a hint, never as fact |

## The confidence threshold decision, documented

The **0.7 floor** on structural edge types (calls/extends/implements/
overrides) mirrors the inheritance-confidence decision in `patterns.ts`:
at or above 0.7 a structural claim is stored or derived; below it the edge is
a **guess** and renders as `inferred` — never as structural. The hover
component (`src/lsp/cross_language_hover.ts`) applies the identical rule, so
the webview badge and the hover wording can never disagree.

## Resolution order

1. `metadata.evidenceClass` stored on the `brain_relationship` row wins
   (indexer-attested tier, passed through by the W2 transport).
2. Otherwise the declared derivation above applies (type + confidence).

## Mutation gates

- an `inferred` edge rendered as `structural` fails the suite (W4 M1)
- a badge that disagrees with its edge's resolved tier fails (W4 M2)
- a legend missing a tier (or with drifted meaning text) fails (W4 M3)

## Declared limitations

- Badge styling (colors/shape) is CSS in each editor's webview; the class
  contract above is what is verified — the class names are the honesty
  surface, the paint is presentation.
- Tiers describe relationship data quality, not symbol truth.
