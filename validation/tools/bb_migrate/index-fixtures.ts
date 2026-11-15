// Index the T0/T1 fixtures into bb_migrate's own BB_DATA_DIR.
// Fixture corpora are READ; only the isolated bbdata index is written.
import path from "node:path"
import { existsSync } from "node:fs"
import { getProjectId } from "../../../src/cli/index"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../src/brain/database"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const fixtures: Array<{ label: string; dir: string }> = [
  { label: "T0-polyglot", dir: path.join(ROOT, "test/fixtures/polyglot") },
  { label: "T1-n100", dir: path.join(ROOT, ".perf-fixtures/bb-scale/n100") },
]
for (const fixture of fixtures) {
  if (!existsSync(fixture.dir)) { console.log(JSON.stringify({ label: fixture.label, skipped: "fixture absent" })); continue }
  const projectId = getProjectId(fixture.dir)
  const started = Date.now()
  await indexProjectParallel(projectId, fixture.dir, {})
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const counts = raw.prepare(
    `SELECT (SELECT COUNT(*) FROM brain_file WHERE project_id=?) AS files,
            (SELECT COUNT(*) FROM brain_symbol WHERE project_id=?) AS symbols,
            (SELECT COUNT(*) FROM brain_relationship WHERE project_id=?) AS relationships,
            (SELECT COUNT(*) FROM brain_import WHERE file_id IN (SELECT id FROM brain_file WHERE project_id=?)) AS imports`,
  ).get(projectId, projectId, projectId, projectId) as any
  console.log(JSON.stringify({ label: fixture.label, projectId, dir: fixture.dir, indexMs: Date.now() - started, counts: Object.fromEntries(Object.entries(counts ?? {}).map(([k, v]) => [k, Number(v)])) }))
}
