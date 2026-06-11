// @ts-nocheck — Ported from backbencher. Kept structurally identical for sync.
import type { Node } from "web-tree-sitter"
import { UniversalSymbol, SymbolKind, RelationshipType, ParseResult, ImportInfo, ExportInfo, ParseError, FileMetadata, UniversalRelationship, Parameter, LanguageAnalyzer } from "../types.js"

interface RustContext {
  tree: { rootNode: Node }
  content: string
  filePath: string
  symbols: UniversalSymbol[]
  imports: ImportInfo[]
  relationships: UniversalRelationship[]
  exports: ExportInfo[]
  metadata: Partial<FileMetadata>
}

export class RealRustAnalyzer implements LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ParseResult, "language" | "metadata"> & { metadata?: Partial<FileMetadata> } {
    const ctx: RustContext = {
      tree: { rootNode },
      content,
      filePath,
      symbols: [],
      imports: [],
      relationships: [],
      exports: [],
      metadata: {
        language: "rust",
        detectedFrameworks: [],
        frameworkPatterns: [],
      },
    }

    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          if (!ctx.metadata.errors) ctx.metadata.errors = []
          ctx.metadata.errors.push({
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

    const stack: { node: Node; parent: UniversalSymbol | null }[] = [{ node: rootNode, parent: null }]

    while (stack.length > 0) {
      const popped = stack.pop()
      if (!popped) continue

      const { node, parent } = popped
      let currentParent = parent

      if (node.type === "struct_item") {
        currentParent = this.handleStruct(node, ctx, parent) ?? parent
      } else if (node.type === "trait_item") {
        currentParent = this.handleTrait(node, ctx, parent) ?? parent
      } else if (node.type === "impl_item") {
        currentParent = this.handleImpl(node, ctx, parent) ?? parent
      } else if (node.type === "function_item" || node.type === "function_signature_item") {
        currentParent = this.handleFunction(node, ctx, parent) ?? parent
      } else if (node.type === "enum_item") {
        currentParent = this.handleEnum(node, ctx, parent) ?? parent
      } else if (node.type === "let_declaration" || node.type === "const_item" || node.type === "static_item") {
        this.handleVariable(node, ctx, parent)
      } else if (node.type === "use_declaration") {
        this.handleUseDeclaration(node, ctx)
      } else if (node.type === "macro_definition") {
        this.handleMacro(node, ctx, parent)
      } else if (node.type === "mod_item") {
        currentParent = this.handleMod(node, ctx, parent) ?? parent
      } else if (node.type === "attribute_item") {
        this.handleAttribute(node, ctx)
      } else if (node.type === "call_expression") {
        this.handleCallExpression(node, ctx, parent)
      } else if (node.type === "macro_invocation") {
        this.handleMacroInvocation(node, ctx, parent)
      } else if (node.type === "enum_variant") {
        const variantName = this.extractIdentifier(node, "name")
        if (variantName && parent && parent.kind === SymbolKind.Enum) {
          const sym = this.createSymbol(variantName, SymbolKind.EnumMember, node, parent)
          ctx.symbols.push(sym)
        }
      } else if (node.type === "type_item" || node.type === "type_alias_declaration") {
        const name = this.extractIdentifier(node, "name")
        if (name) {
          const sym = this.createSymbol(name, SymbolKind.Type, node, parent, { type: "type_alias" })
          ctx.symbols.push(sym)
        }
      } else if (node.type === "closure_expression") {
        const name = `closure_${node.startPosition.row + 1}_${node.startPosition.column + 1}`
        const sym = this.createSymbol(name, SymbolKind.Function, node, parent, { isClosure: true })
        ctx.symbols.push(sym)
      } else if (node.type === "extern_crate_declaration") {
        const name = this.extractIdentifier(node, "name")
        if (name) {
          ctx.imports.push({
            module: name,
            items: ["*"],
            range: {
              startLine: node.startPosition.row + 1, startColumn: node.startPosition.column + 1,
              endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1,
              startIndex: node.startIndex, endIndex: node.endIndex,
            },
            metadata: { rustSpecific: true, externalCrate: true },
          })
        }
      } else if (node.type === "unsafe_block") {
        if (!ctx.metadata.patterns) ctx.metadata.patterns = []
        if (ctx.metadata.patterns.indexOf("Unsafe Code") === -1) ctx.metadata.patterns.push("Unsafe Code")
      } else if (node.type === "await_expression") {
        const inner = node.namedChild(0)
        if (inner && (inner.type === "call_expression" || inner.type === "macro_invocation")) {
          const fnNode = inner.childForFieldName?.("function") || inner.childForFieldName?.("macro")
          if (fnNode) {
            ctx.relationships.push({
              source: parent?.name || "global",
              target: fnNode.text,
              type: RelationshipType.Calls,
              metadata: { rustSpecific: true, isAwait: true },
            })
          }
        }
      } else if (node.type === "match_expression" || node.type === "if_expression" || node.type === "while_expression" || node.type === "loop_expression" || node.type === "for_expression" || node.type === "if_let_expression" || node.type === "while_let_expression") {
        if (!ctx.metadata.cyclomaticComplexity) ctx.metadata.cyclomaticComplexity = 1
        ctx.metadata.cyclomaticComplexity++
      } else if (node.type === "try_expression") {
        if (!ctx.metadata.patterns) ctx.metadata.patterns = []
        if (ctx.metadata.patterns.indexOf("Error Propagation (?)") === -1) ctx.metadata.patterns.push("Error Propagation (?)")
      } else if (node.type === "where_clause") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && c.type === "where_predicate") {
            const left = c.namedChild(0)
            if (left) {
              ctx.relationships.push({
                source: parent?.name || "global",
                target: left.text,
                type: RelationshipType.References,
                metadata: { rustSpecific: true, whereBound: true },
              })
            }
          }
        }
      } else if (node.type === "lifetime") {
        if (!ctx.metadata.patterns) ctx.metadata.patterns = []
        if (ctx.metadata.patterns.indexOf("Explicit Lifetimes") === -1) ctx.metadata.patterns.push("Explicit Lifetimes")
      } else if (node.type === "scoped_type_identifier") {
        const name = node.childForFieldName("name") || node.namedChild(node.namedChildCount - 1)
        if (name) {
          const n = name.text
          if (["Send", "Sync", "Sized", "Unpin", "UnwindSafe", "RefUnwindSafe"].includes(n)) {
            if (!ctx.metadata.patterns) ctx.metadata.patterns = []
            if (ctx.metadata.patterns.indexOf("Auto Traits") === -1) ctx.metadata.patterns.push("Auto Traits")
          }
        }
      } else if (node.type === "use_as_clause" || node.type === "scoped_use_list") {
        // Re-exports: pub use foo as bar
        if (this.isPublic(node.parent || node) && node.parent?.type === "use_declaration") {
          if (!ctx.metadata.patterns) ctx.metadata.patterns = []
          if (ctx.metadata.patterns.indexOf("Re-exports") === -1) ctx.metadata.patterns.push("Re-exports")
        }
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) {
          stack.push({ node: child, parent: currentParent })
        }
      }
    }

    return {
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      metadata: ctx.metadata,
    }
  }

  private handleAttribute(node: Node, ctx: RustContext): void {
    const text = node.text
    if (text.startsWith("#[get") || text.startsWith("#[post") || text.startsWith("#[put") || text.startsWith("#[delete") || text.startsWith("#[head") || text.startsWith("#[patch")) {
      if (!ctx.metadata.detectedFrameworks?.includes("actix_web")) {
        ctx.metadata.detectedFrameworks = [...(ctx.metadata.detectedFrameworks || []), "actix_web"]
      }
      let existing: any = undefined
      if (ctx.metadata.frameworkPatterns) {
        for (let i = 0; i < ctx.metadata.frameworkPatterns.length; i++) {
          if (ctx.metadata.frameworkPatterns[i].framework === "Actix Web") {
            existing = ctx.metadata.frameworkPatterns[i]
            break
          }
        }
      }
      if (!existing) {
        ctx.metadata.frameworkPatterns = [
          ...(ctx.metadata.frameworkPatterns || []),
          { framework: "Actix Web", patterns: ["route_handlers"] },
        ]
      }

      let targetNode = node.parent
      if (targetNode?.type === "source_file" || targetNode?.type === "declaration_list") {
        targetNode = node.nextNamedSibling
      }
      if (targetNode && targetNode.type === "function_item") {
        const nameNode = targetNode.childForFieldName("name")
        if (nameNode) {
          const match = text.match(/\[(?:get|post|put|delete)\("([^"]+)"\)\]/)
          if (match && match[1]) {
            ctx.relationships.push({
              source: nameNode.text,
              target: match[1],
              type: RelationshipType.Exports,
              metadata: {},
            })
          }
        }
      }
    }

    if (text.includes("#[test]") || text.includes("#[cfg(test)") || text.includes("#[tokio::test")) {
      if (!ctx.metadata.patterns) ctx.metadata.patterns = []
      if (ctx.metadata.patterns.indexOf("Testing") === -1) ctx.metadata.patterns.push("Testing")
    }
    if (text.includes("derive")) {
      if (!ctx.metadata.patterns) ctx.metadata.patterns = []
      if (ctx.metadata.patterns.indexOf("Derive Macros") === -1) ctx.metadata.patterns.push("Derive Macros")
    }
    if (text.includes("must_use")) {
      if (!ctx.metadata.patterns) ctx.metadata.patterns = []
      if (ctx.metadata.patterns.indexOf("Must Use") === -1) ctx.metadata.patterns.push("Must Use")
    }
    if (text.includes("deprecated")) {
      if (!ctx.metadata.patterns) ctx.metadata.patterns = []
      if (ctx.metadata.patterns.indexOf("Deprecated API") === -1) ctx.metadata.patterns.push("Deprecated API")
    }
  }

  private extractIdentifier(node: Node, field: string): string | null {
    const child = node.childForFieldName(field)
    if (child) return child.text

    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && (c.type === "identifier" || c.type === "type_identifier" || c.type === "scoped_identifier")) {
        return c.text
      }
    }
    return null
  }

  private isPublic(node: Node): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "visibility_modifier") {
        return true
      }
    }
    return false
  }

  private createSymbol(
    name: string,
    kind: SymbolKind,
    node: Node,
    parent: UniversalSymbol | null,
    extraMetadata: any = {},
  ): UniversalSymbol {
    let ownerName = parent?.name
    let ownerKind = parent?.kind

    if (parent?.kind === SymbolKind.Class && parent.metadata?.type === "impl") {
      ownerName = parent.metadata?.target
    }
    // Trait symbols should expose themselves as Interface for ownerKind
    if (parent?.kind === SymbolKind.Trait) {
      ownerKind = SymbolKind.Interface
    }
    if (parent?.kind === SymbolKind.Interface) {
      ownerKind = SymbolKind.Interface
    }

    return {
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
      id: `${parent ? parent.id + "." : ""}${name}`,
      parent: parent ? parent.name : undefined,
      ownerName,
      ownerKind,
      metadata: { ...extraMetadata },
    }
  }

  private handleStruct(
    node: Node,
    ctx: RustContext,
    parent: UniversalSymbol | null,
  ): UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    // Use SymbolKind.Struct for Rust structs
    const symbol = this.createSymbol(name, SymbolKind.Struct, node, parent)
    if (this.isPublic(node)) symbol.visibility = "public"
    ctx.symbols.push(symbol)

    // Handle fields
    let fieldDeclarationList: Node | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "field_declaration_list") {
        fieldDeclarationList = child
        break
      }
    }
    if (fieldDeclarationList) {
      for (let i = 0; i < fieldDeclarationList.namedChildCount; i++) {
        const fieldNode = fieldDeclarationList.namedChild(i)
        if (fieldNode && fieldNode.type === "field_declaration") {
          const fieldName = this.extractIdentifier(fieldNode, "name")
          if (fieldName) {
            const fieldSymbol = this.createSymbol(fieldName, SymbolKind.Property, fieldNode, symbol, {
              type: "field",
            })
            if (this.isPublic(fieldNode)) fieldSymbol.visibility = "public"
            ctx.symbols.push(fieldSymbol)
          }
        }
      }
    }

    if (this.isPublic(node)) {
      ctx.exports.push({
        name,
        type: SymbolKind.Class,
        range: symbol.range,
        isType: true,
      })
    }
    return symbol
  }

  private handleTrait(
    node: Node,
    ctx: RustContext,
    parent: UniversalSymbol | null,
  ): UniversalSymbol | null {
    const nameNode = node.childForFieldName("name")
    let name = nameNode ? nameNode.text : null

    if (nameNode) {
      const nextSibling = nameNode.nextNamedSibling
      if (nextSibling && nextSibling.type === "type_parameters") {
        name += nextSibling.text
      }
    }
    if (!name) return null

    // Use SymbolKind.Trait directly instead of Interface
    const symbol = this.createSymbol(name, SymbolKind.Trait, node, parent)
    ctx.symbols.push(symbol)

    // Extract trait bounds → Extends relationships (trait Foo: Bar + Baz)
    const boundsNode = node.childForFieldName("bounds") || this.findChildByType(node, "trait_bounds")
    if (boundsNode) {
      for (let i = 0; i < boundsNode.namedChildCount; i++) {
        const bound = boundsNode.namedChild(i)
        if (bound && (bound.type === "type_identifier" || bound.type === "scoped_type_identifier" || bound.type === "trait_bound")) {
          ctx.relationships.push({
            source: name,
            target: bound.text,
            type: RelationshipType.Extends,
            confidence: 1.0,
            metadata: { rustSpecific: true, traitBound: true },
          })
        }
      }
    }

    if (this.isPublic(node)) {
      ctx.exports.push({
        name,
        type: SymbolKind.Trait,
        range: symbol.range,
        isType: true,
      })
    }
    return symbol
  }

  private handleImpl(
    node: Node,
    ctx: RustContext,
    parent: UniversalSymbol | null,
  ): UniversalSymbol | null {
    let traitNode: Node | null = null
    let typeNode: Node | null = null

    traitNode = node.childForFieldName("trait")
    typeNode = node.childForFieldName("type")

    if (!traitNode && !typeNode) {
      let forIndex = -1
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "for") {
          forIndex = i
          break
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        if (c.type === "type_identifier" || c.type === "scoped_type_identifier" || c.type === "generic_type") {
          if (forIndex !== -1) {
            if (i < forIndex) traitNode = c
            if (i > forIndex) typeNode = c
          } else {
            typeNode = c
          }
        }
      }
    }

    if (!typeNode) return null

    const typeName = typeNode.text
    const traitName = traitNode ? traitNode.text : undefined
    const implName = traitName ? `${traitName}_for_${typeName}` : typeName

    // Use SymbolKind.Impl for Rust impl blocks
    const symbol = this.createSymbol(implName, SymbolKind.Impl, node, parent)
    ctx.symbols.push(symbol)

    if (traitName) {
      ctx.relationships.push({
        source: typeName,
        target: traitName,
        type: RelationshipType.Implements,
        metadata: {},
      })
    }

    return symbol
  }

  private handleMod(
    node: Node,
    ctx: RustContext,
    parent: UniversalSymbol | null,
  ): UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const symbol = this.createSymbol(name, SymbolKind.Module, node, parent, { type: "mod" })
    ctx.symbols.push(symbol)

    if (this.isPublic(node)) {
      ctx.exports.push({
        name,
        type: SymbolKind.Module,
        range: symbol.range,
        isType: false,
      })
    }
    return symbol
  }

  private handleEnum(
    node: Node,
    ctx: RustContext,
    parent: UniversalSymbol | null,
  ): UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const symbol = this.createSymbol(name, SymbolKind.Enum, node, parent, { type: "enum" })
    ctx.symbols.push(symbol)

    if (this.isPublic(node)) {
      ctx.exports.push({
        name,
        type: SymbolKind.Enum,
        range: symbol.range,
        isType: true,
      })
    }

    return symbol
  }

  private handleFunction(
    node: Node,
    ctx: RustContext,
    parent: UniversalSymbol | null,
  ): UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const isMethod = parent && (parent.metadata?.type === "impl" || parent.metadata?.type === "trait")
    let isConstFn = false
    let isAsyncFn = false
    let isUnsafeFn = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "const") isConstFn = true
      if (c && c.type === "async") isAsyncFn = true
      if (c && c.type === "unsafe") isUnsafeFn = true
    }

    const symbol = this.createSymbol(
      name,
      isMethod ? SymbolKind.Method : SymbolKind.Function,
      node,
      parent,
      { type: "function", isConstFn, isAsyncFn, isUnsafeFn },
    )

    if (isConstFn) symbol.metadata = { ...symbol.metadata, isConst: true }
    if (isAsyncFn) symbol.isAsync = true
    if (isUnsafeFn) symbol.metadata = { ...symbol.metadata, isUnsafe: true }

    let visibility = "private"
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "visibility_modifier") {
        visibility = c.text.includes("crate") ? "crate" : c.text.includes("super") ? "super" : "public"
        break
      }
    }
    symbol.visibility = visibility

    // Check for impl Trait return types
    const returnTypeNode = node.childForFieldName("return_type")
    if (returnTypeNode) {
      symbol.returnType = returnTypeNode.text
    }

    const typeParametersNode = node.childForFieldName("type_parameters")
    if (typeParametersNode) {
      symbol.genericParameters = [typeParametersNode.text]
    }

    const parametersNode = node.childForFieldName("parameters")
    if (parametersNode) {
      const params: Parameter[] = []
      for (let i = 0; i < parametersNode.namedChildCount; i++) {
        const p = parametersNode.namedChild(i)
        if (p && (p.type === "parameter" || p.type === "self_parameter")) {
          const pName = p.childForFieldName("pattern") || p.childForFieldName("self_token") ||
            (p.type === "self_parameter" ? p : null)
          const pType = p.childForFieldName("type")
          params.push({
            name: pName ? pName.text.replace("&", "").replace("mut ", "").trim() : (p.type === "self_parameter" ? "self" : "unknown"),
            type: pType ? pType.text : "any",
          })
        }
      }
      if (params.length > 0) symbol.parameters = params
    }

    ctx.symbols.push(symbol)

    if (this.isPublic(node) && !isMethod) {
      ctx.exports.push({
        name,
        type: SymbolKind.Function,
        range: symbol.range,
        isType: false,
      })
    }

    // Trace calls and borrows
    const traceStack = [node]
    while (traceStack.length > 0) {
      const curr = traceStack.pop()
      if (!curr) continue

      if (curr.type === "call_expression") {
        const functionNode = curr.childForFieldName("function")
        if (functionNode) {
          let target = functionNode.text
          if (functionNode.type === "field_expression") {
            const fieldNode = functionNode.childForFieldName("field")
            const valueNode = functionNode.childForFieldName("value")
            if (fieldNode) {
              target = fieldNode.text
              if (valueNode && valueNode.text === "self" && symbol.ownerName) {
                target = `${symbol.ownerName}.${target}`
              }
            }
          } else if (functionNode.type === "scoped_identifier") {
            const nameNode =
              functionNode.childForFieldName("name") || functionNode.namedChild(functionNode.namedChildCount - 1)
            if (nameNode) target = nameNode.text
          }

          ctx.relationships.push({
            source: symbol.ownerName ? `${symbol.ownerName}.${symbol.name}` : symbol.name,
            target: target,
            type: RelationshipType.Calls,
            metadata: { callExpression: functionNode.text },
          })
        }
      }

      if (curr.type === "reference_type") {
        const typeNode = curr.childForFieldName("type")
        if (typeNode && symbol.ownerName) {
          ctx.relationships.push({
            source: `${symbol.ownerName}.${symbol.name}`,
            target: typeNode.text,
            type: RelationshipType.Uses,
            metadata: { relationshipType: "rust_borrow" },
          })
        }
      }

      for (let i = curr.namedChildCount - 1; i >= 0; i--) {
        const child = curr.namedChild(i)
        if (child) traceStack.push(child)
      }
    }

    return symbol
  }

  private handleVariable(node: Node, ctx: RustContext, parent: UniversalSymbol | null): void {
    let patternNode = node.childForFieldName("pattern")
    if (!patternNode) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i)
        if (child && child.type === "identifier") {
          patternNode = child
          break
        }
      }
    }
    if (!patternNode) return

    const name = patternNode.text
    const symbol = this.createSymbol(name, SymbolKind.Variable, node, parent, { type: node.type })
    ctx.symbols.push(symbol)

    if (this.isPublic(node) && !parent) {
      ctx.exports.push({
        name,
        type: SymbolKind.Variable,
        range: symbol.range,
        isType: false,
      })
    }
  }

  private handleUseDeclaration(node: Node, ctx: RustContext): void {
    const isPublic = this.isPublic(node)
    const collectPath = (n: Node, prefix: string = ""): string => {
      if (n.type === "identifier" || n.type === "type_identifier") return prefix + n.text
      if (n.type === "scoped_identifier") {
        const path = n.childForFieldName("path") || n.namedChild(0)
        const name = n.childForFieldName("name") || n.namedChild(n.namedChildCount - 1)
        const p = path ? collectPath(path) + "::" : ""
        return prefix + p + (name ? name.text : "")
      }
      if (n.type === "use_list") {
        const items: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "self") items.push(prefix ? prefix + "::self" : "self")
          else if (c.type === "use_as_clause") {
            const aliasPath = c.childForFieldName("path") || c.namedChild(0)
            const aliasName = c.childForFieldName("alias") || c.namedChild(c.namedChildCount - 1)
            const ap = aliasPath ? collectPath(aliasPath) : ""
            const an = aliasName ? aliasName.text : ""
            items.push(prefix ? prefix + "::" + ap : ap)
          }
          else items.push(prefix ? prefix + "::" + collectPath(c) : collectPath(c))
        }
        return items.join(", ")
      }
      if (n.type === "use_as_clause") {
        const path = n.childForFieldName("path") || n.namedChild(0)
        return path ? collectPath(path) : n.text
      }
      return prefix + n.text
    }

    let modulePath = ""
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c || c.type === "visibility_modifier" || c.type === "use" || c.type === "crate") continue
      if (!modulePath) modulePath = collectPath(c)
    }

    if (!modulePath) return

    ctx.imports.push({
      module: modulePath,
      source: modulePath,
      items: modulePath.includes(",") ? modulePath.split(",").map(s => s.trim()) : [modulePath.split("::").pop() || modulePath],
      range: {
        startLine: node.startPosition.row + 1, startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1,
        startIndex: node.startIndex, endIndex: node.endIndex,
      },
      metadata: { rustSpecific: true, isPublic },
    })

    if (isPublic) {
      ctx.exports.push({
        name: modulePath,
        type: SymbolKind.Module,
        range: {
          startLine: node.startPosition.row + 1, startColumn: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1,
          startIndex: node.startIndex, endIndex: node.endIndex,
        },
        isType: false,
      })
    }
  }

  // Extract function calls at any scope (not just inside function bodies)
  private handleCallExpression(node: Node, ctx: RustContext, parent: UniversalSymbol | null): void {
    const functionNode = node.childForFieldName("function")
    if (!functionNode) return

    let target = ""
    let qualified = ""

    if (functionNode.type === "field_expression") {
      // obj.method() or self.method()
      const fieldNode = functionNode.childForFieldName("field")
      const valueNode = functionNode.childForFieldName("value")
      if (fieldNode) {
        target = fieldNode.text
        qualified = valueNode ? `${valueNode.text}.${fieldNode.text}` : fieldNode.text
      }
    } else if (functionNode.type === "scoped_identifier") {
      // std::fs::read() or crate::foo::bar()
      const nameNode = functionNode.childForFieldName("name") || functionNode.namedChild(functionNode.namedChildCount - 1)
      if (nameNode) {
        target = nameNode.text
        qualified = functionNode.text
      }
    } else if (functionNode.type === "generic_function") {
      // foo::<T>()
      const baseNode = functionNode.childForFieldName("function")
      if (baseNode) {
        target = baseNode.text
        qualified = baseNode.text
      }
    } else {
      // Simple identifier: foo()
      target = functionNode.text
      qualified = target
    }

    if (!target) return

    const source = parent?.name || "global"

    ctx.relationships.push({
      source,
      target,
      fromSymbol: source,
      toSymbol: qualified,
      type: RelationshipType.Calls,
      metadata: { qualified },
    })

    // Rust constructors: ::new() or PascalCase struct instantiation
    if (target === "new" || qualified.endsWith("::new") || (target[0] === target[0].toUpperCase() && target[0] !== target[0].toLowerCase())) {
      ctx.relationships.push({
        source,
        target,
        fromSymbol: source,
        toSymbol: qualified,
        type: RelationshipType.Instantiates,
        confidence: 0.75,
        metadata: { qualified, isConstructor: true },
      })
    }
  }

  // Extract macro invocations: println!(), vec![], format!(), etc.
  private handleMacroInvocation(node: Node, ctx: RustContext, parent: UniversalSymbol | null): void {
    const macroNode = node.childForFieldName("macro")
    if (!macroNode) return

    let macroName = ""

    if (macroNode.type === "scoped_identifier") {
      // std::println!() or crate::my_macro!()
      const nameNode = macroNode.childForFieldName("name") || macroNode.namedChild(macroNode.namedChildCount - 1)
      macroName = nameNode ? nameNode.text : macroNode.text
    } else {
      macroName = macroNode.text
    }

    if (!macroName) return

    const source = parent?.name || "global"

    ctx.relationships.push({
      source,
      target: macroName,
      fromSymbol: source,
      toSymbol: `macro:${macroName}`,
      type: RelationshipType.Calls,
      metadata: { macroInvocation: true },
    })

    if (["panic", "todo", "unimplemented", "unreachable"].includes(macroName)) {
      if (!ctx.metadata.patterns) ctx.metadata.patterns = []
      const pName = macroName + "!"
      if (ctx.metadata.patterns.indexOf(pName) === -1) ctx.metadata.patterns.push(pName)
    }
  }

  private handleMacro(node: any, ctx: any, parent: any): any {
    let nameNode = node.childForFieldName("name")
    if (!nameNode) {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && child.type === "identifier") {
          nameNode = child
          break
        }
      }
    }
    if (!nameNode) return null

    const name = nameNode.text
    // Use symbol type directly instead of metadata for macros
    const symbol = this.createSymbol(name, SymbolKind.Macro, node, parent)
    ctx.symbols.push(symbol)

    if (this.isPublic(node) || node.text.includes("#[macro_export]")) {
      ctx.exports.push({
        name,
        type: "function" as any,
        range: symbol.range,
        isType: false,
      })
    }
    return symbol
  }
}
