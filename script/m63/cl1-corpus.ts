// script/m63/cl1-corpus.ts — build a real index for the CL1 gate.
//
// The gate needs a REAL polyglot index: fixtures with two hand-written classes
// cannot exercise name ambiguity (which is the whole defect), because a fixture
// has unique names by construction. So the corpus is whatever real repository
// the caller points at, indexed by the real pipeline into a private data dir.
//
// Nothing here is committed: the data dir is a temp dir unless the caller keeps
// it. A repository with at least two languages that call each other produces
// cross-language rows; a single-language repository produces none, and the
// gate says so rather than passing on zero rows.

import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dirname ?? ".", "..", "..")

export interface BuiltCorpus {
  projectId: string
  dataDir: string
  workspace: string
  indexSeconds: number
  files: number
  crossLanguageRows: number
  languages: string[]
}

export async function buildCorpusIndex(corpusPath: string): Promise<BuiltCorpus> {
  const workspace = realpathSync(corpusPath)
  const dataDir = mkdtempSync(join(tmpdir(), "bb-cl1-corpus-"))
  process.env.BB_DATA_DIR = dataDir

  const { getProjectId } = await import(join(ROOT, "src", "cli", "index.ts"))
  const { indexProjectParallel } = await import(join(ROOT, "src", "ast", "parallel-indexer.ts"))
  const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))

  const projectId = getProjectId(workspace)
  const started = Date.now()
  await indexProjectParallel(projectId as any, workspace, {})
  const indexSeconds = (Date.now() - started) / 1000

  const raw = await BrainDatabase.getRawInstance(projectId as any)
  const files = (raw.prepare("SELECT COUNT(*) AS c FROM brain_file WHERE project_id = ?").get(projectId) as any).c as number
  const crossLanguageRows = (raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND is_cross_language = 1").get(projectId) as any).c as number
  const languages = (raw.prepare("SELECT DISTINCT language FROM brain_file WHERE project_id = ? AND language IS NOT NULL ORDER BY language").all(projectId) as any[]).map((r) => r.language as string)

  return { projectId, dataDir, workspace, indexSeconds, files, crossLanguageRows, languages }
}

if (import.meta.main) {
  const corpus = process.argv[2]
  if (!corpus) { console.error("usage: cl1-corpus.ts <real repo path>"); process.exit(2) }
  const built = await buildCorpusIndex(corpus)
  mkdirSync(built.dataDir, { recursive: true })
  console.log(JSON.stringify(built, null, 2))
  console.log(`\nTo reuse this index instead of rebuilding it:\n  BB_CL1_DB=${built.dataDir} BB_CL1_PROJECT=${built.projectId}`)
}
