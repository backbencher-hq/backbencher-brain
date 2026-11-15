// validation/tools/bb_doc/work/probe-refresh.ts — Phase A audit probe for the
// freshness / inline auto-refresh contract. MUST run WITHOUT BB_NO_AUTO_REFRESH
// because the behaviour under test is the refresh itself.
//
// Usage:
//   BB_DATA_DIR=validation/tools/bb_doc/bbdata \
//     bun validation/tools/bb_doc/work/probe-refresh.ts
//
// The fixture is built inside validation/tools/bb_doc/work/, indexed under the
// tool's own BB_DATA_DIR, and the only files that get reindexed are the ones
// this probe cited — the same bounded repair the handler performs for a caller.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { readFileSync as read } from "node:fs"
import { TOOL_DESCRIPTORS } from "../../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { generateDocumentation } from "../../../../src/intelligence/documentation/doc-engine"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { hashFileContent } from "../../../../src/brain/freshness"

const REPO = path.resolve(import.meta.dirname, "../../../..")
const OUT = path.join(REPO, "validation/tools/bb_doc/probe-refresh.json")

const observations: Array<{ id: string; ok: boolean; detail: string }> = []
function obs(id: string, ok: boolean, detail: unknown): void {
  observations.push({ id, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) })
}

const root = mkdtempSync(path.join(REPO, "validation/tools/bb_doc/work", "refresh-"))
mkdirSync(path.join(root, "src", "lib"), { recursive: true })
mkdirSync(path.join(root, "many"), { recursive: true })
writeFileSync(path.join(root, "src", "lib", "math.ts"), `/** Adds two numbers. */
export function add(a: number, b: number): number { return a + b }
`)
writeFileSync(path.join(root, "src", "app.ts"), `import { add } from "./lib/math"
/** Entry point that calls add. */
export function main(): number { return add(1, 2) }
`)
for (let i = 0; i < 30; i++) writeFileSync(path.join(root, "many", `f${i}.ts`), `/** Doc ${i}. */\nexport function fn${i}(x: number): number { return x + ${i} }\n`)
const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})

const descriptor = TOOL_DESCRIPTORS.find((d) => d.name === "bb_doc")!
const handler = createToolHandlers().bb_doc
const ctx = { projectPath: root, projectId } as any
async function dispatch(args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  try {
    const validated = validateToolArguments(descriptor, args) as Record<string, unknown>
    const r: any = await handler(validated, ctx)
    return { isError: r?.isError === true, text: (r?.content ?? []).map((c: any) => c.text ?? "").join("\n") }
  } catch (e: any) {
    return { isError: true, text: `error: ${e?.message ?? String(e)}` }
  }
}
function doc(r: { text: string }): any { return JSON.parse(r.text) }
const raw: any = await BrainDatabase.getRawInstance(projectId as any)
const indexedHash = (rel: string): string => String((raw.prepare("SELECT file_hash FROM brain_file WHERE project_id=? AND relative_path=?").get(projectId, rel) as any)?.file_hash ?? "")
const onDiskHash = (rel: string): string => hashFileContent(read(path.join(root, rel)))
const isEnabled = process.env.BB_NO_AUTO_REFRESH !== "1"

// ── R1: a stale cited file is repaired, declared, and the answer REGENERATED ──
if (!isEnabled) {
  obs("R1.precondition", false, "BB_NO_AUTO_REFRESH=1 is set, so the refresh probes cannot run")
} else {
  const before = await dispatch({ mode: "symbol", target: "add", format: "json" })
  const beforeDoc = doc(before)
  const beforeLine = beforeDoc.sections.find((s: any) => s.id === "api").facts[0]
  const originalHash = indexedHash("src/lib/math.ts")
  // Prepend two lines so every indexed bound moves: a regenerated document must
  // report the NEW line, not the pre-refresh row.
  const edited = `// a new first line\nexport const marker = "shift"\n` + read(path.join(root, "src/lib/math.ts"), "utf8")
  writeFileSync(path.join(root, "src/lib/math.ts"), edited)
  const staleHashBefore = indexedHash("src/lib/math.ts")
  obs("R1.fixture-is-stale-before", staleHashBefore !== onDiskHash("src/lib/math.ts"), `indexed=${staleHashBefore} disk=${onDiskHash("src/lib/math.ts")}`)

  const after = await dispatch({ mode: "symbol", target: "add", format: "json" })
  const j = doc(after)
  obs("R1.autoRefresh-declared", typeof j.autoRefresh === "string" && /auto-refreshed/.test(j.autoRefresh), j.autoRefresh ?? "(absent)")
  obs("R1.answer-not-built-from-stale-rows", j.sections.find((s: any) => s.id === "api").facts[0] !== beforeLine && /at lines 4-4|at line 4|4-4/.test(j.sections.find((s: any) => s.id === "api").facts[0]), `before=${beforeLine} after=${j.sections.find((s: any) => s.id === "api").facts[0]}`)
  obs("R1.file-reindexed-on-disk", indexedHash("src/lib/math.ts") === onDiskHash("src/lib/math.ts") && indexedHash("src/lib/math.ts") !== originalHash, `hash=${indexedHash("src/lib/math.ts")}`)
  obs("R1.freshness-envelope-clean-after-repair", j.freshness?.stale === 0 && j.freshness?.missing === 0, JSON.stringify(j.freshness))
  obs("R1.sources-no-longer-stale", (j.citations ?? []).every((c: any) => c.freshness !== "stale"), JSON.stringify((j.citations ?? []).map((c: any) => `${c.kind}:${c.freshness}`)))

  // ── R2: refresh:false declines and answers from existing data ─────────────
  writeFileSync(path.join(root, "src/lib/math.ts"), edited + "// another line\n")
  const declined = await dispatch({ mode: "symbol", target: "add", format: "json", refresh: false })
  const dj = doc(declined)
  obs("R2.decline-declared-with-reason", typeof dj.autoRefresh === "string" && /disabled/.test(dj.autoRefresh), dj.autoRefresh ?? "(absent)")
  obs("R2.stale-envelope-present", (dj.freshness?.stale ?? 0) >= 1 && /refresh=false|BB_NO_AUTO_REFRESH/.test(String(dj.freshness?.remediation)), JSON.stringify(dj.freshness))
  obs("R2.answered-from-existing-data", (dj.citations ?? []).some((c: any) => c.freshness === "stale"), JSON.stringify((dj.citations ?? []).map((c: any) => `${c.kind}:${c.freshness}`)))
  // The markdown footer text the caller actually reads on the stale path.
  const md = await dispatch({ mode: "symbol", target: "add", refresh: false })
  obs("R2.markdown-declines-refresh", /auto-refresh disabled/.test(md.text), (md.text.match(/auto-refresh declined[^\n]*|auto-refresh disabled[^\n]*/) ?? [""])[0])
  const footer = (md.text.split("\n---\n").pop() ?? "").trim()
  obs("R2.markdown-staleness-footer-wording", true, footer.split("\n")[0].slice(0, 230))
  obs("R2.markdown-footer-names-doc-citations-not-findings", !/findings' files/.test(md.text), footer.split("\n")[0].slice(0, 160))
  // Evidence count vs the quality block's stale count: quality counts collected
  // citations, Sources lists the ones a fact refers to.
  obs("R2.stale-count-matches-emitted", dj.quality.references.stale === (dj.citations ?? []).filter((c: any) => c.freshness === "stale").length, `quality.references.stale=${dj.quality.references.stale} emittedStale=${(dj.citations ?? []).filter((c: any) => c.freshness === "stale").length} emittedCitations=${(dj.citations ?? []).length}`)

  // ── R3: a DELETED cited file is removed from the index and declared ───────
  rmSync(path.join(root, "src", "app.ts"))
  const deleted = await dispatch({ mode: "project", format: "json", limit: 20 })
  const dd = doc(deleted)
  const deletedRow = raw.prepare("SELECT id FROM brain_file WHERE project_id=? AND relative_path='src/app.ts'").get(projectId)
  obs("R3.deleted-file-repair-declared", typeof dd.autoRefresh === "string" && /(removed|auto-refreshed)/.test(dd.autoRefresh), dd.autoRefresh ?? "(absent)")
  obs("R3.deleted-file-row-removed", deletedRow === undefined, String(JSON.stringify(deletedRow)))
  obs("R3.no-missing-citation-survives", (dd.citations ?? []).every((c: any) => c.freshness !== "missing"), JSON.stringify((dd.citations ?? []).filter((c: any) => c.freshness === "missing").map((c: any) => c.path)))

  // ── R4: the file budget declines rather than repairing 30 files ───────────
  for (let i = 0; i < 30; i++) writeFileSync(path.join(root, "many", `f${i}.ts`), `/** Doc ${i} edited. */\nexport function fn${i}(x: number): number { return x + ${i} + 1 }\n`)
  const big = await dispatch({ mode: "project", format: "json", limit: 20 })
  const bj = doc(big)
  obs("R4.file-budget-declined", typeof bj.autoRefresh === "string" && /budget/.test(bj.autoRefresh), bj.autoRefresh ?? "(absent)")
  obs("R4.declined-answer-cites-stale", (bj.citations ?? []).some((c: any) => c.freshness === "stale") || (bj.quality.references.stale ?? 0) > 0, `staleQuality=${bj.quality.references.stale} emitted=${(bj.citations ?? []).length}`)
}

// ── R5: freshness envelope scope for a single-file document ────────────────
{
  const r = await dispatch({ mode: "file", target: "src/lib/math.ts", format: "json", refresh: false })
  const j = doc(r)
  obs("R5.file-mode-envelope-remediation-scope", true, `kind-wording=${JSON.stringify(String(j.freshness?.remediation ?? "")).slice(0, 200)}`)
  const single = (j.citations ?? []).filter((c: any) => c.path).length
  obs("R5.file-mode-cites-one-file", single >= 1, `fileCitations=${single} envelope=${JSON.stringify(j.freshness)}`)
}

// ── R6: engine-level freshness consistency (no handler decoration) ──────────
{
  const engine = await generateDocumentation(projectId, root, { mode: "project", limit: 20 })
  const emittedStale = (engine.citations ?? []).filter((c) => c.freshness === "stale").length
  const collectedStale = engine.quality.references.stale
  obs("R6.quality-stale-count-is-collected-not-emitted", true, `quality.references.stale=${collectedStale} emittedStale=${emittedStale} emittedCitations=${(engine.citations ?? []).length}`)
  obs("R6.quality-stale-exceeds-emitted", collectedStale <= emittedStale, `quality=${collectedStale} emitted=${emittedStale}`)
  const facts = engine.sections.flatMap((s) => s.facts)
  obs("R6.passed-not-blocked-by-stale", engine.quality.passed === (engine.quality.factuality.passed && engine.quality.references.passed && engine.quality.budget.passed && engine.quality.completeness.passed), `passed=${engine.quality.passed} freshnessPassed=${engine.quality.freshness.passed} stale=${collectedStale}`)
}

const report = {
  schemaVersion: 1,
  tool: "bb_doc",
  generatedAt: new Date().toISOString(),
  env: { BB_DATA_DIR: process.env.BB_DATA_DIR ?? "(default)", BB_NO_AUTO_REFRESH: process.env.BB_NO_AUTO_REFRESH ?? "(unset)" },
  fixture: { root, projectId, files: 34 },
  observations,
  summary: { total: observations.length, failed: observations.filter((o) => !o.ok).length, failing: observations.filter((o) => !o.ok).map((o) => o.id) },
}
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
console.log(`refresh probes: ${observations.length} observations, ${report.summary.failed} failing`)
for (const o of observations) console.log(`  ${o.ok ? "ok  " : "FAIL"} ${o.id} — ${o.detail.slice(0, 200)}`)
console.log(`written: ${OUT}`)
process.exit(0)
