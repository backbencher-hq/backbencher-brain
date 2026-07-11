// Batch Storage — Write file parse results to SQLite in batches
// Ported from backbencher's parallel-indexer.ts storeResults()
// Handles: file records, brain_symbol, brain_relationship (5-strategy resolution),
// brain_import, taint flows, semantic embeddings

import { relative } from "path"
import type Database from "better-sqlite3"
import { createLogger } from "../util/log.js"

const log = createLogger("store")

// ============================================================================
// TYPES
// ============================================================================

export interface FileResult {
  filePath: string
  success: boolean
  timeout?: boolean
  error?: string
  brain_symbol?: any[]
  brain_relationship?: any[]
  brain_import?: any[]
  language?: string
  framework?: string
  fileHash?: string
  sizeBytes?: number
  lastModified?: number
  errors?: any[]
}

export interface StoreStats {
  symbols: number
  relationships: number
  imports: number
}

// ============================================================================
// MAIN STORE FUNCTION
// ============================================================================

export function storeResults(
  db: Database.Database,
  projectHash: string,
  projectPath: string,
  results: FileResult[],
): StoreStats {
  let totalSymbols = 0
  let totalRelationships = 0
  let totalImports = 0

  // Generic names to skip
  const ANALYZER_GENERIC_NAMES = new Set([
    "global", "Global", "unknown", "SCSS_FILE_SCOPE",
    "window", "self", "module", "exports", "default",
    "package_manifest", "GlobalScope",
  ])

  // Intra-class receivers
  const INTRA_CLASS_RECEIVERS = new Set(["self", "this", "me", "Self"])

  // Languages with SQL/exec APIs
  const LANGUAGES_WITH_SQL = new Set([
    "java", "python", "go", "php", "ruby", "csharp", "kotlin", "scala",
    "typescript", "javascript", "tsx", "jsx", "rust", "swift", "dart",
    "perl", "lua", "groovy", "cpp", "c", "elixir", "clojure", "r", "powershell", "zig",
  ])

  const now = Date.now()

  // Prepare statements
  const insertFile = db.prepare(`
    INSERT OR REPLACE INTO brain_file
    (id, project_hash, path, relative_path, file_hash, size_bytes, last_modified, language, framework, layer, is_test, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertSymbol = db.prepare(`
    INSERT OR REPLACE INTO brain_symbol
    (id, project_hash, file_id, name, qualified_name, kind, line_start, line_end, byte_start, byte_end, visibility, parameters, return_type, qualified_calls, complexity, gravity_score, layer, owner_symbol_id, annotations, is_async, is_static, is_abstract, generic_parameters)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertImport = db.prepare(`
    INSERT OR REPLACE INTO brain_import
    (id, project_hash, file_id, imported_name, import_path, import_type, is_external, line_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertRelationship = db.prepare(`
    INSERT OR REPLACE INTO brain_relationship
    (id, project_hash, source_symbol_id, target_symbol_id, target_external, relationship_type, confidence, line_number, is_cross_file, is_cross_language, bridge_mechanism)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertTaint = db.prepare(`
    INSERT OR REPLACE INTO brain_taint_flow
    (id, project_hash, source_symbol_id, sink_symbol_id, source_type, sink_type, vulnerability_type, severity, is_mitigated, flow_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const deleteFileSymbols = db.prepare("DELETE FROM brain_symbol WHERE file_id = ?")
  const deleteFileImports = db.prepare("DELETE FROM brain_import WHERE file_id = ?")
  const deleteFileRelationships = db.prepare(`
    DELETE FROM brain_relationship WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
  `)
  const deleteFileTaints = db.prepare(`
    DELETE FROM brain_taint_flow WHERE source_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
       OR sink_symbol_id IN (SELECT id FROM brain_symbol WHERE file_id = ?)
  `)

  // Pre-resolve targets across the entire DB
  const resolveTargetStmt = db.prepare(
    "SELECT id FROM brain_symbol WHERE project_hash = ? AND name = ? LIMIT 1"
  )

  // Two-phase insert: disable FK during batch for performance/correctness
  // (brain_relationship may reference brain_symbol being inserted in the same batch)
  db.pragma("foreign_keys = OFF")

  const tx = db.transaction(() => {
    for (const result of results) {
      if (!result.success) continue

      const relativePath = relative(projectPath, result.filePath)
      const fileId = `${projectHash}:${relativePath}`
      const pathLower = relativePath.toLowerCase()

      // Clean existing data for this file
      deleteFileRelationships.run(fileId)
      deleteFileTaints.run(fileId, fileId)
      deleteFileSymbols.run(fileId)
      deleteFileImports.run(fileId)

      // Classify layer
      let fileLayer = "core"
      if (pathLower.includes("/ui/") || pathLower.includes("/components/") || pathLower.includes("/pages/")) {
        fileLayer = "ui"
      } else if (pathLower.includes("/db/") || pathLower.includes("/database/") || pathLower.includes("/repository/") || pathLower.includes("/models/")) {
        fileLayer = "db"
      } else if (pathLower.includes("/services/") || pathLower.includes("/api/") || pathLower.includes("/controllers/")) {
        fileLayer = "service"
      } else if (pathLower.includes("test") || pathLower.includes("spec")) {
        fileLayer = "test"
      }

      // Override layer if framework is detected
      if (result.brain_import) {
        const hasFramework = result.brain_import.some(
          (i: any) =>
            typeof i.module === "string" &&
            (i.module.includes("react") || i.module.includes("vue") || i.module.includes("svelte")),
        )
        if (hasFramework) fileLayer = "ui"
      }

      const isTestFile = pathLower.includes("/test/") || pathLower.includes("/tests/") ||
        pathLower.includes("/__tests__/") || pathLower.includes("/spec/") ||
        pathLower.includes(".test.") || pathLower.includes(".spec.") ? 1 : 0

      // Insert file record
      insertFile.run(
        fileId, projectHash, result.filePath, relativePath,
        result.fileHash || "", result.sizeBytes || 0,
        result.lastModified || now, result.language || "unknown",
        result.framework || null, fileLayer, isTestFile, now,
      )

      // Insert brain_symbol
      if (result.brain_symbol) {
        for (const symbol of result.brain_symbol) {
          const symbolKind = symbol.type || symbol.kind || "unknown"
          if (symbolKind === "unknown" && ANALYZER_GENERIC_NAMES.has(symbol.name)) continue

          const startLine = symbol.startLine ?? symbol.range?.startLine ?? 0
          const endLine = symbol.endLine ?? symbol.range?.endLine ?? startLine
          const startIndex = symbol.startIndex ?? symbol.range?.startIndex ?? null
          const endIndex = symbol.endIndex ?? symbol.range?.endIndex ?? null

          const symbolId = `${fileId}:${symbol.name}:${startLine}`

          // Resolve owner
          let ownerSymbolId: string | null = null
          if (symbol.ownerName && symbol.ownerKind) {
            ownerSymbolId = `${fileId}:${symbol.ownerName}:0`
          } else if (symbol.qualifiedName && symbol.qualifiedName.includes(".")) {
            const qnParts = symbol.qualifiedName.split(".")
            if (qnParts.length >= 2) {
              const ownerFromQn = result.brain_symbol?.find((s: any) => s.name === qnParts[qnParts.length - 2])
              if (ownerFromQn) {
                const parentStartLine = ownerFromQn.startLine ?? ownerFromQn.range?.startLine ?? 0
                ownerSymbolId = `${fileId}:${ownerFromQn.name}:${parentStartLine}`
              }
            }
          }

          insertSymbol.run(
            symbolId, projectHash, fileId, symbol.name,
            symbol.qualifiedName || symbol.name, symbolKind,
            startLine, endLine, startIndex, endIndex,
            symbol.visibility || "public",
            symbol.parameters ? JSON.stringify(symbol.parameters) : null,
            symbol.returnType || null,
            symbol.qualifiedCalls ? JSON.stringify(symbol.qualifiedCalls) : null,
            symbol.complexity || 1,
            (symbol.complexity || 1) * (symbol.visibility === "public" ? 1.5 : 1.0),
            symbol.layer || fileLayer,
            ownerSymbolId,
            symbol.metadata ? JSON.stringify(symbol.metadata) : symbol.decorators ? JSON.stringify(symbol.decorators) : null,
            symbol.isAsync ? 1 : 0,
            symbol.isStatic ? 1 : 0,
            symbol.isAbstract ? 1 : 0,
            symbol.genericParameters ? JSON.stringify(symbol.genericParameters) : null,
          )
          totalSymbols++

          // Process taint sources and sinks
          if (symbol.taintSources || symbol.taintSinks) {
            const sources = symbol.taintSources || []
            const sinks = symbol.taintSinks || []

            if (sources.length > 0 && sinks.length > 0) {
              for (const source of sources) {
                for (const sink of sinks) {
                  const taintId = `taint:${projectHash}:${symbolId}:${source.type}:${sink.type}`
                  const severity =
                    sink.vulnerability_type === "sql_injection" || sink.vulnerability_type === "command_injection"
                      ? "critical" : "high"
                  insertTaint.run(taintId, projectHash, symbolId, symbolId, source.type, sink.type, sink.vulnerability_type, severity, 0, JSON.stringify([symbolId]))
                }
              }
            } else if (sources.length > 0) {
              for (let i = 0; i < sources.length; i++) {
                const source = sources[i]
                insertTaint.run(`taint_src:${projectHash}:${symbolId}:${source.type}:${i}`, projectHash, symbolId, null, source.type, "unresolved", "unresolved", "unknown", 0, JSON.stringify([symbolId]))
              }
            } else if (sinks.length > 0) {
              for (let i = 0; i < sinks.length; i++) {
                const sink = sinks[i]
                const severity = sink.vulnerability_type === "sql_injection" ? "critical" : "high"
                insertTaint.run(`taint_snk:${projectHash}:${symbolId}:${sink.type}:${i}`, projectHash, null, symbolId, "unresolved", sink.type, sink.vulnerability_type, severity, 0, JSON.stringify([symbolId]))
              }
            }
          }

          // Heuristic taint detection for languages without explicit taint
          if (!symbol.taintSources && !symbol.taintSinks && symbolKind === "function" && LANGUAGES_WITH_SQL.has(result.language?.toLowerCase() || "")) {
            const snippet = symbol.snippet || ""
            const qualifiedCalls = symbol.qualifiedCalls || []
            const hasStringConcat = snippet.includes("+ ") || snippet.includes("concat")
            const callsPattern = [...qualifiedCalls, snippet].join(" ")

            if (hasStringConcat && /execute|query|find|insert|update|delete.*where|cursor/i.test(callsPattern)) {
              // Potential SQL injection — store as isolated sink
              insertTaint.run(`taint_h:${projectHash}:${symbolId}:sql_injection:0`, projectHash, null, symbolId, "unresolved", "sql_query", "sql_injection", "high", 0, JSON.stringify([symbolId]))
            }
          }
        }
      }

      // Insert brain_import
      if (result.brain_import) {
        for (const imp of result.brain_import) {
          if (!imp.name) continue
          const importId = `${fileId}:import:${imp.name}:${imp.line || 0}`
          insertImport.run(importId, projectHash, fileId, imp.name || "unknown", imp.path || "", imp.type || "named", imp.isExternal ? 1 : 0, imp.line || 0)
          totalImports++
        }
      }

      // Insert brain_relationship with 5-strategy source resolution
      if (result.brain_relationship) {
        for (const rel of result.brain_relationship) {
          const sourceName = rel.source || rel.sourceId || rel.fromSymbol || rel.from || "unknown"
          const targetName = rel.targetExternal || rel.targetId || rel.target || rel.toSymbol || rel.to || "unknown"
          const relType = rel.type || rel.relationshipType || "references"
          if (relType === "contains") continue

          // Extract leaf name for resolution
          const extractLeaf = (name: string) => {
            const noLine = name.replace(/:\d+$/, "")
            const byColon = noLine.split(":")
            const lastColon = byColon[byColon.length - 1] || name
            const byDot = lastColon.split(".")
            return byDot[byDot.length - 1] || lastColon
          }
          const sourceLeaf = extractLeaf(sourceName)
          const targetLeaf = extractLeaf(targetName)

          // 5-strategy source symbol lookup
          const sourceSymbol = result.brain_symbol?.find((s: any) => {
            if (!sourceName || sourceName === "unknown") return false
            if (s.name === sourceName) return true
            if (s.name === sourceLeaf) return true
            if (sourceName.endsWith(`:${s.name}`)) return true
            if (sourceName.endsWith(`.${s.name}`)) return true
            if (s.qualifiedName && sourceName === s.qualifiedName) return true
            return false
          })

          let sourceId: string
          if (sourceSymbol) {
            sourceId = `${fileId}:${sourceSymbol.name}:${sourceSymbol.startLine || 0}`
          } else {
            // Handle intra-class receivers
            if (INTRA_CLASS_RECEIVERS.has(sourceLeaf)) {
              const enclosingSymbol = result.brain_symbol?.find((s: any) => {
                const kind = s.type || s.kind || "unknown"
                return ["class", "interface", "struct", "trait", "enum", "object", "actor", "impl"].includes(kind)
              })
              if (enclosingSymbol) {
                sourceId = `${fileId}:${enclosingSymbol.name}:${enclosingSymbol.startLine || 0}`
                if (!result.brain_symbol?.some((s: any) => s.name === enclosingSymbol.name)) {
                  // Insert a dummy source
                  insertSymbol.run(sourceId, projectHash, fileId, enclosingSymbol.name, enclosingSymbol.name, "class", 0, 0, null, null, "public", null, null, null, 1, 1.0, "core", null, null, 0, 0, 0, null)
                  totalSymbols++
                }
                // Skip the rest
                const targetId = resolveTargetStmt.get(projectHash, targetLeaf) as any
                const relId = `${projectHash}:rel:${sourceId}:${targetName}:${relType}`
                insertRelationship.run(relId, projectHash, sourceId, targetId?.id || null, targetName, relType, rel.confidence || 1.0, 0, 1, 0, null)
                totalRelationships++
                continue
              }
            }
            // Skip unresolvable
            continue
          }

          // Resolve target
          const targetRow = resolveTargetStmt.get(projectHash, targetLeaf) as any
          const targetId = targetRow?.id || null

          const relId = `${projectHash}:rel:${sourceId}:${targetName}:${relType}`
          insertRelationship.run(relId, projectHash, sourceId, targetId, targetName, relType, rel.confidence || 1.0, 0, 1, 0, null)
          totalRelationships++
        }
      }
    }
  })

  try {
    tx()
    db.pragma("foreign_keys = ON")
  } catch (err: any) {
    db.pragma("foreign_keys = ON")
    log.error("batch insert failed", { error: err?.message, batchSize: results.length })
  }

  return { symbols: totalSymbols, relationships: totalRelationships, imports: totalImports }
}
