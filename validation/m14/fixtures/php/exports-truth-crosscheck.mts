/**
 * `exports` — the ORACLE against the ANALYZER, on every file that carries the label.
 *
 * ## Why a label dump is not enough for this label
 *
 * The differential draws 60 files per repo per wave from a cold-pool rotation. `exports`
 * is 58 edges over 18 files in a 5,094-file population, so a wave can contain **zero**
 * rows of it — and a label that is admitted to the compared set with 0 truth and 0
 * comparable prints nothing and passes. That is the same shape as the vacuous zero this
 * lane has now found three times (the `argument` wrapper, the pre-seeded shape keys, the
 * callee field), so the label gets a proof that does not depend on which wave ran:
 * **every file the audit says carries a publication, compared row by row.**
 *
 * ## What is compared, and with whose matcher
 *
 * The analyzer side comes from `parseFile` — the production entry point, not the
 * analyzer class, so a projection-layer loss would show up here. The truth side comes
 * from `derivePhpExportsTruth` (script/m14/oracles/php-exports.ts), the same oracle the
 * differential registers. The matcher is the harness's own `normTarget`, imported rather
 * than re-implemented: a second matcher would be a second thing to be wrong, and the
 * question here is about the EDGES, not about matching.
 *
 * Both directions are reported: `MISSING` (truth with no analyzer row — a lost edge) and
 * `unexplained` (analyzer with no truth row — a fabricated one). Either must be 0.
 *
 * ## The non-vacuity controls
 *
 * An empty comparison passes silently, so the instrument asserts its own denominator:
 * the file set is non-empty, the truth total equals the audit's publication count, and
 * the fully qualified `\define` file — the edge this round added, the one the old
 * spelling rule refused — is present on BOTH sides. Without those, "0/0" and "the oracle
 * is wired" would be the same output.
 *
 * Run: npx tsx validation/m14/fixtures/php/exports-truth-crosscheck.mts
 * Exits non-zero on any mismatch or on a control that does not hold.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { normTarget } from "../../../../script/m14/differential"
import { derivePhpExportsTruth } from "../../../../script/m14/oracles/php-exports"

const ROOT = process.cwd()
const ARTIFACT = path.join(ROOT, "validation/m60/php/exports-probe.json")
const audit = JSON.parse(readFileSync(ARTIFACT, "utf8"))
const publications: { file: string; callee: string; name: string }[] = audit.defineAudit.publications
if (!Array.isArray(publications) || publications.length === 0) {
  console.error(`FAIL — ${ARTIFACT} carries no defineAudit.publications; the denominator is missing, so this check would compare nothing`)
  process.exit(1)
}

// The audit's file labels are `<repo>/<rel>`; the corpus root is the artifact's own.
const CORPUS = audit.corpusRoot as string
const files = [...new Set(publications.map((p) => p.file))].sort()

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-php.wasm"))))

let missing = 0
let unexplained = 0
let analyzerTotal = 0
let truthTotal = 0
let sawAbsoluteFq = false
const missingRows: string[] = []
const unexplainedRows: string[] = []

/**
 * The comparator, as a function, so it can be run on a case built to FAIL.
 *
 * A comparator that cannot report a mismatch makes every "0/0" it prints worthless,
 * and this lane has now paid for that lesson three times in instruments (the `argument`
 * wrapper, the pre-seeded shape keys, the callee field). So the same function that
 * compares the corpus is run on a synthetic pair one edge apart, in both directions,
 * and the run fails if it does NOT report them.
 */
const compareExports = (
  truthTargets: string[],
  analyzerTargets: string[],
): { missing: number; unexplained: number } => {
  const t = new Set(truthTargets.map((x) => `exports|${normTarget(x)}`))
  const a = new Set(analyzerTargets.map((x) => `exports|${normTarget(x)}`))
  let miss = 0
  let unex = 0
  for (const k of t) if (!a.has(k)) miss++
  for (const k of a) if (!t.has(k)) unex++
  return { missing: miss, unexplained: unex }
}

for (const label of files) {
  const abs = path.join(CORPUS, label)
  const content = readFileSync(abs, "utf8")
  const tree: any = parser.parse(content)
  const truth = derivePhpExportsTruth(tree.rootNode)
  tree.delete?.()

  const result: any = await parseFile(abs, "php")
  const analyzer = ((result?.relationships ?? []) as any[]).filter((r) => String(r?.type ?? "") === "exports")

  truthTotal += truth.length
  analyzerTotal += analyzer.length

  // The harness collapses the analyzer side per file on `label|target` before comparing;
  // the oracle dedupes the same way. Mirroring the collapse here keeps the two sides
  // comparable for the same reason the harness does it (one edge per call SITE would
  // otherwise read as a fabrication).
  // The analyzer side is collapsed to one edge per (label,target) — the harness's own
  // dedupe, applied here for the same reason: one edge per call SITE would otherwise be
  // read as a fabrication.
  const analyzerTargets: string[] = []
  const seenAnalyzerTarget = new Set<string>()
  for (const r of analyzer) {
    const t = String(r.target ?? "")
    const k = `exports|${normTarget(t)}`
    if (seenAnalyzerTarget.has(k)) continue
    seenAnalyzerTarget.add(k)
    analyzerTargets.push(t)
  }
  const truthTargets = truth.map((t) => String(t.target))
  const cmp = compareExports(truthTargets, analyzerTargets)
  missing += cmp.missing
  unexplained += cmp.unexplained
  if (cmp.missing > 0 && missingRows.length < 20) {
    const a = new Set(analyzerTargets.map((x) => normTarget(x)))
    for (const t of truthTargets) if (!a.has(normTarget(t)) && missingRows.length < 20) missingRows.push(`${label}: truth exports -> ${t}`)
  }
  if (cmp.unexplained > 0 && unexplainedRows.length < 20) {
    const t = new Set(truthTargets.map((x) => normTarget(x)))
    for (const r of analyzer) {
      if (!t.has(normTarget(String(r.target ?? ""))) && unexplainedRows.length < 20) {
        unexplainedRows.push(`${label}: analyzer exports -> ${r.target}  ${JSON.stringify(r.metadata ?? {})}`)
      }
    }
  }

  if (label.endsWith("auto_prepend_file.php")) {
    const want = "AUTO_PREPEND_FILE_LOADED"
    sawAbsoluteFq =
      truth.some((t) => t.target === want) && analyzer.some((r) => String(r.target) === want)
  }
}

console.log("php `exports` — the oracle against the analyzer, every file that carries the label")
console.log(`  files compared        ${files.length}   (the audit's publication set, not a draw)`)
console.log(`  truth edges           ${truthTotal}`)
console.log(`  analyzer edges        ${analyzerTotal}`)
console.log(`  MISSING (truth-only)  ${missing}`)
for (const r of missingRows) console.log(`    ${r}`)
console.log(`  unexplained (an-only) ${unexplained}`)
for (const r of unexplainedRows) console.log(`    ${r}`)

let failures = 0
const check = (name: string, ok: boolean, detail = ""): void => {
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`)
}
console.log("")
check("a denominator exists (files > 0)", files.length > 0, `${files.length} files`)
check(
  "the truth total equals the audit's publication count",
  truthTotal === publications.length,
  `${truthTotal} vs ${publications.length}`,
)
check(
  "the fully qualified `\\define` file is on BOTH sides",
  sawAbsoluteFq,
  "phpunit/tests/end-to-end/generic/_files/auto_prepend_file.php",
)
check("MISSING = 0 (no lost edge)", missing === 0)
check("unexplained = 0 (no fabricated edge)", unexplained === 0)

// POSITIVE CONTROLS on the comparator itself — the same function, on pairs one edge apart.
// Without these, "0/0" above and "the comparator is inert" would print the same line.
const c1 = compareExports(["CONTROL_NAME"], [])
const c2 = compareExports([], ["CONTROL_NAME"])
const c3 = compareExports(["CONTROL_NAME"], ["CONTROL_NAME"])
check("control: a truth-only edge IS reported as MISSING", c1.missing === 1 && c1.unexplained === 0, JSON.stringify(c1))
check("control: an analyzer-only edge IS reported as unexplained", c2.missing === 0 && c2.unexplained === 1, JSON.stringify(c2))
check("control: a matched pair reports neither", c3.missing === 0 && c3.unexplained === 0, JSON.stringify(c3))

console.log("")
if (failures > 0) {
  console.log(`FAIL — ${failures} check(s) failed`)
  process.exit(1)
}
console.log(`PASS — ${truthTotal} truth edge(s) and ${analyzerTotal} analyzer edge(s) agree on all ${files.length} file(s) that carry the label`)
