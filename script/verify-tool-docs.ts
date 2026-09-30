import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PUBLIC_TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"
import { FRESHNESS_REMEDIATION } from "../src/brain/freshness"

interface CuratedToolDocumentation {
  returns: readonly string[]
  errors: readonly string[]
  limitations: readonly string[]
  performance: string
  safety: string
  evidence: string
}

const curated: Readonly<Record<string, CuratedToolDocumentation>> = {
  bb_search: {
    returns: ["Indexed matches with file and line provenance", "Exact symbol or bounded file source in retrieval modes", "Freshness state where available"],
    errors: ["Missing mode-specific query, symbolName, or filePath", "Invalid regular expression", "Unknown or mode-irrelevant option"],
    limitations: ["Results reflect the current index and may be stale", "Content search is lexical; use bb_ask for semantic discovery"],
    performance: "Pagination and result limits bound retrieval; exact indexed lookup is preferred over content scanning.",
    safety: "Read-only. It does not refresh the index or modify source files.",
    evidence: "Paths, line ranges, symbol kinds, and source snippets are indexed evidence; stale flags qualify that evidence.",
  },
  bb_ask: {
    returns: ["Natural-language answer", "Ranked semantic matches", "Similarity and source provenance"],
    errors: ["Empty query", "Unavailable index or embedding state", "Unknown option"],
    limitations: ["Semantic similarity discovers candidates but does not independently prove a claim", "Local word vectors provide lexical-quality fallback rather than model-quality semantics"],
    performance: "The limit bounds returned semantic matches; embedding coverage and model choice affect ranking quality.",
    safety: "Read-only. It does not write source or silently rebuild embeddings.",
    evidence: "Treat matched symbols and resolvable source locations as evidence; treat generated explanation as interpretation.",
  },
  bb_analyze: {
    returns: [
      "Mode-specific typed analysis: graph edges, file dependency edges, project counts, complexity metrics, impact, or test evidence",
      "A declared bound on every answer — what was returned, what exists, and whether the set is the whole one",
      "Explicit unavailable states: a metric or target that cannot be computed is `available: false` / `notFoundReason`, never a substituted number",
    ],
    errors: [
      "Missing required mode",
      "Missing or blank target for a target-based mode",
      "Option irrelevant to the selected mode (refused, never ignored)",
      "`limit` on a mode it does not apply to, or `limit: 0`",
      "A `complexity` target that names no indexed file and no directory prefix",
    ],
    limitations: [
      "Static relationships cannot establish runtime behavior",
      "Test results describe indexed static evidence, not executed coverage; a project whose tests the indexer did not recognise is reported as having none, with the reason",
      "Callers/callees/trace/impact modes share the graph engine's owner-cascade semantics: a relationship stored against a class member is attributed to the owner class. Every edge states which it was through `targetMatch` (`exact` or `owner-cascade`); absent means the engine could not tell, which is not the same as `exact`",
      "A name resolves to ONE stored symbol. `rootCandidates` (bb_graph) and `rootCandidates` here say how many the name matched among — 1 means the name was unique, more means the answer is about one of several",
      "mode `impact` refuses a target the graph cannot root at, with `notFoundReason: \"not-traversable\"` and the symbol type. Such a symbol IS in the index; `callers`/`callees` resolve the same name because they match any type",
      "A depth-capped walk is TRUNCATION and says so: `summary.truncated` is true with `truncationReason` naming the depth cap, beside `maxDepth` and `maxDepthReached`",
      "A walk also runs under a wall-clock budget (`summary.timeBudgetMs` / `timeBudgetExhausted`, default 2,000 ms). A node is not a unit of work: the per-node caller query is priced by the reproducible ORDER BY, which SQLite applies before the LIMIT, so `edgeLimit` cannot bound it. Measured on this repository's own src: 2,436 matching rows for one symbol cost 85.8 ms of the 87.8 ms, and the walk was unbounded until this budget existed",
      "`dependencies` resolves an internal specifier against the importing file's own directory and LABELS each edge `resolved` / `suffix-match` / `unresolved`. It is not a guess from a basename: on this repository's own src only 74 of 906 `imports` relationships carry both endpoints and `brain_import.resolved_symbol_id` is empty, so specifier resolution is the primary path, not a fallback",
      "A file's `dependents` and `dependencies` lists are capped per row; `dependentsTotal` / `dependenciesTotal` are the real sizes and the Truncated flags say the list was cut",
      "Neither list carries `fileId` — a file id is `<40-hex project id>:<relative path>`, so it repeated the path printed beside it (56,540 of 121,340 bytes on a default page of this repository's src). The path is the locator, `resolution` says how it was reached, and the row above carries the id for the file the row is about",
      "`metrics.couplingEdges` counts only the relationship types listed in `couplingRelationshipTypes`; `exports` and `contains` are index bookkeeping. `stats.relationships` is every row and is a different number",
      "`metrics.maintainability` is unavailable when the formula's domain does not cover the scope (it is negative above roughly 3·10⁴ non-blank lines) rather than clamped to 0",
      "Locations are project-relative. `nodes[].filePath` (absolute) is not emitted, so the same question returns the same bytes on any machine",
      "A mapping entry carries at most 20 links (`linksTruncated` says when more exist); the ranking and every summary count use the complete set",
      "`provenance` on a `dependencies` page is on the REPORT, not repeated per row",
    ],
    performance: "Every mode is paged and says so. `limit` bounds the answer — 25 edges per direction for callers/callees/trace (default), 20 files for dependencies, 50 entries for the test modes. On this repository's src (183 files, 8,565 symbols, 52,597 relationships) a default answer is 1.5-26 KB for eight of the eleven modes; `dependencies` is 75.9 KB (~21k tokens) because 20 of those files really do have 506 internal edges between them, so a caller who wants less should pass `limit`. The graph walk is additionally bounded by depth, per-node site limit, fan-out budget, and a wall-clock budget; whichever fires is named in `truncationReason`. All nine graph cases in fixtures/analyze/latency-gate.sh answer in under 2.4 s on that corpus, against a measured 613 s and several that never returned.",
    safety: "Read-only. Analysis never creates tests or edits source.",
    evidence: "Findings derive from brain_* symbols, files, relationships, complexity, and test-file classifications. `provenance.evidenceClass` classifies what kind of claim the answer is; `unknowns` names every absence the answer rests on.",
  },
  bb_patterns: {
    returns: ["Pattern findings with confidence and locations", "Orphan, framework, and anti-pattern classifications", "Optional persisted run history"],
    errors: ["Invalid scope or confidence threshold", "Unavailable index", "Unknown option"],
    // Written from the measured behavior, not from the shape of the feature.
    // The previous three lines were true of every analysis tool and false in the
    // ways that matter to a reader deciding whether to delete something:
    //   * "static incoming-reference evidence, not proof" said the right thing
    //     and hid that the tool had been accepting a SELF-REFERENTIAL
    //     `overrides` row as proof of a consumer;
    //   * "heuristic and confidence-qualified" said nothing about what the
    //     confidence means or how it is derived;
    //   * nothing at all said that a finding can be a coverage gap in the
    //     analyzer rather than dead code, which is the dominant residual class.
    limitations: [
      "A finding is not a deletion instruction. The tool reports what the index does and does not record; where the index is silent, the finding says so on its face rather than presenting absence of evidence as evidence of absence.",
      "Confidence is derived from measured evidence classes, not assigned per rule. It spans 0.30-0.70 for orphans (the published cap) and 0.60-0.90 for anti-patterns. Name-unique symbols measured a 0.0% false-positive rate against a source-text oracle; ambiguous names measured 14.4%.",
      "A symbol with no ANCHORED incoming row, in a file that has one, gets the coverage-gap disclosure. The per-symbol test counts anchored rows only while the per-file test counts any row, and that asymmetry is deliberate: an unanchored row is a name match, and 97% of rake's `references` edges name no consumer, so counting them per symbol would suppress the disclosure across the whole corpus.",
      "A relationship only counts as usage evidence if it is not a self-loop, its published evidenceClass is not \"inferred\", and its confidence is at least 0.7. Refused rows are counted in `summary.unverifiedUsageEdges` and itemised on the findings they would have cleared.",
      "A finding whose symbol had no recorded incoming reference while its file did carries a COVERAGE GAP INDICATOR. That is the signature of an analyzer that reached the file and not the symbol, and such a finding may be a coverage gap rather than dead code.",
      "Dynamic dispatch, reflection, and string-keyed lookups are invisible. The engine never fabricates a resolved edge for them, so a symbol reached only that way is reported.",
      "False-positive rate is 0.0-27.8% by corpus, measured against a source-text oracle that cannot see reflection or template indirection — so the true rate is higher, and the number is a lower bound.",
      "Test files are excluded from candidates but not from evidence: a production symbol called only from a test is not reported, and a production file imported only by a test is not reported. `includeTests: true` means \"also report test symbols\", not \"ignore tests when looking for users\".",
      "Framework and anti-pattern detection is heuristic and confidence-qualified.",
    ],
    performance: "Cost is index-bound and grows with the SYMBOL count, not the relationship count: every set the scan builds is reduced in SQL, so a 223,880-symbol / 898,806-relationship repository is scanned in 32s and a 56,738-symbol one in 3.9s. Three measurements on real corpora, each with byte-identical output: the anti-pattern rules once took 330s because of a correlated COUNT and now take 0.4s; the relationship pass once shipped 710,671 rows into JS to build sets bounded by symbol count and now ships ~5,700 rows of aggregates; and the whole scan was three statements over the same rows before the coverage indicator re-read what the evidence gate had already read. `limit` bounds the displayed page; the census in the header is the full candidate count, and `raise \\`limit\\`` is named when the page is short.",
    safety: "Source is read-only. recordRun writes only analysis-history records in the brain database, and persists the whole census rather than the displayed page so the auto-resolve pass cannot mark live findings as gone.",
    evidence: "Every finding is confidence-qualified, carries an evidence array naming what was checked, and carries a limitations array. Two channels are kept distinct: an anchored edge from an identified symbol is decisive, while a name match clears a candidate only when the name is unambiguous in the reporting scope. `summary.suppressedByReason` accounts for every candidate the scan discarded, and `summary.importResolution` states how far the import channel could be carried.",
  },
  bb_security: {
    // Corrected 2026-09-30 against the code. The previous `returns` claimed
    // "cross-language source-to-sink flow evidence" while the text mode never
    // rendered the source, the path, the confidence or the limitations — the
    // adapter built them and the handler discarded them. What the response
    // actually contains is a finding list plus a census that makes truncation
    // visible, and the observations that are explicitly NOT findings.
    returns: [
      "Normalized security findings (label, severity, calibrated confidence, sink type, source type)",
      "A `[scan: …]` census line stating how many taint flows were indexed, how many findings they deduplicated into, how many are being shown, and how many are beyond the cap",
      "One-sided flows listed separately as unvalidated observations, each with its real severity and the reason it is unvalidated",
      "Optional persisted run history, recording the full analysed finding set (never the display window) with evidence, confidence and limitations",
    ],
    errors: ["Unavailable index", "Invalid history limit (non-integer, or negative)", "Unknown option (rejected with the accepted set named)"],
    limitations: [
      "Static taint analysis can produce false positives and false negatives",
      "It is not runtime testing or a penetration test",
      "`confirmed` means both flow endpoints are indexed symbols — it does **not** prove the values are connected. The indexer pairs every taint source with every taint sink in a symbol body, so two tokens in one function produce a confirmed flow whether or not one reaches the other",
      "**Not detected:** hardcoded secrets (no such finding type is emitted; that rule belongs to `bb_patterns`), genuine cross-*language* taint (the `crossLanguage` flag means the flow was stitched across symbols, not that languages differ), standalone weak-crypto use (emitted as a sink with no co-located source, so it remains an observation)",
      "Severity is normalized into exactly `critical|high|medium|low|unknown`; an unrecognised stored value becomes `unknown` rather than vanishing from the counts",
    ],
    performance: "Indexed flow analysis and output/history limits bound work and response size. The response always states the census — indexed flows, deduplicated findings, findings shown, findings beyond the cap — so a truncated scan is never presented as a complete one. `recordRun` re-scans with a census-sized cap so that persisting the history snapshot can never auto-resolve findings that were merely not examined.",
    safety: "Source is read-only. recordRun writes only analysis-history records in the brain database.",
    evidence: "A finding is supported by indexed source/sink locations and relationship paths; severity does not imply exploitability. Persisted history records the engine's calibrated confidence (0.7 confirmed / 0.4 observation / 0.3 mitigated), the taint-flow evidence, and the per-finding limitations. Unvalidated observations are never persisted to history.",
  },
  bb_doc: {
    returns: ["Markdown or structured JSON documentation", "Resolvable citations and evidence classifications", "Quality and website reference metadata"],
    errors: ["Missing target for target-based mode", "Unsupported format or mode", "Unavailable indexed evidence"],
    limitations: ["Unknown facts remain explicit rather than inferred without support", "Stale evidence is qualified and cannot silently become current"],
    performance: "Evidence count and maxTokens impose explicit response budgets.",
    safety: "Read-only. It never refreshes implicitly, writes source, or invokes bb_edit.",
    evidence: "Claims are classified as extracted, inferred, generated, or unknown and carry resolvable citations where applicable.",
  },
  bb_visualize: {
    returns: [
      "Canonical nodes and links, with EVERY stored relationship type between a pair kept as a separate link",
      "An auditable projection rather than a picture: each link carries `rowId` (the stored relationship it traces to), its stored `confidence` and its line; each node carries `line`, `lineEnd` and `qualifiedName`, so the graph is navigable and every edge can be checked against the row that justifies it",
      "Three DISTINCT declared counts — `totalNodesAvailable` (what the scope and filters match), `truncation.originalNodes` (what reached the projection) and `nodes` (what was returned) — so a short page is never mistaken for a whole set",
      "`excluded` — what the noise filter removed, how many, and the patterns responsible — so a partial map is never mistaken for a complete one",
      "`declaredAbsent` with an `absenceNote` when the answer is empty, distinguishing what matched nothing from what matched but did not survive the projection",
      "Text, JSON, or genuinely SELF-CONTAINED HTML: one file with no network, no fonts and no build step, carrying its own force-directed layout and canvas renderer, so it renders offline and in an air-gapped editor",
      "In the HTML the evidence is ENCODED rather than decorated: edge opacity is stored confidence, relationship type sets colour and a structural/behavioural dash, a stale endpoint is a hollow ring, node size is the index's own gravity, and any node or edge can be selected to read its stored facts",
    ],
    errors: ["Missing target for a scoped graph", "Unsupported scope or format", "Unavailable index"],
    limitations: ["The graph reflects static indexed relationships", "NOISE FILTER (declared, and the caller's to change). Build output and VCS metadata are excluded by default, matched on whole path SEGMENTS. This was previously a bare-substring rule that removed real source: measured on cargo, `dist` removed `src/util/edit_distance.rs`, `out` removed `src/compiler/layout.rs` and `src/compiler/output_depinfo.rs`, and `build` removed `crates/cargo-test-support/build.rs`, leaving 225 of 1,787 symbol-bearing files with no exclusion declared anywhere. Test and spec sources are ordinary source and are INCLUDED by default; `excludePatterns` and `includeTests` change all of it, and whatever is removed is counted onto `excluded`", "SCOPE TARGETS ARE VALUES, not patterns. `%` and `_` match themselves and a directory prefix matches on a segment boundary, so `src/util` never reaches `src/utilities`. This matches bb_analyze, whose contract states the same rule; the two tools previously disagreed, and this one was the permissive one (measured: a target of `%` selected every file in the corpus)", "`feature` scope matches a symbol NAME or a docstring. The docstring half is thin in practice and the answer does not pretend otherwise: measured on cargo, 70 of 40,595 symbols (0.17%) carry one, so a feature query is usually a name match", "Nodes and links beyond configured budgets are omitted and reported", "Owner-cascade attribution: member-level relationships are attributed to the owner class, same as bb_graph"],
    performance: "maxNodes, maxLinks, scope, relationshipTypes, and languages constrain graph construction.",
    safety: "Read-only. HTML output contains the same bounded graph as JSON and does not mutate the project.",
    evidence: "Nodes and links resolve to canonical indexed entities; links with omitted endpoints are not emitted.",
  },
  bb_migrate: {
    returns: ["Dependency-ordered migration plans", "Effort methodology, library mappings, and risks", "Explicit unsupported and truncation results"],
    errors: ["Missing targetLanguage", "No symbolName or symbolNames", "Unknown option"],
    limitations: ["Plans are estimates, not translated source", "Library mappings are advisory and unsupported routes remain explicit", "Dependency ordering and mapping depend on the analyzer-extracted symbol and relationship graph; edge cases that the analyzers cannot resolve (reflection, dynamic dispatch, or cross-file relations the grammar does not model) limit the completeness of the resulting plan"],
    performance: "Requests are capped at 100 symbols and dependency traversal is bounded.",
    safety: "Read-only. It does not generate, replace, or compile target-language source.",
    evidence: "Dependency ordering comes from indexed relationships; effort and mappings are labeled methodology-driven estimates.",
  },
  bb_edit: {
    returns: ["Structured mutation result or dry-run preview", "Validation, formatting, rollback, and reindex status", "Affected paths and caller protection outcomes"],
    errors: ["Path escape or symlink escape", "Ambiguous symbol name (the message names filePath/lineStart)", "Symbol renamed or removed since the target file was indexed (refreshed first, then refused by name)", "Caller protection, parse, formatting, or reindex failure"],
    limitations: ["Named symbol edits need an INDEX, not a fresh one: when the target file changed after it was indexed, the tool refreshes that ONE file's rows and re-resolves the symbol before planning, so bounds always come from the bytes on disk and never from a stale span (M59.A11, #890). The refresh is reported in `warnings`; if the symbol was renamed or removed in the meantime the edit is refused by name instead of guessing a span", "Directly after a write, the file's own evidence is current but cross-file relationships are only re-derived within the bounded post-pass, so a caller in an unrelated file may lag until the next dir index (same bound as bb_index)", "Refactoring is identifier-aware static rewriting, not a full language-server proof", "Per-mode argument rejection names the offending fields but not the accepted set for the mode (e.g. `bb_edit update mode does not accept: position` does not say that `update` accepts only `mode, dryRun, filePath, symbolName, lineStart, content/newContent, format`); callers must consult the mode contract in this page when constructing payloads. Known gap in `validateEditArguments` (src/mcp/tool-validation.ts). proof"],
    performance: "Only affected files are written, formatted, validated, and reindexed.",
    safety: "Write-capable. Uses project-root path checks, atomic writes, snapshots, validation, and rollback; use dryRun before risky edits. dryRun writes no source file, but a stale target file is still refreshed in the INDEX first (derived data only), because the bounds it previews must be the bounds the real edit would use.",
    evidence: "Mutation bounds come from indexed AST bytes, re-resolved from the file on disk whenever the indexed rows are stale; validation and reindex state report whether post-edit evidence is current.",
  },
  bb_index: {
    returns: ["Indexed, deleted, and error counts for the refreshed path", "Mode actually applied (auto resolved, file, or dir)", "Per-file error names for any file that failed to reindex"],
    errors: ["Missing path", "Path outside the project root", "Parse or store failure for an individual file"],
    limitations: ["A file reindex updates only that file's evidence; cross-file relationships refresh on the next full or incremental dir index", "Dir mode reuses the incremental indexer: unchanged files are skipped by design"],
    performance: "A single file reindex is bounded by that file's parse cost; dir mode is bounded by the changed-file set.",
    safety: "Write-capable against index data only. It never modifies source files.",
    evidence: "Counts come from the real parse/store pipeline; errors name the file that failed rather than swallowing it.",
  },
  bb_health: {
    returns: ["Index, schema, runtime, freshness, and embedding health", "Optional integrity and analysis-history summaries", "Typed warnings and refresh outcome"],
    errors: ["Invalid freshness or sample settings", "Refresh/index failure", "Unknown option"],
    limitations: ["Sampled freshness is not a complete filesystem proof", "Embedding coverage reports stored state, not semantic quality"],
    performance: "Sampled freshness is the default; complete freshness and integrity checks intentionally cost more.",
    safety: "Status is read-only. refresh=true explicitly mutates only index data; force=true performs a full in-place reindex.",
    evidence: "Counts and versions come from the brain database; freshness compares indexed metadata with the filesystem.",
  },
  bb_graph: {
    returns: [
      "Per-symbol dependency graph: callers and callees",
      "Per-edge endpoints as described nodes — `{ id, name, symbolType, file, line, isExternal }` on BOTH ends, so an edge is self-contained and no id has to be parsed or looked up in a second call",
      "Per-edge `rowId`: the stored `brain_relationship` row the edge came from, so every claim is auditable against the index (measured: every emitted rowId resolves to exactly one stored row, and the edge's endpoints agree with that row)",
      "Endpoints the index could not resolve as `ext:<name>` nodes, with `isExternal: true` — a recorded name, never a symbol guessed from that name",
      "Per-edge `match` (`exact` | `owner-cascade`) and `matchedMember` (`{ name, file }` when the cascade matched): whether the stored row names the symbol that was asked for, or one of its members folded onto it",
      "Per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred) with confidence",
      "Per-edge call-site address (M62.A2): `{ kind, file, line, note }` — `call-site` is an exact stored line; `declaration` is a LABELED substitute (the calling symbol's own declaration, shown only when no call-site line is stored); `unknown` has no position at all (line null) and states why. A position is never fabricated and never reported as line 0",
      "`summary.edgesByType`: the composition of the RETURNED edges by stored relationship kind, counted from the emitted edges. The default filter covers every stored kind, so an answer is usually not all call edges — measured: lodash `baseConvert` 99 of 230, cobra `getCompletions` 36 of 65, rake `standard_rake_options` 72 of 76. This is how you learn the ratio without walking the edges",
      "`summary.maxEdges` / `totalEdgeLimitReached`: the bound on the WHOLE answer, across both directions and every depth, and whether it bit. `edgeLimit` bounds one query; this bounds the answer, and their product is what a caller receives",
      "`summary.edgeKindPriority`: the order in which kinds survive the per-symbol site limit — dependency kinds first, then lexical, then module-level, then membership. Only observable under `truncated`, published always",
      "`summary.relationshipTypesUsed`: the relationship kinds this run actually searched, resolved. `summary.scope.relationshipTypes` echoes it, so the filter that produced the answer is never a restatement of a default that may have moved",
      "`summary.exactCallers` / `cascadedCallers` / `exactCallees` / `cascadedCallees`: DEPTH 0 only — how much of the answer is about the symbol that was asked for and how much the owner cascade folded in from its members. `deeperCallers` / `deeperCallees` hold the edges about symbols the traversal discovered, so exact + cascaded + deeper is the number of edges returned",
      "`summary.callerBudget` / `calleeBudget` with `callerBudgetExhausted` / `calleeBudgetExhausted`: the fan-out bound in force and whether it bit. `truncationReason` can name `caller-budget-exhausted`; this says what the budget was",
      "`summary.edgesInBothDirections`: stored rows present in both the caller and the callee list — `totalCallers + totalCallees` double-counts exactly this many",
      "`root.candidates`: how many stored symbols the requested name resolved among — 1 means the name was unique, more means the answer is about one of several and `root` is what to confirm",
      "`summary.maxDepth`: the depth bound this run actually used, alongside `summary.maxDepthReached`. Together they are the only way to tell \"the walk finished\" from \"the walk stopped\"",
      "A per-edge `depth`, which is HOW FAR THE WALK WENT before finding that row — not the shortest distance between two symbols. See Limitations",
      "`summary.scope`: the `direction`, `relationshipTypes` and `includeCrossLanguage` actually applied, so a narrowed traversal returning zero edges is distinguishable from a widened one that found nothing",
      "Declared truncation with a reason when the traversal is bounded",
    ],
    errors: [
      "Missing symbol",
      "maxDepth outside the declared 1-10 range",
      "edgeLimit below 1",
      "maxEdges below 1",
      "direction outside callers|callees|both",
      "relationshipTypes given as an empty list (a narrowed traversal that can match nothing is refused rather than silently returning an empty graph)",
      "Symbol not found in the index",
    ],
    limitations: ["Edges reflect indexed static evidence with declared tiers; inferred edges are labeled, not proven",
      "An edge's `depth` is the depth of the query that found its stored row, not the shortest path between the two symbols. The traversal is depth-first and the per-row dedupe is global, so the first traversal to reach a row emits it: measured, 24% of edges on cobra, 57% on lodash and 60% on rake sit deeper than the shortest path in their own answer. No edge ever claims a SHORTER path than its answer can demonstrate, so `depth` is a valid upper bound on distance - read it as 'how far the walk got', not 'how far apart these are'. Use `direction` with a smaller `maxDepth` when the distance itself matters",
      "The default filter covers every stored relationship kind, so an answer mixes dependency edges with lexical references (`uses`, `references`), structural membership (`contains`) and module edges (`imports`, `exports`). `contains` means owner → member: a class reporting its own methods is structure, not dependency. Filter with `relationshipTypes` for a pure call graph, or read `edgesByType`",
      "Every kind competes for the per-symbol site limit, and the surviving set is decided by `edgeKindPriority` — dependency kinds first. A truncated answer therefore keeps more `calls` and fewer `contains` than an untruncated one would, and the published order is the rule that decides it",
      "A target the index could not resolve appears as an `ext:<name>` node rather than as a symbol. That is a real gap in the index, surfaced rather than papered over: the edge `caller --calls--> ext:name` is what the store holds, and no internal symbol is substituted for it", "The graph reflects the index as of the last index run", "Owner-cascade attribution: a relationship stored against a class member (e.g. a call to a method) is reported toward the owner class, so caller/callee sets are a superset of exact-symbol-only matches. The superset is REDUCIBLE: every edge carries `match` (`exact` or `owner-cascade`) and, when cascaded, `matchedMember` naming the member the stored row actually referenced, and the summary carries the exact/cascade split. Measured on cobra, `Command` (182 methods) answers with 184 caller edges of which 24 name `Command` itself — a ratio no per-edge field alone makes obvious, and one no count in the payload revealed before the split existed. Every edge also carries the `rowId` it traces to",
      "A target the index could not resolve is reported as an `ext:<name>` node — a NAME the index saw and could not attach to a symbol — and is never resolved by matching that name against other symbols in the project. The name is not unique there (measured on vscode, `match` names 37,876 stored symbols; on svelte, `end` names 437,570), so matching it would manufacture edges the store does not contain, crowd out the resolvable callees, and seed the traversal with a guess. `ext:` nodes are leaves: there is nothing stored about them to walk into",
      "Two identical calls return identical answers unless the wall-clock bound fired in one of them, in which case `summary.timeBudgetExhausted` says so. Every other bound here — the per-query site limit, the fan-out budget, the total-answer bound, the depth — is a function of the data, so two identical calls on an unchanged index always agree",
      "A symbol name is not a unique identifier. When one name matches several stored symbols the resolver takes the highest-gravity match (ties broken by lowest id, so the pick is reproducible rather than SQLite's whim) and says how many it chose between in `root.candidates` — measured: `build` in lodash resolves among 7, `code_block.go` in cobra among 50, `Command` among 1. When `root.candidates` is greater than 1 the graph is about ONE of those symbols, so confirm `root` is the one you meant before reading the edges. The other candidates are not listed",
      "A name containing a SQL LIKE wildcard (`%`, `_`) is matched LITERALLY, not as a pattern: it either resolves to a symbol that genuinely contains those characters or is reported not found. It never widens into a match on an unrelated symbol", "Call-site positions depend on the analyzer: an exact line is claimed only where the index stored a real line; a legacy 0 or a NULL line yields the declared `declaration` or `unknown` address instead (derived by src/intelligence/graph/line-address.ts — never an inline fallback)", "`summary.totalCallers`/`totalCallees` are the RETURNED counts, not the totals. A per-symbol site limit (`edgeLimit`, default 200, max 5000) bounds one edge query; when it is reached the answer declares `truncated` with `truncationReason` naming the bound (`caller-site-limit` / `callee-site-limit`), `cappedQueries` says how many queries hit it, and `callersIfUncapped`/`calleesIfUncapped` carry the root's true site count (null when no cap was reached — never zero). Before M59.A12 (#888) the limit was silent: a symbol with 3,437 call sites answered 200 rows with `truncated: false`. The cap now fires only when rows were ACTUALLY dropped: the query asks for one row beyond the limit, so a symbol holding exactly `edgeLimit` sites is reported complete instead of falsely truncated"],
    performance: "maxDepth (default 3, max 10) bounds traversal; per-edge evidence resolution is bounded by the returned subgraph. The answer is bounded at three levels and every level is declared: the per-query site limit (`edgeLimit`, default 200, max 5000), the fan-out budget (50 symbols per direction, `callerBudget`/`calleeBudget`) and the size of the WHOLE answer (`maxEdges`, default 1000, max 5000). The third exists because the product of the first two is not a number a reader can use: measured, ripgrep's `unwrap` returns 206 edges at depth 1, 454 at depth 3 and 702 at depth 5 - 228 KiB, 504 KiB and 770 KiB rendered. Reaching `maxEdges` is declared as `total-edge-limit` with the value in `summary.maxEdges`. A fourth bound is a wall-clock budget for the walk (`timeBudgetMs`, default 2000, 0 disables it), and it is the ONE bound here that is a function of the clock rather than of the data: a run that hits it can return fewer edges than an otherwise identical run moments later, and `summary.timeBudgetExhausted` says when. Measured, one run of cobra's busiest symbol at depth 3 rendered 526,043 bytes and the next 493,988. Raise `timeBudgetMs`, or set `0` to accept the runtime, when you need the whole set or a reproducible answer. The depth bound (`maxDepth`, paired with the `maxDepthReached` that says how far the walk actually got) is the fourth `direction` halves the work when only one side is wanted. `direction` halves the work when only one side is wanted — measured on cobra, a caller-only question about a symbol with 36 callees returned 1 edge instead of 37. The per-direction fan-out budget (50 symbols) is internal and is not exposed: truncation is declared in the summary when it bites.",
    safety: "Read-only. It does not modify source files or index data.",
    evidence: "Nodes and edges come from the canonical graph engine over brain_symbol and brain_relationship rows; each edge carries its evidence tier, its confidence, the `rowId` of the row it came from, and `match`/`matchedMember` saying whether the row names the traced symbol or one of its members. Every emitted rowId resolves to exactly one stored row and the edge's endpoints agree with that row — verified against an independent SQL oracle on real repositories. The declared totals are counted with the same query and the same noise filters as the returned edges, so a reported total is the number a caller would receive if no limit existed — verified against an independent SQL count on real repos (validation/m59/results/cap-real-corpus.json). Owner-cascade edges are auditable in the same way: `match` and `matchedMember` identify the member the stored row actually named, and the exact/cascade split in the summary is verified against an independent SQL count of direct-target rows on real repos (cobra: tool reports `exactCallers: 24`; oracle counts 24 direct caller rows for the same symbol).",
  },
  bb_impact: {
    returns: [
      "The rule the answer was MEASURED under, in `rule`: which relationship kinds count as dependencies (the applied list is echoed here on every answer), the owner-cascade, the noise policy, and the depth",
      "Whether the set is the WHOLE truth or a prefix of a larger one, and how that was established: the component measures the returned set against an unbounded walk of the same rule whenever truncation was declared or the walk reached the last expandable depth, and declares a prefix when they disagree — even when no bound fired",
      "Downstream dependents of the symbol with per-edge evidence tiers and confidence, cross-language flags, bridge mechanism, and each dependent's own position",
      "How the requested name became the root it walked: `rootMatch` carries the name asked for, whether the match was exact, a containment match, or the member→owner substitution, and how many stored symbols carry that exact name",
      "The declared limits, from the component that owns them: `budget` (node budget, depth, and the THREE ceilings the declared total is computed under) and `traversal` (depth actually reached, the engine's own truncation state and reason, its per-query site limit, its capped-query count, and the root's uncapped caller count when computable). The two work ceilings (`totalScanCeiling`, `totalExpansionCeiling`) are properties of the INDEX, so the same question always gets the same answer; `totalTimeCeilingMs` is a property of the MACHINE, and it is the one bound that can make two identical calls differ — `countVerification.timedOut` says when that happened",
      "How completeness was established, in `countVerification`: `ran: false` means the walk never reached the depth boundary, so no node could have been blocked and every bound that could fire has declared itself — the set is the whole truth by construction, with no measurement paid for. `ran: true` means the set was measured against an unbounded walk of the same rule and the two agree. `timedOut: true` means the measurement stopped on the wall clock, which is the only published reason the same question can get two different answers",
      "How each dependent is a dependent, per row, in `via`: `exact` (the stored row names the symbol asked about), `member` (it names one of its members — the owner cascade working as declared, with the member named in `viaMember`), or `range-folded` (it names neither, and the row is in the answer only because the cascade RANGE widened). `cascade` is the composition of the returned set by those three, or `null` when the index refused the member lookups it needs to establish it",
      "`directCount` — the exact number of DIRECT dependents, or `null` when the counting walk hit a declared ceiling. `totalCountIfKnown` is the true transitive total under the same rule, or `null` for a declared unknown. Neither is ever smaller than `shownCount`. `rule.relationshipTypes` names the kinds that count, so a `uses` or `references` relationship that did not appear is explained rather than mysterious",
      "Freshness: a per-dependent `stale` flag (`true`/`false`, or `null` when the file is not in the index at all) and a summary `freshness` envelope; `rootStale` declares the root's own file separately, since a stale root with fresh dependents is still a stale answer",
      "Declared-absent result when the symbol is unknown — never an empty guess",
    ],
    errors: [
      "Missing symbol",
      "Symbol not found in the index",
      "The named symbol exists but is not a traversable root (an enum member, a constant, a plain field) — a declared error naming the kind, never an empty set",
      "relationshipTypes given as an empty list (a narrowed rule that can match nothing is refused rather than silently re-read as the default — the same refusal bb_graph raises)",
    ],
    limitations: [
      "Static impact analysis cannot establish runtime behavior",
      "Reflects the index as of the last index run; the freshness envelope states how far that is from the files on disk",
      "Owner-cascade attribution applies: dependents through class-member relationships are attributed to the owner class",
      "A truncated answer is a bounded PREFIX of the set, not a sample of it: the walk is depth-first, so a hub's 200 returned rows are an exploration order, not the 200 nearest dependents. `directCount` is the field that makes the shape readable. The set is then re-sorted by the SHORTEST path the measurement found, so `depth` is minimal rather than first-traced, but membership is still the walk's exploration order",
      "The owner cascade is a RANGE over symbol ids, and a range widens: for a member `P:container:29` it covers [`P:container:`, `P:container;`) — the whole container — so every sibling of `29` is folded in with it. Measured, the range is a strict SUPERSET of the owner relation (it never loses a dependent the owner relation has) but it adds dependents the owner relation does not: ripgrep `RegexMatcher` answers 21 of which 7 are `range-folded` and 0 are real members, graphql-js `join` 9 of 128, lodash `call` 2 of 85. `cascade.rangeFolded` counts them, so the over-count is visible instead of silent. The walk that implements the range is the graph engine's and is not changed here",
    ],
    performance:
      "Complete answers stay under ~250 ms on the lane's corpora. A truncated hub pays for an unbounded counting walk so the declared total is honest: 0.5–2.0 s, bounded by two declared ceilings (50 000 scanned rows, 2 000 expansions) past which the total is a declared `null` rather than a number paid for with seconds.",
    safety: "Read-only. It does not modify source files or index data.",
    evidence:
      "Impact derives from brain_relationship rows via the same engine the editor impact panel uses. The declared total is measured by an independent bounded walk under the traversal's own rule — same relationship kinds, same owner cascade, same noise policy, same depth — so it is the size of the set the answer is a prefix of. Completeness is PROVED rather than inferred: whenever truncation was declared, or the walk reached the last expandable depth, the set is measured against an unbounded walk and declared a prefix when the two disagree, which is how cobra `HasAvailableFlags` came to answer 28 with `truncated: true` instead of 27 with `truncated: false`. An independent SQL oracle in the bb_impact corpus lane re-derives both the set and the total from the stored tables on nine real repositories, with an SQL-level differential between the cascade range rule and the owner relation behind the `via` numbers above.",
  },
  bb_cross_language: {
    returns: [
      "One fact per stored cross-language row about the name. `facts` holds the rows on the copies themselves; `memberFacts` holds the rows on their MEMBERS, each marked `match: \"owner-cascade\"` with `matchedMember` and `matchedMemberId` naming the member. Every fact names both ends — `self` (symbol, file, language, line) and `other` — plus the stored `rowId`, direction, bridge, evidence tier and confidence",
      "`copies`: every indexed symbol carrying the name, with file, language, line and cross-row count, plus `ambiguous` and `ambiguityNote`",
      "`ownFactCount` and `memberFactCount` separately, so a reader can tell a symbol that is itself connected from one that is connected only through its members — and `silentItselfButNotItsMembers` when that is the case",
      "Declared absence only when NEITHER the copies nor their members hold a stored row, with `absenceNote` saying so — and saying so SCOPED TO THE PROJECT, because that is all the three queries behind it searched. It reads \"anywhere in THIS PROJECT's index\", because it used to read \"anywhere in the index\" while searching one project, which was false whenever the same name existed in another project holding rows for it (M63.CL4)",
      "Declared truncation: `truncated`, `truncationReason` and `totalCountIfKnown` when the `limit` bounded the answer. `unpairableRowCount` and `collapsedRowCount` are GUARDS, not activity: each is 0 on all 1,662 names across two measured corpora, because the store as written cannot produce either state (see the limitations). They are verified by seeding the state each one guards, and both can be broken, so they are known to work rather than assumed to",
    ],
    errors: ["Missing or blank symbol", "Symbol not found in the index (declared, not an empty set)", "limit outside the declared 1..1000 range (refused, never clamped silently)"],
    limitations: [
      "Reads stored is_cross_language=1 relationship rows only; never infers cross-language facts. Absence means \"no stored rows FOR THIS PROJECT\", never \"this symbol is unconnected\": the same name in another project may hold rows for it, which is why the absence note names the scope",
      "Reads stored is_cross_language=1 relationship rows only; never infers cross-language facts",
      "Coverage depends on the analyzers that produced cross-language rows — this tool reports what was stored, nothing more",
      "A name is many symbols: the answer is the UNION over every copy, never a silent choice among them. Narrow with the `copies` list — every fact names the copy it came from",
      "`collapsedRowCount` is 0 everywhere and is expected to be. It needs a row matched by BOTH the by-name query and the owner-cascade query, which needs a member named exactly like its owner — and the member query excludes that case by its own `m.name <> owner.name` filter, so the SQL forbids it rather than the data being empty. It is verified by seeding two same-named symbols in files of different languages, which does satisfy both arms; a self-edge does not, because one file means one language and the row is dropped as unpairable first. A mutant that removes the rule is caught",
      "MEMBER ROWS ARE REPORTED, NOT ABSORBED. 95.4% of stored cross-language rows target a member rather than a class or namespace, so a by-name answer for an owner finds almost nothing on the owner itself. Those rows appear in `memberFacts`, attributed to the member, because an edge on `Label.newLabel` is not an edge on `Label`. bb_graph answers the same question by CASCADING member edges onto the owner, so its count is larger: its cascade is a lexical id-prefix range, this tool's is the store's `owner_symbol_id`. Both are declared; neither is reconciled into the other",
      "`bridge` is the stored `bridge_mechanism`. On a real polyglot corpus it is almost always the indexer's `name-resolution` placeholder, which means two identifiers matched by name — not that the two languages communicate by that mechanism. Weigh it with `tier` and `confidence`",
      "A row whose endpoint file has no detected language cannot name a pair; such rows are counted in `unpairableRowCount` and never dressed up with a guessed language. No corpus reaches that state — all 922 indexed files carry a language, and the indexer flags a row cross-language only when the two files' languages differ — so the guard is verified by seeding an unlabelled endpoint, and a mutant that fabricates a pair for it is caught",
      "Over half of the stored cross-language rows on the measured corpus carry no analyzer evidenceClass, so their tier is derived by the shared rule rather than claimed by the analyzer",
    ],
    performance: "Three indexed queries — the stored rows for the name, the rows on its members, and every symbol carrying the name — with no graph traversal; every declared count is derived from the rows those three already returned, so there is no fourth query for it. Measured on a 230-file JVM corpus: the mean answer is 7 facts and 7.5KB, p90 is 12 facts, and the response is bounded by `limit`. For scale, `bb_graph` returns 3-8x more bytes for the same symbols, and on owner-heavy symbols it took 29-79s where this tool takes 14-53ms.",
    safety: "Read-only. It does not modify source files or index data.",
    evidence: "Only brain_relationship rows with is_cross_language=1, filtered by the ROW's own project_id — in both this tool and the editor cross-language hover section, which previously joined the opposite symbol with `ss.project_id = r.project_id` and so returned another project's rows; both directions of that fix are proved load-bearing by mutants that each remove one of them. Classified by the single evidence-tier rule in src/lsp/evidence_tier.ts, over a projection that names both ends because a hover card already shows which file the reader is in and an agent does not. Every count is cross-checked against an independent SQL count over two real polyglot indexes — a 230-file JVM corpus (3 language pairs) and a 692-file Elixir/Erlang corpus (16 pairs, 1,168 cross-language rows) — and thirteen planted defects are all caught on both, including three specific to the member section (cascade laundered, the pre-CL2 absence rule, and a cascade reported with no member to check it against) and two that break one direction of the hover door's project scope. Four further surfaces are covered that no corpus reaches — a project with no cross-language rows at all, a truncation driven by the member section, the own-first precedence rule at limit 1, and the absence note's project scope, the last of which found a real defect — bringing the total to fourteen planted defects: script/m63/verify-cl1-cross-language.ts, validation/m63/results/CL1.json. A corpus-free check that every mutant still has a live anchor runs in `verify:fast` as script/m63/verify-cl1-wiring.ts.",
  },
  bb_annotate: {
    returns: [
      "Stored annotation row with its enforced provenance (author class `agent`, never spoofable) and the calling tool identity, recorded verbatim",
      "`surfacing` — whether an editor surface can actually show this note, MEASURED against the index rather than promised: `editor` (bool, the AND of `nameMatched` and `pathMatched` — the editor needs BOTH), `nameMatched`, `pathMatched`, `matchedAs` (`name` and/or `qualifiedName`), `matchedNames`, and a `statement` saying what is and is not true. The name matching is necessary but not sufficient: a note on a symbol the index holds, written against a path it has never seen, can never be selected by a file-scoped hover, and is reported `editor: false` with the reason. This replaced a `surfaces` field that claimed the note \"renders in the editor hover section and graph badge\" for every note; measured on a real corpus, 100% of notes written under a symbol's qualified name matched no symbol name at all, so that claim was false exactly where it sounded most confident",
      "The path handling: `surfacing.pathNote` when a path was resolved to the index's own spelling, `surfacing.pathWarning` when no indexed file matches the given path (stored under that spelling, no editor surface will scope it to a file), and a name-level note statement when no path was given",
    ],
    // Honesty: this tool does NOT require the symbol to exist in the index. It is
    // a free-form note store — an agent may annotate before a symbol is indexed, or
    // a name the analyzer did not classify — so `unknown symbol` is a declared
    // ACCEPTANCE with `surfacing.editor: false`, not a refusal. The previous claim
    // ("Missing or unknown symbol") was a doc-truth lie: the handler only ever
    // refused a blank symbol, and a symbol absent from brain_symbol stored with
    // stored:true.
    errors: [
      "Missing or blank symbol",
      "Empty body (a refusal, not a silent no-op)",
      "Body exceeds the declared 2000-char limit, counted in characters (an astral glyph is one character, not two UTF-16 units)",
      "toolIdentity exceeds the declared 200-char limit — refused, never truncated",
      "toolIdentity containing a control character or line break — a label is a name, not a document. Refused, because a newline in that field rendered (measured, through the real renderer) as a SECOND provenance line that could claim to be a human note",
    ],
    limitations: [
      "Annotations are opinions layered on index evidence, never index truth",
      "Annotation store semantics are owned by the M28 workstream",
      "Any symbol name is accepted. Reachability is reported, not enforced: a name no indexed symbol carries is stored and declared `surfacing.editor: false`",
      "The note is keyed on the name as given. A name that matches several indexed symbols (a name is one symbol per file/line — `force` in 8 files of a real corpus) is one note shown wherever that name appears, unless `path` scopes it to a file",
      "`path` is resolved to the index's own spelling (`brain_file.relative_path`), so `src/a.ts`, `./src/a.ts` and the absolute path are the SAME note. A path matching no indexed file is stored verbatim and declared",
      "`toolIdentity` is the caller's own label. It is recorded verbatim and never verified — `author_class` is the enforced field",
      "The editor renderer escapes EVERY interpolated field, not only the body: `author_class`, `tool_identity` and `body` all go through the escaper, and a line break in any of them is flattened to a space. Markup escaping alone is not enough — a newline is what turns one annotation into two in a markdown list, which is how a caller's own label once forged a line reading 'human note by the-review-team'. So a row that already carries such a value — written before the guard, or by any other writer — still renders as exactly one line",
      "One note is kept per location, so a second agent annotating the same symbol+path REPLACES the first note. The replacement is reported in `replaced` with the previous body, but the previous note does not survive in the store. Annotating a DIFFERENT path (or no path) keeps a separate note per location",
    ],
    performance: "Constant-time store write bounded by the 2000-char body limit. `surfacing` adds two indexed lookups (name, qualified name) plus one file-row lookup for the path.",
    safety: "Write-capable against the annotation store only. It never modifies source files.",
    evidence: "Annotations carry provenance (toolIdentity, time) and are stored in brain_annotation. `author_class` is constrained to {agent, human} by a storage-level trigger, so a row cannot carry a third claim that every reader would then render verbatim.",
  },
  bb_annotations: {
    returns: [
      "Typed annotations for a symbol or the whole project, with full provenance on every row (author class, tool identity, timestamps)",
      "`count` (the page size), `totalCountIfKnown` (the true number of matching annotations) and `truncated` with a `truncationReason` naming the fix — a bounded read declares its bound, like bb_search and bb_graph. This door used to return only `count`, so a project with 300 notes and the default limit answered a flat `count: 50` with no way to know 250 more existed",
      "Declared-absent result when none exist — absence is never an error",
    ],
    errors: ["limit outside the declared 1-200 range"],
    limitations: [
      "Reads only stored annotations; absence is declared, not inferred",
      "Annotation store semantics are owned by the M28 workstream",
      "Without `path`, a symbol that lives in several files returns every file's notes together; pass `path` (or read each row's symbol_path) to separate them",
      "A `symbol` filter also matches notes written under a symbol's QUALIFIED name, because that is one of the two name forms the editor accepts. This is the same predicate `surfacing` reports, so a reader and the editor always agree on which notes exist",
      "`path` is resolved to the index's own spelling before filtering, so a reader passing `./src/a.ts` finds the note a writer stored as `src/a.ts`",
      "A `path` filter WITHOUT a `symbol` returns that file's own notes only. It used to also return every NAME-LEVEL note in the project, because a name-level note does apply wherever its name appears — but that made a narrow question answer mostly-global: measured on a real corpus, a path read returned 2 notes for the file and 48 name-level notes from the whole project, and the file's own notes were nearly cut off by the default limit. Pass `includeNameLevel: true` for the broader set. With a `symbol` AND a `path`, name-level notes about THAT symbol are still included, because they are about the symbol you asked for",
    ],
    performance: "Indexed lookup by project and symbol (brain_annotation_project_symbol_idx). The declared total is a second COUNT over the same predicate, so `totalCountIfKnown` costs one indexed count.",
    safety: "Read-only. It does not modify source files, index data, or annotations.",
    evidence: "Rows come from brain_annotation with provenance fields preserved.",
  },
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const artifactPath = resolve(root, "docs/data/public-tools.json")
const referenceDir = resolve(root, "docs/tools")
const siteDataPath = resolve(root, "website/src/data/tools.generated.ts")

function artifact(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    packageVersion: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version,
    generatedFrom: ["src/mcp/tool-registry.ts", "script/verify-tool-docs.ts"],
    tools: PUBLIC_TOOL_DESCRIPTORS.map((descriptor) => ({
      ...descriptor,
      referencePath: `docs/tools/${descriptor.name}.md`,
      ...curated[descriptor.name],
    })),
  }
}

// M35.D1: staleness section rendered from the executable registry + the
// registered remediation constants — docs CANNOT drift from code because both
// sides derive from the same source here.
export const FRESHNESS_TOOLS: Record<string, { modes: string[]; surfaces: string }> = {
  bb_search: { modes: ["symbol", "content", "file"], surfaces: "per-row `stale` flags + `freshness` block (`{ fresh, stale, missing, staleRatio, mode, remediation }`)" },
  bb_analyze: { modes: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"], surfaces: "`freshness` block (`{ fresh, stale, missing, staleRatio, mode, remediation }`); graph nodes and report rows carry `stale` flags (project-wide modes sample or resolve visible rows only — the block names its coverage mode)" },
  bb_visualize: { modes: [], surfaces: "per-node and per-link `stale` flags (links inherit worst-of-endpoints) + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON; truncation composes with staleness" },
  bb_migrate: { modes: ["plan"], surfaces: "per-plan `sourceFile` + `stale` flags with an up-front stale-plan notice + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON" },
  bb_patterns: { modes: [], surfaces: "per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh" },
  bb_security: { modes: [], surfaces: "per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh" },
  bb_doc: { modes: [], surfaces: "`freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON + footer naming the remediation; per-citation `(stale)` in Sources; silent when all fresh" },
  // bb_ask reports per-source staleness but is NOT auto-refreshing, and it does
  // NOT emit a `freshness` envelope. Both halves matter and the generated page
  // used to get the first one wrong: it claimed the tool "does not report
  // per-file index staleness", while the retrieval path has always marked every
  // cited source whose file changed on disk with `[STALE — file changed since
  // index]` (measured with a controlled edit; see fixtures/bb_ask). A verified
  // aggregate answer — a count — carries no per-file marker, because a count
  // describes the whole index rather than a file, and that is stated rather than
  // left to be discovered.
  // M63.T2: the tool whose answer is acted on, and the last read surface
  // without a freshness block. Registered here with the surfaces it really
  // has: a per-dependent `stale` flag, the root's own `rootStale`, the
  // envelope, and the bounded inline repair. The page previously said the tool
  // "does not report per-file index staleness" — while its own remediation text
  // named `refresh=false` and `BB_NO_AUTO_REFRESH=1`, two controls it did not
  // accept. Both facts are now true.
  bb_impact: { modes: ["impact"], surfaces: "per-dependent `stale` flag (three states: `true`/`false`, or `null` when the file is not in the index at all), the root's own `rootStale`, and a `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`). Stale files inside the answer are repaired within budget and the walk is re-run, declared in `autoRefresh`; `refresh=false` opts out" },
  bb_ask: { modes: ["answer"], surfaces: "per-source `[STALE — file changed since index]` markers on retrieval answers, repeated in the source list; a verified aggregate answer carries no per-file marker (it describes the whole index, not a file)" },
}
// M48.D1 (#701): explicit cross-reference map. Every overlapping tool pair
// states when to use which — rendered into every per-tool doc so an agent or
// human reading one page knows its neighbors. Kept adjacent to the generator
// so docs cannot drift from the map (the M48.D1 gate asserts each row lands).
export const RELATIONS: Record<string, string> = {
  bb_search: "For lexical/exact retrieval use this tool. For natural-language questions over the codebase use `bb_ask` (semantic, cited answers).",
  bb_ask: "For exact symbol/content/file retrieval use `bb_search`; this tool answers natural-language questions with citations.",
  bb_analyze: "For the plain per-symbol call graph use `bb_graph` (same engine, evidence tiers). For bounded impact-with-files use mode `impact` (numbers identical to `bb_impact`).",
  bb_graph: "For richer analysis (dependencies, complexity, tests, impact aggregation) use `bb_analyze`; for plain callers/callees with evidence tiers this is the tool.",
  bb_impact: "This is the bounded-impact specialist; `bb_analyze` mode `impact` aggregates the same canonical walk with file-level risk — the numbers are identical by gate.",
  bb_cross_language: "For same-language callers/callees use `bb_graph`; this tool reports cross-language pairs and bridges (declared absent when none).",
  bb_visualize: "For raw graph data use `bb_graph`; this tool renders diagrams with truncation metadata.",
  bb_edit: "To attach human-visible notes to symbols use `bb_annotate`; this tool mutates source files.",
  bb_annotate: "To change source code use `bb_edit`; this tool stores provenance-enforced notes on symbols.",
  bb_annotations: "To write a note use `bb_annotate`; this tool reads stored annotations and declares absence.",
  bb_index: "The CLI twin is `bb index` (same semantics; see docs/MCP_CLI_INDEXER_GUIDE.md). Refresh changed files after agent edits with mode `dir`/`file` or the CLI `--changed`.",
  bb_health: "For index size/counts use `bb index status` (CLI) or the stats surface; this tool reports index health and integrity.",
  bb_doc: "For raw symbol metadata use `bb_search` mode `symbol`; this tool composes documented, cited explanations.",
  bb_patterns: "For security-specific taint findings use `bb_security`; this tool covers orphans, framework patterns, and anti-patterns.",
  bb_security: "For general code-quality patterns use `bb_patterns`; this tool focuses on taint flows and security findings.",
  bb_migrate: "For dependency structure use `bb_graph`; this tool produces migration plans with declared limitations.",
}

/**
 * Tools whose staleness section is written by hand in `stalenessSection`
 * rather than derived from FRESHNESS_TOOLS or from the "no freshness surface"
 * default. Exported so the M48.D1 gate can hold these to their real text
 * instead of to one of the two blanket phrasings — which is how bb_edit's page
 * stayed stale and un-flagged: M59.A11 changed this generator, the committed
 * markdown was never regenerated, and the gate was still checking the old
 * wording, so the staleness check passed against text the generator no longer
 * produces.
 */
export const CUSTOM_STALENESS_TOOLS = new Set(["bb_edit"])

function stalenessSection(tool: any): string {
  // M59.A11 (#890): bb_edit is the one tool that CONSUMES a stale target by
  // refreshing it rather than reading around it or refusing. Stated here so the
  // generated page cannot claim it "does not auto-refresh".
  if (tool.name === "bb_edit") {
    return `No freshness flags are returned — this tool does not summarize OTHER files' staleness, and it does not read stale data: a stale TARGET file is refreshed (that file only) and the symbol re-resolved from the bytes on disk before the edit is planned, and the refresh is named in \`warnings\`. If that change renamed or removed the symbol, the edit is refused by name rather than applied to a stale span. For unrelated files, remediation stays manual: project scope → \`${FRESHNESS_REMEDIATION.dir}\`.`
  }
  const info = FRESHNESS_TOOLS[tool.name]
  if (!info) {
    // M48.D1 (#701): explicit about auto-refresh so the section cannot be
    // misread as contradicting tools that DO auto-refresh (bb_graph et al do
    // not). Truth: this tool neither reports staleness nor auto-refreshes.
    return `This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first (project scope: \`${FRESHNESS_REMEDIATION.dir}\`).`
  }
  const modePart = info.modes.length ? `Freshness modes (registered as \`freshnessModes\`): ${info.modes.map((m) => `\`${m}\``).join(", ")}.` : "Freshness applies to the tool's read output (no registered per-mode split)."
  // bb_ask reports staleness but never auto-refreshes, and unlike the graph
  // tools it emits no `freshness` envelope. The two facts are stated so the
  // page cannot be read as promising either — and its remediation text is the
  // MANUAL one, because the shared constant names automatic refresh and would
  // otherwise put "reads auto-refresh stale files within budget when enabled"
  // two sentences after "this tool does not auto-refresh".
  if (tool.name === "bb_ask") {
    return `${modePart} Staleness surfaces as: ${info.surfaces}. This tool does not auto-refresh, and it emits no \`freshness\` envelope: a verified aggregate answer is a count over the whole index rather than a per-file fact, so there is no per-file envelope to publish. When a cited source is stale, remediation is manual: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only). Nothing is stale → no marker. Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
  }
  return `${modePart} Staleness surfaces as: ${info.surfaces}. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → \`${FRESHNESS_REMEDIATION.dir}\`; file scope → \`${FRESHNESS_REMEDIATION.file}\`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
}

function renderReference(tool: any): string {
  const schema = JSON.stringify(tool.inputSchema, null, 2)
  const examples = tool.documentation.examples.map((example: unknown) => `\`${JSON.stringify(example)}\``).join("\n\n")
  const bullets = (items: readonly string[]) => items.map((item) => `- ${item}`).join("\n")
  return `# \`${tool.name}\`\n\n${tool.description}\n\n## Contract\n\n- Category: \`${tool.documentation.category}\`\n- Mutability: \`${tool.mutability}\`\n- Requires index: \`${tool.requiresIndex}\`\n- Modes: ${tool.modes.map((mode: string) => `\`${mode}\``).join(", ")}\n- Planned modes (roadmap, not executable): ${(tool.plannedModes ?? []).map((mode: string) => `\`${mode}\``).join(", ") || "(none)"}\n- Defaults: \`${JSON.stringify(tool.documentation.defaults)}\`\n\n## Input Schema\n\n\`\`\`json\n${schema}\n\`\`\`\n\n## Returns\n\n${bullets(tool.returns)}\n\n## Examples\n\n${examples}\n\n## Errors\n\n${bullets(tool.errors)}\n\n## Limitations\n\n${bullets(tool.limitations)}\n\n## Performance\n\n${tool.performance}\n\n## Safety\n\n${tool.safety}\n\n## Evidence Semantics\n\n${tool.evidence}\n\n## Relationship to other tools\n\n${RELATIONS[tool.name] ?? ""}\n\n## Staleness\n\n${stalenessSection(tool)}\n\nThis page is generated from the executable registry and curated documentation. Run \`npm run docs:generate\` to update it.\n`
}

// M56.T1 (#781): the website's tool reference is generated HERE, in the same
// pass that writes docs/data/public-tools.json and docs/tools/*.md, so the
// site, the shipped markdown reference and the executable registry cannot
// disagree. Every field below is either a registry field or a curated field
// rendered into docs/tools/*.md — the site renders these values and may not
// hand-type tool facts.
function siteToolFacts(): unknown[] {
  const data = artifact() as { tools: any[] }
  return data.tools.map((tool: any) => ({
    name: tool.name,
    category: tool.documentation.category,
    summary: tool.documentation.summary,
    description: tool.description,
    mutability: tool.mutability,
    requiresIndex: tool.requiresIndex,
    modes: tool.modes,
    plannedModes: tool.plannedModes ?? [],
    parameters: Object.entries((tool.inputSchema?.properties ?? {}) as Record<string, any>)
      .map(([pname, p]: [string, any]) => ({
        name: pname,
        type: p.type ?? "any",
        required: ((tool.inputSchema?.required ?? []) as string[]).includes(pname),
        description: p.description ?? "",
      }))
      .sort((a: any, b: any) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name)),
    defaults: tool.documentation.defaults,
    examples: tool.documentation.examples,
    returns: tool.returns,
    errors: tool.errors,
    limitations: tool.limitations,
    performance: tool.performance,
    safety: tool.safety,
    evidence: tool.evidence,
    relations: RELATIONS[tool.name] ?? "",
    staleness: stalenessSection(tool).replace(/`/g, ""),
    referencePath: tool.referencePath,
  }))
}

function renderSiteData(): string {
  return `// AUTO-GENERATED by script/verify-tool-docs.ts --write - DO NOT EDIT BY HAND.
//
// The website tool reference, derived from the executable registry
// (src/mcp/tool-registry.ts) through the same pass that writes
// docs/data/public-tools.json and docs/tools/*.md. Fields are registry fields
// or curated reference fields; the tools page, the docs table and the homepage
// render these values and are forbidden from hand-typing tool facts.
//
// Regenerate: bun run docs:generate
// Verify:     bun run docs:verify

export const TOOL_FACTS = ${JSON.stringify(siteToolFacts(), null, 2)}

export type ToolFact = (typeof TOOL_FACTS)[number]
`
}

function expectedFiles(): Map<string, string> {
  const data = artifact() as { tools: any[] }
  const files = new Map<string, string>([[artifactPath, `${JSON.stringify(data, null, 2)}\n`]])
  for (const tool of data.tools) files.set(resolve(root, tool.referencePath), renderReference(tool))
  files.set(siteDataPath, renderSiteData())
  return files
}

const files = expectedFiles()
if (process.argv.includes("--write")) {
  mkdirSync(dirname(artifactPath), { recursive: true })
  mkdirSync(referenceDir, { recursive: true })
  mkdirSync(dirname(siteDataPath), { recursive: true })
  for (const [path, content] of files) writeFileSync(path, content)
  console.log(`Generated ${files.size} canonical tool documentation artifacts.`)
  process.exit(0)
}

let failures = 0
for (const name of Object.keys(curated)) {
  if (!PUBLIC_TOOL_DESCRIPTORS.some((tool) => tool.name === name)) {
    console.error(`FAIL: curated documentation exists for non-public tool ${name}`)
    failures++
  }
}
for (const descriptor of PUBLIC_TOOL_DESCRIPTORS) {
  if (!curated[descriptor.name]) {
    console.error(`FAIL: public tool ${descriptor.name} has no curated documentation`)
    failures++
  }
}
for (const [path, expected] of files) {
  let actual = ""
  try { actual = readFileSync(path, "utf8") } catch {}
  if (actual !== expected) {
    console.error(`FAIL: ${path.slice(root.length + 1)} is missing or stale; run npm run docs:generate`)
    failures++
  }
}
if (failures) process.exit(1)
console.log(`TOOL DOCS: PASS (${PUBLIC_TOOL_DESCRIPTORS.length} public tools, ${files.size} artifacts)`)
