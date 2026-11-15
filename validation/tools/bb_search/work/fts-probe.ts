import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const pid = getProjectId(path.join(repoRoot, "validation/tools/bb_search/work/project")) as any
const raw = await BrainDatabase.getRawInstance(pid)
const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%fts%'").all()
const out: any = { tables }
for (const t of tables as any[]) {
  try { out[t.name] = raw.prepare(`SELECT COUNT(*) c FROM ${t.name}`).get() } catch (e: any) { out[t.name] = "ERR " + e.message }
}
try { out.marker = raw.prepare("SELECT * FROM brain_symbol_content_fts_meta").all() } catch (e: any) { out.marker = "ERR " + e.message }
try { out.ftsTest = raw.prepare("SELECT symbol_id FROM brain_symbol_content_fts WHERE brain_symbol_content_fts MATCH ? LIMIT 3").all('"bodyOnlyNeedle"') } catch (e: any) { out.ftsTest = "ERR " + e.message }
out.sourceText = raw.prepare("SELECT name, substr(source_text,1,60) s FROM brain_symbol WHERE name IN ('bodyOnlyHost','handleRequest')").all()
console.log(JSON.stringify(out, null, 2))

const LIKE_ESCAPE_CHAR = "\\"
const needle = "%" + "bodyOnlyNeedle" + "%"
const rows = raw.prepare(
  "SELECT id FROM brain_symbol WHERE project_id = ? AND COALESCE(line_start, 0) > 0 AND name NOT LIKE '/%/%' " +
    `AND (name LIKE ? COLLATE NOCASE ESCAPE '\\' OR qualified_name LIKE ? COLLATE NOCASE ESCAPE '\\' OR docstring LIKE ? COLLATE NOCASE ESCAPE '\\' OR source_text LIKE ? COLLATE NOCASE ESCAPE '\\') LIMIT ?`,
).all(pid, needle, needle, needle, needle, 20000)
console.log("fallback rows:", JSON.stringify(rows))
// and the exact phase
console.log("exact:", JSON.stringify(raw.prepare("SELECT id, name FROM brain_symbol WHERE project_id=? AND name = ? COLLATE NOCASE").all(pid, "bodyOnlyNeedle")))
