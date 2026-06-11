// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealGroovyAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: Node, fileContent: string, filePath: string): ParseResult {
    // LAW 4: 100% Stateless Thread Safety. ZERO mutable class-level properties.
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []
    const exports: ExportInfo[] = []
    const errors: ParseError[] = []

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
            kind: SymbolKind.Namespace,
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
             kind: SymbolKind.Import,
             range: this.getRange(node),
             metadata: { groovySpecific: true, isStatic },
          })
        }
      }
      // 3. Classes, Traits, Interfaces, Enums
      else if (["class_declaration", "interface_declaration", "trait_declaration", "enum_declaration"].includes(node.type)) {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode) {
          const className = nameNode.text
          nextScopePath.push(className)
          
          let kind = SymbolKind.Class
          if (node.type === "interface_declaration" || node.type === "trait_declaration") kind = SymbolKind.Interface
          if (node.type === "enum_declaration") kind = SymbolKind.Enum

          symbols.push({
            name: currentPackage ? `${currentPackage}.${className}` : className,
            kind,
            range: this.getRange(node),
            metadata: { groovySpecific: true, type: node.type, localName: className },
          })

          // Extract Implements / Extends relationships (Traits / Superclasses)
          const extendsClause = this.findChild(node, (n) => n.type === "super_interfaces" || n.type === "interfaces");
          const superClass = this.findChild(node, (n) => n.type === "superclass");
          if (superClass) {
            const scName = this.findChild(superClass, (n) => n.type === "type_identifier");
            if (scName) {
              relationships.push({ source: className, target: scName.text, type: RelationshipType.Extends, metadata: {} });
            }
          }
          const extendsClause2 = this.findChild(node, (n) => n.type === "super_interfaces" || n.type === "interfaces")
          if (extendsClause) {
             const typeIds = this.filterChildren(extendsClause, (n) => n.type === "type_identifier")
             for (let i = 0; i < typeIds.length; i++) {
                 relationships.push({
                     source: className,
                     target: typeIds[i].text,
                     type: RelationshipType.Implements,
                     metadata: {}
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
                          kind: SymbolKind.Property,
                          range: this.getRange(node), // synthetic bounds matching class
                          metadata: { groovySpecific: true, synthetic: true, generatedBy: `@${annName}` },
                      })
                      relationships.push({
                         source: "log",
                         target: className,
                         type: RelationshipType.Uses,
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
            name: methodName,
            kind: node.type === "constructor_declaration" ? SymbolKind.Constructor : SymbolKind.Method,
            range: this.getRange(node),
            metadata: { groovySpecific: true, isSpockTest: nameNode.type === "string_literal" },
          })
          
          // Map method to parent class
          if (activeScope && activeScope !== "global") {
            relationships.push({
               source: methodName,
               target: activeScope,
               type: RelationshipType.Uses, // belongs to
               metadata: { belongsToClass: true }
            })
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
            kind: node.type === "field_declaration" || node.type === "def_declaration" ? SymbolKind.Property : SymbolKind.Variable,
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
                kind: SymbolKind.Method,
                range: this.getRange(node),
                metadata: { groovySpecific: true, synthetic: true, bridgeFrom: fieldName },
             })
             symbols.push({
                name: setterName,
                kind: SymbolKind.Method,
                range: this.getRange(node),
                metadata: { groovySpecific: true, synthetic: true, bridgeFrom: fieldName },
             })

             if (activeScope && activeScope !== "global") {
                 relationships.push({ source: getterName, target: activeScope, type: RelationshipType.Uses, metadata: { synthetic: true } })
                 relationships.push({ source: setterName, target: activeScope, type: RelationshipType.Uses, metadata: { synthetic: true } })
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
              type: RelationshipType.Calls,
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
                 kind: SymbolKind.Variable,
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
                    type: RelationshipType.Uses,
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
              type: RelationshipType.Calls,
              metadata: {}
            })
            // Groovy uses new ClassName() — detect instantiation
            if (nameNode.text[0] === nameNode.text[0].toUpperCase() && nameNode.text[0] !== nameNode.text[0].toLowerCase()) {
              relationships.push({
                source: activeScope,
                target: nameNode.text,
                type: RelationshipType.Instantiates,
                confidence: 0.8,
                metadata: { isInstantiation: true },
              })
            }
        }
      }
      // 8. Constructor calls: new ClassName() → Instantiates
      else if (node.type === "constructor_declaration") {
        const typeNode = this.findChild(node, (n) => n.type === "type_identifier" || n.type === "identifier")
        if (typeNode) {
          relationships.push({
            source: activeScope || "global",
            target: typeNode.text,
            type: RelationshipType.Instantiates,
            confidence: 0.95,
            metadata: { isConstructor: true },
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
                 type: RelationshipType.Calls,
                 metadata: { synthetic: true, bridgeFrom: pText }
             })
             relationships.push({
                 source: activeScope,
                 target: `set${capitalized}`,
                 type: RelationshipType.Calls,
                 metadata: { synthetic: true, bridgeFrom: pText }
             })
         }
      }
      // 8. Annotations (`@CompileStatic`, `@SpringBootApplication`, etc)
      else if (node.type === "annotation") {
         const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "scoped_identifier")
         if (nameNode) {
             symbols.push({
                 name: `@${nameNode.text}`,
                 kind: SymbolKind.Property,
                 range: this.getRange(node),
                 metadata: { groovySpecific: true, isAnnotation: true }
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
    const uniqueSymbolsMap = new Map<string, UniversalSymbol>()
    for (let i = 0; i < symbols.length; i++) {
        uniqueSymbolsMap.set(`${symbols[i].kind}:${symbols[i].name}:${symbols[i].range.startLine}:${symbols[i].range.startColumn}`, symbols[i])
    }
    const uniqueSymbols = Array.from(uniqueSymbolsMap.values())

    const uniqueRelMap = new Map<string, UniversalRelationship>()
    for (let i = 0; i < relationships.length; i++) {
        uniqueRelMap.set(`${relationships[i].source}->${relationships[i].target}`, relationships[i])
    }
    const uniqueRelationships = Array.from(uniqueRelMap.values())

    for (var _gi = 0; _gi < uniqueSymbols.length; _gi++) { var gs = uniqueSymbols[_gi]; if (!gs.metadata?.synthetic && gs.visibility !== "private") { exports.push({ name: gs.name, kind: gs.kind, range: gs.range, visibility: "public" }); } }
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
