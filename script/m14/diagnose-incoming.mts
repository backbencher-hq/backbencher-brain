/**
 * Per-lane incoming diagnosis. See diagnose-incoming.sh for the contract.
 *
 * The point is to separate three causes that all render as "the incoming number is bad":
 *
 *   A  NAME IS NOT AN IDENTIFIER — the published symbol name is a bare simple name, so
 *      declarations sharing a name across files collapse into one node and every edge to
 *      it is ambiguous. Fixing this means publishing a file-scoped qualified name.
 *
 *   B  EMITTER/PUBLISHER FORMAT MISMATCH — the target string does not equal the published
 *      name, but its FINAL SEGMENT does. These edges would resolve if the two used one
 *      canonical function. This is the cheapest real win in the programme and it is
 *      mechanical: no semantic reasoning, one helper, applied in two places.
 *
 *   C  EXTERNAL — stdlib / BCL / catalog references, legitimately outside the corpus but
 *      emitted indistinguishably from local ones.
 *
 * Only B is free. A is per-language front-end work and is why the ambiguity column moves
 * slowly. C is bookkeeping.
 *
 * Read with the population attached: this walks the FIRST N files by sorted path, so a
 * rerun with a different N is a different measurement, not a contradiction.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../src/ast/engine"

const lang = process.argv[2]
const ext = process.argv[3]
const count = Number(process.argv[4] ?? 80)
const corpus = process.argv[5] ?? "$HOME/fixtures/repositories"

const files = execFileSync(
  "bash",
  ["-lc", `find ${corpus} -name '*.${ext}' -type f | sort | head -${count}`],
  { encoding: "utf8", maxBuffer: 1 << 28 },
)
  .trim()
  .split("\n")
  .filter(Boolean)

/** published name -> the files and qualifiedNames that declare it */
const byName = new Map<string, { files: Set<string>; kinds: Set<string>; quals: Set<string> }>()
/** one entry per edge, so a target's per-type cost can be attributed */
const edges: { t: string; type: string; file: string }[] = []
let parsed = 0
let failed = 0

for (const f of files) {
  let r: any
  try {
    r = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
    parsed++
  } catch {
    failed++
    continue
  }
  for (const s of r?.symbols ?? []) {
    let e = byName.get(s.name)
    if (!e) byName.set(s.name, (e = { files: new Set(), kinds: new Set(), quals: new Set() }))
    e.files.add(f)
    e.kinds.add(String(s.kind))
    // A distinct qualifiedName is the ONLY evidence in the index that the name is not
    // the sole identity. Without one, two same-named declarations are indistinguishable.
    if (s.qualifiedName && s.qualifiedName !== s.name) e.quals.add(String(s.qualifiedName))
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (t) edges.push({ t, type: String(e?.type ?? ""), file: f })
  }
}

const distinctTargets = [...new Set(edges.map((e) => e.t))]
const unresolved = distinctTargets.filter((t) => !byName.has(t))
const ambiguous = distinctTargets
  // Guard the lookup: `byName.get(t)!` on a target that is unresolved returns undefined,
  // and the non-null assertion is erased at runtime. Filtering on the map's own presence
  // makes the two sets provably disjoint instead of asserting it.
  .filter((t) => byName.has(t))
  .map((t) => ({ t, d: byName.get(t)! }))
  .filter((x) => x.d.files.size > 1)

console.log(`files walked ${files.length} (parsed ${parsed}, failed ${failed})`)
console.log(`published names ${byName.size}   edges ${edges.length}   distinct targets ${distinctTargets.length}`)
console.log()

// ---- A: is the published name an identifier?
console.log(`A  NAME IS NOT AN IDENTIFIER`)
console.log(`   ambiguous targets (>1 file declaring the name): ${ambiguous.length}`)
if (ambiguous.length) {
  const noQual = ambiguous.filter((x) => x.d.quals.size === 0).length
  console.log(`   of those, NO distinct qualifiedName: ${noQual} (${Math.round((100 * noQual) / ambiguous.length)}%)`)
  const hist = new Map<string, number>()
  for (const a of ambiguous) {
    const k = a.d.files.size > 10 ? "11+" : String(a.d.files.size)
    hist.set(k, (hist.get(k) ?? 0) + 1)
  }
  console.log(`   declarations-per-colliding-name: ${[...hist.entries()].sort().map(([k, v]) => `${k}:${v}`).join("  ")}`)
  for (const a of ambiguous.sort((x, y) => y.d.files.size - x.d.files.size).slice(0, 5)) {
    console.log(`     ${String(a.d.files.size).padStart(4)} files declare  ${a.t}  [${[...a.d.kinds].join("|")}]`)
  }
}
console.log()

// ---- B: emitter/publisher format mismatch
console.log(`B  EMITTER/PUBLISHER FORMAT MISMATCH  (cheapest real win — one canonical name fn)`)
const dotted = unresolved.filter((t) => t.includes("."))
const lastSegHits = dotted.filter((t) => byName.has(t.split(".").pop()!))
console.log(`   unresolved targets: ${unresolved.length}`)
console.log(`   containing '.': ${dotted.length} (${dotted.length ? Math.round((100 * dotted.length) / unresolved.length) : 0}%)`)
console.log(`   final segment IS a published name: ${lastSegHits.length} (${dotted.length ? Math.round((100 * lastSegHits.length) / dotted.length) : 0}%)  <- these resolve if both sides use one function`)
if (lastSegHits.length) {
  const cost = new Map<string, number>()
  for (const e of edges) {
    if (byName.has(e.t)) continue
    if (!e.t.includes(".")) continue
    if (!byName.has(e.t.split(".").pop()!)) continue
    cost.set(e.type, (cost.get(e.type) ?? 0) + 1)
  }
  console.log(`   EDGES recoverable by fixing the name function: ${[...cost.values()].reduce((a, b) => a + b, 0)}`)
  console.log(`   by edge type: ${JSON.stringify(Object.fromEntries([...cost].sort((a, b) => b[1] - a[1])))}`)
  console.log(`   examples: ${lastSegHits.slice(0, 6).map((s) => `"${s}"`).join(" ")}`)
}
console.log()

// ---- C: the remainder is external
const fmtFixed = new Set(lastSegHits)
const external = unresolved.filter((t) => !fmtFixed.has(t))
console.log(`C  EXTERNAL / GENUINELY ABSENT  (needs an explicit external marker, not a resolver)`)
console.log(`   unresolved remaining after fixing B: ${external.length}`)
const wild = external.filter((t) => t.endsWith(":*") || t.endsWith(":* "))
console.log(`   of which module-wildcard shaped (e.g. "os:*"): ${wild.length}`)
console.log(`   examples: ${external.slice(0, 8).map((s) => `"${s}"`).join(" ")}`)