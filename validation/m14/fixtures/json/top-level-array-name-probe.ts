/**
 * MALFORMED TOP-LEVEL ARRAY ELEMENT NAMES — the population behind the `0]` finding.
 *
 * ## The defect this measures
 *
 * `arrayItemName` (src/ast/real-json-analyzer.ts) derives an array element's NAME. For an
 * array written under a key the name is the key plus the index (`a[0]`). For an array that
 * is itself an ELEMENT the name is the qualified path minus the module prefix
 * (`rows[0][0]` from `mod.rows[0][0]`). The subtraction is
 *
 *     arrayPath.slice(rootName.length + 1)
 *
 * which is right only when the character at `rootName.length` is the DOT that separates the
 * module from its first key. When the document's TOP LEVEL is an array, the character is
 * `[`, and the `+ 1` eats it:
 *
 *     module `input0`, element at path `input0[3]`  ->  name `3]`
 *     module `input0`, element at path `input0[3][2]` -> name `3][2]`
 *
 * so the name carries a trailing `]` and no leading `[`. The documented form is `[3]` and
 * `[3][2]`. Two consequences, and only the first is cosmetic:
 *
 *   1. the NAME is malformed against the lane's own contract row on arrays;
 *   2. `addArrayObjectSymbol` / `addArrayElementSymbol` derive `ownerName` from the name by
 *      cutting at the LAST `[`, so the owner chain for a top-level array is spelled in the
 *      malformed namespace. It stays SELF-CONSISTENT, which is why source resolution still
 *      reads 100% — the chain resolves inside the malformed names. That is the reason this
 *      is easy to miss and not a reason to leave it: a self-consistent wrong namespace is
 *      what a name collision becomes later.
 *
 * ## What it measures, over production `parseFile`
 *
 *   malformed          symbols on an INDEX PATH whose name is not the qualified path's
 *                      remainder under the module
 *   wellFormedBracket  symbols on an index path whose name IS that remainder (the contract form)
 *   filesWithTopArray documents carrying >=1 malformed name
 *   collisionPairs      symbols SHARING a qualifiedName — the observable cost of the
 *                      namespace split
 *
 * ## Why the test is derived from the qualified path, not from the name's shape
 *
 * The first version of this probe tested `name.endsWith("]") && !name.startsWith("[")` and
 * reported **3,411 "malformed" names** in one 50-file chunk. Every sampled example was
 * `start_urls[0]`, `configurations[1]`, `Statement[7]` — the CORRECT keyed form, which ends
 * with `]` and does not start with `[` for a reason that has nothing to do with this defect.
 * The predicate was wrong and the analyzer was right; a shape test on the name cannot tell
 * `0]` (the bug) from `Statement[0]` (the contract) because both are "bracket-ish".
 *
 * The second version compared the name against "the qualified path minus the module prefix"
 * and reported **132,180 deviations in 514 files, and 0 conforming names**. That rule was
 * also wrong, and over-asserting: the lane's naming rule is not "path minus module" for
 * OBJECT members. A member of an object is named by its KEY alone, at every depth —
 * `defs.X.y` publishes `y`, not `defs.X.y` — so the rule fires on ordinary keyed members and
 * reports the whole corpus as broken. A probe whose predicate matches the majority is a
 * probe with a bad model, not a corpus with a bad analyzer. Both discarded readings are
 * recorded here so neither is re-derived as if it were new.
 *
 * ## The predicate that survives
 *
 * The lane's naming rule has exactly two cases, and they are distinguished by the PATH, not
 * by the name:
 *
 *   KEYED      an array written under a key: name = key + index       (`allOf[0]`)
 *   ELEMENT    an array that is itself an element: name = qualified path after the module
 *              (`rows[0][0]` from `mod.rows[0][0]`)
 *
 * and a document whose TOP LEVEL is an array is neither: the array has no key, so the
 * MODULE is the only thing that names it. That is the case under test, and it is selected
 * from the qualified path by one condition: the path continues with `[` immediately after
 * the shortest published module prefix. `mod[3]` is in the population; `mod.a[0]` and
 * `mod.a.b` are not, because the boundary character is `.`.
 *
 * Within that population the probe reports WHAT SPELLING the name carries rather than
 * asserting one, because the two implementations under comparison disagree about which
 * spelling is right and the probe cannot settle that from the outside:
 *
 *   MODULE-PREFIXED  name begins with the module name (`pass0[1]`)
 *   STRAY-BRACKET    name has NO `[` anywhere yet ends with `]` (`3]`) — this is the
 *                    `arrayPath.slice(rootName.length + 1)` truncation, and it is the only
 *                    bucket that is a spelling NO other case produces
 *   BRACKET-FORM     name begins with `[` (`[1]`) — the form the doc states
 *   OTHER            anything else, printed
 *
 * `STRAY-BRACKET` is the finding: it is not the keyed form (it has no key) and not the
 * element form (the element form always carries the enclosing `[…]`). `collisionPairs` then
 * measures whether any of it actually costs the graph a name.
 *
 * Every predicate is `startsWith` / `endsWith` / `indexOf` / `slice` / equality. No pattern
 * matching.
 *
 * ## The module boundary is derived, not assumed
 *
 * Selecting the population needs to know where the MODULE name ends and the path begins. The
 * probe does not assume a spelling; it asks the file's own published symbols. For a
 * qualified path `q`, every published qualified name that is a prefix of `q` at a boundary
 * where `q` continues with `.` or `[` is a candidate, and the SHORTEST such candidate is the
 * module: `mod` and `mod.a` are both prefixes of `mod.a[0]`, and `mod.a` is a KEY, not a
 * module, so the shorter one is the correct answer. Zero candidates means the path is not
 * under a published module and the symbol is counted as UNBOUNDED rather than bucketed
 * against a guess.
 *
 * ## Chunking
 *
 * Takes an explicit file list and is run in chunks that terminate; the whole-population
 * walk in one process is not reproducible on this lane (limitation 9 — the in-process WASM
 * parse trap is a property of the RUN, not of a file).
 *
 * Usage:
 *   xargs -a <list> -d '\n' npx tsx validation/m14/fixtures/json/top-level-array-name-probe.ts
 */
import { parseFile } from "../../../../src/ast/pool-worker"
import { statSync } from "node:fs"
import * as path from "node:path"

const files = process.argv.slice(2).filter((a) => statSync(a, { throwIfNoEntry: false })?.isFile())

let filesRead = 0
let symbols = 0
let unbounded = 0
let inPopulation = 0
let filesInPopulation = 0

/** The four spellings, counted over the top-level-array population only. */
const spellings = new Map<string, number>()

const strayExamples: string[] = []
const otherExamples: string[] = []
const collisionExamples: string[] = []
let filesWithTruncated = 0
let collisionNames = 0

/**
 * The shortest published qualified name that prefixes `q` at a `.`/`[` boundary.
 * `mod` and `mod.a` are both prefixes of `mod.a[0]`; `mod.a` is a KEY, so the shortest
 * candidate is the module. Derived from the file, not assumed.
 */
function moduleOf(q: string, published: string[]): string | null {
  let best: string | null = null
  for (const cand of published) {
    if (cand.length === 0 || cand.length >= q.length) continue
    if (!q.startsWith(cand)) continue
    const boundary = q.charAt(cand.length)
    if (boundary !== "." && boundary !== "[") continue
    if (best === null || cand.length < best.length) best = cand
  }
  return best
}

/** Which spelling the name carries. String predicates only, no pattern matching. */
function spellingOf(name: string, module: string): string {
  if (name.startsWith("[")) return "BRACKET-FORM"
  if (name.startsWith(module)) return "MODULE-PREFIXED"
  // TRUNCATED-HEAD: a `]` appears with no `[` before it. This is the family the
  // `slice(rootName.length + 1)` truncation produces — `3]` on the element itself and
  // `3][2]` on its descendants — and it is the one bucket no keyed or element form can
  // produce, because every keyed form carries its `[i]` and every element form carries the
  // enclosing `[...]` it descends from. A `]` with a `[` before it is the ordinary keyed
  // form (`Statement[0]`), which is why the ORDER of the two indexOf calls is the test.
  const close = name.indexOf("]")
  const open = name.indexOf("[")
  if (close !== -1 && (open === -1 || open > close)) return "TRUNCATED-HEAD"
  if (open !== -1 && close !== -1) return "KEYED"
  return "OTHER"
}

for (const file of files) {
  let result: Awaited<ReturnType<typeof parseFile>>
  try {
    result = await parseFile(file, path.dirname(file))
  } catch {
    continue
  }
  filesRead++
  const published = result.symbols ?? []
  symbols += published.length
  const qnames = published.map((s) => s.qualifiedName)

  // name -> the qualified paths that carry it. One name at two paths is the harm.
  const byName = new Map<string, Set<string>>()
  for (const s of published) {
    const list = byName.get(s.name) ?? new Set<string>()
    list.add(s.qualifiedName)
    byName.set(s.name, list)
  }

  let fileTruncated = false
  let inPopulationForFile = 0
  for (const s of published) {
    const q = s.qualifiedName
    if (q.indexOf("[") === -1) continue
    const module = moduleOf(q, qnames)
    if (module === null) {
      unbounded++
      continue
    }
    // IN POPULATION: the path hangs directly off the module by an index, which is the
    // top-level-array case. A keyed array continues with `.` and is excluded.
    if (q.charAt(module.length) !== "[") continue
    inPopulation++
    inPopulationForFile++
    const spelling = spellingOf(s.name, module)
    spellings.set(spelling, (spellings.get(spelling) ?? 0) + 1)
    if (spelling === "TRUNCATED-HEAD") {
      fileTruncated = true
      if (strayExamples.length < 20) {
        strayExamples.push(
          `        name=${JSON.stringify(s.name)} qname=${JSON.stringify(q)} kind=${s.kind}`,
        )
      }
    }
    if (spelling === "OTHER" && otherExamples.length < 20) {
      otherExamples.push(
        `        name=${JSON.stringify(s.name)} qname=${JSON.stringify(q)} kind=${s.kind}`,
      )
    }
  }
  if (inPopulationForFile > 0) filesInPopulation++
  if (fileTruncated) filesWithTruncated++

  for (const [name, paths] of byName) {
    if (paths.size > 1) {
      collisionNames++
      if (collisionExamples.length < 20) {
        collisionExamples.push(
          `        name=${JSON.stringify(name)} at ${paths.size} qualified path(s): ${JSON.stringify([...paths].slice(0, 3))}`,
        )
      }
    }
  }
  }
console.log(`top-level-array name probe — ${files.length} file(s), ${filesRead} read, ${symbols} symbols`)
console.log(`index-path symbols with no published module : ${unbounded}`)
console.log(`POPULATION: symbols hanging off the module by an index : ${inPopulation}`)
console.log(`files in that population                   : ${filesInPopulation}`)
console.log("")
console.log("spelling of the name, over that population:")
for (const [sp, n] of [...spellings.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${sp.padEnd(20)} ${n}`)
}
console.log("")
console.log(`files carrying >=1 TRUNCATED-HEAD name       : ${filesWithTruncated}`)
console.log(`names shared by >1 qualified path (whole file): ${collisionNames}`)
if (strayExamples.length) {
  console.log("")
  console.log("TRUNCATED-HEAD examples:")
  for (const l of strayExamples) console.log(l)
}
if (otherExamples.length) {
  console.log("")
  console.log("OTHER examples:")
  for (const l of otherExamples) console.log(l)
}
if (collisionExamples.length) {
  console.log("")
  console.log("one name at several paths:")
  for (const l of collisionExamples) console.log(l)
}
