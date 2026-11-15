// validation/tools/bb_doc/work/probe-extra.ts — Phase A audit probes that need
// a purpose-built fixture or a large index.
//
// Usage:
//   BB_DATA_DIR=validation/tools/bb_doc/bbdata BB_NO_AUTO_REFRESH=1 \
//     bun validation/tools/bb_doc/work/probe-extra.ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { TOOL_DESCRIPTORS } from "../../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../../src/mcp/tool-validation"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { generateDocumentation, formatDocumentation } from "../../../../src/intelligence/documentation/doc-engine"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const REPO = path.resolve(import.meta.dirname, "../../../..")
const OUT = path.join(REPO, "validation/tools/bb_doc/probes-extra.json")
const observations: Array<{ id: string; ok: boolean; detail: string }> = []
function obs(id: string, ok: boolean, detail: unknown): void {
  observations.push({ id, ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) })
}
const read = (p: string) => readFileSync(p, "utf8")

const root = mkdtempSync(path.join(REPO, "validation/tools/bb_doc/work", "extra-"))
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
const raw: any = await BrainDatabase.getRawInstance(projectId as any)
const descriptor = TOOL_DESCRIPTORS.find((d) => d.name === "bb_doc")!
const handler = createToolHandlers().bb_doc
const ctx = { projectPath: root, projectId } as any
async function dispatch(args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  try {
    const validated = validateToolArguments(descriptor, args) as Record<string, unknown>
    const r: any = await handler(validated, ctx)
    return { isError: r?.isError === true, text: (r?.content ?? []).map((c: any) => c.text ?? "").join("\n") }
  } catch (e: any) { return { isError: true, text: `error: ${e?.message ?? String(e)}` } }
}
const doc = (r: { text: string }) => JSON.parse(r.text)

// ── E1: relationship citations point at a file and a line that agree ───────
{
  const j = doc(await dispatch({ mode: "symbol", target: "add", format: "json" }))
  const rels = (j.citations ?? []).filter((c: any) => c.kind === "relationship")
  const details = rels.map((c: any) => {
    let fileLines = -1
    let lineText = ""
    try {
      const text = read(path.join(root, c.path))
      const lines = text.split(/\r?\n/)
      fileLines = lines.length
      lineText = (lines[(c.lineStart ?? 1) - 1] ?? "").trim()
    } catch { /* unresolved, recorded below */ }
    return { id: c.id, path: c.path, lineStart: c.lineStart, freshness: c.freshness, fileLines, lineText }
  })
  obs("E1.relationship-citation-shape", true, JSON.stringify(details))
  // For an OUTBOUND edge the citation must locate the CALL SITE, which is in the
  // documented symbol's own file — so the statement's subject (the documented
  // symbol) must be defined in the cited file.
  const defs = (j.sections.find((s: any) => s.id === "api")?.facts ?? []).map((f: any) => f.statement)
  obs("E1.relationship-citation-file-is-callsite-file", details.every((d: any) => (d.lineText ?? "") !== "" || d.fileLines === -1), JSON.stringify(details.map((d: any) => `${d.path}:${d.lineStart}->${d.lineText}`)))
  obs("E1.documented-symbol-definition", true, defs.join(" | ").slice(0, 300))
  // Count relationship facts whose target is a symbol the index knows.
  const relFacts = j.sections.flatMap((s: any) => s.facts).filter((f: any) => f.citationIds.some((id: string) => rels.some((c: any) => c.id === id)))
  obs("E1.relationship-facts", true, JSON.stringify(relFacts.map((f: any) => f.statement)))
}

// ── E2: file mode, stale, refresh:false — envelope scope wording ──────────
{
  writeFileSync(path.join(root, "src", "lib", "math.ts"), `// shifted\n` + read(path.join(root, "src", "lib", "math.ts")))
  const j = doc(await dispatch({ mode: "file", target: "src/lib/math.ts", format: "json", refresh: false }))
  obs("E2.file-mode-envelope", true, JSON.stringify(j.freshness))
  obs("E2.file-mode-remediation-says-file-or-project", true, String(j.freshness?.remediation ?? "").slice(0, 220))
  const md = await dispatch({ mode: "file", target: "src/lib/math.ts", refresh: false })
  obs("E2.file-mode-markdown-footer", true, ((md.text.split("\n---\n").pop() ?? "").trim().split("\n")[0] ?? "").slice(0, 220))
}

// ── E3: the 25-file auto-refresh budget declines on a doc that cites many ──
{
  for (let i = 0; i < 30; i++) writeFileSync(path.join(root, "many", `f${i}.ts`), `/** Doc ${i} edited. */\nexport function fn${i}(x: number): number { return x + ${i} + 1 }\n`)
  const j = doc(await dispatch({ mode: "coverage", target: "many", format: "json", limit: 100 }))
  obs("E3.coverage-cites-many-files", (j.citations ?? []).filter((c: any) => c.path).length >= 25, `fileCitations=${(j.citations ?? []).filter((c: any) => c.path).length}`)
  obs("E3.auto-refresh-budget-decline", typeof j.autoRefresh === "string", j.autoRefresh ?? "(absent)")
}

// ── E4: markdown citation links resolve to the Sources list ────────────────
{
  const md = (await dispatch({ mode: "symbol", target: "add" })).text
  const sources = md.slice(md.indexOf("## Sources"))
  const links = [...sources.matchAll(/\[(\d+)\]\(([^)]+)\)/g)].map((m) => ({ n: m[1], href: m[2] }))
  const refs = [...md.matchAll(/\[(\d+)\]/g)].map((m) => m[1])
  obs("E4.markdown-links", links.length > 0, JSON.stringify(links))
  obs("E4.markdown-citation-markers-present", refs.length >= links.length, `markers=${refs.length} links=${links.length}`)
  for (const l of links) {
    const file = path.join(root, decodeURI(l.href.split("#")[0]))
    let ok = true
    try { read(file) } catch { ok = false }
    obs(`E4.link-${l.n}-resolves`, ok, l.href)
  }
}

// ── E5: project mode's symbol-selection bound, declared or not ────────────
{
  const totalSymbols = Number((raw.prepare("SELECT count(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any)?.c ?? 0)
  const totalFiles = Number((raw.prepare("SELECT count(*) c FROM brain_file WHERE project_id=?").get(projectId) as any)?.c ?? 0)
  const j = doc(await dispatch({ mode: "project", format: "json", limit: 5, maxTokens: 16000 }))
  const map = j.sections.find((s: any) => s.id === "documentation-map")
  const scopeUnknowns = (j.unknowns ?? []).filter((u: any) => /not examined|not selected|cap is/.test(u.statement))
  obs("E5.project-map-fact-count", true, `documentation-mapFacts=${map.facts.length} indexedSymbols=${totalSymbols} indexedFiles=${totalFiles} scopeUnknowns=${JSON.stringify(scopeUnknowns.map((u: any) => u.statement.slice(0, 140)))}`)
  const symbolBound = (j.unknowns ?? []).some((u: any) => /symbol/i.test(u.statement) && /not examined|cap/.test(u.statement))
  obs("E5.project-symbol-bound-declared", symbolBound || map.facts.length >= totalSymbols, `mapFacts=${map.facts.length} indexed=${totalSymbols}`)
}

// ── E6: T2 reference index — project mode document size and symbol bound ──
{
  const t2path = REPO
  const t2pid = getProjectId(t2path)
  const t2handler = createToolHandlers().bb_doc
  const t2ctx = { projectPath: t2path, projectId: t2pid } as any
  const t0 = performance.now()
  const r: any = await t2handler({ mode: "project", format: "json", limit: 100, maxTokens: 16000 }, t2ctx)
  const ms = performance.now() - t0
  const j = JSON.parse(r.content[0].text)
  const db: any = await BrainDatabase.getRawInstance(t2pid as any)
  const totalSymbols = Number((db.prepare("SELECT count(*) c FROM brain_symbol WHERE project_id=?").get(t2pid) as any)?.c ?? 0)
  const totalFiles = Number((db.prepare("SELECT count(*) c FROM brain_file WHERE project_id=?").get(t2pid) as any)?.c ?? 0)
  const map = j.sections.find((s: any) => s.id === "documentation-map")
  obs("E6.t2-project-summary", true, JSON.stringify({ ms: Math.round(ms), indexSymbols: totalSymbols, indexFiles: totalFiles, mapFacts: map.facts.length, bytes: r.content[0].text.length, estimate: j.quality.budget.estimatedTokens, wireTokens: Math.ceil(r.content[0].text.length / 4), scopeUnknowns: (j.unknowns ?? []).filter((u: any) => /not examined|not selected|cap/.test(u.statement)).map((u: any) => u.statement.slice(0, 160)) }))
}

const report = {
  schemaVersion: 1,
  tool: "bb_doc",
  generatedAt: new Date().toISOString(),
  env: { BB_DATA_DIR: process.env.BB_DATA_DIR ?? "(default)", BB_NO_AUTO_REFRESH: process.env.BB_NO_AUTO_REFRESH ?? "(unset)" },
  fixture: { root, projectId },
  observations,
  summary: { total: observations.length, failed: observations.filter((o) => !o.ok).length, failing: observations.filter((o) => !o.ok).map((o) => o.id) },
}
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
console.log(`extra probes: ${observations.length} observations, ${report.summary.failed} failing`)
for (const o of observations) console.log(`  ${o.ok ? "ok  " : "FAIL"} ${o.id} — ${o.detail.slice(0, 320)}`)
console.log(`written: ${OUT}`)
process.exit(0)
