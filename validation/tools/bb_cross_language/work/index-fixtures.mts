// validation/tools/bb_cross_language/work/index-fixtures.mts
//
// Builds the campaign performance fixtures for bb_cross_language and records
// what each one actually contains. T0 = test/fixtures/polyglot (java+scala and
// ts+js), T1 = .perf-fixtures/bb-scale/n100 (single language: the absence path).
//
// The indexer is imported from SOURCE (not dist/): dist/ is 70 source files
// stale in this checkout, and a fixture built by a stale indexer would be a
// measurement of the wrong binary.
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_cross_language/work/index-fixtures.mts
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const DATA_DIR = join(HERE, "..", "bbdata")
mkdirSync(DATA_DIR, { recursive: true })
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const tiers = {
  T0: join(ROOT, "test", "fixtures", "polyglot"),
  T1: join(ROOT, ".perf-fixtures", "bb-scale", "n100"),
}

async function main(): Promise<void> {
  const { getProjectId } = await import(join(ROOT, "src", "util", "project-id.ts"))
  const { indexProjectParallel } = await import(join(ROOT, "src", "ast", "parallel-indexer.ts"))
  const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))

  const manifest: Record<string, unknown> = {}
  for (const [tier, dir] of Object.entries(tiers)) {
    const workspace = realpathSync.native(dir)
    const projectId = getProjectId(workspace)
    const started = Date.now()
    const result = await (indexProjectParallel as any)(projectId, workspace, {})
    const indexMs = Date.now() - started
    const raw = await (BrainDatabase as any).getRawInstance(projectId)
    const counts = {
      files: (raw.prepare("SELECT COUNT(*) n FROM brain_file WHERE project_id = ?").get(projectId) as any).n,
      symbols: (raw.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ?").get(projectId) as any).n,
      crossRows: (raw.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ? AND is_cross_language = 1").get(projectId) as any).n,
      languages: (raw.prepare("SELECT DISTINCT language l FROM brain_file WHERE project_id = ? AND language IS NOT NULL ORDER BY language").all(projectId) as any[]).map((r) => r.l),
    }
    const ownNames = (raw.prepare(
      `SELECT ts.name AS name, COUNT(*) AS n FROM brain_relationship r
       JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY ts.name ORDER BY n DESC LIMIT 8`,
    ).all(projectId) as any[])
    const memberNames = (raw.prepare(
      `SELECT owner.name AS name, COUNT(*) AS n FROM brain_relationship r
       JOIN brain_symbol m ON m.id = r.target_symbol_id
       JOIN brain_symbol owner ON owner.id = m.owner_symbol_id
       WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY owner.name ORDER BY n DESC LIMIT 8`,
    ).all(projectId) as any[])
    const quietNames = (raw.prepare(
      `SELECT s.name AS name, COUNT(*) AS copies FROM brain_symbol s
       WHERE s.project_id = ? AND s.name NOT IN (
         SELECT ts.name FROM brain_relationship r JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE r.project_id = ? AND r.is_cross_language = 1
         UNION
         SELECT ss.name FROM brain_relationship r JOIN brain_symbol ss ON ss.id = r.source_symbol_id
         WHERE r.project_id = ? AND r.is_cross_language = 1)
       GROUP BY s.name ORDER BY copies DESC LIMIT 5`,
    ).all(projectId, projectId, projectId) as any[])
    const pairs = (raw.prepare(
      `SELECT sf.language AS source, tf.language AS target, COUNT(*) AS n
       FROM brain_relationship r
       JOIN brain_symbol ss ON ss.id = r.source_symbol_id JOIN brain_file sf ON sf.id = ss.file_id
       JOIN brain_symbol ts ON ts.id = r.target_symbol_id JOIN brain_file tf ON tf.id = ts.file_id
       WHERE r.project_id = ? AND r.is_cross_language = 1 GROUP BY sf.language, tf.language`,
    ).all(projectId) as any[])
    manifest[tier] = { workspace, projectId, indexMs, processedFiles: result?.processedFiles ?? null, counts, pairs, ownNames, memberNames, quietNames }
    console.log(`${tier}: ${JSON.stringify({ projectId: projectId.slice(0, 8), indexMs, counts, pairs })}`)
  }
  writeFileSync(join(HERE, "..", "results", "index-manifest.json"), JSON.stringify({ schemaVersion: 1, tool: "bb_cross_language", dataDir: "bbdata", generatedAt: new Date().toISOString(), tiers: manifest }, null, 2) + "\n")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
