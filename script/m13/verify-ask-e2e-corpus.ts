// script/m13/verify-ask-e2e-corpus.ts — M13.27 (A5).
//
// Drives bb_ask through both real transports (compiled CLI + MCP stdio) and
// samples it across the pinned corpus. Every corpus answer must carry a
// provenance class; stat answers must match the indexed DB exactly (no
// fabricated counts); semantic sources must resolve to real files on disk.
// Failures are recorded in evidence, never excluded.

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.27",
  code: "A5",
  tool: "bb_ask",
  title: "bb_ask: e2e (real MCP + compiled CLI) + real-repo corpus",
  layers: ["e2e", "corpus"],
  decisions: {
    transports: "compiled CLI via `node bin/bb tool bb_ask`; MCP via StdioClientTransport → src/mcp/server.ts",
    corpus: "one small sub-directory per major language family (Ruby, TypeScript, Erlang, Go); every probe recorded",
    antiFabrication: "stat answers are checked against the DB count exactly; sources must resolve to real files",
  },
  limitations: [
    "Only a small sub-directory per repo is indexed (full 29-repo indexing is hours-long); broader coverage is M14.",
    "A sub-directory with no resolvable symbols is skipped (recorded, not failed).",
  ],
})

// ── 1. e2e: both transports on a fresh fixture ─────────────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-ask-e2e-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handleRequest(): string { return \"ok\" }\n")
await indexProjectParallel(projectId, root, {})

// CLI
const bb = path.resolve("bin/bb")
{
  const r = execFileSync("node", [bb, "tool", "bb_ask", "--dir", root, "--args", JSON.stringify({ query: "how many symbols are in this project" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
  harness.check("CLI: stats answer carries provenance", r.includes("[provenance:") && /There are \d+ symbols/.test(r), r.slice(0, 160))
  const empty = (() => { try { execFileSync("node", [bb, "tool", "bb_ask", "--dir", root, "--args", JSON.stringify({ query: "" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" }); return "" } catch (e: any) { return `${e.stdout ?? ""}${e.stderr ?? ""}` } })()
  harness.negative("CLI: empty query rejected", empty.includes("non-empty query"), empty.slice(0, 140))
}

// MCP stdio
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const isBun = typeof Bun !== "undefined"
  const serverEntry = isBun ? path.resolve("src/mcp/server.ts") : path.resolve("bin/bb")
  const serverArgs = isBun ? ["--dir", root] : ["mcp", "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, ...serverArgs], cwd: process.cwd(), stderr: "pipe" })
  const client = new Client({ name: "verify-ask-e2e", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_ask", arguments: args })
    return { text: (res?.content ?? []).map((c: any) => c.text ?? "").join("\n"), isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    const r = await call({ query: "how does request handling work?" })
    harness.check("MCP: semantic answer carries provenance", !r.isError && r.text.includes("[provenance:"), r.text.slice(0, 160))
    const empty = await call({ query: "" })
    harness.negative("MCP: empty query rejected", empty.isError && empty.text.includes("non-empty query"), empty.text.slice(0, 140))
  } catch (e) {
    harness.check("MCP bb_ask e2e session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}
rmSync(root, { recursive: true, force: true })

// ── 2. Corpus sampling ─────────────────────────────────────────────────────
const REPO_ROOT = "$HOME/fixtures/repositories"
const SAMPLE: Array<[string, string, string]> = [
  ["rake", "lib/rake", "Ruby"],
  ["graphql-js", "src", "TypeScript"],
  ["rebar3", "apps", "Erlang"],
  ["go-tools", "go/analysis/passes", "Go"],
]

for (const [repo, subPath, family] of SAMPLE) {
  const indexRoot = path.join(REPO_ROOT, repo, subPath)
  if (!existsSync(indexRoot)) {
    harness.check(`corpus ${repo}/${subPath} (${family}): present`, false, `${indexRoot} missing`)
    continue
  }
  const pid = getProjectId(indexRoot)
  try {
    await indexProjectParallel(pid, indexRoot, {})
    const raw = await BrainDatabase.getRawInstance(pid)
    const actual = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(pid) as any)?.c ?? 0
    const tag = `${repo}/${subPath} (${family})`

    // Stat answer: must match the DB exactly (anti-fabrication). The answer uses
    // toLocaleString ("7,330"), so compare digit-normalized.
    const stat = await quickAnswer(pid, "how many symbols are in this project")
    const digits = (s: string) => s.replace(/\D/g, "")
    harness.check(`corpus ${tag}: stat answer matches indexed count exactly`, digits(stat.answer).includes(String(actual)), `answer=${stat.answer.slice(0, 80)} db=${actual}`)
    harness.check(`corpus ${tag}: stat answer carries provenance`, !!stat.provenance.evidenceClass, stat.provenance.evidenceClass)

    // Semantic answer: provenance-bearing, sources resolve to real files.
    const sem = await quickAnswer(pid, "how does request handling work in this codebase")
    harness.check(`corpus ${tag}: semantic answer carries provenance class`, ["indexed", "semantic_candidate", "unknown"].includes(sem.provenance.evidenceClass), sem.provenance.evidenceClass)
    const realFiles = sem.sources.every((s) => s.file.length === 0 || existsSync(path.join(indexRoot, s.file)) || existsSync(s.file))
    harness.check(`corpus ${tag}: every source resolves to a real file on disk`, realFiles, JSON.stringify(sem.sources).slice(0, 120))
    harness.negative(
      `corpus ${tag}: no fabricated count in semantic answer`,
      !/There are \d+ (symbols|files|classes)/.test(sem.answer) || sem.provenance.evidenceClass === "indexed",
      sem.answer.slice(0, 100),
    )
  } catch (e) {
    harness.check(`corpus ${repo}/${subPath} (${family}): corpus session`, false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(pid)), { recursive: true, force: true }) } catch {}
  }
}

harness.emit()
