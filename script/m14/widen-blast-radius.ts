/**
 * BLAST-RADIUS SCAN for widening `ontology-coverage-gate.ts`'s ALL_TYPES.
 *
 * WHY THIS EXISTS. The gate's `ALL_TYPES` (`:123`) is the list of relationship types it can
 * count, rule and print. It held **10** while `src/ast/types.ts:91` has declared **14** since the
 * four EXTENDED values landed. A type absent from ALL_TYPES was invisible to the gate in all three
 * places it is used: the edge counter (`if (!ALL_TYPES.includes(t)) continue`), the un-emitted
 * guard, and the row loop. So no lane could adjudicate `decorates` / `mixes_in` / `part_of` /
 * `renders` — their edges were dropped before counting and they never reached the table.
 *
 * Widening the list is one line, but it changes what every lane prints. This scan measures that
 * BEFORE the edit, per lane, so the change is a decision with numbers rather than a surprise.
 *
 *   emitted  — some analyzer in src/ast emits this type (`RelationshipType.<T>`)
 *   ruled    — the lane's spec carries a RULED decision naming the type, OR its `*-ruled.ts`
 *              table has an entry for it
 *   neither  — the lane would gain a RULED-UNJUSTIFIED row: it does not emit the type and has
 *              never ruled it out. THAT is the debt the gate exists to expose, and the number is
 *              what the owner needs to see before the arbiter starts reporting it.
 *
 * THE MEASUREMENT IT RECORDED (2026-11-19, before the widening landed): 52 lanes scanned, **155
 * new RULED-UNJUSTIFIED rows** fleet-wide — decorates 34, mixes_in 42, part_of 45, renders 34.
 * That is debt being EXPOSED, not a regression; every one is a lane that does not emit the type
 * and has never ruled it out. The gate's self-test passes 11/11 before and after.
 *
 * This file is committed because `docs/analyzers/csharp.md` cites the number. A measurement a
 * reader cannot re-run is a claim, not evidence.
 *
 * RUN: bun script/m14/widen-blast-radius.ts
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const EXTENDED = ["decorates", "mixes_in", "part_of", "renders"] as const

/** Which extended types each analyzer emits, read from the source rather than guessed. */
function emittedByAnalyzers(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const astDir = path.join(ROOT, "src/ast")
  for (const f of fs.readdirSync(astDir)) {
    if (!f.startsWith("real-") || !f.endsWith("-analyzer.ts")) continue
    const lang = f.slice("real-".length, -"-analyzer.ts".length)
    const src = fs.readFileSync(path.join(astDir, f), "utf8")
    const set = new Set<string>()
    for (const t of EXTENDED) {
      const cap = t[0].toUpperCase() + t.slice(1)
      if (new RegExp(`RelationshipType\\.${cap}\\b`).test(src)) set.add(t)
    }
    out.set(lang, set)
  }
  return out
}

/** Which extended types a lane's SPEC rules out (a RULED decision whose body names the type). */
function ruledBySpec(lang: string): Set<string> {
  const p = path.join(ROOT, "script/m14/spec", `${lang}-completeness.json`)
  const set = new Set<string>()
  if (!fs.existsSync(p)) return set
  let d: any
  try { d = JSON.parse(fs.readFileSync(p, "utf8")) } catch { return set }
  const decs = d?.design_decision?.decisions ?? []
  for (const t of EXTENDED) {
    const re = new RegExp(`\\b${t}\\b`, "i")
    for (const dec of decs) {
      if (dec.status !== "RULED") continue
      if (re.test(String(dec.resolution ?? ""))) { set.add(t); break }
    }
  }
  return set
}

/** Which extended types a lane's TABLE rules out (`script/m14/<lang>-ruled.ts`). */
function ruledByTable(lang: string): Set<string> {
  const p = path.join(ROOT, "script/m14", `${lang}-ruled.ts`)
  const set = new Set<string>()
  if (!fs.existsSync(p)) return set
  const src = fs.readFileSync(p, "utf8")
  for (const t of EXTENDED) if (new RegExp(`type:\\s*"${t}"`).test(src)) set.add(t)
  return set
}

const emitted = emittedByAnalyzers()
const lanes = [
  ...new Set([
    ...fs.readdirSync(path.join(ROOT, "script/m14/spec"))
      .filter((f) => f.endsWith("-completeness.json"))
      .map((f) => f.replace("-completeness.json", "")),
    ...emitted.keys(),
  ]),
].sort()

console.log("lane-by-lane effect of widening ALL_TYPES 10 -> 14\n")
console.log("lane         " + EXTENDED.map((t) => t.padEnd(10)).join("") + "  new UNJUSTIFIED rows")
console.log("-".repeat(100))

let totalNew = 0
const perTypeNew: Record<string, number> = {}
const worst: Array<{ lane: string; n: number; which: string[] }> = []

for (const lane of lanes) {
  const em = emitted.get(lane) ?? new Set<string>()
  const rs = ruledBySpec(lane)
  const rt = ruledByTable(lane)
  const cells: string[] = []
  const unjust: string[] = []
  for (const t of EXTENDED) {
    let cell: string
    if (em.has(t)) cell = "EMITTED"
    else if (rt.has(t)) cell = "ruled-tbl"
    else if (rs.has(t)) cell = "ruled-spec"
    else { cell = "—"; unjust.push(t); perTypeNew[t] = (perTypeNew[t] ?? 0) + 1 }
    cells.push(cell.padEnd(10))
  }
  if (unjust.length) {
    totalNew += unjust.length
    worst.push({ lane, n: unjust.length, which: unjust })
  }
  console.log(lane.padEnd(13) + cells.join("") + "  " + (unjust.length ? unjust.join(", ") : "0"))
}

console.log("\n" + "-".repeat(100))
console.log(`lanes scanned: ${lanes.length}`)
console.log(`NEW RULED-UNJUSTIFIED rows across the fleet: ${totalNew}`)
console.log(`by type: ${Object.entries(perTypeNew).map(([k, v]) => `${k}=${v}`).join("  ") || "(none)"}`)
console.log("\nworst offenders (lanes gaining the most rows):")
for (const w of worst.sort((a, b) => b.n - a.n).slice(0, 8)) {
  console.log(`  ${w.lane.padEnd(12)} ${w.n}  ${w.which.join(", ")}`)
}
console.log("\nbase 10 types are unaffected by this change (all lanes already report them).")
console.log("A non-zero total is DEBT EXPOSED, not a regression: each row is a lane that does not")
console.log("emit the type and has never ruled it out. The gate's self-test must still pass 11/11.")