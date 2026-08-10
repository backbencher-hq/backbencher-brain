import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import type { ComplexityMetric, ComplexityReport } from "../contracts"
import { makeProvenance } from "../evidence"

type SymRow = {
  id: string
  name: string
  symbolType: string
  complexity: number
  line: number
  lineEnd: number
  file: string
  fileId: string
}

const ENGINE = "complexity@intelligence"
const ENGINE_VERSION = "m10.04"

const metric = (value: number | null): ComplexityMetric => ({ value, available: value !== null })

// Scope-correct complexity. Unavailable metrics are marked available:false and
// value:null rather than fabricated. depthOfInheritance is always unavailable
// until real hierarchy analysis exists (previously hardcoded to 1).
export async function analyzeComplexity(
  projectId: ProjectID,
  options: { scope?: "project" | "file" | "class" | "function"; target?: string; threshold?: number } = {},
): Promise<ComplexityReport> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const scope = options.scope ?? "project"
  const target = options.target ?? "entire project"

  const base =
    "SELECT s.id, s.name, s.symbol_type AS symbolType, COALESCE(s.complexity,0) AS complexity, " +
    "COALESCE(s.line_start,0) AS line, COALESCE(s.line_end,0) AS lineEnd, " +
    "f.relative_path AS file, f.id AS fileId " +
    "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ?"

  let symbols: SymRow[]
  if (scope === "function") {
    if (!options.target) throw new Error("Function name required for function scope")
    symbols = raw.prepare(base + " AND s.name = ? LIMIT 50").all(projectId, options.target) as SymRow[]
  } else if (scope === "class") {
    if (!options.target) throw new Error("Class name required for class scope")
    symbols = raw.prepare(base + " AND s.name = ? AND s.symbol_type = 'class' LIMIT 50").all(projectId, options.target) as SymRow[]
  } else if (scope === "file") {
    if (!options.target) throw new Error("File path required for file scope")
    symbols = raw.prepare(base + " AND f.relative_path LIKE ?").all(projectId, `%${options.target}%`) as SymRow[]
  } else {
    symbols = raw.prepare(base).all(projectId) as SymRow[]
  }

  const symbolCount = symbols.length
  let totalCyclomatic = 0
  const breakdown: ComplexityReport["breakdown"] = []
  for (const sym of symbols) {
    totalCyclomatic += sym.complexity
    breakdown.push({ name: sym.name, type: sym.symbolType, complexity: sym.complexity, file: sym.file, line: sym.line })
  }
  breakdown.sort((a, b) => b.complexity - a.complexity)

  const cyclomaticAvg = symbolCount > 0 ? Math.round((totalCyclomatic / symbolCount) * 100) / 100 : null

  // Lines of code: scope-consistent. Function/class -> sum symbol spans.
  // File -> that file's line_count. Project -> sum of all file line_count.
  let loc: number | null = null
  if (scope === "function" || scope === "class") {
    loc = symbols.reduce((sum, s) => sum + (s.lineEnd > s.line ? s.lineEnd - s.line : 0), 0)
  } else if (scope === "file" && symbols.length > 0) {
    const row = raw.prepare("SELECT COALESCE(line_count,0) AS lc FROM brain_file WHERE id = ?").get(symbols[0]!.fileId) as { lc: number } | undefined
    loc = row ? Number(row.lc) : null
  } else if (scope === "project") {
    const row = raw.prepare("SELECT COALESCE(SUM(line_count),0) AS lc FROM brain_file WHERE project_id = ?").get(projectId) as { lc: number }
    loc = Number(row.lc)
  }

  // Coupling edges touching the scoped symbols (or all edges for project scope).
  let couplingEdges: number | null = null
  if (scope === "project") {
    const row = raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ?").get(projectId) as { c: number }
    couplingEdges = Number(row.c)
  } else if (symbols.length > 0) {
    const ids = symbols.map((s) => s.id)
    const placeholders = ids.map(() => "?").join(",")
    const row = raw.prepare(
      "SELECT COUNT(*) AS c FROM brain_relationship WHERE project_id = ? AND (" +
        "source_symbol_id IN (" + placeholders + ") OR target_symbol_id IN (" + placeholders + "))",
    ).get(projectId, ...ids, ...ids) as { c: number }
    couplingEdges = Number(row.c)
  } else {
    couplingEdges = 0
  }

  // Maintainability index (Halstead-free variant). Only computable when we have
  // symbols and a LOC figure; otherwise unavailable rather than NaN.
  let maintainability: number | null = null
  if (symbolCount > 0 && loc !== null && loc >= 0) {
    const avg = cyclomaticAvg ?? 0
    const mi = Math.max(0, 171 - 5.2 * Math.log(avg + 1) - 16.2 * Math.log(loc + 1))
    maintainability = Math.round(mi * 100) / 100
  }

  return {
    target,
    scope,
    metrics: {
      cyclomaticAvg: metric(cyclomaticAvg),
      cyclomaticTotal: metric(symbolCount > 0 ? totalCyclomatic : null),
      linesOfCode: metric(loc),
      couplingEdges: metric(couplingEdges),
      maintainability: metric(maintainability),
      depthOfInheritance: metric(null), // not computed yet — never fabricated
    },
    breakdown: breakdown.slice(0, 20),
    symbolCount,
    provenance: makeProvenance({ evidenceClass: "indexed", engine: ENGINE, engineVersion: ENGINE_VERSION, projectId, source: "brain_symbol+brain_file+brain_relationship", limitations: ["depthOfInheritance unavailable; cyclomatics use indexed heuristics not dynamic dispatch."] }),
  }
}
