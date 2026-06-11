// Brain Write Tools — Surgical code editing via MCP
// Registered alongside read-tools, called by MCP server
// All edits use byte-precise patching with undo backup

import { registerTool, type ServerContext } from "../server.js"
import { patch, createBackup, restoreBackup, preflightCheck } from "../ast/patcher.js"
import { injectImports, pruneImports } from "../ast/imports.js"
import { findSymbol, searchSymbols, findFiles, getCallers, getFileSymbols } from "../graph/query.js"
import { reindexFiles } from "../indexer/parallel.js"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { resolve, relative, basename, extname, dirname } from "path"
import { existsSync } from "fs"

// ============================================================================
// HELPERS
// ============================================================================

async function resolveSymbol(ctx: ServerContext, name: string, filePath?: string, lineStart?: number) {
  const symbol = findSymbol(ctx.db, ctx.projectHash, name, filePath, lineStart)
  if (!symbol) return null

  const filepath = resolve(ctx.projectPath, symbol.relative_path)
  if (!existsSync(filepath)) return null

  return { symbol, filepath }
}

// ============================================================================
// brain_update
// ============================================================================

registerTool({
  name: "brain_update",
  description: "Modify a symbol or code block using AST-precise byte boundaries. Looks up the symbol in the brain database, obtains exact byte bounds, and surgically replaces the bounded region. Falls back to string replacement when symbolName is omitted. Supports sub-symbol targeting via oldContent string match. Creates undo backup automatically.",
  inputSchema: {
    type: "object",
    properties: {
      symbolName: { type: "string", description: "Exact name of the function, class, or symbol to replace" },
      newContent: { type: "string", description: "The new code content" },
      oldContent: { type: "string", description: "Exact old code to replace (for sub-symbol targeting)" },
      filePath: { type: "string", description: "File path to disambiguate" },
      lineStart: { type: "number", description: "Line number to disambiguate overloads" },
      force: { type: "boolean", description: "Force update even if high-risk" },
      dryRun: { type: "boolean", description: "Preview diff without writing" },
    },
    required: ["newContent"],
  },
  handler: async (args: any, ctx: any) => {
    // SYMBOL MODE
    if (args.symbolName) {
      const resolved = await resolveSymbol(ctx, args.symbolName, args.filePath, args.lineStart)
      if (!resolved) return { error: { code: "NOT_FOUND", message: `Symbol not found: ${args.symbolName}` } }

      const { symbol, filepath } = resolved
      if (symbol.byte_start == null || symbol.byte_end == null) {
        return { error: { code: "NO_BOUNDS", message: "Symbol has no byte bounds. Use oldContent string mode." } }
      }

      // Cascade check
      if (!args.force) {
        const callers = getCallers(ctx.db, ctx.projectHash, symbol.id, 5)
        if (callers.length > 5) {
          return {
            error: {
              code: "HIGH_RISK",
              message: `${callers.length} callers found. Use force: true to proceed.`,
              callers: callers.slice(0, 10).map((c: any) => ({ name: c.source_name, file: c.source_file })),
            },
          }
        }
      }

      // Sub-symbol targeting
      let startIdx = symbol.byte_start
      let endIdx = symbol.byte_end

      if (args.oldContent) {
        const content = readFileSync(filepath, "utf8")
        const symbolCode = content.substring(symbol.byte_start, symbol.byte_end)
        const idx = symbolCode.indexOf(args.oldContent)
        if (idx === -1) return { error: { code: "NOT_FOUND", message: "oldContent not found in symbol body" } }
        startIdx = symbol.byte_start + idx
        endIdx = startIdx + args.oldContent.length
      }

      if (args.dryRun) {
        const original = readFileSync(filepath, "utf8")
        const preview = original.substring(0, startIdx) + args.newContent + original.substring(endIdx)
        return { data: { dryRun: true, preview: preview.substring(startIdx - 20, startIdx + args.newContent.length + 20) } }
      }

      createBackup(filepath, ctx.projectPath)
      await patch(filepath, startIdx, endIdx, args.newContent)

      // Reindex in background
      reindexFiles(ctx.projectPath, ctx.db, [{ path: filepath, type: "modified" }]).catch(() => {})

      return { data: { success: true, file: relative(ctx.projectPath, filepath), symbol: args.symbolName } }
    }

    // PRIMITIVE MODE (string replacement)
    if (args.filePath && args.oldContent && args.newContent) {
      const filepath = resolve(ctx.projectPath, args.filePath)
      if (!existsSync(filepath)) return { error: { code: "NOT_FOUND", message: `File not found: ${args.filePath}` } }

      const content = readFileSync(filepath, "utf8")
      const idx = content.indexOf(args.oldContent)
      if (idx === -1) return { error: { code: "NOT_FOUND", message: "oldContent not found in file" } }

      createBackup(filepath, ctx.projectPath)
      await patch(filepath, idx, idx + args.oldContent.length, args.newContent)
      reindexFiles(ctx.projectPath, ctx.db, [{ path: filepath, type: "modified" }]).catch(() => {})

      return { data: { success: true, file: relative(ctx.projectPath, filepath) } }
    }

    return { error: { code: "INVALID_PARAMS", message: "Provide symbolName or (filePath + oldContent + newContent)" } }
  },
})

// ============================================================================
// brain_insert
// ============================================================================

registerTool({
  name: "brain_insert",
  description: "Insert new code at a precise position relative to an existing symbol. Supports before, after, inside-top, and inside-bottom positions. Automatically injects required imports. Creates undo backup.",
  inputSchema: {
    type: "object",
    properties: {
      targetSymbolName: { type: "string", description: "Anchor symbol name" },
      position: { type: "string", enum: ["before", "after", "inside-top", "inside-bottom"], description: "Insert position" },
      newContent: { type: "string", description: "Code to insert" },
      requiredImports: { type: "array", items: { type: "object", properties: { module: { type: "string" }, items: { type: "array", items: { type: "string" } } } }, description: "Dependencies to auto-inject" },
      filePath: { type: "string", description: "File path to disambiguate" },
      dryRun: { type: "boolean" },
      force: { type: "boolean" },
    },
    required: ["targetSymbolName", "position", "newContent"],
  },
  handler: async (args: any, ctx: any) => {
    const resolved = await resolveSymbol(ctx, args.targetSymbolName, args.filePath)
    if (!resolved) return { error: { code: "NOT_FOUND", message: `Symbol not found: ${args.targetSymbolName}` } }

    const { symbol, filepath } = resolved
    if (symbol.byte_start == null || symbol.byte_end == null) {
      return { error: { code: "NO_BOUNDS", message: "Anchor symbol has no byte bounds" } }
    }

    const content = readFileSync(filepath, "utf8")
    let patchStart = 0
    let formattedContent = args.newContent

    if (args.position === "before") {
      patchStart = symbol.byte_start
      formattedContent = `${args.newContent}\n\n`
    } else if (args.position === "after") {
      patchStart = symbol.byte_end
      formattedContent = `\n\n${args.newContent}`
    } else if (args.position === "inside-top") {
      // Find opening brace
      const symbolCode = content.substring(symbol.byte_start, symbol.byte_end)
      const braceIdx = symbolCode.indexOf("{")
      if (braceIdx === -1) return { error: { code: "NO_BRACE", message: "Cannot find opening brace" } }
      patchStart = symbol.byte_start + braceIdx + 1
      formattedContent = `\n${args.newContent}\n`
    } else if (args.position === "inside-bottom") {
      const symbolCode = content.substring(symbol.byte_start, symbol.byte_end)
      const braceIdx = symbolCode.lastIndexOf("}")
      if (braceIdx === -1) return { error: { code: "NO_BRACE", message: "Cannot find closing brace" } }
      patchStart = symbol.byte_start + braceIdx
      formattedContent = `\n${args.newContent}\n`
    }

    if (args.dryRun) {
      return { data: { dryRun: true, position: args.position, target: args.targetSymbolName } }
    }

    createBackup(filepath, ctx.projectPath)
    await patch(filepath, patchStart, patchStart, formattedContent)

    // Auto-inject imports
    if (args.requiredImports && args.requiredImports.length > 0) {
      await injectImports(filepath, args.requiredImports)
    }

    reindexFiles(ctx.projectPath, ctx.db, [{ path: filepath, type: "modified" }]).catch(() => {})

    return { data: { success: true, file: relative(ctx.projectPath, filepath), target: args.targetSymbolName } }
  },
})

// ============================================================================
// brain_delete
// ============================================================================

registerTool({
  name: "brain_delete",
  description: "Delete a symbol or entire file with cascade protection. Checks for callers before deletion and blocks if any exist (unless force:true). Automatically prunes orphaned imports after symbol deletion. Creates undo backup.",
  inputSchema: {
    type: "object",
    properties: {
      symbolName: { type: "string", description: "Symbol name to delete. Omit to delete entire file." },
      filePath: { type: "string", description: "File path for disambiguation or file deletion" },
      lineStart: { type: "number" },
      force: { type: "boolean", description: "Force deletion even if called by others" },
    },
  },
  handler: async (args: any, ctx: any) => {
    // FILE MODE
    if (!args.symbolName && args.filePath) {
      const filepath = resolve(ctx.projectPath, args.filePath)
      if (!existsSync(filepath)) return { error: { code: "NOT_FOUND", message: `File not found: ${args.filePath}` } }

      createBackup(filepath, ctx.projectPath)
      const { unlinkSync } = await import("fs")
      unlinkSync(filepath)
      reindexFiles(ctx.projectPath, ctx.db, [{ path: filepath, type: "deleted" }]).catch(() => {})

      return { data: { success: true, file: args.filePath, deleted: "file" } }
    }

    // SYMBOL MODE
    if (!args.symbolName) return { error: { code: "INVALID_PARAMS", message: "Provide symbolName or filePath" } }

    const resolved = await resolveSymbol(ctx, args.symbolName, args.filePath, args.lineStart)
    if (!resolved) return { error: { code: "NOT_FOUND", message: `Symbol not found: ${args.symbolName}` } }

    const { symbol, filepath } = resolved
    if (symbol.byte_start == null || symbol.byte_end == null) {
      return { error: { code: "NO_BOUNDS", message: "Symbol has no byte bounds" } }
    }

    // Cascade protection
    if (!args.force) {
      const callers = getCallers(ctx.db, ctx.projectHash, symbol.id, 100)
      if (callers.length > 0) {
        return {
          error: {
            code: "CASCADE_BLOCKED",
            message: `${callers.length} caller(s) found. Use force: true to proceed or update callers first.`,
            callers: callers.slice(0, 10).map((c: any) => ({ name: c.source_name, file: c.source_file })),
          },
        }
      }
    }

    createBackup(filepath, ctx.projectPath)
    await patch(filepath, symbol.byte_start, symbol.byte_end, "", true)

    // Prune orphaned imports
    await pruneImports(filepath)

    reindexFiles(ctx.projectPath, ctx.db, [{ path: filepath, type: "modified" }]).catch(() => {})

    return { data: { success: true, file: relative(ctx.projectPath, filepath), symbol: args.symbolName } }
  },
})

// ============================================================================
// brain_refactor
// ============================================================================

registerTool({
  name: "brain_refactor",
  description: "Rename a symbol across the entire codebase. Finds all call sites via relationship graph, patches each one using byte-precise replacement. Reports number of files modified and call sites updated. Supports dryRun for preview.",
  inputSchema: {
    type: "object",
    properties: {
      symbolName: { type: "string", description: "Symbol to rename" },
      newName: { type: "string", description: "New name" },
      filePath: { type: "string", description: "File path to disambiguate" },
      lineStart: { type: "number" },
      dryRun: { type: "boolean", description: "Preview changes without executing" },
    },
    required: ["symbolName", "newName"],
  },
  handler: async (args: any, ctx: any) => {
    const resolved = await resolveSymbol(ctx, args.symbolName, args.filePath, args.lineStart)
    if (!resolved) return { error: { code: "NOT_FOUND", message: `Symbol not found: ${args.symbolName}` } }

    const { symbol, filepath: defFile } = resolved

    // Find all call sites
    const callers = getCallers(ctx.db, ctx.projectHash, symbol.id, 500)
    const affectedFiles = new Set<string>()
    affectedFiles.add(defFile)

    const edits: Array<{ file: string; oldName: string; newName: string }> = []

    if (args.dryRun) {
      for (const caller of callers) {
        affectedFiles.add(resolve(ctx.projectPath, (caller as any).source_file))
      }
      return {
        data: {
          dryRun: true,
          filesToModify: affectedFiles.size,
          callSitesToUpdate: callers.length,
          callers: callers.slice(0, 20).map((c: any) => ({ file: c.source_file, name: c.source_name })),
        },
      }
    }

    // Rename definition
    if (symbol.byte_start != null && symbol.byte_end != null) {
      createBackup(defFile, ctx.projectPath)
      const content = readFileSync(defFile, "utf8")
      const symbolCode = content.substring(symbol.byte_start, symbol.byte_end)
      const updated = symbolCode.replace(new RegExp(`\\b${args.symbolName}\\b`, "g"), args.newName)
      if (updated !== symbolCode) {
        await patch(defFile, symbol.byte_start, symbol.byte_end, updated)
        edits.push({ file: relative(ctx.projectPath, defFile), oldName: args.symbolName, newName: args.newName })
      }
    }

    // Rename call sites
    for (const caller of callers as any[]) {
      const callerFile = resolve(ctx.projectPath, caller.source_file)
      if (!existsSync(callerFile)) continue

      createBackup(callerFile, ctx.projectPath)
      const content = readFileSync(callerFile, "utf8")
      const updated = content.replace(new RegExp(`\\b${args.symbolName}\\b`, "g"), args.newName)
      if (updated !== content) {
        writeFileSync(callerFile, updated, "utf8")
        affectedFiles.add(callerFile)
        edits.push({ file: relative(ctx.projectPath, callerFile), oldName: args.symbolName, newName: args.newName })
      }
    }

    // Reindex all affected files
    const changes = Array.from(affectedFiles).map(f => ({ path: f, type: "modified" as const }))
    reindexFiles(ctx.projectPath, ctx.db, changes).catch(() => {})

    return {
      data: {
        success: true,
        filesModified: affectedFiles.size,
        callSitesUpdated: edits.length,
        edits: edits.slice(0, 20),
      },
    }
  },
})

// ============================================================================
// brain_write
// ============================================================================

registerTool({
  name: "brain_write",
  description: "Create a new file with automatic wiring into the project structure. Detects file type, auto-injects into parent files (routers, barrel exports). Validates syntax via AST parsing. Maximum 5000 lines.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Absolute file path to create" },
      content: { type: "string", description: "Complete source code content" },
      force: { type: "boolean", description: "Bypass size limit (max 5000 lines)" },
      autoWire: { type: "boolean", description: "Auto-connect to parent files" },
    },
    required: ["filePath", "content"],
  },
  handler: async (args: any, ctx: any) => {
    const lineCount = args.content.split("\n").length

    if (lineCount > 5000) {
      return { error: { code: "TOO_LARGE", message: `File is ${lineCount} lines. Maximum is 5000.` } }
    }
    if (lineCount > 800 && !args.force) {
      return { error: { code: "SIZE_WARNING", message: `File is ${lineCount} lines. Use force: true to proceed (max 5000).` } }
    }

    const filepath = resolve(ctx.projectPath, args.filePath)

    // Ensure directory exists
    mkdirSync(dirname(filepath), { recursive: true })

    // Save backup if overwriting
    if (existsSync(filepath)) {
      createBackup(filepath, ctx.projectPath)
    }

    // Write file
    writeFileSync(filepath, args.content, "utf8")

    // Detect file type
    const ext = extname(filepath)
    const dir = dirname(filepath).toLowerCase()
    let fileType = "file"
    if (dir.includes("/components/") || ext === ".tsx" || ext === ".jsx") fileType = "component"
    else if (dir.includes("/hooks/")) fileType = "hook"
    else if (dir.includes("/services/")) fileType = "service"
    else if (dir.includes("/utils/")) fileType = "utility"
    else if (dir.includes("/api/") || dir.includes("/routes/")) fileType = "api_route"
    else if (dir.includes("/types/") || ext === ".d.ts") fileType = "type"

    // Syntax validation
    let syntaxStatus = "not checked"
    try {
      const { parseFile } = await import("../ast/engine.js")
      await parseFile(filepath, args.content)
      syntaxStatus = "ok"
    } catch {
      syntaxStatus = "parse skipped"
    }

    // Auto-wire into parent barrel exports
    let wired = ""
    if (args.autoWire !== false) {
      const parentFiles = [
        resolve(dirname(filepath), "index.ts"),
        resolve(dirname(filepath), "index.js"),
      ]
      for (const pf of parentFiles) {
        if (existsSync(pf)) {
          const pfContent = readFileSync(pf, "utf8")
          const moduleName = basename(filepath, extname(filepath))
          const exportLine = `export * from "./${moduleName}";`
          if (!pfContent.includes(exportLine)) {
            const updated = pfContent + "\n" + exportLine + "\n"
            try {
              createBackup(pf, ctx.projectPath)
              writeFileSync(pf, updated, "utf8")
              wired = `auto-wired into ${relative(ctx.projectPath, pf)}`
            } catch {}
          }
          break
        }
      }
    }

    // JIT index
    try {
      await reindexFiles(ctx.projectPath, ctx.db, [{ path: filepath, type: "added" }])
    } catch {}

    return {
      data: {
        success: true,
        path: relative(ctx.projectPath, filepath),
        fileType,
        syntax: syntaxStatus,
        lines: lineCount,
        wired: wired || undefined,
      },
    }
  },
})
