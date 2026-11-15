// Do the analyzer and the oracle number anonymous classes the SAME way?
//
// SDJ-8 put a per-file counter on the analyzer (`anonymous_X`, `anonymous_X#2`,
// ...) because the bare name is unique only within its supertype. The oracle was
// left emitting the bare name, which reported every disambiguated class as
// UNEXPLAINED fabrication. Both ends now carry the counter, and this checks they
// AGREE — the numbering only matches if the two traversals visit the anonymous
// classes in the same order, which is exactly the assumption worth testing.
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"
import { deriveScalaContainsTruth } from "../differential"
const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
const p = new P(); p.setLanguage(gl)
let bad = 0, files = 0, collisions = 0
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, "utf8")
  const res: any = new RealScalaAnalyzer().analyze(p.parse(src).rootNode, src, f)
  const aNames = new Set<string>()
  for (const s of res.symbols ?? []) if (String(s.name).startsWith("anonymous")) aNames.add(s.name)
  const tNames = new Set<string>()
  for (const e of deriveScalaContainsTruth(p.parse(src).rootNode)) if (e.target.startsWith("anonymous")) tNames.add(e.target)
  if (aNames.size === 0) continue
  files++
  const numbered = [...aNames].filter((x) => x.includes("#")).length
  collisions += numbered
  const onlyA = [...aNames].filter((x) => !tNames.has(x))
  const onlyT = [...tNames].filter((x) => !aNames.has(x))
  if (onlyA.length || onlyT.length) {
    bad++
    console.log(`DISAGREE ${path.basename(f)}  analyzer=${aNames.size} oracle=${tNames.size}`)
    if (onlyA.length) console.log(`   analyzer-only: ${onlyA.join(", ")}`)
    if (onlyT.length) console.log(`   oracle-only:   ${onlyT.join(", ")}`)
  }
}
console.log(`\nfiles with anonymous classes: ${files}   disambiguated names seen: ${collisions}   disagreements: ${bad}`)
process.exit(bad ? 1 : 0)
