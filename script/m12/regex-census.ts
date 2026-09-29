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

/**
 * `--head` (2026-09-28, the zig lane's zero-regex paydown): scan the COMMITTED
 * analyzer blobs instead of the working tree, and record which of the two the
 * artifact describes.
 *
 * reviews/regex-policy.md's 2026-09-12 addendum already stated this rule ("the
 * artifact must describe a commit, so it is produced from that commit's blobs,
 * never from whatever the working tree happens to carry") and named a `--head`
 * mode as the way to do it — but the generator had no such mode, so the only
 * writer produced a working-tree artifact and the rule was prose. The scanner
 * already took a directory (`scanAnalyzers(dir)`) and `census-truth.ts` already
 * materialised the HEAD blobs into one, so this is the two lines that make the
 * documented mode real rather than a new mechanism.
 *
 * It matters in a shared working tree: a lane that removes a regex while other
 * lanes are mid-edit must not publish an artifact describing the whole working
 * tree, and a lane that ADDS one must not be able to hide it behind a dirty
 * census either.
 */
async function main() {
  const fromHead = process.argv.includes("--head")
  const usages = fromHead
    ? ((await import("./census-truth")).scanHeadAnalyzers() as Promise<typeof usages>)
    : await scanAnalyzers()
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
    // Which tree the artifact describes, recorded IN the artifact: a census
    // whose provenance is invisible is how a stale one read like a current one.
    describes: fromHead ? `HEAD blobs (git show HEAD:src/ast/...)` : "the working tree (a preview; run with --head to anchor it to a commit)",
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
