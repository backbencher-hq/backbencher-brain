// bb_migrate latency on the three campaign tiers, measured through the real handler
// (args → handler → engine → result), not through a private entry point.
//
// Warm measurements: one untimed warm-up call per shape in the same process, then
// five measured calls. p50/p95 are nearest-rank over the measured runs. The DB
// file state is recorded before/after so the read-path write behaviour is visible
// in the same document as the timing.
import { existsSync, statSync } from "node:fs"
import { loadavg } from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { getProjectId } from "../../../src/cli/index"
import { handler } from "../../../src/mcp/tools/bb_migrate/handler"
import { BrainDatabase } from "../../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const TIER = (process.argv[2] ?? "t0").toLowerCase()
const CONFIG: Record<string, { dir: string; cohort: string; targetLanguage: string }> = {
  t0: { dir: path.join(ROOT, "test/fixtures/polyglot"), cohort: "ts-js", targetLanguage: "python" },
  t1: { dir: path.join(ROOT, ".perf-fixtures/bb-scale/n100"), cohort: ".", targetLanguage: "python" },
  t2: { dir: ROOT, cohort: "src/mcp/tools", targetLanguage: "python" },
}
const config = CONFIG[TIER]
if (!config || !existsSync(config.dir)) { console.error(`unknown or absent tier ${TIER}`); process.exit(2) }
const projectId = getProjectId(config.dir)
const dataDir = path.resolve(process.env.BB_DATA_DIR ?? "")
const dbPath = BrainDatabase.getDbPath(projectId)

const fileState = () => Object.fromEntries(["", "-wal", "-shm"].map((suffix) => {
  const p = dbPath + suffix
  return [suffix || "db", existsSync(p) ? { size: statSync(p).size, mtimeMs: Math.round(statSync(p).mtimeMs) } : null]
}))

function rank(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

async function main() {
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const counts = raw.prepare(
    `SELECT (SELECT COUNT(*) FROM brain_file WHERE project_id=?) files,(SELECT COUNT(*) FROM brain_symbol WHERE project_id=?) symbols,(SELECT COUNT(*) FROM brain_relationship WHERE project_id=?) relationships`,
  ).get(projectId, projectId, projectId) as any
  const candidates = raw.prepare(
    `SELECT s.id id, s.name name, f.language language, f.relative_path file
     FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
     WHERE s.project_id=? AND s.symbol_type IN ('function','method','class','interface','type')
     ORDER BY (SELECT COUNT(*) FROM brain_relationship r WHERE r.source_symbol_id=s.id OR r.target_symbol_id=s.id) DESC, s.id LIMIT 60`,
  ).all(projectId) as any[]


  const call = async (args: Record<string, unknown>) => {
    const started = performance.now()
    const result = await handler(args, { projectId, projectPath: config.dir })
    const ms = performance.now() - started
    const text = result.content[0]?.text ?? ""
    return { ms, isError: result.isError === true, text }
  }
  const measure = async (args: Record<string, unknown>, warmups = 1, runs = 5) => {
    for (let i = 0; i < warmups; i++) await call(args)
    const samples: number[] = []
    let last: Awaited<ReturnType<typeof call>> | null = null
    for (let i = 0; i < runs; i++) { last = await call(args); samples.push(last.ms) }
    const plans = (() => { try { return JSON.parse(last!.text).plans?.length ?? null } catch { return null } })()
    return { args, samplesMs: samples.map((v) => Number(v.toFixed(1))), p50Ms: Number(rank(samples, 50).toFixed(1)), p95Ms: Number(rank(samples, 95).toFixed(1)), lastIsError: last!.isError, lastPlans: plans, lastTextHead: last!.text.split("\n").slice(0, 2) }
  }

  const stateBefore = fileState()
  // First call in a cold process: this is the number a first MCP request pays.
  const firstCallStart = performance.now()
  const firstCall = await handler({ symbolNames: [candidates[0]?.name ?? ""], targetLanguage: config.targetLanguage }, { projectId, projectPath: config.dir })
  const firstCallMs = Number((performance.now() - firstCallStart).toFixed(1))
  const stateAfterFirst = fileState()

  // A plannable single symbol: the first candidate whose name yields a plan.
  let chosen: any = null
  for (const candidate of candidates) {
    const probe = await call({ symbolNames: [candidate.name], targetLanguage: config.targetLanguage })
    if (!probe.isError && probe.text.startsWith("migration target")) { chosen = candidate; break }
  }
  if (!chosen) { console.error("no plannable symbol found"); process.exit(1) }
  const fourteenNames = [...new Set(candidates.slice(0, 40).map((c) => c.name))].slice(0, 12)

  const single = await measure({ symbolNames: [chosen.name], targetLanguage: config.targetLanguage })
  const singleJson = await measure({ symbolNames: [chosen.name], targetLanguage: config.targetLanguage, format: "json" })
  const twelve = await measure({ symbolNames: fourteenNames, targetLanguage: config.targetLanguage })
  const cohort = await measure({ paths: [config.cohort], targetLanguage: config.targetLanguage })

  const stateAfter = fileState()
  console.log(JSON.stringify({
    tier: TIER, projectId, dir: config.dir, dataDir,
    measuredAt: new Date().toISOString(),
    loadAverage: loadavg().map((v) => Number(v.toFixed(2))),
    index: { counts: { files: Number(counts.files), symbols: Number(counts.symbols), relationships: Number(counts.relationships) }, dbPath, dbMtimeMs: stateBefore.db?.mtimeMs ?? null },
    firstCall: { args: { symbolNames: [candidates[0]?.name], targetLanguage: config.targetLanguage }, ms: firstCallMs, isError: firstCall.isError === true },
    shapes: {
      singleText: single, singleJson, twelveNames: twelve, cohort,
    },
    dbState: { before: stateBefore, afterFirstCall: stateAfterFirst, after: stateAfter },
  }, null, 1))
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
