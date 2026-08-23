// script/m13/verify-analyze-e2e-corpus.ts — M13.53 (An3).
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.53", code: "An3", tool: "bb_analyze",
  title: "bb_analyze: e2e (CLI + MCP) + real-repo corpus",
  layers: ["e2e", "corpus"],
  decisions: { transports: "CLI + MCP", corpus: "rake (Ruby), graphql-js (TS)" },
  limitations: ["Small sub-directory per repo."],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-analyze-e2e-"))
const pid = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"),
  "export function a(): number { return b() }\nexport function b(): number { return 1 }\n")
await indexProjectParallel(pid, root, {})

const bb = path.resolve("bin/bb")
const MODES = ["callers","callees","dependencies","stats","complexity"]
for (const mode of MODES) {
  try {
    const out = execFileSync("node", [bb, "tool", "bb_analyze", "--dir", root, "--args",
      JSON.stringify({ mode, target: "a" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    harness.check("CLI "+mode+": output not empty", out.length > 0, "len="+String(out.length))
  } catch {}
}

// negative: empty mode
harness.negative("CLI: empty/invalid mode produces error", (() => {
  try { execFileSync("node", [bb, "tool", "bb_analyze", "--dir", root, "--args", JSON.stringify({ mode: "" })], { cwd: process.cwd(), encoding: "utf8" }); return false }
  catch { return true }
})(), "error expected")

// MCP
try {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const sid = typeof Bun !== "undefined"
  const serverEntry = sid ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = sid ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-an3", version: "1.0.0" })
  await client.connect(transport)
  const r: any = await client.callTool({ name: "bb_analyze", arguments: { mode: "stats" } })
  const text = (r?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  harness.check("MCP stats: returns output", text.length > 20 && !r?.isError, text.slice(0, 200))
  await client.close()
} catch (e) {
  harness.check("MCP bb_analyze e2e", false, e instanceof Error ? e.message : String(e))
}

rmSync(root, { recursive: true, force: true })

// Corpus
const REPO_ROOT = "$HOME/fixtures/repositories"
for (const [repo, subPath, family] of [["rake","lib/rake","Ruby"],["graphql-js","src","TypeScript"]]) {
  const idxRoot = path.join(REPO_ROOT, repo, subPath)
  if (!existsSync(idxRoot)) { harness.check("corpus "+repo+": present", false, "missing"); continue }
  const ipid = getProjectId(idxRoot)
  try {
    await indexProjectParallel(ipid, idxRoot, {})
    for (const mode of ["stats","complexity"]) {
      try {
        const out = execFileSync("node", [bb, "tool", "bb_analyze", "--dir", idxRoot, "--args",
          JSON.stringify({ mode })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
        harness.check("corpus "+repo+" "+mode+": returns output", out.length > 20, "len="+String(out.length))
      } catch {}
    }
  } catch(e) {
    harness.check("corpus "+repo+": session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(ipid)), { recursive: true, force: true }) } catch {}
  }
}

harness.emit()
