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
  pendingInstantiations: Array<{ source: string; target: string; qualified: string }>
  // startIndex of call_expression / macro_invocation nodes that sit directly
  // inside an await_expression (`.await`). The DFS visits the inner call node
  // anyway, so the await branch must NOT push a second edge — instead it
  // records the node here and the normal call/macro handler attaches the
  // isAwait marker to its single edge (one edge per call site).
  awaitedCalls: Set<number>
}

export class RealRustAnalyzer implements ASTEngine.LanguageAnalyzer {
  // RSD3: per-file set of symbol ids already handed out, so impl blocks and
  // other same-(owner,name) declarations never share an id (struct Foo + two
  // `impl Foo` blocks previously produced THREE symbols all id "Foo"; 2,852
  // duplicates across cargo+ripgrep). Reset per analyze() call.
  private usedIds = new Set<string>()

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
      pendingInstantiations: [],
      awaitedCalls: new Set<number>(),
    }
    this.usedIds = new Set<string>()

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
        // RSD5 write-gate (2026-09-05, cargo census): a field on the LEFT of
        // `self.x = v` (assignment_expression) or `self.x += v`
        // (compound_assignment_expr) is a WRITE, not a read — the family
        // contract (csharp/ruby/cpp waves) emits `uses` only for reads.
        // Pure writes leaked bogus uses; read-modify-write keeps its edge via
        // the RHS occurrence. (web-tree-sitter returns fresh wrappers, so
        // compare by exact source span, never object identity.)
        const par = node.parent
        let isAssignLhs = false
        if (par && (par.type === "assignment_expression" || par.type === "compound_assignment_expr")) {
          const left = par.namedChild(0)
          if (left && left.startIndex === node.startIndex && left.endIndex === node.endIndex) isAssignLhs = true
        }
        // field_identifier only — tuple indexing (`tuple.0`) parses as a
        // field_expression with an integer_literal field; numeric indices are
        // not symbols and must not produce uses edges.
        if (
          !isAssignLhs &&
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
        // The DFS descends into the awaited inner node anyway, so a raw edge
        // here would DUPLICATE the call site (probe-confirmed 2026-08-28:
        // `do_connect(host, port).await` emitted BOTH a full-text raw edge
        // and the leaf-qualified call edge). Record the inner node and let
        // handleCallExpression / handleMacroInvocation attach isAwait to the
        // single canonical edge.
        const inner = node.namedChild(0)
        if (inner && (inner.type === "call_expression" || inner.type === "macro_invocation")) {
          ctx.awaitedCalls.add(inner.startIndex)
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

    // #383 payload attach: qualified_calls were attached DIRECTLY to the
    // enclosing symbol during the walk (RSD1/RSD2 fix: the old name-keyed
    // qcByFunction map merged every same-named function/method across types
    // and modules into ONE payload, and a whole-file `!metadata.errors` guard
    // wiped payloads from every function in files with ANY parse error).
    for (const sym of ctx.symbols) {
      if (sym.qualified_calls && sym.qualified_calls.length > 0) {
        sym.qualified_calls = [...new Set(sym.qualified_calls)]
      }
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
    // Attribute-based framework detection (family contract: python/cpp
    // populate detectedFrameworks from code signals; rust previously only
    // caught actix route macros). Name-scoped — std derives (Debug, Clone)
    // never imply a framework; only ecosystem-specific markers do.
    const detectFw = (name: string): void => {
      if (!ctx.metadata.detectedFrameworks?.includes(name)) {
        ctx.metadata.detectedFrameworks = [...(ctx.metadata.detectedFrameworks || []), name]
      }
    }
    if (text.startsWith("#[")) {
      // derive-name bodies never contain further brackets, so a scan between
      // `derive(` and `)]` is exact for the marker names.
      const dStart = text.indexOf("derive(")
      if (dStart >= 0) {
        const body = text.slice(dStart + 7)
        if (/\b(Serialize|Deserialize)\b/.test(body)) detectFw("serde")
        if (/\b(Parser|Subcommand|Args|ValueEnum)\b/.test(body)) detectFw("clap")
        // thiserror is signalled by `#[derive(thiserror::Error)]` or the
        // crate-qualified path — bare `Error` is ambiguous with std-style
        // customs and must NOT imply a framework.
        if (text.includes("thiserror")) detectFw("thiserror")
      }
      if (text.includes("tokio::main") || text.includes("tokio::test") || text.includes("tokio::flavor")) detectFw("tokio")
      if (text.includes("axum::")) detectFw("axum")
      if (text.includes("rocket::")) detectFw("rocket")
      if (text.includes("tracing::instrument")) detectFw("tracing")
      if (text.includes("derive(Parser")) detectFw("clap") // keep both spellings honest
    }
    if (text.startsWith("#[get") || text.startsWith("#[post") || text.startsWith("#[put") || text.startsWith("#[delete") || text.startsWith("#[head") || text.startsWith("#[patch")) {
      detectFw("actix_web")
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

    const symbol: ASTEngine.UniversalSymbol = {
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
    symbol.id = this.uniqueId(symbol.id)
    return symbol
  }

  /** Hand out a per-file-unique id: first claim wins plain, later claims get
   *  a deterministic numeric suffix (`Foo`, `Foo#2`, …). RSD3. */
  private uniqueId(base: string): string {
    let id = base
    let n = 2
    while (this.usedIds.has(id)) {
      id = `${base}#${n}`
      n++
    }
    this.usedIds.add(id)
    return id
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
    // Split the import into MODULE (path prefix) and ITEMS (local bindings,
    // alias-aware: `Write as W` binds W, `self` binds the module leaf).
    // Family contract (JS/Java): module = path, items = imported names.
    // Pre-fix, `use std::io::{Read, Write as W}` stored the whole raw text
    // as module and comma-split garbage into items (found 2026-08-28).
    const collect = (n: Node): { path: string; items: string[] } => {
      if (n.type === "identifier" || n.type === "type_identifier") {
        return { path: n.text, items: [n.text] }
      }
      if (n.type === "scoped_identifier") {
        const path = n.childForFieldName("path") || n.namedChild(0)
        const name = n.childForFieldName("name") || n.namedChild(n.namedChildCount - 1)
        const p = path ? collect(path).path + "::" : ""
        return { path: p + (name ? name.text : ""), items: [name ? name.text : ""] }
      }
      if (n.type === "scoped_use_list") {
        const pathNode = n.namedChild(0)
        const listNode = n.namedChild(1)
        const base = pathNode ? collect(pathNode).path : ""
        const items: string[] = []
        if (listNode && listNode.type === "use_list") {
          for (let i = 0; i < listNode.namedChildCount; i++) {
            const c = listNode.namedChild(i)
            if (!c) continue
            if (c.type === "self") {
              // `use crate::foo::{self}` binds the module itself
              const leaf = base.split("::").filter(Boolean).pop()
              if (leaf) items.push(leaf)
            } else if (c.type === "use_as_clause") {
              const aliasName = c.childForFieldName("alias") || c.namedChild(c.namedChildCount - 1)
              if (aliasName) items.push(aliasName.text)
            } else if (c.type === "identifier" || c.type === "type_identifier") {
              items.push(c.text)
            } else if (c.type === "scoped_identifier") {
              const leaf = c.namedChild(c.namedChildCount - 1)
              if (leaf) items.push(leaf.text)
            } else if (c.type === "scoped_use_list") {
              // RSD6a: `use std::{env, path::{Path, PathBuf}}` — a nested
              // group binds the INNER leaves (Path, PathBuf), never the
              // submodule name unless listed. These were silently DROPPED
              // (65 declarations across cargo+ripgrep; 7,367 use-decls, no
              // import truth in the differential — fixture is the guard).
              const inner = collect(c)
              for (const it of inner.items) items.push(it)
            }
          }
        }
        return { path: base, items }
      }
      if (n.type === "use_list") {
        const items: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "use_as_clause") {
            const aliasName = c.childForFieldName("alias") || c.namedChild(c.namedChildCount - 1)
            if (aliasName) items.push(aliasName.text)
          } else if (c.type === "identifier" || c.type === "type_identifier") {
            items.push(c.text)
          } else if (c.type === "scoped_identifier") {
            const leaf = c.namedChild(c.namedChildCount - 1)
            if (leaf) items.push(leaf.text)
          }
        }
        return { path: "", items }
      }
      if (n.type === "use_as_clause") {
        const path = n.childForFieldName("path") || n.namedChild(0)
        const aliasName = n.childForFieldName("alias") || n.namedChild(n.namedChildCount - 1)
        return { path: path ? collect(path).path : n.text, items: [aliasName ? aliasName.text : (path ? collect(path).items[0] : n.text)] }
      }
      if (n.type === "use_wildcard") {
        // use super::util::* — module = path prefix, item = "*"
        const inner = n.namedChild(0)
        const path = inner ? collect(inner).path : n.text
        return { path, items: ["*"] }
      }
      return { path: n.text, items: [n.text] }
    }

    // Aggregate one import row per distinct module prefix. A TOP-LEVEL GROUP
    // import (`use {a::X, b::Y};`) has its use_list as a direct child with NO
    // shared prefix — each binding becomes its own row with its own full
    // module path (RSD6b: the pre-fix code fabricated module 'Read, File' by
    // joining items; 28 such declarations across cargo+ripgrep).
    const rows: { path: string; items: string[] }[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c || c.type === "visibility_modifier" || c.type === "use" || c.type === "crate") continue
      if (c.type === "use_list") {
        for (let j = 0; j < c.namedChildCount; j++) {
          const sub = c.namedChild(j)
          if (!sub || sub.type === ",") continue
          const r = collect(sub)
          if (r.items.length) rows.push(r)
        }
        continue
      }
      const r = collect(c)
      if (r.items.length) rows.push(r)
    }
    if (rows.length === 0) return
    // Merge rows sharing the same module (a multi-item `use std::io::{A, B}`
    // stays ONE row; wildcards never merge into item lists).
    const mergedRows: { path: string; items: string[] }[] = []
    for (const r of rows) {
      const ex = mergedRows.find((m) => m.path === r.path && m.items[0] !== "*" && r.items[0] !== "*")
      if (ex) ex.items.push(...r.items)
      else mergedRows.push({ path: r.path, items: [...r.items] })
    }

    const modulePath = mergedRows[0].path
    for (const row of mergedRows) {
      ctx.imports.push({
        module: row.path,
        source: row.path,
        items: row.items,
        range: {
          startLine: node.startPosition.row + 1, startColumn: node.startPosition.column + 1,
          endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1,
          startIndex: node.startIndex, endIndex: node.endIndex,
        },
        metadata: { rustSpecific: true, isPublic },
      })
    }

    if (isPublic && modulePath) {
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

    const metadata: Record<string, any> = { qualified }
    // Awaited call sites carry the isAwait marker on the canonical edge
    // (one edge per call site — the await branch records, it does not emit).
    if (ctx.awaitedCalls.has(node.startIndex)) {
      metadata.rustSpecific = true
      metadata.isAwait = true
    }
    ctx.relationships.push({
      source,
      target,
      fromSymbol: source,
      toSymbol: qualified,
      type: ASTEngine.RelationshipType.Calls,
      metadata,
    })

    // #383 payload: calls per enclosing function — attached DIRECTLY to the
    // enclosing fn/method symbol (RSD1: the old name-keyed qcByFunction map
    // merged same-named methods across types and impls — 410 buckets / 749
    // excess entries in cargo+ripgrep). Attach is unconditional (RSD2: a
    // whole-file `!metadata.errors` guard previously wiped payloads from all
    // 4,620 functions across 519 error files; single-token ERROR recovery is
    // precise enough that the symbolRef attach never misattributes).
    const qcOwner = parent &&
      (parent.kind === ASTEngine.SymbolKind.Function || parent.kind === ASTEngine.SymbolKind.Method)
    if (qcOwner) {
      const arr = parent.qualified_calls ?? []
      arr.push(qualified)
      parent.qualified_calls = arr
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

    const metadata: Record<string, any> = { macroInvocation: true }
    // Awaited macros (foo!().await) carry isAwait on the single macro edge.
    if (ctx.awaitedCalls.has(node.startIndex)) {
      metadata.rustSpecific = true
      metadata.isAwait = true
    }
    ctx.relationships.push({
      source,
      target: macroName,
      fromSymbol: source,
      toSymbol: `macro:${macroName}`,
      type: ASTEngine.RelationshipType.Calls,
      metadata,
    })

    // #383 payload parity with calls edges: macro invocations are real call
    // sites, so a function whose body only invokes macros must still carry a
    // qualified_calls payload (toSymbol-style `macro:name` entries).
    const qcOwner = parent &&
      (parent.kind === ASTEngine.SymbolKind.Function || parent.kind === ASTEngine.SymbolKind.Method)
    if (qcOwner) {
      const arr = parent.qualified_calls ?? []
      arr.push(`macro:${macroName}`)
      parent.qualified_calls = arr
    }

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
