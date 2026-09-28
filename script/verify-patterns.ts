// verify-patterns.ts — canonical orphan detection: positive + negative fixtures.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { detectOrphans } from "../src/intelligence/patterns/orphans"

let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) console.log("  ok: " + label)
  else {
    failures++
    console.log("  FAIL: " + label + (detail ? " " + detail : ""))
  }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-patterns-"))
mkdirSync(path.join(root, "src"), { recursive: true })
// used.ts: referenced by main.ts. orphan.ts: never referenced.
writeFileSync(path.join(root, "src", "used.ts"),
  "export function usedFn(): number { return 1 }\nexport class UsedClass { run(): number { return 2 } }\n")
writeFileSync(path.join(root, "src", "orphan.ts"),
  "export function orphanFn(): number { return 3 }\nexport class OrphanClass { run(): number { return 4 } }\n")
writeFileSync(path.join(root, "src", "main.ts"),
  "import { usedFn, UsedClass } from \"./used\"\nexport function main(): number { const c = new UsedClass(); return usedFn() + c.run() }\n")
// A Python module: helperPy used by app.py, deadPy never used.
writeFileSync(path.join(root, "src", "helpers.py"), "def helper_py():\n    return 1\n\ndef dead_py():\n    return 2\n")
writeFileSync(path.join(root, "src", "app.py"), "from helpers import helper_py\n\ndef run_app():\n    return helper_py()\n")

const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  const report = await detectOrphans(projectId, { minConfidence: 0.4, maxResults: 100 })
  const names = new Set(report.findings.map((f) => f.location.symbol).filter(Boolean))
  const files = new Set(report.findings.filter((f) => f.rule === "orphaned_file").map((f) => f.location.file))

  // POSITIVE: the genuinely-unused symbols must be flagged.
  check("orphanFn flagged as orphaned", names.has("orphanFn"), [...names].join(","))
  check("OrphanClass flagged as orphaned", names.has("OrphanClass"), [...names].join(","))

  // NEGATIVE: used symbols must NOT be flagged (this is where the old visibility bug failed).
  check("usedFn NOT flagged (called by main)", !names.has("usedFn"))
  check("UsedClass NOT flagged (instantiated by main)", !names.has("UsedClass"))
  check("main NOT flagged (entry point)", !names.has("main"))

  // Finding schema completeness.
  const sample = report.findings.find((f) => f.location.symbol === "orphanFn")
  check("finding has engine provenance", !!sample && sample.engine.length > 0)
  check("finding has evidence array", !!sample && Array.isArray(sample.evidence) && sample.evidence.length > 0)
  check("finding has limitations (false-positive classes)", !!sample && sample.limitations.length > 0)
  check("finding has exact linesOfCode (not invented)", !!sample && typeof sample.linesOfCode === "number")
  check("remediation is evidence-aware (not 'safe to remove')", !!sample && !/safely removed|safe to remove/i.test(sample.remediation))
  check("confidence is capped <= 0.7", !!sample && sample.confidence <= 0.7)

  // Orphaned file: orphan.ts is imported by nobody... actually orphan.ts's symbols
  // are unused, and no file imports it -> orphaned file.
  check("orphan.ts flagged as orphaned file", [...files].some((f) => f.includes("orphan.ts")), [...files].join(","))
  check("used.ts NOT flagged as orphaned file (imported by main)", ![...files].some((f) => f.includes("used.ts")))

  // Summary integrity.
  check("summary counts match findings", report.summary.total === report.findings.length)
  check("summary reports scanned symbols > 0", report.summary.scannedSymbols > 0)
  check("byRule sums to total", Object.values(report.summary.byRule).reduce((a, b) => a + b, 0) === report.summary.total)

  // Rule filtering: request only functions.
  const fnOnly = await detectOrphans(projectId, { rules: ["orphaned_function"], minConfidence: 0.4 })
  check("rule filter returns only functions", fnOnly.findings.every((f) => f.rule === "orphaned_function"))
} catch (error) {
  check("patterns session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(failures === 0 ? "\nPATTERNS: PASS" : "\nPATTERNS: " + failures + " FAILURES")
process.exit(failures > 0 ? 1 : 0)
