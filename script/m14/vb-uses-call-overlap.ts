/**
 * VB USES / CALLS OVERLAP PROBE — can one member access carry BOTH labels?
 *
 * ## The question
 *
 * `uses` is defined in this lane's own contract as "a value read that is neither a
 * call nor a write" (go's GO1, csharp's CS-D4 and CS-R1 say the same). So a member
 * access that IS the callee of a call must not also be published as a read, or one
 * fact carries two labels and both the `calls` count and the `uses` count are
 * inflated by the same rows.
 *
 * The analyzer excludes callee position with `isCalleePosition`, which CLIMBS from
 * the member access to its enclosing node. For `obj.M()` the shape is
 *
 *     invocation_expression(function: member_access_expression)
 *
 * and the climb compares `function` by node id, so it works. For `obj.M(3)` this
 * grammar produces
 *
 *     return_statement
 *       array_access_expression            <- no invocation node anywhere
 *         member_access_expression         <- the member access
 *           identifier . identifier
 *
 * and the climb walks out of the `array_access_expression` to the `return_statement`
 * and returns false. So the member is published as BOTH `calls -> M` (by the
 * `array_access_expression` branch of `collectBodyEdges`) and `uses -> M`.
 *
 * ## Why this is a separate instrument and not a fixture assertion
 *
 * Because the number moves with the corpus. A fixture can assert that ONE shape
 * double-labels; only a count over a derived population says how much of the graph
 * is affected, and the honesty contract's population rule requires the denominator
 * beside it. The fixture that pins the fix is
 * `validation/m14/fixtures/vb/member-read-and-construction.vb`.
 *
 * ## No regex
 *
 * Joins are on strings; the population is a sorted directory walk. Nothing here
 * matches source text.
 */

import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.VB_CORPUS ?? "roslyn-vb"
const DIR = join(CORPUS_ROOT, REPO)
const LIMIT = Number(process.env.VB_NFILES ?? 0)
const MAX_DRAWS = Number(process.env.VB_DRAWS ?? 25)

function hasSuffix(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length
}

function derivePopulation(dir: string, ext: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (out.length >= want || depth > 24) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (out.length >= want) return
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!hasSuffix(e.name, ext)) continue
      try { if (statSync(p).isFile()) out.push(p) } catch {}
    }
  }
  walk(dir, 0)
  return out
}

const allOnDisk = derivePopulation(DIR, ".vb", Number.MAX_SAFE_INTEGER)
const files = LIMIT > 0 ? allOnDisk.slice(0, LIMIT) : allOnDisk

console.log("=".repeat(92))
console.log("VB USES/CALLS OVERLAP PROBE")
console.log(`population DERIVED by directory walk: ${allOnDisk.length} .vb files on disk`)
console.log(`population MEASURED this run:        ${files.length}`)
console.log("entry point: parseFile() — production")
console.log("=".repeat(92) + "\n")

let usesTotal = 0
let callsTotal = 0
/** (source|target) pairs carrying BOTH a `uses` and a `calls` edge. */
const overlapPairs = new Set<string>()
let overlapEdges = 0
const overlapByShape: Map<string, number> = new Map()
const draws: string[] = []
const overlapFiles = new Set<string>()

for (const abs of files) {
  const rel = abs.slice(DIR.length + 1)
  let r: any
  try { r = await parseFile(abs, DIR) } catch { continue }
  const usesKeys = new Map<string, any[]>()
  const callsKeys = new Set<string>()
  for (const e of (r.relationships ?? [])) {
    const t = String(e?.type ?? "")
    const k = `${String(e.source ?? "")}|${String(e.target ?? "")}`
    if (t === "uses") {
      usesTotal++
      const arr = usesKeys.get(k) ?? []
      arr.push(e)
      usesKeys.set(k, arr)
    } else if (t === "calls") {
      callsTotal++
      callsKeys.add(k)
    }
  }
  for (const [k, arr] of usesKeys) {
    if (!callsKeys.has(k)) continue
    overlapEdges += arr.length
    overlapPairs.add(k)
    overlapFiles.add(rel)
    for (const e of arr) {
      const shape = String(e?.metadata?.readKind ?? "?")
      const callShape = "?"
      overlapByShape.set(shape, (overlapByShape.get(shape) ?? 0) + 1)
      if (draws.length < MAX_DRAWS) {
        draws.push(`${rel}:${String(e.line_number ?? "?")}  uses ${JSON.stringify(e.source)} -> ${JSON.stringify(e.target)}` +
          `  (readKind=${shape}, and the same pair also has a calls edge${callShape === "?" ? "" : " " + callShape})`)
      }
    }
  }
}

console.log("MEASURED")
console.log(`  uses edges                                     ${usesTotal}`)
console.log(`  calls edges                                    ${callsTotal}`)
console.log(`  (source,target) pairs carrying BOTH labels     ${overlapPairs.size}`)
console.log(`  uses edges whose pair also has a calls edge     ${overlapEdges}` +
  (usesTotal > 0 ? `  (${((overlapEdges / usesTotal) * 100).toFixed(2)}% of all uses edges)` : ""))
console.log(`  ...across ${overlapFiles.size} of ${files.length} files`)
console.log(`  by readKind: ${[...overlapByShape.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
console.log("")
if (draws.length > 0) {
  console.log(`DRAWS (capped at ${MAX_DRAWS})`)
  for (const d of draws) console.log("  " + d)
  console.log("")
}
console.log("VERDICT RULE: a member access that the analyzer published as a `calls` edge")
console.log("must NOT also be published as a `uses` edge. Any non-zero count above is a")
console.log("mislabel: one site, two types.")
console.log("")
console.log("DONE. population DERIVED: " + allOnDisk.length + "; measured: " + files.length)