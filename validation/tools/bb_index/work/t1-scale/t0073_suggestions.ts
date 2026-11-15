// Test suggestion engine (M9.11).
//
// Given changed production symbols (added / modified / deleted), recommend test
// actions. Evidence-first: prefer EXISTING affected tests (from static mapping
// evidence) before suggesting new files. Naming conventions are used ONLY as a
// low-confidence fallback when no relationship evidence exists and ALWAYS flagged.
// Suggestions are recommendation text only — generated test code is never emitted
// or written by this engine.
import path from "node:path"
import { BrainDatabase } from "../../brain/database"
import type { ProjectID } from "../../project/schema"
import { graphTraversal } from "../graph/graph-engine"
import { testImpact } from "./test-intel"
import type {
  AffectedTestEntry,
  TestSuggestionActionItem,
  TestSuggestionsReport,
  TestSymbolChangeSuggestion,
} from "../contracts"

export type ChangedSymbol = {
  name: string
  file: string
  kind: "added" | "modified" | "deleted"
}

export interface SuggestOptions {
  maxDepth?: number
  /** symbols below this complexity get downgraded priority */
  trivialityThreshold?: number
}

type TestRef = { testSymbol: string; testFile: string; depth: number }

type SymRow = {
  id: string
  name: string
  symbolType: string
  fileId: string
  file: string
  absPath: string
  complexity: number
  gravity: number
}

function priorityFor(complexity: number, blastRadius: number, kind: string): TestSuggestionActionItem["priority"] {
  if (kind === "deleted") return "high"
  if (complexity >= 6 || blastRadius >= 6) return "critical"
  if (complexity >= 3 || blastRadius >= 3) return "high"
  if (complexity >= 2 || blastRadius >= 1) return "medium"
  return "low"
}

function effortFor(complexity: number, existingTests: number): TestSuggestionActionItem["estimatedEffort"] {
  if (existingTests > 0 && complexity < 3) return "small"
  if (complexity >= 6 || existingTests === 0) return "large"
  return "medium"
}

export async function testSuggestions(
  projectId: ProjectID,
  changed: ChangedSymbol[],
  options: SuggestOptions = {},
): Promise<TestSuggestionsReport> {
  const raw = await BrainDatabase.getRawInstance(projectId)
  const unknowns: string[] = []

  const rows = raw.prepare(
    "SELECT s.id, s.name, s.symbol_type AS symbolType, s.file_id AS fileId, f.relative_path AS file, f.path AS absPath, " +
      "COALESCE(s.complexity,0) AS complexity, COALESCE(s.gravity_score,0) AS gravity " +
      "FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id " +
      "WHERE s.project_id = ? AND COALESCE(f.is_test_file,0) = 0 " +
      "AND s.symbol_type IN ('function','method','class','interface','struct','enum')",
  ).all(projectId) as SymRow[]

  const byName = new Map<string, SymRow[]>()
  for (const r of rows) {
    const arr = byName.get(r.name) ?? []
    arr.push(r)
    byName.set(r.name, arr)
  }

  const changedOut: TestSymbolChangeSuggestion[] = []
  const affectedEntries: AffectedTestEntry[] = []

  for (const ch of changed) {
    const candidates = (byName.get(ch.name) ?? []).filter((r) => r.file.endsWith(ch.file) || ch.file.endsWith(r.file) || r.absPath.endsWith(ch.file))
    const sym = candidates[0]

    // Deleted: caller-decided (the symbol may still be a stale index row until reindex,
    // and callers know their VCS state). Resolve referencing tests from residual edges.
    if (ch.kind === "deleted") {
      const impact = await testImpact(projectId, ch.name, { maxDepth: options.maxDepth ?? 4 }).catch(() => null)
      const dangling = impact && impact.found ? [...impact.directTests, ...impact.indirectTests] : []
      for (const t of dangling) affectedEntries.push({ testSymbol: t.testSymbol, testFile: t.testFile, depth: t.depth, changedSymbol: ch.name })
      changedOut.push({
        symbolId: sym?.id ?? "",
        symbolName: ch.name,
        filePath: sym?.file ?? ch.file,
        changeType: "deleted",
        blastRadius: 0,
        namingFallback: false,
        actions: dangling.length
          ? [{
              action: "review_deleted_symbol_coverage",
              evidence: { evidenceKind: "reference", confidence: 0.6, testFile: dangling[0].testFile },
              targetBasis: "dangling_impact_edge",
              priority: "high",
              estimatedEffort: "medium",
              text: `Symbol '${ch.name}' deleted; review existing tests referencing it (e.g. ${dangling[0].testFile}) for now-stale assertions and remove/adjust coverage.`,
            }]
          : [{
              action: "review_deleted_symbol_coverage",
              evidence: { evidenceKind: "reference", confidence: 0.4 },
              targetBasis: "unresolved",
              priority: "medium",
              estimatedEffort: "small",
              text: `Symbol '${ch.name}' deleted and no referencing tests were resolved; confirm no test depended on it.`,
            }],
      })
      continue
    }

    // added / modified but unresolvable in the index
    if (!sym) {
      unknowns.push(`changed symbol '${ch.name}' in '${ch.file}' not found in index (treated as unresolvable)`)
      continue
    }

    // blast radius via shared graph engine (caller closure)
    let blastRadius = 0
    try {
      const g = await graphTraversal(projectId, sym.name, { direction: "callers", maxDepth: options.maxDepth ?? 4 })
      const callers = new Set(g.callers.map((e) => g.nodes[e.from]).filter((n) => n && !n.isExternal).map((n) => n.id))
      blastRadius = callers.size
    } catch {
      unknowns.push(`blast-radius graph unavailable for '${ch.name}'`)
    }

    // existing affected tests (evidence-first)
    const impact = await testImpact(projectId, sym.name, { maxDepth: options.maxDepth ?? 4 }).catch(() => null)
    const existingTests = impact && impact.found ? [...impact.directTests, ...impact.indirectTests] : []
    for (const t of existingTests) affectedEntries.push({ testSymbol: t.testSymbol, testFile: t.testFile, depth: t.depth, changedSymbol: sym.name })

    const actions: TestSuggestionActionItem[] = []
    let namingFallback = false

    if (existingTests.length > 0) {
      for (const t of existingTests.slice(0, 4)) {
        actions.push({
          action: "extend_existing_test",
          evidence: { evidenceKind: t.depth === 0 ? "direct_call" : "reference", confidence: t.depth === 0 ? 0.85 : 0.6, testFile: t.testFile, testSymbol: t.testSymbol },
          targetBasis: "existing_test_ref",
          priority: priorityFor(sym.complexity, blastRadius, ch.kind),
          estimatedEffort: effortFor(sym.complexity, existingTests.length),
          text: `'${sym.name}' changed; extend existing test '${t.testSymbol}' in ${t.testFile}.`,
        })
      }
    } else {
      // No relationship evidence → naming-convention expected path, flagged low-confidence.
      namingFallback = true
      const expected = expectedTestPath(sym.file)
      actions.push({
        action: "create_test",
        evidence: { evidenceKind: "import", confidence: 0.3 },
        targetBasis: "expected_convention",
        priority: priorityFor(sym.complexity, blastRadius, ch.kind),
        estimatedEffort: effortFor(sym.complexity, 0),
        text: `No test references '${sym.name}'. Suggest creating coverage (e.g. ${expected}) — naming-convention fallback, low confidence.`,
      })
    }

    changedOut.push({
      symbolId: sym.id,
      symbolName: sym.name,
      filePath: sym.file,
      changeType: ch.kind,
      blastRadius,
      actions,
      namingFallback,
    })
  }

  // Deduplicate affected tests (same test may be hit by multiple changed symbols).
  const seen = new Set<string>()
  const affectedDedup = affectedEntries.filter((e) => {
    const k = e.testSymbol + "@" + e.testFile + "|" + e.changedSymbol
    return seen.has(k) ? false : (seen.add(k), true)
  })

  const allActions = changedOut.flatMap((c) => c.actions)
  return {
    changedSymbols: changedOut,
    affectedExistingTests: affectedDedup,
    unknowns,
    summary: {
      actionCount: allActions.length,
      extendExisting: allActions.filter((a) => a.action === "extend_existing_test").length,
      createNew: allActions.filter((a) => a.action === "create_test").length,
    },
  }
}

function expectedTestPath(file: string): string {
  const dir = path.dirname(file)
  const ext = path.extname(file)
  const base = path.basename(file, ext)
  if (ext === ".py") return path.join(dir, `test_${base}.py`)
  return path.join(dir, `${base}${ext === ".ts" ? ".test.ts" : ".test.js"}`)
}
