<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_migrate: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_migrate through any MCP host, the CLI (`bb tool bb_migrate`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_migrate/descriptor.ts, src/mcp/tools/bb_migrate/handler.ts, script/tool-docs/curation/bb_migrate.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_migrate --write`.
-->
# `bb_migrate`

Read-only single or batch migration planning with dependency order, explicit effort methodology, library mappings, risks, truncation, and unsupported cases. A request is a list of entries (symbol names, indexed symbol ids, project-relative paths) unioned and capped at 100; every entry resolves to at most one component before any relationship is read, and a component named through more than one entry is planned once. Plans whose source file changed since the last index are flagged stale up front — a plan is a claim about current code; JSON output carries the freshness block.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `plan`
- Planned modes (roadmap, not executable): (none)
- Defaults: `{"format":"text"}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "symbolName": {
      "type": "string",
      "description": "legacy single-symbol alias for symbolNames; when both are supplied the entries are UNIONED, never silently dropped"
    },
    "symbolNames": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "one or more component names; a name that matches several symbols in different files is refused with candidate ids to re-run against symbolIds. Blank entries are refused by name"
    },
    "paths": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "project-relative file or DIRECTORY paths (absolute paths inside the project are accepted); every indexed symbol in them joins the request, so a whole module can be planned in one call. UNION with symbolNames, not a replacement: naming a symbol AND a path that contains it plans it once. A path that matches no indexed file is refused by name"
    },
    "symbolIds": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "indexed symbol ids (shape `<projectId>:<relative file>:<name>:<line>`), the ONLY unambiguous way to name a component. Use this when a refusal reported that a name matches several symbols; a name is not an identity, and ids come from an earlier result's plans or an ambiguity refusal's candidates. An id no symbol carries is refused by name"
    },
    "targetLanguage": {
      "type": "string",
      "description": "e.g. rust, go, python. An unknown target is refused; a known target with no dictionary rows for the source pair is planned with the missing-data gap declared and no mapping invented. Blank is refused"
    },
    "format": {
      "type": "string",
      "enum": [
        "text",
        "json"
      ],
      "description": "output format (default text)"
    }
  },
  "required": [
    "targetLanguage"
  ]
}
```

## Returns

- Dependency-ordered migration plans, grouped into parallel-workable waves, one plan per component named by the request
- Scope completeness: how much of the cited integration surface the request actually covers
- Cohort rollup by source file and by wave, plus the zero-indexed `cohort.wavePlan` keyed by symbol id
- Effort methodology with its rates published as data, library mappings by provenance, and measured risks
- Explicit unsupported entries with typed reasons (missing-symbol, ambiguous-symbol with candidate ids, same-language, unsupported-source, unsupported-target)
- Truncation split into `deduplicated` (entries that resolved to an already-planned component) and `capped` (entries the 100-entry cap dropped, named in `cappedNames`)
- Freshness of every plan's source file: per-plan `stale` flags, an up-front stale-plan notice in text, and the `freshness` envelope in JSON

## Examples

`{"symbolName":"handleRequest","targetLanguage":"go"}`

`{"symbolNames":["parse","handle"],"targetLanguage":"rust","format":"json"}`

`{"paths":["src/api"],"targetLanguage":"go"}`

`{"symbolIds":["<projectId>:src/api/handler.ts:handleRequest:12"],"targetLanguage":"go"}`

## Errors

- Missing targetLanguage
- A blank targetLanguage (refused: the tool will not resolve an empty language name)
- No symbolName, symbolNames, symbolIds or paths
- A blank entry in symbolNames, symbolIds or paths (refused by name: a blank entry would silently narrow the request)
- A path that matches no indexed file (the tool says so rather than returning an empty plan set)
- A symbol id that no indexed symbol carries (the tool names the id, because an id is the only unambiguous selector)
- No index for the project (the tool is read-only and refuses with the `bb index` remediation rather than creating one)
- Unknown option (the door names the accepted options)

## Limitations

- Plans are estimates, not translated source; the tool does not generate, replace or compile target-language code
- Library mappings are advisory and unsupported routes remain explicit; an unmapped third-party library is named at confidence 0 and charged 6h of research, never claimed as supported
- A library with an observed import but no registered target is reported with `target: null` and `confidence: 0` — declared absence, never an invented equivalence
- Dependency ordering and mapping depend on the analyzer-extracted symbol and relationship graph; reflection, dynamic dispatch, or relations the grammar does not model limit the completeness of the resulting plan
- A request names a bounded set of components, and the cited integration surface is usually much larger: measured 98.6-99.8% out of scope on the cobra corpus for requests of 1-16 symbols. The `scope` block reports this on every result
- The dictionary carries 486 rows across 30 source languages and 21 target languages, covering 126 of the 630 possible source-to-target pairs (20%). Two keys (`flutter/material`, `shadcn/ui` — 4 of 486 rows, 0.8%) cannot be produced by import canonicalization at all; the audit enforces that class in both directions. A further 31 rows carry knowledge an import lookup can only reach through a specifier real source code does not write (API idioms such as `pool.query`, a framework name, 16 Flutter widget or type names, and display names with spaces) — they are kept, and this is their stated limit. Audited by script/m20/verify-migration-dictionary.ts

## Performance

Work is bounded by the request, not by repository size. A request is capped at 100 entries, and each entry resolves to at most one component before any relationship is read, so a common name cannot expand the load: on the 6,452-file / 310,423-symbol reference index a 12-name batch loaded 844 symbols and 46,753 relationships before this rule and stays inside the 5 s read-tool budget after it. `cohort.work` reports what a call actually read, and `truncation.cappedNames` names every dropped entry.

## Safety

Read-only, including the index open: plans are computed from a byte-read-only connection, no migrations run on a read, and the tool never creates an index. It does not generate, replace, or compile target-language source.

## Evidence Semantics

Dependency ordering comes from indexed relationships; effort and library mappings are labelled methodology-driven estimates, with the rates published as data. Relationship line, confidence, cross-language flag, bridge mechanism and both external endpoint names are read from the index; none is synthesized.

## Relationship to other tools

For dependency structure use `bb_graph`; this tool produces migration plans with declared limitations.

## Deep guides

- [Migration plans, ordering and honesty](../BB_MIGRATE.md)

## Staleness

Freshness modes (registered as `freshnessModes`): `plan`. Staleness surfaces as: per-plan `sourceFile` + `stale` flags with an up-front stale-plan notice + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON. This tool does NOT auto-refresh and has no `refresh` option: the flags and the envelope DESCRIBE the index as it stands, and the repair is manual — project scope → run: `bb index --changed` (or the `bb_index` tool with the project path — incremental, changed files only); file scope → run: `bb index "<file>"` for the file the plan belongs to. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
