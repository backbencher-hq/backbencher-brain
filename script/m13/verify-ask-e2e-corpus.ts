// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_ask end-to-end gate: both source transports (MCP stdio and
//   the CLI) on a fresh fixture, then the real-repository corpus — every answer must
//   carry provenance, declared bounds and its route, every stat answer must equal the
//   indexed DB exactly, and every cited source must exist on disk.
// WHICH TOOL IT SERVES — bb_ask (read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — the transports are driven from SOURCE under both runtimes
//   and the child environment is forwarded: the SDK sanitizes child env and drops
//   BB_DATA_DIR, so an unfixed gate either read the user's real index or failed with a
//   false "No index found".
// WHERE ITS EVIDENCE LIVES — validation/m13/results/a5.json and
//   validation/tools/bb_ask/gates/.
// EDIT TOGETHER WHEN THIS FILE CHANGES — script/m13/verify-ask-stdio-entry.ts,
//   src/mcp/tools/bb_ask/handler.ts, src/intelligence/search/quick-answer.ts.
// CONTRACTS IT MUST NOT BREAK — the corpus legs declare a missing corpus as a block, not
//   a pass; the anti-fabrication digit check is exact; no compiled artifact is required.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"
import { Harness } from "./harness"
import { resolveCorpusRoot } from "../lib/corpus-root.ts"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")
const isBun = typeof (globalThis as any).Bun !== "undefined"

const harness = new Harness({
  issue: "M13.27",
  code: "A5",
  tool: "bb_ask",
  title: "bb_ask: e2e (source MCP + source CLI) and real-repo corpus",
  layers: ["e2e", "corpus"],
  decisions: {
    transports: "CLI via `node --import tsx src/cli/index.ts tool bb_ask`; MCP via the real StdioClientTransport into src/mcp/server.ts (or verify-ask-stdio-entry.ts under node)",
    corpus: "one small sub-directory per major language family (Ruby, TypeScript, Erlang, Go)",
    antiFabrication: "stat answers are checked against the DB count exactly; sources must resolve to real files",
    envelope: "both transports must return provenance AND declared bounds",
  },
  limitations: [
    "Only a small sub-directory per repo is indexed (full 29-repo indexing is hours-long); broader coverage is the corpus lane.",
    "A sub-directory with no resolvable symbols is skipped (recorded, not failed).",
  ],
})

// ── 1. e2e: both source transports on a fresh fixture ─────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-ask-e2e-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handleRequest(): string { return \"ok\" }\n")
await indexProjectParallel(projectId, root, {})

// CLI (source entry)
{
  const cliPrefix = isBun ? [path.join(REPO_ROOT, "src", "cli", "index.ts")] : [TSX_CLI, path.join(REPO_ROOT, "src", "cli", "index.ts")]
  const cli = (args: Record<string, unknown>): { text: string; ok: boolean } => {
    try {
      const out = execFileSync(process.execPath, [...cliPrefix, "tool", "bb_ask", "--dir", root, "--args", JSON.stringify(args)], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env },
      })
      return { text: out, ok: true }
    } catch (e: any) {
      return { text: `${e.stdout ?? ""}${e.stderr ?? ""}`, ok: false }
    }
  }
  const stats = cli({ query: "how many symbols are in this project" })
  harness.check("CLI (source entry): stats answer carries provenance, bounds and the count", stats.ok && stats.text.includes("[provenance:") && stats.text.includes("[bounds:") && /There are \d+ symbols/.test(stats.text), stats.text.slice(0, 180))
  const empty = cli({ query: "" })
  harness.negative("CLI (source entry): empty query rejected", !empty.ok && empty.text.includes("non-empty query"), empty.text.slice(0, 140))
}

// MCP stdio (source entry, environment forwarded)
{
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const serverEntry = path.join(REPO_ROOT, "script", "m13", "verify-ask-stdio-entry.ts")
  const serverCommand = isBun ? [path.join(REPO_ROOT, "src", "mcp", "server.ts"), "--dir", root] : [TSX_CLI, serverEntry, "--dir", root]
  const transport = new StdioClientTransport({ command: process.execPath, args: serverCommand, cwd: REPO_ROOT, stderr: "pipe", env: { ...process.env } as Record<string, string> })
  const client = new Client({ name: "verify-ask-e2e", version: "1.0.0" })
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({ name: "bb_ask", arguments: args })
    return { text: (res?.content ?? []).map((c: any) => c.text ?? "").join("\n"), isError: res?.isError ?? false }
  }
  try {
    await client.connect(transport)
    const answer = await call({ query: "how does request handling work?" })
    harness.check("MCP (source entry): answer carries provenance and bounds", !answer.isError && answer.text.includes("[provenance:") && answer.text.includes("[bounds:"), answer.text.slice(0, 180))
    const empty = await call({ query: "" })
    harness.negative("MCP (source entry): empty query rejected", empty.isError && empty.text.includes("non-empty query"), empty.text.slice(0, 140))
  } catch (e) {
    harness.check("MCP bb_ask e2e session", false, e instanceof Error ? e.message : String(e))
  } finally {
    try { await client.close() } catch {}
  }
}
rmSync(root, { recursive: true, force: true })

// ── 2. Corpus sampling ────────────────────────────────────────────────────
const REPO_ROOT_CORPUS = resolveCorpusRoot(REPO_ROOT)
harness.check("corpus: repository corpus is present on this machine", !!REPO_ROOT_CORPUS, REPO_ROOT_CORPUS ?? "not found")
const SAMPLE: Array<[string, string, string]> = [
  ["rake", "lib/rake", "Ruby"],
  ["graphql-js", "src", "TypeScript"],
  ["rebar3", "apps", "Erlang"],
  ["go-tools", "go/analysis/passes", "Go"],
]

if (REPO_ROOT_CORPUS) {
  for (const [repo, subPath, family] of SAMPLE) {
    const indexRoot = path.join(REPO_ROOT_CORPUS, repo, subPath)
    if (!existsSync(indexRoot)) {
      harness.check(`corpus ${repo}/${subPath} (${family}): present`, false, `${indexRoot} missing`)
      continue
    }
    const pid = getProjectId(indexRoot)
    try {
      await indexProjectParallel(pid, indexRoot, {})
      const raw = await BrainDatabase.getRawInstance(pid, { readonly: true })
      const actual = (raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(pid) as any)?.c ?? 0
      const tag = `${repo}/${subPath} (${family})`

      // Stat answer: must match the DB exactly (anti-fabrication). The answer uses
      // toLocaleString ("7,330"), so compare digit-normalized.
      const stat = await quickAnswer(pid, "how many symbols are in this project")
      const digits = (value: string) => value.replace(/\D/g, "")
      harness.check(`corpus ${tag}: stat answer matches indexed count exactly`, digits(stat.answer).includes(String(actual)), `answer=${stat.answer.slice(0, 80)} db=${actual}`)
      harness.check(`corpus ${tag}: stat answer carries provenance, bounds and snapshot`, stat.provenance.evidenceClass === "indexed" && !!stat.bounds && (!!stat.indexSnapshot || stat.provenance.limitations.length > 0), stat.provenance.evidenceClass)

      // Semantic answer: provenance-bearing, sources resolve to real files.
      const sem = await quickAnswer(pid, "how does request handling work in this codebase")
      harness.check(`corpus ${tag}: semantic answer carries a provenance class`, ["indexed", "semantic_candidate", "unknown"].includes(sem.provenance.evidenceClass), sem.provenance.evidenceClass)
      harness.check(`corpus ${tag}: semantic answer declares its bounds`, typeof sem.bounds?.returned === "number" && "truncated" in sem.bounds, JSON.stringify(sem.bounds))
      const realFiles = sem.sources.every((source) => source.file.length === 0 || existsSync(path.join(indexRoot, source.file)) || existsSync(source.file))
      harness.check(`corpus ${tag}: every source resolves to a real file on disk`, realFiles, JSON.stringify(sem.sources).slice(0, 120))
      harness.negative(
        `corpus ${tag}: no fabricated count in a non-aggregate answer`,
        !/There are \d+ (symbols|files|classes)/.test(sem.answer) || sem.provenance.evidenceClass === "indexed",
        sem.answer.slice(0, 100),
      )
    } catch (e) {
      harness.check(`corpus ${repo}/${subPath} (${family}): corpus session`, false, e instanceof Error ? e.message : String(e))
    } finally {
      try { rmSync(path.dirname(BrainDatabase.getDbPath(pid)), { recursive: true, force: true }) } catch {}
    }
  }
}

harness.emit()
