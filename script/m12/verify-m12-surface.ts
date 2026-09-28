// M12.47 MCP/CLI surface differential across all advertised languages.
//
// This is intentionally separate from the generic MCP smoke test. It indexes
// every positive M12 fixture, then proves each language through three distinct
// public paths:
//   1. shared library handlers (the implementation used by both transports),
//   2. the compiled Node CLI (`node bin/bb tool ...`), and
//   3. one real MCP stdio session (`node bin/bb mcp ...`).
//
// For every language it checks indexed/search/analyze/document/migrate/
// visualize/edit capability, exact language labels, CLI parity, and safe error
// serialization. It also checks the published support matrix against the
// fixture-backed advertised set so the matrix cannot drift silently.
//
// Usage: bun script/m12/verify-m12-surface.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const FIXTURE_ROOT = join(ROOT, "validation/m12/fixtures")
const MATRIX_FILE = join(ROOT, "docs/data/m12-surface-matrix.json")
const OUT_FILE = join(ROOT, "validation/m12/results/mcp-cli-surface.json")
const CLI = join(ROOT, "bin/bb")
// Bun is the evidence-script runtime, but the compiled CLI/MCP contract is
// explicitly the Node + better-sqlite3 runtime. Never use Bun's execPath here.
const NODE_RUNTIME = process.env.BB_NODE_RUNTIME ?? "node"
const LANGUAGES = readdirSync(FIXTURE_ROOT).filter((entry) => !entry.startsWith(".")).sort()
const CAPABILITIES = ["indexed", "queried", "analyzed", "documented", "migrated", "visualized", "edited", "cli", "mcp"] as const

type Capability = (typeof CAPABILITIES)[number]
type SurfaceRow = { language: string; file: string; symbol: string; line: number; capabilities: Record<Capability, boolean>; errors: string[] }

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function safeJson(text: string): any | null { try { return JSON.parse(text) } catch { return null } }
function resultText(result: any): string { return (result?.content ?? []).map((item: any) => item?.text ?? "").join("\n") }
function shellText(result: ReturnType<typeof spawnSync>): string { return `${result.stdout ?? ""}${result.stderr ?? ""}` }

const matrix = JSON.parse(readFileSync(MATRIX_FILE, "utf8")) as { advertisedLanguages: number; capabilities: string[]; languages: Array<{ language: string; parser: string }> }
const matrixLanguages = matrix.languages.map((entry) => entry.language).sort()
check("published matrix declares 41 languages", matrix.advertisedLanguages === 41)
check("published matrix capability list is complete", CAPABILITIES.every((capability) => matrix.capabilities.includes(capability)))
check("published matrix matches fixture language set", JSON.stringify(matrixLanguages) === JSON.stringify(LANGUAGES), `matrix=${matrixLanguages.length} fixtures=${LANGUAGES.length}`)
check("public registry has exactly ten tools", PUBLIC_TOOL_DESCRIPTORS.length === 10)

// Build the same positive corpus used by M12.44/M12.45.
const corpus = mkdtempSync(join(tmpdir(), "bb-m12-surface-"))
const filesByLanguage: Record<string, string[]> = {}
for (const language of LANGUAGES) {
  const source = join(FIXTURE_ROOT, language)
  const target = join(corpus, language)
  mkdirSync(target, { recursive: true })
  filesByLanguage[language] = readdirSync(source).filter((file) => !file.startsWith("Negative")).sort()
  for (const file of filesByLanguage[language]) copyFileSync(join(source, file), join(target, file))
}
const corpusFileCount = Object.values(filesByLanguage).flat().length
const projectId = getProjectId(corpus)
const raw = await BrainDatabase.getRawInstance(projectId)
const handlers = createToolHandlers()
const context = { projectId: String(projectId), projectPath: corpus }

async function handlerCall(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; thrown: string }> {
  try {
    const result = await handlers[name]!(args, context as any)
    return { text: resultText(result), isError: result.isError === true, thrown: "" }
  } catch (error: any) {
    return { text: "", isError: true, thrown: error?.message ?? String(error) }
  }
}

console.log(`  indexing ${corpusFileCount} positive fixtures across ${LANGUAGES.length} languages...`)
const stats: any = await indexProjectParallel(projectId, corpus, { logger: { log: () => {}, write: () => {} } })
const indexedRows = raw.prepare("SELECT COUNT(*) AS c FROM brain_file WHERE project_id=?").get(projectId) as any
check("all positive fixtures indexed", Number(indexedRows?.c ?? 0) === corpusFileCount, `${indexedRows?.c ?? 0}/${corpusFileCount}`)
check("indexer reports zero file errors", Number(stats.errorFiles ?? 0) === 0, `errors=${stats.errorFiles ?? 0}`)

const rows = raw.prepare(
  "SELECT f.language AS language, f.relative_path AS file, s.name AS symbol, COALESCE(s.line_start,1) AS line " +
  "FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? ORDER BY f.language, " +
  "CASE WHEN s.symbol_type IN ('class','function','module','interface','struct','type','table') THEN 0 ELSE 1 END, s.line_start",
).all(projectId) as Array<{ language: string; file: string; symbol: string; line: number }>
const targets = new Map<string, { language: string; file: string; symbol: string; line: number }>()
for (const language of LANGUAGES) {
  const candidates = rows.filter((row) => row.language === language && row.symbol && !row.symbol.startsWith("anonymous_") && !row.symbol.startsWith("block_"))
  const target = candidates.find((row) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(row.symbol)) ?? candidates[0]
  if (target) targets.set(language, target)
  check(`${language} has an indexed smoke target`, Boolean(target))
}
check("indexed target set covers all 41 languages", targets.size === LANGUAGES.length, `${targets.size}/${LANGUAGES.length}`)

const surfaceRows: SurfaceRow[] = []
for (const language of LANGUAGES) {
  const target = targets.get(language)
  if (!target) continue
  const capabilities = Object.fromEntries(CAPABILITIES.map((capability) => [capability, false])) as Record<Capability, boolean>
  const errors: string[] = []
  capabilities.indexed = true

  // Search is the canonical per-language query contract. Exact + language
  // filtering catches both dropped symbols and false language attribution.
  const search = await handlerCall("bb_search", { query: target.symbol, language, exact: true, limit: 100 })
  const searchHasTarget = search.text.includes(target.symbol) && search.text.includes(`(${language})`)
  capabilities.queried = !search.isError && searchHasTarget
  if (!capabilities.queried) errors.push(`handler search: ${search.thrown || search.text.slice(0, 180)}`)

  const complexity = await handlerCall("bb_analyze", { mode: "complexity", target: target.file })
  capabilities.analyzed = !complexity.isError && Boolean(safeJson(complexity.text))
  if (!capabilities.analyzed) errors.push(`handler analyze: ${complexity.thrown || complexity.text.slice(0, 180)}`)

  const doc = await handlerCall("bb_doc", { mode: "file", target: target.file, format: "json" })
  capabilities.documented = !doc.isError && safeJson(doc.text)?.mode === "file"
  if (!capabilities.documented) errors.push(`handler doc: ${doc.thrown || doc.text.slice(0, 180)}`)

  const migrate = await handlerCall("bb_migrate", { symbolName: target.symbol, targetLanguage: "rust", format: "json" })
  const migrateJson = safeJson(migrate.text)
  capabilities.migrated = !migrate.isError && migrateJson !== null && Array.isArray(migrateJson?.plans) && Array.isArray(migrateJson?.unsupported)
  if (!capabilities.migrated) errors.push(`handler migrate: ${migrate.thrown || migrate.text.slice(0, 180)}`)

  const visualize = await handlerCall("bb_visualize", { scope: "project", languages: [language], format: "json", maxNodes: 20, maxLinks: 100 })
  const visualizeJson = safeJson(visualize.text)
  capabilities.visualized = !visualize.isError && Array.isArray(visualizeJson?.nodes) && visualizeJson?.provenance != null
  if (!capabilities.visualized) errors.push(`handler visualize: ${visualize.thrown || visualize.text.slice(0, 180)}`)

  // A dry-run write is deliberately used: it proves the public mutation path
  // and safe-path validation without changing the evidence corpus.
  const edit = await handlerCall("bb_edit", { mode: "write", dryRun: true, filePath: `.m12-surface/${language}/probe.txt`, content: `surface probe for ${language}\n` })
  const editJson = safeJson(edit.text)
  capabilities.edited = !edit.isError && editJson?.dryRun === true && editJson?.validated === false && editJson?.reindexed === false
  if (!capabilities.edited) errors.push(`handler edit: ${edit.thrown || edit.text.slice(0, 180)}`)

  // The compiled CLI must return the same search text as the shared handler.
  const cliSearch = spawnSync(NODE_RUNTIME, [CLI, "tool", "bb_search", "--dir", corpus, "--args", JSON.stringify({ query: target.symbol, language, exact: true, limit: 100 })], { cwd: ROOT, encoding: "utf8", timeout: 120000 })
  capabilities.cli = cliSearch.status === 0 && cliSearch.stdout.trim() === search.text.trim()
  if (!capabilities.cli) errors.push(`CLI search status=${cliSearch.status} output=${shellText(cliSearch).slice(0, 180)}`)

  surfaceRows.push({ language, file: target.file, symbol: target.symbol, line: Number(target.line), capabilities, errors })
  console.log(`  ${language}: ${Object.values(capabilities).filter(Boolean).length}/${CAPABILITIES.length} capabilities`)
}

// Actual MCP stdio transport: one server process, all language targets, then
// every public tool once on the same corpus.
const transport = new StdioClientTransport({ command: NODE_RUNTIME, args: [CLI, "mcp", "--dir", corpus], cwd: ROOT, stderr: "pipe" })
const client = new Client({ name: "m12-surface-verifier", version: "1.0.0" })
let mcpConnected = false
let mcpStructuredErrors = false
try {
  await client.connect(transport)
  mcpConnected = true
  check("MCP initialize handshake", true)
  const listed = await client.listTools()
  check("MCP tools/list matches the public registry", listed.tools.length === PUBLIC_TOOL_DESCRIPTORS.length && listed.tools.every((tool: any) => PUBLIC_TOOL_DESCRIPTORS.some((descriptor) => descriptor.name === tool.name)))

  for (const row of surfaceRows) {
    const response: any = await client.callTool({ name: "bb_search", arguments: { query: row.symbol, language: row.language, exact: true, limit: 100 } })
    const text = resultText(response)
    const pass = response.isError !== true && text.includes(row.symbol) && text.includes(`(${row.language})`)
    row.capabilities.mcp = pass
    if (!pass) row.errors.push(`MCP search: ${text.slice(0, 180)}`)
  }

  const representative = surfaceRows[0]
  const globalCalls: Array<[string, Record<string, unknown>, (text: string, isError: boolean) => boolean]> = [
    ["bb_search", { query: representative?.symbol ?? "main", limit: 5 }, (text, error) => !error && text.length > 0],
    ["bb_ask", { query: "how does the indexed code work", limit: 2 }, (text, error) => !error && text.length > 0],
    ["bb_health", {}, (text, error) => !error && /files=\d+ symbols=\d+ relationships=\d+/.test(text)],
    ["bb_patterns", { scope: "orphaned", limit: 2 }, (text, error) => !error && text.length > 0],
    ["bb_security", {}, (text, error) => !error && text.length > 0],
    ["bb_visualize", { scope: "project", format: "json", maxNodes: 20, maxLinks: 100 }, (text, error) => !error && safeJson(text)?.provenance != null],
    ["bb_migrate", { symbolName: representative?.symbol ?? "main", targetLanguage: "rust", format: "json" }, (text, error) => !error && Array.isArray(safeJson(text)?.unsupported)],
    ["bb_analyze", { mode: "stats" }, (text, error) => !error && Number(safeJson(text)?.symbols ?? 0) > 0],
    ["bb_doc", { mode: "symbol", target: representative?.symbol ?? "main", format: "json" }, (text, error) => !error && safeJson(text)?.mode === "symbol"],
    ["bb_edit", { mode: "write", dryRun: true, filePath: ".m12-surface/mcp-probe.txt", content: "mcp surface probe\n" }, (text, error) => !error && safeJson(text)?.dryRun === true],
  ]
  for (const [name, args, predicate] of globalCalls) {
    const response: any = await client.callTool({ name, arguments: args })
    check(`MCP ${name} global smoke`, predicate(resultText(response), response.isError === true), resultText(response).slice(0, 180))
  }

  // MCP and CLI must serialize validation failures without a stack trace or a
  // fabricated language. This is the language-attribution/error contract.
  const invalid: any = await client.callTool({ name: "bb_search", arguments: { query: 42 } })
  const invalidText = resultText(invalid)
  mcpStructuredErrors = invalid.isError === true && invalidText === "error: bb_search: query must be string" && !invalidText.includes("at ")
  check("MCP validation errors are structured", mcpStructuredErrors)
  check("MCP validation errors do not fabricate language attribution", !/\b(python|java|rust|typescript)\b/i.test(invalidText))
} catch (error: any) {
  check("MCP session", false, error?.message ?? String(error))
} finally {
  if (mcpConnected) await client.close()
}

// CLI error contract is checked separately because the CLI process owns the
// serialization boundary.
const cliInvalid = spawnSync(NODE_RUNTIME, [CLI, "tool", "bb_search", "--args", JSON.stringify({ query: 42 })], { cwd: ROOT, encoding: "utf8", timeout: 30000 })
const cliInvalidText = shellText(cliInvalid).trim()
check("CLI validation errors are structured", cliInvalid.status !== 0 && cliInvalidText === "error: bb_search: query must be string")
check("CLI validation errors contain no stack trace", !cliInvalidText.includes(" at ") && !cliInvalidText.includes("file://"))
check("CLI validation errors do not fabricate language attribution", !/\b(python|java|rust|typescript)\b/i.test(cliInvalidText))

for (const row of surfaceRows) {
  for (const capability of CAPABILITIES) check(`${row.language} ${capability}`, row.capabilities[capability], row.errors.join(" | "))
}

const allPassed = failures === 0 && surfaceRows.length === LANGUAGES.length && surfaceRows.every((row) => CAPABILITIES.every((capability) => row.capabilities[capability]))
const evidence = {
  schemaVersion: 1,
  name: "m12.47-mcp-cli-surface",
  passed: allPassed,
  advertisedLanguages: LANGUAGES.length,
  corpusFiles: corpusFileCount,
  indexedFiles: Number(indexedRows?.c ?? 0),
  toolCount: PUBLIC_TOOL_DESCRIPTORS.length,
  capabilities: [...CAPABILITIES],
  validation: { cliStructuredErrors: cliInvalid.status !== 0 && cliInvalidText === "error: bb_search: query must be string", mcpStructuredErrors: mcpStructuredErrors ?? false },
  perLanguage: surfaceRows,
}
mkdirSync(dirname(OUT_FILE), { recursive: true })
writeFileSync(OUT_FILE, JSON.stringify(evidence, null, 2) + "\n")
console.log(`wrote ${OUT_FILE}`)

rmSync(corpus, { recursive: true, force: true })
rmSync(dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
if (!allPassed) {
  console.error(`\nM12.47 SURFACE: FAIL (${failures} failures)`)
  process.exit(1)
}
console.log("\nM12.47 SURFACE: PASS — 41 languages × 9 capabilities")
