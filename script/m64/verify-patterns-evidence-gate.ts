// script/m64/verify-patterns-evidence-gate.ts
//
// M64.P1 — the evidence gate, as a hermetic gate inside the repo.
//
// WHY THIS FILE EXISTS. Every defect this lane found in bb_patterns was found on
// a real corpus in fixtures/bb_patterns/, which is outside this repository and
// not wired into `npm run verify`. So none of the fixes are guarded: the page
// could go back to being an alphabetical prefix of the repository, the god-class
// join could go back to ignoring its index, and the evidence gate could go back
// to accepting a self-loop, and no gate in this repo would notice. This file is
// the guard.
//
// WHY THE FIXTURE IS WRITTEN INTO THE INDEX RATHER THAN ONLY BY WRITING SOURCE.
//
// The gate's whole content is about rows the indexer publishes with a specific
// `confidence` and `metadata.evidenceClass`:
//     an `overrides` row that is a self-loop, evidenceClass "inferred", at 0.5
// and the requirement that such a row must NOT clear an orphan candidate. A
// source-only fixture cannot produce that shape — the analyzer decides those
// values — so a source-only gate would assert nothing about the part that
// actually broke. Instead the fixture is indexed normally, and then the exact
// rows the gate must reason about are written into the project's brain.db.
//
// That is still hermetic: a tmpdir project, indexed by the real indexer, with
// rows this file inserts and the file itself removes. It needs no corpus, no
// network, and no fixture checked in. And it is a stronger test than a
// corpus run, because each row is placed to fail in exactly one way.
//
// WHAT IT ASSERTS, in one line each:
//   G1  a self-loop `overrides` row does NOT clear a candidate
//   G2  an `evidenceClass: "inferred"` row does NOT clear a candidate
//   G3  a confidence-0.5 row does NOT clear a candidate
//   G4  a clean anchored row DOES clear a candidate
//   G5  the page is ordered by confidence, not alphabetically
//   G6  a rejected row is disclosed on the finding that it would have cleared
//   G7  refused evidence is counted in summary.unverifiedUsageEdges
//   G8  the coverage-gap indicator fires on asymmetry and not on suspicion
//   G9  every finding carries evidence and limitations
//   G10 statistics.totalFound is the census, not the page
//   G11 the same decision is reachable through the MCP handler

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { detectOrphans } from "../../src/intelligence/patterns/orphans"
import { PatternBrainTools } from "../../src/ast/tools"

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) passed++
  if (value) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-m64-p1-"))
mkdirSync(path.join(root, "src"), { recursive: true })

// Six declarations in six files, so the candidate set is unambiguous by NAME as
// well as by id. A name collision would let the name channel clear a candidate
// for a reason unrelated to the row under test, and the test would pass for the
// wrong reason — which is the mistake m20/verify-patterns-parameter-scan's
// successor made when it counted substrings instead of rows.
writeFileSync(path.join(root, "src", "selfloop.ts"), "export class SelfLoopTarget { run(): number { return 1 } }\n")
writeFileSync(path.join(root, "src", "inferred.ts"), "export class InferredTarget { run(): number { return 2 } }\n")
writeFileSync(path.join(root, "src", "lowconf.ts"), "export class LowConfTarget { run(): number { return 3 } }\n")
writeFileSync(path.join(root, "src", "clean.ts"), "export class CleanTarget { run(): number { return 4 } }\n")
writeFileSync(path.join(root, "src", "lonely.ts"), "export class LonelyTarget { run(): number { return 5 } }\n")
writeFileSync(path.join(root, "src", "caller.ts"),
  "import { CleanTarget } from \"./clean\"\n" +
  "export function callerOne(): number { return new CleanTarget().run() }\n")

const projectId = getProjectId(root)
const USAGE = "calls"

try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)

  const idOf = (name: string): string => {
    const row = raw
      .prepare("SELECT s.id FROM brain_symbol s WHERE s.project_id = ? AND s.name = ?")
      .get(projectId, name) as { id: string } | undefined
    if (!row) throw new Error(`fixture symbol ${name} was not indexed`)
    return row.id
  }
  const fileOf = (name: string): string => {
    const row = raw
      .prepare("SELECT f.id FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.name = ?")
      .get(projectId, name) as { id: string } | undefined
    if (!row) throw new Error(`fixture symbol ${name} has no file`)
    return row.id
  }

  const selfLoop = idOf("SelfLoopTarget")
  const inferred = idOf("InferredTarget")
  const lowConf = idOf("LowConfTarget")
  const clean = idOf("CleanTarget")
  const lonely = idOf("LonelyTarget")
  const caller = idOf("callerOne")
  const callerFile = fileOf("callerOne")
  const cleanFile = fileOf("CleanTarget")

  // The three rows the gate must reject, each with exactly ONE defect, so a
  // failure names its cause. `target_external` is the bare name, which is what
  // the indexer writes for an intra-project target.
  // Column names are the schema's, not the ones this file first assumed:
  // brain_relationship has `time_created`, not `created_at`, and `confidence` is
  // NOT NULL. Verified against sqlite_master rather than from memory, because a
  // wrong column name fails the whole gate with an SqliteError that reads like
  // a product failure and is not one.
  const insert = raw.prepare(
    "INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external, relationship_type, confidence, is_cross_file, metadata, time_created) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
  const mkId = (tag: string) => `${projectId}:m64:${tag}`
  const now = Date.now()

  // G1: self-loop. rake's real shape, read out of its own rows.
  insert.run(mkId("selfloop"), projectId, selfLoop, selfLoop, "SelfLoopTarget", "TaskLib.SelfLoopTarget", "overrides", 0.99, 0,
    JSON.stringify({ isOverride: true, reasonCode: "first-parent-guess", evidenceClass: "inferred" }), now)
  // G2: inferred only, high confidence, anchored and NOT a self-loop.
  insert.run(mkId("inferred"), projectId, caller, inferred, "callerOne", "InferredTarget", "overrides", 0.99, 0,
    JSON.stringify({ isOverride: true, evidenceClass: "inferred" }), now)
  // G3: low confidence only, structural, anchored, not a self-loop.
  insert.run(mkId("lowconf"), projectId, caller, lowConf, "callerOne", "LowConfTarget", USAGE, 0.5, 0,
    JSON.stringify({ evidenceClass: "structural" }), now)
  // G4: clean control — the one row that must clear its candidate.
  insert.run(mkId("clean"), projectId, caller, clean, "callerOne", "CleanTarget", USAGE, 0.9, 0,
    JSON.stringify({ evidenceClass: "structural" }), now)

  const report = await detectOrphans(projectId, { minConfidence: 0, maxResults: 1000 })
  const names = new Set(report.findings.filter((f) => f.rule !== "orphaned_file").map((f) => f.location.symbol))
  const find = (n: string) => report.findings.find((f) => f.location.symbol === n)

  // --- G1..G4: one defect per row ---------------------------------------
  check("G1 a self-loop overrides row does NOT clear the candidate", names.has("SelfLoopTarget"),
    `SelfLoopTarget absent — the self-loop was accepted as a consumer`)
  check("G2 an evidenceClass=inferred row does NOT clear the candidate", names.has("InferredTarget"),
    `InferredTarget absent — the inferred tier was accepted as a consumer`)
  check("G3 a confidence-0.5 row does NOT clear the candidate", names.has("LowConfTarget"),
    `LowConfTarget absent — the guess tier was accepted as a consumer`)
  check("G4 a clean anchored row DOES clear the candidate", !names.has("CleanTarget"),
    `CleanTarget was still reported despite a clean cross-file call edge`)
  check("a symbol with no relationship at all is still reported (control)", names.has("LonelyTarget"))

  // --- G5: the page is ranked, not alphabetical --------------------------
  {
    // The defect this guards is the one that made the default page an
    // alphabetical prefix of the repository: a constant confidence collapses the
    // comparator to `file.localeCompare`. Assert the ORDER rather than the
    // count, and assert that the page is not sorted by path.
    const page = report.findings.slice(0, 20)
    let orderedByConfidence = true
    for (let i = 1; i < page.length; i++) if (page[i - 1].confidence < page[i].confidence) orderedByConfidence = false
    check("G5 the page is ordered by confidence, descending", orderedByConfidence,
      page.map((f) => `${f.location.symbol}=${f.confidence}`).join(" "))

    const byPath = [...page].map((f) => f.location.file)
    const sortedByPath = [...byPath].sort((a, b) => a.localeCompare(b))
    check("G5b the page is NOT merely alphabetical by path", byPath.join("|") !== sortedByPath.join("|"),
      byPath.slice(0, 4).join(", "))
  }

  // --- G6: refused evidence is disclosed, per finding --------------------
  {
    const f = find("SelfLoopTarget")
    check("G6 the finding names the refused evidence", !!f?.evidence.some((e) => e.description.includes("REFUSED EVIDENCE")),
      JSON.stringify(f?.evidence.map((e) => e.description.slice(0, 40))))
    check("G6b the refusal names the reason it was refused",
      !!f?.evidence.some((e) => e.description.includes("inferred")),
      JSON.stringify(f?.evidence.map((e) => e.description.slice(0, 60))))
  }
  {
    // A finding with no refused evidence must not claim one. A disclosure that
    // fires everywhere is a disclosure nobody reads.
    const clean = find("CleanTarget")
    check("G6c a cleared candidate is not reported at all (so cannot claim a disclosure)", !clean)
  }

  // --- G7: refusals are counted -----------------------------------------
  {
    const uv = (report.summary as any)?.unverifiedUsageEdges
    check("G7 unverifiedUsageEdges is reported", !!uv, "absent")
    check("G7b the three refusal reasons are itemised",
      !!uv && Object.keys(uv.byReason).length === 3, JSON.stringify(uv?.byReason))
    check("G7c the self-loop refusal is counted", (uv?.byReason?.selfLoop ?? 0) >= 1, JSON.stringify(uv?.byReason))
    check("G7d the inferred refusal is counted", (uv?.byReason?.inferred ?? 0) >= 1, JSON.stringify(uv?.byReason))
    check("G7e the low-confidence refusal is counted", (uv?.byReason?.lowConfidence ?? 0) >= 1, JSON.stringify(uv?.byReason))
    check("G7f refusals are itemised by relationship type", !!uv && Object.keys(uv.byRelationshipType).length >= 1)
    check("G7g the accepted confidence floor is stated", uv?.minimumConfidence === 0.7, String(uv?.minimumConfidence))
  }

  // --- G8: coverage-gap fires on asymmetry, not on suspicion -------------
  {
    // clean.ts receives a clean incoming edge and SelfLoopTarget's file does
    // not, so LonelyTarget (no rows at all, file has none either) must NOT
    // claim a coverage gap, while a symbol in a reached file with no row of its
    // own would.
    const lonely = find("LonelyTarget")
    check("G8 no coverage-gap claim when the symbol and its file are equally unreferenced",
      !lonely?.evidence.some((e) => e.description.includes("COVERAGE GAP INDICATOR")),
      JSON.stringify(lonely?.evidence.map((e) => e.description.slice(0, 40))))
  }
  {
    // Now the positive case, constructed properly. Moving an existing symbol
    // into LonelyTarget's file does NOT create the asymmetry — it relocates a
    // declaration without anything pointing at the file. The asymmetry needs an
    // INCOMING EDGE that lands on a DIFFERENT symbol in the same file, so: point
    // the existing clean caller at a second class in lonely.ts. Then that file
    // is demonstrably reached, and LonelyTarget inside it is not.
    //
    // The first attempt at this block moved `callerOne` into lonely.ts and
    // asserted the indicator would fire; it reported that lonely.ts "has no
    // incoming cross-file reference at all", which was the truth and defeated
    // the test's own premise. An assertion whose setup does not create the
    // condition it asserts is worse than no assertion, because it is either
    // vacuous or permanently red.
    const siblingId = `${projectId}:lonely.ts:ReachedSibling:1`
    raw.prepare(
      "INSERT INTO brain_symbol (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end, visibility) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(siblingId, projectId, fileOf("LonelyTarget"), "ReachedSibling", "ReachedSibling", "class", 1, 1, "public")
    insert.run(mkId("sibling"), projectId, caller, siblingId, "callerOne", "ReachedSibling", USAGE, 0.9, 0,
      JSON.stringify({ evidenceClass: "structural" }), now)

    const after = await detectOrphans(projectId, { minConfidence: 0, maxResults: 1000 })
    const lonely = after.findings.find((f) => f.location.symbol === "LonelyTarget")
    const sibling = after.findings.find((f) => f.location.symbol === "ReachedSibling")
    check("G8b the sibling with the clean edge is cleared (so the fixture really is asymmetric)",
      !sibling, `ReachedSibling was still reported: ${JSON.stringify(sibling?.description)}`)
    check("G8c coverage-gap claim fires when the file is reached and the symbol is not",
      !!lonely?.evidence.some((e) => e.description.includes("COVERAGE GAP INDICATOR")),
      JSON.stringify(lonely?.evidence.map((e) => e.description.slice(0, 50))))
    check("G8d the claim states the file's own numbers",
      !!lonely?.evidence.some((e) => /its file receives \d+ incoming usage edge\(s\) from \d+ distinct source\(s\)/.test(e.description)),
      JSON.stringify(lonely?.evidence.map((e) => e.description.slice(0, 90))))
    check("G8e a limitation repeats it so it survives truncation",
      !!lonely?.limitations.some((l) => /probably the analyzer's, not the code's/.test(l)),
      JSON.stringify(lonely?.limitations))
  }

  // --- G9: the finding schema -------------------------------------------
  {
    const all = report.findings
    check("G9 every finding carries at least one evidence entry", all.every((f) => f.evidence.length > 0))
    check("G9b every finding carries at least one limitation", all.every((f) => f.limitations.length > 0))
    check("G9c confidence is within the published band [0.30, 0.70]",
      all.every((f) => f.confidence >= 0.3 && f.confidence <= 0.7),
      all.map((f) => f.confidence).join(","))
    check("G9d remediation never says a symbol is safe to remove",
      all.every((f) => !/safely removed|safe to remove/i.test(f.remediation)))
  }

  // --- G10: counts -------------------------------------------------------
  {
    const patterns: any = await PatternBrainTools.detectPatterns(projectId, {
      includeOrphaned: true, includeFramework: false, includeAntiPatterns: false, confidenceThreshold: 0, maxResults: 2,
    })
    const byTypeSum = Object.values(patterns.statistics.byType).reduce((a: any, b: any) => a + b, 0) as number
    check("G10 totalFound is the census, not the page",
      patterns.statistics.totalFound === patterns.scan.findingsBeforeDisplayLimit,
      JSON.stringify(patterns.statistics))
    check("G10b the census is at least the page", patterns.statistics.totalFound >= patterns.patterns.length)
    check("G10c byType sums to the census", byTypeSum === patterns.statistics.totalFound,
      `byType=${byTypeSum} totalFound=${patterns.statistics.totalFound}`)
    check("G10d the page honours maxResults", patterns.patterns.length <= 2, String(patterns.patterns.length))
    check("G10e scan.displayed equals the page", patterns.scan.displayed === patterns.patterns.length)
  }

  // --- G11: the same decision through the handler ------------------------
  {
    // The engine being right is not the contract. The CONTRACT is what a caller
    // is shown, so the handler path is asserted too — this is the layer every
    // one of the twelve defects was reported at.
    const { createToolHandlers } = await import("../../src/mcp/tool-handlers")
    const text: string = (await createToolHandlers().bb_patterns(
      { scope: "orphaned", limit: 50 },
      { projectId, projectPath: root } as any,
    )).content[0].text as string
    check("G11 the handler still reports a self-loop target as a candidate", text.includes("SelfLoopTarget"))
    check("G11b the handler still suppresses the clean target", !text.includes("CleanTarget —"))
    check("G11c the handler states the census", /orphaned code \(\d+ found\)/.test(text), text.split("\n")[0])
    check("G11d the handler names the per-rule census breakdown", /\[scan: \d+ orphan candidate\(s\)/.test(text))
    check("G11e the handler reports the suppression accounting", /\[suppressed: /.test(text))
  }
} catch (error) {
  check("M64.P1 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(`\nM64.P1: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)
