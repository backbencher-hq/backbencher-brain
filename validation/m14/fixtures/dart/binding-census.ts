/**
 * THE BINDING CENSUS — what the `localBinding` marker actually marks.
 *
 * ## The hole this instrument is here to narrow
 *
 * The round that introduced the binding spelling verifies a claim about a TARGET: `<callable>#
 * <binding>` carries a separator no declaration name can carry, so the store's name-based rule
 * cannot bind it. That check is about the SPELLING. It does NOT prove the edge it marks was a
 * read of a binding — and a lane could in principle mark a real reference to a declaration, spell
 * it with the separator, and watch the gate print it as `bindOK` instead of `resolved`. The gate's
 * control catches the crude form of that laundering (a marked edge whose target a declaration
 * answers is `bindingRefuted`, and the control plants one), but a marked edge spelled so nothing
 * answers it is measured only by whether the ANALYZER was right to mark it.
 *
 * So this census asks the analyzer's own output the only question that can be asked from outside
 * it: does the marked set LOOK like a scope-resolved set of bindings, or like something wider?
 * Four shapes, each a fingerprint of a specific mistake:
 *
 *   tail starts with an uppercase letter   a type, class or constant name read as a declaration
 *                                          would land here (measured: 9, and every one is a
 *                                          PARAMETER — `_check(TypeImpl T, TypeImpl S, ...)`
 *                                          in dart-sdk's own test suite — so uppercase alone is
 *                                          not a defect and these are printed to be eyeballed)
 *   prefix contains a dot                  a member path on the left of the separator; allowed
 *                                          (`obj.method#param` is a real callable), printed so a
 *                                          systematic receiver mistake would be visible
 *   prefix === tail                        a name reading itself — the shape a marker applied
 *                                          without resolving a scope would produce
 *   tail contains a dot                    not an identifier at all
 *
 * ## WHAT IT DOES NOT PROVE — read this before quoting the exit code
 *
 * It proves the marked set is not OBVIOUSLY wrong; it does not prove every marked edge is a
 * binding. Only the analyzer's scope resolution can say that, and it is the thing under test.
 * What the census can do is make a change in the marked set VISIBLE: run it before and after an
 * edit and compare the four counters, and a marker that starts firing for member reads shows up
 * here as a slope rather than as a silent column in the gate.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/dart/binding-census.ts [maxFiles] [corpusRoot]
 *
 * Defaults: 400 sampled files from `/home/ishaq2321/bb_tests/repositories`. The sample is a
 * stride over the sorted corpus, the same way the gate samples, so two runs are comparable.
 */
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { BINDING_SEP } from "../../../../src/ast/types"

const ROOT = process.argv[3] ?? "/home/ishaq2321/bb_tests/repositories"
const TARGET = Number(process.argv[2] ?? 400)

function dartFiles(dir: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      dartFiles(p, out)
      continue
    }
    if (!e.name.endsWith(".dart")) continue
    // The lane's population cap: the engine extracts above 1 MB rather than analyzing.
    try {
      if (statSync(p).size > 1_048_576) continue
    } catch {
      continue
    }
    out.push(p)
  }
}

const all: string[] = []
for (const repo of readdirSync(ROOT)) {
  const p = path.join(ROOT, repo)
  try {
    if (!statSync(p).isDirectory()) continue
  } catch {
    continue
  }
  dartFiles(p, all)
}
all.sort()
if (all.length === 0) {
  console.log(`no .dart files under ${ROOT} — nothing measured, and that is not a pass`)
  process.exit(2)
}
const stride = Math.max(1, Math.floor(all.length / Math.max(1, TARGET)))
const sample = all.filter((_, i) => i % stride === 0)

const byPair = new Map<string, number>()
let bindingEdges = 0
let uppercaseTail = 0
let dottedPrefix = 0
let prefixEqTail = 0
let dottedTail = 0
const upperExamples: string[] = []
const dottedPrefixExamples: string[] = []
let filesParsed = 0

for (const f of sample) {
  let res: any
  try {
    res = await parseFile(f, ROOT)
  } catch {
    continue
  }
  filesParsed++
  for (const r of res?.relationships ?? []) {
    if (r?.metadata?.localBinding !== true) continue
    const t = String(r.target ?? "")
    const at = t.lastIndexOf(BINDING_SEP)
    if (at < 0) {
      // A MARKED EDGE WITHOUT THE SEPARATOR. Not counted as a shape: this is the defect the
      // gate counts as `bindFAIL`, and it is named here so a reader of this table cannot miss
      // it by reading the four shape counters as the whole story.
      console.log(`  (marked WITHOUT the separator, the gate's bindFAIL shape: ${JSON.stringify(t)})`)
      continue
    }
    const prefix = t.slice(0, at)
    const tail = t.slice(at + 1)
    bindingEdges++
    byPair.set(t, (byPair.get(t) ?? 0) + 1)
    if (/^[A-Z]/.test(tail)) {
      uppercaseTail++
      if (upperExamples.length < 15) upperExamples.push(t)
    }
    if (prefix.includes(".")) {
      dottedPrefix++
      if (dottedPrefixExamples.length < 15) dottedPrefixExamples.push(t)
    }
    if (prefix === tail) prefixEqTail++
    if (tail.includes(".")) dottedTail++
  }
}

console.log(`binding census — ${ROOT}`)
console.log(`sample: ${filesParsed} of ${all.length} .dart files parsed (stride ${stride})`)
console.log(`binding-marked edges: ${bindingEdges}   distinct spellings: ${byPair.size}`)
console.log(
  `  tail starts UPPERCASE : ${uppercaseTail}   (a class/const name read as a declaration, or a` +
    ` PARAMETER named like a type — printed below, they are not separable by shape)`,
)
console.log(`  prefix contains a dot : ${dottedPrefix}`)
console.log(`  prefix === tail       : ${prefixEqTail}   (the shape an unresolved scope would produce)`)
console.log(`  tail contains a dot   : ${dottedTail}   (not an identifier: impossible as a binding)`)
if (bindingEdges > 0) {
  console.log("")
  console.log("top 25 spellings (a long tail of 1s is what a scope-resolved set looks like):")
  for (const [k, n] of [...byPair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(n).padStart(6)}  ${k}`)
  }
}
if (upperExamples.length) console.log(`\nuppercase tails:  ${upperExamples.join("  ")}`)
if (dottedPrefixExamples.length) console.log(`\ndotted prefixes:  ${dottedPrefixExamples.join("  ")}`)
console.log(
  `\nA binding is measured by its SPELLING in the gate; this table measures the marked SET. ` +
    `Comparing these four counters across two revisions is the check this file exists for.`,
)
