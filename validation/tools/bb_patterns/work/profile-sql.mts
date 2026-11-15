// Phase B profiler: times every SQL statement the pattern engines issue on one
// tier, through a read-only handle (so the profile measures queries, not the
// read-write open). Used to target the P-03 latency fix.
//
// Usage: BB_DATA_DIR=<tier data dir> npx tsx profile-sql.mts <projectDir> <out.json>

import { writeFileSync } from "node:fs"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { detectOrphans } from "../../../../src/intelligence/patterns/orphans"
import { detectIndexRules } from "../../../../src/intelligence/patterns/rules"

const projectDir = process.argv[2]
const outPath = process.argv[3]
if (!projectDir || !outPath) { console.error("usage: profile-sql.mts <projectDir> <out.json>"); process.exit(2) }
const projectId = getProjectId(projectDir)

const realGet = BrainDatabase.getRawInstance.bind(BrainDatabase)
const statements: Array<{ sql: string; ms: number; rows: number; kind: string }> = []
function wrap(raw: any, kind: string) {
  const proxy: any = new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string) => {
          const stmt = target.prepare(sql)
          return new Proxy(stmt, {
            get(st, p) {
              const value = (st as any)[p]
              if (typeof value !== "function") return value
              if (["all", "get", "run", "iterate"].includes(String(p))) {
                return (...args: any[]) => {
                  const t0 = performance.now()
                  const result = value.apply(st, args)
                  const ms = Math.round((performance.now() - t0) * 100) / 100
                  let rows = -1
                  if (Array.isArray(result)) rows = result.length
                  statements.push({ sql: sql.replace(/\s+/g, " ").slice(0, 180), ms, rows, kind })
                  return result
                }
              }
              return value.bind(st)
            },
          })
        }
      }
      return (target as any)[prop]
    },
  })
  return proxy
}
;(BrainDatabase as any).getRawInstance = async (pid: string, options: any = {}) => wrap(await realGet(pid, { ...options, readonly: true }), "query")

const totalStart = performance.now()
try {
  const orphansStart = performance.now()
  const report = await detectOrphans(projectId as any, { minConfidence: 0, maxResults: 100 })
  const orphansMs = Math.round((performance.now() - orphansStart) * 100) / 100
  const rulesStart = performance.now()
  await detectIndexRules(projectId as any, { confidenceThreshold: 0, maxResults: 100, includeFramework: true, includeAntiPatterns: true })
  const rulesMs = Math.round((performance.now() - rulesStart) * 100) / 100
  const totalMs = Math.round((performance.now() - totalStart) * 100) / 100
  const byKind: Record<string, number> = {}
  for (const s of statements) byKind[s.kind] = Math.round(((byKind[s.kind] ?? 0) + s.ms) * 100) / 100
  const reportOut = {
    approach: "read-only handle; every statement the pattern engines issue is timed. Multiple calls to one SQL shape are separate rows because each executes.",
    projectId,
    dataDir: process.env.BB_DATA_DIR ?? null,
    orphansMs,
    rulesMs,
    totalMs,
    statementCount: statements.length,
    totalsByEngine: { orphans: report.summary.candidatesTotal, scannedSymbols: report.summary.scannedSymbols, rules: null },
    statements: statements.sort((a, b) => b.ms - a.ms),
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(outPath, JSON.stringify(reportOut, null, 2) + "\n")
  console.log("orphansMs", orphansMs, "rulesMs", rulesMs, "totalMs", totalMs, "statements", statements.length)
  for (const s of reportOut.statements.slice(0, 20)) console.log(String(s.ms).padStart(10), "rows=" + String(s.rows).padStart(7), "|", s.sql.slice(0, 130))
} catch (error) {
  console.error("FATAL", error)
  process.exitCode = 1
} finally {
  BrainDatabase.closeAll()
}
