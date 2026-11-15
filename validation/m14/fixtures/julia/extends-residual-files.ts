/**
 * TARGETED RE-MEASURE of the `extends` residual, over EXACTLY the nine files the whole-population
 * `direct-oracle-check.ts --files 100000` run reported as carrying the label's 25 unexplained and 8
 * missing rows (commit-time log /tmp/julia-direct-whole.log, 2026-10-28). Analyzer side is the
 * PRODUCTION entry point (`parseFile`), truth side the lane's independent oracle, same key
 * (`from`, `target`) and same file set as that run — this answers "did the chain fix close THOSE
 * rows, and did it invent any" without paying the whole-population cost per iteration.
 *
 * READ-ONLY. Writes nothing.
 *
 *   npx tsx validation/m14/fixtures/julia/extends-residual-files.ts
 */
/** Targeted re-measure of the `extends` residual over exactly the files the whole-population run
 *  reported, analyzer (prod parseFile) vs the lane's independent oracle. Read-only. */
import { readFileSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { deriveJuliaExtendsTruth } from "../../../../script/m14/oracles/julia-type-edges"
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))
const FILES = [
  "Graphs.jl/src/linalg/spectral.jl",
  "julia/Compiler/test/newinterp.jl",
  "julia/JuliaLowering/test/closures.jl",
  "julia/JuliaLowering/test/typedefs_ir.jl",
  "julia/stdlib/Dates/src/types.jl",
  "julia/base/broadcast.jl",
  "julia/test/core.jl",
  "julia/test/specificity.jl",
  "julia/test/subtype.jl",
]
let tAll = 0, aAll = 0, unAll = 0, miAll = 0
for (const label of FILES) {
  const abs = path.join(CR, label)
  const parts = label.split("/")
  const dir = path.join(CR, parts[0]!)
  const text = readFileSync(abs, "utf8")
  const tree = parser.parse(text)
  const T = new Set<string>()
  for (const e of deriveJuliaExtendsTruth(tree.rootNode)) T.add(`${e.from}\u0001${e.target}`)
  tree.delete?.()
  const r: any = await parseFile(abs, dir)
  const A = new Set<string>()
  for (const x of (r?.relationships ?? []) as any[]) {
    if (String(x.type ?? "").toLowerCase() !== "extends") continue
    A.add(`${String(x.source ?? "")}\u0001${String(x.target ?? "")}`)
  }
  const un = [...A].filter((k) => !T.has(k))
  const mi = [...T].filter((k) => !A.has(k))
  tAll += T.size; aAll += A.size; unAll += un.length; miAll += mi.length
  console.log(`${label}  truth ${T.size}  analyzer ${A.size}  unexplained ${un.length}  missing ${mi.length}`)
  for (const k of un) console.log(`   UNEXPLAINED ${k.split("\u0001").join(" -> ")}`)
  for (const k of mi) console.log(`   MISSING     ${k.split("\u0001").join(" -> ")}`)
}
console.log(`TOTAL truth ${tAll} analyzer ${aAll} unexplained ${unAll} missing ${miAll}`)
