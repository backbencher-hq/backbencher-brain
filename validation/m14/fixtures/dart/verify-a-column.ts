/**
 * VERIFY THE A COLUMN OF `script/m14/diagnose-incoming.mts` FOR DART.
 *
 * The shared instrument reports, on the first 80 `.dart` files by sorted path:
 *
 *   A  ambiguous targets (>1 file declaring the name): 169
 *      of those, NO distinct qualifiedName: 169 (100%)
 *
 * 100% is a strong claim: it says that for every colliding target name, NOT ONE of its
 * declarations anywhere in the window carries a `qualifiedName` differing from `name` —
 * i.e. that the index holds no evidence anywhere that those are distinct symbols.
 *
 * The 600-file production record disagrees with the shape of that claim:
 * `dart-600-8237d3e31ac2.raw.ndjson` publishes 7,121 of 10,868 symbols with a dotted
 * `qualifiedName`, including members like `WebSocketChannelException.constructor`.
 *
 * So either the A column is right for this window (a 80-file window that happens to hold
 * only top-level declarations), or the column has a bug. This distinguishes the two by
 * re-deriving A two ways on the identical 80 files:
 *
 *   sameAsInstrument  exactly the instrument's rule, so the two must agree count for count
 *   anyQualEver        the same ambiguous set, but asking whether ANY declaration of the name
 *                      anywhere in the window has qualifiedName != name
 *
 * `sameAsInstrument` reproducing 169/169 while `anyQualEver` is low would mean the window
 * is genuinely all-top-level. A large `anyQualEver` beside an identical 169 would mean the
 * instrument is dropping the qualified names it is asking about.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const COUNT = Number(process.argv[2] ?? 80)

// The SAME walk the instrument uses, so the two populations are identical and a
// disagreement is a disagreement about the A column and nothing else.
const FILES = execFileSync(
  "bash",
  ["-lc", `find ${CORPUS_ROOT} -name '*.dart' -type f | sort | head -${COUNT}`],
  { encoding: "utf8", maxBuffer: 1 << 28 },
)
  .trim()
  .split("\n")
  .filter(Boolean)
console.log(`population: ${FILES.length} files, the first ${FILES.length} .dart by sorted path`)

const byName = new Map<string, { files: Set<string>; quals: Set<string>; dottedQuals: Set<string> }>()
const edges: { t: string; type: string }[] = []
let parsed = 0
let failed = 0
let symbols = 0
let dottedSymbols = 0

for (const f of FILES) {
  let r: any
  try {
    r = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
    parsed++
  } catch {
    failed++
    continue
  }
  for (const s of r?.symbols ?? []) {
    symbols++
    const q = String(s.qualifiedName ?? "")
    if (q !== String(s.name)) dottedSymbols++
    let e = byName.get(s.name)
    if (!e) byName.set(s.name, (e = { files: new Set(), quals: new Set(), dottedQuals: new Set() }))
    e.files.add(f)
    if (q && q !== String(s.name)) {
      e.quals.add(q)
      if (q.includes(".")) e.dottedQuals.add(q)
    }
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (t) edges.push({ t, type: String(e?.type ?? "") })
  }
}

const distinctTargets = [...new Set(edges.map((e) => e.t))]
const ambiguous = distinctTargets.filter((t) => byName.has(t)).filter((t) => byName.get(t)!.files.size > 1)
const noQual = ambiguous.filter((t) => byName.get(t)!.quals.size === 0)
const anyQualEver = ambiguous.filter((t) => byName.get(t)!.quals.size > 0)
const anyDotted = ambiguous.filter((t) => byName.get(t)!.dottedQuals.size > 0)

console.log(`parsed ${parsed} failed ${failed}  symbols ${symbols}  of which qualifiedName != name: ${dottedSymbols}`)
console.log(`edges ${edges.length}  distinct targets ${distinctTargets.length}  ambiguous ${ambiguous.length}\n`)

console.log(`sameAsInstrument  NO distinct qualifiedName : ${noQual.length} (${Math.round((100 * noQual.length) / ambiguous.length)}%)`)
console.log(`anyQualEver        HAS a distinct qualifiedName: ${anyQualEver.length} (${Math.round((100 * anyQualEver.length) / ambiguous.length)}%)`)
console.log(`anyDotted          HAS a DOTTED qualifiedName   : ${anyDotted.length} (${Math.round((100 * anyDotted.length) / ambiguous.length)}%)\n`)

console.log("THE 15 MOST-COLLIDING AMBIGUOUS NAMES, with the qualified names they carry")
const ranked = [...ambiguous].sort((a, b) => byName.get(b)!.files.size - byName.get(a)!.files.size).slice(0, 15)
console.log("files  quals  dotted  name")
for (const t of ranked) {
  const d = byName.get(t)!
  console.log(`${String(d.files.size).padStart(5)} ${String(d.quals.size).padStart(6)} ${String(d.dottedQuals.size).padStart(7)}  ${t}`)
}

console.log("\nWHY: the instrument counts `constructor` and `main` as unqualified when `constructor`")
console.log("is published as `Owner.constructor` in at least one file. Either that file is outside")
console.log("this window or the member symbols are not reached. Named directly below.")

const constructorEntry = byName.get("constructor")
if (constructorEntry) {
  console.log(`  constructor: ${constructorEntry.files.size} files, ${constructorEntry.quals.size} quals, ${constructorEntry.dottedQuals.size} dotted`)
  console.log(`  sample dotted: ${[...constructorEntry.dottedQuals].slice(0, 6).join(", ")}`)
} else {
  console.log("  constructor is not a published name in this window at all")
}
const mainEntry = byName.get("main")
if (mainEntry) {
  console.log(`  main: ${mainEntry.files.size} files, ${mainEntry.quals.size} quals, ${mainEntry.dottedQuals.size} dotted`)
}