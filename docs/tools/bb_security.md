# `bb_security`

Taint-flow security scan over the indexed source-to-sink flows: SQL injection, XSS, command injection, path traversal, insecure deserialization, SSRF, open redirect and code execution. Flows whose endpoints both resolve to indexed symbols are findings; one-sided flows are reported separately as unvalidated observations, never as confirmed exploits. Findings whose underlying file changed after indexing carry a staleness marker.

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

- Normalized security findings (label, severity, calibrated confidence, sink type, source type)
- A `[scan: …]` census line stating how many taint flows were indexed, how many findings they deduplicated into, how many are being shown, and how many are beyond the cap
- One-sided flows listed separately as unvalidated observations, each with its real severity and the reason it is unvalidated
- Optional persisted run history, recording the full analysed finding set (never the display window) with evidence, confidence and limitations

## Examples

`{}`

`{"recordRun":true}`

`{"history":true}`

## Errors

- Unavailable index
- Invalid history limit (non-integer, or negative)
- Unknown option (rejected with the accepted set named)

## Limitations

- Static taint analysis can produce false positives and false negatives
- It is not runtime testing or a penetration test
- `confirmed` means both flow endpoints are indexed symbols — it does **not** prove the values are connected. The indexer pairs every taint source with every taint sink in a symbol body, so two tokens in one function produce a confirmed flow whether or not one reaches the other
- **Not detected:** hardcoded secrets (no such finding type is emitted; that rule belongs to `bb_patterns`), genuine cross-*language* taint (the `crossLanguage` flag means the flow was stitched across symbols, not that languages differ), standalone weak-crypto use (emitted as a sink with no co-located source, so it remains an observation)
- Severity is normalized into exactly `critical|high|medium|low|unknown`; an unrecognised stored value becomes `unknown` rather than vanishing from the counts

## Performance

Indexed flow analysis and output/history limits bound work and response size. The response always states the census — indexed flows, deduplicated findings, findings shown, findings beyond the cap — so a truncated scan is never presented as a complete one. `recordRun` re-scans with a census-sized cap so that persisting the history snapshot can never auto-resolve findings that were merely not examined.

## Safety

Source is read-only. recordRun writes only analysis-history records in the brain database.

## Evidence Semantics

A finding is supported by indexed source/sink locations and relationship paths; severity does not imply exploitability. Persisted history records the engine's calibrated confidence (0.7 confirmed / 0.4 observation / 0.3 mitigated), the taint-flow evidence, and the per-finding limitations. Unvalidated observations are never persisted to history.

## Relationship to other tools

For general code-quality patterns use `bb_patterns`; this tool focuses on taint flows and security findings.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
