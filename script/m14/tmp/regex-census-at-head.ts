// script/m14/tmp/regex-census-at-head.ts — regenerate validation/m12/results/
// regex-census.json from COMMITTED HEAD BLOBS rather than from the working tree.
//
// Why this exists: the M49.R2 gate compares the committed census against
// `scanHeadAnalyzers()`, so an artifact generated from a shared dirty tree (the W6
// lesson: "git archive HEAD into a scratch tree, the census generator run THERE")
// would carry other lanes' uncommitted regexes and read as STALE the moment HEAD
// moved. `scanHeadAnalyzers` already does the scratch-tree work, so this writes the
// SAME document shape the generator writes (`script/m12/regex-census.ts`), from the
// same AST scan, on the only input the gate trusts.
import { writeFileSync } from "node:fs"
import { scanHeadAnalyzers, headAnalyzerFiles } from "../../m12/census-truth"

const OUT = "validation/m12/results/regex-census.json"

async function main() {
  const usages = await scanHeadAnalyzers()
  const perFileMap = new Map<string, typeof usages>()
  for (const u of usages) {
    if (!perFileMap.has(u.file)) perFileMap.set(u.file, [])
    perFileMap.get(u.file)!.push(u)
  }
  const rows = [...perFileMap.entries()]
    .map(([file, list]) => ({ file, count: list.length, usages: list }))
    .sort((a, b) => b.count - a.count)

  const byClassification: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  for (const u of usages) {
    byClassification[u.classification] = (byClassification[u.classification] ?? 0) + 1
    byCategory[u.receiverCategory] = (byCategory[u.receiverCategory] ?? 0) + 1
  }

  const document = {
    schemaVersion: 1,
    milestone: "M12",
    purpose: "ast_driven_regex_census_across_wired_analyzers",
    generatedAt: new Date().toISOString(),
    parser: "tree-sitter-typescript (project WASM pipeline)",
    methodology:
      "parse analyzer source with tree-sitter; walk for regex literal nodes and RegExp constructors; record location, operation, receiver category, and preliminary classification. REGENERATED FROM HEAD BLOBS (not the working tree) by script/m14/tmp/regex-census-at-head.ts, because M49.R2 compares this artifact against scanHeadAnalyzers(): a census carrying uncommitted regexes from another lane's dirty file would read as STALE.",
    totalRegexUsages: usages.length,
    analyzersScanned: headAnalyzerFiles().length,
    byClassification,
    byReceiverCategory: byCategory,
    perFile: rows,
  }
  writeFileSync(OUT, JSON.stringify(document, null, 2) + "\n")
  console.log(`HEAD-blob census: ${headAnalyzerFiles().length} analyzers, ${usages.length} regex usages`)
  console.log("byClassification:", JSON.stringify(byClassification))
  console.log("byReceiverCategory:", JSON.stringify(byCategory))
  console.log(`wrote ${OUT}`)
}

main()
