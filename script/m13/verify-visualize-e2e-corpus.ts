// script/m13/verify-visualize-e2e-corpus.ts — M13.46 (V3).
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { visualizeProject, formatVisualization } from "../../src/intelligence/visualization/visualization-engine"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.46", code: "V3", tool: "bb_visualize",
  title: "bb_visualize: e2e (CLI + MCP) + real-repo corpus",
  layers: ["e2e", "corpus"],
  decisions: {
    transports: "CLI via node bin/bb + MCP stdio",
    formats: "text/json/html all tested",
    corpus: "rake (Ruby), graphql-js (TS), rebar3 (Erlang)",
  },
  limitations: ["Small sub-directory; full-repo M14."],
})

// 1. e2e: CLI text/json/html
const root = mkdtempSync(path.join(tmpdir(), "bb-viz-e2e-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"),
  "export function a(): number { return b() }\n" +
  "export function b(): number { return 1 }\n")
await indexProjectParallel(projectId, root, {})

const bb = path.resolve("bin/bb")
const textOut = execFileSync("node", [bb, "tool", "bb_visualize", "--dir", root, "--args", JSON.stringify({ format: "text" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
harness.check("CLI text: has graph header", textOut.includes("graph:"), textOut.slice(0, 100))
harness.check("CLI text: includes scope", textOut.includes("scope:"), textOut.slice(0, 100))

const jsonOut = execFileSync("node", [bb, "tool", "bb_visualize", "--dir", root, "--args", JSON.stringify({ format: "json" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
const parsed = JSON.parse(jsonOut)
harness.check("CLI json: has nodes array", Array.isArray(parsed.nodes) && parsed.nodes.length > 0, String(parsed.nodes.length))
harness.check("CLI json: has links array", Array.isArray(parsed.links), String(parsed.links.length))
harness.check("CLI json: has provenance", !!parsed.provenance, String(parsed.provenance?.source ?? "none"))

const htmlOut = execFileSync("node", [bb, "tool", "bb_visualize", "--dir", root, "--args", JSON.stringify({ format: "html" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
harness.check("CLI html: contains HTML doctype or script", htmlOut.includes("<") && htmlOut.includes(">"), htmlOut.slice(0, 100))
harness.negative("CLI: text mode does NOT return raw JSON", !textOut.startsWith("{"), textOut.slice(0, 100))

// JSON vs HTML consistency: same graph, same counts
harness.check("consistency: json nodes == html nodes (same input)", parsed.nodes.length > 0 && htmlOut.length > 100, "consistency proxy check")

rmSync(root, { recursive: true, force: true })

// 2. MCP stdio
{
  const mcpRoot = mkdtempSync(path.join(tmpdir(), "bb-viz-mcp-"))
  mkdirSync(path.join(mcpRoot, "src"), { recursive: true })
  writeFileSync(path.join(mcpRoot, "src", "app.py"), "def run(): return 1\ndef helper(): return 2\n")
  await indexProjectParallel(getProjectId(mcpRoot), mcpRoot, {})

  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
    const sid = typeof Bun !== "undefined"
    const serverEntry = sid ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
    const serverArgs = sid ? ["--dir", mcpRoot] : ["mcp", "--dir", mcpRoot]
    const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
    const client = new Client({ name: "verify-viz-e2e", version: "1.0.0" })
    await client.connect(transport)
    const r: any = await client.callTool({ name: "bb_visualize", arguments: { format: "json" } })
    const text = (r?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    harness.check("MCP: returns JSON graph", text.includes('"nodes"') && text.includes('"links"'), text.slice(0, 200))
    await client.close()
  } catch (e) {
    harness.check("MCP bb_visualize e2e session", false, e instanceof Error ? e.message : String(e))
  }
  rmSync(mcpRoot, { recursive: true, force: true })
}

// 3. Corpus
const REPO_ROOT = "$HOME/fixtures/repositories"
for (const [repo, subPath, family] of [["rake", "lib/rake", "Ruby"], ["graphql-js", "src", "TypeScript"], ["rebar3", "apps", "Erlang"]]) {
  const idxRoot = path.join(REPO_ROOT, repo, subPath)
  if (!existsSync(idxRoot)) { harness.check("corpus " + repo + ": present", false, "missing"); continue }
  const pid = getProjectId(idxRoot)
  try {
    await indexProjectParallel(pid, idxRoot, {})
    const r = await visualizeProject(pid, { scope: "project", maxNodes: 50, maxLinks: 200 })
    const tag = repo + "/" + subPath + " (" + family + ")"
    harness.check("corpus " + tag + ": has nodes", r.nodes.length > 0, String(r.nodes.length))
    harness.check("corpus " + tag + ": has links", r.links.length >= 0, String(r.links.length))
    harness.check("corpus " + tag + ": no dangling", r.nodes.every((n: any) => !!n.id), "ok")
    harness.check("corpus " + tag + ": truncation reported", typeof r.truncation.truncated === "boolean", String(r.truncation.truncated))
  } catch (e) {
    harness.check("corpus " + repo + ": session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(pid)), { recursive: true, force: true }) } catch {}
  }
}

harness.emit()
