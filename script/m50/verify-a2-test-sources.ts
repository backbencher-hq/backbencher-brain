// script/m50/verify-a2-test-sources.ts — M50.A2 residual (#764) permanent gate.
//
// Two things are gated here, on hermetic fixtures indexed with the REAL indexer:
//
//   T1..T4  TEST SOURCES MUST BE CODE. The indexer's is_test_file flag matches
//           directory segments (…/spec/…) and the `.spec.` infix with no regard
//           for file type, so data fixtures carry the flag. The test-intel
//           family must exclude them from the test corpus AND say so in
//           provenance.unknowns — a small corpus is never silent.
//   G1..G5  BOUNDED GAP WORK. test_gaps used to materialize every production
//           symbol with its links, build a gap object (with its recommendation
//           string) for every one, sort ~30k of them, and slice to 200. The
//           returned page and the summary must now equal an INDEPENDENT
//           derivation computed here from the raw tables.
//   N1..N3  Each comparison is shown falsifiable.
//
// Runs under bun AND node/tsx.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-m50-testsrc-"))
process.env.BB_DATA_DIR = DATA_DIR

// Production functions with distinct complexity/gravity so the gap ranking has
// real content: alphabetical file order and risk order deliberately DISAGREE.
const N_PROD = 12

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))

  let pass = 0
  let failed = 0
  const check = (name: string, ok: boolean, detail?: string) => {
    if (ok) {
      pass++
      console.log(`  ok ${name}`)
    } else {
      failed++
      console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`)
    }
  }
  const negative = (name: string, detected: boolean, detail?: string) => check(`NEGATIVE ${name}`, detected, detail)

  const buildFixture = async (withCodeTest: boolean) => {
    const proj = mkdtempSync(path.join(tmpdir(), withCodeTest ? "bb-m50-tsrcA-" : "bb-m50-tsrcB-"))
    mkdirSync(path.join(proj, "src"), { recursive: true })
    mkdirSync(path.join(proj, "tools", "spec"), { recursive: true })
    const lines: string[] = []
    for (let i = 0; i < N_PROD; i++) {
      // Decreasing complexity so risk order (complexity*2 + gravity*10) is the
      // reverse of file order — a page that ignores the ranking is detectable.
      const complexity = N_PROD - i
      lines.push(`export function prod${String(i).padStart(2, "0")}(v: number): number {`)
      lines.push(`  let t = v`)
      for (let k = 0; k < complexity; k++) lines.push(`  t = t + ${k} * v`)
      lines.push(`  return t`)
      lines.push(`}`)
    }
    writeFileSync(path.join(proj, "src", "prod.ts"), lines.join("\n") + "\n")
    // A data fixture under a /spec/ directory: the indexer flags it as a test
    // file (segment match), but it is JSON — not a test source.
    writeFileSync(path.join(proj, "tools", "spec", "table.json"), JSON.stringify({ cases: [{ a: 1 }] }, null, 2))
    if (withCodeTest) {
      // `list.test.ts` is under NO test directory: it is recognised only by its
      // name, which is exactly the case the flag currently misses on real repos
      // when the file sits outside test/… — here it proves the CODE filter.
      writeFileSync(
        path.join(proj, "src", "list.test.ts"),
        `import { prod00, prod01 } from "./prod"\nexport function checks(): number { return prod00(1) + prod01(2) }\n`,
      )
    }
    writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "m50-testsrc-fixture", version: "1.0.0" }))
    const pid = getProjectId(proj)
    const r = await indexProjectParallel(pid as any, proj, { force: true, skipPostProcessing: true })
    if (r.errors && r.errors.length > 0) throw new Error(`fixture index errors: ${JSON.stringify(r.errors)}`)
    return { proj, pid: pid as string }
  }

  const { testMapping, testGaps } = await import(path.join(ROOT, "src/intelligence/testing/test-intel"))
  const { testQuality } = await import(path.join(ROOT, "src/intelligence/testing/quality"))

  // ══ Fixture A: a real code test source + a flagged JSON fixture ══════════
  const A = await buildFixture(true)
  const raw = await BrainDatabase.getRawInstance(A.pid as any)

  const flagged = raw.prepare("SELECT relative_path p, language l FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1 ORDER BY relative_path").all(A.pid) as Array<{ p: string; l: string }>
  // M57 updated the indexer so non-code files are never flagged — the fixture
  // assertion below therefore accepts BOTH worlds and keys on what actually
  // happened, so this gate stays truthful before AND after the M57 re-index:
  //   pre-M57 world:  table.json flagged -> test-intel must exclude + disclose
  //   post-M57 world: table.json not flagged -> nothing to exclude, no disclosure
  const jsonFlagged = flagged.some((f) => f.p === "tools/spec/table.json")
  check("fixture: the JSON fixture's flag state is consistent with its language", jsonFlagged ? (flagged.find((f) => f.p === "tools/spec/table.json")?.l === "json" ?? false) : true, JSON.stringify(flagged))
  check("fixture: the indexer flags the .test.ts source as a test file", flagged.some((f) => f.p === "src/list.test.ts"), JSON.stringify(flagged))

  // Cross-file `calls` edges are produced by post-processing (which this fixture
  // skips for speed), so the test→production edge is seeded the same way the
  // other M50 gates seed the table the engine reads.
  const testSym = raw.prepare("SELECT s.id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND f.relative_path='src/list.test.ts' LIMIT 1").get(A.pid) as { id: string } | undefined
  const prodSym = raw.prepare("SELECT s.id FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND f.relative_path='src/prod.ts' ORDER BY s.name LIMIT 1").get(A.pid) as { id: string } | undefined
  if (!testSym || !prodSym) throw new Error(`fixture missing symbols: test=${JSON.stringify(testSym)} prod=${JSON.stringify(prodSym)}`)
  raw.prepare(
    "INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_file) VALUES (?,?,?,?,?,?,1)",
  ).run(`gate-rel-${A.pid}-1`, A.pid, testSym.id, prodSym.id, "calls", 0.9)

  const mappingA = await testMapping(A.pid as any, {})
  check("T1: a flagged data fixture is NOT counted as a test file", mappingA.summary.testFiles === flagged.filter((f) => f.l !== "json").length, `testFiles=${mappingA.summary.testFiles} flagged=${flagged.length}`)
  check(
    "T2: the non-code exclusion is declared when it happened, absent when it cannot",
    jsonFlagged
      ? mappingA.provenance.unknowns.some((u) => u.startsWith("non-code-test-files-excluded:"))
      : !mappingA.provenance.unknowns.some((u) => u.startsWith("non-code-test-files-excluded:")),
    JSON.stringify(mappingA.provenance.unknowns),
  )

  const qualityA = await testQuality(A.pid as any, {})
  check("T3: test_quality lists no data fixture as a test file", qualityA.files.every((f) => !f.relativePath.endsWith(".json")), JSON.stringify(qualityA.files.map((f) => f.relativePath)))
  const qualityUnknownA = qualityA.provenance.unknowns.some((u) => u.startsWith("non-code-test-files-excluded:"))
  check(
    "T4: test_quality declares the exclusion when it happened, absent when it cannot",
    jsonFlagged ? qualityUnknownA : !qualityUnknownA,
    JSON.stringify(qualityA.provenance.unknowns),
  )

  // ══ G1..G5: the gap page + summary equal an independent derivation ═══════
  const MAX = 5
  const gapsA = await testGaps(A.pid as any, { maxResults: MAX })

  // Independent derivation straight from the raw tables — no engine code.
  const prodRows = raw.prepare(
    "SELECT s.id, s.name, COALESCE(s.line_start,0) AS line, COALESCE(s.complexity,0) AS complexity, " +
      "COALESCE(s.gravity_score,0) AS gravity, f.relative_path AS file " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND COALESCE(f.is_test_file,0) = 0 AND s.symbol_type IN ('function','method','class','interface','struct','enum')",
  ).all(A.pid) as Array<{ id: string; name: string; line: number; complexity: number; gravity: number; file: string }>
  const direct = new Set(
    (raw.prepare(
      "SELECT DISTINCT r.target_symbol_id id FROM brain_relationship r " +
        "JOIN brain_symbol ts ON ts.id = r.source_symbol_id " +
        "JOIN brain_file tf ON tf.id = ts.file_id AND COALESCE(tf.is_test_file,0)=1 " +
        "WHERE r.project_id = ? AND r.relationship_type IN ('calls','instantiates') AND r.target_symbol_id IS NOT NULL",
    ).all(A.pid) as Array<{ id: string }>).map((r) => r.id),
  )
  const oracle = prodRows
    .filter((s) => !direct.has(s.id))
    .map((s) => ({ id: s.id, file: s.file, risk: Math.round((s.complexity * 2 + s.gravity * 10) * 100) / 100 }))
    .sort((a, b) => b.risk - a.risk || a.file.localeCompare(b.file))

  check("G1: summary.total equals the independent candidate count", gapsA.summary.total === oracle.length, `tool=${gapsA.summary.total} oracle=${oracle.length}`)
  check("G2: byCategory accounts for every candidate", Object.values(gapsA.summary.byCategory).reduce((a, b) => a + b, 0) === oracle.length, JSON.stringify(gapsA.summary.byCategory))
  check("G3: highRisk equals the independent count", gapsA.summary.highRisk === oracle.filter((o) => o.risk >= 10).length, `tool=${gapsA.summary.highRisk}`)
  check("G4: the returned page is the oracle's top-K (bounded AND correctly ranked)", gapsA.gaps.map((g) => g.symbolId).join("|") === oracle.slice(0, MAX).map((o) => o.id).join("|"), `tool=${gapsA.gaps.map((g) => g.name).join(",")}`)
  check("G5: truncation is reported when the page is bounded", gapsA.provenance.truncated === (oracle.length > MAX), `truncated=${gapsA.provenance.truncated}`)

  // Falsifiability: an unbounded (all-rows) page and a rank-permuted page must
  // both be rejected by the SAME comparison G4 makes.
  negative("an unbounded page", !(oracle.map((o) => o.id).join("|") === oracle.slice(0, MAX).map((o) => o.id).join("|")) || oracle.length <= MAX)
  const permuted = [...oracle.slice(0, MAX)]
  permuted.reverse()
  negative("a rank-permuted page", !(permuted.map((o) => o.id).join("|") === oracle.slice(0, MAX).map((o) => o.id).join("|")))

  // Fixture A DOES have code test evidence, so the no-evidence disclosure must
  // NOT appear (it would be a false alarm).
  check("G6: no false 'no test evidence' disclosure when evidence exists", !gapsA.provenance.unknowns.some((u) => u.startsWith("no-test-evidence-edges")), JSON.stringify(gapsA.provenance.unknowns))
  check("G7: the fixture really has code test evidence", direct.size > 0, `direct=${direct.size}`)

  // ══ Fixture B: only a flagged JSON fixture, no code test source ══════════
  const B = await buildFixture(false)
  const rawB = await BrainDatabase.getRawInstance(B.pid as any)
  const jsonFlaggedB = (rawB.prepare("SELECT relative_path p FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1").all(B.pid) as Array<{ p: string }>).some((f) => f.p === "tools/spec/table.json")
  const gapsB = await testGaps(B.pid as any, { maxResults: MAX })
  check("T5: with no code test source, the absence is disclosed", gapsB.provenance.unknowns.some((u) => u.startsWith("no-test-evidence-edges")), JSON.stringify(gapsB.provenance.unknowns))
  // World-aware (see the fixture-A note): pre-M57 the flagged JSON is excluded
  // and must be disclosed; post-M57 it is never flagged, so there is nothing
  // to exclude and the disclosure must be absent.
  check(
    "T6: and the non-code exclusion is disclosed",
    jsonFlaggedB
      ? gapsB.provenance.unknowns.some((u) => u.startsWith("non-code-test-files-excluded:"))
      : !gapsB.provenance.unknowns.some((u) => u.startsWith("non-code-test-files-excluded:")),
    JSON.stringify(gapsB.provenance.unknowns),
  )
  const mappingB = await testMapping(B.pid as any, {})
  check("T7: the no-code-test fixture reports zero test files", mappingB.summary.testFiles === 0, `testFiles=${mappingB.summary.testFiles}`)
  const qualityB = await testQuality(B.pid as any, {})
  check("T8: the no-code-test fixture lists zero test files", qualityB.files.length === 0, JSON.stringify(qualityB.files.map((f) => f.relativePath)))

  // Falsifiability of the disclosure itself: it must be driven by the corpus,
  // not stamped unconditionally.
  negative("a disclosure stamped without a cause", gapsB.provenance.unknowns.length > 0 && gapsA.provenance.unknowns.every((u) => !u.startsWith("no-test-evidence-edges")))

  // ══ evidence stamp ══════════════════════════════════════════════════════
  try {
    const { execFileSync } = await import("node:child_process")
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    const dir = path.join(ROOT, "validation/m50/results")
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "A2-test-sources.json")
    const prev = (() => { try { return JSON.parse(readFileSync(file, "utf8")) } catch { return {} } })()
    writeFileSync(
      file,
      JSON.stringify(
        {
          ...prev,
          probe: "M50.A2-test-sources",
          issue: 764,
          milestone: "M50",
          at: new Date().toISOString(),
          commit,
          checks: pass + failed,
          passed: pass,
          failed,
          fixture: { productionFunctions: N_PROD, fixtureA: "code test source + flagged JSON fixture", fixtureB: "flagged JSON fixture only" },
          method:
            "Hermetic fixtures indexed with the real indexer; the gap page and summary are compared against an independent " +
            "SQL derivation (own candidate query, own comparator), and the test-corpus disclosure is exercised with and " +
            "without a code test source so it cannot be stamped unconditionally.",
          verifierCommand: "npx tsx script/m50/verify-a2-test-sources.ts",
          status: failed === 0 ? "verified" : "known-gap",
        },
        null,
        2,
      ) + "\n",
    )
  } catch { /* evidence stamp is best-effort; the exit code is the verdict */ }

  BrainDatabase.closeAll()
  rmSync(DATA_DIR, { recursive: true, force: true })
  rmSync(A.proj, { recursive: true, force: true })
  rmSync(B.proj, { recursive: true, force: true })
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error("FAIL", e && (e.stack || e.message))
  process.exit(1)
})
