// tmp-c-fixprobe.ts — F5 triage wave probes:
// A) loadext.c: ancestor chains of the trio def-name identifiers + analyzer symbols
//    + the sqlite3Autoext phantom region parse shape (raw children incl. anonymous)
// B) sqlite3-wasm.c: raw children of the #include node at L262
// C) jimsh0.c: which oracle/analyzer gates fire around sizeof(jim_wide) — context dump
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

const CORPUS = "$HOME/fixtures/repositories/sqlite"

const chain = (n: any): string => {
  const out: string[] = []
  let cur: any = n
  while (cur) { out.push(`${cur.type}@L${cur.startPosition.row + 1}`); cur = cur.parent }
  return out.join(" < ")
}

// ── A) loadext.c
{
  const F = path.join(CORPUS, "src/loadext.c")
  const src = fs.readFileSync(F, "utf8")
  const root = p.parse(src).rootNode
  const analyzer = new anaMod.RealCAnalyzer()
  const res = analyzer.analyze(root, src, F)
  console.log("═══ A) loadext.c")
  const trio = ["sqlite3_auto_extension", "sqlite3_cancel_auto_extension", "sqlite3_reset_auto_extension"]
  console.log("-- analyzer symbols for the trio:")
  for (const s of res.symbols ?? []) {
    if (trio.includes(s.name)) console.log("   ", s.name, "| kind:", s.kind, "| scope:", s.scope, "| L", s.range?.startLine)
  }
  console.log("-- identifier occurrences + ancestor chains (def sites):")
  const walk = (n: any): void => {
    if (n.type === "identifier" && trio.includes(n.text) && n.startPosition.row + 1 > 700) {
      console.log("   ", n.text, "L" + (n.startPosition.row + 1), "::", chain(n))
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
  console.log("-- raw tree 785-800 (sqlite3Autoext region, depth 4):")
  const dump = (n: any, d: number): void => {
    const L = n.startPosition.row + 1
    if (L < 783 || L > 802 || d > 5) return
    const isNamed = n.isNamed ? "" : " (anon)"
    console.log("   " + "  ".repeat(d) + n.type + isNamed + " L" + L + (n.childCount === 0 ? " :: " + JSON.stringify(n.text.slice(0, 40)) : ""))
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dump(c, d + 1) }
  }
  dump(root, 0)
  console.log("-- raw tree 806-816 (first def, depth 4):")
  const dump2 = (n: any, d: number): void => {
    const L = n.startPosition.row + 1
    if (L < 806 || L > 817 || d > 5) return
    const isNamed = n.isNamed ? "" : " (anon)"
    console.log("   " + "  ".repeat(d) + n.type + isNamed + " L" + L + (n.childCount === 0 ? " :: " + JSON.stringify(n.text.slice(0, 40)) : ""))
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) dump2(c, d + 1) }
  }
  dump2(root, 0)
}

// ── B) sqlite3-wasm.c
{
  const F = path.join(CORPUS, "ext/wasm/api/sqlite3-wasm.c")
  const src = fs.readFileSync(F, "utf8")
  const root = p.parse(src).rootNode
  console.log("═══ B) sqlite3-wasm.c include node at L262")
  const walk = (n: any): void => {
    if (n.type === "preproc_include" && n.startPosition.row + 1 >= 260 && n.startPosition.row + 1 <= 263) {
      console.log("   preproc_include @L" + (n.startPosition.row + 1), "namedChildren:", n.namedChildCount, "children:", n.childCount)
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) console.log("      child", i, c.type, c.isNamed ? "(named)" : "(anon)", JSON.stringify(c.text.slice(0, 50)), "field:", n.fieldNameForChild(i))
      }
      const pathField = n.childForFieldName("path")
      console.log("   path field:", pathField ? pathField.type + " " + JSON.stringify(pathField.text) : "(none)")
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}

// ── C) jimsh0.c sizeof site + oracle behavior around it
{
  const F = path.join(CORPUS, "autosetup/jimsh0.c")
  const src = fs.readFileSync(F, "utf8")
  const root = p.parse(src).rootNode
  console.log("═══ C) jimsh0.c sizeof(jim_wide) at ~L12183")
  const walk = (n: any): void => {
    if (n.type === "sizeof_expression" && n.startPosition.row + 1 >= 12180 && n.startPosition.row + 1 <= 12186) {
      console.log("   sizeof_expression L" + (n.startPosition.row + 1), "::", JSON.stringify(n.text))
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) console.log("      child", i, c.type, c.isNamed ? "(named)" : "(anon)", "::", JSON.stringify(c.text.slice(0, 40)))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
  }
  walk(root)
}
