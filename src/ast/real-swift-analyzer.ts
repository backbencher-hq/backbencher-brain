import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

export class RealSwiftAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const patternsObj: Record<string, boolean> = {}
    const frameworksObj: Record<string, boolean> = {}

    const metadata: Partial<ASTEngine.FileMetadata> = {
      linesOfCode: 0,
      performanceScore: 100,
      architecturalInsights: [],
      detectedFrameworks: [],
      patterns: [],
    }

    if (!rootNode) return { symbols, imports, relationships, exports, metadata, errors: [] }

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          ;(metadata as any).errors = (metadata as any).errors || []
          ;(metadata as any).errors.push({
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

    let loc = 1
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") loc++
    }
    metadata.linesOfCode = loc

    const stack: { node: Node; parentSymbol: ASTEngine.UniversalSymbol | null }[] = [
      { node: rootNode, parentSymbol: null },
    ]

    while (stack.length > 0) {
      const popped = stack.pop()
      if (!popped) continue

      const { node: curr, parentSymbol } = popped
      let newParentSymbol = parentSymbol

      if (curr.type === "import_declaration") {
        this.handleImport(curr, imports, frameworksObj)
      } else if (
        curr.type === "class_declaration" ||
        curr.type === "struct_declaration" ||
        curr.type === "protocol_declaration" ||
        curr.type === "extension_declaration" ||
        curr.type === "actor_declaration" ||
        curr.type === "enum_declaration"
      ) {
        newParentSymbol = this.handleDeclaration(curr, symbols, relationships, parentSymbol, patternsObj)
      } else if (
        curr.type === "function_declaration" ||
        curr.type === "protocol_function_declaration" ||
        curr.type === "init_declaration" ||
        curr.type === "deinit_declaration" ||
        curr.type === "subscript_declaration"
      ) {
        newParentSymbol = this.handleFunction(curr, symbols, relationships, parentSymbol)
      } else if (
        curr.type === "variable_declaration" ||
        curr.type === "protocol_property_declaration" ||
        curr.type === "constant_declaration" ||
        curr.type === "property_declaration"
      ) {
        this.handleVariable(curr, symbols, parentSymbol, frameworksObj, patternsObj)
      } else if (
        curr.type === "simple_type_identifier" ||
        curr.type === "user_type" ||
        curr.type === "type_identifier"
      ) {
        this.handleTypeReference(curr, relationships, parentSymbol)
      } else if (curr.type === "call_expression") {
        this.handleCall(curr, relationships, parentSymbol)
      } else if (curr.type === "closure_expression") {
        patternsObj["Closures"] = true
        const closureName = `closure_${curr.startPosition.row + 1}_${curr.startPosition.column + 1}`
        this.createSymbol(closureName, ASTEngine.SymbolKind.Function, curr, parentSymbol, symbols, { isClosure: true })
      } else if (curr.type === "enum_entry" || curr.type === "case_statement") {
        const caseName = curr.namedChild ? curr.namedChild(0)?.text : curr.text
        if (caseName && caseName !== "case") {
          this.createSymbol(caseName, ASTEngine.SymbolKind.EnumMember, curr, parentSymbol, symbols, { enumCase: true })
        }
      } else if (curr.type === "typealias_declaration" || curr.type === "typealias_statement") {
        for (let i = 0; i < curr.namedChildCount; i++) {
          const c = curr.namedChild(i)
          if (c && (c.type === "simple_identifier" || c.type === "identifier")) {
            this.createSymbol(c.text, ASTEngine.SymbolKind.Type, curr, parentSymbol, symbols, { isTypeAlias: true })
            break
          }
        }
      } else if (curr.type === "associated_type_clause" || curr.type === "associatedtype_declaration") {
        for (let i = 0; i < curr.namedChildCount; i++) {
          const c = curr.namedChild(i)
          if (c && (c.type === "simple_identifier" || c.type === "identifier")) {
            this.createSymbol(c.text, ASTEngine.SymbolKind.Type, curr, parentSymbol, symbols, { isAssociatedType: true })
            break
          }
        }
      } else if (curr.type === "where_clause") {
        patternsObj["Generics with Where Clauses"] = true
      } else if (curr.type === "willSet_specifier" || curr.type === "didSet_specifier" || curr.type === "willSet_didSet_block") {
        patternsObj["Property Observers (willSet/didSet)"] = true
      } else if (curr.type === "defer_statement") {
        patternsObj["Defer (Cleanup)"] = true
      } else if (curr.type === "do_statement") {
        patternsObj["Do-Catch Blocks"] = true
      } else if (curr.type === "getter_specifier" || curr.type === "setter_specifier") {
        patternsObj["Computed Properties"] = true
      } else if (curr.type === "availability_condition" || curr.type === "platform_condition") {
        patternsObj["Platform Availability Checks"] = true
      } else if (curr.type === "macro_expansion" || curr.type === "macro_declaration") {
        patternsObj["Swift Macros"] = true
      }

      if (
        curr.type === "try_operator" ||
        curr.type === "try_statement" ||
        curr.type === "catch_clause" ||
        curr.type === "throw_statement"
      ) {
        patternsObj["Error Handling"] = true
      }
      if (curr.type === "await_operator" || curr.type === "async_keyword" || curr.type === "async") {
        patternsObj["Async/Await"] = true
      }
      if (
        curr.type === "optional_type" ||
        curr.type === "optional_chaining_expression" ||
        curr.type === "implicitly_unwrapped_optional_type" ||
        curr.type === "if_let_statement" ||
        curr.type === "guard_statement"
      ) {
        patternsObj["Optional Handling"] = true
      }
      if (curr.type === "type_parameter_clause" || curr.type === "type_parameters") {
        patternsObj["Generics"] = true
      }
      if (curr.type === "if_statement" || curr.type === "for_statement" || curr.type === "while_statement" || curr.type === "repeat_while_statement" || curr.type === "switch_statement") {
        if (!metadata.cyclomaticComplexity) metadata.cyclomaticComplexity = 1
        metadata.cyclomaticComplexity++
      }
      if (curr.type === "modifiers") {
        for (let i = 0; i < curr.namedChildCount; i++) {
          const mod = curr.namedChild(i)
          if (!mod) continue
          if (mod.type === "weak_keyword" || mod.type === "unowned_keyword")
            patternsObj["ARC Memory Management"] = true
          if (mod.type === "lazy_keyword" || mod.text === "lazy")
            patternsObj["Lazy Initialization"] = true
          if (mod.type === "final_keyword" || mod.text === "final")
            patternsObj["Final/Sealed"] = true
        }
      }

      for (let i = curr.childCount - 1; i >= 0; i--) {
        const child = curr.child(i)
        if (child) stack.push({ node: child, parentSymbol: newParentSymbol })
      }
    }

    for (const p in patternsObj) {
      metadata.patterns!.push(p)
    }
    for (const f in frameworksObj) {
      metadata.detectedFrameworks!.push(f)
    }

    // Post-loop: add contains (parent→child) and references (import deps)
    for (const s of symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        relationships.push({
          type: ASTEngine.RelationshipType.Contains,
          source: _owner,
          target: s.name,
          isExternal: false,
          weight: 1,
          metadata: {},
        })
      }
    }
    for (const imp of imports) {
      if (imp.module) {
        relationships.push({
          type: ASTEngine.RelationshipType.References,
          source: "root",
          target: imp.module,
          isExternal: true,
          weight: 0.9,
          metadata: { importModule: imp.module },
        })
      }
    }

    return {
      symbols,
      relationships,
      imports,
      exports,
      metadata,
      errors: (metadata as any).errors || [],
    }
  }

  private createSymbol(
    name: string,
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    symbols: ASTEngine.UniversalSymbol[],
    meta: Record<string, any> = {},
    visibility: string = "internal",
  ): ASTEngine.UniversalSymbol {
    const symbol: ASTEngine.UniversalSymbol = {
      id: parent ? `${parent.id}.${name}` : name,
      name,
      kind,
      range: {
        startLine: node.startPosition.row + 1,
        startColumn: node.startPosition.column,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
      },
      parentId: parent ? parent.id : undefined,
      ownerName: parent ? parent.name : undefined,
      parent: parent ? parent.name : undefined,
      metadata: meta,
      visibility,
    }
    
    if (meta.isAsync) symbol.isAsync = true
    if (meta.throws) symbol.throws = "true"
    if (meta.annotations) symbol.annotations = JSON.stringify(meta.annotations)
    
    symbols.push(symbol)
    return symbol
  }

  private getVisibility(node: Node): string {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "modifiers") {
        for (let j = 0; j < child.namedChildCount; j++) {
          const mod = child.namedChild(j)
          if (mod) {
            if (mod.type === "public_keyword" || mod.text === "public") return "public"
            if (mod.type === "private_keyword" || mod.text === "private") return "private"
            if (mod.type === "fileprivate_keyword" || mod.text === "fileprivate") return "fileprivate"
            if (mod.type === "internal_keyword" || mod.text === "internal") return "internal"
            if (mod.type === "open_keyword" || mod.text === "open") return "open"
            if (mod.text === "package") return "package"
          }
        }
      }
    }
    return "internal"
  }

  private extractAttributes(node: Node): string[] {
    const attrs: string[] = []
    const queue: Node[] = [node]
    while (queue.length > 0) {
      const c = queue.pop()!
      if (c.type === "attribute" || c.type === "modifiers") {
        const text = c.text.trim()
        if (text.startsWith("@")) attrs.push(text)
      }
      for (let i = c.childCount - 1; i >= 0; i--) {
        if (c.child(i)) queue.push(c.child(i)!)
      }
    }
    return attrs
  }

  private handleImport(node: Node, imports: ASTEngine.ImportInfo[], frameworksObj: Record<string, boolean>) {
    let moduleName = ""
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (
        c &&
        (c.type === "simple_identifier" ||
          c.type === "type_identifier" ||
          c.type === "module_identifier" ||
          c.type === "identifier")
      ) {
        moduleName = c.text
        break
      }
    }
    if (moduleName) {
      imports.push({
        module: moduleName,
        isExternal: true,
        range: {
          startLine: node.startPosition.row + 1,
          startColumn: node.startPosition.column,
          endLine: node.endPosition.row + 1,
          endColumn: node.endPosition.column,
          startIndex: node.startIndex,
          endIndex: node.endIndex,
        },
      })
      if (moduleName === "SwiftUI") frameworksObj["SwiftUI"] = true
      if (moduleName === "Combine") frameworksObj["Combine"] = true
      if (moduleName === "UIKit") frameworksObj["UIKit"] = true
      if (moduleName === "Foundation") frameworksObj["Foundation"] = true
    }
  }

  private handleDeclaration(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
    patternsObj: Record<string, boolean>
  ): ASTEngine.UniversalSymbol | null {
    let typeIdentifierNode: Node | null = null
    let kind = ASTEngine.SymbolKind.Class
    let isValueType = false
    let isExtension = false

    if (node.type === "protocol_declaration") {
       kind = ASTEngine.SymbolKind.Interface
       patternsObj["Protocol-Oriented Programming"] = true
       for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && (c.type === "type_identifier" || c.type === "simple_identifier" || c.type === "identifier")) {
             typeIdentifierNode = c
             break
          }
       }
} else if (node.type === "class_declaration" || node.type === "actor_declaration") {
        if (node.type === "actor_declaration") {
            kind = ASTEngine.SymbolKind.Actor
        }
       for (let i = 0; i < node.childCount; i++) {
          const c = node.child(i)
          if (c && c.type === "struct") {
             kind = ASTEngine.SymbolKind.Struct
             isValueType = true
          } else if (c && c.type === "enum") {
             kind = ASTEngine.SymbolKind.Enum
             isValueType = true
          } else if (c && c.type === "extension") {
             kind = ASTEngine.SymbolKind.Namespace
             isExtension = true
          } else if (c && (c.type === "type_identifier" || c.type === "user_type" || c.type === "simple_identifier" || c.type === "identifier")) {
             if (!typeIdentifierNode) typeIdentifierNode = c
          }
       }
    }

    if (!typeIdentifierNode) return parent
    
    let hasGenerics = false
    for (let i = 0; i < node.childCount; i++) {
       const c = node.child(i)
       if (c && (c.type === "type_parameter_clause" || c.type === "type_parameters")) {
          hasGenerics = true
          patternsObj["Generics"] = true
       }
    }

    const meta: Record<string, any> = { hasGenerics }
    if (isValueType) meta.isValueType = true
    if (kind === ASTEngine.SymbolKind.Interface) meta.isProtocol = true

    let rawType = ""
    for (let i = 0; i < node.childCount; i++) {
       const c = node.child(i)
       if (c && c.type === "inheritance_specifier") {
          for (let j = 0; j < c.childCount; j++) {
             const nested = c.child(j)
             if (nested && (nested.type === "user_type" || nested.type === "type_identifier" || nested.type === "identifier")) {
                 rawType = nested.text
             }
          }
       }
    }
    if (kind === ASTEngine.SymbolKind.Enum && rawType) {
        meta.rawType = rawType
    }

    const vis = this.getVisibility(node)
    const symbol = this.createSymbol(typeIdentifierNode.text, kind, typeIdentifierNode, parent, symbols, meta, vis)

    if (isExtension) {
        symbol.ownerName = typeIdentifierNode.text
    }

    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "type_inheritance_clause" || c.type === "inheritance_specifier" || c.type === "protocol_inheritance_clause")) {
        this.extractInheritance(c, relationships, symbol, symbols)
      }
    }

    return symbol
  }

  private extractInheritance(
    inheritanceClause: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbol: ASTEngine.UniversalSymbol,
    symbols: ASTEngine.UniversalSymbol[],
  ) {
    symbol.metadata = symbol.metadata || {}
    symbol.metadata.inheritance = symbol.metadata.inheritance || []

    // Build a set of known protocol names for accurate extends vs implements
    const protocolNames = new Set<string>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Interface || s.metadata?.isProtocol) {
        protocolNames.add(s.name)
      }
    }

    for (let i = 0; i < inheritanceClause.childCount; i++) {
      const child = inheritanceClause.child(i)
      if (
        child &&
        (child.type === "type_identifier" ||
          child.type === "simple_type_identifier" ||
          child.type === "user_type" ||
          child.type === "identifier" ||
          child.type === "inherited_type")
      ) {
        let name = child.text
        for (let k = 0; k < child.childCount; k++) {
          const nested = child.child(k)
          if (
            nested &&
            (nested.type === "type_identifier" ||
              nested.type === "simple_type_identifier" ||
              nested.type === "user_type" ||
              nested.type === "identifier")
          ) {
            name = nested.text
          }
        }

        symbol.metadata.inheritance.push(name)
        // Determine extends vs implements by checking if target is a known protocol
        const isProtocol = protocolNames.has(name)
        const relType = isProtocol
          ? ASTEngine.RelationshipType.Implements
          : (symbol.kind === ASTEngine.SymbolKind.Class || symbol.kind === ASTEngine.SymbolKind.Actor) && i === 0
            ? ASTEngine.RelationshipType.Extends
            : ASTEngine.RelationshipType.Implements
        relationships.push({
          type: relType,
          source: symbol.name,
          target: name,
          isExternal: true,
          weight: 1,
          metadata: {},
        })
      }
    }
  }

  private handleFunction(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    let nameNode: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "simple_identifier" || c.type === "identifier" || c.type === "init" || c.type === "deinit" || c.type === "subscript")) {
        nameNode = c
        break
      }
    }
    if (!nameNode && node.type === "protocol_function_declaration") {
      for (let i = 0; i < node.childCount; i++) {
         const c = node.child(i)
         if (c && (c.type === "simple_identifier" || c.type === "identifier")) {
             nameNode = c
             break
         }
      }
    }

    if (!nameNode) return parent

    let kind = ASTEngine.SymbolKind.Function
    if (node.type === "init_declaration") kind = ASTEngine.SymbolKind.Constructor
    else if (
      parent &&
      (parent.kind === ASTEngine.SymbolKind.Class ||
        parent.kind === ASTEngine.SymbolKind.Interface ||
        parent.kind === ASTEngine.SymbolKind.Namespace)
    ) {
      kind = ASTEngine.SymbolKind.Method
    }

    const vis = this.getVisibility(node)
    
    let hasGenerics = false
    for (let i = 0; i < node.childCount; i++) {
       const c = node.child(i)
       if (c && (c.type === "type_parameter_clause" || c.type === "type_parameters")) {
          hasGenerics = true
       }
    }
    
    const meta: Record<string, any> = {}
    if (hasGenerics) meta.hasGenerics = true
    
    const funcAttrs = this.extractAttributes(node)
    if (funcAttrs.length > 0) meta.annotations = funcAttrs

    let isAsync = false
    let throws = false
    const nodeQueue: Node[] = [node]
    while (nodeQueue.length > 0) {
      const c = nodeQueue.pop()!
      if (c.type === "async_keyword" || c.text === "async" || c.type === "async") {
        isAsync = true
      }
      if (c.type === "throws_keyword" || c.text === "throws" || c.type === "throw_expression" || c.type === "throws") {
        throws = true
      }
      for (let i = c.childCount - 1; i >= 0; i--) {
        if (c.child(i)) nodeQueue.push(c.child(i)!)
      }
    }
    if (isAsync) meta.isAsync = true
    if (throws) meta.throws = true

    const symbol = this.createSymbol(nameNode.text, kind, nameNode, parent, symbols, meta, vis)

    // Check for override keyword → Overrides relationship
    let isOverride = false
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.type === "modifiers") {
        for (let j = 0; j < c.childCount; j++) {
          const mod = c.child(j)
          if (mod && (mod.text === "override" || mod.type === "override_keyword")) {
            isOverride = true
            break
          }
        }
      }
      if (isOverride) break
    }
    if (isOverride && parent) {
      relationships.push({
        type: ASTEngine.RelationshipType.Overrides,
        source: symbol.name,
        target: symbol.name, // The overridden method has the same name
        isExternal: true,
        weight: 0.8,
        metadata: { overriddenIn: parent.name },
      })
    }

    let foundArrow = false
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "parameter_clause" || c.type === "parameters")) {
        const queue: Node[] = [c]
        while (queue.length > 0) {
          const curr = queue.pop()!
          if (curr.type === "parameter") {
            let paramIdentifier: Node | null = null
            for (let k = 0; k < curr.childCount; k++) {
              const pc = curr.child(k)
              if (pc && (pc.type === "simple_identifier" || pc.type === "identifier")) {
                if (!paramIdentifier) paramIdentifier = pc
              }
            }
            if (paramIdentifier) {
              this.createSymbol(paramIdentifier.text, ASTEngine.SymbolKind.Variable, paramIdentifier, symbol, symbols, {
                parameter: true,
              })
            }
          }
          for (let j = curr.childCount - 1; j >= 0; j--) {
            const child = curr.child(j)
            if (child) queue.push(child)
          }
        }
      } else if (c && c.type === "->") {
         foundArrow = true
      } else if (foundArrow && c && (c.type === "type_identifier" || c.type === "user_type" || c.type === "simple_type_identifier" || c.type === "identifier")) {
         symbol.returnType = c.text
         foundArrow = false
      }
    }

    return symbol
  }

  private handleVariable(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    parent: ASTEngine.UniversalSymbol | null,
    frameworksObj: Record<string, boolean>,
    patternsObj: Record<string, boolean>
  ) {
    const vis = this.getVisibility(node)
    const annotations: string[] = []
    for (let i = 0; i < node.childCount; i++) {
       const c = node.child(i)
       if (c && c.type === "modifiers") {
          for (let j = 0; j < c.childCount; j++) {
             const mod = c.child(j)
             if (mod && mod.type === "attribute") {
                const text = mod.text
                annotations.push(text)
                if (text.indexOf("@State") !== -1 || text.indexOf("@Binding") !== -1 || text.indexOf("@Environment") !== -1 || text.indexOf("@ObservedObject") !== -1) {
                   frameworksObj["SwiftUI"] = true
                   patternsObj["Property Wrappers"] = true
                }
                if (text.indexOf("@Published") !== -1) {
                   frameworksObj["Combine"] = true
                   patternsObj["Property Wrappers"] = true
                }
                if (text.indexOf("@MainActor") !== -1 || text.indexOf("@Sendable") !== -1 || text.indexOf("@globalActor") !== -1) {
                   patternsObj["Swift Concurrency"] = true
                }
                if (text.startsWith("@")) patternsObj["Property Wrappers"] = true
             }
          }
       }
       if (c && c.type === "attribute") {
           const text = c.text
           annotations.push(text)
            if (text.indexOf("@State") !== -1 || text.indexOf("@Binding") !== -1 || text.indexOf("@Environment") !== -1 || text.indexOf("@ObservedObject") !== -1) {
               frameworksObj["SwiftUI"] = true
               patternsObj["Property Wrappers"] = true
            }
            if (text.indexOf("@Published") !== -1) {
               frameworksObj["Combine"] = true
               patternsObj["Property Wrappers"] = true
            }
            if (text.indexOf("@MainActor") !== -1 || text.indexOf("@Sendable") !== -1 || text.indexOf("@globalActor") !== -1) {
               patternsObj["Swift Concurrency"] = true
            }
            if (text.startsWith("@")) patternsObj["Property Wrappers"] = true
       }
    }

    const meta: Record<string, any> = {}
    if (annotations.length > 0) meta.annotations = annotations

    let patternClause: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
       const c = node.child(i)
       if (c && (c.type === "pattern_initializer" || c.type === "pattern")) {
          patternClause = c
          break
       }
    }

    if (patternClause) {
        let identifierNode: Node | null = null
        for (let i = 0; i < patternClause.childCount; i++) {
           const c = patternClause.child(i)
           if (c && (c.type === "simple_identifier" || c.type === "identifier" || c.type === "pattern")) {
              identifierNode = c
              break
           }
        }
        if (!identifierNode) identifierNode = patternClause
        if (identifierNode) {
            this.createSymbol(identifierNode.text, ASTEngine.SymbolKind.Variable, identifierNode, parent, symbols, meta, vis)
        }
    } else {
        for (let i = 0; i < node.childCount; i++) {
           const c = node.child(i)
           if (c && (c.type === "simple_identifier" || c.type === "identifier")) {
              this.createSymbol(c.text, ASTEngine.SymbolKind.Variable, c, parent, symbols, meta, vis)
              break
           }
        }
    }
  }

  private handleTypeReference(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
  ) {
    if (!parent) return
    relationships.push({
      type: ASTEngine.RelationshipType.Uses,
      source: parent.name,
      target: node.text,
      isExternal: true,
      weight: 1,
      metadata: { referenceType: "type" },
    })
  }

  private handleCall(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    parent: ASTEngine.UniversalSymbol | null,
  ) {
    if (!parent) return
    let functionNameNode: Node | null = null
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && (c.type === "simple_identifier" || c.type === "identifier" || c.type === "function" || c.type === "member_expression" || c.type === "navigation_expression")) {
        functionNameNode = c
        break
      }
    }
    if (functionNameNode) {
      const targetName = functionNameNode.text
      relationships.push({
        type: ASTEngine.RelationshipType.Calls,
        source: parent.name,
        target: targetName,
        isExternal: true,
        weight: 1,
        metadata: {},
      })
      // Swift class instantiation: ClassName() or ClassName.init()
      if (targetName && targetName[0] === targetName[0].toUpperCase() && targetName[0] !== targetName[0].toLowerCase()) {
        relationships.push({
          type: ASTEngine.RelationshipType.Instantiates,
          source: parent.name,
          target: targetName,
          isExternal: true,
          weight: 0.7,
          metadata: { isInstantiation: true },
        })
      }
    }
  }
}