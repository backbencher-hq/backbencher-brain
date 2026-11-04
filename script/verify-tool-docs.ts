import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PUBLIC_TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"
import { FRESHNESS_REMEDIATION } from "../src/brain/freshness"

import type { CuratedToolDocumentation } from "./tool-docs/types"
import { EDIT_MODE_CONTRACT } from "./tool-docs/contract-text"
import { curation as bb_search_curation, relation as bb_search_relation } from "./tool-docs/curation/bb_search"
import { curation as bb_ask_curation, relation as bb_ask_relation } from "./tool-docs/curation/bb_ask"
import { curation as bb_analyze_curation, relation as bb_analyze_relation } from "./tool-docs/curation/bb_analyze"
import { curation as bb_patterns_curation, relation as bb_patterns_relation } from "./tool-docs/curation/bb_patterns"
import { curation as bb_security_curation, relation as bb_security_relation } from "./tool-docs/curation/bb_security"
import { curation as bb_doc_curation, relation as bb_doc_relation } from "./tool-docs/curation/bb_doc"
import { curation as bb_visualize_curation, relation as bb_visualize_relation } from "./tool-docs/curation/bb_visualize"
import { curation as bb_migrate_curation, relation as bb_migrate_relation } from "./tool-docs/curation/bb_migrate"
import { curation as bb_edit_curation, relation as bb_edit_relation } from "./tool-docs/curation/bb_edit"
import { curation as bb_index_curation, relation as bb_index_relation } from "./tool-docs/curation/bb_index"
import { curation as bb_health_curation, relation as bb_health_relation } from "./tool-docs/curation/bb_health"
import { curation as bb_graph_curation, relation as bb_graph_relation } from "./tool-docs/curation/bb_graph"
import { curation as bb_impact_curation, relation as bb_impact_relation } from "./tool-docs/curation/bb_impact"
import { curation as bb_cross_language_curation, relation as bb_cross_language_relation } from "./tool-docs/curation/bb_cross_language"
import { curation as bb_annotate_curation, relation as bb_annotate_relation } from "./tool-docs/curation/bb_annotate"
import { curation as bb_annotations_curation, relation as bb_annotations_relation } from "./tool-docs/curation/bb_annotations"

const curated: Readonly<Record<string, CuratedToolDocumentation>> = {
  bb_search: bb_search_curation,
  bb_ask: bb_ask_curation,
  bb_analyze: bb_analyze_curation,
  bb_patterns: bb_patterns_curation,
  bb_security: bb_security_curation,
  bb_doc: bb_doc_curation,
  bb_visualize: bb_visualize_curation,
  bb_migrate: bb_migrate_curation,
  bb_edit: bb_edit_curation,
  bb_index: bb_index_curation,
  bb_health: bb_health_curation,
  bb_graph: bb_graph_curation,
  bb_impact: bb_impact_curation,
  bb_cross_language: bb_cross_language_curation,
  bb_annotate: bb_annotate_curation,
  bb_annotations: bb_annotations_curation,
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
  // M13.F8 (#701): bb_visualize EMITS the envelope but does NOT auto-refresh, and the page said
  // the opposite — it quoted the registered constants ("reads auto-refresh stale files within
  // budget when enabled — disable with ... refresh=false") for a read path that never calls
  // `maybeAutoRefresh` and whose schema does not publish `refresh` at all. Both facts are now
  // stated: the surface it has, and the manual interface. `modes: []` is the same decision
  // bb_patterns/bb_security/bb_health record — the envelope covers the graph's files as a SET
  // rather than splitting the answer per mode — so there is no per-mode split to register.
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
  // M64.H1/H5/R: bb_health is the tool whose report IS the freshness answer, and
  // it was missing from this table. The generator therefore took its "no
  // freshness surface" branch and the page said "This tool does not report
  // per-file index staleness and does not auto-refresh" while every call
  // returned a `freshness` block naming fresh/stale/missing counts, the files
  // behind them, and WHY each file was classified as it was. Found 2026-10-14 by
  // script/verify-tool-page-claims.ts, which checks a page against the live
  // payload instead of against this table — the table and the page agreed with
  // each other and disagreed with the tool.
  bb_health: { modes: [], surfaces: "a top-level `freshness` block on every report (`{ mode, requestedMode, checked, total, fresh, stale, missing, staleFiles, missingFiles, unresolved, isComplete, reasons }`) — `mode` is what was actually CHECKED, `isComplete` is the boolean to branch on before reading `stale` as a project total, `unresolved` is counted as neither fresh nor stale, and `reasons` carries the verdict mix (`{ byKind, freshVerifiedByContent, freshVerifiedByMetadata, isSample }`) so a consumer can tell a content-hash-verified file from an `mtime+size` fast-path one without reading the prose. `paths` answers per-path state for named files; `verbose` adds the stale/missing file NAMES" },
}
// M48.D1 (#701): explicit cross-reference map. Every overlapping tool pair
// states when to use which — rendered into every per-tool doc so an agent or
// human reading one page knows its neighbors. Kept adjacent to the generator
// so docs cannot drift from the map (the M48.D1 gate asserts each row lands).
export const RELATIONS: Record<string, string> = {
  bb_search: bb_search_relation,
  bb_ask: bb_ask_relation,
  bb_analyze: bb_analyze_relation,
  bb_patterns: bb_patterns_relation,
  bb_security: bb_security_relation,
  bb_doc: bb_doc_relation,
  bb_visualize: bb_visualize_relation,
  bb_migrate: bb_migrate_relation,
  bb_edit: bb_edit_relation,
  bb_index: bb_index_relation,
  bb_health: bb_health_relation,
  bb_graph: bb_graph_relation,
  bb_impact: bb_impact_relation,
  bb_cross_language: bb_cross_language_relation,
  bb_annotate: bb_annotate_relation,
  bb_annotations: bb_annotations_relation,
}

/**
 * Deep guides linked from each generated page.
 *
 * The reference page is generated from the registry; the hand-written deep guides
 * carry the operational detail. They were only reachable by guessing the filename,
 * so every page now links its guides. Tools without a dedicated guide point at the
 * document that owns their detail (indexing, graph engine); tools whose guide is
 * written for the annotation family get their own page.
 */
export const GUIDE_LINKS: Record<string, { label: string; href: string }[]> = {
  bb_search: [{ label: "Search semantics and modes", href: "../BB_SEARCH.md" }],
  bb_ask: [{ label: "Asking questions honestly — routes, confidence, bounds", href: "../BB_ASK.md" }],
  bb_analyze: [
    { label: "Analysis modes and output shapes", href: "../BB_ANALYZE.md" },
    { label: "Test intelligence (mode: tests)", href: "../BB_TEST_INTEL.md" },
    { label: "Test quality (mode: test_quality)", href: "../BB_TEST_QUALITY.md" },
    { label: "Recorded analysis runs", href: "../BB_ANALYSIS_HISTORY.md" },
  ],
  bb_health: [{ label: "Index health and freshness", href: "../BB_HEALTH.md" }],
  bb_patterns: [{ label: "Patterns: dead code, orphans, frameworks and anti-patterns", href: "../BB_PATTERNS.md" }],
  bb_security: [{ label: "Security: taint flows, tiers, and what is not detected", href: "../BB_SECURITY.md" }],
  bb_visualize: [{ label: "Bounded dependency maps and their declared bounds", href: "../BB_VISUALIZE.md" }],
  bb_migrate: [{ label: "Migration plans, ordering and honesty", href: "../BB_MIGRATE.md" }],
  bb_doc: [
    { label: "Document generation: modes, citations, audiences", href: "../BB_DOC.md" },
    { label: "Doc reference: every field and option", href: "../BB_DOC_REFERENCE.md" },
    { label: "Doc examples", href: "../BB_DOC_EXAMPLES.md" },
  ],
  bb_edit: [{ label: "Unified editing: safety model, rollback and every mode", href: "../BB_EDIT.md" }],
  bb_index: [{ label: "Indexing guide: flags, resume, performance, troubleshooting", href: "../indexing/README.md" }],
  bb_graph: [{ label: "The graph engine: what each edge means and how it is resolved", href: "../GRAPH_ENGINE.md" }],
  bb_impact: [{ label: "Impact: budgets, completeness and the wall clock", href: "../BB_IMPACT.md" }],
  bb_cross_language: [{ label: "Cross-language facts: what is stored and what is not", href: "../BB_CROSS_LANGUAGE.md" }],
  bb_annotate: [{ label: "Writing annotations: provenance, bounds, surfacing", href: "../BB_ANNOTATE.md" }],
  bb_annotations: [{ label: "Reading annotations: filters, bounds, absence", href: "../BB_ANNOTATIONS.md" }],
}

/** Rendered after the relations section; empty when the tool has no linked guide. */
function guideSection(toolName: string): string {
  const links = GUIDE_LINKS[toolName] ?? []
  if (links.length === 0) return ""
  return `## Deep guides\n\n${links.map((link) => `- [${link.label}](${link.href})`).join("\n")}\n\n`
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
export const CUSTOM_STALENESS_TOOLS = new Set(["bb_edit", "bb_patterns", "bb_security", "bb_migrate"])

function stalenessSection(tool: any): string {
  // M59.A11 (#890): bb_edit is the one tool that CONSUMES a stale target by
  // refreshing it rather than reading around it or refusing. Stated here so the
  // generated page cannot claim it "does not auto-refresh".
  if (tool.name === "bb_edit") {
    return `No freshness flags are returned — this tool does not summarize OTHER files' staleness, and it does not read stale data: a stale TARGET file is refreshed (that file only) and the symbol re-resolved from the bytes on disk before the edit is planned, and the refresh is named in \`warnings\`. If that change renamed or removed the symbol, the edit is refused by name rather than applied to a stale span. For unrelated files, remediation stays manual: project scope → run \`bb index --changed\` (or the \`bb_index\` tool with the project path — incremental, changed files only).`
  }
  const info = FRESHNESS_TOOLS[tool.name]
  if (!info) {
    // M48.D1 (#701): explicit about auto-refresh so the section cannot be
    // misread as contradicting tools that DO auto-refresh (bb_graph et al do
    // not). Truth: this tool neither reports staleness nor auto-refreshes.
    //
    // 2026-10-14: the remediation is the MANUAL one, inline — quoting
    // FRESHNESS_REMEDIATION.dir here put "reads auto-refresh stale files within
    // budget when enabled" two sentences after "does not auto-refresh", in the
    // same paragraph. bb_ask's branch below already inlines the manual wording
    // for exactly this reason; this branch (shared by every tool without a
    // freshness surface) did not.
    return `This tool does not report per-file index staleness and does not auto-refresh. Output reflects the index as of the last index run; when files changed after indexing, refresh first: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only).`
  }
  const modePart = info.modes.length ? `Freshness modes (registered as \`freshnessModes\`): ${info.modes.map((m) => `\`${m}\``).join(", ")}.` : "Freshness applies to the tool's read output (no registered per-mode split)."
  // bb_health REPORTS freshness and does not auto-refresh on a read: a refresh
  // happens only because the caller asked for one, which is a different fact
  // from a read tool repairing itself and must be said differently. The
  // remediation text is the MANUAL one inline, because the shared constant
  // names automatic refresh and would otherwise contradict the sentence beside
  // it (the same mistake this branch was added to remove from bb_graph's page).
  if (tool.name === "bb_health") {
    return `${modePart} Staleness surfaces as: ${info.surfaces}. It does not auto-refresh on a read: the report DESCRIBES the index and a reindex happens only when asked for (\`refresh: true\` reindexes before reporting, \`force: true\` wipes and rebuilds first and is destructive, \`wait: false\` detaches it), so a stale report is a measurement, not a repair. When the report names stale or missing files, repair them with the manual interface: run: \`bb index --changed\` (or the \`bb_index\` tool with the project path — incremental, changed files only), or pass \`paths\` to check named files instead of scanning the project. Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
  }
  // bb_ask reports staleness but never auto-refreshes, and unlike the graph
  // tools it emits no `freshness` envelope. The two facts are stated so the
  // page cannot be read as promising either — and its remediation text is the
  // MANUAL one, because the shared constant names automatic refresh and would
  // otherwise put "reads auto-refresh stale files within budget when enabled"
  // two sentences after "this tool does not auto-refresh".
  if (tool.name === "bb_ask") {
    return `${modePart} Staleness surfaces as: ${info.surfaces}. This tool does not auto-refresh, and it emits no \`freshness\` envelope: a verified aggregate answer is a count over the whole index rather than a per-file fact, so there is no per-file envelope to publish. When a cited source is stale, remediation is manual: run: bb index --changed (or the bb_index tool with the project path — incremental, changed files only). Nothing is stale → no marker. Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
  }
  // M13.F8 (#701): bb_visualize emits the envelope and does NOT auto-refresh — the handler
  // computes the summary and stops, so the flags describe the index as it stands. The page
  // used to take the default branch and quote the registered constants, telling a reader the
  // read path refreshes and that `refresh=false` turns it off; neither was true. The manual
  // interface is inlined (the same spelling bb_health's branch uses) instead of quoted, so the
  // sentence and the text beside it cannot contradict each other. The file-scope wording is
  // named too: the runtime picks it for `scope: "file"` (before the fix the handler hardcoded
  // the project scope for every scope, while this page promised the file one).
  if (tool.name === "bb_visualize") {
    return `${modePart} Staleness surfaces as: ${info.surfaces}. This tool does NOT auto-refresh: the flags and the envelope DESCRIBE the index as it stands, nothing is reindexed to make them stale or fresh, and there is no \`refresh\` option to opt out with. Project scope → run: \`bb index --changed\` (or the \`bb_index\` tool with the project path — incremental, changed files only). File scope → run: \`bb index "<file>"\` for the one file named in the answer. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
  }
  if (tool.name === "bb_migrate") {
    return `${modePart} Staleness surfaces as: ${info.surfaces}. This tool does NOT auto-refresh and has no \`refresh\` option: the flags and the envelope DESCRIBE the index as it stands, and the repair is manual — project scope → run: \`bb index --changed\` (or the \`bb_index\` tool with the project path — incremental, changed files only); file scope → run: \`bb index "<file>"\` for the file the plan belongs to. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
  }
  if (tool.name === "bb_security") {
    return `${modePart} Staleness surfaces as: ${info.surfaces}. This tool does not auto-refresh and has no \`refresh\` option: a touched finding file is marked \`[stale]\` and the footer names the MANUAL repair — run: \`bb index --changed\` (or the \`bb_index\` tool with the project path — incremental, changed files only). Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
  }
  if (tool.name === "bb_patterns") {
    return `${modePart} Staleness surfaces as: ${info.surfaces}. This tool does NOT auto-refresh: the per-finding flags DESCRIBE the index as it stands, nothing is reindexed to make them stale or fresh, and there is no \`refresh\` option to opt out with. When findings name stale or missing files, repair them with the manual interface: run: \`bb index --changed\` (or the \`bb_index\` tool with the project path — incremental, changed files only). Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
  }
  return `${modePart} Staleness surfaces as: ${info.surfaces}. When something is stale/missing, the remediation names the registered reindex interfaces: project scope → \`${FRESHNESS_REMEDIATION.dir}\`; file scope → \`${FRESHNESS_REMEDIATION.file}\`. Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in \`src/brain/freshness.ts\`).`
}

/**
 * M71.D6: the per-mode half of `requiresIndex`, on the Contract line the page
 * leads with. A bare `true` was the whole published answer, and it was read as
 * "this tool is unusable until you index" — which is true for four of bb_edit's
 * five modes and false for the one that creates files. Rendered from the
 * registry's own `indexFreeModes`, so the sentence cannot outlive the rule.
 */
function indexRequirementNote(tool: any): string {
  const free: readonly string[] = tool.indexFreeModes ?? []
  if (!free.length) return ""
  return ` (except ${free.map((mode: string) => `\`${mode}\``).join(", ")}, which needs no index at all: it plans from the request and the disk, resolves no symbol, and reindexes the file it wrote — so it works on a project the indexer has never run over, and that is how such a project gets its first indexed rows)`
}

function renderReference(tool: any): string {
  const schema = JSON.stringify(tool.inputSchema, null, 2)
  const examples = tool.documentation.examples.map((example: unknown) => `\`${JSON.stringify(example)}\``).join("\n\n")
  const bullets = (items: readonly string[]) => items.map((item) => `- ${item}`).join("\n")
  const authorHeader = [
    "<!--",
    "Author: Muhammad Ishaq Khan",
    "",
    `WHAT THIS DOCUMENT IS — the generated reference for ${tool.name}: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.`,
    `WHO IT IS FOR — callers of ${tool.name} through any MCP host, the CLI (\`bb tool ${tool.name}\`), or a library.`,
    `EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/${tool.name}/descriptor.ts, src/mcp/tools/${tool.name}/handler.ts, script/tool-docs/curation/${tool.name}.ts; regenerate with \`npx tsx script/verify-tool-docs.ts --only ${tool.name} --write\`.`,
    "-->",
    "",
  ].join("\n")
  return `${authorHeader}# \`${tool.name}\`\n\n${tool.description}\n\n## Contract\n\n- Category: \`${tool.documentation.category}\`\n- Mutability: \`${tool.mutability}\`\n- Requires index: \`${tool.requiresIndex}\`${indexRequirementNote(tool)}\n- Modes: ${tool.modes.map((mode: string) => `\`${mode}\``).join(", ")}\n- Planned modes (roadmap, not executable): ${(tool.plannedModes ?? []).map((mode: string) => `\`${mode}\``).join(", ") || "(none)"}\n- Defaults: \`${JSON.stringify(tool.documentation.defaults)}\`\n\n## Input Schema\n\n\`\`\`json\n${schema}\n\`\`\`\n\n## Returns\n\n${bullets(tool.returns)}\n\n## Examples\n\n${examples}\n\n## Errors\n\n${bullets(tool.errors)}\n\n## Limitations\n\n${bullets(tool.limitations)}\n\n## Performance\n\n${tool.performance}\n\n## Safety\n\n${tool.safety}\n\n## Evidence Semantics\n\n${tool.evidence}\n\n## Relationship to other tools\n\n${RELATIONS[tool.name] ?? ""}\n\n${guideSection(tool.name)}## Staleness\n\n${stalenessSection(tool)}\n\nThis page is generated from the executable registry and curated documentation. Run \`npm run docs:generate\` to update it, or \`npx tsx script/verify-tool-docs.ts --only <tool> --write\` for a single page.\n`
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

function expectedFiles(only?: string): Map<string, string> {
  const data = artifact() as { tools: any[] }
  if (only !== undefined) {
    const tool = data.tools.find((candidate: any) => candidate.name === only)
    if (!tool) return new Map()
    return new Map([[resolve(root, tool.referencePath), renderReference(tool)]])
  }
  const files = new Map<string, string>([[artifactPath, `${JSON.stringify(data, null, 2)}\n`]])
  for (const tool of data.tools) files.set(resolve(root, tool.referencePath), renderReference(tool))
  files.set(siteDataPath, renderSiteData())
  return files
}

const onlyFlag = process.argv.indexOf("--only")
const ONLY = onlyFlag >= 0 ? process.argv[onlyFlag + 1] : undefined
if (onlyFlag >= 0 && ONLY === undefined) {
  console.error("tool docs: --only needs a tool name")
  process.exit(2)
}
if (ONLY !== undefined && !PUBLIC_TOOL_DESCRIPTORS.some((tool) => tool.name === ONLY)) {
  console.error(`tool docs: --only names an unknown public tool: ${ONLY}`)
  process.exit(2)
}
const files = expectedFiles(ONLY)
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
