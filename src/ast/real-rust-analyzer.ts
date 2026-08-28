import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// Extract the route path from an axum-style method attribute
// (`#[get("/users")]` → `/users`). Pure-String scan — replaces the legacy
// `\[(?:get|post|put|delete)\("([^"]+)"\)\]` regex.
function extractRoutePath(text: string): string | null {
  for (const verb of ["get", "post", "put", "delete"]) {
    const marker = `[${verb}("`
    const start = text.indexOf(marker)
    if (start >= 0) {
      const rest = text.slice(start + marker.length)
      const end = rest.indexOf('")]')
      if (end >= 0) return rest.slice(0, end)
    }
  }
  return null
}

interface RustContext {
  tree: { rootNode: Node }
  content: string
  filePath: string
  symbols: ASTEngine.UniversalSymbol[]
  imports: ASTEngine.ImportInfo[]
  relationships: ASTEngine.UniversalRelationship[]
  exports: ASTEngine.ExportInfo[]
  metadata: Partial<ASTEngine.FileMetadata>
  emittedUses: Set<string>
  qcByFunction: Map<string, string[]>
  pendingInstantiations: Array<{ source: string; target: string; qualified: string }>
}

export class RealRustAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
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
      emittedUses: new Set<string>(),
      qcByFunction: new Map<string, string[]>(),
      pendingInstantiations: [],
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

    const stack: { node: Node; parent: ASTEngine.UniversalSymbol | null }[] = [{ node: rootNode, parent: null }]

    while (stack.length > 0) {
      const popped = stack.pop()
      if (!popped) continue

      const { node, parent } = popped
      let currentParent = parent

      if (node.type === "struct_item" || node.type === "union_item") {
        // union_item (pub union Pixel { .. }) is structurally identical to
        // struct_item (name field + field_declaration_list) and is a real
        // declaration site — previously unhandled, so Rust unions emitted
        // NO symbol (completeness gap found 2026-08-28).
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
      } else if (node.type === "field_expression") {
        // obj.field or self.field → Uses (family contract: field access is a
        // USES edge, never paired with references; when the field expression
        // is the function of a call (`self.items.push`), the call_expression
        // branch already emits the `calls` edge — one edge per pair).
        const field = node.childForFieldName("field")
        const value = node.childForFieldName("value")
        // field_identifier only — tuple indexing (`tuple.0`) parses as a
        // field_expression with an integer_literal field; numeric indices are
        // not symbols and must not produce uses edges.
        if (
          field &&
          field.type === "field_identifier" &&
          field.text.trim() &&
          node.parent?.type !== "call_expression"
        ) {
          const source = parent?.name || "global"
          const relKey = `${source}::uses::${field.text}`
          if (!ctx.emittedUses.has(relKey)) {
            ctx.emittedUses.add(relKey)
            ctx.relationships.push({
              source,
              target: field.text,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.9,
              metadata: { relationshipType: "field_access", accessedFrom: value?.text },
            })
          }
        }
      } else if (node.type === "struct_expression") {
        // User { id, name } — struct literal construction → instantiates.
        // Enum-variant literals (MatchStrategy::Suffix { … }) carry a
        // scoped_type_identifier name field; the TARGET is the variant LEAF
        // (Suffix), matching the oracle's lastSegment and the family
        // leaf-target contract (#419-B instantiates pin).
        const typeNode = node.childForFieldName("name") || node.namedChild(0)
        if (typeNode && (typeNode.type === "type_identifier" || typeNode.type === "scoped_type_identifier")) {
          const leaf = this.stripGenerics(typeNode.text).split("::").filter(Boolean).pop() ?? typeNode.text
          if (leaf) {
            const source = parent?.name || "global"
            ctx.relationships.push({
              source,
              target: leaf,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.8,
              metadata: { relationshipType: "struct_literal", isConstructor: true },
            })
          }
        }
      } else if (node.type === "macro_invocation") {
        this.handleMacroInvocation(node, ctx, parent)
      } else if (node.type === "enum_variant") {
        const variantName = this.extractIdentifier(node, "name")
        if (variantName && parent && parent.kind === ASTEngine.SymbolKind.Enum) {
          const sym = this.createSymbol(variantName, ASTEngine.SymbolKind.EnumMember, node, parent)
          ctx.symbols.push(sym)
        }
      // 'type_alias_declaration' does not exist in this grammar - aliases
      // are type_item nodes (grammar audit). Trait-level associated types
      // (type Item; inside a trait body) are associated_type nodes — a real
      // declaration site that previously emitted NO symbol (completeness
      // gap found 2026-08-28); impl-level `type Item = u32` stays type_item.
      } else if (node.type === "type_item" || node.type === "associated_type") {
        const name = this.extractIdentifier(node, "name")
        if (name) {
          const sym = this.createSymbol(name, ASTEngine.SymbolKind.Type, node, parent, { type: "type_alias" })
          ctx.symbols.push(sym)
        }
      } else if (node.type === "closure_expression") {
        // Anonymous closures have generated names (closure_68_23) and are
        // function-local execution artifacts, not declaration sites. Skip them
        // as symbols — call sites are captured via call_expression.
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
              type: ASTEngine.RelationshipType.Calls,
              metadata: { rustSpecific: true, isAwait: true },
            })
          }
        }
      } else if (
        node.type === "if_expression" ||
        node.type === "while_expression" || node.type === "loop_expression" ||
        node.type === "for_expression"
      ) {
        // T1 family contract. DEAD literals removed: 'if_let_expression'/
        // 'while_let_expression' do not exist in this grammar - `if let`
        // parses as a plain if_expression (verified live).
        if (!ctx.metadata.cyclomaticComplexity) ctx.metadata.cyclomaticComplexity = 1
        ctx.metadata.cyclomaticComplexity++
      } else if (node.type === "match_arm") {
        // match arms are the Rust analogue of switch cases (per-case family
        // granularity)
        if (!ctx.metadata.cyclomaticComplexity) ctx.metadata.cyclomaticComplexity = 1
        ctx.metadata.cyclomaticComplexity++
      } else if (node.type === "binary_expression") {
        const op = node.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") {
          if (!ctx.metadata.cyclomaticComplexity) ctx.metadata.cyclomaticComplexity = 1
          ctx.metadata.cyclomaticComplexity++
        }
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
                type: ASTEngine.RelationshipType.References,
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

    // Add Contains (REAL container ownership only; imports stay in the
    // imports array — Java-family contract, no dangling `references root`)
    for (const s of ctx.symbols) {
      const _owner = s.ownerName || s.scope; if (_owner) ctx.relationships.push({ source: _owner, target: s.name, type: ASTEngine.RelationshipType.Contains, confidence: 1.0, metadata: {} })
    }

    // #383 payload attach: calls per enclosing function.
    for (const sym of ctx.symbols) {
      const qc = ctx.qcByFunction.get(sym.name)
      if (qc && qc.length > 0) sym.qualified_calls = [...new Set(qc)]
    }

    // Deferred instantiation resolution: emit only constructions whose TYPE
    // is declared in this file. Everything else (std/foreign crates) was
    // unresolvable noise.
    {
      const inFile = new Set<string>()
      for (const sym of ctx.symbols) {
        if (
          sym.kind === ASTEngine.SymbolKind.Struct || sym.kind === ASTEngine.SymbolKind.Enum ||
          sym.kind === ASTEngine.SymbolKind.Type || sym.kind === ASTEngine.SymbolKind.Impl
        ) inFile.add(sym.name)
      }
      for (const cand of ctx.pendingInstantiations) {
        if (!inFile.has(cand.target)) continue
        ctx.relationships.push({
          source: cand.source,
          target: cand.target,
          fromSymbol: cand.source,
          toSymbol: cand.qualified,
          type: ASTEngine.RelationshipType.Instantiates,
          confidence: 0.8,
          metadata: { isConstructor: true },
        })
      }
    }

    // File-level complexity field (family contract - was absent; only a
    // cyclomaticComplexity counter existed).
    ctx.metadata.complexity = ctx.metadata.cyclomaticComplexity ?? 1

    // #419-D evidence tiers on EVERY edge.
    this.classifyEvidenceTier(ctx.relationships)

    return {
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      metadata: ctx.metadata,
    }
  }

  /** #419-D evidence-tier classification (family rules). */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") { md.evidenceClass = md.whereBound ? "reference_qualified" : "import_based"; continue }
      if (t === "extends" || t === "implements" || t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") {
        md.evidenceClass = conf >= 0.8 && md.isConstructor ? "usage_contextual" : "structural"
        continue
      }
      md.evidenceClass = "usage_contextual"
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
          const routePath = extractRoutePath(text)
          if (routePath) {
            ctx.relationships.push({
              source: nameNode.text,
              target: routePath,
              type: ASTEngine.RelationshipType.Exports,
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

  /** Strip a trailing generic parameter list: `UserService<T>` → `UserService`. */
  private stripGenerics(name: string): string {
    const lt = name.indexOf("<")
    return lt >= 0 ? name.slice(0, lt) : name
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
    kind: ASTEngine.SymbolKind,
    node: Node,
    parent: ASTEngine.UniversalSymbol | null,
    extraMetadata: any = {},
  ): ASTEngine.UniversalSymbol {
    let ownerName = parent?.name
    let ownerKind = parent?.kind

    if (parent?.kind === ASTEngine.SymbolKind.Class && parent.metadata?.type === "impl") {
      ownerName = parent.metadata?.target
    }
    // Trait symbols should expose themselves as Interface for ownerKind
    if (parent?.kind === ASTEngine.SymbolKind.Trait) {
      ownerKind = ASTEngine.SymbolKind.Interface
    }
    if (parent?.kind === ASTEngine.SymbolKind.Interface) {
      ownerKind = ASTEngine.SymbolKind.Interface
    }

    return {
      name,
      kind,
      // Rust default visibility is private - never leave it undefined.
      visibility: "private",
      range: {
        startLine: node.startPosition.row + 1,
        // Columns are 1-based family-wide (+1 was missing).
        startColumn: node.startPosition.column + 1,
        endLine: node.endPosition.row + 1,
        endColumn: node.endPosition.column + 1,
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
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    // Use SymbolKind.Struct for Rust structs
    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Struct, node, parent)
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
            const fieldSymbol = this.createSymbol(fieldName, ASTEngine.SymbolKind.Property, fieldNode, symbol, {
              type: "field",
            })
            // Rust fields default to private; only `pub` fields are public
            fieldSymbol.visibility = this.isPublic(fieldNode) ? "public" : "private"
            ctx.symbols.push(fieldSymbol)
          }
        }
      }
    }

    if (this.isPublic(node)) {
      ctx.exports.push({
        name,
        type: ASTEngine.SymbolKind.Class,
        range: symbol.range,
        isType: true,
      })
    }
    return symbol
  }

  private handleTrait(
    node: Node,
    ctx: RustContext,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const nameNode = node.childForFieldName("name")
    let name = nameNode ? nameNode.text : null

    if (!name) return null

    // Use SymbolKind.Trait directly instead of Interface. Strip generic
    // parameter lists (Repository<T> → Repository) so the symbol name is a
    // stable, unqualified identity — generics go into genericParameters.
    const genericParams: string[] = []
    const nextSibling = nameNode ? nameNode.nextNamedSibling : null
    if (nextSibling && nextSibling.type === "type_parameters") {
      genericParams.push(nextSibling.text)
    }
    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Trait, node, parent, {
      type: "trait",
      ...(genericParams.length > 0 ? { genericParameters: genericParams } : {}),
    })
    if (genericParams.length > 0) symbol.genericParameters = genericParams
    ctx.symbols.push(symbol)

    // Extract trait bounds → Extends relationships (trait Foo: Bar + Baz)
    const boundsNode = node.childForFieldName("bounds")
    if (boundsNode) {
      for (let i = 0; i < boundsNode.namedChildCount; i++) {
        const bound = boundsNode.namedChild(i)
        // Pinned wasm: trait_bounds children are direct type nodes -
        // 'trait_bound' does not exist here (grammar audit).
        if (bound && (bound.type === "type_identifier" || bound.type === "scoped_type_identifier" || bound.type === "generic_type")) {
          ctx.relationships.push({
            source: name,
            target: this.extractTraitName(bound),
            type: ASTEngine.RelationshipType.Extends,
            confidence: 1.0,
            metadata: { rustSpecific: true, traitBound: true },
          })
        }
      }
    }

    if (this.isPublic(node)) {
      ctx.exports.push({
        name,
        type: ASTEngine.SymbolKind.Trait,
        range: symbol.range,
        isType: true,
      })
    }
    return symbol
  }

  private handleImpl(
    node: Node,
    ctx: RustContext,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
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

    const typeName = this.stripGenerics(typeNode.text)
    const traitName = traitNode ? traitNode.text : undefined
    // Impl symbols are named after the type they implement (stable identity);
    // the trait lives on the Implements relationship emitted below. Generic
    // parameter lists are stripped: `impl<T: Repository<User>> UserService<T>`
    // → `UserService`.
    const implName = typeName

    // Use SymbolKind.Impl for Rust impl blocks
    const symbol = this.createSymbol(implName, ASTEngine.SymbolKind.Impl, node, parent, { type: "impl" })
    ctx.symbols.push(symbol)

    if (traitNode && traitName) {
      ctx.relationships.push({
        source: typeName,
        target: this.extractTraitName(traitNode),
        type: ASTEngine.RelationshipType.Implements,
        metadata: {},
      })
    }

    return symbol
  }

  /** Leaf type name of a trait reference: `super::Repository<User>` → `Repository`. */
  private extractTraitName(node: Node): string {
    const nameField = node.childForFieldName("name") || node.namedChild(0)
    if (nameField && nameField.type === "type_identifier") return nameField.text
    if (nameField && nameField.type === "scoped_type_identifier") {
      const last = nameField.namedChild(nameField.namedChildCount - 1)
      if (last && last.type === "type_identifier") return last.text
    }
    if (node.type === "type_identifier") return node.text
    return this.stripGenerics(node.text).split("::").pop() || node.text
  }

  private handleMod(
    node: Node,
    ctx: RustContext,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Module, node, parent, { type: "mod" })
    ctx.symbols.push(symbol)

    if (this.isPublic(node)) {
      ctx.exports.push({
        name,
        type: ASTEngine.SymbolKind.Module,
        range: symbol.range,
        isType: false,
      })
    }
    return symbol
  }

  private handleEnum(
    node: Node,
    ctx: RustContext,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Enum, node, parent, { type: "enum" })
    ctx.symbols.push(symbol)

    if (this.isPublic(node)) {
      ctx.exports.push({
        name,
        type: ASTEngine.SymbolKind.Enum,
        range: symbol.range,
        isType: true,
      })
    }

    return symbol
  }

  private handleFunction(
    node: Node,
    ctx: RustContext,
    parent: ASTEngine.UniversalSymbol | null,
  ): ASTEngine.UniversalSymbol | null {
    const name = this.extractIdentifier(node, "name")
    if (!name) return null

    const isMethod =
      parent &&
      (parent.metadata?.type === "impl" ||
        parent.metadata?.type === "trait" ||
        parent.kind === ASTEngine.SymbolKind.Trait ||
        parent.kind === ASTEngine.SymbolKind.Impl)
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
      isMethod ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
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

    // T1 family contract: per-symbol cyclomatic complexity (was absent).
    symbol.complexity = this.functionComplexityRust(node)

    const parametersNode = node.childForFieldName("parameters")
    if (parametersNode) {
      const params: ASTEngine.Parameter[] = []
      for (let i = 0; i < parametersNode.namedChildCount; i++) {
        const p = parametersNode.namedChild(i)
        if (p && (p.type === "parameter" || p.type === "self_parameter")) {
          // 'self_token' is not a serialized FIELD in this grammar - the
          // self_parameter NODE itself is the fallback (its text is '&self').
          const pName = p.childForFieldName("pattern") ||
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
        type: ASTEngine.SymbolKind.Function,
        range: symbol.range,
        isType: false,
      })
    }

    return symbol
  }

  private handleVariable(node: Node, ctx: RustContext, parent: ASTEngine.UniversalSymbol | null): void {
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

    // Module/impl-level const/static/let are declarations; function-local
    // `let` bindings are execution artifacts (noise), not declaration sites.
    // A parent whose kind is Function/Method/Closure means we are inside a
    // function body — skip those. A parent of a function itself (the symbol
    // pushed by handleFunction) is also a body marker.
    if (parent && (parent.kind === ASTEngine.SymbolKind.Function || parent.kind === ASTEngine.SymbolKind.Method)) {
      return
    }

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Variable, node, parent, { type: node.type })
    ctx.symbols.push(symbol)

    if (this.isPublic(node) && !parent) {
      ctx.exports.push({
        name,
        type: ASTEngine.SymbolKind.Variable,
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
        type: ASTEngine.SymbolKind.Module,
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
  private handleCallExpression(node: Node, ctx: RustContext, parent: ASTEngine.UniversalSymbol | null): void {
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
      // foo::<T>() / obj.method::<T>() — turbofish wraps the real callee.
      // The TARGET is the LEAF name (field for field_expression, last
      // segment for scoped_identifier), never the whole base text
      // (cap.parse::<u32>() must target `parse`, not `cap.parse`;
      // .cast::<T>() chains must target `cast`, not the whole expression).
      const baseNode = functionNode.childForFieldName("function")
      if (baseNode) {
        if (baseNode.type === "field_expression") {
          const fieldNode = baseNode.childForFieldName("field")
          if (fieldNode) {
            target = fieldNode.text
            qualified = baseNode.text
          }
        } else if (baseNode.type === "scoped_identifier") {
          const nameNode = baseNode.childForFieldName("name") || baseNode.namedChild(baseNode.namedChildCount - 1)
          if (nameNode) {
            target = nameNode.text
            qualified = baseNode.text
          }
        } else {
          target = baseNode.text
          qualified = baseNode.text
        }
      }
    } else {
      // Simple identifier: foo(). Non-identifier callees — parenthesized
      // closure calls ((self.0)(...)) — have no static name and must not
      // fabricate a target (the differential oracle derives none either).
      if (functionNode.type === "identifier") {
        target = functionNode.text
        qualified = target
      }
    }

    if (!target) return

    const source = parent?.name || "global"

    ctx.relationships.push({
      source,
      target,
      fromSymbol: source,
      toSymbol: qualified,
      type: ASTEngine.RelationshipType.Calls,
      metadata: { qualified },
    })

    // #383 payload: calls per enclosing function.
    const qcFn = parent?.name
    if (qcFn && !ctx.metadata.errors) {
      const list = ctx.qcByFunction.get(qcFn) ?? []
      list.push(qualified)
      ctx.qcByFunction.set(qcFn, list)
    }

    // Rust construction:
    //   Foo::new() / Type::default() -> Instantiates of the RECEIVER TYPE
    //   (target 'new' was garbage - the constructed TYPE is the receiver),
    //   PascalCase tuple-struct constructor call -> Instantiates @0.75
    //   (measured Rust convention: functions are snake_case).
    let instTarget: string | null = null
    if (functionNode.type === "field_expression" || functionNode.type === "scoped_identifier") {
      // Receiver TYPE: value (field_expression) or path (scoped_identifier).
      const receiver =
        functionNode.childForFieldName("value") ??
        functionNode.childForFieldName("path") ??
        functionNode.namedChild(functionNode.namedChildCount - 2)
      if (target === "new" && receiver) {
        const recvText = this.stripGenerics(receiver.text)
        const leaf = recvText.split("::").filter(Boolean).pop() ?? ""
        if (/^[A-Z]/.test(leaf)) instTarget = leaf
      }
    } else if (/^[A-Z]/.test(target)) {
      instTarget = target
    }
    // DEFERRED resolution: constructor candidates emit only when the type
    // resolves to an IN-FILE symbol. Immediate emission fired on every
    // std/external type (Arc, Ok, foreign builders) - 90%+ noise that could
    // never resolve to a project symbol.
    if (instTarget) {
      ctx.pendingInstantiations.push({ source, target: instTarget, qualified })
    }
  }

  /** Per-function cyclomatic complexity (T1 family contract). */
  private functionComplexityRust(node: Node): number {
    const decisionTypes = new Set([
      // match ARMS are counted (per-case family granularity) - counting the
      // match_expression TOO would double-count every dispatch.
      "if_expression", "match_arm", "while_expression",
      "loop_expression", "for_expression", "try_expression",
    ])
    let c = 1
    const st: Node[] = [node]
    while (st.length) {
      const n = st.pop()!
      if (decisionTypes.has(n.type)) c++
      else if (n.type === "binary_expression") {
        const op = n.childForFieldName("operator")?.text
        if (op === "&&" || op === "||") c++
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const ch = n.namedChild(i)
        if (ch) st.push(ch)
      }
    }
    return c
  }

  // Extract macro invocations: println!(), vec![], format!(), etc.
  private handleMacroInvocation(node: Node, ctx: RustContext, parent: ASTEngine.UniversalSymbol | null): void {
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
      type: ASTEngine.RelationshipType.Calls,
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
    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Macro, node, parent)
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
