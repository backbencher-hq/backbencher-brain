// tmp-c-5edges.ts — F5 triage probe: dump BOTH sides of the 5 unexplained
// sqlite edges (loadext table trio, wasm macro-include, jimsh0 sizeof).
// Analyzer: RealCAnalyzer.analyze on the single file; Oracle: deriveCCalls.
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

const CORPUS = "$HOME/fixtures/repositories/sqlite"
const FILES = ["src/loadext.c", "ext/wasm/api/sqlite3-wasm.c", "autosetup/jimsh0.c"]

const walkPrint = (root: any, lo: number, hi: number, cap = 60): void => {
  const walk = (n: any): void => {
    const L = n.startPosition.row + 1
    if (L >= lo && L <= hi && n.type !== "comment") {
      console.log("    L" + L, "|", n.type, "|", JSON.stringify(n.text.slice(0, 70)), "| parent:", n.parent?.type)
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  if (cap > 0) walk(root)
}

for (const rel of FILES) {
  const F = path.join(CORPUS, rel)
  const src = fs.readFileSync(F, "utf8")
  const root = p.parse(src).rootNode
  let res: any
  try {
    res = analyzer.analyze(root, src, F)
  } catch (e) {
    console.log("══", rel, "ANALYZE THREW:", e)
    continue
  }
  const rels = (res.relationships ?? []).map((r: any) => ({
    label: String(r.type ?? r.relationshipType ?? ""),
    target: String(r.target ?? ""),
    from: String(r.source ?? ""),
    line: r.line_number ?? 0,
  }))
  const truth: any[] = diffMod.deriveCCalls(root, src)
  console.log("════════════════", rel, "| analyzer edges:", rels.length, "| oracle edges:", truth.length)

  if (rel.endsWith("loadext.c")) {
    const names = ["sqlite3_auto_extension", "sqlite3_cancel_auto_extension", "sqlite3_reset_auto_extension", "sqlite3_load_extension"]
    console.log("  ANALYZER edges to table fns:")
    for (const r of rels) if (names.includes(r.target)) console.log("    ", r.label, "| from:", r.from, "| t:", r.target, "| L", r.line)
    console.log("  ORACLE edges to table fns:")
    for (const e of truth) if (names.includes(e.target)) console.log("    ", e.label, "| t:", e.target)
    console.log("  ANALYZER uses-edges from global (first 50):")
    let n = 0
    for (const r of rels) if (r.label === "uses" && (r.from === "global" || r.from === "")) { console.log("    L" + r.line, "->", r.target); if (++n >= 50) break }
    console.log("  ORACLE uses-edges (first 50):")
    n = 0
    for (const e of truth) if (e.label === "uses") { console.log("    ->", e.target); if (++n >= 50) break }
    console.log("  parse shapes L395-410:")
    walkPrint(root, 395, 410)
  }

  if (rel.includes("sqlite3-wasm")) {
    console.log("  ANALYZER references edges (all):")
    for (const r of rels) if (r.label === "references") console.log("    L" + r.line, "| from:", r.from, "| t:", JSON.stringify(r.target))
    console.log("  ORACLE references edges (first 40):")
    let n = 0
    for (const e of truth) if (e.label === "references") { console.log("    ->", JSON.stringify(e.target)); if (++n >= 40) break }
    console.log("  parse shapes L258-266:")
    walkPrint(root, 258, 266)
  }

  if (rel.includes("jimsh0")) {
    console.log("  ANALYZER edges target=jim_wide:")
    for (const r of rels) if (r.target === "jim_wide") console.log("    ", r.label, "| from:", r.from, "| L", r.line)
    console.log("  ORACLE edges target=jim_wide:")
    for (const e of truth) if (e.target === "jim_wide") console.log("    ", e.label)
    console.log("  ANALYZER edges near L12178-12188:")
    for (const r of rels) if (r.line >= 12178 && r.line <= 12188) console.log("    ", r.label, "| from:", r.from, "| t:", JSON.stringify(r.target), "| L", r.line)
    console.log("  parse shapes L12180-12186:")
    walkPrint(root, 12180, 12186)
  }
}
