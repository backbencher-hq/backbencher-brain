// tmp-clj-adv-ab.ts — A/B: does the file-global comment flag fabricate edges? (real corpus file)
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-clojure.wasm")))
const p = new ParserClass(); p.setLanguage(g)
const anaMod: any = await import("../src/ast/real-clojure-analyzer")
const analyzer = new anaMod.RealClojureAnalyzer()

const F = process.argv[2]
const src = fs.readFileSync(F, "utf8")
const analysis = (s: string) => {
  const res = analyzer.analyze(p.parse(s).rootNode, s, F)
  return res.relationships.map((r: any) => `${r.source}|${r.type}|${r.target}|${r.line_number ?? "NULL"}`)
}
const asIs = analysis(src)
// neutralise EVERY non-head bare `comment` symbol (case leg + data vectors)
const anchors: Array<[string, string]> = [
  ["[clojure.core comment]", "[clojure.core comment-X]"],
  ["[cljs.core comment]", "[cljs.core comment-X]"],
  ["    comment\n    (let [cfg (:config-in-comment config)", "    comment-X\n    (let [cfg (:config-in-comment config)"],
]
let mutated = src
for (const [a, b] of anchors) {
  if (!mutated.includes(a)) { console.log("ANCHOR NOT FOUND: " + a); process.exit(1) }
  mutated = mutated.replace(a, b)
}
const mut = analysis(mutated)
const onlyAsIs = asIs.filter(e => !mut.includes(e))
const onlyMut = mut.filter(e => !asIs.includes(e))
console.log(`file: ${F}`)
console.log(`edges as-is: ${asIs.length}; edges with case-constant renamed: ${mut.length}`)
console.log(`edges ONLY in as-is (fabricated by the flag flip): ${onlyAsIs.length}`)
for (const e of onlyAsIs) console.log(`  + ${e}`)
console.log(`edges ONLY in mutated: ${onlyMut.length}`)
for (const e of onlyMut) console.log(`  - ${e}`)
// also: edges sourcing from the comment body line (4744 in original)
console.log(`edges at line 4744 (as-is): ${JSON.stringify(asIs.filter(e => e.endsWith("|4744")))}`)
