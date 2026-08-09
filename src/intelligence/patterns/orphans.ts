import { BrainDatabase } from "../../brain/database"
import { AnalysisExclusions } from "../../ast/analysis-exclusions"
import type { ProjectID } from "../../project/schema"
import type { OrphanOptions, PatternFinding, PatternReport } from "../contracts"
import { makeProvenance } from "../evidence"

const ENGINE = "orphans@intelligence"
const USAGE_TYPES = ["calls", "instantiates", "extends", "implements", "uses"]

// Common entry-point name patterns (explicit, extensible). A symbol matching
// one of these is not reported as orphaned even with zero incoming edges.
const ENTRY_POINT_NAMES = new Set(["main", "__main__", "start", "run", "init", "setup", "handler", "default"])
const ENTRY_POINT_SUFFIXES = ["Handler", "Controller", "Middleware", "Route", "Routes", "Command", "Plugin"]

type SymRow = {
  id: string
  name: string
  symbolType: string
  visibility: string | null
  line: number
  lineEnd: number
  file: string
  fileId: string
}

function isEntryPointName(name: string): boolean {
  if (ENTRY_POINT_NAMES.has(name)) return true
  return ENTRY_POINT_SUFFIXES.some((s) => name.endsWith(s))
}

function locFor(sym: { line: number; lineEnd: number }): number {
  return sym.lineEnd > sym.line ? sym.lineEnd - sym.line : 0
}

// Strict orphan detection.
//
// Correctness model (verified against the indexer's actual output):
//   - A symbol is "used" iff it has an incoming edge of a USAGE type where
//     target_symbol_id = symbol.id (resolved) OR target_external = symbol.name
//     (name-matched cross-file). 'exports' and 'contains' are NOT usage.
//   - Visibility is NOT used to filter: many languages (TS) mark everything
//     public, so the old `visibility != public` filter suppressed all findings.
//   - Entry points (by explicit name/suffix rules) are excluded.
//   - A file is orphaned iff no OTHER file references any of its symbols (via
//     resolved cross-file usage edges or an 'imports' edge naming its path).
export async function detectOrphans(projectId: ProjectID, options: OrphanOptions = {}): Promise<PatternReport> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const minConfidence = options.minConfidence ?? 0.5
  const maxResults = options.maxResults ?? 100
  const rules = new Set(options.rules ?? ["orphaned_function", "orphaned_class", "orphaned_file"])
  const includeTests = options.includeTests ?? false

  // Build the set of "used" symbol keys: both resolved ids and referenced names.
  const usedIds = new Set<string>()
  const usedNames = new Set<string>()
  const usageRows = raw.prepare(
    "SELECT target_symbol_id AS id, target_external AS ext FROM brain_relationship " +
      "WHERE project_id = ? AND relationship_type IN (" + USAGE_TYPES.map(() => "?").join(",") + ")",
  ).all(projectId, ...USAGE_TYPES) as Array<{ id: string | null; ext: string | null }>
  for (const row of usageRows) {
    if (row.id) usedIds.add(row.id)
    if (row.ext) {
      // target_external may be a bare name ("usedFn") or "path:name" — take the tail.
      const tail = row.ext.includes(":") ? row.ext.split(":").pop()! : row.ext
      usedNames.add(tail)
    }
  }

  const symbols = raw.prepare(
    "SELECT s.id, s.name, s.symbol_type AS symbolType, s.visibility, " +
      "COALESCE(s.line_start,0) AS line, COALESCE(s.line_end,0) AS lineEnd, " +
      "f.relative_path AS file, f.id AS fileId " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND s.symbol_type IN ('function','method','class','interface','struct','enum')",
  ).all(projectId) as SymRow[]

  const findings: PatternFinding[] = []
  const scannedFiles = new Set<string>()

  // Files referenced from OTHER files via a RESOLVED cross-file usage edge.
  // (Name-only matches are intentionally excluded here: a method named "run" in
  // an unrelated class must not mark its file as referenced. Name matching is
  // fine for symbol-level orphans but too coarse for file-level.)
  const referencedFiles = new Set<string>()
  const symbolFileById = new Map(symbols.map((s) => [s.id, s.fileId]))
  const resolvedCrossFileRows = raw.prepare(
    "SELECT r.source_symbol_id AS src, r.target_symbol_id AS tgt FROM brain_relationship r " +
      "WHERE r.project_id = ? AND r.target_symbol_id IS NOT NULL AND r.source_symbol_id IS NOT NULL " +
      "AND r.relationship_type IN (" + USAGE_TYPES.map(() => "?").join(",") + ")",
  ).all(projectId, ...USAGE_TYPES) as Array<{ src: string; tgt: string }>
  for (const row of resolvedCrossFileRows) {
    const srcFile = symbolFileById.get(row.src)
    const tgtFile = symbolFileById.get(row.tgt)
    if (tgtFile && srcFile && srcFile !== tgtFile) referencedFiles.add(tgtFile)
  }

  for (const sym of symbols) {
    scannedFiles.add(sym.fileId)
  }

  // ---- orphaned functions/methods & classes ----
  for (const sym of symbols) {
    if (!includeTests && AnalysisExclusions.isTestPath(sym.file)) continue
    if (AnalysisExclusions.isHardNoisePath(sym.file) || AnalysisExclusions.isNoiseSymbolName(sym.name)) continue
    if (isEntryPointName(sym.name)) continue

    const used = usedIds.has(sym.id) || usedNames.has(sym.name)
    if (used) continue

    const isClassLike = ["class", "interface", "struct", "enum"].includes(sym.symbolType)
    const rule = isClassLike ? "orphaned_class" : "orphaned_function"
    if (!rules.has(rule as any)) continue

    // Confidence: name-based external matching is a known false-positive vector,
    // so cap confidence and record it as a limitation.
    const confidence = 0.6
    if (confidence < minConfidence) continue

    findings.push({
      rule: rule as any,
      engine: ENGINE,
      severity: "info",
      confidence,
      location: { file: sym.file, line: sym.line, symbol: sym.name },
      linesOfCode: locFor(sym),
      description: `${isClassLike ? "Type" : "Function"} '${sym.name}' has no incoming usage edges (calls/instantiates/extends/implements/uses).`,
      remediation: "Verify it is not referenced dynamically, via reflection, framework registration, or build/test config before considering removal.",
      evidence: [
        { kind: "relationship", description: "No resolved incoming usage relationship (target_symbol_id)." },
        { kind: "reference", description: "No name-matched cross-file reference (target_external)." },
      ],
      limitations: [
        "Name-only matching cannot see dynamic dispatch, reflection, or string-based lookups.",
        "Framework entry points not matched by the built-in name/suffix rules may be false positives.",
        "Build configs, plugin manifests (XML), and test conventions are not scanned.",
      ],
    })
  }

  // ---- orphaned files ----
  if (rules.has("orphaned_file")) {
    const files = raw.prepare(
      "SELECT id, relative_path AS relativePath FROM brain_file WHERE project_id = ?",
    ).all(projectId) as Array<{ id: string; relativePath: string }>

    // A file is referenced if any OTHER file imports/uses a symbol in it. We use
    // resolved cross-file usage: referencedFiles set above captures files whose
    // symbols are used anywhere. To require *incoming from another file*, check
    // 'imports' edges naming the file path.
    const importTargets = raw.prepare(
      "SELECT target_external AS ext FROM brain_relationship WHERE project_id = ? AND relationship_type = 'imports'",
    ).all(projectId) as Array<{ ext: string | null }>
    const importedPathTails = new Set<string>()
    for (const row of importTargets) {
      if (!row.ext) continue
      // "./used:usedFn" -> "used"; "path/to/mod:Name" -> "mod"
      const spec = row.ext.split(":")[0] ?? row.ext
      const tail = spec.split("/").pop()?.replace(/\.[^.]+$/, "") ?? spec
      importedPathTails.add(tail)
    }

    for (const file of files) {
      if (!includeTests && AnalysisExclusions.isTestPath(file.relativePath)) continue
      if (AnalysisExclusions.isHardNoisePath(file.relativePath)) continue
      const basename = file.relativePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? file.relativePath
      // Skip likely entry points by filename.
      if (["index", "main", "app", "mod"].includes(basename.toLowerCase())) continue
      const referencedBySymbol = referencedFiles.has(file.id)
      const referencedByImport = importedPathTails.has(basename)
      if (referencedBySymbol || referencedByImport) continue

      const confidence = 0.5
      if (confidence < minConfidence) continue
      findings.push({
        rule: "orphaned_file",
        engine: ENGINE,
        severity: "info",
        confidence,
        location: { file: file.relativePath, line: 1 },
        linesOfCode: 0,
        description: `File '${file.relativePath}' has no incoming references from other files (no importing file, no cross-file symbol usage).`,
        remediation: "Confirm the file is not an entry point, dynamically loaded, or referenced by build/test tooling before removal.",
        evidence: [
          { kind: "reference", description: "No cross-file symbol usage resolves into this file." },
          { kind: "import", description: "No 'imports' edge names this file's module path." },
        ],
        limitations: [
          "Entry points and dynamically loaded files may appear orphaned.",
          "Build systems and non-code manifests are not scanned.",
        ],
      })
    }
  }

  findings.sort((a, b) => b.confidence - a.confidence || a.location.file.localeCompare(b.location.file))
  const truncated = findings.length > maxResults
  const page = findings.slice(0, maxResults)

  const byRule: Record<string, number> = {}
  for (const f of page) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1

  return {
    findings: page,
    provenance: makeProvenance({ evidenceClass: "static_finding", engine: ENGINE, engineVersion: "m10.02", projectId, source: "brain_symbol+brain_relationship+brain_file", limitations: ["Dynamic dispatch, reflection, string references, and external manifests are not fully observable."], truncated }),
    summary: {
      total: page.length,
      byRule,
      scannedSymbols: symbols.length,
      scannedFiles: scannedFiles.size,
      truncated,
    },
  }
}
