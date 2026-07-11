// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import * as Log from "../tool/brain-log.js"
import { CrossFileQualifier } from "./qualifier"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

type UniversalSymbol = UniversalSymbol
type UniversalRelationship = UniversalRelationship

const log = Log.create({ service: "ast-integration" })

/**
 * Integration layer for cross-file relationship resolution
 * This connects the qualifier system with the main indexing pipeline
 */
export namespace CrossFileIntegration {

  export interface ProjectContext {
    projectId: string
    files: Map<string, FileData>
    symbols: UniversalSymbol[]
    relationships: UniversalRelationship[]
  }

  export interface FileData {
    filePath: string
    content: string
    language: string
    framework?: string
    symbols: UniversalSymbol[]
    imports: ImportInfo[]
  }

  export interface ImportInfo {
    importedName: string
    localName: string
    fromModule: string
    importType: 'default' | 'named' | 'namespace' | 'side-effect'
    isTypeOnly?: boolean
  }

  export interface ResolutionResult {
    resolvedRelationships: UniversalRelationship[]
    stats: {
      totalFiles: number
      totalSymbols: number
      totalRelationships: number
      resolvedCount: number
      resolutionRate: number
      unresolvedTargets: string[]
      processingTimeMs: number
    }
  }

  /**
   * Main entry point: resolve relationships across all files in a project
   */
  export async function resolveProjectRelationships(
    context: ProjectContext
  ): Promise<ResolutionResult> {
    const startTime = Date.now()

    log.info("starting project-wide relationship resolution", {
      projectId: context.projectId,
      totalFiles: context.files.size,
      totalSymbols: context.symbols.length,
      totalRelationships: context.relationships.length
    })

    // Convert to file contexts for qualifier
    const fileContexts: CrossFileQualifier.FileContext[] = Array.from(context.files.values()).map(fileData => ({
      filePath: fileData.filePath,
      symbols: fileData.symbols,
      imports: fileData.imports.map(imp => ({
        filePath: fileData.filePath,
        module: imp.fromModule,
        alias: imp.localName !== imp.importedName ? imp.localName : undefined,
        items: [imp.importedName],
        isDefault: imp.importType === 'default'
      })),
      language: fileData.language,
      framework: fileData.framework
    }))

    // Build symbol index
    const symbolIndex = CrossFileQualifier.buildSymbolIndex(fileContexts)

    // Resolve qualified calls to create new relationships
    const crossFileRelationships = CrossFileQualifier.resolveQualifiedCalls(fileContexts, symbolIndex)

    // Merge with existing relationships
    const allRelationships = [...context.relationships, ...crossFileRelationships]

    // Calculate stats
    const resolvedCount = crossFileRelationships.filter(rel => (rel.confidence || 0) > 0.5).length
    const unresolvedTargets = crossFileRelationships
      .filter(rel => (rel.confidence || 0) <= 0.5)
      .map(rel => rel.metadata?.callText || rel.target || 'unknown')
      .slice(0, 20)

    const processingTimeMs = Date.now() - startTime

    const result: ResolutionResult = {
      resolvedRelationships: allRelationships,
      stats: {
        totalFiles: context.files.size,
        totalSymbols: context.symbols.length,
        totalRelationships: allRelationships.length,
        resolvedCount,
        resolutionRate: resolvedCount / Math.max(crossFileRelationships.length, 1),
        unresolvedTargets,
        processingTimeMs
      }
    }

    log.info("project relationship resolution completed", result.stats)

    return result
  }

  /**
   * Incremental resolution for when a single file changes
   */
  export async function resolveIncrementalChanges(
    context: ProjectContext,
    changedFilePath: string
  ): Promise<ResolutionResult> {
    log.info("resolving incremental changes", { changedFilePath })

    // Get the changed file
    const changedFile = context.files.get(changedFilePath)
    if (!changedFile) {
      throw new Error(`File not found in project: ${changedFilePath}`)
    }

    // Remove old relationships for this file
    const filteredRelationships = context.relationships.filter(rel =>
      !(rel.source || "").includes(changedFilePath) &&
      !(rel.target && rel.target.includes(changedFilePath))
    )

    // Create new context with updated relationships
    const updatedContext: ProjectContext = {
      ...context,
      relationships: filteredRelationships
    }

    // Run full resolution (for now - could be optimized later)
    return resolveProjectRelationships(updatedContext)
  }

  /**
   * Extract imports from file content using language-specific parsers
   */
  export function extractImports(filePath: string, content: string, language: string): ImportInfo[] {
    const imports: ImportInfo[] = []

    switch (language) {
      case 'typescript':
      case 'javascript':
        return extractTypeScriptImports(content)

      case 'python':
        return extractPythonImports(content)

      case 'go':
        return extractGoImports(content)

      default:
        log.warn("unsupported language for import extraction", { language, filePath })
        return []
    }
  }

  function extractTypeScriptImports(content: string): ImportInfo[] {
    const imports: ImportInfo[] = []

    // Match various import patterns
    const patterns = [
      // import { name1, name2 } from 'module'
      /import\s*{\s*([^}]+)\s*}\s*from\s*['"]([^'"]+)['"]/g,
      // import name from 'module'
      /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
      // import * as name from 'module'
      /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
      // import 'module' (side-effect)
      /import\s*['"]([^'"]+)['"]/g
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        if (match[2]) {
          // Named or default imports
          const importedItems = match[1] ? match[1].split(',').map(s => s.trim()) : []
          for (const item of importedItems) {
            const [importedName, localName] = item.includes(' as ')
              ? item.split(' as ').map(s => s.trim())
              : [item, item]

            imports.push({
              importedName: importedName.trim(),
              localName: localName.trim(),
              fromModule: match[2],
              importType: pattern.source.includes('\\*') ? 'namespace' : 'named'
            })
          }
        } else {
          // Side-effect import
          imports.push({
            importedName: '',
            localName: '',
            fromModule: match[1],
            importType: 'side-effect'
          })
        }
      }
    }

    return imports
  }

  function extractPythonImports(content: string): ImportInfo[] {
    const imports: ImportInfo[] = []

    const patterns = [
      // from module import name1, name2
      /from\s+([^\s]+)\s+import\s+([^\n]+)/g,
      // import module
      /^import\s+([^\n]+)/gm,
      // import module as alias
      /import\s+(\w+(?:\.\w+)*)\s+as\s+(\w+)/g
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        if (pattern.source.includes('from')) {
          // from X import Y
          const module = match[1]
          const importedItems = match[2].split(',').map(s => s.trim())

          for (const item of importedItems) {
            const [importedName, localName] = item.includes(' as ')
              ? item.split(' as ').map(s => s.trim())
              : [item, item]

            imports.push({
              importedName: importedName.trim(),
              localName: localName.trim(),
              fromModule: module,
              importType: 'named'
            })
          }
        } else {
          // import X or import X as Y
          const parts = match[1].split(' as ')
          const moduleName = parts[0].trim()
          const localName = parts[1] ? parts[1].trim() : moduleName

          imports.push({
            importedName: moduleName,
            localName,
            fromModule: moduleName,
            importType: 'default'
          })
        }
      }
    }

    return imports
  }

  function extractGoImports(content: string): ImportInfo[] {
    const imports: ImportInfo[] = []

    // Match Go import patterns
    const patterns = [
      // import "package"
      /import\s+"([^"]+)"/g,
      // import alias "package"
      /import\s+(\w+)\s+"([^"]+)"/g,
      // Multi-line imports
      /import\s*\(\s*([\s\S]*?)\s*\)/g
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        if (pattern.source.includes('\\(')) {
          // Multi-line import block
          const lines = match[1].split('\n').map(line => line.trim()).filter(Boolean)
          for (const line of lines) {
            const lineMatch = line.match(/^(\w+\s+)?"([^"]+)"/)
            if (lineMatch) {
              const alias = lineMatch[1] ? lineMatch[1].trim() : undefined
              const packagePath = lineMatch[2]
              const packageName = packagePath.split('/').pop() || packagePath

              imports.push({
                importedName: packageName,
                localName: alias || packageName,
                fromModule: packagePath,
                importType: 'default'
              })
            }
          }
        } else {
          // Single import
          const alias = match[2] ? match[1] : undefined
          const packagePath = match[2] || match[1]
          const packageName = packagePath.split('/').pop() || packagePath

          imports.push({
            importedName: packageName,
            localName: alias || packageName,
            fromModule: packagePath,
            importType: 'default'
          })
        }
      }
    }

    return imports
  }

  /**
   * Detect framework from file patterns and content
   */
  export function detectFramework(filePath: string, content: string): string | undefined {
    // React detection
    if (content.includes('import React') || content.includes('from "react"') ||
        content.includes('useState') || content.includes('useEffect') ||
        filePath.includes('.jsx') || filePath.includes('.tsx')) {
      return 'react'
    }

    // Next.js detection
    if (content.includes('next/') || filePath.includes('pages/') ||
        content.includes('getServerSideProps') || content.includes('getStaticProps')) {
      return 'nextjs'
    }

    // Django detection
    if (content.includes('from django') || content.includes('import django') ||
        content.includes('models.Model') || content.includes('@login_required')) {
      return 'django'
    }

    // Flask detection
    if (content.includes('from flask') || content.includes('@app.route') ||
        content.includes('Flask(__name__)')) {
      return 'flask'
    }

    // Express detection
    if (content.includes('express()') || content.includes('app.get') ||
        content.includes('req, res') || content.includes('from "express"')) {
      return 'express'
    }

    // Spring Boot detection
    if (content.includes('@SpringBootApplication') || content.includes('@RestController') ||
        content.includes('import org.springframework')) {
      return 'spring'
    }

    // Flutter detection
    if (content.includes('import \'package:flutter') || content.includes('StatelessWidget') ||
        content.includes('StatefulWidget') || filePath.includes('lib/')) {
      return 'flutter'
    }

    return undefined
  }
}