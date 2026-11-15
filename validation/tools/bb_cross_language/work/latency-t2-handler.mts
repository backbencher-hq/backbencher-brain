// validation/tools/bb_cross_language/work/latency-t2-handler.mts
//
// T2 (reference large index) measured through the REAL handler, against the COPY of
// the reference store under validation/tools/bb_cross_language/t2-copy. The shared
// store is never opened read-write by a measurement; the copy is (copy-t2-db.cjs made
// it from a read-only connection with the SQLite backup API).
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_cross_language/work/latency-t2-handler.mts
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const COPY = join(HERE, "..", "t2-copy")
const PROJECT = "1d3d57103be91b8f9716d70199fe28a3f39245d9"
const RUNS = 5
process.env.BB_DATA_DIR = COPY
process.env.BB_NO_AUTO_REFRESH = "1"

const now = () => Number(process.hrtime.bigint()) / 1e6
const round = (n: number) => Math.round(n * 1000) / 1000
const stats = (xs: number[]) => {
  const sorted = [...xs].sort((a, b) => a - b)
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!
  return { p50Ms: round(at(50)), p95Ms: round(at(95)), minMs: round(sorted[0]!), maxMs: round(sorted[sorted.length - 1]!) }
}

const copyInfo = JSON.parse(readFileSync(join(HERE, "..", "results", "t2-copy.json"), "utf8"))
const { createToolHandlers } = await import(join(ROOT, "src", "mcp", "tool-handlers.ts"))
const { storedCrossLanguageFactsByName } = await import(join(ROOT, "src", "lsp", "cross_language_hover.ts"))
const handlers = createToolHandlers() as Record<string, (args: any, ctx: any) => Promise<any>>
const ctx = { projectId: PROJECT, projectPath: "/t2-copy" }
const call = async (args: Record<string, unknown>) => {
  const started = now()
  const result = await handlers["bb_cross_language"](args, ctx)
  const elapsed = now() - started
  const text = result?.content?.[0]?.text ?? ""
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch {}
  return { elapsed, bytes: Buffer.byteLength(text), parsed }
}
// Independent component reference over a read-only connection, for the agreement leg.
const Database = (await import("better-sqlite3")).default as any
const ro = new Database(join(COPY, "projects", PROJECT, "brain.db"), { readonly: true, fileMustExist: true })

const subjects: Record<string, unknown> = {}
for (const name of ["Command", "type", "file"]) {
  const copies = (ro.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id = ? AND name = ?").get(PROJECT, name) as any).n
  const warm = await call({ symbol: name })
  const runs: number[] = []
  for (let i = 0; i < RUNS; i++) runs.push((await call({ symbol: name })).elapsed)
  const limited: number[] = []
  for (let i = 0; i < RUNS; i++) limited.push((await call({ symbol: name, limit: 1 })).elapsed)
  const cstarted = now()
  const component = (storedCrossLanguageFactsByName as any)(ro, PROJECT, name)
  const componentMs = now() - cstarted
  subjects[name] = {
    copies,
    defaultCall: { args: { symbol: name }, warmup: 1, runs: RUNS, ...stats(runs), bytes: warm.bytes },
    limit1Call: { args: { symbol: name, limit: 1 }, runs: RUNS, ...stats(limited) },
    answerShape: { declaredAbsent: warm.parsed?.declaredAbsent, factCount: warm.parsed?.factCount, storedRowCount: warm.parsed?.storedRowCount, deeperDescendantRowCount: warm.parsed?.deeperDescendantRowCount, copyCount: warm.parsed?.copyCount, copiesTruncated: warm.parsed?.copiesTruncated },
    componentOneShot: { ms: round(componentMs), facts: component.facts.length, storedRowCount: component.storedRowCount },
    handlerMatchesComponent: (warm.parsed?.factCount ?? -1) === component.facts.length + component.memberFacts.length && (warm.parsed?.storedRowCount ?? -1) === component.storedRowCount,
  }
}
ro.close()
const out = {
  schemaVersion: 1,
  tool: "bb_cross_language",
  tier: "T2 reference large index — HANDLER level",
  measuredAt: new Date().toISOString(),
  currentCommit: (() => { try { return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  copy: { destination: copyInfo.destination, bytes: copyInfo.bytes, sourceCounts: copyInfo.sourceCounts, equal: copyInfo.equal, note: "the handler runs against this copy with a private BB_DATA_DIR; the shared store is untouched" },
  environment: { node: process.version, cpus: (await import("node:os")).cpus().length, load: readFileSync("/proc/loadavg", "utf8").trim() },
  rules: ["BB_NO_AUTO_REFRESH=1", "warm (one discarded call per subject)", `${RUNS} measured runs`, "p50/p95 from the measured runs"],
  budget: { p95Ms: 5000, verdict: Object.values(subjects).every((s: any) => s.defaultCall.p95Ms <= 5000) ? "within budget" : "BREACH" },
  subjects,
  limitations: [
    "The reference index carries ZERO stored cross-language rows, so T2 exercises the absence path only; the facts path on a large row population is measured by the CL1 corpus lane (692-file elixir index, 714 rows).",
    "Wall-clock figures belong to this machine and were taken while a fleet process shares the checkout; the load average is recorded.",
  ],
}
writeFileSync(join(HERE, "..", "results", "LATENCY-t2-handler.json"), JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify({ budget: out.budget, subjects: Object.fromEntries(Object.entries(subjects).map(([k, v]: any) => [k, { default: v.defaultCall, limit1: v.limit1Call, agree: v.handlerMatchesComponent }])) }, null, 2))
