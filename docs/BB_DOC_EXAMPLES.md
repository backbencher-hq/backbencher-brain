# `bb_doc` Example Corpus

These examples are normative shapes, not claims about a particular repository.
They demonstrate the required distinction between extracted facts, bounded
inferences, generated prose, and unknown information.

## Requests For Every Mode

### Symbol

```json
{"mode":"symbol","target":"handleRequest","format":"markdown","audience":"developer","detail":"deep","includeTests":true}
```

Expected focus: exact signature and location, behavior supported by source,
callers/callees, test evidence, and explicit unknown error behavior.

### File

```json
{"mode":"file","target":"src/http/router.ts","format":"json","detail":"standard","includeExamples":false}
```

Expected focus: file purpose, public symbols, imports/exports, syntax state, and
freshness. A purpose not stated in source must be classified as inferred.

### Module

```json
{"mode":"module","target":"src/intelligence/search","format":"markdown","audience":"maintainer","includeDiagrams":true}
```

Expected focus: module boundary, entry points, public surface, internal files,
and a bounded dependency diagram whose nodes and links carry citation IDs.

### Feature

```json
{"mode":"feature","target":"analysis finding lifecycle","format":"json","detail":"deep","includeTests":true,"limit":30}
```

Expected focus: semantically discovered candidates followed by cited entry
points, execution flow, persistence relationships, and tests. Semantic matches
alone cannot support behavior claims.

### API

```json
{"mode":"api","target":"src/api/users.ts","format":"markdown","audience":"user","includeExamples":true}
```

Expected focus: detected endpoints or exported API symbols, cited inputs and
outputs, observed error contracts, and source-backed examples. HTTP status
codes absent from evidence are emitted as unknown.

### Project

```json
{"mode":"project","format":"json","audience":"website","detail":"brief","maxTokens":4000}
```

Expected focus: indexed language/file/symbol inventory, architecture entry
points, health state, high-confidence risks, and stable website metadata.

### Coverage

```json
{"mode":"coverage","target":"src/public","format":"json","audience":"maintainer","limit":100}
```

Expected focus: documented and undocumented public symbols, stale references,
unsupported evidence, and deterministic covered/expected/unknown counts.

## Symbol Markdown

```markdown
# `handleRequest`

Handles a request and returns a string. [1]

## Signature

`handleRequest(req: Request): string` [1]

## Dependencies

- Calls `parseBody`. [2]
- Defined in `src/app.ts`. [1]

## Limitations

- Error behavior is unknown: no indexed error contract was found. [3]

## Sources

[1]: src/app.ts#L12-L18
[2]: src/app.ts#L14
[3]: unavailable: no error-contract evidence
```

The first two statements are extracted from source and relationships. The
error statement is an explicit unknown; it is not replaced with a guessed
exception description.

## Project JSON

```json
{
  "schemaVersion": "1",
  "mode": "project",
  "title": "Project reference",
  "summary": "Indexed project inventory with cited entry points.",
  "sections": [
    {
      "id": "architecture",
      "heading": "Architecture",
      "prose": "The project has two indexed modules connected by an import edge.",
      "facts": [
        {
          "classification": "inferred",
          "statement": "src/api is an entry module because it is exported and has incoming references.",
          "confidence": 0.82,
          "citationIds": ["c1", "c2"]
        }
      ],
      "citations": ["c1", "c2"]
    }
  ],
  "citations": [
    {
      "id": "c1",
      "kind": "file",
      "path": "src/api/index.ts",
      "lineStart": 1,
      "lineEnd": 20,
      "evidence": "exports createApp",
      "freshness": "fresh",
      "confidence": 1
    },
    {
      "id": "c2",
      "kind": "relationship",
      "path": "src/server.ts",
      "relationshipType": "imports",
      "evidence": "server imports src/api/index.ts",
      "freshness": "fresh",
      "confidence": 0.96
    }
  ],
  "unknowns": [
    {
      "statement": "Deployment topology is unknown.",
      "reason": "not-observed",
      "affectedSection": "architecture"
    }
  ],
  "quality": {
    "passed": true,
    "factuality": { "passed": true, "uncitedClaims": 0, "unsupportedClaims": 0 },
    "references": { "passed": true, "broken": 0, "stale": 0, "missing": 0 },
    "completeness": { "passed": true, "covered": 2, "expected": 2, "unknown": 1 },
    "freshness": { "passed": true, "snapshot": "snapshot-abc", "staleClaims": 0 },
    "budget": { "passed": true, "estimatedTokens": 620, "maxTokens": 4000 },
    "warnings": []
  },
  "reference": {
    "projectId": "project-id",
    "projectPath": "/workspace/project",
    "snapshotId": "snapshot-abc",
    "generatedAt": "2026-08-09T00:00:00.000Z",
    "indexVersion": "v1",
    "schemaVersion": 13,
    "sourceLanguage": "typescript",
    "canonicalPath": "project/architecture",
    "slugs": ["project", "architecture"],
    "tags": ["api", "entry-point"],
    "relatedReferences": [],
    "diagrams": []
  }
}
```

## Stale Evidence

```json
{
  "classification": "unknown",
  "statement": "The current return behavior cannot be confirmed.",
  "confidence": null,
  "citationIds": ["stale-1"],
  "reason": "stale-evidence"
}
```

Stale inventory facts may remain visible with a warning, but current behavior,
API contracts, and examples must be downgraded to unknown until reindexed.
