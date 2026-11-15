// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the COMPILED-door proof for bb_visualize: the same real MCP
//   stdio session as probe.ts, but spawned from the built package (`node bin/bb`,
//   which runs dist/) instead of the source CLI, so the shipped artifact is
//   exercised and not only the tree it was built from.
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true).
// WHY IT IS SHAPED THIS WAY — the source door is the development truth; the
//   compiled door is the released one, and a release note that only ever tested
//   source would ship whatever the build step happened to produce. Both doors are
//   expected to answer with the same declared shape, so the check compares counts
//   and declarations, not prose.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_visualize/results/compiled-door.json.
// EDIT TOGETHER WHEN THIS CHANGES — probe.ts (the source door), real-corpus.ts,
//   and the dist rebuild.
// CONTRACTS IT MUST NOT BREAK — writes only under validation/tools/bb_visualize/.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

const HERE = path.resolve(import.meta.dirname ?? ".", ".")
const ROOT = path.resolve(HERE, "..", "..", "..")
const DATA_DIR = path.join(HERE, "bbdata")
const RESULTS = path.join(HERE, "results")
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"
const repo = path.join("/home/ishaq2321/bb_tests/repositories", "rake")
const sha = (file: string) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null)
const state = (file: string) => ({ exists: existsSync(file), size: existsSync(file) ? statSync(file).size : 0, sha256: sha(file) })

const { getProjectId } = await import("../../../src/util/project-id")
const { BrainDatabase } = await import("../../../src/brain/database")
const projectId = getProjectId(repo)
const dbPath = BrainDatabase.getDbPath(projectId)
const before = { db: state(dbPath), wal: state(`${dbPath}-wal`) }

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, "bin", "bb"), "mcp", "--dir", repo],
  cwd: ROOT,
  env: { ...process.env, BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" } as Record<string, string>,
  stderr: "pipe",
})
const client = new Client({ name: "bb-visualize-compiled-door", version: "1.0.0" })
let stderrText = ""
transport.stderr?.on("data", (chunk: Buffer) => { stderrText += String(chunk) })
const checks: Array<{ name: string; pass: boolean; detail: string }> = []
const check = (name: string, pass: boolean, detail = "") => { checks.push({ name, pass, detail }); if (!pass) console.log(`  FAIL: ${name} — ${detail}`) }
try {
  await client.connect(transport)
  const listed: any = await client.listTools()
  const tool = (listed?.tools ?? []).find((entry: any) => entry.name === "bb_visualize")
  check("compiled: bb_visualize is registered", !!tool)
  const call = async (args: Record<string, unknown>) => {
    const response: any = await client.callTool({ name: "bb_visualize", arguments: args })
    return { isError: response?.isError === true, text: String(response?.content?.[0]?.text ?? "") }
  }
  const text = await call({})
  check("compiled: default text answers", !text.isError && text.text.startsWith("graph: "), text.text.slice(0, 120))
  const json = await call({ format: "json" })
  const answer = JSON.parse(json.text || "{}")
  check("compiled: JSON declares bounds, page, provenance and freshness", !!answer.nodes && typeof answer.totalNodesAvailable === "number" && !!answer.considered?.page && !!answer.provenance?.source && !!answer.freshness)
  check("compiled: provenance names the stored rows", answer.provenance?.source === "stored-symbol-and-relationship-rows", String(answer.provenance?.source))
  const html = await call({ format: "html" })
  check("compiled: HTML is self-contained", !html.isError && !/https?:\/\//.test(html.text) && html.text.includes("data-bb-layout") && html.text.includes("totalNodesAvailable"), `${html.text.length} bytes`)
  const refused = await call({ maxNodes: 0 })
  check("compiled: an out-of-range bound is an error envelope", refused.isError && /between 1 and 2000/.test(refused.text), refused.text.slice(0, 120))
  await client.close()
} catch (error: any) {
  check("compiled: session", false, String(error?.message ?? error))
}
await new Promise((resolve) => setTimeout(resolve, 300))
const after = { db: state(dbPath), wal: state(`${dbPath}-wal`) }
check("compiled: index bytes unchanged by the session", JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }))
const table = {
  schemaVersion: 1, tool: "bb_visualize", door: "compiled (node bin/bb -> dist/)",
  generatedAt: new Date().toISOString(),
  verifierCommand: "BB_DATA_DIR=validation/tools/bb_visualize/bbdata npx tsx validation/tools/bb_visualize/compiled-door.ts",
  repo, projectId, passed: checks.filter((row) => row.pass).length, failed: checks.filter((row) => !row.pass).length,
  status: checks.every((row) => row.pass) ? "verified" : "partial", checks, dbUnchanged: JSON.stringify(before) === JSON.stringify(after), stderrTail: stderrText.split("\n").filter(Boolean).slice(-3),
}
writeFileSync(path.join(RESULTS, "compiled-door.json"), JSON.stringify(table, null, 2) + "\n")
console.log(`compiled door: ${table.status.toUpperCase()} (${table.passed}/${checks.length} checks, dbUnchanged=${table.dbUnchanged})`)
process.exit(table.status === "verified" ? 0 : 1)
