// M12 regex census — AST-driven (tree-sitter) enumeration of every regex
// literal and RegExp usage across all wired analyzers. This is deliberately
// NOT a text-grep: it parses each analyzer's own source with the project's
// tree-sitter TypeScript parser and walks the syntax tree for:
//   - regex literal nodes (`/.../`)
//   - `RegExp(...)` / `new RegExp(...)` constructor calls
// For each usage it records the precise location, the regex source, the
// operation (match/replace/test/split/search/exec/constructor/other), and the
// receiver expression category (raw file content, node .text, identifier,
// string literal, ...) so per-analyzer issues can adjudicate replaceability.
//
// The scan logic lives in regex-census-core.ts and is shared with
// verify-regex-census.ts so the regression gate re-runs the same AST scan.
//
// Run: bun script/m12/regex-census.ts
// Writes: validation/m12/results/regex-census.json
import { writeFileSync } from "node:fs"
import { scanAnalyzers, analyzerFiles } from "./regex-census-core"

const OUT = "validation/m12/results/regex-census.json"

async function main() {
  const usages = await scanAnalyzers()
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
    methodology: "parse analyzer source with tree-sitter; walk for regex literal nodes and RegExp constructors; record location, operation, receiver category, and preliminary classification",
    totalRegexUsages: usages.length,
    analyzersScanned: analyzerFiles().length,
    byClassification,
    byReceiverCategory: byCategory,
    perFile: rows,
  }
  writeFileSync(OUT, JSON.stringify(document, null, 2) + "\n")
  console.log(`scanned ${analyzerFiles().length} analyzers, found ${usages.length} regex usages`)
  console.log("byClassification:", JSON.stringify(byClassification))
  console.log("byReceiverCategory:", JSON.stringify(byCategory))
  console.log(`wrote ${OUT}`)
  process.exit(0)
}

main().catch((e) => {
  console.error("census failed:", e)
  process.exit(1)
})
