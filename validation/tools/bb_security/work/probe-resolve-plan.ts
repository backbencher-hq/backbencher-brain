// Reproducible planner evidence for the T2 default-scan fix: the endpoint
// resolution query is timed and planned in BOTH shapes on the shared reference
// index, read-only, no writes. The project-filtered shape is what made a
// 9,000-id lookup cost seconds; the keyed shape is what the engine runs now.
import { statSync } from "node:fs"
import path from "node:path"
import { BrainDatabase } from "../../../../src/brain/database"
import { getProjectId } from "../../../../src/util/project-id"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const DATA = path.join(ROOT, ".bb-data")
process.env.BB_DATA_DIR = DATA
process.env.BB_NO_AUTO_REFRESH = "1"

const projectId = getProjectId(ROOT)
const CHUNK = 200
const REPEATS = 3

async function main() {
  const dbPath = path.join(DATA, "projects", projectId, "brain.db")
  const statOf = () => { const s = statSync(dbPath); return { bytes: s.size, mtimeMs: s.mtimeMs } }
  const before = statOf()
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const sampled = (raw
    .prepare("SELECT DISTINCT sink_symbol_id FROM brain_taint_flow WHERE project_id = ? AND sink_symbol_id IS NOT NULL LIMIT ?")
    .all(projectId, CHUNK) as Array<{ sink_symbol_id: string }>).map((r) => r.sink_symbol_id)
  const placeholders = sampled.map(() => "?").join(",")

  const shapes = [
    {
      id: "project-filtered",
      query: `SELECT s.id, s.project_id, s.name, s.line_start AS line, f.relative_path AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.id IN (${placeholders})`,
      args: [projectId, ...sampled],
    },
    {
      id: "primary-key",
      query: `SELECT s.id, s.project_id, s.name, s.line_start AS line, f.relative_path AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.id IN (${placeholders})`,
      args: [...sampled],
    },
  ]

  const results: any[] = []
  for (const shape of shapes) {
    const plan = (raw.prepare("EXPLAIN QUERY PLAN " + shape.query).all(...shape.args) as Array<{ detail: string }>).map((r) => r.detail)
    const stmt = raw.prepare(shape.query)
    stmt.all(...shape.args) // warm
    const samples: number[] = []
    let rows = 0
    for (let i = 0; i < REPEATS; i++) {
      const t = performance.now()
      rows = (stmt.all(...shape.args) as any[]).length
      samples.push(Math.round((performance.now() - t) * 1000) / 1000)
    }
    samples.sort((a, b) => a - b)
    results.push({
      id: shape.id,
      ids: sampled.length,
      rows,
      plan,
      usesPrimaryKey: plan.some((d) => d.includes("sqlite_autoindex_brain_symbol_1")),
      usesProjectIndex: plan.some((d) => d.includes("(project_id=?)")),
      samplesMs: samples,
      p50Ms: samples[Math.floor(samples.length / 2)],
    })
  }

  const after = statOf()
  const report = {
    schemaVersion: 1,
    tool: "bb_security",
    what: "endpoint-resolution query plan on the shared reference index, both shapes",
    generatedAt: new Date().toISOString(),
    referenceIndex: { projectId, dbPath: path.relative(ROOT, dbPath), dbBefore: before, dbAfter: after, dbUnchanged: before.bytes === after.bytes && before.mtimeMs === after.mtimeMs },
    chunkIds: sampled.length,
    repeats: REPEATS,
    shapes: results,
    verdict:
      results.find((r) => r.id === "project-filtered")?.p50Ms > results.find((r) => r.id === "primary-key")?.p50Ms * 10
        ? "CONFIRMED: the project-filtered shape plans an index scan over the project and is an order of magnitude slower"
        : "NOT CONFIRMED: the measured shapes do not differ as expected",
  }
  console.log(JSON.stringify(report, null, 2))
}
await main()
