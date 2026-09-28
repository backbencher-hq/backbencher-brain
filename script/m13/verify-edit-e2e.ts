// script/m13/verify-edit-e2e.ts — M13.14 (E9).
//
// Exercises all five bb_edit modes and their error paths through BOTH real
// transports: the compiled Node CLI (`node bin/bb tool bb_edit …`) and the
// real MCP stdio server (StdioClientTransport → src/mcp/server.ts). Proves
// dry-run performs zero writes in both transports.

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.14",
  code: "E9",
  tool: "bb_edit",
  title: "bb_edit: e2e (real MCP + compiled CLI, all five modes)",
  layers: ["e2e"],
  decisions: {
    transports: "compiled CLI via `node bin/bb tool bb_edit --dir <root> --args <json>`; MCP via StdioClientTransport → src/mcp/server.ts (Bun runs server.ts directly, Node uses bin/bb mcp)",
    dryRun: "every positive case uses dryRun:true so no file is written; a separate check confirms the target file does NOT exist after a dry-run write",
  },
  limitations: [
    "The CLI transport reads the prebuilt bin/bb; run `npm run build` before this verifier.",
    "MCP stdio under Bun executes src/mcp/server.ts directly (no build needed for that path).",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-edit-e2e-"))
const projectId = getProjectId(root)
const srcDir = path.join(root, "src")
mkdirSync(srcDir, { recursive: true })
writeFileSync(path.join(srcDir, "app.ts"), "export function e2eTarget(): number { return 1 }\nexport function e2eCaller(): number { return e2eTarget() }\n")
writeFileSync(path.join(srcDir, "solo.ts"), "export function solo(): number { return 9 }\n")
await indexProjectParallel(projectId, root, {})

const bb = path.resolve("bin/bb")
const isBun = typeof Bun !== "undefined"

// ── CLI transport: all five modes (dry-run, zero writes) ──────────────────
function cli(args: Record<string, unknown>): { text: string; ok: boolean } {
  try {
    const out = execFileSync("node", [bb, "tool", "bb_edit", "--dir", root, "--args", JSON.stringify(args)], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    return { text: out, ok: true }
  } catch (e: any) {
    return { text: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`, ok: false }
  }
}

{
  // write (dry-run → no file created)
  const r = cli({ mode: "write", dryRun: true, filePath: "src/written.ts", content: "export const w = 1\n" })
  harness.check("CLI write dry-run succeeds", r.ok && r.text.includes('"dryRun": true'), r.text.slice(0, 160))
  harness.check("CLI write dry-run performs zero writes", !existsSync(path.join(srcDir, "written.ts")))
}
{
  // update
  const r = cli({ mode: "update", dryRun: true, symbolName: "e2eTarget", filePath: "src/app.ts", newContent: "return 42" })
  harness.check("CLI update dry-run succeeds", r.ok && r.text.includes('"dryRun": true'), r.text.slice(0, 160))
}
{
  // insert
  const r = cli({ mode: "insert", dryRun: true, targetSymbolName: "e2eTarget", filePath: "src/app.ts", position: "inside-bottom", newContent: "const ins = true" })
  harness.check("CLI insert dry-run succeeds", r.ok && r.text.includes('"dryRun": true'), r.text.slice(0, 160))
}
{
  // delete (dry-run)
  const r = cli({ mode: "delete", dryRun: true, symbolName: "solo", filePath: "src/solo.ts" })
  harness.check("CLI delete dry-run succeeds", r.ok && r.text.includes('"dryRun": true'), r.text.slice(0, 160))
  harness.check("CLI delete dry-run leaves the file untouched", readFileSync(path.join(srcDir, "solo.ts"), "utf8").includes("function solo"))
}
{
  // refactor
  const r = cli({ mode: "refactor", dryRun: true, symbolName: "e2eTarget", filePath: "src/app.ts", newName: "renamedTarget" })
  harness.check("CLI refactor dry-run succeeds", r.ok && r.text.includes('"dryRun": true'), r.text.slice(0, 160))
}
// CLI error paths (negatives)
{
  const r = cli({ mode: "write", content: "x" })
  harness.negative("CLI rejects write without filePath", !r.ok && r.text.includes("requires filePath"), r.text.slice(0, 140))
}
{
  const r = cli({ mode: "refactor", symbolName: "e2eTarget" })
  harness.negative("CLI rejects refactor without newName", !r.ok && (r.text.includes("requires newName") || r.text.includes("newName")), r.text.slice(0, 140))
}
{
  const r = cli({ mode: "write", filePath: "../escape.ts", content: "x" })
  harness.negative("CLI rejects path escape", !r.ok && r.text.includes("escapes"), r.text.slice(0, 140))
}

// ── MCP stdio transport: all five modes (dry-run) + error paths ───────────
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = isBun ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-edit-e2e", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_edit", arguments: args })
    const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    return { text, isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    // write
    const w = await call({ mode: "write", dryRun: true, filePath: "src/mcp-written.ts", content: "export const m = 1\n" })
    harness.check("MCP write dry-run succeeds", !w.isError && w.text.includes('"dryRun": true'), w.text.slice(0, 160))
    harness.check("MCP write dry-run performs zero writes", !existsSync(path.join(srcDir, "mcp-written.ts")))
    // update
    const u = await call({ mode: "update", dryRun: true, symbolName: "e2eTarget", filePath: "src/app.ts", newContent: "return 42" })
    harness.check("MCP update dry-run succeeds", !u.isError && u.text.includes('"dryRun": true'), u.text.slice(0, 160))
    // insert
    const i = await call({ mode: "insert", dryRun: true, targetSymbolName: "e2eTarget", filePath: "src/app.ts", position: "inside-bottom", newContent: "const ins = true" })
    harness.check("MCP insert dry-run succeeds", !i.isError && i.text.includes('"dryRun": true'), i.text.slice(0, 160))
    // delete
    const d = await call({ mode: "delete", dryRun: true, symbolName: "solo", filePath: "src/solo.ts" })
    harness.check("MCP delete dry-run succeeds", !d.isError && d.text.includes('"dryRun": true'), d.text.slice(0, 160))
    // refactor
    const rf = await call({ mode: "refactor", dryRun: true, symbolName: "e2eTarget", filePath: "src/app.ts", newName: "renamedTarget" })
    harness.check("MCP refactor dry-run succeeds", !rf.isError && rf.text.includes('"dryRun": true'), rf.text.slice(0, 160))
    // error paths (negatives)
    const e1 = await call({ mode: "write", content: "x" })
    harness.negative("MCP rejects write without filePath", e1.isError && e1.text.includes("requires filePath"), e1.text.slice(0, 140))
    const e2 = await call({ mode: "write", filePath: "../escape.ts", content: "x" })
    harness.negative("MCP rejects path escape", e2.isError && e2.text.includes("escapes"), e2.text.slice(0, 140))
    const e3 = await call({ mode: "refactor", symbolName: "nonexistentSymbol", newName: "x", filePath: "src/app.ts" })
    harness.negative("MCP rejects unknown symbol", e3.isError, e3.text.slice(0, 140))
  } catch (e) {
    harness.check("MCP bb_edit e2e session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}

rmSync(root, { recursive: true, force: true })
rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })

harness.emit()
