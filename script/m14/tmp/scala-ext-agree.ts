// Do the analyzer and the oracle publish the SAME extension-method identity?
//
// The invariant has TWO parts, and conflating them is what made an earlier
// version of this probe report a false disagreement:
//
//  1. A decorated extension method WITH an owner emits a `contains` edge, so the
//     oracle must publish the same decorated target. Oracle-only must be empty.
//  2. A TOP-LEVEL decorated extension method has no owner, so it emits NO
//     `contains` edge and the oracle correctly publishes no target for it. Its
//     invariant is the opposite: the analyzer must not leak a `contains` edge
//     naming it.
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
let bad = 0
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, "utf8")
  const res: any = new RealScalaAnalyzer().analyze(p.parse(src).rootNode, src, f)
  const owned = new Set<string>(), ownerless = new Set<string>()
  for (const s of res.symbols ?? []) {
    if (!s.metadata?.isExtension || !s.name.includes("@")) continue
    if (s.ownerName) owned.add(s.name); else ownerless.add(s.name)
  }
  const truth = new Set<string>()
  for (const e of deriveScalaContainsTruth(p.parse(src).rootNode)) if (e.target.includes("@")) truth.add(e.target)
  const oracleOnly = [...truth].filter((x) => !owned.has(x))
  // The REVERSE direction is the one that produces a false MISSING: a decorated
  // analyzer symbol whose target the oracle left bare. Checking only
  // `truth ⊆ owned` reported AGREE on PPrint.scala while the two sides published
  // 3 and 2 names.
  const analyzerOnly = [...owned].filter((x) => !truth.has(x))
  const containsTargets = new Set<string>((res.relationships ?? []).filter((r: any) => r.type === "contains").map((r: any) => String(r.target)))
  const leaked = [...ownerless].filter((x) => containsTargets.has(x))
  const ok = oracleOnly.length === 0 && analyzerOnly.length === 0 && leaked.length === 0
  if (!ok) bad++
  console.log(`${ok ? "AGREE" : "DISAGREE"}  ${path.basename(f)}  owned=${owned.size} topLevel=${ownerless.size} oracleDecorated=${truth.size}`)
  if (oracleOnly.length) console.log(`   oracle-only: ${oracleOnly.join(", ")}`)
  if (analyzerOnly.length) console.log(`   analyzer-only (FALSE MISSING: analyzer decorates, oracle left it bare): ${analyzerOnly.join(", ")}`)
  if (leaked.length) console.log(`   top-level leaked a contains edge: ${leaked.join(", ")}`)
}
process.exit(bad ? 1 : 0)
