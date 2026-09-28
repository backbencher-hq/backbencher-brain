# `bb_doc`

Generate read-only, evidence-backed documentation with resolvable citations and a freshness block over the cited files. Supports symbol, file, module, feature, API, project, and documentation-coverage modes in Markdown or JSON.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `symbol`, `file`, `module`, `feature`, `api`, `project`, `coverage`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"format":"markdown","audience":"developer","detail":"standard","includeExamples":false,"includeDiagrams":false,"includeTests":false,"limit":20,"maxTokens":4000}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": [
        "symbol",
        "file",
        "module",
        "feature",
        "api",
        "project",
        "coverage"
      ],
      "description": "documentation mode"
    },
    "target": {
      "type": "string",
      "description": "symbol, file, module, feature, or API target (`symbol`/`symbolName`/`query` are accepted as aliases); optional for project and coverage"
    },
    "format": {
      "type": "string",
      "enum": [
        "markdown",
        "json"
      ],
      "description": "output format (default markdown)"
    },
    "audience": {
      "type": "string",
      "enum": [
        "developer",
        "maintainer",
        "user",
        "website"
      ],
      "description": "documentation audience"
    },
    "detail": {
      "type": "string",
      "enum": [
        "brief",
        "standard",
        "deep"
      ],
      "description": "detail level"
    },
    "includeExamples": {
      "type": "boolean",
      "description": "include only source-backed examples"
    },
    "includeDiagrams": {
      "type": "boolean",
      "description": "include cited diagrams when available"
    },
    "includeTests": {
      "type": "boolean",
      "description": "include indexed test evidence"
    },
    "limit": {
      "type": "number",
      "description": "maximum evidence items"
    },
    "maxTokens": {
      "type": "number",
      "description": "output token budget"
    }
  },
  "required": [
    "mode"
  ]
}
```

## Returns

- Markdown or structured JSON documentation
- Resolvable citations and evidence classifications
- Quality and website reference metadata

## Examples

`{"mode":"symbol","target":"handleRequest"}`

`{"mode":"feature","target":"request handling","format":"json"}`

`{"mode":"coverage","target":"src"}`

## Errors

- Missing target for target-based mode
- Unsupported format or mode
- Unavailable indexed evidence

## Limitations

- Unknown facts remain explicit rather than inferred without support
- Stale evidence is qualified and cannot silently become current

## Performance

Evidence count and maxTokens impose explicit response budgets.

## Safety

Read-only. It never refreshes implicitly, writes source, or invokes bb_edit.

## Evidence Semantics

Claims are classified as extracted, inferred, generated, or unknown and carry resolvable citations where applicable.

## Relationship to other tools

For raw symbol metadata use `bb_search` mode `symbol`; this tool composes documented, cited explanations.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON + footer naming the remediation; per-citation `(stale)` in Sources; silent when all fresh. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it.
