import { BrainDatabase } from "../../../../src/brain/database"
const pid = process.argv[2]
const raw = await BrainDatabase.getRawInstance(pid as any)
console.log("files:")
for (const r of raw.prepare("SELECT relative_path,language FROM brain_file WHERE project_id=? ORDER BY relative_path").all(pid) as any[]) console.log(" ", r.relative_path, r.language)
console.log("test symbols:")
for (const r of raw.prepare("SELECT s.name,s.symbol_type,f.relative_path FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND f.relative_path LIKE '%test%'").all(pid) as any[]) console.log(" ", JSON.stringify(r))
console.log("relationship types:")
for (const r of raw.prepare("SELECT relationship_type,COUNT(*) c FROM brain_relationship WHERE project_id=? GROUP BY 1").all(pid) as any[]) console.log(" ", r.relationship_type, r.c)
console.log("symbols:")
for (const r of raw.prepare("SELECT s.name,s.symbol_type,f.relative_path FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? ORDER BY f.relative_path,s.line_start").all(pid) as any[]) console.log(" ", r.relative_path, r.name, r.symbol_type)
