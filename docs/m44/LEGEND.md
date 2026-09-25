# bb/graph — the badge legend (M44.U4)

GENERATED from the live core (`script/m26/graph-core.ts` `renderLegend`) —
the drift gate is byte-identical regeneration by `script/m44/verify-legend.ts`.
One legend ships with every hub list, hub tree, graph, and impact render (§13.9).

## Edge evidence tiers:

- tier `structural` — structural: stored or derived structure (calls/extends/implements/overrides/contains/exports/instantiates at confidence >= 0.7) — safe to trust for navigation
- tier `import_based` — import_based: derived from import statements — the module relationship is real, the use may be indirect
- tier `usage_contextual` — usage_contextual: usage-site evidence — the name appears in context, not guaranteed to be a call
- tier `reference_qualified` — reference_qualified: reference with qualifier evidence — stronger than usage_contextual, weaker than structure
- tier `inferred` — inferred: a guess or an unrecognized relationship kind (heuristic, or confidence < 0.7) — treat as a hint, never as fact
## Enrichment annotations:

- enrichment — ⌾ role/pattern/layer/criticality — inferred by the index enrichment pass (M40); an annotation, never an evidence tier.
## Staleness:

- status `fresh` — fresh — indexed data matches the files on disk; no marker is shown
- status `stale` — ⚠️ stale — the file changed since indexing (or a reindex is pending); the data may be outdated — refresh before trusting it
- status `missing` — missing — an indexed file is no longer on disk; the data refers to a file that moved or was deleted
- status `unknown` — unknown — freshness cannot be claimed for this file; declared unknown, never silently fresh
