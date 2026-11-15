// validation/tools/bb_annotations/work/index-fixtures.mts
//
// Builds the three isolated indexes the audit measures: T0 (test/fixtures/polyglot),
// T1 (.perf-fixtures/bb-scale/n100) and the purpose-built probe fixture. Each index
// lives under this lane's BB_DATA_DIR, so no measurement can reach the shared store.
// The indexer is imported from SOURCE: dist/ predates the module split in this
// checkout, and a fixture built by a stale indexer would describe the wrong binary.
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/index-fixtures.mts
import { mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const DATA_DIR = join(HERE, "..", "bbdata")
mkdirSync(DATA_DIR, { recursive: true })
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const tiers: Record<string, string> = {
  T0: join(ROOT, "test", "fixtures", "polyglot"),
  T1: join(ROOT, ".perf-fixtures", "bb-scale", "n100"),
  probe: join(HERE, "probe-fixture"),
}

async function main(): Promise<void> {
  const { getProjectId } = await import(join(ROOT, "src", "util", "project-id.ts"))
  const { indexProjectParallel } = await import(join(ROOT, "src", "ast", "parallel-indexer.ts"))
  const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))

  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    tool: "bb_annotations",
    dataDir: DATA_DIR,
    builtAt: new Date().toISOString(),
    tiers: {},
  }

  for (const [tier, dir] of Object.entries(tiers)) {
    const workspace = realpathSync.native(dir)
    const projectId = getProjectId(workspace)
    const started = Date.now()
    await (indexProjectParallel as any)(projectId, workspace, {})
    const indexMs = Date.now() - started
    const raw = await (BrainDatabase as any).getRawInstance(projectId)
    const dbPath = join(DATA_DIR, "projects", projectId, "brain.db")
    const counts = {
      files: (raw.prepare("SELECT COUNT(*) n FROM brain_file WHERE project_id = ?").get(projectId) as any).n,
      symbols: (raw.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ?").get(projectId) as any).n,
      relationships: (raw.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ?").get(projectId) as any).n,
      annotations: (raw.prepare("SELECT COUNT(*) n FROM brain_annotation WHERE project_id = ?").get(projectId) as any).n,
    }
    // Two facts the read-door audit depends on, measured on the built index:
    // what a qualified_name looks like, and which column holds a file's absolute path.
    const qualified = (raw.prepare(
      "SELECT name, qualified_name FROM brain_symbol WHERE project_id = ? AND qualified_name IS NOT NULL AND qualified_name != name LIMIT 8",
    ).all(projectId) as any[])
    const files = (raw.prepare("SELECT relative_path, path FROM brain_file WHERE project_id = ? LIMIT 4").all(projectId) as any[])
    manifest.tiers[tier] = {
      workspace,
      projectId,
      dbPath,
      dbBytes: statSync(dbPath).size,
      dbMtimeMs: statSync(dbPath).mtimeMs,
      indexMs,
      counts,
      qualifiedNameExamples: qualified,
      filePathColumns: files,
    }
    raw.close()
  }

  writeFileSync(join(HERE, "..", "raw", "index-manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  console.log(JSON.stringify(manifest, null, 2))
}

await main()
