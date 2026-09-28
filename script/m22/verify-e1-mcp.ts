// script/m22/verify-e1-mcp.ts — M22.E1
// Proves the MCP bb_index tool is registered and makes a just-written file's
// symbols queryable immediately (agent-fresh):
//   1. bb_index appears in the public tool descriptors with a path arg.
//   2. An agent writes a new file with a new function, calls bb_index {path},
//      then bb_search finds the symbol immediately (no full reindex).
//   3. A second bb_index on the same unchanged file is an idempotent near-no-op.
//   4. Negative: an unindexed/nonexistent path returns a clear error, never a
//      silent no-op.
// No auto-pass / tautological assertions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainTools } from "../../src/ast/tools"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { createToolHandlers } from "../../src/mcp/tool-handlers"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m22/results")

let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

async function run() {
  const root = mkdtempSync(path.join(tmpdir(), "m22-e1-"))
  const proj = path.join(root, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  for (let i = 0; i < 8; i++) writeFileSync(path.join(proj, "src", `m${i}.ts`), `export function e1f${i}(x:number){return x+${i}}\n`)
  const pid = getProjectId(proj)
  await indexProjectParallel(pid, proj, {})

  // 1. bb_index registered
  const desc = PUBLIC_TOOL_DESCRIPTORS.find((d) => d.name === "bb_index")
  check("E1 bb_index tool is registered in the public registry", !!desc, "not registered")
  check("E1 bb_index requires a path argument", !!desc && (desc.inputSchema.required ?? []).includes("path"), "no required path")

  // 2. agent writes a new file, calls bb_index, symbol queryable immediately
  const newFile = path.join(proj, "src", "agent-created.ts")
  writeFileSync(newFile, "export function AGENT_FRESH_SYM(x:number){return x*3}\n")
  const handlers = createToolHandlers()
  const before = await BrainTools.searchCode(pid, "AGENT_FRESH_SYM", { maxResults: 5 })
  check("E1 symbol is NOT queryable before bb_index", before.length === 0, `before=${before.length}`)

  const res = await handlers.bb_index({ path: "src/agent-created.ts" }, { projectPath: proj, projectId: pid })
  const parsed = JSON.parse(res.content[0].text)
  check("E1 bb_index returns a JSON result with counts", typeof parsed.indexed === "number" && typeof parsed.errors === "number", res.content[0].text.slice(0, 160))
  check("E1 bb_index reindexed the file (indexed >= 1)", parsed.indexed >= 1, JSON.stringify(parsed))

  const after = await BrainTools.searchCode(pid, "AGENT_FRESH_SYM", { maxResults: 5 })
  check("E1 symbol is queryable immediately after bb_index", after.some((h: any) => h.symbolName === "AGENT_FRESH_SYM"), JSON.stringify(after.slice(0, 2)))

  // 3. idempotent: second call on the unchanged file is a near-no-op
  const res2 = await handlers.bb_index({ path: "src/agent-created.ts" }, { projectPath: proj, projectId: pid })
  const parsed2 = JSON.parse(res2.content[0].text)
  check("E1 a second bb_index on the unchanged file is a near-no-op", parsed2.indexed === 0, JSON.stringify(parsed2))

  // 4. negative: nonexistent path errors clearly
  const res3 = await handlers.bb_index({ path: "src/does-not-exist.ts" }, { projectPath: proj, projectId: pid })
  negative("E1 a nonexistent path returns a clear error (never a silent no-op)", res3.isError === true || /no such path/.test(res3.content[0].text), res3.content[0].text.slice(0, 120))

  rmSync(root, { recursive: true, force: true })
  const finalStatus = passed === checks && negatives >= 1 ? "verified" : "known-gap"
  mkdirSync(RESULTS, { recursive: true })
  const { execFileSync } = await import("node:child_process")
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const result = {
    issue: "M22.E1", code: "E1", milestone: "M22", status: finalStatus,
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m22/verify-e1-mcp.ts",
    evidenceFile: "E1.json", generatedAt: new Date().toISOString(),
    command: "bun run script/m22/verify-e1-mcp.ts",
    observed: { indexedFirstCall: parsed.indexed, indexedSecondCall: parsed2.indexed, symbolQueryableAfter: after.some((h: any) => h.symbolName === "AGENT_FRESH_SYM") },
    limitations: ["Exercised at the tool-handler level (the same handler the MCP server dispatches); the MCP JSON-RPC transport is already covered by the e2e CLI sweep's initialize handshake."],
  }
  writeFileSync(path.join(RESULTS, "E1.json"), JSON.stringify(result, null, 2) + "\n")
  try {
    const led = JSON.parse(readFileSync(path.join(ROOT, "validation/m22/ledger.json"), "utf8"))
    const e = Object.values(led.issues).find((i: any) => i.code === "E1")
    if (e) { e.status = finalStatus; e.passed = passed; e.failed = checks - passed; e.commit = commit; e.evidenceFile = "E1.json" }
    writeFileSync(path.join(ROOT, "validation/m22/ledger.json"), JSON.stringify(led, null, 2) + "\n")
  } catch (e2: any) { console.log(`E1: ledger self-update failed: ${e2?.message}`) }
  console.log(`E1: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
  process.exit(finalStatus === "verified" ? 0 : 1)
}

run().catch((e) => { console.error("E1 verifier crashed:", e); process.exit(1) })