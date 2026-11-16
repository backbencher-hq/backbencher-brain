// script/m14/tmp/clean-export-surface.ts
//
// The export-surface question, measured on this lane's five corpora with the
// PINNED wasm and the production analyzer:
//
//   1. the M49 exports-family invariant (run-fixtures.ts) requires UNIQUE export
//      names per file — a duplicate cannot identify its provider;
//   2. every export name must resolve to a TOP-LEVEL symbol, where the
//      haskell-family rule counts MODULE-owned symbols as top-level (the module
//      is the namespace; `import M (f)` binds `f`);
//   3. a Clean module with no export keyword exports its module-level symbols,
//      so "0 exports" is the failure this lane started from (312/312 files
//      exported <= 1 thing before the fix).
//
// Mirrors the harness predicate exactly rather than paraphrasing it.
//
// Run: bun script/m14/tmp/clean-export-surface.ts [--samples N]
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealCleanAnalyzer } from "../../../src/ast/real-clean-analyzer"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories"
const REPOS = ["Clyde", "clean-stdlib", "Prelude", "cloogle.org", "eastwood"]
const SAMPLES = (() => {
  const i = process.argv.indexOf("--samples")
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : 10
})()

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(lang)

const files: string[] = []
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    if (e === ".git" || e === "node_modules") continue
    const p = path.join(d, e)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p)
    else if (e.endsWith(".icl") || e.endsWith(".dcl")) files.push(p)
  }
}
for (const r of REPOS) { try { walk(path.join(CORPUS, r)) } catch { /* absent */ } }

let total = 0, withExports = 0, zeroExportFiles = 0, exports = 0
let dupFiles = 0, dupNames = 0, unresolvable = 0, moduleOnly = 0
const dupSamples: string[] = []
const unresSamples: string[] = []
const zeroSamples: string[] = []

for (const f of files.sort()) {
  const src = readFileSync(f, "utf8")
  const res = new RealCleanAnalyzer().analyze(parser.parse(src).rootNode as any, src, f)
  const rel = path.relative(CORPUS, f)
  total++
  const syms = res.symbols as any[]
  const exps = (res.exports ?? []) as any[]
  exports += exps.length
  if (exps.length) withExports++
  else { zeroExportFiles++; if (zeroSamples.length < SAMPLES) zeroSamples.push(`  ${rel}`) }

  const names = exps.map((e) => e.name)
  const dups = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
  if (dups.length) {
    dupFiles++
    dupNames += dups.length
    if (dupSamples.length < SAMPLES) {
      dupSamples.push(`  ${rel}: ${dups.map((n) => `${n}[${exps.filter((e) => e.name === n).map((e) => e.kind).join("+")}]`).join(" ")}`)
    }
  }

  // Harness resolvability: ownerless, csharp-namespace-owned, or module-owned.
  const moduleNames = new Set(syms.filter((s) => s.kind === "module" || s.kind === "Module").map((s) => s.name))
  const topLevel = new Set(syms.filter((s) => !s.ownerName || moduleNames.has(s.ownerName)).map((s) => s.name))
  const bad = [...new Set(names)].filter((n) => !topLevel.has(n))
  if (bad.length) {
    unresolvable += bad.length
    if (unresSamples.length < SAMPLES) unresSamples.push(`  ${rel}: ${bad.join(", ")}`)
  }
  if (exps.length && exps.every((e) => moduleNames.has(e.name) || e.kind === "module")) moduleOnly++
}

console.log(`files=${total}`)
console.log(`exports=${exports}  files with >=1 export: ${withExports}  files with 0: ${zeroExportFiles}`)
console.log(`duplicate-name files: ${dupFiles} (${dupNames} distinct duplicated name(s))`)
console.log(`unresolvable export names: ${unresolvable}   files exporting only the module symbol: ${moduleOnly}`)
if (dupSamples.length) { console.log(`\nduplicate samples:`); for (const s of dupSamples) console.log(s) }
if (unresSamples.length) { console.log(`\nunresolvable samples:`); for (const s of unresSamples) console.log(s) }
if (zeroSamples.length) { console.log(`\nzero-export samples:`); for (const s of zeroSamples) console.log(s) }
