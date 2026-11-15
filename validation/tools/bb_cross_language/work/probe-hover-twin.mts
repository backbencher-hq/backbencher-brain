// validation/tools/bb_cross_language/work/probe-hover-twin.mts
//
// Reproduces the exact W3 fixture from script/m26/verify-cross-language-hover.ts
// (a one-line main.ts whose symbols are seeded at lines 1..3) and calls the real
// LSP hover at the three positions the gate asserts. Purpose: separate a defect
// in the shared owner module from one in the hover door around it.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")

const ws = mkdtempSync(join(tmpdir(), "bbcl-hover-ws-"))
const dataDir = mkdtempSync(join(tmpdir(), "bbcl-hover-data-"))
writeFileSync(join(ws, "main.ts"), "export function main(): void {}\n")
writeFileSync(join(ws, "service.kt"), "fun service() {}\n")
const canonical = realpathSync(ws)
const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
mkdirSync(join(dataDir, "projects", projectId), { recursive: true })
process.env.BB_DATA_DIR = dataDir

const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
const raw = await (BrainDatabase as any).getRawInstance(projectId)
raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`).run("file-ts", projectId, join(ws, "main.ts"), "main.ts", "typescript", "w3-ts-hash")
raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`).run("file-kt", projectId, join(ws, "service.kt"), "service.kt", "kotlin", "w3-kt-hash")
const sym = raw.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
sym.run("sym-main", projectId, "file-ts", "main", "function", 1, 1, 1, 3, 5)
sym.run("sym-service", projectId, "file-kt", "service", "function", 1, 1, 1, 3, 4)
sym.run("sym-local", projectId, "file-ts", "localCaller", "function", 2, 2, 5, 8, 2)
const rel = raw.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism, metadata) VALUES (?,?,?,?,?,?,?,?,?)`)
rel.run("rel-xt-1", projectId, "sym-service", "sym-main", "calls", 0.92, 1, "kotlin-ts interop", JSON.stringify({ evidenceClass: "usage_contextual" }))
rel.run("rel-xt-2", projectId, "sym-local", "sym-service", "calls", 0.5, 1, null, null)
rel.run("rel-same-1", projectId, "sym-local", "sym-main", "calls", 0.95, 0, null, null)

const { hover } = await import(join(ROOT, "src", "lsp", "hover.ts"))
const filePath = join(ws, "main.ts")
for (const [label, line] of [["h1 line0 char7", 0], ["h2 line1 char7", 1], ["h3 line2 char7", 2]] as const) {
  const result = await (hover as any)(raw, { filePath, position: { line, character: 7 } })
  const text = result?.contents?.value ?? ""
  const crossLines = text.split("\n").filter((l: string) => /cross-language|called from|calls into/.test(l))
  const symbolLine = text.split("\n").find((l: string) => /```|symbol|function/.test(l)) ?? ""
  console.log(`--- ${label} | bytes=${text.length}`)
  console.log("  cross:", JSON.stringify(crossLines))
  console.log("  first:", JSON.stringify(symbolLine.slice(0, 100)))
}
process.exit(0)
