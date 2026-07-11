// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import * as Log from "../tool/brain-log.js"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

type UniversalSymbol = UniversalSymbol
type UniversalRelationship = UniversalRelationship
const SymbolKind = SymbolKind
const RelationshipType = RelationshipType

const log = Log.create({ service: "ast-qualifier" })

// Cross-File Relationship Resolution - ProxiCall Brain Level Intelligence
// This module takes raw qualified_calls and resolves them to actual symbols across files

export namespace CrossFileQualifier {
  // Symbol index for fast lookups
  interface SymbolIndex {
    byName: Map<string, UniversalSymbol[]>
    byQualifiedName: Map<string, UniversalSymbol[]>
    byOwner: Map<string, UniversalSymbol[]>
    imports: Map<string, ImportResolution[]>
  }

  interface ImportResolution {
    filePath: string
    module: string
    alias?: string
    items: string[]
    isDefault: boolean
  }

  export interface FileContext {
    filePath: string
    symbols: UniversalSymbol[]
    imports: ImportResolution[]
    language: string
    framework?: string
  }

  interface QualificationResult {
    newRelationships: UniversalRelationship[]
    resolvedCalls: number
    unresolvedCalls: string[]
    confidence: number
  }

  // Build symbol index from all parsed files
  export function buildSymbolIndex(fileContexts: FileContext[]): SymbolIndex {
    const index: SymbolIndex = {
      byName: new Map(),
      byQualifiedName: new Map(),
      byOwner: new Map(),
      imports: new Map(),
    }

    for (const context of fileContexts) {
      // Index symbols
      for (const symbol of context.symbols) {
        // Index by simple name
        if (!index.byName.has(symbol.name)) {
          index.byName.set(symbol.name, [])
        }
        index.byName.get(symbol.name)!.push(symbol)

        // Index by qualified name (ClassName.methodName)
        if (symbol.ownerName) {
          const qualified = `${symbol.ownerName}.${symbol.name}`
          if (!index.byQualifiedName.has(qualified)) {
            index.byQualifiedName.set(qualified, [])
          }
          index.byQualifiedName.get(qualified)!.push(symbol)
        }

        // Index by owner (all symbols in a class)
        if (symbol.ownerName) {
          if (!index.byOwner.has(symbol.ownerName)) {
            index.byOwner.set(symbol.ownerName, [])
          }
          index.byOwner.get(symbol.ownerName)!.push(symbol)
        }
      }

      // Index imports for this file
      if (!index.imports.has(context.filePath)) {
        index.imports.set(context.filePath, [])
      }
      index.imports.get(context.filePath)!.push(...context.imports)
    }

    log.info("symbol index built", {
      totalSymbols: Array.from(index.byName.values()).flat().length,
      uniqueNames: index.byName.size,
      qualifiedNames: index.byQualifiedName.size,
      filesWithImports: index.imports.size,
    })

    return index
  }

  // Resolve all qualified calls to create cross-file relationships
  export function resolveQualifiedCalls(
    fileContexts: FileContext[],
    index: SymbolIndex,
  ): UniversalRelationship[] {
    const allRelationships: UniversalRelationship[] = []

    for (const context of fileContexts) {
      for (const symbol of context.symbols) {
        if (symbol.qualified_calls && symbol.qualified_calls.length > 0) {
          const result = resolveCallsForSymbol(symbol, context, index)
          allRelationships.push(...result.newRelationships)
        }
      }
    }

    log.info("qualified calls resolved", {
      totalRelationships: allRelationships.length,
      filesProcessed: fileContexts.length,
    })

    return allRelationships
  }

  // Resolve calls for a single symbol
  function resolveCallsForSymbol(
    symbol: UniversalSymbol,
    context: FileContext,
    index: SymbolIndex,
  ): QualificationResult {
    const relationships: UniversalRelationship[] = []
    const unresolvedCalls: string[] = []
    let resolvedCount = 0

    if (!symbol.qualified_calls) {
      return {
        newRelationships: [],
        resolvedCalls: 0,
        unresolvedCalls: [],
        confidence: 1.0,
      }
    }

    for (const call of symbol.qualified_calls) {
      const resolution = resolveCall(call, symbol, context, index)
      if (resolution) {
        relationships.push(resolution)
        resolvedCount++
      } else {
        unresolvedCalls.push(call)
      }
    }

    const confidence = symbol.qualified_calls.length > 0
      ? resolvedCount / symbol.qualified_calls.length
      : 1.0

    return {
      newRelationships: relationships,
      resolvedCalls: resolvedCount,
      unresolvedCalls,
      confidence,
    }
  }

  // Resolve a single call to a relationship
  function resolveCall(
    call: string,
    sourceSymbol: UniversalSymbol,
    context: FileContext,
    index: SymbolIndex,
  ): UniversalRelationship | null {
    // Skip very short or very long calls
    if (call.length < 2 || call.length > 100) return null

    // Parse the call into parts
    const parts = call.split(".")
    if (parts.length === 0) return null

    const sourceId = createSymbolId(sourceSymbol, context.filePath)

    // Strategy 1: Direct qualified name lookup (Class.method)
    if (parts.length >= 2) {
      const qualifiedName = call
      const candidates = index.byQualifiedName.get(qualifiedName) || []

      for (const candidate of candidates) {
        // Prefer same language matches
        if (candidate.metadata?.language === context.language || !candidate.metadata?.language) {
          return {
            source: sourceId,
            target: createSymbolId(candidate, getSymbolFilePath(candidate, context)),
            type: RelationshipType.Calls,
            confidence: 0.9,
            metadata: {
              callText: call,
              resolvedBy: "qualified_lookup",
              targetFile: getSymbolFilePath(candidate, context),
            },
          }
        }
      }
    }

    // Strategy 2: Import resolution
    const importedTarget = resolveViaImports(call, parts, context, index)
    if (importedTarget) {
      return {
        source: sourceId,
        target: createSymbolId(importedTarget.symbol, importedTarget.filePath),
        type: RelationshipType.Calls,
        confidence: importedTarget.confidence,
        metadata: {
          callText: call,
          resolvedBy: "import_resolution",
          targetFile: importedTarget.filePath,
          importAlias: importedTarget.alias,
        },
      }
    }

    // Strategy 3: Simple name lookup (method name only)
    const methodName = parts[parts.length - 1]
    const candidates = index.byName.get(methodName) || []

    // Filter candidates by context (same framework, similar patterns)
    const contextualCandidates = candidates.filter(candidate => {
      // Prefer same language
      if (candidate.metadata?.language !== context.language && candidate.metadata?.language) {
        return false
      }

      // For method calls, prefer methods over other symbol types
      if (parts.length > 1 && candidate.kind !== SymbolKind.Method && candidate.kind !== SymbolKind.Function) {
        return false
      }

      // Framework-specific filtering
      if (context.framework && candidate.metadata?.framework) {
        return candidate.metadata.framework === context.framework
      }

      return true
    })

    if (contextualCandidates.length === 1) {
      // Single match - high confidence
      const target = contextualCandidates[0]
      return {
        source: sourceId,
        target: createSymbolId(target, getSymbolFilePath(target, context)),
        type: RelationshipType.Calls,
        confidence: 0.7,
        metadata: {
          callText: call,
          resolvedBy: "contextual_match",
          targetFile: getSymbolFilePath(target, context),
        },
      }
    } else if (contextualCandidates.length > 1) {
      // Multiple matches - pick most likely one (same file > same framework > first match)
      const sameFileCandidate = contextualCandidates.find(c =>
        getSymbolFilePath(c, context) === context.filePath
      )

      if (sameFileCandidate) {
        return {
          source: sourceId,
          target: createSymbolId(sameFileCandidate, context.filePath),
          type: RelationshipType.Calls,
          confidence: 0.8,
          metadata: {
            callText: call,
            resolvedBy: "same_file_preference",
            targetFile: context.filePath,
          },
        }
      }

      // Framework match
      const frameworkCandidate = contextualCandidates.find(c =>
        c.metadata?.framework === context.framework
      )

      if (frameworkCandidate) {
        return {
          source: sourceId,
          target: createSymbolId(frameworkCandidate, getSymbolFilePath(frameworkCandidate, context)),
          type: RelationshipType.Calls,
          confidence: 0.6,
          metadata: {
            callText: call,
            resolvedBy: "framework_preference",
            targetFile: getSymbolFilePath(frameworkCandidate, context),
          },
        }
      }

      // Fall back to first match with lower confidence
      const firstMatch = contextualCandidates[0]
      return {
        source: sourceId,
        target: createSymbolId(firstMatch, getSymbolFilePath(firstMatch, context)),
        type: RelationshipType.Calls,
        confidence: 0.4,
        metadata: {
          callText: call,
          resolvedBy: "ambiguous_match",
          targetFile: getSymbolFilePath(firstMatch, context),
          alternativeCount: contextualCandidates.length - 1,
        },
      }
    }

    // Strategy 4: Owner-based resolution (this.method, self.method)
    if (parts.length === 2 && (parts[0] === "this" || parts[0] === "self" || parts[0] === "super")) {
      const ownerSymbols = sourceSymbol.ownerName
        ? index.byOwner.get(sourceSymbol.ownerName) || []
        : []

      const methodInClass = ownerSymbols.find(s =>
        s.name === methodName &&
        (s.kind === SymbolKind.Method || s.kind === SymbolKind.Function)
      )

      if (methodInClass) {
        return {
          source: sourceId,
          target: createSymbolId(methodInClass, context.filePath),
          type: RelationshipType.Calls,
          confidence: 0.95,
          metadata: {
            callText: call,
            resolvedBy: "owner_method",
            targetFile: context.filePath,
          },
        }
      }
    }

    return null
  }

  // Resolve call via import statements
  function resolveViaImports(
    call: string,
    parts: string[],
    context: FileContext,
    index: SymbolIndex,
  ): { symbol: UniversalSymbol; filePath: string; confidence: number; alias?: string } | null {
    const imports = index.imports.get(context.filePath) || []

    for (const imp of imports) {
      // Check if first part matches import alias
      if (imp.alias && parts[0] === imp.alias) {
        // Look for the method in the imported module
        const methodName = parts.length > 1 ? parts[parts.length - 1] : parts[0]
        const moduleSymbols = findSymbolsInModule(imp.module, index)

        const matchingSymbol = moduleSymbols.find(s => s.name === methodName)
        if (matchingSymbol) {
          return {
            symbol: matchingSymbol,
            filePath: getSymbolFilePath(matchingSymbol, context),
            confidence: 0.85,
            alias: imp.alias,
          }
        }
      }

      // Check if call matches specific imported items
      if (imp.items.includes(parts[0])) {
        const methodName = parts.length > 1 ? parts[parts.length - 1] : parts[0]
        const moduleSymbols = findSymbolsInModule(imp.module, index)

        const matchingSymbol = moduleSymbols.find(s => s.name === methodName)
        if (matchingSymbol) {
          return {
            symbol: matchingSymbol,
            filePath: getSymbolFilePath(matchingSymbol, context),
            confidence: 0.9,
          }
        }
      }

      // Default imports (import module)
      if (imp.isDefault && parts[0] === getModuleName(imp.module)) {
        const methodName = parts.length > 1 ? parts[parts.length - 1] : parts[0]
        const moduleSymbols = findSymbolsInModule(imp.module, index)

        const matchingSymbol = moduleSymbols.find(s => s.name === methodName)
        if (matchingSymbol) {
          return {
            symbol: matchingSymbol,
            filePath: getSymbolFilePath(matchingSymbol, context),
            confidence: 0.8,
          }
        }
      }
    }

    return null
  }

  // Find symbols in a specific module/package
  function findSymbolsInModule(moduleName: string, index: SymbolIndex): UniversalSymbol[] {
    // Convert module name to potential file paths
    const possiblePaths = [
      moduleName + '.ts',
      moduleName + '.js',
      moduleName + '.py',
      moduleName + '.go',
      moduleName + '/index.ts',
      moduleName + '/index.js',
      'src/' + moduleName + '.ts',
      'src/' + moduleName + '.js',
      'lib/' + moduleName + '.ts',
    ]

    const foundSymbols: UniversalSymbol[] = []

    // Search for symbols in all possible file paths
    for (const [filePath, symbols] of Array.from(index.byName.entries())) {
      for (const path of possiblePaths) {
        if (filePath.endsWith(path) || filePath.includes(moduleName)) {
          // Get all exported symbols from this file
          const exportedSymbols = symbols.filter(s => s.visibility === 'public' || s.kind === 'function' || s.kind === 'class')
          foundSymbols.push(...exportedSymbols)
        }
      }
    }

    return foundSymbols
  }

  // Helper functions
  function createSymbolId(symbol: UniversalSymbol, filePath: string): string {
    const location = `${filePath}:${symbol.range.startLine}:${symbol.range.startColumn}`
    const qualified = symbol.ownerName ? `${symbol.ownerName}.${symbol.name}` : symbol.name
    return `${qualified}@${location}`
  }

  function getSymbolFilePath(symbol: UniversalSymbol, context: FileContext): string {
    // For now, assume symbols are in the context file
    // In a full implementation, this would track which file each symbol comes from
    return context.filePath
  }

  function getModuleName(modulePath: string): string {
    // Extract module name from path: "package.subpackage.module" -> "module"
    const parts = modulePath.split(/[/.\\]/)
    return parts[parts.length - 1]
  }

  // Language-specific call resolution strategies
  export const LanguageStrategies = {
    // TypeScript/JavaScript specific resolution
    typescript: {
      resolveFrameworkCalls(call: string, context: FileContext): string | null {
        // React hooks
        if (call.startsWith("use") && context.framework === "react") {
          return "react.hooks." + call
        }

        // Node.js built-ins
        const nodeBuiltins = ["require", "process.env", "console.log", "__dirname", "__filename"]
        if (nodeBuiltins.some(builtin => call.includes(builtin))) {
          return "node.builtin." + call
        }

        return null
      }
    },

    // Dart/Flutter specific resolution
    dart: {
      resolveFrameworkCalls(call: string, context: FileContext): string | null {
        // Flutter widgets
        if (context.framework === "flutter") {
          const flutterWidgets = [
            "Widget", "StatelessWidget", "StatefulWidget", "State",
            "Container", "Row", "Column", "Text", "Icon", "Padding",
            "Scaffold", "AppBar", "FloatingActionButton", "Navigator"
          ]

          if (flutterWidgets.some(widget => call.includes(widget))) {
            return "flutter.widgets." + call
          }
        }

        // Dart built-ins
        const dartBuiltins = ["print", "debugPrint"]
        if (dartBuiltins.includes(call)) {
          return "dart.core." + call
        }

        return null
      }
    },

    // Python specific resolution
    python: {
      resolveFrameworkCalls(call: string, context: FileContext): string | null {
        // Django
        if (context.framework === "django") {
          if (call.includes("models.") || call.includes("views.") || call.includes("forms.")) {
            return "django." + call
          }
        }

        // Flask
        if (context.framework === "flask") {
          if (call.includes("request.") || call.includes("session.") || call.includes("app.")) {
            return "flask." + call
          }
        }

        return null
      }
    },

    // Java specific resolution
    java: {
      resolveFrameworkCalls(call: string, context: FileContext): string | null {
        // Spring Framework
        if (context.framework === "spring") {
          if (call.includes("@Autowired") || call.includes("@Service") || call.includes("@Repository")) {
            return "spring." + call
          }
        }

        // Java built-ins
        if (call.startsWith("System.") || call.startsWith("String.") || call.startsWith("Math.")) {
          return "java.lang." + call
        }

        return null
      }
    }
  }

  // Performance optimizations for large codebases
  export function createOptimizedIndex(fileContexts: FileContext[]): SymbolIndex {
    // For large codebases (100k+ symbols), use more efficient indexing:
    // 1. Bloom filters for quick negative lookups
    // 2. Trie structures for prefix matching
    // 3. Parallel indexing
    // 4. Incremental updates

    // For now, use the standard implementation
    return buildSymbolIndex(fileContexts)
  }

  // Batch relationship resolution for performance
  export function batchResolveRelationships(
    fileContexts: FileContext[],
    batchSize: number = 1000,
  ): UniversalRelationship[] {
    const index = buildSymbolIndex(fileContexts)
    const allRelationships: UniversalRelationship[] = []

    // Process files in batches to manage memory
    for (let i = 0; i < fileContexts.length; i += batchSize) {
      const batch = fileContexts.slice(i, i + batchSize)
      const batchRelationships = resolveQualifiedCalls(batch, index)
      allRelationships.push(...batchRelationships)

      log.info("batch processed", {
        batchNumber: Math.floor(i / batchSize) + 1,
        filesInBatch: batch.length,
        relationshipsFound: batchRelationships.length,
      })
    }

    return allRelationships
  }
}