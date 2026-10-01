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

    // 3. Rank the whole census, then slice. M57.T3: the orphan page is BOUNDED
    // at the scan (the old call used maxResults: Number.MAX_SAFE_INTEGER, which
    // materialized every finding object with evidence arrays on for a display of
    // at most maxResults items). The full census comes from the summary
    // aggregates.
    //
    //    But the bound was applied to the CONCATENATION, orphan branch first:
    //
    //      for (const finding of orphanReport.findings) patterns.push(...)
    //      for (const finding of ruleFindings)        patterns.push(...)
    //      displayedPatterns = patterns.slice(0, opts.maxResults)
    //
    //    So on any repository with more orphan candidates than maxResults, the
    //    anti-pattern branch was sliced out of the response entirely — 806
    //    high-complexity functions, 214 god classes, 18 long-parameter lists and
    //    20 framework findings on a 45,018-symbol index, all invisible, while
    //    includeAntiPatterns defaulted to true and the registry advertised "the
    //    full pattern scan". Ranking the merged census fixes it: a 0.9 god
    //    class outranks a 0.7 dead helper, which is also the order a reader
    //    wants them in.
    const severityRank = { error: 0, warning: 1, info: 2 } as const
    const orphanPage = patterns.filter((p) => String(p.type).startsWith("orphaned_"))
    const rulePage = patterns.filter((p) => !String(p.type).startsWith("orphaned_"))
    patterns.length = 0
    const ranked = [...orphanPage, ...rulePage].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence
      const sa = severityRank[a.severity as keyof typeof severityRank] ?? 3
      const sb = severityRank[b.severity as keyof typeof severityRank] ?? 3
      if (sa !== sb) return sa - sb
      return String(a.location?.file ?? "").localeCompare(String(b.location?.file ?? ""))
    })
    patterns.push(...ranked)

    // Statistics over the census. The orphan contribution comes from the
    // candidate census; the rule contribution from the returned rule findings.
    // The orphan PAGE entries are census-covered, so the loop counts only
    // non-orphan findings — otherwise the page double-counts.
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

    // M69: a class the caller EXPLICITLY asked for must not vanish because the
    // page filled up with another class.
    //
    // MEASURED on rebar3/apps with the repo's own corpus gate, which asks for
    // `{ scope: "all", includeFramework: true, confidenceThreshold: 0.51 }`:
    //
    //   framework types in the index : Erlang, cowboy, eunit, otp, rebar3  (5)
    //   framework findings on the page: 0
    //
    // The ranking above is by confidence, and an orphan candidate carries up to
    // 0.7 while a framework finding carries a fixed 0.6. With more than
    // `maxResults` orphan candidates scoring above 0.6, every framework and
    // anti-pattern finding is displaced off the page — not filtered out by the
    // threshold, never rendered at all. `graphql-js` and `cabal` emit 4 and 2
    // respectively; only the corpus with a deep orphan census loses them.
    //
    // So a caller who passed `includeFramework: true` received none, with nothing
    // in the answer to distinguish "no framework here" from "the page was full".
    // The census line reports totals, so the information existed — but the caller
    // asked for a class and got none of it, which is the thing that breaks an
    // agent deciding whether to raise `limit` or accept the answer.
    //
    // The fix keeps the budget and the ranking: the page is filled as ranked, and
    // then, for each class the caller requested that has findings but no
    // representation, its highest-ranked finding is promoted in place of the
    // lowest-ranked item on the page. One slot per requested class, not a quota —
    // a repository with 900 god classes still returns one god class, and a caller
    // still gets its frameworks.
    const REQUESTED = [
      { on: opts.includeOrphaned !== false, match: (t: string) => t.startsWith("orphaned_") },
      { on: opts.includeFramework !== false, match: (t: string) => t === "framework-detected" },
      {
        on: opts.includeAntiPatterns !== false,
        match: (t: string) => ["high-complexity-function", "long-parameter-list", "god-class"].includes(t),
      },
    ]
    const page = patterns.slice(0, opts.maxResults)
    if (patterns.length > opts.maxResults && page.length > 0) {
      for (const req of REQUESTED) {
        if (!req.on) continue
        const onPage = page.some((p) => req.match(String(p.type)))
        if (onPage) continue
        const best = patterns.find((p) => req.match(String(p.type)))
        if (!best) continue
        // Displace the lowest-ranked page item that is NOT the sole
        // representative of another requested class, so one promotion cannot
        // silence a different one.
        let victim = -1
        for (let i = page.length - 1; i >= 0; i--) {
          const others = REQUESTED.filter((r) => r.on && r.match(String(page[i].type)))
          if (others.length > 1) continue
          if (page.filter((p, j) => j < i && others.some((r) => r.match(String(p.type)))).length > 0) continue
          victim = i
          break
        }
        if (victim === -1) continue
        page[victim] = best
      }
      page.sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence
        const sa = severityRank[a.severity as keyof typeof severityRank] ?? 3
        const sb = severityRank[b.severity as keyof typeof severityRank] ?? 3
        if (sa !== sb) return sa - sb
        return String(a.location?.file ?? "").localeCompare(String(b.location?.file ?? ""))
      })
    }
    const displayedPatterns = page
    const censusTotal = orphanCandidates + ruleFindingCount
    return {
      patterns: displayedPatterns,
      statistics: {
        // The census, not the page. This field was the returned page's length
        // while byType / bySeverity / averageConfidence beside it all described
        // the census, so one object reported two different universes and the
        // handler printed the page length under the words "patterns (N)".
        // With a default limit of 20 the tool fetched 100, printed 20, and
        // reported 100. `scan.displayed` is the page length.
        totalFound: censusTotal,
        byType,
        bySeverity,
        averageConfidence: censusTotal > 0 ? confidenceSum / censusTotal : 0,
      },
      recommendations: [],
      scan: {
        candidatesEvaluated: censusTotal,
        findingsBeforeDisplayLimit: censusTotal,
        displayed: displayedPatterns.length,
        truncated: censusTotal > displayedPatterns.length,
      },
    }
  }
}
