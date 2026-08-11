import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealGroovyAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, fileContent: string, filePath: string): ASTEngine.ParseResult {
    // LAW 4: 100% Stateless Thread Safety. ZERO mutable class-level properties.
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    let currentPackage = ""

    // LAW 3: O(N) iterative Depth-First Search. No Recursive GC leaks.
    const walkStack: Array<{ 
      node: Node; 
      isExit: boolean; 
      scopePath: string[]; // Maintaining FQNs (Fully Qualified Names)
    }> = [
      { node: rootNode, isExit: false, scopePath: [] }
    ]

    while (walkStack.length > 0) {
      const state = walkStack.pop()!
      if (!state) continue
      
      const { node, isExit, scopePath } = state
      if (isExit || !node || node.isMissing) continue

      let nextScopePath = [...scopePath]
      const activeScope = nextScopePath.length > 0 ? nextScopePath[nextScopePath.length - 1] : "global"
      const fqn = nextScopePath.join(".")

      // LAW 1: Flawless Database Extraction
      
      // 1. Package space (namespace)
      if (node.type === "package_declaration") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "scoped_identifier")
        if (nameNode) {
          currentPackage = nameNode.text
          symbols.push({
            name: currentPackage,
            kind: ASTEngine.SymbolKind.Namespace,
            range: this.getRange(node),
            metadata: { groovySpecific: true, isPackage: true },
          })
        }
      }
      // 2. Imports (Very important for Java/Groovy JVM boundary resolution)
      else if (node.type === "import_declaration") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "scoped_identifier")
        if (nameNode) {
          const isStatic = this.findChild(node, (n) => n.text === "static") !== null
          imports.push({
            source: nameNode.text,
            specifiers: [{ name: nameNode.text, isDefault: true }],
          })
          symbols.push({
             name: nameNode.text,
             kind: ASTEngine.SymbolKind.Import,
             range: this.getRange(node),
             metadata: { groovySpecific: true, isStatic },
          })
          // DependsOn for imports
          relationships.push({
            source: currentPackage || filePath,
            target: nameNode.text,
            type: ASTEngine.RelationshipType.References,
            confidence: 0.9,
            metadata: { isImportDep: true },
          })
        }
      }
      // 3. Classes, Traits, Interfaces, Enums
      else if (["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"].includes(node.type)) {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode) {
          const className = nameNode.text
          nextScopePath.push(className)
          
          let kind = ASTEngine.SymbolKind.Class
          if (node.type === "interface_declaration" || node.type === "trait_declaration") kind = ASTEngine.SymbolKind.Interface
          if (node.type === "enum_declaration") kind = ASTEngine.SymbolKind.Enum

          symbols.push({
            name: className,
            kind,
            range: this.getRange(node),
            metadata: { groovySpecific: true, type: node.type, localName: className },
          })

          // Extract Implements / Extends relationships (Traits / Superclasses)
          const extendsClause = this.findChild(node, (n) => n.type === "super_interfaces" || n.type === "interfaces")
          const superClass = this.findChild(node, (n) => n.type === "superclass")
          if (superClass) {
            const scName = this.findChild(superClass, (n) => n.type === "type_identifier")
            if (scName) {
              relationships.push({ source: className, target: scName.text, type: ASTEngine.RelationshipType.Extends, metadata: {} })
            }
          }
          if (extendsClause) {
            // type_identifier may be nested under type_list
            let typeIds = this.filterChildren(extendsClause, (n) => n.type === "type_identifier")
            if (typeIds.length === 0) {
              const typeList = this.findChild(extendsClause, (n) => n.type === "type_list")
              if (typeList) typeIds = this.filterChildren(typeList, (n) => n.type === "type_identifier")
            }
            for (const tid of typeIds) {
              relationships.push({
                source: className,
                target: tid.text,
                type: ASTEngine.RelationshipType.Implements,
                metadata: {},
              })
            }
          }

          // FIX 5: Synthesize compile-time AST Annotations (@Slf4j, @Log, etc.)
          const modifiers = this.findChild(node, (n) => n.type === "modifiers")
          if (modifiers) {
              const annotations = this.filterChildren(modifiers, (n) => n.type === "annotation")
              for (const ann of annotations) {
                  const annName = this.findChild(ann, (n) => n.type === "identifier")?.text
                  if (annName && ["Slf4j", "Log", "Log4j", "Log4j2", "Commons"].includes(annName)) {
                      symbols.push({
                          name: "log",
                          kind: ASTEngine.SymbolKind.Property,
                          range: this.getRange(node), // synthetic bounds matching class
                          metadata: { groovySpecific: true, synthetic: true, generatedBy: `@${annName}` },
                      })
                      relationships.push({
                         source: "log",
                         target: className,
                         type: ASTEngine.RelationshipType.Uses,
                         metadata: { belongsToClass: true, synthetic: true }
                      })
                  }
              }
          }
        }
      }
      // 4. Methods, Constructors, and Spock Tests
      else if (node.type === "method_declaration" || node.type === "constructor_declaration") {
        // Handle standard identifiers or Spock Strings (`def "should calculate tax correctly"()`)
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "string_literal")
        if (nameNode) {
          const methodName = nameNode.text.replace(/["']/g, "")
          nextScopePath.push(methodName)
          
          symbols.push({
            name: node.type === "constructor_declaration" ? "constructor" : methodName,
            kind: node.type === "constructor_declaration" ? ASTEngine.SymbolKind.Constructor : ASTEngine.SymbolKind.Method,
            range: this.getRange(node),
            metadata: { groovySpecific: true, isSpockTest: nameNode.type === "string_literal" },
          })
          
          // Map method to parent class (skip constructors with same name as class)
          if (activeScope && activeScope !== "global" && methodName !== activeScope) {
            relationships.push({
               source: activeScope,
               target: methodName,
               type: ASTEngine.RelationshipType.Contains,
               metadata: { belongsToClass: true }
            })
          }
          // Check for @Override annotation → Overrides relationship
          const modifiers = this.findChild(node, (n) => n.type === "modifiers")
          if (modifiers) {
            const annotations = this.filterChildren(modifiers, (n) => n.type === "annotation" || n.type === "marker_annotation")
            for (const ann of annotations) {
              const annName = this.findChild(ann, (n) => n.type === "identifier")?.text
              if (annName === "Override") {
                relationships.push({
                  source: activeScope,
                  target: methodName,
                  type: ASTEngine.RelationshipType.Overrides,
                  confidence: 0.9,
                  metadata: { isOverride: true },
                })
              }
            }
          }
        }
      }
      // 5. Fields & Variables (Dynamic `def` vs Static typing)
      else if (node.type === "field_declaration" || node.type === "def_declaration" || node.type === "variable_declaration") {
        const declarator = this.findChild(node, (n) => n.type === "variable_declarator")
        const nameNode = declarator ? this.findChild(declarator, (n) => n.type === "identifier") : null
        if (nameNode) {
          const fieldName = nameNode.text
          symbols.push({
            name: fieldName,
            kind: node.type === "field_declaration" || node.type === "def_declaration" ? ASTEngine.SymbolKind.Property : ASTEngine.SymbolKind.Variable,
            range: this.getRange(node),
            metadata: { groovySpecific: true, parentScope: activeScope },
          })

          // FIX 4: Property-to-Getter/Setter Bridging (Class level fields)
          if (node.type === "field_declaration" || node.type === "def_declaration") {
             const capitalized = fieldName.charAt(0).toUpperCase() + fieldName.slice(1)
             const getterName = `get${capitalized}`
             const setterName = `set${capitalized}`
             
             symbols.push({
                name: getterName,
                kind: ASTEngine.SymbolKind.Method,
                range: this.getRange(node),
                metadata: { groovySpecific: true, synthetic: true, bridgeFrom: fieldName },
             })
             symbols.push({
                name: setterName,
                kind: ASTEngine.SymbolKind.Method,
                range: this.getRange(node),
                metadata: { groovySpecific: true, synthetic: true, bridgeFrom: fieldName },
             })

             if (activeScope && activeScope !== "global") {
                 relationships.push({ source: getterName, target: activeScope, type: ASTEngine.RelationshipType.Uses, metadata: { synthetic: true } })
                 relationships.push({ source: setterName, target: activeScope, type: ASTEngine.RelationshipType.Uses, metadata: { synthetic: true } })
             }
          }
        }
      }
      // FIX 1: Command Expressions & Gradle DSL Blocks
      else if (node.type === "command_expression") {
        const cmdName = this.findChild(node, (n) => n.type === "identifier")
        if (cmdName) {
            const cmdText = cmdName.text
            nextScopePath.push(cmdText)
            
            relationships.push({
              source: activeScope,
              target: cmdText,
              type: ASTEngine.RelationshipType.Calls,
              metadata: { isCommandExpression: true }
            })
        }
      }
      // FIX 2: Implicit `it` Parameter in Closures
      else if (node.type === "closure") {
         const hasParams = this.findChild(node, (n) => n.type === "lambda_expression") !== null
         if (!hasParams) {
             symbols.push({
                 name: "it",
                 kind: ASTEngine.SymbolKind.Variable,
                 range: this.getRange(node), 
                 metadata: { groovySpecific: true, synthetic: true, isImplicitClosureParam: true },
             })
         }
      }
      // FIX 3: GString (Interpolated String) Relationship Extraction
      else if (node.type === "string_interpolation" || node.type === "interpolated_string") {
         // Some tree-sitter grammars nest the identifier in expressions inside the interpolation
         const expr = this.findChild(node, (n) => n.type === "expression") || node
         const ids = this.filterChildren(expr, (n) => n.type === "identifier" || n.type === "field_access")
         for (const idNode of ids) {
             const targetText = idNode.type === "field_access" ? this.findChild(idNode, (n) => n.type === "identifier")?.text : idNode.text
             if (targetText && activeScope !== "global") {
                 relationships.push({
                    source: activeScope,
                    target: targetText,
                    type: ASTEngine.RelationshipType.Uses,
                    metadata: { isGStringInterpolation: true }
                 })
             }
         }
      }
      // 7. Standard Method Invocations (Cross-file Calls)
      else if (node.type === "method_invocation") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode && activeScope !== "global") {
            relationships.push({
              source: activeScope,
              target: nameNode.text,
              type: ASTEngine.RelationshipType.Calls,
              metadata: {}
            })
            // Groovy uses new ClassName() — detect instantiation
            if (nameNode.text[0] === nameNode.text[0].toUpperCase() && nameNode.text[0] !== nameNode.text[0].toLowerCase()) {
              relationships.push({
                source: activeScope,
                target: nameNode.text,
                type: ASTEngine.RelationshipType.Instantiates,
                confidence: 0.8,
                metadata: { isInstantiation: true },
              })
            }
        }
      }
      // 8. Constructor calls: new ClassName() → Instantiates
      else if (node.type === "constructor_declaration" || node.type === "object_creation_expression") {
        const typeNode = this.findChild(node, (n) => n.type === "type_identifier" || n.type === "identifier")
        if (typeNode) {
          relationships.push({
            source: activeScope || "global",
            target: typeNode.text,
            type: ASTEngine.RelationshipType.Instantiates,
            confidence: 0.95,
            metadata: { isConstructor: node.type === "constructor_declaration", isObjectCreation: node.type === "object_creation_expression" },
          })
        }
      }
      // FIX 4 (Caller side): Property/Field Access mapped to synthetic Get/Set calls
      else if (node.type === "field_access" || node.type === "property_access") {
         const propName = this.findChild(node, (n) => n.type === "identifier")
         if (propName && activeScope !== "global") {
             const pText = propName.text
             const capitalized = pText.charAt(0).toUpperCase() + pText.slice(1)
             relationships.push({
                 source: activeScope,
                 target: `get${capitalized}`,
                 type: ASTEngine.RelationshipType.Calls,
                 metadata: { synthetic: true, bridgeFrom: pText }
             })
             relationships.push({
                 source: activeScope,
                 target: `set${capitalized}`,
                 type: ASTEngine.RelationshipType.Calls,
                 metadata: { synthetic: true, bridgeFrom: pText }
             })
         }
      }
      // LAW 2: Absolute Zero WASM-bridge arrays. O(D) memory safety.
      const childCount = node.namedChildCount
      for (let i = childCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
           walkStack.push({ node: child, isExit: false, scopePath: nextScopePath })
        }
      }
    }

    // LAW 3: O(N) MAP deduplications.
    const uniqueSymbolsMap = new Map<string, ASTEngine.UniversalSymbol>()
    for (let i = 0; i < symbols.length; i++) {
        uniqueSymbolsMap.set(`${symbols[i].kind}:${symbols[i].name}:${symbols[i].range.startLine}:${symbols[i].range.startColumn}`, symbols[i])
    }
    const uniqueSymbols = Array.from(uniqueSymbolsMap.values())

    const uniqueRelMap = new Map<string, ASTEngine.UniversalRelationship>()
    for (let i = 0; i < relationships.length; i++) {
        uniqueRelMap.set(`${relationships[i].source}->${relationships[i].target}`, relationships[i])
    }
    const uniqueRelationships = Array.from(uniqueRelMap.values())

    for (let i = 0; i < uniqueSymbols.length; i++) {
      const s = uniqueSymbols[i]
      if (!s.metadata?.synthetic && s.visibility !== "private") {
        exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" })
      }
    }
    return {
      language: "groovy",
      symbols: uniqueSymbols,
      relationships: uniqueRelationships,
      imports,
      exports,
      errors,
      metadata: { 
          complexity: uniqueSymbols.length + uniqueRelationships.length, 
          linesOfCode: fileContent.split("\n").length 
      },
    }
  }

  // Pure cursor helper protecting V8 from GC Thrashing (Law 2)
  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
        const child = node.namedChild(i)
        if (child && predicate(child)) return child
    }
    return null
  }

  // Pure collection cursor helper (Law 2)
  private filterChildren(node: Node, predicate: (n: Node) => boolean): Node[] {
     const results: Node[] = []
     const count = node.namedChildCount
     for (let i = 0; i < count; i++) {
         const child = node.namedChild(i)
         if (child && predicate(child)) results.push(child)
     }
     return results
  }

  private getRange(node: Node) {
    return {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column,
        startIndex: node.startIndex,
        endIndex: node.endIndex
    }
  }
}
