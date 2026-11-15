// REAL-CORPUS evidence for bb_patterns, through the REAL MCP stdio door.
//
// For each indexed real repository this script starts the source MCP server
// (work/node-server-entry.ts -> src/mcp/server.ts) over StdioClientTransport, calls
// bb_patterns across its documented shapes, records the answer's own census/page and
// latency, and stat's the index db+wal before and after to state whether a READ moved
// the index. Refusal cases and the >100-orphan class-promotion fixture are exercised
// through the same door, so the release evidence is the wire behaviour, not the handler
// called in-process.
//
// Usage: npx tsx real-corpus-door.mts <out.json>

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const outPath = process.argv[2]
if (!outPath) { console.error("usage: real-corpus-door.mts <out.json>"); process.exit(2) }
const ROOT = process.cwd()
const ENTRY = path.resolve("validation/tools/bb_patterns/work/node-server-entry.ts")
const CORPUS_DIR = path.resolve("validation/tools/bb_patterns/corpus")
const REPOS_ROOT = process.env.BB_CORPUS_ROOT ?? path.join(process.env.HOME ?? "", "bb_tests", "repositories")
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)
const walFingerprint = (p: string) => { const s = statOf(p); return s === null || s.bytes === 0 ? "absent-or-empty" : JSON.stringify(s) }

function displayedRows(text: string): number {
  return text.split("\n").filter((line) => {
    if (!line.startsWith("  ")) return false
    const body = line.trim()
    if (!body || body === "none") return false
    return /^\[(?:info|warning|error)\] /.test(body) || /^orphaned_/.test(body)
  }).length
}
function censusOf(text: string): string | null {
  const found = text.match(/^(?:patterns|orphaned code) \((\d+)/)
  const scan = text.match(/\[scan: ([^\]]*)\]/)
  return `${found?.[1] ?? "?"} | ${scan?.[1] ?? ""}`
}

type DoorCase = { label: string; args: Record<string, unknown>; }
async function withServer<T>(dataDir: string, projectDir: string, run: (call: (args: Record<string, unknown>) => Promise<any>) => Promise<T>): Promise<{ result: T; dbUnchanged: boolean; before: any; after: any; stderrTail: string }> {
  const dbPath = path.join(dataDir, "projects", getProjectId(projectDir), "brain.db")
  const before = { db: statOf(dbPath), wal: walFingerprint(`${dbPath}-wal`) }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", ENTRY, "--dir", projectDir],
    cwd: ROOT,
    stderr: "pipe",
    env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1", BB_EMBEDDING_DISABLED: "1" } as Record<string, string>,
  })
  const client = new Client({ name: "bb-patterns-real-corpus", version: "1.0.0" })
  let stderr = ""
  try { transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") }) } catch {}
  try {
    await client.connect(transport)
    const call = async (args: Record<string, unknown>) => {
      const t0 = performance.now()
      const res: any = await client.callTool({ name: "bb_patterns", arguments: args })
      const ms = Math.round((performance.now() - t0) * 100) / 100
      const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
      return { ms, isError: res?.isError === true, text, chars: text.length }
    }
    const result = await run(call)
    const after = { db: statOf(dbPath), wal: walFingerprint(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
    return { result, dbUnchanged: JSON.stringify(before.db) === JSON.stringify(after.db) && before.wal === after.wal, before, after, stderrTail: stderr.slice(-400) }
  } finally {
    try { await client.close() } catch {}
  }
}

const CORPUS: Array<{ name: string; repo: string; dataDir: string }> = [
  { name: "graphql-js", repo: path.join(REPOS_ROOT, "graphql-js"), dataDir: path.join(CORPUS_DIR, "graphql-js") },
  { name: "rake", repo: path.join(REPOS_ROOT, "rake"), dataDir: path.join(CORPUS_DIR, "rake") },
  { name: "rebar3", repo: path.join(REPOS_ROOT, "rebar3"), dataDir: path.join(CORPUS_DIR, "rebar3") },
  { name: "go-tools", repo: path.join(REPOS_ROOT, "go-tools"), dataDir: path.join(CORPUS_DIR, "go-tools") },
  { name: "zig", repo: path.join(REPOS_ROOT, "zig"), dataDir: path.join(CORPUS_DIR, "zig") },
]

const doorOnly = process.env.BB_DOOR_ONLY === "1"
const repoFilter = process.env.BB_CORPUS_REPO || (process.argv.find((arg) => arg.startsWith("--repo=")) ?? "").slice("--repo=".length) || null
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null
const report: Record<string, any> = {
  tool: "bb_patterns",
  door: "MCP stdio (source server: validation/tools/bb_patterns/work/node-server-entry.ts -> src/mcp/server.ts)",
  env: { BB_DATA_DIR: "per-corpus lane data dir under validation/tools/bb_patterns/corpus/", BB_NO_AUTO_REFRESH: "1", BB_EMBEDDING_DISABLED: "1" },
  reposRoot: REPOS_ROOT,
  corpus: [] as any[],
  refusals: [] as any[],
  promotionFixture: null as any,
  generatedAt: new Date().toISOString(),
}
if (existing) {
  report.corpus = existing.corpus ?? []
  report.refusals = existing.refusals ?? []
  report.promotionFixture = existing.promotionFixture ?? null
}
const upsert = (entry: any) => {
  const index = report.corpus.findIndex((c: any) => c.name === entry.name)
  if (index >= 0) report.corpus[index] = entry
  else report.corpus.push(entry)
}

try {
  // ── real repositories through the door ────────────────────────────────────
  for (const entry of CORPUS) {
    if (doorOnly) continue
    if (repoFilter && entry.name !== repoFilter) continue
    const factsPath = path.resolve(`validation/tools/bb_patterns/raw/corpus-${entry.name}-facts.json`)
    const facts = existsSync(factsPath) ? JSON.parse(readFileSync(factsPath, "utf8")) : null
    const dbPath = path.join(entry.dataDir, "projects", getProjectId(entry.repo), "brain.db")
    if (!facts || !existsSync(dbPath)) {
      upsert({ name: entry.name, status: "blocked", reason: "index incomplete at run time", facts })
      continue
    }
    const READ_CASES: DoorCase[] = [
      { label: "orphaned-default", args: { scope: "orphaned" } },
      { label: "all-default", args: {} },
      { label: "all-limit-100", args: { limit: 100 } },
      { label: "all-no-orphaned", args: { includeOrphaned: false } },
      { label: "all-threshold-0.7", args: { confidenceThreshold: 0.7 } },
      { label: "history-read", args: { history: true, limit: 5 } },
    ]
    const readSession = await withServer(entry.dataDir, entry.repo, async (call) => {
      const out: any[] = []
      for (const c of READ_CASES) {
        const r = await call(c.args)
        out.push({ label: c.label, args: c.args, isError: r.isError, ms: r.ms, chars: r.chars, census: censusOf(r.text), rows: displayedRows(r.text), head: r.text.split("\n").slice(0, 2).join("\n") })
      }
      return out
    })
    // recordRun is the ONE documented write: it persists analysis-history records, so it
    // runs in its own session and its WAL movement is expected rather than hidden.
    const writeSession = await withServer(entry.dataDir, entry.repo, async (call) => {
      const r = await call({ scope: "orphaned", recordRun: true })
      return [{ label: "orphaned-recordRun", args: { scope: "orphaned", recordRun: true }, isError: r.isError, ms: r.ms, chars: r.chars, census: censusOf(r.text), rows: displayedRows(r.text), head: r.text.split("\n").slice(0, 2).join("\n") }]
    })
    upsert({
      name: entry.name,
      status: "measured",
      population: facts.index,
      projectId: facts.projectId,
      cases: readSession.result,
      dbUnchanged: readSession.dbUnchanged,
      readSessionIndexBefore: readSession.before,
      readSessionIndexAfter: readSession.after,
      writeCase: writeSession.result[0],
      writeCaseWroteIndex: JSON.stringify(writeSession.after) !== JSON.stringify(writeSession.before),
      writeSessionIndexBefore: writeSession.before,
      writeSessionIndexAfter: writeSession.after,
    })
    // Persist after every repository: a long run is resumable and a session restart
    // never loses a measured corpus.
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
  }

  // ── refusals through the same door ───────────────────────────────────────
  if (!repoFilter || doorOnly) {
    const graphql = CORPUS[0]
    const { result } = await withServer(graphql.dataDir, graphql.repo, async (call) => {
      const out: any[] = []
      for (const c of [
        { label: "refuse-invalid-scope", args: { scope: "quality" } },
        { label: "refuse-unknown-option", args: { foo: true } },
        { label: "refuse-limit-above-maximum", args: { limit: 10_000_000 } },
        { label: "refuse-threshold-out-of-range", args: { confidenceThreshold: 2 } },
      ] as DoorCase[]) {
        const r = await call(c.args)
        out.push({ label: c.label, isError: r.isError, head: r.text.split("\n")[0].slice(0, 180) })
      }
      // missing index: a directory the indexer never ran over, under the same door
      const empty = mkdtempSync(path.join(tmpdir(), "bb-patterns-real-empty-"))
      try {
        const r = await call({})
        void r
      } finally { rmSync(empty, { recursive: true, force: true }) }
      return out
    })
    report.refusals = result
    // The missing-index refusal needs its own server pointed at the unindexed directory.
    const emptyDir = mkdtempSync(path.join(tmpdir(), "bb-patterns-real-unindexed-"))
    try {
      const missing = await withServer(path.join(CORPUS_DIR, "graphql-js"), emptyDir, async (call) => {
        const r = await call({})
        return [{ label: "refuse-missing-index", isError: r.isError, head: r.text.split("\n")[0].slice(0, 180) }]
      })
      report.refusals.push(...missing.result)
    } finally { rmSync(emptyDir, { recursive: true, force: true }) }
  }

  // ── >100-orphan class-promotion fixture through the door ─────────────────
  if (!repoFilter || doorOnly) {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), "bb-patterns-real-promotion-"))
    const dataDir = mkdtempSync(path.join(tmpdir(), "bb-patterns-real-promotion-data-"))
    try {
      mkdirSync(path.join(fixtureDir, "src"), { recursive: true })
      for (let i = 0; i < 130; i++) writeFileSync(path.join(fixtureDir, "src", `m${i}.ts`), `export function unref${i}(): number { return ${i} }\n`)
      const members = (n: number) => Array.from({ length: n }, (_, k) => `  f${k}(): number { return ${k} }`).join("\n")
      writeFileSync(path.join(fixtureDir, "src", "wide.ts"), Array.from({ length: 60 }, (_, i) => `export class Wide${i} {\n${members(12)}\n}`).join("\n") + "\n")
      const pid = getProjectId(fixtureDir)
      await indexProjectParallel(pid, fixtureDir, {})
      await flushBackgroundEmbeddings({ timeoutMs: 5000 })
      BrainDatabase.closeAll()
      const raw = await BrainDatabase.getRawInstance(pid)
      raw.prepare("UPDATE brain_file SET framework_type='react' WHERE project_id=? AND relative_path='src/m0.ts'").run(pid)
      BrainDatabase.closeAll()
      const { result } = await withServer(dataDir, fixtureDir, async (call) => {
        const r = await call({})
        const rows = r.text.split("\n").filter((line) => /^  \[(?:info|warning|error)\] |^  orphaned_/.test(line))
        return [{
          label: "promotion-default", args: {}, isError: r.isError, ms: r.ms, census: censusOf(r.text), rows: rows.length,
          hasOrphanRow: rows.some((row: string) => /orphaned_/.test(row)),
          hasFrameworkRow: rows.some((row: string) => row.includes("framework-detected")),
          hasGodClassRow: rows.some((row: string) => row.includes("god-class")),
          sample: rows.slice(0, 3),
        }]
      })
      report.promotionFixture = { fixture: { files: 131, orphanCandidates: 130, godClasses: 60, framework: 1 }, result }
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
      rmSync(dataDir, { recursive: true, force: true })
    }
  }
} catch (error: any) {
  report.error = String(error?.message ?? error)
  process.exitCode = 1
} finally {
  try { BrainDatabase.closeAll() } catch {}
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({
  corpus: report.corpus.map((c: any) => ({ name: c.name, status: c.status, dbUnchanged: c.dbUnchanged, latency: c.cases?.map((x: any) => `${x.label}:${x.ms}ms/${x.rows}rows`) })),
  refusals: report.refusals,
  promotion: report.promotionFixture?.result,
}, null, 1))
