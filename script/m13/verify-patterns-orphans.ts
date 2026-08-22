// script/m13/verify-patterns-orphans.ts — M13.37 (P3).
//
// Orphan detection verified across languages (not TS/Python only):
//   1. NEGATIVE: a symbol that IS called by another symbol in the same file
//      is NEVER flagged as orphaned — in every language tested. Each fixture
//      is a three-layer call chain (caller → usedB → usedA) so BOTH usedA and
//      usedB have incoming calls edges: a symbol may be a caller and still be
//      used. (A caller with zero incoming edges IS an orphan — earlier fixture
//      versions asserted the opposite, which was a test bug, not a detector
//      bug.)
//   2. POSITIVE: a genuinely unreferenced symbol IS flagged — beyond
//      TypeScript/Python (Ruby, Go, Java, Python, TypeScript).
//
// Names avoid the entry-point exclusions (main/run/init/start/handler/...)
// so the fixtures exercise the real detector path.
//
// M13.37 also surfaced two product defects that are fixed and covered here:
//   a. The Ruby analyzer missed bare method calls (`foo` with no receiver or
//      parens — parsed as a plain identifier), so Ruby call graphs were empty
//      and every Ruby function looked orphaned.
//   b. The indexer hardcoded is_cross_file=1 on every relationship, so
//      same-file calls were labeled cross-file.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { detectOrphans } from "../../src/intelligence/patterns/orphans"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.37",
  code: "P3",
  tool: "bb_patterns",
  title: "bb_patterns: orphan detection across languages (false-positive negatives)",
  layers: ["unit", "integration"],
  decisions: {
    negative: "a called symbol must never be flagged — this is the false-positive guard, asserted per language",
    positive: "an unreferenced symbol must be flagged — beyond TS/Python (Ruby, Go, Java, Python)",
    entryPoints: "fixture names avoid the built-in entry-point exclusions so the real detector path is exercised",
  },
  limitations: [
    "Orphan detection is static index evidence; dynamic dispatch/reflection remains a documented limitation of the detector itself.",
  ],
})

// (language, extension, usedA, usedB, orphanName, source)
const FIXTURES: Array<[string, string, string, string, string, string]> = [
  ["typescript", "ts",
    "usedAlpha", "usedBeta",
    "orphanTs",
    "export function usedAlpha(): number { return 1 }\n" +
    "export function usedBeta(): number { return usedAlpha() }\n" +
    "export function callerTs(): number { return usedBeta() }\n" +
    "export function orphanTs(): number { return 2 }\n"],
  ["python", "py",
    "used_alpha", "used_beta",
    "orphan_py",
    "def used_alpha():\n    return 1\n" +
    "def used_beta():\n    return used_alpha()\n" +
    "def caller_py():\n    return used_beta()\n" +
    "def orphan_py():\n    return 2\n"],
  ["ruby", "rb",
    "used_alpha", "used_beta",
    "orphan_rb",
    "def used_alpha\n  1\nend\n" +
    "def used_beta\n  used_alpha\nend\n" +
    "def caller_rb\n  used_beta\nend\n" +
    "def local_user_rb\n  local_x = 1\n  local_x\nend\n" +
    "def assignment_user_rb\n  result = used_alpha\n  result\nend\n" +
    "def block_user_rb\n  [1, 2].each do |item|\n    item\n  end\nend\n" +
    "def orphan_rb\n  2\nend\n"],
  ["go", "go",
    "usedAlpha", "usedBeta",
    "orphanGo",
    "package app\n" +
    "func usedAlpha() int { return 1 }\n" +
    "func usedBeta() int { return usedAlpha() }\n" +
    "func callerGo() int { return usedBeta() }\n" +
    "func orphanGo() int { return 2 }\n"],
  ["java", "java",
    "usedAlpha", "usedBeta",
    "orphanJava",
    "public class App {\n" +
    "  static int usedAlpha() { return 1; }\n" +
    "  static int usedBeta() { return usedAlpha(); }\n" +
    "  static int callerJava() { return usedBeta(); }\n" +
    "  static int orphanJava() { return 2; }\n" +
    "}\n"],
]

for (const [language, ext, usedA, usedB, orphan, source] of FIXTURES) {
  const root = mkdtempSync(path.join(tmpdir(), `bb-orphans-${language}-`))
  const projectId = getProjectId(root)
  mkdirSync(path.join(root, "src"), { recursive: true })
  writeFileSync(path.join(root, "src", `app.${ext}`), source)
  try {
    await indexProjectParallel(projectId, root, {})
    const report = await detectOrphans(projectId as any, { minConfidence: 0, maxResults: 100 })
    const inFile = report.findings.filter((f) => f.location.file.endsWith(`app.${ext}`))
    const flagged = new Set(inFile.map((f) => f.location.symbol))

    harness.negative(
      `orphans (${language}): called symbol '${usedA}' is NEVER flagged (false-positive guard)`,
      !flagged.has(usedA) && !flagged.has(usedB),
      `flagged: ${[...flagged].join(",") || "none"}`,
    )
    harness.check(
      `orphans (${language}): unreferenced '${orphan}' IS flagged (positive beyond TS/Py)`,
      flagged.has(orphan),
      `flagged: ${[...flagged].join(",") || "none"}`,
    )
    harness.check(`orphans (${language}): findings carry evidence`, inFile.every((f) => (f.evidence?.length ?? 0) > 0), "evidence-less finding")

    // M13.37 surfaced a data-integrity bug: is_cross_file was hardcoded to 1
    // on EVERY relationship at insert time, so same-file calls were labeled
    // cross-file. The indexer now computes it from the resolved target's file.
    const raw = BrainDatabase.openByPath(BrainDatabase.getDbPath(projectId), { readonly: true }) as any
    const sameFileMarkedCross = raw.prepare(
      `SELECT count(*) AS c FROM brain_relationship r
       JOIN brain_symbol src ON src.id = r.source_symbol_id
       JOIN brain_symbol tgt ON tgt.id = r.target_symbol_id
       WHERE r.project_id = ? AND r.relationship_type = 'calls'
         AND r.is_cross_file = 1 AND src.file_id = tgt.file_id`,
    ).get(projectId) as { c: number }
    harness.check(
      `orphans (${language}): same-file calls edges are NOT labeled cross-file (is_cross_file honesty)`,
      sameFileMarkedCross.c === 0,
      `same-file calls marked cross-file: ${sameFileMarkedCross.c}`,
    )

    // Ruby scope semantics: bare identifiers that are locals (assignment
    // targets, block params) must NOT be emitted as call targets.
    if (language === "ruby") {
      const localTargets = raw.prepare(
        `SELECT count(*) AS c FROM brain_relationship
         WHERE project_id = ? AND relationship_type = 'calls'
           AND target_external IN ('local_x', 'item')`,
      ).get(projectId) as { c: number }
      harness.check(
        "orphans (ruby): locals and block params are NOT emitted as call targets (scope semantics)",
        localTargets.c === 0,
        `local/block-param call targets: ${localTargets.c}`,
      )
      const assignmentCall = raw.prepare(
        `SELECT count(*) AS c FROM brain_relationship r
         JOIN brain_symbol s ON s.id = r.source_symbol_id
         WHERE r.project_id = ? AND r.relationship_type = 'calls'
           AND s.name = 'assignment_user_rb' AND r.target_external = 'used_alpha'`,
      ).get(projectId) as { c: number }
      harness.check(
        "orphans (ruby): assignment RHS bare call is indexed (AST scope distinction)",
        assignmentCall.c > 0,
        `assignment RHS calls: ${assignmentCall.c}`,
      )
    }
  } catch (e) {
    harness.check(`orphans (${language}): session`, false, e instanceof Error ? e.message : String(e))
  } finally {
    try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
  }
}

harness.emit()
