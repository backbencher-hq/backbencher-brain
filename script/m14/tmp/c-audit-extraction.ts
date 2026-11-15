// C lane audit: symbol kinds, edge types, unknown/ownerless counts and parse
// damage on the full M12 C slice through the PRODUCTION entry (parseFile).
// Run: bun script/m14/tmp/c-audit-extraction.ts
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../src/ast/pool-worker"

const Z = "/home/ishaq2321/bb_tests/repositories/zig"
const files = execFileSync("bash", ["-c", `find ${Z} -name '*.c' -size +1k -not -path '*/.git/*' | sort | head -400`], { encoding: "utf8" }).split("\n").filter(Boolean)
const kinds: Record<string, number> = {}
const edges: Record<string, number> = {}
let syms = 0
let rels = 0
let unknownKind = 0
let emptyName = 0
let memberNoOwner = 0
let errFiles = 0
let filesWithSymbols = 0
let importedEdges = 0
const t0 = performance.now()
for (const f of files) {
  const r: any = await parseFile(f, Z)
  const S: any[] = r.symbols ?? []
  const R: any[] = r.relationships ?? []
  if (S.length > 0) filesWithSymbols++
  syms += S.length
  rels += R.length
  if ((r.errors?.length ?? 0) > 0) errFiles++
  for (const s of S) {
    kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
    if (s.kind === "unknown" || !s.kind) unknownKind++
    if (!s.name || s.name === "unknown") emptyName++
    if ((s.kind === "property" || s.kind === "enum_member" || s.kind === "method") && !s.ownerName) memberNoOwner++
  }
  for (const e of R) {
    edges[e.type] = (edges[e.type] ?? 0) + 1
    if (e.type === "imports" || e.metadata?.isImport) importedEdges++
  }
}
const ms = performance.now() - t0
console.log(`parseFile over ${files.length} C files: ${(ms / 1000).toFixed(1)}s (${(ms / files.length).toFixed(1)}ms/file)`)
console.log(`symbols ${syms} | relationships ${rels} | files with symbols ${filesWithSymbols}/${files.length} | files reporting errors ${errFiles}`)
console.log(`unknown-kind symbols ${unknownKind} | empty/unknown names ${emptyName} | members without ownerName ${memberNoOwner}`)
console.log(`edge types:`, JSON.stringify(edges, null, 0))
console.log(`import-ish edges (type=imports or metadata.isImport): ${importedEdges}`)
console.log(`kinds:`, JSON.stringify(kinds, null, 0))
