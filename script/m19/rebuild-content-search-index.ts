// script/m19/rebuild-content-search-index.ts — M19.Q1 maintenance.
//
// Builds the persistent trigram search surface used by giant-corpus content
// search. This is intentionally separate from query execution: a user query
// must never trigger a multi-minute schema/index rebuild.

import { rebuildContentSearchIndex } from "../../src/intelligence/search/content-search"
import { getProjectId } from "../../src/cli/index"
import { BrainDatabase } from "../../src/brain/database"

const repo = process.argv[2]
if (!repo) {
  console.error("usage: bun script/m19/rebuild-content-search-index.ts <repo>")
  process.exit(2)
}

const projectId = getProjectId(repo)
const started = Date.now()
try {
  const result = await rebuildContentSearchIndex(projectId)
  const raw = await BrainDatabase.getRawInstance(projectId)
  const indexed = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol_content_fts WHERE project_id=?").get(projectId) as any).c
  const marker = raw.prepare("SELECT * FROM brain_symbol_content_fts_meta WHERE project_id=?").get(projectId)
  const summary = {
    ok: indexed === result.symbolCount && indexed === result.indexed,
    repo,
    projectId,
    indexed,
    symbolCount: result.symbolCount,
    maxUpdated: result.maxUpdated,
    wallMs: Date.now() - started,
    marker,
  }
  console.log(JSON.stringify(summary))
  process.exit(summary.ok ? 0 : 1)
} catch (error: any) {
  console.error(JSON.stringify({ ok: false, repo, error: error?.message || String(error), wallMs: Date.now() - started }))
  process.exit(1)
}
