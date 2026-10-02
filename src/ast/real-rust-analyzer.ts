import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// Extract the route path from an axum-style method attribute
// (`#[get("/users")]` → `/users`). Pure-String scan — replaces the legacy
// `\[(?:get|post|put|delete)\("([^"]+)"\)\]` regex.
// actix-web spells a route as an attribute. The GUARD that recognised the framework
// and the EXTRACTOR that read the path used two different verb lists — six versus
// four — so `#[head(…)]` and `#[patch(…)]` were detected as actix and then produced
// no route at all, silently. One list, used by both, so they cannot drift again.
// `options`, `trace` and actix's older `#[route("/p", method = "GET")]` were missing
// from both, which cost 4 of the 7 routes in the fixture (RUST-D24).
const ROUTE_VERBS = ["get", "post", "put", "delete", "patch", "head", "options", "trace", "route"]

/**
 * The route verb this attribute declares, or "" when it declares none.
 * ASCII comparison, no regex; requires `(` or whitespace after the verb so
 * `#[getter]` is never mistaken for `#[get]`.
 */
function routeVerbOf(text: string): string {
  if (!text.startsWith("#[")) return ""
  const rest = text.slice(2)
  for (const verb of ROUTE_VERBS) {
    if (!rest.startsWith(verb)) continue
    const next = rest[verb.length] ?? ""
    if (next === "(" || next === " " || next === "\t") return verb
  }
  return ""
}

function extractRoutePath(text: string): string | null {
  if (!routeVerbOf(text)) return null
  // the route is the FIRST string literal in the attribute, which is the path for
  // both `#[get("/p")]` and `#[route("/p", method = "GET")]`
  const open = text.indexOf("(", 2)
  if (open < 0) return null
  const q1 = text.indexOf('"', open)
  if (q1 < 0) return null
  const q2 = text.indexOf('"', q1 + 1)
  if (q2 <= q1 + 1) return null
  return text.slice(q1 + 1, q2)
}

// ASCII word-run membership: exact the same thing `\b(S1|S2|...)\b` decides,
// without a regex. JS `\b` is defined by the ASCII word class, so a manual
// before/after char-code test is an equivalent, not an approximation — and the
// matches here are marker NAMES in a `#[derive(...)]` body, where a substring
// hit (`SerializeAny` for `Serialize`) must not fire.
function hasBareWord(hay: string, word: string): boolean {
  const isWordChar = (c: number): boolean =>
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
  let i = hay.indexOf(word)
  while (i >= 0) {
    const before = i > 0 ? hay.charCodeAt(i - 1) : 0
    const after = i + word.length < hay.length ? hay.charCodeAt(i + word.length) : 0
    if (!isWordChar(before) && !isWordChar(after)) return true
    i = hay.indexOf(word, i + 1)
  }
  return false
}

// R8 (M60 standing rule, enforced by G1): the family contract is THREE metadata
// keys — `framework` (the deterministic primary pick), `detectedFrameworks`
// (always an array) and `frameworkPatterns` (aligned) — and rust published two
// of them, so every consumer reading `framework` fell through to the engine's
// `"unknown"` default (`framework-corpus.json` shows rust rows with
// `framework: "unknown", status: "default"`). The pick is a FIXED priority
// order over this lane's own markers, not a second detection pass: an
// application framework outranks the runtime it runs on, which outranks the CLI
// parser and the derive-level markers (serde is the weakest signal — it is
// present in nearly every crate). Mirrors java's `pickJavaFramework` and golang's
// `frameworks[0]?.name`, each lane owning its own order.
const RUST_FRAMEWORK_PRIORITY: string[] = [
  "actix_web", "axum", "rocket", "tokio", "clap", "serde", "thiserror", "tracing",
]

// R10 (M60 standing rule): the declared synthetic name for an impl whose
// implemented TYPE has no nominal name — `impl ToPkgId for (T, U)`,
// `impl Index<Match> for [u8]`. The type has no name, but the impl BLOCK is a
// real construct that owns members and carries an `implements` edge, so it
// still needs one; the family already spells this class this way (c's
// `anonymous_struct` / `anonymous_union` / `anonymous_enum`, cpp's
// `anonymous`), and it is DECLARED in the M60 registers rather than left to a
// reader to infer. It is not a placeholder for an unknown state (R7): the
// state is fully known — the block exists and its type is unnamed — and the
// type's own spelling rides `metadata.implementedType`.
const RUST_UNNAMED_IMPL = "anonymous_impl"

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
  // M59.A7 (#825): the constructor candidate carries the 1-based line of the
  // node that NAMES the type it constructs — the edge is emitted in a deferred
  // pass (after the symbol table exists), long after the node is in hand.
  pendingInstantiations: Array<{ source: string; target: string; qualified: string; line?: number; bareSpelling?: boolean }>
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

  /**
   * M59.A7 (#825): the 1-based line of a syntax node, or `undefined` when the
   * node is absent. Never 0 — a site that cannot be named is OMITTED from the
   * edge (the #820 rule), so a reader can tell "no line" from "line 1".
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node || !node.startPosition || typeof node.startPosition.row !== "number") return undefined
    return node.startPosition.row + 1
  }

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
        // R8 (M60 standing rule): the family contract's three keys, ALL
        // declared here. `framework` is the deterministic primary pick and its
        // VALUE is assigned after the walk (below), because detection happens
        // in the attribute handler as the tree is traversed — but the key is
        // part of what this analyzer publishes, so it is declared at
        // construction exactly as the compliant lanes (java's
        // `pickJavaFramework`, go's `frameworks[0]?.name`) declare theirs.
        framework: undefined,
        detectedFrameworks: [],
        frameworkPatterns: [],
      },
      emittedUses: new Set<string>(),
      pendingInstantiations: [],
      awaitedCalls: new Set<number>(),
    }
    this.usedIds = new Set<string>()

    // R1 (rust review): order-independent resolution sets (CGD26 class):
    // file-visible VALUE names mapped to their owners ("" = file scope),
    // plus use-imported leaves (file-wide visibility). Built BEFORE the
    // main walk so reads before declarations still resolve.
    const valueOwners = new Map<string, Set<string>>()
    const useImported = new Set<string>()
    this.collectValueOwners(rootNode, valueOwners, useImported)

    // R1: per-function bound-name sets (flow-insensitive, C-family
    // contract). Residuals (documented): use-before-decl and cross-arm
    // reads, lambda params applied function-wide, UPPERCASE locals read
    // as path-pattern uses.
    const fnBindings = this.collectFunctionBindings(rootNode, valueOwners, useImported)

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
        this.handleUseDeclaration(node, ctx, parent)
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
              // M59.A7 (#825): the FIELD identifier's line, not the receiver's —
              // a `field_expression` starts at its value.
              ...(this.nodeLine(field) ? { line_number: this.nodeLine(field)! } : {}),
              metadata: { relationshipType: "field_access", accessedFrom: value?.text },
            })
          }
        }
      } else if (node.type === "struct_expression") {
        // User { id, name } — struct literal construction → instantiates.
        // Enum-variant literals (MatchStrategy::Suffix { … }) carry a
        // scoped_type_identifier name field; the TARGET is the variant LEAF
        // (Suffix), matching the oracle's lastSegment and the family
        // leaf-target contract (#419-B instantiates pin). D2: a `Self`
        // literal constructs the enclosing impl type.
        const typeNode = node.childForFieldName("name") || node.namedChild(0)
        if (typeNode && (typeNode.type === "type_identifier" || typeNode.type === "scoped_type_identifier")) {
          // R10/R7: an unresolvable `Self` (an impl whose implemented type has
          // no nominal name) is ABSENCE — `?? leaf` kept the raw literal
          // "Self" and emitted `instantiates -> "Self"`, a name no symbol has.
          let leaf: string | null = this.stripGenerics(typeNode.text).split("::").filter(Boolean).pop() ?? typeNode.text
          if (leaf === "Self") leaf = this.enclosingImplType(node)
          if (leaf) {
            const source = parent?.name || "global"
            ctx.relationships.push({
              source,
              target: leaf,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.8,
              // M59.A7 (#825): the constructed TYPE's own line.
              ...(this.nodeLine(typeNode) ? { line_number: this.nodeLine(typeNode)! } : {}),
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
        // R8 (rust review): a bare-identifier bound that names one of the
        // enclosing generic parameters (`where T: Clone`) is locally bound,
        // not a file-type reference. Real path bounds (`String: PartialEq`,
        // fixture-pinned) still emit.
        //
        // R15 (rust review #798, cargo full extent) — two holes in this rule's
        // own words ("the enclosing generic params"), both measured:
        //   1. `function_signature_item` — a TRAIT method declaration, which has
        //      no body — was missing from the item list, so the climb skipped
        //      the signature and stopped at the trait, whose `type_parameters`
        //      are the TRAIT's. A where clause on a method signature therefore
        //      never saw the method's own parameters: `fn try_borrow_with<F,
        //      E>(...) where F: FnOnce() -> ...;` emitted `references -> F`
        //      for exactly the locally-bound name the rule excludes inside a
        //      `function_item` (cargo: once.rs, paths.rs, package_id_spec.rs).
        //   2. The climb took the FIRST enclosing item and stopped, so a bound
        //      naming an OUTER parameter (`impl<N, E> Graph<N, E>` with
        //      `where N: Borrow<Q>` on a method) was read as a file type. The
        //      whole chain is walked now: every enclosing generic item binds.
        const genericParams = new Set<string>()
        let gcur: Node | null = node.parent
        while (gcur) {
          if (
            gcur.type === "function_item" || gcur.type === "function_signature_item" ||
            gcur.type === "trait_item" ||
            gcur.type === "struct_item" || gcur.type === "enum_item" ||
            gcur.type === "type_item" || gcur.type === "impl_item"
          ) {
            const tp = gcur.childForFieldName("type_parameters")
            if (tp) {
              const pw: Node[] = [tp]
              while (pw.length > 0) {
                const m = pw.pop()!
                if (m.type === "type_identifier" || m.type === "identifier") genericParams.add(m.text)
                for (let k = 0; k < m.namedChildCount; k++) {
                  const c = m.namedChild(k)
                  if (c) pw.push(c)
                }
              }
            }
          }
          gcur = gcur.parent
        }
        // R15: the bounded side contributes its type NAME(S), never raw text:
        //   `where T::Err: Display`                published `T::Err`
        //   `where <T as FromStr>::Err: Display`   published `<T as FromStr>::Err`
        //   `where anyhow::Error: From<E>`         published the MODULE `anyhow`
        // — targets no consumer can resolve, the name-surface class the c/cpp
        // #924 round closed: a target is the deepest NAME segment, a path
        // prefix is not a type dependency, and a LIFETIME (`where 'a: 's`)
        // is not a symbol at all, so that predicate contributes nothing.
        // `String: PartialEq` (the fixture pin) is untouched — its left side IS
        // one name. This is the same rule the declared-type pass applies by
        // construction (it reads only `type_identifier` leaves).
        const boundNames = (n: Node | null): Node[] => {
          if (!n) return []
          // A scoped path names one type: the `name` field is the leaf
          // (`anyhow::Error` -> Error, `T::Err` -> Err, `<T as X>::Err` -> Err).
          if (n.type === "scoped_type_identifier" || n.type === "scoped_identifier" || n.type === "qualified_type") {
            const nm = n.childForFieldName("name")
            if (nm) return [nm]
            const last = n.namedChild(n.namedChildCount - 1)
            return last && (last.type === "type_identifier" || last.type === "identifier") ? [last] : []
          }
          const out: Node[] = []
          const w: Node[] = [n]
          while (w.length > 0) {
            const m = w.pop()!
            // Lifetimes are not types: `'a` and its inner identifier
            // contribute nothing (`&'a N` must yield N alone).
            if (m.type === "lifetime") continue
            if (m.type === "type_identifier") out.push(m)
            for (let k = m.namedChildCount - 1; k >= 0; k--) {
              const ch = m.namedChild(k)
              if (ch) w.push(ch)
            }
          }
          return out
        }
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (!c || c.type !== "where_predicate") continue
          const left = c.namedChild(0)
          for (const leaf of boundNames(left)) {
            if (!leaf.text || genericParams.has(leaf.text)) continue
            ctx.relationships.push({
              source: parent?.name || "global",
              target: leaf.text,
              type: ASTEngine.RelationshipType.References,
              // M59.A7 (#825): the bound's own line.
              ...(this.nodeLine(leaf) ? { line_number: this.nodeLine(leaf)! } : {}),
              metadata: { rustSpecific: true, whereBound: true },
            })
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
      } else if (node.type === "identifier") {
        this.handleIdentifierRead(node, ctx, parent, valueOwners, useImported, fnBindings)
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
      const _owner = s.ownerName || s.scope
      if (!_owner) continue
      ctx.relationships.push({
        source: _owner,
        target: s.name,
        type: ASTEngine.RelationshipType.Contains,
        confidence: 1.0,
        // M59.A7 (#825): the member's own declaration line.
        ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
        metadata: {},
      })
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
        // RUST-D30: a bare single-segment callee never resolves to a same-named
        // local type — the prelude owns those spellings (`Ok`, `Some`, `None`,
        // `Err`). Dropped here rather than at the candidate, so the rule sits
        // where the ambiguity actually becomes visible.
        if (cand.bareSpelling) continue
        ctx.relationships.push({
          source: cand.source,
          target: cand.target,
          fromSymbol: cand.source,
          toSymbol: cand.qualified,
          type: ASTEngine.RelationshipType.Instantiates,
          confidence: 0.8,
          // M59.A7 (#825): recorded at the call site (the type that names the
          // construction), carried through the deferred resolution pass.
          ...(cand.line ? { line_number: cand.line } : {}),
          metadata: { isConstructor: true },
        })
      }
    }

    // File-level complexity field (family contract - was absent; only a
    // cyclomaticComplexity counter existed).
    ctx.metadata.complexity = ctx.metadata.cyclomaticComplexity ?? 1

    // R8: the deterministic primary pick, made HERE rather than in the
    // construction literal because `detectedFrameworks` is filled by the
    // attribute handler as the tree is walked — a pick made at construction
    // time would always read the empty initial array. Absent (not a literal)
    // when nothing was detected, which is the same absence rule R7 enforces on
    // names: `meta.framework` stays undefined and no consumer can match a
    // framework the file does not use.
    ctx.metadata.framework = RUST_FRAMEWORK_PRIORITY.find(
      (fw) => (ctx.metadata.detectedFrameworks ?? []).includes(fw),
    )

    // Declared-type reference graph (R13, rust extreme review — family
    // standard, mirrors go/c/zig; rust had ONLY where-bound references).
    // Parameter types, return types, struct/union field types, enum variant
    // field types, const/static types and type-alias right-hand sides emit
    // `references` to every named type mentioned. Primitives are
    // `primitive_type` nodes (never collected); lifetimes are `lifetime`
    // nodes (never collected); generic parameter LISTS are declarations,
    // not deps (skipped — but a use of a param in a field type still
    // mentions it); where-clauses belong to the R8 branch (skipped here);
    // body-local annotations and turbofish args are execution artifacts
    // (documented boundary). `Self` resolves to the enclosing impl type
    // (D2 rule) and is otherwise skipped — a bare "Self" edge could never
    // resolve to any symbol.
    this.extractRustDeclaredTypeRefs(rootNode, ctx)

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

  /** R13: declared-type `references` (see the call site for the contract). */
  private extractRustDeclaredTypeRefs(rootNode: Node, ctx: RustContext): void {
    const emitted = new Set<string>()
    // Generic parameter names of the nearest enclosing generic item (R8's
    // climb): they are LOCALLY BOUND, not dependencies — `fn generic<T>(x:
    // T)` must not emit generic->T (the existing R8 forbid pins exactly
    // this for the where-bound; the param-type mention is the same name).
    const genericParamsOf = (item: Node): Set<string> => {
      const out = new Set<string>()
      let gcur: Node | null = item
      while (gcur) {
        if (
          gcur.type === "function_item" || gcur.type === "trait_item" ||
          gcur.type === "struct_item" || gcur.type === "enum_item" ||
          gcur.type === "type_item" || gcur.type === "impl_item"
        ) {
          const tp = gcur.childForFieldName("type_parameters")
          if (tp) {
            const pw: Node[] = [tp]
            while (pw.length > 0) {
              const m = pw.pop()!
              if (m.type === "type_identifier" || m.type === "identifier") out.add(m.text)
              for (let k = 0; k < m.namedChildCount; k++) {
                const c = m.namedChild(k)
                if (c) pw.push(c)
              }
            }
          }
          break
        }
        gcur = gcur.parent
      }
      return out
    }
    const push = (source: string, leafNode: Node, gparams: Set<string>): void => {
      let target = leafNode.text
      if (!target || target === "Self") {
        const resolved = this.enclosingImplType(leafNode)
        if (!resolved) return
        target = resolved
      }
      if (gparams.has(target)) return
      const key = `${source}::references::${target}`
      if (emitted.has(key)) return
      emitted.add(key)
      ctx.relationships.push({
        source,
        target,
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
        // M59.A7 (#825): the leaf that names the type.
        ...(this.nodeLine(leafNode) ? { line_number: this.nodeLine(leafNode)! } : {}),
        metadata: { relationshipType: "declared_type" },
      })
    }
    const collectLeaves = (typeNode: Node | null): Node[] => {
      const out: Node[] = []
      if (!typeNode) return out
      const w: Node[] = [typeNode]
      while (w.length > 0) {
        const m = w.pop()!
        // where-bounds belong to R8; generic parameter lists declare.
        if (m !== typeNode && (m.type === "where_clause" || m.type === "type_parameters")) continue
        if (m.type === "type_identifier") out.push(m)
        for (let i = m.namedChildCount - 1; i >= 0; i--) {
          const c = m.namedChild(i)
          if (c) w.push(c)
        }
      }
      return out
    }
    const walk: Node[] = [rootNode]
    while (walk.length > 0) {
      const n = walk.pop()!
      const t = n.type
      // Macro RULE bodies are templates, not code (same rule as the R1
      // read gate) — never collect type mentions from them.
      if (t === "macro_definition") continue
      if (t === "function_item") {
        const src = this.extractIdentifier(n, "name") ?? "global"
        const gparams = genericParamsOf(n)
        const params = n.childForFieldName("parameters")
        if (params) {
          for (let i = 0; i < params.namedChildCount; i++) {
            const p = params.namedChild(i)
            if (!p) continue
            if (p.type === "self_parameter") continue
            const ty = p.type === "parameter" ? p.childForFieldName("type") : null
            for (const leaf of collectLeaves(ty)) push(src, leaf, gparams)
          }
        }
        const ret = n.childForFieldName("return_type")
        for (const leaf of collectLeaves(ret)) push(src, leaf, gparams)
      } else if (t === "struct_item" || t === "union_item") {
        const src = this.extractIdentifier(n, "name") ?? "global"
        const gparams = genericParamsOf(n)
        // Field types are the non-name direct children of each
        // field_declaration (the name is field_identifier-typed, never
        // collected — only type_identifier leaves resolve).
        const fw: Node[] = [n]
        while (fw.length > 0) {
          const m = fw.pop()!
          if (m !== n && (m.type === "where_clause" || m.type === "type_parameters")) continue
          if (m.type === "field_declaration") {
            for (let i = 0; i < m.namedChildCount; i++) {
              const c = m.namedChild(i)
              if (c && c.type !== "field_identifier" && c.type !== "visibility_modifier" && c.type !== "attribute_item") {
                for (const leaf of collectLeaves(c)) push(src, leaf, gparams)
              }
            }
            continue
          }
          // R14 (rust review #798, ripgrep full extent): a TUPLE struct's
          // field types (`pub struct StandardStream(StandardStreamKind);`,
          // `struct LiteralStrategy(fnv::HashMap<..>);`) were never collected —
          // the named-field path below only walks `field_declaration`, and a
          // tuple struct has none: its fields sit directly in an
          // `ordered_field_declaration_list`, exactly like a tuple ENUM
          // VARIANT's do (that branch already handled them). 13 sites over 10
          // files on ripgrep alone; a tuple field declares a type just as a
          // named one does, so the omission was an extraction gap, not a rule.
          if (m.type === "ordered_field_declaration_list") {
            for (let i = 0; i < m.namedChildCount; i++) {
              const c = m.namedChild(i)
              if (c) for (const leaf of collectLeaves(c)) push(src, leaf, gparams)
            }
            continue
          }
          for (let i = m.namedChildCount - 1; i >= 0; i--) {
            const c = m.namedChild(i)
            if (c) fw.push(c)
          }
        }
      } else if (t === "enum_item") {
        const src = this.extractIdentifier(n, "name") ?? "global"
        const gparams = genericParamsOf(n)
        // Struct-variant fields behave like struct fields; tuple-variant
        // fields (`V(Point)`) are bare type children of
        // ordered_field_declaration_list. Variant NAMES are
        // identifier-typed (never collected).
        const ew: Node[] = [n]
        while (ew.length > 0) {
          const m = ew.pop()!
          if (m !== n && (m.type === "where_clause" || m.type === "type_parameters")) continue
          if (m.type === "field_declaration") {
            for (let i = 0; i < m.namedChildCount; i++) {
              const c = m.namedChild(i)
              if (c && c.type !== "field_identifier" && c.type !== "visibility_modifier" && c.type !== "attribute_item") {
                for (const leaf of collectLeaves(c)) push(src, leaf, gparams)
              }
            }
            continue
          }
          if (m.type === "ordered_field_declaration_list") {
            for (let i = 0; i < m.namedChildCount; i++) {
              const c = m.namedChild(i)
              if (c) for (const leaf of collectLeaves(c)) push(src, leaf, gparams)
            }
            continue
          }
          for (let i = m.namedChildCount - 1; i >= 0; i--) {
            const c = m.namedChild(i)
            if (c) ew.push(c)
          }
        }
      } else if (t === "type_item" || t === "associated_type") {
        const src = this.extractIdentifier(n, "name") ?? "global"
        const gparams = genericParamsOf(n)
        // The aliased type is the last named child that is not the name
        // itself nor the parameter list (a valueless `type Item;`
        // contributes nothing).
        const nameNode = n.childForFieldName("name") ?? n.namedChild(0)
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (!c || c.type === "type_parameters" || c.type === "where_clause") continue
          if (nameNode && c.startIndex === nameNode.startIndex && c.endIndex === nameNode.endIndex) continue
          for (const leaf of collectLeaves(c)) push(src, leaf, gparams)
          break
        }
      } else if (t === "const_item" || t === "static_item") {
        const nm = n.childForFieldName("name")?.text
        if (nm && nm !== "_") {
          const ty = n.childForFieldName("type")
          const gparams = genericParamsOf(n)
          for (const leaf of collectLeaves(ty)) push(nm, leaf, gparams)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) walk.push(c)
      }
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
        if (hasBareWord(body, "Serialize") || hasBareWord(body, "Deserialize")) detectFw("serde")
        if (hasBareWord(body, "Parser") || hasBareWord(body, "Subcommand") ||
            hasBareWord(body, "Args") || hasBareWord(body, "ValueEnum")) detectFw("clap")
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
    if (routeVerbOf(text)) {
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
              // M59.A7 (#825): the function that carries the attribute.
              ...(this.nodeLine(nameNode) ? { line_number: this.nodeLine(nameNode)! } : {}),
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

  /** D3 (rust second review): unrestricted `pub` only. `pub(crate)` /
   *  `pub(super)` items are not externally importable and must not enter
   *  the export list (the M49 importable-units invariant). Symbol
   *  visibility fields are untouched — only export gating changes. */
  private isUnrestrictedPublic(node: Node): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === "visibility_modifier" && child.text.trim() === "pub") {
        return true
      }
    }
    return false
  }

  /** D2 (rust second review): the `Self` type of the enclosing impl block
   *  (`Self { x }` constructs the implementing type). Trait bodies have no
   *  impl to resolve (null → existing filtered behavior).
   *
   *  R10 (M60 standing rule): `Self` is the implemented TYPE, so it resolves to
   *  that type's NOMINAL name — and when the type has no nominal name the
   *  honest answer is ABSENCE (R7), not the impl block's synthetic name:
   *  `Self` in `impl ToPkgId for (T, U)` is `(T, U)`, which is not
   *  `anonymous_impl` and is not a name at all, so no edge is emitted. */
  private enclosingImplType(node: Node | null): string | null {
    let cur = node ? node.parent : null
    while (cur) {
      if (cur.type === "impl_item") return this.implSelfTypeName(cur.childForFieldName("type"))
      cur = cur.parent
    }
    return null
  }

  /**
   * R10 (M60 standing rule) — the NAME of the type an impl implements.
   *
   * An impl symbol is named after the type it implements (stable identity, see
   * `handleImpl`), and an `&mut`/`&`/`*const`/`(...)` wrapper does not change
   * what the type is NAMED: `&mut ProcessBuilder` is the type `ProcessBuilder`
   * behind a reference, so those wrappers are TRANSPARENT here and the
   * innermost nominal name is the answer. The old rule took
   * `stripGenerics(typeNode.text)` verbatim, so for a wrapped type it published
   * SOURCE TEXT as a name — `&mut ProcessBuilder` rode the impl SYMBOL, the
   * `implements` edge's SOURCE and every `Self` resolution inside the block,
   * and the M60 target-spelling census convicted it (6 `references` targets over
   * 2 files: `&mut ProcessBuilder` x5, `&mut Execs` x1). The differential could
   * never see it: its truth derives from the same rule, so both sides spelled
   * the fabrication identically.
   *
   * A type with NO nominal name — a slice `[u8]`, a tuple `(T, U)`, a unit, a
   * never type, a function pointer, `dyn Trait`, `<T as Trait>::Assoc` — has no
   * name to publish, so this returns `null` and each caller decides the honest
   * state: the SYMBOL falls back to the family's declared synthetic
   * (`RUST_UNNAMED_IMPL`, keeping the source spelling in metadata where it is
   * evidence rather than an identifier), and `Self` RESOLUTION falls back to
   * ABSENCE.
   *
   * The two callers then read the SAME unwrapped node two different ways, and
   * the difference is deliberate and pre-existing:
   *
   *   `implTypeSymbolName` keeps a path's QUALIFICATION (`impl From<X> for
   *   std::io::Error` publishes `std::io::Error`) because the deferred
   *   constructor resolution reads in-file SYMBOL names — flattening a foreign
   *   `io::Error` to `Error` would make `Error::new()` inside the impl look like
   *   a local construction. Measured: flattening it added 12 spurious
   *   `instantiates` edges on ripgrep alone.
   *   `implSelfTypeName` takes the LEAF (`Error`), because a `references` or
   *   `instantiates` TARGET is a leaf by the family's leaf-target contract
   *   (#419-B).
   */
  private nominalTypeNode(typeNode: Node | null): Node | null {
    let cur: Node | null = typeNode
    for (let guard = 0; cur && guard < 16; guard++) {
      const t = cur.type
      if (t === "reference_type" || t === "pointer_type" || t === "parenthesized_type") {
        const inner = cur.childForFieldName("type") ?? cur.namedChild(cur.namedChildCount - 1)
        if (!inner) return null
        cur = inner
        continue
      }
      break
    }
    if (!cur) return null
    const t = cur.type
    if (t === "type_identifier" || t === "primitive_type" || t === "scoped_type_identifier" || t === "generic_type") {
      return cur
    }
    return null
  }

  /** The impl SYMBOL's name: the unwrapped type's own spelling, generics
   *  stripped, path qualification PRESERVED (`std::io::Error`, `Vec`). */
  private implTypeSymbolName(typeNode: Node | null): string | null {
    const n = this.nominalTypeNode(typeNode)
    if (!n) return null
    return this.stripGenerics(n.text) || null
  }

  /** The name `Self` resolves to inside the impl: the unwrapped type's LEAF
   *  (`Error` for `std::io::Error`), or `null` when the type has no nominal
   *  name at all. */
  private implSelfTypeName(typeNode: Node | null): string | null {
    const n = this.nominalTypeNode(typeNode)
    if (!n) return null
    return this.stripGenerics(n.text).split("::").filter(Boolean).pop() || null
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

    // D3: exports are externally importable units — unrestricted `pub`
    // at true file top level only (mirrors the fn/mod/variable !parent
    // rule; members ride Contains).
    if (this.isUnrestrictedPublic(node) && !parent) {
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
        let bound = boundsNode.namedChild(i)
        // RUST-MR: a HIGHER-RANKED bound (`for<'de> Deserialize<'de>` — the
        // lifetime-generic supertrait idiom) wraps its type in a
        // `higher_ranked_trait_bound` node, so the direct-child test below
        // missed it and the supertrait edge was NEVER emitted: serde's
        // `pub trait DeserializeOwned: for<'de> Deserialize<'de> {}` published
        // nothing. The F5 oracle had the mirror-image bug on the same construct
        // — it took the binder's text and FABRICATED `extends -> "for"` — so
        // both sides were wrong in opposite directions and the row surfaced as
        // one MISSING while the real edge never surfaced at all. Measured: 3
        // higher-ranked bounds in 2 files across 2,598, and this is the only
        // construct where a supertrait bound is named but unpublished.
        if (bound?.type === "higher_ranked_trait_bound") {
          for (let j = 0; j < bound.namedChildCount; j++) {
            const inner = bound.namedChild(j)
            if (inner && (inner.type === "type_identifier" || inner.type === "scoped_type_identifier" || inner.type === "generic_type")) { bound = inner; break }
          }
        }
        // Pinned wasm: trait_bounds children are direct type nodes -
        // 'trait_bound' does not exist here (grammar audit).
        if (bound && (bound.type === "type_identifier" || bound.type === "scoped_type_identifier" || bound.type === "generic_type")) {
          ctx.relationships.push({
            source: name,
            target: this.extractTraitName(bound),
            type: ASTEngine.RelationshipType.Extends,
            confidence: 1.0,
            // M59.A7 (#825): the supertrait's own line in the bound list.
            ...(this.nodeLine(bound) ? { line_number: this.nodeLine(bound)! } : {}),
            metadata: { rustSpecific: true, traitBound: true },
          })
        }
      }
    }

    // D3: see struct export gate above.
    if (this.isUnrestrictedPublic(node) && !parent) {
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

    const traitName = traitNode ? traitNode.text : undefined
    // Impl symbols are named after the type they implement (stable identity);
    // the trait lives on the Implements relationship emitted below. Generic
    // parameter lists are stripped: `impl<T: Repository<User>> UserService<T>`
    // → `UserService`.
    //
    // R10: and the name is the type's NOMINAL name — `&mut ProcessBuilder` is
    // the type `ProcessBuilder` behind a reference, not a name called
    // `&mut ProcessBuilder`. A type with no nominal name at all takes the
    // family's declared synthetic for a construct the language does not name
    // (c's `anonymous_struct`/`anonymous_union`/`anonymous_enum`, cpp's
    // `anonymous`), and its source spelling is kept in metadata — a NAME field
    // may only carry a name.
    const nominal = this.implTypeSymbolName(typeNode)
    const implName = nominal ?? RUST_UNNAMED_IMPL

    // Use SymbolKind.Impl for Rust impl blocks
    const symbol = this.createSymbol(
      implName,
      ASTEngine.SymbolKind.Impl,
      node,
      parent,
      nominal ? { type: "impl" } : { type: "impl", implementedType: typeNode.text },
    )
    ctx.symbols.push(symbol)

    if (traitNode && traitName) {
      ctx.relationships.push({
        source: implName,
        target: this.extractTraitName(traitNode),
        type: ASTEngine.RelationshipType.Implements,
        // M59.A7 (#825): the TRAIT reference's line — the site that names the
        // target, not the implementing type's.
        ...(this.nodeLine(traitNode) ? { line_number: this.nodeLine(traitNode)! } : {}),
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

    // M49 exports invariant: only TOP-LEVEL modules export (a fn inside
    // `pub mod network` is imported as network::connect, not bare connect —
    // the module is the importable unit). Nested-mod members ride Contains.
    if (this.isUnrestrictedPublic(node) && !parent) {
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

    // D3: see struct export gate above.
    if (this.isUnrestrictedPublic(node) && !parent) {
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
      {
        type: "function",
        isConstFn,
        isAsyncFn,
        isUnsafeFn,
        // #612 store-phase: a rust `function_item` carries a body; a
        // `function_signature_item` does not — that node is a trait method
        // signature or an `extern "C" { fn f(); }` FFI declaration. Both used
        // to publish an indistinguishable `function` symbol, so the extern
        // declaration could win name resolution against the definition that
        // implements it in another file. (The node-type discriminator already
        // existed here for scope purposes; only the published fact was absent.)
        ...(node.type === "function_signature_item" ? { isDeclaration: true } : {}),
      },
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
          // R7 (M60 standing rule, enforced by G1): when a fallback has nothing
          // truthful to say, the honest state is ABSENCE, not the string
          // "unknown" — a literal in a name-bearing field becomes a parameter
          // row no source contains, which every consumer downstream can then
          // match, count and display. A self parameter's name IS `self` (the
          // grammar's self_parameter node is its own fallback, and stripping
          // `&`/`mut ` from its text leaves exactly that), so the only shape
          // that can reach the absence path is a `parameter` with no pattern:
          // an ERROR-recovered heading, which is skipped rather than named.
          const name = pName ? pName.text.replace("&", "").replace("mut ", "").trim() : ""
          if (name) params.push({ name, type: pType ? pType.text : "any" })
        }
      }
      if (params.length > 0) symbol.parameters = params
    }

    ctx.symbols.push(symbol)

    // M49 exports invariant: free fns export only at true file top level
    // (no parent at all). A `pub fn` inside `pub mod network` is imported
    // as network::connect — the module is the unit; module members ride
    // Contains. isMethod already excludes impl/trait fns.
    if (this.isUnrestrictedPublic(node) && !isMethod && !parent) {
      ctx.exports.push({
        name,
        type: ASTEngine.SymbolKind.Function,
        range: symbol.range,
        isType: false,
      })
    }

    return symbol
  }

  /** R1: file-visible VALUE names mapped to owner sets ("" = file scope).
   *  Kinds that name run-time entities readable bare: Constant
   *  (const/static), Function (callbacks), EnumMember (variants),
   *  Struct/Enum/Union/Type (constructors and unit values). Modules,
   *  macros, traits, methods, properties never resolve bare. Function
   *  bodies and const/static bodies contribute no declarations (locals);
   *  impl/trait members are associated items (never bare-readable).
   *  Use-imported leaves resolve file-wide (imports bind names too). */
  private collectValueOwners(
    rootNode: Node,
    owners: Map<string, Set<string>>,
    useImported: Set<string>,
  ): void {
    const add = (name: string | null, modOwners: string[]): void => {
      if (!name) return
      let s = owners.get(name)
      if (!s) {
        s = new Set<string>()
        owners.set(name, s)
      }
      if (modOwners.length === 0) s.add("")
      else for (const m of modOwners) s.add(m)
    }
    const leftmostId = (n: Node | null): string | null => {
      let cur = n
      while (cur) {
        if (cur.type === "identifier") return cur.text
        // M14.0.F1 (#880): `declarator` is a C/C++ field and this grammar
        // declares none — the old `childForFieldName("declarator")` was copied
        // from the cpp lane, could never match, and the named-child step below
        // carried the walk. Stated once, without the dead probe.
        cur = cur.namedChild(0)
      }
      return null
    }
    const stack: Array<{ n: Node; mods: string[]; inFn: boolean; inImpl: boolean }> = [
      { n: rootNode, mods: [], inFn: false, inImpl: false },
    ]
    while (stack.length > 0) {
      const { n, mods, inFn, inImpl } = stack.pop()!
      const t = n.type
      if (t === "mod_item") {
        const nm = n.childForFieldName("name")?.text
        const body = n.namedChild(n.namedChildCount - 1)
        const hasBody = !!body && body.type === "declaration_list"
        if (nm && hasBody) {
          for (let i = n.namedChildCount - 1; i >= 0; i--) {
            const c = n.namedChild(i)
            if (c) stack.push({ n: c, mods: [...mods, nm], inFn, inImpl })
          }
          continue
        }
      } else if (t === "function_item") {
        // Impl/trait members are associated (never bare-readable); free
        // functions (file or module scope) are values (callbacks).
        if (!inImpl) {
          const nm = n.childForFieldName("name")?.text
          if (nm) {
            if (mods.length === 0) add(nm, [])
            else add(nm, mods)
          }
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) stack.push({ n: c, mods, inFn: true, inImpl })
        }
        continue
      } else if (t === "impl_item" || t === "trait_item") {
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) stack.push({ n: c, mods, inFn, inImpl: true })
        }
        continue
      } else if (!inFn && (t === "const_item" || t === "static_item")) {
        const nm = n.childForFieldName("name")?.text ?? leftmostId(n)
        if (nm && nm !== "_" && !inImpl) add(nm, mods)
        // Bodies hold no file-visible declarations; still descend for
        // nested mods (a mod inside a const body is legal, if bizarre).
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) stack.push({ n: c, mods, inFn: true, inImpl })
        }
        continue
      } else if (
        !inFn && !inImpl &&
        (t === "struct_item" || t === "enum_item" || t === "union_item" || t === "type_item")
      ) {
        const nm = n.childForFieldName("name")?.text
        if (nm) add(nm, mods)
      } else if (t === "enum_variant") {
        // Variants are global constants (C parity) — but mod-scoped when
        // nested, so reads outside the module stay silent.
        const nm = n.childForFieldName("name")?.text ?? n.namedChild(0)?.text
        if (nm && !inFn) add(nm, mods)
      } else if (t === "use_declaration") {
        for (const leaf of this.useLeafNames(n)) {
          if (leaf && leaf !== "self" && leaf !== "*") useImported.add(leaf)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ n: c, mods, inFn, inImpl })
      }
    }
  }

  /** R1: leaf names bound by one `use` (alias-aware, self-aware). Mirrors
   *  handleUseDeclaration's leaf logic without building ImportInfo rows. */
  private useLeafNames(node: Node): string[] {
    const out: string[] = []
    const walk = (n: Node | null): void => {
      if (!n) return
      if (n.type === "identifier" || n.type === "type_identifier") {
        // A bare `use foo;` binds foo.
        if (n.parent && (n.parent.type === "use_declaration" || n.parent.type === "use_list")) out.push(n.text)
        return
      }
      // R11 (rust extreme review): a scoped single-leaf path binds its
      // LEAF (`use std::io::Read` binds Read — previously NOTHING was
      // bound, so every read of a plain-path import stayed silent while
      // braced/aliased imports resolved; the import ROW was recorded
      // correctly, only the R1 name set missed it). Only the last segment
      // binds (intermediate modules are not values); do not recurse inside
      // (the inner path segments bind nothing). A scoped path that is the
      // PREFIX of a brace group (`use foo::bar::{a}`) binds nothing — the
      // group leaves bind on their own; only direct paths and group leaves.
      if (n.type === "scoped_identifier") {
        const par = n.parent
        if (par && (par.type === "use_declaration" || par.type === "use_list")) {
          const last = n.namedChild(n.namedChildCount - 1)
          if (last && (last.type === "identifier" || last.type === "type_identifier")) {
            const t = last.text
            if (t && t !== "self" && t !== "super" && t !== "crate") out.push(t)
          }
        }
        return
      }
      if (n.type === "use_as_clause") {
        const alias = n.childForFieldName("alias") || n.namedChild(n.namedChildCount - 1)
        if (alias) out.push(alias.text)
        return
      }
      if (n.type === "self") return
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type !== "visibility_modifier" && c.type !== "use" && c.type !== "crate") walk(c)
    }
    return out
  }

  /** R1: per-function bound names (parameters + all pattern bindings in the
   *  body, closures folded in). Keyed by function_item startIndex. */
  /** R1: enclosing inline-module names for one node (outermost first). */
  private enclosingMods(node: Node | null): string[] {
    const out: string[] = []
    let cur = node ? node.parent : null
    while (cur) {
      if (cur.type === "mod_item") {
        const nm = cur.childForFieldName("name")?.text
        if (nm) out.unshift(nm)
      }
      cur = cur.parent
    }
    return out
  }

  /** R1: identifiers bound by one PATTERN subtree. In DECLARATION
   *  positions (let/param/for/let-condition patterns) every lowercase
   *  identifier binds, and UPPERCASE ones bind too (the grammar declares —
   *  `let G`, `fn f(G)`). In MATCH positions (arms, or-patterns) lowercase
   *  binds but UPPERCASE is a path pattern (`None`, `RED`) — reported via
   *  `uses` when the probe says resolvable, otherwise bound (harmless).
   *  Tuple-struct HEADS (`Some` in `Some(v)`) never bind anywhere — they
   *  name the constructor (emitted as uses when resolvable). Accepted
   *  residual: UPPERCASE locals read as uses when a same-named global
   *  exists AND the binding sits in match position. */
  private collectPatternIds(
    node: Node | null,
    out: Set<string>,
    resolves: (name: string) => boolean,
    isDecl: boolean,
  ): void {
    if (!node) return
    if (node.type === "identifier") {
      const nm = node.text
      if (!nm || nm === "_" || nm.startsWith("$")) return
      const first = nm.charCodeAt(0)
      if (first >= 65 && first <= 90 && !isDecl && resolves(nm)) return
      out.add(nm)
      return
    }
    // Type/namespace positions never bind values. (self/Self/super/crate
    // are filtered by the caller/emission gate, not here.)
    if (
      node.type === "type_identifier" || node.type === "scoped_identifier" ||
      node.type === "field_identifier" || node.type === "lifetime" ||
      node.type === "primitive_type"
    ) return
    if (node.type === "tuple_struct_pattern") {
      // First child is the constructor path — never a binding.
      for (let i = 1; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c) this.collectPatternIds(c, out, resolves, isDecl)
      }
      return
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c) this.collectPatternIds(c, out, resolves, isDecl)
    }
  }

  /** R1: per-function bound-name sets. The uppercase path-pattern rule
   *  needs resolvability: probe = file-scope owners, use-imported leaves,
   *  or the function's own enclosing modules. */
  private collectFunctionBindings(
    rootNode: Node,
    valueOwners: Map<string, Set<string>>,
    useImported: Set<string>,
  ): Map<number, Set<string>> {
    const out = new Map<number, Set<string>>()
    const stack: Node[] = [rootNode]
    const fns: Node[] = []
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "function_item") fns.push(n)
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    for (const fn of fns) {
      const bound = new Set<string>()
      const fnMods = this.enclosingMods(fn)
      const resolves = (nm: string): boolean => {
        const owners = valueOwners.get(nm)
        if (!owners) return useImported.has(nm)
        if (owners.has("")) return true
        if (useImported.has(nm)) return true
        for (const m of fnMods) if (owners.has(m)) return true
        return false
      }
      // Parameters (pattern field or the whole parameter node) — declaration
      // context: always binds, even UPPERCASE (`fn f(G: u32)` shadows).
      const params = fn.childForFieldName("parameters")
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i)
          if (!p) continue
          if (p.type === "self_parameter") continue
          const pat = p.childForFieldName("pattern") ?? p
          this.collectPatternIds(pat, bound, resolves, true)
        }
      }
      // Body walk. Declaration contexts (`let` patterns, `for` loop
      // variables) always bind; `let_condition` (if/while-let, refutable)
      // and `match_arm` patterns use match semantics (uppercase = path).
      // Pattern-typed nodes occur ONLY in pattern positions (expressions
      // use tuple_expression/call_expression/struct_expression), so no
      // value subtree is ever misread as a binder.
      const body: Node[] = [fn]
      while (body.length > 0) {
        const m = body.pop()!
        if (m.type === "let_declaration") {
          const pat = m.childForFieldName("pattern") ?? m.namedChild(0)
          this.collectPatternIds(pat, bound, resolves, true)
        } else if (m.type === "let_condition") {
          this.collectPatternIds(m.namedChild(0), bound, resolves, false)
        } else if (m.type === "for_expression") {
          // Loop variable is the first named child (irrefutable → binds).
          this.collectPatternIds(m.namedChild(0), bound, resolves, true)
        } else if (m.type === "closure_expression") {
          // R10 (rust extreme review): closure parameters bind (irrefutable
          // position — `|x|`, `|(a, b)|`, `|*p|` all declare). They were
          // never collected, so a closure param colliding with a file value
          // emitted junk `uses` (probe: `|G| G + 1` with `const G: u32`
          // emitted f->G). Folded into the enclosing function's set per the
          // documented contract (closures share it; a same-named read past
          // the closure stays suppressed — flow-insensitive residual, same
          // class as cross-arm reads).
          for (let i = 0; i < m.namedChildCount; i++) {
            const c = m.namedChild(i)
            if (c && c.type === "closure_parameters") {
              this.collectPatternIds(c, bound, resolves, true)
            }
          }
        } else if (m.type === "match_arm") {
          // Arm patterns (refutable position): sweep pattern-typed nodes
          // with match semantics. Bodies still descend normally below.
          // Nested let/for/condition declarations keep declaration
          // semantics — skip their subtrees here (the main walk binds
          // them with isDecl=true when it descends).
          //
          // R9 (rust extreme review): the arm PATTERN lives in the
          // `pattern` field wrapped in `match_pattern`, and a bare
          // binding (`v => ...`) is a BARE identifier — neither shape was
          // in the sweep list, so the binding never bound: the pattern
          // site itself and every body read of it emitted junk `uses`
          // whenever a file value collided (probe: `v => v` with
          // `const v: u32` emitted f->v). The pattern subtree is swept
          // with match semantics (bare identifiers included); the arm
          // BODY is untouched (its reads are values, never bindings).
          const patField = m.childForFieldName("pattern")
          if (patField) {
            const psub: Node[] = [patField]
            while (psub.length > 0) {
              const q = psub.pop()!
              if (
                q !== patField &&
                (q.type === "let_declaration" || q.type === "let_condition" || q.type === "for_expression")
              ) continue
              if (
                q.type === "match_pattern" || q.type === "identifier" ||
                q.type === "tuple_pattern" || q.type === "struct_pattern" ||
                q.type === "tuple_struct_pattern" || q.type === "ref_pattern" ||
                q.type === "or_pattern" || q.type === "slice_pattern"
              ) {
                this.collectPatternIds(q, bound, resolves, false)
              }
              for (let i = q.namedChildCount - 1; i >= 0; i--) {
                const c = q.namedChild(i)
                if (c) psub.push(c)
              }
            }
          }
          const sub: Node[] = [m]
          while (sub.length > 0) {
            const q = sub.pop()!
            if (
              q !== m &&
              (q.type === "let_declaration" || q.type === "let_condition" || q.type === "for_expression")
            ) continue
            if (
              q.type === "tuple_pattern" || q.type === "struct_pattern" ||
              q.type === "tuple_struct_pattern" || q.type === "ref_pattern" ||
              q.type === "or_pattern" || q.type === "slice_pattern"
            ) {
              this.collectPatternIds(q, bound, resolves, false)
            }
            for (let i = q.namedChildCount - 1; i >= 0; i--) {
              const c = q.namedChild(i)
              if (c) sub.push(c)
            }
          }
        }
        // Do not descend into nested items (a nested fn has its own entry;
        // nested closures share this function's set — documented residual).
        if (m !== fn && (m.type === "function_item" || m.type === "const_item" || m.type === "static_item")) continue
        for (let i = m.namedChildCount - 1; i >= 0; i--) {
          const c = m.namedChild(i)
          if (c) body.push(c)
        }
      }
      out.set(fn.startIndex, bound)
    }
    return out
  }

  /** R1: one bare `identifier` occurrence — emit Uses iff it names a
   *  file-visible VALUE and survives the exclusion discipline (declaration
   *  positions incl. leftmost rule, call callees incl. turbofish climb,
   *  member leaves, qualified non-leaves, preprocessor/macros/attributes/
   *  use-paths, LHS writes, where-bounds, shadowing). */
  private handleIdentifierRead(
    node: Node,
    ctx: RustContext,
    parent: ASTEngine.UniversalSymbol | null,
    valueOwners: Map<string, Set<string>>,
    useImported: Set<string>,
    fnBindings: Map<number, Set<string>>,
  ): void {
    const name = node.text
    if (!name || name === "_" || name === "self" || name === "Self" || name === "super" || name === "crate" || name.startsWith("$")) return
    const p = node.parent

    // Macro RULE bodies are templates, not code (CGD5 analog) — but macro
    // INVOCATION arguments are genuine reads.
    if (this.hasAncestor(node, "macro_definition", ["macro_invocation"])) return
    // A macro INVOCATION's NAME is a CALLEE, and the calls branch owns it
    // (RUST-D2 publishes `calls -> bail` for `bail!(…)`). The guard above covers
    // a macro DEFINITION's body; nothing covered the invocation's own `macro`
    // field, so a USE-IMPORTED macro published TWO edges for one name at one
    // line — `calls -> bail` AND `uses -> bail` — while an imported FUNCTION
    // called by name published `calls` only, because the call-callee guard below
    // matches `call_expression` and not `macro_invocation`. Measured 269 sites
    // over a 550-file slice of cargo/tokio/serde/hyper/ripgrep. R1's contract
    // excludes callees, so the read was a fabrication; and the F5 `uses` oracle
    // mirrored it (its only macro rule skips identifiers under a macro
    // DEFINITION, stopping at `macro_invocation`), so the differential agreed
    // with the fabrication and could not see it. The climb mirrors the
    // call-callee climb so a PATH-qualified macro (`std::eprintln!`) is covered
    // too, and the guard is on the `macro` FIELD alone — the invocation's
    // arguments are reads and keep publishing.
    {
      let mtop: Node = node
      let mup: Node | null = p
      while (mup && (mup.type === "scoped_identifier" || mup.type === "generic_function")) {
        mtop = mup
        mup = mup.parent
      }
      if (mup && mup.type === "macro_invocation") {
        const mfield = mup.childForFieldName("macro")
        if (mfield && mfield.startIndex === mtop.startIndex && mfield.endIndex >= mtop.endIndex) return
      }
    }
    // Attributes (`#[derive(Foo)]`) and use paths are metadata/imports.
    if (this.hasAncestor(node, "attribute_item", ["function_item", "struct_item", "enum_item", "impl_item", "trait_item", "mod_item"])) return
    if (this.hasAncestor(node, "use_declaration", null)) return
    // RUST-MR: a parameter of a FUNCTION-POINTER TYPE declares, it does not
    // read. `type PasswordStore = extern "C" fn(schema: *const SecretSchema, …)`
    // is a type alias — no body, therefore no per-function bound-name set to
    // exclude those names by — and when such a name also resolved (a
    // use-imported leaf or a file-visible value) the sweep published
    // `uses -> schema`. A real function's parameters were already excluded by the
    // bound-name set; a type's parameters had no such set. Last of the three
    // declaration-position classes this line audit found, after the macro callee
    // and the trait method signature.
    if (p && p.type === "parameter") {
      const params = p.parent
      const holder = params?.parent
      if (params?.type === "parameters" && holder && (holder.type === "bare_function_type" || holder.type === "function_type" || holder.type === "parenthesized_type")) return
      // RUST-MR: a TRAIT method SIGNATURE's parameter declares too, and it is the
      // same absence of a body: `collectFunctionBindings` collects
      // `function_item` only, so a bodiless `function_signature_item` has NO
      // bound-name set and its parameter names fell through to the read sweep.
      // Found at FULL extent, not by the 550-file sample — cargo's
      // `src/compiler/mod.rs:142-143` (`fn exec(&self, …, on_stdout_line: &mut
      // dyn FnMut(&str) -> CargoResult<()>, …) -> CargoResult<()>;` inside a
      // trait) published `uses -> on_stdout_line` and `uses -> on_stderr_line`.
      // RUST-D13's fn-pointer guard was one level too shallow: a fn-pointer TYPE
      // is a type alias and a trait SIGNATURE is a declaration, and both have
      // no body to bind a name.
      if (params?.type === "parameters") {
        let owner: Node | null = params.parent
        while (owner && owner.type !== "function_item" && owner.type !== "function_signature_item" && owner.type !== "closure_expression") owner = owner.parent
        if (owner && owner.type === "function_signature_item") return
      }
    }
    // Where-bounds belong to the dedicated where branch (R8).
    if (this.hasAncestor(node, "where_predicate", null)) return

    // Call callee (span-matched; climbs generic_function + parenthesized
    // wrappers like the calls branch's leaf logic) — the calls branch owns it.
    let top: Node = node
    let up: Node | null = p
    while (up && (up.type === "generic_function" || up.type === "parenthesized_expression")) {
      top = up
      up = up.parent
    }
    if (up && up.type === "call_expression") {
      const fnField = up.childForFieldName("function")
      if (fnField && fnField.startIndex === top.startIndex && fnField.endIndex >= top.endIndex) return
      const first = up.namedChild(0)
      if (first && first.startIndex === top.startIndex && first.endIndex >= top.endIndex) return
    }
    // Member leaves — the field path owns them; the OBJECT stays readable.
    if (p && p.type === "field_expression") {
      const field = p.childForFieldName("field")
      if (field && field.startIndex === node.startIndex) return
    }
    // Qualified paths: non-leaf segments never read; the LEAF may (unit
    // variants, assoc consts — the deliberate Rust difference from CPP).
    if (p && p.type === "scoped_identifier") {
      const last = p.namedChild(p.namedChildCount - 1)
      if (!last || last.startIndex !== node.startIndex) return
    } else if (this.hasAncestor(node, "scoped_identifier", ["call_expression", "field_expression"])) {
      return
    }
    // Assignment LHS is a WRITE (family contract).
    if (p && (p.type === "assignment_expression" || p.type === "compound_assignment_expr")) {
      const lhs = p.namedChild(0)
      if (lhs && lhs.startIndex === node.startIndex && lhs.endIndex >= node.endIndex) return
    }
    // Defining occurrences: entity names (first identifier-ish child of an
    // item node) never read. (Pattern bindings are decided by membership
    // below, not position.)
    if (p && this.isItemNamePosition(node, p)) return

    // Shadowing: bound in an enclosing function?
    let fnNode: Node | null = p
    while (fnNode && fnNode.type !== "function_item") fnNode = fnNode.parent
    if (fnNode) {
      const bound = fnBindings.get(fnNode.startIndex)
      if (bound && bound.has(name)) return
    }

    // Resolvability: file scope, use-imported, or an enclosing module.
    const owners = valueOwners.get(name)
    let ok = false
    if (owners) {
      if (owners.has("")) ok = true
      else if (useImported.has(name)) ok = true
      else {
        const mods = this.enclosingMods(node)
        for (const m of mods) {
          if (owners.has(m)) { ok = true; break }
        }
      }
    } else if (useImported.has(name)) {
      ok = true
    }
    if (!ok) return

    const source = parent?.name || "global"
    const relKey = `${source}::uses::${name}`
    if (ctx.emittedUses.has(relKey)) return
    ctx.emittedUses.add(relKey)
    ctx.relationships.push({
      source,
      target: name,
      type: ASTEngine.RelationshipType.Uses,
      confidence: 1.0,
      // M59.A7 (#825): the identifier's own line.
      ...(this.nodeLine(node) ? { line_number: this.nodeLine(node)! } : {}),
      metadata: { relationshipType: "identifier_usage", nodeType: node.type },
    })
  }

  /** True when `node` sits under an ancestor of one of `types` before
   *  crossing any node of a stop type (null stops = never stop early). */
  private hasAncestor(node: Node, types: string | string[], stopAt: string[] | null): boolean {
    const want = Array.isArray(types) ? types : [types]
    let cur: Node | null = node.parent
    while (cur) {
      if (want.includes(cur.type)) return true
      if (stopAt) {
        for (const s of stopAt) {
          if (cur.type === s) return false
        }
      }
      cur = cur.parent
    }
    return false
  }

  /** True when `node` is the defining NAME occurrence of its item parent
   *  (first identifier-ish named child of an entity-declaring node). */
  private isItemNamePosition(node: Node, parent: Node): boolean {
    switch (parent.type) {
      case "function_item":
      // RUST-MR: a TRAIT method DECLARATION is a `function_signature_item` (no
      // body), and the switch below listed `function_item` only — so a trait
      // method's own NAME fell through to the read sweep. When the name also
      // resolved (a use-imported leaf of the same name, or a file-visible value)
      // it published a `uses` edge for its own DECLARATION, and at
      // cargo-test-support/src/lib.rs:1477 that edge was a SELF-EDGE
      // (`uses current_dir -> current_dir`). The IMPLEMENTATION of the same
      // method never did, which is what made the class look like a trait quirk
      // rather than a missing node type. 10 sites survived the macro-callee fix
      // in the same 550-file slice; the whole class is trait method signatures
      // whose name collides with an import.
      case "function_signature_item":
      case "struct_item":
      case "enum_item":
      case "trait_item":
      case "mod_item":
      case "type_item":
      case "associated_type":
      case "static_item":
      case "const_item":
      case "enum_variant":
      case "field_declaration":
      case "extern_crate_declaration":
        break
      default:
        return false
    }
    for (let i = 0; i < parent.namedChildCount; i++) {
      const c = parent.namedChild(i)
      if (c && (c.type === "identifier" || c.type === "type_identifier" || c.type === "field_identifier")) {
        return c.startIndex === node.startIndex && c.endIndex === node.endIndex
      }
    }
    return false
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

    // R12 (rust extreme review): the blank identifier declares nothing —
    // `const _ : u32 = 0;` (valid Rust) minted a `_` Variable symbol
    // (GO5/Z8 class). Reads already skip blanks; extraction must too.
    // R12 (rust extreme review): the blank identifier declares nothing —
    // `const _ : u32 = 0;` (valid Rust) minted a `_` Variable symbol
    // (GO5/Z8 class). Reads already skip blanks; extraction must too.
    if (name === "_") return

    // Module/impl-level const/static/let are declarations; function-local
    // `let` bindings are execution artifacts (noise), not declaration sites.
    // A parent whose kind is Function/Method/Closure means we are inside a
    // function body — skip those. A parent of a function itself (the symbol
    // pushed by handleFunction) is also a body marker.
    //
    // RUST-MR: that comment says `let`, and `let` is the only one of the three
    // the rule is true for. A function-local `const`/`static` is not a mutable
    // local: it is a NAMED declaration with a type, a value and a line
    // (`const DETERMINISTIC_TIMESTAMP: u64 = 1153704088;` inside
    // `assert_deterministic_mtime`), and it is published everywhere else — the
    // guard was the only thing standing between the form and the graph. Measured
    // in the corpus census: 43 function-local `const` and 22 function-local
    // `static`, 0% covered, against 200/200 module-level `const` and 15/15
    // associated ones. The spec lists both node types as handled_verified, so
    // the exclusion made that claim false at the site level. `let` keeps the
    // skip (M11.11's closure boundary, and a local binding genuinely declares
    // nothing outside its body).
    if (node.type === "let_declaration" && parent && (parent.kind === ASTEngine.SymbolKind.Function || parent.kind === ASTEngine.SymbolKind.Method)) {
      return
    }

    const symbol = this.createSymbol(name, ASTEngine.SymbolKind.Variable, node, parent, { type: node.type })
    ctx.symbols.push(symbol)

    if (this.isUnrestrictedPublic(node) && !parent) {
      ctx.exports.push({
        name,
        type: ASTEngine.SymbolKind.Variable,
        range: symbol.range,
        isType: false,
      })
    }
  }

  private handleUseDeclaration(node: Node, ctx: RustContext, parent: ASTEngine.UniversalSymbol | null): void {
    const isPublic = this.isPublic(node)
    // Split the import into MODULE (path prefix) and ITEMS (local bindings,
    // alias-aware: `Write as W` binds W, `self` binds the module leaf).
    // Family contract (JS/Java): module = path, items = imported names.
    // Pre-fix, `use std::io::{Read, Write as W}` stored the whole raw text
    // as module and comma-split garbage into items (found 2026-08-28).
    const collect = (n: Node): { path: string; items: string[]; node: Node } => {
      if (n.type === "identifier" || n.type === "type_identifier") {
        return { path: n.text, items: [n.text], node: n }
      }
      if (n.type === "crate" || n.type === "super" || n.type === "self") {
        // RUST-D29 follow-on: `crate::foo` and `super::util` carry a `crate`/`super`
        // NODE in the path field, not an identifier. Restricting the FALLBACK to
        // path-bearing nodes — so that a comment can never become a module — sent this
        // recursion to the refuse branch and the prefix came back "", which is how
        // `crate::foo::{bar, Baz as B}` briefly published module `::foo` instead of
        // `crate::foo`. A path ROOT is path-bearing by definition; that was the gap
        // in the narrower rule, and the fixture caught it on the same run.
        return { path: n.text, items: [n.text], node: n }
      }
      if (n.type === "scoped_identifier") {
        // A LEADING `::` — an absolute path — has NO `path` field at all: the first
        // named child IS the name (`::libc` is a scoped_identifier whose only named
        // child is the identifier `libc`). Falling back to namedChild(0) there used
        // the name as its own prefix and doubled it, so `use ::libc::c_int;`
        // published module `libc::libc::c_int` and items `["c_int"]`. A missing
        // path field means NO PREFIX, not "assume child 0", and the leading `::` is
        // itself part of the path a consumer has to resolve, so it is kept.
        const pathNode = n.childForFieldName("path")
        const name = n.childForFieldName("name") || n.namedChild(n.namedChildCount - 1)
        const p = pathNode ? collect(pathNode).path + "::" : n.text.startsWith("::") ? "::" : ""
        return { path: p + (name ? name.text : ""), items: [name ? name.text : ""], node: n }
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
        return { path: base, items, node: n }
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
        return { path: "", items, node: n }
      }
      if (n.type === "use_as_clause") {
        const path = n.childForFieldName("path") || n.namedChild(0)
        const aliasName = n.childForFieldName("alias") || n.namedChild(n.namedChildCount - 1)
        return { path: path ? collect(path).path : n.text, items: [aliasName ? aliasName.text : (path ? collect(path).items[0] : n.text)], node: n }
      }
      if (n.type === "use_wildcard") {
        // use super::util::* — module = path prefix, item = "*"
        const inner = n.namedChild(0)
        const path = inner ? collect(inner).path : n.text
        return { path, items: ["*"], node: n }
      }
      // RUST-D29: the fallback used to accept ANY node and publish its raw text as a
      // module path. In a use_list that means a COMMENT or a stray separator becomes
      // an import: `use {a ,, b}` published module `,`, `use {/* Pre-comment! */
      // Foo, Bar}` published `/* Pre-comment! */`, and a `// FIXME` line inside a
      // group published the whole comment sentence. 14 such rows at full extent, all
      // in parse-recovery or rustfmt-test files — the same shape as the `str!` gap,
      // where the grammar gives up and the recovery tree contains tokens that are not
      // paths. A module path must be spelled from path-bearing nodes only, so the
      // fallback is restricted to those and everything else yields no row at all.
      if (n.type === "use_as_clause" || n.type === "scoped_use_list" || n.type === "use_list" || n.type === "scoped_identifier") {
        return { path: n.text, items: [n.text], node: n }
      }
      return { path: "", items: [], node: n }
    }

    // Aggregate one import row per distinct module prefix. A TOP-LEVEL GROUP
    // import (`use {a::X, b::Y};`) has its use_list as a direct child with NO
    // shared prefix — each binding becomes its own row with its own full
    // module path (RSD6b: the pre-fix code fabricated module 'Read, File' by
    // joining items; 28 such declarations across cargo+ripgrep).
    const rows: { path: string; items: string[]; node: Node }[] = []
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
    const mergedRows: { path: string; items: string[]; node: Node }[] = []
    for (const r of rows) {
      const ex = mergedRows.find((m) => m.path === r.path && m.items[0] !== "*" && r.items[0] !== "*")
      if (ex) ex.items.push(...r.items)
      else mergedRows.push({ path: r.path, items: [...r.items], node: r.node })
    }

    const modulePath = mergedRows[0].path
    for (const row of mergedRows) {
      ctx.imports.push({
        module: row.path,
        source: row.path,
        items: row.items,
        // RUST-D27: the range is the PATH's, not the whole declaration's. A
        // multi-line group (`use {\n    aho_corasick::AhoCorasick,\n    bstr,\n};`)
        // gave every one of its rows the line of the `use` keyword, so the record
        // pointed at a line that does not bear the path it names — 56 such records
        // in ripgrep alone, found by the first audit ever run over this channel.
        range: (() => {
          const n2 = row.node ?? node
          return {
            startLine: n2.startPosition.row + 1, startColumn: n2.startPosition.column + 1,
            endLine: n2.endPosition.row + 1, endColumn: n2.endPosition.column + 1,
            startIndex: n2.startIndex, endIndex: n2.endIndex,
          }
        })(),
        metadata: { rustSpecific: true, isPublic },
      })
    }

    // D3: re-exported paths are externally importable only when
    // unrestricted-pub at true file top level (members ride Contains).
    if (this.isUnrestrictedPublic(node) && !parent && modulePath) {
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
    // RUST-D30: set only on the `Self(..)` path, where the callee is a single
    // identifier but a KEYWORD with one meaning. It travels with the call because
    // by the time the instantiation surface runs, `target` is the resolved type.
    let selfSpelling = false
    // M59.A7 (#825): the leaf that NAMES the callee. A `field_expression`
    // starts at its VALUE (`self.repository.find()` starts at `self`) and a
    // `scoped_identifier` at its leftmost segment, so the construct-start node
    // is the wrong site — and Rust allows a call chain to break before the dot
    // (`repo\n.find(id)`), which makes it a line too early in real code.
    let calleeNameNode: Node | null = null

    if (functionNode.type === "field_expression") {
      // obj.method() or self.method()
      const fieldNode = functionNode.childForFieldName("field")
      const valueNode = functionNode.childForFieldName("value")
      if (fieldNode) {
        target = fieldNode.text
        qualified = valueNode ? `${valueNode.text}.${fieldNode.text}` : fieldNode.text
        calleeNameNode = fieldNode
      }
    } else if (functionNode.type === "scoped_identifier") {
      // std::fs::read() or crate::foo::bar()
      const nameNode = functionNode.childForFieldName("name") || functionNode.namedChild(functionNode.namedChildCount - 1)
      if (nameNode) {
        target = nameNode.text
        qualified = functionNode.text
        calleeNameNode = nameNode
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
            calleeNameNode = fieldNode
          }
        } else if (baseNode.type === "scoped_identifier") {
          const nameNode = baseNode.childForFieldName("name") || baseNode.namedChild(baseNode.namedChildCount - 1)
          if (nameNode) {
            target = nameNode.text
            qualified = baseNode.text
            calleeNameNode = nameNode
          }
        } else if (baseNode.text === "Self") {
          // R10/R7 follow-through on the turbofish form `Self::<T>(x)`.
          const resolved = this.enclosingImplType(node)
          if (!resolved) return
          target = resolved
          qualified = resolved
          calleeNameNode = baseNode
        } else {
          target = baseNode.text
          qualified = baseNode.text
          calleeNameNode = baseNode
        }
      }
    } else {
      // Simple identifier: foo(). Non-identifier callees — parenthesized
      // closure calls ((self.0)(...)) — have no static name and must not
      // fabricate a target (the differential oracle derives none either).
      if (functionNode.type === "identifier") {
        // R10/R7 follow-through (found by the F14 name-surface gate when it
        // was extended to rust): `Self(..)` calls the enclosing impl type's
        // CONSTRUCTOR, and `Self` is a KEYWORD — never a symbol NAME. The lane
        // already refuses it as a name on the read surface
        // (`handleIdentifierRead` skips `self`/`Self`/`super`/`crate`) and
        // already resolves it on the instantiates surface (D2), so publishing
        // the literal here made `calls` the one surface where `Self` was a
        // target — 6 rows on cargo (`Ok(Self(name))` in
        // cargo-util-schemas/src/manifest/mod.rs, `Self(ProcessEnv)` in
        // build-rs/src/input.rs). The callee's name is the enclosing type's,
        // exactly as `Name(..)` is spelled; a trait default body has no impl
        // to resolve (and no tuple struct to construct), so there the callee
        // has NO name and the edge is omitted — absence, not the literal.
        if (functionNode.text === "Self") {
          const resolved = this.enclosingImplType(node)
          if (!resolved) return
          target = resolved
          qualified = resolved
          calleeNameNode = functionNode
          // RUST-D30: `Self(..)` reaches the instantiation branch with `target`
          // already RESOLVED to the enclosing type, so the bare-spelling test there
          // sees `Wrap` and cannot tell it apart from a real `Wrap(..)` call. Mark
          // it here, where the keyword is still visible, as SPELLED evidence: `Self`
          // is a keyword with one meaning and is never ambiguous with the prelude.
          selfSpelling = true
        } else {
          target = functionNode.text
          qualified = target
          calleeNameNode = functionNode
        }
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
      ...(this.nodeLine(calleeNameNode) ? { line_number: this.nodeLine(calleeNameNode)! } : {}),
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
    //   D2: `Self` receivers / bare `Self(..)` construct the enclosing
    //   impl type (previously filtered as unresolvable noise).
    let instTarget: string | null = null
    let bareSpelling = false
    if (functionNode.type === "field_expression" || functionNode.type === "scoped_identifier") {
      // Receiver TYPE: value (field_expression) or path (scoped_identifier).
      const receiver =
        functionNode.childForFieldName("value") ??
        functionNode.childForFieldName("path") ??
        functionNode.namedChild(functionNode.namedChildCount - 2)
      if (target === "new" && receiver) {
        const recvText = this.stripGenerics(receiver.text)
        let leaf = recvText.split("::").filter(Boolean).pop() ?? ""
        // R10/R7: an unresolvable `Self` constructs an unnamed type, and an
        // unnamed type has no name — absence, never the raw literal.
        if (leaf === "Self") leaf = this.enclosingImplType(node) ?? ""
        // ≡ /^[A-Z]/ — first char in A-Z (rust upper-camel types).
        if (leaf.length > 0 && leaf.charCodeAt(0) >= 65 && leaf.charCodeAt(0) <= 90) instTarget = leaf
      }
    } else if (target.length > 0 && target.charCodeAt(0) >= 65 && target.charCodeAt(0) <= 90) {
      // RUST-D30: a BARE single-segment callee is ambiguous against the prelude.
      // `Ok(())` is the prelude's variant, and with a local `struct Ok;` in the same
      // file the deferred `inFile` filter resolved it to that struct and published
      // `instantiates -> Ok` — an edge created by a NAME COLLISION, with no
      // relationship to the local type because it was never mentioned. A receiver
      // that is spelled (`LocalType { .. }`, `path::to::LocalType { .. }`, a
      // resolvable `Self(..)`, an imported alias) is evidence; a bare name is not,
      // and the analyzer already refuses to guess for the ambiguous `new`/`from`
      // family, so it must refuse here too. `bareSpelling` carries that fact to the
      // deferred pass, where the in-file filter finally runs.
      instTarget = target
      // `Self(..)` arrives here with `target` ALREADY RESOLVED to the enclosing
      // type, so this branch cannot see that it was a keyword rather than a
      // same-named local identifier \u2014 which is precisely the case D30 exempts.
      if (!selfSpelling) bareSpelling = true
    }
    if (instTarget === "Self") instTarget = this.enclosingImplType(node) ?? null
    // DEFERRED resolution: constructor candidates emit only when the type
    // resolves to an IN-FILE symbol. Immediate emission fired on every
    // std/external type (Arc, Ok, foreign builders) - 90%+ noise that could
    // never resolve to a project symbol.
    if (instTarget) {
      // M59.A7 (#825): the constructed TYPE's naming node — the receiver of
      // `Foo::new()` / `Foo::default()`, or the callee itself for a PascalCase
      // constructor call.
      const instNameNode =
        functionNode.type === "identifier"
          ? functionNode
          : functionNode.type === "scoped_identifier"
            ? (functionNode.childForFieldName("path") ?? functionNode)
            : (functionNode.childForFieldName("value") ?? functionNode)
      ctx.pendingInstantiations.push({
        source,
        target: instTarget,
        qualified,
        line: this.nodeLine(instNameNode),
        bareSpelling,
      })
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
    // M59.A7 (#825): the name node, not the scoped path's leftmost segment.
    let macroNameNode: Node | null = macroNode

    if (macroNode.type === "scoped_identifier") {
      // std::println!() or crate::my_macro!()
      const nameNode = macroNode.childForFieldName("name") || macroNode.namedChild(macroNode.namedChildCount - 1)
      macroName = nameNode ? nameNode.text : macroNode.text
      macroNameNode = nameNode ?? macroNode
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
      ...(this.nodeLine(macroNameNode) ? { line_number: this.nodeLine(macroNameNode)! } : {}),
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
