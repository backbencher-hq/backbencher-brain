# `bb_doc` Design Specification (M9.15)

`bb_doc` is a read-only documentation generator over indexed brain evidence.
It produces cited Markdown or website-consumable JSON. It never writes to a
repository; generated source changes must use `bb_edit`.

## Contract

### Input

```ts
type DocMode = "symbol" | "file" | "module" | "feature" | "api" | "project" | "coverage"
type DocFormat = "markdown" | "json"

interface DocRequest {
  mode: DocMode
  target?: string
  format?: DocFormat // default: markdown
  audience?: "developer" | "maintainer" | "user" | "website"
  detail?: "brief" | "standard" | "deep"
  includeExamples?: boolean
  includeDiagrams?: boolean
  includeTests?: boolean
  limit?: number
  maxTokens?: number
}
```

`target` is required for `symbol`, `file`, `module`, and `feature`. It is
optional for `api`, `project`, and `coverage`; omitted targets mean the whole
indexed project. `limit` is bounded by the server and defaults to 20 evidence
items. `maxTokens` is an output budget, not permission to omit citations.

### Output

```ts
interface DocResult {
  schemaVersion: "1"
  mode: DocMode
  title: string
  summary: string
  sections: DocSection[]
  citations: Citation[]
  unknowns: UnknownFact[]
  quality: QualityReport
  reference: ReferenceMetadata
}

interface DocSection {
  id: string
  heading: string
  prose: string
  facts: Fact[]
  citations: string[] // citation ids used by this section
}

interface Fact {
  classification: "extracted" | "inferred" | "generated" | "unknown"
  statement: string
  confidence: number | null
  citationIds: string[]
}

interface Citation {
  id: string
  kind: "symbol" | "file" | "relationship" | "import" | "test" | "finding" | "embedding" | "health"
  path?: string
  symbol?: string
  lineStart?: number
  lineEnd?: number
  relationshipType?: string
  evidence: string
  freshness: "fresh" | "stale" | "missing" | "unknown"
  confidence: number | null
}

interface UnknownFact {
  statement: string
  reason: "not-indexed" | "not-observed" | "stale-evidence" | "unsupported-mode" | "output-budget"
  affectedSection: string
}
```

Markdown renders citations as stable links such as `[1](src/auth.ts#L12-L28)`.
JSON retains the complete citation objects and stable IDs for website clients.
Citation IDs are deterministic for the same project snapshot, query, and
schema version.

## Modes

| Mode | Target | Primary evidence | Required sections |
| --- | --- | --- | --- |
| `symbol` | symbol name, optionally file/line | signature, bounds, docstring, callers/callees, tests | API, behavior, dependencies, tests, limitations |
| `file` | repository-relative path | file symbols, imports/exports, syntax state | Overview, public symbols, dependencies, risks |
| `module` | directory/module name | files, imports/exports, internal relationships | Purpose, entry points, public surface, module graph |
| `feature` | feature name or semantic target | related symbols/files, graph, patterns, tests | Entry points, flow, components, test coverage |
| `api` | optional route/controller/API target | exported symbols, route-like symbols, contracts | Endpoints, inputs/outputs, errors, examples |
| `project` | optional project target | project stats, languages, entry points, health | Architecture, inventory, risks, documentation map |
| `coverage` | optional path/module | public symbols, docstrings, citations, tests | Documented, undocumented, stale, unsupported |

`feature` uses lexical and semantic evidence only to discover candidates; every
included claim must still cite concrete symbols, files, or relationships.
`api` does not infer undocumented HTTP behavior from a function name alone.

## Fact And Prose Rules

- **Extracted** facts are directly present in indexed source or tables: names,
  signatures, line bounds, imports, exports, relationship types, and measured
  complexity.
- **Inferred** facts are bounded conclusions supported by multiple evidence
  items, such as “this symbol is an entry point because it is exported and has
  incoming route-like references.” They include confidence and citations.
- **Generated** prose is connective explanation. It must not add behavior,
  guarantees, parameters, errors, or examples absent from evidence.
- **Unknown** facts are explicit. The generator must say what is unknown and
  why rather than fill gaps with conventional framework behavior.

Confidence is the minimum of the supporting evidence confidence, freshness
confidence, and mode-specific inference cap. Extracted source facts may use
`1.0` when fresh and exact. Inferred claims are capped at `0.85`; semantic-only
feature discovery is capped at `0.70`; stale or missing evidence cannot support
a confident claim.

## Freshness And Availability

The provider reports the index snapshot and checks source freshness before
generation. Fresh evidence may be used normally. Stale evidence is included
only with a visible `stale` citation and an `unknowns` entry for claims that
depend on current source. Missing source or unavailable tables produce
`missing`/`unknown` citations and do not become prose claims. An empty result is
valid and must explain whether no target was found or the evidence was
unavailable.

`bb_doc` never refreshes implicitly. Callers must explicitly refresh through
`bb_health`/`bb_refresh`, then request documentation again. This keeps the
operation read-only and makes the source snapshot deterministic.

## Examples And Diagrams

Examples are emitted only when a cited source snippet or verified API contract
provides one. The generator labels examples as illustrative when they are
assembled from multiple facts. It never invents request payloads, return
values, error codes, or setup commands.

Diagrams are optional. Markdown may contain Mermaid with cited nodes and edges;
JSON exposes `reference.diagrams` with nodes, links, and citation IDs. A graph
edge without a resolvable source and target is omitted and recorded as an
unknown, not rendered as a guessed connection.

## Quality Gates

```ts
interface QualityReport {
  passed: boolean
  factuality: { passed: boolean; uncitedClaims: number; unsupportedClaims: number }
  references: { passed: boolean; broken: number; stale: number; missing: number }
  completeness: { passed: boolean; covered: number; expected: number; unknown: number }
  freshness: { passed: boolean; snapshot: string; staleClaims: number }
  budget: { passed: boolean; estimatedTokens: number; maxTokens: number }
  warnings: string[]
}
```

The deterministic gate fails when a claim has no citation, a citation points to
an invalid symbol/file span, an unsupported claim is presented as fact, the
output exceeds `maxTokens`, or required mode sections are absent. Stale
citations are warnings for inventory sections and failures for current-behavior
claims. Unknowns are counted toward completeness and must be visible.

## Website Reference Metadata

```ts
interface ReferenceMetadata {
  projectId: string
  projectPath: string
  snapshotId: string
  generatedAt: string
  indexVersion: string | null
  schemaVersion: number | null
  sourceLanguage: string | null
  canonicalPath: string | null
  slugs: string[]
  tags: string[]
  relatedReferences: string[]
  diagrams: Array<{ id: string; format: "mermaid" | "json"; citationIds: string[] }>
}
```

`snapshotId`, citation IDs, section IDs, and canonical paths are stable keys for
website ingestion. A website may render `DocResult` directly, cache it by
`projectId/snapshotId/mode/target`, and link back to the repository using
`path`, `lineStart`, and `lineEnd`.

## Operational Limits

- Default evidence limit: 20 items per section.
- Default output budget: 4,000 tokens; hard server maximum: 16,000.
- Diagrams are not emitted in this implementation: `includeDiagrams=true`
  records an honest `not-observed` unknown and `reference.diagrams` stays
  empty. No fabricated mermaid/graph output is produced.
- Examples are only emitted when source-backed evidence exists; otherwise
  `includeExamples=true` records an honest `not-observed` unknown.
- No source writes, refreshes, network calls, or generated test files.
- Errors are structured and identify the mode, target, and unavailable evidence.

See `docs/BB_DOC_EXAMPLES.md` for representative Markdown and JSON output.

## Verification

`script/m20/verify-doc-modes.ts` proves the full mode matrix (symbol, file,
module, feature, api, project, coverage) through the real handler, invalid-mode
and missing-target rejection, registry agreement, JSON/Markdown parity, and
honest empty-project semantics. `script/m20/verify-doc-citations.ts` proves
that every emitted citation resolves to a real file with a valid line span,
that stale sources yield `freshness=stale` with `quality.freshness.passed`
false, and that deleted sources yield `freshness=missing` plus a real
`references.broken` count (no longer hardcoded to zero).
`script/m20/verify-doc-examples-diagrams.ts` proves examples/diagrams are never
fabricated (honest `not-observed` unknowns) and that removing a relationship
from the index removes the corresponding fact (tamper-negative). These are
fixture-level evidence; real-repository documentation coverage is owned by
M20.X2.
