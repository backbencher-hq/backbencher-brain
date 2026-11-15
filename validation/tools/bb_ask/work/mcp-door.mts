// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — drives bb_ask through the REAL MCP stdio door (source entry, node --import
//   tsx, environment forwarded) and records one success and every refusal it must produce:
//   empty/whitespace/missing query, unknown option, invalid limit type/range, unknown mode.
// WHICH TOOL IT SERVES — bb_ask (read).
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/mcp-door.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tool-validation.ts, src/mcp/server.ts,
//   src/mcp/tools/bb_ask/descriptor.ts.
//
// Usage: BB_DATA_DIR=<dir> BB_NO_AUTO_REFRESH=1 npx tsx mcp-door.mts <projectDir> <out.json>

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { getProjectId } from "../../../../src/util/project-id"

const projectDir = process.argv[2]
const outPath = process.argv[3]
if (!projectDir || !outPath) {
  console.error("usage: mcp-door.mts <projectDir> <out.json>")
  process.exit(2)
}
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..", "..", "..", "..")
const projectId = getProjectId(projectDir)

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(here, "node-server-entry.ts"), "--dir", projectDir],
  cwd: repoRoot,
  stderr: "pipe",
  // The SDK sanitizes the child environment; forward the whole env so BB_DATA_DIR
  // reaches the server and the probe reads the same index it measured.
  env: { ...process.env } as Record<string, string>,
})
let serverStderr = ""
transport.stderr?.on("data", (chunk: Buffer) => { serverStderr += chunk.toString() })
const client = new Client({ name: "bb-ask-door-probe", version: "1.0.0" })

type Call = { label: string; args: Record<string, unknown>; expectError: boolean; expectText?: string }
const calls: Call[] = [
  { label: "success: aggregate question", args: { query: "how many functions are in this project" }, expectError: false, expectText: "provenance: indexed" },
  { label: "success: aggregate declares an index snapshot and bounds", args: { query: "how many files are in this project" }, expectError: false, expectText: "[index:" },
  { label: "success: semantic question", args: { query: "where is request handling implemented" }, expectError: false, expectText: "provenance:" },
  { label: "success: exact symbol name", args: { query: "handleImpactRequest" }, expectError: false, expectText: "Matched by NAME" },
  { label: "success: limit bounds the source list", args: { query: "request handling", limit: 1 }, expectError: false },
  { label: "refusal: empty query", args: { query: "" }, expectError: true, expectText: "non-empty query" },
  { label: "refusal: whitespace query", args: { query: "   " }, expectError: true, expectText: "non-empty query" },
  { label: "refusal: missing query", args: {}, expectError: true, expectText: "missing required option" },
  { label: "refusal: unknown option", args: { query: "x", mode: "explain" }, expectError: true, expectText: "unknown or irrelevant options" },
  { label: "refusal: negative limit", args: { query: "x", limit: -1 }, expectError: true, expectText: "non-negative" },
  { label: "refusal: fractional limit", args: { query: "x", limit: 2.5 }, expectError: true, expectText: "whole number" },
  { label: "refusal: limit wrong type", args: { query: "x", limit: "5" }, expectError: true, expectText: "limit must be number" },
  { label: "refusal: limit=0 refuses with the page-size sentence", args: { query: "x", limit: 0 }, expectError: true, expectText: "limit must be a whole number between 1 and 100" },
  { label: "refusal: limit=101 refuses with the page-size sentence", args: { query: "x", limit: 101 }, expectError: true, expectText: "limit must be a whole number between 1 and 100" },
]

const rows: Array<Record<string, unknown>> = []
let listTools: any = null
try {
  await client.connect(transport)
  const listed: any = await client.listTools()
  const ask = (listed?.tools ?? []).find((t: any) => t.name === "bb_ask")
  listTools = {
    found: !!ask,
    description: ask?.description,
    inputSchema: ask?.inputSchema,
    toolCount: (listed?.tools ?? []).length,
  }
  for (const call of calls) {
    const t0 = performance.now()
    let response: any
    let thrown: string | null = null
    try {
      response = await client.callTool({ name: "bb_ask", arguments: call.args })
    } catch (error: any) {
      thrown = String(error?.message ?? error)
    }
    const ms = Math.round((performance.now() - t0) * 100) / 100
    const text = (response?.content ?? []).map((item: any) => item.text ?? "").join("\n")
    const isError = response?.isError === true
    const sourceLines = text.split("\n").filter((line) => /^\d+\. \S/.test(line.trim())).length
    const hasBounds = /\[bounds: returned=\d+, totalMatches=(?:\d+|unknown), truncated=(?:true|false)/.test(text)
    rows.push({
      label: call.label,
      args: call.args,
      thrown,
      isError,
      ms,
      chars: text.length,
      sourceLines,
      expectationMet:
        thrown === null &&
        isError === call.expectError &&
        (!call.expectText || text.includes(call.expectText)) &&
        (call.expectError || hasBounds),
      hasBounds,
      text: text.length > 1200 ? text.slice(0, 1200) + `…[+${text.length - 1200} chars]` : text,
    })
  }
  // A tool name that does not exist must fail as unavailable, not hang.
  try {
    const bad: any = await client.callTool({ name: "bb_ask_typo", arguments: { query: "x" } })
    const badText = (bad?.content ?? []).map((item: any) => item.text ?? "").join("\n")
    rows.push({ label: "refusal: unknown tool name", isError: bad?.isError === true, text: badText.slice(0, 200), expectationMet: bad?.isError === true })
  } catch (error: any) {
    rows.push({ label: "refusal: unknown tool name", thrown: String(error?.message ?? error), isError: true, expectationMet: true })
  }
} catch (error: any) {
  rows.push({ label: "__fatal__", thrown: String(error?.stack ?? error), isError: true, expectationMet: false })
} finally {
  try { await client.close() } catch {}
}

const report = {
  projectDir,
  projectId,
  dataDir: process.env.BB_DATA_DIR ?? "(default ~/.bb)",
  entry: "real MCP stdio: node --import tsx → src/mcp/server.ts (source door)",
  env: { BB_DATA_DIR: process.env.BB_DATA_DIR ?? null, BB_NO_AUTO_REFRESH: process.env.BB_NO_AUTO_REFRESH ?? null, BB_EMBEDDING_DISABLED: process.env.BB_EMBEDDING_DISABLED ?? null },
  listTools,
  calls: rows,
  failures: rows.filter((r: any) => r.expectationMet === false).length,
  serverStderr: serverStderr.slice(0, 4000),
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
for (const row of rows) console.log(JSON.stringify({ label: row.label, isError: row.isError, ms: row.ms, chars: row.chars, met: row.expectationMet }))
console.log(JSON.stringify({ listToolsFound: listTools?.found, toolCount: listTools?.toolCount, failures: report.failures }))
