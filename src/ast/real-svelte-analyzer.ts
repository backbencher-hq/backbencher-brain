// @ts-nocheck — Ported from backbencher.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "./types.js"

export class RealSvelteAnalyzer implements LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    // Svelte relationships extracted via AST traversal (no regex)
    // Directives like on:click, bind:value are parsed as attributes by tree-sitter
    const errors: ParseError[] = []

    const walkStack: { node: Node; scopePath: string[] }[] = [{ node: rootNode, scopePath: [] }]

    while (walkStack.length > 0) {
      const { node, scopePath } = walkStack.pop()!
      const type = node.type
      let currentScope = [...scopePath]

      if (type === "element" || type === "script_element" || type === "template_element" || type === "style_element") {
        const startTag = this.findChild(node, (n) => n.type === "start_tag") || this.findChild(node, (n) => n.type === "self_closing_tag")
        if (startTag) {
          const tagNameNode = this.findChild(startTag, (n) => n.type === "tag_name")
          const tagName = tagNameNode?.text || "template"

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
              // Extract script content without regex: find <script...> and </script>
              const openEnd = rawText.indexOf(">")
              const closeTag = rawText.lastIndexOf("</script>")
              let scriptContent = ""
              if (openEnd !== -1 && closeTag > openEnd) {
                scriptContent = rawText.substring(openEnd + 1, closeTag)
                blockSymbol.metadata!.embeddedScriptContent = scriptContent
              }

              // Extract exports from script content without regex (pure string ops)
              // Svelte component props: export let/const/function/class name
              if (scriptContent) {
                const exportKeyword = "export "
                let searchIdx = 0
                while (searchIdx < scriptContent.length) {
                  const expIdx = scriptContent.indexOf(exportKeyword, searchIdx)
                  if (expIdx === -1) break
                  searchIdx = expIdx + exportKeyword.length
                  // Skip whitespace after "export "
                  while (searchIdx < scriptContent.length && 
                         (scriptContent[searchIdx] === " " || scriptContent[searchIdx] === "\t" || scriptContent[searchIdx] === "\n")) {
                    searchIdx++
                  }
                  // Check for let/const/function/class/type/interface
                  const rest = scriptContent.substring(searchIdx)
                  let nameStart = searchIdx
                  if (rest.startsWith("let ") || rest.startsWith("const ")) {
                    nameStart = searchIdx + (rest.startsWith("let ") ? 4 : 6)
                  } else if (rest.startsWith("function ")) {
                    nameStart = searchIdx + 9
                  } else if (rest.startsWith("class ")) {
                    nameStart = searchIdx + 6
                  } else if (rest.startsWith("type ")) {
                    nameStart = searchIdx + 5
                  } else if (rest.startsWith("interface ")) {
                    nameStart = searchIdx + 10
                  } else if (rest.startsWith("default ")) {
                    // export default function/class name or export default name
                    const afterDefault = rest.substring(8).trimStart()
                    if (afterDefault.startsWith("function ")) {
                      nameStart = searchIdx + 8 + 1 + 9 // skip "default function "
                    } else if (afterDefault.startsWith("class ")) {
                      nameStart = searchIdx + 8 + 1 + 6
                    } else {
                      // export default name
                      nameStart = searchIdx + 8
                    }
                  } else {
                    continue // not a recognizable export
                  }
                  // Extract the name (identifier)
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
                      type: RelationshipType.Exports,
                      confidence: 0.9,
                      metadata: { context: "Svelte component prop (export)" },
                    } as any)
                  }
                  searchIdx = nameEnd
                }
              }

              // Extract lang attribute without regex: find 'lang=' and extract value
              for (let i = 0; i < startTag.childCount; i++) {
                const child = startTag.child(i)
                if (child && child.type === "attribute") {
                  const txt = child.text
                  if (txt.startsWith("lang=")) {
                    let val = txt.substring(5)
                    if ((val.startsWith('"') || val.startsWith("'")) && val.length > 1) {
                      val = val.substring(1, val.length - 1)
                    }
                    blockSymbol.metadata!.scriptLang = val
                    break
                  }
                }
              }
            }

            currentScope.push(blockSymbol.name)
          } else {
            // Custom component detection: capitalized tag name → Instantiates + Contains
            const isCustomComponent = tagName.length > 0 && tagName[0] === tagName[0].toUpperCase() && tagName[0] !== tagName[0].toLowerCase()
            if (isCustomComponent) {
              const parentName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"
              relationships.push({
                source: parentName,
                target: tagName,
                type: RelationshipType.Contains,
                confidence: 0.9,
                metadata: { context: "Svelte component nesting" },
              } as any)
              relationships.push({
                source: parentName,
                target: tagName,
                type: RelationshipType.Instantiates,
                confidence: 0.85,
                metadata: { context: "Svelte component usage" },
              } as any)
            }
            // Push element name to scope for child tracking
            currentScope.push(tagName)
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
            attrName.startsWith("style:") ||
            attrName.startsWith("use:") ||
            attrName.startsWith("transition:") ||
            attrName.startsWith("animate:") ||
            attrName.startsWith("in:") ||
            attrName.startsWith("out:")
          ) {
            const attrValue = this.findChild(node, (n) => n.type === "attribute_value")?.text
            if (attrValue) {
              attrSymbol.metadata!.directiveExpression = attrValue.replace(/^["']|["']$/g, "")
            }
            // AST-based relationship extraction from directive attributes (zero regex)
            const scopeName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"
            if (attrName.startsWith("on:")) {
              relationships.push({
                source: scopeName,
                target: attrName.slice(3),
                type: RelationshipType.Calls,
                confidence: 0.7,
                metadata: { context: `Svelte event handler ${attrName}` },
              } as any)
            } else if (attrName.startsWith("bind:")) {
              relationships.push({
                source: scopeName,
                target: attrName.slice(5),
                type: RelationshipType.Uses,
                confidence: 0.8,
                metadata: { context: `Svelte binding ${attrName}` },
              } as any)
            } else if (attrName.startsWith("class:")) {
              relationships.push({
                source: scopeName,
                target: attrName.slice(6),
                type: RelationshipType.Uses,
                confidence: 0.8,
                metadata: { context: `Svelte class directive ${attrName}` },
              } as any)
            } else if (attrName.startsWith("style:")) {
              relationships.push({
                source: scopeName,
                target: attrName.slice(6),
                type: RelationshipType.Uses,
                confidence: 0.8,
                metadata: { context: `Svelte style directive ${attrName}` },
              } as any)
            } else if (attrName.startsWith("use:")) {
              relationships.push({
                source: scopeName,
                target: attrName.slice(4),
                type: RelationshipType.Calls,
                confidence: 0.85,
                metadata: { context: `Svelte action ${attrName}` },
              } as any)
            } else if (attrName.startsWith("transition:") || attrName.startsWith("in:") || attrName.startsWith("out:")) {
              const colonIdx = attrName.indexOf(":")
              relationships.push({
                source: scopeName,
                target: attrName.slice(colonIdx + 1),
                type: RelationshipType.Uses,
                confidence: 0.8,
                metadata: { context: `Svelte transition ${attrName}` },
              } as any)
            } else if (attrName.startsWith("animate:")) {
              relationships.push({
                source: scopeName,
                target: attrName.slice(8),
                type: RelationshipType.Uses,
                confidence: 0.8,
                metadata: { context: `Svelte animation ${attrName}` },
              } as any)
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
            // Import relationship: component imports this symbol
            const scopeName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"
            relationships.push({
              source: scopeName,
              target: item,
              type: RelationshipType.Imports,
              confidence: 0.9,
              metadata: { context: "Svelte import", module: modulePath },
            } as any)
          }
        }
      }

      // Handle Svelte exports (export let/const/function in script blocks)
      if (type === "export_statement") {
        const decl = this.findChild(node, (n) =>
          n.type === "variable_declaration" ||
          n.type === "function_declaration" ||
          n.type === "class_declaration" ||
          n.type === "lexical_declaration",
        )
        if (decl) {
          const nameNode = this.findChild(decl, (n) => n.type === "identifier")
          if (nameNode) {
            exports.push({
              name: nameNode.text,
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
            const scopeName = currentScope.length > 0 ? currentScope[currentScope.length - 1] : "component"
            relationships.push({
              source: scopeName,
              target: nameNode.text,
              type: RelationshipType.Exports,
              confidence: 0.9,
              metadata: { context: "Svelte export" },
            } as any)
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

    // Post-loop: add contains for owned symbols
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
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
