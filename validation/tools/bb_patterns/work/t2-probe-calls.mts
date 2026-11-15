// Phase A T2 decomposition probe: measures what a default bb_patterns call costs on
// the reference population, one engine at a time, flushing each result to disk after
// the call so a slow or killed run still leaves the measurement behind. The handler
// call is measured last, because it is the sum the report is about.
//
// Usage: BB_DATA_DIR=<tier data dir> BB_NO_AUTO_REFRESH=1 npx tsx t2-probe-calls.mts <out.jsonl>

import { appendFileSync, statSync, existsSync } from "node:fs"
import { loadavg, cpus } from "node:os"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { detectOrphans } from "../../../../src/intelligence/patterns/orphans"
import { detectIndexRules } from "../../../../src/intelligence/patterns/rules"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"

const outPath = process.argv[2]
if (!outPath) { console.error("usage: t2-probe-calls.mts <out.jsonl>"); process.exit(2) }
const projectDir = process.cwd()
const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)
const handler = createToolHandlers().bb_patterns
const rows: any[] = []
function emit(row: Record<string, unknown>) {
  const record = { ...row, loadavg: loadavg(), cores: cpus().length, at: new Date().toISOString() }
  rows.push(record)
  appendFileSync(outPath, JSON.stringify(record) + "\n")
  console.log(JSON.stringify(record))
}
async function timed(label: string, fn: () => Promise<any>) {
  const t0 = performance.now()
  const value = await fn()
  const ms = Math.round((performance.now() - t0) * 100) / 100
  return { ms, value }
}

const indexBefore = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
emit({ phase: "start", projectId, dbPath, indexBefore, dataDir: process.env.BB_DATA_DIR ?? null })

try {
  const orphans = await timed("detectOrphans", () => detectOrphans(projectId, { minConfidence: 0, maxResults: 100 }))
  emit({
    phase: "detectOrphans", ms: orphans.ms,
    findings: orphans.value.findings.length,
    candidatesTotal: orphans.value.summary.candidatesTotal,
    scannedSymbols: orphans.value.summary.scannedSymbols,
    scannedFiles: orphans.value.summary.scannedFiles,
    suppressed: orphans.value.summary.suppressedByReason,
  })
  const rules = await timed("detectIndexRules", () => detectIndexRules(projectId as any, { confidenceThreshold: 0, maxResults: 100, includeFramework: true, includeAntiPatterns: true }))
  emit({ phase: "detectIndexRules", ms: rules.ms, findings: rules.value.length, byType: rules.value.reduce((a: any, f: any) => { a[f.type] = (a[f.type] ?? 0) + 1; return a }, {}) })
  const all1 = await timed("handler:{}", () => handler({} as any, { projectId, projectPath: projectDir } as any))
  const text1 = ((all1.value as any)?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  emit({
    phase: "handler-default-all", ms: all1.ms, chars: text1.length,
    isError: (all1.value as any)?.isError === true,
    head: text1.split("\n")[0],
    scan: (text1.match(/\[scan: ([^\]]*)\]/) ?? [])[1] ?? null,
    displayRows: text1.split("\n").filter((l) => /^ {2}\[\w/.test(l)).length,
  })
  const orph1 = await timed("handler:{scope:orphaned}", () => handler({ scope: "orphaned" } as any, { projectId, projectPath: projectDir } as any))
  const text2 = ((orph1.value as any)?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  emit({
    phase: "handler-orphaned", ms: orph1.ms, chars: text2.length,
    isError: (orph1.value as any)?.isError === true,
    head: text2.split("\n")[0],
    scan: (text2.match(/\[scan: ([^\]]*)\]/) ?? [])[1] ?? null,
    displayRows: text2.split("\n").filter((l) => /^ {2}\[\w/.test(l)).length,
  })
  emit({ phase: "end", indexAfter: { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) } })
} catch (error: any) {
  emit({ phase: "error", message: String(error?.message ?? error), stack: String(error?.stack ?? "").slice(0, 1200) })
  process.exitCode = 1
} finally {
  try { BrainDatabase.closeAll() } catch {}
}
