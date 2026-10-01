# `bb_patterns`

Detect orphaned code, framework patterns, and anti-patterns, ranked by evidence-derived confidence, with staleness markers when a finding's file changed after indexing. Use scope=orphaned for dead code; scope=all (default) for the full pattern scan with the optional pattern/confidence filters. Architecture and code-quality analysis are planned, not yet executable.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `orphaned`, `all`
- Planned modes (roadmap, not executable): `quality`, `architecture`
- Defaults: `{"scope":"all","limit":20,"includeOrphaned":true,"includeFramework":true,"includeAntiPatterns":true,"confidenceThreshold":0,"history":false,"recordRun":false}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "enum": [
        "orphaned",
        "all"
      ],
      "description": "orphaned only, or all pattern classes (default all)"
    },
    "limit": {
      "type": "number",
      "description": "max results (default 20)"
    },
    "includeOrphaned": {
      "type": "boolean",
      "description": "include orphaned-code patterns in an all scan (default true)"
    },
    "includeFramework": {
      "type": "boolean",
      "description": "include framework patterns (default true)"
    },
    "includeAntiPatterns": {
      "type": "boolean",
      "description": "include anti-patterns (default true)"
    },
    "confidenceThreshold": {
      "type": "number",
      "description": "drop findings below this confidence (default 0 = report everything, ranked). Orphan confidence is evidence-derived and spans 0.3-0.7; anti-pattern confidence is 0.6-0.9"
    },
    "history": {
      "type": "boolean",
      "description": "return persisted pattern history"
    },
    "recordRun": {
      "type": "boolean",
      "description": "persist this scan as an analysis run (persists the whole census, not the displayed page)"
    }
  }
}
```

## Returns

- Pattern findings with confidence and locations
- Orphan, framework, and anti-pattern classifications
- Optional persisted run history

## Examples

`{"scope":"orphaned"}`

`{"confidenceThreshold":0.6}`

`{"recordRun":true}`

## Errors

- Invalid scope or confidence threshold
- Unavailable index
- Unknown option

## Limitations

- A finding is not a deletion instruction. The tool reports what the index does and does not record; where the index is silent, the finding says so on its face rather than presenting absence of evidence as evidence of absence.
- Confidence is derived from measured evidence classes, not assigned per rule. It spans 0.30-0.70 for orphans (the published cap) and 0.60-0.90 for anti-patterns. Name-unique symbols measured a 0.0% false-positive rate against a source-text oracle; ambiguous names measured 14.4%.
- A relationship only counts as usage evidence if it is not a self-loop, its published evidenceClass is not "inferred", and its confidence is at least 0.7. Refused rows are counted in `summary.unverifiedUsageEdges` and itemised on the findings they would have cleared.
- A finding whose symbol had no recorded incoming reference while its file did carries a COVERAGE GAP INDICATOR. That is the signature of an analyzer that reached the file and not the symbol, and such a finding may be a coverage gap rather than dead code.
- Dynamic dispatch, reflection, and string-keyed lookups are invisible. The engine never fabricates a resolved edge for them, so a symbol reached only that way is reported.
- False-positive rate is 0.0-27.8% by corpus, measured against a source-text oracle that cannot see reflection or template indirection — so the true rate is higher, and the number is a lower bound.
- Test files are excluded from candidates but not from evidence: a production symbol called only from a test is not reported, and a production file imported only by a test is not reported. `includeTests: true` means "also report test symbols", not "ignore tests when looking for users".
- Framework and anti-pattern detection is heuristic and confidence-qualified.

## Performance

The scan is index-bound and single-pass; the anti-pattern rules use a correlated COUNT over the member index, so cost grows with symbol count and not with the square of it. A default `bb_patterns {}` measured 6.7s on a 45,018-symbol repository, down from 330s before the query was fixed. `limit` bounds the displayed page; the census in the header is the full candidate count, and `raise \`limit\`` is named when the page is short.

## Safety

Source is read-only. recordRun writes only analysis-history records in the brain database, and persists the whole census rather than the displayed page so the auto-resolve pass cannot mark live findings as gone.

## Evidence Semantics

Every finding is confidence-qualified, carries an evidence array naming what was checked, and carries a limitations array. Two channels are kept distinct: an anchored edge from an identified symbol is decisive, while a name match clears a candidate only when the name is unambiguous in the reporting scope. `summary.suppressedByReason` accounts for every candidate the scan discarded, and `summary.importResolution` states how far the import channel could be carried.

## Relationship to other tools

For security-specific taint findings use `bb_security`; this tool covers orphans, framework patterns, and anti-patterns.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
