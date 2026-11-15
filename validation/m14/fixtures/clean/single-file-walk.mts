/**
 * single-file-walk — parse EXACTLY ONE path through production `parseFile` and print
 * its symbols and edges as JSON.
 *
 * This is the isolated half of `clean-excluded-probe.mts`, and it exists as its own
 * process on purpose. The probe's question is whether a file the sharded walk excluded
 * for a 120 s WALL-CLOCK timeout can be walked when it has the machine to itself. That
 * question is only answerable if nothing else is being parsed at the same time, so one
 * path per process and no shared pool: a shared pool would reintroduce the contention
 * the probe exists to remove, and the file would be excluded for the original reason.
 *
 * `parseFile` from `src/ast/pool-worker.ts` is the production entry point. `analyze()`
 * is deliberately NOT used — it is a per-file unit that skips the pipeline stages
 * (pool, timeouts, truncation, enhancements), so a count from it is not a count from
 * the pipeline.
 *
 * Exit 0 with JSON on stdout when the file walked. Exit non-zero, or 0 with an
 * `outcome` of HUNG/ERRORED, when it did not — never a silent zero, because "the file
 * produced no edges" and "the file was not read" are different claims and the probe
 * would rather fail loudly than blur them.
 *
 * Usage: npx tsx validation/m14/fixtures/clean/single-file-walk.mts <abs path>
 */
import * as fs from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const target = process.argv[2]
if (!target || !fs.existsSync(target)) {
  console.error(`usage: single-file-walk.mts <abs path to an existing file>`)
  console.error(`  given: ${target ?? "(nothing)"}`)
  process.exit(2)
}

const t0 = Date.now()
let result: Awaited<ReturnType<typeof parseFile>>
try {
  result = await parseFile(target)
} catch (e) {
  // A parse that THROWS is a measurement, and it is reported as one.
  process.stdout.write(JSON.stringify({
    path: target, outcome: "ERRORED", ms: Date.now() - t0,
    error: (e as Error).message.slice(0, 500), symbols: 0, edges: 0, kinds: {},
  }, null, 2) + "\n")
  process.exit(0)
}

const symbols = result?.symbols ?? []
const relationships = result?.relationships ?? []
const kinds: Record<string, number> = {}
for (const s of symbols) {
  const k = String((s as { kind?: string }).kind ?? "")
  kinds[k] = (kinds[k] ?? 0) + 1
}

const perType: Record<string, number> = {}
for (const r of relationships) {
  const t = String((r as { type?: string }).type ?? "")
  perType[t] = (perType[t] ?? 0) + 1
}

process.stdout.write(JSON.stringify({
  path: target,
  outcome: "PARSED",
  ms: Date.now() - t0,
  symbols: symbols.length,
  edges: relationships.length,
  kinds,
  perType,
  emptyNames: symbols.filter((s) => !String((s as { name?: string }).name ?? "")).length,
  unknownKind: symbols.filter((s) => { const k = String((s as { kind?: string }).kind ?? ""); return !k || k === "unknown" }).length,
  unknownEndpoints: relationships.filter((r) => {
    const x = r as { source?: string; target?: string }
    return String(x.source ?? "") === "unknown" || String(x.target ?? "") === "unknown"
  }).length,
}, null, 2) + "\n")