// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the real-corpus proof for bb_visualize: it indexes real
//   repositories into an isolated data directory, then drives the REAL MCP stdio
//   server against each of them for every scope, both layouts and all three
//   formats, and records what came back — node/link counts, declared truncation,
//   HTML size and self-containment, latency, and whether a read moved the index.
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true,
//   modes: project, file, module, symbol, feature).
// WHY IT IS SHAPED THIS WAY — a fixture is the tool's own opinion about what a
//   project looks like. A real repository is not: it has vendored trees, build
//   output, test suites, several languages and symbol names the fixture never
//   contains. Scopes and filters are proven on THAT data, through the protocol a
//   client uses, so a green run is a claim about the product rather than about
//   the harness. The data directory is isolated so the shared workspace index is
//   never touched, and the repos are read-only inputs.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_visualize/REAL-CORPUS.json,
//   validation/tools/bb_visualize/results/real-<repo>*.json.
// EDIT TOGETHER WHEN THIS CHANGES — probe.ts, latency.ts, docs/BB_VISUALIZE.md.
// CONTRACTS IT MUST NOT BREAK — no write to the repositories, no write to the
//   shared .bb-data index; indexes live under validation/tools/bb_visualize/
//   (gitignored), never committed.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { loadavg, hostname } from "node:os"
import path from "node:path"

const HERE = path.resolve(import.meta.dirname ?? ".", ".")
const RESULTS_DIR = path.join(HERE, "results")
const DATA_DIR = path.join(HERE, "bbdata")
const ROOT = path.resolve(HERE, "..", "..", "..")
const CORPUS_ROOT = "/home/ishaq2321/bb_tests/repositories"
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

interface Repo { key: string; dir: string; language: string }
const REPOS: Repo[] = [
  { key: "graphql-js", dir: path.join(CORPUS_ROOT, "graphql-js"), language: "TypeScript/JavaScript" },
  { key: "rake", dir: path.join(CORPUS_ROOT, "rake"), language: "Ruby" },
  { key: "rebar3", dir: path.join(CORPUS_ROOT, "rebar3"), language: "Erlang" },
  // The full zig checkout is 16,766 source files and its index build was interrupted
  // twice by session teardown at 4,860/16,766 files (1.7 GB, partial and NOT reused).
  // The standard library subtree is a complete, real Zig/C corpus and is indexed whole.
  { key: "zig-std", dir: path.join(CORPUS_ROOT, "zig", "lib", "std"), language: "Zig/C" },
  { key: "go-tools", dir: path.join(CORPUS_ROOT, "go-tools"), language: "Go" },
]

const sha256 = (file: string): string | null => {
  if (!existsSync(file)) return null
  try { return execFileSync("sha256sum", [file], { encoding: "utf8" }).trim().split(/\s+/)[0] ?? null } catch { return null }
}
const state = (file: string) => ({ path: path.basename(file), exists: existsSync(file), size: existsSync(file) ? statSync(file).size : 0, sha256: sha256(file) })

async function projectFor(repo: Repo): Promise<{ projectId: string; dbPath: string }> {
  const { getProjectId } = await import("../../../src/util/project-id")
  const { BrainDatabase } = await import("../../../src/brain/database")
  const projectId = getProjectId(repo.dir)
  return { projectId, dbPath: BrainDatabase.getDbPath(projectId) }
}

async function indexRepo(repo: Repo, incremental = false): Promise<any> {
  const { projectId, dbPath } = await projectFor(repo)
  if (existsSync(dbPath) && !incremental) {
    const facts = await factsOf(projectId)
    if (facts.files > 0) return { ...facts, indexMs: 0, reused: true }
  }
  const { indexProjectParallel } = await import("../../../src/ast/parallel-indexer")
  const t0 = performance.now()
  // An interrupted run leaves a valid but partial index; `isIncremental` continues
  // from what the database already holds instead of re-parsing the whole tree.
  await indexProjectParallel(projectId, repo.dir, existsSync(dbPath) ? { isIncremental: true } : {})
  const indexMs = Math.round(performance.now() - t0)
  return { ...(await factsOf(projectId)), indexMs, reused: false }
}

async function factsOf(projectId: string): Promise<any> {
  const { BrainDatabase } = await import("../../../src/brain/database")
  const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
  const one = (sql: string) => Number((raw.prepare(sql).get(projectId) as any)?.c ?? 0)
  return {
    files: one("SELECT COUNT(*) c FROM brain_file WHERE project_id=?"),
    symbols: one("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?"),
    relationships: one("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?"),
    languages: (raw.prepare("SELECT language, COUNT(*) c FROM brain_file WHERE project_id=? AND language IS NOT NULL GROUP BY 1 ORDER BY c DESC").all(projectId) as any[]).map((row) => ({ language: row.language, files: row.c })),
  }
}

/** Deterministic targets chosen from the index itself, so the matrix is not
 *  coupled to a filename that a repository may rename. */
async function pickTargets(projectId: string): Promise<any> {
  const { BrainDatabase } = await import("../../../src/brain/database")
  const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
  const fileRow = raw.prepare("SELECT f.relative_path AS path, COUNT(s.id) c FROM brain_file f JOIN brain_symbol s ON s.file_id=f.id WHERE f.project_id=? GROUP BY f.relative_path ORDER BY c DESC, f.relative_path LIMIT 1").get(projectId) as any
  const symbolRow = raw.prepare("SELECT s.name, s.symbol_type, f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.name IS NOT NULL AND length(s.name)>4 AND s.symbol_type IN ('class','function','method','module','struct','interface') ORDER BY s.gravity_score DESC, s.id LIMIT 1").get(projectId) as any
  const moduleRow = raw.prepare("SELECT relative_path AS path FROM brain_file WHERE project_id=? ORDER BY relative_path LIMIT 1").get(projectId) as any
  const filePath = String(fileRow?.path ?? "")
  const modulePath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "."
  return {
    file: filePath,
    module: modulePath === "." ? filePath.split("/")[0] ?? filePath : modulePath,
    symbol: String(symbolRow?.name ?? ""),
    feature: String(symbolRow?.name ?? "").slice(0, Math.max(4, Math.floor(String(symbolRow?.name ?? "").length / 2))),
    fallbackModuleFile: String(moduleRow?.path ?? ""),
  }
}

async function indexCommand(keys: string[]): Promise<void> {
  const incremental = process.argv.includes("--incremental")
  mkdirSync(RESULTS_DIR, { recursive: true })
  const out: any[] = []
  for (const repo of REPOS.filter((candidate) => keys.length === 0 || keys.includes(candidate.key))) {
    console.log(`indexing ${repo.key} (${repo.dir})…`)
    const facts = await indexRepo(repo, incremental)
    const { projectId, dbPath } = await projectFor(repo)
    const row = { key: repo.key, repoPath: repo.dir, language: repo.language, projectId, dbPath, db: state(dbPath), wal: state(`${dbPath}-wal`), ...facts, targets: await pickTargets(projectId) }
    out.push(row)
    writeFileSync(path.join(RESULTS_DIR, `real-${repo.key}-index.json`), JSON.stringify(row, null, 2) + "\n")
    console.log(`  ${facts.files} files / ${facts.symbols} symbols / ${facts.relationships} relationships in ${facts.indexMs} ms${facts.reused ? " (reused)" : ""}`)
  }
  const summaryPath = path.join(RESULTS_DIR, "real-index.json")
  const existing: any = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : { repos: [] }
  const merged = new Map(existing.repos.map((row: any) => [row.key, row]))
  for (const row of out) merged.set(row.key, row)
  writeFileSync(summaryPath, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), dataDir: DATA_DIR, repos: [...merged.values()] }, null, 2) + "\n")
}

async function doorCommand(keys: string[]): Promise<void> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  mkdirSync(RESULTS_DIR, { recursive: true })
  const reports: any[] = []
  for (const repo of REPOS.filter((candidate) => keys.length === 0 || keys.includes(candidate.key))) {
    const { projectId, dbPath } = await projectFor(repo)
    const facts = await factsOf(projectId)
    if (facts.files === 0) { console.log(`skipping ${repo.key}: not indexed`); continue }
    const targets = await pickTargets(projectId)
    const before = { db: state(dbPath), wal: state(`${dbPath}-wal`) }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", path.join(ROOT, "src", "cli", "index.ts"), "mcp", "--dir", repo.dir],
      cwd: ROOT,
      env: { ...process.env, BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" },
      stderr: "pipe",
    })
    const client = new Client({ name: "bb-visualize-real-corpus", version: "1.0.0" })
    let stderrText = ""
    transport.stderr?.on("data", (chunk: Buffer) => { stderrText += String(chunk) })
    const openedAt = performance.now()
    try {
      await client.connect(transport)
    const connectMs = Math.round(performance.now() - openedAt)
    const call = async (args: Record<string, unknown>, name: string) => {
      const t0 = performance.now()
      const response: any = await client.callTool({ name: "bb_visualize", arguments: args })
      const ms = Math.round(performance.now() - t0)
      const text = (response?.content ?? []).map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("\n")
      const isError = response?.isError === true
      let nodes = 0, links = 0, truncated: boolean | null = null, totalNodesAvailable: number | null = null, layout: string | null = null
      if (String(args.format) === "json" && !isError) {
        try {
          const parsed = JSON.parse(text)
          nodes = parsed.nodes?.length ?? 0
          links = parsed.links?.length ?? 0
          truncated = parsed.truncation?.truncated ?? null
          totalNodesAvailable = parsed.totalNodesAvailable ?? null
          layout = parsed.layout ?? null
        } catch { /* recorded through isError/bytes */ }
      } else if (String(args.format) === "html" && !isError) {
        layout = /data-bb-layout=\\?"([a-z]+)\\?"/.exec(text)?.[1] ?? null
        nodes = (text.match(/"id":/g) ?? []).length
      } else if (!isError) {
        const head = /^graph: (\d+) nodes, (\d+) links/m.exec(text)
        if (head) { nodes = Number(head[1]); links = Number(head[2]) }
        truncated = /^truncated: yes/m.test(text)
        const page = /available: (\d+) symbol\(s\) match/m.exec(text)
        if (page) totalNodesAvailable = Number(page[1])
        layout = /^layout: ([a-z]+)/m.exec(text)?.[1] ?? null
      }
      return {
        name,
        args,
        isError,
        ms,
        bytes: text.length,
        nodes,
        links,
        truncated,
        totalNodesAvailable,
        layout,
        htmlSelfContained: String(args.format) === "html" ? !/(?:src|href)\s*=\s*["']https?:\/\/|@import|fonts\.googleapis|cdn\./i.test(text) && (text.match(/https?:\/\//g) ?? []).length === 0 : null,
        textHead: isError ? text.slice(0, 300) : undefined,
      }
    }
    const cases: any[] = []
    const matrix: [string, Record<string, unknown>][] = [
      ["project text (default)", {}],
      ["project json", { format: "json" }],
      ["project html regions", { format: "html" }],
      ["project html force", { format: "html", layout: "force" }],
      // The largest accepted budget is exercised at 1000 nodes here: a 2000-node answer is
      // a ~12-16 MB single JSON-RPC message and this host runs the fleet at high memory
      // pressure, which killed the spawned server mid-message. The 2000-node shape is
      // measured in-process in results/latency-t2.json.
      ["project json large budget", { format: "json", maxNodes: 1000, maxLinks: 20000 }],
      ["project json calls only", { format: "json", relationshipTypes: ["calls"], maxNodes: 200 }],
      ["file text", { scope: "file", target: targets.file, format: "text" }],
      ["file json", { scope: "file", target: targets.file, format: "json" }],
      ["module json", { scope: "module", target: targets.module, format: "json" }],
      ["symbol text", { scope: "symbol", target: targets.symbol, format: "text" }],
      ["symbol html", { scope: "symbol", target: targets.symbol, format: "html" }],
      ["feature json", { scope: "feature", target: targets.feature, format: "json" }],
      ["project json offset page 2", { format: "json", maxNodes: 50, offset: 50 }],
      ["project text includeTests false", { format: "text", includeTests: false }],
      ["unknown scope refused", { scope: "galaxy" }],
      ["missing target refused", { scope: "symbol" }],
      ["maxNodes 0 refused", { maxNodes: 0 }],
    ]
    for (const [name, args] of matrix) {
      const row = await call(args, name)
      cases.push(row)
      const detail = row.isError ? `refused: ${row.textHead?.slice(0, 80)}` : `${row.nodes} nodes / ${row.links} links / ${row.bytes} B / ${row.ms} ms`
      console.log(`  ${repo.key} · ${name}: ${detail}`)
    }
      await client.close()
      await new Promise((resolve) => setTimeout(resolve, 300))
      const after = { db: state(dbPath), wal: state(`${dbPath}-wal`) }
      const report = {
        key: repo.key,
        repoPath: repo.dir,
        language: repo.language,
        projectId,
        connectMs,
        index: { files: facts.files, symbols: facts.symbols, relationships: facts.relationships, languages: facts.languages },
        targets,
        dbBefore: before,
        dbAfter: after,
        dbUnchanged: JSON.stringify(before) === JSON.stringify(after),
        stderrTail: stderrText.split("\n").filter((line) => line.trim().length > 0).slice(-4),
        cases,
      }
      reports.push(report)
      writeFileSync(path.join(RESULTS_DIR, `real-${repo.key}-door.json`), JSON.stringify(report, null, 2) + "\n")
    } catch (error: any) {
      console.log(`  ${repo.key}: DOOR FAILED — ${error?.message ?? String(error)}`)
      reports.push({ key: repo.key, repoPath: repo.dir, language: repo.language, projectId, error: String(error?.message ?? error), cases: [] })
      await new Promise((resolve) => setTimeout(resolve, 300))
      continue
    }
  }
  const summary = new Map<string, any>()
  const outPath = path.join(RESULTS_DIR, "real-corpus.json")
  const previous: any = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { repos: [] }
  for (const row of previous.repos ?? []) summary.set(row.key, row)
  for (const row of reports) summary.set(row.key, row)
  writeFileSync(outPath, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), environment: { runtime: process.version, host: hostname(), loadAverage: loadavg(), dataDir: DATA_DIR, corpusRoot: CORPUS_ROOT }, repos: [...summary.values()] }, null, 2) + "\n")
  console.log(`real-corpus: ${reports.length} repos recorded`)
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "all"
  const keys = process.argv.slice(3).filter((arg) => !arg.startsWith("--"))
  if (mode === "index" || mode === "all") await indexCommand(mode === "all" ? [] : keys)
  if (mode === "door" || mode === "all") await doorCommand(mode === "all" ? [] : keys)
  console.log("REAL-CORPUS: done")
}

main().catch((error) => { console.error("FATAL", error); process.exit(2) })
