// verify-mcp.ts — Phase 6 acceptance: spawn `bb mcp`, do the MCP handshake
// (initialize, tools/list, tools/call bb_search + bb_health), assert results.
//   bun run script/verify-mcp.ts      (and npx tsx under Node)
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}
console.log(`runtime: ${process.version} (${typeof Bun !== "undefined" ? "bun" : "node"})`)

// fixture project
const root = mkdtempSync(path.join(tmpdir(), "bb-mcp-fixture-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(
  path.join(root, "src", "app.ts"),
  `export function handleRequest(req: any): string {
  return req?.body ?? ""
}

export class RequestHandler {
  handle(req: any): string {
    return this.respond(req)
  }
  private respond(req: any): string {
    return req?.type ?? ""
  }
}
`,
)

// index it first via the CLI entry
const { getProjectId } = await import("../src/cli/index")
const { indexProjectParallel } = await import("../src/ast/parallel-indexer")
const pid = getProjectId(root)
await indexProjectParallel(pid, root, {})
console.log(`  indexed fixture (${pid.slice(0, 8)})`)

// spawn the MCP server
const entry = path.resolve("src/mcp/server.ts")
const isBun = typeof Bun !== "undefined"
const transport = new StdioClientTransport({
  command: isBun ? "bun" : "npx",
  args: isBun ? [entry, "--dir", root] : ["tsx", entry, "--dir", root],
  cwd: process.cwd(),
  stderr: "pipe",
})
const client = new Client({ name: "verify", version: "1.0.0" })

let serverStderr = ""
transport.onerror = (e) => console.log(`  transport error: ${e}`)
const origSpawn = (transport as any)._process
try {
  await client.connect(transport)
  check("MCP initialize handshake", true)

  const tools = await client.listTools()
  const names = tools.tools.map((t: any) => t.name)
  check("tools/list exposes ten public tools", names.length === 10 && ["bb_search","bb_ask","bb_analyze","bb_patterns","bb_security","bb_doc","bb_visualize","bb_migrate","bb_edit","bb_health"].every((t) => names.includes(t)), `got ${names.join(",")}`)

  const searchRes: any = await client.callTool({ name: "bb_search", arguments: { query: "handleRequest", limit: 5 } })
  const searchText = (searchRes.content ?? []).map((c: any) => c.text ?? "").join("\n")
  check("bb_search returns the symbol", searchText.includes("handleRequest") && searchText.includes("app.ts"), searchText.slice(0, 120))

  const fileRes: any = await client.callTool({ name: "bb_search", arguments: { mode: "file", filePath: "src/app.ts" } })
  const fileText = (fileRes.content ?? []).map((c: any) => c.text ?? "").join("\n")
  const filePayload = JSON.parse(fileText)
  check("bb_search file mode returns source envelope", filePayload.searchMode === "file" && filePayload.file === "src/app.ts" && filePayload.content.includes("handleRequest"), fileText.slice(0, 160))

  const emptyRes: any = await client.callTool({ name: "bb_search", arguments: { query: "" } })
  const emptyText = (emptyRes.content ?? []).map((c: any) => c.text ?? "").join("\n")
  check("bb_search rejects empty query at MCP boundary", emptyRes.isError === true && emptyText.includes("non-empty query"), emptyText.slice(0, 160))

  const healthRes: any = await client.callTool({ name: "bb_health", arguments: {} })
  const healthText = (healthRes.content ?? []).map((c: any) => c.text ?? "").join("\n")
  check("bb_health returns counts", /symbols=\d+/.test(healthText), healthText.slice(0, 120))

  const selectRes: any = await client.callTool({ name: "bb_search", arguments: { mode: "symbol", symbolName: "handleRequest" } })
  const selectText = (selectRes.content ?? []).map((c: any) => c.text ?? "").join("\n")
  check("bb_search symbol mode extracts the symbol", selectText.includes("handleRequest") && selectText.includes("src/app.ts"), selectText.slice(0, 140))

  const relRes: any = await client.callTool({ name: "bb_analyze", arguments: { mode: "callees", target: "handle" } })
  const relText = (relRes.content ?? []).map((c: any) => c.text ?? "").join("\n")
  check("bb_analyze returns callees", relText.includes('"callees"'), relText.slice(0, 140))

  const askRes: any = await client.callTool({ name: "bb_ask", arguments: { query: "how does the request handler respond" } })
  const askText = (askRes.content ?? []).map((c: any) => c.text ?? "").join("\n")
  check("bb_ask returns an answer", askText.length > 0, askText.slice(0, 140))

  await client.close()
} catch (e) {
  check("MCP session", false, `${(e as Error).message}`)
}

rmSync(root, { recursive: true, force: true })
rmSync(path.dirname((await import("../src/brain/database")).BrainDatabase.getDbPath(pid)), { recursive: true, force: true })
console.log(failures === 0 ? "\nMCP VERIFY: ALL PASS" : `\nMCP VERIFY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
