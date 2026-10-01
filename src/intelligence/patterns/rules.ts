// src/intelligence/patterns/rules.ts — real, index-backed pattern rules for
// bb_patterns scope=all (M13.36).
//
// Every rule is computed from the indexed brain_* tables with evidence and a
// confidence derived from the metric. There are no stubs: a finding is only
// emitted when the indexed data actually matches the rule.

import { BrainDatabase } from "../../brain/database"
import { nonCodeLanguageSQL } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"

export interface RuleFinding {
  type: string
  confidence: number
  location: { file: string; line: number; symbol?: string }
  description: string
  severity: "info" | "warning" | "error"
  suggestion: string
  evidence: Array<{ type: string; description: string }>
  /** True when this finding is the `maxResults`-th or later for its own type,
   *  i.e. the display budget cut it and not the rule. `bb_patterns` reports
   *  this so a caller can tell "there were 900 god classes" from "there were
   *  900 god classes and you are looking at 100". */
  truncatedByDisplayLimit?: boolean
}


interface RuleOptions {
  confidenceThreshold: number
  maxResults: number
  includeFramework: boolean
  includeAntiPatterns: boolean
}

const COMPLEXITY_THRESHOLD = 15
const PARAMETER_THRESHOLD = 7
const GOD_CLASS_MEMBER_THRESHOLD = 10
const GOD_CLASS_SOFT_CAP = 20

export async function detectIndexRules(projectId: ProjectID, options: RuleOptions): Promise<RuleFinding[]> {
  const findings: RuleFinding[] = []
  const raw = await BrainDatabase.getRawInstance(projectId)
  // `maxResults` was declared on RuleOptions and passed by every caller
  // (tools.ts:154) and read NOWHERE: the three rule queries and the framework
  // loop were all unbounded, so a caller asking for 1 result got 869. The
  // budget is applied per type below, after the confidence filter, so that
  // lowering the threshold does not have to raise the cap to see anything.
  const budget = Math.max(0, options.maxResults)

  // Anti-pattern rules describe executable code, so they exclude the languages
  // whose indexed symbols are structural keys. The top-ranked god-class finding
  // on a 45,018-symbol repository was docs/data/m10-baseline.json:25 — a JSON
  // file's members. The orphan engine already excluded these; the rules branch
  // did not, so the same noise survived here under a different rule name. The
  // language set is shared (analysis-exclusions.NON_CODE_LANGUAGES) rather than
  // restated: a second, weaker copy of a language rule is how the qualified
  // references and the import-stem collisions went missing in the first place.
  const nonCode = nonCodeLanguageSQL("f")
  const nonCodeClause = ` AND ${nonCode.sql}`

  if (options.includeAntiPatterns) {
    // 1. High-complexity functions (cyclomatic from the analyzer).
    const complex = raw.prepare(
      "SELECT s.name, s.complexity, f.relative_path AS file, COALESCE(s.line_start, 0) AS line " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND s.complexity IS NOT NULL AND s.complexity >= ?" + nonCodeClause +
        " ORDER BY s.complexity DESC",
    ).all(projectId, COMPLEXITY_THRESHOLD, ...nonCode.params) as Array<{ name: string; complexity: number; file: string; line: number }>
    let shown = 0
    for (const row of complex) {
      // M20.P1/the previous gate was `row.complexity / COMPLEXITY_THRESHOLD <
      // confidenceThreshold`. The SQL above already guarantees
      // complexity >= COMPLEXITY_THRESHOLD, so that ratio is always >= 1.0 and
      // the check could never fire for any legal threshold. The gate is now on
      // the confidence the finding actually carries, which is what
      // `confidenceThreshold` is documented to mean.
      const confidence = Math.min(0.9, 0.5 + row.complexity / 100)
      if (confidence < options.confidenceThreshold) continue
      if (shown >= budget) {
        findings.push({
          type: "high-complexity-function",
          confidence,
          location: { file: row.file, line: row.line, symbol: row.name },
          description: `Function '${row.name}' has complexity ${row.complexity} (threshold ${COMPLEXITY_THRESHOLD}).`,
          severity: "warning",
          suggestion: "Split the function into smaller units and reduce nesting depth.",
          evidence: [{ type: "indexed-complexity", description: `complexity=${row.complexity} (from brain_symbol.complexity)` }],
          truncatedByDisplayLimit: true,
        })
        continue
      }
      shown++
      findings.push({
        type: "high-complexity-function",
        confidence,
        location: { file: row.file, line: row.line, symbol: row.name },
        description: `Function '${row.name}' has complexity ${row.complexity} (threshold ${COMPLEXITY_THRESHOLD}).`,
        severity: "warning",
        suggestion: "Split the function into smaller units and reduce nesting depth.",
        evidence: [{ type: "indexed-complexity", description: `complexity=${row.complexity} (from brain_symbol.complexity)` }],
      })
    }

    // 2. Long parameter lists — counted by SQLite (json_each), not JS.
    // M57.T3 (#791): the old query shipped every parameter array to JS and
    // JSON.parsed ~180k rows per call to keep 15 findings. The count now
    // happens in SQLite on BOTH runtimes (bun:sqlite and node:sqlite bundle
    // JSON1 — probed). Guards preserve the old JS behavior exactly:
    //   - json_valid: an invalid array was a silent skip (try/catch), not a
    //     crash — json_each would throw on it.
    //   - length >= 17: an array with MORE than PARAMETER_THRESHOLD (7)
    //     elements is at minimum 2 brackets + 8 one-char elements + 7 commas;
    //     shorter rows can never match (cheap skip before json_each).
    const paramRows = raw.prepare(
      "SELECT s.name, s.parameters, f.relative_path AS file, COALESCE(s.line_start, 0) AS line, " +
        "(SELECT COUNT(*) FROM json_each(s.parameters)) AS paramCount " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND s.parameters IS NOT NULL AND s.parameters != '[]' " +
        "AND json_valid(s.parameters) AND length(s.parameters) >= 17 " +
        "AND (SELECT COUNT(*) FROM json_each(s.parameters)) > ?" + nonCodeClause +
        " ORDER BY s.id",
    ).all(projectId, PARAMETER_THRESHOLD, ...nonCode.params) as Array<{ name: string; parameters: string; file: string; line: number; paramCount: number }>
    let shownParams = 0
    for (const row of paramRows) {
      const confidence = 0.7
      if (confidence < options.confidenceThreshold) continue
      const params = JSON.parse(row.parameters) as string[] // json_valid-guarded; cannot throw
      if (shownParams >= budget) {
        findings.push({
          type: "long-parameter-list",
          confidence,
          location: { file: row.file, line: row.line, symbol: row.name },
          description: `Function '${row.name}' has ${row.paramCount} parameters (threshold ${PARAMETER_THRESHOLD}).`,
          severity: "warning",
          suggestion: "Group related parameters into a single options/configuration object.",
          evidence: [{ type: "indexed-parameters", description: `parameters=${params.slice(0, 12).join(", ")}` }],
          truncatedByDisplayLimit: true,
        })
        continue
      }
      shownParams++
      findings.push({
        type: "long-parameter-list",
        confidence,
        location: { file: row.file, line: row.line, symbol: row.name },
        description: `Function '${row.name}' has ${row.paramCount} parameters (threshold ${PARAMETER_THRESHOLD}).`,
        severity: "warning",
        suggestion: "Group related parameters into a single options/configuration object.",
        evidence: [{ type: "indexed-parameters", description: `parameters=${params.slice(0, 12).join(", ")}` }],
      })
    }

    // 3. God classes (classes with an excessive number of direct members).
    //
    // MIMIC ON PURPOSE: the previous form was
    //   LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id AND m.project_id = s.project_id
    //   ... GROUP BY s.id HAVING COUNT(m.id) > ?
    // and EXPLAIN QUERY PLAN on a real index shows why it was unusable:
    //
    //   SEARCH m USING INDEX brain_sym_proj_type_idx (project_id=?) LEFT-JOIN
    //   USE TEMP B-TREE FOR GROUP BY
    //   USE TEMP B-TREE FOR ORDER BY
    //
    // brain_symbol_owner_idx ON brain_symbol(owner_symbol_id) EXISTS and is
    // exactly the index for `m.owner_symbol_id = s.id`, and the planner did not
    // choose it. So the member count cost |candidate types| x |all symbols in
    // the project| row visits. Measured across the corpus, with every rewrite
    // returning an IDENTICAL row set:
    //
    //   repo         symbols   this form    correlated COUNT(*)   pre-aggregate
    //   lodash             553        26ms                     1ms
    //   clojure         10,263       625ms                     9ms
    //   backbencher     45,018    >25,000ms                 104ms
    //
    // A plain `bb_patterns {}` — no arguments, includeAntiPatterns defaulting to
    // true — took 330s on that last index. The correlated form is the fastest of
    // the rewrites measured and needs no schema migration, so it is the one
    // shipped. It is equivalent by construction: COUNT(*) over the owner index
    // is the same count the LEFT JOIN produced, and nothing is lost by dropping
    // the redundant `m.project_id` predicate because an owner_symbol_id already
    // names a row in the same project.
    const godClasses = raw.prepare(
      "SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start, 0) AS line, " +
        "(SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) AS members " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND s.symbol_type IN ('class','interface','struct','trait','enum') " +
        "AND (SELECT COUNT(*) FROM brain_symbol m WHERE m.owner_symbol_id = s.id) > ?" + nonCodeClause +
        " ORDER BY members DESC",
    ).all(projectId, GOD_CLASS_MEMBER_THRESHOLD, ...nonCode.params) as Array<{ name: string; file: string; line: number; members: number }>
    let shownGod = 0
    for (const row of godClasses) {
      // The previous gate was `row.members / 20 < confidenceThreshold`, which
      // is a ratio on a scale unrelated to the confidence emitted below. At the
      // default threshold of 0.6 it DROPPED an 11-member class (ratio 0.55)
      // while KEEPING a 0.65-confidence complexity finding — the filter was
      // keeping the weaker finding and discarding the stronger one. The gate is
      // now on the confidence the finding actually carries.
      const confidence = Math.min(0.9, 0.5 + row.members / 40)
      if (confidence < options.confidenceThreshold) continue
      const finding: RuleFinding = {
        type: "god-class",
        confidence,
        location: { file: row.file, line: row.line, symbol: row.name },
        description: `Type '${row.name}' has ${row.members} direct members (threshold ${GOD_CLASS_MEMBER_THRESHOLD}).`,
        severity: "warning",
        suggestion: "Split the type by responsibility; extract cohesive subsets into focused types.",
        evidence: [{ type: "indexed-members", description: `direct members=${row.members} (via owner_symbol_id)` }],
      }
      if (shownGod >= budget) { finding.truncatedByDisplayLimit = true; findings.push(finding); continue }
      shownGod++
      findings.push(finding)
    }
  }

  if (options.includeFramework) {
    // 4. Detected frameworks (from analyzer-assigned framework_type).
    const frameworks = raw.prepare(
      "SELECT framework_type, COUNT(*) c FROM brain_file " +
        "WHERE project_id = ? AND framework_type IS NOT NULL AND framework_type NOT IN ('', 'unknown') " +
        "GROUP BY framework_type ORDER BY c DESC",
    ).all(projectId) as Array<{ framework_type: string; c: number }>
    let shownFw = 0
    for (const fw of frameworks) {
      // One finding per framework TYPE, and a type can never be "beyond the
      // display budget" in a way that hides it: there are at most a handful.
      if (shownFw >= budget && budget > 0 && frameworks.length > budget) {
        findings.push({
          type: "framework-detected",
          confidence: 0.6,
          location: { file: "", line: 0 },
          description: `Framework '${fw.framework_type}' detected in ${fw.c} indexed file(s).`,
          severity: "info",
          suggestion: "Framework usage is static index evidence; verify actual runtime wiring before drawing conclusions.",
          evidence: [],
          truncatedByDisplayLimit: true,
        })
        continue
      }
      shownFw++
      const files = raw.prepare(
        "SELECT relative_path FROM brain_file WHERE project_id = ? AND framework_type = ? LIMIT 10",
      ).all(projectId, fw.framework_type) as Array<{ relative_path: string }>
      const first = files[0]
      findings.push({
        type: "framework-detected",
        confidence: 0.6,
        location: { file: first?.relative_path ?? "", line: 0 },
        description: `Framework '${fw.framework_type}' detected in ${fw.c} indexed file(s).`,
        severity: "info",
        suggestion: "Framework usage is static index evidence; verify actual runtime wiring before drawing conclusions.",
        evidence: files.slice(0, 5).map((f) => ({ type: "indexed-file", description: f.relative_path })),
      })
    }
  }

  return findings
}
