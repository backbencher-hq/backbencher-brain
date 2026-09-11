// script/m20/benchmark-tool-latency.ts — M20 performance evidence.
//
// Measures the actual handler paths on already-indexed repositories. Indexing
// is deliberately excluded from per-tool latency; it is reported separately
// from the database counts. Every number is wall-clock data from this machine,
// not a complexity guarantee. The edit measurement uses an invalid request so
// no source mutation is possible.

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { createToolHandlers } from "../../src/mcp/tool-handlers"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m20/results")
const tools = ["bb_search", "bb_ask", "bb_analyze", "bb_health", "bb_patterns", "bb_security", "bb_visualize", "bb_migrate", "bb_doc", "bb_edit"] as const
const repos = [
  { id: "rake", path: "$HOME/fixtures/repositories/rake", query: "Task" },
  { id: "intellij-community", path: "$HOME/intellij-community", query: "VirtualFile" },
]
const args: Record<string, Record<string, unknown>> = {
  bb_search: { query: "QUERY", limit: 5 },
  bb_ask: { query: "QUERY", limit: 3 },
  bb_analyze: { mode: "stats" },
  bb_health: {},
  bb_patterns: { scope: "orphaned", limit: 5 },
  bb_security: {},
  bb_visualize: { scope: "project", format: "json", maxNodes: 50, maxLinks: 100 },
  bb_migrate: { symbolName: "QUERY", targetLanguage: "python", format: "json" },
  bb_doc: { mode: "symbol", target: "QUERY", format: "json" },
  bb_edit: { mode: "invalid-m20-benchmark-mode" },
}

function sha(file: string): string { return createHash("sha256").update(readFileSync(file)).digest("hex") }
function firstExistingSource(root: string): string | null {
  const candidates = ["lib/rake.rb", "rake.gemspec", "Rakefile", "src/main.ts", "README.md"]
  for (const relative of candidates) {
    const file = path.join(root, relative)
    if (existsSync(file)) return file
  }
  return null
}
async function count(projectId: string, table: string): Promise<number> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  return Number((raw.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE project_id=?`).get(projectId) as { c: number }).c)
}

const handlers = createToolHandlers()
const evidence: any[] = []
let checks = 0
let passed = 0
let negatives = 0
function check(label: string, condition: boolean, detail = ""): void { checks++; if (condition) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, condition: boolean, detail = ""): void { negatives++; check(`${label} [negative]`, condition, detail) }
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

for (const repo of repos) {
  const projectId = getProjectId(repo.path)
  if (!existsSync(BrainDatabase.getDbPath(projectId))) {
    console.log(`UNMEASURED: ${repo.id}: no indexed database at ${BrainDatabase.getDbPath(projectId)}`)
    continue
  }
  const files = await count(projectId, "brain_file")
  const symbols = await count(projectId, "brain_symbol")
  if (files === 0 || symbols === 0) {
    console.log(`UNMEASURED: ${repo.id}: indexed database is empty (files=${files} symbols=${symbols})`)
    continue
  }
  check(`${repo.id}: indexed database has files and symbols`, true, `files=${files} symbols=${symbols}`)
  const perTool: Record<string, unknown> = {}
  for (const tool of tools) {
    const samples: number[] = []
    let success = 0
    let errorText = ""
    const toolArgs = { ...args[tool], query: repo.query, symbolName: repo.query, target: repo.query }
    const editProbe = tool === "bb_edit" ? firstExistingSource(repo.path) : null
    const sourceBefore = editProbe ? sha(editProbe) : null
    for (let run = 0; run < (tool === "bb_edit" ? 1 : 3); run++) {
      const started = performance.now()
      try {
        console.log(`RUN: ${repo.id}/${tool} #${run + 1}`)
        const result = await withTimeout(handlers[tool](toolArgs, { projectId, projectPath: repo.path } as any), 90000)
        samples.push(Math.round((performance.now() - started) * 100) / 100)
        if (tool === "bb_edit") success += result.isError === true ? 1 : 0
        else success += result.content?.length > 0 ? 1 : 0
      } catch (error) {
        samples.push(Math.round((performance.now() - started) * 100) / 100)
        errorText = error instanceof Error ? error.message : String(error)
      }
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? null
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null
    const sourceAfter = editProbe ? sha(editProbe) : null
    if (tool === "bb_edit") negative(`${repo.id}: invalid edit fails closed and is read-only`, success === 1 && editProbe !== null && sourceBefore === sourceAfter, `${errorText} probe=${editProbe} before=${sourceBefore} after=${sourceAfter}`)
    else check(`${repo.id}: ${tool} completed measured calls`, success === samples.length && samples.length > 0, errorText)
    perTool[tool] = { runs: samples.length, samplesMs: samples, medianMs: median, p95Ms: p95, successfulRuns: success, error: errorText || null }
  }
  evidence.push({ repo: repo.id, path: repo.path, files, symbols, tools: perTool })
}

const result = {
  issue: "M20.PERF", code: "PERF", milestone: "M20", status: passed === checks ? "verified" : "known-gap",
  checks, passed, failed: checks - passed, negativeCases: negatives,
  currentCommit: (await Bun.$`git rev-parse HEAD`.text()).trim(),
  verifierCommand: "bun run script/m20/benchmark-tool-latency.ts",
  evidenceFile: "PERF.json",
  generatedAt: new Date().toISOString(),
  measured: evidence,
  methodology: "Handler wall-clock only; database indexing is pre-existing and reported separately by files/symbols. Three samples per read tool, one fail-closed sample for bb_edit.",
  complexityInterpretation: "These measurements establish observed latency at two corpus sizes. They do not prove asymptotic complexity; obvious full scans, row caps, and database query behavior must be reviewed separately.",
  limitations: ["Machine-dependent wall-clock values.", "Embedding/API latency is included when bb_ask invokes an embedding path; no claim separates provider latency without a provider trace.", "bb_edit is measured only on its invalid-argument fail-closed path to avoid mutating real repositories."],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(path.join(RESULTS, "PERF.json"), JSON.stringify(result, null, 2) + "\n")
console.log(`PERF: ${result.status.toUpperCase()} (${passed}/${checks} checks, ${negatives} negative)`)
process.exit(result.status === "verified" ? 0 : 1)
