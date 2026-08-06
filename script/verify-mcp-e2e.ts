// verify-mcp-e2e.ts — full end-to-end acceptance of the MCP surface.
// Spawns the REAL compiled CLI (`bb mcp --dir …`), does the handshake, lists
// tools, then calls ALL 15 tools and asserts each one responds.
//   bun run script/verify-mcp-e2e.ts        (or: npx tsx script/verify-mcp-e2e.ts)
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
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
  const EXPECTED = [
    "bb_search", "bb_select", "bb_relationships", "bb_ask", "bb_health",
    "bb_patterns", "bb_security", "bb_visualize", "bb_migrate", "bb_refresh",
    "bb_write", "bb_update", "bb_insert", "bb_delete", "bb_refactor",
  ]
  check("tools/list exposes all 15 tools", EXPECTED.every((t) => names.includes(t)), `got ${names.length}: ${names.join(",")}`)

  // ---- read-only tools ----
  let r = await call("bb_search", { query: "handleRequest", limit: 5 })
  check("bb_search finds handleRequest", r.text.includes("handleRequest") && r.text.includes("app.ts"), r.text.slice(0, 120))

  r = await call("bb_select", { symbolName: "handleRequest" })
  check("bb_select extracts symbol source", r.text.includes("handleRequest") && r.text.includes("src/app.ts"), r.text.slice(0, 140))

  r = await call("bb_relationships", { target: "handle", direction: "callees" })
  check("bb_relationships returns callees", r.text.includes("callees of handle"), r.text.slice(0, 140))

  r = await call("bb_ask", { query: "how does the request handler respond" })
  check("bb_ask returns semantic matches", r.text.length > 0 && !r.text.startsWith("error:"), r.text.slice(0, 140))

  r = await call("bb_health", {})
  check("bb_health returns counts", /symbols=\d+/.test(r.text), r.text.slice(0, 120))

  r = await call("bb_patterns", {})
  check("bb_patterns returns analysis", r.text.length > 0 && !r.text.startsWith("error:"), r.text.slice(0, 140))

  r = await call("bb_security", {})
  check("bb_security returns findings", r.text.length > 0 && !r.text.startsWith("error:"), r.text.slice(0, 140))

  r = await call("bb_visualize", {})
  check("bb_visualize returns graph summary", r.text.includes("nodes") && r.text.includes("links"), r.text.slice(0, 140))

  r = await call("bb_migrate", { symbolName: "handleRequest", targetLanguage: "go" })
  check("bb_migrate returns a plan", r.text.length > 0 && !r.text.startsWith("error:"), r.text.slice(0, 160))

  // ---- mutation tools (on the throwaway fixture) ----
  r = await call("bb_write", { filePath: "src/new.ts", content: "export function brandNew(): string {\n  return \"hi\"\n}\n" })
  check("bb_write creates a file", r.text.includes("written"), r.text.slice(0, 120))

  r = await call("bb_update", { symbolName: "helper", newContent: "export function helper(): number {\n  return 99\n}\n" })
  check("bb_update replaces symbol", r.text.includes("updated helper"), r.text.slice(0, 120))

  r = await call("bb_insert", { targetSymbolName: "handleRequest", position: "after", newContent: "export function insertedAfter(): string {\n  return \"x\"\n}\n" })
  check("bb_insert inserts code", r.text.includes("inserted after"), r.text.slice(0, 120))

  r = await call("bb_delete", { symbolName: "orphanedFunction" })
  check("bb_delete removes symbol", r.text.includes("deleted orphanedFunction"), r.text.slice(0, 120))

  r = await call("bb_refactor", { symbolName: "handleRequest", newName: "handleRequestV2" })
  check("bb_refactor renames symbol", r.text.includes("renamed handleRequest -> handleRequestV2"), r.text.slice(0, 140))

  // mutation actually landed on disk?
  const disk = (await import("fs")).readFileSync
  const newFileText = disk(path.join(root, "src", "new.ts"), "utf8")
  check("bb_write file exists on disk", newFileText.includes("brandNew"))
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
console.log(failures === 0 ? "\nMCP E2E: ALL 15 TOOLS PASS" : `\nMCP E2E: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
