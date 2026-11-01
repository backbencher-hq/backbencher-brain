// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the end-to-end gate for bb_analyze over the REAL doors:
//   MCP stdio (spawned from the source tree) and the CLI (source entry), plus
//   the two real-repository corpus legs.
// WHICH TOOL IT SERVES — bb_analyze (read, requiresIndex, 11 modes).
// WHY IT IS SHAPED THIS WAY — the previous version had three defects that made
//   its red/green say nothing about the product: (1) each CLI call was wrapped
//   in `try { } catch { }` with an EMPTY catch, so a failing mode emitted no
//   check at all instead of a red one; (2) the MCP transport was built without
//   `env`, and the SDK's default allowlist drops BB_DATA_DIR, so the server
//   answered "No index found" — a red that described the harness; (3) both legs
//   ran `node bin/bb`, i.e. the gitignored dist build, not the working tree.
//   This version passes the environment through, gives every leg a check even on
//   failure, runs the SOURCE doors (bun entry / tsx MCP server), and exercises
//   all eleven modes rather than one.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/an3.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_analyze/*, the source
//   CLI entry (src/cli/index.ts) and the MCP server entry (src/mcp/server.ts).
// CONTRACTS IT MUST NOT BREAK — no silent skip: every mode, transport and corpus
//   leg contributes exactly one check.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { Harness } from "./harness"
import { resolveCorpusRoot, corpusRootCandidates } from "../lib/corpus-root.ts"

const harness = new Harness({
  issue: "M13.53",
  code: "An3",
  tool: "bb_analyze",
  title: "bb_analyze: e2e over MCP and CLI source doors + real-repo corpus",
  layers: ["e2e", "corpus"],
  decisions: { transports: "MCP stdio + CLI, both from the source tree", corpus: "rake (Ruby), graphql-js (TypeScript)" },
  limitations: ["Small sub-directory per repo."],
})

if (!process.env.BB_DATA_DIR) process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-analyze-an3-data-"))
process.env.BB_NO_AUTO_REFRESH = "1"

const root = mkdtempSync(path.join(tmpdir(), "bb-analyze-e2e-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"),
  "export function a(): number { return b() }\nexport function b(): number { return 1 }\n")
mkdirSync(path.join(root, "test"), { recursive: true })
writeFileSync(path.join(root, "test", "app.test.ts"),
  "import { a } from '../src/app'\ntest('a', () => { expect(a()).toBe(1) })\n")
await indexProjectParallel(projectId, root, {})

// Per-mode arguments the mode ACCEPTS; asking dependencies for a `target` was
// how the old corpus leg could pass while answering a refusal.
const MODES: Array<[string, Record<string, unknown>]> = [
  ["callers", { mode: "callers", target: "b" }],
  ["callees", { mode: "callees", target: "a" }],
  ["trace", { mode: "trace", target: "a" }],
  ["dependencies", { mode: "dependencies", filePath: "src" }],
  ["stats", { mode: "stats" }],
  ["complexity", { mode: "complexity", target: "src" }],
  ["impact", { mode: "impact", target: "a" }],
  ["test_mapping", { mode: "test_mapping" }],
  ["test_gaps", { mode: "test_gaps" }],
  ["test_impact", { mode: "test_impact", target: "a" }],
  ["test_quality", { mode: "test_quality" }],
]

// ── CLI door: source entry under bun (no dist dependency) ──────────────────
const cliArgs = (args: Record<string, unknown>) => ["run", path.resolve("src/cli/index.ts"), "tool", "bb_analyze", "--dir", root, "--args", JSON.stringify(args)]
for (const [mode, args] of MODES) {
  let out = ""
  let failed: string | null = null
  try {
    out = execFileSync("bun", cliArgs(args), { cwd: process.cwd(), encoding: "utf8", stdio: "pipe", env: process.env as Record<string, string> })
  } catch (e: any) {
    failed = `exit ${e?.status ?? "?"}: ${(e?.stderr || e?.stdout || "").toString().slice(0, 120)}`
    out = (e?.stdout || "").toString()
  }
  harness.check(`CLI ${mode}: answers through the source door`, failed === null && out.length > 20 && !/"isError":\s*true/.test(out), failed ?? `len=${out.length}`)
  if (failed === null) {
    let json: any = null
    try { json = JSON.parse(out) } catch {}
    harness.check(`CLI ${mode}: JSON answer`, json !== null, out.slice(0, 100))
  }
}
// The CLI must exit non-zero on a refused call: a door that reports success for
// an error result is a false success for any scripted caller.
let refusalExit = 0
let refusalOut = ""
try {
  refusalOut = execFileSync("bun", cliArgs({ mode: "dependencies", limit: 0 }), { cwd: process.cwd(), encoding: "utf8", stdio: "pipe", env: process.env as Record<string, string> })
  refusalExit = 0
} catch (e: any) {
  refusalExit = e?.status ?? 1
  refusalOut = (e?.stdout || e?.stderr || "").toString()
}
harness.negative("CLI: a refused call exits non-zero", refusalExit !== 0, `exit=${refusalExit}`)
harness.negative("CLI: the refusal names the rule", /limit must be at least 1/.test(refusalOut), refusalOut.slice(0, 120))

// ── MCP stdio door: source server, environment passed through ──────────────
try {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const isBun = typeof Bun !== "undefined"
  const transport = new StdioClientTransport({
    command: isBun ? "bun" : "npx",
    args: isBun ? [path.resolve("src/mcp/server.ts"), "--dir", root] : ["tsx", path.resolve("src/mcp/server.ts"), "--dir", root],
    cwd: process.cwd(),
    // The SDK's default environment allowlist drops BB_DATA_DIR; pass ours so
    // the server reads the index this gate built (the verify-mcp pattern).
    env: process.env as Record<string, string>,
    stderr: "pipe",
  })
  const client = new Client({ name: "verify-an3", version: "1.0.0" })
  await client.connect(transport)
  const list: any = await client.listTools()
  const analyze = list.tools.find((tool: any) => tool.name === "bb_analyze")
  harness.check("MCP: bb_analyze is advertised", !!analyze, "missing")
  harness.check("MCP: the advertised schema carries all 11 modes", (analyze?.inputSchema?.properties?.mode?.enum ?? []).length === 11, String((analyze?.inputSchema?.properties?.mode?.enum ?? []).length))
  for (const [mode, args] of MODES) {
    const r: any = await client.callTool({ name: "bb_analyze", arguments: args })
    const text = (r?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    let json: any = null
    try { json = JSON.parse(text) } catch {}
    harness.check(`MCP ${mode}: answers with JSON and isError=false`, r?.isError !== true && json !== null && text.length > 20, text.slice(0, 120))
  }
  const refused: any = await client.callTool({ name: "bb_analyze", arguments: { mode: "callers", target: "" } })
  harness.negative("MCP: a refused call carries isError:true", refused?.isError === true, JSON.stringify(refused?.content?.[0]?.text ?? "").slice(0, 120))
  await client.close()
} catch (e: any) {
  harness.check("MCP bb_analyze e2e", false, e instanceof Error ? e.message : String(e))
}

rmSync(root, { recursive: true, force: true })
try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}

// ── corpus legs: real repositories, with a DECLARED block when absent ──────
const REPO_ROOT = resolveCorpusRoot(process.cwd())
if (!REPO_ROOT) {
  harness.check("corpus present", false, `no corpus found; searched: ${corpusRootCandidates(process.cwd()).join(", ")}`)
} else {
  for (const [repo, subPath] of [["rake", "lib/rake"], ["graphql-js", "src"]]) {
    const idxRoot = path.join(REPO_ROOT, repo, subPath)
    if (!existsSync(idxRoot)) {
      harness.check(`corpus ${repo}: present at ${idxRoot}`, false, "missing")
      continue
    }
    const ipid = getProjectId(idxRoot)
    try {
      await indexProjectParallel(ipid, idxRoot, {})
      for (const args of [{ mode: "stats" }, { mode: "complexity" }]) {
        let out = ""
        let failed: string | null = null
        try {
          out = execFileSync("bun", cliArgsAt(idxRoot, args), { cwd: process.cwd(), encoding: "utf8", stdio: "pipe", env: process.env as Record<string, string> })
        } catch (e: any) {
          failed = `exit ${e?.status ?? "?"}: ${(e?.stderr || "").toString().slice(0, 100)}`
        }
        harness.check(`corpus ${repo} ${args.mode}: answers on a real repo`, failed === null && out.length > 20, failed ?? `len=${out.length}`)
      }
    } catch (e: any) {
      harness.check(`corpus ${repo}: session`, false, e instanceof Error ? e.message : String(e))
    } finally {
      try { rmSync(path.dirname(BrainDatabase.getDbPath(ipid)), { recursive: true, force: true }) } catch {}
    }
  }
}

function cliArgsAt(dir: string, args: Record<string, unknown>): string[] {
  return ["run", path.resolve("src/cli/index.ts"), "tool", "bb_analyze", "--dir", dir, "--args", JSON.stringify(args)]
}

harness.emit()
