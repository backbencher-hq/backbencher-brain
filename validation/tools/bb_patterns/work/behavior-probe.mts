// Phase A behavioral probe for bb_patterns. Builds a scratch fixture whose shape
// is chosen so the defects under audit are observable:
//   * >100 orphan candidates (fills the engine's 100-item page),
//   * 60 god classes at confidence 0.8 (outrank orphan 0.7 and framework 0.6),
//   * one framework row, anti-patterns (god class, long params, complexity),
//   * a used pair so the "not orphaned" negative is present,
//   * a modified file and a deleted file for the staleness footer.
// Every case records validateToolArguments (the MCP boundary) and the real handler
// answer, so a claim in the audit is a recorded observation, not a reading of code.
//
// Usage: BB_DATA_DIR=<scratch> BB_NO_AUTO_REFRESH=1 npx tsx behavior-probe.mts <out.json>

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../../../src/mcp/tool-registry"
import { validateToolArguments } from "../../../../src/mcp/tool-validation"
import { getAnalysisHistory } from "../../../../src/intelligence/analysis/run-history"

const outPath = process.argv[2]
if (!outPath) { console.error("usage: behavior-probe.mts <out.json>"); process.exit(2) }

const root = mkdtempSync(path.join(tmpdir(), "bb-patterns-behavior-"))
mkdirSync(path.join(root, "src"), { recursive: true })

// Used pair: never reported.
writeFileSync(path.join(root, "src", "used.ts"),
  "export function usedFn(): number { return 1 }\nexport function caller(): number { return usedFn() }\n")
// Candidate orphans: one exported function per file, none called.
for (let i = 0; i < 130; i++) {
  writeFileSync(path.join(root, "src", `m${i}.ts`), `export function unref${i}(): number {\n  return ${i}\n}\n`)
}
// Anti-patterns: god classes at 0.8 confidence.
const members = (n: number) => Array.from({ length: n }, (_, k) => `  f${k}(): number { return ${k} }`).join("\n")
writeFileSync(path.join(root, "src", "wide.ts"),
  Array.from({ length: 60 }, (_, i) => `export class Wide${i} {\n${members(12)}\n}`).join("\n") +
  `\nexport function longParams(${Array.from({ length: 9 }, (_, i) => `p${i}: number`).join(", ")}): number { return p0 }\n`)
// Complexity 15: confidence 0.65.
let complex = "export function complexFn(): number {\n"
for (let i = 0; i < 15; i++) complex += " ".repeat(i) + "if (true) {\n"
complex += " ".repeat(15) + "return 1\n"
for (let i = 14; i >= 0; i--) complex += " ".repeat(i) + "}\n"
complex += "  return 2\n}\n"
writeFileSync(path.join(root, "src", "complex.ts"), complex)
// Staleness targets.
writeFileSync(path.join(root, "src", "stale.ts"), "export function staleCandidate(): number { return 9 }\n")
writeFileSync(path.join(root, "src", "gone.ts"), "export function goneCandidate(): number { return 8 }\n")

const projectId = getProjectId(root)
const handler = createToolHandlers().bb_patterns
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((d) => d.name === "bb_patterns")!

type Case = { case: string; validated: { ok: boolean; error?: string }; isError: boolean; text: string; facts: Record<string, unknown> }
const cases: Case[] = []
function rows(text: string): number {
  return text.split("\n").filter((l) => /^ {2}\[?\w/.test(l)).length
}
function scanLine(text: string): string | null {
  const m = text.match(/\[scan: ([^\]]*)\]/)
  return m ? m[1] : null
}
async function call(name: string, args: Record<string, unknown>): Promise<Case> {
  let validated: { ok: boolean; error?: string }
  try {
    const normalised = validateToolArguments(descriptor, args)
    validated = { ok: true, error: JSON.stringify(normalised) === "{}" ? undefined : undefined }
    const result: any = await handler(normalised, { projectId, projectPath: root } as any)
    const text = (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    const c: Case = {
      case: name,
      validated,
      isError: result?.isError === true,
      text,
      facts: {
        chars: text.length,
        displayRows: rows(text),
        scan: scanLine(text),
        censusHeader: (text.match(/^(?:patterns|orphaned code) \((\d+)/) ?? [])[1] ?? null,
        showsFramework: text.includes("framework-detected"),
        showsOrphanRow: text.includes("orphaned_"),
        staleMarks: (text.match(/\[stale\]/g) ?? []).length,
        footer: (text.match(/stale, \d+ missing of/) ?? [])[0] ?? null,
        recordedRun: (text.match(/recorded run [^:]+: new=\d+ repeated=\d+ resolved=\d+/) ?? [])[0] ?? null,
      },
    }
    cases.push(c)
    return c
  } catch (e: any) {
    const c: Case = { case: name, validated: { ok: false, error: String(e?.message ?? e) }, isError: true, text: "", facts: {} }
    cases.push(c)
    return c
  }
}

try {
  await indexProjectParallel(projectId, root, {})
  // A framework row and post-index source drift, the two states only the index or
  // the filesystem can produce after indexing.
  const raw = await BrainDatabase.getRawInstance(projectId)
  raw.prepare("UPDATE brain_file SET framework_type = 'react' WHERE project_id = ? AND relative_path = 'src/m0.ts'").run(projectId)
  BrainDatabase.close(projectId)
  writeFileSync(path.join(root, "src", "stale.ts"), "export function staleCandidate(): number { return 10 }\n")
  rmSync(path.join(root, "src", "gone.ts"))

  const historyBefore = await getAnalysisHistory(projectId, "patterns", 100)

  // ── page vs census, and the class-representation contract at the HANDLER page
  await call("default-all", {})
  await call("all-limit-5", { scope: "all", limit: 5 })
  await call("all-limit-100", { scope: "all", limit: 100 })
  await call("all-limit-1", { scope: "all", limit: 1 })
  await call("orphaned-default", { scope: "orphaned" })
  await call("orphaned-limit-1", { scope: "orphaned", limit: 1 })
  await call("orphaned-limit-1000", { scope: "orphaned", limit: 1000 })
  await call("orphaned-threshold-0.6", { scope: "orphaned", confidenceThreshold: 0.6 })
  await call("orphaned-threshold-0.7", { scope: "orphaned", confidenceThreshold: 0.7 })
  await call("all-threshold-0.7", { scope: "all", confidenceThreshold: 0.7 })
  await call("all-no-orphaned", { scope: "all", includeOrphaned: false })
  await call("all-no-framework", { scope: "all", includeFramework: false })
  await call("all-no-antipatterns", { scope: "all", includeAntiPatterns: false })
  await call("all-no-classes", { scope: "all", includeOrphaned: false, includeFramework: false, includeAntiPatterns: false })

  // ── declared errors: option/threshold validation (MCP boundary)
  await call("refuse-scope-quality", { scope: "quality" })
  await call("refuse-scope-uppercase", { scope: "ALL" })
  await call("refuse-unknown-option", { foo: true })
  await call("refuse-limit-string", { limit: "5" })
  await call("refuse-confidence-string", { confidenceThreshold: "0.5" })
  await call("refuse-include-orphaned-string", { includeOrphaned: "false" })

  // ── accepted-but-unvalidated numeric edges (handler-level behaviour)
  await call("limit-0", { limit: 0 })
  await call("limit-negative", { limit: -5 })
  await call("limit-fraction", { limit: 2.7 })
  await call("limit-huge", { limit: 1000000000 })
  await call("threshold-negative", { confidenceThreshold: -1 })
  await call("threshold-above-one", { confidenceThreshold: 2 })
  await call("threshold-huge-positive", { scope: "orphaned", confidenceThreshold: 5 })
  await call("limit-nan-direct", { limit: Number.NaN })
  await call("threshold-nan-direct", { confidenceThreshold: Number.NaN })

  // ── history
  await call("history-true", { history: true })
  await call("history-limit-1", { history: true, limit: 1 })
  await call("history-zero", { history: true, limit: 0 })
  await call("history-with-recordRun", { history: true, recordRun: true })

  // ── recordRun: all-scope, and the orphaned-scope silent no-op
  const orphanedRecord = await call("recordRun-orphaned-scope", { scope: "orphaned", recordRun: true })
  const historyAfterOrphan = await getAnalysisHistory(projectId, "patterns", 100)
  const recordedAll = await call("recordRun-all", { scope: "all", limit: 5, recordRun: true })
  const historyAfter = await getAnalysisHistory(projectId, "patterns", 100)

  const report = {
    tier: "behavior",
    projectId,
    projectDir: root,
    dataDir: process.env.BB_DATA_DIR ?? null,
    route: "createToolHandlers().bb_patterns (source door, the same handler the MCP server calls)",
    handlerRowShape: "two leading spaces then an optional [severity] tag",
    history: {
      runsBefore: historyBefore.runs.length,
      afterOrphanedScopeRecordRun: historyAfterOrphan.runs.length,
      orphanedScopeRecordRunWroteRun: historyAfterOrphan.runs.length > historyBefore.runs.length,
      afterAllRecordRun: historyAfter.runs.length,
      recordedAllHeader: recordedAll.text.split("\n")[0] ?? "",
      recordedRunFindingCount: historyAfter.runs[0]?.findingCount ?? null,
      recordedRunStatus: historyAfter.runs[0]?.status ?? null,
    },
    cases,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify({ cases: cases.map((c) => ({ case: c.case, validated: c.validated.ok, isError: c.isError, rows: c.facts.displayRows, scan: c.facts.scan, fw: c.facts.showsFramework, stale: c.facts.staleMarks, header: c.facts.censusHeader })), history: report.history }, null, 1))
} catch (error) {
  console.error("FATAL", error)
  process.exitCode = 1
} finally {
  try { BrainDatabase.closeAll() } catch {}
}
