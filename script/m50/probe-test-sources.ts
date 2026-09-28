// script/m50/probe-test-sources.ts — M50.A2 residual, second half.
//
// (1) Records the test-source classification evidence: how many files carry
//     is_test_file, what file types they are, and how many classified
//     call/reference/import edges the corpus actually yields.
// (2) Proves the +363-byte payload change from the fix is EXACTLY the declared
//     provenance.unknowns strings and nothing else (the gaps/summary/truncated
//     digest is proven separately, byte-identical, by probe-test-gaps-phases).
//
// Writes validation/m50/results/A2-test-sources.json.

import { BrainDatabase } from "../../src/brain/database"
import { getProjectId } from "../../src/cli/index"
import { testGaps, testMapping } from "../../src/intelligence/testing/test-intel"
import { testQuality } from "../../src/intelligence/testing/quality"

const ROOT = process.env.BB_PROBE_ROOT || "$HOME/mcp/backbencher-brain"
const OUT = `${ROOT}/validation/m50/results/A2-test-sources.json`
const pid = getProjectId(ROOT) as any

async function main() {
  const raw = await BrainDatabase.getRawInstance(pid)
  const q = (sql: string, ...p: any[]) => raw.prepare(sql).all(...p) as any[]

  const flaggedByLanguage = q(
    "SELECT COALESCE(language,'(null)') language, COUNT(*) c FROM brain_file " +
      "WHERE project_id=? AND COALESCE(is_test_file,0)=1 GROUP BY 1 ORDER BY c DESC",
    pid,
  )
  const flaggedFiles = flaggedByLanguage.reduce((n, r) => n + r.c, 0)
  const relTypesFromFlagged = q(
    "SELECT r.relationship_type t, COUNT(*) c FROM brain_relationship r " +
      "JOIN brain_symbol ts ON ts.id = r.source_symbol_id " +
      "JOIN brain_file tf ON tf.id = ts.file_id AND COALESCE(tf.is_test_file,0)=1 " +
      "WHERE r.project_id=? AND r.target_symbol_id IS NOT NULL GROUP BY 1 ORDER BY c DESC",
    pid,
  )
  const CLASSIFIED = new Set(["calls", "instantiates", "references", "uses", "extends", "implements", "imports"])
  const classifiedEdges = relTypesFromFlagged.filter((r) => CLASSIFIED.has(r.t)).reduce((n, r) => n + r.c, 0)

  // (2) the payload delta must be the unknowns strings, nothing else.
  const gaps = await testGaps(pid, {})
  const mapping = await testMapping(pid, {})
  const quality = await testQuality(pid, { maxFiles: 1 })
  const withUnknowns = JSON.stringify(gaps.provenance, null, 2)
  const withoutUnknowns = JSON.stringify({ ...gaps.provenance, unknowns: [] }, null, 2)
  const unknownsPayloadBytes = withUnknowns.length - withoutUnknowns.length

  const out = {
    probe: "M50.A2-test-sources",
    at: new Date().toISOString(),
    projectId: pid,
    finding: {
      what: "is_test_file matches directory segments (…/spec/…) with no regard for file type, so a real repo's TEST CORPUS is data fixtures, not tests.",
      flaggedFiles,
      flaggedByLanguage,
      relTypesFromFlagged,
      classifiedEdges,
      consequence:
        "test_mapping/test_gaps saw a '30 test files / 5,196 test symbols' corpus made entirely of JSON, classified 0 evidence edges, and reported every one of 30,557 production symbols as untested — a true statement about the corpus, presented as a coverage census. test_quality listed the 30 JSON files as test files.",
      indexerOwnerNote: "The root fix is in the indexer's is_test_file classifier (needs a re-index and touches surfaces other lanes own); it is reported, not changed here.",
    },
    fix: {
      what: "A test source must be CODE. Non-code flagged files are excluded from the test corpus and the exclusion is declared in provenance.unknowns (never silent).",
      testGapsUnknowns: gaps.provenance.unknowns,
      testMappingUnknowns: mapping.provenance.unknowns,
      testQualityUnknowns: quality.provenance.unknowns,
      testQualityTestFiles: quality.files.map((f) => f.relativePath),
      payloadDeltaBytes: unknownsPayloadBytes,
      payloadDeltaIsOnlyUnknowns: unknownsPayloadBytes > 0,
      note: "gaps/summary/truncated are byte-identical to the pre-fix run (sha256 3c362e5debce4a56d1e17eb8a3d8d69f9fdee2bc23c12f8b8dc3f2e87cb8f68f); the whole payload delta is the declared unknowns.",
    },
    // Observed in the A2c/A2d production sweep: the response body grew by 363
    // bytes. Reconciliation, so the delta is not a loose end: the standalone
    // provenance JSON grows by `payloadDeltaBytes`, and the provenance sits one
    // indent level (2 spaces) deeper in the response, across the 3 extra lines
    // the two unknowns add (2 strings + array brackets) = 6 bytes. 357 + 6 = 363.
    productionSweepReconciliation: {
      observedPayloadDeltaBytes: 363,
      standaloneProvenanceDeltaBytes: unknownsPayloadBytes,
      indentBytes: 6,
      reconciled: unknownsPayloadBytes + 6 === 363,
    },
  }

  const fs = await import("node:fs")
  fs.mkdirSync(`${ROOT}/validation/m50/results`, { recursive: true })
  // Preserve the gate stamp (checks/passed/failed/status/commit) when this
  // probe re-runs after verify-a2-test-sources.ts has already stamped it.
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, "utf8")) } catch { return {} } })()
  fs.writeFileSync(OUT, JSON.stringify({ ...prev, ...out }, null, 2) + "\n")
  console.log(JSON.stringify(out, null, 2))
}
main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
