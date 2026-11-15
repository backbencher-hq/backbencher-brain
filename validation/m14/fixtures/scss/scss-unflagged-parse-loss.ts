/**
 * SCSS UNFLAGGED PARSE LOSS — how much of this lane's output is missing, and how much of
 * the missing part no flag names.
 *
 * ## THE QUESTION
 *
 * `scss-extend-argument-isolation.ts` established that 86.8% of the corpus's `@extend`
 * statements are written in a form `tree-sitter-scss` cannot read, that the enclosing rule
 * becomes an ERROR node, and that NONE of the nine erroring isolation cases sets `degraded`
 * or `fallback`. That last part is the expensive one. Every downstream instrument in this
 * project keys off those two flags:
 *
 *   - the degraded-file accounting in `scss-relationship-census.ts` counts `degraded` files,
 *   - the ontology arbiter's DEGRADED verdict is a degraded-file decision,
 *   - `pool-worker.parseFile`'s fallback extractor is entered on `fallback`.
 *
 * So a file that loses 40 selector symbols to an ERROR region and sets neither flag is
 * INVISIBLE to all three, and every count computed over it is quietly short. This file
 * measures how short, and attributes the shortfall.
 *
 * ## WHAT IT COUNTS, over the WHOLE admitted corpus through production `parseFile`
 *
 *   admitted / walked / thrown
 *   files with >=1 parse error                       and their share
 *   files with errors and NEITHER degraded NOR fallback   <- the invisible bucket
 *   symbols and edges published by erroring files vs clean files
 *   attribution: of the erroring files, how many contain an `@extend` whose argument the
 *   isolation matrix measured as an ERROR region
 *
 * The attribution is a TEXT test for the trigger, and a PARSE-TEST for the outcome, so the
 * two halves are independent: it is not "this file has an error" (which is true of most
 * files) but "this file has the specific construct the matrix showed is unreadable".
 *
 * A file matching BOTH is ATTRIBUTED; a file with errors and no such `@extend` is UNATTRIBUTED
 * and its count is printed, because an unexplained residue is a finding and not a rounding error.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-unflagged-parse-loss.ts
 *
 * READ-ONLY with respect to the corpus. Writes only a probe dir under /tmp.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const WALK = Number(process.argv[2] ?? 0) // 0 = the whole admitted corpus

const all: string[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let files: string[]
  try {
    files = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of files) all.push(path.join(dir, rel))
}
const admitted: { abs: string; rel: string; text: string }[] = []
for (const abs of all) {
  let text: string
  try {
    if (statSync(abs).size > 512 * 1024) continue
    text = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  if (detectLanguageFromPath(abs, text) !== "scss") continue
  admitted.push({ abs, rel: path.relative(CR, abs), text })
}
admitted.sort((a, b) => (a.abs < b.abs ? -1 : 1))
const list = WALK > 0 ? admitted.filter((_, i) => i % Math.max(1, Math.floor(admitted.length / WALK)) === 0).slice(0, WALK) : admitted

/** The two argument forms the isolation matrix measured as ERROR regions. */
const BROKEN_ARG = /@extend\s+[%#]/
const UNBROKEN_ARG = /@extend\s+\./
const ARG = /@extend\s*([^;}]*)/g

type Row = {
  rel: string
  errors: number
  degraded: boolean
  fallback: boolean
  symbols: number
  edges: number
  bytes: number
  brokenArg: number
  cleanArg: number
}
const rows: Row[] = []
let thrown = 0
let thrownRel = ""

let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= list.length) return
    const { abs, rel, text } = list[i]
    let r: any
    try {
      r = await parseFile(abs, path.dirname(abs))
    } catch (e) {
      thrown++
      thrownRel = rel
      continue
    }
    let brokenArg = 0
    let cleanArg = 0
    for (const m of text.matchAll(ARG)) {
      const a = m[1].trim()
      if (a.length === 0) continue
      if (a[0] === "%" || a[0] === "#") brokenArg++
      else if (a[0] === ".") cleanArg++
    }
    rows.push({
      rel,
      errors: (r?.errors ?? []).length,
      degraded: r?.degraded === true,
      fallback: r?.fallback === true,
      symbols: (r?.symbols ?? []).length,
      edges: (r?.relationships ?? []).length,
      bytes: text.length,
      brokenArg,
      cleanArg,
    })
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
rows.sort((a, b) => (a.rel < b.rel ? -1 : 1))

const err = rows.filter((r) => r.errors > 0)
const unflagged = err.filter((r) => !r.degraded && !r.fallback)
const attributed = unflagged.filter((r) => r.brokenArg > 0)
const unattributed = unflagged.filter((r) => r.brokenArg === 0)
const clean = rows.filter((r) => r.errors === 0)
const sum = (rs: Row[], k: "symbols" | "edges" | "bytes") => rs.reduce((a, r) => a + r[k], 0)
const pctv = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)

console.log("scss unflagged parse loss — production parseFile over the admitted corpus")
console.log(`corpus root           ${CR}`)
console.log(`admitted .scss        ${admitted.length.toLocaleString()}`)
console.log(`walked                ${list.length.toLocaleString()}${WALK > 0 ? ` (every ${Math.max(1, Math.floor(admitted.length / WALK))}th of the sorted admitted list)` : " (the whole admitted corpus)"}`)
console.log(`thrown                ${thrown}${thrownRel ? `  e.g. ${thrownRel}` : ""}`)
console.log("")
console.log(`files carrying >=1 parse error       ${err.length.toLocaleString()}  ${pctv(err.length, rows.length)} of ${rows.length.toLocaleString()} walked`)
console.log(`  of those, degraded or fallback      ${err.length - unflagged.length}`)
console.log(`  UNFLAGGED, i.e. in no flag at all    ${unflagged.length.toLocaleString()}  ${pctv(unflagged.length, rows.length)} of walked, ${pctv(unflagged.length, err.length)} of the erroring files`)
console.log("")
console.log(`                          files     symbols      edges       bytes`)
console.log(`clean files            ${String(clean.length).padStart(9)}${String(sum(clean, "symbols")).padStart(11)}${String(sum(clean, "edges")).padStart(10)}${String(sum(clean, "bytes")).padStart(11)}`)
console.log(`unflagged-error files  ${String(unflagged.length).padStart(9)}${String(sum(unflagged, "symbols")).padStart(11)}${String(sum(unflagged, "edges")).padStart(10)}${String(sum(unflagged, "bytes")).padStart(11)}`)
// A PER-BYTE rate, because raw symbol counts across two groups of different total size
// would flatter whichever group has more text. Symbols per 1,000 bytes is the comparable
// quantity, and it is printed for BOTH groups so the reader can divide rather than trust.
const perK = (rs: Row[]) => (sum(rs, "symbols") / Math.max(1, sum(rs, "bytes"))) * 1000
console.log(
  `  symbols per 1,000 bytes  clean ${perK(clean).toFixed(2)}   unflagged-error ${perK(unflagged).toFixed(2)}   ratio ${(perK(unflagged) / Math.max(1e-9, perK(clean))).toFixed(3)}`,
)
console.log(
  `  edges    per 1,000 bytes  clean ${((sum(clean, "edges") / Math.max(1, sum(clean, "bytes"))) * 1000).toFixed(2)}   unflagged-error ${((sum(unflagged, "edges") / Math.max(1, sum(unflagged, "bytes"))) * 1000).toFixed(2)}`,
)
console.log("")
console.log(`ATTRIBUTION of the ${unflagged.length.toLocaleString()} unflagged-error files, by whether they contain an`)
console.log(`@extend whose argument form the isolation matrix measured as an ERROR region:`)
console.log(`  ATTRIBUTED   contains @extend %x or @extend #x   ${attributed.length.toLocaleString()}  ${pctv(attributed.length, unflagged.length)}`)
console.log(`  UNATTRIBUTED no such @extend                      ${unattributed.length.toLocaleString()}  ${pctv(unattributed.length, unflagged.length)}`)
console.log(`  @extend statements in the attributed files        ${attributed.reduce((a, r) => a + r.brokenArg, 0).toLocaleString()}`)
console.log(`  @extend statements in the unattributed files      ${unattributed.reduce((a, r) => a + r.brokenArg, 0).toLocaleString()}`)

const noBrokenButBrokenArg = rows.filter((r) => r.brokenArg > 0 && r.errors === 0)
console.log(`\n  files with a broken-form @extend and NO error   ${noBrokenButBrokenArg.length.toLocaleString()}   ${noBrokenButBrokenArg.slice(0, 5).map((r) => `${r.rel} (${r.brokenArg})`).join(", ")}`)
if (noBrokenButBrokenArg.length > 5) console.log(`    ... and ${noBrokenButBrokenArg.length - 5} more`)
if (noBrokenButBrokenArg.length === 0) {
  console.log("  so every broken-form @extend in the corpus put its file into an ERROR region")
} else {
  console.log(
    `  ${noBrokenButBrokenArg.length} of them did NOT, which the matrix does not explain; stated rather than absorbed into the attribution`,
  )
}

const worst = [...unflagged].sort((a, b) => b.errors - a.errors).slice(0, 12)
console.log(`\nthe 12 unflagged-error files with the most parse errors, with what they published:`)
for (const r of worst) {
  console.log(
    `  ${String(r.errors).padStart(5)} err  ${String(r.symbols).padStart(5)} sym  ${String(r.edges).padStart(4)} edge  ${String(r.brokenArg).padStart(3)} badArg  ${r.rel}`,
  )
}
