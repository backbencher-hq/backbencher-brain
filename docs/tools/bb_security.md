# `bb_security`

Cross-language security scan: SQL injection, XSS, command injection, hardcoded secrets, weak crypto. Findings whose underlying file changed after indexing carry a staleness marker.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `findings`
- Planned modes (roadmap, not executable): `flow`, `summary`, `hotspots`
- Defaults: `{"history":false,"recordRun":false,"limit":20}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "history": {
      "type": "boolean",
      "description": "return persisted security history"
    },
    "recordRun": {
      "type": "boolean",
      "description": "persist this scan as an analysis run"
    },
    "limit": {
      "type": "number",
      "description": "history run limit (default 20)"
    }
  }
}
```

## Returns

- Normalized security findings
- Cross-language source-to-sink flow evidence
- Optional persisted run history

## Examples

`{}`

`{"recordRun":true}`

`{"history":true}`

## Errors

- Unavailable index
- Invalid history limit
- Unknown option

## Limitations

- Static taint analysis can produce false positives and false negatives
- It is not runtime testing or a penetration test

## Performance

Indexed flow analysis and output/history limits bound work and response size.

## Safety

Source is read-only. recordRun writes only analysis-history records in the brain database.

## Evidence Semantics

A finding is supported by indexed source/sink locations and relationship paths; severity does not imply exploitability.

## Relationship to other tools

For general code-quality patterns use `bb_patterns`; this tool focuses on taint flows and security findings.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
