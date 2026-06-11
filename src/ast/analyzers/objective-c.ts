// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

export class RealObjectiveCAnalyzer implements LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ParseResult {
    const symbols: UniversalSymbol[] = []
    const relationships: UniversalRelationship[] = []
    const imports: ImportInfo[] = []

    const objcMatches = content.matchAll(/#(?:import|include)\s+[<"]([^>"]+)[>"]/g)
    for (const m of objcMatches) {
      var modName = m[1].replace(/["<>]/g, ""); frameworks.add(modName.indexOf("UIKit") !== -1 ? "UIKit" : modName.indexOf("Foundation") !== -1 ? "Foundation" : modName.indexOf("AppKit") !== -1 ? "AppKit" : modName.indexOf("Cocoa") !== -1 ? "Cocoa" : ""); imports.push({ module: modName, items: [], importType: "include", lineNumber: 0, isExternal: m[0].includes("<") || !m[1].startsWith(".") })
    }

    const exports: ExportInfo[] = []; const frameworks: string[] = []
    const errors: ParseError[] = []

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
      
      // 1. Classes & Implementations
      if (node.type === "class_interface" || node.type === "class_implementation") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "type_identifier")
        if (nameNode) {
          nextActiveScope = nameNode.text
          // Extract superclass (after nameNode, look for type_identifier)
          let foundName = false
          let superName: string | null = null
          let protocols: string[] = []
          for (let ci = 0; ci < node.namedChildCount; ci++) {
            const cn = node.namedChild(ci)
            if (!cn) continue
            if (cn.type === "identifier" && !foundName) { foundName = true; continue }
            if ((cn.type === "type_identifier" || cn.type === "superclass_reference") && !superName) { superName = cn.text }
            if (cn.type === "protocol_qualifiers" || cn.type === "protocol_list") {
              for (let pj = 0; pj < cn.namedChildCount; pj++) {
                const pn = cn.namedChild(pj)
                if (pn && (pn.type === "type_identifier" || pn.type === "identifier")) protocols.push(pn.text)
              }
            }
          }
          if (superName) { relationships.push({ source: nameNode.text, target: superName, type: RelationshipType.Extends, metadata: { objcSpecific: true } }) }
          for (let pk = 0; pk < protocols.length; pk++) { relationships.push({ source: nameNode.text, target: protocols[pk], type: RelationshipType.Implements, metadata: { objcSpecific: true, isProtocol: true } }) }
          symbols.push({
            name: nameNode.text,
            kind: SymbolKind.Class,
            range: this.getRange(node),
            metadata: { objcSpecific: true, type: node.type, superClass: superName, protocols },
          })
        }
      } 
      // 2. Categories (e.g., @interface MyClass (MyCategory))
      else if (node.type === "category_interface" || node.type === "category_implementation") {
        const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "type_identifier")
        if (nameNode) {
          nextActiveScope = nameNode.text
          symbols.push({
            name: nameNode.text,
            kind: SymbolKind.Namespace, // Representing category extension
            range: this.getRange(node),
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
            kind: SymbolKind.Interface,
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
            kind: SymbolKind.Method,
            range: this.getRange(node),
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
            kind: SymbolKind.Function,
            range: this.getRange(node),
            metadata: { objcSpecific: true },
          })
        }
      }
      // 6. Properties (@property)
      else if (node.type === "property_declaration") {
         const nameNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "property_identifier")
         if (nameNode) {
           symbols.push({
             name: nameNode.text,
             kind: SymbolKind.Property,
             range: this.getRange(node),
             metadata: { objcSpecific: true },
           })
         }
      }
      // 7. Variables (C-style declarations)
      else if (node.type === "block_literal" || node.type === "block_expression") {
         symbols.push({
           name: "block_" + node.startPosition.row + "_" + node.startPosition.column,
           kind: SymbolKind.Function,
           range: this.getRange(node),
           metadata: { objcSpecific: true, isBlock: true },
         })
      } else if (node.type === "declaration") {
         const declarator = this.findChild(node, (n) => n.type === "init_declarator" || n.type === "identifier")
         const nameNode = declarator ? (declarator.type === "init_declarator" ? this.findChild(declarator, (n) => n.type === "identifier") : declarator) : null
         if (nameNode) {
           symbols.push({
             name: nameNode.text,
             kind: SymbolKind.Variable,
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
              type: RelationshipType.Calls,
              metadata: { isMessageExpression: true }
            })
            // Detect [[Foo alloc] init] as Instantiates
            if (selectorNode.text === "alloc" || selectorNode.text === "new") { 
              var receiverNode = this.findChild(node, (n) => n.type === "identifier" || n.type === "type_identifier");
              if (receiverNode) {
                relationships.push({ source: activeScope, target: receiverNode.text, type: RelationshipType.Instantiates, confidence: 0.9, metadata: { isObjCAlloc: true } });
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
              type: RelationshipType.Calls,
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

    // Law 3: O(1) MAP deduplications
    const uniqueSymbolsMap = new Map<string, UniversalSymbol>()
    for (let i = 0; i < symbols.length; i++) {
        // Allow overloading map to include kind
        uniqueSymbolsMap.set(`${symbols[i].kind}:${symbols[i].name}`, symbols[i])
    }
    const uniqueSymbols = Array.from(uniqueSymbolsMap.values())

    const uniqueRelMap = new Map<string, UniversalRelationship>()
    for (let i = 0; i < relationships.length; i++) {
        uniqueRelMap.set(`${relationships[i].source}->${relationships[i].target}`, relationships[i])
    }
    const uniqueRelationships = Array.from(uniqueRelMap.values())

    for (var _oi = 0; _oi < uniqueSymbols.length; _oi++) { var os = uniqueSymbols[_oi]; exports.push({ name: os.name, kind: os.kind, range: os.range, visibility: "public" }); }
    return {
      language: "objective-c",
      symbols: uniqueSymbols,
      relationships: uniqueRelationships,
      imports,
      exports,
      errors,
      metadata: { complexity: uniqueSymbols.length, linesOfCode: content.split("\n").length, detectedFrameworks: frameworks.filter(Boolean), framework: frameworks.filter(Boolean)[0] },
    }
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
