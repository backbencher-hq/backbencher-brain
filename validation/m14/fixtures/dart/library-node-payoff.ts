/**
 * D1 PAYOFF — does publishing the library node bind the `imports`/`exports` SOURCES?
 *
 * WHY THIS HARNESS AND NOT THE SHARED ONE. `incoming-abc-prod.ts` resolves TARGETS only
 * (`byName.has(e.t)`), so a fix to the SOURCE side of an edge is invisible to it by
 * construction: its source column could not move even if the fix were complete. This
 * harness reports endpoint FORM for BOTH ends, using the SAME three-column partition
 * section 3 of `validation/m14/measurements/dart-abc-endpoint-600.txt` recorded BEFORE
 * the fix — `exact` (the endpoint string is a published name), else `qual` (it is a
 * published qualifiedName), else `lastSeg` (its last segment is a published name) — so
 * the two tables are comparable cell for cell and the "before" column needs no
 * re-derivation, no stash and no second tree.
 *
 * The four questions:
 *   1. Do the `imports`/`exports` sources bind, and uniquely?
 *   2. How many library names collide with another file's library? A collision moves an
 *      edge from `unresolved` to `ambiguous`: honest and countable, but NOT a resolution,
 *      and must not be reported as one.
 *   3. Did publishing a snake_case library name into the flat name space make any
 *      EXPRESSION edge (`uses`/`calls`/`instantiates`/`references`/`contains`) bind to a
 *      Module node by string coincidence? Those are FALSE bindings this change introduces
 *      — a local read of `driver` that happens to equal a file stem. Counted, and a
 *      non-zero count is a reason to reconsider, not a footnote.
 *   4. `bothEndsResolve` per type, the column the arbiter optimises.
 *
 * Population: the 600 paths in `validation/m14/measurements/dart-sample-list-600.txt` —
 * the committed list every other 600-file dart measurement used.
 *
 * Usage: npx tsx validation/m14/fixtures/dart/library-node-payoff.ts [listPath]
 */
import { readFileSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const LIST = process.argv[2] ?? "validation/m14/measurements/dart-sample-list-600.txt"
const files = readFileSync(LIST, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)

interface Decl {
  files: Set<string>
  quals: Set<string>
  /** SYMBOL INSTANCES, not files: a name can be a library AND a top-level function in
   *  the same file, and counting files would call that binding to the library alone. */
  syms: number
  moduleSyms: number
}
const byName = new Map<string, Decl>()
const quals = new Set<string>()
const edges: { type: string; src: string; tgt: string; file: string }[] = []
const modules: { name: string; file: string; directive: string }[] = []
let parsed = 0
let failed = 0
let symbols = 0

const decl = (name: string, file: string, qual: string): Decl => {
  let e = byName.get(name)
  if (!e) byName.set(name, (e = { files: new Set(), quals: new Set(), syms: 0, moduleSyms: 0 }))
  e.files.add(file)
  if (qual && qual !== name) {
    e.quals.add(qual)
    quals.add(qual)
  }
  return e
}

for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, readFileSync(f, "utf8"))
    parsed++
  } catch {
    failed++
    continue
  }
  for (const s of r?.symbols ?? []) {
    symbols++
    const name = String(s.name)
    const d = decl(name, f, String(s.qualifiedName ?? ""))
    d.syms++
    if (s.kind === "module") {
      d.moduleSyms++
      // `nodeType` is on parseFile's metadata allowlist; a key the analyzer invents is
      // dropped at the worker boundary, so reading anything else here would measure
      // this harness's imagination rather than the production symbol.
      const r = s.range ?? {}
      // The named/unnamed split is NOT readable from the production symbol: parseFile
      // forwards only allowlisted metadata keys and `libraryDirective` is not one of
      // them. What IS readable is the range — an implicit library is zero-width at byte
      // 0, while both directive forms carry the directive's own span — so that is what
      // this harness classifies on, and it is why the analyzer left the split out of
      // `metadata` instead of publishing a key the worker drops.
      const form = r.startIndex === 0 && r.endIndex === 0 ? "implicit_library(zero-width at byte 0)" : "has a directive span"
      modules.push({ name, file: f, directive: `${String((s.metadata ?? {}).nodeType ?? "?")} / ${form}` })
    }
  }
  for (const rel of r?.relationships ?? []) {
    edges.push({ type: String(rel?.type ?? ""), src: String(rel?.source ?? ""), tgt: String(rel?.target ?? ""), file: f })
  }
}

const names = new Set(byName.keys())
/** exact -> qual -> lastSeg, first match wins: the partition the BEFORE table used. */
const bucket = (ep: string): "exact" | "qual" | "lastSeg" | "none" => {
  if (names.has(ep)) return "exact"
  if (quals.has(ep)) return "qual"
  const last = ep.split(".").pop()!
  if (last !== ep && names.has(last)) return "lastSeg"
  return "none"
}
const onlyModules = (n: string) => {
  const d = byName.get(n)!
  return d.moduleSyms > 0 && d.moduleSyms === d.syms
}

console.log(`population: ${files.length} paths from ${LIST}`)
console.log(`parsed ${parsed}  failed ${failed}  symbols ${symbols}  of which Module ${modules.length}`)
console.log(`edges ${edges.length}  published names ${names.size}  published qualifiedNames ${quals.size}\n`)

console.log("1. ENDPOINT FORM, all edges. exact = the endpoint IS a published name; qual = it IS a")
console.log("   published qualifiedName; lastSeg = its FINAL SEGMENT is a published name. Partition.")
const perType = new Map<string, { e: number; sx: number; sq: number; sl: number; tx: number; tq: number; tl: number; both: number }>()
for (const e of edges) {
  let r = perType.get(e.type)
  if (!r) perType.set(e.type, (r = { e: 0, sx: 0, sq: 0, sl: 0, tx: 0, tq: 0, tl: 0, both: 0 }))
  r.e++
  const s = bucket(e.src)
  if (s === "exact") r.sx++
  else if (s === "qual") r.sq++
  else if (s === "lastSeg") r.sl++
  const t = bucket(e.tgt)
  if (t === "exact") r.tx++
  else if (t === "qual") r.tq++
  else if (t === "lastSeg") r.tl++
  if (s !== "none" && t !== "none") r.both++
}
const p = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-")
console.log("   type          edges  srcExact  srcQual  srcLastSeg |  tgtExact  tgtQual  tgtLastSeg | bothEnds")
for (const [t, r] of [...perType].sort((x, y) => y[1].e - x[1].e)) {
  const f3 = (n: number) => `${n}(${p(n, r.e).padStart(3)})`.padStart(11)
  console.log(`   ${t.padEnd(12)} ${String(r.e).padStart(6)} ${f3(r.sx)} ${f3(r.sq)} ${f3(r.sl)} | ${f3(r.tx)} ${f3(r.tq)} ${f3(r.tl)} | ${f3(r.both)}`)
}

console.log("\n2. LIBRARY SOURCES on `imports`/`exports`: resolved = source IS a published name;")
console.log("   unique = exactly one file publishes it; collision = >1, which is ambiguous, NOT resolved.")
console.log("   type          edges  srcRes  unique  collision  srcUnresolved")
for (const t of ["imports", "exports"]) {
  const es = edges.filter((e) => e.type === t)
  let res = 0
  let uniq = 0
  let coll = 0
  let unres = 0
  for (const e of es) {
    const d = byName.get(e.src)
    if (!d) unres++
    else {
      res++
      if (d.files.size === 1) uniq++
      else coll++
    }
  }
  console.log(`   ${t.padEnd(12)} ${String(es.length).padStart(6)} ${String(res).padStart(6)} ${String(uniq).padStart(6)} ${String(coll).padStart(9)} ${String(unres).padStart(13)}`)
}
const coll = [...byName].filter(([, d]) => d.moduleSyms > 1)
console.log(`   library names published by >1 file: ${coll.length}   ${coll.map(([n, d]) => `${n} x${d.moduleSyms}`).slice(0, 10).join(" ")}`)
const byDir = new Map<string, number>()
for (const m of modules) byDir.set(m.directive, (byDir.get(m.directive) ?? 0) + 1)
console.log(`   Module nodes: ${modules.length}   by directive form: ${JSON.stringify(Object.fromEntries([...byDir].sort()))}`)

console.log("\n3. COINCIDENTAL BINDINGS — expression edges whose ONLY resolvable declarations are Module")
console.log("   nodes. Every one of these is a FALSE binding introduced by publishing the name.")
let co = 0
const coByType = new Map<string, number>()
const ex: string[] = []
for (const e of edges) {
  if (e.type === "imports" || e.type === "exports") continue
  if (!names.has(e.tgt) || !onlyModules(e.tgt)) continue
  co++
  coByType.set(e.type, (coByType.get(e.type) ?? 0) + 1)
  if (ex.length < 8) ex.push(`${e.type} -> ${JSON.stringify(e.tgt)}  in ${e.file.split("/").pop()}`)
}
console.log(`   edges binding only to Module nodes: ${co}   ${JSON.stringify(Object.fromEntries([...coByType].sort((x, y) => y[1] - x[1])))}`)
for (const x of ex) console.log(`     ${x}`)

console.log(`\n4. self-loops (source == target): ${edges.filter((e) => e.src === e.tgt).length}`)
console.log(`   unknown endpoints: ${edges.filter((e) => e.src === "unknown" || e.tgt === "unknown").length}`)
console.log(`   empty symbol names: ${[...names].filter((n) => n.length === 0).length}`)
console.log(`   empty edge endpoints: ${edges.filter((e) => !e.src || !e.tgt).length}`)
console.log(`   edge count by type, for the BEFORE table's own total to be checked:`)
console.log(`     sum of per-type edges: ${edges.length}   distinct types: ${perType.size}`)