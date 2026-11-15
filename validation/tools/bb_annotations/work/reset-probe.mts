// validation/tools/bb_annotations/work/reset-probe.mts
//
// Resets the probe fixture's ISOLATED index so the declared-absence phase runs
// against a store that genuinely holds zero rows. Only this lane's BB_DATA_DIR
// and the lane's own fixture project are touched; the shared store and the
// real-corpus indexes are never named here.
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/reset-probe.mts
import { existsSync, mkdirSync, realpathSync, rmSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const DATA_DIR = join(HERE, "..", "bbdata")
const WORKSPACE = join(HERE, "probe-fixture")
mkdirSync(DATA_DIR, { recursive: true })
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const { getProjectId } = await import(join(ROOT, "src", "util", "project-id.ts"))
const { indexProjectParallel } = await import(join(ROOT, "src", "ast", "parallel-indexer.ts"))
const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))

const canonical = realpathSync.native(WORKSPACE)
const projectId = getProjectId(canonical)
const projectDir = join(DATA_DIR, "projects", projectId)
if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true })
const started = Date.now()
await (indexProjectParallel as any)(projectId, canonical, {})
const raw = await (BrainDatabase as any).getRawInstance(projectId, { readonly: true })
const out = {
  schemaVersion: 1,
  tool: "bb_annotations",
  action: "reset probe fixture index to zero annotations",
  workspace: canonical,
  projectId,
  dataDir: DATA_DIR,
  indexMs: Date.now() - started,
  dbBytes: statSync(join(projectDir, "brain.db")).size,
  counts: {
    files: (raw.prepare("SELECT COUNT(*) n FROM brain_file WHERE project_id = ?").get(projectId) as any).n,
    symbols: (raw.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ?").get(projectId) as any).n,
    annotations: (raw.prepare("SELECT COUNT(*) n FROM brain_annotation WHERE project_id = ?").get(projectId) as any).n,
  },
  regeneratedAt: new Date().toISOString(),
}
raw.close()
const { writeFileSync } = await import("node:fs")
writeFileSync(join(HERE, "..", "raw", "probe-reset.json"), JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify(out, null, 2))
