// validation/tools/bb_doc/work/probe-core.ts — Phase A audit probe for bb_doc.
//
// Every probe goes through the REAL dispatch path the MCP server uses:
// validateToolArguments (the registry validator) -> the registered handler.
// Engine-level predicates call generateDocumentation directly, because the
// handler decorates its answer with the freshness envelope and that decoration
// is itself one of the claims under audit.
//
// Usage:
//   BB_DATA_DIR=validation/tools/bb_doc/bbdata BB_NO_AUTO_REFRESH=1 \
//     bun validation/tools/bb_doc/work/probe-core.ts
//
// Writes validation/tools/bb_doc/probes.json. Exit code 0 = probes ran (NOT a
// pass/fail signal): the point of this file is to record measured behaviour,
// including the defects.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs"
import { readFileSync as read } from "node:fs"
import path from "node:path"
import { TOOL_DESCRIPTORS } from "../../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { generateDocumentation, formatDocumentation, buildProse, explainEmptyRequiredSections, assertUnknownsNameRenderedSections, resolveUnknownSections, type DocRequest } from "../../../../src/intelligence/documentation/doc-engine"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const REPO = path.resolve(import.meta.dirname, "../../../..")
const OUT = path.join(REPO, "validation/tools/bb_doc/probes.json")
const MODES = ["symbol", "file", "module", "feature", "api", "project", "coverage"] as const
type Mode = (typeof MODES)[number]
const REQUIRED: Record<Mode, string[]> = {
  symbol: ["api", "behavior", "dependencies", "tests", "limitations"],
  file: ["overview", "public-symbols", "dependencies", "risks"],
  module: ["purpose", "entry-points", "public-surface", "module-graph"],
  feature: ["entry-points", "flow", "components", "test-coverage"],
  api: ["endpoints", "inputs-outputs", "errors", "examples"],
  project: ["architecture", "inventory", "risks", "documentation-map"],
  coverage: ["documented", "undocumented", "stale", "unsupported"],
}

const observations: Array<{ id: string; ok: boolean; detail: string }> = []
function obs(id: string, ok: boolean, detail: unknown): void {
  observations.push({ id, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) })
}
function section(md: string, heading: string): string | null {
  const marker = `## ${heading}\n`
  const i = md.indexOf(marker)
  if (i < 0) return null
  const rest = md.slice(i + marker.length)
  const next = rest.indexOf("\n## ")
  return next < 0 ? rest : rest.slice(0, next)
}

// ── fixture ────────────────────────────────────────────────────────────────
const root = mkdtempSync(path.join(REPO, "validation/tools/bb_doc/work", "fixture-"))
mkdirSync(path.join(root, "src", "lib"), { recursive: true })
mkdirSync(path.join(root, "tests"), { recursive: true })
mkdirSync(path.join(root, ".github", "workflows"), { recursive: true })
writeFileSync(path.join(root, "src", "lib", "math.ts"), `/** Adds two numbers. */
export function add(a: number, b: number): number { return a + b }

/** Renders a map for the *page*; returns a [pointer]. */
export function render(values: Map<string, number>): string {
  return JSON.stringify([...values.entries()])
}
`)
writeFileSync(path.join(root, "src", "app.ts"), `import { add } from "./lib/math"
/** Entry point that calls add. */
export function main(): number { return add(1, 2) }
`)
writeFileSync(path.join(root, "src", "audit.py"), `def audit_login(user: str) -> bool:\n    """Records a login audit event."""\n    return bool(user)\n\n\ndef silent(user):\n    return user\n`)
writeFileSync(path.join(root, "tests", "app.test.ts"), `import { main } from "../src/app"\ntest("main", () => { expect(main()).toBe(3) })\n`)
writeFileSync(path.join(root, ".github", "workflows", "ci.yml"), "name: ci\non: push\njobs:\n  build:\n    steps:\n      - run: echo ok\n")

const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})
const raw: any = await BrainDatabase.getRawInstance(projectId as any)
// Plant the two index facts the api mode reads and the fixture indexer does not
// produce on its own: an HTTP framework attribution and an API contract path.
raw.prepare("UPDATE brain_file SET framework_type='net_http' WHERE relative_path='src/app.ts'").run()
raw.prepare("UPDATE brain_symbol SET api_contract_path='/login' WHERE name='main'").run()
// An open analysis finding, with its occurrence location, for Risks.
const now = Date.now()
raw.prepare(`INSERT OR REPLACE INTO brain_analysis_finding
  (id, project_id, kind, fingerprint, rule, title, severity, state, confidence, evidence, first_seen_at, last_seen_at, occurrence_count, time_created, time_updated)
  VALUES ('f1', ?, 'complexity', 'fp1', 'deep-nesting', 'Deeply nested branch', 'medium', 'open', 0.8, 'four levels deep', ?, ?, 1, ?, ?)`)
  .run(projectId, now, now, now, now)
raw.prepare(`INSERT OR REPLACE INTO brain_analysis_occurrence
  (id, finding_id, run_id, state, location, evidence, observed_at, time_created, time_updated)
  VALUES ('o1', 'f1', 'r1', 'open', ?, 'four levels deep', ?, ?, ?)`)
  .run("src/app.ts:2", now, now, now)

const descriptor = TOOL_DESCRIPTORS.find((d) => d.name === "bb_doc")!
const handler = createToolHandlers().bb_doc
const ctx = { projectPath: root, projectId } as any

type DispatchResult = { isError: boolean; text: string; threw: boolean; ms: number }
async function dispatch(args: Record<string, unknown>): Promise<DispatchResult> {
  const t0 = performance.now()
  try {
    const validated = validateToolArguments(descriptor, args) as Record<string, unknown>
    const r: any = await handler(validated, ctx)
    const text = (r?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { isError: r?.isError === true, text, threw: false, ms: performance.now() - t0 }
  } catch (e: any) {
    return { isError: true, text: `error: ${e?.message ?? String(e)}`, threw: true, ms: performance.now() - t0 }
  }
}
function doc(r: DispatchResult): any {
  return JSON.parse(r.text)
}
function citationsResolve(result: any, projectRoot: string): { unresolved: string[]; badSpan: string[] } {
  const unresolved: string[] = []
  const badSpan: string[] = []
  for (const c of result.citations ?? []) {
    if (!c.path) continue
    const abs = path.isAbsolute(c.path) ? c.path : path.join(projectRoot, c.path)
    try {
      const lines = read(abs, "utf8").split(/\r?\n/)
      if (c.lineStart && c.lineStart > lines.length) badSpan.push(`${c.id} -> ${c.path}:${c.lineStart} (file has ${lines.length})`)
    } catch {
      unresolved.push(`${c.id} -> ${c.path}`)
    }
  }
  return { unresolved, badSpan }
}
const TARGETS: Record<Mode, string | undefined> = {
  symbol: "add",
  file: "src/lib/math.ts",
  module: "src/lib",
  feature: "add",
  api: undefined,
  project: undefined,
  coverage: undefined,
}

// ── P1: mode × format ─────────────────────────────────────────────────────
const modeSummaries: Record<string, any> = {}
for (const mode of MODES) {
  const args: Record<string, unknown> = { mode }
  if (TARGETS[mode] !== undefined) args.target = TARGETS[mode]
  const jsonR = await dispatch({ ...args, format: "json" })
  const mdR = await dispatch({ ...args })
  if (jsonR.isError || mdR.isError) {
    obs(`P1.${mode}.runs`, false, `json=${jsonR.text.slice(0, 120)} md=${mdR.text.slice(0, 120)}`)
    continue
  }
  const j = doc(jsonR)
  const md = mdR.text
  const sectionIds = j.sections.map((s: any) => s.id)
  const missing = REQUIRED[mode].filter((id) => !sectionIds.includes(id))
  obs(`P1.${mode}.declared-sections`, missing.length === 0, `sections=${sectionIds.join(",")} missing=${missing.join(",")}`)
  const facts = j.sections.flatMap((s: any) => s.facts)
  const uncited = facts.filter((f: any) => f.classification !== "unknown" && f.citationIds.length === 0).length
  obs(`P1.${mode}.every-non-unknown-fact-cited`, uncited === 0, `facts=${facts.length} uncited=${uncited}`)
  obs(`P1.${mode}.quality-fields`, ["factuality", "references", "completeness", "freshness", "budget"].every((k) => typeof j.quality?.[k]?.passed === "boolean"), JSON.stringify(Object.fromEntries(["factuality", "references", "completeness", "freshness", "budget"].map((k) => [k, j.quality?.[k]?.passed]))))
  const conjunction = j.quality.factuality.passed && j.quality.references.passed && j.quality.budget.passed && j.quality.completeness.passed
  obs(`P1.${mode}.passed-is-conjunction`, j.quality.passed === conjunction, `passed=${j.quality.passed} conjunction=${conjunction}`)
  const rendered = new Set(sectionIds)
  const dangling = (j.unknowns ?? []).filter((u: any) => !rendered.has(u.affectedSection))
  obs(`P1.${mode}.unknowns-name-rendered-sections`, dangling.length === 0, dangling.map((u: any) => u.affectedSection).join(","))
  const { unresolved, badSpan } = citationsResolve(j, root)
  obs(`P1.${mode}.citations-resolve`, unresolved.length === 0, unresolved.join(","))
  obs(`P1.${mode}.citation-spans-in-file`, badSpan.length === 0, badSpan.join(" | "))
  const hasFreshness = j.freshness && ["fresh", "stale", "missing", "staleRatio", "mode", "remediation"].every((k) => k in j.freshness)
  obs(`P1.${mode}.freshness-envelope-in-json`, Boolean(hasFreshness), JSON.stringify(j.freshness ?? null).slice(0, 200))
  obs(`P1.${mode}.markdown-title-matches-json`, md.startsWith(`# ${j.title}`), `md head=${JSON.stringify(md.slice(0, 60))} json title=${j.title}`)
  obs(`P1.${mode}.markdown-has-quality`, /## Quality/.test(md), "")
  const sourceList = md.includes("## Sources")
  const fileCites = (j.citations ?? []).filter((c: any) => c.path).length
  obs(`P1.${mode}.sources-section-iff-file-citations`, sourceList === fileCites > 0, `sources=${sourceList} fileCitations=${fileCites} indexCitations=${(j.citations ?? []).length - fileCites}`)
  // The estimate is defined on the engine object. The wire payload is the
  // indented handler answer, so the ratio is measured rather than assumed.
  const wireTokens = Math.ceil(jsonR.text.length / 4)
  obs(`P1.${mode}.budget-estimate-vs-wire`, j.quality.budget.estimatedTokens <= wireTokens && j.quality.budget.maxTokens === 4000, `estimate=${j.quality.budget.estimatedTokens} wire~${wireTokens} ratio=${(wireTokens / j.quality.budget.estimatedTokens).toFixed(2)}`)
  modeSummaries[mode] = {
    sections: sectionIds,
    facts: facts.length,
    citations: (j.citations ?? []).length,
    fileCitations: fileCites,
    indexCitations: (j.citations ?? []).length - fileCites,
    unknowns: (j.unknowns ?? []).length,
    passed: j.quality.passed,
    budget: j.quality.budget,
    freshness: j.freshness,
    summary: j.summary,
    bytes: jsonR.text.length,
    ms: Math.round(jsonR.ms),
  }
}

// ── P2: options ───────────────────────────────────────────────────────────
const base = { mode: "project" }
for (const audience of ["developer", "maintainer", "user", "website"]) {
  const r = await dispatch({ ...base, format: "json", audience })
  const j = doc(r)
  const ids = j.sections.map((s: any) => s.id)
  obs(`P2.audience.${audience}.required-present`, REQUIRED.project.every((id) => ids.includes(id)), ids.join(","))
  obs(`P2.audience.${audience}.tags`, j.reference.tags.join(",") === `project,${audience},standard`, j.reference.tags.join(","))
  obs(`P2.audience.${audience}.evidence-index-optional`, (audience === "maintainer" || audience === "website") === ids.includes("evidence-index"), ids.join(","))
}
for (const detail of ["brief", "standard", "deep"]) {
  const r = await dispatch({ ...base, format: "json", detail, limit: 20 })
  const j = doc(r)
  const perSection = j.quality.bounds.perSection
  const expectedPer = detail === "brief" ? 5 : detail === "deep" ? 60 : 20
  obs(`P2.detail.${detail}.per-section`, perSection === expectedPer, `perSection=${perSection} expected=${expectedPer}`)
  const ids = j.sections.map((s: any) => s.id)
  obs(`P2.detail.${detail}.required-present`, REQUIRED.project.every((id) => ids.includes(id)), ids.join(","))
  obs(`P2.detail.${detail}.optional-all-edges`, (detail === "deep") === ids.includes("all-edges"), ids.join(","))
  obs(`P2.detail.${detail}.facts-within-cap`, j.sections.every((s: any) => s.facts.length <= perSection), j.sections.map((s: any) => `${s.id}:${s.facts.length}`).join(","))
}
// includeExamples / includeDiagrams / includeTests
{
  const ex = doc(await dispatch({ mode: "symbol", target: "add", format: "json", includeExamples: true }))
  obs("P2.includeExamples.honest-unknown", ex.unknowns.some((u: any) => u.reason === "not-observed" && /example/i.test(u.statement)), ex.unknowns.map((u: any) => u.statement.slice(0, 60)).join(" | "))
  const dg = doc(await dispatch({ mode: "project", format: "json", includeDiagrams: true }))
  obs("P2.includeDiagrams.honest-unknown", dg.unknowns.some((u: any) => u.reason === "not-observed" && /diagram/i.test(u.statement)), JSON.stringify(dg.reference.diagrams))
  obs("P2.includeDiagrams.diagrams-empty", Array.isArray(dg.reference.diagrams) && dg.reference.diagrams.length === 0, JSON.stringify(dg.reference.diagrams))
  const testsOff = doc(await dispatch({ mode: "symbol", target: "add", format: "json", includeTests: false }))
  const testsOn = doc(await dispatch({ mode: "symbol", target: "add", format: "json", includeTests: true }))
  obs("P2.includeTests.false-still-includes-tests-in-symbol-mode", JSON.stringify(testsOff.sections.find((s: any) => s.id === "tests").facts) === JSON.stringify(testsOn.sections.find((s: any) => s.id === "tests").facts), `off=${testsOff.sections.find((s: any) => s.id === "tests").facts.length} on=${testsOn.sections.find((s: any) => s.id === "tests").facts.length}`)
  const fileTestsOn = doc(await dispatch({ mode: "file", target: "src/lib/math.ts", format: "json", includeTests: true }))
  obs("P2.includeTests.file-mode-observable", fileTestsOn.sections.some((s: any) => s.id === "tests") || fileTestsOn.citations.some((c: any) => c.kind === "test"), fileTestsOn.sections.map((s: any) => s.id).join(","))
}
// limit bounds
for (const limit of [1, 20, 100, 101, 1000, 0]) {
  const r = await dispatch({ mode: "project", format: "json", limit })
  if (r.isError) {
    obs(`P2.limit.${limit}.refused`, true, r.text.slice(0, 140))
    continue
  }
  const j = doc(r)
  obs(`P2.limit.${limit}.observed`, true, `perSection=${j.quality.bounds.perSection} scopeFiles-limited sections=${j.sections.length}`)
}
// maxTokens bounds
const tokenCases: Array<{ maxTokens: number; expect: string }> = [
  { maxTokens: 1, expect: "unmet-or-refused" },
  { maxTokens: 50, expect: "unmet-or-refused" },
  { maxTokens: 500, expect: "trimmed" },
  { maxTokens: 4000, expect: "default" },
  { maxTokens: 16000, expect: "max" },
  { maxTokens: 20000, expect: "clamped" },
  { maxTokens: 0, expect: "zero" },
]
const tokenObservations: any[] = []
for (const { maxTokens } of tokenCases) {
  const r = await dispatch({ mode: "project", format: "json", maxTokens, limit: 20 })
  if (r.isError) {
    obs(`P2.maxTokens.${maxTokens}.refused`, true, r.text.slice(0, 160))
    tokenObservations.push({ maxTokens, refused: true, text: r.text.slice(0, 160) })
    continue
  }
  const j = doc(r)
  const wireTokens = Math.ceil(r.text.length / 4)
  const requiredPresent = REQUIRED.project.every((id) => j.sections.map((s: any) => s.id).includes(id))
  tokenObservations.push({ maxTokens, reportedMaxTokens: j.quality.budget.maxTokens, estimated: j.quality.budget.estimatedTokens, passed: j.quality.budget.passed, wireTokens, requiredPresent, droppedFacts: j.quality.bounds.sections.reduce((n: number, s: any) => n + s.droppedForBudget, 0) })
  obs(`P2.maxTokens.${maxTokens}.observed`, requiredPresent && (j.quality.budget.passed ? j.quality.budget.estimatedTokens <= j.quality.budget.maxTokens : true), `reportedMax=${j.quality.budget.maxTokens} estimate=${j.quality.budget.estimatedTokens} passed=${j.quality.budget.passed} wire~${wireTokens} required=${requiredPresent}`)
}

// ── P3: target resolution ─────────────────────────────────────────────────
const fileTargets = ["src/lib/math.ts", "./src/lib/math.ts", path.join(root, "src/lib/math.ts"), "src/lib", "math", "math.ts", "no/such/file.ts"]
for (const target of fileTargets) {
  const r = await dispatch({ mode: "file", target, format: "json" })
  if (r.isError) { obs(`P3.file.${target}.refused`, true, r.text.slice(0, 140)); continue }
  const j = doc(r)
  const fileCites = j.citations.filter((c: any) => c.kind === "file")
  const paths = fileCites.map((c: any) => c.path)
  obs(`P3.file.${target}.resolves`, fileCites.length > 0, `paths=${JSON.stringify(paths)}`)
  const scopeNote = (j.unknowns ?? []).find((u: any) => /No indexed file matched/.test(u.statement))
  obs(`P3.file.${target}.absent-case-explains-five-forms`, target !== "no/such/file.ts" || (scopeNote && /(exact|prefix|basename|absolute)/.test(scopeNote.statement)), scopeNote ? scopeNote.statement.slice(0, 160) : "(no explanation)")
}
// symbol aliases through the validator
for (const alias of [{ symbol: "add" }, { symbolName: "add" }, { query: "add" }]) {
  const r = await dispatch({ mode: "symbol", ...alias, format: "json" })
  obs(`P3.symbol-alias.${Object.keys(alias)[0]}`, !r.isError, r.text.slice(0, 120))
}
{
  const conflict = await dispatch({ mode: "symbol", symbol: "add", query: "main", format: "json" })
  obs("P3.symbol-alias.conflict-refused", conflict.isError && /aliases with different values/.test(conflict.text), conflict.text.slice(0, 160))
  const blank = await dispatch({ mode: "symbol", symbol: "   ", format: "json" })
  obs("P3.symbol-alias.blank-does-not-satisfy-required", blank.isError, blank.text.slice(0, 140))
}
// module
for (const target of ["src", "src/lib", "no/such/module"]) {
  const r = await dispatch({ mode: "module", target, format: "json" })
  const j = doc(r)
  obs(`P3.module.${target}.purpose-facts`, true, `sections=${j.sections.map((s: any) => `${s.id}:${s.facts.length}`).join(",")} unknowns=${j.unknowns.length}`)
}
// feature: semantic discovery must be declared when it fails
{
  const r = await dispatch({ mode: "feature", target: "add", format: "json" })
  const j = doc(r)
  const semanticUnknown = (j.unknowns ?? []).find((u: any) => /Semantic candidate discovery/.test(u.statement))
  obs("P3.feature.semantic-failure-declared", Boolean(semanticUnknown), semanticUnknown ? semanticUnknown.statement.slice(0, 160) : JSON.stringify(j.unknowns.map((u: any) => u.statement.slice(0, 80))))
}
// api: planted surface; then removed
{
  const j = doc(await dispatch({ mode: "api", format: "json" }))
  const endpoints = j.sections.find((s: any) => s.id === "endpoints")
  obs("P3.api.planted-endpoint-found", endpoints.facts.some((f: any) => f.statement.includes("/login")), JSON.stringify(endpoints.facts.map((f: any) => f.statement.slice(0, 90))))
  obs("P3.api.errors-section-explains-limit", (j.unknowns ?? []).some((u: any) => u.affectedSection === "errors"), JSON.stringify((j.unknowns ?? []).filter((u: any) => u.affectedSection === "errors").map((u: any) => u.statement.slice(0, 120))))
}
// project target is accepted but does not scope
{
  const untargeted = doc(await dispatch({ mode: "project", format: "json" }))
  const targeted = doc(await dispatch({ mode: "project", target: "src/lib", format: "json" }))
  obs("P3.project.target-is-metadata-only", untargeted.summary === targeted.summary && targeted.reference.canonicalPath === "src/lib", `canonicalPath=${targeted.reference.canonicalPath} sameSummary=${untargeted.summary === targeted.summary}`)
}
// coverage: symbol bound
{
  const j = doc(await dispatch({ mode: "coverage", format: "json" }))
  const documented = j.sections.find((s: any) => s.id === "documented")
  const undocumented = j.sections.find((s: any) => s.id === "undocumented")
  obs("P3.coverage.classifies-undocumented-as-unknown", undocumented.facts.every((f: any) => f.classification === "unknown"), `documented=${documented.facts.length} undocumented=${undocumented.facts.length}`)
  obs("P3.coverage.marks-python-hash-undocumented-unverified", (j.sections.find((s: any) => s.id === "unsupported").facts ?? []).some((f: any) => f.statement.includes('"#"')), JSON.stringify((j.sections.find((s: any) => s.id === "unsupported")?.facts ?? []).map((f: any) => f.statement.slice(0, 120))))
}

// ── P4: refusals and validation ───────────────────────────────────────────
const refusals: Array<[string, Record<string, unknown>]> = [
  ["missing-mode", {}],
  ["bad-mode", { mode: "vibes" }],
  ["missing-target-symbol", { mode: "symbol" }],
  ["missing-target-file", { mode: "file" }],
  ["missing-target-module", { mode: "module" }],
  ["missing-target-feature", { mode: "feature" }],
  ["bad-format", { mode: "symbol", target: "add", format: "html" }],
  ["bad-audience", { mode: "project", audience: "admin" }],
  ["bad-detail", { mode: "project", detail: "deepest" }],
  ["bad-limit-type", { mode: "project", limit: "many" }],
  ["fractional-limit", { mode: "project", limit: 3.7 }],
  ["negative-limit", { mode: "project", limit: -5 }],
  ["unknown-option", { mode: "project", arbitrary: 1 }],
  ["null-mode", { mode: null }],
]
for (const [label, args] of refusals) {
  const r = await dispatch(args)
  obs(`P4.${label}.refused-with-isError`, r.isError && r.text.length > 0, r.text.slice(0, 140))
}

// ── P5: empty project semantics ───────────────────────────────────────────
{
  const emptyRoot = mkdtempSync(path.join(REPO, "validation/tools/bb_doc/work", "empty-"))
  mkdirSync(path.join(emptyRoot, "src"))
  writeFileSync(path.join(emptyRoot, "src", "nothing.ts"), "// nothing here\n")
  const emptyPid = getProjectId(emptyRoot)
  await indexProjectParallel(emptyPid, emptyRoot, {})
  const emptyHandler = createToolHandlers().bb_doc
  const emptyCtx = { projectPath: emptyRoot, projectId: emptyPid } as any
  for (const mode of MODES) {
    const args: Record<string, unknown> = { mode, format: "json" }
    if (["symbol", "file", "module", "feature"].includes(mode)) args.target = "missing"
    try {
      const r: any = await emptyHandler(args, emptyCtx)
      const j = JSON.parse(r.content[0].text)
      const facts = j.sections.flatMap((s: any) => s.facts).filter((f: any) => f.classification !== "unknown")
      obs(`P5.${mode}.empty-not-passing`, j.quality.passed === false, `passed=${j.quality.passed} facts=${facts.length} unknowns=${j.unknowns.length} sections=${j.sections.map((s: any) => s.id).join(",")}`)
      obs(`P5.${mode}.empty-explained`, j.sections.every((s: any) => s.facts.length > 0 || s.prose.length > 20) && j.unknowns.some((u: any) => /No indexed evidence matched/.test(u.statement)), `unknowns=${j.unknowns.map((u: any) => u.reason).join(",")}`)
    } catch (e: any) {
      obs(`P5.${mode}.empty-project`, false, `threw: ${e?.message ?? e}`)
    }
  }
  rmSync(path.join(path.dirname(BrainDatabase.getDbPath(emptyPid))), { recursive: true, force: true })
  rmSync(emptyRoot, { recursive: true, force: true })
}

// ── P6: determinism ───────────────────────────────────────────────────────
{
  const a = await dispatch({ mode: "project", format: "json" })
  const b = await dispatch({ mode: "project", format: "json" })
  const ja = doc(a); const jb = doc(b)
  delete ja.reference.generatedAt; delete jb.reference.generatedAt
  obs("P6.deterministic-except-generatedAt", JSON.stringify(ja) === JSON.stringify(jb), `firstDiff=${(() => { const sa = JSON.stringify(ja); const sb = JSON.stringify(jb); let i = 0; while (i < Math.min(sa.length, sb.length) && sa[i] === sb[i]) i++; return `${i}:${sa.slice(i, i + 80)} vs ${sb.slice(i, i + 80)}` })()}`)
  obs("P6.snapshotId-stable", ja.quality.freshness.snapshot === jb.quality.freshness.snapshot && ja.quality.freshness.snapshot.length === 32, ja.quality.freshness.snapshot)
}

// ── P7: engine truth predicates ───────────────────────────────────────────
{
  const engineReq = (r: DocRequest) => generateDocumentation(projectId, root, r)
  const wide = await engineReq({ mode: "project", limit: 100 })
  const bounds = wide.quality.bounds
  const identity = bounds.sections.filter((s: any) => s.emitted + s.droppedForBudget !== s.capped)
  obs("P7.bounds-identity", identity.length === 0, identity.map((s: any) => `${s.id}:${s.emitted}+${s.droppedForBudget}!=${s.capped}`).join(","))
  const availOk = bounds.sections.every((s: any) => s.available >= s.capped && s.capped === Math.min(s.available, bounds.perSection) && s.emitted === (wide.sections.find((x: any) => x.id === s.id)?.facts.length ?? -1))
  obs("P7.bounds-available-capped-emitted", availOk, JSON.stringify(bounds.sections.map((s: any) => ({ id: s.id, a: s.available, c: s.capped, d: s.droppedForBudget, e: s.emitted }))).slice(0, 400))
  const text = formatDocumentation(wide, "json")
  const reported = wide.quality.budget.estimatedTokens
  obs("P7.estimate-is-not-an-undercount", reported * 4 >= text.length, `estimate*4=${reported * 4} actualChars=${text.length}`)
  const tiny = await engineReq({ mode: "project", limit: 100, maxTokens: 1 })
  obs("P7.tiny-budget-unmet-not-refused", tiny.quality.budget.passed === false && tiny.quality.completeness.covered === tiny.quality.completeness.expected, `budgetPassed=${tiny.quality.budget.passed} covered=${tiny.quality.completeness.covered}/${tiny.quality.completeness.expected} unknownReasons=${[...new Set(tiny.unknowns.map((u) => u.reason))].join(",")}`)
  const big = await engineReq({ mode: "project", limit: 100, maxTokens: 16000 })
  obs("P7.max-token-ceiling", big.quality.budget.maxTokens === 16000, `maxTokens=${big.quality.budget.maxTokens} estimate=${big.quality.budget.estimatedTokens}`)
  // Markdown escaping: the fixture docstring contains '*' and '['.
  const rendered = formatDocumentation(await engineReq({ mode: "symbol", target: "render" }), "markdown")
  const escapedLines = rendered.split("\n").filter((l) => l.startsWith("- ") && l.includes("Renders a map"))
  obs("P7.markdown-escapes-active-characters", escapedLines.some((l) => l.includes("\\*page\\*") && l.includes("\\[pointer\\]")), escapedLines.join(" | ").slice(0, 240))
  // A symbol whose stored parameter list is absent must not render `name()`.
  raw.prepare("UPDATE brain_symbol SET parameters=NULL WHERE name='main'").run()
  const noParams = await engineReq({ mode: "symbol", target: "main" })
  const apiFacts = noParams.sections.find((s: any) => s.id === "api").facts.map((f: any) => f.statement)
  obs("P7.absent-parameter-list-is-not-name()", apiFacts.length > 0 && !apiFacts.some((s: string) => /function add\(\)|main\(\)/.test(s)) && apiFacts.some((s: string) => /main; the index records no parameter list|main is defined/.test(s)), apiFacts.join(" | ").slice(0, 300))
  raw.prepare("UPDATE brain_symbol SET parameters='[{\"name\":\"a\",\"type\":\"number\"},{\"name\":\"b\",\"type\":\"number\"}]' WHERE name='main'").run()
  // Coverage and project symbol bounds: how many symbols are classified vs the
  // project total, and is the bound declared anywhere?
  const coverage = await engineReq({ mode: "coverage", limit: 20 })
  const coverageCount = coverage.sections.find((s: any) => s.id === "documented").facts.length + coverage.sections.find((s: any) => s.id === "undocumented").facts.length
  const symbolTotal = Number((raw.prepare("SELECT count(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any)?.c ?? 0)
  const scopeUnknown = coverage.unknowns.some((u) => /scope|evidence limit|not examined/i.test(u.statement))
  obs("P7.coverage-symbol-bound-declared", coverageCount >= symbolTotal || scopeUnknown, `classified=${coverageCount} indexed=${symbolTotal} scopeUnknown=${scopeUnknown}`)
  const project = await engineReq({ mode: "project", limit: 20 })
  const mapFacts = project.sections.find((s: any) => s.id === "documentation-map").facts.length
  const fileScopeUnknown = project.unknowns.some((u) => /file\(s\) were not examined/.test(u.statement))
  obs("P7.project-documentation-map-bound-declared", mapFacts >= symbolTotal || project.unknowns.some((u) => /symbol/i.test(u.statement) && /not examined|not selected|cap/.test(u.statement)), `mapFacts=${mapFacts} indexed=${symbolTotal} fileScopeUnknown=${fileScopeUnknown}`)
  // Guarantor behaviour: the two guards must throw on malformed input.
  const goodSections = [{ id: "a", heading: "A", prose: "", facts: [], citations: [] }]
  let threw = false
  try { explainEmptyRequiredSections(goodSections as any, [{ id: "a", heading: "A", required: true, audience: "all", facts: [] }] as any, []) } catch { threw = true }
  obs("P7.explainEmptyRequiredSections-throws", threw, String(threw))
  let threwDangling = false
  try { assertUnknownsNameRenderedSections({ mode: "symbol", sections: goodSections, unknowns: [{ statement: "x", reason: "not-indexed", affectedSection: "ghost" }] } as any) } catch { threwDangling = true }
  obs("P7.assertUnknownsNameRenderedSections-throws", threwDangling, String(threwDangling))
}

// ── P8: doc claims that can be checked mechanically ─────────────────────────
{
  const gen = readFileSync(path.join(REPO, "docs/BB_DOC.md"), "utf8")
  const ref = readFileSync(path.join(REPO, "docs/BB_DOC_REFERENCE.md"), "utf8")
  const ex = readFileSync(path.join(REPO, "docs/BB_DOC_EXAMPLES.md"), "utf8")
  const page = readFileSync(path.join(REPO, "docs/tools/bb_doc.md"), "utf8")
  // BB_DOC_REFERENCE claims the tool does not refresh the index; the handler
  // auto-refreshes by default (verified in probe-refresh.ts). The contradiction
  // is with the generated page's own Staleness section.
  obs("P8.reference-md-denies-refresh", /does not write source files, refresh the index, create tests/.test(ref), (ref.match(/refresh the index/) ?? [])[0] ?? "(absent)")
  obs("P8.generated-page-denies-refresh", /never refreshes implicitly/.test(page), (page.match(/never refreshes implicitly/) ?? [])[0] ?? "(absent)")
  obs("P8.generated-page-affirms-refresh", /auto-refresh stale files within budget/.test(page), "")
  // BB_DOC.md internal contradiction on diagrams.
  obs("P8.bb-doc-diagram-contradiction", /Markdown may contain Mermaid/.test(gen) && /Diagrams are not emitted in this implementation/.test(gen), "both sentences present")
  // Examples: are the documented section names the measured ones?
  const engineSymbolMd = formatDocumentation(await generateDocumentation(projectId, root, { mode: "symbol", target: "add" }), "markdown")
  const measuredHeadings = engineSymbolMd.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3))
  const exampleHeadings = (ex.match(/^## (Signature|Dependencies|Limitations|Sources)$/gm) ?? []).map((l) => l.slice(3))
  obs("P8.examples-section-names-match-measured", exampleHeadings.every((h) => measuredHeadings.includes(h)), `example=${exampleHeadings.join(",")} measured=${measuredHeadings.join(",")}`)
  // The Project JSON example's completeness.expected vs the mode's declared set.
  obs("P8.examples-project-expected-matches-declared", /"expected": 2/.test(ex) === false, 'example carries "expected": 2; declared project set has 4')
  // Generated page errors: "Unsupported format or mode" is true (validator rejects both).
  const badFormat = await dispatch({ mode: "symbol", target: "add", format: "html" })
  obs("P8.page-error-claim-unsupported-format", badFormat.isError, badFormat.text.slice(0, 120))
  // docs/BB_DOC.md mode table target column vs handler.
  obs("P8.bb-doc-target-requirements-match", /required for `symbol`, `file`, `module`, and `feature`/.test(gen) && /optional for `api`, `project`, and `coverage`/.test(gen), "statement present; handler enforces exactly these four")
  // JSON keeps the citation objects; markdown renders links.
  const jdoc = doc(await dispatch({ mode: "symbol", target: "add", format: "json" }))
  obs("P8.json-citation-shape", (jdoc.citations ?? []).every((c: any) => typeof c.id === "string" && typeof c.kind === "string" && typeof c.freshness === "string"), JSON.stringify((jdoc.citations ?? [])[0] ?? null).slice(0, 240))
}

const report = {
  schemaVersion: 1,
  tool: "bb_doc",
  generatedAt: new Date().toISOString(),
  env: { BB_DATA_DIR: process.env.BB_DATA_DIR ?? "(default)", BB_NO_AUTO_REFRESH: process.env.BB_NO_AUTO_REFRESH ?? "(unset)" },
  fixture: { root, projectId, files: 5 },
  modeSummaries,
  tokenObservations,
  observations,
  summary: {
    total: observations.length,
    failed: observations.filter((o) => !o.ok).length,
    failing: observations.filter((o) => !o.ok).map((o) => o.id),
  },
}
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
console.log(`probes: ${observations.length} observations, ${report.summary.failed} failing`)
for (const o of observations.filter((x) => !x.ok)) console.log(`  FAIL ${o.id} — ${o.detail.slice(0, 220)}`)
console.log(`written: ${OUT}`)
process.exit(0)
