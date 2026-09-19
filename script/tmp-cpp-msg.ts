// tmp-cpp-msg.ts — F5 triage: fmt test/std-test.cc `what uses -> msg` (1 unexplained).
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
const p = new ParserClass()
p.setLanguage(g)
const anaMod: any = await import("../src/ast/real-cpp-analyzer")
const diffMod: any = await import("./m14/differential")

const F = "$HOME/fixtures/repositories/fmt/test/std-test.cc"
const src = fs.readFileSync(F, "utf8")
const root = p.parse(src).rootNode
const analyzer = new anaMod.RealCppAnalyzer()
const res = analyzer.analyze(root, src, F)
const rels = (res.relationships ?? []).map((r: any) => ({
  label: String(r.type ?? r.relationshipType ?? ""),
  target: String(r.target ?? ""),
  from: String(r.source ?? ""),
  line: r.line_number ?? 0,
  meta: r.metadata ?? {},
}))
console.log("analyzer edges total:", rels.length)
console.log("-- analyzer edges with target 'msg' or from 'what':")
for (const r of rels) if (r.target === "msg" || r.from === "what") console.log("   ", JSON.stringify(r))

const truth: any[] = [...diffMod.deriveCppEdges(root), ...diffMod.deriveCppBareUses(root)]
console.log("oracle edges total:", truth.length)
console.log("-- oracle edges with target 'msg':")
for (const e of truth) if (e.target === "msg") console.log("   ", JSON.stringify(e))
console.log("-- oracle edges from near what() (any target 'msg'/'c_str'/'string'):")
for (const e of truth) if (["msg", "c_str"].includes(String(e.target))) console.log("   ", JSON.stringify(e))

console.log("-- analyzer symbols matching 'msg' or 'what':")
for (const s of res.symbols ?? []) if (/msg|what/.test(s.name)) console.log("   ", s.name, "| kind:", s.kind, "| scope:", s.scope, "| owner:", s.ownerName, "| L", s.range?.startLine)

console.log("-- parse shape L363-372 (walk, print overlapping):")
const walk = (n: any, d: number): void => {
  if (d > 9) return
  const L = n.startPosition.row + 1
  const E = n.endPosition.row + 1
  if (!(L > 372 || E < 363)) {
    console.log("   " + "  ".repeat(d) + n.type + (n.isNamed ? "" : " (anon)") + " L" + L + "-" + E + (n.childCount === 0 ? " :: " + JSON.stringify(n.text.slice(0, 50)) : ""))
  }
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c, d + 1) }
}
walk(root, 0)
