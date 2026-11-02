<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_doc: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_doc through any MCP host, the CLI (`bb tool bb_doc`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_doc/descriptor.ts, src/mcp/tools/bb_doc/handler.ts, script/tool-docs/curation/bb_doc.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_doc --write`.
-->
# `bb_doc`

Generate read-only, evidence-backed documentation with resolvable citations and a freshness block over the cited files. Every mode emits its declared section set, an empty result is never reported as passing, and the output budget is enforced on the payload the caller receives: `quality.budget.estimatedTokens` is measured on the decorated answer, and `estimatedTokens * 4` is never smaller than what was sent. When the required sections cannot fit, the result says so rather than dropping one. `quality.references` counts the citations the answer EMITS (plus the `collected*` totals of everything gathered), so the stale/missing numbers match the Sources list. Supports symbol, file, module, feature, API, project, and documentation-coverage modes in Markdown or JSON. When the cited files are stale, the handler auto-refreshes exactly those files within the shared budget and regenerates the document; refresh=false opts out and answers from existing data with the freshness block. A module target that matches no indexed file is refused by name rather than answered with project-wide facts, and `limit`/`maxTokens` outside their ranges are refused rather than clamped.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `symbol`, `file`, `module`, `feature`, `api`, `project`, `coverage`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"format":"markdown","audience":"developer","detail":"standard","includeExamples":false,"includeDiagrams":false,"includeTests":false,"limit":20,"maxTokens":8000}`

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
      "description": "symbol, file, module, feature, or API target (`symbol`/`symbolName`/`query` are accepted as aliases); optional for project and coverage. `symbol` matches an indexed name, qualified name or its last dotted/`::` segment. `file` accepts an exact repository-relative path, an absolute path, a directory prefix, or a bare file name with or without its extension. `module` needs a repository-relative directory the index holds; a target that matches nothing is REFUSED with the forms tried. `project` accepts a target but uses it as document metadata only — it does not scope the selection."
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
      "description": "documentation audience: selects OPTIONAL sections only; a required section is never dropped for a smaller audience"
    },
    "detail": {
      "type": "string",
      "enum": [
        "brief",
        "standard",
        "deep"
      ],
      "description": "detail level: `brief` caps each section at 5 facts and drops optional sections, `standard` caps at `limit`, `deep` caps at 3x`limit` and adds the optional all-edges section; for `feature` it also enables semantic candidate expansion, which is much slower"
    },
    "includeExamples": {
      "type": "boolean",
      "description": "include source-backed examples. No example is emitted when no cited snippet or verified contract supplies one; an honest not-observed unknown is recorded instead"
    },
    "includeDiagrams": {
      "type": "boolean",
      "description": "include cited diagrams when available. This implementation does not emit diagrams; `reference.diagrams` stays empty and an honest not-observed unknown is recorded"
    },
    "includeTests": {
      "type": "boolean",
      "description": "include indexed test evidence. Accepted for `symbol` and `feature` modes only (their documents render a test section); the other modes REFUSE it because it would do nothing. Absent means the mode default (on); explicit false suppresses the test facts"
    },
    "limit": {
      "type": "number",
      "minimum": 1,
      "maximum": 100,
      "description": "maximum evidence items per section (whole number 1-100, default 20). Out-of-range values are REFUSED, not clamped, so the page returned is the page requested"
    },
    "maxTokens": {
      "type": "number",
      "minimum": 1,
      "maximum": 16000,
      "description": "output token budget measured on the emitted payload (whole number 1-16000, default 8000; the default clears the measured minimum honest rendering on the reference index, ~6,700 tokens). `estimatedTokens` reports that measurement; when the required sections cannot fit, `budget.passed` is false and a shortfall unknown names the smallest honest rendering. Out-of-range values are REFUSED"
    },
    "refresh": {
      "type": "boolean",
      "description": "false opts out of the inline auto-refresh of the files this document cites (default: auto-refresh those files within the shared budget, then regenerate); the decision is always declared in `autoRefresh` or the answer text"
    }
  },
  "required": [
    "mode"
  ]
}
```

## Returns

- Markdown or structured JSON documentation: title, summary, the mode's declared sections, citation objects with stable IDs and per-citation freshness, and declared unknowns
- `quality`: the four-term verdict, emitted-citation reference counts (`broken`/`stale`/`missing` plus the `collectedStale`/`collectedMissing` totals of everything gathered), completeness against the declared section set, the index snapshot, and the payload-measured budget
- `quality.bounds`: per-section numbers — `available`, `capped`, `droppedForBudget`, `emitted` — with `emitted + droppedForBudget === capped` enforced before the result is returned
- A declared selection bound when a scope has more indexed symbols than the evidence limit selected, naming both numbers
- `reference`: stable website keys (`projectId`, `snapshotId`, `generatedAt`, `indexVersion`, `schemaVersion`, `sourceLanguage`, `canonicalPath`, `slugs`, `tags`) and an empty `diagrams` array
- An `autoRefresh` line whenever stale cited files were repaired or a repair was declined, with the reason

## Examples

`{"mode":"symbol","target":"handleRequest"}`

`{"mode":"feature","target":"request handling","format":"json","detail":"deep"}`

`{"mode":"coverage","target":"src","audience":"maintainer"}`

## Errors

- Missing mode, or a mode outside symbol|file|module|feature|api|project|coverage
- Missing target for `symbol`, `file`, `module` or `feature`
- `limit` outside 1-100, or `maxTokens` outside 1-16000 — refused with the accepted range rather than clamped
- `includeTests` on a mode that renders no test evidence (everything except `symbol` and `feature`)
- A `module` target that matches no indexed file — refused by name, with the two directory forms it tried
- An invalid `format`, `audience` or `detail` value (rejected by the registry validator with the accepted enum)
- Unavailable indexed evidence

## Limitations

- Unknown facts are explicit, and a required section that renders empty says why in its own words; a document with no cited claim never reports `passed`
- Stale evidence is qualified per citation and counted as `freshness.passed: false`; it cannot silently become current
- `includeTests` is a real option only where a test section is rendered: `symbol` and `feature`. The other modes refuse it instead of accepting a no-op
- `project` mode accepts a target but uses it as document metadata; it does not scope the selection
- `feature` mode's semantic candidate expansion is opt-in via `detail: "deep"`; every other call is lexically discovered and says so, because semantic expansion measured 19-52 s on a 310k-symbol index
- A scope with more indexed symbols than `2 x limit` reports the selection bound (`selected` of `available`) rather than implying it mapped the whole set
- When the required sections cannot fit `maxTokens`, the result is returned with `budget.passed: false` and the smallest honest rendering named; it is never met by dropping a required section

## Performance

Measured warm on the reference index (6,452 files, 310,423 symbols, 820,040 relationships): default calls take symbol 0.24 s, file 0.19 s, module 0.42 s, api 1.03 s, project 0.76 s, coverage 0.07 s, feature 1.97 s (p50; five runs, p95 at most 3.65 s). A COLD first default call in a fresh process is 3.9 s on a cold page cache (930 ms with a warm one) and the read-only database open is 2 ms; the cold cost is index page-cache warm-up, not query time, and it is declared here rather than hidden by the warm figures. `feature` with `detail: "deep"` adds a semantic candidate pass (measured 18.0 s and 926 MB on the reference index) and is the only shape that can approach the client timeout; the default feature call is lexical and 2 s. Work is bounded by the request: the evidence limit bounds the facts, the per-section cap bounds each section, and `maxTokens` bounds the emitted payload. The default budget is 8,000 tokens because the measured minimum honest rendering of a project document on the reference index is about 6,700 tokens; a 4,000-token default could not be honoured by its own reference call.

## Safety

Read-only with one bounded, declared exception: when the files a document cites are stale, the handler reindexes exactly those cited files (at most 25 files / 2 MiB per call) and regenerates. `refresh:false` or `BB_NO_AUTO_REFRESH=1` opts out and the answer declares the decline. It never writes source, never creates a file, never calls bb_edit, and never touches a file the document does not cite.

## Evidence Semantics

Claims are classified as extracted, inferred, generated or unknown and carry resolvable citations; relationship facts name the symbol on the other end of the edge, with inbound edges naming the documented symbol. `quality.references` counts the citations the answer emits so the stale/missing numbers can be checked against the Sources list.

## Relationship to other tools

For raw symbol metadata use `bb_search` mode `symbol`; this tool composes documented, cited explanations. For cross-language reference facts on one symbol use `bb_cross_language`; for graph traversal use `bb_graph`.

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON + footer naming the remediation; per-citation `(stale)` in Sources; silent when all fresh. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → `reads auto-refresh stale files within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)`; file scope → `reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index "<file>" (or the bb_index tool with that file path)`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
