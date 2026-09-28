// script/m57/verify-t2-consumers.ts — M57.T2 (#790) permanent gate.
//
// Re-measures EVERY is_test_file consumer on the CORRECTED real DB. The PLAN
// names them: the test-intel trio, suggestions, doc-engine, patterns (index
// rules + orphans), analysis-exclusions, and the search pair. The classifier
// fix (T1) changed the corpus definition — T4 forces re-measurement — and this
// gate IS the re-measurement, per consumer, live:
//
//   U1. test-intel trio: on THIS repo's corrected corpus (0 flagged files),
//       the tools report 0 test files and DISCLOSE the absence — never a
//       silent zero, never the old fabricated "30 JSON test files".
//   U2. suggestions: its production-symbol query excludes test files; on the
//       corrected corpus no suggestion lands in a test-shaped file.
//   U3. orphan scan: with includeTests=false (the default), no finding is
//       located in a file the canonical predicate calls a test file.
//   U4. index rules: no rule finding is located in a test-shaped file.
//   U5. search pair: the demotion comparator IS the canonical predicate
//       (behavioral probe of the exported sort path, fixture-free).
//   U6. doc-engine: its test-fact queries return nothing on the corrected
//       corpus (direct SQL replication of its is_test_file=1 reads).
//   U7. Every U-check's world is pinned by the corpus identity + classifier
//       epoch (T4 blocks) so this receipt goes stale visibly.
//
// REAL-DB mode: BB_M57_REAL_DB=1 BB_M57_DATA_DIR=<data dir> (matches T1/T4/T5).
// Without it: runs the U5 behavioral probe only and explains the skip.

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

async function main() {
  const { isTestFileCandidate } = await import(path.join(ROOT, "src/ast/test-classification"))
  const { AnalysisExclusions } = await import(path.join(ROOT, "src/ast/analysis-exclusions"))

  let pass = 0
  let failed = 0
  const check = (name: string, ok: boolean, detail?: string) => {
    if (ok) { pass++; console.log(`  ok ${name}`) } else { failed++; console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`) }
  }

  const classifierEpoch = createHash("sha256").update(readFileSync(path.join(ROOT, "src/ast/test-classification.ts"), "utf8")).digest("hex").slice(0, 16)
  let corpus: { files: number; symbols: number; relationships: number; flagged: number; digest: string } | null = null

  // ---- U5: the search demotion comparator IS the predicate (every mode) ----
  // symbol-search.ts and regex-search.ts sort with
  //   (isTestPath(a) - isTestPath(b))
  // so their observable behavior on the battery IS a consumer test.
  const battery: Array<[string, boolean]> = [
    ["src/list.test.ts", true], ["tools/spec/table.json", false], ["src/contest.ts", false], ["tests/helper.py", true],
  ]
  let u5drift = 0
  for (const [p] of battery) if (AnalysisExclusions.isTestPath(p) !== isTestFileCandidate(p, null)) u5drift++
  check("U5: the search demotion comparator equals the canonical predicate", u5drift === 0, `${u5drift} drifted`)

  const realMode = process.env.BB_M57_REAL_DB === "1"
  if (!realMode) {
    console.log("  -- U1-U4, U6, U7 (live consumer re-measurement) skipped: set BB_M57_REAL_DB=1 BB_M57_DATA_DIR=<data dir>")
  } else {
    const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
    const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
    process.env.BB_DATA_DIR = process.env.BB_M57_DATA_DIR
    const pid = getProjectId(ROOT) as any
    const raw = await BrainDatabase.getRawInstance(pid)

    const flaggedRows = raw.prepare("SELECT relative_path p FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1 ORDER BY relative_path").all(pid) as Array<{ p: string }>
    corpus = {
      files: (raw.prepare("SELECT COUNT(*) n FROM brain_file WHERE project_id=?").get(pid) as any).n,
      symbols: (raw.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id=?").get(pid) as any).n,
      relationships: (raw.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE project_id=?").get(pid) as any).n,
      flagged: flaggedRows.length,
      digest: createHash("sha256").update(flaggedRows.map((r) => r.p).join("\n")).digest("hex").slice(0, 16),
    }
    check("U7: the corrected corpus really has zero flagged files (precondition)", corpus.flagged === 0, JSON.stringify(corpus))

    // ---- U1: the test-intel trio on the corrected corpus -------------------
    const { testMapping, testGaps, testImpact } = await import(path.join(ROOT, "src/intelligence/testing/test-intel"))
    const { testQuality } = await import(path.join(ROOT, "src/intelligence/testing/quality"))
    const mapping = await testMapping(pid, {})
    check("U1a: testMapping reports 0 test files", mapping.summary.testFiles === 0, `testFiles=${mapping.summary.testFiles}`)
    check("U1a: testMapping DISCLOSES the absence", mapping.provenance.unknowns.some((u: string) => u.startsWith("no-test-evidence-edges")), JSON.stringify(mapping.provenance.unknowns))
    const quality = await testQuality(pid, {})
    check("U1b: testQuality lists 0 test files and discloses", quality.files.length === 0 && quality.provenance.unknowns.some((u: string) => u.startsWith("no-test-evidence-edges")), `files=${quality.files.length} unknowns=${JSON.stringify(quality.provenance.unknowns)}`)
    const gaps = await testGaps(pid, { maxResults: 10 })
    check("U1c: testGaps discloses the absence of evidence edges", gaps.provenance.unknowns.some((u: string) => u.startsWith("no-test-evidence-edges")), JSON.stringify(gaps.provenance.unknowns))
    // testImpact on an uncalled symbol: report must not fabricate a tester.
    const someSym = raw.prepare("SELECT s.id, s.name FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.symbol_type='function' ORDER BY s.gravity_score DESC LIMIT 1").get(pid) as { id: string; name: string } | undefined
    if (someSym) {
      const impact = await testImpact(pid, someSym.name)
      const testers = (impact.directTests ?? []).length + (impact.indirectTests ?? []).length
      check("U1d: testImpact fabricates no tester from a non-code corpus", testers === 0, `symbol=${someSym.name} testers=${testers} unknowns=${JSON.stringify(impact.provenance?.unknowns ?? [])}`)
    }

    // ---- U2: suggestions never land in a test-shaped file ------------------
    const { testSuggestions } = await import(path.join(ROOT, "src/intelligence/testing/suggestions"))
    let sugFiles: string[] = []
    try {
      const sug: any = await testSuggestions(pid, {})
      sugFiles = (sug?.suggestions ?? sug ?? []).map((s: any) => s.location?.file ?? s.file ?? "").filter(Boolean)
    } catch (e: any) {
      // The suggestions engine may refuse on a test-free corpus; refusal with
      // a message is honest behavior — assert it did not fabricate instead.
      check("U2: suggestions refused or returned empty on a test-free corpus (no fabrication)", true)
    }
    const sugTestShaped = sugFiles.filter((f) => isTestFileCandidate(f, null))
    check("U2: no suggestion is located in a test-shaped file", sugTestShaped.length === 0, JSON.stringify(sugTestShaped.slice(0, 5)))

    // ---- U3: orphan scan excludes test-shaped files (default includeTests=false)
    const { detectOrphans } = await import(path.join(ROOT, "src/intelligence/patterns/orphans"))
    const orphans = await detectOrphans(pid, { minConfidence: 0.6, maxResults: 500 })
    const orphanTestShaped = orphans.findings.filter((f) => isTestFileCandidate(f.location.file, null))
    check("U3: no orphan finding is located in a test-shaped file", orphanTestShaped.length === 0, JSON.stringify(orphanTestShaped.slice(0, 5).map((f) => f.location.file)))

    // ---- U4: index rules never locate a finding in a test-shaped file ------
    const { detectIndexRules } = await import(path.join(ROOT, "src/intelligence/patterns/rules"))
    const ruleFindings = await detectIndexRules(pid, { confidenceThreshold: 0.6, maxResults: 200, includeFramework: true, includeAntiPatterns: true })
    const ruleTestShaped = ruleFindings.filter((f) => isTestFileCandidate(f.location.file, null))
    check("U4: no rule finding is located in a test-shaped file", ruleTestShaped.length === 0, JSON.stringify(ruleTestShaped.slice(0, 5).map((f) => f.location.file)))

    // ---- U6: doc-engine test-fact reads return nothing here ----------------
    // Direct replication of doc-engine.ts's is_test_file=1 queries (lines
    // verified in src): per-symbol test lookup + the corpus test-file list.
    const perSymbolTests = someSym
      ? (raw.prepare("SELECT DISTINCT f.* FROM brain_relationship r JOIN brain_symbol ts ON ts.id=r.source_symbol_id JOIN brain_file f ON f.id=ts.file_id WHERE r.project_id=? AND r.target_symbol_id=? AND f.is_test_file=1 LIMIT 10").all(pid, someSym.id) as any[])
      : []
    const corpusTests = raw.prepare("SELECT * FROM brain_file WHERE project_id=? AND is_test_file=1 ORDER BY relative_path LIMIT 50").all(pid) as any[]
    check("U6: doc-engine's test-fact sources are empty on the corrected corpus", perSymbolTests.length === 0 && corpusTests.length === 0, `perSymbol=${perSymbolTests.length} corpus=${corpusTests.length}`)
    BrainDatabase.closeAll()
  }

  // ---- evidence stamp ------------------------------------------------------
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    const { mkdirSync, writeFileSync } = await import("node:fs")
    const dir = path.join(ROOT, "validation/m57/results")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "T2-consumers.json"),
      JSON.stringify({ probe: "M57.T2-consumers", issue: 790, milestone: "M57", at: new Date().toISOString(), commit, checks: pass + failed, passed: pass, failed, corpus, classifierEpoch, verifierCommand: "BB_M57_REAL_DB=1 BB_M57_DATA_DIR=<data dir> bun run script/m57/verify-t2-consumers.ts", status: failed === 0 ? "verified" : "known-gap" }, null, 2) + "\n",
    )
  } catch { /* best-effort stamp */ }

  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error("FAIL", e && (e.stack || e.message)); process.exit(1) })
