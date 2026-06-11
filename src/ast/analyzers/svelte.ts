// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealSvelteAnalyzer implements LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const svelteRelRegexes = [
      { pattern: /on:(\w+)={(\w+)}/g, type: "Calls" },
      { pattern: /bind:(\w+)={(\w+)}/g, type: "Uses" },
      { pattern: /bind:(\w+)="(\w+)"/g, type: "Uses" },
      { pattern: /class:(\w+)={(\w+)}/g, type: "Uses" },
      { pattern: /\{(\w+)\}/g, type: "Uses" },
    ]
    for (const r of svelteRelRegexes) {
      let m: any
      while ((m = r.pattern.exec(content)) !== null) {
        relationships.push({
          sourceSymbolName: "component",
          targetSymbolName: m[2] || m[1],
          relationshipType: r.type,
          confidence: 0.7,
          context: "Svelte directive",
          lineNumber: 0,
        } as any)
      }
    }
    const errors: ParseError[] = []

    const walkStack: { node: Node; scopePath: string[] }[] = [{ node: rootNode, scopePath: [] }]

    while (walkStack.length > 0) {
      const { node, scopePath } = walkStack.pop()!
      const type = node.type
      let currentScope = [...scopePath]

      if (type === "element" || type === "script_element" || type === "template_element" || type === "style_element") {
        const startTag = this.findChild(node, (n) => n.type === "start_tag")
        if (startTag) {
          const tagName = this.findChild(startTag, (n) => n.type === "tag_name")?.text || "template"

          if (tagName === "script" || tagName === "template" || tagName === "style") {
            const blockSymbol: UniversalSymbol = {
              name: tagName === "script" ? "svelte_script" : `svelte_block_${tagName}`,
              kind: SymbolKind.Module,
              range: {
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                startColumn: node.startPosition.column,
                endColumn: node.endPosition.column,
                startIndex: node.startIndex,
                endIndex: node.endIndex,
              },
              scope: currentScope.join("."),
              metadata: { isSvelteBlock: true },
            }
            symbols.push(blockSymbol)

            if (tagName === "script") {
              const rawText = node.text
              const scriptMatch = rawText.match(/<script[^>]*>([^\x00]*?)<\/script>/i)
              if (scriptMatch && scriptMatch[1]) {
                blockSymbol.metadata!.embeddedScriptContent = scriptMatch[1]
              }

              const langAttr = this.findChild(startTag, (n) => n.type === "attribute" && n.text?.startsWith("lang="))
              if (langAttr) {
                const langMatch = langAttr.text.match(/lang=["'](\w+)["']/)
                if (langMatch) blockSymbol.metadata!.scriptLang = langMatch[1]
              }
            }

            currentScope.push(blockSymbol.name)
          }
        }
      }

      if (type === "directive_attribute" || type === "attribute") {
        const attrName = this.findChild(node, (n) => n.type === "attribute_name" || n.type === "directive_name")?.text
        if (attrName) {
          const attrSymbol: UniversalSymbol = {
            name: attrName,
            kind: SymbolKind.Property,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            metadata: {},
          }
          symbols.push(attrSymbol)

          if (
            attrName.startsWith("on:") ||
            attrName.startsWith("bind:") ||
            attrName.startsWith("class:") ||
            attrName.startsWith("style:")
          ) {
            const attrValue = this.findChild(node, (n) => n.type === "attribute_value")?.text
            if (attrValue) {
              attrSymbol.metadata!.directiveExpression = attrValue.replace(/^["']|["']$/g, "")
            }
          }
        }
      }

      if (type === "call_expression") {
        const fnNameNode = this.findChild(node, (n) => n.type === "identifier")
        if (fnNameNode) {
          const fnName = fnNameNode.text

          if (
            fnName === "$props" ||
            fnName === "$state" ||
            fnName === "$derived" ||
            fnName === "$effect" ||
            fnName === "$render" ||
            fnName === "$inspect"
          ) {
            const runeSymbol: UniversalSymbol = {
              name: fnName,
              kind: SymbolKind.Function,
              range: {
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                startColumn: node.startPosition.column,
                endColumn: node.endPosition.column,
                startIndex: node.startIndex,
                endIndex: node.endIndex,
              },
              scope: currentScope.join("."),
              metadata: { isSvelteRune: true, runeType: fnName },
            }
            symbols.push(runeSymbol)

            const parent = node.parent
            if (parent && parent.type === "variable_declarator") {
              const varName = this.findChild(parent, (n) => n.type === "identifier")?.text
              if (varName) {
                const varSymbol: UniversalSymbol = {
                  name: varName,
                  kind: SymbolKind.Variable,
                  range: {
                    startLine: parent.startPosition.row + 1,
                    endLine: parent.endPosition.row + 1,
                    startColumn: parent.startPosition.column,
                    endColumn: parent.endPosition.column,
                    startIndex: parent.startIndex,
                    endIndex: parent.endIndex,
                  },
                  scope: currentScope.join("."),
                  metadata: { isSvelteRuneVariable: true, runeType: fnName },
                }
                symbols.push(varSymbol)
              }
            }
          }
        }
      }

      if (type === "import_statement") {
        let modulePath = ""
        const importedNames: string[] = []

        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child) {
            if (child.type === "string") {
              modulePath = child.text.replace(/^["']|["']$/g, "")
            } else if (child.type === "identifier") {
              importedNames.push(child.text)
            }
          }
        }

        if (importedNames.length > 0 || modulePath) {
          imports.push({
            module: modulePath,
            importedNames,
            isDefaultImport: importedNames.length > 0,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
          })

          for (const item of importedNames) {
            symbols.push({
              name: item,
              kind: SymbolKind.Import,
              range: {
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                startColumn: node.startPosition.column,
                endColumn: node.endPosition.column,
              },
              scope: currentScope.join("."),
              metadata: { module: modulePath, originalName: item },
            })
          }
        }
      }

      if (type === "variable_declarator") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode) {
          const initNode = this.findChild(node, (n) => n.type === "call_expression")
          let isRuneVar = false
          if (initNode) {
            const fn = this.findChild(initNode, (n) => n.type === "identifier")
            if (fn && ["$state", "$derived", "$effect"].includes(fn.text)) {
              isRuneVar = true
            }
          }

          const varSymbol: UniversalSymbol = {
            name: nameNode.text,
            kind: SymbolKind.Variable,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            metadata: isRuneVar ? { isSvelteRuneVariable: true } : {},
          }
          symbols.push(varSymbol)
        }
      }

      if (type === "function_declaration" || type === "function") {
        const fnNameNode = this.findChild(node, (n) => n.type === "identifier")
        if (fnNameNode) {
          symbols.push({
            name: fnNameNode.text,
            kind: SymbolKind.Function,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            metadata: {},
          })
        }
      }

      if (type === "class_declaration" || type === "class") {
        const classNameNode = this.findChild(node, (n) => n.type === "identifier")
        if (classNameNode) {
          symbols.push({
            name: classNameNode.text,
            kind: SymbolKind.Class,
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              startColumn: node.startPosition.column,
              endColumn: node.endPosition.column,
              startIndex: node.startIndex,
              endIndex: node.endIndex,
            },
            scope: currentScope.join("."),
            metadata: {},
          })
        }
      }

      if (type === "ERROR" || node.hasError) {
        const errMsg = "Svelte Syntax Error at " + (node.startPosition.row + 1) + ":" + node.startPosition.column
        errors.push({
          message: errMsg,
          range: {
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
          },
          severity: "error",
        })
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          walkStack.push({ node: child, scopePath: currentScope })
        }
      }
    }

    return {
      language: "svelte",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "Svelte",
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) {
        return child
      }
    }
    return null
  }
}
