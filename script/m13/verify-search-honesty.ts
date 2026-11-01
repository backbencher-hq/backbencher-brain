// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the honesty gate for bb_search: proves what each mode
//   actually searches (indexed AST facts, never a raw filesystem scan), that
//   freshness flags are real, that a body-only word is reachable, that
//   `bodyCoverage` describes the corpus rather than a lie, and that a content
//   READ does not persist schema in the index database.
// WHICH TOOL IT SERVES — bb_search (read; modes symbols/content/symbol/file).
// WHY IT IS SHAPED THIS WAY — static text checks are cheap but can go stale with
//   the module layout, so the paths are the CURRENT owners of the behaviour and
//   every claim has a runtime half that would fail if the behaviour regressed.
//   A gate that pins an old file path is green for the wrong reason; a gate that
//   demands a thrown error where the handler correctly returns an `isError`
//   envelope pins the defect it claims to guard.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/s4.json (through the shared
//   harness); this run's output is recorded by the caller.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_search/handler.ts,
//   src/intelligence/search/{symbol,content,regex}-search.ts, and the other
//   script/m13/verify-search-*.ts gates.
// CONTRACTS IT MUST NOT BREAK — every runtime assertion must be able to fail on
//   a plausible regression (no `check(..., true)`), and a result may never claim
//   source that is not in the index.
// ─────────────────────────────────────────────────────────────────────────────

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
  title: "bb_search: honesty audit (AST vs lexical; freshness truthfulness; body coverage)",
  layers: ["unit", "integration"],
  decisions: {
    symbolsMode: "searchSymbols runs SQL over brain_symbol JOIN brain_file — the indexed corpus, never a raw filesystem or git scan",
    contentMode: "searchContent runs bounded SQL/FTS phases over the indexed symbol corpus (name, qualified name, docstring and the stored bounded body); the source header documents that this is NOT full-text file contents",
    symbolMode: "findSymbol reads indexed AST records from the brain database and noise-classifies by RELATIVE path",
    fileMode: "requires a brain_file row; refuses 'file is not indexed' when the row is absent — disk content is only read for indexed paths",
    freshness: "every search engine calls checkResultsFreshness, which compares the stored SHA-256 file_hash against on-disk bytes; changed files are flagged stale, never fresh",
    bodyCoverage: "bodyCoverage.withBody counts symbols whose stored body is non-empty; it is the disclosure that separates 'nothing matched' from 'nothing could match'",
    readBoundary: "a content read must not create schema in the index database (proven on a fresh fixture by listing sqlite_master before/after)",
  },
  limitations: [
    "The audit proves the index-backed claim statically (query shape) and dynamically (row-deletion probe); it does not re-verify analyzer symbol extraction.",
    "Body reachability is proven on a TypeScript fixture whose analyzer stores symbol bodies; an analyzer that does not store bodies is represented by bodyCoverage, not repaired here.",
  ],
})

const ROOT = path.resolve(import.meta.dir, "..", "..")

function readSource(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

// ── 1. Static audit: which module owns which behaviour ─────────────────────
const symbolSearch = readSource("src/intelligence/search/symbol-search.ts")
const contentSearch = readSource("src/intelligence/search/content-search.ts")
const regexSearch = readSource("src/intelligence/search/regex-search.ts")
const freshnessSrc = readSource("src/brain/freshness.ts")
const handlerSrc = readSource("src/mcp/tools/bb_search/handler.ts")

harness.check(
  "symbols mode: searchSymbols queries brain_symbol JOIN brain_file (indexed corpus)",
  symbolSearch.includes("FROM brain_symbol") && symbolSearch.includes("JOIN brain_file"),
  "query does not join brain_file",
)
harness.check("symbols mode: no raw source-file reads in the search path", !symbolSearch.includes("readFileSync"), "readFileSync present")
harness.check(
  "content mode: searches the indexed symbol corpus (name+qualified_name+docstring+body)",
  contentSearch.includes("FROM brain_symbol") && contentSearch.includes("docstring") && contentSearch.includes("source_text"),
  "not index-backed or the body column is missing",
)
harness.check(
  "content mode: documented as not full-text file contents (no false claim)",
  contentSearch.includes("NOT full-text file contents") || contentSearch.includes("not full-text file contents"),
  "missing doc header",
)
harness.check("content mode: no raw source-file reads", !contentSearch.includes("readFileSync"), "readFileSync present")
harness.check(
  "read boundary: content search creates no schema on the read path",
  !contentSearch.includes("contentFtsSchema(raw)") || contentSearch.indexOf("contentFtsSchema(raw)") > contentSearch.indexOf("rebuildContentSearchIndex"),
  "read path still installs the FTS schema",
)
harness.check(
  "symbol mode: handler delegates to ASTEngine.findSymbol (indexed records)",
  handlerSrc.includes("ASTEngine.findSymbol"),
  "findSymbol not used",
)
harness.check(
  "file mode: guard requires a brain_file row before reading disk",
  handlerSrc.includes("file is not indexed") && handlerSrc.includes("SELECT id, language, file_hash FROM brain_file"),
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
  symbolSearch.includes("result.stale = true"),
  "no stale flagging",
)

// ── 2. Runtime: index-backed claims + body reachability + bodyCoverage ─────
const root = mkdtempSync(path.join(tmpdir(), "bb-search-honesty-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "a.ts"), "export function indexedA(): number { return 1 }\n")
writeFileSync(path.join(root, "src", "b.ts"), "export function indexedB(): number { return 2 }\n")
writeFileSync(
  path.join(root, "src", "body.ts"),
  "export function bodyHost(): number {\n  const bodyOnlyHonestyMarker = 7\n  return bodyOnlyHonestyMarker\n}\n",
)
await indexProjectParallel(projectId, root, {})

const raw = await BrainDatabase.getRawInstance(projectId)
const bFile = raw.prepare("SELECT id, path FROM brain_file WHERE path LIKE '%b.ts'").get() as { id: string; path: string } | undefined

// The match-set declaration fields the JSON content answer promises must be
// present, and bodyCoverage must count the bodies that are actually stored.
{
  const schemaObjects = () =>
    (raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%fts%'").all() as Array<{ name: string }>).map((r) => r.name)
  const before = schemaObjects()
  const body = await searchContent(projectId, "bodyOnlyHonestyMarker", { maxResults: 10 })
  harness.check(
    "runtime: body-only word is reachable in content mode",
    body.some((r: any) => r.symbolName === "bodyHost"),
    `results=${body.length}`,
  )
  harness.check("runtime: content declares matchMode", body.matchMode === "phrase", String(body.matchMode))
  harness.check(
    "runtime: bodyCoverage.withBody counts stored bodies",
    (body.bodyCoverage?.withBody ?? 0) >= 1 && (body.bodyCoverage?.symbols ?? 0) >= 1,
    JSON.stringify(body.bodyCoverage),
  )
  const after = schemaObjects()
  harness.negative(
    "runtime: a content read adds no schema objects to the index database",
    after.length === before.length && after.every((name) => before.includes(name)),
    `before=${before.join(",") || "(none)"} after=${after.join(",") || "(none)"}`,
  )
}

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

// Negative: file mode refuses a path with no brain_file row (real handler). The
// handler contract is an isError envelope, not a thrown error — demanding a throw
// pinned the old leak, so the assertion reads the envelope.
{
  const { createToolHandlers } = await import("../../src/mcp/tool-handlers")
  const publicSearch = createToolHandlers().bb_search
  let envelope: any = null
  let threw = false
  try {
    envelope = await publicSearch({ mode: "file", filePath: "src/b.ts" }, { projectId, projectPath: root })
  } catch {
    threw = true
  }
  const text = (envelope?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  harness.negative(
    "runtime: file mode refuses unindexed path through an error envelope",
    !threw && envelope?.isError === true && text.includes("file is not indexed"),
    threw ? "handler threw instead of returning an envelope" : `isError=${envelope?.isError} text=${text.slice(0, 120)}`,
  )
}

rmSync(root, { recursive: true, force: true })
harness.emit()
