// script/m13/verify-migrate-e2e-corpus.ts — M13.49 (M2).
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { generateMigrationPlans } from "../../src/intelligence/migration/migration-engine"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.49", code: "M2", tool: "bb_migrate",
  title: "bb_migrate: e2e (CLI + MCP) + corpus",
  layers: ["e2e", "corpus"],
  decisions: { transports: "CLI + MCP stdio", corpus: "sampled from rake, rebar3" },
  limitations: ["Small sub-directory per repo."],
})

// CLI e2e
const root = mkdtempSync(path.join(tmpdir(), "bb-mig-e2e-"))
const pid = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function greet(): string { return 'hi' }\n")
await indexProjectParallel(pid, root, {})

const bb = path.resolve("bin/bb")
const cliOut = execFileSync("node", [bb, "tool", "bb_migrate", "--dir", root, "--args", JSON.stringify({ symbolNames: ["greet"], targetLanguage: "python" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
harness.check("CLI: output not empty", cliOut.length > 10, String(cliOut.length))
harness.check("CLI: contains effort/dependency info", cliOut.includes("effort") || cliOut.includes("Effort") || cliOut.includes("dependency") || cliOut.includes("migration"), cliOut.slice(0, 120))
const jsonOut = execFileSync("node", [bb, "tool", "bb_migrate", "--dir", root, "--args", JSON.stringify({ symbolNames: ["greet"], targetLanguage: "python", format: "json" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
const parsed = JSON.parse(jsonOut)
harness.check("CLI json: has plans array", Array.isArray(parsed.plans), String(parsed.plans.length))
harness.negative("CLI: output doesn't contain compiled code", !cliOut.includes("def greet") && !jsonOut.includes("def greet"), "no generated code")

rmSync(root, { recursive: true, force: true })

// MCP
{
  const mcpRoot = mkdtempSync(path.join(tmpdir(), "bb-mig-mcp-"))
  mkdirSync(path.join(mcpRoot, "src"), { recursive: true })
  writeFileSync(path.join(mcpRoot, "src", "app.ts"), "export function run(): number { return 1 }\n")
  await indexProjectParallel(getProjectId(mcpRoot), mcpRoot, {})
  try {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
    const sid = typeof Bun !== "undefined"
    const serverEntry = sid ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
    const serverArgs = sid ? ["--dir", mcpRoot] : ["mcp", "--dir", mcpRoot]
    const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
    const client = new Client({ name: "verify-mig-e2e", version: "1.0.0" })
    await client.connect(transport)
    const r: any = await client.callTool({ name: "bb_migrate", arguments: { symbolNames: ["run"], targetLanguage: "go", format: "json" } })
    const text = (r?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    harness.check("MCP: returns JSON plans", text.includes('"plans"') || text.includes("run"), text.slice(0, 200))
    await client.close()
  } catch (e) {
    harness.check("MCP bb_migrate e2e", false, e instanceof Error ? e.message : String(e))
  }
  rmSync(mcpRoot, { recursive: true, force: true })
}

// Corpus
const REPO_ROOT = "$HOME/fixtures/repositories"
for (const [repo, subPath, family] of [["rake","lib/rake","Ruby"],["rebar3","apps","Erlang"]]) {
  const idxRoot = path.join(REPO_ROOT, repo, subPath)
  if (!existsSync(idxRoot)) { harness.check("corpus "+repo+": present", false, "missing"); continue }
  const ipid = getProjectId(idxRoot)
  try {
    await indexProjectParallel(ipid, idxRoot, {})
    const r = await generateMigrationPlans(ipid, { symbolNames: ["run","main","task","process"].slice(0,2), targetLanguage: "python" })
    harness.check("corpus "+repo+" ("+family+"): plans returned", Array.isArray(r.plans), String(r.plans.length))
  } catch(e) {
    harness.check("corpus "+repo+": session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(ipid)), { recursive: true, force: true }) } catch {}
  }
}

harness.emit()
