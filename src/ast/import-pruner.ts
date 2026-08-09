import { ASTEngine } from "./engine"

export class ImportPruner {
  /**
   * Surgically analyzes an AST to detect and remove orphaned imports.
   * Used by bb_edit delete mode to perform garbage collection on dependencies.
   */
  static async prune(fileContent: string, filePath: string): Promise<string> {
    const lang = ASTEngine.detectLanguage(filePath)
    if (!lang) return fileContent

    try {
      if (["typescript", "javascript", "tsx", "jsx"].includes(lang)) {
        const { tree: ast } = await ASTEngine.parseFile(filePath, fileContent)
        return this.pruneTypeScriptImports(fileContent, ast)
      }
      return this.pruneImportsStructural(fileContent, lang)
    } catch (e) {
      // Fall back silently - return unchanged content
      return fileContent
    }
  }

  private static pruneImportsStructural(fileContent: string, lang: string): string {
    // Language-specific import patterns for non-TS/JS languages
    const patterns: Record<string, { regex: RegExp; extractName: (m: RegExpMatchArray) => string; stripComments: boolean }> = {
      elixir: { regex: /^\s*(?:import|alias|use|require)\s+(.+?)(?:\s*,\s*|\s*$)/gm, extractName: (m) => m[1].split(".").pop()?.split("{").pop()?.trim() || "", stripComments: false },
      erlang: { regex: /^-include(?:_lib)?\s*\(\s*"([^"]+)"\s*\)/gm, extractName: (m) => m[1], stripComments: false },
      haskell: { regex: /^import\s+(?:qualified\s+)?([^(\s]+)/gm, extractName: (m) => m[1].split(".").pop() || "", stripComments: false },
      hcl: { regex: /^\s*(?:module|provider)\s+"([^"]+)"/gm, extractName: (m) => m[1], stripComments: false },
      clojure: { regex: /\((?::require|ns|:use|:import)\s+[^)]+\)/g, extractName: (m) => m[0], stripComments: false },
      groovy: { regex: /^import\s+(?:static\s+)?(.+?)(?:\s+as\s+\w+)?$/gm, extractName: (m) => m[1].split(".").pop() || "", stripComments: false },
      r: { regex: /^(?:library|require)\s*\(\s*(.+?)\s*\)/gm, extractName: (m) => m[1].replace(/["']/g, ""), stripComments: false },
      sql: { regex: /^\s*(?:#import|@import|--\s*import)\s+(.+?)$/gm, extractName: (m) => m[1], stripComments: false },
      bash: { regex: /^(?:source|\.)\s+(.+?)(?:\s+|$)/gm, extractName: (m) => m[1].split("/").pop()?.replace(/["']/g, "") || "", stripComments: false },
      powershell: { regex: /^(?:\.\s+|Import-Module\s+)(.+?)(?:\s*;|\s*$)/gm, extractName: (m) => m[1].replace(/["']/g, ""), stripComments: false },
      perl: { regex: /^use\s+(.+?)(?:\s+|;|$)/gm, extractName: (m) => m[1].split("::").pop() || "", stripComments: false },
      swift: { regex: /^import\s+(.+?)$/gm, extractName: (m) => m[1], stripComments: false },
      zig: { regex: /^(?:const|pub\s+)?usingnamespace\s+@import\("([^"]+)"\)/gm, extractName: (m) => m[1].split("/").pop()?.replace(".zig","") || "", stripComments: false },
      fsharp: { regex: /^open\s+(.+?)$/gm, extractName: (m) => m[1].split(".").pop() || "", stripComments: false },
      "objective-c": { regex: /^#(?:import|include)\s+[<"](.+?)[>"]/gm, extractName: (m) => m[1].split("/").pop()?.replace(".h","") || "", stripComments: false },
      graphql: { regex: /^#\s*import\s+(.+?)$/gm, extractName: (m) => m[1], stripComments: false },
      vue: { regex: /import\s+.+?\s+from\s+['"](.+?)['"]/gm, extractName: (m) => m[1].split("/").pop() || "", stripComments: false },
      svelte: { regex: /import\s+.+?\s+from\s+['"](.+?)['"]/gm, extractName: (m) => m[1].split("/").pop() || "", stripComments: false },
      clean: { regex: /^import\s+(.+?)(?:\s*;|\s*$)/gm, extractName: (m) => m[1].split(".").pop() || "", stripComments: false },
      html: { regex: /<(?:script|link|img)\s+[^>]*(?:src|href)=["']([^"']+)["']/gm, extractName: (m) => m[1].split("/").pop() || "", stripComments: false },
      css: { regex: /@import\s+(?:url\()?["']?([^"')]+)["']?\)?/gm, extractName: (m) => m[1], stripComments: false },
      json: { regex: /^\s*[/][/]s*@imports+(.+?)$/gm, extractName: (m) => m[1], stripComments: false },
      yaml: { regex: /^\s*#\s*@import\s+(.+?)$/gm, extractName: (m) => m[1], stripComments: false },
      python: { regex: /^(?:from\s+(\S+)\s+)?import\s+(.+?)(?:\s+#.*)?$/gm, extractName: (m) => m[2]?.split(",")[0]?.trim().split(" as ")[0]?.trim() || "", stripComments: true },
      go: { regex: /^import\s+(?:\w+\s+)?"([^"]+)"/gm, extractName: (m) => m[1], stripComments: false },
      rust: { regex: /^use\s+(.+?);/gm, extractName: (m) => m[1].split("::").pop() || "", stripComments: false },
      java: { regex: /^import\s+(?:static\s+)?(.+?);/gm, extractName: (m) => m[1].split(".").pop() || "", stripComments: false },
      kotlin: { regex: /^import\s+(.+?)$/gm, extractName: (m) => m[1].split(".").pop() || "", stripComments: false },
      scala: { regex: /^import\s+(.+?)$/gm, extractName: (m) => m[1].split(".").pop() || "", stripComments: false },
      dart: { regex: /^import\s+['"](.+?)['"]\s*(?:as\s+\w+)?\s*;/gm, extractName: (m) => m[1].split("/").pop()?.replace(".dart","") || "", stripComments: false },
      c: { regex: /^#include\s+[<"](.+?)[>"]/gm, extractName: (m) => m[1], stripComments: false },
      cpp: { regex: /^#include\s+[<"](.+?)[>"]/gm, extractName: (m) => m[1], stripComments: false },
      ruby: { regex: /^require(?:_relative)?\s+['"](.+?)['"]/gm, extractName: (m) => m[1], stripComments: false },
      php: { regex: /^(?:use\s+(.+?);|require(?:_once)?\s+['"](.+?)['"])/gm, extractName: (m) => m[1]?.split("\\").pop() || m[2] || "", stripComments: false },
      csharp: { regex: /^using\s+(?:static\s+)?(.+?);/gm, extractName: (m) => m[1].split(".").pop() || "", stripComments: false },
      lua: { regex: /^(?:local\s+)?require\s*\(\s*['"](.+?)['"]\s*\)/gm, extractName: (m) => m[1], stripComments: false },
    }

    const pattern = patterns[lang]
    if (!pattern) return fileContent

    let result = fileContent
    const matches = [...result.matchAll(pattern.regex)]
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i]
      const imported = pattern.extractName(m)
      if (!imported) continue
      const bodyContent = result.substring(0, m.index!) + result.substring(m.index! + m[0].length)
      const usageRegex = new RegExp("\\b" + imported.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b")
      if (!usageRegex.test(bodyContent)) {
        result = result.substring(0, m.index!) + result.substring(m.index! + m[0].length)
      }
    }
    return result
  }

  private static pruneTypeScriptImports(fileContent: string, ast: any): string {
    const rootNode = ast.rootNode
    const importNodes = rootNode.children.filter((n: any) => n.type === "import_statement")

    if (importNodes.length === 0) return fileContent

    let resultContent = fileContent

    // Process from bottom to top to avoid shifting byte indices
    for (let i = importNodes.length - 1; i >= 0; i--) {
      const node = importNodes[i]
      const clause = node.children.find((c: any) => c.type === "import_clause")

      if (!clause) continue

      const specifiers: { name: string; start: number; end: number; type: string }[] = []

      // 1. Default Imports
      const defaultImport = clause.children.find((c: any) => c.type === "identifier")
      if (defaultImport) {
        specifiers.push({
          name: defaultImport.text,
          start: defaultImport.startIndex,
          end: defaultImport.endIndex,
          type: "default",
        })
      }

      // 2. Named Imports
      const namedImports = clause.children.find((c: any) => c.type === "named_imports")
      let hasNamedImports = false
      if (namedImports) {
        hasNamedImports = true
        const importSpecifiers = namedImports.children.filter((c: any) => c.type === "import_specifier")
        for (const spec of importSpecifiers) {
          // If aliased (e.g. import { x as y }), the alias is the identifier used
          const alias = spec.children.find((c: any) => c.type === "identifier" && c !== spec.children[0])
          const nameNode = alias || spec.children[0]
          if (nameNode) {
            specifiers.push({
              name: nameNode.text,
              start: spec.startIndex,
              end: spec.endIndex,
              type: "named",
            })
          }
        }
      }

      // 3. Namespace Imports (* as x)
      const namespaceImport = clause.children.find((c: any) => c.type === "namespace_import")
      if (namespaceImport) {
        const idNode = namespaceImport.children.find((c: any) => c.type === "identifier")
        if (idNode) {
          specifiers.push({
            name: idNode.text,
            start: namespaceImport.startIndex,
            end: namespaceImport.endIndex,
            type: "namespace",
          })
        }
      }

      // Check which specifiers are orphaned
      const bodyContent = fileContent.substring(0, node.startIndex) + fileContent.substring(node.endIndex)

      const unusedSpecifiers = specifiers.filter((spec) => {
        // Fast textual check: if the word doesn't appear outside the import statement, it's dead.
        // We use word boundaries to avoid partial matches (e.g., 'z' matching inside 'zod')
        const regex = new RegExp(`\\b${spec.name}\\b`)
        return !regex.test(bodyContent)
      })

      if (unusedSpecifiers.length === 0) continue

      // If ALL specifiers in the import are unused, obliterate the entire import statement
      if (unusedSpecifiers.length === specifiers.length) {
        // Remove entire line including newline
        let start = node.startIndex
        let end = node.endIndex
        // Eat trailing newline if possible
        if (resultContent[end] === "\r") end++
        if (resultContent[end] === "\n") end++

        resultContent = resultContent.substring(0, start) + resultContent.substring(end)
      }
      // If only some are unused, we selectively prune them (only applies to named imports safely)
      else if (hasNamedImports) {
        // We prune them from bottom to top
        const unusedNamed = unusedSpecifiers.filter((s) => s.type === "named").sort((a, b) => b.start - a.start)

        for (const spec of unusedNamed) {
          let start = spec.start
          let end = spec.end

          // Look behind for a comma, or ahead for a comma, and eat it too (Sibling Garbage Collection)
          let contentBefore = resultContent.substring(0, start)
          let contentAfter = resultContent.substring(end)

          // Eat following comma and spaces
          const trailingCommaMatch = contentAfter.match(/^(\s*,\s*)/)
          if (trailingCommaMatch) {
            end += trailingCommaMatch[0].length
          } else {
            // If no trailing comma, maybe a preceding comma?
            const precedingCommaMatch = contentBefore.match(/(\s*,\s*)$/)
            if (precedingCommaMatch) {
              start -= precedingCommaMatch[0].length
            }
          }

          resultContent = resultContent.substring(0, start) + resultContent.substring(end)
        }
      }
    }

    return resultContent
  }
}
