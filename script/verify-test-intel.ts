// verify-test-intel.ts — strict static test intelligence (mapping/gaps/impact).
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { testMapping, testGaps, testImpact } from "../src/intelligence/testing/test-intel"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-testintel-"))
mkdirSync(path.join(root, "src"), { recursive: true })
// add: complex, tested. untested: complex, NOT tested (should be high-risk gap).
// same-name isolation: two files each declare `helper`; only one is tested.
writeFileSync(path.join(root, "src", "calc.ts"),
  "export function add(a: number, b: number): number {\n" +
  "  if (a > 0) { if (b > 0) { return a + b } else { return a } } else { return b }\n" +
  "}\n" +
  "export function untested(a: number): number {\n" +
  "  if (a > 10) { return a * 2 } else if (a > 5) { return a + 1 } else { return 0 }\n" +
  "}\n")
writeFileSync(path.join(root, "src", "a.ts"), "export function helper(): number { return 1 }\n")
writeFileSync(path.join(root, "src", "b.ts"), "export function helper(): number { return 2 }\n")
writeFileSync(path.join(root, "src", "calc.test.ts"),
  "import { add } from './calc'\nimport { helper } from './a'\n" +
  "export function testAdd(): void { if (add(1,2) !== 3) throw new Error('x'); helper() }\n")

const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  // --- mapping ---
  const mapping = await testMapping(projectId)
  check("mapping runs on brain_* tables (no crash)", !!mapping.summary)
  check("test files detected", mapping.summary.testFiles >= 1, `testFiles=${mapping.summary.testFiles}`)
  const addEntry = mapping.entries.find((e) => e.name === "add")
  check("add is mapped to a test (direct call)", !!addEntry && addEntry.links.some((l) => l.evidence === "direct_call"))
  check("add strongest evidence is direct_call", !!addEntry && addEntry.strongestEvidence === "direct_call")
  const untestedEntry = mapping.entries.find((e) => e.name === "untested")
  check("untested has no test links", !!untestedEntry && untestedEntry.links.length === 0)

  // same-name isolation: a.ts helper tested, b.ts helper NOT.
  const helperA = mapping.entries.find((e) => e.name === "helper" && e.file.includes("a.ts"))
  const helperB = mapping.entries.find((e) => e.name === "helper" && e.file.includes("b.ts"))
  check("helper in a.ts is mapped", !!helperA && helperA.links.length > 0)
  check("helper in b.ts is NOT mapped (same-name isolation)", !!helperB && helperB.links.length === 0)

  // --- gaps ---
  const gaps = await testGaps(projectId)
  check("gaps include untested symbol", gaps.gaps.some((g) => g.name === "untested"))
  check("gaps exclude tested add", !gaps.gaps.some((g) => g.name === "add"))
  check("no_evidence category present", gaps.summary.byCategory["no_evidence"] > 0)
  // ranking: untested (complex) should outrank helper (trivial)
  const untestedRank = gaps.gaps.findIndex((g) => g.name === "untested")
  const helperBRank = gaps.gaps.findIndex((g) => g.name === "helper" && g.file.includes("b.ts"))
  check("high-complexity untested ranks above trivial gap", untestedRank >= 0 && (helperBRank < 0 || untestedRank < helperBRank))

  // --- impact ---
  const impact = await testImpact(projectId, "add")
  check("impact found for add", impact.found)
  check("impact lists a direct test", impact.directTests.length > 0, JSON.stringify(impact.directTests))
  check("impact affected test files non-empty", impact.affectedTestFiles.length > 0)
  check("runtime coverage is a separate unpopulated field", impact.runtimeCoverage.available === false)

  const noImpact = await testImpact(projectId, "does_not_exist_zzz")
  check("impact not-found returns found:false", !noImpact.found)
} catch (error) {
  check("test-intel session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nTEST-INTEL: PASS" : "\nTEST-INTEL: " + failures + " FAILURES")
process.exit(failures > 0 ? 1 : 0)
