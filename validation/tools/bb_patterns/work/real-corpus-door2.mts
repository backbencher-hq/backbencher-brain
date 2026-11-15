// REAL-CORPUS evidence v2 — minimal, self-contained, per-repo resilient.
// Each repository: READ session (orphaned, all-default, all-limit-100, history) with
// db+WAL snapshotted before/after (a read must leave them alone), then a separate
// recordRun session (the one documented write). Refusals and the >100-orphan promotion
// fixture run in their own sessions. The report is rewritten after every repository.
//
// Usage: BB_DATA_DIR=<lane> npx tsx real-corpus-door2.mts <out.json>
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const outPath = path.resolve(process.argv[2] ?? "validation/tools/bb_patterns/REAL-CORPUS.json")
const ROOT = process.cwd()
const ENTRY = path.resolve("validation/tools/bb_patterns/work/node-server-entry.ts")
const CORPUS_DIR = path.resolve("validation/tools/bb_patterns/corpus")
const REPOS_ROOT = process.env.BB_CORPUS_ROOT ?? path.join(process.env.HOME ?? "", "bb_tests", "repositories")
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)
const walOf = (p: string) => { const s = statOf(p); return s === null || s.bytes === 0 ? "absent-or-empty" : JSON.stringify(s) }
const rowsOf = (text: string) => text.split("\n").filter((line) => line.startsWith("  ") && line.trim() !== "" && line.trim() !== "none" && (/^\[(?:info|warning|error)\] /.test(line.trim()) || /^orphaned_/.test(line.trim()))).length
const censusOf = (text: string) => `${(text.match(/^(?:patterns|orphaned code) \((\d+)/) ?? [])[1] ?? "?"} | ${(text.match(/\[scan: ([^\]]*)\]/) ?? [])[1] ?? ""}`

type Case = { label: string; args: Record<string, unknown> }
async function door<T>(repoDir: string, dataDir: string, run: (call: (args: Record<string, unknown>) => Promise<any>) => Promise<T>) {
  const dbPath = path.join(dataDir, "projects", getProjectId(repoDir), "brain.db")
  const before = { db: statOf(dbPath), wal: walOf(`${dbPath}-wal`) }
  // BUN-ONLY vs node: under bun the entry runs directly (bun executes TS); under node
  // it needs --import tsx. Hardcoding the node form made every child die under a bun
  // parent and the client reported "Connection closed" for every repository.
  const runtimeArgs = typeof (globalThis as any).Bun !== "undefined" ? [ENTRY, "--dir", repoDir] : ["--import", "tsx", ENTRY, "--dir", repoDir]
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: runtimeArgs,
    cwd: ROOT,
    stderr: "pipe",
    env: { ...process.env, BB_DATA_DIR: dataDir, BB_NO_AUTO_REFRESH: "1", BB_EMBEDDING_DISABLED: "1" } as Record<string, string>,
  })
  const client = new Client({ name: "bb-real-corpus", version: "1.0.0" })
  try {
    await client.connect(transport)
    let failure: string | null = null
    const call = async (args: Record<string, unknown>) => {
      const t0 = performance.now()
      const res: any = await client.callTool({ name: "bb_patterns", arguments: args })
      const text = (res?.content ?? []).map((c: any) => c.text ?? "").join("\n")
      return { ms: Math.round((performance.now() - t0) * 100) / 100, isError: res?.isError === true, text }
    }
    let result: T | null = null
    try { result = await run(call) } catch (error: any) { failure = String(error?.message ?? error) }
    const after = { db: statOf(dbPath), wal: walOf(`${dbPath}-wal`) }
    return { result, failure, readsMovedDbOrWal: JSON.stringify(before.db) !== JSON.stringify(after.db) || before.wal !== after.wal, before, after }
  } finally { try { await client.close() } catch {} }
}
const caseLines = async (call: any, cases: Case[]) => {
  const out: any[] = []
  for (const c of cases) {
    try {
      const r = await call(c.args)
      out.push({ label: c.label, args: c.args, isError: r.isError, ms: r.ms, chars: r.text.length, census: censusOf(r.text), rows: rowsOf(r.text), head: r.text.split("\n")[0]?.slice(0, 200) })
    } catch (error: any) {
      out.push({ label: c.label, args: c.args, error: String(error?.message ?? error) })
    }
  }
  return out
}

const READ_CASES: Case[] = [
  { label: "orphaned-default", args: { scope: "orphaned" } },
  { label: "all-default", args: {} },
  { label: "all-limit-100", args: { limit: 100 } },
  { label: "history-read", args: { history: true, limit: 5 } },
]
const REPOS = ["graphql-js", "rake", "rebar3", "go-tools", "zig"]
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null
const report: any = {
  tool: "bb_patterns",
  door: "MCP stdio (source server via validation/tools/bb_patterns/work/node-server-entry.ts -> src/mcp/server.ts)",
  env: { BB_DATA_DIR: "per-corpus lane dir", BB_NO_AUTO_REFRESH: "1", BB_EMBEDDING_DISABLED: "1" },
  reposRoot: REPOS_ROOT,
  corpus: Array.isArray(existing?.corpus) ? existing.corpus.filter((c: any) => !c.remeasure) : [],
  refusals: existing?.refusals ?? [],
  promotionFixture: existing?.promotionFixture ?? null,
  generatedAt: new Date().toISOString(),
}
const save = () => writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")

const doorOnly = process.env.BB_DOOR_ONLY === "1"
const pick = doorOnly ? [] : process.env.BB_CORPUS_REPO ? REPOS.filter((r) => r === process.env.BB_CORPUS_REPO) : REPOS
for (const name of pick) {
  const repoDir = path.join(REPOS_ROOT, name)
  const dataDir = path.join(CORPUS_DIR, name)
  const factsPath = path.resolve(`validation/tools/bb_patterns/raw/corpus-${name}-facts.json`)
  const dbPath = path.join(dataDir, "projects", getProjectId(repoDir), "brain.db")
  if (!existsSync(factsPath) || !existsSync(dbPath)) {
    report.corpus = report.corpus.filter((c: any) => c.name !== name)
    report.corpus.push({ name, status: "blocked", reason: "index incomplete when the door was run" })
    save()
    continue
  }
  const facts = JSON.parse(readFileSync(factsPath, "utf8"))
  let entry: any = { name, status: "measured", population: facts.index, projectId: facts.projectId }
  try {
    const reads = await door(repoDir, dataDir, async (call) => caseLines(call, READ_CASES))
    entry = { ...entry, readCases: reads.result, readsMovedDbOrWal: reads.readsMovedDbOrWal, readIndexBefore: reads.before, readIndexAfter: reads.after, readFailure: reads.failure }
    const write = await door(repoDir, dataDir, async (call) => caseLines(call, [{ label: "orphaned-recordRun", args: { scope: "orphaned", recordRun: true } }]))
    entry.writeCase = write.result?.[0] ?? null
    entry.writeCaseWroteIndex = write.readsMovedDbOrWal
    entry.writeIndexBefore = write.before
    entry.writeIndexAfter = write.after
    entry.writeFailure = write.failure
    report.corpus = report.corpus.filter((c: any) => c.name !== name)
    report.corpus.push(entry)
  } catch (error: any) {
    entry.error = String(error?.message ?? error)
    report.corpus = report.corpus.filter((c: any) => c.name !== name)
    report.corpus.push(entry)
  }
  report.generatedAt = new Date().toISOString()
  save()
  console.log(`${name}: readsMoved=${entry.readsMovedDbOrWal} writeWrote=${entry.writeCaseWroteIndex} failure=${entry.readFailure ?? "none"}`)
}

if (!process.env.BB_CORPUS_REPO || doorOnly) {
  // ── refusals ─────────────────────────────────────────────────────────────
  const refusalCases: Case[] = [
    { label: "refuse-invalid-scope", args: { scope: "quality" } },
    { label: "refuse-unknown-option", args: { foo: true } },
    { label: "refuse-limit-above-maximum", args: { limit: 10_000_000 } },
    { label: "refuse-threshold-out-of-range", args: { confidenceThreshold: 2 } },
  ]
  const graphqlEntry = { repoDir: path.join(REPOS_ROOT, "graphql-js"), dataDir: path.join(CORPUS_DIR, "graphql-js") }
  try {
    const refused = await door(graphqlEntry.repoDir, graphqlEntry.dataDir, async (call) => caseLines(call, refusalCases))
    report.refusals = refused.result ?? []
    const emptyDir = mkdtempSync(path.join(tmpdir(), "bb-patterns-door-unindexed-"))
    try {
      const missing = await door(emptyDir, graphqlEntry.dataDir, async (call) => caseLines(call, [{ label: "refuse-missing-index", args: {} }]))
      report.refusals.push(...(missing.result ?? []))
    } finally { rmSync(emptyDir, { recursive: true, force: true }) }
  } catch (error: any) { report.refusalsError = String(error?.message ?? error) }
  save()

  // ── >100-orphan / framework / god-class promotion fixture ────────────────
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "bb-patterns-door-promotion-"))
  const fixtureData = mkdtempSync(path.join(tmpdir(), "bb-patterns-door-promotion-data-"))
  try {
    mkdirSync(path.join(fixtureDir, "src"), { recursive: true })
    for (let i = 0; i < 130; i++) writeFileSync(path.join(fixtureDir, "src", `m${i}.ts`), `export function unref${i}(): number { return ${i} }\n`)
    const members = (n: number) => Array.from({ length: n }, (_, k) => `  f${k}(): number { return ${k} }`).join("\n")
    writeFileSync(path.join(fixtureDir, "src", "wide.ts"), Array.from({ length: 60 }, (_, i) => `export class Wide${i} {\n${members(12)}\n}`).join("\n") + "\n")
    // Index INTO the fixture's own lane data dir: the process-wide BB_DATA_DIR is the
    // lane scratch, and the door child gets BB_DATA_DIR=fixtureData, so indexing into
    // the parent data dir would leave the door looking at an unindexed project.
    const priorDataDir = process.env.BB_DATA_DIR
    process.env.BB_DATA_DIR = fixtureData
    const pid = getProjectId(fixtureDir)
    await indexProjectParallel(pid, fixtureDir, {})
    await flushBackgroundEmbeddings({ timeoutMs: 5000 })
    BrainDatabase.closeAll()
    const raw = await BrainDatabase.getRawInstance(pid)
    raw.prepare("UPDATE brain_file SET framework_type='react' WHERE project_id=? AND relative_path='src/m0.ts'").run(pid)
    BrainDatabase.closeAll()
    process.env.BB_DATA_DIR = priorDataDir
    const promoted = await door(fixtureDir, fixtureData, async (call) => {
      const r = await call({})
      const rows = r.text.split("\n").filter((line) => /^  \[(?:info|warning|error)\] |^  orphaned_/.test(line))
      return [{ label: "promotion-default", isError: r.isError, ms: r.ms, census: censusOf(r.text), rows: rows.length, hasOrphanRow: rows.some((row: string) => /orphaned_/.test(row)), hasFrameworkRow: rows.some((row: string) => row.includes("framework-detected")), hasGodClassRow: rows.some((row: string) => row.includes("god-class")), sample: rows.slice(0, 3) }]
    })
    report.promotionFixture = { fixture: { files: 131, orphanCandidates: 130, godClasses: 60, frameworkFiles: 1 }, result: promoted.result, readsMovedDbOrWal: promoted.readsMovedDbOrWal }
  } catch (error: any) {
    report.promotionFixture = { error: String(error?.message ?? error) }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
    rmSync(fixtureData, { recursive: true, force: true })
    BrainDatabase.closeAll()
  }
  save()
}
console.log(`REAL-CORPUS written: ${outPath}`)
