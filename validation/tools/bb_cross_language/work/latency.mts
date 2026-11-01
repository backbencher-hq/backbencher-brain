// validation/tools/bb_cross_language/work/latency.mts
//
// Campaign performance measurement for bb_cross_language, three tiers, warm, five
// runs, p50/p95, with the exact subject and command recorded.
//
//   T0 tiny      test/fixtures/polyglot, indexed under validation/tools/<tool>/bbdata
//   T1 synthetic .perf-fixtures/bb-scale/n100, own BB_DATA_DIR
//   T2 reference the workspace's own index (.bb-data/projects/<id>/brain.db)
//
// T2 is measured through the SHARED OWNER MODULE over a READ-ONLY sqlite
// connection, not through the handler. The handler opens the shared store with
// BrainDatabase.getRawInstance, which opens read-write; the campaign rule is that
// a measurement never writes the shared index. The component is the same SQL the
// handler runs, and the handler's own overhead (validation + JSON.stringify) is
// measured separately on T0/T1 so the T2 handler number can be stated as
// component + measured overhead rather than guessed.
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_cross_language/work/latency.mts
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { cpus, totalmem, arch, platform } from "node:os"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const DATA_DIR = join(HERE, "..", "bbdata")
const RUNS = 5

const stats = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b)
  const pct = (p: number) => {
    if (sorted.length === 0) return 0
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
    return sorted[idx]!
  }
  return { p50Ms: round(pct(50)), p95Ms: round(pct(95)), minMs: round(sorted[0] ?? 0), maxMs: round(sorted[sorted.length - 1] ?? 0) }
}
const round = (n: number) => Math.round(n * 1000) / 1000
const now = () => Number(process.hrtime.bigint()) / 1e6

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(join(HERE, "..", "results", "index-manifest.json"), "utf8"))
  const { createToolHandlers } = await import(join(ROOT, "src", "mcp", "tool-handlers.ts"))

  const handlerSet = createToolHandlers() as Record<string, (args: any, ctx: any) => Promise<any>>
  const callHandler = async (projectId: string, args: Record<string, unknown>) => {
    const started = now()
    const result = await handlerSet["bb_cross_language"](args, { projectId, projectPath: "." })
    const elapsed = now() - started
    const text = result?.content?.[0]?.text ?? ""
    return { elapsed, bytes: Buffer.byteLength(text), parsed: safe(text) }
  }
  const safe = (text: string) => { try { return JSON.parse(text) } catch { return null } }

  const shape = (parsed: any) => parsed === null ? { parsed: false } : {
    declaredAbsent: parsed.declaredAbsent,
    ownFactCount: parsed.ownFactCount,
    memberFactCount: parsed.memberFactCount,
    copyCount: parsed.copyCount,
    copiesTruncated: parsed.copiesTruncated,
    truncated: parsed.truncated,
    totalCountIfKnown: parsed.totalCountIfKnown,
  }

  const tiers: Record<string, unknown> = {}

  // ── T0 / T1 through the handler (private data dirs) ─────────────────────────
  process.env.BB_DATA_DIR = DATA_DIR
  process.env.BB_NO_AUTO_REFRESH = "1"
  for (const [tier, subject] of [["T0", "Inventory"], ["T1", "id"]] as const) {
    const projectId = manifest.tiers[tier].projectId as string
    // Warm: one full call, discarded. Then five measured calls.
    const warm = await callHandler(projectId, { symbol: subject })
    const runs: number[] = []
    const bytes: number[] = []
    for (let i = 0; i < RUNS; i++) {
      const r = await callHandler(projectId, { symbol: subject })
      runs.push(r.elapsed)
      bytes.push(r.bytes)
    }
    // A limit-bounded call and a refusal, same tier.
    const boundedRuns: number[] = []
    for (let i = 0; i < RUNS; i++) boundedRuns.push((await callHandler(projectId, { symbol: subject, limit: 1 })).elapsed)
    const missingRuns: number[] = []
    for (let i = 0; i < RUNS; i++) missingRuns.push((await callHandler(projectId, { symbol: "no-such-name-xyz" })).elapsed)
    tiers[tier] = {
      subject: { workspace: manifest.tiers[tier].workspace, projectId, indexMs: manifest.tiers[tier].indexMs, counts: manifest.tiers[tier].counts },
      defaultCall: { args: { symbol: subject }, warmup: 1, runs: RUNS, ...stats(runs), bytes: { min: Math.min(...bytes), max: Math.max(...bytes) }, answerShape: shape(warm.parsed) },
      limit1Call: { args: { symbol: subject, limit: 1 }, runs: RUNS, ...stats(boundedRuns) },
      unknownSymbolCall: { args: { symbol: "no-such-name-xyz" }, runs: RUNS, ...stats(missingRuns), isError: true },
    }
  }

  // ── T2: the reference large index, READ-ONLY ────────────────────────────────
  const Database = (await import("better-sqlite3")).default as any
  const shared = {
    projectId: "1d3d57103be91b8f9716d70199fe28a3f39245d9",
    dbPath: join(ROOT, ".bb-data", "projects", "1d3d57103be91b8f9716d70199fe28a3f39245d9", "brain.db"),
  }
  const db = new Database(shared.dbPath, { readonly: true, fileMustExist: true })
  const { storedCrossLanguageFactsByName } = await import(join(ROOT, "src", "lsp", "cross_language_hover.ts"))
  const componentCall = (name: string) => {
    const started = now()
    const result = (storedCrossLanguageFactsByName as any)(db, shared.projectId, name)
    return { elapsed: now() - started, result }
  }
  const meta = {
    files: (db.prepare("SELECT COUNT(*) n FROM brain_file").get() as any).n,
    symbols: (db.prepare("SELECT COUNT(*) n FROM brain_symbol").get() as any).n,
    relationships: (db.prepare("SELECT COUNT(*) n FROM brain_relationship").get() as any).n,
    crossLanguageRows: (db.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE is_cross_language = 1").get() as any).n,
  }
  const t2Subjects: Record<string, unknown> = {}
  for (const name of ["type", "file", "Command"]) {
    const copies = (db.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ? AND name = ?").get(shared.projectId, name) as any).n
    if (copies === 0) { t2Subjects[name] = { copies, skipped: "name not indexed" }; continue }
    const warm = componentCall(name)
    const runs: number[] = []
    for (let i = 0; i < RUNS; i++) runs.push(componentCall(name).elapsed)
    t2Subjects[name] = {
      copies,
      warmup: 1,
      runs: RUNS,
      ...stats(runs),
      answer: { facts: warm.result.facts.length, memberFacts: warm.result.memberFacts.length, storedRowCount: warm.result.storedRowCount, deeperDescendantRowCount: warm.result.deeperDescendantRowCount, copiesTruncated: warm.result.copiesTruncated },
    }
  }
  db.close()

  // Handler overhead on the same machines: total handler minus the component work.
  let handlerOverhead: unknown = null
  {
    const t0 = manifest.tiers.T0
    const db0 = new Database(join(DATA_DIR, "projects", t0.projectId, "brain.db"), { readonly: true, fileMustExist: true })
    const comp = Array.from({ length: RUNS }, () => {
      const started = now()
      ;(storedCrossLanguageFactsByName as any)(db0, t0.projectId, "Inventory")
      return now() - started
    })
    // Sequential: five concurrent handler calls measure the event loop's queue
    // as much as the handler, and the point of this block is per-call overhead.
    const handlerTimes: number[] = []
    for (let i = 0; i < RUNS; i++) handlerTimes.push((await callHandler(t0.projectId, { symbol: "Inventory" })).elapsed)
    db0.close()
    handlerOverhead = { component: stats(comp), handler: stats(handlerTimes), note: "same process, same fixture; the difference is handler validation + envelope assembly + JSON.stringify" }
  }

  const payload = {
    schemaVersion: 1,
    tool: "bb_cross_language",
    generatedAt: new Date().toISOString(),
    currentCommit: "c43282e92",
    rules: ["BB_NO_AUTO_REFRESH=1", "warm (one discarded warmup call per subject)", `${RUNS} measured runs per subject`, "p50/p95 from the measured runs"],
    environment: {
      node: process.version,
      platform: `${platform()} ${arch()}`,
      cpus: cpus().length,
      totalMemGB: Math.round(totalmem() / 1024 / 1024 / 1024),
    },
    budgets: { T0DefaultMaxMs: 250, T1DefaultMaxMs: 1000, T2DefaultMaxMs: 5000, clientTimeoutMs: 30000 },
    tiers,
    t2: {
      measure: "shared owner module over a read-only sqlite connection — see the file header for why the handler is not used on the shared index",
      index: meta,
      subjects: t2Subjects,
      readOnly: true,
    },
    handlerOverhead,
    commands: {
      fixtures: "BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_cross_language/work/index-fixtures.mts",
      latency: "BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_cross_language/work/latency.mts",
    },
    limitations: [
      "T2's index carries ZERO stored cross-language rows (measured), so T2 exercises the absence path only; no T2 answer can contain a fact.",
      "T2 is measured through the component because the handler opens the shared store read-write and this campaign's rule forbids writing it from a measurement. The handler's own overhead is measured on T0 in the same process.",
      "T1's synthetic index is single-language TypeScript, so it also exercises the absence path only; T0 is the only tier with stored cross-language rows.",
      "Wall-clock figures belong to this machine; the ratio against the same-machine component runs is the portable part.",
    ],
  }
  writeFileSync(join(HERE, "..", "results", "LATENCY-raw.json"), JSON.stringify(payload, null, 2) + "\n")
  console.log(JSON.stringify({ tiers: Object.fromEntries(Object.entries(tiers).map(([k, v]: any) => [k, v.defaultCall])), t2: t2Subjects, handlerOverhead, environment: payload.environment }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
