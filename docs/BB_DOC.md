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
| `api` | optional route/controller/API target | symbols with an `api_contract_path`, route-ish symbol types, and exported symbols of files the index marks as an HTTP framework | Endpoints, inputs/outputs, errors, examples |
| `project` | optional project target | project stats, languages, entry points, health | Architecture, inventory, risks, documentation map |
| `coverage` | optional path/module | public symbols, docstrings, citations, tests | Documented, undocumented, stale, unsupported |

`feature` uses lexical and semantic evidence only to discover candidates; every
included claim must still cite concrete symbols, files, or relationships.
`api` does not infer undocumented HTTP behavior from a function name alone.

**What `api` mode reads, measured.** It selects a symbol when the index records
an `api_contract_path`, or gives it a route/endpoint/controller type, or it is a
**callable** in a file whose `framework_type` is an HTTP framework. The first two
were
measured empty on all eight indexed corpora — `api_contract_path` was null in
every one and no corpus held a single route-ish symbol type — so before the
framework route existed the mode had **no input at all**: all four of its
required sections rendered empty on 100% of cases on every corpus and every
detail level, while the only content it produced, a list of imports, landed in
the OPTIONAL `dependencies` section the declared set does not mention. The mode
was advertised as one of seven working modes and had never once had a symbol to
document.

The `net_http` attribution is the index's own vocabulary, not a guess at what
frameworks exist; a framework absent from the set contributes no endpoint, and
the document says how many files the index attributed. It is present in **1 of
the 8 measured corpora** (go_tools, 25 files), so this is a real input on a real
repository rather than a general one, and the section says which counts it found.

Broadening the selection that way introduced a defect a fixture could not see,
and only go_tools exposed it: selecting *every* exported symbol of an
HTTP-attributed file made the mode report `module blog()` and `struct Config()`
as endpoints. Measured on go_tools, those 25 files hold 281 exported symbols, of
which **121 are property accessors, 25 module declarations, 19 structs, 18
variables and 3 interfaces** — 186 of 281 are not callable at all. So a symbol
reaches Endpoints only on an authoritative route signal (a contract path, or a
route/endpoint/controller type) or as a callable in an HTTP-attributed file, and
every entry states what the index does and does not record: framework attribution
is a property of the FILE, so it places a symbol on an HTTP surface without
saying which request that symbol answers, and no method or path is recorded.

`api` also cannot report two of its four sections, and now says so by name:

- **Errors.** The index has no table, column or symbol type that records a
  thrown, raised or returned error. That is a limit of what is indexed, not a
  finding that the code cannot fail, and the section says which.
- **Examples.** An example requires cited source, so it is emitted only where an
  endpoint carries a docstring containing a call to itself or an indexed test
  names one.

**Every mode emits its declared section set, always** — including a section with
no evidence, which is then absent from nothing and unexplained by nothing. That
is what makes the completeness gate meaningful: `expected` is the mode's declared
section count, and `covered` is how many of them are present. A required section
is never dropped for `audience` or `detail`; those two inputs select OPTIONAL
sections and the per-section evidence cap, so a reader can never be handed an
incomplete document by asking for a smaller one.

**A required section that renders empty must say why, in its own words.** Every
required section declares, in the source, what would have filled it — a
completed search, not "no data available" — and the generator writes that
declaration as a note when the section comes out empty. A section that cannot
explain itself is refused, not returned.

This is structural, not per-mode, because the alternative was nine sections that
were empty in 100% of cases on every corpus and every detail level with nothing
saying why, and a reader cannot tell those apart from a measurement that found
nothing. Two rules make the explanation real:

- **A note names the section it explains.** Notes name a *concern* — tests, the
  graph, freshness — and the section is resolved once, after assembly, against
  the sections the result actually renders. Hardcoded ids named sections that
  exist in only one mode: the test gap said `tests` while `feature` renders
  `test-coverage`, and the unresolved-edge note said `flow` while `module`
  renders `module-graph`. A note pointing at a section the reader cannot see is
  not an explanation, and it left those sections looking unexplained while a
  message appeared to cover them.
- **A caveat is not an explanation.** "This file changed after indexing" and
  "this file did not parse" are true and belong on the section whose facts they
  qualify. Neither says why that section has no facts, and neither may stand in
  for saying so: an `api` document with an empty Endpoints section once showed
  only a freshness note and never said that no endpoint was indexed.
- **An explanation must be AIMED, not defaulted.** A concern whose section does
  not exist in the current mode lands on the document's lead, and it was then
  accepted as that section's explanation. On the 5 382-file typescript index the
  scope note — "5 282 file(s) were not examined" — was the *only* note the
  Endpoints section carried, which is not a reason it has no endpoints. The same
  note in `file` mode, which does render the section `scope` prefers, is aimed and
  does explain it. So the rule is per resolution, not per concern: a defaulted
  note never excuses a section, an aimed one may.

`file` mode accepts a repository-relative path. An exact path, an absolute path,
a directory prefix, and a bare file name (with or without its extension) all
resolve. An absent path and an unresolved one are distinguishable, and the
latter says which of the four forms it tried.

**What `risks` is built from**, and why it is not "the analysis findings":
three sources, all read from the index, all cited. Open
`brain_analysis_finding` rows, files with recorded parser errors, and symbols at
a measured complexity at or above a stated threshold. A required section that is
always empty is a placeholder, not a measurement — and it WAS always empty,
because no read path in this tool produces an analysis finding while the index
held, on one measured corpus, 1 099 files with recorded parser errors and
185 477 symbols carrying a measured complexity. When all three sources are
empty, the section says exactly that, because the absence of evidence is not
evidence of absence.

**`limitations` and `unsupported` are measurements, not disclaimers.** Both were
literal `facts: []` in the source, empty in 100% of cases on every corpus and
every detail level, with a reassuring lead and nothing saying why. They are now
built from the same branch that decides each gap, so a section and its note
cannot disagree — there is no second measurement to drift, and no limit asserted
without a citation.

- `limitations` (in `symbol`) carries, per symbol: no docstring, no test
  evidence, a source that moved or vanished under the index, a file with parser
  errors, and unresolved edges. The distinction it exists to draw is between
  "has no documentation" and "this tool cannot see its documentation": when the
  language's comment marker is one the reader does not read, the fact says the
  verdict is **unverified**, not absent. Reporting the second as the first is a
  false negative about the code, produced by a limit of the reader.
- `unsupported` (in `coverage`) carries what could not be measured about the
  scope: files the index recorded parser errors for, and symbols in a language
  whose comment marker the reader does not read and which the analyzer left
  without a docstring. Both are cited, and both are read with the documented /
  undocumented verdicts they qualify.

**Docstrings are read from disk, and only where a comment is a comment.** A
markdown symbol's name is a heading and `*` is the BOLD delimiter, so a
comment scanner above a heading reads the previous English line as a JSDoc
block; measured on this repository's own index, 79 of 3 598 markdown symbols
received a fabricated docstring at `extracted` / `1.0`. Languages whose symbol
names are prose are therefore excluded by asking
`language-detection.ts` — the registry that admits a file to an analyzer — so
the doc lane and the router cannot drift. The remaining limit is stated rather
than papered over: the scanner knows `/**`, ` * ` and `//`, and not `#`, `;` or
`--`, so a symbol in Ruby, Python, Perl, shell, Clojure, Lisp, SQL or Lua
reports "not observed" instead of a guess. Teaching it those belongs to the
analyzer lane, which knows each grammar. Where it matters for a verdict, the
`unsupported` section now reports it per language and counts the symbols it
affects.

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
  bounds: {
    perSection: number
    sections: Array<{
      id: string
      available: number
      capped: number
      droppedForBudget: number
      emitted: number
    }>
  }
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
   dropping a required section. The figure is measured with a same-width
   placeholder in the field and that measurement is what is reported, so
   `estimatedTokens * 4` is never smaller than the payload it describes — the
   figure a caller budgets from must not be an under-count.

   **What that figure measures: the returned object, not the wire bytes.** The
   shared MCP handler adds a `freshness` envelope to every tool's result and
   serialises with two-space indentation. Measured on rebar3, `project` mode,
   `limit` 20: the engine's object is 16 904 characters and the reported figure
   is 16 908; the handler's compact form is 17 000, and the wire form is 21 925 —
   **1.30x the object**, and 1.47x on a larger document. So a caller budgeting
   from `estimatedTokens` is budgeting for the object, and a client counting
   tokens off the wire will spend about a third more. The transport is shared
   with every other tool, so its shape is not this tool's decision; the gap is
   pinned in `verify-doc-truth.ts` (T27) so a change there surfaces as a diff in
   this gate rather than as a surprise in a client's budget.
4. **completeness** — every declared section for the mode is present.

Stale evidence is a **warning**, not a failure: the spec makes it a failure for
current-behavior claims, and this result makes no such claim. Unknowns are
counted in `completeness.unknown` and are always listed; they do not by
themselves fail the gate, because declaring a gap is the tool working, not
failing.

**Two bounds shorten a document, and they compose.** The per-section evidence
cap (`detail` × `limit`) and the output budget each remove facts, and every
removed fact is accounted for:

```
available = notSelectedByCap + capped
capped    = droppedByBudget + emitted
```

`bounds` publishes all five numbers per section, and `emitted` is read back off
the finished section rather than carried forward, so the identity is a
measurement. The generator refuses to return a result where it does not close.

Two defects lived here, and both were invisible while the bound existed only as
prose:

- The cap was **announced and never applied**. The section was assembled from the
  uncapped draft, so the sentence was the sole description of the cap and it was
  false: measured on rebar3 at `brief`, it claimed "115 of 120 inventory items
  were not selected" — a claim of keeping 5 — while the document kept more, and
  the number a reader could count came from the budget's halving instead.
- Both bounds were announced **from the same list**, so a 12-of-24 documentation
  map reported "18 more dropped": 36 accounted for out of 24, on every section
  of a real document.

A count a reader can check and finds wrong is worse than no count, because it
condemns the whole quality block.

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
a harness error rather than as a pass. A failure detail names EVERY offender: a
gate that sampled 6 of its 24 findings hid three quarters of the evidence it was
written to surface.

Three further lanes in that gate exist because an audit found the same defect
class the `risks` fix belonged to, surviving in eight more sections:

- **No required section is empty without a note naming that section** — checked
  over 29 declared sections × 3 detail levels × 7 modes, 609 checks.
- **Every note names a section the result actually renders**, from outside the
  tool, because an assertion inside the code under test is not evidence about it.
- **The published bounds are the applied bounds** — `emitted` equals the
  section's real fact count, and `emitted + droppedByBudget === capped` for
  every section. The generator throws rather than return a result whose bounds do
  not close, and the identity caught a miscount on its first run.

The last two guards are also driven directly by the gate with synthetic
malformed results, so each is shown to reject what it exists to reject: a guard
exercised only by the code it guards would pass if it were `return`.

**One verifier per evidence file.** This gate and
`script/m20/verify-doc-examples-diagrams.ts` both wrote
`validation/m20/results/D3.json`, and the manifest assigns D3 to the
examples/diagrams verifier. Two verifiers sharing one evidence file is
last-writer-wins, so the file was evidence of whichever had run most recently —
which is how a milestone ends up marked `verified` with numbers no verifier
produced. This gate now records as `DOC-TRUTH` in its own file, and no manifest
code was taken for it: D1 is the mode and option contract, D2 citation
resolution and freshness, and D3 examples and diagrams, so none of the three
covers statement truth and result self-consistency.

The same predicates run against real repositories by
`fixtures/bb_doc/verify-corpus.ts` (shared corpus, outside this repository):
**382 checks pass, 0 fail, 1 disclosed skip, 56/56 negatives proved able to
fail**, over `rake`, `rebar3`, `clojure`, `zig`, `lua`, `go_tools`, `typescript`
and `perl5` — Ruby, Erlang, Clojure, Zig, Lua, Go, TypeScript and Perl. A corpus
that is absent or too small to be meaningful is recorded as `skipped` with the
reason, never as `passed`.
