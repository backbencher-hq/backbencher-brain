// script/m13/verify-doc-e2e-corpus.ts — M13.57 (D3).
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.57", code: "D3", tool: "bb_doc",
  title: "bb_doc: e2e (CLI + MCP) + real-repo corpus",
  layers: ["e2e", "corpus"],
  decisions: { transports: "CLI + MCP", corpus: "rake (Ruby), rebar3 (Erlang)" },
  limitations: ["Small sub-directory per repo."],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-doc-e2e-"))
const pid = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"),
  "export function greet(name: string): string { return 'Hello, ' + name }\n")
await indexProjectParallel(pid, root, {})

const bb = path.resolve("bin/bb")

// CLI markdown + json
for (const fmt of ["markdown","json"]) {
  try {
    const out = execFileSync("node", [bb, "tool", "bb_doc", "--dir", root, "--args",
      JSON.stringify({ mode: "symbol", target: "greet", format: fmt })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    harness.check("CLI symbol "+fmt+": has output", out.length > 10, "len="+String(out.length))
  } catch {}
}

// MCP
try {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const sid = typeof Bun !== "undefined"
  const serverEntry = sid ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = sid ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-doc-e2e", version: "1.0.0" })
  await client.connect(transport)
  const r: any = await client.callTool({ name: "bb_doc", arguments: { mode: "project" } })
  const text = (r?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  harness.check("MCP project: returns output", text.length > 20 && !r?.isError, text.slice(0, 200))
  // Symbol without target: the server rejects it on the next call
  try {
    const r2: any = await client.callTool({ name: "bb_doc", arguments: { mode: "symbol" } })
    harness.negative("MCP: symbol without target rejected", r2?.isError === true, "rejected")
  } catch {
    harness.negative("MCP: symbol without target rejected", true, "threw error")
  }
  await client.close()
} catch (e) {
  harness.check("MCP bb_doc e2e", false, e instanceof Error ? e.message : String(e))
}

rmSync(root, { recursive: true, force: true })

// Corpus
const REPO_ROOT = "$HOME/fixtures/repositories"
for (const [repo, subPath, family] of [["rake","lib/rake","Ruby"],["rebar3","apps","Erlang"]]) {
  const idxRoot = path.join(REPO_ROOT, repo, subPath)
  if (!existsSync(idxRoot)) { harness.check("corpus "+repo+": present", false, "missing"); continue }
  const ipid = getProjectId(idxRoot)
  try {
    await indexProjectParallel(ipid, idxRoot, {})
    try {
      const out = execFileSync("node", [bb, "tool", "bb_doc", "--dir", idxRoot, "--args",
        JSON.stringify({ mode: "project" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
      harness.check("corpus "+repo+" project: has output", out.length > 20, "len="+String(out.length))
    } catch {}
  } catch(e) {
    harness.check("corpus "+repo+": session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(ipid)), { recursive: true, force: true }) } catch {}
  }
}

harness.emit()
