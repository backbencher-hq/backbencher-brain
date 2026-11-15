import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const pid = getProjectId(path.join(repoRoot, "validation/tools/bb_search/work/project")) as any
const raw = await BrainDatabase.getRawInstance(pid)
const out: any = {}
try {
  raw.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.__bb_fts_probe USING fts5(x)")
  raw.exec("DROP TABLE IF EXISTS temp.__bb_fts_probe")
  out.tempProbe = "ok"
} catch (e: any) { out.tempProbe = "ERR " + e.message }
try {
  raw.exec("CREATE VIRTUAL TABLE temp.__bb_rank_probe USING fts5(id UNINDEXED, name)")
  raw.prepare("INSERT INTO temp.__bb_rank_probe (id, name) VALUES (?, ?)").run("a", "handleRequest")
  out.tempRank = (raw.prepare("SELECT id FROM temp.__bb_rank_probe WHERE temp.__bb_rank_probe MATCH ?").all("\"handle\"") as any[])
  raw.exec("DROP TABLE IF EXISTS temp.__bb_rank_probe")
} catch (e: any) { out.tempRank = "ERR " + e.message }
console.log(JSON.stringify(out))
