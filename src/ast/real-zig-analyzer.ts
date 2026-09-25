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
          // Z9 (extreme review): a function-local @import is still a real
          // import fact (calls in function bodies are captured too, so
          // dropping the import was inconsistent) — record it exactly like
          // the top-level branch, without minting a local symbol.
          const lchildren = this.getAllNamedChildren(node)
          const lrhs = lchildren[lchildren.length - 1]
          const lrhsType = lrhs?.type || ""
          const lbuiltin =
            lrhsType === "call_expression" || lrhsType === "builtin_function"
              ? this.anyChild(lrhs, (n) => n.type === "builtin_identifier")
              : null
          if (lbuiltin && (lbuiltin.text === "@import" || lbuiltin.text === "@cImport")) {
            const largs = this.anyChild(lrhs, (n) => n.type === "arguments")
            const lstr = largs ? this.anyChild(largs, (n) => n.type === "string" || n.type === "string_content") : null
            if (lstr) {
              let ltarget = lstr.text
              if (
                (ltarget.startsWith('"') && ltarget.endsWith('"')) ||
                (ltarget.startsWith("'") && ltarget.endsWith("'"))
              ) {
                ltarget = ltarget.substring(1, ltarget.length - 1)
              }
              imports.push({
                module: ltarget,
                isDefaultImport: false,
                range: this.nodeRange(node),
                metadata: { zigImport: true, builtin: lbuiltin.text },
              })
              relationships.push({
                source: "(global)",
                target: ltarget,
                type: ASTEngine.RelationshipType.References,
                confidence: 1.0,
                // M59.A7 (#825): an import dependency occurs where its TARGET is
                // written — the path literal, not the declaration statement.
                ...(this.nodeLine(lstr) ? { line_number: this.nodeLine(lstr)! } : {}),
                metadata: { relationshipType: "zig_import", isImport: true },
              })
            }
          }
          this.pushChildren(node, walkStack, container, inFunction)
          continue
        }

        const identNode = this.anyChild(node, (n) => n.type === "identifier")
        const varName = identNode ? identNode.text : ""
        if (!varName || varName.length > 80) {
          this.pushChildren(node, walkStack, container, inFunction)
          continue
        }
        // Z8 (extreme review): the blank identifier is not a declaration —
        // `var _ = 1;` minted a `_` Variable symbol (GO5 class).
        if (varName === "_") {
          this.pushChildren(node, walkStack, container, inFunction)
          continue
        }

        const isExported = this.hasToken(node, "pub") || this.hasToken(node, "export")
        const children = this.getAllNamedChildren(node)
        const rhs = children[children.length - 1]
        const rhsType = rhs?.type || ""
        const rhsText = rhs ? this.nodeText(rhs) : ""

        // @import / @cImport: an import, not a symbol. (ZGD4 note: the REAL
        // usingnamespace form is the declaration `usingnamespace @import(...);`
        // handled by its own branch below — probe-verified 2026-09-04. An
        // assignment-RHS usingnamespace is not valid Zig; the grammar
        // error-recovers it into a call_expression with an ERROR child.)
        const builtin =
          rhsType === "call_expression" || rhsType === "builtin_function"
            ? this.anyChild(rhs, (n) => n.type === "builtin_identifier")
            : null
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
                // M59.A7 (#825): the line of the module path as written.
                ...(this.nodeLine(strNode) ? { line_number: this.nodeLine(strNode)! } : {}),
                metadata: { relationshipType: "zig_import", isImport: true },
              })
            }
            this.pushChildren(node, walkStack, container, inFunction)
            continue
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

      // ─── TEST / COMPTIME BLOCKS: executable bodies, not declaration scope ───
      // ZGD3 (zig wave, M37 #600): test_declaration and comptime_declaration
      // contain block bodies whose `var` locals are EXECUTION artifacts. The
      // walk previously fell through with inFunction=false, so every test
      // body leaked file-scope Variable symbols (probe: `test "t1" { var
      // local_counter ... }` emitted variable:local_counter). Reusing the
      // inFunction flag marks the body as executable scope: no declaration
      // symbols, while calls/uses emission (analyzeZigCodeRelationships) is
      // unaffected — it tracks function_declaration only and emits these
      // sites with source "(global)" (ZIG.D.2 contract).
      if (type === "test_declaration" || type === "comptime_declaration") {
        this.pushChildren(node, walkStack, container, true)
        continue
      }

      // ─── USINGNAMESPACE DECLARATION (ZGD4, zig wave M37 #600) ───
      // `usingnamespace @import("x.zig");` is a first-class import fact the
      // walk previously dropped entirely (probe-verified 2026-09-04: no
      // import record, no references edge). The @import sits in a
      // builtin_function child — same shape as the plain-import branch.
      if (type === "using_namespace_declaration") {
        const bf = this.anyChild(node, (n) => n.type === "builtin_function")
        const bi = bf ? this.anyChild(bf, (n) => n.type === "builtin_identifier") : null
        if (bf && bi && (bi.text === "@import" || bi.text === "@cImport")) {
          const argsNode = this.anyChild(bf, (n) => n.type === "arguments")
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
              metadata: { zigImport: true, builtin: bi.text, usingnamespace: true },
            })
            relationships.push({
              source: "(global)",
              target: importTarget,
              type: ASTEngine.RelationshipType.References,
              confidence: 1.0,
              // M59.A7 (#825): the module path as written.
              ...(this.nodeLine(strNode) ? { line_number: this.nodeLine(strNode)! } : {}),
              metadata: { relationshipType: "zig_import", isImport: true },
            })
          }
        }
        this.pushChildren(node, walkStack, container, inFunction)
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

        if (fnName && fnName !== "_" && fnName.length < 100 && !isAnonymousContainerMember) {
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
            metadata: {
              zigFunction: true,
              inline: isInline,
              paramCount: params.length,
              // #612 store-phase: DECLARATION vs DEFINITION. Measured against
              // this grammar (tree dump, 2026-09-25): `extern fn run_engine()
              // c_int;` and `pub fn call_it() c_int { … }` BOTH parse as
              // `function_declaration` — the body is the discriminator, a
              // `block` child. A body-less form is a declaration (`extern fn`,
              // and the `function_signature` spelling if the grammar produces
              // it); a `block` child is a definition. Without the flag an
              // `extern` declaration competed on equal footing with the
              // definition implementing it in another file.
              ...(type === "function_signature" || !this.anyChild(node, (n) => n.type === "block")
                ? { isDeclaration: true }
                : {}),
            },
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
        if (fieldName && fieldName !== "_" && fieldName.length < 50) {
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
      // Per ERROR/MISSING node, not per hasError-bearing ancestor: the old
      // `node.hasError ||` arm fired once for EVERY node on the spine above a
      // single real error — the root spans the whole file, so one parse error
      // cascaded into 163 pipeline rows on aro/Attribute.zig (the #897
      // cross-check caught it: tree walk found the file's nodes, pipeline
      // reported 163). A MISSING node carries hasError too but its type is
      // the expected token, so the isMissing arm keeps that reporting.
      if (node.type === "ERROR" || node.isMissing) {
        const snippet = nodeText.substring(0, 50)
        errors.push({
          message: `Zig syntax error: ${snippet}`,
          range: {
            // Z2 (zig review): 1-based columns like every other range in
            // this file (nodeRange +1s) — the raw 0-based columns leaked
            // through here (svelte-wave class).
            startLine: node.startPosition.row + 1,
            startColumn: node.startPosition.column + 1,
            endLine: node.endPosition.row + 1,
            endColumn: node.endPosition.column + 1,
            startIndex: node.startIndex,
            endIndex: node.endIndex,
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
          // M59.A7 (#825): a containment edge has no call site, but it has a
          // navigable one — the member's own declaration line. Omitted, never
          // written as 0, when the symbol carries no range (#820).
          ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
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

    // Z3 (zig review): bare-identifier value reads. The analyzer emitted NO
    // bare-identifier edges at all (`return MAX` produced zero relationships)
    // while const reads, call args, index operands and return expressions
    // all read file-visible values. C-family discipline with a lexical
    // scope stack (params + block/payload/short bindings shadow) and
    // resolvability required (file-scope const/var/fn/enum-members only).
    this.analyzeZigBareIdentifierUses(rootNode, relationships, symbols)

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
    //
    // Z1 (zig review): `complexity` was the synthetic symbols.length
    // heuristic beside per-symbol real complexities — the removed-
    // everywhere-else disease. Both fields report the real file-level
    // cyclomatic number (family contract, go parity).
    const fileComplexity = this.zigBodyComplexity(rootNode)
    return {
      language: "zig",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: fileComplexity,
        cyclomaticComplexity: fileComplexity,
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
        const leafNode = this.zigCalleeLeafNode(n)
        const leaf = leafNode?.text
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
              // M59.A7 (#825): the callee LEAF as written — the name-bearing
              // node, not the call expression (which a receiver can precede).
              ...(this.nodeLine(leafNode) ? { line_number: this.nodeLine(leafNode)! } : {}),
              metadata: { relationshipType: "zig_function_call", callExpression: n.text.slice(0, 60) },
            })
          }
        }
      }
      if (n.type === "field_expression" && !this.isCallCallee(n)) {
        const fieldNode = this.zigFieldLeafNode(n)
        const field = fieldNode?.text
        const notBuiltinAccess =
          this.anyChild(n, (c) => c.type === "identifier") !== null
        // ZGD1 (zig wave, M37 #600 — standing-rule write-gate class): an
        // assignment LHS is a WRITE, never a read. Zig assignments parse as
        // variable_declaration (probe-verified: `self.count = 5;` and
        // `self.count += 1;` are both variable_declaration nodes, LHS = first
        // named child) — gate only that LHS span, so the RHS of
        // `self.a = self.b` stays a genuine read.
        const p = n.parent
        const isAssignLhs = !!p && p.type === "variable_declaration" && p.namedChild(0)?.id === n.id
        // ZGD5 (same wave): `.bad` enum literals and `.{...}` init fields
        // parse as field_expression with a SINGLE named child — no base, so
        // they are not member accesses. `return .bad` emitted a phantom
        // `uses f->bad` (probe-verified).
        const isEnumLiteral = n.namedChildCount < 2
        // ZGD5b: a qualified TYPE ANNOTATION (`fn f() foo.Bar`, `w: io.Writer`)
        // is a namespace-qualified type reference — a declared-type fact, not
        // a runtime member READ. Type positions are direct children of the
        // declaration nodes (probe-verified); the declared-type graph already
        // carries the fact. `uses` stays reserved for runtime reads
        // (`return self.count`).
        const isTypePosition =
          p?.type === "parameter" ||
          p?.type === "container_field" ||
          p?.type === "function_declaration"
        if (field && notBuiltinAccess && !isAssignLhs && !isEnumLiteral && !isTypePosition) {
          const source = nextInFn && nextFn ? nextFn : "(global)"
          const k = `${source}->${field}`
          if (!emittedUses.has(k)) {
            emittedUses.add(k)
            relationships.push({
              source,
              target: field,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 0.75,
              // M59.A7 (#825): the field LEAF as written.
              ...(this.nodeLine(fieldNode) ? { line_number: this.nodeLine(fieldNode)! } : {}),
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

  /**
   * Z3: bare-identifier value reads (`return MAX`, `g(D)`, `m[k]` keys,
   * return operands). Every bare `identifier` naming a file-visible VALUE
   * (file-scope const/var/fn/enum-member) is a Uses edge, with:
   * - a lexical scope stack: function params bind at entry; block locals
   *   (variable_declaration names), payload captures (`|x|`), for/if/while
   *   payloads bind in walk order (reads before any binding still resolve
   *   outward — C-family flow discipline);
   * - declaration positions never read (first-identifier rule for
   *   variable_declaration; entity names; composite-literal keys are
   *   field_identifier-typed and auto-skip; labels/package/import paths/
   *   blank `_` excluded);
   * - call callees (span-matched; the calls branch owns them), member
   *   leaves (field path owns them; objects stay readable), qualified
   *   non-leaves, assignment LHS writes, test/comptime-exempt contexts all
   *   excluded;
   * - resolvability required: unknown names (std/dot-imported/external,
   *   macro-template `$x`) stay silent — no junk edges.
   */
  private analyzeZigBareIdentifierUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    symbols: ASTEngine.UniversalSymbol[],
  ): void {
    const fileValues = new Set<string>()
    // Enum members live in one global error/value namespace in Zig
    // (`error.Bad` reads the variant regardless of which set declared it),
    // so they resolve by name even when owned.
    const enumMemberNames = new Set<string>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.EnumMember) enumMemberNames.add(s.name)
      if (
        !s.ownerName &&
        (s.kind === ASTEngine.SymbolKind.Constant ||
          s.kind === ASTEngine.SymbolKind.Variable ||
          s.kind === ASTEngine.SymbolKind.Function ||
          s.kind === ASTEngine.SymbolKind.EnumMember)
      ) {
        fileValues.add(s.name)
      }
    }
    const emitted = new Set<string>()
    interface ScopeFrame {
      names: Set<string>
      fnName: string | null
    }
    const scopeStack: ScopeFrame[] = []
    const isShadowed = (name: string): boolean => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        if (scopeStack[i].names.has(name)) return true
      }
      return false
    }
    // NOTE (M49 W9, registered defect — NOT fixed here): this walk binds EVERY
    // identifier in the node's subtree, so a name that appears only in a
    // parameter's TYPE becomes a binding and shadows the real file-level value
    // for the whole function. Probe-verified: in
    //     const FLAG = 1;
    //     fn typeField(s: struct { FLAG: u8 }) void { _ = FLAG; }
    // the genuine read `_ = FLAG` emits ZERO `uses` edges, and `w: io.Writer`
    // likewise swallows reads of a global named `io`. The correct model is
    // "a binding is a declared NAME, not a subtree" (first identifier child of
    // a `parameter`; the direct identifier children of a `payload`). A fix was
    // written and measured against the zls corpus, but it must land together
    // with the zig ORACLE in script/m14/differential.ts (the oracle derives the
    // signature-region reads this fix suppresses — measured 5 MISSING), and
    // that oracle is another wave's in-flight work, so the fix is held rather
    // than half-landed. Registered in reviews/m49-w9-fixture-coverage-
    // adjudication.md + validation/m49/ledger.json (W9).
    // Z7 (extreme review): a parameter's binding is its declared NAME, not
    // its subtree. The entry pre-walk used to bind every identifier under a
    // parameter node, so a name appearing only in a parameter's TYPE (or
    // default value position) shadowed the real file-level value for the
    // whole function (`s: struct { Flag: u8 }` swallowed `_ = Flag`;
    // `x: T` swallowed the comptime type use; `x: u32 = Def` swallowed the
    // default-value read). Probe-pinned on synthetics; both sides.
    const bindParamName = (node: Node, frame: ScopeFrame): void => {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "identifier") {
          if (c.text !== "_") frame.names.add(c.text)
          return
        }
      }
      // Defensive fallback (every valid parameter has a name): first
      // identifier anywhere under the node.
      const any = this.anyChild(node, (c) => c.type === "identifier")
      if (any && any.text !== "_") frame.names.add(any.text)
    }
    const bindIdentifiersUnder = (node: Node, frame: ScopeFrame): void => {
      const walk: Node[] = [node]
      while (walk.length > 0) {
        const m = walk.pop()!
        // Never descend into nested executable/code bodies for bindings —
        // their names belong to inner scopes (collected when visited), and
        // never into call/composite arguments (those read).
        //
        // F6 audit: this list named `composite_literal` / `func_literal` —
        // rust/go vocabulary that cannot occur in tree-sitter-zig, so neither
        // stop could ever fire. They are removed; the live stops
        // (`call_expression`, `block`, `block_expression`) are unchanged, so
        // this is a pure dead-code removal.
        if (
          m !== node &&
          (m.type === "call_expression" || m.type === "block" ||
            m.type === "block_expression")
        ) {
          continue
        }
        if (m.type === "identifier" && m.text !== "_") frame.names.add(m.text)
        for (let i = m.namedChildCount - 1; i >= 0; i--) {
          const c = m.namedChild(i)
          if (c) walk.push(c)
        }
      }
    }
    // A defining occurrence never reads: the first identifier child of a
    // variable_declaration (`const MAX = ..`, `x = ..` LHS) or of an entity
    // item (fn/struct/enum/mod/type names).
    const isDefiningOccurrence = (node: Node): boolean => {
      const p = node.parent
      if (!p) return false
      if (p.type === "variable_declaration") {
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (c && c.type === "identifier") {
            return c.startIndex === node.startIndex && c.endIndex === node.endIndex
          }
        }
        return false
      }
      // Error sets declare EVERY direct member (`error{ A, B }`) — unlike
      // single-name items, there is no first-only rule here.
      if (p.type === "error_set_declaration" && node.type === "identifier") return true
      // F6 audit: `struct_item` / `enum_item` / `union_item` / `type_item` /
      // `mod_item` / `package_clause` are rust/go node names — none exists in
      // tree-sitter-zig, so those six disjuncts could never fire, and the
      // sibling `type_identifier` / `field_identifier` child checks could never
      // match either (zig spells every one of these `identifier`). The real
      // zig declaring forms are all covered without them: a `const X = struct
      // {...}` / `const T = u32` name is an `identifier` child of
      // `variable_declaration` (handled above); container members are
      // `container_field`; error-set members are handled above; fn/test names
      // are `function_declaration` / `test_declaration`.
      if (
        p.type === "function_declaration" || p.type === "test_declaration" ||
        p.type === "container_field" || p.type === "error_set_declaration"
      ) {
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (c && c.type === "identifier") {
            return c.startIndex === node.startIndex && c.endIndex === node.endIndex
          }
        }
      }
      return false
    }
    const isCallCallee = (node: Node): boolean => {
      // The callee is namedChild(0) of the call (identifier, field or
      // generic/builtin wrapper): anything under it is the callee subtree.
      let top: Node = node
      let p: Node | null = node.parent
      while (p && p.type !== "call_expression" && p.type !== "block" && p.type !== "function_declaration") {
        top = p
        p = p.parent
      }
      if (!p || p.type !== "call_expression") return false
      const first = p.namedChildCount > 0 ? p.namedChild(0) : null
      return !!first && top.startIndex >= first.startIndex && top.endIndex <= first.endIndex
    }
    const stack: Array<{ node: Node; exit: boolean; pushed: boolean }> = [{ node: rootNode, exit: false, pushed: false }]
    while (stack.length > 0) {
      const { node, exit, pushed } = stack.pop()!
      if (exit) {
        if (pushed) scopeStack.pop()
        continue
      }
      const t = node.type
      let pushedScope = false
      if (t === "function_declaration") {
        // Parameters bind at entry (identifiers in parameter nodes; type
        // positions are type_identifier-typed and auto-skip).
        const frame: ScopeFrame = { names: new Set<string>(), fnName: null }
        const params: Node[] = [node]
        while (params.length > 0) {
          const m = params.pop()!
          if (m.type !== "function_declaration" || m === node) {
            if (m.type === "parameter") bindParamName(m, frame)
            for (let i = m.namedChildCount - 1; i >= 0; i--) {
              const c = m.namedChild(i)
              // Do not descend into the body here (it gets its own scope
              // frames as the walk continues); do not cross nested items.
              if (c && c.type !== "block" && c.type !== "block_expression" && c.type !== "function_declaration") params.push(c)
            }
          }
        }
        const nm = this.anyChild(node, (c) => c.type === "identifier")
        frame.fnName = nm ? nm.text : null
        scopeStack.push(frame)
        pushedScope = true
      } else if (t === "block" || t === "block_expression") {
        scopeStack.push({ names: new Set<string>(), fnName: null })
        pushedScope = true
      } else if (t === "switch_case") {
        // Z6 (extreme review): payload captures are scoped to their own
        // switch arm — binding them into the enclosing block/function frame
        // leaked the capture past the arm (a post-switch genuine read of a
        // same-named file value was swallowed) and left file-scope switches
        // with no frame at all (a global capture name emitted a junk bare
        // read). The case frame is empty at entry so arm PATTERNS (walked
        // before the payload binds) still resolve outward; the payload
        // binds into this frame and the arm body reads it; the frame pops
        // at case exit. if/while/for/catch payloads keep the enclosing
        // binding (their else/continuation arms share the construct — a
        // documented single-pass boundary, see Z10).
        scopeStack.push({ names: new Set<string>(), fnName: null })
        pushedScope = true
      } else if (t === "payload") {
        // Capture bindings (`|x|`, `|*x|`, `|a, b|`) bind in the current
        // (innermost) scope.
        const top = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null
        if (top) bindIdentifiersUnder(node, top)
      } else if (t === "variable_declaration") {
        // LHS/first-identifier bindings (order-independent within the
        // statement: bind at the declaration node before descending, so no
        // read can leak through ordering). C6: ONLY `var`/`const`
        // declarations bind — a plain assignment (`g = v`, same node type
        // per ZGD1) WRITES a global; binding it would swallow later genuine
        // reads of that global.
        const top = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null
        if (top && (this.hasToken(node, "var") || this.hasToken(node, "const"))) {
          for (let i = 0; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (!c) continue
            if (c.type === "identifier") {
              if (c.text !== "_") top.names.add(c.text)
              break
            }
            break
          }
        }
      } else if (t === "identifier") {
        const name = node.text
        const p = node.parent
        // Error-type leaf rule (mirrors the zig oracle rod for rod): an
        // enum member resolves BY NAME only as the leaf of an `error.X`
        // occurrence that is a VALUE position — a parameter's error type,
        // or a container field's error type, is a declared-type fact, not
        // a read. Bare enum-member names never resolve in Zig (`red` alone
        // is invalid; switch patterns are enum literals), so without this
        // gate every same-named type/field identifier would emit junk.
        let inError = false
        if (p && p.type === "error_type" && p.namedChildCount > 0) {
          const last = p.namedChild(p.namedChildCount - 1)
          if (last && last.startIndex === node.startIndex && last.endIndex === node.endIndex) {
            let q: Node | null = p.parent
            let typePos = false
            while (q) {
              if (q.type === "parameter" || q.type === "container_field") { typePos = true; break }
              if (
                q.type === "variable_declaration" || q.type === "arguments" ||
                q.type === "return_expression" || q.type === "call_expression" ||
                q.type === "function_declaration" || q.type === "block" ||
                q.type === "block_expression"
              ) break
              q = q.parent
            }
            if (!typePos) inError = true
          }
        }
        if (
          name && name !== "_" && !name.startsWith("$") &&
          !isDefiningOccurrence(node) &&
          !isCallCallee(node) &&
          !(p && p.type === "field_expression") &&
          // F6 audit: the former `label_name` / `continue_label` disjuncts are
          // rust vocabulary — tree-sitter-zig labels are `block_label` /
          // `break_label` (both live here) and a `continue :outer` label is an
          // anonymous token with no identifier child to suppress.
          !((p && p.type === "labeled_statement") ||
            (p && p.type === "block_label") || (p && p.type === "break_label")) &&
          !isShadowed(name) &&
          (fileValues.has(name) || (inError && enumMemberNames.has(name)))
        ) {
          let fnName: string | null = null
          for (let i = scopeStack.length - 1; i >= 0; i--) {
            if (scopeStack[i].fnName) {
              fnName = scopeStack[i].fnName
              break
            }
          }
          const src = fnName ?? "(global)"
          const key = `${src}::uses::${name}`
          if (!emitted.has(key)) {
            emitted.add(key)
            relationships.push({
              source: src,
              target: name,
              type: ASTEngine.RelationshipType.Uses,
              confidence: 1.0,
              // M59.A7 (#825): the read occurs on the identifier's own line.
              ...(this.nodeLine(node) ? { line_number: this.nodeLine(node)! } : {}),
              metadata: { relationshipType: "identifier_usage", nodeType: node.type },
            })
          }
        }
      }
      stack.push({ node, exit: true, pushed: pushedScope })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, exit: false, pushed: false })
      }
    }
  }

  // F6 audit — REMOVED: `hasZigQualifiedAncestor`. Its only `true` return was
  // `cur.type === "qualified_type"`, and tree-sitter-zig has no such node (a
  // qualified type `std.mem.Allocator` is a nested `field_expression`,
  // probe-verified), so the function returned false for every input and the
  // `!this.hasZigQualifiedAncestor(node)` guard it fed was a no-op. Its
  // boundary names were equally dead (`field_declaration`, `composite_literal`,
  // `assignment_statement` are rust/go names; zig uses `container_field`,
  // `struct_initializer`, `variable_declaration`). The intended suppression of
  // type-position reads is already done by the direct `field_expression`
  // parent check at the call site; re-pointing this at `field_expression`
  // would have dropped genuine receiver reads instead.

  /** Builtin @-prefixed calls and generic type applications are not user
   *  call targets. Returns the leaf name for a real user call site, else
   *  undefined. */
  private zigCalleeLeafNode(call: Node): Node | undefined {
    const callee = call.namedChildCount > 0 ? call.namedChild(0) : null
    if (!callee) return undefined
    if (callee.type === "identifier") {
      // ZGD4: `usingnamespace` is a builtin keyword-like import operator, not
      // a user symbol — `pub const io = usingnamespace @import("io.zig")`
      // fabricated a `calls -> usingnamespace` edge (probe-verified).
      if (callee.text === "usingnamespace") return undefined
      // Skip builtin intrinsics (@foo).
      return callee
    }
    if (callee.type === "field_expression") {
      return this.zigFieldLeafNode(callee)
    }
    // call_expression whose callee is a builtin_function / generic_identifier
    // / pointer_wrapped — not a plain user call.
    return undefined
  }

  private zigCalleeLeaf(call: Node): string | undefined {
    return this.zigCalleeLeafNode(call)?.text
  }

  /** Leaf NAME of a field_expression (`std.math.abs` -> abs, `list.items` ->
   *  items). */
  private zigFieldLeaf(expr: Node): string | undefined {
    return this.zigFieldLeafNode(expr)?.text
  }

  /** The name-bearing field LEAF of a field_expression — the same node whose
   *  text `zigFieldLeaf` returns, kept so an emitted edge can carry the SITE
   *  line (M59.A7 #825) as well as the name. */
  private zigFieldLeafNode(expr: Node): Node | undefined {
    const last = expr.namedChildCount > 0 ? expr.namedChild(expr.namedChildCount - 1) : null
    if (last && last.type === "identifier") return last
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
    // `site` is the type node the leaf name was read from — M59.A7 (#825) wants
    // the reference line of the NAME, not of the enclosing declaration.
    const push = (leaf: string, site?: Node) => {
      if (!leaf) return
      const trim = leaf.replace(/[!*\s\[\]\{\}]+/g, "").trim()
      if (!trim) return
      const base = trim.split("<or>")[0] ?? trim
      const head = base.indexOf("=") !== -1 ? base.slice(0, base.indexOf("=")).trim() : base
      // ≡ /^\d/ — first char is 0-9 (rejects `123abc`-style heads).
      if (!head || BUILTINS.has(head) || (head.length > 0 && head.charCodeAt(0) >= 48 && head.charCodeAt(0) <= 57)) return
      if (!emitted.has(head)) {
        emitted.add(head)
        relationships.push({
          source: "(declared-type)",
          target: head,
          type: ASTEngine.RelationshipType.References,
          confidence: 0.9,
          // M59.A7 (#825): the type as written at this site.
          ...(this.nodeLine(site) ? { line_number: this.nodeLine(site)! } : {}),
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
            const tNode = this.zigTypeLeafNode(param)
            if (tNode) push(tNode.text, tNode)
          }
        }
        // Return type: error_union_type / nullable_type / pointer_type /
        // slice_type / builtin_type — AND bare identifier / field_expression
        // (ZGD2, zig wave M37 #600: `fn make() MyError` and `fn f() foo.Bar`
        // emitted NO declared-type ref — the collection list lacked both
        // shapes; a bare identifier is the whole type, a field_expression
        // like io.Writer is a qualified one). The function-NAME identifier
        // (first named child) is excluded — it is not a type.
        // NOTE: NO `return_type` literal here — tree-sitter-zig has no such
        // node (dead literal removed in the zig wave grammar audit).
        const kids = this.getAllNamedChildren(n)
        const retNode = kids
          .filter((c) => c.type !== "identifier" || kids.indexOf(c) !== 0)
          .find((c) => c.type === "error_union_type" || c.type === "nullable_type" || c.type === "pointer_type" || c.type === "slice_type" || c.type === "builtin_type" || c.type === "identifier" || c.type === "field_expression")
        const retLeafNode = retNode ? this.zigTypeLeafNode(retNode) : undefined
        if (retLeafNode) push(retLeafNode.text, retLeafNode)
      }
      if (n.type === "container_field") {
        // struct/union/enum member type
        const tNode = this.zigTypeLeafNode(n)
        if (tNode) push(tNode.text, tNode)
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
    return this.zigTypeLeafNode(node)?.text
  }

  /** The identifier NODE whose text `zigTypeLeaf` returns (identical traversal
   *  and identical drop-the-declaration-name rule), so a declared-type
   *  reference can carry the line the type is written on (M59.A7 #825). */
  private zigTypeLeafNode(node: Node): Node | undefined {
    if (node.type === "identifier") return node
    const ids: Node[] = []
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 200) {
      const n = stack.pop()!
      if (n.type === "identifier") ids.push(n)
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    if (ids.length === 0) return undefined
    // parameter/container_field: child 0 is the declaration NAME — drop it.
    if (
      (node.type === "parameter" || node.type === "container_field") &&
      node.namedChildCount > 0 &&
      node.namedChild(0)?.type === "identifier"
    ) {
      ids.shift()
      if (ids.length === 0) return undefined
    }
    // The LAST identifier after the name is the type leaf.
    return ids[ids.length - 1]
  }

  /**
   * M59.A7 (#825): the 1-based line of a syntax node, or `undefined` when the
   * node is absent. Never 0 — a missing site is OMITTED from the edge (the
   * #820 rule), so a reader can tell "no line" from "line 1".
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node || !node.startPosition || typeof node.startPosition.row !== "number") return undefined
    return node.startPosition.row + 1
  }

  /**
   * M59.A7 (#825): a declaration's start is not always the line its NAME is
   * written on (a wrapped declaration puts the name on the next line), so the
   * grammar's `name` field is the site when it exists. Mirror of the C and C++
   * lanes' `nameLine`.
   */
  private nameLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    const nameField =
      typeof (node as any).childForFieldName === "function" ? node.childForFieldName("name") : null
    return this.nodeLine(nameField ?? node)
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
