<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — real, abridged `bb_doc` output for one fixture: a symbol document, a project document, the stale-evidence answer, and the named refusals. Abridgements are marked where they occur.
WHO IT IS FOR — callers who want the exact shape of an answer without reading the full specification.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_doc/handler.ts, src/intelligence/documentation/doc-engine.ts, docs/BB_DOC.md, validation/tools/bb_doc/EVIDENCE.json (the run that produced these samples).
-->

# `bb_doc` example output

These samples were produced by the tool on `test/fixtures/polyglot` (a 5-file TS/JS/Java/Scala
fixture) with the working tree described in `validation/tools/bb_doc/EVIDENCE.json`. Long fact
lists are abridged and the omission is marked; nothing else is rewritten. They are output shapes,
not claims about a particular repository.

## Symbol document (Markdown)

```markdown
# symbol: total

1 file(s) and 1 symbol(s) in scope, 11 cited claim(s) across 5 section(s) from 7 source(s). No indexed evidence was found for: Tests.

## API

2 claims, 2 read directly from the index, resting on 1 source (1 symbol).

-  _(100%)_ function total(item: { price?: number }, discountPct: number): number is defined in ts-js/src/checkout.ts at lines 4-7.[1]
-  _(100%)_ total is declared public.[1]

## Behavior

3 claims, 3 read directly from the index, resting on 1 source (1 symbol). Read from the index and, where the index has none, from the comment block above the definition on disk.

-  _(100%)_ total is defined in ts-js/src/checkout.ts at line 4, takes item: { price?: number }, discountPct: number and returns number.[1]
-  _(100%)_ Its documentation (the source file on disk) says: TS checkout — calls INTO the JS module.[1]
-  _(100%)_ total has a measured complexity of 1.[1]

## Dependencies

5 claims, 5 read directly from the index, resting on 6 sources (relationship and import). Edges are read from the graph; an edge whose target the index did not resolve is marked inferred.

-  _(100%)_ checkout exports total.[2]
-  _(100%)_ total calls basePrice.[3]
-  _(100%)_ total calls applyDiscount.[4]
-  _(100%)_ ts-js/src/checkout.ts imports ./pricing.js, which is a file this project indexes.[5][6]

## Tests

No test files are indexed in this project, so total cannot be checked for test coverage.

## Limitations

1 claim, 1 read directly from the index, resting on 1 source (1 symbol). What this document cannot say is stated here rather than filled in.

-  _(100%)_ No test file is indexed in this project, so total cannot be checked for test coverage at all.[1]

## Unknowns

- No test files are indexed in this project, so total cannot be checked for test coverage. _(not-observed, affects: tests)_

## Quality

- passed: true
- factuality: true (0 uncited claim(s))
- references: true (0 broken, 0 stale, 0 missing)
- completeness: true (5/5 required sections, 1 unknown(s))
- budget: true (684/4000 tokens)
- snapshot: `5044abe2eb1171cf7883096c4a8e4c58`

## Sources

- [1](ts-js/src/checkout.ts#L4-L7) — symbol: Indexed function total
- [2](ts-js/src/checkout.ts#L4) — relationship exports: exports edge between checkout and total
- [3](ts-js/src/checkout.ts#L5) — relationship calls: calls edge between total and basePrice
- [4](ts-js/src/checkout.ts#L6) — relationship calls: calls edge between total and applyDiscount
- [5][6](ts-js/src/checkout.ts#L1) — import: Import ./pricing.js (two indexed names, one import)
```

The in-edge `checkout exports total.` is stated with the DOCUMENTED symbol as the object; an
inbound edge reads `<neighbour> <type> <documented symbol>`, never `<neighbour> <type> <neighbour>`.

## Project document (JSON, abridged)

```json
{
  "schemaVersion": "1",
  "mode": "project",
  "title": "project documentation",
  "summary": "5 file(s) and 10 symbol(s) in scope, 20 cited claim(s) across 5 section(s) from 41 source(s). No indexed evidence was found for: Risks.",
  "sections": [
    {
      "id": "architecture",
      "heading": "Architecture",
      "prose": "5 claims, 5 read directly from the index, resting on 5 sources (1 health). Counts and language mix as measured in the index.",
      "facts": [
        { "classification": "extracted", "statement": "The index holds 5 files, 13 symbols, 26 relationships and 2 imports.", "confidence": 1, "citationIds": ["health:index-totals"] },
        { "classification": "extracted", "statement": "java: 1 files, 4 symbols.", "confidence": 1, "citationIds": ["health:language:java"] }
      ],
      "citations": ["health:index-totals", "health:language:java"]
    },
    {
      "id": "risks",
      "heading": "Risks",
      "prose": "No open analysis finding, no recorded parser error and no complexity outlier is indexed for this project, so no risk is asserted here — the absence of evidence is not evidence of absence.",
      "facts": [],
      "citations": []
    }
  ],
  "citations": [
    {
      "id": "relationship:java-scala/src/main/scala/com/demo/Warehouse.scala:exports:4:_file_:Warehouse",
      "kind": "relationship",
      "path": "java-scala/src/main/scala/com/demo/Warehouse.scala",
      "lineStart": 4,
      "relationshipType": "exports",
      "evidence": "exports edge between (file) and Warehouse",
      "freshness": "fresh",
      "confidence": 1
    }
  ],
  "unknowns": [
    { "statement": "No open analysis finding, no recorded parser error and no complexity outlier is indexed for this project, so no risk is asserted here — the absence of evidence is not evidence of absence.", "reason": "not-indexed", "affectedSection": "risks" }
  ],
  "quality": {
    "passed": true,
    "factuality": { "passed": true, "uncitedClaims": 0, "unsupportedClaims": 0 },
    "references": { "passed": true, "broken": 0, "stale": 0, "missing": 0, "collectedStale": 0, "collectedMissing": 0 },
    "completeness": { "passed": true, "covered": 4, "expected": 4, "unknown": 6 },
    "freshness": { "passed": true, "snapshot": "5044abe2eb1171cf7883096c4a8e4c58", "staleClaims": 0 },
    "budget": { "passed": true, "estimatedTokens": 4628, "maxTokens": 16000 },
    "bounds": {
      "perSection": 5,
      "sections": [
        { "id": "architecture", "available": 6, "capped": 5, "droppedForBudget": 0, "emitted": 5 },
        { "id": "risks", "available": 0, "capped": 0, "droppedForBudget": 0, "emitted": 0 }
      ]
    },
    "warnings": ["23 collected citation(s) were not emitted because no fact referred to them"]
  },
  "reference": {
    "projectId": "24cb6a202c39689cc13693683c490bbb9ced1f80",
    "projectPath": "<project>",
    "snapshotId": "5044abe2eb1171cf7883096c4a8e4c58",
    "generatedAt": "2026-11-01T20:28:47.755Z",
    "indexVersion": "v1.0.0",
    "schemaVersion": 1,
    "sourceLanguage": "java",
    "canonicalPath": "project",
    "slugs": ["project"],
    "tags": ["project", "developer", "standard"],
    "relatedReferences": [],
    "diagrams": []
  }
}
```

`quality.references.stale`/`missing`/`broken` describe the citations that survive into the answer;
`collectedStale`/`collectedMissing` report everything the generator gathered. `bounds` closes:
`emitted + droppedForBudget === capped`, and `emitted` is read back off the finished section.

## Stale evidence, declined repair (real answer fragments)

A source file edited after indexing, asked with `refresh: false`:

```json
{
  "freshness": {
    "fresh": 0,
    "stale": 1,
    "missing": 0,
    "staleRatio": 1,
    "mode": "complete",
    "remediation": "1 stale in this file — reads auto-refresh this file within budget when enabled — disable with BB_NO_AUTO_REFRESH=1 or refresh=false; manual repair: run: bb index \"src/math.ts\" (or the bb_index tool with that file path)"
  },
  "autoRefresh": "auto-refresh disabled (BB_NO_AUTO_REFRESH or refresh=false)",
  "references": { "passed": true, "broken": 0, "stale": 2, "missing": 0, "collectedStale": 3, "collectedMissing": 0 }
}
```

The Markdown answer closes with the decline line and the footer, in the document's own vocabulary:

```
auto-refresh disabled (BB_NO_AUTO_REFRESH or refresh=false)

---
1 stale, 0 missing of 1 cited file(s) — this read does NOT auto-refresh — the rows describe the index as it stands; manual repair: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only)
```

A document citing exactly one file gets the file-scope remediation; a document citing several
gets the project-scope one. With the repair enabled the answer instead carries
`auto-refreshed 1 file in …ms` and is regenerated before it is returned.

## Refusals (real messages)

```
bb_doc limit must be a whole number between 1 and 100 (default 20) — got 101. It is refused rather than clamped because the document would not be the one requested.

bb_doc maxTokens must be a whole number between 1 and 16000 (default 4000) — got 0. Raise it or narrow the target; there is no larger ceiling.

bb_doc includeTests is accepted for symbol and feature modes only — file mode renders no test evidence, so the option would do nothing.

bb_doc module mode: no indexed file matches the module "nope" — tried the repository-relative directory prefix "nope/" and the path prefix "nope". Pass a repository-relative directory that the index holds (e.g. "src/lib"), or use mode "file" for a single file.
```
