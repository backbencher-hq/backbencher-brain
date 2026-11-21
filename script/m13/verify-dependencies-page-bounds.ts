// script/m13/verify-dependencies-page-bounds.ts
//
// Two reported defects on the dependency page (0.1.8):
//
//   "Dependencies output is still unusable. session/session.go returns 116
//    dependencies, including _test.go files, and the response reached 10,923 lines
//    before host truncation. limit bounds files, not rows."
//
// 1. `limit` bounded FILE ROWS. Each row could carry up to 100 dependencies plus
//    100 dependents, so a 50-file page could emit ~10,000 entries. The page now has
//    its own row budget (MAX_PAGE_ROW_ENTRIES).
// 2. `_test.go` files appeared in both lists. That is real coupling but not
//    blast radius, and it dominated the page. They are filtered by default and
//    COUNTED (`testFilesExcluded`), with `includeTests: true` to restore them.
//
// Built on a real index through the real indexer, because both defects are about
// what the query returns, not about what the source says.

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import * as path from "node:path"

let failures = 0
let checks = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const SCRATCH = path.resolve(import.meta.dirname, "../../.tools/deps-bounds")
const dataDir = path.join(SCRATCH, "data")
const srcDir = path.join(SCRATCH, "src")

console.log("M13 dependency page bounds + test filtering\n")
rmSync(SCRATCH, { recursive: true, force: true })
mkdirSync(srcDir, { recursive: true })
process.env.BB_DATA_DIR = dataDir

// `hub/hub.go` is imported by 40 ordinary files and 10 test files: enough to exceed
// the 300-entry page budget from a single row set, and enough test edges to see the
// filter working. The hub needs its OWN package directory — inside one directory a
// Go import names the PACKAGE (every file in it), so a hub.go sitting beside its
// importers resolves to no single target and emits no per-file dependent edge.
const ordinary = 40
const tests = 10
mkdirSync(path.join(srcDir, "hub"), { recursive: true })
for (let i = 0; i < ordinary; i++) {
  writeFileSync(path.join(srcDir, `user${String(i).padStart(2, "0")}.go`), 'package deps\n\nimport "example.com/deps/hub"\n\nvar _ = hub.Value\n')
}
for (let i = 0; i < tests; i++) {
  // A valid EXTERNAL test package, which is how a real _test.go imports the code
  // under test. The previous fixture declared `package hub` and imported itself,
  // which Go does not allow, so it produced no edges and the gate was measuring an
  // empty set rather than the filter.
  writeFileSync(path.join(srcDir, `user${String(i).padStart(2, "0")}_test.go`), 'package deps_test\n\nimport (\n\t"testing"\n\thub "example.com/deps/hub"\n)\n\nfunc TestX(t *testing.T) { _ = hub.Value }\n')
}
writeFileSync(path.join(srcDir, "hub", "hub.go"), "package hub\n\nconst Value = 1\n")
writeFileSync(path.join(srcDir, "go.mod"), "module example.com/deps\n\ngo 1.21\n")

const { getProjectId } = await import("../../src/util/project-id")
const { indexProjectParallel } = await import("../../src/ast/parallel-indexer")
const { getFileDependencies } = await import("../../src/intelligence/analysis/dependencies")

const projectId = getProjectId(srcDir)
await indexProjectParallel(projectId, srcDir, {})

// ── the page bound ───────────────────────────────────────────────────────────
const page = await getFileDependencies(projectId as any, { limit: 50 })
const emitted = page.reduce((n, r) => n + r.dependencies.length + r.dependents.length, 0)
check("the page cannot exceed the row budget however many files it lists", emitted <= 300, `emitted=${emitted} across ${page.length} file rows`)
check("the per-row cap still applies (one file cannot dominate)", page.every((r) => r.dependencies.length <= 100 && r.dependents.length <= 100))

// ── THE REPORTED DEFECT: a non-zero total must never come with an empty list ──
// The first version of the page budget spent the whole allowance on the first rows, so a
// row later in the ranking returned `dependenciesTotal: 89` beside `dependencies: []`.
// Reported by the owner as "Directory dependencies now show totals but empty edge lists".
{
  const starved = page.filter(
    (r) =>
      (r.dependenciesTotal > 0 && r.dependencies.length === 0) ||
      (r.dependentsTotal > 0 && r.dependents.length === 0),
  )
  check(
    "THE REPORTED DEFECT: no row reports a total with an EMPTY edge list",
    starved.length === 0,
    starved.slice(0, 3).map((r) => `${r.file} deps=${r.dependenciesTotal}/${r.dependencies.length} depdents=${r.dependentsTotal}/${r.dependents.length}`).join(" | "),
  )
  // Every trimmed row must SAY it was trimmed, so a short list is declared, not silent.
  const silentlyShort = page.filter((r) => (r.dependencies.length < r.dependenciesTotal && !r.dependenciesTruncated) || (r.dependents.length < r.dependentsTotal && !r.dependentsTruncated))
  check("every trimmed row declares its truncation", silentlyShort.length === 0, silentlyShort.slice(0, 2).map((r) => r.file).join(", "))
}

// ── an EXACT-FILE query is never thinned ─────────────────────────────────────
// The scoped question ("this file's edges") is the one the page budget must not touch:
// one row, so it receives the full per-row cap.
{
  const one = await getFileDependencies(projectId as any, { filePath: "hub/hub.go", limit: 50 })
  const row = one.find((r) => r.file.endsWith("hub/hub.go"))
  check("an exact-file query returns its row", !!row)
  if (row) {
    check(
      "an exact-file query lists EVERY dependent (not a fair-share slice)",
      row.dependents.length === Math.min(row.dependentsTotal, 100),
      `${row.dependents.length} of ${row.dependentsTotal}`,
    )
  }
}

// ── test filtering ───────────────────────────────────────────────────────────
// Scope to the hub so it is the ONLY row and therefore receives the whole row
// budget. Searching the unscoped page is unreliable: with the budget correctly
// enforced, a row late in the ranking can legitimately receive zero entries, which
// would make this gate measure the budget instead of the test filter.
const hubPage = await getFileDependencies(projectId as any, { filePath: "hub", limit: 50 })
const hubDefault = hubPage.find((r) => r.file.endsWith("hub/hub.go"))
check("the hub file is on the page", !!hubDefault)
if (hubDefault) {
  const testPaths = hubDefault.dependents.filter((d) => /_test\.go$/.test(d.path))
  check("no _test.go dependents by default", testPaths.length === 0, JSON.stringify(testPaths.slice(0, 3)))
  check("the exclusion is DECLARED, not silent", typeof hubDefault.testFilesExcluded === "number" && hubDefault.testFilesExcluded > 0, String(hubDefault.testFilesExcluded))
}

// opt in: the same rows come back
const withTests = await getFileDependencies(projectId as any, { filePath: "hub", limit: 50, includeTests: true })
const hubAll = withTests.find((r) => r.file.endsWith("hub/hub.go"))
if (hubAll) {
  const testPaths = hubAll.dependents.filter((d) => /_test\.go$/.test(d.path))
  check("includeTests:true restores the test dependents", testPaths.length > 0, `${testPaths.length} test dependents`)
  check("includeTests:true reports nothing excluded", (hubAll.testFilesExcluded ?? 0) === 0, String(hubAll.testFilesExcluded))
} else {
  check("includeTests:true page still lists the hub file", false)
}

rmSync(SCRATCH, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} passed`)
console.log(failures === 0 ? "DEPENDENCY BOUNDS: PASS" : `DEPENDENCY BOUNDS: FAIL (${failures})`)
process.exit(failures === 0 ? 0 : 1)
