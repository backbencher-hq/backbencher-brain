// Generic analyzer — fallback for unknown languages
// Basic symbol extraction via iterative DFS tree traversal

import type { LanguageAnalyzer, UniversalSymbol, ParseResult } from "../types.js"
import { SymbolKind } from "../types.js"

export class GenericAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: any, content: string, filePath: string): Omit<ParseResult, "language" | "metadata"> {
    const symbols: UniversalSymbol[] = []

    // Iterative DFS — no recursion to prevent stack overflow
    const stack: any[] = [rootNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node.isNamed) {
        const isSmall = node.endIndex - node.startIndex < 100
        if (isSmall && node.text) {
          symbols.push({
            name: node.text,
            kind: this.mapNodeType(node.type),
            range: {
              startLine: node.startPosition.row + 1,
              startColumn: node.startPosition.column + 1,
              endLine: node.endPosition.row + 1,
              endColumn: node.endPosition.column + 1,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            metadata: { nodeType: node.type, raw: true },
          })
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push(child)
      }
    }

    return {
      symbols,
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      metadata: {
        complexity: Math.min(symbols.length, 100),
        linesOfCode: content.split("\n").length,
      },
    }
  }

  private mapNodeType(nodeType: string): SymbolKind {
    if (nodeType.includes("function")) return SymbolKind.Function
    if (nodeType.includes("class")) return SymbolKind.Class
    if (nodeType.includes("variable")) return SymbolKind.Variable
    if (nodeType.includes("import")) return SymbolKind.Import
    if (nodeType.includes("export")) return SymbolKind.Export
    return SymbolKind.Variable
  }
}
