// tmp-c-trio2.ts — F5 triage probe #2: the sqlite3Apis table-entry subset each
// side emits, plus every occurrence line of the anchor names. Crack the trio.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
const p = new ParserClass()
p.setLanguage(g)

const anaMod: any = await import("../src/ast/real-c-analyzer")
const diffMod: any = await import("./m14/differential")
const analyzer = new anaMod.RealCAnalyzer()

const F = "$HOME/fixtures/repositories/sqlite/src/loadext.c"
const src = fs.readFileSync(F, "utf8")
const root = p.parse(src).rootNode
const res = analyzer.analyze(root, src, F)
const rels = (res.relationships ?? []).map((r: any) => ({
  label: String(r.type ?? r.relationshipType ?? ""),
  target: String(r.target ?? ""),
  from: String(r.source ?? ""),
}))
const truth: any[] = diffMod.deriveCCalls(root, src)

// The sqlite3Apis table: identifiers directly under initializer_list between
// the table start and the load-extensions section end (lines 133..690).
const table = new Set<string>()
const tableLines: string[] = []
{
  const walk = (n: any): void => {
    const L = n.startPosition.row + 1
    if (n.type === "identifier" && n.parent?.type === "initializer_list" && L >= 133 && L <= 700) {
      table.add(n.text)
      tableLines.push(n.text + "@L" + L)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
console.log("table entries:", table.size)

const aUses = new Set(rels.filter((r: any) => r.label === "uses" && table.has(r.target)).map((r: any) => r.target))
const oUses = new Set(truth.filter((e: any) => e.label === "uses" && table.has(e.target)).map((e: any) => e.target))
console.log("analyzer table-uses:", aUses.size, "| oracle table-uses:", oUses.size)

const onlyA = [...aUses].filter(t => !oUses.has(t)).sort()
const onlyO = [...oUses].filter(t => !aUses.has(t)).sort()
console.log("ANALYZER-only (unexplained candidates):", onlyA.length)
for (const t of onlyA) console.log("   ", t)
console.log("ORACLE-only (missing candidates):", onlyO.length)
for (const t of onlyO.slice(0, 20)) console.log("   ", t)

const lines = src.split("\n")
const occ = (name: string): string => {
  const out: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp("\\b" + name + "\\b").test(lines[i])) out.push(i + 1)
  }
  return out.join(",")
}
console.log("── anchor occurrences (line numbers) / analyzer / oracle:")
for (const name of ["sqlite3_auto_extension", "sqlite3_cancel_auto_extension", "sqlite3_reset_auto_extension", "sqlite3_load_extension", "sqlite3_bind_blob64", "sqlite3_malloc64", "sqlite3_msize", "sqlite3_realloc64", "sqlite3_strglob", "sqlite3_vtab_config", "sqlite3_blob_open"]) {
  if (!table.has(name)) { console.log("  (not an entry?)", name, "lines:", occ(name)); continue }
  console.log("  ", name, "| lines:", occ(name), "| analyzer:", aUses.has(name) ? "Y" : "n", "| oracle:", oUses.has(name) ? "Y" : "n")
}
