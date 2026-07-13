// @ts-nocheck
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
import { UniversalSymbol, ParseResult } from "./types.js"

export class ImportInjector {
  /**
   * Surgically injects required imports into the AST of a file without breaking formatting.
   * Now utilizes true AST parsing for surgical precision instead of naive regex.
   */
  static async inject(
    fileContent: string,
    filePath: string,
    requiredImports: { module: string; items: string[] }[],
  ): Promise<string> {
    if (!requiredImports || requiredImports.length === 0) return fileContent

    const lang = (await import("./engine.js")).detectLanguage(filePath)
    if (!lang) return fileContent

    try {
      if (["typescript", "javascript", "tsx", "jsx"].includes(lang)) {
        // Safe await parsing for AST precision
        const { tree: ast } = await (await import("./engine.js")).parseFile(filePath, fileContent)
        return this.injectTypeScriptImports(fileContent, ast, requiredImports)
      }
      return this.injectRegexFallback(fileContent, lang, requiredImports)
    } catch (e) {
      // Fall back silently - regex fallback will handle it
      return this.injectRegexFallback(fileContent, lang, requiredImports)
    }
  }

  private static injectTypeScriptImports(
    fileContent: string,
    ast: any,
    requiredImports: { module: string; items: string[] }[],
  ): string {
    const rootNode = ast.rootNode
    const importNodes = rootNode.children.filter((n: any) => n.type === "import_statement")

    const existingModules = new Map<string, Set<string>>()

    for (const node of importNodes) {
      const sourceStr = fileContent.substring(node.startIndex, node.endIndex)
      const match = sourceStr.match(/from\s+['"]([^'"]+)['"]/)
      if (match) {
        const source = match[1]
        if (!existingModules.has(source)) existingModules.set(source, new Set())

        const itemsMatch = sourceStr.match(/\{([^}]+)\}/)
        if (itemsMatch) {
          const items = itemsMatch[1].split(",").map((i) => i.trim())
          items.forEach((i) => existingModules.get(source)!.add(i))
        }
      }
    }

    const additions: string[] = []
    for (const req of requiredImports) {
      const existing = existingModules.get(req.module)
      if (existing) {
        const missingItems = req.items.filter((item) => !existing.has(item))
        if (missingItems.length > 0) {
          additions.push(`import { ${missingItems.join(", ")} } from '${req.module}';`)
        }
      } else {
        additions.push(`import { ${req.items.join(", ")} } from '${req.module}';`)
      }
    }

    if (additions.length === 0) return fileContent

    let insertIndex = 0
    if (importNodes.length > 0) {
      const lastImport = importNodes[importNodes.length - 1]
      insertIndex = lastImport.endIndex
    }

    const before = fileContent.slice(0, insertIndex)
    const after = fileContent.slice(insertIndex)

    const prefix = insertIndex === 0 ? "" : "\n"
    const suffix = after.startsWith("\n") ? "" : "\n"

    return before + prefix + additions.join("\n") + suffix + after
  }

  private static injectRegexFallback(
    fileContent: string,
    lang: string,
    requiredImports: { module: string; items: string[] }[],
  ): string {
    // Language-specific import injection patterns
    const formatters: Record<string, (req: { module: string; items: string[] }) => string> = {
      typescript: (req) => `import { ${req.items.join(", ")} } from '${req.module}';`,
      tsx: (req) => `import { ${req.items.join(", ")} } from '${req.module}';`,
      javascript: (req) => `import { ${req.items.join(", ")} } from '${req.module}';`,
      python: (req) => req.items.length > 0 ? `from ${req.module} import ${req.items.join(", ")}` : `import ${req.module}`,
      go: (req) => `import "${req.module}"`,
      rust: (req) => `use ${req.module};`,
      java: (req) => `import ${req.module};`,
      kotlin: (req) => `import ${req.module}`,
      scala: (req) => `import ${req.module}`,
      dart: (req) => `import '${req.module}';`,
      c: (req) => `#include "${req.module}"`,
      cpp: (req) => `#include "${req.module}"`,
      ruby: (req) => `require '${req.module}'`,
      php: (req) => `use ${req.module};`,
      csharp: (req) => `using ${req.module};`,
      swift: (req) => `import ${req.module}`,
      lua: (req) => `require("${req.module}")`,
      elixir: (req) => `import ${req.module}`,
      erlang: (req) => `-include("${req.module}").`,
      haskell: (req) => `import ${req.module}`,
      clojure: (req) => `(:require [${req.module}])`,
      groovy: (req) => `import ${req.module}`,
      r: (req) => `library(${req.module})`,
      perl: (req) => `use ${req.module};`,
      bash: (req) => `source ${req.module}`,
      powershell: (req) => `Import-Module ${req.module}`,
      'objective-c': (req) => `#import "${req.module}"`,
      zig: (req) => `const _ = @import("${req.module}");`,
      fsharp: (req) => `open ${req.module}`,
      sql: (req) => `-- @import ${req.module}`,
      yaml: (req) => `# @import ${req.module}`,
      html: (req) => `<!-- @import ${req.module} -->`,
      css: (req) => `@import '${req.module}';`,
      vue: (req) => `import { ${req.items.join(", ")} } from '${req.module}';`,
      svelte: (req) => `import { ${req.items.join(", ")} } from '${req.module}';`,
      graphql: (req) => `# import '${req.module}'`,
      hcl: (req) => `# @import "${req.module}"`,
      clean: (req) => `import ${req.module}`,
      json: (req) => `// @import "${req.module}"`,
    }

    const importMarkers: Record<string, RegExp> = {
      typescript: /^import\s+/,
      tsx: /^import\s+/,
      javascript: /^import\s+/,
      python: /^(?:from\s+\S+\s+)?import\s+/,
      go: /^import\s+/,
      rust: /^use\s+/,
      java: /^import\s+/,
      kotlin: /^import\s+/,
      scala: /^import\s+/,
      dart: /^import\s+/,
      c: /^#include\s+/,
      cpp: /^#include\s+/,
      ruby: /^require(?:_relative)?\s+/,
      php: /^use\s+/,
      csharp: /^using\s+/,
      swift: /^import\s+/,
      lua: /^(?:local\s+)?require\s*\(/,
      elixir: /^(?:import|alias|use|require)\s+/,
      erlang: /^-include/,
      haskell: /^import\s+(?:qualified\s+)?/,
      clojure: /\((?::require|ns)/,
      groovy: /^import\s+/,
      r: /^(?:library|require)\s*\(/,
      perl: /^use\s+/,
      bash: /^(?:source|\.)\s+/,
      powershell: /^(?:\.\s+|Import-Module\s+)/,
      'objective-c': /^#(?:import|include)\s+/,
      zig: /^const\s+.*@import/,
      fsharp: /^open\s+/,
      sql: /^--\s*@import/,
      yaml: /^#\s*@import/,
      html: /<!--\s*@import/,
      css: /^@import\s+/,
      vue: /^import\s+/,
      svelte: /^import\s+/,
      graphql: /^#\s*import/,
      hcl: /^#\s*@import/,
      clean: /^import\s+/,
      json: /^\/\/\s*@import/,
    }

    const format = formatters[lang]
    const marker = importMarkers[lang]

    if (!format) {
      // Generic fallback for unknown languages
      let lines = fileContent.split("\n")
      let lastImportIndex = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith("import ") || lines[i].trim().startsWith("require(") || lines[i].trim().startsWith("#include") || lines[i].trim().startsWith("use ") || lines[i].trim().startsWith("using ")) {
          lastImportIndex = i
        }
      }
      const newLines = requiredImports.map((req) => `import { ${req.items.join(", ")} } from '${req.module}';`)
      if (lastImportIndex !== -1) lines.splice(lastImportIndex + 1, 0, ...newLines)
      else lines = [...newLines, "", ...lines]
      return lines.join("\n")
    }

    let lines = fileContent.split("\n")
    let lastImportIndex = -1

    for (let i = 0; i < lines.length; i++) {
      if (marker.test(lines[i].trim())) {
        lastImportIndex = i
      }
    }

    const newImportLines: string[] = []
    for (const req of requiredImports) {
      const moduleRegex = new RegExp(req.module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      const isImported = lines.some((line) => moduleRegex.test(line) && marker.test(line))
      if (!isImported) {
        newImportLines.push(format(req))
      }
    }

    if (newImportLines.length === 0) return fileContent

    if (lastImportIndex !== -1) {
      lines.splice(lastImportIndex + 1, 0, ...newImportLines)
    } else {
      // Insert after shebang or file header, or at top
      let insertAt = 0
      for (let i = 0; i < lines.length; i++) {
        if (i === 0 && lines[i].startsWith("#!")) { insertAt = i + 1; continue }
        if (lines[i].trim() === "" || lines[i].trim().startsWith("//") || lines[i].trim().startsWith("/*") || lines[i].trim().startsWith("*")) { insertAt = i + 1; continue }
        break
      }
      lines.splice(insertAt, 0, ...newImportLines)
    }

    return lines.join("\n")
  }
}
