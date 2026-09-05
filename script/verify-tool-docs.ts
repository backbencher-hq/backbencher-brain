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
    limitations: ["Static relationships cannot establish runtime behavior", "Test results describe indexed static evidence, not executed coverage"],
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
    limitations: ["The graph reflects static indexed relationships", "Nodes and links beyond configured budgets are omitted and reported"],
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
    errors: ["Path escape or symlink escape", "Stale or ambiguous indexed symbol bounds", "Caller protection, parse, formatting, or reindex failure"],
    limitations: ["Named symbol edits require a fresh index", "Refactoring is identifier-aware static rewriting, not a full language-server proof"],
    performance: "Only affected files are written, formatted, validated, and reindexed.",
    safety: "Write-capable. Uses project-root path checks, atomic writes, snapshots, validation, and rollback; use dryRun before risky edits.",
    evidence: "Mutation bounds come from indexed AST bytes; validation and reindex state report whether post-edit evidence is current.",
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
    returns: ["Per-symbol dependency graph: callers and callees", "Per-edge evidence tier (structural/import_based/usage_contextual/reference_qualified/inferred) with confidence", "Declared truncation with a reason when the traversal is bounded"],
    errors: ["Missing symbol", "maxDepth outside the declared 1-10 range", "Symbol not found in the index"],
    limitations: ["Edges reflect indexed static evidence with declared tiers; inferred edges are labeled, not proven", "The graph reflects the index as of the last index run"],
    performance: "maxDepth (default 3, max 10) bounds traversal; per-edge evidence resolution is bounded by the returned subgraph.",
    safety: "Read-only. It does not modify source files or index data.",
    evidence: "Nodes and edges come from the canonical graph engine over brain_symbol and brain_relationship rows; each edge carries its evidence tier and confidence.",
  },
  bb_impact: {
    returns: ["Downstream dependents of the symbol with per-edge evidence tiers and confidence", "Declared-absent result when the symbol is unknown — never an empty guess"],
    errors: ["Missing symbol", "Symbol not found in the index"],
    limitations: ["Static impact analysis cannot establish runtime behavior", "Reflects the index as of the last index run"],
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
    evidence: "Annotations carry provenance (toolIdentity, time) and are stored in brain_annotation. Stable today: row provenance (author class, tool identity, timestamps), one note per author per location, in-place update on re-annotate, and declared absence on reads. Store semantics beyond this surface are owned by the M28 workstream.",
  },
  bb_annotations: {
    returns: ["Typed annotations for a symbol or the whole project, with full provenance (author class, tool identity, timestamps)", "Declared-absent result when none exist — absence is never an error"],
    errors: ["limit outside the declared 1-200 range"],
    limitations: ["Reads only stored annotations; absence is declared, not inferred", "Annotation store semantics are owned by the M28 workstream"],
    performance: "Indexed lookup by project and symbol (brain_annotation_project_symbol_idx).",
    safety: "Read-only. It does not modify source files, index data, or annotations.",
    evidence: "Rows come from brain_annotation with provenance fields preserved. Stable today: typed reads per symbol or whole project with full provenance on every row and declared absence when none exist. Store semantics beyond this surface are owned by the M28 workstream.",
  },
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const artifactPath = resolve(root, "docs/data/public-tools.json")
const referenceDir = resolve(root, "docs/tools")

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
// sides derive from the same source here. M31.D5: bb_health reports index
// freshness (stale/missing counts + names) yet is not an envelope tool, so it
// gets a custom truthful section; bb_search alone auto-refreshes within budget
// (M43), so its section appends the auto-refresh knobs with defaults/opt-outs.
const FRESHNESS_TOOLS: Record<string, { modes: string[]; surfaces: string; knobs?: boolean }> = {
  bb_search: { modes: ["symbol", "content", "file"], surfaces: "per-row `stale` flags + `freshness` block (`{ fresh, stale, missing, staleRatio, mode, remediation }`)", knobs: true },
  bb_analyze: { modes: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"], surfaces: "`freshness` block (`{ fresh, stale, missing, staleRatio, mode, remediation }`); graph nodes and report rows carry `stale` flags (project-wide modes sample or resolve visible rows only — the block names its coverage mode)" },
  bb_visualize: { modes: [], surfaces: "per-node and per-link `stale` flags (links inherit worst-of-endpoints) + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON; truncation composes with staleness" },
  bb_migrate: { modes: ["plan"], surfaces: "per-plan `sourceFile` + `stale` flags with an up-front stale-plan notice + `freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON" },
  bb_patterns: { modes: [], surfaces: "per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh" },
  bb_security: { modes: [], surfaces: "per-finding `[stale]` markers + counts footer naming the remediation; silent when all fresh" },
  bb_doc: { modes: [], surfaces: "`freshness` envelope (`{ fresh, stale, missing, staleRatio, mode, remediation }`) on JSON + footer naming the remediation; per-citation `(stale)` in Sources; silent when all fresh" },
}
// Custom staleness sections: bb_health reports index-vs-filesystem freshness
// (sampled/complete counts + stale/missing file names) as its health block but
// never auto-refreshes — refresh/force are explicit reindex params. The
// generic "does not report index staleness" text and the envelope template
// both lie for it, so it gets its own verbatim section (mirrored in
// script/m35/verify-docs-staleness.ts so the gate cannot drift).
function stalenessSection(tool: any): string {
  const info = FRESHNESS_TOOLS[tool.name]
  if (tool.name === "bb_health") {
    return `Reports index-vs-filesystem freshness on demand as its health block (sampled by default, complete with freshness=\"complete\"): fresh/stale/missing counts, plus stale and missing file names when verbose=true. It never reindexes silently: refresh=true runs an incremental index with a bounded derived pass and force=true a full rebuild, both BEFORE reporting; otherwise the report describes the stored index. When stale/missing files are found the registered remediation text applies: project scope → \`${FRESHNESS_REMEDIATION.dir}\`; file scope → \`${FRESHNESS_REMEDIATION.file}\`. For this tool the explicit refresh/force parameters are the reindex path; read tools (bb_search and CLI bb search) additionally auto-refresh stale files within budget when enabled, which this health report never does on its own. Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
  }
  if (!info) {
    return `This tool does not report index staleness. Output reflects the index as of the last bb index run; run bb index --changed to refresh changed files before acting on results.`
  }
  const modePart = info.modes.length ? `Freshness modes (registered as \`freshnessModes\`): ${info.modes.map((m) => `\`${m}\``).join(", ")}.` : "Freshness applies to the tool's read output (no registered per-mode split)."
  const knobsPart = info.knobs
    ? ` Inline auto-refresh is bounded by the environment knobs \`BB_AUTO_REFRESH_MAX_FILES\` (default 25 stale+missing files) and \`BB_AUTO_REFRESH_MAX_BYTES\` (default 2 MiB of modified-file bytes); disable it entirely with \`BB_NO_AUTO_REFRESH=1\` (any other value leaves it enabled) or per call with refresh=false (MCP) / --no-auto-refresh (CLI). Out of budget, disabled, or while another indexer holds the single-flight index lock, the read answers from existing data with the staleness block and an honest decline.`
    : ""
  return `${modePart} Staleness surfaces as: ${info.surfaces}. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → \`${FRESHNESS_REMEDIATION.dir}\`; file scope → \`${FRESHNESS_REMEDIATION.file}\`. Nothing is stale → silence (no remediation text).${knobsPart} Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
}

function renderReference(tool: any): string {
  const schema = JSON.stringify(tool.inputSchema, null, 2)
  const examples = tool.documentation.examples.map((example: unknown) => `\`${JSON.stringify(example)}\``).join("\n\n")
  const bullets = (items: readonly string[]) => items.map((item) => `- ${item}`).join("\n")
  return `# \`${tool.name}\`\n\n${tool.description}\n\n## Contract\n\n- Category: \`${tool.documentation.category}\`\n- Mutability: \`${tool.mutability}\`\n- Requires index: \`${tool.requiresIndex}\`\n- Modes: ${tool.modes.map((mode: string) => `\`${mode}\``).join(", ")}\n- Planned modes (roadmap, not executable): ${(tool.plannedModes ?? []).map((mode: string) => `\`${mode}\``).join(", ") || "(none)"}\n- Defaults: \`${JSON.stringify(tool.documentation.defaults)}\`\n\n## Input Schema\n\n\`\`\`json\n${schema}\n\`\`\`\n\n## Returns\n\n${bullets(tool.returns)}\n\n## Examples\n\n${examples}\n\n## Errors\n\n${bullets(tool.errors)}\n\n## Limitations\n\n${bullets(tool.limitations)}\n\n## Performance\n\n${tool.performance}\n\n## Safety\n\n${tool.safety}\n\n## Evidence Semantics\n\n${tool.evidence}\n\n## Staleness\n\n${stalenessSection(tool)}\n\nThis page is generated from the executable registry and curated documentation. Run \`npm run docs:generate\` to update it.\n`
}

function expectedFiles(): Map<string, string> {
  const data = artifact() as { tools: any[] }
  const files = new Map<string, string>([[artifactPath, `${JSON.stringify(data, null, 2)}\n`]])
  for (const tool of data.tools) files.set(resolve(root, tool.referencePath), renderReference(tool))
  return files
}

const files = expectedFiles()
if (process.argv.includes("--write")) {
  mkdirSync(dirname(artifactPath), { recursive: true })
  mkdirSync(referenceDir, { recursive: true })
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
