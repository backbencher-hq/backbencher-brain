// src/intelligence/patterns/rules.ts — real, index-backed pattern rules for
// bb_patterns scope=all (M13.36).
//
// Every rule is computed from the indexed brain_* tables with evidence and a
// confidence derived from the metric. There are no stubs: a finding is only
// emitted when the indexed data actually matches the rule.

import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"

export interface RuleFinding {
  type: string
  confidence: number
  location: { file: string; line: number; symbol?: string }
  description: string
  severity: "info" | "warning" | "error"
  suggestion: string
  evidence: Array<{ type: string; description: string }>
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

export async function detectIndexRules(projectId: ProjectID, options: RuleOptions): Promise<RuleFinding[]> {
  const findings: RuleFinding[] = []
  const raw = await BrainDatabase.getRawInstance(projectId)

  if (options.includeAntiPatterns) {
    // 1. High-complexity functions (cyclomatic from the analyzer).
    const complex = raw.prepare(
      "SELECT s.name, s.complexity, f.relative_path AS file, COALESCE(s.line_start, 0) AS line " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "WHERE s.project_id = ? AND s.complexity IS NOT NULL AND s.complexity >= ? " +
        "ORDER BY s.complexity DESC",
    ).all(projectId, COMPLEXITY_THRESHOLD) as Array<{ name: string; complexity: number; file: string; line: number }>
    for (const row of complex) {
      if (row.complexity / COMPLEXITY_THRESHOLD < options.confidenceThreshold) continue
      findings.push({
        type: "high-complexity-function",
        confidence: Math.min(0.9, 0.5 + row.complexity / 100),
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
        "AND (SELECT COUNT(*) FROM json_each(s.parameters)) > ? " +
        "ORDER BY s.id",
    ).all(projectId, PARAMETER_THRESHOLD) as Array<{ name: string; parameters: string; file: string; line: number; paramCount: number }>
    for (const row of paramRows) {
      const params = JSON.parse(row.parameters) as string[] // json_valid-guarded; cannot throw
      findings.push({
        type: "long-parameter-list",
        confidence: 0.7,
        location: { file: row.file, line: row.line, symbol: row.name },
        description: `Function '${row.name}' has ${row.paramCount} parameters (threshold ${PARAMETER_THRESHOLD}).`,
        severity: "warning",
        suggestion: "Group related parameters into a single options/configuration object.",
        evidence: [{ type: "indexed-parameters", description: `parameters=${params.slice(0, 12).join(", ")}` }],
      })
    }

    // 3. God classes (classes with an excessive number of direct members).
    const godClasses = raw.prepare(
      "SELECT s.id, s.name, f.relative_path AS file, COALESCE(s.line_start, 0) AS line, COUNT(m.id) AS members " +
        "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
        "LEFT JOIN brain_symbol m ON m.owner_symbol_id = s.id AND m.project_id = s.project_id " +
        "WHERE s.project_id = ? AND s.symbol_type IN ('class','interface','struct','trait','enum') " +
        "GROUP BY s.id HAVING COUNT(m.id) > ? ORDER BY members DESC",
    ).all(projectId, GOD_CLASS_MEMBER_THRESHOLD) as Array<{ name: string; file: string; line: number; members: number }>
    for (const row of godClasses) {
      if (row.members / 20 < options.confidenceThreshold) continue
      findings.push({
        type: "god-class",
        confidence: Math.min(0.9, 0.5 + row.members / 40),
        location: { file: row.file, line: row.line, symbol: row.name },
        description: `Type '${row.name}' has ${row.members} direct members (threshold ${GOD_CLASS_MEMBER_THRESHOLD}).`,
        severity: "warning",
        suggestion: "Split the type by responsibility; extract cohesive subsets into focused types.",
        evidence: [{ type: "indexed-members", description: `direct members=${row.members} (via owner_symbol_id)` }],
      })
    }
  }

  if (options.includeFramework) {
    // 4. Detected frameworks (from analyzer-assigned framework_type).
    const frameworks = raw.prepare(
      "SELECT framework_type, COUNT(*) c FROM brain_file " +
        "WHERE project_id = ? AND framework_type IS NOT NULL AND framework_type NOT IN ('', 'unknown') " +
        "GROUP BY framework_type ORDER BY c DESC",
    ).all(projectId) as Array<{ framework_type: string; c: number }>
    for (const fw of frameworks) {
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
