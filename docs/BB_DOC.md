<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the design specification for `bb_doc`: its request/result contract, per-mode behaviour, evidence and freshness rules, declared bounds, refusals and the gates that prove them.
WHO IT IS FOR — callers of `bb_doc`, and the maintainer changing `src/intelligence/documentation/doc-engine.ts` or `src/mcp/tools/bb_doc/**`.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_doc/descriptor.ts, src/mcp/tools/bb_doc/handler.ts, src/intelligence/documentation/doc-engine.ts, docs/BB_DOC_REFERENCE.md, docs/BB_DOC_EXAMPLES.md, and the `bb_doc` gates.
-->

# `bb_doc` design specification

`bb_doc` is a read-only documentation generator over indexed brain evidence. It produces cited
Markdown or website-consumable JSON. It never writes a repository file; source changes belong to
`bb_edit`. Its one write is bounded and declared: when the files a document cites are stale, the
handler reindexes exactly those files (at most 25 files / 2 MiB per call) and regenerates.

## Contract

### Input

```ts
type DocMode = "symbol" | "file" | "module" | "feature" | "api" | "project" | "coverage"
type DocFormat = "markdown" | "json"
type DocAudience = "developer" | "maintainer" | "user" | "website"
type DocDetail = "brief" | "standard" | "deep"

interface DocRequest {
  mode: DocMode
  target?: string
  format?: DocFormat                 // default: markdown
  audience?: DocAudience             // default: developer; selects OPTIONAL sections only
  detail?: DocDetail                 // default: standard; selects the per-section cap
  includeExamples?: boolean          // default: false
  includeDiagrams?: boolean          // default: false; never emits a diagram here
  includeTests?: boolean             // symbol/feature only; omit for the mode default
  limit?: number                     // 1..100, default 20
  maxTokens?: number                 // 1..16000, default 8000
}
```

The handler additionally accepts `refresh: boolean`. `refresh: false` opts out of the inline
repair; the decision is still declared in the answer.

`target` is required for `symbol`, `file`, `module` and `feature`. It is optional for `api`,
`project` and `coverage`; omitted targets mean the whole indexed project. `project` accepts a
target but uses it as document metadata only — it does not scope the selection.

Requests are refused, never silently adjusted:

| Request | Refusal |
|---|---|
| mode not in the seven | `bb_doc requires mode: …` |
| missing target for a target mode | `bb_doc <mode> mode requires target` |
| `limit` outside 1–100 | names the accepted range and says it is not clamped |
| `maxTokens` outside 1–16000 | names the accepted range and the hard ceiling |
| `includeTests` on `file`/`module`/`api`/`project`/`coverage` | names the two modes that render test evidence |
| `module` target matching no indexed file | `unknown module`: names the two directory forms tried |
| invalid `format`/`audience`/`detail`/`mode` enum | registry validator names the accepted set |

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
  prose: string        // orientation only — never the facts joined together
  facts: Fact[]
  citations: string[]  // citation ids used by this section
}

interface Fact {
  classification: "extracted" | "inferred" | "generated" | "unknown"
  statement: string
  confidence: number | null
  citationIds: string[]
}

interface Citation {
  id: string
  kind: "symbol" | "file" | "relationship" | "import" | "test" | "finding" | "health"
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

Markdown renders file-backed citations as stable links such as `[1](src/auth.ts#L12-L28)` and
index-scoped evidence in a separate `## Index` list. JSON retains the complete citation objects
and stable IDs. Citation IDs are deterministic for the same project snapshot, query and schema
version; they are built from repository-relative paths and never contain a machine path.
`quality.references.stale`/`missing`/`broken` count the citations the answer EMITS, so they can be
checked against the Sources list; `collectedStale`/`collectedMissing` publish the totals of
everything the generator gathered, including evidence no fact referred to.

## Modes

| Mode | Target | Primary evidence | Required sections |
| --- | --- | --- | --- |
| `symbol` | symbol name, qualified name, or its last dotted/`::` segment | signature, bounds, docstring, inbound/outbound relationships, imports, tests | API, Behavior, Dependencies, Tests, Limitations |
| `file` | exact repository-relative path, absolute path, directory prefix, or bare file name with/without extension | file row, symbols, imports/exports, syntax state, findings | Overview, Public symbols, Dependencies, Risks |
| `module` | repository-relative directory the index holds | files under the module, its public surface, internal edges | Purpose, Entry points, Public surface, Module graph |
| `feature` | feature name (lexical match over name, qualified name, docstring) | candidate symbols, their files, edges, tests | Entry points, Flow, Components, Test coverage |
| `api` | optional path/contract target | symbols with `api_contract_path`, route/endpoint/controller symbol types, callables in files the index attributes to an HTTP framework | Endpoints, Inputs and outputs, Errors, Examples |
| `project` | optional (metadata only) | project totals, language mix, entry points, findings, documentation coverage | Architecture, Inventory, Risks, Documentation map |
| `coverage` | optional path/module | documented/undocumented symbols, stale sources, unmeasurable verdicts | Documented, Undocumented, Stale, Unsupported |

Evidence rules:

- **`module` refuses rather than falls back.** A module target matching no indexed file is an
  error naming the directory-prefix forms tried. Answering with project-wide inventory would be a
  document about a different subject.
- **`api` never invents a route.** A symbol reaches Endpoints on an authoritative route signal (a
  contract path, or a route/endpoint/controller type), or as a callable in a file the index marks
  as an HTTP framework. Framework attribution is a property of the FILE, so it places a symbol on
  an HTTP surface without saying which request it answers; no method or path is recorded, and the
  document says so. `api_contract_path` and route-ish types have been empty on the indexed corpora
  measured; the framework route is the one that has produced endpoints.
- **`api` cannot report two of its four sections, and says so by name.** Errors: the index has no
  table, column or symbol type recording thrown/raised/returned errors. Examples: none is emitted
  unless a cited snippet or verified contract supplies one.
- **`feature` semantic expansion is opt-in.** Candidates are found lexically; `detail: "deep"`
  additionally asks the semantic index, which measured 19–52 s on a 310k-symbol index. Every
  other call is lexical and records a `not-observed` unknown saying so.
- **`coverage` classifies undocumented symbols as `unknown`** with `confidence: null`, and the
  `unsupported` section names the comment markers this reader cannot see (`#`, `;`, `--`, …)
  per language, so "undocumented" is never reported as a finding about code the reader could not
  read.
- **Docstrings are read from disk and only where a comment is a comment.** The reader recognises
  `/**`, `*` and `//`; languages whose symbol names are prose (markdown headings, where `*` is the
  bold delimiter) are excluded by the analyzer-language registry rather than by a second list.

## Sections, prose and unknowns

- **Every mode emits its declared section set**, including a required section with no evidence.
- **A required section that renders empty must say why, in its own words.** Every required section
  declares in the source what would have filled it; the generator writes that declaration as a
  note when the section comes out empty, and refuses to return a required section it cannot
  explain.
- **A note names the section it explains.** Notes name a concern (tests, graph, freshness) and are
  resolved after assembly against the sections the result actually renders. A note that defaulted
  to the lead section never excuses a section's emptiness; only an aimed note does. A caveat
  ("this file changed after indexing") is not an explanation.
- **Prose adds orientation, never a fact restatement.** A populated section says how its claims
  were obtained (read from the index / inferred / recorded as unknown) and what they rest on (the
  citation kinds).
- **A scope with more indexed symbols than `2 × limit`** publishes the selection bound
  (`selected` of `available`) as an `output-budget` unknown, so a documentation map of 200
  symbols on a 310,423-symbol index is never presented as the whole set.

## Evidence classes and confidence

- **Extracted**: directly present in indexed source or tables — names, signatures, line bounds,
  imports, exports, relationship types, measured complexity, file rows.
- **Inferred**: a bounded conclusion where the index did not resolve the far end (an edge whose
  target has no symbol), capped at 0.85.
- **Generated**: connective prose. It adds no behaviour, guarantee, parameter, error or example
  that the evidence does not hold.
- **Unknown**: explicit; says what is unknown and why.

Confidence is DERIVED — the minimum of the classification cap and the freshness cap of the
citations under the claim. Extracted evidence on fresh files can reach 1.0; stale evidence caps
at 0.5 and missing at 0.3. A caller cannot assert confidence. Semantic discovery is used to find
candidates only; every emitted fact cites a concrete symbol, file or edge.

`quality.warnings` carries the measurement notes (stale/missing sources, trimmed sections,
dropped citations, no-evidence); the gap inventory lives in `unknowns` and is not copied into
`warnings`, so the payload never carries the same sentences twice.

## Freshness and auto-refresh

- Freshness is resolved once per generation over exactly the files the generated document cites,
  using the same batch resolver every other read path uses (mtime+size fast path, content-hash
  fallback; an edit that preserves both size and mtime is reported fresh without hashing — the
  accepted trade-off documented in `src/brain/freshness.ts`).
- When cited files are stale or missing, the handler repairs exactly those files within the shared
  budget (`BB_AUTO_REFRESH_MAX_FILES` default 25, `BB_AUTO_REFRESH_MAX_BYTES` default 2 MiB),
  declares the decision in `autoRefresh` (or the answer text), and REGENERATES so the answer is
  not built from the rows the refresh replaced. A second bounded round catches citations the
  regenerated document introduced.
- A decline is always declared with its reason: `disabled` (`refresh:false` or
  `BB_NO_AUTO_REFRESH=1`), file/byte budget, another live indexer, or an error. The JSON
  `freshness` envelope always carries `{ fresh, stale, missing, staleRatio, mode, remediation, passed }`,
  where `passed` is the envelope's own verdict (`stale === 0 && missing === 0`).
- **Envelope scope follows the document**: a document citing exactly one file gets the registered
  FILE-scope remediation (`bb index "<file>"`); a document citing several files gets the
  project-scope one. When the repair was declined because it is disabled, the markdown footer uses
  the manual-only constants — it never claims an automatic behaviour that did not run, and it
  names the files as cited files, not as another tool's findings.
- Stale evidence is a WARNING for the overall verdict, not a failure: the spec makes it a failure
  for current-behaviour claims, and this result makes no such claim. `freshness.passed` reports
  the collected citations' freshness separately.

## Output budget

- The budget is enforced on the payload the caller receives, not on the engine's internal object.
  The handler measures `Math.ceil(payload.length / 4)`, re-runs the engine with the measured
  decoration overhead subtracted until the payload fits, and reports the measurement in
  `quality.budget.estimatedTokens` with `maxTokens` echoing the request.
  `estimatedTokens * 4` is never smaller than the payload sent.
- When the required sections cannot fit even at the smallest honest rendering, the result is
  returned with `budget.passed: false` and a shortfall unknown naming that rendering. It is never
  met by dropping a required section.
- Two bounds shorten a document and both are published per section:
  `available = capped + notSelectedByCap` and `capped = droppedByBudget + emitted`, with `emitted`
  read back off the finished section. The generator throws rather than return a result whose
  arithmetic does not close.

## Website reference metadata

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

`snapshotId`, citation IDs, section IDs and canonical paths are stable keys for website ingestion.
A website may render `DocResult` directly, cache it by `projectId/snapshotId/mode/target`, and link
back to the repository using `path`, `lineStart` and `lineEnd`. `diagrams` is always empty in this
implementation.

## Measured cost

Warm default calls on the reference index (6,452 files / 310,423 symbols / 820,040 relationships),
five runs each, read-only DB handles, `BB_NO_AUTO_REFRESH=1`:
symbol 0.24 s, file 0.19 s, module 0.42 s, api 1.03 s, project 0.76 s, coverage 0.07 s,
feature 1.97 s (p50; p95 at most 3.65 s). **A cold first default call in a fresh process is 3.9 s
on a cold page cache** (930 ms with a warm cache) and the read-only database open is 2 ms; that
cold cost is index page-cache warm-up, not query time. It is declared here rather than hidden
behind the warm figures. The only shape that can approach a client timeout is the explicit
`detail: "deep"` feature path, measured at 18.0 s and 926 MB on the reference index; it is an
opt-in and the descriptor and pages say so.

## Operational limits and refusals

- Default evidence limit: 20 items per section; accepted range 1–100; out-of-range values are
  refused, not clamped.
- Default output budget: 8,000 tokens measured on the payload; hard maximum 16,000; out-of-range
  values are refused. The default clears the measured minimum honest rendering of a project
  document on the reference index (about 6,700 tokens); a smaller default could not be honoured by
  its own reference call.
- Diagrams are not emitted. `includeDiagrams=true` records an honest `not-observed` unknown.
- Examples are not emitted: `includeExamples=true` records an honest `not-observed` unknown. The
  engine does not mine code fences or synthesise calls.
- `project` mode's target is metadata only; `module` mode refuses an unmatched directory.
- No source writes, network calls, or generated test files. The only write is the bounded,
  declared reindex of cited files.
- Errors are structured (a named message with `isError: true`) and identify the mode, the option
  and the accepted values.

See `docs/BB_DOC_EXAMPLES.md` for real (abridged) output and refusal shapes.

## Verification

Measured commands and what each proves. A gate that cannot go red is not evidence; these have all
been observed red on a planted or real regression before being observed green.

| Command | Proves |
|---|---|
| `bun run script/m13/verify-doc-facts.ts` | fact classification exists, every non-unknown fact carries a citation, the handler in `src/mcp/tools/bb_doc/handler.ts` validates mode and target |
| `bun run script/m13/verify-doc-modes.ts` | all seven modes dispatch through the CLI and refuse bad input |
| `bun run script/m13/verify-doc-e2e-corpus.ts` | CLI + MCP stdio end-to-end, plus `rake`/`rebar3` corpus documents |
| `bun run script/m13/verify-doc-docs.ts` | the generated page matches the registry, the generator passes, D1–D3 evidence is verified |
| `bun run script/m15/verify-doc-deep.ts` | seven subsystem lanes: classification, regex census (must be zero unallowlisted), cross-file citations, measured cost, real-repo e2e, docs honesty (descriptor ↔ page ↔ handler ↔ engine), evidence self-audit, mode coverage |
| `bun run script/m20/verify-doc-modes.ts` | mode/option contract through the real handler: mode matrix, refusals, JSON/Markdown parity, empty-project semantics |
| `bun run script/m20/verify-doc-citations.ts` | every emitted citation resolves with a valid span; stale and deleted sources yield `stale`/`missing` and the reference counters move |
| `bun run script/m20/verify-doc-examples-diagrams.ts` | examples/diagrams are never fabricated; removing a relationship removes the fact |
| `bun run script/m20/verify-doc-truth.ts` | statement truth and self-consistency: inbound edges name the documented symbol, counts match emitted citations, the payload budget holds, prose is not a fact restatement, bounds close, stale-footer vocabulary |
| `bun run script/verify-doc.ts` | engine-level smoke over all seven modes, citation resolution, stale labelling, budget failure, no source mutation |
| `bun run script/verify-doc-design.ts` | this specification still states the required contract sections |

The real-repository corpus companion named in older revisions (the fixture-corpus corpus verifier (`bb_doc/verify-corpus.ts`),
ten repositories) is not present in this checkout; the corpus legs that can run here use
`rake`, `rebar3`, `clojure` and `zig` from the fixture corpus. The other six
repositories (`lua`, `go_tools`, `typescript`, `perl5`, `openssl`, `cpython`) are absent, so that
leg is recorded as blocked rather than green.
