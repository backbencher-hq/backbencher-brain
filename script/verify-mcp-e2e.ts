// verify-mcp-e2e.ts — full end-to-end acceptance of the MCP surface.
// Spawns the REAL compiled CLI (`bb mcp --dir …`), does the handshake, lists
// tools, then calls EVERY CONTRACTED tool and asserts each one responds. The list
// comes from docs/data/public-tools.json (16 today), never from a literal here:
// this header said 15, the assertion below said 10, and the registry said 16.
//   bun run script/verify-mcp-e2e.ts        (or: npx tsx script/verify-mcp-e2e.ts)
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { execSync } from "child_process"

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}

// The public surface is DEFINED by the contract, not by a number restated in a test.
// docs/data/public-tools.json is generated from src/mcp/tool-registry.ts and enforced
// by script/verify-public-surface.ts, so it is the one place this list can come from.
const contract = JSON.parse(readFileSync(new URL("../docs/data/public-tools.json", import.meta.url), "utf8"))
const CONTRACT_TOOLS: string[] = (contract.tools ?? []).map((t: any) => t.name)

function parsePayload(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
console.log(`runtime: ${process.version} (${typeof Bun !== "undefined" ? "bun" : "node"})`)

// ---- fixture project (TS + Python so cross-language tools have data) ----
const root = mkdtempSync(path.join(tmpdir(), "bb-mcp-e2e-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(
  path.join(root, "src", "app.ts"),
  `export function handleRequest(req: any): string {
  return req?.body ?? ""
}

export function helper(): number {
  return 42
}

export class RequestHandler {
  handle(req: any): string {
    return this.respond(req)
  }
  private respond(req: any): string {
    const query = "SELECT * FROM users WHERE id = " + req?.id
    console.log("secret_key_here_12345")
    return req?.type ?? ""
  }
}

export function orphanedFunction(): void {
  console.log("never called anywhere")
}
`,
)
writeFileSync(path.join(root, "src", "helper.py"), `def note_book():\n    return "hello from python"\n`)

// ---- 1. index the fixture ----
// Node: compiled dist via bin/bb (better-sqlite3). Bun: index via the library
// API (bun:sqlite) — the compiled dist is intentionally Node-only by design.
const isBun = typeof Bun !== "undefined"
if (!isBun) {
  const bb = path.resolve("bin/bb")
  try {
    execSync(`${process.execPath} "${bb}" index "${root}"`, { cwd: process.cwd(), stdio: "pipe" })
    check("bb index fixture via compiled CLI", true)
  } catch (e: any) {
    check("bb index fixture via compiled CLI", false, `${(e as Error).message}`)
  }
} else {
  const { getProjectId } = await import("../src/cli/index")
  const { indexProjectParallel } = await import("../src/ast/parallel-indexer")
  await indexProjectParallel(getProjectId(root), root, {})
  check("bb index fixture (source, bun:sqlite)", true)
}

// ---- 2. spawn the MCP server through the runtime's real entry ----
// Node: `node bin/bb mcp --dir …` (compiled CLI). Bun: `bun src/mcp/server.ts
// --dir …` (self-executing source entry, bun:sqlite).
const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
const serverArgs = isBun ? ["--dir", root] : ["mcp", "--dir", root]
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry, ...serverArgs],
  cwd: process.cwd(),
  stderr: "pipe",
})
const client = new Client({ name: "verify-e2e", version: "1.0.0" })
let serverStderr = ""
;(transport as any).stderr?.on?.("data", (d: Buffer) => (serverStderr += d.toString()))

async function call(name: string, args: Record<string, unknown> = {}) {
  const res: any = await client.callTool({ name, arguments: args })
  const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  return { text, isError: res?.isError ?? false }
}

try {
  await client.connect(transport)
  check("MCP initialize handshake (bb mcp CLI)", true)

  const tools = await client.listTools()
  const names = tools.tools.map((t: any) => t.name)
  const missing = CONTRACT_TOOLS.filter((t) => !names.includes(t))
  const undeclared = names.filter((t) => !CONTRACT_TOOLS.includes(t))
  check(`tools/list exposes exactly the ${CONTRACT_TOOLS.length} contracted public tools`,
    missing.length === 0 && undeclared.length === 0,
    `missing: ${missing.join(",") || "none"}; served but not contracted: ${undeclared.join(",") || "none"}`)

  // ---- read-only tools ----
  let r = await call("bb_search", { query: "handleRequest", limit: 5 })
  check("bb_search finds handleRequest", r.text.includes("handleRequest") && r.text.includes("app.ts"), r.text.slice(0, 120))

  r = await call("bb_search", { mode: "symbol", symbolName: "handleRequest" })
  check("bb_search symbol mode extracts source", r.text.includes("handleRequest") && r.text.includes("src/app.ts"), r.text.slice(0, 140))

  r = await call("bb_analyze", { mode: "callees", target: "handle" })
  check("bb_analyze returns graph evidence", r.text.includes('"callees"'), r.text.slice(0, 160))

  r = await call("bb_analyze", { mode: "stats", target: "ignored" })
  check("bb_analyze rejects irrelevant mode options", r.isError && r.text.includes("irrelevant options"), r.text.slice(0, 160))

  r = await call("bb_ask", { query: "how does the request handler respond" })
  check("bb_ask returns semantic matches", r.text.length > 0 && !r.text.startsWith("error:"), r.text.slice(0, 140))

  r = await call("bb_health", {})
  check("bb_health returns counts", /symbols=\d+/.test(r.text), r.text.slice(0, 120))

  r = await call("bb_health", { verbose: true })
  check("bb_health verbose includes freshness", /freshness:/.test(r.text), r.text.slice(0, 160))

  r = await call("bb_health", { freshness: "complete" })
  check("bb_health complete mode surfaces mode", /complete/.test(r.text), r.text.slice(0, 160))

  r = await call("bb_health", { includeAnalysisRuns: true })
  check("bb_health includeAnalysisRuns emits analysis or no error", !r.text.startsWith("error:"), r.text.slice(0, 160))

  r = await call("bb_health", { refresh: true })
  check("bb_health refresh returns report", /symbols=\d+/.test(r.text), r.text.slice(0, 180))

  r = await call("bb_patterns", {})
  check("bb_patterns returns analysis", r.text.length > 0 && !r.text.startsWith("error:"), r.text.slice(0, 140))

  r = await call("bb_security", {})
  check("bb_security returns findings", r.text.length > 0 && !r.text.startsWith("error:"), r.text.slice(0, 140))

  r = await call("bb_visualize", { scope: "project", format: "json", maxNodes: 20, maxLinks: 50 })
  check("bb_visualize returns graph provenance", r.text.includes('"provenance"') && r.text.includes('"truncation"'), r.text.slice(0, 180))

  r = await call("bb_migrate", { symbolNames: ["handleRequest", "missingSymbol"], targetLanguage: "go", format: "json" })
  check("bb_migrate returns normalized batch result", r.text.includes('"dependencyOrder"') && r.text.includes('"unsupported"'), r.text.slice(0, 180))

  r = await call("bb_doc", { mode: "symbol", target: "handleRequest", format: "json", includeTests: true })
  check("bb_doc returns cited structured documentation", r.text.includes('"mode": "symbol"') && r.text.includes('"citations"'), r.text.slice(0, 180))

  r = await call("bb_analyze", { mode: "test_quality" })
  check("bb_analyze test quality returns a report", r.text.length > 0 && !r.text.startsWith("error:"), r.text.slice(0, 140))

  // ---- the five tools that had NO MCP coverage at all ----
  // They were added after this harness was written and never called here, which is how the
  // surface count drifted from ten to sixteen without a gate noticing.
  r = await call("bb_graph", { symbol: "RequestHandler", direction: "both", maxDepth: 2 })
  const graph = parsePayload(r.text)
  check("bb_graph roots an exact symbol and tiers every edge",
    !r.isError && graph?.root?.name === "RequestHandler" && graph?.root?.match === "exact" &&
      Array.isArray(graph?.callers) && graph.callers.length > 0 &&
      [...(graph.callers ?? []), ...(graph.callees ?? [])].every((e: any) => typeof e.tier === "string" && typeof e.relationshipType === "string"),
    r.text.slice(0, 180))

  r = await call("bb_impact", { symbol: "handleRequest" })
  const impact = parsePayload(r.text)
  check("bb_impact declares its rule and its root match",
    !r.isError && impact?.rootMatch?.via === "exact" && Array.isArray(impact?.rule?.relationshipTypes) &&
      impact.rule.relationshipTypes.includes("calls"),
    r.text.slice(0, 180))

  r = await call("bb_cross_language", { symbol: "helper" })
  const xl = parsePayload(r.text)
  check("bb_cross_language declares absence instead of inventing facts",
    !r.isError && xl?.declaredAbsent === true && Array.isArray(xl?.facts) && xl.facts.length === 0 &&
      xl?.ownFactCount === 0 && xl?.pairCount === 0,
    r.text.slice(0, 180))

  const noteBody = "e2e acceptance note: written, read back, and left as provenance for the annotate round-trip."
  r = await call("bb_annotate", { symbol: "handleRequest", path: "src/app.ts", body: noteBody })
  const wrote = parsePayload(r.text)
  check("bb_annotate stores an agent-authored note with enforced provenance",
    !r.isError && wrote?.stored === true && wrote?.annotation?.author_class === "agent" &&
      wrote?.annotation?.body === noteBody && wrote?.annotation?.symbol_path === "src/app.ts",
    r.text.slice(0, 180))

  r = await call("bb_annotations", { symbol: "handleRequest" })
  const readBack = parsePayload(r.text)
  check("bb_annotations reads that note back",
    !r.isError && readBack?.count === 1 && readBack?.declaredAbsent === false &&
      readBack?.annotations?.[0]?.body === noteBody,
    r.text.slice(0, 180))

  // bb_index was only ever exercised through the CLI, never as the MCP tool.
  r = await call("bb_index", { path: "src/app.ts", mode: "file" })
  check("bb_index reindexes one file and reports an outcome",
    !r.isError && /outcome/i.test(r.text), r.text.slice(0, 180))

  // ---- mutation tools (on the throwaway fixture) ----
  r = await call("bb_edit", { mode: "write", filePath: "src/edit-created.ts", content: "export const editCreated = true\n" })
  check("bb_edit write creates a file", r.text.includes('"reindexed": true') && r.text.includes('"validated": true'), r.text.slice(0, 160))

  r = await call("bb_edit", { mode: "write", filePath: "src/new.ts", content: "export function brandNew(): string {\n  return \"hi\"\n}\n" })
  check("bb_edit write creates another file", r.text.includes('"reindexed": true'), r.text.slice(0, 120))

  r = await call("bb_edit", { mode: "update", symbolName: "helper", newContent: "export function helper(): number {\n  return 99\n}\n" })
  check("bb_edit update replaces symbol", r.text.includes('"mode": "update"'), r.text.slice(0, 120))

  r = await call("bb_edit", { mode: "insert", targetSymbolName: "handleRequest", position: "after", newContent: "export function insertedAfter(): string {\n  return \"x\"\n}\n" })
  check("bb_edit insert adds source", r.text.includes('"mode": "insert"'), r.text.slice(0, 120))

  r = await call("bb_edit", { mode: "delete", symbolName: "orphanedFunction" })
  check("bb_edit delete removes symbol", r.text.includes('"mode": "delete"'), r.text.slice(0, 120))

  r = await call("bb_edit", { mode: "refactor", symbolName: "handleRequest", newName: "handleRequestV2" })
  check("bb_edit refactor renames symbol", r.text.includes('"mode": "refactor"'), r.text.slice(0, 140))

  // mutation actually landed on disk?
  const disk = (await import("fs")).readFileSync
  const newFileText = disk(path.join(root, "src", "new.ts"), "utf8")
  check("bb_edit write file exists on disk", newFileText.includes("brandNew"))
  const appText = disk(path.join(root, "src", "app.ts"), "utf8")
  check("bb_refactor applied on disk", appText.includes("handleRequestV2") && !appText.includes("export function handleRequest("))

  await client.close()
} catch (e) {
  check("MCP session", false, `${(e as Error).message}\n--- server stderr ---\n${serverStderr.slice(-1500)}`)
}

rmSync(root, { recursive: true, force: true })
const { BrainDatabase } = await import("../src/brain/database")
const { getProjectId } = await import("../src/cli/index")
rmSync(path.dirname(BrainDatabase.getDbPath(getProjectId(root))), { recursive: true, force: true })
console.log(failures === 0 ? `\nMCP E2E: ${CONTRACT_TOOLS.length} CONTRACTED PUBLIC TOOLS PASS` : `\nMCP E2E: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
