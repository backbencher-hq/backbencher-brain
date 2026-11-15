import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const EMPTY = mkdtempSync(path.join(tmpdir(), "sw-seam2-"))
process.env.BB_DATA_DIR = EMPTY
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const REPO = "/tmp/sw-seam"
async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const pid = getProjectId(REPO) as any
  await indexProjectParallel(pid, REPO, {})
  const raw = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string) => raw.prepare(sql).all() as any[]
  const one = (sql: string) => raw.prepare(sql).get() as any
  const FLAGS = ["isMemberRead","isKeyPath","isEnumConstruction","isSuperInit","isSelfInit","isBareRead","isFieldAccess","isInstantiation","evidenceClass"]
  const flags: Record<string, number> = {}
  for (const k of FLAGS)
    flags[k] = one(`SELECT COUNT(*) c FROM brain_relationship WHERE json_extract(metadata, '$.${k}') IS NOT NULL`).c
  const ev = JSON.parse(readFileSync(path.join(ROOT, "validation/m60/results/P1-swift.json"), "utf8"))
  ev.secondReview = {
    at: new Date().toISOString(),
    newFlags: flags,
    verdict: "SW-G/SW-H flags join F1 (enrichment overwrite, filed on P1 #829); enum/init instantiates land with type/target/confidence; line NULL (no edge lines emitted)",
  }
  writeFileSync(path.join(ROOT, "validation/m60/results/P1-swift.json"), JSON.stringify(ev, null, 2) + "\n")
  console.log("flags:", JSON.stringify(flags))
  console.log("P1-swift.json extended");
}
main().catch((e) => { console.error("FATAL", e); process.exit(1) })
