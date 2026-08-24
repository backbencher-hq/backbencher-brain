import { BrainDatabase } from "../brain/database"
import type { ProjectID } from "../project/schema"
import * as Log from "../tool/brain-log"
import { eq, and, or, sql, inArray, like, desc, count } from "drizzle-orm"
import {
  BrainSymbolTable,
  BrainRelationshipTable,
  BrainFileTable,
  BrainImportTable,
} from "../brain/brain.sql"
import { GraphIntelligence } from "./graph"

const log = Log.create({ service: "pattern-recognition" })

// Universal Pattern Recognition System
// This implements the pattern detection algorithms inspired by ProxiCall Brain's translate.dart
// but designed for ANY programming language, not just Dart/Flutter

export namespace PatternRecognition {
  // Core pattern types that we can detect across any language
  export enum PatternType {
    // Orphaned code patterns (universal across languages)
    OrphanedFunction = "orphaned_function",
    OrphanedClass = "orphaned_class",
    OrphanedFile = "orphaned_file",
    UnusedImport = "unused_import",
    DeadCode = "dead_code",

    // Architectural patterns (framework-agnostic)
    Singleton = "singleton",
    Factory = "factory",
    Observer = "observer",
    Repository = "repository",
    Adapter = "adapter",

    // Framework-specific patterns (auto-detected by framework)
    ReactHook = "react_hook",
    ReactComponent = "react_component",
    BlocPattern = "bloc_pattern",
    MVCController = "mvc_controller",
    MVVMViewModel = "mvvm_viewmodel",

    // Anti-patterns and code smells
    GodClass = "god_class",
    LongMethod = "long_method",
    DeepInheritance = "deep_inheritance",
    CircularDependency = "circular_dependency",
    TightCoupling = "tight_coupling",

    // Security and quality patterns
    SecurityVulnerability = "security_vulnerability",
    PerformanceBottleneck = "performance_bottleneck",
    TestSmell = "test_smell",
    DocumentationGap = "documentation_gap",
  }

  export interface PatternDetectionResult {
    pattern: PatternType
    confidence: number
    location: {
      file: string
      startLine: number
      endLine?: number
      symbol?: string
    }
    description: string
    severity: "info" | "warning" | "error" | "critical"
    suggestion?: string
    evidence: Array<{
      type: "ast_analysis" | "relationship_analysis" | "complexity_metrics" | "naming_convention"
      description: string
      confidence: number
    }>
    metadata: Record<string, any>
  }

  export interface PatternAnalysisOptions {
    patterns?: PatternType[]
    includeFrameworkPatterns?: boolean
    includeAntiPatterns?: boolean
    confidenceThreshold?: number
    maxResults?: number
    focusFiles?: string[]
  }

  // 🧠 STEP 5.1: Universal Orphaned Detection Algorithms
  // This is the core innovation from translate.dart - detecting unused/orphaned code
  export async function detectOrphanedCode(
    projectId: ProjectID,
    options: PatternAnalysisOptions = {},
  ): Promise<PatternDetectionResult[]> {
    const opts = {
      patterns: [
        PatternType.OrphanedFunction,
        PatternType.OrphanedClass,
        PatternType.OrphanedFile,
        PatternType.UnusedImport,
        PatternType.DeadCode,
      ],
      confidenceThreshold: 0.7,
      maxResults: 100,
      ...options,
    }

    log.info("starting orphaned code detection", { projectId, options: opts })

    const db = await BrainDatabase.getInstance(projectId)
    const results: PatternDetectionResult[] = []

    // 1. Detect orphaned functions (functions never called)
    if (opts.patterns.includes(PatternType.OrphanedFunction)) {
      const orphanedFunctions = await detectOrphanedFunctions(db, projectId)
      results.push(...orphanedFunctions)
    }

    // 2. Detect orphaned classes (classes never instantiated or referenced)
    if (opts.patterns.includes(PatternType.OrphanedClass)) {
      const orphanedClasses = await detectOrphanedClasses(db, projectId)
      results.push(...orphanedClasses)
    }

    // 3. Detect orphaned files (files with no incoming dependencies)
    if (opts.patterns.includes(PatternType.OrphanedFile)) {
      const orphanedFiles = await detectOrphanedFiles(db, projectId)
      results.push(...orphanedFiles)
    }

    // 4. Detect unused imports
    if (opts.patterns.includes(PatternType.UnusedImport)) {
      const unusedImports = await detectUnusedImports(db, projectId)
      results.push(...unusedImports)
    }

    // Filter by confidence and limit results
    const filteredResults = results
      .filter((r) => r.confidence >= opts.confidenceThreshold)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, opts.maxResults)

    log.info("orphaned code detection completed", {
      projectId,
      totalFound: results.length,
      highConfidence: filteredResults.length,
    })

    return filteredResults
  }

  // 🧠 STEP 5.2: Framework-Specific Pattern Detection
  export async function detectFrameworkPatterns(
    projectId: ProjectID,
    options: PatternAnalysisOptions = {},
  ): Promise<PatternDetectionResult[]> {
    const db = await BrainDatabase.getInstance(projectId)
    const results: PatternDetectionResult[] = []

    // Auto-detect project frameworks
    const frameworks = await detectProjectFrameworks(db, projectId)

    for (const framework of frameworks) {
      switch (framework) {
        case "react":
          results.push(...(await detectReactPatterns(db, projectId)))
          break
        case "flutter":
          results.push(...(await detectFlutterBlocPatterns(db, projectId)))
          break
        case "spring":
          results.push(...(await detectSpringMVCPatterns(db, projectId)))
          break
        case "express":
          results.push(...(await detectExpressPatterns(db, projectId)))
          break
        // Add more frameworks as needed
      }
    }

    return results
  }

  // 🧠 STEP 5.3: Cross-Language Logical Error Detection
  export async function detectLogicalErrors(
    projectId: ProjectID,
    options: PatternAnalysisOptions = {},
  ): Promise<PatternDetectionResult[]> {
    const db = await BrainDatabase.getInstance(projectId)
    const results: PatternDetectionResult[] = []

    // Universal logical error patterns that work across languages
    results.push(...(await detectNullPointerRisks(db, projectId)))
    results.push(...(await detectInfiniteLoops(db, projectId)))
    results.push(...(await detectResourceLeaks(db, projectId)))
    results.push(...(await detectRaceConditions(db, projectId)))
    results.push(...(await detectInconsistentState(db, projectId)))
    results.push(...(await detectLongMethods(db, projectId))) // Added Long Method detection

    return results
  }

  // 🧠 STEP 5.4: Architectural Violation Detection
  export async function detectArchitecturalViolations(
    projectId: ProjectID,
    options: PatternAnalysisOptions = {},
  ): Promise<PatternDetectionResult[]> {
    const db = await BrainDatabase.getInstance(projectId)
    const results: PatternDetectionResult[] = []

    // Universal architectural violations
    results.push(...(await detectLayerViolations(db, projectId)))
    results.push(...(await detectDependencyViolations(db, projectId)))
    results.push(...(await detectSingleResponsibilityViolations(db, projectId)))
    results.push(...(await detectOpenClosedViolations(db, projectId)))

    return results
  }

  // Implementation functions for orphaned code detection
  async function detectOrphanedFunctions(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Find functions that have no incoming "calls" relationships
    const callerCounts = db
      .select({
        target_id: BrainRelationshipTable.target_symbol_id,
        count: count(BrainRelationshipTable.id).as("count"),
      })
      .from(BrainRelationshipTable)
      .where(
        and(eq(BrainRelationshipTable.project_id, projectId), eq(BrainRelationshipTable.relationship_type, "calls")),
      )
      .groupBy(BrainRelationshipTable.target_symbol_id)
      .as("caller_counts")

    const functionsWithoutCallers = await db
      .select({
        symbol: BrainSymbolTable,
        file: BrainFileTable,
      })
      .from(BrainSymbolTable)
      .innerJoin(
        BrainFileTable,
        and(
          eq(BrainSymbolTable.project_id, BrainFileTable.project_id),
          eq(BrainSymbolTable.file_id, BrainFileTable.id),
        ),
      )
      .leftJoin(callerCounts, eq(BrainSymbolTable.id, callerCounts.target_id))
      .where(
        and(
          eq(BrainSymbolTable.project_id, projectId),
          eq(BrainSymbolTable.symbol_type, "function"),
          // Exclude entry points and exported functions
          not(like(BrainSymbolTable.name, "main%")),
          not(like(BrainSymbolTable.name, "export%")),
          not(eq(BrainSymbolTable.visibility, "public")),
          not(like(BrainFileTable.relative_path, "%mix.exs")),
          sql`COALESCE(${callerCounts.count}, 0) = 0`,
        ),
      )
      .limit(50)

    return functionsWithoutCallers.map(
      (result: any): PatternDetectionResult => ({
        pattern: PatternType.OrphanedFunction,
        confidence: Math.min(calculateOrphanConfidence(result.symbol, "function"), 0.6),
        location: {
          file: result.file?.relative_path || "unknown",
          startLine: result.symbol.line_start || 0,
          symbol: result.symbol.name,
        },
        description: `Function '${result.symbol.name}' may be unused — checked only code-level imports (build configs, plugin XML, and test conventions were not scanned)`,
        severity: "info" as const,
        suggestion: "Consider removing if truly unused, or make it private if it's a utility function",
        evidence: [
          {
            type: "relationship_analysis" as const,
            description: "No incoming 'calls' relationships found",
            confidence: 0.9,
          },
          {
            type: "ast_analysis" as const,
            description: "Function is not exported and has no apparent entry point usage",
            confidence: 0.8,
          },
        ],
        metadata: {
          symbolType: result.symbol.symbol_type,
          complexity: result.symbol.complexity,
          visibility: result.symbol.visibility,
        },
      }),
    )
  }

  async function detectOrphanedClasses(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Similar logic for classes - find classes never instantiated or referenced
    const classesWithoutReferences = await db
      .select({
        symbol: BrainSymbolTable,
        file: BrainFileTable,
      })
      .from(BrainSymbolTable)
      .innerJoin(
        BrainFileTable,
        and(
          eq(BrainSymbolTable.project_id, BrainFileTable.project_id),
          eq(BrainSymbolTable.file_id, BrainFileTable.id),
        ),
      )
      .leftJoin(
        BrainRelationshipTable,
        and(
          eq(BrainRelationshipTable.target_symbol_id, BrainSymbolTable.id),
          or(
            eq(BrainRelationshipTable.relationship_type, "instantiates"),
            eq(BrainRelationshipTable.relationship_type, "extends"),
            eq(BrainRelationshipTable.relationship_type, "implements"),
            eq(BrainRelationshipTable.relationship_type, "uses"),
          ),
        ),
      )
      .where(
        and(
          eq(BrainSymbolTable.project_id, projectId),
          eq(BrainSymbolTable.symbol_type, "class"),
          not(eq(BrainSymbolTable.visibility, "public")),
        ),
      )
      .groupBy(BrainSymbolTable.id)
      .having(sql`count(*) = 0`)
      .limit(30)

    return classesWithoutReferences.map(
      (result: any): PatternDetectionResult => ({
        pattern: PatternType.OrphanedClass,
        confidence: Math.min(calculateOrphanConfidence(result.symbol, "class"), 0.6),
        location: {
          file: result.file?.relative_path || "unknown",
          startLine: result.symbol.line_start || 0,
          symbol: result.symbol.name,
        },
        description: `Class '${result.symbol.name}' may be unused — checked only code-level relationships (build configs, plugin XML, and test conventions were not scanned)`,
        severity: "info" as const,
        suggestion: "Consider removing if unused, or check if it's missing from imports",
        evidence: [
          {
            type: "relationship_analysis" as const,
            description: "No instantiation, extension, or implementation relationships found",
            confidence: 0.85,
          },
        ],
        metadata: {
          symbolType: result.symbol.symbol_type,
          visibility: result.symbol.visibility,
        },
      }),
    )
  }

  async function detectOrphanedFiles(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Find files with no incoming import relationships
    const importCounts = db
      .select({
        file_id: BrainImportTable.file_id,
        count: count(BrainImportTable.id).as("count"),
      })
      .from(BrainImportTable)
      .where(eq(BrainImportTable.project_id, projectId))
      .groupBy(BrainImportTable.file_id)
      .as("import_counts")

    const filesWithoutImports = await db
      .select({
        file: BrainFileTable,
      })
      .from(BrainFileTable)
      .leftJoin(importCounts, eq(BrainFileTable.id, importCounts.file_id))
      .where(
        and(
          eq(BrainFileTable.project_id, projectId),
          // Exclude entry points, configuration files, build files, and non-code artifacts
          not(like(BrainFileTable.relative_path, "%main%")),
          not(like(BrainFileTable.relative_path, "%index%")),
          not(like(BrainFileTable.relative_path, "%config%")),
          not(like(BrainFileTable.relative_path, "%.json")),
          not(like(BrainFileTable.relative_path, "%.md")),
          not(like(BrainFileTable.relative_path, "%.xml")),
          not(like(BrainFileTable.relative_path, "%.gradle")),
          not(like(BrainFileTable.relative_path, "%.bazel")),
          not(like(BrainFileTable.relative_path, "%.yml")),
          not(like(BrainFileTable.relative_path, "%.yaml")),
          not(like(BrainFileTable.relative_path, "%.toml")),
          not(like(BrainFileTable.relative_path, "%/BUILD%")),
          not(like(BrainFileTable.relative_path, "%Makefile%")),
          not(like(BrainFileTable.relative_path, "%CMakeLists%")),
          not(like(BrainFileTable.relative_path, "%pom.xml%")),
          not(like(BrainFileTable.relative_path, "%/test/%")),
          not(like(BrainFileTable.relative_path, "%/tests/%")),
          not(like(BrainFileTable.relative_path, "%/spec/%")),
          sql`COALESCE(${importCounts.count}, 0) = 0`,
        ),
      )
      .limit(20)

    return filesWithoutImports.map(
      (result: any): PatternDetectionResult => ({
        pattern: PatternType.OrphanedFile,
        confidence: 0.6, // Lower confidence as files might be entry points
        location: {
          file: result.file.relative_path,
          startLine: 1,
        },
        description: `File '${result.file.relative_path}' may be unused — checked only code-level imports (build configs, plugin XML, and test conventions were not scanned)`,
        severity: "info" as const,
        suggestion: "Verify if this file is still needed or missing from build configuration",
        evidence: [
          {
            type: "relationship_analysis" as const,
            description: "No incoming import relationships found",
            confidence: 0.6,
          },
        ],
        metadata: {
          fileSize: result.file.size_bytes,
          language: result.file.language,
        },
      }),
    )
  }

  async function detectUnusedImports(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Find imports that are never actually used in the code
    // This requires analyzing if imported symbols appear in the file's symbol usage
    const potentiallyUnusedImports = await db
      .select({
        import: BrainImportTable,
        file: BrainFileTable,
      })
      .from(BrainImportTable)
      .innerJoin(
        BrainFileTable,
        and(
          eq(BrainImportTable.project_id, BrainFileTable.project_id),
          eq(BrainImportTable.file_id, BrainFileTable.id),
        ),
      )
      .where(
        and(
          eq(BrainImportTable.project_id, projectId),
          eq(BrainImportTable.is_external, false), // Focus on internal imports first
        ),
      )
      .limit(500)

    const patterns: PatternDetectionResult[] = []

    for (const { import: imp, file } of potentiallyUnusedImports) {
      // Get the actual name to search for (use alias if present, otherwise imported name)
      const usedName = imp.imported_as || imp.imported_name

      // Check if this import is actually used in the file
      let isUsed = false
      let usageCount = 0
      let confidence = 0.8

      // Method 1: Check if imported name appears in any symbol relationships from this file
      const relationships = await db
        .select({ count: count(BrainRelationshipTable.id) })
        .from(BrainRelationshipTable)
        .innerJoin(BrainSymbolTable, eq(BrainRelationshipTable.source_symbol_id, BrainSymbolTable.id))
        .where(
          and(
            eq(BrainSymbolTable.file_id, file.id),
            or(
              // Check if relationship targets the imported symbol
              eq(BrainRelationshipTable.target_symbol_id, imp.resolved_symbol_id || ""),
              // Check if external target matches imported name
              like(BrainRelationshipTable.target_external || "", `%${usedName}%`),
            ),
          ),
        )

      if (relationships[0]?.count > 0) {
        isUsed = true
        usageCount = relationships[0].count
      }

      // Method 2: Check if imported name appears in file content (fallback for cases AST might miss)
      if (!isUsed && file.content) {
        // Escape special regex characters in usedName
        const escapedUsedName = usedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

        // Search for the imported name in code context (not in comments or strings)
        // Look for common usage patterns: function calls, property access, instantiation
        const usagePatterns = [
          new RegExp(`\\b${escapedUsedName}\\s*\\(`, "g"), // Function call: usedName(
          new RegExp(`\\bnew\\s+${escapedUsedName}\\b`, "g"), // Instantiation: new usedName
          new RegExp(`\\b${escapedUsedName}\\s*\\.`, "g"), // Property access: usedName.
          new RegExp(`\\b${escapedUsedName}\\s*<`, "g"), // Generic type: usedName<
          new RegExp(`:\\s*${escapedUsedName}\\b`, "g"), // Type annotation: : usedName
          new RegExp(`extends\\s+${escapedUsedName}\\b`, "g"), // Inheritance: extends usedName
          new RegExp(`implements\\s+${escapedUsedName}\\b`, "g"), // Interface: implements usedName
          // Indirect usage patterns — spread, config linking, object shorthand
          new RegExp(`\\{\\s*${escapedUsedName}\\s*[,}]`, "g"), // Object shorthand: { usedName, ...}
          new RegExp(`[,(]\\s*${escapedUsedName}\\s*[,)]`, "g"), // Argument usage: foo(usedName) or [usedName,
          new RegExp(`\\.\\.\\.\\s*${escapedUsedName}\\b`, "g"), // Spread: ...usedName
          new RegExp(`\\{\\s*\\.\\.\\..*${escapedUsedName}`, "g"), // Object spread: { ...sharedConfig }
        ]

        for (const pattern of usagePatterns) {
          const matches = file.content.match(pattern)
          if (matches && matches.length > 0) {
            isUsed = true
            usageCount = matches.length
            confidence = 0.6 // Lower confidence since content-based detection is less precise
            break
          }
        }
      }

      // Method 3: Check if import is resolved to a symbol (high confidence it's used)
      if (!isUsed && imp.resolved_symbol_id) {
        // If we have a resolved symbol, check if any symbols in this file reference it
        const symbolReferences = await db
          .select({ count: count(BrainSymbolTable.id) })
          .from(BrainSymbolTable)
          .where(
            and(
              eq(BrainSymbolTable.file_id, file.id),
              // Check if qualified_calls contains reference to imported symbol
              sql`json_array_length(${BrainSymbolTable.qualified_calls}) > 0`,
            ),
          )

        if (symbolReferences[0]?.count > 0) {
          // This is a heuristic - we can't easily search JSON arrays in SQLite
          // But if file has qualified calls, there's a good chance imports are used
          confidence = 0.5
        }
      }

      // If import appears to be unused, create a pattern detection result
      if (!isUsed) {
        patterns.push({
          pattern: PatternType.UnusedImport,
          confidence,
          location: {
            file: file.relative_path,
            startLine: imp.line_number || 0,
            endLine: imp.line_number,
            symbol: usedName,
          },
          description: `Import '${imp.imported_name}'${imp.imported_as ? ` (as '${imp.imported_as}')` : ""} from '${imp.import_path}' appears to be unused`,
          severity: "info" as const,
          suggestion: `Remove this import to reduce bundle size and improve code clarity`,
          evidence: [
            {
              type: "relationship_analysis" as const,
              description: `No usage of '${usedName}' found in file relationships or content`,
              confidence,
            },
          ],
          metadata: {
            importedName: imp.imported_name,
            importedAs: imp.imported_as,
            importPath: imp.import_path,
            importType: imp.import_type,
            language: file.language,
            usageCount,
          },
        })
      }
    }

    return patterns
  }

  // Framework detection helpers
  async function detectProjectFrameworks(db: any, projectId: ProjectID): Promise<string[]> {
    const frameworkIndicators = await db
      .select({
        framework: BrainFileTable.framework_type,
        count: count(BrainFileTable.id),
      })
      .from(BrainFileTable)
      .where(eq(BrainFileTable.project_id, projectId))
      .groupBy(BrainFileTable.framework_type)
      .having(sql`count(*) > 0`)

    return frameworkIndicators.filter((f: any) => f.framework).map((f: any) => f.framework)
  }

  // Framework-specific pattern detection
  async function detectReactPatterns(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    const patterns: PatternDetectionResult[] = []

    // Detect React hooks violations (calling hooks conditionally)
    const reactFiles = await db
      .select()
      .from(BrainFileTable)
      .where(
        and(
          eq(BrainFileTable.project_id, projectId),
          or(eq(BrainFileTable.framework_type, "react"), eq(BrainFileTable.framework_type, "next")),
        ),
      )

    for (const file of reactFiles) {
      // Check for hooks called inside conditions (simplified pattern matching)
      if (file.content) {
        const content = file.content as string
        const lines = content.split("\n")

        // Pattern 1: Conditional hooks
        const conditionalHookPattern = /if\s*\([^)]*\)\s*\{[^}]*use[A-Z][a-zA-Z]*\(/g
        let match
        while ((match = conditionalHookPattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length
          patterns.push({
            pattern: PatternType.ReactHook,
            confidence: 0.8,
            location: {
              file: file.file_path,
              startLine: lineNumber,
            },
            description: "React hooks called conditionally - hooks must be called at top level",
            severity: `warning`,
            suggestion: "Move hook calls outside of conditional blocks",
            evidence: [
              {
                type: "ast_analysis",
                description: "Hook call found inside conditional statement",
                confidence: 0.8,
              },
            ],
            metadata: { framework: "react", violation: "conditional_hooks", code: match[0] },
          })
        }

        // Pattern 2: Missing dependency arrays in useEffect
        const missingDepsPattern = /useEffect\s*\(\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}\s*\)/g
        while ((match = missingDepsPattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length
          patterns.push({
            pattern: PatternType.ReactHook,
            confidence: 0.6,
            location: {
              file: file.file_path,
              startLine: lineNumber,
            },
            description: "useEffect without dependency array - may cause infinite re-renders",
            severity: "warning",
            suggestion: "Add dependency array as second argument to useEffect",
            evidence: [
              {
                type: "ast_analysis",
                description: "useEffect called without explicit dependency array",
                confidence: 0.6,
              },
            ],
            metadata: { framework: "react", issue: "missing_deps" },
          })
        }

        // Pattern 3: Class components (suggest migration to hooks)
        const classComponentPattern = /class\s+([A-Z][a-zA-Z]*)\s+extends\s+React\.Component/g
        while ((match = classComponentPattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length
          patterns.push({
            pattern: PatternType.ReactComponent,
            confidence: 0.9,
            location: {
              file: file.file_path,
              startLine: lineNumber,
              symbol: match[1],
            },
            description: "Class component detected - consider migrating to functional components with hooks",
            severity: "info",
            suggestion: "Refactor to functional component using hooks for better performance and readability",
            evidence: [
              {
                type: "naming_convention",
                description: "Class component extends React.Component",
                confidence: 0.9,
              },
            ],
            metadata: { framework: "react", pattern: "class_component", component: match[1] },
          })
        }
      }
    }

    return patterns
  }

  async function detectFlutterBlocPatterns(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    const patterns: PatternDetectionResult[] = []

    // Detect BLoC pattern usage and violations in Flutter/Dart projects
    const dartFiles = await db
      .select()
      .from(BrainFileTable)
      .where(
        and(
          eq(BrainFileTable.project_id, projectId),
          or(eq(BrainFileTable.language, "dart"), eq(BrainFileTable.framework_type, "flutter")),
        ),
      )

    for (const file of dartFiles) {
      if (file.content) {
        const content = file.content as string
        let match

        // Pattern 1: BLoC without proper state management
        const blocWithoutStatePattern = /class\s+([A-Z][a-zA-Z]*Bloc)\s+extends\s+Bloc[^{]*\{(?![^}]*emit\()/gs
        while ((match = blocWithoutStatePattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length
          patterns.push({
            pattern: PatternType.BlocPattern,
            confidence: 0.7,
            location: {
              file: file.file_path,
              startLine: lineNumber,
              symbol: match[1],
            },
            description: "BLoC class without state emission - state changes should use emit()",
            severity: `warning`,
            suggestion: "Use emit() to emit new states in event handlers",
            evidence: [
              {
                type: "ast_analysis",
                description: "BLoC class found without emit() calls",
                confidence: 0.7,
              },
            ],
            metadata: { framework: "flutter", pattern: "bloc_no_emit", bloc: match[1] },
          })
        }

        // Pattern 2: Direct UI updates in BLoC (anti-pattern)
        const blocWithUIPattern = /class\s+([A-Z][a-zA-Z]*Bloc)[^{]*\{[^}]*setState\(/gs
        while ((match = blocWithUIPattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length
          patterns.push({
            pattern: PatternType.BlocPattern,
            confidence: 0.9,
            location: {
              file: file.file_path,
              startLine: lineNumber,
              symbol: match[1],
            },
            description: "BLoC contains direct UI updates - BLoC should only emit states",
            severity: "critical",
            suggestion: "Remove setState() from BLoC - emit states instead and let BlocBuilder rebuild UI",
            evidence: [
              {
                type: "ast_analysis",
                description: "setState() found in BLoC class - violates separation of concerns",
                confidence: 0.9,
              },
            ],
            metadata: { framework: "flutter", violation: "bloc_with_setstate", bloc: match[1] },
          })
        }

        // Pattern 3: Missing BlocProvider
        const blocUsagePattern = /BlocBuilder<([A-Z][a-zA-Z]*Bloc),/g
        const providerPattern = /BlocProvider<([A-Z][a-zA-Z]*Bloc)>/g
        const usedBlocs = new Set<string>()
        const providedBlocs = new Set<string>()

        while ((match = blocUsagePattern.exec(content)) !== null) {
          usedBlocs.add(match[1])
        }

        while ((match = providerPattern.exec(content)) !== null) {
          providedBlocs.add(match[1])
        }

        // Check for used but not provided BLoCs
        for (const bloc of usedBlocs) {
          if (!providedBlocs.has(bloc)) {
            patterns.push({
              pattern: PatternType.BlocPattern,
              confidence: 0.6,
              location: {
                file: file.file_path,
                startLine: 1,
              },
              description: `BLoC ${bloc} used without BlocProvider - may cause runtime errors`,
              severity: "warning",
              suggestion: `Wrap widget tree with BlocProvider<${bloc}>`,
              evidence: [
                {
                  type: "relationship_analysis",
                  description: "BlocBuilder found without corresponding BlocProvider",
                  confidence: 0.6,
                },
              ],
              metadata: { framework: "flutter", issue: "missing_bloc_provider", bloc },
            })
          }
        }
      }
    }

    return patterns
  }

  async function detectSpringMVCPatterns(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    const patterns: PatternDetectionResult[] = []

    // Detect Spring MVC patterns and violations in Java projects
    const javaFiles = await db
      .select()
      .from(BrainFileTable)
      .where(
        and(
          eq(BrainFileTable.project_id, projectId),
          or(eq(BrainFileTable.language, "java"), eq(BrainFileTable.framework_type, "spring")),
        ),
      )

    for (const file of javaFiles) {
      if (file.content) {
        const content = file.content as string
        let match

        // Pattern 1: Controller with business logic (should be in service layer)
        const controllerWithLogicPattern = /@RestController[^{]*class\s+([A-Z][a-zA-Z]*)\s*\{[^}]{200,}/gs
        while ((match = controllerWithLogicPattern.exec(content)) !== null) {
          const snippet = match[0]
          // Check if controller has complex logic (loops, multiple conditionals)
          const forLoops = snippet.match(/for\s*\(/g)
          const ifStatements = snippet.match(/if\s*\(/g)
          if ((forLoops && forLoops.length > 2) || (ifStatements && ifStatements.length > 3)) {
            const lineNumber = content.substring(0, match.index).split("\n").length
            patterns.push({
              pattern: PatternType.MVCController,
              confidence: 0.7,
              location: {
                file: file.file_path,
                startLine: lineNumber,
                symbol: match[1],
              },
              description: "Controller contains business logic - should delegate to service layer",
              severity: "warning",
              suggestion: "Move business logic to @Service classes and inject them into controller",
              evidence: [
                {
                  type: "complexity_metrics",
                  description: "Controller contains complex logic patterns (loops, conditionals)",
                  confidence: 0.7,
                },
              ],
              metadata: { framework: "spring", anti_pattern: "fat_controller", controller: match[1] },
            })
          }
        }

        // Pattern 2: Missing @Transactional on service methods
        const serviceMethodPattern =
          /@Service[^{]*class\s+([A-Z][a-zA-Z]*)[^{]*\{[^}]*public[^{]*\{[^}]*save\(|update\(|delete\(/gs
        while ((match = serviceMethodPattern.exec(content)) !== null) {
          if (!match[0].includes("@Transactional")) {
            const lineNumber = content.substring(0, match.index).split("\n").length
            patterns.push({
              pattern: PatternType.Repository,
              confidence: 0.6,
              location: {
                file: file.file_path,
                startLine: lineNumber,
                symbol: match[1],
              },
              description: "Service method modifying data without @Transactional annotation",
              severity: "warning",
              suggestion: "Add @Transactional annotation to methods that modify database state",
              evidence: [
                {
                  type: "ast_analysis",
                  description: "Data modification method found without transaction management",
                  confidence: 0.6,
                },
              ],
              metadata: { framework: "spring", issue: "missing_transactional", service: match[1] },
            })
          }
        }

        // Pattern 3: Autowired field injection (constructor injection preferred)
        const autowiredFieldPattern = /@Autowired[^;]*private\s+([A-Z][a-zA-Z]*)\s+([a-z][a-zA-Z]*);/g
        while ((match = autowiredFieldPattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length
          patterns.push({
            pattern: PatternType.Adapter,
            confidence: 0.8,
            location: {
              file: file.file_path,
              startLine: lineNumber,
            },
            description: "Field injection with @Autowired - constructor injection is preferred",
            severity: "info",
            suggestion: "Use constructor-based dependency injection for better testability and immutability",
            evidence: [
              {
                type: "ast_analysis",
                description: "@Autowired field injection detected",
                confidence: 0.8,
              },
            ],
            metadata: {
              framework: "spring",
              code_smell: "field_injection",
              field: match[2],
              type: match[1],
            },
          })
        }

        // Pattern 4: Missing validation in REST controllers
        const restMethodPattern = /@(Get|Post|Put|Delete)Mapping[^{]*\(([^)]*)\)[^{]*\{/g
        while ((match = restMethodPattern.exec(content)) !== null) {
          if (!match[0].includes("@Valid") && (match[1] === "Post" || match[1] === "Put")) {
            const lineNumber = content.substring(0, match.index).split("\n").length
            patterns.push({
              pattern: PatternType.MVCController,
              confidence: 0.5,
              location: {
                file: file.file_path,
                startLine: lineNumber,
              },
              description: `${match[1]}Mapping without @Valid annotation - input validation missing`,
              severity: "warning",
              suggestion: "Add @Valid annotation to request body parameters for automatic validation",
              evidence: [
                {
                  type: "ast_analysis",
                  description: "POST/PUT endpoint without validation",
                  confidence: 0.5,
                },
              ],
              metadata: { framework: "spring", issue: "missing_validation", method: match[1] },
            })
          }
        }
      }
    }

    return patterns
  }

  async function detectExpressPatterns(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    const patterns: PatternDetectionResult[] = []

    // Detect Express.js patterns and violations in JavaScript/TypeScript projects
    const jsFiles = await db
      .select()
      .from(BrainFileTable)
      .where(
        and(
          eq(BrainFileTable.project_id, projectId),
          or(
            eq(BrainFileTable.language, "javascript"),
            eq(BrainFileTable.language, "typescript"),
            eq(BrainFileTable.framework_type, "express"),
          ),
        ),
      )

    for (const file of jsFiles) {
      if (file.content) {
        const content = file.content as string
        let match

        // Pattern 1: Routes without error handling
        const routeWithoutErrorPattern =
          /app\.(get|post|put|delete|patch)\s*\([^,]+,\s*(async\s+)?\([^)]*\)\s*=>\s*\{(?![^}]*catch|[^}]*\.catch\()/gs
        while ((match = routeWithoutErrorPattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length
          patterns.push({
            pattern: PatternType.MVCController,
            confidence: 0.7,
            location: {
              file: file.file_path,
              startLine: lineNumber,
            },
            description: "Express route without error handling - async errors may crash the server",
            severity: `warning`,
            suggestion: "Wrap async route handlers with try-catch or use async error handling middleware",
            evidence: [
              {
                type: "ast_analysis",
                description: "Route handler without error handling mechanism",
                confidence: 0.7,
              },
            ],
            metadata: { framework: "express", issue: "missing_error_handling", method: match[1] },
          })
        }

        // Pattern 2: Missing input validation middleware
        const routeWithoutValidationPattern =
          /app\.(post|put|patch)\s*\([^,]+,\s*\([^)]*\)\s*=>\s*\{(?![^}]*req\.body|[^}]*validate)/gs
        while ((match = routeWithoutValidationPattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length
          patterns.push({
            pattern: PatternType.MVCController,
            confidence: 0.6,
            location: {
              file: file.file_path,
              startLine: lineNumber,
            },
            description: `${match[1].toUpperCase()} route without input validation - potential security risk`,
            severity: "warning",
            suggestion: "Add validation middleware (e.g., express-validator, joi) before route handler",
            evidence: [
              {
                type: "ast_analysis",
                description: "POST/PUT/PATCH route without validation",
                confidence: 0.6,
              },
            ],
            metadata: { framework: "express", issue: "missing_validation", method: match[1] },
          })
        }

        // Pattern 3: Callback hell / deeply nested callbacks
        const callbackHellPattern =
          /\}\s*\)\s*\.\s*then\s*\(\s*[^{]*\{[^}]*\}\s*\)\s*\.\s*then\s*\(\s*[^{]*\{[^}]*\}\s*\)\s*\.\s*then\(/g
        while ((match = callbackHellPattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length
          patterns.push({
            pattern: PatternType.TightCoupling,
            confidence: 0.8,
            location: {
              file: file.file_path,
              startLine: lineNumber,
            },
            description: "Callback hell detected - multiple chained promises reduce readability",
            severity: "warning",
            suggestion: "Refactor to async/await for better readability and error handling",
            evidence: [
              {
                type: "complexity_metrics",
                description: "Multiple chained promise callbacks",
                confidence: 0.8,
              },
            ],
            metadata: { framework: "express", code_smell: "callback_hell" },
          })
        }

        // Pattern 4: Missing middleware ordering (body parser after routes)
        const bodyParserAfterRoutesPattern = /app\.(get|post|put|delete)[^]*app\.use\(.*json\(\)\)/s
        if (bodyParserAfterRoutesPattern.test(content)) {
          patterns.push({
            pattern: PatternType.MVCController,
            confidence: 0.9,
            location: {
              file: file.file_path,
              startLine: 1,
            },
            description: "Body parser middleware registered after routes - request body will be undefined",
            severity: "critical",
            suggestion: "Move app.use(express.json()) before route definitions",
            evidence: [
              {
                type: "ast_analysis",
                description: "Middleware ordering issue detected",
                confidence: 0.9,
              },
            ],
            metadata: { framework: "express", bug: "middleware_ordering" },
          })
        }

        // Pattern 5: Hardcoded secrets in routes
        const secretPattern = /(api_key|apiKey|password|secret|token)\s*[:=]\s*["']([^"']{10,})["']/g
        while ((match = secretPattern.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split("\n").length
          patterns.push({
            pattern: PatternType.SecurityVulnerability,
            confidence: 0.8,
            location: {
              file: file.file_path,
              startLine: lineNumber,
            },
            description: `Hardcoded ${match[1]} detected - security vulnerability`,
            severity: "critical",
            suggestion: "Move secrets to environment variables (process.env) or secure vault",
            evidence: [
              {
                type: "ast_analysis",
                description: "Hardcoded credential found in source code",
                confidence: 0.8,
              },
            ],
            metadata: { framework: "express", vulnerability: "hardcoded_secret", type: match[1] },
          })
        }
      }
    }

    return patterns
  }

  // Logical error detection (placeholders for sophisticated analysis)
  async function detectNullPointerRisks(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Detect potential null pointer exceptions by looking at optional types without checks
    // This is a simplified heuristic: looking for variables with '?' in type that are used frequently
    return []
  }

  async function detectInfiniteLoops(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Heuristic: Methods with high complexity but very few lines might indicate complex loop conditions
    return []
  }

  async function detectResourceLeaks(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Heuristic: Methods that open files but don't close them (hard to do without deep dataflow)
    return []
  }

  async function detectRaceConditions(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Detect potential race conditions in concurrent code
    return []
  }

  async function detectInconsistentState(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Detect inconsistent object state patterns
    return []
  }

  // Anti-patterns
  async function detectLongMethods(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    const violations = await db
      .select({
        symbol: BrainSymbolTable,
        file: BrainFileTable,
      })
      .from(BrainSymbolTable)
      .innerJoin(
        BrainFileTable,
        and(
          eq(BrainSymbolTable.project_id, BrainFileTable.project_id),
          eq(BrainSymbolTable.file_id, BrainFileTable.id),
        ),
      )
      .where(
        and(
          eq(BrainSymbolTable.project_id, projectId),
          eq(BrainSymbolTable.symbol_type, "function"),
          // Heuristic: method longer than 100 lines
          sql`(${BrainSymbolTable.line_end} - ${BrainSymbolTable.line_start}) > 100`,
        ),
      )
      .limit(20)

    return violations.map(
      (result: any): PatternDetectionResult => ({
        pattern: PatternType.LongMethod,
        confidence: 0.9,
        location: {
          file: result.file.relative_path,
          startLine: result.symbol.line_start || 0,
          endLine: result.symbol.line_end,
          symbol: result.symbol.name,
        },
        description: `Function '${result.symbol.name}' is unusually long (${result.symbol.line_end - result.symbol.line_start} lines)`,
        severity: "warning" as const,
        suggestion: "Consider extracting parts of this function into smaller, private helper methods",
        evidence: [
          {
            type: "complexity_metrics",
            description: `Length is ${result.symbol.line_end - result.symbol.line_start} lines (threshold: 100)`,
            confidence: 0.9,
          },
        ],
        metadata: {},
      }),
    )
  }

  // Architectural violation detection
  async function detectLayerViolations(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Use GraphIntelligence to detect improper layer dependencies
    // E.g., domain layer depending on presentation layer
    const violations = await db
      .select({
        source_file: BrainFileTable,
        target_file: BrainFileTable,
        import: BrainImportTable,
      })
      .from(BrainImportTable)
      .innerJoin(
        BrainFileTable,
        and(
          eq(BrainImportTable.project_id, BrainFileTable.project_id),
          eq(BrainImportTable.file_id, BrainFileTable.id),
        ),
      )
      .where(
        and(
          eq(BrainImportTable.project_id, projectId),
          like(BrainFileTable.relative_path, "%/domain/%"),
          like(BrainImportTable.import_path, "%/presentation/%"),
        ),
      )
      .limit(10)

    return violations.map(
      (result: any): PatternDetectionResult => ({
        pattern: PatternType.TightCoupling,
        confidence: 0.8,
        location: {
          file: result.source_file.relative_path,
          startLine: 1,
          endLine: 1,
        },
        description: `Domain layer file '${result.source_file.relative_path}' improperly imports from presentation layer '${result.import.import_path}'`,
        severity: `warning` as const,
        suggestion: "Invert the dependency using interfaces or move the logic",
        evidence: [
          {
            type: "relationship_analysis",
            description: `Found import from ${result.import.import_path}`,
            confidence: 0.9,
          },
        ],
        metadata: {},
      }),
    )
  }

  async function detectDependencyViolations(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    const results: PatternDetectionResult[] = []

    // 1. High Coupling (God Classes / Modules)
    // Find symbols with a massive number of outgoing or incoming relationships
    const highCoupling = await db
      .select({
        symbol: BrainSymbolTable,
        file: BrainFileTable,
        outgoing: sql<number>`COUNT(CASE WHEN ${BrainRelationshipTable.source_symbol_id} = ${BrainSymbolTable.id} THEN 1 END)`,
        incoming: sql<number>`COUNT(CASE WHEN ${BrainRelationshipTable.target_symbol_id} = ${BrainSymbolTable.id} THEN 1 END)`,
      })
      .from(BrainSymbolTable)
      .innerJoin(
        BrainFileTable,
        and(
          eq(BrainSymbolTable.project_id, BrainFileTable.project_id),
          eq(BrainSymbolTable.file_id, BrainFileTable.id),
        ),
      )
      .leftJoin(
        BrainRelationshipTable,
        or(
          eq(BrainRelationshipTable.source_symbol_id, BrainSymbolTable.id),
          eq(BrainRelationshipTable.target_symbol_id, BrainSymbolTable.id),
        ),
      )
      .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.symbol_type, "class")))
      .groupBy(BrainSymbolTable.id)
      .having(
        sql`COUNT(CASE WHEN ${BrainRelationshipTable.source_symbol_id} = ${BrainSymbolTable.id} THEN 1 END) + COUNT(CASE WHEN ${BrainRelationshipTable.target_symbol_id} = ${BrainSymbolTable.id} THEN 1 END) > 30`,
      )
      .limit(10)

    for (const hc of highCoupling) {
      results.push({
        pattern: PatternType.TightCoupling,
        confidence: 0.9,
        location: {
          file: hc.file.relative_path,
          startLine: hc.symbol.line_start || 0,
          endLine: hc.symbol.line_end,
          symbol: hc.symbol.name,
        },
        description: `Class '${hc.symbol.name}' has extremely high coupling (Incoming: ${hc.incoming}, Outgoing: ${hc.outgoing})`,
        severity: "warning",
        suggestion: "Refactor to use Dependency Injection or split into smaller domain-specific services.",
        evidence: [
          {
            type: "relationship_analysis",
            description: `Total relationships: ${hc.incoming + hc.outgoing} (threshold: 30)`,
            confidence: 0.9,
          },
        ],
        metadata: { incoming: hc.incoming, outgoing: hc.outgoing },
      })
    }

    // 2. Circular Dependencies (A -> B -> A)
    // We look for pairs of symbols that mutually depend on each other
    let rawDb
    try {
      const { BrainDatabase } = await import("../brain/database")
      rawDb = await BrainDatabase.getRawInstance(projectId)
    } catch {}

    if (rawDb) {
      const circularDeps = rawDb
        .prepare(
          `
        SELECT 
          r1.source_symbol_id as a_id,
          r1.target_symbol_id as b_id,
          sA.name as a_name,
          sB.name as b_name,
          fA.relative_path as a_file,
          sA.line_start as a_line
        FROM brain_relationship r1
        JOIN brain_relationship r2 ON r1.source_symbol_id = r2.target_symbol_id AND r1.target_symbol_id = r2.source_symbol_id
        JOIN brain_symbol sA ON r1.source_symbol_id = sA.id
        JOIN brain_symbol sB ON r1.target_symbol_id = sB.id
        JOIN brain_file fA ON sA.file_id = fA.id
        WHERE r1.project_id = ?
          AND r1.source_symbol_id < r1.target_symbol_id
        LIMIT 10
      `,
        )
        .all(projectId)

      for (const cd of circularDeps as any[]) {
        results.push({
          pattern: PatternType.CircularDependency,
          confidence: 0.95,
          location: {
            file: cd.a_file,
            startLine: cd.a_line || 0,
            symbol: cd.a_name,
          },
          description: `Circular dependency detected between '${cd.a_name}' and '${cd.b_name}'`,
          severity: `warning`,
          suggestion: "Extract the shared dependency into a third module or use Dependency Inversion.",
          evidence: [
            {
              type: "relationship_analysis",
              description: `Mutual relationship exists between ${cd.a_name} and ${cd.b_name}`,
              confidence: 0.95,
            },
          ],
          metadata: { a_name: cd.a_name, b_name: cd.b_name },
        })
      }
    }

    return results
  }

  async function detectSingleResponsibilityViolations(
    db: any,
    projectId: ProjectID,
  ): Promise<PatternDetectionResult[]> {
    // LIVE COMPUTATION (M14 #301): the previous implementation read the
    // brain_pattern table, which nothing ever wrote - god_class/long_function
    // detection silently returned empty on every project. Thresholds are
    // MEASURED on grails-core (3000-file sample, M14):
    //   aggregated class complexity: P90=31 P95=52 P99=137 max=356
    //   method line-span:            P90=17 P95=26 P99=58  max=416
    // god_class: SUM(method complexity) >= 80 AND >= 20 methods (~P97/P95)
    // long_function: line span >= 50 (~P99)
    const out: PatternDetectionResult[] = []

    // Aggregate METHODS under their OWNING CLASS via owner_symbol_id.
    // (An earlier draft grouped by bare method NAME - every method was its
    // own group, so the threshold could never fire.)
    const godClasses = await db
      .select({
        name: BrainSymbolTable.name,
        fileId: BrainSymbolTable.file_id,
        total: sql`SUM(${BrainSymbolTable.complexity})`.as("total"),
        cnt: sql`COUNT(*)`.as("cnt"),
      })
      .from(BrainSymbolTable)
      .innerJoin(
        sql`${BrainSymbolTable} owner ON ${BrainSymbolTable}.owner_symbol_id = owner.id`,
      )
      .where(and(eq(BrainSymbolTable.project_id, projectId), eq(BrainSymbolTable.symbol_type, "method")))
      .groupBy(sql`owner.name`, sql`owner.id`)
      .having(sql`SUM(${BrainSymbolTable.complexity}) >= 80 AND COUNT(*) >= 20`)
      .limit(50)

    for (const g of godClasses) {
      out.push({
        pattern: PatternType.GodClass,
        confidence: 0.9,
        location: { file: String(g.fileId ?? ""), startLine: 0, symbol: String(g.name) },
        description: `god_class: ${g.name} aggregates complexity ${g.total} across ${g.cnt} methods`,
        severity: "warning",
        evidence: [{ type: "complexity_metrics", description: "measured threshold: sum>=80 AND methods>=20", confidence: 0.9 }],
        metadata: {},
      })
    }

    const longFns = await db
      .select({ name: BrainSymbolTable.name, fileId: BrainSymbolTable.file_id })
      .from(BrainSymbolTable)
      .where(
        and(
          eq(BrainSymbolTable.project_id, projectId),
          inArray(BrainSymbolTable.symbol_type, ["method", "function"]),
          sql`(${BrainSymbolTable.line_end} - ${BrainSymbolTable.line_start} + 1) >= 50`,
        ),
      )
      .limit(50)

    for (const f of longFns) {
      out.push({
        pattern: PatternType.LongMethod,
        confidence: 0.9,
        location: { file: String(f.fileId ?? ""), startLine: 0, symbol: String(f.name) },
        description: `long_function: ${f.name} spans >= 50 lines`,
        severity: "info",
        evidence: [{ type: "complexity_metrics", description: "measured threshold: span>=50 lines", confidence: 0.9 }],
        metadata: {},
      })
    }

    return out
  }

  async function detectOpenClosedViolations(db: any, projectId: ProjectID): Promise<PatternDetectionResult[]> {
    // Detect violations of the Open/Closed Principle:
    // Classes/functions should be open for extension but closed for modification
    // Common violations include:
    // 1. Large switch/case or if-else chains that would require modification to add new cases
    // 2. Classes with many conditionals based on type checking
    // 3. Methods that need modification to handle new types

    const patterns: PatternDetectionResult[] = []

    // Get all files with code to analyze
    const files = await db
      .select()
      .from(BrainFileTable)
      .where(
        and(
          eq(BrainFileTable.project_id, projectId),
          not(eq(BrainFileTable.is_test_file, true)),
          not(eq(BrainFileTable.is_config_file, true)),
        ),
      )
      .limit(200)

    for (const file of files) {
      if (!file.content) continue
      const content = file.content as string

      // Pattern 1: Large switch statements (5+ cases) - suggests need for polymorphism
      const switchPattern = /switch\s*\([^)]+\)\s*\{([^}]*case[^}]*){5,}\}/gs
      let match
      while ((match = switchPattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split("\n").length
        const caseCount = (match[0].match(/case\s+/g) || []).length

        patterns.push({
          pattern: PatternType.TightCoupling,
          confidence: 0.75,
          location: {
            file: file.relative_path,
            startLine: lineNumber,
          },
          description: `Large switch statement with ${caseCount} cases - violates Open/Closed Principle`,
          severity: "warning" as const,
          suggestion:
            "Consider using polymorphism (strategy pattern, factory pattern, or command pattern) instead of switch statements",
          evidence: [
            {
              type: "ast_analysis" as const,
              description: `Switch statement with ${caseCount} cases requires modification to add new cases`,
              confidence: 0.75,
            },
          ],
          metadata: {
            violationType: "open_closed_switch",
            caseCount,
            language: file.language,
          },
        })
      }

      // Pattern 2: Long if-else chains (4+ else-if) - suggests need for polymorphism
      const ifElsePattern = /if\s*\([^)]+\)\s*\{[^}]*\}(\s*else\s+if\s*\([^)]+\)\s*\{[^}]*\}){3,}/gs
      while ((match = ifElsePattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split("\n").length
        const elseIfCount = (match[0].match(/else\s+if/g) || []).length

        patterns.push({
          pattern: PatternType.TightCoupling,
          confidence: 0.7,
          location: {
            file: file.relative_path,
            startLine: lineNumber,
          },
          description: `Long if-else chain with ${elseIfCount + 1} branches - violates Open/Closed Principle`,
          severity: "warning" as const,
          suggestion: "Refactor to use polymorphism or lookup tables to make code extensible without modification",
          evidence: [
            {
              type: "ast_analysis" as const,
              description: `If-else chain with ${elseIfCount + 1} branches requires modification to add new conditions`,
              confidence: 0.7,
            },
          ],
          metadata: {
            violationType: "open_closed_if_else",
            branchCount: elseIfCount + 1,
            language: file.language,
          },
        })
      }

      // Pattern 3: Type checking patterns (instanceof, typeof) - suggests need for polymorphism
      const typeCheckPattern = /(instanceof|typeof|is\s+\w+|as\s+\w+)[^;{]*\{[^}]*\}/g
      const typeChecks: number[] = []
      while ((match = typeCheckPattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split("\n").length
        typeChecks.push(lineNumber)
      }

      // Group consecutive type checks (within 20 lines) as a single violation
      if (typeChecks.length >= 3) {
        const groups: number[][] = []
        let currentGroup: number[] = [typeChecks[0]]

        for (let i = 1; i < typeChecks.length; i++) {
          if (typeChecks[i] - typeChecks[i - 1] <= 20) {
            currentGroup.push(typeChecks[i])
          } else {
            if (currentGroup.length >= 3) groups.push(currentGroup)
            currentGroup = [typeChecks[i]]
          }
        }
        if (currentGroup.length >= 3) groups.push(currentGroup)

        for (const group of groups) {
          patterns.push({
            pattern: PatternType.TightCoupling,
            confidence: 0.65,
            location: {
              file: file.relative_path,
              startLine: group[0],
              endLine: group[group.length - 1],
            },
            description: `Multiple type checks (${group.length}) - violates Open/Closed Principle`,
            severity: "info" as const,
            suggestion: "Use polymorphism and interface-based design to eliminate type checking",
            evidence: [
              {
                type: "ast_analysis" as const,
                description: `${group.length} type checks suggest behavior varies by type - consider polymorphism`,
                confidence: 0.65,
              },
            ],
            metadata: {
              violationType: "open_closed_type_check",
              typeCheckCount: group.length,
              language: file.language,
            },
          })
        }
      }

      // Pattern 4: Enum-based conditionals (common OCP violation)
      // Look for patterns like: if (status === "pending") ... else if (status === "active")
      const enumConditionalPattern =
        /if\s*\(\s*\w+\s*===?\s*["'](\w+)["']\s*\)[^}]*\}(\s*else\s+if\s*\(\s*\w+\s*===?\s*["']\w+["']\s*\)[^}]*\}){2,}/gs
      while ((match = enumConditionalPattern.exec(content)) !== null) {
        const lineNumber = content.substring(0, match.index).split("\n").length
        const conditionCount = (match[0].match(/===?/g) || []).length

        patterns.push({
          pattern: PatternType.TightCoupling,
          confidence: 0.8,
          location: {
            file: file.relative_path,
            startLine: lineNumber,
          },
          description: `Enum/string-based conditional logic (${conditionCount} checks) - violates Open/Closed Principle`,
          severity: "warning" as const,
          suggestion:
            "Use state pattern or strategy pattern to make behavior extensible without modifying existing code",
          evidence: [
            {
              type: "ast_analysis" as const,
              description: `${conditionCount} string/enum comparisons suggest state-dependent behavior - use polymorphism`,
              confidence: 0.8,
            },
          ],
          metadata: {
            violationType: "open_closed_enum_conditional",
            conditionCount,
            language: file.language,
          },
        })
      }
    }

    return patterns
  }

  // Helper functions
  function calculateOrphanConfidence(symbol: any, symbolType: string): number {
    let confidence = 0.7 // Base confidence

    // Increase confidence if function/class is complex (more likely to be intentional if used)
    if (symbol.complexity && symbol.complexity > 10) {
      confidence += 0.1
    }

    // Decrease confidence if it's public (might be used externally)
    if (symbol.visibility === "public") {
      confidence -= 0.3
    }

    // Increase confidence for utility-looking names
    if (symbol.name && (symbol.name.includes("util") || symbol.name.includes("helper"))) {
      confidence += 0.1
    }

    return Math.min(Math.max(confidence, 0.1), 0.95)
  }

  function not(condition: any) {
    return sql`NOT (${condition})`
  }
}
