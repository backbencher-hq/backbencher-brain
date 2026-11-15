// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the release-grade REAL-CORPUS proof for bb_ask: real repositories
//   from /home/ishaq2321/bb_tests/repositories are indexed into an isolated BB_DATA_DIR,
//   then queried through the REAL MCP stdio door (src/mcp/server.ts) in two embedding
//   configurations — provider embeddings at ask time and local word vectors — exercising
//   the semantic, exact-name and fallback routes on real code, while proving the index
//   database bytes and WAL frames do not move.
// WHICH TOOL IT SERVES — bb_ask (read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — a fixture corpus can pass while a 375-file TypeScript repo
//   degrades; and a tool is only release-grade if the path a host actually uses (MCP
//   stdio) answers real questions with declared route/model/bounds. The provider/local
//   pair also exercises the honest model-mismatch fallback when an index was embedded in
//   one space and the question is embedded in another.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_ask/REAL-CORPUS.json.
// EDIT TOGETHER WHEN THIS CHANGES — work/latency.mts, work/mcp-door.mts,
//   docs/BB_ASK.md (measured-latency section).
// CONTRACTS IT MUST NOT BREAK — the door is the source entry; env is forwarded so the
//   child reads the isolated data dir; a failed corpus leg is recorded as failed, never
//   skipped silently.
//
// Usage:
//   BB_DATA_DIR=validation/tools/bb_ask/bbdata/real-corpus \
//     npx tsx validation/tools/bb_ask/work/real-corpus.mts
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..")
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs")
const SERVER = path.join(REPO_ROOT, "src", "mcp", "server.ts")
const OUT = path.join(REPO_ROOT, "validation", "tools", "bb_ask", "REAL-CORPUS.json")
const REPOS = "/home/ishaq2321/bb_tests/repositories"

const dataDir = process.env.BB_DATA_DIR
if (!dataDir) {
  console.error("BB_DATA_DIR must point at an isolated directory (never ~/.bb)")
  process.exit(2)
}

const statOf = (file: string) => (existsSync(file) ? { size: statSync(file).size, mtimeMs: Math.round(statSync(file).mtimeMs) } : null)
const indexFiles = (projectId: string) => {
  const dbPath = BrainDatabase.getDbPath(projectId)
  return { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`) }
}
const walFrames = (snapshot: ReturnType<typeof indexFiles>) => snapshot.wal?.size ?? 0
const dbUnchanged = (before: ReturnType<typeof indexFiles>, after: ReturnType<typeof indexFiles>) =>
  before.db?.size === after.db?.size && before.db?.mtimeMs === after.db?.mtimeMs && walFrames(after) === walFrames(before)

type CallRecord = {
  label: string
  args: Record<string, unknown>
  ms: number
  isError: boolean
  method: string | null
  queryModel: string | null
  bounds: string | null
  coverage: string | null
  staleMarkers: number
  missingMarkers: number
  text: string
}

function parseAnswer(text: string): Pick<CallRecord, "method" | "queryModel" | "bounds" | "coverage" | "staleMarkers" | "missingMarkers"> {
  const method = text.match(/method=([a-z-]+)/)?.[1] ?? null
  const queryModel = text.match(/queryModel=([^,\s]+)/)?.[1] ?? null
  const bounds = text.match(/\[bounds: [^\]]+\]/)?.[0] ?? null
  const coverage = text.match(/embeddingCoverage=([^\n]+)/)?.[1]?.slice(0, 160) ?? null
  return {
    method,
    queryModel,
    bounds,
    coverage,
    staleMarkers: (text.match(/\[STALE/g) ?? []).length,
    missingMarkers: (text.match(/\[MISSING/g) ?? []).length,
  }
}

async function doorSession(projectDir: string, embeddingMode: "provider" | "local", calls: Array<{ label: string; args: Record<string, unknown> }>): Promise<{ records: CallRecord[]; error: string | null }> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  if (embeddingMode === "local") env.BB_EMBEDDING_DISABLED = "1"
  else delete env.BB_EMBEDDING_DISABLED
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [TSX_CLI, SERVER, "--dir", projectDir],
    cwd: REPO_ROOT,
    stderr: "pipe",
    // The SDK sanitizes the child environment; forward everything so BB_DATA_DIR,
    // BB_NO_AUTO_REFRESH and the embedding configuration reach the server.
    env,
  })
  const client = new Client({ name: "bb-ask-real-corpus", version: "1.0.0" })
  const records: CallRecord[] = []
  let error: string | null = null
  try {
    await client.connect(transport)
    for (const call of calls) {
      const t0 = performance.now()
      const response: any = await client.callTool({ name: "bb_ask", arguments: call.args })
      const ms = Math.round((performance.now() - t0) * 10) / 10
      const text = (response?.content ?? []).map((content: any) => content.text ?? "").join("\n")
      records.push({ label: call.label, args: call.args, ms, isError: response?.isError === true, text: text.length > 2500 ? text.slice(0, 2500) + `…[+${text.length - 2500}]` : text, ...parseAnswer(text) })
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    try { await client.close() } catch {}
  }
  return { records, error }
}

// ── Corpora ─────────────────────────────────────────────────────────────────
type Corpus = { name: string; relativePath: string; embedding: "provider" | "local"; calls: Array<{ label: string; args: Record<string, unknown> }> }
const CORPORA: Corpus[] = [
  {
    name: "rake/lib (Ruby, provider-embedded)",
    relativePath: "rake/lib",
    embedding: "provider",
    calls: [
      { label: "semantic question (provider space)", args: { query: "how does a task get executed in this project" } },
      { label: "exact symbol name", args: { query: "Rake", limit: 3 } },
      { label: "fallback: nonsense term", args: { query: "xyzzyplugh" } },
      { label: "aggregate count", args: { query: "how many functions are in this project" } },
    ],
  },
  {
    name: "graphql-js/src (TypeScript, local-embedded)",
    relativePath: "graphql-js/src",
    embedding: "local",
    calls: [
      { label: "semantic question (local space)", args: { query: "how are schema types validated" } },
      { label: "exact symbol name", args: { query: "GraphQLSchema", limit: 2 } },
      { label: "fallback: identifier absent from vocabulary", args: { query: "zzqxwv unknownToken" } },
      { label: "aggregate count", args: { query: "how many classes are in this project" } },
    ],
  },
  {
    name: "rebar3/apps (Erlang, local-embedded)",
    relativePath: "rebar3/apps",
    embedding: "local",
    calls: [
      { label: "semantic question (local space)", args: { query: "how is a release built" } },
      { label: "exact symbol name", args: { query: "rebar3", limit: 2 } },
      { label: "aggregate count", args: { query: "how many files are in this project" } },
    ],
  },
]

// The provider-embedded corpus is also questioned from the LOCAL space: the index holds
// 2048-dim provider vectors while the question is 50-dim local, so the answer must be a
// declared model-mismatch fallback — not a silent zero-similarity guess.
const MISMATCH_CALLS: Array<{ label: string; args: Record<string, unknown> }> = [
  { label: "model-mismatch: local question against provider-embedded index", args: { query: "how does a task get executed in this project" } },
  { label: "exact symbol still answers without embeddings", args: { query: "Rake", limit: 1 } },
]

const report: any = {
  schemaVersion: 1,
  tool: "bb_ask",
  title: "real-corpus MCP stdio proof (provider + local embeddings)",
  generatedAt: new Date().toISOString(),
  currentCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.trim(),
  dataDir,
  corpusRoot: REPOS,
  runtime: `node ${process.version} + tsx`,
  commands: {
    indexOne: "BB_DATA_DIR=<isolated> [BB_EMBEDDING_DISABLED=1] npx tsx validation/tools/bb_ask/work/real-corpus.mts",
    door: "node node_modules/tsx/dist/cli.mjs src/mcp/server.ts --dir <corpus> (MCP stdio, env forwarded)",
  },
  corpora: [],
  limitations: [
    "Provider-embedding indexing cost is paid once per corpus; the 2048-dim space is filled by the configured provider, not by the local model.",
    "Latency is measured through the MCP stdio door including SDK transport overhead, on this machine, with other fleet work possibly running.",
  ],
}

for (const corpus of CORPORA) {
  const projectDir = path.join(REPOS, corpus.relativePath)
  const projectId = getProjectId(projectDir)
  const record: any = { name: corpus.name, projectDir, embedding: corpus.embedding, index: {}, door: null, mismatchDoor: null }
  if (!existsSync(projectDir)) {
    record.error = "corpus path missing"
    report.corpora.push(record)
    continue
  }
  // Index in the requested embedding configuration, into the isolated data dir.
  process.env.BB_EMBEDDING_DISABLED = corpus.embedding === "local" ? "1" : ""
  if (corpus.embedding === "provider") delete process.env.BB_EMBEDDING_DISABLED
  const indexPath = ["index", "started"]
  const indexStart = Date.now()
  try {
    await indexProjectParallel(projectId, projectDir, {})
    await flushBackgroundEmbeddings()
    indexPath.push("complete")
  } catch (cause) {
    indexPath.push(`failed: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  record.index = {
    ms: Date.now() - indexStart,
    outcome: indexPath[indexPath.length - 1],
    files: spawnSync("find", [projectDir, "-type", "f"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).length,
  }
  try {
    const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
    record.index.facts = {
      symbols: (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(projectId) as any)?.c ?? 0,
      files: (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(projectId) as any)?.c ?? 0,
      embeddings: raw.prepare("SELECT embedding_model m, vector_dimension d, COUNT(*) c FROM brain_semantic_embedding WHERE project_id=? GROUP BY m,d").all(projectId),
    }
  } catch (cause) {
    record.index.factsError = cause instanceof Error ? cause.message : String(cause)
  }

  const before = indexFiles(projectId)
  const door = await doorSession(projectDir, corpus.embedding, corpus.calls)
  const after = indexFiles(projectId)
  record.door = { embeddingMode: corpus.embedding, calls: door.records, error: door.error, indexFiles: { before, after, dbUnchanged: dbUnchanged(before, after) } }

  if (corpus.embedding === "provider") {
    const mismatchBefore = indexFiles(projectId)
    const mismatch = await doorSession(projectDir, "local", MISMATCH_CALLS)
    const mismatchAfter = indexFiles(projectId)
    record.mismatchDoor = { embeddingMode: "local", calls: mismatch.records, error: mismatch.error, indexFiles: { before: mismatchBefore, after: mismatchAfter, dbUnchanged: dbUnchanged(mismatchBefore, mismatchAfter) } }
  }
  report.corpora.push(record)
  console.log(`${corpus.name}: indexed ${record.index.ms}ms, symbols=${record.index.facts?.symbols ?? "?"}, embeddings=${JSON.stringify(record.index.facts?.embeddings ?? [])}`)
  for (const call of [...door.records, ...(record.mismatchDoor?.calls ?? [])]) {
    console.log(`  ${call.label}: ${call.ms}ms method=${call.method} model=${call.queryModel} error=${call.isError}`)
  }
  console.log(`  dbUnchanged=${record.door.indexFiles.dbUnchanged}${record.mismatchDoor ? ` mismatchDbUnchanged=${record.mismatchDoor.indexFiles.dbUnchanged}` : ""}`)
}

report.totals = {
  corpora: report.corpora.length,
  doorCalls: report.corpora.reduce((sum: number, entry: any) => sum + (entry.door?.calls?.length ?? 0) + (entry.mismatchDoor?.calls?.length ?? 0), 0),
  allDbUnchanged: report.corpora.every((entry: any) => entry.door?.indexFiles?.dbUnchanged === true && (entry.mismatchDoor === null || entry.mismatchDoor.indexFiles.dbUnchanged === true)),
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n")
console.log(`\n${OUT}: ${report.totals.corpora} corpora, ${report.totals.doorCalls} real door calls, allDbUnchanged=${report.totals.allDbUnchanged}`)
process.exit(report.totals.allDbUnchanged && report.corpora.every((entry: any) => !entry.error && !entry.door?.error) ? 0 : 1)
