// ad-hoc probe for #910 gate triage: what rows exist for util.h and what
// classification the analyzers gave them.
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../src/brain/database"

const root = mkdtempSync(path.join(tmpdir(), "bb-910probe-"))
const FIX: Record<string, string> = {
  "util.h": "int util_add(int a, int b);\n",
  "util.c": '#include "util.h"\nstatic int util_scale(int v) { return v > 0 ? v : -v; }\n',
  "main.c": '#include <stdio.h>\n#include "util.h"\nint main_entry(void) { printf("%d\\n", util_add(1, 2)); return 0; }\n',
}
for (const [rel, text] of Object.entries(FIX)) writeFileSync(path.join(root, rel), text)
const pid = "probe-910"
await indexProjectParallel(pid, root, {})
const raw = await BrainDatabase.getRawInstance(pid)
console.log("=== brain_file languages ===")
for (const f of raw.prepare("SELECT relative_path, language FROM brain_file WHERE project_id = ?").all(pid) as any[]) {
  console.log(" ", f.relative_path, "->", f.language)
}
console.log("=== brain_import ===")
for (const r of raw.prepare("SELECT id, file_id, imported_name, import_path, import_type, is_external, line_number FROM brain_import WHERE project_id = ?").all(pid) as any[]) {
  console.log(" ", JSON.stringify(r))
}
console.log("=== include relationships ===")
for (const r of raw.prepare("SELECT relationship_type, source_symbol_id, target_symbol_id, source_external, target_external, line_number, metadata FROM brain_relationship WHERE project_id = ?").all(pid) as any[]) {
  console.log(" ", JSON.stringify(r))
}
try { rmSync(root, { recursive: true, force: true }) } catch {}
process.exit(0)
