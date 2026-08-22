// script/m13/verify-search-honesty.ts — M13.21 (S4).
//
// Honesty audit for bb_search. Documents exactly what each mode searches and
// proves the freshness truthfulness claims:
//
//   symbols mode → BrainTools.searchCode → searchSymbols: SQL over
//     brain_symbol JOIN brain_file (the indexed corpus). No raw filesystem scan.
//   content mode → searchContent: FTS5/LIKE over the indexed symbol corpus
//     (name + qualified_name + docstring) — documented as NOT full-text file
//     contents.
//   symbol mode → ASTEngine.findSymbol: indexed AST records.
//   file mode → requires an existing brain_file row; throws "file is not
//     indexed" otherwise.
//
// Freshness is computed by checkResultsFreshness in every search engine:
// the stored SHA-256 file_hash is compared against on-disk content; results
// from changed files are flagged stale, never presented as fresh.
//
// Runtime proof (negative): a symbol whose brain_file row is deleted must no
// longer be returned by any mode — no result may claim source that is not
// indexed.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { BrainTools } from "../../src/ast/tools"
import { searchContent } from "../../src/intelligence/search/content-search"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.21",
  code: "S4",
  tool: "bb_search",
  title: "bb_search: honesty audit (AST vs lexical; freshness truthfulness)",
  layers: ["unit", "integration"],
  decisions: {
    symbolsMode: "searchSymbols runs SQL over brain_symbol JOIN brain_file — the indexed corpus, never a raw filesystem or git scan",
    contentMode: "searchContent runs FTS5/LIKE over the indexed symbol corpus (name+qualified_name+docstring); the source header documents that this is NOT full-text file contents",
    symbolMode: "findSymbol reads indexed AST records from the brain database",
    fileMode: "requires a brain_file row; throws 'file is not indexed' when the row is absent — disk content is only read for indexed paths",
    freshness: "every search engine calls checkResultsFreshness, which compares the stored SHA-256 file_hash against on-disk bytes; changed files are flagged stale, never fresh",
  },
  limitations: [
    "The audit proves the index-backed claim statically (query shape) and dynamically (row-deletion probe); it does not re-verify analyzer symbol extraction (that is the M12 analyzer work).",
  ],
})

const ROOT = path.resolve(import.meta.dir, "..", "..")

// ── 1. Static audit: what each mode searches ───────────────────────────────
const symbolSearch = readSource("src/intelligence/search/symbol-search.ts")
const contentSearch = readSource("src/intelligence/search/content-search.ts")
const regexSearch = readSource("src/intelligence/search/regex-search.ts")
const freshnessSrc = readSource("src/brain/freshness.ts")
const handlers = readSource("src/mcp/tool-handlers.ts")

function readSource(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

harness.check(
  "symbols mode: searchSymbols queries brain_symbol JOIN brain_file (indexed corpus)",
  symbolSearch.includes("FROM brain_symbol") && symbolSearch.includes("JOIN brain_file"),
  "query does not join brain_file",
)
harness.check(
  "symbols mode: no raw source-file reads in the search path",
  !symbolSearch.includes("readFileSync"),
  "readFileSync present",
)
harness.check(
  "content mode: searches the indexed symbol corpus (name+qualified_name+docstring)",
  contentSearch.includes("FROM brain_symbol") && contentSearch.includes("docstring"),
  "not index-backed",
)
harness.check(
  "content mode: documented as not full-text file contents (no false claim)",
  contentSearch.includes("not full-text file contents"),
  "missing doc header",
)
harness.check(
  "content mode: no raw source-file reads",
  !contentSearch.includes("readFileSync"),
  "readFileSync present",
)
harness.check(
  "symbol mode: handler delegates to ASTEngine.findSymbol (indexed records)",
  handlers.includes("ASTEngine.findSymbol"),
  "findSymbol not used",
)
harness.check(
  "file mode: guard requires a brain_file row before reading disk",
  handlers.includes("file is not indexed") && handlers.includes("SELECT id, language, file_hash FROM brain_file"),
  "guard missing",
)
harness.check(
  "freshness: every search engine routes through checkResultsFreshness",
  symbolSearch.includes("checkResultsFreshness") && contentSearch.includes("checkResultsFreshness") && regexSearch.includes("checkResultsFreshness"),
  "an engine skips freshness",
)
harness.check(
  "freshness: checkResultsFreshness compares stored file_hash against disk",
  freshnessSrc.includes("file_hash") && freshnessSrc.includes("fileUnchangedSince") && freshnessSrc.includes("sha256"),
  "no hash comparison",
)
harness.check(
  "freshness: no 'always fresh' shortcut exists",
  !freshnessSrc.includes("stale = false") && !freshnessSrc.includes("fresh: true"),
  "hardcoded fresh present",
)
harness.check(
  "freshness: stale results are flagged, never silently dropped or presented fresh",
  symbolSearch.includes('result.stale = true'),
  "no stale flagging",
)

// ── 2. Runtime proof: results never claim source that is not indexed ──────
const root = mkdtempSync(path.join(tmpdir(), "bb-search-honesty-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "a.ts"), "export function indexedA(): number { return 1 }\n")
writeFileSync(path.join(root, "src", "b.ts"), "export function indexedB(): number { return 2 }\n")
await indexProjectParallel(projectId, root, {})

const raw = await BrainDatabase.getRawInstance(projectId)
const bFile = raw.prepare("SELECT id, path FROM brain_file WHERE path LIKE '%b.ts'").get() as { id: string; path: string } | undefined

{
  // Before deletion: every result's fileId resolves to an indexed brain_file row.
  const syms = await BrainTools.searchCode(projectId, "indexed", { maxResults: 50 })
  const allIndexed = syms.every((r: any) => raw.prepare("SELECT 1 FROM brain_file WHERE id = ?").get(r.fileId))
  harness.check("runtime: symbols-mode results all resolve to indexed brain_file rows", allIndexed, `results=${syms.length}`)
  const content = await searchContent(projectId, "indexed", { maxResults: 50 })
  const contentIndexed = content.every((r: any) => raw.prepare("SELECT 1 FROM brain_file WHERE id = ?").get(r.fileId))
  harness.check("runtime: content-mode results all resolve to indexed brain_file rows", contentIndexed, `results=${content.length}`)
}

// Negative: after deleting b.ts's brain_file row, no mode may return its
// symbols — a result that claims source that is not indexed is a lie.
if (bFile) {
  raw.prepare("DELETE FROM brain_file WHERE id = ?").run(bFile.id)
  const after = await BrainTools.searchCode(projectId, "indexedB", { maxResults: 20 })
  harness.negative(
    "runtime: symbol with no brain_file row is never returned (no unindexed claims)",
    !after.some((r: any) => JSON.stringify(r).includes("indexedB")),
    `returned ${after.length} results`,
  )
  const afterContent = await searchContent(projectId, "indexedB", { maxResults: 20 })
  harness.negative(
    "runtime: content mode never returns results for an unindexed file",
    !afterContent.some((r: any) => JSON.stringify(r).includes("indexedB")),
    `returned ${afterContent.length} results`,
  )
} else {
  harness.check("runtime: fixture b.ts indexed", false, "no brain_file row for b.ts")
}

// Negative: file mode refuses a path with no brain_file row (real handler).
{
  const { createToolHandlers } = await import("../../src/mcp/tool-handlers")
  const publicSearch = createToolHandlers().bb_search
  try {
    await publicSearch({ mode: "file", filePath: "src/b.ts" }, { projectId, projectPath: root })
    harness.negative("runtime: file mode refuses unindexed path", false, "did not throw")
  } catch (e: any) {
    harness.negative("runtime: file mode refuses unindexed path", String(e).includes("file is not indexed"), String(e).slice(0, 120))
  }
}

rmSync(root, { recursive: true, force: true })
harness.emit()
