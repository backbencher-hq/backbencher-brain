/**
 * DART A/B/C THROUGH PRODUCTION `parseFile` — the baseline the shared instrument cannot produce.
 *
 * WHY THIS FILE EXISTS. `script/m14/diagnose-incoming.mts` calls `ASTEngine.parseFile`, whose
 * symbol records carry NO `qualifiedName` field at all (verified: 6/6 empty on
 * exception.dart via ASTEngine, 0/6 via production `parseFile`, same analyzer, same input).
 * Its A column asks "does any declaration of this name carry a qualifiedName != name", so it
 * is answered from an empty set for every lane: bash 35/35, python 26/26, dart 169/169 all
 * read 100%. The column is dead on that entry point. `script/m14/` is section-8 shared
 * machinery, so the instrument is NOT edited here; this file re-derives the same three causes
 * on the entry point the lane contract names (production `parseFile`).
 *
 * The three causes are re-derived with the instrument's definitions so the two are comparable:
 *   A  the target name is declared by >1 file, i.e. the bare name is not an identifier
 *   B  the target is unresolved and its FINAL SEGMENT is a published name (one naming fn away)
 *   C  whatever is left, reported with its shape rather than pooled into "unresolved"
 *
 * A is split further, because "no qualifiedName" and "one qualifiedName" are different defects:
 *   A2  the declarations carry >=2 DISTINCT qualifiedNames -> already distinguishable, the
 *       resolver is at fault for keying on `name`
 *   A1  every declaration shares ONE qualifiedName -> genuinely one identity, not a collision
 *   A0  no declaration carries a qualifiedName -> no evidence in the index at all
 *
 * Usage: npx tsx validation/m14/fixtures/dart/incoming-abc-prod.ts [fileCount] [corpusRoot]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const COUNT = Number(process.argv[2] ?? 80)

const files = execFileSync("bash", ["-lc", `find ${CORPUS_ROOT} -name '*.dart' -type f | sort | head -${COUNT}`], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .filter(Boolean)

interface Decl {
  files: Set<string>
  quals: Set<string>
}
const byName = new Map<string, Decl>()
const edges: { t: string; type: string; file: string; src: string }[] = []
let parsed = 0
let failed = 0
let symbols = 0
let withQual = 0

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
    const q = String(s.qualifiedName ?? "")
    if (q && q !== name) withQual++
    let e = byName.get(name)
    if (!e) byName.set(name, (e = { files: new Set(), quals: new Set() }))
    e.files.add(f)
    if (q && q !== name) e.quals.add(q)
  }
  for (const rel of r?.relationships ?? []) {
    const t = String(rel?.target ?? "")
    if (t) edges.push({ t, type: String(rel?.type ?? ""), file: f, src: String(rel?.source ?? "") })
  }
}

const distinctTargets = [...new Set(edges.map((e) => e.t))]
const unresolved = distinctTargets.filter((t) => !byName.has(t))
const ambiguous = distinctTargets.filter((t) => byName.has(t) && byName.get(t)!.files.size > 1)
const resolved = distinctTargets.length - unresolved.length

console.log(`population: the first ${files.length} .dart by sorted path`)
console.log(`parsed ${parsed} failed ${failed}   symbols ${symbols}   of which qualifiedName != name: ${withQual}`)
console.log(`edges ${edges.length}   distinct targets ${distinctTargets.length}   resolved ${resolved}   unresolved ${unresolved.length}\n`)

const a0 = ambiguous.filter((t) => byName.get(t)!.quals.size === 0)
const a1 = ambiguous.filter((t) => byName.get(t)!.quals.size === 1)
const a2 = ambiguous.filter((t) => byName.get(t)!.quals.size > 1)
console.log(`A  NAME IS NOT AN IDENTIFIER   ambiguous targets: ${ambiguous.length}`)
console.log(`   A2  >=2 DISTINCT qualifiedNames (already distinguishable, resolver keyed on name): ${a2.length}`)
console.log(`   A1  exactly ONE qualifiedName  (one identity, not a collision)                    : ${a1.length}`)
console.log(`   A0  NO qualifiedName at all    (no evidence in the index)                          : ${a0.length}`)

const ranked = [...ambiguous].sort((a, b) => byName.get(b)!.files.size - byName.get(a)!.files.size).slice(0, 10)
console.log(`\n   files  distinctQuals  name`)
for (const t of ranked) console.log(`   ${String(byName.get(t)!.files.size).padStart(5)} ${String(byName.get(t)!.quals.size).padStart(13)}  ${t}`)

const dotted = unresolved.filter((t) => t.includes("."))
const lastSeg = dotted.filter((t) => byName.has(t.split(".").pop()!))
const fmtFixed = new Set(lastSeg)
const cost = new Map<string, number>()
for (const e of edges) {
  if (byName.has(e.t)) continue
  if (!fmtFixed.has(e.t)) continue
  cost.set(e.type, (cost.get(e.type) ?? 0) + 1)
}
console.log(`\nB  EMITTER/PUBLISHER FORMAT MISMATCH   unresolved: ${unresolved.length}`)
console.log(`   containing '.': ${dotted.length} (${dotted.length ? Math.round((100 * dotted.length) / unresolved.length) : 0}%)`)
console.log(`   final segment IS a published name: ${lastSeg.length}   EDGES recoverable: ${[...cost.values()].reduce((x, y) => x + y, 0)}`)
console.log(`   by edge type: ${JSON.stringify(Object.fromEntries([...cost].sort((x, y) => y[1] - x[1])))}`)
console.log(`   examples: ${lastSeg.slice(0, 6).map((s) => `"${s}"`).join(" ")}`)

const external = unresolved.filter((t) => !fmtFixed.has(t))
const wild = external.filter((t) => t.endsWith(":*"))
const dottedExternal = external.filter((t) => !t.endsWith(":*") && t.includes("."))
const bareExternal = external.filter((t) => !t.endsWith(":*") && !t.includes("."))
console.log(`\nC  EXTERNAL / GENUINELY ABSENT   remaining: ${external.length}`)
console.log(`   module-wildcard "pkg:*": ${wild.length}`)
console.log(`   dotted, not wildcard    : ${dottedExternal.length}   examples: ${dottedExternal.slice(0, 5).join(" ")}`)
console.log(`   bare, not wildcard      : ${bareExternal.length}   examples: ${bareExternal.slice(0, 8).join(" ")}`)

const perType = new Map<string, { edges: number; res: number; unres: number; amb: number }>()
for (const e of edges) {
  let r = perType.get(e.type)
  if (!r) perType.set(e.type, (r = { edges: 0, res: 0, unres: 0, amb: 0 }))
  r.edges++
  if (byName.has(e.t)) {
    if (byName.get(e.t)!.files.size > 1) r.amb++
    else r.res++
  } else r.unres++
}
console.log(`\nPER-TYPE RESOLUTION (edges, not distinct targets) — the column the brief optimises`)
console.log(`type          edges  resolved  ambiguous  unresolved  res%`)
for (const [t, r] of [...perType].sort((x, y) => y[1].edges - x[1].edges)) {
  const pct = r.edges ? Math.round((100 * r.res) / r.edges) : 0
  console.log(`${t.padEnd(12)} ${String(r.edges).padStart(6)} ${String(r.res).padStart(9)} ${String(r.amb).padStart(10)} ${String(r.unres).padStart(11)} ${String(pct).padStart(5)}`)
}