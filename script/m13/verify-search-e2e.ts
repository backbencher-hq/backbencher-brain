// script/m13/verify-search-e2e.ts — M13.19 (S2).
//
// Exercises all four bb_search modes (symbols / content / symbol / file) and
// their error paths through BOTH real transports: the compiled Node CLI
// (`node bin/bb tool bb_search --dir … --args …`) and the real MCP stdio
// server (StdioClientTransport → src/mcp/server.ts). Proves every mode and
// every error path surfaces correctly in both transports.

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.19",
  code: "S2",
  tool: "bb_search",
  title: "bb_search: e2e (real MCP + compiled CLI)",
  layers: ["e2e"],
  decisions: {
    transports: "compiled CLI via `node bin/bb tool bb_search --dir <root> --args <json>`; MCP via StdioClientTransport → src/mcp/server.ts (Bun runs server.ts directly, Node uses bin/bb mcp)",
    modes: "symbols (default), content (JSON envelope searchMode=content), symbol (findSymbol JSON), file (source envelope searchMode=file)",
    errors: "empty query, file mode without filePath, unindexed file, path escape, non-string query — each asserted in both transports",
  },
  limitations: [
    "The CLI transport reads the prebuilt bin/bb; run `npm run build` before this verifier.",
    "MCP stdio under Bun executes src/mcp/server.ts directly (no build needed for that path).",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-search-e2e-"))
const projectId = getProjectId(root)
const srcDir = path.join(root, "src")
mkdirSync(srcDir, { recursive: true })
writeFileSync(path.join(srcDir, "app.ts"), "export function handleRequest(): string { return \"ok\" }\nexport function duplicateName(): number { return 1 }\n")
writeFileSync(path.join(srcDir, "solo.ts"), "export const soloValue = 9\n")
await indexProjectParallel(projectId, root, {})
// A real file that exists on disk but was NOT indexed — must surface the
// "file is not indexed" guard (a nonexistent file fails earlier as "file not found").
writeFileSync(path.join(srcDir, "not-indexed.ts"), "export const late = true\n")

const bb = path.resolve("bin/bb")
const isBun = typeof Bun !== "undefined"

// ── CLI transport ─────────────────────────────────────────────────────────
function cli(args: Record<string, unknown>): { text: string; ok: boolean } {
  try {
    const out = execFileSync("node", [bb, "tool", "bb_search", "--dir", root, "--args", JSON.stringify(args)], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    return { text: out, ok: true }
  } catch (e: any) {
    return { text: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`, ok: false }
  }
}

// symbols mode (default)
{
  const r = cli({ query: "handleRequest", limit: 5 })
  harness.check("CLI symbols mode returns the symbol", r.ok && r.text.includes("handleRequest") && r.text.includes("src/app.ts"), r.text.slice(0, 160))
}
// content mode
{
  const r = cli({ mode: "content", query: "handleRequest", limit: 5 })
  let parsed: any = null
  try { parsed = JSON.parse(r.text) } catch {}
  harness.check("CLI content mode returns JSON with searchMode=content", r.ok && parsed?.searchMode === "content" && (parsed.results ?? []).some((x: any) => String(x.name).includes("handleRequest") || JSON.stringify(x).includes("handleRequest")), r.text.slice(0, 160))
}
// symbol mode
{
  const r = cli({ mode: "symbol", symbolName: "duplicateName" })
  let parsed: any = null
  try { parsed = JSON.parse(r.text) } catch {}
  harness.check("CLI symbol mode returns findSymbol matches", r.ok && (parsed?.matches ?? []).length >= 1 && JSON.stringify(parsed).includes("duplicateName"), r.text.slice(0, 160))
}
// file mode
{
  const r = cli({ mode: "file", filePath: "src/app.ts" })
  let parsed: any = null
  try { parsed = JSON.parse(r.text) } catch {}
  harness.check("CLI file mode returns source envelope", r.ok && parsed?.searchMode === "file" && parsed?.file === "src/app.ts" && parsed?.content?.includes("handleRequest"), r.text.slice(0, 160))
}

// CLI error paths (negatives)
{
  const r = cli({ query: "" })
  harness.negative("CLI rejects empty query", !r.ok && r.text.includes("non-empty query"), r.text.slice(0, 140))
}
{
  const r = cli({ mode: "file" })
  harness.negative("CLI rejects file mode without filePath", !r.ok && r.text.includes("requires filePath"), r.text.slice(0, 140))
}
{
  const r = cli({ mode: "file", filePath: "src/not-indexed.ts" })
  harness.negative("CLI rejects unindexed file", !r.ok && r.text.includes("file is not indexed"), r.text.slice(0, 140))
}
{
  const r = cli({ mode: "file", filePath: "../escape.ts" })
  harness.negative("CLI rejects path escape", !r.ok && r.text.includes("escapes"), r.text.slice(0, 140))
}
{
  const r = cli({ query: 42 })
  harness.negative("CLI rejects non-string query", !r.ok && r.text.includes("query must be string"), r.text.slice(0, 140))
}

// ── MCP stdio transport ───────────────────────────────────────────────────
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = isBun ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-search-e2e", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_search", arguments: args })
    const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { text, isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    // symbols
    const s = await call({ query: "handleRequest", limit: 5 })
    harness.check("MCP symbols mode returns the symbol", !s.isError && s.text.includes("handleRequest") && s.text.includes("src/app.ts"), s.text.slice(0, 160))
    // content
    const c = await call({ mode: "content", query: "handleRequest", limit: 5 })
    let cp: any = null
    try { cp = JSON.parse(c.text) } catch {}
    harness.check("MCP content mode returns JSON with searchMode=content", !c.isError && cp?.searchMode === "content" && (cp.results ?? []).some((x: any) => JSON.stringify(x).includes("handleRequest")), c.text.slice(0, 160))
    // symbol
    const sy = await call({ mode: "symbol", symbolName: "duplicateName" })
    let sp: any = null
    try { sp = JSON.parse(sy.text) } catch {}
    harness.check("MCP symbol mode returns findSymbol matches", !sy.isError && (sp?.matches ?? []).length >= 1 && JSON.stringify(sp).includes("duplicateName"), sy.text.slice(0, 160))
    // file
    const f = await call({ mode: "file", filePath: "src/app.ts" })
    let fp: any = null
    try { fp = JSON.parse(f.text) } catch {}
    harness.check("MCP file mode returns source envelope", !f.isError && fp?.searchMode === "file" && fp?.file === "src/app.ts" && fp?.content?.includes("handleRequest"), f.text.slice(0, 160))
    // error paths (negatives)
    const e1 = await call({ query: "" })
    harness.negative("MCP rejects empty query", e1.isError && e1.text.includes("non-empty query"), e1.text.slice(0, 140))
    const e2 = await call({ mode: "file" })
    harness.negative("MCP rejects file mode without filePath", e2.isError && e2.text.includes("requires filePath"), e2.text.slice(0, 140))
    const e3 = await call({ mode: "file", filePath: "src/not-indexed.ts" })
    harness.negative("MCP rejects unindexed file", e3.isError && e3.text.includes("file is not indexed"), e3.text.slice(0, 140))
    const e4 = await call({ mode: "file", filePath: "../escape.ts" })
    harness.negative("MCP rejects path escape", e4.isError && e4.text.includes("escapes"), e4.text.slice(0, 140))
    const e5 = await call({ query: 42 })
    harness.negative("MCP rejects non-string query", e5.isError && e5.text.includes("query must be string"), e5.text.slice(0, 140))
  } catch (e) {
    harness.check("MCP bb_search e2e session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}

rmSync(root, { recursive: true, force: true })
harness.emit()
