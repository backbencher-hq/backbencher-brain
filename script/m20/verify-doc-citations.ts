// M20.D2 — bb_doc citation resolution and freshness.
//
// 1. Every emitted citation resolves to a real file on disk with a valid line
//    span (no phantom citations).
// 2. Stale fixture: a source file changed since indexing yields citations
//    with freshness=stale and quality.freshness.passed=false.
// 3. Missing/broken fixture: a source file deleted after indexing yields
//    freshness=missing AND a broken citation count > 0, and
//    quality.references.passed=false. (This proves the broken count is real,
//    not the hardcoded 0 it used to be.)
// 4. Persists exact evidence; no auto-pass assertions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { generateDocumentation } from "../../src/intelligence/documentation/doc-engine"
import { docSourceFingerprint, docRelevantWorkingTreeChanges } from "../../src/intelligence/documentation/evidence"

let checks = 0
let passed = 0
let negativeCases = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) { passed++; console.log(`  ok: ${label}`) }
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, condition: boolean, detail = ""): void {
  negativeCases++
  check(`${label} [negative]`, condition, detail)
}

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-d2-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "math.ts"), "/** Adds two numbers. */\nexport function add(a: number, b: number): number { return a + b }\n")
writeFileSync(path.join(root, "src", "app.ts"), "import { add } from './math'\nexport function main(): number { return add(1, 2) }\n")
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  // ── 1. Citation resolution ────────────────────────────────────────────
  const doc = await generateDocumentation(projectId, root, { mode: "project", limit: 50 })
  check("citations: emitted", doc.citations.length > 0, `n=${doc.citations.length}`)
  const fileKinds = doc.citations.filter((c) => ["file", "symbol", "import", "relationship", "test"].includes(c.kind) && c.path)
  check("citations: file-backed kinds present", fileKinds.length > 0, `n=${fileKinds.length}`)
  const allResolve = fileKinds.every((c) => {
    const abs = path.isAbsolute(c.path!) ? c.path! : path.join(root, c.path!)
    try {
      const lines = readFileSync(abs, "utf8").split(/\r?\n/)
      return c.lineStart == null || c.lineStart <= lines.length
    } catch { return false }
  })
  check("citations: every file-backed citation resolves on disk", allResolve, JSON.stringify(fileKinds.map((c) => c.path)))

  // ── 2. Stale fixture ──────────────────────────────────────────────────
  writeFileSync(path.join(root, "src", "math.ts"), "/** Adds two numbers. */\nexport function add(a: number, b: number): number { return a + b + 100 }\n")
  const staleDoc = await generateDocumentation(projectId, root, { mode: "symbol", target: "add", limit: 20 })
  const staleCitations = staleDoc.citations.filter((c) => c.symbol === "add" || (c.path ?? "").includes("math.ts"))
  check("stale: citation freshness reflects modified file", staleCitations.some((c) => c.freshness === "stale"), JSON.stringify(staleCitations.map((c) => c.freshness)))
  negative("stale: quality.freshness does not pass", staleDoc.quality.freshness.passed === false, JSON.stringify(staleDoc.quality.freshness))

  // ── 3. Missing/broken fixture ─────────────────────────────────────────
  rmSync(path.join(root, "src", "app.ts"))
  const missing = await generateDocumentation(projectId, root, { mode: "project", limit: 50 })
  const appCitations = missing.citations.filter((c) => (c.path ?? "").includes("app.ts"))
  check("missing: deleted file citations are freshness=missing", appCitations.every((c) => c.freshness === "missing"), JSON.stringify(appCitations.map((c) => c.freshness)))
  check("broken: deleted file citations counted as broken", missing.quality.references.broken >= 1, `broken=${missing.quality.references.broken}`)
  negative("missing: references.passed is false when files are gone", missing.quality.references.passed === false, JSON.stringify(missing.quality.references))
  negative("broken: quality no longer hardcodes broken=0", missing.quality.references.broken > 0, `broken=${missing.quality.references.broken}`)

  // ── 4. Fresh baseline sanity ──────────────────────────────────────────
  const fresh = await generateDocumentation(projectId, root, { mode: "symbol", target: "add", limit: 20 })
  check("fresh: add symbol still documented after app.ts removal", fresh.citations.some((c) => (c.path ?? "").includes("math.ts")), JSON.stringify(fresh.citations.map((c) => c.path)))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

const failed = checks - passed
const result = {
  issue: "M20.D2", code: "D2", milestone: "M20",
  status: failed === 0 && docRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks, passed, failed, negativeCases,
  currentCommit: (() => { try { return Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim() } catch { return "unknown" } })(),
  sourceFingerprint: docSourceFingerprint(path.resolve(".")),
  workingTreeRelevantChanges: docRelevantWorkingTreeChanges(path.resolve(".")),
  verifierCommand: "bun run script/m20/verify-doc-citations.ts",
  evidenceFile: "D2.json",
  generatedAt: new Date().toISOString(),
  limitations: ["Fixture-level citation/freshness matrix; real-repository documentation coverage is owned by M20.X2."],
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeFileSync(path.resolve("validation/m20/results/D2.json"), JSON.stringify(result, null, 2) + "\n")
console.log(failed === 0 ? "\nDOC D2: PASS" : `\nDOC D2: ${failed} FAILURES`)
process.exit(failed ? 1 : 0)