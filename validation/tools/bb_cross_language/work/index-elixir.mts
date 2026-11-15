// validation/tools/bb_cross_language/work/index-elixir.mts
//
// One-time build of the elixir corpus index used for (a) CL1 corpus-lane runs and
// (b) the D4 row-set equality proof. Isolated BB_DATA_DIR under this tool's
// validation tree; the corpus repository itself is read-only.
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_cross_language/work/index-elixir.mts
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const DATA_DIR = join(HERE, "..", "bbdata")
const CORPUS = "/home/ishaq2321/bb_tests/repositories/elixir"
mkdirSync(DATA_DIR, { recursive: true })
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const { getProjectId } = await import(join(ROOT, "src", "util", "project-id.ts"))
const { indexProjectParallel } = await import(join(ROOT, "src", "ast", "parallel-indexer.ts"))
const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))

const workspace = realpathSync(CORPUS)
const projectId = getProjectId(workspace)
const started = Date.now()
const result = await (indexProjectParallel as any)(projectId, workspace, {})
const raw = await (BrainDatabase as any).getRawInstance(projectId)
const counts = {
  files: (raw.prepare("SELECT COUNT(*) n FROM brain_file WHERE project_id = ?").get(projectId) as any).n,
  symbols: (raw.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ?").get(projectId) as any).n,
  crossRows: (raw.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE project_id = ? AND is_cross_language = 1").get(projectId) as any).n,
}
const manifestPath = join(HERE, "..", "results", "index-manifest.json")
const manifest = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(manifestPath, "utf8")))
manifest.tiers.CL1 = {
  subject: "elixir corpus (616 files, Elixir/Erlang, the CL1 corpus lane)",
  workspace, projectId, dataDir: DATA_DIR, indexMs: Date.now() - started,
  processedFiles: result?.processedFiles ?? null, counts,
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
console.log(JSON.stringify({ projectId, dataDir: DATA_DIR, counts, indexMs: Date.now() - started }, null, 2))
