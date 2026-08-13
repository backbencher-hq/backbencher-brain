import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * Dedicated Makefile analyzer (tree-sitter-make grammar).
 *
 * Universal mapping:
 *   - variable_assignment (VAR := value)      -> constant
 *   - rule / explicit_rule targets            -> function (the build target)
 *   - include directives                      -> import
 *   - rule prerequisites                      -> uses relationship
 */
export class RealMakefileAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const errors: ASTEngine.ParseError[] = []
    const patterns: string[] = []

    const walkStack: Node[] = [rootNode]

    while (walkStack.length > 0) {
      const node = walkStack.pop()!
      const type = node.type

      if (type === "variable_assignment" || type === "variable_definition") {
        const nameNode = this.findChild(node, (n) => n.type === "word" || n.type === "identifier" || n.type === "variable")
        if (nameNode) {
          const name = nameNode.text.trim()
          const valueNode = this.findChild(node, (n) => n.type === "text" || n.type === "value" || n.type === "word")
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Constant,
            range: this.nodeToRange(node),
            visibility: "global",
            metadata: { nodeType: type, isMakeVariable: true, value: valueNode ? valueNode.text.trim() : undefined },
          })
        }
        patterns.push("Make variables")
        continue
      }

      if (type === "rule" || type === "explicit_rule" || type === "rule_with_recipe" || type === "static_pattern_rule") {
        const targetsNode = this.findChild(node, (n) => n.type === "targets" || n.type === "target")
        if (targetsNode) {
          const targets = this.extractTargets(targetsNode)
          for (const t of targets) {
            if (t === ".PHONY" || t.startsWith(".")) continue
            symbols.push({
              name: t,
              kind: ASTEngine.SymbolKind.Function,
              range: this.nodeToRange(node),
              visibility: "public",
              metadata: { nodeType: type, isMakeTarget: true, targetName: t },
            })
          }
          const prereqsNode = this.findChild(node, (n) => n.type === "prerequisites")
          if (prereqsNode) {
            const prereqs = this.extractTargets(prereqsNode)
            for (const p of prereqs) {
              relationships.push({
                source: targets[0] || "makefile",
                target: p,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 1.0,
                metadata: { role: "target_dependency" },
              })
            }
          }
        }
        patterns.push("Make rules")
        continue
      }

      if (type === "include_statement" || type === "include" || type === "include_directive") {
        const pathNode = this.findChild(node, (n) => n.type === "word" || n.type === "text" || n.type === "string")
        if (pathNode) {
          imports.push({
            module: pathNode.text.trim(),
            items: [],
            importType: "make_include",
            lineNumber: node.startPosition.row + 1,
            isExternal: false,
          })
          relationships.push({
            source: "makefile",
            target: pathNode.text.trim(),
            type: ASTEngine.RelationshipType.Imports,
            confidence: 1.0,
            metadata: { isMakeInclude: true },
          })
        }
      }

      // Descend into children
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) walkStack.push(child)
      }
    }

    return {
      language: "make",
      symbols,
      relationships,
      imports,
      exports: [],
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns,
        framework: "Make",
      },
    }
  }

  private extractTargets(node: Node): string[] {
    const out: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === "word" || child.type === "target") {
        const t = child.text.trim()
        if (t && !out.includes(t)) out.push(t)
      }
    }
    // Fallback: split text for grammars that collapse targets into one node
    if (out.length === 0) {
      for (const t of node.text.trim().split(/\s+/)) {
        if (t && !out.includes(t)) out.push(t)
      }
    }
    return out
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
