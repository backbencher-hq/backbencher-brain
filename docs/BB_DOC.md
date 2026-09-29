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

**Every mode emits its declared section set, always** — including a section with
no evidence, which then carries an explicit `not-observed` unknown rather than
being absent. That is what makes the completeness gate meaningful: `expected` is
the mode's declared section count, and `covered` is how many of them are
present. A required section is never dropped for `audience` or `detail`; those
two inputs select OPTIONAL sections and the per-section evidence cap, so a
reader can never be handed an incomplete document by asking for a smaller one.

`file` mode accepts a repository-relative path. An exact path, an absolute path,
a directory prefix, and a bare file name (with or without its extension) all
resolve. An absent path and an unresolved one are distinguishable, and the
latter says which of the four forms it tried.

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

`bb_doc` is a read path and participates in the shared inline auto-refresh
(M43.A1/A2), like `bb_search` and `bb_analyze`: when the files a document
cites are stale, the handler reindexes exactly those files within budget and
**regenerates** the document, so an answer is never built from the rows a
refresh just replaced. The repair is declared in an `autoRefresh` line, and
`refresh: false` (or `BB_NO_AUTO_REFRESH=1`) opts out and answers from existing
data with the staleness block. A decline is always declared with its reason.

The read-only guarantee is unchanged: `bb_doc` never writes source, never
creates a file, and never calls `bb_edit`. The only write it can cause is a
reindex of files that already exist, bounded and declared.

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

`passed` is the conjunction of exactly four things, and nothing else:

1. **factuality** — every claim carries a citation, AND the result is not empty.
   A document with no evidence at all is a factuality failure: there is nothing
   for it to be factual about. (`citations.every(...)` over an empty array is
   vacuously true, which is how an empty result once reported `passed: true`.)
2. **references** — no citation is broken and none points at a missing file.
3. **budget** — the measured size of the WHOLE returned object is within
   `maxTokens`. Over budget, the largest sections are trimmed and every drop is
   declared as an `output-budget` unknown. A budget too small for the required
   sections is reported as unmet, with the shortfall named; it is never met by
   dropping a required section.
4. **completeness** — every declared section for the mode is present.

Stale evidence is a **warning**, not a failure: the spec makes it a failure for
current-behavior claims, and this result makes no such claim. Unknowns are
counted in `completeness.unknown` and are always listed; they do not by
themselves fail the gate, because declaring a gap is the tool working, not
failing.

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
- No source writes, network calls, or generated test files. The only write it
  can cause is the bounded, declared reindex of files it already cites.
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
from the index removes the corresponding fact (tamper-negative).

`script/m20/verify-doc-truth.ts` is the gate for the class the three above
cannot see. They build a two-file temporary project and prove that citations
RESOLVE and that bad input is REFUSED. None of them asks whether a statement is
true of the source, or whether the result's own metadata is self-consistent — and
a corpus review over eight indexed upstream repositories found 19 defects in
exactly that blind spot. Every predicate in this gate is shared with a negative
twin that proves it can convict, and the gate records a check with no detail as
a harness error rather than as a pass.

The same predicates run against real repositories by
`fixtures/bb_doc/verify-corpus.ts` (shared corpus, outside this repository):
**382 checks pass, 0 fail, 1 disclosed skip, 56/56 negatives proved able to
fail**, over `rake`, `rebar3`, `clojure`, `zig`, `lua`, `go_tools`, `typescript`
and `perl5` — Ruby, Erlang, Clojure, Zig, Lua, Go, TypeScript and Perl. A corpus
that is absent or too small to be meaningful is recorded as `skipped` with the
reason, never as `passed`.
