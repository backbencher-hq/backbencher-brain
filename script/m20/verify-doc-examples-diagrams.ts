// M20.D3 — bb_doc source-backed examples and diagrams.
//
// 1. includeExamples=true never fabricates examples: it emits an honest
//    not-observed unknown instead of invented code.
// 2. includeDiagrams=true never fabricates diagrams: reference.diagrams stays
//    empty and the unknown documents the unavailable state.
// 3. Tamper-negative: deleting a relationship from the index removes the
//    corresponding fact from regenerated docs (no phantom/uncited claims).
// 4. Persists exact evidence; no auto-pass assertions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
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

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-d3-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "math.ts"), "/** Adds two numbers. */\nexport function add(a: number, b: number): number { return a + b }\n")
writeFileSync(path.join(root, "src", "app.ts"), "import { add } from './math'\nexport function main(): number { return add(1, 2) }\n")
const projectId = getProjectId(root)
try {
  await indexProjectParallel(projectId, root, {})

  // ── 1. Examples honesty ──────────────────────────────────────────────
  const withExamples = await generateDocumentation(projectId, root, { mode: "symbol", target: "add", includeExamples: true, limit: 20 })
  check("examples: no fabricated example section", !withExamples.sections.some((s) => /example/i.test(s.heading)), JSON.stringify(withExamples.sections.map((s) => s.heading)))
  check("examples: honest not-observed unknown emitted", withExamples.unknowns.some((u) => u.reason === "not-observed" && /example/i.test(u.statement)), JSON.stringify(withExamples.unknowns.map((u) => u.statement)))
  negative("examples: no invented example code in prose", !withExamples.summary.includes("```"), withExamples.summary.slice(0, 200))

  // ── 2. Diagrams honesty ──────────────────────────────────────────────
  const withDiagrams = await generateDocumentation(projectId, root, { mode: "project", includeDiagrams: true, limit: 20 })
  check("diagrams: reference.diagrams stays empty (no fabrication)", Array.isArray(withDiagrams.reference.diagrams) && withDiagrams.reference.diagrams.length === 0, JSON.stringify(withDiagrams.reference.diagrams))
  check("diagrams: honest not-observed unknown emitted", withDiagrams.unknowns.some((u) => u.reason === "not-observed" && /diagram/i.test(u.statement)), JSON.stringify(withDiagrams.unknowns.map((u) => u.statement)))
  negative("diagrams: no fabricated mermaid/json diagram", !JSON.stringify(withDiagrams).includes("mermaid"), "mermaid found")

  // ── 3. Tamper-negative: relationship removal ─────────────────────────
  const raw = await BrainDatabase.getRawInstance(projectId)
  const before = await generateDocumentation(projectId, root, { mode: "symbol", target: "main", limit: 20 })
  // Located by CITATION KIND, not by heading text: the declared section set for
  // `symbol` names the section "Dependencies", and a tamper-negative that
  // pins a heading would break on a rename instead of on a real defect.
  const relCitationIds = new Set(before.citations.filter((c) => c.kind === "relationship").map((c) => c.id))
  const relationshipFacts = before.sections.flatMap((s) => s.facts).filter((f) => f.citationIds.some((id) => relCitationIds.has(id))).map((f) => f.statement)
  check("tamper: baseline has relationship facts for main", relationshipFacts.length > 0, JSON.stringify(relationshipFacts))
  const deleted = raw.prepare("DELETE FROM brain_relationship WHERE project_id = ? AND (source_symbol_id IN (SELECT id FROM brain_symbol WHERE name='main') OR target_symbol_id IN (SELECT id FROM brain_symbol WHERE name='main'))").run(projectId)
  check("tamper: relationship row deleted", deleted.changes > 0, `changes=${deleted.changes}`)
  const after = await generateDocumentation(projectId, root, { mode: "symbol", target: "main", limit: 20 })
  const afterRelIds = new Set(after.citations.filter((c) => c.kind === "relationship").map((c) => c.id))
  const afterFacts = after.sections.flatMap((s) => s.facts).filter((f) => f.citationIds.some((id) => afterRelIds.has(id))).map((f) => f.statement)
  negative("tamper: removed relationship no longer appears in docs", !afterFacts.some((f) => f.includes("add")), JSON.stringify(afterFacts))
  check("tamper: after removal, no relationship fact survives", afterFacts.length === 0, JSON.stringify(afterFacts))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

const failed = checks - passed
const result = {
  issue: "M20.D3", code: "D3", milestone: "M20",
  status: failed === 0 && docRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks, passed, failed, negativeCases,
  currentCommit: (() => { try { return Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim() } catch { return "unknown" } })(),
  sourceFingerprint: docSourceFingerprint(path.resolve(".")),
  workingTreeRelevantChanges: docRelevantWorkingTreeChanges(path.resolve(".")),
  verifierCommand: "bun run script/m20/verify-doc-examples-diagrams.ts",
  evidenceFile: "D3.json",
  generatedAt: new Date().toISOString(),
  limitations: ["Fixture-level examples/diagrams honesty and tamper response; real-repository documentation coverage is owned by M20.X2."],
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeFileSync(path.resolve("validation/m20/results/D3.json"), JSON.stringify(result, null, 2) + "\n")
console.log(failed === 0 ? "\nDOC D3: PASS" : `\nDOC D3: ${failed} FAILURES`)
process.exit(failed ? 1 : 0)