// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealVueAnalyzer implements LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const vueRelRegexes = [
      { pattern: /v-on:(\w+)="(\w+)"/g, type: "Calls" },
      { pattern: /@(\w+)="(\w+)"/g, type: "Calls" },
      { pattern: /v-bind:(\w+)="(\w+)"/g, type: "Uses" },
      { pattern: /:(\w+)="(\w+)"/g, type: "Uses" },
      { pattern: /v-model="(\w+)"/g, type: "Uses" },
    ]
    for (const r of vueRelRegexes) {
      let m: any
      while ((m = r.pattern.exec(content)) !== null) {
        relationships.push({
          source: "template",
          target: m[2] || m[1],
          type: r.type === "Calls" ? RelationshipType.Calls : RelationshipType.Uses,
          confidence: 0.7,
          metadata: { vueDirective: true, directiveName: m[1] },
        })
      }
    }
    const errors: ParseError[] = []
    const patterns: string[] = []

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: {
              startLine: n.startPosition.row + 1, startColumn: n.startPosition.column + 1,
              endLine: n.endPosition.row + 1, endColumn: n.endPosition.column + 1,
              startIndex: n.startIndex, endIndex: n.endIndex,
            },
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

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
              name: tagName === "script" ? "vue_script" : `vue_block_${tagName}`,
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
              metadata: {},
            }
            symbols.push(blockSymbol)

            if (tagName === "script") {
              const rawText = node.text
              const scriptMatch = rawText.match(/<script[^>]*>([^\x00]*?)<\/script>/i)
              if (scriptMatch && scriptMatch[1]) {
                blockSymbol.metadata!.embeddedScriptContent = scriptMatch[1]
              }
            }

            currentScope.push(blockSymbol.name)
          } else {
            const componentSymbol: UniversalSymbol = {
              name: tagName,
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
            }
            symbols.push(componentSymbol)
            currentScope.push(componentSymbol.name)
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

          if (attrName.startsWith("v-") || attrName.startsWith(":") || attrName.startsWith("@")) {
            const attrValue = this.findChild(node, (n) => n.type === "attribute_value")?.text
            if (attrValue) {
              attrSymbol.metadata!.directiveExpression = attrValue.replace(/^["']|["']$/g, "")
              if (attrName === "v-if" || attrName === "v-else" || attrName === "v-show") patterns.push("Conditional Rendering")
              if (attrName === "v-for") patterns.push("List Rendering (v-for)")
              if (attrName === "v-model") patterns.push("Two-Way Binding (v-model)")
              if (attrName === "router-link" || attrName === "router-view") patterns.push("Vue Router")
              if (attrName === "@click" || attrName === "v-on:click") patterns.push("Event Handling")
              if (attrName === "v-html") patterns.push("Raw HTML (v-html)")
            }
          }
        }
      }

      if (type === "call_expression") {
        const fnNameNode = this.findChild(node, (n) => n.type === "identifier")
        if (fnNameNode) {
          const fnName = fnNameNode.text

          if (fnName === "defineProps" || fnName === "defineEmits" || fnName === "defineExpose") {
            const macroSymbol: UniversalSymbol = {
              name: fnName,
              kind: SymbolKind.Method,
              range: {
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                startColumn: node.startPosition.column,
                endColumn: node.endPosition.column,
                startIndex: node.startIndex,
                endIndex: node.endIndex,
              },
              scope: currentScope.join("."),
              metadata: { isVueMacro: true },
            }
            symbols.push(macroSymbol)
          }

          if (fnName === "ref" || fnName === "reactive" || fnName === "computed" || fnName === "watch" || fnName === "watchEffect") {
            patterns.push("Composition API")
            const parent = node.parent
            if (parent && parent.type === "variable_declarator") {
              const varName = this.findChild(parent, (n) => n.type === "identifier")?.text
              if (varName) {
                symbols.push({
                  name: varName,
                  kind: SymbolKind.Variable,
                  range: {
                    startLine: parent.startPosition.row + 1, endLine: parent.endPosition.row + 1,
                    startColumn: parent.startPosition.column, endColumn: parent.endPosition.column,
                    startIndex: parent.startIndex, endIndex: parent.endIndex,
                  },
                  scope: currentScope.join("."),
                  metadata: { isReactive: true, reactiveType: fnName },
                })
              }
            }
          }

          if (fnName === "useRouter" || fnName === "useRoute") patterns.push("Vue Router")
          if (fnName === "useStore" || fnName === "defineStore") patterns.push("Pinia State Management")
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
        }
      }

      if (type === "variable_declarator") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode) {
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
            metadata: {},
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
        const errMsg = "Vue Syntax Error at " + (node.startPosition.row + 1) + ":" + node.startPosition.column
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
      language: "vue",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns,
        detectedFrameworks: ["Vue"],
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
