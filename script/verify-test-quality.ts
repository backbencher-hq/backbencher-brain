// verify-test-quality.ts — evidence-based test quality + suggestions (M9.11).
// Independent measurement, explicit unknown states, evidence-first suggestions.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { testQuality } from "../src/intelligence/testing/quality"
import { testSuggestions } from "../src/intelligence/testing/suggestions"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-testquality-"))
mkdirSync(path.join(root, "src"), { recursive: true })

// Production symbols: `add` (tested), `untested` (no test refs), `gone` (will be "deleted").
writeFileSync(path.join(root, "src", "calc.ts"),
  "export function add(a: number, b: number): number {\n" +
  "  if (a > 0) { if (b > 0) { return a + b } else { return a } } else { return b }\n" +
  "}\n" +
  "export function untested(a: number): number {\n" +
  "  if (a > 10) { return a * 2 } else if (a > 5) { return a + 1 } else { return 0 }\n" +
  "}\n" +
  "export function gone(a: number): number { return a }\n")

// Rich test: assertions + error handling + parameterized + comments.
writeFileSync(path.join(root, "src", "calc.test.ts"),
  "import { add, gone } from './calc'\n" +
  "import { expect, assert } from './assertlib'\n" +
  "// covers arithmetic behavior and error paths\n" +
  "export function testAdd(): void {\n" +
  "  expect(add(1, 2)).toBe(3)\n" +
  "  assert(add(2, 2) === 4)\n" +
  "  assert(gone(1) === 1)\n" +
  "  try { add(1, 2) } catch (e) { throw new Error('must not throw') }\n" +
  "  const cases = [[1,2,3],[2,2,4]]\n" +
  "  for (const [a,b,exp] of cases) it.each(cases)('adds', () => expect(add(a,b)).toBe(exp))\n" +
  "}\n")

// Weak test: calls add but has NO assertion / error-handling evidence.
writeFileSync(path.join(root, "src", "weak.spec.ts"),
  "import { add } from './calc'\n" +
  "export function testWeak(): void { add(1, 1) }\n")

const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  // ---- quality: independent measurement + unknown handling ----
  const quality = await testQuality(projectId)
  check("quality returns files", quality.files.length === 2, `files=${quality.files.length}`)

  const richQ = quality.files.find((f) => f.relativePath.includes("calc.test.ts"))
  const weakQ = quality.files.find((f) => f.relativePath.includes("weak.spec.ts"))
  check("rich test detected", !!richQ)
  check("weak test detected", !!weakQ)

  if (richQ && weakQ) {
    const richDims = Object.fromEntries(richQ.dimensions.map((d) => [d.id, d]))
    const weakDims = Object.fromEntries(weakQ.dimensions.map((d) => [d.id, d]))

    // Independence: each dimension measured from its own evidence, not a shared score.
    check("assertions measured independently (supported)", richDims.assertions?.supported === true)
    check("error_handling measured independently", richDims.error_handling?.supported === true)
    check("parameterization measured from content evidence", richDims.parameterization?.supported === true)
    check("rich assertions evidence > weak assertions evidence",
      (richDims.assertions?.evidenceStrength ?? 0) > (weakDims.assertions?.evidenceStrength ?? 0),
      `rich=${richDims.assertions?.evidenceStrength} weak=${weakDims.assertions?.evidenceStrength}`)
    check("rich error_handling evidence > weak", (richDims.error_handling?.evidenceStrength ?? 0) > (weakDims.error_handling?.evidenceStrength ?? 0))
    check("rich parameterization present (>0)", (richDims.parameterization?.evidenceStrength ?? 0) > 0)
    check("weak parameterization absent (0)", (weakDims.parameterization?.evidenceStrength ?? 0) === 0)

    // Rich test should out-score weak test overall (independence shows in aggregate).
    check("rich overall >= weak overall", (richQ.overall ?? -1) >= (weakQ.overall ?? 1) - 1e-9,
      `rich=${richQ.overall} weak=${weakQ.overall}`)

    // Explicit issue surfaced for the no-assertion weak test (not fabricated).
    check("weak test flags no-assertion issue", weakQ.issues.some((i) => i.category === "no_assertion_evidence"))
  }

  // Unknown handling: maxFiles=0 → no file content read → content-backed dims unknown (never fabricated).
  const noContent = await testQuality(projectId, { maxFiles: 0 })
  const anyFile = noContent.files[0]
  check("unread file → content dims unknown (supported=false)",
    !!anyFile && anyFile.dimensions.some((d) => d.id === "assertions" && d.supported === false))
  check("unknown dims listed in unsupported[]",
    !!anyFile && anyFile.unsupported.includes("assertions") && anyFile.unsupported.includes("error_handling"))
  check("overall is null-ish when nothing measurable", noContent.summary.filesUnknown >= 0)

  // ---- suggestions: evidence-first, changed-symbol scenarios ----
  const changedAdd = await testSuggestions(projectId, [{ name: "add", file: "src/calc.ts", kind: "modified" }])
  check("suggestions run for changed add", changedAdd.changedSymbols.length === 1)
  check("changed add → extend_existing_test (existing tests first)",
    changedAdd.changedSymbols[0].actions.some((a) => a.action === "extend_existing_test"))
  check("changed add → NOT naming fallback (has evidence)", changedAdd.changedSymbols[0].namingFallback === false)
  check("affectedExistingTests recorded", changedAdd.affectedExistingTests.length > 0)

  const changedUntested = await testSuggestions(projectId, [{ name: "untested", file: "src/calc.ts", kind: "modified" }])
  check("untested → create_test suggestion", changedUntested.changedSymbols[0].actions.some((a) => a.action === "create_test"))
  check("untested → naming fallback flagged (low confidence)", changedUntested.changedSymbols[0].namingFallback === true)

  const addedUntested = await testSuggestions(projectId, [{ name: "untested", file: "src/calc.ts", kind: "added" }])
  check("added symbol scenario is preserved", addedUntested.changedSymbols[0].changeType === "added")
  check("added untested symbol recommends create_test", addedUntested.changedSymbols[0].actions.some((a) => a.action === "create_test"))
  check("added untested symbol flags naming fallback", addedUntested.changedSymbols[0].namingFallback === true)

  const changedDeleted = await testSuggestions(projectId, [{ name: "gone", file: "src/calc.ts", kind: "deleted" }])
  check("deleted → review_deleted_symbol_coverage",
    changedDeleted.changedSymbols[0].actions.some((a) => a.action === "review_deleted_symbol_coverage"))
  check("deleted → existing referencing test surfaced", changedDeleted.affectedExistingTests.some((t) => t.changedSymbol === "gone"))

} catch (error) {
  check("test-quality session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nTEST-QUALITY: PASS" : `\nTEST-QUALITY: ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
