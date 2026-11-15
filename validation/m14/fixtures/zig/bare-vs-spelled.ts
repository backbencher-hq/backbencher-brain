/**
 * ZIG — is the ambiguous population a SPELLING population?
 *
 * ## The question
 *
 * `script/m14/diagnose-incoming.mts` reports cause B ("emitter/publisher format
 * mismatch") by looking for an UNRESOLVED target whose FINAL SEGMENT is a
 * published name. Measured on three Zig corpora it reports **0**: 0 of 404 / 1,024 /
 * 2,585 unresolved targets. Read alone that says "there is no mismatch here, the
 * unresolved population is external".
 *
 * That reading is bounded by the instrument, and this file exists to measure the
 * bound. B is looked for only among targets that resolve to NOTHING. A mismatch
 * where the bare target DOES resolve — to more than one declaration — renders as
 * **ambiguous**, which B never inspects. `incoming-check.ts` at 600 files reports
 * `contains` with 5,043 distinct targets, 3,324 of them ambiguous and 7
 * unresolved: that is a population that resolves, so B is silent on it, and the
 * cause of the ambiguity is not shared at all if the unique spelling exists.
 *
 * So the question here is per edge: **does `source + "." + target` name a published
 * `qualifiedName`, and is that name distinct from every other edge's spelling of
 * the same pair?** When it is, the edge is not ambiguous in the language — it is
 * ambiguous only because it was published as its leaf.
 *
 * ## What it reports, per type
 *
 *   edges             total
 *   leafMatches       target, verbatim, IS a published `name`
 *   leafAmbiguous     it is, and >1 declaration publishes it
 *   spelledMatches    `source + "." + target` IS a published `qualifiedName`
 *   spelledUnique     it is, and exactly ONE declaration publishes THAT
 *   spelledAmbiguous  it is, but several do
 *   unspelled         no unique spelling exists — cause A, not cause B
 *
 * `leafAmbiguous` partitions into `spelledUnique + spelledAmbiguous + unspelled`,
 * so the two mechanisms cannot be double-counted and neither can hide the other.
 *
 * ## Population
 *
 * `find <root> -name '*.zig' | sort | head -N`, the same draw as every other Zig
 * instrument, with the root printed next to every number.
 *
 * ## Instrument
 *
 * `parseFile` from `src/ast/pool-worker` — the production entry point.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/bare-vs-spelled.ts <root> [N] [--out path]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith("--"))
const flag = (k: string, d: string) => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (hit === undefined) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}
const root = positional[0] ?? "/home/ishaq2321/bb_tests/repositories"
const N = Number(positional[1] ?? 300)
const out = flag("out", "")

const files = execFileSync("bash", ["-lc", `find ${root} -name '*.zig' -type f | sort | head -${N}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

/** published bare name -> how many (file) declarations publish it */
const nameDecls = new Map<string, Set<string>>()
/** published qualifiedName -> the (file) declarations publishing it */
const qualDecls = new Map<string, Set<string>>()
/** one row per (type, target, source) so a pair is counted once, not once per edge */
const pairs = new Map<string, { type: string; source: string; target: string }>()
let symbols = 0
let parsed = 0
let failed = 0

for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, root)
    parsed++
  } catch {
    failed++
    continue
  }
  for (const s of r?.symbols ?? []) {
    const n = String(s?.name ?? "")
    if (!n) continue
    symbols++
    let a = nameDecls.get(n)
    if (!a) nameDecls.set(n, (a = new Set()))
    a.add(f)
    const q = String(s?.qualifiedName ?? "")
    if (q) {
      let b = qualDecls.get(q)
      if (!b) qualDecls.set(q, (b = new Set()))
      b.add(f)
    }
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    const s = String(e?.source ?? "")
    if (!t) continue
    pairs.set(`${e?.type}|${s}|${t}`, { type: String(e?.type ?? ""), source: s, target: t })
  }
}

const rows = [...pairs.values()]
  const bucket = new Map<
    string,
    { edges: 0; leafMatches: number; leafAmbiguous: number; spelledMatches: number; spelledUnique: number; spelledAmbiguous: number; unspelled: number }
  >()
const unspelledExamples = new Map<string, number>()
const recoveredExamples = new Map<string, Set<string>>()

for (const p of rows) {
  let b = bucket.get(p.type)
  if (!b)
    bucket.set(
      p.type,
      (b = { edges: 0, leafMatches: 0, leafAmbiguous: 0, spelledMatches: 0, spelledUnique: 0, spelledAmbiguous: 0, unspelled: 0 }),
    )
  b.edges++
  const decls = nameDecls.get(p.target)
  if (!decls) continue // unresolved — not this question
  b.leafMatches++
  if (decls.size === 1) continue // already unambiguous
  b.leafAmbiguous++
  const spelled = `${p.source}.${p.target}`
  const sdecls = qualDecls.get(spelled)
  if (!sdecls) {
    b.unspelled++
    unspelledExamples.set(p.type, (unspelledExamples.get(p.type) ?? 0) + 1)
    continue
  }
  b.spelledMatches++
  if (sdecls.size === 1) {
    b.spelledUnique++
    let e = recoveredExamples.get(p.type)
    if (!e) recoveredExamples.set(p.type, (e = new Set()))
    if (e.size < 6) e.add(`${p.source} -> ${spelled}`)
  } else {
    b.spelledAmbiguous++
  }
}

const table = [...bucket.entries()]
  .sort((a, b) => b[1].edges - a[1].edges)
  .map(([type, b]) => ({ type, ...b }))

const totals = table.reduce(
  (a, r) => ({
    edges: a.edges + r.edges,
    leafMatches: a.leafMatches + r.leafMatches,
    leafAmbiguous: a.leafAmbiguous + r.leafAmbiguous,
    spelledMatches: a.spelledMatches + r.spelledMatches,
    spelledUnique: a.spelledUnique + r.spelledUnique,
    spelledAmbiguous: a.spelledAmbiguous + r.spelledAmbiguous,
    unspelled: a.unspelled + r.unspelled,
  }),
  { edges: 0, leafMatches: 0, leafAmbiguous: 0, spelledMatches: 0, spelledUnique: 0, spelledAmbiguous: 0, unspelled: 0 },
)

console.log(`population: ${files.length} files listed, ${parsed} parsed, ${failed} failed, ${symbols} symbols`)
console.log(`root: ${root}`)
console.log()
console.log(
  `type              pairs  leafMatch  leafAmb    spelled     spelledUni  spelledAmb   unspelled`,
)
for (const r of table) {
  console.log(
    `${r.type.padEnd(16)} ${String(r.edges).padStart(6)} ${String(r.leafMatches).padStart(10)} ${String(r.leafAmbiguous).padStart(8)} ${String(r.spelledMatches).padStart(11)} ${String(r.spelledUnique).padStart(11)} ${String(r.spelledAmbiguous).padStart(11)} ${String(r.unspelled).padStart(11)}`,
  )
}
console.log(
  `${"TOTAL".padEnd(16)} ${String(totals.edges).padStart(6)} ${String(totals.leafMatches).padStart(10)} ${String(totals.leafAmbiguous).padStart(8)} ${String(totals.spelledMatches).padStart(11)} ${String(totals.spelledUnique).padStart(11)} ${String(totals.spelledAmbiguous).padStart(11)} ${String(totals.unspelled).padStart(11)}`,
)
console.log()
console.log("leafAmbiguous partitions into spelledUnique + spelledAmbiguous + unspelled:")
console.log(
  `  ${totals.spelledUnique} + ${totals.spelledAmbiguous} + ${totals.unspelled} = ${totals.spelledUnique + totals.spelledAmbiguous + totals.unspelled}`,
)
console.log()
console.log("pairs whose leaf is ambiguous but `source.target` is a UNIQUE published qualifiedName, by type:")
for (const [t, ex] of [...recoveredExamples.entries()].sort()) {
  console.log(`  ${t}: ${[...ex].map((s) => `"${s}"`).join(" ")}`)
}

if (out) {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(
    out,
    JSON.stringify(
      {
        population: { root, filesListed: files.length, parsed, failed, symbols },
        note:
          "one row per (type, source, target) triple, not per edge. leafAmbiguous = the bare target is published by " +
          ">1 declaration. spelledUnique = `source.target` is a published qualifiedName published by exactly one " +
          "declaration, so the ambiguity is the LEAF SPELLING and not the language.",
        totals,
        perType: table,
      },
      null,
      2,
    ),
  )
  console.error(`\nwrote ${out}`)
}