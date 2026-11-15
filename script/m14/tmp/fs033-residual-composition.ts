// FS033 — the residual grouped by what the SOURCE actually IS, not by a shape predicate.
//
// FS028 buckets a residual by a shape (`calls / source other`), and "other" is a bucket
// with 116 rows in it. A bucket that large is not a finding; it is an admission that the
// classifier ran out of names. This probe groups by the source NAME and by whether the
// target is a type the file declares, because the working hypothesis is that most of the
// 116 is ONE construct — a construction whose source happens to be `constructor` — and the
// only way to know is to count the names rather than to reason about them.
//
// The secondary row that matters: for each residual `calls` row, is there an analyzer
// `instantiates` row with the same target? If yes, the two implementations disagree about
// a LABEL on a fact both see, which is a contract question. If no, one of them is simply
// missing the fact, which is a bug. Those two cases look identical in a total and are
// completely different problems.
import * as fs from "fs"
import * as path from "path"
const ROOT = path.resolve(import.meta.dirname, "../../..")
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { deriveFsharpEdges } = await import(path.join(ROOT, "script/m14/fsharp-truth-oracle.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
if (!P.__init) {
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  ;(P as any).__init = true
}
const REPO = process.argv[2]!
const LIMIT = Number(process.argv[3] ?? 60)
const { RealFsharpAnalyzer } = await import(path.join(ROOT, "src/ast/real-fsharp-analyzer.ts"))
const az = new RealFsharpAnalyzer()

// Traversal order, NOT sorted. fs028 — the probe whose totals this file exists to explain —
// fills its sample in `readdirSync` order with no sort, and sorting here made the two probes
// describe DIFFERENT 120-file samples of the same repository. Two probes disagreeing about
// the same corpus is either a bug in one of them or a different question; it was a different
// question, and it cost a full round of chasing a class that was already fixed in the files
// I happened to look at.
function walk(dir: string, acc: string[] = [], cap = Number.MAX_SAFE_INTEGER): string[] {
  if (acc.length >= cap) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (acc.length >= cap) return acc
    if (e.name === ".git" || e.name === "node_modules" || e.name === "bin" || e.name === "obj") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc, cap)
    else if (/\.(fs|fsi|fsx)$/.test(e.name)) acc.push(p)
  }
  return acc
}
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))

// MISSING calls rows: grouped by source name, and split by "is there an instantiates row
// for the same target in the same file" — the label-disagreement test.
const bySource = new Map<string, number>()
const labelDisagree = new Map<string, number>()
const trueMissing = new Map<string, number>()
const examples = new Map<string, string>()
let callsMissing = 0
let files = 0
for (const f of walk(REPO, [], LIMIT)) {
  const src = fs.readFileSync(f, "utf8")
  let r: any
  try { r = await az.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
  files++
  const truth = deriveFsharpEdges(parser.parse(src).rootNode, r.symbols ?? [])
  const rels = (r.relationships ?? []).map((x: any) => `${x.type}|${x.source}|${x.target}`)
  const relSet = new Set(rels)
  for (const e of truth) {
    if (e.label !== "calls") continue
    if (relSet.has(`calls|${e.from}|${e.to}`)) continue
    callsMissing++
    bySource.set(e.from, (bySource.get(e.from) ?? 0) + 1)
    if (!examples.has(e.from)) examples.set(e.from, `${path.basename(f)}:${e.line}`)
    if (relSet.has(`instantiates|${e.from}|${e.to}`)) {
      labelDisagree.set(e.from, (labelDisagree.get(e.from) ?? 0) + 1)
    } else {
      trueMissing.set(e.from, (trueMissing.get(e.from) ?? 0) + 1)
    }
  }
}
console.log(`files: ${files}   MISSING calls rows: ${callsMissing}\n`)
console.log("by SOURCE name:")
for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  const d = labelDisagree.get(k) ?? 0
  const t = trueMissing.get(k) ?? 0
  console.log(`  ${String(v).padStart(5)}  ${k.slice(0, 42).padEnd(42)}  label-disagree=${String(d).padStart(4)}  truly-absent=${String(t).padStart(4)}   ${examples.get(k)}`)
}
const dTot = [...labelDisagree.values()].reduce((a, b) => a + b, 0)
const tTot = [...trueMissing.values()].reduce((a, b) => a + b, 0)
console.log(`\nTOTAL  label-disagreement (a contract question): ${dTot}   truly absent (a bug): ${tTot}`)

// ---- the open-path `references` class, grouped by SOURCE ----
//
// 128 rows, the largest UNEXPLAINED class. `FscMain.fs` agrees 12/12 after the file-scope
// fallback, so whatever is left is not that rule — it is a different set of files. The
// question is whether the disagreement is always about the SOURCE (which scope owns the
// `open`) or sometimes about the TARGET, and those are different bugs.
const openBySource = new Map<string, number>()
const openByShape = new Map<string, number>()
const openEx = new Map<string, string>()
let openUnexplained = 0
for (const f of walk(REPO, [], LIMIT)) {
  const src = fs.readFileSync(f, "utf8")
  let r: any
  try { r = await az.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
  const truth = deriveFsharpEdges(parser.parse(src).rootNode, r.symbols ?? [])
  const tset = new Set(truth.map((e: any) => `${e.label}|${e.from}|${e.to}`))
  for (const x of (r.relationships ?? [])) {
    if (x.type !== "references" || x.metadata?.declaredOn) continue
    if (tset.has(`references|${x.source}|${x.target}`)) continue
    openUnexplained++
    const byShape = tset.has(`references|Global|${x.target}`) ? "truth says Global"
      : [...tset].some((k) => k.endsWith(`|${x.target}`)) ? "truth has the target, different source" : "truth has no such target"
    openByShape.set(byShape, (openByShape.get(byShape) ?? 0) + 1)
    openBySource.set(x.source, (openBySource.get(x.source) ?? 0) + 1)
    if (!openEx.has(byShape)) openEx.set(byShape, `${path.basename(f)}  ${x.source} -> ${x.target}`)
  }
}
console.log(`\n---- UNEXPLAINED open-path references: ${openUnexplained} ----`)
for (const [k, v] of [...openByShape].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}\n         eg ${openEx.get(k)}`)
console.log("\n  by source:")
for (const [k, v] of [...openBySource].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(v).padStart(5)}  ${k.slice(0, 60)}`)
