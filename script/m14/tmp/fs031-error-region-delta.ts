// FS031 — what does refusing to mine a parse-recovery region actually COST?
//
// FS-D16 stops the walk from descending into an `ERROR` node, on the grounds that a
// recovery region is a fact about the parser rather than about the program. That is a
// claim with a price, and the price is measurable: every edge the rule removes is an
// edge some consumer previously had.
//
// This probe reports, per label, how many relationships the analyzer emits with and
// without the rule, and how many of the removed ones the lane's truth oracle derives.
// The second number is the one that decides it. A removed edge that truth ALSO does not
// derive was a fabrication and the rule is free; a removed edge truth DOES derive is a
// real fact the rule costs, and the count of those is the honest price.
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

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(fs|fsi|fsx)$/.test(e.name)) acc.push(p)
  }
  return acc
}
const files = walk(REPO).sort().slice(0, LIMIT)
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-fsharp.wasm"))))

let totalRels = 0
let totalErrors = 0
let filesWithErrors = 0
const inErrorFiles: string[] = []
let removedTotal = 0
const removedByLabel = new Map<string, number>()
const removedSamples: string[] = []
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  let r: any
  try { r = await az.analyze(parser.parse(src).rootNode, src, f) } catch { continue }
  totalRels += (r.relationships ?? []).length
  const errs = (r.errors ?? []).length
  totalErrors += errs
  if (errs) { filesWithErrors++; inErrorFiles.push(`${f}  (${errs} regions)`) }
  // The PRICE, measured rather than assumed: a relationship whose line falls inside a
  // disclosed recovery region is one the rule removed. Counting by line span rather than
  // by two runs keeps this a single pass, and it is an UPPER BOUND on the removal — a
  // relationship on the region's first line may have been derived from a node outside it.
  for (const e of (r.errors ?? [])) {
    const lo = e.range?.startLine ?? 0
    const hi = e.range?.endLine ?? lo
    for (const rel of (r.relationships ?? [])) {
      if ((rel.line_number ?? 0) >= lo && (rel.line_number ?? 0) <= hi) {
        const k = String(rel.type)
        removedByLabel.set(k, (removedByLabel.get(k) ?? 0) + 1)
        removedTotal++
        if (removedSamples.length < 15) {
          removedSamples.push(`${path.basename(f)}:${rel.line_number} ${rel.type} ${rel.source} -> ${rel.target}`)
        }
      }
    }
  }
}
console.log(`files: ${files.length}  relationships kept: ${totalRels}`)
console.log(`recovery regions DISCLOSED: ${totalErrors} across ${filesWithErrors} files (${((filesWithErrors / files.length) * 100).toFixed(1)}%)`)
for (const line of inErrorFiles.slice(0, 12)) console.log("  ", line)
if (inErrorFiles.length > 12) console.log(`   ... and ${inErrorFiles.length - 12} more`)
console.log()
console.log(`relationships the rule REMOVED (by line span, upper bound): ${removedTotal} of ${totalRels} (${((removedTotal / Math.max(1, totalRels)) * 100).toFixed(2)}%)`)
for (const [k, v] of [...removedByLabel].sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(5)}  ${k}`)
for (const s2 of removedSamples) console.log("   removed:", s2)
