// script/m57/probe-reindex-sandbox.ts — M57.T1d re-index proof, sandbox DB.
// Re-indexes THIS repo into a throwaway BB_DATA_DIR with the fixed classifier,
// then records the before/after flagged-file census against the M50 conviction.
// The real ~/.bb DB is never touched.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const SANDBOX = mkdtempSync(path.join(tmpdir(), "bb-m57-reindex-"))
process.env.BB_DATA_DIR = SANDBOX

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))

  const pid = getProjectId(ROOT) as string
  const r = await indexProjectParallel(pid as any, ROOT, { force: true })
  const raw = await BrainDatabase.getRawInstance(pid)
  const flagged = raw.prepare(
    "SELECT relative_path p, language l FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1 ORDER BY relative_path",
  ).all(pid) as Array<{ p: string; l: string }>
  const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(pid) as any).c
  const testEdges = (raw.prepare(
    "SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol ts ON ts.id=r.source_symbol_id " +
    "JOIN brain_file tf ON tf.id=ts.file_id AND COALESCE(tf.is_test_file,0)=1 " +
    "WHERE r.project_id=? AND r.relationship_type IN ('calls','instantiates','references','uses','extends','implements','imports')",
  ).get(pid) as any).c

  const nonCode = flagged.filter((f) => ["json","yaml","yml","md","toml","xml","csv","txt"].includes((f.l||"").toLowerCase()))
  const census = {
    probe: "M57.T1-reindex-sandbox",
    issue: 789,
    milestone: "M57",
    at: new Date().toISOString(),
    commit: process.env.M57_COMMIT || "",
    files: files,
    indexErrors: r.errors?.length ?? 0,
    before: { flaggedFiles: 30, allJson: true, classifiedEdges: 0, source: "validation/m50/results/A2-test-sources.json" },
    after: {
      flaggedFiles: flagged.length,
      flaggedByLanguage: Object.entries(flagged.reduce((m: Record<string, number>, f) => { const k = f.l || "(null)"; m[k] = (m[k]||0)+1; return m }, {})),
      nonCodeFlagged: nonCode.length,
      nonCodeSamples: nonCode.slice(0, 8),
      classifiedEdgesFromFlagged: testEdges,
      samples: flagged.slice(0, 12),
    },
    verdict: {
      nonCodeFlaggedIsZero: nonCode.length === 0,
      corpusIsNonZero: flagged.length > 0,
      evidenceEdgesExist: testEdges > 0,
    },
  }
  mkdirSync(path.join(ROOT, "validation/m57/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m57/results/T1-reindex-sandbox.json"), JSON.stringify(census, null, 2) + "\n")
  console.log(JSON.stringify({ files, flagged: flagged.length, nonCode: nonCode.length, testEdges, errors: r.errors?.length ?? 0, samples: flagged.slice(0, 10) }, null, 2))
  BrainDatabase.closeAll()
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
