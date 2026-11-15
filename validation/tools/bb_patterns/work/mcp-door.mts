// Phase A MCP door probe: starts the REAL MCP server over stdio (source door) and
// calls bb_patterns through @modelcontextprotocol/sdk, exactly as an MCP host
// does. Captures one success, three refusals (invalid scope, unknown option,
// missing index) and proves the transport is clean: a polluted stdout breaks the
// JSON-RPC handshake, so a completed session is itself evidence.
//
// Usage: BB_DATA_DIR=<scratch> BB_NO_AUTO_REFRESH=1 npx tsx mcp-door.mts <out.json>

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const outPath = process.argv[2]
if (!outPath) { console.error("usage: mcp-door.mts <out.json>"); process.exit(2) }

const entry = path.resolve("validation/tools/bb_patterns/work/node-server-entry.ts")
const dataDir = process.env.BB_DATA_DIR ?? ""
if (!dataDir) { console.error("BB_DATA_DIR is required: the door must run against the lane's own index"); process.exit(2) }
const childEnv = { ...process.env, BB_DATA_DIR: path.resolve(dataDir), BB_NO_AUTO_REFRESH: "1" }

// Fixture A: indexed project (success cases + engine refusals).
const indexedRoot = mkdtempSync(path.join(tmpdir(), "bb-patterns-door-"))
mkdirSync(path.join(indexedRoot, "src"), { recursive: true })
writeFileSync(path.join(indexedRoot, "src", "app.ts"),
  "export function used(): number { return 1 }\nexport function dead(): number { return 2 }\nexport function caller(): number { return used() }\n")
const indexedId = getProjectId(indexedRoot)
await indexProjectParallel(indexedId, indexedRoot, {})
BrainDatabase.closeAll()
// Fixture B: a directory that is NOT indexed under this data dir (missing-index refusal).
const unindexedRoot = mkdtempSync(path.join(tmpdir(), "bb-patterns-door-empty-"))
const unindexedId = getProjectId(unindexedRoot)

type DoorResult = { tool: string; arguments: Record<string, unknown>; isError: boolean; text: string; chars: number }
async function doorCase(
  client: Client,
  label: string,
  args: Record<string, unknown>,
): Promise<{ label: string; result: DoorResult }> {
  const res: any = await client.callTool({ name: "bb_patterns", arguments: args })
  const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  return { label, result: { tool: "bb_patterns", arguments: args, isError: res?.isError === true, text, chars: text.length } }
}

const report: Record<string, unknown> = {
  door: "MCP stdio (source door)",
  entry,
  command: `npx tsx ${entry} --dir <fixture>`,
  protocol: "JSON-RPC over stdio via @modelcontextprotocol/sdk StdioClientTransport; child env carries BB_DATA_DIR and BB_NO_AUTO_REFRESH=1",
  indexedFixture: { dir: indexedRoot, projectId: indexedId },
  unindexedFixture: { dir: unindexedRoot, projectId: unindexedId },
  cases: [] as unknown[],
  generatedAt: new Date().toISOString(),
}

async function session(dir: string, cases: Array<{ label: string; args: Record<string, unknown> }>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", entry, "--dir", dir],
    cwd: process.cwd(),
    env: childEnv as Record<string, string>,
    stderr: "pipe",
  })
  const client = new Client({ name: "bb-patterns-door-probe", version: "1.0.0" })
  let stderr = ""
  try {
    if (transport.stderr) transport.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })
  } catch {}
  const out: unknown[] = []
  try {
    await client.connect(transport)
    for (const c of cases) out.push(await doorCase(client, c.label, c.args))
  } finally {
    try { await client.close() } catch {}
  }
  return { out, stderrTail: stderr.slice(-600) }
}

try {
  const indexed = await session(indexedRoot, [
    { label: "success-orphaned", args: { scope: "orphaned", limit: 5 } },
    { label: "success-default-all", args: {} },
    { label: "refuse-invalid-scope", args: { scope: "quality" } },
    { label: "refuse-unknown-option", args: { foo: true } },
    { label: "refuse-invalid-threshold", args: { confidenceThreshold: 2 } },
  ])
  const unindexed = await session(unindexedRoot, [{ label: "refuse-missing-index", args: {} }])
  report.cases = [...indexed.out, ...unindexed.out]
  report.serverStderr = { indexed: indexed.stderrTail, unindexed: unindexed.stderrTail }
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify({
    cases: (report.cases as any[]).map((c) => ({ label: c.label, isError: c.result.isError, chars: c.result.chars, head: c.result.text.slice(0, 120) })),
    stderrTail: report.serverStderr,
  }, null, 1))
} catch (error) {
  console.error("FATAL", error)
  process.exitCode = 1
} finally {
  try { BrainDatabase.closeAll() } catch {}
}
