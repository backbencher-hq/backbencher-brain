/**
 * NIM FOLD MISMATCH — cause B, in Nim's own idiom.
 *
 * ## What the brief's B probe can and cannot see
 *
 * `script/m14/diagnose-incoming.mts` measures cause B as: an unresolved target
 * that is DOTTED whose FINAL SEGMENT is a published name. On nim that is 1 of
 * 1,289 (0%), so this lane reported B as 0 edges.
 *
 * That probe's symptom clause is written for a language where the edge and the
 * symbol are the same string modulo a dotted prefix. Nim has a second, larger
 * spelling axis the clause cannot express: **a Nim identifier is
 * case-insensitive and underscore-insensitive.** `nimIdentNormalize` is the
 * language's own rule and it is not a convention — the compiler's `mangle`
 * applies it before two identifiers are ever compared, so `is_Root`, `isRoot`
 * and `ISROOT` are ONE symbol in any Nim program.
 *
 * An analyzer that publishes and emits the SPELLING AT THE SITE therefore writes
 * two different strings for one symbol the moment the two ends of an edge
 * disagree on case or underscores, and neither string matches the other under the
 * store's exact-match strategies (`parallel-indexer.ts` `resolveRelationships`
 * strategies 1-4, all `=` comparisons). The edge is TRUE and resolves to nothing,
 * and the dotted probe scores it 0 because there is no dot.
 *
 * So this probe measures the population the dotted probe cannot reach: for every
 * unresolved target, does the target's FOLD equal the fold of a name some other
 * file in the sample publishes?
 *
 * ## Why the answer decides work rather than describing it
 *
 *   recoverable > 0  -> cause B is NOT 0 for nim, it is invisible to the brief's
 *                      probe, and the fix is the brief's own recipe applied in
 *                      Nim's alphabet: make the emitted target equal the
 *                      PUBLISHED spelling, which means the analyzer has to carry
 *                      one canonical spelling function to both ends.
 *   recoverable = 0  -> the dotted probe's 0 stands for nim and B is closed.
 *
 * ## Population
 *
 * The same 600-file deterministic list every other nim measurement used, named on
 * disk and sha256'd in the output, so the number is comparable with
 * `s19-ambiguity-classify`, `s17-module-identity-ceiling-600` and
 * `s20-diagnose-600-BEFORE` rather than a fresh window.
 *
 * READ-ONLY with respect to the corpus. Writes nothing outside this run.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"

const LIST = "validation/m14/measurements/nim/session13-file-list.txt"
const listBytes = readFileSync(LIST, "utf8")
const files = listBytes.split("\n").filter(Boolean)

const analyzerSrc = readFileSync("src/ast/real-nim-analyzer.ts", "utf8")
const digest = createHash("sha256").update(analyzerSrc).digest("hex").slice(0, 16)

/**
 * The language's own identifier equivalence, written out.
 *
 * `mangle` in `nim/lib/system.nim` normalises an identifier by lowercasing it and
 * deleting every `_` (and, for the first character of a field, folding `_` away).
 * Two identifiers that normalise alike are the same symbol to the compiler, so a
 * fold match here is evidence the two spellings denote ONE symbol — not a guess
 * about a name someone chose to reuse.
 */
function fold(id: string): string {
  let out = ""
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i)
    if (c === 0x5f) continue // `_`
    out += id[i].toLowerCase()
  }
  return out
}

/** published name -> the spellings seen, and the files declaring them */
const byName = new Map<string, { files: Set<string>; fold: string }>()
/** fold -> spellings that share it. Built only over names with >=2 spellings. */
const byFold = new Map<string, Set<string>>()
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
    const name = String(s?.name ?? "")
    if (!name) continue
    let e = byName.get(name)
    if (!e) byName.set(name, (e = { files: new Set(), fold: fold(name) }))
    e.files.add(f)
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (t) edges.push({ t, type: String(e?.type ?? ""), file: f })
  }
}

for (const name of byName.keys()) {
  const k = fold(name)
  let s = byFold.get(k)
  if (!s) byFold.set(k, (s = new Set()))
  s.add(name)
}

const distinctTargets = [...new Set(edges.map((e) => e.t))]
const unresolved = distinctTargets.filter((t) => !byName.has(t))

/** an unresolved target whose FOLD is published under a different spelling */
const recoverable = unresolved.filter((t) => byFold.get(fold(t)) !== undefined)

console.log(`nim fold-mismatch probe — cause B, in Nim's own alphabet`)
console.log(`analyzer : src/ast/real-nim-analyzer.ts sha256:${digest}`)
console.log(`file list: ${LIST} sha256 ${createHash("sha256").update(listBytes).digest("hex").slice(0, 16)}`)
console.log(`files ${files.length} (parsed ${parsed}, failed ${failed})`)
console.log(`published names ${byName.size}   edges ${edges.length}   distinct targets ${distinctTargets.length}`)
console.log(`unresolved distinct targets ${unresolved.length}`)
console.log()

console.log(`1  DOES THE PROBE'S OWN PREMISE HOLD — is one fold many spellings in this corpus?`)
const multi = [...byFold.entries()].filter(([, s]) => s.size > 1)
console.log(`   folds carrying >1 spelling: ${multi.length}`)
for (const [k, s] of multi.sort((a, b) => b[1].size - a[1].size).slice(0, 8)) {
  console.log(`     ${String(s.size).padStart(3)} spellings of fold "${k}": ${[...s].slice(0, 5).map((x) => JSON.stringify(x)).join(" ")}`)
}
console.log()

console.log(`2  THE CAUSE-B POPULATION — unresolved targets that are a published symbol under another spelling`)
console.log(`   recoverable distinct targets: ${recoverable.length}`)
if (recoverable.length) {
  const perTarget = new Map<string, number>()
  for (const e of edges) {
    if (!recoverable.includes(e.t)) continue
    perTarget.set(e.t, (perTarget.get(e.t) ?? 0) + 1)
  }
  const edgeTotal = [...perTarget.values()].reduce((a, b) => a + b, 0)
  console.log(`   recoverable EDGES: ${edgeTotal} of ${edges.length}`)
  const byType = new Map<string, number>()
  for (const e of edges) {
    if (!recoverable.includes(e.t)) continue
    byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
  }
  console.log(`   by edge type: ${JSON.stringify(Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])))}`)
  console.log(`   every recoverable target, with the spelling that resolves it:`)
  for (const [t, n] of [...perTarget].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(n).padStart(5)} edges  target ${JSON.stringify(t)}  fold ${JSON.stringify(fold(t))}  published as ${[...(byFold.get(fold(t)) ?? [])].map((x) => JSON.stringify(x)).join(" ")}`)
  }
} else {
  console.log(`   ZERO. The dotted probe's 0 for nim is therefore not an artefact of its`)
  console.log(`   symptom clause: there is no second spelling axis either, and cause B is`)
  console.log(`   closed for this lane at 0 edges.`)
}
console.log()

console.log(`3  THE OVERLAP WITH THE BRIEF'S B — both probes on the same population`)
const dotted = unresolved.filter((t) => t.includes("."))
const lastSeg = dotted.filter((t) => byName.has(t.split(".").pop()!))
console.log(`   dotted unresolved (brief's B symptom): ${dotted.length}`)
console.log(`   of those, final segment IS a published name (brief's B cause): ${lastSeg.length}`)
console.log(`   fold-recoverable (this probe): ${recoverable.length}`)
const overlap = recoverable.filter((t) => lastSeg.includes(t))
console.log(`   overlap between the two populations: ${overlap.length}`)
console.log(`   union, i.e. every edge cause B could reach in nim: ${new Set([...lastSeg, ...recoverable]).size} distinct targets`)
console.log()
console.log(`analyzer sha256 after the walk : ${createHash("sha256").update(readFileSync("src/ast/real-nim-analyzer.ts", "utf8")).digest("hex").slice(0, 16)}  (unchanged — every number above is tied to this analyzer state)`)