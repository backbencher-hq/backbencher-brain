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

    // 1. Orphan detection — canonical, provenance-bearing, evidence-aware.
    if (opts.includeOrphaned) {
      const orphanReport = await detectOrphans(projectId, {
        minConfidence: opts.confidenceThreshold,
        maxResults: Math.floor(opts.maxResults * 0.6),
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
    }

    // 2. Framework-specific patterns (legacy heuristic candidates).
    // These rules have not been calibrated against canonical evidence yet.
    // They remain here so existing `bb_patterns scope=all` output stays valid
    // while callers migrate to canonical detectors.
    if (opts.includeFramework) {
      patterns.push({
        type: "framework_pattern_stub",
        confidence: 0.0,
        location: { file: "", line: 0 },
        description: "Framework-pattern detection has not been migrated to canonical provenance-bearing rules; use canonical taxonomies instead.",
        severity: "info",
        suggestion: "Use `bb_patterns scope=orphaned` or `bb_security` for evidence-bearing findings until framework rules migrate.",
        evidence: [],
      })
    }

    if (opts.includeAntiPatterns) {
      patterns.push({
        type: "anti_pattern_stub",
        confidence: 0.0,
        location: { file: "", line: 0 },
        description: "Anti-pattern heuristics have not been migrated to canonical evidence form; use canonical rules instead.",
        severity: "info",
        suggestion: "Use `bb_security` for evidence-bearing anti-pattern results; legacy regex heuristics are retained only for compatibility.",
        evidence: [],
      })
    }

    // 3. Statistics mapping (canonical-safe aggregation).
    const byType: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    let confidenceSum = 0
    for (const pattern of patterns) {
      byType[pattern.type] = (byType[pattern.type] || 0) + 1
      bySeverity[pattern.severity] = (bySeverity[pattern.severity] || 0) + 1
      confidenceSum += pattern.confidence
    }

    return {
      patterns: patterns.slice(0, opts.maxResults),
      statistics: {
        totalFound: patterns.length,
        byType,
        bySeverity,
        averageConfidence: patterns.length ? confidenceSum / patterns.length : 0,
      },
      recommendations: [],
    }
  }
}
