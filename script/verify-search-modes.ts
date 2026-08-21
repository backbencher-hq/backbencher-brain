import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { searchSymbols } from "../src/intelligence/search/symbol-search"
import { searchContent } from "../src/intelligence/search/content-search"
import { searchRegex, InvalidRegexError } from "../src/intelligence/search/regex-search"
import { createContractFixture } from "./fixtures/contract-fixture"
import { createToolHandlers } from "../src/mcp/tool-handlers"
import { TOOL_DESCRIPTORS } from "../src/mcp/tool-registry"
import { validateToolArguments } from "../src/mcp/tool-validation"

let failures = 0
const checks: Array<{ label: string; passed: boolean; detail?: string }> = []
function check(label: string, condition: boolean, detail = ""): void {
  checks.push({ label, passed: condition, ...(detail ? { detail } : {}) })
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-search-modes-"))
const projectId = getProjectId(root)
try {
  createContractFixture(root)
  await indexProjectParallel(projectId, root, {})

  const exact = await searchSymbols(projectId, "handleRequest", { exact: true })
  check("exact matches only the exact symbol", exact.length >= 1 && exact.every((r) => r.symbolName === "handleRequest"))
  check("default mode is tagged symbol", exact.searchMode === "symbol")

  const prefix = await searchSymbols(projectId, "handle", {})
  check("prefix finds handleRequest", prefix.some((r) => r.symbolName === "handleRequest"))

  const substring = await searchSymbols(projectId, "quest", {})
  check("substring finds handleRequest", substring.some((r) => r.symbolName === "handleRequest"))

  const dup = await searchSymbols(projectId, "duplicateName", {})
  check("substring finds both duplicate symbols", dup.filter((r) => r.symbolName === "duplicateName").length === 2)

  const page1 = await searchSymbols(projectId, "duplicateName", { maxResults: 1, offset: 0 })
  const page2 = await searchSymbols(projectId, "duplicateName", { maxResults: 1, offset: 1 })
  check("pagination returns distinct pages", page1.length === 1 && page2.length === 1 && page1[0]!.file !== page2[0]!.file)

  const regexResults = await searchRegex(projectId, "^handle.*", {})
  check("regex matches by pattern", regexResults.some((r) => r.symbolName === "handleRequest"))
  check("regex mode is tagged", regexResults.searchMode === "regex")
  check("regex reports truncation flag", regexResults.truncated === false)

  const regexNoMatch = await searchRegex(projectId, "^zzz_nothing_matches$", {})
  check("regex non-match returns empty", regexNoMatch.length === 0)

  let invalidThrew = false
  try {
    await searchRegex(projectId, "([unclosed", {})
  } catch (error) {
    invalidThrew = error instanceof InvalidRegexError
  }
  check("invalid regex throws InvalidRegexError", invalidThrew)

  const viaOption = await searchSymbols(projectId, "^helper$", { regex: true })
  check("regex:true routes through symbol dispatcher", viaOption.some((r) => r.symbolName === "helper"))

  const content = await searchContent(projectId, "handleRequest", {})
  check("content search finds documented symbol", content.some((r) => r.symbolName === "handleRequest"))
  check("content mode is tagged", content.searchMode === "content")
  check("content results carry content matchType", content.every((r) => r.matchType === "content"))

  const contentViaMode = await searchSymbols(projectId, "handleRequest", { mode: "content" })
  check("mode=content routes through dispatcher", contentViaMode.some((r) => r.symbolName === "handleRequest"))

  const langFiltered = await searchSymbols(projectId, "ProcessValue", { languages: ["go"] })
  check("language filter narrows results", langFiltered.every((r) => r.language === "go"))
  const langFilteredMiss = await searchSymbols(projectId, "ProcessValue", { languages: ["python"] })
  check("language filter excludes other languages", langFilteredMiss.length === 0)

  const kindFiltered = await searchSymbols(projectId, "RequestHandler", { symbolKind: "class" })
  check("symbolKind filter narrows results", kindFiltered.every((r) => r.symbolType === "class"))

  // Public-boundary checks: the engine tests above must not mask handler and
  // validation defects. File mode is a typed source retrieval response, not a
  // filtered symbol list, and mode-specific query requirements are enforced
  // before the handler runs.
  const searchDescriptor = TOOL_DESCRIPTORS.find((descriptor) => descriptor.name === "bb_search")!
  let emptyRejected = false
  try { validateToolArguments(searchDescriptor, { query: "" }) } catch (error) { emptyRejected = String(error).includes("non-empty query") }
  check("public search rejects empty symbol query", emptyRejected)

  let fileMissingRejected = false
  try { validateToolArguments(searchDescriptor, { mode: "file" }) } catch (error) { fileMissingRejected = String(error).includes("requires filePath") }
  check("public file mode requires filePath", fileMissingRejected)

  const publicSearch = createToolHandlers().bb_search
  const fileResult = await publicSearch({ mode: "file", filePath: "src/app.ts" }, { projectPath: root, projectId })
  const filePayload = JSON.parse(fileResult.content[0]!.text)
  check("public file mode returns a file envelope", filePayload.searchMode === "file" && filePayload.file === "src/app.ts")
  check("public file mode returns source content", typeof filePayload.content === "string" && filePayload.content.includes("handleRequest"))
  check("public file mode returns freshness metadata", typeof filePayload.stale === "boolean" && typeof filePayload.contentLength === "number")

  let traversalRejected = false
  try { await publicSearch({ mode: "file", filePath: "../outside.ts" }, { projectPath: root, projectId }) } catch (error) { traversalRejected = String(error).includes("escapes project root") }
  check("public file mode rejects path escape", traversalRejected)
} catch (error) {
  check("search modes session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname((await import("../src/brain/database")).BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

mkdirSync(path.resolve("validation/m13/results"), { recursive: true })
writeFileSync(path.resolve("validation/m13/results/search.json"), JSON.stringify({
  schemaVersion: 1,
  kind: "tool_search_verification",
  tool: "bb_search",
  checks,
  passed: failures === 0,
  limitations: [
    "Search correctness is bounded by indexed analyzer symbols and file hashes.",
    "This evidence does not establish analyzer completeness or semantic-answer quality.",
  ],
}, null, 2) + "\n")
console.log(failures === 0 ? "\nSEARCH MODES: PASS" : "\nSEARCH MODES: " + failures + " FAILURES")
process.exit(failures > 0 ? 1 : 0)
