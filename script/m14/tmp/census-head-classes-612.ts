// Read-only companion to script/m12/regex-census.ts: it runs the SAME AST scan
// the census does, over the analyzers as they are on disk, and prints the rows
// with their classifications — so a caller can see what a re-derivation would
// write (and whether the review-class total moves) before writing it.
//
// Run: bun script/m14/tmp/census-head-classes-612.ts
import { scanAnalyzers, analyzerFiles } from "../../m12/regex-census-core"

const usages = await scanAnalyzers()
const byClass: Record<string, number> = {}
for (const u of usages) byClass[u.classification] = (byClass[u.classification] ?? 0) + 1
console.log(`analyzers: ${analyzerFiles().length} · usages: ${usages.length}`)
console.log("byClassification:", JSON.stringify(byClass))
console.log("REVIEW-CLASS TOTAL:", (byClass.needs_review ?? 0) + (byClass.replaceable ?? 0))
for (const u of usages.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.log(`${u.file}:${u.line} ${u.classification} ${u.operation} ${u.receiverCategory} ${JSON.stringify(u.source).slice(0, 60)}`)
}
