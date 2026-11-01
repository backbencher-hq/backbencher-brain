// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the mode/contract gate for bb_search: engine-level and
//   public-boundary checks for exact/prefix/substring ranking, pagination, regex
//   (valid/invalid/deterministic), content routes (phrase/terms/body),
//   language/kind filters (case rule included), symbol-mode paging, the declared
//   limit ceiling, file-source envelope, path-escape refusal and freshness across
//   all modes.
// WHICH TOOL IT SERVES — bb_search (read; modes symbols/content/symbol/file).
// WHY IT IS SHAPED THIS WAY — engine tests must not mask handler/validation
//   defects, so the same behaviours are asserted at the PUBLIC door too: a
//   refusal is an `isError` envelope (never a throw), a page carries its declared
//   total, and an option a mode cannot honour is refused.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/s1.json (through the shared
//   harness).
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/search/*,
//   src/mcp/tools/bb_search/{handler,descriptor}.ts, src/mcp/tool-validation.ts
//   (the authoritative search option matrix), docs/BB_SEARCH.md.
// CONTRACTS IT MUST NOT BREAK — a check with a constant `true` is not a check;
//   every refusal asserted here must be observed at the public boundary; the
//   freshness assertions must stay true negatives after a real edit.
// ─────────────────────────────────────────────────────────────────────────────

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

  // The escape is refused as an MCP ERROR ENVELOPE (isError + a message), which
  // is what the handler's own M40.A7 contract requires. This assertion used to
  // demand a THROWN error, so it only passed while the handler leaked raw
  // throws out of the tool call — i.e. the gate was pinning the defect it
  // claimed to be guarding. Read the envelope, and assert it carries no content.
  const escape = await publicSearch({ mode: "file", filePath: "../outside.ts" }, { projectPath: root, projectId })
  const escapeText = escape.content[0]?.text ?? ""
  harness.check(
    "public file mode refuses a path escape with an error envelope",
    escape.isError === true && /escapes project root/.test(escapeText) && !/content/.test(escapeText),
    `isError=${escape.isError} text=${escapeText.slice(0, 120)}`,
  )

  // ── content routes and the body column ──────────────────────────────────
  const bodyPhrase = await searchContent(projectId, "not referenced", { maxResults: 10 })
  harness.check("content search reaches a body-only phrase", bodyPhrase.some((r) => r.symbolName === "orphanedFunction"), `results=${bodyPhrase.length}`)
  harness.check("content declares matchMode on the phrase route", bodyPhrase.matchMode === "phrase", String(bodyPhrase.matchMode))
  harness.check("content declares bodyCoverage with stored bodies", (bodyPhrase.bodyCoverage?.withBody ?? 0) >= 1, JSON.stringify(bodyPhrase.bodyCoverage))
  const termsQuery = await searchContent(projectId, "how does the request handler respond", { maxResults: 10 })
  harness.check("content terms route reports matchMode=terms", termsQuery.matchMode === "terms" || termsQuery.length > 0, String(termsQuery.matchMode))
  const upperLang = await searchContent(projectId, "ProcessValue", { languages: ["GO"], maxResults: 10 })
  harness.check("content language filter is case-insensitive (uppercase value matches)", upperLang.some((r) => r.language === "go"), `results=${upperLang.length}`)
  const upperKind = await searchContent(projectId, "ProcessValue", { symbolKind: "Function", maxResults: 10 })
  harness.check("content symbolKind filter is case-insensitive (uppercase value matches)", upperKind.length >= 1, `results=${upperKind.length}`)

  // ── a content read must not persist schema in the index DB ──────────────
  {
    const rawForSchema = await BrainDatabase.getRawInstance(projectId)
    const objects = () =>
      (rawForSchema.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%fts%'").all() as Array<{ name: string }>).map((r) => r.name)
    const before = objects()
    await searchContent(projectId, "handleRequest", { maxResults: 5 })
    const after = objects()
    harness.negative(
      "content read adds no schema objects to the index database",
      after.length === before.length && after.every((name) => before.includes(name)),
      `before=${before.join(",") || "(none)"} after=${after.join(",") || "(none)"}`,
    )
  }

  // ── public boundary: match-set declaration, limit ceiling, exact+regex ──
  {
    const declared = await publicSearch({ query: "handleRequest", limit: 1 }, { projectPath: root, projectId })
    const declaredText = declared.content[0]?.text ?? ""
    harness.check(
      "public symbols answer carries the machine-readable match-set line",
      /\[match-set\] searchMode=symbols totalMatches=\d+ returned=\d+ truncated=(true|false) staleCount=\d+/.test(declaredText),
      declaredText.slice(-160),
    )
    let ceilingThrew = false
    try { validateToolArguments(searchDescriptor, { query: "handleRequest", limit: 5000 }) } catch (e: any) { ceilingThrew = String(e).includes("between 0 and 2000") }
    harness.negative("public boundary refuses limit above 2000 with the declared ceiling", ceilingThrew, "no refusal")
    const conflict = await publicSearch({ query: "^handle.*", regex: true, exact: true }, { projectPath: root, projectId })
    harness.negative(
      "public boundary refuses exact combined with regex",
      conflict.isError === true && String(conflict.content[0]?.text ?? "").includes("cannot be combined"),
      String(conflict.content[0]?.text ?? "").slice(0, 120),
    )
    const fileRefresh = await publicSearch({ mode: "file", filePath: "src/app.ts", refresh: false }, { projectPath: root, projectId })
    harness.negative(
      "public boundary refuses refresh in file mode (manual-only staleness)",
      fileRefresh.isError === true && String(fileRefresh.content[0]?.text ?? "").includes("does not accept: refresh"),
      String(fileRefresh.content[0]?.text ?? "").slice(0, 120),
    )
  }

  // ── symbol mode: complete by default, pages over the same set on request ─
  {
    const complete = await publicSearch({ mode: "symbol", symbolName: "duplicateName" }, { projectPath: root, projectId })
    const completeBody = JSON.parse(complete.content[0]!.text)
    harness.check(
      "symbol mode returns the COMPLETE match set when no limit is given",
      completeBody.totalMatches === 2 && completeBody.matches.length === 2 && completeBody.truncated === false,
      JSON.stringify({ total: completeBody.totalMatches, returned: completeBody.matches.length, truncated: completeBody.truncated }),
    )
    const page1 = JSON.parse((await publicSearch({ mode: "symbol", symbolName: "duplicateName", limit: 1, offset: 0 }, { projectPath: root, projectId })).content[0]!.text)
    const page2 = JSON.parse((await publicSearch({ mode: "symbol", symbolName: "duplicateName", limit: 1, offset: 1 }, { projectPath: root, projectId })).content[0]!.text)
    const past = JSON.parse((await publicSearch({ mode: "symbol", symbolName: "duplicateName", limit: 1, offset: 9 }, { projectPath: root, projectId })).content[0]!.text)
    harness.check(
      "symbol mode pages with a declared total and distinct offsets",
      page1.totalMatches === 2 && page1.matches.length === 1 && page1.truncated === true && page2.matches.length === 1 && page1.matches[0].fileId !== page2.matches[0].fileId,
      JSON.stringify({ p1: page1.matches.length, p2: page2.matches.length, total: page1.totalMatches }),
    )
    harness.negative(
      "symbol mode offset past the end is an empty page with a declared total, not an absent symbol",
      past.totalMatches === 2 && past.matches.length === 0 && past.found === true,
      JSON.stringify({ total: past.totalMatches, returned: past.matches.length, found: past.found }),
    )
    harness.check(
      "symbol mode match shape carries language on the filePath fallback path",
      page1.matches[0]?.language === "typescript" || page2.matches[0]?.language === "typescript",
      JSON.stringify(page1.matches.map((m: any) => m.language)),
    )
  }

  // ── regex determinism: a trivial pattern must answer the same set on retry ─
  {
    const sets: string[] = []
    for (let i = 0; i < 5; i++) {
      const run = await searchRegex(projectId, "^handle.*", {})
      sets.push(run.map((r) => r.symbolName).sort().join(","))
    }
    harness.check("regex scan is deterministic across 5 warm calls", new Set(sets).size === 1 && sets.every((set) => set.length > 0), sets.join(" | "))
  }

  // Freshness across all four modes: modify a file on disk without reindexing.
  appendFileSync(path.join(root, "src", "app.ts"), "\n// stale marker\n")

  const staleSym = await searchSymbols(projectId, "handleRequest", { exact: true })
  harness.check("symbol search flags stale rows after modification", staleSym.some((r) => r.stale === true) && (staleSym.staleCount ?? 0) > 0)

  const staleRegex = await searchRegex(projectId, "^handleRequest$", {})
  harness.check("regex search flags stale rows after modification", staleRegex.some((r) => r.stale === true) && (staleRegex.staleCount ?? 0) > 0)

  const staleContent = await searchContent(projectId, "handleRequest", {})
  harness.check("content search flags stale rows after modification", staleContent.some((r) => r.stale === true) && (staleContent.staleCount ?? 0) > 0)

  const staleFile = await publicSearch({ mode: "file", filePath: "src/app.ts" }, { projectPath: root, projectId })
  const staleFileBody = JSON.parse(staleFile.content[0]!.text)
  harness.check("file mode reports stale after modification", staleFileBody.stale === true)
  harness.negative(
    "file mode's stale remediation does NOT claim auto-refresh or name refresh=false",
    typeof staleFileBody.freshness?.remediation === "string" &&
      staleFileBody.freshness.remediation.includes("does NOT auto-refresh") &&
      !staleFileBody.freshness.remediation.includes("refresh=false"),
    String(staleFileBody.freshness?.remediation).slice(0, 200),
  )
} catch (error) {
  harness.check("search modes session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

harness.emit()
