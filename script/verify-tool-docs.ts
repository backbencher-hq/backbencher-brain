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
    returns: ["Mode-specific typed analysis", "Graph, dependency, complexity, impact, or test evidence", "Explicit unavailable and truncation states"],
    errors: ["Missing required mode", "Missing target for a target-based mode", "Option irrelevant to the selected mode"],
    limitations: ["Static relationships cannot establish runtime behavior", "Test results describe indexed static evidence, not executed coverage", "Callers/callees/trace/impact modes share the graph engine's owner-cascade semantics: a relationship stored against a class member is attributed to the owner class", "The callers/callees/trace modes bound each edge query by a declared per-symbol site limit (200) and report it in `summary.truncated` / `summary.truncationReason` with the root's true count in `summary.callersIfUncapped`; `summary.totalCallers` is the returned count, never a silent total (M59.A12, #888)"],
    performance: "Mode-specific limits and graph traversal bounds prevent unbounded output.",
    safety: "Read-only. Analysis never creates tests or edits source.",
    evidence: "Findings derive from brain_* symbols, files, relationships, complexity, and test-file classifications.",
  },
  bb_patterns: {
    returns: ["Pattern findings with confidence and locations", "Orphan, framework, and anti-pattern classifications", "Optional persisted run history"],
    errors: ["Invalid scope or confidence threshold", "Unavailable index", "Unknown option"],
    limitations: ["Orphan status is static incoming-reference evidence, not proof that code is unused", "Framework and anti-pattern detection is heuristic and confidence-qualified", "Candidates are derived from analyzer-extracted symbols and relationships; the same graph gaps (dynamic/reflection wiring, unresolved cross-file references) that limit the analyzers also constrain these detections"],
    performance: "The result limit and confidence threshold bound reporting; history access is separately limited.",
    safety: "Source is read-only. recordRun writes only analysis-history records in the brain database.",
    evidence: "Every finding is confidence-qualified and tied to indexed files, symbols, or relationships.",
  },
  bb_security: {
    returns: ["Normalized security findings", "Cross-language source-to-sink flow evidence", "Optional persisted run history"],
    errors: ["Unavailable index", "Invalid history limit", "Unknown option"],
    limitations: ["Static taint analysis can produce false positives and false negatives", "It is not runtime testing or a penetration test"],
    performance: "Indexed flow analysis and output/history limits bound work and response size.",
    safety: "Source is read-only. recordRun writes only analysis-history records in the brain database.",
    evidence: "A finding is supported by indexed source/sink locations and relationship paths; severity does not imply exploitability.",
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
    returns: ["Canonical nodes and links", "Text, JSON, or self-contained HTML projection", "Provenance and explicit truncation metadata"],
    errors: ["Missing target for a scoped graph", "Unsupported scope or format", "Unavailable index"],
    limitations: ["The graph reflects static indexed relationships", "Nodes and links beyond configured budgets are omitted and reported", "Owner-cascade attribution: member-level relationships are attributed to the owner class, same as bb_graph"],
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
    returns: ["Per-symbol dependency graph: callers and callees", "Per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred) with confidence", "Per-edge call-site address (M62.A2): `{ kind, file, line, note }` — `call-site` is an exact stored line; `declaration` is a LABELED substitute (the calling symbol's own declaration, shown only when no call-site line is stored); `unknown` has no position at all (line null) and states why. A position is never fabricated and never reported as line 0", "Declared truncation with a reason when the traversal is bounded"],
    errors: ["Missing symbol", "maxDepth outside the declared 1-10 range", "Symbol not found in the index"],
    limitations: ["Edges reflect indexed static evidence with declared tiers; inferred edges are labeled, not proven", "The graph reflects the index as of the last index run", "Owner-cascade attribution: a relationship stored against a class member (e.g. a call to a method) is reported toward the owner class, so caller/callee sets are a superset of exact-symbol-only matches — every edge still traces to a stored relationship row", "Call-site positions depend on the analyzer: an exact line is claimed only where the index stored a real line; a legacy 0 or a NULL line yields the declared `declaration` or `unknown` address instead (derived by src/intelligence/graph/line-address.ts — never an inline fallback)", "`summary.totalCallers`/`totalCallees` are the RETURNED counts, not the totals. A per-symbol site limit (`edgeLimit`, default 200, max 5000) bounds one edge query; when it is reached the answer declares `truncated` with `truncationReason` naming the bound (`caller-site-limit` / `callee-site-limit`), `cappedQueries` says how many queries hit it, and `callersIfUncapped`/`calleesIfUncapped` carry the root's true site count (null when no cap was reached — never zero). Before M59.A12 (#888) the limit was silent: a symbol with 3,437 call sites answered 200 rows with `truncated: false`"],
    performance: "maxDepth (default 3, max 10) bounds traversal; per-edge evidence resolution is bounded by the returned subgraph.",
    safety: "Read-only. It does not modify source files or index data.",
    evidence: "Nodes and edges come from the canonical graph engine over brain_symbol and brain_relationship rows; each edge carries its evidence tier and confidence. The declared totals are counted with the same query and the same noise filters as the returned edges, so a reported total is the number a caller would receive if no limit existed — verified against an independent SQL count on real repos (validation/m59/results/cap-real-corpus.json).",
  },
  bb_impact: {
    returns: ["Downstream dependents of the symbol with per-edge evidence tiers and confidence", "Declared-absent result when the symbol is unknown — never an empty guess"],
    errors: ["Missing symbol", "Symbol not found in the index"],
    limitations: ["Static impact analysis cannot establish runtime behavior", "Reflects the index as of the last index run", "Owner-cascade attribution applies: dependents through class-member relationships are attributed to the owner class"],
    performance: "Traversal bounds match the canonical graph engine limits; output scales with the dependents subgraph.",
    safety: "Read-only. It does not modify source files or index data.",
    evidence: "Impact derives from brain_relationship rows via the same engine the editor impact panel uses.",
  },
  bb_cross_language: {
    returns: ["Cross-language relationship pairs for the symbol with bridge mechanism and evidence tier", "Declared-absent result when no stored cross-language rows exist"],
    errors: ["Missing symbol", "Symbol not found in the index (declared, not an empty set)"],
    limitations: ["Reads stored is_cross_language=1 relationship rows only; never infers cross-language facts", "Coverage depends on the analyzers that produced cross-language rows"],
    performance: "Bounded by the stored cross-language rows for the symbol; no graph traversal.",
    safety: "Read-only. It does not modify source files or index data.",
    evidence: "Only brain_relationship rows with is_cross_language=1; identical semantics to the editor cross-language hover section.",
  },
  bb_annotate: {
    returns: ["Stored annotation id and provenance (tool identity, timestamp)", "Declared refusals for missing symbol, empty body, or over-limit body"],
    errors: ["Missing or unknown symbol", "Empty body (a refusal, not a silent no-op)", "Body exceeds the declared 2000-char limit"],
    limitations: ["Annotations are opinions layered on index evidence, never index truth", "Annotation store semantics are owned by the M28 workstream"],
    performance: "Constant-time store write bounded by the 2000-char body limit.",
    safety: "Write-capable against the annotation store only. It never modifies source files.",
    evidence: "Annotations carry provenance (toolIdentity, time) and are stored in brain_annotation.",
  },
  bb_annotations: {
    returns: ["Typed annotations for a symbol or the whole project, with full provenance (author class, tool identity, timestamps)", "Declared-absent result when none exist — absence is never an error"],
    errors: ["limit outside the declared 1-200 range"],
    limitations: ["Reads only stored annotations; absence is declared, not inferred", "Annotation store semantics are owned by the M28 workstream"],
    performance: "Indexed lookup by project and symbol (brain_annotation_project_symbol_idx).",
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
const FRESHNESS_TOOLS: Record<string, { modes: string[]; surfaces: string }> = {
  bb_search: { modes: ["symbol", "content", "file"], surfaces: "per-row `stale` flags + `freshness` block (`{ fresh, stale, missing, staleRatio, mode, remediation }`)" },
  bb_analyze: { modes: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"], surfaces: "`freshness` block (`{ fresh, stale, missing, staleRatio, mode, remediation }`); graph nodes and report rows carry `stale` flags (project-wide modes sample or resolve visible rows only — the block names its coverage mode)" },
  bb_visualize: { modes: [], surfaces: "per-node and per-link `stale` flags (links inherit worst-of-endpoints) + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON; truncation composes with staleness" },
  bb_migrate: { modes: ["plan"], surfaces: "per-plan `sourceFile` + `stale` flags with an up-front stale-plan notice + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON" },
  bb_patterns: { modes: [], surfaces: "per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh" },
  bb_security: { modes: [], surfaces: "per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh" },
  bb_doc: { modes: [], surfaces: "`freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON + footer naming the remediation; per-citation `(stale)` in Sources; silent when all fresh" },
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
