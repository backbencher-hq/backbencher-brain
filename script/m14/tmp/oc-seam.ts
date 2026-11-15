// ObjC M60 seam trace (second review, in-wave): OC-E/F/G/H payload across
// the seam. Real pipeline into throwaway BB_DATA_DIR; rows read back.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const EMPTY = mkdtempSync(path.join(tmpdir(), "oc-seam-"))
process.env.BB_DATA_DIR = EMPTY
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const REPO = "/tmp/oc-seam"
async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(REPO) as any
  const stats = await indexProjectParallel(pid, REPO, {})
  const raw = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string) => raw.prepare(sql).all() as any[]
  const one = (sql: string) => raw.prepare(sql).get() as any
  const FLAGS = ["isBareRead","isFieldRead","isMessageExpression","isCFunctionCall","isObjCAlloc","isOverride","isCategoryProtocol","evidenceClass"]
  const flags: Record<string, number> = {}
  for (const k of FLAGS)
    flags[k] = one(`SELECT COUNT(*) c FROM brain_relationship WHERE json_extract(metadata, '$.${k}') IS NOT NULL`).c
  const dupes = q(`SELECT relationship_type rt, source_symbol_id s, target_external te, COUNT(*) n FROM brain_relationship GROUP BY rt, s, te HAVING n > 1`)
  const ev = {
    probe: "M60 objc seam trace (OC-E/F/G/H payload)",
    at: new Date().toISOString(),
    wave: "M49.OC2 (in flight)",
    rowsByType: Object.fromEntries(q(`SELECT relationship_type rt, COUNT(*) n FROM brain_relationship GROUP BY rt`).map((r: any) => [r.rt, r.n])),
    lineNumber: {
      gt0: one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number > 0`).c,
      eq0: one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number = 0`).c,
      nul: one(`SELECT COUNT(*) c FROM brain_relationship WHERE line_number IS NULL`).c,
    },
    analyzerFlagSurvival: flags,
    duplicateGroups: dupes.length,
    symbols: {
      total: one(`SELECT COUNT(*) c FROM brain_symbol`).c,
      withRange: one(`SELECT COUNT(*) c FROM brain_symbol WHERE line_start IS NOT NULL AND line_start > 0`).c,
    },
  }
  mkdirSync(path.join(ROOT, "validation/m60/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m60/results/P1-objc.json"), JSON.stringify(ev, null, 2) + "\n")
  console.log(JSON.stringify(ev, null, 1))
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
