// @ts-nocheck — Ported from backbencher.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "./types.js"

export class RealJavaScriptAnalyzer implements LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string
  ): ParseResult & { metadata: Partial<FileMetadata> } {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const errors: ParseError[] = []

    const frameworks: Record<string, boolean> = { JavaScript: true }
    const patterns: Record<string, boolean> = {}
    const symbolMap = new Map<string, UniversalSymbol>()

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.nodeToRange(n),
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    interface StackItem {
      node: Node
      scope: string[]
      isClassScope: boolean
    }

    const stack: StackItem[] = [{ node: rootNode, scope: [], isClassScope: false }]
    let cyclomaticComplexity = 1

    while (stack.length > 0) {
      const { node, scope, isClassScope } = stack.pop()!
      let skipChildren = false
      const nextScope = [...scope]
      let nextIsClassScope = isClassScope

      if (
        node.type === "if_statement" ||
        node.type === "for_statement" ||
        node.type === "while_statement" ||
        node.type === "catch_clause" ||
        node.type === "switch_case" ||
        node.type === "ternary_expression"
      ) {
        cyclomaticComplexity++
      }

      switch (node.type) {
        case "class_declaration":
        case "class": {
          const idNode = this.findChildByType(node, "identifier")
          if (idNode) {
            const name = idNode.text
            const fqn = scope.length > 0 ? `${scope.join(".")}.${name}` : name
            const sym: UniversalSymbol = {
              name,
              kind: SymbolKind.Class,
              range: this.nodeToRange(node),
              scope: scope.join("."),
              visibility: "public",
              metadata: { javascriptSpecific: true, isClass: true },
            }
            symbols.push(sym)
            symbolMap.set(fqn, sym)
            nextScope.push(name)
            nextIsClassScope = true

            const heritageNode = this.findChildByType(node, "class_heritage")
            if (heritageNode) {
              const isExtends = heritageNode.text.includes("extends")
              for (let i = 0; i < heritageNode.namedChildCount; i++) {
                const hChild = heritageNode.namedChild(i)
                if (!hChild) continue
                // Direct identifier (newer grammar) or extends_clause/implements_clause (older)
                if (hChild.type === "identifier" || hChild.type === "type_identifier") {
                  relationships.push({
                    source: name,
                    target: hChild.text,
                    type: isExtends ? RelationshipType.Extends : RelationshipType.Implements,
                    confidence: 1.0,
                    metadata: { javascriptSpecific: true },
                  })
                } else if (hChild.type === "extends_clause" || hChild.type === "implements_clause") {
                  for (let j = 0; j < hChild.namedChildCount; j++) {
                    const typeNode = hChild.namedChild(j)
                    if (typeNode && (typeNode.type === "identifier" || typeNode.type === "type_identifier")) {
                      relationships.push({
                        source: name,
                        target: typeNode.text,
                        type: hChild.type === "extends_clause" ? RelationshipType.Extends : RelationshipType.Implements,
                        confidence: 1.0,
                        metadata: { javascriptSpecific: true },
                      })
                    }
                  }
                }
              }
            }
          }
          break
        }

        case "function_declaration":
        case "generator_function_declaration": {
          const idNode = this.findChildByType(node, "identifier")
          if (idNode) {
            const name = idNode.text
            const fqn = scope.length > 0 ? `${scope.join(".")}.${name}` : name
            const isAsync = !!node.namedChildren?.some((nc: any) => nc?.type === "async"); const kind = isClassScope ? SymbolKind.Method : SymbolKind.Function
            const sym: UniversalSymbol = {
              name,
              kind,
              range: this.nodeToRange(node),
              scope: scope.join("."),
              visibility: "public",
              metadata: { javascriptSpecific: true, isGenerator: node.type === "generator_function_declaration", isAsync },
            }
            symbols.push(sym)
            symbolMap.set(fqn, sym)
            nextScope.push(name)
            nextIsClassScope = false
            // Contains + potential Overrides: if this function is inside a class
            if (isClassScope && scope.length > 0) {
              relationships.push({
                source: scope[scope.length - 1],
                target: name,
                type: RelationshipType.Contains,
                confidence: 1.0,
                metadata: { javascriptSpecific: true, isMember: true },
              })
            }
          }
          break
        }

        case "function_expression":
        case "arrow_function": {
          // If we're not inside a declaration that already named this, record it as a closure
          const parentType = node.parent?.type
          if (parentType !== "variable_declarator" && parentType !== "assignment_expression" && parentType !== "method_definition") {
             const name = `anonymous_function_${node.startIndex}`
             const sym: UniversalSymbol = {
               name,
               kind: SymbolKind.Function,
               range: this.nodeToRange(node),
               scope: scope.join("."),
               visibility: "local",
               metadata: { javascriptSpecific: true, isClosure: true },
             }
             symbols.push(sym)
             nextScope.push(name)
             nextIsClassScope = false
          }
          break
        }

        case "getter_definition":
        case "setter_definition":
        case "method_definition": {
          const idNode = this.findChildByType(node, "property_identifier") || this.findChildByType(node, "identifier")
          if (idNode) {
            const name = idNode.text
            const fqn = scope.length > 0 ? `${scope.join(".")}.${name}` : name
            const sym: UniversalSymbol = {
              name,
              kind: SymbolKind.Method,
              range: this.nodeToRange(node),
              scope: scope.join("."),
              visibility: "public",
              metadata: { javascriptSpecific: true, isMethod: true, isGetter: node.type === "getter_definition", isSetter: node.type === "setter_definition" },
            }
            symbols.push(sym)
            symbolMap.set(fqn, sym)
            nextScope.push(name)
            nextIsClassScope = false
            // Contains for class methods
            if (isClassScope && scope.length > 0) {
              relationships.push({
                source: scope[scope.length - 1],
                target: name,
                type: RelationshipType.Contains,
                confidence: 1.0,
                metadata: { javascriptSpecific: true, isMember: true },
              })
            }
          }
          break
        }

        case "variable_declarator": {
          const idNode = this.findChildByType(node, "identifier")
          if (idNode) {
            const name = idNode.text
            const fqn = scope.length > 0 ? `${scope.join(".")}.${name}` : name
            
            let isFunction = false
            for (let i = 0; i < node.namedChildCount; i++) {
              const c = node.namedChild(i)
              if (c && (c.type === "arrow_function" || c.type === "function_expression")) {
                isFunction = true
                break
              }
            }

            const sym: UniversalSymbol = {
              name,
              kind: isFunction ? SymbolKind.Function : SymbolKind.Variable,
              range: this.nodeToRange(node),
              scope: scope.join("."),
              visibility: "local",
              metadata: { javascriptSpecific: true, isArrowFunction: isFunction },
            }
            symbols.push(sym)
            symbolMap.set(fqn, sym)

            if (isFunction) {
              nextScope.push(name)
              nextIsClassScope = false
            }
          }
          break
        }

        case "assignment_expression": {
          const leftNode = node.namedChild(0)
          const rightNode = node.namedChild(1)

          if (leftNode && rightNode) {
            if (leftNode.type === "member_expression") {
              const objNode = this.findChildByType(leftNode, "identifier") || leftNode.namedChild(0)
              const propNode = this.findChildByType(leftNode, "property_identifier")
              
              if (objNode && propNode) {
                if (objNode.text === "module" && propNode.text === "exports") {
                  patterns["CommonJS Exports"] = true
                  exports.push({ name: "default", isDefault: true, range: this.nodeToRange(node) })
                  
                  // if module.exports is assigned another member like module.exports = exports = app
                  if (rightNode.type === "assignment_expression" || rightNode.type === "identifier") {
                     // We just record the export
                  }
                }
                else if (objNode.text === "exports") {
                  patterns["CommonJS Exports"] = true
                  exports.push({ name: propNode.text, isDefault: false, range: this.nodeToRange(node) })
                }
                
                // Prototype OR generic dynamic object method assignment like req.get = function()
                let isFunctionAssignment = rightNode.type === "function_expression" || rightNode.type === "arrow_function"
                let fnNode = rightNode
                
                // Support chained assignment: req.get = req.header = function() {}
                if (!isFunctionAssignment && rightNode.type === "assignment_expression") {
                   let curr = rightNode
                   while (curr.type === "assignment_expression") {
                      const child = curr.namedChild(1)
                      if (!child) break
                      curr = child
                   }
                   if (curr.type === "function_expression" || curr.type === "arrow_function") {
                      isFunctionAssignment = true
                      fnNode = curr
                   }
                }

                if (isFunctionAssignment) {
                   patterns["Prototype Inheritance"] = true
                   let className = objNode.text
                   if (objNode.type === "member_expression") {
                      const subObj = this.findChildByType(objNode, "identifier")
                      if (subObj) className = subObj.text
                   }
                   
                   const propertyName = propNode.text !== "prototype" ? propNode.text : (this.findChildByType(leftNode.parent!, "property_identifier")?.text || "method")
                   
                   // Dynamic prototype methods: use the function's own bounds so we capture closures precisely!
                   const sym: UniversalSymbol = {
                      name: `${className}.${propertyName}`,
                      kind: SymbolKind.Method,
                      range: this.nodeToRange(fnNode), // VERY IMPORTANT: Use fnNode bounds to perfectly wrap closure!
                      scope: className,
                      visibility: "public",
                      metadata: { javascriptSpecific: true, isPrototypeMethod: true },
                    }
                    symbols.push(sym)
                    symbolMap.set(`${className}.${propertyName}`, sym)
                    nextScope.push(`${className}.${propertyName}`)
                    nextIsClassScope = false
                }
              }
            }
          }
          break
        }

        case "member_expression": {
          const objNode = node.namedChild(0);
          if (objNode && objNode.type === "this" && scope.length > 0) {
            const propNode = node.namedChild(1);
            if (propNode && (propNode.type === "property_identifier" || propNode.type === "identifier")) {
              relationships.push({
                source: scope.join("."),
                target: propNode.text,
                type: RelationshipType.Uses,
                confidence: 0.9,
                metadata: { javascriptSpecific: true, isThisAccess: true },
              })
            }
          }
          break
        }

        case "call_expression": {
          const functionNode = node.namedChild(0)
          if (!functionNode) break

          // CommonJS require()
          if (functionNode.type === "identifier" && functionNode.text === "require") {
            const argsNode = this.findChildByType(node, "arguments")
            if (argsNode && argsNode.namedChildCount > 0) {
              const arg = argsNode.namedChild(0)
              if (arg && (arg.type === "string" || arg.type === "template_string")) {
                const reqPath = arg.text.replace(/['"`]/g, "")
                imports.push({
                  module: reqPath,
                  items: ["*"],
                  isDefault: true,
                  range: this.nodeToRange(node),
                  metadata: { javascriptSpecific: true, type: "require" },
                })
                patterns["CommonJS Imports"] = true
                relationships.push({
                  source: scope.join(".") || "global",
                  target: reqPath,
                  type: RelationshipType.Uses,
                  confidence: 1.0,
                  metadata: { javascriptSpecific: true, isRequire: true },
                })
              }
            }
            break
          }

          // Extract call target and qualified name
          let targetName = ""
          let qualifiedName = ""

          if (functionNode.type === "member_expression") {
            // obj.method() or console.log() or this.foo()
            const objNode = functionNode.namedChild(0)
            const propNode = this.findChildByType(functionNode, "property_identifier")
            if (propNode) {
              targetName = propNode.text
              qualifiedName = objNode ? `${objNode.text}.${propNode.text}` : propNode.text
            } else {
              targetName = functionNode.text
              qualifiedName = targetName
            }
          } else if (functionNode.type === "identifier") {
            targetName = functionNode.text
            qualifiedName = targetName
          } else {
            // Fallback: use full text
            targetName = functionNode.text
            qualifiedName = targetName
          }

          if (!targetName) break

          // Skip common JS builtins/globals to reduce noise
          const builtins = new Set([
            "console.log", "console.error", "console.warn", "console.info", "console.debug",
            "setTimeout", "setInterval", "clearTimeout", "clearInterval",
            "JSON.parse", "JSON.stringify", "Object.keys", "Object.values", "Object.entries",
            "Array.isArray", "Array.from", "parseInt", "parseFloat", "isNaN", "isFinite",
            "Promise.resolve", "Promise.reject", "Promise.all",
          ])
          if (builtins.has(targetName) || builtins.has(qualifiedName)) break

          const caller = scope.length > 0 ? scope.join(".") : "global"
          relationships.push({
            source: caller,
            target: targetName,
            fromSymbol: caller,
            toSymbol: qualifiedName,
            type: RelationshipType.Calls,
            confidence: 0.9,
            metadata: { javascriptSpecific: true, qualified: qualifiedName },
          })

          // Detect frameworks from calls
          if (qualifiedName === "React.createElement" || targetName === "createElement") {
            frameworks["React"] = true
            patterns["React.createElement"] = true
          }
          if (qualifiedName.includes("express") || targetName === "express") frameworks["Express"] = true
          if (targetName === "useState" || targetName === "useEffect" || targetName === "useCallback") {
            frameworks["React"] = true
            patterns["React Hooks"] = true
          }
          if (targetName === "defineComponent" || targetName === "ref" || targetName === "computed") {
            frameworks["Vue"] = true
          }
          break
        }

        case "new_expression": {
          // new Foo() — instantiation
          const ctorNode = node.namedChild(0)
          if (!ctorNode) break

          let ctorName = ""
          if (ctorNode.type === "identifier") {
            ctorName = ctorNode.text
          } else if (ctorNode.type === "member_expression") {
            ctorName = ctorNode.text
          }

          if (ctorName) {
            const caller = scope.length > 0 ? scope.join(".") : "global"
            relationships.push({
              source: caller,
              target: ctorName,
              fromSymbol: caller,
              toSymbol: ctorName,
              type: RelationshipType.Instantiates,
              confidence: 0.95,
              metadata: { javascriptSpecific: true, isNew: true },
            })
          }
          break
        }

        case "export_statement": {
          patterns["ES6 Exports"] = true
          let isDefault = false
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (child) {
              if (child.type === "default") {
                isDefault = true
              } else if (child.type === "identifier") {
                exports.push({ name: child.text, isDefault, range: this.nodeToRange(child) })
              } else if (child.type === "export_clause") {
                for (let j = 0; j < child.namedChildCount; j++) {
                  const specifier = child.namedChild(j)
                  if (specifier && specifier.type === "export_specifier") {
                    const id = this.findChildByType(specifier, "identifier")
                    if (id) {
                      exports.push({ name: id.text, isDefault: false, range: this.nodeToRange(id) })
                    }
                  }
                }
              } else if (child.type === "lexical_declaration" || child.type === "variable_declaration") {
                const declNode = this.findChildByType(child, "variable_declarator")
                if (declNode) {
                  const idNode = this.findChildByType(declNode, "identifier")
                  if (idNode) {
                    exports.push({ name: idNode.text, isDefault: false, range: this.nodeToRange(idNode) })
                  }
                }
              }
            }
          }
          break
        }

        case "import_statement": {
          patterns["ES6 Imports"] = true
          let srcPath = ""
          const srcNode = this.findChildByType(node, "string")
          if (srcNode) srcPath = srcNode.text.replace(/['"`]/g, "")

          const importsItems: string[] = []
          let isDefault = true
          const clauseNode = this.findChildByType(node, "import_clause")
          if (clauseNode) {
             for (let i = 0; i < clauseNode.namedChildCount; i++) {
                const specifiers = clauseNode.namedChild(i)
                if (specifiers) {
                   if (specifiers.type === "identifier") {
                      importsItems.push(specifiers.text)
                   } else if (specifiers.type === "named_imports") {
                      isDefault = false
                      for (let j = 0; j < specifiers.namedChildCount; j++) {
                         const impSpec = specifiers.namedChild(j)
                         if (impSpec && impSpec.type === "import_specifier") {
                            const nameNode = this.findChildByType(impSpec, "identifier")
                            if (nameNode) importsItems.push(nameNode.text)
                         }
                      }
                   }
                }
             }
          }

          if (srcPath) {
            imports.push({
              module: srcPath,
              items: importsItems,
              isDefault,
              range: this.nodeToRange(node),
              metadata: { javascriptSpecific: true, type: "import" }
            })
            // Create a relationship for ES6 imports
            relationships.push({
               source: scope.join(".") || "global",
               target: srcPath,
               type: RelationshipType.References,
               confidence: 1.0,
               metadata: { javascriptSpecific: true, isImport: true }
            })
          }
          break
        }
      }

      if (!skipChildren) {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) {
            stack.push({ node: child, scope: nextScope, isClassScope: nextIsClassScope })
          }
        }
      }
    }

    const architecturalScore = Math.min(100, Math.max(0, 100 - errors.length * 5))
    const detectedPatterns: string[] = Object.keys(patterns)
    const detectedFrameworks: string[] = Object.keys(frameworks)
    
    if (this.detectsJsx(rootNode)) {
      detectedFrameworks.push("React")
      detectedPatterns.push("JSX Components")
    }

    const frameworkPatterns = detectedPatterns.map(p => ({
        framework: "JavaScript",
        patterns: [{ type: "usage", detected: true, description: p }]
    }))

    return {
      language: "javascript",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: detectedFrameworks.length > 1 ? detectedFrameworks[1] : detectedFrameworks[0],
        patterns: detectedPatterns,
        detectedFrameworks,
        frameworkPatterns,
        architecturalInsights: [],
        architecturalScore,
        codeQuality: errors.length === 0 ? "Excellent" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        analysisVersion: "3.0.1-javascript-stateless-fixed",
      },
    }
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  private detectsJsx(rootNode: Node): boolean {
    const stack: Node[] = [rootNode]
    let maxIters = 500
    while (stack.length > 0 && maxIters-- > 0) {
       const node = stack.pop()!
       if (node.type === "jsx_element" || node.type === "jsx_self_closing_element") return true
       for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child) stack.push(child)
       }
    }
    return false
  }

  private nodeToRange(node: Node): UniversalSymbol["range"] {
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
