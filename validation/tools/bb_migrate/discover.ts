// Enumerate the fixture/workspace indexes for bb_migrate measurement: project ids, populations, and
// plannable candidate symbols (a candidate is one that yields at least one plan for a target language).
import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { BrainDatabase } from "../../../src/brain/database"
import { generateMigrationPlans } from "../../../src/intelligence/migration/migration-engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const targets: Array<{ tier: string; dir: string; targetLanguage: string }> = [
  { tier: "T0", dir: path.join(ROOT, "test/fixtures/polyglot"), targetLanguage: "python" },
  { tier: "T1", dir: path.join(ROOT, ".perf-fixtures/bb-scale/n100"), targetLanguage: "python" },
  { tier: "T2-workspace", dir: ROOT, targetLanguage: "python" },
]
for (const t of targets) {
  const projectId = getProjectId(t.dir)
  let counts: any = null
  try {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    counts = raw.prepare(
      `SELECT (SELECT COUNT(*) FROM brain_file WHERE project_id=?) f, (SELECT COUNT(*) FROM brain_symbol WHERE project_id=?) s, (SELECT COUNT(*) FROM brain_relationship WHERE project_id=?) r, (SELECT COUNT(*) FROM brain_import WHERE file_id IN (SELECT id FROM brain_file WHERE project_id=?)) i`,
    ).get(projectId, projectId, projectId, projectId)
  } catch (e) {
    console.log(JSON.stringify({ tier: t.tier, dir: t.dir, projectId, counts: null, note: String(e).slice(0, 160) }))
    continue
  }
  let chosen: any[] = []
  if (Number(counts.s) > 0) {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    const candidates = raw.prepare(
      `SELECT s.id id, s.name name, s.symbol_type type, f.language language, f.relative_path file
       FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
       WHERE s.project_id=? AND s.symbol_type IN ('function','method','class','interface','type')
       ORDER BY (SELECT COUNT(*) FROM brain_relationship r WHERE r.source_symbol_id=s.id OR r.target_symbol_id=s.id) DESC, s.id LIMIT 40`,
    ).all(projectId) as any[]
    for (const c of candidates) {
      const probe = await generateMigrationPlans(projectId, { symbolNames: [c.name], targetLanguage: t.targetLanguage })
      const plan = probe.plans.find((p: any) => p.symbolId === c.id)
      if (plan) { chosen.push({ id: c.id, name: c.name, type: c.type, language: c.language, file: c.file, plans: probe.plans.length }); if (chosen.length >= 5) break }
    }
  }
  console.log(JSON.stringify({ tier: t.tier, dir: t.dir, projectId, counts: Object.fromEntries(Object.entries(counts ?? {}).map(([k, v]) => [k, Number(v)])), chosen }))
}
