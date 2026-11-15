// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_visualize latency measurement: warm five-run p50/p95
//   on the three campaign tiers (T0 polyglot fixture, T1 synthetic scale
//   fixture, T2 this workspace's reference index), with the exact command, the
//   index population and mtime, the HTML artifact size, and a read-path
//   integrity record around the T2 sweep.
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true,
//   modes: project, file, module, symbol, feature).
// WHY IT IS SHAPED THIS WAY — a warm number is the only number that describes
//   the tool rather than the process start, and the population has to be
//   recorded WITH the number because the reference index is rewritten by other
//   processes while measurements run. The variants are the ones the descriptor's
//   performance claims name: the default call, the largest accepted budget, the
//   JSON shape, and the HTML artifact whose size is part of its cost.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_visualize/LATENCY.json.
// EDIT TOGETHER WHEN THIS CHANGES — the descriptor's performance wording,
//   docs/BB_VISUALIZE.md, validation/tools/bb_visualize/probe.ts.
// CONTRACTS IT MUST NOT BREAK — T0/T1 write only under
//   validation/tools/bb_visualize/{work,bbdata}; a T2 sweep records the index
//   bytes before and after instead of claiming they did not move.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { hostname, loadavg } from "node:os"
import path from "node:path"

const HERE = path.resolve(import.meta.dirname ?? ".", ".")
const RESULTS_DIR = path.join(HERE, "results")
const TIER = process.argv[2] ?? "t0"

interface Run { variant: string; ms: number; nodes: number; links: number; bytes: number; truncated: boolean }

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]!
}
// sha256sum rather than readFileSync: the reference index is 3.4 GB and the
// Buffer path refuses files above 2 GiB. The native tool streams it.
const hashFile = (file: string): string | null => {
  if (!existsSync(file)) return null
  try { return execFileSync("sha256sum", [file], { encoding: "utf8" }).trim().split(/\s+/)[0] ?? null } catch { return null }
}
const fileState = (file: string) => ({ path: path.basename(file), exists: existsSync(file), size: existsSync(file) ? statSync(file).size : 0, mtimeMs: existsSync(file) ? statSync(file).mtimeMs : 0, sha256: hashFile(file) })

async function indexFacts(projectId: string): Promise<{ files: number; symbols: number; relationships: number; dbPath: string }> {
  const { BrainDatabase } = await import("../../../src/brain/database")
  const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
  const one = (sql: string) => Number((raw.prepare(sql).get(projectId) as any)?.c ?? 0)
  return {
    files: one("SELECT COUNT(*) c FROM brain_file WHERE project_id=?"),
    symbols: one("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?"),
    relationships: one("SELECT COUNT(*) c FROM brain_relationship WHERE project_id=?"),
    dbPath: BrainDatabase.getDbPath(projectId),
  }
}

async function main(): Promise<void> {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const commit = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(HERE, "..", "..", ".."), encoding: "utf8" }).trim() } catch { return "unknown" } })()
  let projectId: string, projectPath: string, dataDir: string, tierLabel: string
  let before: { db: any; wal: any } | null = null
  if (TIER === "t2") {
    dataDir = path.resolve(path.join(HERE, "..", "..", "..", ".bb-data"))
    process.env.BB_DATA_DIR = dataDir
    process.env.BB_NO_AUTO_REFRESH = "1"
    projectPath = path.resolve(path.join(HERE, "..", "..", ".."))
    const { getProjectId } = await import("../../../src/util/project-id")
    projectId = getProjectId(projectPath)
    tierLabel = "t2-reference-large"
  } else {
    dataDir = path.join(HERE, "bbdata")
    process.env.BB_DATA_DIR = dataDir
    process.env.BB_NO_AUTO_REFRESH = "1"
    const { fixtureContext, FIXTURE_DIR, writeFixture } = await import("./lib/fixture")
    if (TIER === "t1") {
      const scaleRoot = path.resolve(path.join(HERE, "..", "..", "..", ".perf-fixtures", "bb-scale", "n100"))
      if (!existsSync(scaleRoot)) throw new Error(`T1 fixture absent: ${scaleRoot}`)
      const { getProjectId } = await import("../../../src/util/project-id")
      const { indexProjectParallel } = await import("../../../src/ast/parallel-indexer")
      projectPath = scaleRoot
      projectId = getProjectId(scaleRoot)
      const dbPath = path.join(dataDir, "projects", projectId, "brain.db")
      if (!existsSync(dbPath)) { console.log(`indexing T1 fixture…`); await indexProjectParallel(projectId, scaleRoot, {}) }
      tierLabel = "t1-synthetic-n100"
    } else {
      writeFixture(false)
      const context = await fixtureContext(FIXTURE_DIR, false)
      projectId = context.projectId
      projectPath = FIXTURE_DIR
      tierLabel = "t0-tiny-polyglot-like"
    }
  }

  const facts = await indexFacts(projectId)
  const dbFiles = { db: fileState(facts.dbPath), wal: fileState(`${facts.dbPath}-wal`) }
  if (TIER === "t2") before = dbFiles
  const { createToolHandlers } = await import("../../../src/mcp/tool-handlers")
  const handlers = createToolHandlers()
  const context = { projectId, projectPath } as any
  const call = async (args: Record<string, unknown>) => {
    const t0 = performance.now()
    const response: any = await handlers.bb_visualize(args, context)
    const ms = performance.now() - t0
    const text = String(response?.content?.[0]?.text ?? "")
    let nodes = 0, links = 0, truncated = false
    if (String(args.format) === "json") {
      try { const parsed = JSON.parse(text); nodes = parsed.nodes?.length ?? 0; links = parsed.links?.length ?? 0; truncated = parsed.truncation?.truncated === true } catch { /* leave zeroes */ }
    } else if (String(args.format) === "html") {
      const match = /"nodes":\[/.exec(text)
      truncated = /"truncated":true/.test(text)
      nodes = match ? -1 : 0
    } else {
      const head = /^graph: (\d+) nodes, (\d+) links/m.exec(text)
      if (head) { nodes = Number(head[1]); links = Number(head[2]) }
      truncated = /^truncated: yes/m.test(text)
    }
    return { variant: "", ms, nodes, links, bytes: text.length, truncated }
  }

  // One warm call per shape before measuring: the first call in a process pays
  // the database open and the plan cache, and that cost belongs to "cold", not
  // to the warm figures the campaign publishes.
  const variants = [
    { name: "default-text", args: {} },
    { name: "json", args: { format: "json" } },
    { name: "html", args: { format: "html" } },
    { name: "max-budget-json", args: { format: "json", maxNodes: 2000, maxLinks: 20000 } },
    { name: "symbol-text", args: { scope: "symbol", target: TIER === "t2" ? "graphTraversal" : "deep_lookup", format: "text" } },
  ] as const
  // The COLD call: the first request this process serves, which pays the database
  // open, the page cache and the plan cache. Recorded separately because a client
  // timeout is a cold-call failure even when every warm number is inside budget.
  const coldStart = performance.now()
  await call(variants[0].args)
  const coldFirstCallMs = Math.round(performance.now() - coldStart)
  const runs: Run[] = []
  for (let round = 0; round < 5; round++) {
    for (const variant of variants) {
      const measured = await call(variant.args)
      runs.push({ ...measured, variant: variant.name })
    }
  }
  const after = TIER === "t2" ? { db: fileState(facts.dbPath), wal: fileState(`${facts.dbPath}-wal`) } : null
  const summary = variants.map((variant) => {
    const values = runs.filter((run) => run.variant === variant.name)
    const ms = values.map((value) => value.ms)
    return {
      variant: variant.name,
      args: variant.args,
      p50: Math.round(percentile(ms, 50)),
      p95: Math.round(percentile(ms, 95)),
      min: Math.round(Math.min(...ms)),
      max: Math.round(Math.max(...ms)),
      nodes: values[values.length - 1]!.nodes,
      links: values[values.length - 1]!.links,
      bytes: values[values.length - 1]!.bytes,
      truncated: values[values.length - 1]!.truncated,
    }
  })
  const budgets = { t0DefaultP95Ms: 250, t1DefaultP95Ms: 1000, t2DefaultP95Ms: 5000 }
  const defaultRow = summary.find((row) => row.variant === "default-text")!
  const budget = TIER === "t2" ? 5000 : TIER === "t1" ? 1000 : 250
  const evidence = {
    schemaVersion: 1,
    tool: "bb_visualize",
    tier: tierLabel,
    status: "measured",
    currentCommit: commit,
    generatedAt: new Date().toISOString(),
    verifierCommand: `BB_DATA_DIR=${TIER === "t2" ? ".bb-data" : "validation/tools/bb_visualize/bbdata"} npx tsx validation/tools/bb_visualize/latency.ts ${TIER}`,
    environment: {
      runtime: `${process.version} (node --import tsx)`,
      host: hostname(),
      loadAverageAtMeasurement: loadavg().map((value) => Math.round(value * 100) / 100),
      memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB rss in-process`,
      readOnlyRules: "BB_NO_AUTO_REFRESH=1 for the whole sweep; no indexer, no write tool",
      dataDir,
      measurement: "in-process handler calls after one warm call per shape; five measured warm runs per shape",
    },
    referenceIndex: {
      projectId,
      projectPath,
      files: facts.files,
      symbols: facts.symbols,
      relationships: facts.relationships,
      dbPath: facts.dbPath,
      db: dbFiles.db,
      wal: dbFiles.wal,
      source: "COUNT(*) on brain_file / brain_symbol / brain_relationship through a read-only handle",
    },
    budgets: { ...budgets, applied: budget, tier: tierLabel },
    summary,
    defaultP95WithinBudget: defaultRow.p95 <= budget,
    coldFirstCallMs,
    coldWithinClientTimeout: coldFirstCallMs < 30_000,
    readPath: TIER === "t2" ? { before: before, after, dbUnchanged: JSON.stringify(before) === JSON.stringify(after) } : null,
    raw: runs.map((run) => ({ variant: run.variant, ms: Math.round(run.ms) })),
  }
  writeFileSync(path.join(RESULTS_DIR, `latency-${TIER}.json`), JSON.stringify(evidence, null, 2) + "\n")
  console.log(JSON.stringify({ tier: tierLabel, default: defaultRow, budget, within: evidence.defaultP95WithinBudget, coldFirstCallMs, coldWithinClientTimeout: evidence.coldWithinClientTimeout, htmlBytes: summary.find((row) => row.variant === "html")?.bytes, readPath: evidence.readPath ? evidence.readPath.dbUnchanged : "n/a" }, null, 1))
  const green = evidence.defaultP95WithinBudget && evidence.coldWithinClientTimeout
  console.log(`latency-${TIER}: ${green ? "WITHIN BUDGET" : "OVER BUDGET"} (default p95 ${defaultRow.p95} ms vs ${budget} ms; cold first call ${coldFirstCallMs} ms)`)
  process.exit(green ? 0 : 1)
}

main().catch((error) => { console.error("FATAL", error); process.exit(2) })
