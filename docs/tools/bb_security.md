<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_security: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_security through any MCP host, the CLI (`bb tool bb_security`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_security/descriptor.ts, src/mcp/tools/bb_security/handler.ts, script/tool-docs/curation/bb_security.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_security --write`.
-->
# `bb_security`

Taint-flow security scan over the indexed source-to-sink flows: SQL injection, XSS, command injection, path traversal, insecure deserialization, SSRF, open redirect and code execution. Flows whose endpoints both resolve to indexed symbols are findings; one-sided flows are reported separately as unvalidated observations, never as confirmed exploits. Reads are read-only against the index; an unindexed project is refused by name. Findings whose underlying file changed after indexing carry a staleness marker.

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

- A findings answer: one line per finding with severity, label, symbol, resolved `file:line`, source and sink type, and `[mitigated]` / `[stale]` flags when they apply — at most 20 findings are rendered per answer
- A `[scan: …]` census line stating how many taint flows were indexed, how many findings they deduplicated into, how many are shown, how many are beyond the scan cap, and — when the cap bites — the explicit `CAPPED at <cap>` sentence naming how many findings were not examined
- One-sided flows listed separately as unvalidated observations, each with its real severity, its location and the reason it is unvalidated (at most 5 rendered; the census names the total)
- A staleness footer only when a finding's file changed after indexing: `N stale, M missing of K finding file(s)` plus the manual repair command; silence when everything is fresh
- A history answer: a JSON page with the persisted runs (bounded by `limit`), the persisted findings (capped at 200 with `findingsTotal`/`findingsShown`/`findingsTruncated`), the finding-state summary, and a `census` object. Persisted findings carry the engine's evidence, calibrated confidence and per-finding limitations; unvalidated observations are never persisted

## Examples

`{}`

`{"recordRun":true}`

`{"history":true}`

## Errors

- Unavailable index — every door (MCP, CLI, library) refuses by name; a read never creates an index
- Invalid history limit (non-integer, or negative)
- Unknown option (rejected with the accepted set named)
- `limit` without `history: true` (refused: it would be accepted and then ignored)
- `history` together with `recordRun` (refused: they are different answers; pass one)

## Limitations

- Static taint analysis can produce false positives and false negatives
- It is not runtime testing or a penetration test
- `confirmed` means both flow endpoints are indexed symbols — it does **not** prove the values are connected. The indexer pairs every taint source with every taint sink in a symbol body, so two tokens in one function produce a confirmed flow whether or not one reaches the other
- **Not detected:** hardcoded secrets (no such finding type is emitted; that rule belongs to `bb_patterns`), genuine cross-*language* taint (the `crossLanguage` flag means the flow was stitched across symbols, not that languages differ), standalone weak-crypto use (emitted as a sink with no co-located source, so it remains an observation)
- Severity is normalized into exactly `critical|high|medium|low|unknown`; an unrecognised stored value becomes `unknown` rather than vanishing from the counts. Persisted history stores the normalized grade of a confirmed/mitigated flow, so an ungradeable resolved flow is recorded as `unknown`
- A parameterized or escaped sink may still be reported: the indexer matcher is token-based and does not track sanitizers, so validate a critical finding against the actual data flow before acting on it

## Performance

A findings answer is bounded by the engine's scan cap (500 flows) and renders at most 20 findings plus 5 observations; the census line states when the cap dropped findings. `recordRun` re-scans with a census-sized cap (50,000) so the persisted snapshot is the analysed set rather than the display window, and the same CAPPED sentence appears if even that cap bites. A history answer is bounded by `limit` on runs and by a 200-finding page with the true total declared. Reads open the index read-only and never reindex a file.

## Safety

Reads are read-only: the index is opened with the driver's read-only mode, so a read runs no migrations and moves no WAL. `recordRun` is the one write — it stores analysis-history rows — and, because it opens the database for writing, it may also run the additive open-path migrations every write path runs. No source file is ever modified.

## Evidence Semantics

A finding is supported by indexed source/sink locations and relationship paths; severity does not imply exploitability. The text answer renders the finding's location, source and sink type; the calibrated confidence (0.7 confirmed / 0.4 observation / 0.3 mitigated) and the taint-flow evidence are carried in the history JSON, which is the persisted evidence. Unvalidated observations are never persisted to history.

## Relationship to other tools

For general code-quality patterns use `bb_patterns`; this tool focuses on taint flows and security findings.

## Deep guides

- [Security: taint flows, tiers, and what is not detected](../BB_SECURITY.md)

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh. This tool does not auto-refresh and has no `refresh` option: a touched finding file is marked `[stale]` and the footer names the MANUAL repair — run: `bb index --changed` (or the `bb_index` tool with the project path — incremental, changed files only). Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
