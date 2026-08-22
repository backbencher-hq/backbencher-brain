// verify-search-modes.ts — M13.18 (S1) bb_search mode negatives + freshness.
// Migrated to the shared M13 harness (script/m13/harness.ts) so its evidence is
// schema-compliant and adversarial (negative cases required for `verified`).
import { appendFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { searchSymbols } from "../src/intelligence/search/symbol-search"
import { searchContent } from "../src/intelligence/search/content-search"
import { searchRegex, InvalidRegexError } from "../src/intelligence/search/regex-search"
import { createContractFixture } from "./fixtures/contract-fixture"
import { createToolHandlers } from "../src/mcp/tool-handlers"
import { TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"
import { validateToolArguments } from "../src/mcp/tool-validation"
import { Harness } from "./m13/harness"

const harness = new Harness({
  issue: "M13.18",
  code: "S1",
  tool: "bb_search",
  title: "bb_search: mode negatives + freshness on all modes",
  layers: ["unit", "integration"],
  decisions: {
    fileModeContract: "mode=file returns a typed file envelope (path, content, language, freshness), not filtered symbol rows",
    freshness: "symbol, regex, content, and file modes all flag stale files (content freshness added in this issue)",
  },
  limitations: [
    "Search correctness is bounded by indexed analyzer symbols and file hashes.",
    "This evidence does not establish analyzer completeness or semantic-answer quality.",
    "S2 (e2e) and S3 (real-repo corpus) are separate M13 issues.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-search-modes-"))
const projectId = getProjectId(root)
const searchDescriptor = TOOL_DESCRIPTORS.find((descriptor) => descriptor.name === "bb_search")!
const publicSearch = createToolHandlers().bb_search

try {
  createContractFixture(root)
  await indexProjectParallel(projectId, root, {})

  const exact = await searchSymbols(projectId, "handleRequest", { exact: true })
  harness.check("exact matches only the exact symbol", exact.length >= 1 && exact.every((r) => r.symbolName === "handleRequest"))
  harness.check("default mode is tagged symbol", exact.searchMode === "symbol")

  const prefix = await searchSymbols(projectId, "handle", {})
  harness.check("prefix finds handleRequest", prefix.some((r) => r.symbolName === "handleRequest"))

  const substring = await searchSymbols(projectId, "quest", {})
  harness.check("substring finds handleRequest", substring.some((r) => r.symbolName === "handleRequest"))

  const dup = await searchSymbols(projectId, "duplicateName", {})
  harness.check("substring finds both duplicate symbols", dup.filter((r) => r.symbolName === "duplicateName").length === 2)

  const page1 = await searchSymbols(projectId, "duplicateName", { maxResults: 1, offset: 0 })
  const page2 = await searchSymbols(projectId, "duplicateName", { maxResults: 1, offset: 1 })
  harness.check("pagination returns distinct pages", page1.length === 1 && page2.length === 1 && page1[0]!.file !== page2[0]!.file)

  const regexResults = await searchRegex(projectId, "^handle.*", {})
  harness.check("regex matches by pattern", regexResults.some((r) => r.symbolName === "handleRequest"))
  harness.check("regex mode is tagged", regexResults.searchMode === "regex")
  harness.check("regex reports truncation flag", regexResults.truncated === false)

  const regexNoMatch = await searchRegex(projectId, "^zzz_nothing_matches$", {})
  harness.check("regex non-match returns empty", regexNoMatch.length === 0)

  const viaOption = await searchSymbols(projectId, "^helper$", { regex: true })
  harness.check("regex:true routes through symbol dispatcher", viaOption.some((r) => r.symbolName === "helper"))

  const content = await searchContent(projectId, "handleRequest", {})
  harness.check("content search finds documented symbol", content.some((r) => r.symbolName === "handleRequest"))
  harness.check("content mode is tagged", content.searchMode === "content")
  harness.check("content results carry content matchType", content.every((r) => r.matchType === "content"))

  const contentViaMode = await searchSymbols(projectId, "handleRequest", { mode: "content" })
  harness.check("mode=content routes through dispatcher", contentViaMode.some((r) => r.symbolName === "handleRequest"))

  const langFiltered = await searchSymbols(projectId, "ProcessValue", { languages: ["go"] })
  harness.check("language filter narrows results", langFiltered.every((r) => r.language === "go"))
  const langFilteredMiss = await searchSymbols(projectId, "ProcessValue", { languages: ["python"] })
  harness.check("language filter excludes other languages", langFilteredMiss.length === 0)

  const kindFiltered = await searchSymbols(projectId, "RequestHandler", { symbolKind: "class" })
  harness.check("symbolKind filter narrows results", kindFiltered.every((r) => r.symbolType === "class"))

  // Public-boundary negatives: the engine tests must not mask handler/validation defects.
  harness.rejects("public search rejects empty symbol query", () => validateToolArguments(searchDescriptor, { query: "" }), "non-empty query")
  harness.rejects("public file mode requires filePath", () => validateToolArguments(searchDescriptor, { mode: "file" }), "requires filePath")
  await harness.rejectsAsync("invalid regex throws InvalidRegexError", () => searchRegex(projectId, "([unclosed", {}), "InvalidRegexError")

  const fileResult = await publicSearch({ mode: "file", filePath: "src/app.ts" }, { projectPath: root, projectId })
  const filePayload = JSON.parse(fileResult.content[0]!.text)
  harness.check("public file mode returns a file envelope", filePayload.searchMode === "file" && filePayload.file === "src/app.ts")
  harness.check("public file mode returns source content", typeof filePayload.content === "string" && filePayload.content.includes("handleRequest"))
  harness.check("public file mode returns freshness metadata", typeof filePayload.stale === "boolean" && typeof filePayload.contentLength === "number")
  harness.check("unmodified file mode reports fresh", filePayload.stale === false)

  await harness.rejectsAsync("public file mode rejects path escape", () => publicSearch({ mode: "file", filePath: "../outside.ts" }, { projectPath: root, projectId }), "escapes project root")

  // Freshness across all four modes: modify a file on disk without reindexing.
  appendFileSync(path.join(root, "src", "app.ts"), "\n// stale marker\n")

  const staleSym = await searchSymbols(projectId, "handleRequest", { exact: true })
  harness.check("symbol search flags stale rows after modification", staleSym.some((r) => r.stale === true) && (staleSym.staleCount ?? 0) > 0)

  const staleRegex = await searchRegex(projectId, "^handleRequest$", {})
  harness.check("regex search flags stale rows after modification", staleRegex.some((r) => r.stale === true) && (staleRegex.staleCount ?? 0) > 0)

  const staleContent = await searchContent(projectId, "handleRequest", {})
  harness.check("content search flags stale rows after modification", staleContent.some((r) => r.stale === true) && (staleContent.staleCount ?? 0) > 0)

  const staleFile = await publicSearch({ mode: "file", filePath: "src/app.ts" }, { projectPath: root, projectId })
  harness.check("file mode reports stale after modification", JSON.parse(staleFile.content[0]!.text).stale === true)
} catch (error) {
  harness.check("search modes session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

harness.emit()
