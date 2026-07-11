// Import Tools — Unified import injector + pruner
// AST-aware for TS/JS, regex fallback for 40+ languages
// Ported from backbencher's import-injector.ts + import-pruner.ts

import { readFileSync, writeFileSync } from "fs"
import { parseFile } from "../ast/engine.js"
import { createLogger } from "../util/log.js"

const log = createLogger("brain_import")

// ============================================================================
// IMPORT INJECTOR
// ============================================================================

export async function injectImports(
  filePath: string,
  requiredImports: { module: string; items: string[] }[],
): Promise<boolean> {
  if (!requiredImports || requiredImports.length === 0) return false

  const content = readFileSync(filePath, "utf8")

  try {
    // Try AST-based injection for TS/JS
    const result = await parseFile(filePath, content)
    const lang = result.language

    if (["typescript", "tsx", "javascript", "jsx"].includes(lang || "")) {
      const modified = injectTypescriptImports(content, result, requiredImports)
      if (modified !== content) {
        writeFileSync(filePath, modified, "utf8")
        return true
      }
      return false
    }

    // Regex fallback for other languages
    const modified = injectRegexFallback(content, lang || "unknown", requiredImports)
    if (modified !== content) {
      writeFileSync(filePath, modified, "utf8")
      return true
    }
  } catch (err) {
    log.debug("import injection failed", { file: filePath, error: String(err) })
  }

  return false
}

function injectTypescriptImports(
  content: string,
  parseResult: any,
  requiredImports: { module: string; items: string[] }[],
): string {
  const tree = parseResult._tree || parseResult
  const rootNode = tree?.rootNode
  if (!rootNode) return content

  // Find all import statements
  const importNodes: any[] = []
  function findImports(node: any) {
    if (node.type === "import_statement" || node.type === "lexical_declaration") {
      const text = content.substring(node.startIndex, node.endIndex)
      if (text.startsWith("import ")) importNodes.push(node)
    }
    if (node.children) {
      for (const child of node.children) findImports(child)
    }
  }
  findImports(rootNode)

  // Parse existing imports
  const existingModules = new Map<string, Set<string>>()
  for (const node of importNodes) {
    const sourceStr = content.substring(node.startIndex, node.endIndex)
    const match = sourceStr.match(/from\s+['"]([^'"]+)['"]/)
    if (match) {
      const source = match[1]!
      if (!existingModules.has(source)) existingModules.set(source, new Set())
      const itemsMatch = sourceStr.match(/\{([^}]+)\}/)
      if (itemsMatch) {
        const items = itemsMatch[1]!.split(",").map(i => i.trim())
        for (const item of items) existingModules.get(source)!.add(item)
      }
      // Also check default import
      const defaultMatch = sourceStr.match(/^import\s+(\w+)/)
      if (defaultMatch && defaultMatch[1] && !sourceStr.includes("{")) {
        existingModules.get(source)!.add(defaultMatch[1])
      }
    }
  }

  // Build additions
  const additions: string[] = []
  for (const req of requiredImports) {
    const existing = existingModules.get(req.module)
    if (existing) {
      const missingItems = req.items.filter(item => !existing.has(item))
      if (missingItems.length > 0) {
        additions.push(`import { ${missingItems.join(", ")} } from '${req.module}';`)
      }
    } else {
      additions.push(`import { ${req.items.join(", ")} } from '${req.module}';`)
    }
  }

  if (additions.length === 0) return content

  // Insert after last import
  let insertIndex = 0
  if (importNodes.length > 0) {
    const lastImport = importNodes[importNodes.length - 1]!
    insertIndex = lastImport.endIndex
  }

  const prefix = insertIndex === 0 ? "" : "\n"
  return content.slice(0, insertIndex) + prefix + additions.join("\n") + "\n" + content.slice(insertIndex)
}

function injectRegexFallback(
  content: string,
  language: string,
  requiredImports: { module: string; items: string[] }[],
): string {
  const patterns: Record<string, { regex: RegExp; template: (mod: string, items: string[]) => string }> = {
    python: {
      regex: /^(?:from\s+\S+\s+)?import\s+/m,
      template: (mod, items) => `from ${mod} import ${items.join(", ")}`,
    },
    java: {
      regex: /^import\s+/m,
      template: (mod, items) => `import ${mod}.${items.join(".")};`,
    },
    go: {
      regex: /^import\s+\(/m,
      template: (mod, _items) => `\t"${mod}"`,
    },
    rust: {
      regex: /^use\s+/m,
      template: (mod, items) => `use ${mod}::${items.join("::")};`,
    },
  }

  const pattern = patterns[language]
  if (!pattern) return content

  const matches = [...content.matchAll(new RegExp(pattern.regex.source, "gm"))]
  const insertIndex = matches.length > 0
    ? (matches[matches.length - 1]!.index || 0) + matches[matches.length - 1]![0].length
    : 0

  const additions: string[] = []
  for (const req of requiredImports) {
    additions.push(pattern.template(req.module, req.items))
  }

  return content.slice(0, insertIndex) + "\n" + additions.join("\n") + "\n" + content.slice(insertIndex)
}

// ============================================================================
// IMPORT PRUNER
// ============================================================================

export async function pruneImports(filePath: string): Promise<boolean> {
  const content = readFileSync(filePath, "utf8")

  try {
    const result = await parseFile(filePath, content)
    const lang = result.language || "unknown"

    let modified: string

    if (["typescript", "tsx", "javascript", "jsx"].includes(lang)) {
      modified = pruneTypescriptImports(content)
    } else {
      modified = pruneStructuralImports(content, lang)
    }

    if (modified !== content) {
      writeFileSync(filePath, modified, "utf8")
      return true
    }
  } catch (err) {
    log.debug("import pruning failed", { file: filePath, error: String(err) })
  }

  return false
}

function pruneTypescriptImports(content: string): string {
  const lines = content.split("\n")
  const importLines: { index: number; line: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (line.startsWith("import ") && line.includes("from ")) {
      importLines.push({ index: i, line })
    }
  }

  const bodyContent = lines.map((l, i) =>
    importLines.some(il => il.index === i) ? "" : l
  ).join("\n")

  const removed: number[] = []
  for (const il of importLines) {
    // Extract imported names
    const namedMatch = il.line.match(/import\s+\{([^}]+)\}/)
    const defaultMatch = il.line.match(/import\s+(\w+)\s+from/)
    const starMatch = il.line.match(/import\s+\*\s+as\s+(\w+)/)

    const names: string[] = []
    if (namedMatch) names.push(...namedMatch[1]!.split(",").map(n => n.trim().split(" as ")[0]!.trim()))
    if (defaultMatch) names.push(defaultMatch[1]!)
    if (starMatch) names.push(starMatch[1]!)

    // Check if any name is used in the body
    const allUsed = names.every(name => {
      const regex = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
      return regex.test(bodyContent)
    })

    if (!allUsed) {
      removed.push(il.index)
    }
  }

  if (removed.length === 0) return content

  return lines
    .filter((_, i) => !removed.includes(i))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
}

function pruneStructuralImports(content: string, language: string): string {
  // Language-specific import patterns
  const patterns: Record<string, RegExp> = {
    python: /^(?:from\s+(\S+)\s+)?import\s+(.+?)(?:\s+#.*)?$/gm,
    java: /^import\s+(?:static\s+)?(.+?);/gm,
    kotlin: /^import\s+(.+?)$/gm,
    scala: /^import\s+(.+?)$/gm,
    go: /^\s*"([^"]+)"/gm,
    rust: /^use\s+(.+?);/gm,
    ruby: /^require(?:_relative)?\s+['"](.+?)['"]/gm,
    php: /^(?:use\s+(.+?);|require(?:_once)?\s+['"](.+?)['"])/gm,
    csharp: /^using\s+(?:static\s+)?(.+?);/gm,
    dart: /^import\s+['"](.+?)['"]\s*(?:as\s+\w+)?\s*;/gm,
    swift: /^import\s+(.+?)$/gm,
    c: /^#include\s+[<"](.+?)[>"]/gm,
    cpp: /^#include\s+[<"](.+?)[>"]/gm,
  }

  const pattern = patterns[language]
  if (!pattern) return content

  let result = content
  const matches = [...content.matchAll(pattern)]

  // Process in reverse to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!
    const fullMatch = m[0]
    const imported = (m[1] || m[2] || "").split("/").pop()?.split(".")[0]?.replace(/['"]/g, "")

    if (!imported) continue

    const bodyContent = result.substring(0, m.index) + result.substring(m.index! + fullMatch.length)
    const usageRegex = new RegExp(`\\b${imported.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)

    if (!usageRegex.test(bodyContent)) {
      result = result.substring(0, m.index) + result.substring(m.index! + fullMatch.length)
    }
  }

  return result.replace(/\n{3,}/g, "\n\n")
}
