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
import { resolveCorpusRoot } from "../lib/corpus-root.ts"

const harness = new Harness({
  issue: "M13.49", code: "M2", tool: "bb_migrate",
  title: "bb_migrate: e2e (CLI + MCP) + corpus",
  layers: ["e2e", "corpus"],
  decisions: { transports: "CLI + MCP stdio", corpus: "sampled from rake, rebar3" },
  limitations: ["Small sub-directory per repo."],
})

// Every index this gate builds lives under an isolated BB_DATA_DIR: the checkout's
// own index is not this gate's to touch, and the sandbox home is not writable.
if (!process.env.BB_DATA_DIR) process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-mig-e2e-data-"))
process.env.BB_NO_AUTO_REFRESH = "1"

// CLI e2e
const root = mkdtempSync(path.join(tmpdir(), "bb-mig-e2e-"))
const pid = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function greet(): string { return 'hi' }\n")
await indexProjectParallel(pid, root, {})

// Source door: bin/bb runs the stale dist build, and this gate must exercise the
// working tree. Under bun the CLI source entry runs directly; under node it runs
// through tsx.
const isBun = typeof Bun !== "undefined"
const cliEntry = path.resolve("src/cli/index.ts")
const cliCommand = isBun ? process.execPath : "npx"
const cliArgs = (extra: string[]) => (isBun ? [cliEntry, ...extra] : ["tsx", cliEntry, ...extra])
const cliOut = execFileSync(cliCommand, cliArgs(["tool", "bb_migrate", "--dir", root, "--args", JSON.stringify({ symbolNames: ["greet"], targetLanguage: "python" })]), { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
harness.check("CLI: output not empty", cliOut.length > 10, String(cliOut.length))
harness.check("CLI: contains effort/dependency info", cliOut.includes("effort") || cliOut.includes("Effort") || cliOut.includes("dependency") || cliOut.includes("migration"), cliOut.slice(0, 120))
const jsonOut = execFileSync(cliCommand, cliArgs(["tool", "bb_migrate", "--dir", root, "--args", JSON.stringify({ symbolNames: ["greet"], targetLanguage: "python", format: "json" })]), { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
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
    const serverEntry = path.resolve("src/mcp/server.ts")
    const serverArgs = isBun ? [serverEntry, "--dir", mcpRoot] : ["--import", "tsx", serverEntry, "--dir", mcpRoot]
    // The MCP SDK's default child environment is an ALLOWLIST that drops
    // BB_DATA_DIR, so the child silently reads a different (or absent) index than
    // the one this gate built. Forward the two variables the tool depends on.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: serverArgs,
      cwd: process.cwd(),
      stderr: "pipe",
      env: { ...process.env, BB_DATA_DIR: process.env.BB_DATA_DIR!, BB_NO_AUTO_REFRESH: "1" } as Record<string, string>,
    })
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
// Was: the literal foreign corpus root "$HOME/fixtures/repositories" — see script/lib/corpus-root.ts.
const REPO_ROOT = resolveCorpusRoot(process.cwd()) ?? "REPO_ROOT_UNRESOLVED"
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
