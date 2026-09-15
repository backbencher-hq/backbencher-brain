// script/m59/verify-rel-multiplicity.ts — M59.P3 (#822)
//
// THE CLAIM UNDER TEST: if one function invokes the same callee 4 times on 4
// different lines, the index must be able to say so — 4 call sites, at those
// lines. The tool's whole value ("where do I have to change this?") depends on
// it, and an agent asking bb_graph "who calls target" must not be told "one".
//
// METHOD — fixture where the true answer is known by construction:
//   Multi.java: `target()` (declaration) + `caller()` invoking it exactly 4
//   times on 4 distinct lines. Expected call sites = 4, asserted against the
//   fixture SOURCE TEXT (occurrences of `target(` minus the declaration), never
//   against the analyzer's or the store's own opinion.
//   Then the REAL pipeline (indexProjectParallel: worker pool, real java
//   analyzer, real store) into a throwaway BB_DATA_DIR, and the DB is asked.
//
// MEASURED CONTEXT (script/m59/probe-multiplicity.ts, run 2026-09-16):
//   java/kotlin/scala  — analyzer emits 4 edges, 4 distinct lines  (per-site)
//   typescript/js      — analyzer emits 4 edges, 0 lines           (no line yet)
//   python/go          — analyzer emits 1 edge                     (collapsed)
//   The STORE then collapses all of it to one row per
//   (source, target, type): relId has no line component
//   (src/ast/parallel-indexer.ts). That store collapse is what this gate proves.
//
// SCOPE, DECLARED: this gate asserts the per-site contract for a LINE-EMITTING
// language (java). For the languages that still emit no line, the site rows
// cannot be distinguished, and that is tracked by #825 / the analyzer lane —
// this gate reports their state and never counts it as a pass.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const DATA = mkdtempSync(path.join(tmpdir(), "m59-mult-data-"))
process.env.BB_DATA_DIR = DATA

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

const JAVA_SRC = `public class Multi {
  static int target() { return 1; }
  static int caller() {
    int a = target();
    int b = target();
    int c = target();
    int d = target();
    return a + b + c + d;
  }
}
`

const TS_SRC = `export function target(): number { return 1 }
export function caller(): number {
  const a = target()
  const b = target()
  const c = target()
  const d = target()
  return a + b + c + d
}
`

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail: string) {
  checks++
  if (ok) console.log(`  PASS  ${name}  ${detail}`)
  else {
    failures++
    console.log(`  FAIL  ${name}  ${detail}`)
  }
}

/**
 * The single predicate this gate turns on, factored out so it can be aimed at a
 * deliberately-collapsed world (the self-fail proof) as well as at the real DB.
 * Returns the audit of "how many distinct call sites did the index keep?".
 */
function auditSites(rows: Array<{ line: number | null }>, expected: number) {
  const known = rows.map((r) => r.line).filter((l): l is number => typeof l === "number" && l > 0)
  return {
    rows: rows.length,
    knownLines: known.length,
    distinctLines: new Set(known).size,
    perSite: rows.length === expected && new Set(known).size === expected,
  }
}

async function main() {
  const project = mkdtempSync(path.join(tmpdir(), "m59-mult-proj-"))
  mkdirSync(path.join(project, "src"), { recursive: true })
  writeFileSync(path.join(project, "src", "Multi.java"), JAVA_SRC)
  writeFileSync(path.join(project, "src", "multi.ts"), TS_SRC)

  const javaExpected = (JAVA_SRC.match(/target\(/g) ?? []).length - 1 // minus the declaration
  const tsExpected = (TS_SRC.match(/target\(/g) ?? []).length - 1
  console.log(`fixture: ${project}`)
  console.log(`expected call sites — java: ${javaExpected}  typescript: ${tsExpected} (from source text)\n`)

  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { graphTraversal } = await import(path.join(ROOT, "src/intelligence/graph/graph-engine.ts"))

  const pid = getProjectId(project) as any
  const stats = await indexProjectParallel(pid, project, {})
  console.log(`indexed: files=${stats.totalFiles} symbols=${stats.symbolsExtracted} relationships=${stats.relationshipsFound} errors=${stats.errorFiles}`)

  const raw = await BrainDatabase.getRawInstance(pid)

  const q = (lang: string) =>
    raw
      .prepare(
        `SELECT r.id, r.relationship_type rt, r.line_number AS line, r.target_external te, ts.name tname
         FROM brain_relationship r
         JOIN brain_symbol s ON s.id = r.source_symbol_id
         JOIN brain_file f ON f.id = s.file_id
         LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         WHERE f.language = ?
           AND r.relationship_type IN ('calls','call','uses','references')
           AND (s.name LIKE '%caller%')
           AND (COALESCE(ts.name,'') LIKE '%target%' OR COALESCE(r.target_external,'') LIKE '%target%')`,
      )
      .all(lang) as Array<{ id: string; rt: string; line: number | null; te: string | null; tname: string | null }>

  const javaRows = q("java")
  const tsRows = q("typescript")

  console.log("\n=== java (line-emitting language): the per-site contract ===")
  for (const r of javaRows) console.log(`  ${r.rt.padEnd(10)} line=${JSON.stringify(r.line)} target=${r.tname ?? r.te} id=${r.id}`)
  const javaAudit = auditSites(javaRows, javaExpected)
  check(
    "java-per-call-site",
    javaAudit.perSite,
    `${javaRows.length} rows / ${javaAudit.distinctLines} distinct lines for ${javaExpected} true call sites (${JSON.stringify(javaAudit)})`,
  )

  // ── THE POINT OF THE WHOLE CHANGE: the TOOL must now answer with all four
  // sites. A store that keeps 4 rows the tool cannot surface would be worthless.
  console.log("\n=== through the real tool path (graphTraversal — bb_graph's engine) ===")
  try {
    const t = await graphTraversal(pid, "target", {})
    const sites = t.callers.map((e: any) => e.callSite?.line ?? null)
    for (const e of t.callers) {
      console.log(`  caller=${String(e.from).split(":").slice(-2).join(":")} line=${JSON.stringify(e.callSite?.line)} file=${e.callSite?.file}`)
    }
    const knownSites = sites.filter((l: number | null) => typeof l === "number" && l > 0)
    check(
      "tool-reports-every-call-site",
      t.callers.length >= javaExpected && new Set(knownSites).size === javaExpected,
      `${t.callers.length} caller edges, ${new Set(knownSites).size} distinct lines (expected ${javaExpected} sites) — this is the answer an agent gets`,
    )
  } catch (e: any) {
    check("tool-reports-every-call-site", false, `graphTraversal threw: ${e?.message}`)
  }

  console.log("\n=== typescript (no line yet — reported, NOT counted as a pass) ===")
  for (const r of tsRows) console.log(`  ${r.rt.padEnd(10)} line=${JSON.stringify(r.line)} target=${r.tname ?? r.te}`)
  const tsAudit = auditSites(tsRows, tsExpected)
  console.log(`  scope note: ${JSON.stringify(tsAudit)} — distinct sites unprovable without a line (#825)`)

  // ── SELF-FAIL PROOF: the same predicate, aimed at a collapsed world.
  // If this ever passes, the gate is decoration.
  const collapsed = javaRows.slice(0, 1)
  const collapsedAudit = auditSites(collapsed, javaExpected)
  check(
    "predicate-can-fail",
    !collapsedAudit.perSite,
    `one-row world judged NOT per-site (${JSON.stringify(collapsedAudit)}) — the check reacts to the defect`,
  )
  // ...and it must not fire on a correct world fabricated from the fixture.
  const synthetic = [39, 48, 62, 71].map((line) => ({ line }))
  check(
    "predicate-accepts-correct",
    auditSites(synthetic, 4).perSite,
    "4 rows on 4 distinct lines accepted",
  )

  const outDir = path.join(ROOT, "validation/m59/results")
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    path.join(outDir, "rel-multiplicity.json"),
    JSON.stringify(
      {
        probe: "M59.P3",
        issue: "#822",
        at: new Date().toISOString(),
        command: "npx tsx script/m59/verify-rel-multiplicity.ts",
        question: "4 call sites on 4 lines — does the INDEX keep 4?",
        trueCallSites: { java: javaExpected, typescript: tsExpected },
        java: { rows: javaRows, audit: javaAudit },
        typescript: { rows: tsRows, audit: tsAudit, scope: "no line emitted by the analyzer yet (#825)" },
        predicateCanFail: !collapsedAudit.perSite,
        status: failures === 0 ? "pass" : "fail",
        failures,
        checks,
      },
      null,
      2,
    ) + "\n",
  )
  console.log(`\nevidence: ${path.join(outDir, "rel-multiplicity.json")}`)

  rmSync(project, { recursive: true, force: true })
  if (failures > 0) {
    console.error(`\nFAILED (${failures}/${checks}) — the index cannot report multiple call sites for one callee.`)
    process.exit(1)
  }
  console.log(`\nAll checks passed (${checks}).`)
}

main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
