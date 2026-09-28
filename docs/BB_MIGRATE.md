# `bb_migrate` Reference

`bb_migrate` is a read-only migration planner. It accepts `symbolNames` for
batch planning and retains `symbolName` as a single-symbol compatibility alias.

## Output

The normalized result includes:

- one plan per supported symbol
- `dependencyOrder`, a deterministic topological order over resolved plan relationships, with dependency nodes before their dependents
- source-to-target library mappings with confidence, explicit `supported`/`uncertain` status, and notes
- effort, complexity, risk factors, and strategy steps
- `unsupported` symbols with explicit reasons
- methodology totals: base setup hours, relationship hours, relationship count, and missing-mapping hours/count
- structured `relationshipEvidence` per plan, including stable relationship identity, symbol IDs, paths, type, and strength
- explicit request/response truncation metadata

JSON is machine-readable; text preserves the legacy readable plan style while
adding ordering, methodology, unsupported cases, and truncation.

## Methodology

- 4 base hours per supported component
- 2 hours per unique structured relationship identity across the requested plans
- 6 hours per unsupported library mapping
- relationship evidence is scoped to the exact endpoint symbol IDs; unrelated relationships in the same file are excluded
- dependency-first ordering is deterministic for equal inputs and is derived from resolved directed relationship edges, not dependency counts
- strategy-step text is presentation-only and cannot alter methodology totals
- missing relationship evidence is represented by a zero measured count only when the indexed relationship collection was available; unavailable evidence must remain an explicit limitation
- `dependencyGraph` reports resolved edges, unresolved dependencies, cycles, and `orderingStatus` (`complete`, `partial`, `cyclic`, or `no-edges`)
- cyclic or incomplete graphs are surfaced explicitly and must not be interpreted as a complete dependency order

Unknown library equivalents have `target: null`, `status: "uncertain"`, and an explicit `unsupportedReason`; they are never presented as supported mappings. Same-language, missing-symbol, invalid-target, and unsupported cases appear in `unsupported`.

```json
{"symbolNames":["authenticate","authorize"],"targetLanguage":"go","format":"json"}
```
