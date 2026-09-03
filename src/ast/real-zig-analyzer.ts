import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

/**
 * REAL ZIG ANALYZER v6.0 — declaration-site-only extraction.
 *
 * Grounded in the verified tree-sitter-zig AST shape:
 *   - Top-level and container-level `variable_declaration` nodes carry the
 *     container kinds: `const X = struct {...}`, `enum {...}`, `union(enum) {...}`,
 *     `error{...}`, or plain constants/type aliases.
 *   - `container_field` nodes are struct/union members (→ Property) or enum
 *     members (→ EnumMember).
 *   - `function_declaration` nodes are Methods inside containers, Functions at
 *     file scope.
 *   - Control-flow, type-annotation, call, block, and field-access nodes are
 *     EXECUTION ARTIFACTS, not declaration sites — they never become symbols.
 */
export class RealZigAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // Walk context: node + the nearest enclosing declaration context.
    // Context is null (file scope), a container symbol (struct/enum/union), or
    // a function symbol (whose body must not produce declaration symbols).
    const walkStack: { node: Node; container: ASTEngine.UniversalSymbol | null; inFunction: boolean }[] = [
      { node: rootNode, container: null, inFunction: false },
    ]

    while (walkStack.length > 0) {
      const item = walkStack.pop()!
      const { node, container, inFunction } = item
      const type = node.type
      const nodeText = this.nodeText(node)

      // ─── CONTAINER / CONSTANT DECLARATION: const X = ... ───
      if (type === "variable_declaration") {
        // Inside a function body: locals are execution artifacts — skip.
        if (inFunction) {
          this.pushChildren(node, walkStack, container, inFunction)
          continue
        }

        const identNode = this.anyChild(node, (n) => n.type === "identifier")
        const varName = identNode ? identNode.text : ""
        if (!varName || varName.length > 80) {
          this.pushChildren(node, walkStack, container, inFunction)
          continue
        }

        const isExported = this.hasToken(node, "pub") || this.hasToken(node, "export")
        const children = this.getAllNamedChildren(node)
        const rhs = children[children.length - 1]
        const rhsType = rhs?.type || ""
        const rhsText = rhs ? this.nodeText(rhs) : ""

        // @import / @cImport: an import, not a symbol.
        if (rhsType === "call_expression" || rhsType === "builtin_function") {
          const builtin = this.anyChild(rhs, (n) => n.type === "builtin_identifier")
          if (builtin && (builtin.text === "@import" || builtin.text === "@cImport")) {
            const argsNode = this.anyChild(rhs, (n) => n.type === "arguments")
            const strNode = argsNode ? this.anyChild(argsNode, (n) => n.type === "string" || n.type === "string_content") : null
            if (strNode) {
              let importTarget = strNode.text
              if (
                (importTarget.startsWith('"') && importTarget.endsWith('"')) ||
                (importTarget.startsWith("'") && importTarget.endsWith("'"))
              ) {
                importTarget = importTarget.substring(1, importTarget.length - 1)
              }
              imports.push({
                module: importTarget,
                isDefaultImport: false,
                range: this.nodeRange(node),
                metadata: { zigImport: true, builtin: builtin.text },
              })
              // Family-standard import reference (c wave: an @import is a
              // first-class graph fact, pinned via meta.isImport). The target
              // is the module path literal (@import("std") -> "std"), which
              // resolves like c's #include dependency edge — not a phantom
              // symbol edge. classifyEvidenceTier marks non-declared_type
              // references as `import_based`.
              relationships.push({
                source: "(global)",
                target: importTarget,
                type: ASTEngine.RelationshipType.References,
                confidence: 1.0,
                metadata: { relationshipType: "zig_import", isImport: true },
              })
            }
            this.pushChildren(node, walkStack, container, inFunction)
            continue
          }
        }

        // `const` vs `var` (anonymous tokens, probe-verified): a mutable
        // global `var` is a Variable, not a Constant (deep-review finding
        // 2026-08-29 — previously every global was labeled constant).
        const isVar = this.hasToken(node, "var")
        let kind: ASTEngine.SymbolKind = isVar ? ASTEngine.SymbolKind.Variable : ASTEngine.SymbolKind.Constant
        const isContainer =
          rhsType === "struct_declaration" ||
          rhsType === "enum_declaration" ||
          rhsType === "union_declaration" ||
          rhsType === "error_set_declaration"

        if (rhsType === "struct_declaration") kind = ASTEngine.SymbolKind.Struct
        else if (rhsType === "enum_declaration") kind = ASTEngine.SymbolKind.Enum
        else if (rhsType === "union_declaration") kind = ASTEngine.SymbolKind.Union
        else if (rhsType === "error_set_declaration") kind = ASTEngine.SymbolKind.Enum
        else if (
          // Real tree-sitter-zig value-literal node types (probe-verified
          // 2026-08-29: `boolean`/`character`, NOT the go/java-family
          // `boolean_literal`/`char_literal`/`number_literal` left over from an
          // earlier analyzer copy — those dead literals never matched, so bool/
          // char consts fell through to the name-heuristic below).
          rhsType === "integer" ||
          rhsType === "float" ||
          rhsType === "string" ||
          rhsType === "boolean" ||
          rhsType === "character" ||
          rhsType === "builtin_type"
        ) {
          // Value constant (`const MAX_POINTS: usize = 1024`) — not a type.
          // A `var` global stays Variable even for literal RHS.
          if (!isVar) kind = ASTEngine.SymbolKind.Constant
        } else if (varName[0] === varName[0].toUpperCase() && varName[0] !== varName[0].toLowerCase()) {
          kind = ASTEngine.SymbolKind.Type
        }

        const sym: ASTEngine.UniversalSymbol = {
          name: varName,
          kind,
          visibility: isExported ? "public" : "private",
          range: this.nodeRange(node),
          scope: container ? container.name : undefined,
          ownerName: container?.name,
          ownerKind: container?.kind,
          metadata: {
            zigDeclaration: kind,
            ...(rhsType === "error_set_declaration" ? { zigErrorSet: true } : {}),
          },
        }
        symbols.push(sym)
        if (isExported) exports.push({ name: varName, kind })

        // Container members belong to the new container symbol.
        const newContainer = isContainer ? sym : container
        this.pushChildren(node, walkStack, newContainer, inFunction)
        continue
      }

      // ─── FUNCTION DECLARATION: pub fn name(...) ───
      if (type === "function_declaration" || type === "function_signature") {
        const identNode = this.anyChild(node, (n) => n.type === "identifier")
        const fnName = identNode ? identNode.text : ""
        const isExported = this.hasToken(node, "pub") || this.hasToken(node, "export")
        const isInline = this.hasToken(node, "inline")

        // Methods of an ANONYMOUS struct returned by a generic function
        // (`fn GenericStack(...) type { return struct { fn push(...) } }`) have
        // no named container — they must not become file-scope functions.
        const isAnonymousContainerMember = !container && inFunction

        if (fnName && fnName.length < 100 && !isAnonymousContainerMember) {
          const params: ASTEngine.Parameter[] = []
          const paramsNode = this.anyChild(node, (n) => n.type === "parameters")
          if (paramsNode) {
            for (let i = 0; i < paramsNode.namedChildCount; i++) {
              const child = paramsNode.namedChild(i)
              if (!child || child.type !== "parameter") continue
              const pNameNode = this.anyChild(child, (n) => n.type === "identifier")
              const pTypeNode = this.anyChild(
                child,
                (n) =>
                  n.type === "builtin_type" ||
                  n.type === "nullable_type" ||
                  n.type === "slice_type" ||
                  n.type === "pointer_type" ||
                  n.type === "error_union_type",
              )
              if (pNameNode) {
                params.push({
                  name: pNameNode.text,
                  type: pTypeNode ? this.nodeText(pTypeNode) : undefined,
                })
              }
            }
          }

          // Inside a struct/union/enum container → method; else free function.
          const isMethod = !!container && container.kind !== ASTEngine.SymbolKind.Type
          const sym: ASTEngine.UniversalSymbol = {
            name: fnName,
            kind: isMethod ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
            visibility: isExported ? "public" : "private",
            range: this.nodeRange(node),
            scope: container ? container.name : undefined,
            parameters: params,
            ownerName: container?.name,
            ownerKind: container?.kind,
            // Per-symbol cyclomatic complexity (family standard — go/c/rust
            // emit symbol.complexity; zig did NOT, so completeness section C
            // was impossible). Added zig wave 2026-08-29.
            complexity: this.zigBodyComplexity(node),
            metadata: { zigFunction: true, inline: isInline, paramCount: params.length },
          }
          symbols.push(sym)
          if (isExported && !isMethod) exports.push({ name: fnName, kind: ASTEngine.SymbolKind.Function })
        }
        // Function body: execution artifacts only — no declaration symbols.
        this.pushChildren(node, walkStack, container, true)
        continue
      }

      // ─── CONTAINER FIELD: struct/union member or enum member ───
      // Requires a NAMED container: fields of an anonymous struct returned by
      // a generic function (`fn GenericStack(...) type { return struct {...} }`)
      // have no stable container identity and must NOT become file-scope
      // symbols (C negative contract: anonymous containers are not named).
      if (type === "container_field") {
        if (!container) {
          this.pushChildren(node, walkStack, container, inFunction)
          continue
        }
        const nameNode = this.anyChild(node, (n) => n.type === "identifier")
        const fieldName = nameNode ? nameNode.text : ""
        if (fieldName && fieldName.length < 50) {
          const isEnumMember = container?.kind === ASTEngine.SymbolKind.Enum
          const typeNode = this.anyChild(
            node,
            (n) =>
              n.type === "builtin_type" ||
              n.type === "nullable_type" ||
              n.type === "slice_type" ||
              n.type === "pointer_type" ||
              n.type === "error_union_type",
          )
          symbols.push({
            name: fieldName,
            kind: isEnumMember ? ASTEngine.SymbolKind.EnumMember : ASTEngine.SymbolKind.Property,
            visibility: "public",
            range: this.nodeRange(node),
            scope: container?.name,
            ownerName: container?.name,
            ownerKind: container?.kind,
            returnType: isEnumMember ? undefined : typeNode ? this.nodeText(typeNode) : undefined,
            metadata: { zigField: true, ...(isEnumMember ? { zigEnumMember: true } : {}) },
          })
        }
        this.pushChildren(node, walkStack, container, inFunction)
        continue
      }

      // ─── ERROR SET MEMBERS: error{ InvalidPoint, OutOfMemory } ───
      // Only identifiers that are DIRECT children of the error_set node are
      // members; the declaring variable's LHS identifier is not one.
      if (type === "identifier" && container && container.metadata?.zigErrorSet && node.parent?.type === "error_set_declaration") {
        const identText = node.text
        if (identText && identText.length < 50) {
          symbols.push({
            name: identText,
            kind: ASTEngine.SymbolKind.EnumMember,
            visibility: "public",
            range: this.nodeRange(node),
            scope: container.name,
            ownerName: container.name,
            ownerKind: container.kind,
            metadata: { zigErrorSetMember: true },
          })
        }
        continue
      }

      // (No relationship for switch_expression — `switch` is a keyword, not a
      // symbol; a `references -> switch` edge would be a phantom that never
      // resolves. Control flow is an execution artifact, family contract.)

      // ─── ERROR REPORTING ───
      if (node.hasError || type === "ERROR") {
        const snippet = nodeText.substring(0, 50)
        errors.push({
          message: `Zig syntax error: ${snippet}`,
          range: {
            startLine: node.startPosition.row + 1,
            startColumn: node.startPosition.column,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column,
          },
          severity: "error",
        })
      }

      // ─── PUSH CHILDREN (default: preserve container/function context) ───
      this.pushChildren(node, walkStack, container, inFunction)
    }    // Contains relationships for owned symbols
    for (const s of symbols) {
      if (s.ownerName) {
        relationships.push({
          source: s.ownerName,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          metadata: {},
        })
      }
    }

    // Call and field-access relationships (family contract, added zig wave
    // 2026-08-29). A call_expression emits a `calls` edge to the callee LEAF
    // name (identifier `helper` -> helper; field_expression callee
    // `list.append`/`std.math.abs` -> append/abs). A field_expression that is
    // NOT the direct callee of a call emits a `uses` edge to its field leaf
    // (list.items.len -> len, list.allocator -> allocator, list.items ->
    // items). Source = the enclosing function/method name; struct-local
    // field reads are attributed to the method body that reads them. The
    // analyzer previously emitted NO calls/uses relationships at all — a
    // 30 KB std source with 56 call sites produced zero edges.
    this.analyzeZigCodeRelationships(rootNode, relationships, symbols)

    // Declared-type reference graph (family standard — mirrors go/c/rust):
    // parameter types, return types, struct/union field types emit a
    // `references` edge to their leaf type name (builtin types excluded). A
    // `const HashMap = std.StringHashMap(usize)` type alias does NOT emit a
    // reference — the RHS is a generic type application, not a declared-type
    // dependency (analyzer-verified zig wave 2026-08-29).
    this.extractZigDeclaredTypeRefs(rootNode, relationships)

    // #419-D evidence-tier classification for every emitted relationship
    // (family rules — go/rust/c/cpp all classify; zig did NOT).
    this.classifyEvidenceTier(relationships)

    // No References edge for imports (imports stay in the imports array) and
    // no generic `exports module -> X` edge — `module` is not a symbol, so the
    // edge would never resolve (Java-family contract; the exports array and
    // the `pub` visibility metadata carry the export fact).
    return {
      language: "zig",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length,
        linesOfCode: content.split("\n").length,
        patterns: [],
        framework: "Zig",
        hasFrameworkIntelligence: true,
        hasTypeInference: true,
      },
    }
  }

  /**
   * Calls + Uses (family contract, zig wave 2026-08-29).
   * Walks the tree tracking the enclosing function/method name; a
   * call_expression whose callee is an identifier or a field_expression emits
   * a `calls` edge to the callee LEAF (Rust/Go contract — shared callee
   * `self.repository.add` -> `add`); a field_expression that is NOT a call
   * callee emits a `uses` edge to its field leaf. Builtin calls (@import,
   * @intCast, ...) are compile-time intrinsics, NOT user symbols — skipped.
   */
  private analyzeZigCodeRelationships(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const emittedCalls = new Set<string>()
    const emittedUses = new Set<string>()
    const stack: { node: Node; fn: string | null; inFn: boolean }[] = [{ node: rootNode, fn: null, inFn: false }]
    while (stack.length > 0) {
      const { node: n, fn, inFn } = stack.pop()!
      let nextFn = fn
      let nextInFn = inFn
      if (n.type === "function_declaration") {
        const nameNode = this.anyChild(n, (c) => c.type === "identifier")
        if (nameNode) { nextFn = nameNode.text; nextInFn = true }
      }
      if (n.type === "call_expression") {
        const leaf = this.zigCalleeLeaf(n)
        // NOTE (zig wave, 2026-08-29): NO `leaf !== nextFn` guard here. A
        // same-named method called from within that method (IconDir.
        // writeResData calling entry.writeResData; initComptime calling
        // initComptime) is a REAL call edge, and the differential oracle
        // derives it without any name-guard. Dropping the guard restores
        // analyzer<->oracle parity (the old guard silently lost 5 edges on
        // the upstream corpus). Self-recursion (f -> f) is likewise a
        // legitimate edge and is kept.
        if (leaf) {
          // Top-level / comptime / test-block initializers (`const assert =
          // std.debug.assert;`, `test {...}`) are real call sites outside any
          // function body (go family contract: package-scope calls emit with
          // source "global").
          const source = nextInFn && nextFn ? nextFn : "(global)"
          const k = `${source}->${leaf}`
          if (!emittedCalls.has(k)) {
            emittedCalls.add(k)
            relationships.push({
              source,
              target: leaf,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.85,
              metadata: { relationshipType: "zig_function_call", callExpression: n.text.slice(0, 60) },
            })
          }
        }
      }
      if (n.type === "field_expression" && !this.isCallCallee(n)) {
        const field = this.zigFieldLeaf(n)
        const notBuiltinAccess =
          this.anyChild(n, (c) => c.type === "identifier") !== null
        if (field && notBuiltinAccess) {
          const source = nextInFn && nextFn ? nextFn : "(global)"
          const k = `${source}->${field}`
          if (!emittedUses.has(k)) {
            emittedUses.add(k)
            relationships.push({
              source,
              target: field,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.75,
              metadata: { relationshipType: "zig_field_access", fieldAccessExpression: n.text.slice(0, 60) },
            })
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ node: c, fn: nextFn, inFn: nextInFn })
      }
    }
  }

  /** Builtin @-prefixed calls and generic type applications are not user
   *  call targets. Returns the leaf name for a real user call site, else
   *  undefined. */
  private zigCalleeLeaf(call: Node): string | undefined {
    const callee = call.namedChildCount > 0 ? call.namedChild(0) : null
    if (!callee) return undefined
    if (callee.type === "identifier") {
      // Skip builtin intrinsics (@foo).
      return callee.text
    }
    if (callee.type === "field_expression") {
      return this.zigFieldLeaf(callee)
    }
    // call_expression whose callee is a builtin_function / generic_identifier
    // / pointer_wrapped — not a plain user call.
    return undefined
  }

  /** Leaf name of a field_expression (`std.math.abs` -> abs, `list.items` ->
   *  items). */
  private zigFieldLeaf(expr: Node): string | undefined {
    const last = expr.namedChildCount > 0 ? expr.namedChild(expr.namedChildCount - 1) : null
    if (last && last.type === "identifier") return last.text
    return undefined
  }

  /** True when this field_expression is the direct callee of a call_expression
   *  (list.append in `list.append()`) — then the calls edge is the fact, not
   *  a uses edge. Also skips builtin access `std.foo`. */
  private isCallCallee(expr: Node): boolean {
    const p = expr.parent
    return !!p && p.type === "call_expression"
  }

  /**
   * Declared-type reference graph (family standard — go/c/rust M14). Collects
   * the leaf names of parameter types, return types, and struct/union/enum/
   * error-set field types, emitting `references` edges. Builtins and the bare
   * `void`/`!void` wrappers are excluded; generic type applications on a var
   * RHS (std.StringHashMap(usize)) are NOT declared-type deps.
   */
  private extractZigDeclaredTypeRefs(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const BUILTINS = new Set(["void", "bool", "f16", "f32", "f64", "f80", "f128", "c_longdouble", "i8", "i16", "i32", "i64", "i128", "isize", "u8", "u16", "u32", "u64", "u128", "usize", "anytype", "comptime_int", "comptime_float", "noreturn", "type", "anyerror", "c_char", "c_short", "c_int", "c_long", "c_longlong", "c_uint", "c_ulong", "c_ulonglong", "c_void", "error", "test"])
    const emitted = new Set<string>()
    const push = (leaf: string) => {
      if (!leaf) return
      const trim = leaf.replace(/[!*\s\[\]\{\}]+/g, "").trim()
      if (!trim) return
      const base = trim.split("<or>")[0] ?? trim
      const head = base.indexOf("=") !== -1 ? base.slice(0, base.indexOf("=")).trim() : base
      if (!head || BUILTINS.has(head) || /^\d/.test(head)) return
      if (!emitted.has(head)) {
        emitted.add(head)
        relationships.push({
          source: "(declared-type)",
          target: head,
          type: ASTEngine.RelationshipType.References,
          confidence: 0.9,
          metadata: { relationshipType: "declared_type" },
        })
      }
    }
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "function_declaration") {
        const paramsNode = this.anyChild(n, (c) => c.type === "parameters")
        if (paramsNode) {
          for (let i = 0; i < paramsNode.namedChildCount; i++) {
            const param = paramsNode.namedChild(i)
            if (param?.type !== "parameter") continue
            const t = this.zigTypeLeaf(param)
            if (t) push(t)
          }
        }
        // Return type: look for error_union_type / builtin_type / stdlib type
        // NOTE: NO `return_type` literal here — tree-sitter-zig has no such
        // node (dead literal removed in the zig wave grammar audit). Return
        // types appear as error_union_type / nullable_type / pointer_type /
        // slice_type / builtin_type.
        const ret = this.anyChild(n, (c) => c.type === "error_union_type" || c.type === "nullable_type" || c.type === "pointer_type" || c.type === "slice_type" || c.type === "builtin_type")
        const retLeaf = ret ? this.zigTypeLeaf(ret) : undefined
        if (retLeaf) push(retLeaf)
      }
      if (n.type === "container_field") {
        // struct/union/enum member type
        const t = this.zigTypeLeaf(n)
        if (t) push(t)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /** Best-effort single leaf type name for a parameter/field/return node.
   *
   * Deep-review fixes (2026-08-29, final zig pass):
   *   (1) builtin_type nodes are NO LONGER collected — they are never
   *       declared-type dependencies and, worse, shadowed the real leaf:
   *       `map: *std.StringHashMap(usize)` returned "usize" (the generic
   *       argument, a builtin) and the StringHashMap dependency was silently
   *       lost. A local generic `x: MyList(u32)` lost MyList identically.
   *   (2) for parameter/container_field, the FIRST identifier is the
   *       declaration NAME (`flags: Flag` -> name "flags") — it is excluded
   *       so the leaf is the type. A bare identifier node (plain return
   *       type `fn f() MyError`) IS the type and is returned directly.
   *   (3) enum members (`North`) and builtin-only fields (`sides: u32`)
   *       now yield undefined — no more phantom declared-type refs to
   *       enum members. */
  private zigTypeLeaf(node: Node): string | undefined {
    if (node.type === "identifier") return node.text
    const idents: string[] = []
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 200) {
      const n = stack.pop()!
      if (n.type === "identifier") idents.push(n.text)
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    if (idents.length === 0) return undefined
    // parameter/container_field: child 0 is the declaration NAME — drop it.
    if (
      (node.type === "parameter" || node.type === "container_field") &&
      node.namedChildCount > 0 &&
      node.namedChild(0)?.type === "identifier"
    ) {
      idents.shift()
      if (idents.length === 0) return undefined
    }
    // The LAST identifier after the name is the type leaf.
    return idents[idents.length - 1]
  }

  /** Per-symbol cyclomatic complexity of a function/method body (family
   *  standard — go/c/rust all emit symbol.complexity; zig did NOT).
   *
   * Deep-review fixes (2026-08-29, final zig pass):
   *   (1) Expression forms if_expression / for_expression / while_expression
   *       are Zig's DOMINANT forms (`const a = if (c) 1 else 2;`) and were
   *       never counted — only the statement forms were. All six now count.
   *   (2) `else` in expression forms is an ANONYMOUS token inside the
   *       if_expression (probe-verified), not an else_clause — both are
   *       counted now (else_clause node OR hasToken "else").
   *   (3) binary_expression used a substring trap: `t.indexOf("and")`
   *       falsely matched identifiers (`x + standard + order` -> +2). The
   *       operator is an anonymous child token (`and`/`or`/`orelse`,
   *       probe-verified) — we now match the token type exactly. */
  private zigBodyComplexity(node: Node): number {
    let c = 1
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (
        n.type === "if_statement" ||
        n.type === "if_expression" ||
        n.type === "for_statement" ||
        n.type === "for_expression" ||
        n.type === "while_statement" ||
        n.type === "while_expression" ||
        n.type === "switch_expression" ||
        n.type === "else_clause" ||
        n.type === "catch_expression"
        // NOTE: NO `orelse_expression` literal — tree-sitter-zig models
        // `a orelse b` as a binary_expression (anonymous `orelse` token),
        // probe-verified 2026-08-29. orelse is counted via the operator
        // token check below.
      ) {
        c++
      }
      // `else` branch of an if/for/while EXPRESSION is an anonymous `else`
      // token (probe-verified: if_expression children include else(anon)).
      // else_clause (statement form) is already counted above.
      if (
        (n.type === "if_expression" || n.type === "for_expression" || n.type === "while_expression") &&
        this.hasToken(n, "else")
      ) {
        c++
      }
      if (n.type === "binary_expression") {
        // The operator is an anonymous child token (and/or/orelse/+ etc.) —
        // match the token TYPE, never substrings of the whole expression text
        // ("x + standard + order" must NOT count; "a and b" must).
        for (let i = 0; i < n.childCount; i++) {
          const op = n.child(i)
          if (op && !op.isNamed && (op.type === "and" || op.type === "or" || op.type === "orelse")) {
            c++
            break
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c2 = n.namedChild(i)
        if (c2) stack.push(c2)
      }
    }
    return c
  }

  /** #419-D evidence-tier classification for every emitted relationship
   *  (family rules — rust/c/cpp/go all classify; zig did NOT). */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        md.evidenceClass = md.relationshipType === "declared_type" ? "reference_qualified" : "import_based"
        continue
      }
      if (t === "instantiates") { md.evidenceClass = md.confidence >= 0.8 && md.isConstructor ? "usage_contextual" : "structural"; continue }
      md.evidenceClass = "usage_contextual"
    }
  }

  private pushChildren(
    node: Node,
    walkStack: { node: Node; container: ASTEngine.UniversalSymbol | null; inFunction: boolean }[],
    container: ASTEngine.UniversalSymbol | null,
    inFunction: boolean,
  ): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const child = node.namedChild(i)
      if (child) walkStack.push({ node: child, container, inFunction })
    }
  }

  // ─── PURE HELPER FUNCTIONS ───

  private nodeRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    // 1-based columns (family standard — go/rust/c/cpp all +1; caught by the
    // systems-family consistency gate M14.CC1, 2026-08-29: zig emitted raw
    // 0-based columns, failing startColumn >= 1).
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }

  private nodeText(node: Node | null): string {
    if (!node) return ""
    return node.text
  }

  private anyChild(node: Node, predicate: (n: Node) => boolean): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && predicate(child)) return child
    }
    return null
  }

  // The `pub`/`export`/`inline` modifiers are anonymous token children
  // (`variable_declaration [pub:"pub"] [const:"const"]`) — pure AST, never
  // source-text scanning.
  private hasToken(node: Node, token: string): boolean {
    const count = node.childCount
    for (let i = 0; i < count; i++) {
      const c = node.child(i)
      if (c && !c.isNamed && c.type === token) return true
    }
    return false
  }

  private getAllNamedChildren(node: Node): Node[] {
    const children: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) children.push(child)
    }
    return children
  }
}
