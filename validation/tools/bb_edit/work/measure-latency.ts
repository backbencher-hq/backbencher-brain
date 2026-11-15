// bb_edit latency measurement — T0 (copy of test/fixtures/polyglot) and T1
// (copy of .perf-fixtures/bb-scale/n100), each indexed once under
// validation/tools/bb_edit/bbdata. Warm, five runs per operation, p50/p95.
//
// The fixtures are COPIED under validation/tools/bb_edit/work/run/tiers first:
// the measurement writes files, and it must never mutate the repository's own
// fixture trees (or its index).
import { cpSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel, reindexFilesParallel } from "../../../../src/ast/parallel-indexer"
import { executeEdit, type EditRequest } from "../../../../src/intelligence/edit/edit-engine"
import { ASTEngine } from "../../../../src/ast/engine"

const RUNS = 5
type Sample = { op: string; tier: "T0" | "T1"; ms: number[]; p50: number; p95: number; note?: string }

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

async function measure(
  tier: "T0" | "T1",
  op: string,
  fn: () => Promise<unknown>,
  after?: () => Promise<void>,
  note?: string,
): Promise<Sample> {
  const timed = async (): Promise<number> => {
    const start = process.hrtime.bigint()
    await fn()
    return Number(process.hrtime.bigint() - start) / 1e6
  }
  await timed() // one excluded warm-up run
  if (after) await after()
  const ms: number[] = []
  for (let i = 0; i < RUNS; i++) {
    ms.push(await timed())
    if (after) await after()
  }
  const sorted = [...ms].sort((a, b) => a - b)
  return { op, tier, ms, p50: percentile(sorted, 50), p95: percentile(sorted, 95), note }
}

/** First indexed symbol in a fixture whose span the engine can actually edit.
 *  A body-fragment update is the cheapest probe that the symbol has a spliceable
 *  body inside its indexed span; candidates that fail it are skipped rather than
 *  measured, because a refusal is not a latency sample. */
async function firstUpdatableSymbol(projectId: string, root: string): Promise<{ name: string; absFile: string; relFile: string } | null> {
  for (const name of ["total", "declaredAbsenceFor", "absenceWith", "markerFor", "basePrice", "getStock", "Inventory", "Warehouse", "alpha0", "main", "helper"]) {
    const found = await ASTEngine.findSymbol(projectId, name)
    if (found.matches.length !== 1) continue
    const match = found.matches[0]
    const rel = path.relative(root, match.fileId)
    try {
      await executeEdit(root, projectId, { mode: "update", symbolName: match.name, filePath: rel, newContent: "return 3", dryRun: true, format: false })
      return { name: match.name, absFile: match.fileId, relFile: match.fileId }
    } catch {
      continue
    }
  }
  return null
}

async function tierRun(tier: "T0" | "T1", root: string): Promise<{ samples: Sample[]; note: string }> {
  const projectId = getProjectId(root)
  const symbol = await firstUpdatableSymbol(projectId, root)
  if (!symbol) return { samples: [], note: `${tier}: no indexed symbol found to time` }
  const pristine = readFileSync(symbol.absFile)
  const rel = path.relative(root, symbol.absFile)
  const restore = async (): Promise<void> => {
    writeFileSync(symbol.absFile, pristine)
    await reindexFilesParallel(projectId as any, root, [{ path: symbol.absFile, type: "modified" as const }])
  }
  const scratchRel = `src/latency-${tier}.ts`
  const scratchAbs = path.join(root, scratchRel)
  const restoreScratch = async (): Promise<void> => {
    rmSync(scratchAbs, { force: true })
    await reindexFilesParallel(projectId as any, root, [{ path: scratchAbs, type: "modified" as const }]).catch(() => {})
  }
  if (existsSync(scratchAbs)) await restoreScratch()

  const out: Sample[] = []
  out.push(await measure(tier, "update dryRun", () => executeEdit(root, projectId, { mode: "update", symbolName: symbol.name, filePath: rel, newContent: "return 3", dryRun: true, format: false })))
  out.push(await measure(tier, "update commit", async () => {
    await executeEdit(root, projectId, { mode: "update", symbolName: symbol.name, filePath: rel, newContent: "return 4", format: false })
  }, restore, "timed region is executeEdit only: plan + write + format check + validate + reindex; the fixture restore between runs is outside it"))
  out.push(await measure(tier, "insert inside-top commit", async () => {
    await executeEdit(root, projectId, { mode: "insert", targetSymbolName: symbol.name, filePath: rel, position: "inside-top", newContent: "// latency", format: false })
  }, restore))
  out.push(await measure(tier, "write create commit", async () => {
    await executeEdit(root, projectId, { mode: "write", filePath: scratchRel, content: `export const latency${tier} = 1\n`, format: false })
  }, restoreScratch))
  out.push(await measure(tier, "delete dryRun (force)", () => executeEdit(root, projectId, { mode: "delete", symbolName: symbol.name, filePath: rel, force: true, dryRun: true, format: false })))
  out.push(await measure(tier, "batch dryRun (2 write entries)", () => executeEdit(root, projectId, {
    mode: "batch",
    dryRun: true,
    format: false,
    edits: [
      { mode: "write", filePath: `src/batch-${tier}-a.ts`, content: "export const ba = 1\n" },
      { mode: "write", filePath: `src/batch-${tier}-b.ts`, content: "export const bb = 1\n" },
    ],
  })))
  return { samples: out, note: `${tier}: symbol ${symbol.name} (${rel})` }
}

async function main(): Promise<void> {
  const runDir = path.resolve("validation/tools/bb_edit/work/run/tiers")
  rmSync(runDir, { recursive: true, force: true })
  mkdirSync(runDir, { recursive: true })
  const t0Root = path.join(runDir, "t0-polyglot")
  const t1Root = path.join(runDir, "t1-n100")
  cpSync(path.resolve("test/fixtures/polyglot"), t0Root, { recursive: true })
  cpSync(path.resolve(".perf-fixtures/bb-scale/n100"), t1Root, { recursive: true })

  const t0Id = getProjectId(t0Root)
  const t1Id = getProjectId(t1Root)
  const t0Started = Date.now()
  await indexProjectParallel(t0Id as any, t0Root, {})
  const t0IndexMs = Date.now() - t0Started
  const t1Started = Date.now()
  await indexProjectParallel(t1Id as any, t1Root, {})
  const t1IndexMs = Date.now() - t1Started

  const t0 = await tierRun("T0", t0Root)
  const t1 = await tierRun("T1", t1Root)
  const samples = [...t0.samples, ...t1.samples]

  const doc = {
    schemaVersion: 1,
    tool: "bb_edit",
    tiers: {
      T0: { subject: "test/fixtures/polyglot (copied to a lane work dir)", root: t0Root, note: t0.note },
      T1: { subject: ".perf-fixtures/bb-scale/n100 (copied to a lane work dir)", root: t1Root, note: t1.note },
      T2: { subject: "not measured", reason: "bb_edit mutates source and reindexes; the shared reference index is read-only for this tool lane. Its cost is bounded by the TOUCHED file, not the project size, which is what T0/T1 exercise." },
    },
    environment: {
      node: process.version,
      runs: RUNS,
      warm: "one excluded warm-up run per operation; the fixture index is built once before measurement",
      bbDataDir: process.env.BB_DATA_DIR ?? "(unset)",
      bbNoAutoRefresh: process.env.BB_NO_AUTO_REFRESH ?? "(unset)",
      indexSeconds: { T0: Number((t0IndexMs / 1000).toFixed(2)), T1: Number((t1IndexMs / 1000).toFixed(2)) },
      command: "BB_DATA_DIR=$PWD/validation/tools/bb_edit/bbdata BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_edit/work/measure-latency.ts",
      skipped: "refactor is not timed: it is not a default-argument call (requires newName) and its cost is proportional to the symbol's imported/called graph, which the fixture tiers do not represent",
    },
    budgets: { T0: 250, T1: 1000, source: "docs/tools-campaign/CHARTER.md §6 — T0 default calls < 250 ms, T1 < 1 s (p95)" },
    operations: samples.map((s) => ({
      tier: s.tier,
      operation: s.op,
      runsMs: s.ms.map((v) => Number(v.toFixed(1))),
      p50: Number(s.p50.toFixed(1)),
      p95: Number(s.p95.toFixed(1)),
      withinBudget: s.p95 <= (s.tier === "T0" ? 250 : 1000),
      ...(s.note ? { note: s.note } : {}),
    })),
    generatedAt: new Date().toISOString(),
  }
  const out = path.resolve("validation/tools/bb_edit/LATENCY.json")
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n")
  for (const row of doc.operations) console.log(`${row.tier} ${row.operation.padEnd(32)} p50=${String(row.p50).padStart(8)}ms p95=${String(row.p95).padStart(8)}ms within=${row.withinBudget}`)
  console.log(`\nLATENCY → ${out}`)
}

main().catch((e) => { console.error("FATAL", e); process.exit(2) })
