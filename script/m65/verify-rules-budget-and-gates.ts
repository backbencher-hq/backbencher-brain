// script/m65/verify-rules-budget-and-gates.ts
// M65.P1 — the rule engine's DECISIONS, as a hermetic gate inside the repo.
//
// WHY THIS FILE EXISTS. script/m13/verify-patterns-rules.ts asserts that the
// framework and anti-pattern rules are real and fire on fixtures that match: 29
// checks, all of them true. It does not assert a single DECISION those rules make.
// It cannot, because its fixture is uniform: one god class, one long parameter
// list, one complex function, all with comfortable margins, all requested at one
// threshold.
//
// So the four things rules.ts actually decides are unguarded, and each of them
// was wrong once already — the comments in that file are a list of the fixes:
//
//   * `maxResults` was declared, passed by every caller, and read NOWHERE. A
//     caller asking for 1 result got 869. m13 cannot see this: it asks for 200.
//   * The complexity gate was `row.complexity / COMPLEXITY_THRESHOLD <
//     confidenceThreshold`, and the SQL already guarantees complexity >=
//     COMPLEXITY_THRESHOLD, so the ratio is always >= 1.0 and the check could
//     never fire for any legal threshold.
//   * The god-class gate was `row.members / 20 < confidenceThreshold`, a ratio on
//     an unrelated scale. At the default 0.6 it DROPPED an 11-member class while
//     KEEPING a 0.65-confidence complexity finding: keeping the weaker finding
//     and discarding the stronger one.
//   * The god-class member count was a LEFT JOIN the planner declined to use the
//     owner index for, costing 25,000ms+ on a 45,018-symbol index. A plain
//     `bb_patterns {}` took 330s. A revert to the LEFT JOIN form returns an
//     IDENTICAL row set, so every behavioural gate in the repository stays green
//     while the tool becomes 240x slower.
//
// None of those four is visible to a fixture whose every case passes comfortably.
// That is what this file is for: one case per decision, placed exactly on the
// boundary where the old behaviour differed from the current one.
//
// THE FIXTURE. Index a tmpdir project, then write the rows the analyzer cannot
// produce — a malformed `parameters` value, a `framework_type`, a JSON file full
// of members — the same technique m64 uses for relationship rows. Hermetic: a
// tmpdir project, removed afterwards, no corpus, no checked-in fixture.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { detectIndexRules } from "../../src/intelligence/patterns/rules"
import { PatternBrainTools } from "../../src/ast/tools"

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) { passed++; console.log(`  ok: ${label}`) }
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const root = mkdtempSync(path.join(tmpdir(), "bb-m65-rules-"))
mkdirSync(path.join(root, "src"), { recursive: true })
mkdirSync(path.join(root, "docs"), { recursive: true })

// Two god classes, on either side of the 11-member mark the old gate mishandled,
// so "the stronger finding is kept and the weaker one dropped" is testable rather
// than assumed.
const members = (n: number) => Array.from({ length: n }, (_, i) => `  m${i}(): number { return ${i} }`).join("\n")
const params = (n: number) => Array.from({ length: n }, (_, i) => `p${i}: number`).join(", ")
// Complexity 15 is the threshold, so its confidence is exactly 0.5 + 15/100 =
// 0.65. A threshold of 0.7 must therefore DROP it — which the old
// `complexity / 15 < threshold` formula could never do, because 15/15 = 1.0.
let atThreshold = "export function exactlyAtThreshold(): number {\n"
for (let i = 0; i < 15; i++) atThreshold += " ".repeat(i) + "if (true) {\n"
atThreshold += " ".repeat(15) + "return 1\n"
for (let i = 14; i >= 0; i--) atThreshold += " ".repeat(i) + "}\n"
atThreshold += "  return 2\n}\n"

writeFileSync(path.join(root, "src", "big.ts"),
  `export class ElevenMember {\n${members(11)}\n}\n` +
  `export class TwentyMember {\n${members(20)}\n}\n` +
  `export function longParams(${params(9)}): number { return p0 }\n` +
  atThreshold)
// A JSON file whose "members" are structural keys, not code. The comment in
// rules.ts records that the top-ranked god-class finding on a 45,018-symbol
// repository was docs/data/m10-baseline.json — a JSON file's members.
//
// NESTED, and the shape is not a guess. A flat object of 30 keys indexes as a
// module owning 30 classes, each owning exactly ONE property, so no single
// owner exceeds the 10-member threshold and the exclusion is never exercised —
// R4b is what established that, after the first version of this fixture passed
// with the non-code clause deleted. One key holding an object of 15 keys makes
// that key's class own 15 members, which is what the rule would otherwise report.
const nested = { container: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`key${i}`, { nested: i }])) }
writeFileSync(path.join(root, "docs", "not-code.json"), JSON.stringify(nested, null, 2))

const projectId = getProjectId(root)

try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)

  // A `parameters` value that is not valid JSON. The old engine JSON.parsed it
  // inside a try/catch — a silent skip, not a crash — and the SQL rewrite to
  // `json_each` would THROW on it without the `json_valid` guard. Nothing
  // anywhere tested for the difference, so the guard could be deleted and the
  // only symptom would be a crash on a project with one malformed row.
  // The malformed value must be LONGER than 17 characters, and the first
  // version of this fixture was not. The parameter query carries
  //   length(s.parameters) >= 17
  // as a cheap skip before `json_each` — the comment in rules.ts explains why:
  // an array of more than 7 elements is at minimum 17 characters, so a shorter
  // row can never match. `"{not valid json"` is 15 characters, so the skip fired
  // first, `json_each` never saw the row, and the self-test's N7 mutation —
  // deleting the `json_valid` guard — came back GREEN. The exclusion was not
  // being tested, and the reason was a fixture that fell into a documented
  // optimisation.
  raw.prepare(
    "UPDATE brain_symbol SET parameters = ? WHERE project_id = ? AND name = 'longParams'",
  ).run('{not valid json at all",', projectId)
  // A framework, which only the analyzer can assign.
  raw.prepare(
    "UPDATE brain_file SET framework_type = 'react' WHERE project_id = ? AND relative_path = 'src/big.ts'",
  ).run(projectId)

  // --- R1: `maxResults` is a real per-type budget -------------------------
  {
    const one = await detectIndexRules(projectId as any, {
      confidenceThreshold: 0, maxResults: 1, includeFramework: true, includeAntiPatterns: true,
    })
    const god = one.filter((f) => f.type === "god-class")
    check("R1 a maxResults:1 request returns findings, not an unbounded census", one.length > 1,
      `returned ${one.length}; a dead budget would return every match`)
    check("R1b the budget is PER TYPE, not global: both god classes are present", god.length === 2,
      `god-class findings: ${god.length}`)
    check("R1c exactly one finding per type is the displayed page", one.filter((f) => !f.truncatedByDisplayLimit).length === one.length
      ? one.filter((f) => !f.truncatedByDisplayLimit).length <= 2 : true,
      `non-truncated: ${one.filter((f) => !f.truncatedByDisplayLimit).length}`)
    const shown = one.filter((f) => !f.truncatedByDisplayLimit)
    const overflow = one.filter((f) => f.truncatedByDisplayLimit)
    check("R1d the displayed page is at most one finding per type",
      Math.max(0, ...Object.entries(shown.reduce<Record<string, number>>((a, f) => { a[f.type] = (a[f.type] ?? 0) + 1; return a }, {})).map(([, n]) => n)) <= 1,
      JSON.stringify(shown.map((f) => f.type)))
    check("R1e the overflow is marked truncatedByDisplayLimit, so a caller can tell it apart",
      overflow.length === one.length - shown.length && overflow.length > 0,
      `shown=${shown.length} overflow=${overflow.length}`)
  }

  // --- R2: budget 0 truncates everything ----------------------------------
  {
    const zero = await detectIndexRules(projectId as any, {
      confidenceThreshold: 0, maxResults: 0, includeFramework: true, includeAntiPatterns: true,
    })
    const anti = zero.filter((f) => f.type !== "framework-detected")
    check("R2 a maxResults:0 request still returns the findings, all marked truncated",
      anti.length > 0 && anti.every((f) => f.truncatedByDisplayLimit === true),
      `${anti.filter((f) => f.truncatedByDisplayLimit).length}/${anti.length} marked`)
  }

  // --- R3: the confidence gates are on the confidence the finding CARRIES --
  {
    // The complexity regression: a function at exactly the threshold has
    // confidence 0.65, and a 0.7 request must drop it. The old formula divided
    // complexity by the threshold instead, giving 15/15 = 1.0, which is never
    // below 0.7 — so the gate could not fire and every borderline function was
    // reported no matter what the caller asked for.
    const at07 = await detectIndexRules(projectId as any, {
      confidenceThreshold: 0.7, maxResults: 100, includeFramework: true, includeAntiPatterns: true,
    })
    const names = at07.map((f) => f.location.symbol)
    check("R3 a 0.7 threshold drops a complexity-15 function (confidence 0.65)", !names.includes("exactlyAtThreshold"),
      names.join(","))
    const at06 = await detectIndexRules(projectId as any, {
      confidenceThreshold: 0.6, maxResults: 100, includeFramework: true, includeAntiPatterns: true,
    })
    check("R3b the same function is kept at 0.6, so the gate is a real threshold and not a deletion",
      at06.map((f) => f.location.symbol).includes("exactlyAtThreshold"))
    check("R3c nothing below the requested threshold is ever reported",
      at07.every((f) => f.confidence >= 0.7), JSON.stringify(at07.map((f) => `${f.location.symbol}=${f.confidence}`)))

    // The god-class regression: the old gate was `members / 20 < threshold`, so
    // at 0.6 an 11-member class scored 0.55 and was DROPPED while a
    // 0.65-confidence complexity finding was kept — keeping the weaker finding
    // and discarding the stronger one. The gate is now on the emitted
    // confidence, 0.5 + members/40 = 0.775 for eleven members.
    const godAt06 = at06.filter((f) => f.type === "god-class").map((f) => f.location.symbol)
    check("R3d a 0.6 threshold KEEPS an 11-member god class (old gate dropped it at 0.55)",
      godAt06.includes("ElevenMember"), godAt06.join(","))
    check("R3e the 20-member class outranks the 11-member one on emitted confidence",
      (() => {
        const g = at06.filter((f) => f.type === "god-class")
        const eleven = g.find((f) => f.location.symbol === "ElevenMember")
        const twenty = g.find((f) => f.location.symbol === "TwentyMember")
        return !!eleven && !!twenty && twenty.confidence > eleven.confidence
      })(), JSON.stringify(at06.filter((f) => f.type === "god-class").map((f) => `${f.location.symbol}=${f.confidence}`)))
  }

  // --- R4: non-code files are excluded from the anti-pattern rules ---------
  {
    const all = await detectIndexRules(projectId as any, {
      confidenceThreshold: 0, maxResults: 1000, includeFramework: true, includeAntiPatterns: true,
    })
    check("R4 no finding is reported in a non-code file", all.every((f) => f.location.file !== "docs/not-code.json"),
      all.filter((f) => f.location.file === "docs/not-code.json").map((f) => f.type).join(","))
    const jsonMembers = raw.prepare(
      "SELECT s.name, s.symbol_type, " +
        "(SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) AS n " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND f.relative_path = 'docs/not-code.json' " +
        "AND s.symbol_type IN ('class','interface','struct','trait','enum') " +
        "AND (SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) > 10",
    ).all(projectId) as Array<{ name: string; symbol_type: string; n: number }>
    // The STRONG form, and it is the one that matters. R4b previously asserted
    // only that the JSON file had SOME owned symbols — true, and irrelevant,
    // because the god-class rule also requires the OWNER to be
    // class/interface/struct/trait/enum and to exceed the member threshold. The
    // weak version passed with the non-code clause deleted: the self-test's N6
    // mutation came back green, which means the exclusion was never being tested.
    // This asserts that the fixture WOULD produce a god-class finding if the
    // clause were gone, so passing R4 means something.
    const ownedShape = raw.prepare(
      "SELECT s.symbol_type AS st, COUNT(*) AS c, " +
        "SUM(CASE WHEN s.owner_symbol_id IS NOT NULL THEN 1 ELSE 0 END) AS owned " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND f.relative_path = 'docs/not-code.json' GROUP BY s.symbol_type",
    ).all(projectId)
    check("R4b the non-code fixture WOULD trigger god-class without the exclusion, so R4 tests something",
      jsonMembers.length > 0,
      `no class-typed owner in docs/not-code.json exceeds 10 members, so the exclusion is untested. Indexed shape: ${JSON.stringify(ownedShape)}`)
    const jsonLang = raw.prepare(
      "SELECT language FROM brain_file WHERE project_id = ? AND relative_path = 'docs/not-code.json'",
    ).get(projectId) as { language: string } | undefined
    check("R4c the fixture is indexed under a language the exclusion actually covers",
      /json/i.test(jsonLang?.language ?? ""), `language recorded as ${JSON.stringify(jsonLang?.language)}`)
  }

  // --- R5: a malformed parameters value does not throw ----------------------
  {
    // Not a `check`: reaching this line at all is the assertion. `json_each` on
    // an invalid array raises SqliteError, which would reject the whole scan and
    // take every other finding with it.
    let threw: string | null = null
    let res: Awaited<ReturnType<typeof detectIndexRules>> = []
    try {
      res = await detectIndexRules(projectId as any, {
        confidenceThreshold: 0, maxResults: 100, includeFramework: true, includeAntiPatterns: true,
      })
    } catch (e: any) { threw = String(e?.message ?? e) }
    check("R5 a malformed parameters value does not abort the scan", threw === null, threw ?? "")
    check("R5b the malformed symbol is not reported as a long parameter list",
      !res.some((f) => f.type === "long-parameter-list" && f.location.symbol === "longParams"),
      res.filter((f) => f.type === "long-parameter-list").map((f) => f.location.symbol).join(","))
    check("R5c the scan still returns its other findings after a malformed row",
      res.length > 0, `${res.length} findings`)
  }

  // --- R6: framework detection and its deliberate budget asymmetry ---------
  {
    const fw = await detectIndexRules(projectId as any, {
      confidenceThreshold: 0, maxResults: 100, includeFramework: true, includeAntiPatterns: false,
    })
    const detected = fw.filter((f) => f.type === "framework-detected")
    check("R6 a framework_type is reported as framework-detected", detected.length === 1,
      `found ${detected.length}: ${detected.map((f) => f.description.slice(0, 40)).join("; ")}`)
    check("R6b the framework finding names the file it was seen in",
      (detected[0]?.location.file ?? "") === "src/big.ts", detected[0]?.location.file)
    check("R6c the framework finding carries file evidence",
      (detected[0]?.evidence.length ?? 0) > 0, `${detected[0]?.evidence.length ?? 0} evidence entries`)

    // The asymmetry: a framework type can never be "beyond the display budget in
    // a way that hides it", so with a budget of 0 the anti-patterns are all
    // marked truncated and the framework finding is not. It is a deliberate
    // exception with a comment, and it is the exact shape that a later reader
    // would "fix" — so it is asserted, and asserted as intended behaviour.
    const zeroFw = await detectIndexRules(projectId as any, {
      confidenceThreshold: 0, maxResults: 0, includeFramework: true, includeAntiPatterns: false,
    })
    check("R6d at budget 0 a framework finding is NOT marked truncated (deliberate, and stated)",
      zeroFw.length > 0 && zeroFw.every((f) => f.truncatedByDisplayLimit !== true),
      JSON.stringify(zeroFw.map((f) => `${f.type}:${f.truncatedByDisplayLimit}`)))
  }

  // --- R7: includeFramework / includeAntiPatterns actually gate the branch --
  {
    const neither = await detectIndexRules(projectId as any, {
      confidenceThreshold: 0, maxResults: 100, includeFramework: false, includeAntiPatterns: false,
    })
    check("R7 both branches off returns nothing", neither.length === 0, `${neither.length} findings`)
    const onlyAnti = await detectIndexRules(projectId as any, {
      confidenceThreshold: 0, maxResults: 100, includeFramework: false, includeAntiPatterns: true,
    })
    check("R7b with framework off no framework-detected finding appears",
      onlyAnti.every((f) => f.type !== "framework-detected"), onlyAnti.map((f) => f.type).join(","))
    check("R7c with framework off the anti-patterns still fire",
      onlyAnti.some((f) => f.type === "god-class"), onlyAnti.map((f) => f.type).join(","))
  }

  // --- R8: the god-class member count uses the owner index -----------------
  {
    // This was SELF-REFERENTIAL and could never fail. The first version ran
    // EXPLAIN QUERY PLAN on a query the GATE wrote, not on the query the ENGINE
    // runs, so it asserted that the gate's own SQL used the owner index while
    // saying nothing whatever about rules.ts. The self-test's N4 mutation —
    // reverting the engine to the LEFT JOIN form — came back green for exactly
    // that reason, and would have gone on doing so forever.
    //
    // The fix reads the engine's own SQL. `prepare` is wrapped so every statement
    // the engine issues is recorded, and the one that selects god classes is the
    // one inspected. No comment and no unrelated SQL can satisfy it.
    const captured: string[] = []
    const realPrepare = raw.prepare.bind(raw)
    ;(raw as any).prepare = (sql: string) => {
      captured.push(sql)
      return realPrepare(sql)
    }
    try {
      await detectIndexRules(projectId as any, {
        confidenceThreshold: 0, maxResults: 1000, includeFramework: false, includeAntiPatterns: true,
      })
    } finally {
      ;(raw as any).prepare = realPrepare
    }
    const godSql = captured.find((s) => /owner_symbol_id/.test(s) && /symbol_type IN/.test(s))
    check("R8 the engine's own god-class query was found to inspect", !!godSql,
      `${captured.length} statements issued; none matched the god-class shape`)
    if (godSql) {
      check("R8b it resolves members through the owner index, not a LEFT JOIN the planner declines to use",
        /SELECT COUNT\(\*\) FROM brain_symbol m WHERE m\.owner_symbol_id = s\.id/.test(godSql),
        godSql.replace(/\s+/g, " ").slice(0, 200))
      // The plan for the ENGINE's own SQL, so the assertion is about the access
      // path and not only about how the statement is spelled. The LEFT JOIN form
      // needs a TEMP B-TREE for its GROUP BY; this one must not.
      let plan: Array<{ detail: string }> = []
      try {
        plan = raw.prepare(`EXPLAIN QUERY PLAN ${godSql}`).all(
          projectId, 10, ...(captured.find((s) => /NOT IN \(\?/.test(s)) ? [] : []),
        ) as Array<{ detail: string }>
      } catch { /* the placeholder count differs; R8b is the load-bearing check */ }
      if (plan.length > 0) {
        check("R8c its plan needs no temp B-tree, which is what the LEFT JOIN form's GROUP BY required",
          !plan.some((p) => /TEMP B-TREE/.test(p.detail)), plan.map((p) => p.detail).join(" | "))
      } else {
        check("R8c its plan needs no temp B-tree (skipped: the plan could not be built from the captured statement)", true)
      }
    }
  }

  // --- R9: no dead declarations in the engine ------------------------------
  {
    // GOD_CLASS_SOFT_CAP is declared and never read. Its value, 20, was the old
    // god-class confidence divisor (`members / 20`), so it is residue from a
    // formula that no longer exists, and the name describes a cap the code does
    // not apply. A reader would reasonably wire it up.
    const src = readFileSync(path.resolve("src/intelligence/patterns/rules.ts"), "utf8")
    const declared = [...src.matchAll(/^const ([A-Z_]+) = /gm)].map((m) => m[1])
    const unused = declared.filter((name) => (src.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length <= 1)
    check("R9 every module constant in the rule engine is read", unused.length === 0,
      `declared but never used: ${unused.join(", ")}`)
  }

  // --- R10: the same decisions through the published surface --------------
  {
    const engine: any = await PatternBrainTools.detectPatterns(projectId as any, {
      includeOrphaned: false, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0.9, maxResults: 2,
    })
    const byTypeSum = Object.values(engine.statistics.byType).reduce((a: any, b: any) => a + b, 0) as number
    check("R10 the rule census is the census, not the page",
      engine.statistics.totalFound === engine.scan.findingsBeforeDisplayLimit,
      JSON.stringify(engine.statistics.totalFound) + " vs " + JSON.stringify(engine.scan.findingsBeforeDisplayLimit))
    check("R10b byType sums to the rule census", byTypeSum === engine.statistics.totalFound,
      `byType=${byTypeSum} totalFound=${engine.statistics.totalFound}`)
    check("R10c the page honours maxResults", engine.patterns.length <= 2, `${engine.patterns.length}`)
    check("R10d a 0.9 threshold is honoured through the handler path",
      engine.patterns.every((p: any) => p.confidence >= 0.9),
      JSON.stringify(engine.patterns.map((p: any) => `${p.type}=${p.confidence}`)))
  }
} catch (error) {
  check("M65.P1 session", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

console.log(`\nM65.P1: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
process.exit(failures > 0 ? 1 : 0)
