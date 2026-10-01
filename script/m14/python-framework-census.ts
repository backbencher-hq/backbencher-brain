/**
 * PY-17 CENSUS. Two python framework tables exist — the lane's `PY_FRAMEWORK_MARKERS` and
 * `FrameworkDetector.detectPythonFrameworks` — with overlapping entries, different membership,
 * and different NAME SPELLINGS for the same framework (`"Django"` vs `"django"`). This is the
 * census that says whether that duplication costs anything a CONSUMER can observe, or is only
 * a maintenance hazard.
 *
 * What it measures, and why each measure matters:
 *
 *   1. Every distinct framework STRING the corpus produces. A consumer that groups by this
 *      value — "show me every file using Flask" — gets the right answer only if the spelling
 *      is stable.
 *   2. CASE-VARIANT DUPLICATES: names that differ only in case. If `Django` and `django` both
 *      occur, then a query for one of them silently misses the files that used the other, and
 *      the miss depends on WHICH TABLE matched the file rather than on anything in the source.
 *      That is the defect this census exists to find or rule out.
 *   3. How many files are detected ONLY because the second table exists — i.e. the lane's table
 *      alone would miss them. That is the second table's real weight, and it is the number that
 *      decides whether unifying the tables is urgent or merely tidy.
 *
 * Method: read what the product actually reports (`metadata.detectedFrameworks` from
 * `parseFile`), because the question is what a consumer sees, not what either table intends.
 * Derived from parse output rather than by re-deriving the tables, so a table bug shows up as
 * the wrong string rather than being reproduced faithfully.
 *
 * WHY THIS IS A GATE AND NOT A FIXTURE. `FrameworkIntelligence` is invoked from exactly one
 * place — `engine.ts`, inside `parseFile` — while `script/m14/run-fixtures.ts` calls
 * `analyzer.analyze()` directly for every language except the SFC ones. So no M14 fixture can
 * reach this code at all, and a fixture written here would pass no matter what the detector did.
 * I wrote one, confirmed the bug reproduced through `parseFile`, watched the fixture pass
 * against the broken code, and deleted it: a green row that cannot go red is worse than no row,
 * because it is counted as coverage.
 *
 * So the invariant is asserted here instead, against `parseFile` — the path a consumer takes:
 *
 *     A framework may only be reported if some import NAMES it.
 *
 * "Names" means the import's ROOT SEGMENT equals the framework name, or the framework is one of
 * the documented non-import rules. That single invariant is what substring matching violates, for
 * any needle and any language, so checking it generally is worth more than checking the two
 * collisions that happened to occur here.
 */

import * as fs from "node:fs"
import * as path from "node:path"

const root = process.argv[2]
if (!root) {
  console.error("usage: python-framework-census.ts <corpus-root>")
  process.exit(1)
}

const pyFiles: string[] = []
;(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".py")) pyFiles.push(p)
  }
})(root)

const engine: any = await import("../../src/ast/engine")

/** exact spelling -> file count */
const byExact = new Map<string, number>()
/** lowercased -> the exact spellings seen for it */
const byFolded = new Map<string, Set<string>>()
let nPy = 0
let nDetected = 0
let nMulti = 0
let nFail = 0
/** framework -> files reporting it with NO import naming it (violations of the invariant). */
const unsupported = new Map<string, number>()
const unsupportedEx = new Map<string, string[]>()

for (const f of pyFiles) {
  const raw = fs.readFileSync(f, "utf8")
  const content = raw.length > 1024 * 1024 ? raw.substring(0, 1024 * 1024) : raw
  let res: any
  try {
    res = await engine.ASTEngine.parseFile(f, content)
  } catch {
    nFail++
    continue
  }
  if (res?.language !== "python") continue
  nPy++
  const fws: string[] = res.metadata?.detectedFrameworks ?? []
  if (fws.length > 0) nDetected++
  // THE INVARIANT. `pytest` is exempt because it is ALSO matched by
  // `content.includes("def test_")` — a deliberate heuristic about what a test file IS, not a claim
  // that the file imported pytest. `pytorch` is exempt because `import torch` genuinely IS
  // PyTorch, so the import names the framework under its other name.
  //
  // `tensorflow` is NOT given a `tf` exemption, and that omission is the point: `tf` is the
  // two-character needle whose substring match put 34 corpus files on TensorFlow via `platform`.
  // Admitting it back would let this gate pass the exact bug it exists to catch. An alias is only
  // honest when it is a real, recognisable name for the framework; "tf" is two characters long and
  // is a substring of half the standard library.
  const IMPORT_ALIASES: Record<string, string[]> = { pytorch: ["torch"] }
  const NON_IMPORT_RULES = new Set(["pytest"])
  const imports: string[] = (res.imports ?? []).map((i: any) => String(i.module ?? "").toLowerCase())
  const roots = new Set(imports.map((m) => m.split(".")[0]).filter(Boolean))
  for (const fw of fws) {
    if (NON_IMPORT_RULES.has(fw)) continue
    const named = roots.has(fw.toLowerCase()) || (IMPORT_ALIASES[fw] ?? []).some((a) => roots.has(a))
    if (!named) {
      unsupported.set(fw, (unsupported.get(fw) ?? 0) + 1)
      if ((unsupportedEx.get(fw) ?? []).length < 4) unsupportedEx.set(fw, [...(unsupportedEx.get(fw) ?? []), path.relative(root, f)])
    }
  }
  if (fws.length > 1) nMulti++
  for (const name of fws) {
    byExact.set(name, (byExact.get(name) ?? 0) + 1)
    const k = name.toLowerCase()
    let set = byFolded.get(k)
    if (!set) {
      set = new Set()
      byFolded.set(k, set)
    }
    set.add(name)
  }
}

console.log(`\npython files: ${nPy}  (failed ${nFail})`)
console.log(`  files with >=1 framework: ${nDetected} (${((100 * nDetected) / nPy).toFixed(1)}%)`)
console.log(`  files with  >1 framework: ${nMulti} (${((100 * nMulti) / nPy).toFixed(1)}%)`)
console.log(`  distinct framework strings: ${byExact.size}`)

console.log(`\n  every framework string, by file count:`)
const sorted = [...byExact].sort((a, b) => b[1] - a[1])
for (const [name, count] of sorted) {
  const variants = byFolded.get(name.toLowerCase())!
  const flag = variants.size > 1 ? `   <-- ${variants.size} SPELLINGS: ${[...variants].join(" / ")}` : ""
  console.log(`    ${String(count).padStart(6)}  ${name}${flag}`)
}

const split = [...byFolded].filter(([, v]) => v.size > 1)
console.log(`\n  CASE-VARIANT DUPLICATES: ${split.length}`)
if (split.length === 0) {
  console.log(
    "    none — every framework has exactly ONE spelling across the corpus, so a consumer's\n" +
      "    group-by on this value is stable. The two tables' differing casing does not reach the\n" +
      "    product, because the lane's spelling wins the dedupe whenever both tables match.",
  )
} else {
  for (const [k, v] of split) {
    const parts = [...v].map((s) => `${s} (${byExact.get(s)})`)
    console.log(`    ${k}: ${parts.join("  vs  ")}`)
  }
  console.log(
    "\n    A consumer querying one spelling silently misses the files that used the other, and\n" +
      "    which spelling a file gets depends on WHICH TABLE matched it rather than on anything\n" +
      "    in the source.",
  )
}
if (unsupported.size > 0) {
  console.log(`\n  INVARIANT VIOLATIONS — a framework reported with no import naming it:`)
  for (const [fw, count] of [...unsupported].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(5)}  ${fw}`)
    for (const ex of unsupportedEx.get(fw) ?? []) console.log(`             e.g. ${ex}`)
  }
  console.log(
    `\n    This is substring matching. An import names a framework when its ROOT SEGMENT equals\n` +
      `    the framework name; a module that merely CONTAINS it is a different library —\n` +
      `    "platform" contains "tf", "numpydoc" contains "numpy".`,
  )
  process.exitCode = 1
} else {
  console.log(`\n  INVARIANT HELD: every reported framework (except the documented pytest rule) is named by an import.`)
}
