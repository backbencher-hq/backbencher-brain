// script/m13/verify-analyze-e2e-corpus.ts — M13.53 (An3).
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { Harness } from "./harness"
import { resolveCorpusRoot } from "../lib/corpus-root.ts"

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
// The modes do NOT share one argument shape, and this loop used to pretend they did.
//
// With `catch {}` in place, the disagreement was invisible. Filling in the catch made it
// visible and the gate went red for three of its five modes — and the fault was the GATE'S,
// not bb_analyze's. Measured per mode against the real CLI:
//
//     callers        target required   target "a"        exit 0
//     callees        target required   target "a"        exit 0
//     dependencies   target irrelevant target "a"        exit 1  "irrelevant options: target"
//     stats          target irrelevant target "a"        exit 1  "irrelevant options: target"
//     complexity     no target needed  target "a"        exit 1  "no indexed file matches \"a\""
//                                                          no target      exit 0
//
// So the two shapes are split explicitly rather than guessed. Passing an option a mode
// declares irrelevant is a caller error, and `bb_analyze` is right to refuse it — the gate
// was asserting a contract that does not exist.
const TARGET_MODES = new Set(["callers", "callees"])
for (const mode of MODES) {
  const args = TARGET_MODES.has(mode) ? { mode, target: "a" } : { mode }
  try {
    const out = execFileSync("node", [bb, "tool", "bb_analyze", "--dir", root, "--args",
      JSON.stringify(args)], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    harness.check("CLI "+mode+": output not empty", out.length > 0, "len="+String(out.length))
    } catch (error) {
      harness.check("CLI "+mode+" -- bb_analyze did not run", false, "bb_analyze exited non-zero: " + (error instanceof Error ? error.message.slice(0, 140) : String(error)))
    }
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
// Was: the literal foreign corpus root "$HOME/fixtures/repositories" — see script/lib/corpus-root.ts.
const REPO_ROOT = resolveCorpusRoot(process.cwd()) ?? "REPO_ROOT_UNRESOLVED"
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
      } catch (error) {
        harness.check("corpus "+repo+" "+mode+": bb_analyze did not run", false, "bb_analyze exited non-zero: " + (error instanceof Error ? error.message.slice(0, 140) : String(error)))
      }
    }
  } catch(e) {
    harness.check("corpus "+repo+": session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(ipid)), { recursive: true, force: true }) } catch {}
  }
}

harness.emit()
