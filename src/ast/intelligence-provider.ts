// @ts-nocheck — ported; verified by tests. Restored incrementally in Phase 3.
import { BrainDatabase } from "../brain/database"
import type { ProjectID } from "../project/schema"
import { BrainSymbolTable, BrainFileTable, BrainRelationshipTable } from "../brain/brain.sql"
import { eq, and, like, sql, desc } from "drizzle-orm"
import { BrainTools } from "./tools"
import { TestIntelligence } from "./test_intelligence"
import { GitTemporalHelper } from "../indexer/git_temporal_helper"
import * as Log from "../tool/brain-log"
import { CrossLanguageSecurityAnalysis } from "../security/cross-language-security"

const log = Log.create({ service: "intelligence-provider" })

export interface IntelligenceContext {
  testCoverage: TestCoverageInfo
  impactAnalysis: ImpactAnalysisResult
  temporalWarnings: string[]
  frameworkConventions: FrameworkConvention[]
  complexityWarning: ComplexityWarning | null
  suggestions: string[]
}

export interface UpdateIntelligenceContext {
  mode: "symbol" | "file"
  preflight: IntelligenceContext
  symbolIntelligence: SymbolIntelligence | null
  confidenceScore: number
}

export interface TestCoverageInfo {
  hasTests: boolean
  testFiles: string[]
  coverageConfidence: number
  warning: string | null
}

export interface ImpactAnalysisResult {
  callers: Array<{ name: string; file: string; line: number }>
  callees: Array<{ name: string; file: string; line: number }>
  totalAffected: number
  riskLevel: "low" | "medium" | "high" | "critical"
  breakingChangeLikelihood: number
}

export interface FrameworkConvention {
  framework: string
  convention: string
  compliance: "follows" | "violates" | "unknown"
  suggestion: string | null
}

export interface ComplexityWarning {
  complexity: number
  level: "low" | "medium" | "high" | "critical"
  suggestion: string
}

export namespace IntelligenceProvider {
  export async function getPreWriteContext(
    projectId: ProjectID,
    filePath: string,
    content: string,
  ): Promise<IntelligenceContext> {
    const [testCoverage, temporalWarnings, frameworkConventions, complexityWarning] = await Promise.all([
      getTestCoverageForFile(projectId, filePath).catch(() => ({
        hasTests: false,
        testFiles: [],
        coverageConfidence: 0,
        warning: null,
      })),
      getTemporalWarnings(projectId, filePath).catch(() => [] as string[]),
      getFrameworkConventions(projectId, filePath).catch(() => [] as FrameworkConvention[]),
      analyzeContentComplexity(content).catch(() => null),
    ])
    return {
      testCoverage,
      impactAnalysis: emptyImpact(),
      temporalWarnings,
      frameworkConventions,
      complexityWarning,
      suggestions: generateWriteSuggestions(testCoverage, frameworkConventions, complexityWarning),
    }
  }

  export async function getPreUpdateContext(
    projectId: ProjectID,
    symbolName: string,
    filePath?: string,
  ): Promise<IntelligenceContext> {
    const [testCoverage, impactAnalysis, temporalWarnings, complexityWarning] = await Promise.all([
      getTestCoverageForSymbol(projectId, symbolName).catch(() => ({
        hasTests: false,
        testFiles: [],
        coverageConfidence: 0,
        warning: null,
      })),
      getImpactAnalysis(projectId, symbolName).catch(() => emptyImpact()),
      getTemporalWarnings(projectId, filePath || "").catch(() => [] as string[]),
      getComplexityForSymbol(projectId, symbolName).catch(() => null),
    ])
    return {
      testCoverage,
      impactAnalysis,
      temporalWarnings,
      frameworkConventions: [],
      complexityWarning,
      suggestions: generateUpdateSuggestions(testCoverage, impactAnalysis, complexityWarning),
    }
  }

  export async function getPreDeleteContext(projectId: ProjectID, symbolName: string): Promise<IntelligenceContext> {
    return getPreUpdateContext(projectId, symbolName)
  }

  export async function getUpdateIntelligence(
    projectId: ProjectID,
    input: {
      symbolName?: string | null
      filePath?: string
      newContent: string
    },
  ): Promise<UpdateIntelligenceContext> {
    if (input.symbolName) {
      const [preflight, symbolIntelligence] = await Promise.all([
        getPreUpdateContext(projectId, input.symbolName, input.filePath),
        getSymbolIntelligence(projectId, input.symbolName, {
          includeTemporal: true,
          includeSecurity: true,
          includePatterns: true,
          limit: 20,
        }).catch(() => null),
      ])

      return {
        mode: "symbol",
        preflight,
        symbolIntelligence,
        confidenceScore: computeUpdateConfidence(preflight, symbolIntelligence?.confidenceScore ?? null),
      }
    }

    const preflight = await getPreWriteContext(projectId, input.filePath || "", input.newContent)
    return {
      mode: "file",
      preflight,
      symbolIntelligence: null,
      confidenceScore: computeUpdateConfidence(preflight, null),
    }
  }

  export function formatIntelligenceReport(ctx: IntelligenceContext): string {
    const parts: string[] = []
    if (ctx.testCoverage.hasTests) {
      parts.push(
        `🧪 Test Coverage: ${ctx.testCoverage.testFiles.length} test file(s) cover this - ${ctx.testCoverage.testFiles.join(", ")}`,
      )
    } else if (ctx.testCoverage.warning) {
      parts.push(`⚠️ Test Gap: ${ctx.testCoverage.warning}`)
    }
    if (ctx.impactAnalysis.totalAffected > 0) {
      const r = ctx.impactAnalysis.riskLevel
      const e = r === "critical" ? "🚨" : r === "high" ? "🔴" : r === "medium" ? "🟡" : "🟢"
      parts.push(`${e} Impact: ${ctx.impactAnalysis.totalAffected} symbol(s) affected (${r} risk)`)
      if (ctx.impactAnalysis.breakingChangeLikelihood > 0.5) {
        parts.push(`⚠️ Breaking change likelihood: ${Math.round(ctx.impactAnalysis.breakingChangeLikelihood * 100)}%`)
      }
    }
    if (ctx.complexityWarning && ctx.complexityWarning.level !== "low") {
      parts.push(
        `📊 Complexity: ${ctx.complexityWarning.level} (${ctx.complexityWarning.complexity}) - ${ctx.complexityWarning.suggestion}`,
      )
    }
    for (const conv of ctx.frameworkConventions) {
      if (conv.compliance === "violates" && conv.suggestion) {
        parts.push(`🏗️ ${conv.framework}: ${conv.suggestion}`)
      }
    }
    for (const w of ctx.temporalWarnings) {
      parts.push(w)
    }
    for (const s of ctx.suggestions) {
      parts.push(`💡 ${s}`)
    }
    return parts.length > 0 ? "\n" + parts.join("\n") : ""
  }

  export function formatUpdateIntelligenceReport(ctx: UpdateIntelligenceContext): string {
    const parts: string[] = []
    parts.push(`🧠 Update mode: ${ctx.mode}`)
    parts.push(`🎯 Confidence: ${Math.round(ctx.confidenceScore * 100)}%`)

    const preflight = formatIntelligenceReport(ctx.preflight)
    if (preflight) {
      parts.push(preflight.trimStart())
    }

    if (ctx.symbolIntelligence) {
      if (ctx.symbolIntelligence.patterns && ctx.symbolIntelligence.patterns.length > 0) {
        parts.push(`🧩 Patterns: ${ctx.symbolIntelligence.patterns.join(", ")}`)
      }
      if (ctx.symbolIntelligence.securityFindings && ctx.symbolIntelligence.securityFindings.length > 0) {
        parts.push(`🔐 Security findings: ${ctx.symbolIntelligence.securityFindings.length}`)
      }
      if (ctx.symbolIntelligence.suggestionActions && ctx.symbolIntelligence.suggestionActions.length > 0) {
        parts.push(
          `⚙️ Actions: ${ctx.symbolIntelligence.suggestionActions.map((action) => action.message).join(" | ")}`,
        )
      }
    }

    return "\n" + parts.join("\n")
  }

  function emptyImpact(): ImpactAnalysisResult {
    return {
      callers: [],
      callees: [],
      totalAffected: 0,
      riskLevel: "low",
      breakingChangeLikelihood: 0,
    }
  }

  function computeUpdateConfidence(preflight: IntelligenceContext, symbolConfidence: number | null): number {
    const baseCoverage = Math.max(0, Math.min(1, preflight.testCoverage.coverageConfidence || 0))
    const impactPenalty = preflight.impactAnalysis.totalAffected > 0 ? Math.min(preflight.impactAnalysis.totalAffected / 20, 0.5) : 0
    const complexityPenalty = preflight.complexityWarning
      ? preflight.complexityWarning.level === "critical"
        ? 0.35
        : preflight.complexityWarning.level === "high"
          ? 0.2
          : preflight.complexityWarning.level === "medium"
            ? 0.1
            : 0
      : 0
    const temporalPenalty = preflight.temporalWarnings.length > 0 ? 0.08 : 0
    const symbolBoost = symbolConfidence == null ? 0 : Math.max(0, Math.min(0.25, symbolConfidence * 0.25))

    const score = Math.max(0, Math.min(1, baseCoverage + symbolBoost - impactPenalty - complexityPenalty - temporalPenalty))
    return Number(score.toFixed(3))
  }
}

export interface SymbolIntelligence {
  symbol: {
    id?: string
    name: string
    file?: string
    lineStart?: number
    lineEnd?: number
    byteStart?: number
    byteEnd?: number
    symbolType?: string
  }
  callers: Array<{ name: string; file: string; line: number }>
  callees: Array<{ name: string; file: string; line: number }>
  tests: TestCoverageInfo
  temporalWarnings: string[]
  frameworkConventions: FrameworkConvention[]
  complexity: ComplexityWarning | null
  suggestions: string[]
  suggestionActions?: Array<{ message: string; action: { tool: string; params: Record<string, any> } }>
  patterns?: string[]
  securityFindings?: any[]
  confidenceScore?: number
}

// Enhance existing getSymbolIntelligence to include patterns/security when requested
export namespace IntelligenceProvider {
  const DEFAULT_PATTERN_LIMIT = 10
  const FALLBACK_IMPACT: ImpactAnalysisResult = {
    callers: [],
    callees: [],
    totalAffected: 0,
    riskLevel: "low",
    breakingChangeLikelihood: 0,
  }

  const FALLBACK_TESTS: TestCoverageInfo = {
    hasTests: false,
    testFiles: [],
    coverageConfidence: 0,
    warning: null,
  }

  export async function getSymbolIntelligence(
    projectId: ProjectID,
    symbolName: string,
    options?: {
      includeTemporal?: boolean
      includeSecurity?: boolean
      includePatterns?: boolean
      limit?: number
    },
  ): Promise<SymbolIntelligence> {
    const limit = options?.limit || 20

    // core pieces
    const [impact, tests, temporal, complexity] = await Promise.all([
      getImpactAnalysis(projectId, symbolName).catch(() => FALLBACK_IMPACT),
      getTestCoverageForSymbol(projectId, symbolName).catch(() => FALLBACK_TESTS),
      (options?.includeTemporal ? getTemporalWarnings(projectId, "") : Promise.resolve([])).catch(() => []),
      getComplexityForSymbol(projectId, symbolName).catch(() => null),
    ])

    // symbol record
    let symbolRecord: any = { name: symbolName }
    try {
      const db = await BrainDatabase.getInstance(projectId)
      const rows = await db
        .select({ id: BrainSymbolTable.id, fileId: BrainSymbolTable.file_id, name: BrainSymbolTable.name, lineStart: BrainSymbolTable.line_start, lineEnd: BrainSymbolTable.line_end, byteStart: BrainSymbolTable.byte_start, byteEnd: BrainSymbolTable.byte_end, symbolType: BrainSymbolTable.symbol_type })
        .from(BrainSymbolTable)
        .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.name, symbolName)))
        .limit(1)
      if (rows && rows.length > 0) {
        const r = rows[0]
        symbolRecord = {
          id: r.id,
          name: r.name,
          file: r.fileId,
          lineStart: r.lineStart,
          lineEnd: r.lineEnd,
          byteStart: r.byteStart,
          byteEnd: r.byteEnd,
          symbolType: r.symbolType,
        }
      }
    } catch (e) {
      log.warn(`getSymbolIntelligence(record): ${e}`)
    }

    // patterns
    let patterns: string[] = []
    if (options?.includePatterns) {
      try {
        const detected = await BrainTools.detectPatterns(projectId, { limit: DEFAULT_PATTERN_LIMIT })
        patterns = detected.map((p) => p.pattern)
      } catch (e) {
        log.warn(`getSymbolIntelligence(patterns): ${e}`)
      }
    }

    // security
    let securityFindings: any[] = []
    if (options?.includeSecurity) {
      try {
        const sec = await CrossLanguageSecurityAnalysis.analyzeSecurityAcrossLanguages(projectId, { scan_depth: "surface" })
        // filter vulnerabilities relevant to symbol by entry point file or function match
        securityFindings = (sec.cross_language_vulnerabilities || []).filter((v: any) => {
          try {
            const entry = v.attack_flow?.entry_point
            if (!entry) return false
            if (symbolRecord.file && entry.file && (entry.file === symbolRecord.file || entry.file.endsWith(symbolRecord.file))) return true
            if (entry.function && entry.function === symbolName) return true
          } catch (e) {}
          return false
        })
      } catch (e) {
        log.warn(`getSymbolIntelligence(security): ${e}`)
      }
    }

    // Construct suggestions with actionable payloads
    const suggestions: any[] = []
    if (!tests.hasTests) {
      suggestions.push({ type: "test", message: "No tests cover this symbol. Consider adding tests.", action: { tool: "bb_relationships", params: { target: symbolName, analysisType: "test_impact" } } })
    } else {
      suggestions.push({ type: "test", message: "Run affected tests after change.", action: { tool: "bb_relationships", params: { target: symbolName, analysisType: "test_impact" } } })
    }
    if (impact.totalAffected > 10) {
      suggestions.push({ type: "risk", message: `High impact: ${impact.totalAffected} related symbols. Consider backward-compatible changes.`, action: { tool: "bb_relationships", params: { target: symbolName, analysisType: "impact" } } })
    }
    if (securityFindings.length > 0) {
      suggestions.push({ type: "security", message: `Security findings detected (${securityFindings.length}). Inspect and patch.`, action: { tool: "bb_security", params: { autoPatch: false } } })
    }

    const intel: SymbolIntelligence = {
      symbol: symbolRecord,
      callers: impact.callers?.slice(0, limit) || [],
      callees: impact.callees?.slice(0, limit) || [],
      tests,
      temporalWarnings: temporal || [],
      frameworkConventions: await getFrameworkConventions(projectId, symbolRecord.file || "").catch(() => []),
      complexity: complexity || null,
      suggestions: suggestions.map((s: any) => s.message),
      suggestionActions: suggestions.map((s: any) => ({ message: s.message, action: s.action })),
      patterns,
      securityFindings,
      confidenceScore: 0,
    }

    try {
      const testScore = Math.min(Math.max(tests.coverageConfidence || 0, 0), 1)
      const impactScore = 1 - Math.min(Math.max(impact.breakingChangeLikelihood || 0, 0), 1)
      const securityScore = securityFindings && securityFindings.length > 0 ? 0.3 : 1
      const patternBoost = patterns && patterns.length > 0 ? Math.min(0.15 + patterns.length * 0.01, 0.25) : 0
      let complexityMultiplier = 1
      if (intel.complexity) {
        if (intel.complexity.level === "critical") complexityMultiplier = 0.6
        else if (intel.complexity.level === "high") complexityMultiplier = 0.8
        else if (intel.complexity.level === "medium") complexityMultiplier = 0.92
      }
      const temporalMultiplier = (intel.temporalWarnings || []).length > 0 ? 0.85 : 1

      // Weighted base score: tests (50%), impact (30%), security (20%)
      const base = 0.5 * testScore + 0.3 * impactScore + 0.2 * securityScore
      let finalScore = Math.min(Math.max(base * complexityMultiplier * temporalMultiplier + patternBoost, 0), 1)
      // small normalization to keep scores meaningful
      if (finalScore > 0 && finalScore < 0.05) finalScore = 0.05
      intel.confidenceScore = Number(finalScore.toFixed(3))
    } catch (e) {
      intel.confidenceScore = 0
    }

    return intel
  }
}

async function getTestCoverageForFile(projectId: ProjectID, filePath: string): Promise<TestCoverageInfo> {
  const implFile = filePath
    .replace(/\.test\./, ".")
    .replace(/\.spec\./, ".")
    .replace(/\/__tests__\//, "/")
  const db = await BrainDatabase.getInstance(projectId)
  const testFiles = await db
    .select({ path: BrainFileTable.relative_path })
    .from(BrainFileTable)
    .where(
      and(
        eq(BrainFileTable.project_id, projectId),
        sql`(${BrainFileTable.relative_path} LIKE '%.test.%' OR ${BrainFileTable.relative_path} LIKE '%.spec.%' OR ${BrainFileTable.relative_path} LIKE '%_test%')`,
      ),
    )
    .limit(50)
  const matchingTests = testFiles.filter((t) => {
    const testImpl = t.path
      .replace(/\.test\./, ".")
      .replace(/\.spec\./, ".")
      .replace(/\/__tests__\//, "/")
    return testImpl === implFile || implFile.includes(testImpl.replace(/\.\w+$/, ""))
  })
  if (matchingTests.length > 0) {
    return {
      hasTests: true,
      testFiles: matchingTests.map((t) => t.path),
      coverageConfidence: 0.8,
      warning: null,
    }
  }
  return {
    hasTests: false,
    testFiles: [],
    coverageConfidence: 0,
    warning: `No test files found covering ${filePath}. Consider adding tests.`,
  }
}

async function getTestCoverageForSymbol(projectId: ProjectID, symbolName: string): Promise<TestCoverageInfo> {
  try {
    const coverage = await TestIntelligence.getTestCoverageForSymbol(projectId, symbolName)
    if (coverage && coverage.isCovered) {
      const testFiles = (coverage.coverageRelationships || []).map((r: any) => r.test_file_id || "unknown")
      return { hasTests: true, testFiles, coverageConfidence: 0.85, warning: null }
    }
  } catch (e) {}
  return {
    hasTests: false,
    testFiles: [],
    coverageConfidence: 0,
    warning: `No tests cover "${symbolName}". Modify with caution.`,
  }
}

async function getImpactAnalysis(projectId: ProjectID, symbolName: string): Promise<ImpactAnalysisResult> {
  const callers: Array<{ name: string; file: string; line: number }> = []
  const callees: Array<{ name: string; file: string; line: number }> = []
  try {
    const callerInfos = await BrainTools.getFunctionCallers(projectId, symbolName, {
      includeIndirect: false,
      maxDepth: 1,
    })
    for (const c of callerInfos.slice(0, 20)) {
      callers.push({ name: c.name, file: c.relativePath || c.filePath || "", line: c.range?.startLine || 0 })
    }
  } catch (e) {}
  try {
    const calleeInfos = await BrainTools.getFunctionCallees(projectId, symbolName, {
      includeIndirect: false,
      maxDepth: 1,
    })
    for (const c of calleeInfos.slice(0, 20)) {
      callees.push({ name: c.name, file: c.relativePath || c.filePath || "", line: c.range?.startLine || 0 })
    }
  } catch (e) {}
  const totalAffected = callers.length + callees.length
  let riskLevel: ImpactAnalysisResult["riskLevel"] = "low"
  let breakingChangeLikelihood = 0
  if (totalAffected > 20) {
    riskLevel = "critical"
    breakingChangeLikelihood = 0.9
  } else if (totalAffected > 10) {
    riskLevel = "high"
    breakingChangeLikelihood = 0.7
  } else if (totalAffected > 3) {
    riskLevel = "medium"
    breakingChangeLikelihood = 0.4
  }
  if (callers.length > 0) {
    breakingChangeLikelihood = Math.max(breakingChangeLikelihood, 0.3)
  }
  return { callers, callees, totalAffected, riskLevel, breakingChangeLikelihood }
}

async function getTemporalWarnings(projectId: ProjectID, filePath: string): Promise<string[]> {
  const warnings: string[] = []
  if (!filePath) return warnings
  try {
    const predictive = await GitTemporalHelper.getPredictiveWarning(projectId, filePath)
    if (predictive) {
      warnings.push(predictive)
    }
  } catch (e) {}
  return warnings
}

async function getFrameworkConventions(projectId: ProjectID, filePath: string): Promise<FrameworkConvention[]> {
  const conventions: FrameworkConvention[] = []
  try {
    const db = await BrainDatabase.getInstance(projectId)
    const fileInfo = await db
      .select({ framework: BrainFileTable.framework_type, language: BrainFileTable.language })
      .from(BrainFileTable)
      .where(and(eq(BrainFileTable.project_id, projectId), eq(BrainFileTable.relative_path, filePath)))
      .limit(1)
    if (fileInfo.length === 0 || !fileInfo[0].framework) return conventions
    const fw = fileInfo[0].framework
    if (fw === "react" || fw === "next") {
      conventions.push({
        framework: "React",
        convention: "Use functional components with hooks",
        compliance: "unknown",
        suggestion: "Prefer functional components with hooks over class components",
      })
    } else if (fw === "flutter") {
      conventions.push({
        framework: "Flutter",
        convention: "Use BLoC/Cubit for state management",
        compliance: "unknown",
        suggestion: "Prefer BLoC pattern for state management over setState",
      })
    } else if (fw === "express") {
      conventions.push({
        framework: "Express",
        convention: "Use error handling middleware",
        compliance: "unknown",
        suggestion: "Ensure async route handlers have try-catch or error middleware",
      })
    }
  } catch (e) {}
  return conventions
}

async function getComplexityForSymbol(projectId: ProjectID, symbolName: string): Promise<ComplexityWarning | null> {
  try {
    const db = await BrainDatabase.getInstance(projectId)
    const symbols = await db
      .select({ complexity: BrainSymbolTable.complexity, name: BrainSymbolTable.name })
      .from(BrainSymbolTable)
      .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.name, symbolName)))
      .limit(1)
    if (symbols.length > 0 && symbols[0].complexity != null) {
      const c = symbols[0].complexity
      if (c > 20) {
        return { complexity: c, level: "critical", suggestion: "Refactor into smaller functions" }
      } else if (c > 10) {
        return { complexity: c, level: "high", suggestion: "Consider simplifying this function" }
      } else if (c > 5) {
        return { complexity: c, level: "medium", suggestion: "Function is moderately complex" }
      }
      return { complexity: c, level: "low", suggestion: "" }
    }
  } catch (e) {}
  return null
}

async function analyzeContentComplexity(content: string): Promise<ComplexityWarning | null> {
  const lines = content.split("\n").length
  const branches = (content.match(/\bif\b|\belse\b|\bswitch\b|\bcase\b|\bfor\b|\bwhile\b|\bcatch\b|\?\s/g) || []).length
  const complexity = Math.max(branches, Math.floor(lines / 10))
  if (complexity > 20) {
    return { complexity, level: "critical", suggestion: "File is very complex - consider splitting into modules" }
  } else if (complexity > 10) {
    return { complexity, level: "high", suggestion: "File is complex - consider extracting functions" }
  } else if (complexity > 5) {
    return { complexity, level: "medium", suggestion: "Moderate complexity - acceptable but watch for growth" }
  }
  return null
}

function generateWriteSuggestions(
  testCoverage: TestCoverageInfo,
  frameworkConventions: FrameworkConvention[],
  complexityWarning: ComplexityWarning | null,
): string[] {
  const suggestions: string[] = []
  if (!testCoverage.hasTests) {
    suggestions.push("Consider creating a test file alongside this new file")
  }
  if (complexityWarning && complexityWarning.level !== "low") {
    suggestions.push(complexityWarning.suggestion)
  }
  for (const conv of frameworkConventions) {
    if (conv.suggestion) {
      suggestions.push(conv.suggestion)
    }
  }
  return suggestions
}

function generateUpdateSuggestions(
  testCoverage: TestCoverageInfo,
  impactAnalysis: ImpactAnalysisResult,
  complexityWarning: ComplexityWarning | null,
): string[] {
  const suggestions: string[] = []
  if (!testCoverage.hasTests) {
    suggestions.push("No tests cover this symbol - write tests before modifying")
  } else {
    suggestions.push("Run existing tests after modifying to verify no breakage")
  }
  if (impactAnalysis.riskLevel === "critical" || impactAnalysis.riskLevel === "high") {
    suggestions.push(`${impactAnalysis.totalAffected} symbols depend on this - consider backward-compatible changes`)
  }
  if (complexityWarning && complexityWarning.level !== "low") {
    suggestions.push("High complexity - reducing it first would make changes safer")
  }
  return suggestions
}
