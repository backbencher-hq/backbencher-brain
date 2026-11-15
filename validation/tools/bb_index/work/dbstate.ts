// Read-only state probe: counts + symbols whose name matches a needle.
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
import path from "node:path"
const proj = path.resolve(process.argv[2] ?? "")
const needle = process.argv[3] ?? "VENDORED"
const pid = getProjectId(proj)
const raw = await BrainDatabase.getRawInstance(pid as any, { readonly: true })
const one = (sql: string) => (raw.prepare(sql).get(pid) as any)?.c ?? 0
const files = one("SELECT COUNT(*) c FROM brain_file WHERE project_id=?")
const symbols = one("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?")
const rels = one("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?")
const matches = raw.prepare("SELECT name, file_id FROM brain_symbol WHERE project_id=? AND name LIKE ? ORDER BY name").all(pid, `%${needle}%`)
const vendorRows = raw.prepare("SELECT path FROM brain_file WHERE project_id=? AND path LIKE '%vendor%' ORDER BY path").all(pid)
console.log(JSON.stringify({ projectId: pid, files, symbols, relationships: rels, needle, matches, vendorFiles: vendorRows.map((r: any) => r.path.replace(proj + "/", "")) }, null, 1))
