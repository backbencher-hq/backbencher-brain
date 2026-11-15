// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the release battery: all sixteen public tools called
//   through the REAL MCP stdio door against the real multi-language workspace
//   index built by validation/release/README.md, with latency, error envelopes,
//   refusal assertions and the byte-read-only proof captured into one artifact.
// WHICH TOOL IT SERVES — all sixteen (thirteen read tools on the shared
//   workspace; bb_edit/bb_index/bb_annotate exercised without touching source
//   via dryRun/no-op/annotation-only calls).
// WHY SHAPED THIS WAY — a lane's evidence proves one tool; the release question
//   is whether the shipped server serves all sixteen on a real corpus. This runs
//   the compiled entry (`node bin/bb mcp`) so the artifact is about the binary.
// WHERE EVIDENCE LIVES — validation/release/RELEASE-BATTERY.json.
// EDIT TOGETHER — validation/release/run-t2-baseline.ts (latency budget),
//   validation/release/README.md (corpus + reproduction).
// CONTRACTS — never write the shared .bb-data/~/.bb indexes; dryRun stays
//   dryRun; a refusal is asserted as an error envelope, not counted as success.
// ─────────────────────────────────────────────────────────────────────────────

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const REPO = path.resolve(import.meta.dirname ?? ".", "../..")
const WORKSPACE = path.join(REPO, "validation", "release", "workspace")
const DATA_DIR = path.join(REPO, "validation", "release", "data")
const DB = (() => {
  const projects = path.join(DATA_DIR, "projects")
  if (!existsSync(projects)) return null
  for (const project of readdirSync(projects)) {
    const candidate = path.join(projects, project, "brain.db")
    if (existsSync(candidate)) return candidate
  }
  return null
})()
const statDb = (): { size: number; mtimeMs: number; wal: number } | null => {
  if (!DB || !existsSync(DB)) return null
  const s = statSync(DB)
  let wal = 0
  try { wal = statSync(DB + "-wal").size } catch { /* absent is fine */ }
  return { size: s.size, mtimeMs: s.mtimeMs, wal }
}

interface BatteryCall { tool: string; args: Record<string, unknown>; kind: "read" | "write"; assertError?: boolean; note?: string }
const CALLS: BatteryCall[] = [
  { tool: "bb_health", args: {}, kind: "read" },
  { tool: "bb_search", args: { query: "pipeline", limit: 5 }, kind: "read" },
  { tool: "bb_ask", args: { query: "how are types defined" }, kind: "read" },
  { tool: "bb_analyze", args: { mode: "stats" }, kind: "read" },
  { tool: "bb_patterns", args: { scope: "orphaned", limit: 5 }, kind: "read" },
  { tool: "bb_security", args: {}, kind: "read" },
  { tool: "bb_visualize", args: { scope: "module", target: "graphql-js" }, kind: "read" },
  { tool: "bb_migrate", args: { symbolName: "buildSchema", targetLanguage: "python" }, kind: "read" },
  { tool: "bb_doc", args: { mode: "module", target: "graphql-js" }, kind: "read" },
  { tool: "bb_graph", args: { symbol: "GraphQLSchema", maxDepth: 2, maxEdges: 50 }, kind: "read" },
  { tool: "bb_impact", args: { symbol: "buildSchema" }, kind: "read" },
  { tool: "bb_cross_language", args: { symbol: "GraphQLSchema" }, kind: "read" },
  { tool: "bb_annotations", args: { limit: 5 }, kind: "read" },
  { tool: "bb_annotate", args: { symbol: "GraphQLSchema", body: "release battery note — stored through the real MCP door" }, kind: "write" },
  { tool: "bb_index", args: { path: ".", mode: "dir" }, kind: "write", note: "settled workspace: expected no-op/unchanged" },
  { tool: "bb_edit", args: { mode: "write", filePath: "src/__release_probe__.ts", content: "export const releaseProbe = 1\n", dryRun: true }, kind: "write", note: "dryRun: plans only, writes nothing" },
  // Refusals — an error envelope is the assertion, not a failure.
  { tool: "bb_search", args: { query: "x", limit: 2001 }, kind: "read", assertError: true, note: "limit above max refused by exact sentence" },
  { tool: "bb_ask", args: { query: "x", limit: 0 }, kind: "read", assertError: true, note: "limit 0 refused, not answered empty" },
  { tool: "bb_migrate", args: { symbolName: "buildSchema", targetLanguage: "python", bogusOption: true }, kind: "read", assertError: true, note: "unknown option named" },
  { tool: "bb_doc", args: { mode: "module", target: "graphql-js", limit: 101 }, kind: "read", assertError: true, note: "limit above range refused" },
]

const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(REPO, "bin", "bb"), "mcp", "--dir", WORKSPACE],
  cwd: REPO,
  env: { ...(process.env as Record<string, string>), BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" },
  stderr: "pipe",
})
const client = new Client({ name: "bb-release-battery", version: "1.0.0" }, { capabilities: {} })
const results: Array<Record<string, unknown>> = []
const before = statDb()
let readWriteAttribution: string[] = []

try {
  await client.connect(transport)
  const tools = await client.listTools()
  const toolNames = (tools.tools ?? []).map((t) => t.name).sort()

  // Read phase first (write tools may legitimately change the annotation store).
  for (const call of CALLS) {
    const t0 = performance.now()
    let isError = false
    let text = ""
    try {
      const response = await client.callTool({ name: call.tool, arguments: call.args })
      isError = Boolean(response.isError)
      text = String((response.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "")
      if (call.assertError) {
        // The SDK surfaces refusals either as isError or as an error envelope in text.
        const envelopeRefused = isError || /isError|refused|unknown or irrelevant|must be between|whole number/i.test(text)
        if (!envelopeRefused) results.push({ tool: call.tool, refusalAssertionFailed: true, text: text.slice(0, 200) })
      }
    } catch (error) {
      isError = true
      text = String((error as Error)?.message ?? error)
    }
    const ms = Math.round(performance.now() - t0)
    results.push({
      tool: call.tool,
      kind: call.kind,
      note: call.note ?? null,
      args: call.args,
      ms,
      isError,
      assertError: Boolean(call.assertError),
      refusalAsExpected: call.assertError ? isError || /refused|unknown|must be|whole number/i.test(text) : undefined,
      bytes: text.length,
      head: text.slice(0, 240),
    })
    if (call.kind === "read") {
      const now = statDb()
      if (before && now && (now.size !== before.size || now.mtimeMs !== before.mtimeMs)) {
        readWriteAttribution.push(call.tool)
      }
    }
  }

  const after = statDb()
  const readOnly = {
    dbBytesBefore: before?.size ?? null,
    dbBytesAfter: after?.size ?? null,
    dbMtimeUnchanged: before?.mtimeMs === after?.mtimeMs,
    readToolsThatMovedTheIndex: readWriteAttribution,
    note: "write-tool calls follow the read phase; the read phase is what this proof covers",
  }
  const report = {
    schemaVersion: 1,
    what: "Release battery — all sixteen public tools through the real MCP stdio door on the real multi-language release workspace.",
    generatedAt: new Date().toISOString(),
    head: readFileSync(path.join(REPO, ".git", "HEAD"), "utf8").trim().slice(0, 7),
    door: "node bin/bb mcp --dir validation/release/workspace (compiled entry)",
    workspace: { path: "validation/release/workspace", corpora: ["graphql-js/src (TS/JS)", "rake/lib (Ruby)", "rebar3/apps (Erlang)"] },
    registeredTools: toolNames,
    registeredToolCount: toolNames.length,
    expectedToolCount: 16,
    calls: results,
    readOnlyProof: readOnly,
    verdict: {
      allRegistered: toolNames.length === 16,
      everyToolAnswered: results.filter((r) => r.kind === "read" || r.tool === "bb_annotate" || r.tool === "bb_index" || r.tool === "bb_edit").every((r) => r.isError === false || Boolean(r.assertError)),
      refusalsAsExpected: results.filter((r) => r.assertError).every((r) => r.refusalAsExpected === true),
      readPhaseUntouched: readWriteAttribution.length === 0,
    },
  }
  writeFileSync(path.join(REPO, "validation", "release", "RELEASE-BATTERY.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify(report.verdict, null, 2))
  for (const r of results) {
    console.log(`${String(r.tool).padEnd(19)} ${String(r.kind).padEnd(5)} ${String(r.ms).padStart(6)} ms  isError=${String(r.isError).padEnd(5)} bytes=${String(r.bytes).padStart(6)}${r.assertError ? ` refusal=${r.refusalAsExpected}` : ""}`)
  }
} finally {
  await client.close().catch(() => {})
}
