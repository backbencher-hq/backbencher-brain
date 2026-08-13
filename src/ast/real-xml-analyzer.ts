import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * Dedicated XML analyzer (tree-sitter-xml grammar).
 *
 * Universal mapping:
 *   - element            -> class (structural config unit), named by tag name
 *   - element attribute  -> property (key=value), owned by its element
 *   - XML declaration    -> skipped (prolog, CharData, comments are noise)
 *   - DOCTYPE external   -> import (rare, handled defensively)
 */
export class RealXmlAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const walkStack: { node: Node; ownerName?: string; ownerKind?: ASTEngine.SymbolKind }[] = [
      { node: rootNode },
    ]

    while (walkStack.length > 0) {
      const { node, ownerName, ownerKind } = walkStack.pop()!
      const type = node.type

      if (type === "element") {
        const name = this.getElementName(node)
        const elemSymbol: ASTEngine.UniversalSymbol = {
          name,
          kind: ASTEngine.SymbolKind.Class,
          range: this.nodeToRange(node),
          visibility: "public",
          ownerName,
          ownerKind,
          metadata: { nodeType: type, isXmlElement: true, tagName: name },
        }
        symbols.push(elemSymbol)

        // Element attributes -> property symbols (from the start tag)
        const stag = this.findChild(node, (n) => n.type === "STag" || n.type === "start_tag" || n.type === "OpenTag" || n.type === "Element")
        if (stag) {
          for (let i = 0; i < stag.namedChildCount; i++) {
            const attr = stag.namedChild(i)
            if (!attr) continue
            if (attr.type === "Attribute" || attr.type === "attribute" || attr.type === "attribute_name") {
              const attrText = attr.text
              const eqIdx = attrText.indexOf("=")
              const attrName = (eqIdx > 0 ? attrText.slice(0, eqIdx) : attrText).trim()
              if (!attrName || attrName === name) continue
              if (attrName.startsWith("xmlns")) continue // namespace declarations are noise
              symbols.push({
                name: attrName,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(attr),
                visibility: "public",
                ownerName: name,
                ownerKind: ASTEngine.SymbolKind.Class,
                metadata: { nodeType: attr.type, isXmlAttribute: true, attributeName: attrName },
              })
              relationships.push({
                source: name,
                target: attrName,
                type: ASTEngine.RelationshipType.Contains,
                confidence: 1.0,
                metadata: { role: "xml_attribute" },
              })
            }
          }
        }

        // Push children with the element as owner
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) walkStack.push({ node: child, ownerName: name, ownerKind: ASTEngine.SymbolKind.Class })
        }
        continue
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) walkStack.push({ node: child, ownerName, ownerKind })
      }
    }

    return {
      language: "xml",
      symbols,
      relationships,
      imports,
      exports: [],
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "XML",
      },
    }
  }

  private getElementName(node: Node): string {
    // Name lives inside the STag / start tag node
    const stag = this.findChild(node, (n) => n.type === "STag" || n.type === "start_tag" || n.type === "OpenTag")
    if (stag) {
      const nameNode = this.findChild(stag, (n) => n.type === "Name" || n.type === "name" || n.type === "tag_name")
      if (nameNode && nameNode.text.trim()) return nameNode.text.trim()
    }
    const direct = this.findChild(node, (n) => n.type === "Name" || n.type === "name" || n.type === "tag_name")
    if (direct && direct.text.trim()) return direct.text.trim()
    // Fallback: extract from start tag text
    const m = node.text.match(/<([A-Za-z_][\w:.-]*)/)
    if (m) return m[1]
    return "anonymous"
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
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
