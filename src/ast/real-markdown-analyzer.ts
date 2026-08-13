import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * Dedicated Markdown analyzer (tree-sitter-markdown grammar).
 *
 * Universal mapping:
 *   - atx_heading (h1..h6)    -> type (document section), nested ownership
 *     by heading level
 *   - link / image destination -> uses relationship (cross-file reference)
 *   - fenced_code_block / paragraph / list -> skipped (noise for symbols)
 */
export class RealMarkdownAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // Track heading level stack for nested ownership (h1 owns h2 owns h3...)
    const headingStack: { name: string; level: number }[] = []

    const walkStack: Node[] = [rootNode]
    while (walkStack.length > 0) {
      const node = walkStack.pop()!
      const type = node.type

      if (type === "atx_heading" || type === "setext_heading") {
        const level = this.headingLevel(node)
        const name = this.headingText(node)
        if (!name) continue

        // Pop stack entries that are deeper or equal level (new sibling/ancestor section)
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
          headingStack.pop()
        }
        const owner = headingStack.length > 0 ? headingStack[headingStack.length - 1].name : undefined
        const ownerKind = headingStack.length > 0 ? ASTEngine.SymbolKind.Type : undefined

        symbols.push({
          name,
          kind: ASTEngine.SymbolKind.Type,
          range: this.nodeToRange(node),
          visibility: "public",
          ownerName: owner,
          ownerKind: ownerKind as any,
          metadata: { nodeType: type, headingLevel: level, isMarkdownHeading: true },
        })
        headingStack.push({ name, level })
        continue
      }

      if (type === "link" || type === "image") {
        const destNode = this.findChild(node, (n) => n.type === "link_destination" || n.type === "destination")
        if (destNode && headingStack.length > 0) {
          relationships.push({
            source: headingStack[headingStack.length - 1].name,
            target: destNode.text,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            metadata: { role: "markdown_link", linkText: destNode.text },
          })
        }
        continue
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) walkStack.push(child)
      }
    }

    return {
      language: "markdown",
      symbols,
      relationships,
      imports,
      exports: [],
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: ["Markdown documentation"],
        framework: "Markdown",
      },
    }
  }

  private headingLevel(node: Node): number {
    const marker = this.findChild(node, (n) => n.type === "atx_h1_marker" || n.type === "atx_h2_marker" || n.type === "atx_h3_marker" || n.type === "atx_h4_marker" || n.type === "atx_h5_marker" || n.type === "atx_h6_marker" || n.type === "setext_h1_marker" || n.type === "setext_h2_marker")
    if (marker) {
      if (marker.type.includes("h1")) return 1
      if (marker.type.includes("h2")) return 2
      if (marker.type.includes("h3")) return 3
      if (marker.type.includes("h4")) return 4
      if (marker.type.includes("h5")) return 5
      if (marker.type.includes("h6")) return 6
    }
    // Fallback: count leading # characters
    const m = node.text.match(/^#{1,6}/)
    return m ? m[0].length : 1
  }

  private headingText(node: Node): string {
    const inline = this.findChild(node, (n) => n.type === "inline")
    if (inline) {
      const text = inline.text.replace(/[*_`]/g, "").trim()
      if (text) return text
    }
    // Fallback: strip the # markers
    const cleaned = node.text.replace(/^#{1,6}\s*/, "").replace(/\s*#+\s*$/, "").trim()
    return cleaned
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
