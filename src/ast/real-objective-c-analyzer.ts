import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealObjectiveCAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []

    const exports: ASTEngine.ExportInfo[] = []; const frameworks = new Set<string>()
    const errors: ASTEngine.ParseError[] = []

    // Extract imports — use AST-based approach where possible, regex for #import pragmas
    const objcMatches = content.matchAll(/#(?:import|include)\s+[<"]([^>"]+)[>"]/g)
    for (const m of objcMatches) {
      const modName = m[1].replace(/["<>]/g, "")
      if (modName.includes("UIKit")) frameworks.add("UIKit")
      if (modName.includes("Foundation")) frameworks.add("Foundation")
      if (modName.includes("AppKit")) frameworks.add("AppKit")
      if (modName.includes("Cocoa")) frameworks.add("Cocoa")
      imports.push({
        module: modName, items: [], importType: "include",
        lineNumber: 0, isExternal: m[0].includes("<") || !modName.startsWith(".")
      })
      relationships.push({
        source: "root",
        target: modName,
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
        metadata: { isObjCImport: true },
      })
    }

    // Law 3 & 4: Explicit Iterative Stack (O(N) single-pass) and ZERO mutable class props
    const walkStack: Array<{ node: Node; isExit: boolean; activeScope: string }> = [
      { node: rootNode, isExit: false, activeScope: "global" }
    ]

    while (walkStack.length > 0) {
      const state = walkStack.pop()!
      if (!state) continue
      
      const { node, isExit, activeScope } = state
      if (isExit || !node || node.isMissing) continue

      let nextActiveScope = activeScope

      // Law 1: Flawless Database Extraction (cover all major Obj-C constructs)
      
      // 1. Classes & Implementations. tree-sitter-objc parses BOTH plain classes
      // and categories as class_interface/class_implementation. A category is
      // distinguished by a SECOND identifier child (the category name) before
      // any method/property: `@interface MyClass (MyCategory)`. Detect it and
      // emit an Extension symbol instead of a duplicate Class.
      if (node.type === "class_interface" || node.type === "class_implementation") {
        const identNodes: string[] = []
        for (let ci = 0; ci < node.namedChildCount; ci++) {
          const cn = node.namedChild(ci)
          if (cn && cn.type === "identifier") identNodes.push(cn.text)
        }
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "type_identifier")
        if (nameNode) {
          nextActiveScope = nameNode.text
          // Category detection: a category is `@interface Name (CategoryName)`
          // which carries an anonymous `(` token. A plain class has `:` then a
          // superclass identifier — never a paren. This is exact, not heuristic.
          let hasParen = false
          for (let ci = 0; ci < node.childCount; ci++) {
            const c = node.child(ci)
            if (c && !c.isNamed && c.type === "(") { hasParen = true; break }
          }
          const isCategory = hasParen

          if (isCategory) {
            symbols.push({
              name: nameNode.text,
              kind: ASTEngine.SymbolKind.Extension,
              range: this.getRange(node),
              ownerName: activeScope !== "global" ? activeScope : undefined,
              metadata: { objcSpecific: true, isCategory: true, categoryName: identNodes[1] },
            })
          } else {
            // Plain class: extract superclass + protocols for relationships.
            let foundName = false
            let superName: string | null = null
            let protocols: string[] = []
            for (let ci = 0; ci < node.namedChildCount; ci++) {
              const cn = node.namedChild(ci)
              if (!cn) continue
              if (cn.type === "identifier" && !foundName) { foundName = true; continue }
              if ((cn.type === "type_identifier" || cn.type === "superclass_reference" || cn.type === "identifier") && !superName) { superName = cn.text }
              if (cn.type === "protocol_qualifiers" || cn.type === "protocol_list" || cn.type === "parameterized_arguments") {
                for (let pj = 0; pj < cn.namedChildCount; pj++) {
                  const pn = cn.namedChild(pj)
                  if (pn && (pn.type === "type_identifier" || pn.type === "identifier" || pn.type === "type_name")) protocols.push(pn.text)
                }
              }
            }
            if (superName) { relationships.push({ source: nameNode.text, target: superName, type: ASTEngine.RelationshipType.Extends, metadata: { objcSpecific: true } }) }
            for (let pk = 0; pk < protocols.length; pk++) { relationships.push({ source: nameNode.text, target: protocols[pk], type: ASTEngine.RelationshipType.Implements, metadata: { objcSpecific: true, isProtocol: true } }) }
            symbols.push({
              name: nameNode.text,
              kind: ASTEngine.SymbolKind.Class,
              range: this.getRange(node),
              ownerName: activeScope !== "global" ? activeScope : undefined,
              metadata: { objcSpecific: true, type: node.type, superClass: superName, protocols },
            })
          }
        }
      } 
      // 2. Explicit category node types (some grammars emit these directly).
      else if (node.type === "category_interface" || node.type === "category_implementation") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "type_identifier")
        if (nameNode) {
          nextActiveScope = nameNode.text
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Extension,
            range: this.getRange(node),
            ownerName: activeScope !== "global" ? activeScope : undefined,
            metadata: { objcSpecific: true, isCategory: true },
          })
        }
      }
      // 3. Protocols (@protocol)
      else if (node.type === "protocol_declaration") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier")
        if (nameNode) {
          nextActiveScope = nameNode.text
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Interface,
            range: this.getRange(node),
            metadata: { objcSpecific: true, isProtocol: true },
          })
        }
      }
      // 4. Methods (@method)
      else if (node.type === "method_declaration" || node.type === "method_definition") {
        // Obj-C method selectors can be disjointed, but we grab the first logical identifier or selector 
        const nameNode = this.findChild(node, (n) => n.type === "selector" || n.type === "identifier")
        if (nameNode) {
          nextActiveScope = nameNode.text
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.getRange(node),
            ownerName: activeScope !== "global" ? activeScope : undefined,
            metadata: { objcSpecific: true, isClassMethod: node.text.startsWith("+"), isInstanceMethod: node.text.startsWith("-") },
          })
        }
      } 
      // 5. Standard C Functions
      else if (node.type === "function_definition") {
        const declarator = this.findChild(node, (n) => n.type === "function_declarator" || n.type === "identifier")
        const nameNode = declarator ? (declarator.type === "function_declarator" ? this.findChild(declarator, (n) => n.type === "identifier") : declarator) : null
        
        if (nameNode) {
          nextActiveScope = nameNode.text
          symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Function,
            range: this.getRange(node),
            metadata: { objcSpecific: true },
          })
        }
      }
      // 6. Properties (@property) — the name lives deep inside the trailing
      // struct_declaration (`NSString *prefix` → struct_declaration →
      // struct_declarator → pointer_declarator → identifier).
      else if (node.type === "property_declaration") {
        const nameNode = this.findDeclaredName(node)
        if (nameNode) {
          symbols.push({
            name: nameNode,
            kind: ASTEngine.SymbolKind.Property,
            range: this.getRange(node),
            ownerName: activeScope !== "global" ? activeScope : undefined,
            metadata: { objcSpecific: true },
          })
        }
      }
      // 6b. Instance variables (@implementation X { ... }) — declarations, not locals.
      else if (node.type === "instance_variable") {
        const nameNode = this.findDeclaredName(node)
        if (nameNode) {
          symbols.push({
            name: nameNode,
            kind: ASTEngine.SymbolKind.Property,
            range: this.getRange(node),
            ownerName: activeScope !== "global" ? activeScope : undefined,
            metadata: { objcSpecific: true, isInstanceVariable: true },
          })
        }
      }
      // 7. Variables (C-style declarations) — file-scope only; method-body
      // declarations are locals (execution artifacts) and blocks are generated.
      else if (node.type === "block_literal" || node.type === "block_expression") {
        // Anonymous blocks have generated names — skip as symbols.
      } else if (node.type === "declaration" && activeScope === "global") {
         const declarator = this.findChild(node, (n) => n.type === "init_declarator" || n.type === "identifier")
         const nameNode = declarator ? (declarator.type === "init_declarator" ? this.findChild(declarator, (n) => n.type === "identifier") : declarator) : null
         if (nameNode) {
           symbols.push({
             name: nameNode.text,
             kind: ASTEngine.SymbolKind.Variable,
             range: this.getRange(node),
             metadata: { objcSpecific: true },
           })
         }
      }
      // 8. Relationships (Obj-C Message Expressions `[receiver selector]` & C-Function Calls)
      else if (node.type === "message_expression") {
         const selectorNode = this.findChild(node, (n) => n.type === "selector" || n.type === "identifier")
         if (selectorNode && activeScope !== "global") {
            relationships.push({
              source: activeScope,
              target: selectorNode.text,
              type: ASTEngine.RelationshipType.Calls,
              metadata: { isMessageExpression: true }
            })
            // Detect [[Foo alloc] init] as Instantiates
            if (selectorNode.text === "alloc" || selectorNode.text === "new") { 
              const receiverNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "type_identifier");
              if (receiverNode) {
                relationships.push({ source: activeScope, target: receiverNode.text, type: ASTEngine.RelationshipType.Instantiates, confidence: 0.9, metadata: { isObjCAlloc: true } });
              }
            }
         }
      }
      else if (node.type === "call_expression") {
        const funcNode = this.findChild(node, (n) => n.type === "identifier")
        if (funcNode && activeScope !== "global") {
            relationships.push({
              source: activeScope,
              target: funcNode.text,
              type: ASTEngine.RelationshipType.Calls,
              metadata: { isCFunctionCall: true }
            })
        }
      }

      // Law 2: Absolute Zero array bridge. Bounds checked loops only.
      const childCount = node.namedChildCount
      for (let i = childCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
           walkStack.push({ node: child, isExit: false, activeScope: nextActiveScope })
        }
      }
    }

    // Law 3: O(1) MAP deduplications — include ownerName AND start line so a
    // class_interface and a same-named category (or two distinct declarations)
    // never collapse into one symbol.
    const uniqueSymbolsMap = new Map<string, ASTEngine.UniversalSymbol>()
    for (let i = 0; i < symbols.length; i++) {
        const s = symbols[i]
        uniqueSymbolsMap.set(`${s.kind}:${s.ownerName || ''}:${s.name}:${s.range?.startLine || 0}`, s)
    }
    const uniqueSymbols = Array.from(uniqueSymbolsMap.values())

    const uniqueRelMap = new Map<string, ASTEngine.UniversalRelationship>()
    for (let i = 0; i < relationships.length; i++) {
        uniqueRelMap.set(`${relationships[i].source}->${relationships[i].target}`, relationships[i])
    }
    const uniqueRelationships = Array.from(uniqueRelMap.values())

    // Add Contains relationships for owned symbols
    for (const s of uniqueSymbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        uniqueRelationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: { isContained: true },
        })
      }
    }
    for (let i = 0; i < uniqueSymbols.length; i++) { const s = uniqueSymbols[i]; exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: "public" }); }
    return {
      language: "objective-c",
      symbols: uniqueSymbols,
      relationships: uniqueRelationships,
      imports,
      exports,
      errors,
      metadata: { complexity: uniqueSymbols.length, linesOfCode: content.split("\n").length, detectedFrameworks: [...frameworks], framework: [...frameworks][0] },
    }
  }

  // Walk struct_declaration → struct_declarator → (pointer/reference) →
  // identifier to find the declared property/ivar name.
  private findDeclaredName(node: Node): string | null {
    const walkForIdentifier = (n: Node | null): Node | null => {
      if (!n) return null
      if (n.type === "identifier" || n.type === "property_identifier") return n
      for (let i = 0; i < n.namedChildCount; i++) {
        const found = walkForIdentifier(n.namedChild(i))
        if (found) return found
      }
      return null
    }
    const idNode = walkForIdentifier(node)
    if (!idNode) return null
    // Exclude type identifiers (NSString, NSObject, id, etc.) that appear
    // BEFORE the declarator — the declared name is the LAST identifier in a
    // struct_declaration subtree. Prefer identifiers that are NOT in the
    // type position (first child).
    const structDecl = this.findChild(node, (n) => n.type === "struct_declaration")
    if (structDecl) {
      const sd = this.findChild(structDecl, (n) => n.type === "struct_declarator")
      if (sd) {
        const deep = walkForIdentifier(sd)
        if (deep) return deep.text
      }
    }
    return idNode.text
  }

  // Pure cursor helper protecting V8 from GC Thrashing
  private findChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    const count = node.namedChildCount
    for (let i = 0; i < count; i++) {
        const child = node.namedChild(i)
        if (child && predicate(child)) return child
    }
    return null
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
