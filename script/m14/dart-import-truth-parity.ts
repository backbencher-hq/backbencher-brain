// DART `imports`/`exports` TRUTH PARITY — the red-capable pin for the oracle's resolved-target mirror.
//
// WHY THIS EXISTS (2026-10-18): the exact-path matcher (Lead 174f35fda) exposed that the analyzer
// publishes the FILE a specifier names (project-relative path) when the checkout can answer, while the
// oracle published the specifier as written (`<uri>:*`). The lane aligned the oracle to the analyzer's
// spelling (the analyzer is the contract) by mirroring `dartImportTargetPath`. That mirror is the one
// place in this lane where truth and analyzer can silently disagree — the differential only sees it as
// MISSING/UNEXPLAINED on a drawn sample. THIS probe compares the two derivations directly, on every
// dart fixture, using the SAME synthetic path convention the fixture runner uses
// (`fixtures/dart/<name>.dart`), and fails if any import/export target differs.
//
// THE VACUITY GUARD: the probe also requires that at least one target is NOT the `<uri>:*` spelling —
// i.e. the resolution path is genuinely exercised, so a future change that makes both sides emit raw
// specifiers cannot pass by agreeing on nothing.
//
// Lane-owned instrument; no shared files. Command: bun run script/m14/dart-import-truth-parity.ts
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"
import { deriveDartImportsTruth } from "./oracles/dart-imports"

const ROOT = path.resolve(import.meta.dir ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const FIXTURES = path.join(ROOT, "validation", "m14", "fixtures", "dart")
const parser = await getParser("dart")
const analyzer = new RealDartAnalyzer()

let files = 0, rows = 0, resolvedRows = 0, mismatches = 0
const problems: string[] = []
for (const name of readdirSync(FIXTURES).sort()) {
  if (!name.endsWith(".dart")) continue
  const src = readFileSync(path.join(FIXTURES, name), "utf8")
  const tree = parser.parse(src)
  const root = tree?.rootNode
  if (!root) continue
  // The SAME synthetic path the fixture runner hands the analyzer (see import-resolution expectation:
  // the runner does not pass the real on-disk path, and the resolution rule is anchored from it).
  const synthetic = `fixtures/dart/${name}`
  const result: any = analyzer.analyze(root, src, synthetic)
  const analyzers = (result?.relationships ?? [])
    .filter((r: any) => r.type === "imports" || r.type === "exports")
    .map((r: any) => `${r.type}|${r.target}`)
    .sort()
  const truth = deriveDartImportsTruth(root, synthetic)
    .filter((e: any) => e.label === "imports" || e.label === "exports")
    .map((e: any) => `${e.label}|${e.target}`)
    .sort()
  files++
  rows += analyzers.length
  for (const t of analyzers) if (!String(t).endsWith(":*") || String(t).startsWith("exports|")) {
    if (!String(t).startsWith("imports|") || !String(t).endsWith(":*")) resolvedRows++
  }
  if (analyzers.length !== truth.length || analyzers.some((x, i) => x !== truth[i])) {
    mismatches++
    problems.push(`${name}\n    analyzer: ${JSON.stringify(analyzers)}\n    oracle:   ${JSON.stringify(truth)}`)
  }
}
console.log(`dart import/export truth parity — ${files} fixture file(s), ${rows} import/export row(s), resolved-target rows ${resolvedRows}, mismatched file(s) ${mismatches}`)
// VACUITY GUARD: the resolved-target branch must be exercised (import-resolution fixture pins it).
if (resolvedRows === 0) {
  console.error("VACUITY: no fixture exercised a RESOLVED import target — the parity check would be comparing raw specifiers only")
  process.exit(3)
}
if (mismatches > 0) {
  for (const p of problems.slice(0, 8)) console.error(p)
  console.error(`PARITY FAILED: ${mismatches} file(s)`)
  process.exit(3)
}
console.log("parity PASS — oracle publishes the analyzer's exact spelling on every fixture")
