// ad-hoc: why does the ts control read empty under bun but not under tsx?
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { indexProjectParallel } from "../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../src/brain/database"
import { handleGraphRequest, GRAPH_MODE_USAGES, GRAPH_SCHEMA_VERSION } from "../../../src/lsp/graph_request"

const root = mkdtempSync(path.join(tmpdir(), "bb-910bun-"))
const FIX: Record<string, string> = {
  "util.h": "int util_add(int a, int b);\n",
  "util.c": '#include "util.h"\nstatic int util_scale(int v) { return v > 0 ? v : -v; }\n',
  "main.c": '#include <stdio.h>\n#include "util.h"\nint main_entry(void) { printf("%d\\n", util_add(1, 2)); return 0; }\n',
  "mod.ts": "export function widgetThing(): number {\n  return 1\n}\n",
  "use.ts": 'import { widgetThing } from "./mod"\nexport function useThing(): number {\n  return widgetThing()\n}\n',
}
for (const [rel, text] of Object.entries(FIX)) writeFileSync(path.join(root, rel), text)
const pid = `probe-910bun-${Date.now().toString(36)}`
await indexProjectParallel(pid, root, {})
const raw = await BrainDatabase.getRawInstance(pid)
console.log("runtime:", typeof Bun !== "undefined" ? "bun" : "node")
console.log("=== symbols ===")
for (const s of raw.prepare("SELECT id, name, symbol_type FROM brain_symbol WHERE project_id = ?").all(pid) as any[]) console.log(" ", JSON.stringify(s))
console.log("=== relationships ===")
for (const r of raw.prepare("SELECT relationship_type, source_symbol_id, target_symbol_id, source_external, target_external FROM brain_relationship WHERE project_id = ?").all(pid) as any[]) console.log(" ", JSON.stringify(r))
console.log("=== brain_import ===")
for (const r of raw.prepare("SELECT file_id, import_path, is_external, line_number FROM brain_import WHERE project_id = ?").all(pid) as any[]) console.log(" ", JSON.stringify(r))
const resp: any = await handleGraphRequest(raw, pid, { schemaVersion: GRAPH_SCHEMA_VERSION, symbol: "widgetThing", mode: GRAPH_MODE_USAGES }).catch((e: any) => ({ err: String(e?.message ?? e) }))
console.log("=== usages(widgetThing) ===", JSON.stringify({ err: resp?.err, root: resp?.root, fileLevel: resp?.fileLevel, counts: resp?.counts }))
try { rmSync(root, { recursive: true, force: true }) } catch {}
process.exit(0)
