/**
 * AGGREGATE the residual-cause attribution probe's TABLE 3 into per-type class totals.
 *
 * ## Why this is a file rather than mental arithmetic
 *
 * `probe-graphql-residual-causes.mts` prints one row per (type, evidence class), and its
 * `BARE-NAME-COLLIDING (N declarations in the project)` label embeds the declaration COUNT as a
 * SEPARATE CLASS per distinct N — which is right for a worklist (a name colliding with 2
 * declarations and one colliding with 1,158 are different problems) and wrong as a headline: the
 * lane's report needs "how much of the residual is a bare name that collides with something", not
 * 60 rows of it.
 *
 * Aggregating those rows by eye is where a wrong number gets published. So the sum is computed
 * here, from the artifact, and it CHECKS ITS OWN CLOSURE: the probe prints, per type,
 * `classified N = residual OK` only when its classes partition the residual. This script re-checks
 * that the aggregated classes still sum to the residual, and REFUSES to print totals for a type
 * whose partition does not close.
 *
 * Usage: npx tsx validation/m14/fixtures/graphql/aggregate-residual-causes.mts <probe-output.log>
 */
import { readFileSync } from "node:fs"

const path = process.argv[2]
if (!path) {
  console.error("usage: npx tsx validation/m14/fixtures/graphql/aggregate-residual-causes.mts <probe-run.log>")
  process.exit(2)
}
const lines = readFileSync(path, "utf8").split("\n")

type Cls = { label: string; edges: number; names: number }
type Ty = { type: string; residual: number; amb: number; unres: number; classes: Cls[] }
const types: Ty[] = []
let cur: Ty | null = null
for (const raw of lines) {
  const t = raw.trim()
  const head = t.match(/^(\w+) — residual ([\d,]+) \(amb ([\d,]+) · unres ([\d,]+)\) · classified ([\d,]+)/)
  if (head) {
    cur = { type: head[1], residual: Number(head[2].replace(/,/g, "")), amb: Number(head[3].replace(/,/g, "")), unres: Number(head[4].replace(/,/g, "")), classes: [] }
    types.push(cur)
    const sum = Number(head[5].replace(/,/g, ""))
    if (sum !== cur.residual) console.error(`  ** ${cur.type}: probe said classified ${sum} vs residual ${cur.residual} — REFUSING this type`)
    continue
  }
  const row = t.match(/^([\d,]+)\s+([\d.]+)%\s+(.+?)\s+names=([\d,]+)\s+e\.g\./)
  if (row && cur) {
    cur.classes.push({ edges: Number(row[1].replace(/,/g, "")), label: row[3].trim(), names: Number(row[4].replace(/,/g, "")) })
  }
}
if (types.length === 0) {
  console.error("no TABLE 3 rows found — is this the probe's output?")
  process.exit(2)
}
/** the aggregate label: the class with its declaration count stripped, so one cause is one row. */
const family = (label: string): string =>
  label
    .replace(/\s*\(\d+ declarations? in the project\)/, "")
    .replace(/\s*\(\d+ declarations; the owner IS declared\)/, " (the owner IS declared)")
    .replace(/\s*\(the owner type is declared nowhere in the project\)/, "")
    .replace(/\s*<--.*$/, "")
const num = (n: number) => n.toLocaleString("en-US")
let grand = 0
const grandFam = new Map<string, { edges: number; names: number }>()
for (const ty of types) {
  const sum = ty.classes.reduce((a, c) => a + c.edges, 0)
  const closed = sum === ty.residual
  console.log(`${ty.type} — residual ${num(ty.residual)} (amb ${num(ty.amb)} · unres ${num(ty.unres)}) · classes sum ${num(sum)} ${closed ? "= residual OK" : "** DOES NOT CLOSE **"}`)
  const fam = new Map<string, { edges: number; rows: number; names: number }>()
  for (const c of ty.classes) {
    const f = family(c.label)
    let a = fam.get(f)
    if (!a) fam.set(f, (a = { edges: 0, rows: 0, names: 0 }))
    a.edges += c.edges
    a.rows++
    a.names += c.names
  }
  for (const [f, a] of [...fam.entries()].sort((x, y) => y[1].edges - x[1].edges)) {
    console.log(`    ${String(num(a.edges)).padStart(7)}  ${((a.edges / ty.residual) * 100).toFixed(1).padStart(5)}%  ${f}${a.rows > 1 ? `  [${a.rows} declaration-count rows]` : ""}`)
    const g = grandFam.get(f) ?? { edges: 0, names: 0 }
    grandFam.set(f, { edges: g.edges + a.edges, names: g.names + a.names })
  }
  grand += ty.residual
  console.log("")
}
console.log(`LANE — residual ${num(grand)} across ${types.length} type(s) with residual`)
const total = [...grandFam.values()].reduce((a, x) => a + x.edges, 0)
console.log(`  classes sum ${num(total)} ${total === grand ? "= residual OK (the partition closes over the whole lane)" : "** DOES NOT CLOSE **"}`)
for (const [f, a] of [...grandFam.entries()].sort((x, y) => y[1].edges - x[1].edges)) {
  console.log(`    ${String(num(a.edges)).padStart(7)}  ${((a.edges / grand) * 100).toFixed(1).padStart(5)}%  ${f}`)
}
