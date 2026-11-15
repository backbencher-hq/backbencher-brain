import { DatabaseSync } from "node:sqlite"
import { statSync, readdirSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/cli/index"
const proj = path.resolve(process.argv[2])
const pid = getProjectId(proj)
const db = new DatabaseSync(path.join(process.env.BB_DATA_DIR!, "projects", pid, "brain.db"), { readOnly: true })
const rows = db.prepare("SELECT path,last_modified,size_bytes,file_hash FROM brain_file WHERE project_id=?").all(pid) as any[]
console.log(JSON.stringify({ pid, stored: rows.length }))
let mism = 0
for (const r of rows.slice(0, 6)) {
  const st = statSync(r.path)
  console.log(JSON.stringify({ p: r.path.replace(proj + "/", ""), storedFloor: Math.floor(r.last_modified), diskFloor: Math.floor(st.mtimeMs), sizeEq: r.size_bytes === st.size, hash: r.file_hash }))
}
for (const r of rows) { try { const st = statSync(r.path); if (Math.floor(r.last_modified) !== Math.floor(st.mtimeMs) || r.size_bytes !== st.size) mism++ } catch { mism++ } }
console.log(JSON.stringify({ mismatched: mism, onDisk: readdirSync(proj).length }))
db.close()
