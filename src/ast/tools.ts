// src/ast/tools.ts — M10.06 minimized compatibility layer.
//
// After M10.03/M10.06, this file is the only remaining bridge between the
// canonical intelligence engines and the public handlers. It contains only:
//
//   1. `BrainTools.searchCode` — a thin, document-delegating wrapper around
//      canonical `searchSymbols` (intelligence/search/symbol-search.ts).
//   2. `PatternBrainTools.detectPatterns` — pattern scan aggregator (orphan
//      branch routes to canonical `detectOrphans`, evidence preserved).
//
// All other prior namespaces that used to live here have been removed; see
// docs/M10-DELETION-LEDGER.md for the per-symbol evidence trail.
//
// Anything marked removed remains unreferenced from active handler paths.

import type { ProjectID } from "../project/schema"
import type { SearchOptions, SearchResults } from "../intelligence/contracts"
import type { PatternFinding } from "../intelligence/contracts"
import { detectOrphans } from "../intelligence/patterns/orphans"

/**
 * searchCode is kept as a compatibility alias for handlers. It delegates
 * directly to canonical `searchSymbols` without adding any local heuristic
 * or claiming additional capability beyond the canonical search contract.
 */
export namespace BrainTools {
  /**
   * Universal symbol search. Delegating alias for canonical
   * `searchSymbols` (intelligence/search/symbol-search.ts). The handler should
   * call canonical directly; this wrapper exists for downstream consumers that
   * imported `BrainTools` before M10 removed the other namespaces.
   */
  export async function searchCode(
    projectId: ProjectID,
    query: string,
    options: {
      languages?: string[]
      symbolKind?: string
      includeContent?: boolean
      includeComments?: boolean
      exact?: boolean
      caseSensitive?: boolean
      regex?: boolean
      maxResults?: number
      offset?: number
    } = {},
  ): Promise<SearchResults> {
    const { searchSymbols } = await import("../intelligence/search/symbol-search")
    return searchSymbols(projectId, query, options as SearchOptions)
  }
}

export namespace PatternBrainTools {
  /**
   * Universal pattern detection. The orphaned-code branch routes to the
   * canonical orphan engine (`detectOrphans`) with evidence, limitations, and
   * remediation preserved; the framework/anti-pattern branches are legacy
   * heuristics kept for compatibility until M10.06 calibrates or removes them.
   * Results are mapped into the canonical pattern shape but carry additional
   * metadata from the PatternDetectionResult helpers.
   */
  export async function detectPatterns(
    projectId: ProjectID,
    options: {
      includeOrphaned?: boolean
      includeFramework?: boolean
      includeAntiPatterns?: boolean
      confidenceThreshold?: number
      maxResults?: number
    } = {},
  ): Promise<{
    patterns: Array<{
      type: string
      confidence: number
      location: { file: string; line: number; symbol?: string }
      description: string
      severity: "info" | "warning" | "error"
      suggestion?: string
      evidence: Array<{ type: string; description: string }>
    }>
    statistics: {
      totalFound: number
      byType: Record<string, number>
      bySeverity: Record<string, number>
      averageConfidence: number
    }
    recommendations: Array<{
      priority: "high" | "medium" | "low"
      action: string
      description: string
      affectedPatterns: string[]
    }>
    scan: {
      candidatesEvaluated: number
      findingsBeforeDisplayLimit: number
      displayed: number
      truncated: boolean
    }
  }> {
    const opts = {
      includeOrphaned: true,
      includeFramework: true,
      includeAntiPatterns: true,
      confidenceThreshold: 0.5,
      maxResults: 200,
      ...options,
    }

    const patterns: Array<any> = []
    // M57.T3: full-set aggregates for the orphan branch (see the comment below).
    let orphanCandidates = 0
    const orphanByType: Record<string, number> = {}
    let orphanConfidenceSum = 0

    // 1. Orphan detection — canonical, provenance-bearing, evidence-aware.
    // M57.T3 (#791): the orphan page is BOUNDED at the scan (the old call used
    // maxResults: Number.MAX_SAFE_INTEGER, which materialized every finding
    // object — ~28.6k with evidence arrays on this repo — for a display of at
    // most maxResults items). The full census now comes from the summary
    // aggregates, so statistics.meaning is unchanged:
    //   - candidatesEvaluated: orphan candidates + rule findings
    //   - averageConfidence: same weighted mean as before
    //   - byType/bySeverity: counts over the full pre-slice set (orphan
    //     contributions derived from the candidates census, which reproduces
    //     the old counts exactly because candidate confidence equals the
    //     finding's confidence constant).
    if (opts.includeOrphaned) {
      const orphanReport = await detectOrphans(projectId, {
        minConfidence: opts.confidenceThreshold,
        maxResults: opts.maxResults,
      })
      for (const finding of orphanReport.findings) {
        patterns.push({
          type: finding.rule,
          confidence: finding.confidence,
          location: { file: finding.location.file, line: finding.location.line, symbol: finding.location.symbol },
          description: finding.description,
          severity: "info",
          suggestion: finding.remediation,
          evidence: finding.evidence.map((ev: PatternFinding["evidence"][number]) => ({ type: ev.kind, description: ev.description })),
        })
      }
      orphanCandidates = orphanReport.summary.candidatesTotal
      for (const [k, v] of Object.entries(orphanReport.summary.candidatesByRule)) orphanByType[k] = (orphanByType[k] ?? 0) + v
      orphanConfidenceSum = orphanReport.summary.candidatesAverageConfidence * orphanCandidates
    }

    // 2. Framework + anti-pattern rules — real, index-backed, evidence-bearing
    // (M13.36). A finding is emitted only when indexed data matches the rule;
    // there are no zero-confidence stubs.
    const { detectIndexRules } = await import("../intelligence/patterns/rules")
    const ruleFindings = await detectIndexRules(projectId as any, {
      confidenceThreshold: opts.confidenceThreshold,
      maxResults: opts.maxResults,
      includeFramework: opts.includeFramework,
      includeAntiPatterns: opts.includeAntiPatterns,
    })
    for (const finding of ruleFindings) patterns.push(finding)

    // 3. Statistics mapping (canonical-safe aggregation). M57.T3: the orphan
    // contribution comes from the candidate census (identical numbers to the
    // old materialize-everything path — same constants, same mean). The orphan
    // page entries in `patterns` are census-covered, so the loop below must
    // count ONLY non-orphan (rule) findings — otherwise the page double-counts.
    const byType: Record<string, number> = { ...orphanByType }
    const bySeverity: Record<string, number> = {}
    for (const k of Object.keys(orphanByType)) bySeverity["info"] = (bySeverity["info"] ?? 0) + orphanByType[k]
    let confidenceSum = orphanConfidenceSum
    let ruleFindingCount = 0
    for (const pattern of patterns) {
      if (String(pattern.type).startsWith("orphaned_")) continue
      ruleFindingCount++
      byType[pattern.type] = (byType[pattern.type] || 0) + 1
      bySeverity[pattern.severity] = (bySeverity[pattern.severity] || 0) + 1
      confidenceSum += pattern.confidence
    }

    const displayedPatterns = patterns.slice(0, opts.maxResults)
    return {
      patterns: displayedPatterns,
      statistics: {
        totalFound: displayedPatterns.length,
        byType,
        bySeverity,
        averageConfidence: orphanCandidates + ruleFindingCount > 0 ? confidenceSum / (orphanCandidates + ruleFindingCount) : 0,
      },
      recommendations: [],
      scan: {
        candidatesEvaluated: orphanCandidates + ruleFindingCount,
        findingsBeforeDisplayLimit: orphanCandidates + ruleFindingCount,
        displayed: displayedPatterns.length,
        truncated: orphanCandidates + ruleFindingCount > displayedPatterns.length,
      },
    }
  }
}
