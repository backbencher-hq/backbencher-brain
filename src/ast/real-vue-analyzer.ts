import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealVueAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    // Vue relationships extracted via AST traversal (zero regex)
    // Directives like v-on:, @, v-bind:, :, v-model are parsed as attributes by tree-sitter
    const errors: ASTEngine.ParseError[] = []
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
        const startTag = this.findChild(node, (n) => n.type === "start_tag") || this.findChild(node, (n) => n.type === "self_closing_tag")
        if (startTag) {
          const tagName = this.findChild(startTag, (n) => n.type === "tag_name")?.text || "template"

          if (tagName === "script" || tagName === "template" || tagName === "style") {
            const blockSymbol: ASTEngine.UniversalSymbol = {
              name: tagName === "script" ? "vue_script" : `vue_block_${tagName}`,
              kind: ASTEngine.SymbolKind.Module,
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
              // Extract script content without regex: find <script...> and </script>
              const openEnd = rawText.indexOf(">")
              const closeTag = rawText.lastIndexOf("</script>")
              let scriptContent = ""
              if (openEnd !== -1 && closeTag > openEnd) {
                scriptContent = rawText.substring(openEnd + 1, closeTag)
                blockSymbol.metadata!.embeddedScriptContent = scriptContent
              }

              // Extract exports from script content (pure string ops, zero regex)
              if (scriptContent) {
                const exportKeyword = "export "
                let searchIdx = 0
                while (searchIdx < scriptContent.length) {
                  const expIdx = scriptContent.indexOf(exportKeyword, searchIdx)
                  if (expIdx === -1) break
                  searchIdx = expIdx + exportKeyword.length
                  while (searchIdx < scriptContent.length &&
                         (scriptContent[searchIdx] === " " || scriptContent[searchIdx] === "\t" || scriptContent[searchIdx] === "\n")) {
                    searchIdx++
                  }
                  const rest = scriptContent.substring(searchIdx)
                  let nameStart = searchIdx
                  if (rest.startsWith("let ") || rest.startsWith("const ")) {
                    nameStart = searchIdx + (rest.startsWith("let ") ? 4 : 6)
                  } else if (rest.startsWith("function ")) {
                    nameStart = searchIdx + 9
                  } else if (rest.startsWith("class ")) {
                    nameStart = searchIdx + 6
                  } else if (rest.startsWith("default ")) {
                    const afterDefault = rest.substring(8).trimStart()
                    if (afterDefault.startsWith("function ")) {
                      nameStart = searchIdx + 8 + 1 + 9
                    } else if (afterDefault.startsWith("class ")) {
                      nameStart = searchIdx + 8 + 1 + 6
                    } else {
                      nameStart = searchIdx + 8
                    }
                  } else {
                    continue
                  }
                  while (nameStart < scriptContent.length &&
                         (scriptContent[nameStart] === " " || scriptContent[nameStart] === "\t")) {
                    nameStart++
                  }
                  let nameEnd = nameStart
                  while (nameEnd < scriptContent.length &&
                         ((scriptContent[nameEnd] >= "a" && scriptContent[nameEnd] <= "z") ||
                          (scriptContent[nameEnd] >= "A" && scriptContent[nameEnd] <= "Z") ||
                          (scriptContent[nameEnd] >= "0" && scriptContent[nameEnd] <= "9") ||
                          scriptContent[nameEnd] === "_" || scriptContent[nameEnd] === "$")) {
                    nameEnd++
                  }
                  if (nameEnd > nameStart) {
                    const exportName = scriptContent.substring(nameStart, nameEnd)
                    exports.push({
                      name: exportName,
                      module: filePath,
                      isDefaultExport: false,
                      range: {
                        startLine: node.startPosition.row + 1,
                        endLine: node.endPosition.row + 1,
                        startColumn: node.startPosition.column,
                        endColumn: node.endPosition.column,
                        startIndex: node.startIndex,
                        endIndex: node.endIndex,
                      },
                    })
                    relationships.push({
                      source: "component",
                      target: exportName,
                      type: ASTEngine.RelationshipType.Exports,
                      confidence: 0.9,
                      metadata: { context: "Vue component export" },
                    } as any)
                  }
                  searchIdx = nameEnd
                }
              }
            }

            currentScope.push(blockSymbol.name)
          } else {
            // Vue component detection: PascalCase tag → Instantiates + Contains
            const isCustomComponent = tagName.length > 0 && tagName[0] === tagName[0].toUpperCase() && tagName[0] !== tagName[0].toLowerCase()
            if (isCustomComponent) {
              const parentName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"
              relationships.push({
                source: parentName,
                target: tagName,
                type: ASTEngine.RelationshipType.Contains,
                confidence: 0.9,
                metadata: { context: "Vue component nesting" },
              } as any)
              relationships.push({
                source: parentName,
                target: tagName,
                type: ASTEngine.RelationshipType.Instantiates,
                confidence: 0.85,
                metadata: { context: "Vue component usage" },
              } as any)
            }
            const componentSymbol: ASTEngine.UniversalSymbol = {
              name: tagName,
              kind: ASTEngine.SymbolKind.Class,
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
          const attrSymbol: ASTEngine.UniversalSymbol = {
            name: attrName,
            kind: ASTEngine.SymbolKind.Property,
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
            // Search deeper for attribute_value (may be nested in quoted_attribute_value)
            let attrValue: string | undefined
            const findAttrValue = (n: Node): string | undefined => {
              if (n.type === "attribute_value") return n.text
              if (n.type === "quoted_attribute_value") {
                for (let i = 0; i < n.childCount; i++) {
                  const c = n.child(i)
                  if (c && c.type === "attribute_value") return c.text
                }
              }
              for (let i = 0; i < n.childCount; i++) {
                const c = n.child(i)
                if (c) {
                  const result = findAttrValue(c)
                  if (result !== undefined) return result
                }
              }
              return undefined
            }
            attrValue = findAttrValue(node)
            if (attrValue) {
              // Strip quotes without regex
              let val = attrValue
              if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.substring(1, val.length - 1)
              }
              attrSymbol.metadata!.directiveExpression = val

              if (attrName === "v-if" || attrName === "v-else" || attrName === "v-show") patterns.push("Conditional Rendering")
              if (attrName === "v-for") patterns.push("List Rendering (v-for)")
              if (attrName === "v-model") patterns.push("Two-Way Binding (v-model)")
              if (attrName === "router-link" || attrName === "router-view") patterns.push("Vue Router")
              if (attrName === "@click" || attrName === "v-on:click") patterns.push("Event Handling")
              if (attrName === "v-html") patterns.push("Raw HTML (v-html)")
            }

            // AST-based relationship extraction (zero regex)
            const scopeName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"

            // Get the expression value for use as relationship target
            let exprValue = ""
            if (attrValue) {
              if ((attrValue.startsWith('"') && attrValue.endsWith('"')) || (attrValue.startsWith("'") && attrValue.endsWith("'"))) {
                exprValue = attrValue.substring(1, attrValue.length - 1)
              } else {
                exprValue = attrValue
              }
            }

            // v-on:event or @event → Calls (target = handler from value)
            if (attrName.startsWith("v-on:")) {
              relationships.push({
                source: scopeName,
                target: exprValue || attrName.slice(5),
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.7,
                metadata: { context: "Vue event handler " + attrName },
              } as any)
            } else if (attrName.startsWith("@")) {
              relationships.push({
                source: scopeName,
                target: exprValue || attrName.slice(1),
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.7,
                metadata: { context: "Vue event handler " + attrName },
              } as any)
            }
            // v-bind:prop or :prop → Uses (target = bound variable from value)
            else if (attrName.startsWith("v-bind:")) {
              relationships.push({
                source: scopeName,
                target: exprValue || attrName.slice(7),
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.8,
                metadata: { context: "Vue binding " + attrName },
              } as any)
            } else if (attrName.startsWith(":") && !attrName.startsWith(":class") && !attrName.startsWith(":style")) {
              // :prop (shorthand v-bind, target = bound variable from value)
              relationships.push({
                source: scopeName,
                target: exprValue || attrName.slice(1),
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.8,
                metadata: { context: "Vue binding " + attrName },
              } as any)
            }
            // v-model → Uses (target = bound variable from value)
            else if (attrName === "v-model") {
              relationships.push({
                source: scopeName,
                target: exprValue || attrName,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.9,
                metadata: { context: "Vue v-model directive" },
              } as any)
            }
            // v-if, v-show, v-for → Uses (control flow, target = directive name)
            else if (attrName === "v-if" || attrName === "v-show" || attrName === "v-for" || attrName === "v-else-if") {
              relationships.push({
                source: scopeName,
                target: attrName,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.6,
                metadata: { context: "Vue control flow " + attrName },
              } as any)
            }
          }
        }
      }

      if (type === "call_expression") {
        const fnNameNode = this.findChild(node, (n) => n.type === "identifier")
        if (fnNameNode) {
          const fnName = fnNameNode.text

          if (fnName === "defineProps" || fnName === "defineEmits" || fnName === "defineExpose") {
            const macroSymbol: ASTEngine.UniversalSymbol = {
              name: fnName,
              kind: ASTEngine.SymbolKind.Method,
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
            // Vue macro calls
            const scopeName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"
            relationships.push({
              source: scopeName,
              target: fnName,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.8,
              metadata: { context: "Vue compiler macro" },
            } as any)
          }

          if (fnName === "ref" || fnName === "reactive" || fnName === "computed" || fnName === "watch" || fnName === "watchEffect") {
            patterns.push("Composition API")
            const scopeName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"
            relationships.push({
              source: scopeName,
              target: fnName,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.8,
              metadata: { context: "Vue Composition API" },
            } as any)
            const parent = node.parent
            if (parent && parent.type === "variable_declarator") {
              const varName = this.findChild(parent, (n) => n.type === "identifier")?.text
              if (varName) {
                symbols.push({
                  name: varName,
                  kind: ASTEngine.SymbolKind.Variable,
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

          if (fnName === "useRouter" || fnName === "useRoute") {
            patterns.push("Vue Router")
            const scopeName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"
            relationships.push({
              source: scopeName,
              target: fnName,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.8,
              metadata: { context: "Vue Router composable" },
            } as any)
          }
          if (fnName === "useStore" || fnName === "defineStore") {
            patterns.push("Pinia State Management")
            const scopeName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"
            relationships.push({
              source: scopeName,
              target: fnName,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.8,
              metadata: { context: "Pinia store" },
            } as any)
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
              // Strip quotes without regex
              let path = child.text
              if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
                path = path.substring(1, path.length - 1)
              }
              modulePath = path
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

          // AST-based import relationships
          const scopeName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"
          for (const item of importedNames) {
            relationships.push({
              source: scopeName,
              target: item,
              type: ASTEngine.RelationshipType.Imports,
              confidence: 0.9,
              metadata: { context: "Vue import", module: modulePath },
            } as any)
          }
        }
      }

      if (type === "variable_declarator") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode) {
          const varSymbol: ASTEngine.UniversalSymbol = {
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Variable,
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
            kind: ASTEngine.SymbolKind.Function,
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
            kind: ASTEngine.SymbolKind.Class,
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

    // Post-loop: add contains for owned symbols
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
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
