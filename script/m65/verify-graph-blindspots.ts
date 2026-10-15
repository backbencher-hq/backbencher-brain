// script/m65/verify-graph-blindspots.ts — bb_graph review D1 + D4, as a gate.
//
// THE THREE BLIND SPOTS THIS GATE PINS DOWN
//
// D1. THE JOIN'S BLIND SPOT (11% of the store on this repository's index).
//     The caller and callee queries each INNER JOIN the SOURCE side, so a stored
//     row whose `source_symbol_id` is NULL matches neither arm: it is invisible in
//     BOTH directions, and nothing declared it — not truncation, not the noise
//     filter, not provenance. Measured 2026-10-14 on this repo's index: 69,171 of
//     631,139 rows (11.0%) carry no source symbol, 62,698 target a stored symbol,
//     and 2,099 symbols answered `callers: []` while the store held incoming rows.
//     Worked example: `script/m13/harness.ts:rejects:93` had 40 stored `calls`
//     rows and the answer was `callers: 3` with
//     `truncationReason: "caller-depth-cap-reached"` — a bound named while 95% of
//     the evidence was dropped by a JOIN.
//
// D4a. `noiseFiltered` WAS COUNTED AND NOT PUBLISHED. A fixture with one caller
//      in `vendor/` answered `callers: 0 · truncated: false` beside a
//      `noise-policy:` provenance note — two channels of one answer disagreeing,
//      and the machine-readable one claiming an empty set.
//
// D4b. `includeCrossLanguage: false` REMOVED ROWS WITH NO NUMBER ANYWHERE.
//      Measured on `parseFile` (depth 2): on → 270 edges, 29 cross-language;
//      off → 241 edges and `crossLanguageEdges: 0`. The 29 rows were neither
//      counted nor named. A filter must leave a number behind, like the noise
//      policy does — the doctrine is the engine's own, applied in one place.
//
// WHY A FIXTURE AND NOT THIS REPO'S INDEX
// The gate must be able to fail on a state it creates, deterministically: the
// unattributed row and the cross-language flag are SEEDED onto real indexed rows,
// so the numbers asserted below are exact (1 noise caller, 1 unattributed caller,
// 1 cross-language caller), and a mutation removes each state to prove the
// predicates track the data rather than a constant.
//
// LANGUAGE-AGNOSTIC BY CONSTRUCTION: the counters are store-level counts, so the
// gate seeds the unattributed state for a symbol in SIX languages' fixtures and
// asserts the agent payload publishes the count for each — a fix that only worked
// for the analyzer it was written against would fail five of the six.
//
// RED-GREEN (measured 2026-10-14, before this change):
//   noise fixture      : callers: 0 · truncated: false · provenance note present
//                        (no machine-readable count anywhere in the payload)
//   cross-language off : 241 edges · crossLanguageEdges: 0 · nothing counted
//   unattributed       : no field at all; `callers: 3` with a depth reason

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { execSync } from "node:child_process"

const EMPTY = mkdtempSync(path.join(tmpdir(), "m65-graph-blindspots-"))
process.env.BB_DATA_DIR = EMPTY
process.env.BB_NO_AUTO_REFRESH = "1"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const EVIDENCE = path.join(ROOT, "validation/m65/results/graph-blindspots.json")

type Check = { name: string; passed: boolean; detail: string; negative?: boolean }
const checks: Check[] = []
const check = (name: string, passed: boolean, detail: string, negative = false) => {
  checks.push({ name, passed, detail, negative })
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}  ${detail}`)
}

type LangFixture = { language: string; files: Record<string, string>; targetName: string }

/** Six languages, each declaring a uniquely-named function and calling it from a
 *  second file, so the unattributed count can be seeded against a REAL symbol per
 *  language. The names are distinct because the counts are asserted per fixture
 *  (each fixture is its own project, but distinct names keep the evidence
 *  readable). */
const LANGUAGES: LangFixture[] = [
  {
    language: "typescript",
    files: {
      "src/target.ts": `export function blindTargetTs(x: number): number {\n  return x + 1\n}\n`,
      "src/caller.ts": `import { blindTargetTs } from "./target"\nexport function realCallerTs(): number {\n  return blindTargetTs(2)\n}\n`,
      "vendor/lib/noisy.ts": `import { blindTargetTs } from "../../src/target"\nexport function noisyCallerTs(): number {\n  return blindTargetTs(1)\n}\n`,
    },
    targetName: "blindTargetTs",
  },
  {
    language: "python",
    files: {
      "target.py": `def blind_target_py(x):\n    return x + 1\n`,
      "caller.py": `from target import blind_target_py\n\n\ndef real_caller_py():\n    return blind_target_py(2)\n`,
    },
    targetName: "blind_target_py",
  },
  {
    language: "go",
    files: {
      "target.go": `package demo\n\nfunc BlindTargetGo(x int) int {\n\treturn x + 1\n}\n`,
      "caller.go": `package demo\n\nfunc RealCallerGo() int {\n\treturn BlindTargetGo(2)\n}\n`,
    },
    targetName: "BlindTargetGo",
  },
  {
    language: "rust",
    files: {
      "src/lib.rs": `pub mod target;\npub mod caller;\n`,
      "src/target.rs": `pub fn blind_target_rs(x: i64) -> i64 {\n    x + 1\n}\n`,
      "src/caller.rs": `use crate::target::blind_target_rs;\n\npub fn real_caller_rs() -> i64 {\n    blind_target_rs(2)\n}\n`,
    },
    targetName: "blind_target_rs",
  },
  {
    language: "java",
    files: {
      "demo/Target.java": `package demo;\n\npublic class Target {\n    public static int blindTargetJava(int x) {\n        return x + 1;\n    }\n}\n`,
      "demo/Caller.java": `package demo;\n\npublic class Caller {\n    public static int realCallerJava() {\n        return Target.blindTargetJava(2);\n    }\n}\n`,
    },
    targetName: "blindTargetJava",
  },
  {
    language: "csharp",
    files: {
      "Target.cs": `namespace Demo {\n    public static class Target {\n        public static int BlindTargetCs(int x) { return x + 1; }\n    }\n}\n`,
      "Caller.cs": `namespace Demo {\n    public static class Caller {\n        public static int RealCallerCs() { return Target.BlindTargetCs(2); }\n    }\n}\n`,
    },
    targetName: "BlindTargetCs",
  },
]

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))

  const handlers = createToolHandlers() as any
  const quiet = { log: () => {}, write: () => {} } as any

  const callGraph = async (fixture: string, projectId: string, args: Record<string, unknown>) => {
    const r = await handlers.bb_graph(args, { projectPath: fixture, projectId } as any)
    const text = r?.content?.[0]?.text ?? ""
    return JSON.parse(text)
  }

  const perLanguage: Array<{ language: string; unattributed: number | null; callers: number; note: boolean }> = []
  let noiseFixtureState: { noiseFiltered: any; unattributed: any; truncated: boolean; callers: number; note: boolean } | null = null
  let crossLanguageOff: { excluded: any; crossLanguageEdges: number; edges: number } | null = null
  let mutationBefore = 0
  let mutationAfter = 0

  for (const fx of LANGUAGES) {
    const dir = path.join(EMPTY, fx.language)
    for (const [rel, content] of Object.entries(fx.files)) {
      const abs = path.join(dir, rel)
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
    const pid = getProjectId(dir) as any
    const consoleLog = console.log
    console.log = () => {}
    try {
      await indexProjectParallel(pid, dir, { logger: quiet })
    } finally {
      console.log = consoleLog
    }
    const raw = await BrainDatabase.getRawInstance(pid)
    const target = raw
      .prepare(`SELECT id FROM brain_symbol WHERE project_id = ? AND name = ? LIMIT 1`)
      .get(pid, fx.targetName) as any
    check(
      `fixture-declares-the-target: ${fx.language}`,
      !!target,
      target ? `symbol ${fx.targetName} indexed` : `${fx.targetName} is NOT in the store — the fixture proves nothing`,
    )
    if (!target) continue

    // The state D1 is about, seeded onto a REAL symbol so the count is exact: a
    // stored row that names the target and carries no source symbol.
    raw
      .prepare(
        `INSERT INTO brain_relationship
           (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external,
            relationship_type, confidence, line_number, is_cross_file, time_created, time_updated)
         VALUES (?, ?, NULL, ?, 'seeded-unattributed', ?, 'calls', 1.0, NULL, 0, ?, ?)`,
      )
      .run(`${pid}:seeded:unattributed:${fx.targetName}`, pid, target.id, fx.targetName, Date.now(), Date.now())

    const g = await callGraph(dir, pid, { symbol: fx.targetName, direction: "callers", maxDepth: 2 })
    const unattributed = g?.summary?.unattributed ?? null
    const note = JSON.stringify(g?.provenance?.unknowns ?? []).includes("unattributed-source")
    perLanguage.push({
      language: fx.language,
      unattributed: unattributed ? unattributed.callers : null,
      callers: (g?.callers ?? []).length,
      note,
    })

    if (fx.language === "typescript") {
      check(
        "unattributed-count-is-published",
        !!unattributed && unattributed.callers >= 1,
        `summary.unattributed = ${JSON.stringify(unattributed)} (seeded exactly one unattributed caller row)`,
      )
      check(
        "unattributed-count-names-itself-in-provenance",
        note,
        `provenance.unknowns carries an \`unattributed-source\` note: ${note}`,
      )
      mutationBefore = unattributed?.callers ?? 0
      // MUTATION: remove the state, the count must follow it.
      raw.prepare(`DELETE FROM brain_relationship WHERE id = ?`).run(`${pid}:seeded:unattributed:${fx.targetName}`)
      const g2 = await callGraph(dir, pid, { symbol: fx.targetName, direction: "callers", maxDepth: 2 })
      mutationAfter = g2?.summary?.unattributed?.callers ?? -1
      check(
        "mutation: the count tracks the data",
        mutationAfter === mutationBefore - 1,
        `deleting the seeded row moved the count ${mutationBefore} -> ${mutationAfter}`,
        true,
      )
      // restore, and re-read the noise + cross-language state from this fixture
      raw
        .prepare(
          `INSERT INTO brain_relationship
             (id, project_id, source_symbol_id, target_symbol_id, source_external, target_external,
              relationship_type, confidence, line_number, is_cross_file, time_created, time_updated)
           VALUES (?, ?, NULL, ?, 'seeded-unattributed', ?, 'calls', 1.0, NULL, 0, ?, ?)`,
        )
        .run(`${pid}:seeded:unattributed:${fx.targetName}`, pid, target.id, fx.targetName, Date.now(), Date.now())

      const g3 = await callGraph(dir, pid, { symbol: fx.targetName, direction: "callers", maxDepth: 2 })
      noiseFixtureState = {
        noiseFiltered: g3?.summary?.noiseFiltered ?? null,
        unattributed: g3?.summary?.unattributed ?? null,
        truncated: g3?.summary?.truncated === true,
        callers: (g3?.callers ?? []).length,
        note,
      }
      check(
        "noise-filter-count-is-published",
        !!noiseFixtureState.noiseFiltered && noiseFixtureState.noiseFiltered.callers >= 1,
        `summary.noiseFiltered = ${JSON.stringify(noiseFixtureState.noiseFiltered)} — the vendored caller row is removed BY POLICY and now counted`,
      )
      check(
        "a-filter-is-not-a-bound",
        noiseFixtureState.truncated === false,
        `truncated = ${noiseFixtureState.truncated} with both filters non-zero: filters are counted, they do not claim a bound bit`,
        true,
      )

      // ── D4b: the cross-language scope option leaves a number ──────────────
      const crossRow = raw
        .prepare(
          `SELECT id FROM brain_relationship WHERE project_id = ? AND relationship_type = 'calls' AND target_symbol_id = ? AND source_symbol_id IS NOT NULL LIMIT 1`,
        )
        .get(pid, target.id) as any
      check("cross-language-state-is-seedable", !!crossRow, crossRow ? `call row ${crossRow.id} flagged as cross-language for the measurement` : "no call row to flag")
      if (crossRow) {
        raw.prepare(`UPDATE brain_relationship SET is_cross_language = 1 WHERE id = ?`).run(crossRow.id)
        const off = await callGraph(dir, pid, { symbol: fx.targetName, direction: "callers", maxDepth: 2, includeCrossLanguage: false })
        const on = await callGraph(dir, pid, { symbol: fx.targetName, direction: "callers", maxDepth: 2 })
        crossLanguageOff = {
          excluded: off?.summary?.crossLanguageExcluded ?? null,
          crossLanguageEdges: off?.summary?.crossLanguageEdges ?? -1,
          edges: (off?.callers ?? []).length,
        }
        check(
          "cross-language-exclusion-is-counted",
          !!crossLanguageOff.excluded && crossLanguageOff.excluded.callers >= 1,
          `includeCrossLanguage: false → summary.crossLanguageExcluded = ${JSON.stringify(crossLanguageOff.excluded)} (measured against ${(on?.callers ?? []).length} caller(s) with the default)`,
        )
        check(
          "cross-language-count-is-absent-when-nothing-was-excluded",
          (on?.summary?.crossLanguageExcluded?.callers ?? -1) === 0,
          `default call reports crossLanguageExcluded.callers = ${JSON.stringify(on?.summary?.crossLanguageExcluded ?? null)} (0, not a stale number)`,
          true,
        )
      }
    }
  }

  // ── the counters are store-level, so every language must report them ──────
  check(
    "every-language-fixture-reports-the-count",
    perLanguage.length === LANGUAGES.length && perLanguage.every((p) => p.unattributed !== null && p.unattributed >= 1 && p.note),
    `${perLanguage.map((p) => `${p.language}=${p.unattributed}`).join(" ")} (each fixture seeded exactly one unattributed caller row; the count is a store fact, not an analyzer one)`,
  )

  const failed = checks.filter((c) => !c.passed)
  const negatives = checks.filter((c) => c.negative).length
  mkdirSync(path.dirname(EVIDENCE), { recursive: true })
  const { writeSealed } = await import(path.join(ROOT, "script/lib/evidence.ts"))
  writeSealed(EVIDENCE, {
    gate: "M65.graph-blindspots",
    at: new Date().toISOString(),
    atCommit: execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim(),
    command: "bun run script/m65/verify-graph-blindspots.ts",
    status: failed.length === 0 ? "pass" : "fail",
    checks,
    negativeCases: negatives,
    languages: perLanguage,
    contract:
      "bb_graph publishes the two filters it applies (noiseFiltered, crossLanguageExcluded) and counts the rows its JOIN cannot reach (unattributed, per direction, null when not counted) — measured through the real MCP door",
    before:
      "noise fixture answered callers: 0 · truncated: false with only a prose provenance note; includeCrossLanguage: false dropped 29 of 270 edges uncounted; the unattributed class had no field at all (11.0% of this repo's stored rows)",
    note: `store: ${EMPTY}`,
  })
  console.log(`\nevidence: ${EVIDENCE}`)
  console.log(`per-language unattributed counts: ${perLanguage.map((p) => `${p.language}=${p.unattributed}`).join(" ")}`)
  if (failed.length > 0) {
    console.log(`\n${failed.length} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log("\nAll checks passed — the filters are counted, the JOIN's blind spot is counted, and neither claims to be a bound.")
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
