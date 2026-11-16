// Two-sided `overrides` agreement: analyzer vs oracle, per file.
//
// Built after a lesson. The previous version of this probe reported "the oracle
// emits 0 overrides" for every file, and that was an ARTIFACT: its parser had
// failed to load the language ("Incompatible language version 0"), so it ran the
// oracle over an EMPTY tree and faithfully reported nothing. A measurement
// instrument that cannot report its own brokenness will be believed.
//
// So this asserts its own validity FIRST and refuses to report if any check
// fails: the grammar loaded, the tree is non-trivial, and the oracle returns a
// plausible number of edges for a control file. Only then does it compare.
import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
if (!gl) { console.error("PROBE INVALID: grammar did not load"); process.exit(2) }
const mk = (): any => { const p = new P(); p.setLanguage(gl); return p }
const parser = mk()

// Control: a file whose override truth we already know the analyzer finds.
// SourcePosition.scala is known to carry override truth: the analyzer resolves
// NoSourcePosition.line -> SourcePosition.line at confidence 1.0 there.
const CONTROL = "<corpus-root>/bb_tests/repositories/scala3/compiler/src/dotty/tools/dotc/util/SourcePosition.scala"
const controlSrc = fs.readFileSync(CONTROL, "utf8")
const controlRoot = parser.parse(controlSrc).rootNode
if (!controlRoot || controlRoot.namedChildCount === 0 || !controlRoot.text.includes("trait SrcPos")) {
  console.error(`PROBE INVALID: control tree is degenerate (children=${controlRoot?.namedChildCount})`)
  process.exit(2)
}
// Imported only after the parser is proven good, and proven non-degenerate here.
const { deriveTreeEdges } = await import("../differential")
const controlEdges = deriveTreeEdges(controlRoot, "scala")
const controlOvr = Array.isArray(controlEdges) ? controlEdges.filter((e: any) => e.label === "overrides") : []
if (!Array.isArray(controlEdges) || controlOvr.length < 1) {
  console.error(`PROBE INVALID: oracle returned ${Array.isArray(controlEdges) ? controlEdges.length : "non-array"} edges for the control file`)
  process.exit(2)
}
console.log(`probe valid: control tree ${controlRoot.namedChildCount} children, oracle ${controlEdges.length} edges (${controlOvr.length} overrides)\n`)

let bad = 0
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, "utf8")
  const res: any = new RealScalaAnalyzer().analyze(parser.parse(src).rootNode, src, f)
  const a = new Set<string>()
  for (const r of res.relationships ?? []) if (String(r.type) === "overrides") a.add(`${r.source} -> ${r.target}`)
  const t = new Set<string>()
  for (const e of deriveTreeEdges(parser.parse(src).rootNode, "scala")) {
    if (e.label === "overrides") t.add(`${e.from} -> ${e.target}`)
  }
  const onlyA = [...a].filter((x) => !t.has(x))
  const onlyT = [...t].filter((x) => !a.has(x))
  const verdict = onlyA.length === 0 && onlyT.length === 0 ? "AGREE" : "DISAGREE"
  if (verdict === "DISAGREE") bad++
  console.log(`${verdict}  ${path.basename(f)}  analyzer=${a.size} oracle=${t.size}`)
  for (const x of onlyA) console.log(`   analyzer-only: ${x}`)
  for (const x of onlyT) console.log(`   oracle-only:   ${x}`)
}
process.exit(bad ? 1 : 0)
