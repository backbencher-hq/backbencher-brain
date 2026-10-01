import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"
import { findDeclaringParent } from "./override-context"

/**
 * REAL NIM ANALYZER v1.0 — declaration-site extraction over the pinned
 * tree-sitter-nim grammar.
 *
 * ## Grammar provenance (everything below is probe-verified against
 * wasm/tree-sitter-nim.wasm, not assumed)
 *
 * Grammar: alaviss/tree-sitter-nim 0.6.2, vendored at
 * `grammars/tree-sitter-nim/` (grammar.js + scanner.c + tree-sitter.json) and
 * built with tree-sitter-cli 0.25.1 against emsdk 4.0.4. It ships an EXTERNAL
 * scanner that owns Nim's layout state (`_layout_start` / `_layout_end` /
 * `_inhibit_layout_end`). 24 fields, 377 node types, 127 named node types.
 *
 * The construct inventory this analyzer implements is the official Nim grammar
 * (`doc/grammar.txt`, generated from the compiler's own `parser.nim`), and
 * every construct in it was checked against the REAL Nim 2.2.12 compiler
 * (`nim check`) before its parse tree was read — a construct the compiler
 * rejects is not a Nim construct, so its tree is not evidence. The
 * compiler-validated matrix (17 files) parses with **0 ERROR and 0 MISSING
 * nodes**.
 *
 * ## The seven callable spellings
 *
 * `doc/grammar.txt` lists one `routine` production reached through seven
 * keywords — `proc` / `func` / `method` / `iterator` / `macro` / `template` /
 * `converter` — and this grammar gives each its own node type
 * (`proc_declaration`, `func_declaration`, …, `converter_declaration`) with the
 * identical `name` / `generic_parameters` / `parameters` / `return_type` /
 * `pragmas` / `rewrite_pattern` / `body` field set. Kind mapping:
 *
 * | keyword     | SymbolKind              | why                                                        |
 * | ----------- | ----------------------- | ---------------------------------------------------------- |
 * | `proc`      | `Function`              | the ordinary callable                                       |
 * | `func`      | `Function`              | `proc` restricted to no side effects — still a Function      |
 * | `method`    | `Method`                | dispatched on the first parameter's type (dynamic dispatch) |
 * | `iterator`  | `Function`              | `for`-able callable, no arguments                           |
 * | `converter` | `Function`              | implicit numeric conversion, no arguments                   |
 * | `template`  | `Macro`                 | expanded at compile time by the caller                      |
 * | `macro`     | `Macro`                 | receives the untyped AST                                     |
 *
 * The precise spelling is never lost: it is `metadata.nimCallableKind`.
 *
 * ## Value types vs reference types
 *
 * `object` has copy semantics and `ref object` has identity, inheritance and
 * dynamic dispatch, so a plain/ptr `object` is a `Struct` and a `ref object` is
 * a `Class`. The raw spelling is `metadata.nimObjectKind`.
 *
 * ## What is NOT a symbol (family contract, C-D1 / `LocalsAreNotSymbols`)
 *
 * Parameters, generic parameters, concept parameters, function-local
 * `let`/`var`/`const`, anonymous routines (`proc_expression`,
 * `func_expression`, `iterator_expression`), do-block parameters, for-loop
 * variables, `except … as e` bindings, a body-less `type` section, and every
 * control-flow, literal, operator and call node. They are execution artifacts.
 * The one exception is an object/enum/field declaration, which IS a symbol
 * because the object owns it.
 *
 * ## Resolution: declare-before-use is a language rule, not a preference
 *
 * `nim check` on `proc a() = b()` / `proc b() = discard` reports
 * "undeclared identifier: 'b'" — Nim resolves procs in a single forward-free
 * pass. That is why `uses` and `instantiates` require the target to be a name
 * THIS file declares, and why an unknown name stays silent instead of becoming
 * a junk edge. Cross-file and system-library targets are still emitted as
 * `calls` (target = the callee leaf) and marked `import_based` by
 * `classifyEvidenceTier`; they are genuinely facts about the file.
 */
export class RealNimAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string, context?: ASTEngine.AnalyzeContext): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // ── Per-file facts, all built in ONE pass and read by the later passes ──
    const fileValues = new Set<string>() // module-scope const/let/var/using names
    const fileTypes = new Set<string>() // module-scope type names
    const fileCallables = new Set<string>() // proc/func/method/… names
    const fileEnumMembers = new Set<string>() // every enum field name in the file
    const fileFieldNames = new Set<string>() // every object field name in the file
    const genericParamNames = new Set<string>() // [T, U] of any generic in the file
    const importQualifiers = new Set<string>() // names usable as a module prefix
    const declaredSubtypes = new Map<string, Set<string>>() // base type → declared subtypes
    const docCommentByStartLine = new Map<number, string>() // decl start line → ## text

    // ONE traversal for doc comments + the module surface + the file's own
    // complexity, replacing three separate full-tree walks. See
    // collectDocModulesAndComplexity for why, and for why it must not allocate
    // per node.
    const fileComplexity = this.collectDocModulesAndComplexity(
      rootNode, docCommentByStartLine, imports, exports, importQualifiers, relationships,
    )
    this.collectDeclarations(rootNode, {
      symbols,
      errors,
      docCommentByStartLine,
      fileValues,
      fileTypes,
      fileCallables,
      fileEnumMembers,
      fileFieldNames,
      genericParamNames,
      declaredSubtypes,
    })
    this.collectContainment(symbols, relationships)
    this.collectInheritance(symbols, relationships, fileTypes)
    this.collectOverrides(symbols, relationships, declaredSubtypes, context?.overrideCompanion)
    this.collectCallsAndUses(rootNode, relationships, {
      fileValues,
      fileTypes,
      fileCallables,
      fileEnumMembers,
      fileFieldNames,
      genericParamNames,
      importQualifiers,
    })
    this.classifyEvidenceTier(relationships)

    return {
      language: "nim",
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
        framework: "Nim",
        hasFrameworkIntelligence: true,
        hasTypeInference: true,
      },
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. DOCUMENTATION COMMENTS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * `##` and `##[` are DISTINCT node types from `#` in this grammar
   * (`documentation_comment` / `block_documentation_comment` vs `comment`), and
   * both are `extra` — so the parser places each one relative to the construct
   * it documents in one of TWO ways, and reading only the first is why docstrings
   * measured 0 through the real CLI:
   *
   *   1. ABSORBED. A `##` line that sits between a declaration's `proc` keyword
   *      and its body (the overwhelmingly common shape for a documented proc:
   *      `proc f()` / `## doc` / `  body`) becomes a CHILD of the declaration
   *      node, so its `nextNamedSibling` is the body's `statement_list`, not the
   *      declaration. Anchoring to the sibling in that case documents nothing.
   *      Measured: the doc for `proc newPoint` attached to a `statement_list`.
   *   2. SIBLING. A `##` line above a whole top-level construct
   *      (`## doc` / `proc f() = body`) is a child of the enclosing scope
   *      (`source_file` or a `type_section`) and its `nextNamedSibling` IS the
   *      declaration it documents.
   *
   * So: when the comment's PARENT is itself a declaration container, it belongs
   * to that parent; otherwise it belongs to its next named sibling. Both are
   * grammar-structure facts, and both are indexed by the anchor node's start line
   * so attachment stays O(1) with no nearest-previous scan.
   */
  /**
   * ONE traversal that does the work of three: file doc comments, the module
   * surface (import / from-import / include / export), and the file's own
   * cyclomatic complexity.
   *
   * These were three independent full-tree walks. They are three because they
   * were written at three different times, not because they need three visits:
   * all three are pure visitors over the same nodes with no shared state and no
   * order dependency between them. Measured on a 200-file sample they were 5-9%,
   * 8-19% and 4-19% of analyzer time, so the redundant traversal was a third of
   * the budget spent re-reading the same tree.
   *
   * The fused walk keeps ONE plain local counter and pushes onto ONE stack. That
   * is deliberate and it is the lesson from the rejected memoization: the win
   * here is fewer node VISITS (a WASM boundary crossing each), and the moment a
   * fused walk allocates per-node state — a Map keyed by node id, say — it costs
   * more than the walks it replaced. Nothing here allocates per node.
   *
   * Named children only, for the reason the complexity counter needs it: an
   * anonymous keyword token carries the same type string as the statement that
   * owns it, so descending into anonymous children double-counts every branch.
   */
  private collectDocModulesAndComplexity(
    rootNode: Node,
    out: Map<number, string>,
    imports: ASTEngine.ImportInfo[],
    exports: ASTEngine.ExportInfo[],
    qualifiers: Set<string>,
    relationships: ASTEngine.UniversalRelationship[],
  ): number {
    const isDeclarationContainer = (n: Node): boolean =>
      !!this.callableNodes[n.type] || n.type === "type_declaration" || n.type === "variable_declaration" || n.type === "enum_field_declaration" || n.type === "field_declaration"
    let complexity = 1
    const stack: Node[] = [rootNode]
    while (stack.length > 0) {
      const n = stack.pop()!
      const t = n.type
      // ── complexity ──
      if (BRANCH_NODES.indexOf(t) !== -1) complexity++
      else if (t === "infix_expression") {
        const op = n.childForFieldName("operator")
        if (op && !op.isNamed && (op.type === "and" || op.type === "or" || op.type === "xor")) complexity++
      }
      // ── doc comments ──
      if (t === "documentation_comment" || t === "block_documentation_comment") {
        const text = this.docCommentText(n)
        if (text) {
          const parent = n.parent
          const anchor = parent && isDeclarationContainer(parent) ? parent : n.nextNamedSibling
          if (anchor) out.set(anchor.startPosition.row + 1, text)
        }
        continue
      }
      // ── the module surface ──
      if (t === "import_statement") {
        this.readImportStatement(n, imports, qualifiers, relationships)
        // Still descend: an `import` has no nested declarations, but a malformed
        // one can error-recover around them.
      } else if (t === "import_from_statement") {
        this.readImportFromStatement(n, imports, qualifiers, relationships)
      } else if (t === "include_statement") {
        this.readIncludeStatement(n, imports, relationships)
      } else if (t === "export_statement") {
        this.readExportStatement(n, exports)
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return complexity
  }

  /**
   * Strip the `##` / `##[` opener and the comment body indentation by index
   * arithmetic, never by a pattern over the comment text — the opener is the
   * grammar's own anonymous token, so its length is known from the node, and
   * the body is a single `comment_content` child. No regex is involved, so
   * there is nothing here for the regex census to classify.
   */
  private docCommentText(node: Node): string {
    const opener = node.childCount > 0 ? node.child(0) : null
    const openerText = opener && !opener.isNamed ? opener.text : ""
    const content = node.namedChildCount > 0 ? node.namedChild(0) : null
    let raw = content ? content.text : node.text
    // Fall back to slicing the opener off the node text when the grammar gave no
    // `comment_content` child (an empty `##`).
    if (!content && openerText && raw.startsWith(openerText)) raw = raw.slice(openerText.length)
    const lines = raw.split("\n")
    const cleaned: string[] = []
    for (const line of lines) {
      let l = line
      // Strip a leading run of spaces/tabs by index, not by a pattern.
      let i = 0
      while (i < l.length && (l[i] === " " || l[i] === "\t")) i++
      cleaned.push(i > 0 ? l.slice(i) : l)
    }
    while (cleaned.length > 0 && cleaned[0].trim() === "") cleaned.shift()
    while (cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === "") cleaned.pop()
    return cleaned.join("\n")
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. SYMBOLS
  // ═══════════════════════════════════════════════════════════════════════

  private readonly callableNodes: Record<string, { kind: ASTEngine.SymbolKind; callableKind: string }> = {
    proc_declaration: { kind: ASTEngine.SymbolKind.Function, callableKind: "proc" },
    func_declaration: { kind: ASTEngine.SymbolKind.Function, callableKind: "func" },
    method_declaration: { kind: ASTEngine.SymbolKind.Method, callableKind: "method" },
    iterator_declaration: { kind: ASTEngine.SymbolKind.Function, callableKind: "iterator" },
    template_declaration: { kind: ASTEngine.SymbolKind.Macro, callableKind: "template" },
    macro_declaration: { kind: ASTEngine.SymbolKind.Macro, callableKind: "macro" },
    converter_declaration: { kind: ASTEngine.SymbolKind.Function, callableKind: "converter" },
  }

  /** Every value-binding section in the grammar, with the kind it declares.
   *  `const` → Constant; `let`/`var`/`using` → Variable. */
  private readonly valueSectionNodes: Record<string, ASTEngine.SymbolKind> = {
    const_section: ASTEngine.SymbolKind.Constant,
    let_section: ASTEngine.SymbolKind.Variable,
    var_section: ASTEngine.SymbolKind.Variable,
    using_section: ASTEngine.SymbolKind.Variable,
  }

  private collectDeclarations(
    rootNode: Node,
    ctx: {
      symbols: ASTEngine.UniversalSymbol[]
      errors: ASTEngine.ParseError[]
      docCommentByStartLine: Map<number, string>
      fileValues: Set<string>
      fileTypes: Set<string>
      fileCallables: Set<string>
      fileEnumMembers: Set<string>
      fileFieldNames: Set<string>
      genericParamNames: Set<string>
      declaredSubtypes: Map<string, Set<string>>
    },
  ): void {
    interface Frame {
      node: Node
      /** True once the walk is inside a routine body. Locals — and a `type`
       *  section inside a body (C-D1) — are execution artifacts, never symbols. */
      inCallable: boolean
      /** The `ref`/`ptr` wrapper of the enclosing type declaration, so a nested
       *  `object_declaration` knows whether it is a value or a reference type. */
      objectKind: string
    }
    const stack: Frame[] = [{ node: rootNode, inCallable: false, objectKind: "" }]

    while (stack.length > 0) {
      const { node, inCallable, objectKind } = stack.pop()!
      const type = node.type

      // ── error reporting: one row per ERROR / MISSING node, never per
      //    hasError-bearing ancestor (the root spans the whole file, so an
      //    ancestor test would emit one row for every node on the spine above a
      //    single real error).
      if (type === "ERROR" || node.isMissing) {
        ctx.errors.push({
          message: `Nim syntax error: ${this.snippet(node.text)}`,
          range: this.nodeRange(node),
          severity: "error",
        })
      }

      // ── the seven callable spellings ────────────────────────────────────
      const callable = this.callableNodes[type]
      if (callable) {
        const sym = this.buildCallableSymbol(node, callable, ctx, inCallable)
        if (sym) {
          ctx.symbols.push(sym)
          ctx.fileCallables.add(sym.name)
        }
        this.pushChildren(node, stack, true, "")
        continue
      }

      // ── type definitions ────────────────────────────────────────────────
      if (type === "type_declaration") {
        if (!inCallable) {
          const sym = this.buildTypeSymbol(node, ctx, objectKind)
          if (sym) {
            ctx.symbols.push(sym)
            ctx.fileTypes.add(sym.name)
            for (const g of sym.genericParameters ?? []) ctx.genericParamNames.add(g)
            this.pushTypeMembers(node, sym, ctx)
          }
        }
        this.pushChildren(node, stack, inCallable, objectKind)
        continue
      }

      // ── const / let / var / using sections ──────────────────────────────
      const sectionKind = this.valueSectionNodes[type]
      if (sectionKind) {
        for (let i = 0; i < node.namedChildCount; i++) {
          const decl = node.namedChild(i)
          if (decl && decl.type === "variable_declaration") {
            for (const sym of this.buildValueSymbols(decl, sectionKind, type, inCallable, ctx)) {
              ctx.symbols.push(sym)
              ctx.fileValues.add(sym.name)
            }
          }
        }
        this.pushChildren(node, stack, inCallable, objectKind)
        continue
      }

      // A `ref`/`ptr` wrapper only changes how the `object_declaration` inside
      // it is classified, so it is carried down one level and dropped after.
      const childObjectKind =
        type === "ref_type" ? "ref_type" : type === "pointer_type" ? "pointer_type" : type === "distinct_type" || type === "out_type" || type === "var_type" ? type : objectKind

      this.pushChildren(node, stack, inCallable, childObjectKind)
    }
  }

  private buildCallableSymbol(
    node: Node,
    callable: { kind: ASTEngine.SymbolKind; callableKind: string },
    ctx: {
      symbols: ASTEngine.UniversalSymbol[]
      docCommentByStartLine: Map<number, string>
      genericParamNames: Set<string>
    },
    inCallable: boolean,
  ): ASTEngine.UniversalSymbol | null {
    // The name field is `_symbol` (identifier or accent_quoted for `+`) or
    // `exported_symbol` (identifier/accent_quoted followed by `*`).
    const nameNode = node.childForFieldName("name")
    if (!nameNode) return null
    const nameInfo = this.readNameNode(nameNode)
    if (!nameInfo.name || nameInfo.name === "_") return null
    // A routine declared inside another routine is a nested routine: Nim
    // allows it (closure), and the family rule is that an anonymous/inner
    // body entity is an execution artifact.
    if (inCallable) return null

    const parameters = this.readParameters(node)
    const returnNode = node.childForFieldName("return_type")
    const body = node.childForFieldName("body")
    const genericParameters = this.readGenericParameterNames(node)
    for (const g of genericParameters) ctx.genericParamNames.add(g)

    const pragmas = this.readPragmaNames(node)
    const hasPragma = (n: string): boolean => pragmas.indexOf(n) !== -1
    const doc = ctx.docCommentByStartLine.get(node.startPosition.row + 1)

    const receiverType = callable.callableKind === "method" ? this.methodReceiverTypeLeaf(node) : undefined

    const sym: ASTEngine.UniversalSymbol = {
      name: nameInfo.name,
      kind: callable.kind,
      visibility: nameInfo.exported ? "public" : "private",
      range: this.nodeRange(node),
      scope: undefined,
      parameters,
      returnType: returnNode ? this.nodeText(returnNode) : undefined,
      genericParameters: genericParameters.length > 0 ? genericParameters : undefined,
      decorators: pragmas.length > 0 ? pragmas : undefined,
      comments: doc ? [doc] : undefined,
      // A METHOD's owner is its receiver TYPE, and `ownerName` is the
      // family-standard field for that — the one the store binds for ownership
      // and the one `buildOverrideCompanion` keys on to index
      // (owner -> declared method names) from previously parsed files.
      //
      // Leaving it unset made NIM methods invisible to every owner-based
      // mechanism in the codebase, not just this one: the companion index came
      // back EMPTY for a file whose base class declared a method, so
      // cross-file override resolution could not work no matter what the
      // override pass did. The receiver was already known, just parked in
      // `metadata.nimReceiverType` where nothing generic reads it. The metadata
      // copy stays — the override labels are built from it, and it is the
      // documented place the receiver is recorded.
      ...(receiverType ? { ownerName: receiverType, ownerKind: ASTEngine.SymbolKind.Class } : {}),
      // The store binds `brain_symbol.docstring` from this field (see
      // parallel-indexer's insertSymbol binding). Emitting only `comments`
      // produced docs=0 for every nim symbol through the real CLI, so the `##`
      // text is published under BOTH names.
      ...(doc ? { docstring: doc } : {}),
      complexity: body ? this.nimCyclomaticComplexity(body) : 1,
      metadata: {
        nimCallableKind: callable.callableKind,
        // `isDeclaration` is the DECLARATION vs DEFINITION discriminator: the
        // `routine` production makes `=`+`body` optional, so a body-less
        // `proc f(): int` is a forward declaration. Nim has no separate
        // forward-declaration syntax, so this shape only appears in .nims
        // and macro-generated code — but when it does, an `extern`-like
        // declaration competing on equal footing with the definition that
        // implements it is exactly the zig #612 defect class.
        ...(body ? {} : { isDeclaration: true }),
        ...(nameInfo.exported ? { exported: true } : {}),
        paramCount: parameters.length,
        ...(genericParameters.length > 0 ? { genericParameterCount: genericParameters.length } : {}),
        ...(callable.callableKind === "method" ? { nimReceiverType: receiverType } : {}),
        ...(node.childForFieldName("rewrite_pattern") ? { nimRewritePattern: true } : {}),
        ...(hasPragma("raises") ? { nimRaises: true } : {}),
        ...(hasPragma("noSideEffect") ? { nimNoSideEffect: true } : {}),
        ...(hasPragma("inline") ? { nimInline: true } : {}),
        ...(hasPragma("deprecated") ? { nimDeprecated: true } : {}),
        ...(hasPragma("base") ? { nimBaseMethod: true } : {}),
        ...(hasPragma("tailcall") ? { nimTailcall: true } : {}),
        ...(hasPragma("asm") ? { nimAsm: true } : {}),
        nameRange: nameInfo.range,
      },
    }
    if (doc) sym.metadata.nimDocumented = true
    return sym
  }

  private buildTypeSymbol(
    node: Node,
    ctx: { docCommentByStartLine: Map<number, string> },
    parentObjectKind: string,
  ): ASTEngine.UniversalSymbol | null {
    const symDecl = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (!symDecl || symDecl.type !== "type_symbol_declaration") return null
    const nameNode = symDecl.childForFieldName("name")
    if (!nameNode) return null
    const nameInfo = this.readNameNode(nameNode)
    if (!nameInfo.name || nameInfo.name === "_") return null
    const genericParameters = this.readGenericParameterNames(symDecl)
    const doc = ctx.docCommentByStartLine.get(node.startPosition.row + 1)

    // The right-hand side decides the kind. `type_declaration` is
    // `type_symbol_declaration '=' <typeDefValue>` where typeDefValue may be a
    // tuple/enum/object/concept declaration, a `ref`/`ptr`/`distinct` wrapper
    // around one, or ANY expression (a plain alias such as `array[3, int]`).
    //
    // The wrapper is a SEPARATE node: `ref object …` is
    //   type_declaration(type_symbol_declaration, =, ref_type(ref, object_declaration))
    // so the object declaration is a GRANDCHILD of the declaration, not a
    // direct child. An earlier version only looked at direct children and
    // classified every `ref object` as a plain `Type` — measured on
    // m1_proc.nim, where `Box[T] = ref object` came out `type` instead of
    // `class`.
    let objectKind = parentObjectKind
    let inherits: string | null = null
    let objectNode: Node | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c || c === symDecl) continue
      if (c.type === "ref_type" || c.type === "pointer_type" || c.type === "out_type" || c.type === "var_type" || c.type === "distinct_type") {
        objectKind = c.type
        const inner = this.lastNamedChild(c)
        if (inner && inner.type === "object_declaration") objectNode = inner
      } else if (c.type === "object_declaration") {
        objectNode = c
      } else if (c.type === "type_expression") {
        // `ref`/`ptr` can also arrive wrapped in a `type_expression`.
        const inner = c.namedChildCount > 0 ? c.namedChild(0) : null
        if (inner) {
          if (inner.type === "object_declaration") objectNode = inner
          else if (inner.type === "ref_type" || inner.type === "pointer_type" || inner.type === "out_type" || inner.type === "var_type" || inner.type === "distinct_type") {
            objectKind = inner.type
            const deep = this.lastNamedChild(inner)
            if (deep && deep.type === "object_declaration") objectNode = deep
          }
        }
      }
    }
    if (objectNode && objectKind === "") objectKind = "object"
    if (objectNode) {
      const inh = objectNode.childForFieldName("inherits")
      if (inh) inherits = this.typeLeafName(inh)
    }

    let kind: ASTEngine.SymbolKind
    const rhs = this.typeDefinitionRhs(node)
    if (rhs && rhs.type === "concept_declaration") {
      // A concept is a compile-time structural interface: it declares no
      // runtime value and is satisfied by implicit dispatch, which is exactly
      // what SymbolKind.Interface means in this codebase.
      kind = ASTEngine.SymbolKind.Interface
    } else if (rhs && rhs.type === "enum_declaration") {
      kind = ASTEngine.SymbolKind.Enum
    } else if (objectNode) {
      // `object` copies; `ref object` has identity, inheritance and dynamic
      // dispatch. The raw spelling is preserved in metadata either way.
      kind = objectKind === "ref_type" ? ASTEngine.SymbolKind.Class : ASTEngine.SymbolKind.Struct
    } else if (rhs && (rhs.type === "tuple_type" || rhs.type === "tuple_deconstruct_declaration" || rhs.type === "tuple_construction")) {
      // BOTH tuple spellings, because the grammar gives them different node
      // types and only one of them was in this list:
      //   type U = tuple[a: int, b: string]  -> tuple_type            (named)
      //   type T = (int, string)             -> tuple_construction   (unnamed)
      // The second is the ORDINARY way to write an unnamed tuple in Nim — the
      // compiler accepts `tuple[int, string]` with 3 errors and `(int, string)`
      // with none — and before this it fell through to a bare `type`, so every
      // anonymous tuple type in the language was published as a type-level name
      // with no fields, while the named spelling beside it published a struct.
      // Measured by the mutation run: nim/tuple-type-classified-as-a-type had
      // survived, which is what sent me to the trees.
      kind = ASTEngine.SymbolKind.Struct
    } else {
      // Everything else — `ref Foo`, `ptr T`, `distinct float`, `seq[X]`,
      // `proc (x: int)`, `SomeAlias` — is a type-level name, not a value.
      kind = ASTEngine.SymbolKind.Type
    }

    const sym: ASTEngine.UniversalSymbol = {
      name: nameInfo.name,
      kind,
      visibility: nameInfo.exported ? "public" : "private",
      range: this.nodeRange(node),
      parameters: rhs && rhs.type === "concept_declaration" ? this.readConceptParameters(rhs) : undefined,
      genericParameters: genericParameters.length > 0 ? genericParameters : undefined,
      comments: doc ? [doc] : undefined,
      ...(doc ? { docstring: doc } : {}),
      metadata: {
        nimTypeDefinition: true,
        ...(objectKind ? { nimObjectKind: objectKind } : {}),
        ...(inherits ? { nimInherits: inherits } : {}),
        ...(rhs ? { nimTypeRhs: this.nodeText(rhs) } : {}),
        nameRange: nameInfo.range,
      },
    }
    if (doc) sym.metadata.nimDocumented = true
    return sym
  }

  /** The node AFTER the `=` in a `type_declaration` — the `typeDefValue`. */
  private typeDefinitionRhs(node: Node): Node | null {
    const seenEq = { value: false }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (!c) continue
      if (!seenEq.value) {
        if (!c.isNamed && c.type === "=") seenEq.value = true
        continue
      }
      if (c.isNamed) return this.unwrapTypeExpression(c)
    }
    return null
  }

  /**
   * See through the `type_expression` wrapper the grammar puts around a type
   * RHS, so the classifier sees the SHAPE rather than the wrapper.
   *
   * Found by mutation, not by inspection (nim/tuple-type-classified-as-a-type
   * SURVIVED the first run, which is the harness reporting that a documented
   * rule — "a tuple type is a struct" — had no test behind it and turned out
   * to be FALSE). The trees for the three shapes are not parallel:
   *
   *   type Color = enum …      -> enum_declaration          (no wrapper)
   *   type A = concept x       -> concept_declaration       (no wrapper)
   *   type Pair = tuple[x, y]  -> type_expression           (WRAPPER)
   *                                 └── tuple_type
   *
   * so the old rule matched `tuple_type` at the top level, never saw it behind
   * the wrapper, and `type Pair = tuple[x, y: int]` fell through to the
   * catch-all and published a bare `type` — losing the struct kind its own
   * documentation promised.
   */
  private unwrapTypeExpression(node: Node): Node {
    let cur = node
    // Bounded: a type RHS cannot nest type_expression arbitrarily, and a cycle
    // guard is cheaper than a stack overflow on a malformed tree.
    for (let i = 0; i < 8; i++) {
      if (cur.type !== "type_expression") return cur
      const inner = this.firstChildOfType(cur, "tuple_type") ??
        this.firstChildOfType(cur, "tuple_construction") ??
        this.firstChildOfType(cur, "enum_declaration") ??
        this.firstChildOfType(cur, "concept_declaration") ??
        this.firstChildOfType(cur, "object_declaration") ??
        this.firstChildOfType(cur, "ref_type") ??
        this.firstChildOfType(cur, "distinct_type") ??
        this.firstChildOfType(cur, "pointer_type") ??
        this.firstChildOfType(cur, "array_type") ??
        this.firstChildOfType(cur, "generic_type") ??
        this.firstChildOfType(cur, "sequence_type") ??
        this.firstChildOfType(cur, "set_type") ??
        this.firstChildOfType(cur, "table_type") ??
        this.firstChildOfType(cur, "range_type") ??
        this.firstChildOfType(cur, "ordinal_type")
      if (!inner) return cur
      cur = inner
    }
    return cur
  }

  /**
   * Object/enum members. These ARE symbols: the object owns them, so they get
   * `ownerName`/`ownerKind` and a `contains` edge. A field declaration can name
   * several fields at once (`x, y: int`), so one `field_declaration` yields one
   * symbol per `symbol_declaration` — with the declaration's own range and a
   * per-name `nameRange`.
   */
  private pushTypeMembers(node: Node, owner: ASTEngine.UniversalSymbol, ctx: {
    symbols: ASTEngine.UniversalSymbol[]
    docCommentByStartLine: Map<number, string>
    fileEnumMembers: Set<string>
    fileFieldNames: Set<string>
    declaredSubtypes: Map<string, Set<string>>
  }): void {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "field_declaration" || n.type === "variant_discriminator_declaration") {
        for (const sym of this.buildFieldSymbols(n, owner, ctx.docCommentByStartLine)) {
          ctx.symbols.push(sym)
          ctx.fileFieldNames.add(sym.name)
        }
      } else if (n.type === "enum_field_declaration") {
        for (const sym of this.buildEnumFieldSymbols(n, owner, ctx.docCommentByStartLine)) {
          ctx.symbols.push(sym)
          ctx.fileEnumMembers.add(sym.name)
        }
      } else if (n.type === "object_declaration") {
        const inh = n.childForFieldName("inherits")
        if (inh) {
          const base = this.typeLeafName(inh)
          const set = ctx.declaredSubtypes.get(base) ?? new Set<string>()
          set.add(owner.name)
          ctx.declaredSubtypes.set(base, set)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /** True when some ancestor of `node` has the given type, within a bounded
   *  walk. A malformed tree cannot hang this: the guard is 64 levels, deeper
   *  than any declaration nesting the grammar produces. */
  private hasAncestorOfType(node: Node, type: string): boolean {
    let cur: Node | null = node.parent
    for (let i = 0; cur && i < 64; i++) {
      if (cur.type === type) return true
      cur = cur.parent
    }
    return false
  }

  private buildFieldSymbols(
    node: Node,
    owner: ASTEngine.UniversalSymbol,
    docCommentByStartLine: Map<number, string>,
  ): ASTEngine.UniversalSymbol[] {
    const out: ASTEngine.UniversalSymbol[] = []
    const list = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (!list || list.type !== "symbol_declaration_list") return out
    const typeNode = node.childForFieldName("type")
    // An UNNAMED tuple element declares a TYPE, not a field. The grammar cannot
    // tell the two apart by shape — it builds the same
    // symbol_declaration_list for `tuple[x, y: int]` (names `x`, `y`, then a
    // `: int` type) and for `tuple[int, string]` (the "names" ARE the types,
    // with no type part at all) — so the discriminator is the ABSENCE of the
    // declaration's own type field, which is a structural fact and not a
    // builtin-name guess.
    //
    // Measured before this guard: `type T2 = tuple[int, string]` published
    // `property:int` and `property:string`, i.e. two properties named after
    // builtin TYPES, each with a `contains` edge off T2. Nothing else in the
    // analyzer could have caught it: both names are real identifiers, so no
    // dangling check fires, and a symbol-count check sees two extra rows, not a
    // wrong two. Found by reading the tree while triaging
    // nim/tuple-type-classified-as-a-type, which had survived.
    // Scoped to a tuple element on purpose: a `variant_discriminator_declaration`
    // (`case isCircle`) also carries no `type` field, and applying the rule to
    // every typeless field_declaration silently dropped the discriminator — a
    // regression this guard introduced and the variant probe caught immediately.
    // Inside an OBJECT there is no unnamed element, so the ancestor test is what
    // separates `tuple[int, string]` from `case isCircle`.
    if (!typeNode && this.hasAncestorOfType(node, "tuple_type")) return out
    const doc = docCommentByStartLine.get(node.startPosition.row + 1)
    for (let i = 0; i < list.namedChildCount; i++) {
      const decl = list.namedChild(i)
      if (!decl) continue
      if (decl.type === "tuple_deconstruct_declaration") {
        for (const s of this.buildFieldSymbols(decl, owner, docCommentByStartLine)) out.push(s)
        continue
      }
      if (decl.type !== "symbol_declaration") continue
      const nameNode = decl.childForFieldName("name")
      if (!nameNode) continue
      const nameInfo = this.readNameNode(nameNode)
      if (!nameInfo.name || nameInfo.name === "_") continue
      out.push({
        name: nameInfo.name,
        kind: ASTEngine.SymbolKind.Property,
        visibility: nameInfo.exported ? "public" : "private",
        range: this.nodeRange(node),
        scope: owner.name,
        ownerName: owner.name,
        ownerKind: owner.kind,
        returnType: typeNode ? this.nodeText(typeNode) : undefined,
        comments: doc ? [doc] : undefined,
        ...(doc ? { docstring: doc } : {}),
        metadata: {
          nimField: true,
          ...(node.type === "variant_discriminator_declaration" ? { nimVariantDiscriminator: true } : {}),
          nameRange: nameInfo.range,
        },
      })
    }
    return out
  }

  private buildEnumFieldSymbols(
    node: Node,
    owner: ASTEngine.UniversalSymbol,
    docCommentByStartLine: Map<number, string>,
  ): ASTEngine.UniversalSymbol[] {
    const out: ASTEngine.UniversalSymbol[] = []
    const decl = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (!decl || decl.type !== "symbol_declaration") return out
    const nameNode = decl.childForFieldName("name")
    if (!nameNode) return out
    const nameInfo = this.readNameNode(nameNode)
    if (!nameInfo.name || nameInfo.name === "_") return out
    const doc = docCommentByStartLine.get(node.startPosition.row + 1)
    out.push({
      name: nameInfo.name,
      kind: ASTEngine.SymbolKind.EnumMember,
      visibility: nameInfo.exported ? "public" : "private",
      range: this.nodeRange(node),
      scope: owner.name,
      ownerName: owner.name,
      ownerKind: owner.kind,
      comments: doc ? [doc] : undefined,
      metadata: { nimEnumMember: true, nameRange: nameInfo.range },
    })
    return out
  }

  /**
   * `const`/`let`/`var`/`using` declarations. Nim allows several names in one
   * declaration (`var a, b: int`); each is a symbol with the declaration's
   * range and its own `nameRange`.
   */
  private buildValueSymbols(
    decl: Node,
    kind: ASTEngine.SymbolKind,
    section: string,
    inCallable: boolean,
    ctx: { docCommentByStartLine: Map<number, string> },
  ): ASTEngine.UniversalSymbol[] {
    // Function-local `let`/`var`/`const` are execution artifacts
    // (`LocalsAreNotSymbols`). `const` inside a body is a compile-time local
    // too, so the same rule holds.
    if (inCallable) return []
    const out: ASTEngine.UniversalSymbol[] = []
    const list = decl.namedChildCount > 0 ? decl.namedChild(0) : null
    if (!list || list.type !== "symbol_declaration_list") return out
    const typeNode = decl.childForFieldName("type")
    const valueNode = decl.childForFieldName("value")
    const doc = ctx.docCommentByStartLine.get(decl.startPosition.row + 1)
    for (let i = 0; i < list.namedChildCount; i++) {
      const d = list.namedChild(i)
      if (!d) continue
      if (d.type === "tuple_deconstruct_declaration") {
        // `let (a, b) = pair` — a destructuring binding, not a name.
        continue
      }
      if (d.type !== "symbol_declaration") continue
      const nameNode = d.childForFieldName("name")
      if (!nameNode) continue
      const nameInfo = this.readNameNode(nameNode)
      if (!nameInfo.name || nameInfo.name === "_") continue
      out.push({
        name: nameInfo.name,
        kind,
        visibility: nameInfo.exported ? "public" : "private",
        range: this.nodeRange(decl),
        returnType: typeNode ? this.nodeText(typeNode) : undefined,
        comments: doc ? [doc] : undefined,
        metadata: {
          nimValueBinding: true,
          nimSection: section,
          ...(valueNode ? { nimHasInitializer: true } : {}),
          ...(nameInfo.exported ? { exported: true } : {}),
          nameRange: nameInfo.range,
        },
      })
    }
    return out
  }

  /**
   * Names bound by ONE `let`/`var`/`const` head, including destructuring.
   *
   * Measured defect this fixes (pixie tests/megatest_emoji.nim line 42, found by
   * the NIM differential, not by inspection): the frame binder walked a
   * `symbol_declaration_list` and took only children whose type was
   * `symbol_declaration`, so a DESTRUCTURING binding was skipped whole. The
   * grammar nests those:
   *
   *   variable_declaration          "(_, name, _) = splitFile(filePath)"
   *     symbol_declaration_list
   *       tuple_deconstruct_declaration
   *         symbol_declaration      "_"      -> blank_identifier
   *         symbol_declaration      "name"   -> identifier
   *         symbol_declaration      "_"      -> blank_identifier
   *
   * `name` therefore never entered the frame, `isShadowed("name")` was false at
   * the `images.add((name, image))` read, and the analyzer attributed a read of
   * the LOCAL to `EmojiSet.name` — a struct property declared 26 lines earlier
   * and unrelated to the binding. The edge was not dangling (the target is a
   * real symbol), so no dangling check could ever have caught it: only the
   * shadow rule was wrong. That is the whole class — a same-named field
   * anywhere in the file could absorb any destructured, iterated or
   * pattern-bound local.
   *
   * Recursive, because the pattern nests: `let ((a, b), c) = …` is a
   * tuple_deconstruct_declaration inside a tuple_deconstruct_declaration.
   */
  private readBoundDeclarationNames(list: Node): string[] {
    const out: string[] = []
    const visit = (n: Node | null): void => {
      if (!n) return
      if (n.type === "tuple_deconstruct_declaration") {
        for (let i = 0; i < n.namedChildCount; i++) visit(n.namedChild(i))
        return
      }
      if (n.type !== "symbol_declaration") return
      const nameNode = n.childForFieldName("name")
      const info = nameNode ? this.readNameNode(nameNode) : null
      if (info?.name && info.name !== "_") out.push(info.name)
    }
    for (let i = 0; i < list.namedChildCount; i++) visit(list.namedChild(i))
    return out
  }

  private readParameters(node: Node): ASTEngine.Parameter[] {
    const paramsNode = node.childForFieldName("parameters")
    if (!paramsNode) return []
    const out: ASTEngine.Parameter[] = []
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const p = paramsNode.namedChild(i)
      if (!p) continue
      // A generic parameter list reuses `parameter_declaration`; those are type
      // parameters, not value parameters.
      if (p.type === "parameter_declaration") {
        const typeNode = p.childForFieldName("type")
        const valueNode = p.childForFieldName("value")
        const list = p.namedChildCount > 0 ? p.namedChild(0) : null
        if (!list) continue
        for (let j = 0; j < list.namedChildCount; j++) {
          const d = list.namedChild(j)
          if (!d || d.type !== "symbol_declaration") continue
          const nameNode = d.childForFieldName("name")
          if (!nameNode) continue
          const info = this.readNameNode(nameNode)
          if (!info.name) continue
          out.push({
            name: info.name,
            type: typeNode ? this.nodeText(typeNode) : undefined,
            defaultValue: valueNode ? this.nodeText(valueNode) : undefined,
            isOptional: valueNode != null,
            ...(info.exported ? { exported: true } : {}),
          })
        }
      }
    }
    return out
  }

  private readGenericParameterNames(node: Node): string[] {
    // A routine carries `generic_parameters` as a FIELD; a
    // `type_symbol_declaration` carries the same node UNFIELDED (probe: `Box[T]`
    // parses as `type_symbol_declaration(name: Box, generic_parameter_list)`), so
    // the direct-child lookup is the second path, not a fallback on a field miss
    // for the wrong node.
    const field = node.childForFieldName("generic_parameters")
    if (field) return this.genericNamesFrom(field)
    const direct = this.firstChildOfType(node, "generic_parameter_list")
    if (direct) return this.genericNamesFrom(direct)
    const first = node.namedChildCount > 0 ? node.namedChild(0) : null
    if (first && first.type === "type_symbol_declaration") return this.readGenericParameterNames(first)
    return []
  }

  private genericNamesFrom(list: Node): string[] {
    const out: string[] = []
    for (let i = 0; i < list.namedChildCount; i++) {
      const p = list.namedChild(i)
      if (!p) continue
      if (p.type !== "parameter_declaration") {
        // A concept-style generic may alias a bare symbol directly.
        if (p.type === "identifier") out.push(p.text)
        continue
      }
      const declList = p.namedChildCount > 0 ? p.namedChild(0) : null
      if (!declList) continue
      for (let j = 0; j < declList.namedChildCount; j++) {
        const d = declList.namedChild(j)
        if (!d) continue
        if (d.type === "symbol_declaration") {
          const n = d.childForFieldName("name")
          const info = n ? this.readNameNode(n) : null
          if (info?.name) out.push(info.name)
        } else if (d.type === "tuple_deconstruct_declaration") {
          const info = this.readNameNode(d)
          if (info.name) out.push(info.name)
        }
      }
    }
    return out
  }

  private readConceptParameters(concept: Node): ASTEngine.Parameter[] {
    const list = concept.childForFieldName("parameters")
    if (!list) return []
    const out: ASTEngine.Parameter[] = []
    for (let i = 0; i < list.namedChildCount; i++) {
      const p = list.namedChild(i)
      if (!p) continue
      // The grammar aliases each concept parameter form to its own node type
      // (`var_parameter`, `ref_parameter`, `pointer_parameter`,
      // `static_parameter`, `type_parameter`) or leaves a bare `identifier`.
      if (p.type === "identifier") {
        out.push({ name: p.text })
        continue
      }
      if (p.namedChildCount > 0) {
        const sym = p.namedChild(p.namedChildCount - 1)
        if (sym && sym.type === "identifier") {
          out.push({ name: sym.text, ...(p.type === "type_parameter" ? { isType: true } : {}) })
        }
      }
    }
    return out
  }

  /** Pragma names in the declaration's own `pragmas` field. `{.raises: [].}`
   *  parses as `colon_expression(left: identifier(raises), …)`, so the pragma
   *  NAME is the left side — the right side is the argument, not the pragma. */
  private readPragmaNames(node: Node): string[] {
    const out: string[] = []
    const list = node.childForFieldName("pragmas") ?? this.firstChildOfType(node, "pragma_list")
    if (!list) return out
    for (let i = 0; i < list.namedChildCount; i++) {
      let c = list.namedChild(i)
      if (!c) continue
      if (c.type === "colon_expression" || c.type === "equal_expression") c = c.childForFieldName("left") ?? c
      if (c && c.type === "identifier") out.push(c.text)
    }
    return out
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. MODULES: import / export / include
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * `doc/grammar.txt`:
   *   importStmt = 'import' optInd expr ((comma expr)* / 'except' optInd (expr^+ comma))
   *   exportStmt = 'export' optInd expr ((comma expr)* / 'except' optInd (expr^+ comma))
   *   fromStmt   = 'from' expr 'import' optInd expr (comma expr)*
   *   includeStmt= 'include' optInd expr ^+ comma
   *
   * The module PATH is not always an identifier. `import std/[os, strutils]`
   * parses as `infix_expression(left: std, operator: /, right:
   * array_construction(os, strutils))` — the `/` is the stdlib path separator
   * and the bracket is a module LIST. `import std/os as o` is the same
   * infix shape with the `as` operator, where the right side is the local
   * ALIAS, not a module. `import ./rel` and `import ../parent` are relative
   * paths in the same infix shape. `import "file.nim"` is a string literal.
   */
  /**
   * `from M import a, b` — the from-form. Extracted from the old collectModules
   * walk so the fused walk can call it as a handler; the body is unchanged, and
   * the path reader is the SAME one `import` uses, so a module spelled `./x` in
   * one statement and `x` in another is still one target.
   */
  private readImportFromStatement(
    n: Node,
    imports: ASTEngine.ImportInfo[],
    qualifiers: Set<string>,
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const moduleNode = n.childForFieldName("module")
    const modulePathsParsed = moduleNode ? this.parseModuleExpression(moduleNode) : null
    const module = modulePathsParsed?.paths[0]?.path ?? ""
    const list = this.firstChildOfType(n, "expression_list")
    const items = this.identifierTextsIn(list)
    if (module) {
      imports.push({
        module,
        items,
        isDefaultImport: false,
        range: this.nodeRange(n),
        metadata: { nimImport: true, nimFromImport: true },
      })
      for (const seg of this.moduleSegments(module)) qualifiers.add(seg)
      relationships.push({
        source: "(global)",
        target: module,
        type: ASTEngine.RelationshipType.Imports,
        confidence: 1,
        line_number: moduleNode ? moduleNode.startPosition.row + 1 : n.startPosition.row + 1,
        metadata: { relationshipType: "nim_import", isImport: true, fileLevel: true },
      })
    }
  }

  /** `include a, b, c` — one edge per operand, through the same path reader. */
  private readIncludeStatement(
    n: Node,
    imports: ASTEngine.ImportInfo[],
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const list = this.firstChildOfType(n, "expression_list")
    const includePaths: string[] = []
    if (list) {
      for (let i = 0; i < list.namedChildCount; i++) {
        const c = list.namedChild(i)
        if (!c) continue
        const parsedInc = this.parseModuleExpression(c)
        if (parsedInc) for (const pth of parsedInc.paths) includePaths.push(pth.path)
      }
    }
    for (const text of includePaths) {
      imports.push({
        module: text,
        isDefaultImport: false,
        range: this.nodeRange(n),
        metadata: { nimInclude: true },
      })
      relationships.push({
        source: "(global)",
        target: text,
        type: ASTEngine.RelationshipType.Imports,
        confidence: 1,
        line_number: n.startPosition.row + 1,
        metadata: { relationshipType: "nim_include", isImport: true, fileLevel: true },
      })
    }
  }

  /** `export a, b` — a re-export of imported names, so no relationship of its
   *  own; the names land in the export list and nothing else. */
  private readExportStatement(n: Node, exports: ASTEngine.ExportInfo[]): void {
    const list = this.firstChildOfType(n, "expression_list")
    for (const text of this.identifierTextsIn(list)) {
      if (!text) continue
      exports.push({ name: text, metadata: { nimExport: true } })
    }
  }

  private readImportStatement(
    node: Node,
    imports: ASTEngine.ImportInfo[],
    qualifiers: Set<string>,
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    const exceptClause = this.firstChildOfType(node, "except_clause")
    const exceptTexts = exceptClause ? this.identifierTextsIn(this.firstChildOfType(exceptClause, "expression_list")) : []
    const moduleNodes: Node[] = []
    const list = this.firstChildOfType(node, "expression_list")
    if (list) {
      for (let i = 0; i < list.namedChildCount; i++) {
        const c = list.namedChild(i)
        if (!c) continue
        if (exceptClause && this.isDescendantOf(c, exceptClause)) continue
        moduleNodes.push(c)
      }
    }
    for (const mod of moduleNodes) {
      const parsed = this.parseModuleExpression(mod)
      if (!parsed) continue
      for (const { path, alias, qualifier, site } of parsed.paths) {
        imports.push({
          module: path,
          isDefaultImport: false,
          ...(alias ? { alias } : {}),
          ...(exceptTexts.length > 0 ? { items: exceptTexts } : {}),
          range: this.nodeRange(node),
          metadata: { nimImport: true, ...(parsed.isPathList ? { nimModuleList: true } : {}) },
        })
        for (const seg of this.moduleSegments(path)) qualifiers.add(seg)
        relationships.push({
          source: "(global)",
          target: path,
          type: ASTEngine.RelationshipType.Imports,
          confidence: 1,
          line_number: site.startPosition.row + 1,
          metadata: {
            relationshipType: "nim_import",
            isImport: true,
            fileLevel: true,
            ...(parsed.isPathList ? { nimModuleList: true } : {}),
            ...(alias ? { nimAlias: alias } : {}),
            ...(qualifier ? { nimQualifier: qualifier } : {}),
          },
        })
      }
    }
  }

  /**
   * Flatten one `import` operand into module paths.
   *   `strutils`                     → ["strutils"]
   *   `std/[os, strutils]`            → ["std/os", "std/strutils"]
   *   `os, strutils`                 → two operands at the list level
   *   `std/os as o`                  → ["std/os"] alias "o"
   *   `./rel`, `../parent`           → the relative path, verbatim
   *   `"file.nim"`                   → the string literal, verbatim
   */
  private parseModuleExpression(node: Node): { paths: { path: string; alias?: string; qualifier?: string; site: Node }[]; isPathList: boolean } | null {
    if (node.type === "identifier" || node.type === "accent_quoted") {
      return { paths: [{ path: node.text, site: node }], isPathList: false }
    }
    if (node.type === "interpreted_string_literal" || node.type === "raw_string_literal" || node.type === "long_string_literal") {
      return { paths: [{ path: this.unquote(node.text), site: node }], isPathList: false }
    }
    if (node.type === "array_construction") {
      // `import a/[b, c]` — a bare list with no prefix.
      const out: { path: string; alias?: string; qualifier?: string; site: Node }[] = []
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (!c) continue
        const inner = this.parseModuleExpression(c)
        if (inner) out.push(...inner.paths)
      }
      return out.length > 0 ? { paths: out, isPathList: true } : null
    }
    if (node.type === "infix_expression") {
      const op = node.childForFieldName("operator")
      const left = node.childForFieldName("left")
      const right = node.childForFieldName("right")
      if (!op || !left || !right) return null
      // `as` — the right side is the LOCAL ALIAS, never a module.
      if (op.type === "as") {
        const base = this.parseModuleExpression(left)
        const alias = right.type === "identifier" ? right.text : undefined
        if (!base) return null
        return {
          paths: base.paths.map((p) => ({ path: p.path, ...(alias ? { alias } : {}), site: p.site })),
          isPathList: base.isPathList,
        }
      }
      // `/` — the stdlib path separator, and the reason a NIM path has
      // UNBOUNDED depth: `std/os` is one infix, but `std/private/bitops_utils`
      // is an infix whose LEFT is itself an infix. Handling only
      // identifier/identifier silently dropped every deeper path — measured on
      // the 12-repo corpus: 171 deep-path imports across 141 files produced NO
      // import edge at all, and because the whole path vanished there was no
      // dangling target that could have surfaced it. It also REWROTE one
      // spelling wrongly: `import g/../h` came out as the target `g/h`, a wrong
      // dependency edge rather than a missing one.
      //
      // The separator is NOT an anonymous "/" token: the grammar makes it a
      // NAMED node of type `operator` whose TEXT is the entire separator
      // ("/", or "/../" when a parent hop is fused into the same token), so
      // `op.type` is never "/" and the written path is the node's own text.
      // A `[...]` right side is the one case that is a module LIST rather than
      // a path, and it still has to yield one edge per element.
      const opText = op.text
      if (opText.indexOf("/") === -1) return null
      // A QUALIFIER SET on a from-import. `from std/uri {.all.} as uri2 import
      // removeDotSegments` parses as
      //   infix(std/uri, "/", pragma_expression(identifier(uri), pragma_list({.all.})))
      //   infix(  that,  "as",  identifier(uri2))
      // so the node's own text is "std/uri {.all.}" and the OLD rule published
      // that whole string as the module — a dependency edge on a name no file
      // has, and the real module missing from the graph. The `{.all.}` is a
      // request to import EVERY symbol; it is not part of the path.
      //
      // Found by the full 3,914-file oracle comparison, not by the 60-file
      // rotation: the differential reported 0 unexplained on every sample that
      // did not happen to draw one of the five affected files, so this class was
      // invisible until the oracle was run over the whole corpus.
      if (right.type === "pragma_expression") {
        const inner = right.childForFieldName("left")
        if (!inner || (inner.type !== "identifier" && inner.type !== "accent_quoted")) return null
        const qualifierList = right.childForFieldName("right")
        return {
          paths: [{
            path: `${this.nodeText(left)}/${inner.text}`,
            site: right,
            ...(qualifierList ? { qualifier: this.nodeText(qualifierList) } : {}),
          }],
          isPathList: false,
        }
      }
      if (right.type === "array_construction") {
        const out: { path: string; alias?: string; qualifier?: string; site: Node }[] = []
        const prefix = this.nodeText(left)
        for (let i = 0; i < right.namedChildCount; i++) {
          const c = right.namedChild(i)
          if (!c) continue
          const name = c.type === "identifier" ? c.text : null
          if (name) out.push({ path: `${prefix}/${name}`, site: c })
        }
        return out.length > 0 ? { paths: out, isPathList: true } : null
      }
      return { paths: [{ path: this.nodeText(node), site: node }], isPathList: false }
    }
    if (node.type === "prefix_expression") {
      // A RELATIVE path. `import ./shapes` and `import ../parent` are not
      // infix expressions: the leading `./` / `../` is the PREFIX operator, so
      // the grammar produces `prefix_expression(operator, identifier)` — and
      // handling only the infix shape silently dropped every relative import
      // (measured: 0 imports persisted for a three-file module whose files all
      // use `import ./sibling`, while the same analyzer returned imports for
      // `import std/os`).
      // The path text is taken from the NODE, not reassembled, so `./x` and
      // `../x` keep exactly the spelling the source used — and the deep forms
      // `./core/impl` and `../pkg/mod.nim` come along for free, because the
      // prefix operator node's text already carries the whole `./` or `../`
      // and the operand is a path expression rather than a bare identifier.
      // Reading only the operand was what dropped 434 multi-segment relative
      // imports across the corpus.
      // The relative form can also carry a QUALIFIER SET, and then the node's
      // own text is the whole `import ./m1 {.all.}` operand:
      //   prefix_expression(operator("./"), pragma_expression(identifier(m1), pragma_list))
      // so the same rule as the `/` branch applies — the module is the prefix
      // token plus the pragma's left leaf, and `{.all.}` is a request for every
      // symbol, not a path segment.
      const qualOp = node.childForFieldName("operator")
      if (qualOp) {
        // Skip the operator node BY IDENTITY. It is a NAMED node of type
        // `operator` and it is the first named child, so "the first named child"
        // returns the `./` token and never reaches the operand — which is why
        // the first version of this fix silently did nothing and both the
        // analyzer and the oracle kept publishing `./m1 {.all.}`.
        let operand: Node | null = null
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (c && c.id !== qualOp.id) {
            operand = c
            break
          }
        }
        if (operand && operand.type === "pragma_expression") {
          const inner = operand.childForFieldName("left")
          if (inner && (inner.type === "identifier" || inner.type === "accent_quoted")) {
            const qualifierList = operand.childForFieldName("right")
            return {
              paths: [{
                path: `${qualOp.text}${inner.text}`,
                site: operand,
                ...(qualifierList ? { qualifier: this.nodeText(qualifierList) } : {}),
              }],
              isPathList: false,
            }
          }
        }
      }
      return { paths: [{ path: this.nodeText(node), site: node }], isPathList: false }
    }
    if (node.type === "dot_expression") {
      // A dotted module path that is not a relative one (`import a.b.c`).
      return { paths: [{ path: this.nodeText(node), site: node }], isPathList: false }
    }
    return null
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. RELATIONSHIPS
  // ═══════════════════════════════════════════════════════════════════════

  /** `contains` — owner → owned symbol, at the member's own declaration line. */
  private collectContainment(symbols: ASTEngine.UniversalSymbol[], relationships: ASTEngine.UniversalRelationship[]): void {
    const seen = new Set<string>()
    for (const s of symbols) {
      if (!s.ownerName) continue
      const key = `${s.ownerName} ${s.name}`
      if (seen.has(key)) continue
      seen.add(key)
      relationships.push({
        source: s.ownerName,
        target: s.name,
        type: ASTEngine.RelationshipType.Contains,
        confidence: 1,
        ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
        metadata: { relationshipType: "nim_contains" },
      })
    }
  }

  /**
   * `extends` — `type D = ref object of B`. The `inherits` field is a
   * `type_expression`; its leaf is the base type.
   *
   * The base is NOT required to be declared in this file. In a real Nim module
   * the base almost never is: `Named = ref object of Point` with `Point` in a
   * sibling file is the normal shape, and requiring a same-file declaration
   * dropped the whole family at the seam — measured: a three-file module whose
   * subclass lived in a different file from its base persisted ZERO `extends`
   * rows. The edge is emitted whenever the base is either declared in this file
   * OR reachable through an import, and the evidence tier says which: a
   * same-file base is `structural`, an imported one is `import_based` so the
   * resolver never mistakes a cross-module base for a local one.
   *
   * `ref object of RootObj` names the compiler's own `RootObj`, which is
   * neither declared nor imported — a name with no referent — so it is
   * deliberately NOT emitted: an `extends` to a non-existent symbol is the
   * phantom this guard exists to prevent.
   */
  private collectInheritance(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    fileTypes: Set<string>,
  ): void {
    for (const s of symbols) {
      const base = s.metadata?.nimInherits
      if (typeof base !== "string" || !base) continue
      if (base === s.name) continue
      // The compiler's own roots have no referent in any file; an `extends` to
      // them would be a guaranteed-dangling edge, so they are the only bases
      // excluded. Every other base is a REAL inheritance fact — same-file or
      // cross-file — and the store resolves it.
      if (NIM_COMPILER_ROOTS.has(base)) continue
      const sameFile = fileTypes.has(base)
      relationships.push({
        source: s.name,
        target: base,
        type: ASTEngine.RelationshipType.Extends,
        confidence: 1,
        ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
        metadata: { relationshipType: "nim_object_inheritance", ...(sameFile ? {} : { nimCrossModuleBase: true }) },
      })
    }
  }

  /**
   * `overrides` — Nim method dispatch is dynamic, so overriding is real. The
   * derivation is AST-only and file-local: `declaredSubtypes` comes from
   * `object_declaration.inherits`, so a `method m(d: Dog)` overrides a
   * `method m(a: Animal)` exactly when this file declares `Dog` as a subtype of
   * `Animal`. An overload SET (`method m(d: Dog)` and `method m(d: Cat)`) emits
   * one edge per candidate and marks the edge ambiguous rather than guessing.
   *
   * Cross-file and system-library bases are NOT inferable without a semantic
   * index, and are declared as an explicit limit rather than guessed from name
   * shape.
   */
  private collectOverrides(
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    declaredSubtypes: Map<string, Set<string>>,
    companion?: Map<string, Set<string>>,
  ): void {
    if (declaredSubtypes.size === 0 && !companion) return
    // Group every method in this file by (receiver type, name). A Nim method
    // override keeps the SAME name and differs only in its receiver type, so
    // the name alone cannot address either end of the edge — the family's
    // `localEdgeLabel` convention qualifies an override with its owner, and the
    // Nim owner of a method is its receiver TYPE, so the labels are
    // `Receiver.method`. Without the qualifier `describe -> describe` is
    // degenerate (and the store cannot resolve it: both ends are one name).
    const byKey = new Map<string, ASTEngine.UniversalSymbol[]>()
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method) continue
      const receiver = String(s.metadata?.nimReceiverType ?? "")
      if (!receiver) continue
      const key = `${receiver} ${s.name}`
      const arr = byKey.get(key) ?? []
      arr.push(s)
      byKey.set(key, arr)
    }
    if (byKey.size === 0) return
    const emitted = new Set<string>()
    for (const [key, group] of byKey) {
      const sep = key.indexOf(" ")
      const receiver = key.slice(0, sep)
      const name = key.slice(sep + 1)
      // Every supertype of this receiver that ALSO declares a method of the
      // same name is a base this method overrides. `declaredSubtypes` maps
      // base -> declared subtypes; invert it to walk upward.
      for (const superType of this.transitiveSupertypes(receiver, declaredSubtypes)) {
        const bases = byKey.get(`${superType} ${name}`)
        if (!bases) continue
        for (const b of bases) {
          if (superType === receiver) continue
          const sourceLabel = `${receiver}.${name}`
          const targetLabel = `${superType}.${name}`
          const k = `${sourceLabel} ${targetLabel}`
          if (emitted.has(k)) continue
          emitted.add(k)
          relationships.push({
            source: sourceLabel,
            target: targetLabel,
            type: ASTEngine.RelationshipType.Overrides,
            confidence: 1,
            ...(b.range?.startLine ? { line_number: b.range.startLine } : {}),
            metadata: { relationshipType: "nim_method_override", receiverType: receiver, baseReceiverType: superType },
          })
        }
      }
    }
    if (!companion || byKey.size === 0) return
    // ── CROSS-FILE overrides ──────────────────────────────────────────────
    // A Nim method's DIRECT base is already named in the source and already in
    // this file's symbols, even when the base TYPE lives in another module: the
    // receiver's `nimInherits` is the written base name. What a per-file
    // analyzer cannot know is whether that other module DECLARES a method of
    // the same name — which is exactly what the project's override companion
    // index answers.
    //
    // This adopts the same shared resolver six other analyzers use
    // (`findDeclaringParent`, src/ast/override-context.ts) rather than a Nim-
    // specific reimplementation, so the semantics are identical across
    // languages: the first ancestor in declaration order that actually declares
    // the method, falling back to the first parent only when no ancestor does.
    //
    // The honest depth limit, and it is a real one: the companion carries
    // (owner -> method names) and NOT each type's own base list, so the walk can
    // descend only as far as bases visible in THIS file. A hierarchy three
    // modules deep, where the middle module's base is in a third, stops at the
    // visible link. That is recorded on the edge as `nimCrossFileBase` so a
    // reader can tell a companion-resolved edge from a same-file one, and it is
    // the same limit the java/kotlin lanes document.
    const parentsOf = new Map<string, string[]>()
    for (const [base, subs] of declaredSubtypes) {
      for (const sub of subs) {
        const arr = parentsOf.get(sub) ?? []
        if (arr.indexOf(base) === -1) arr.push(base)
        parentsOf.set(sub, arr)
      }
    }
    const getParents = (typeName: string): readonly string[] => parentsOf.get(typeName) ?? []
    for (const [key, group] of byKey) {
      const sep = key.indexOf(" ")
      const receiver = key.slice(0, sep)
      const name = key.slice(sep + 1)
      const startParents = parentsOf.get(receiver) ?? []
      if (startParents.length === 0) continue
      const declaring = findDeclaringParent(name, startParents, companion, getParents)
      if (!declaring || declaring === receiver) continue
      const sourceLabel = `${receiver}.${name}`
      const targetLabel = `${declaring}.${name}`
      const k = `${sourceLabel} ${targetLabel}`
      if (emitted.has(k)) continue
      emitted.add(k)
      relationships.push({
        source: sourceLabel,
        target: targetLabel,
        type: ASTEngine.RelationshipType.Overrides,
        // 0.9, not 1: the companion asserts that the other module DECLARES the
        // method, which is the substance of the edge, but the walk could not
        // descend past a base that is itself in a third module. The
        // differential's 0.7 claim threshold keeps this a claim rather than an
        // assertion, which is the honest reading of a partly-visible hierarchy.
        confidence: 0.9,
        ...(group[0]?.range?.startLine ? { line_number: group[0].range.startLine } : {}),
        metadata: {
          relationshipType: "nim_method_override",
          receiverType: receiver,
          baseReceiverType: declaring,
          nimCrossFileBase: true,
          nimResolution: "companion-index",
        },
      })
    }
  }

  /** Every strict supertype of `leaf` reachable through the declared-subtype map. */
  private transitiveSupertypes(leaf: string, declaredSubtypes: Map<string, Set<string>>): Set<string> {
    const supers = new Set<string>()
    const seen = new Set<string>([leaf])
    const queue = [leaf]
    while (queue.length > 0) {
      const cur = queue.pop()!
      for (const [base, subs] of declaredSubtypes) {
        if (!subs.has(cur)) continue
        if (seen.has(base)) continue
        seen.add(base)
        supers.add(base)
        queue.push(base)
      }
    }
    return supers
  }


  /**
   * `calls` / `uses` — the two value-flow families.
   *
   * `calls`  — a `call` / `dot_generic_call` node: the target is the callee LEAF
   *            (shared-callee family rule — `a.b.c()` targets `c`), read from
   *            the grammar's `function` field. Command syntax (`echo "x"`) is
   *            the same node. A `bracket_expression` callee (`Foo[int](x)`,
   *            `parseJson[int](s)`) is a generic INSTANTIATION and its target is
   *            the `left` leaf. Compiler intrinsics that Nim does not allow a
   *            user to overload are filtered (see NIM_BUILTINS).
   *
   * `uses`   — a READ of a name this file declares, from two positions:
   *            (a) a bare `identifier` in an expression position, and
   *            (b) the member leaf of a `dot_expression` that is not a call
   *            callee (Nim's UFCS makes `x.foo` a member read). Resolution
   *            requires the name to be declared in THIS file, because Nim's
   *            declare-before-use rule makes anything else either an import or
   *            an error. A lexical scope stack (parameters, generic
   *            parameters, block/branch/loop bindings) suppresses shadowed
   *            names so a local never swallows a file-level value.
   */
  private collectCallsAndUses(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    ctx: {
      fileValues: Set<string>
      fileTypes: Set<string>
      fileCallables: Set<string>
      fileEnumMembers: Set<string>
      fileFieldNames: Set<string>
      genericParamNames: Set<string>
      importQualifiers: Set<string>
    },
  ): void {
    const emitted = new Set<string>()
    // ── the two families that used to own their own full-tree walks ────────
    // `instantiates` and the declared-type `references` are per-node families
    // that were each written as a separate traversal of the same tree. They ride
    // this walk now, which already tracks the enclosing callable — the thing both
    // of them were maintaining a second copy of.
    //
    // Each keeps its OWN dedupe set, because each asks a different question and
    // the keys are not comparable: `instantiates` dedupes per FILE on the bare
    // type name (a type constructed in three places is ONE edge, at the first
    // site), the declared-type family on `owner target` (does this routine
    // depend on this type at all, not what is written at each site), and
    // calls/uses on `source type target`. Sharing one set would silently drop
    // edges, which is why the A/B output diff is the gate on this change.
    const instantiated = new Set<string>()
    const typeRefEmitted = new Set<string>()
    const typeRefHelpers = this.makeDeclaredTypeRefHelpers(
      relationships, ctx.fileTypes, ctx.genericParamNames, ctx.fileValues, ctx.fileCallables, typeRefEmitted,
    )
    const push = (source: string, target: string, type: ASTEngine.RelationshipType, confidence: number, line: number, extra: Record<string, unknown>): void => {
      const key = `${source} ${type} ${target}`
      if (emitted.has(key)) return
      emitted.add(key)
      relationships.push({
        source,
        target,
        type,
        confidence,
        line_number: line,
        metadata: extra,
      })
    }

    interface Scope {
      names: Set<string>
      fnName: string | null
    }
    const scopeStack: Scope[] = []
    const top = (): Scope | null => (scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : null)
    const isShadowed = (name: string): boolean => {
      for (let i = scopeStack.length - 1; i >= 0; i--) if (scopeStack[i].names.has(name)) return true
      return false
    }
    const currentFn = (): string => {
      for (let i = scopeStack.length - 1; i >= 0; i--) {
        const name = scopeStack[i].fnName
        if (name) return name
      }
      return "(global)"
    }

    const resolvable = (name: string): boolean =>
      ctx.fileValues.has(name) || ctx.fileEnumMembers.has(name) || ctx.fileFieldNames.has(name)

    interface Item {
      node: Node
      exit: boolean
      pushed: boolean
    }
    const stack: Item[] = [{ node: rootNode, exit: false, pushed: false }]

    while (stack.length > 0) {
      const { node, exit, pushed } = stack.pop()!
      if (exit) {
        if (pushed) scopeStack.pop()
        continue
      }
      const type = node.type
      let pushedScope = false

      // ── the two fused families, before the scope frame is pushed ─────────
      // currentFn() is read BEFORE this node's own scope exists, which is what
      // the old separate walks did: they attributed an edge to the callable
      // ENCLOSING the construct, never to the callable the construct declares.
      this.collectInstantiationAt(node, relationships, ctx.fileTypes, ctx.fileCallables, instantiated, currentFn())
      this.collectDeclaredTypeRefAt(node, typeRefHelpers)

      // ── scope frames ───────────────────────────────────────────────────
      const callable = this.callableNodes[type]
      if (callable) {
        const frame: Scope = { names: new Set<string>(), fnName: null }
        const nameNode = node.childForFieldName("name")
        const info = nameNode ? this.readNameNode(nameNode) : null
        frame.fnName = info?.name ?? null
        for (const p of this.readParameters(node)) if (p.name && p.name !== "_") frame.names.add(p.name)
        for (const g of this.readGenericParameterNames(node)) frame.names.add(g)
        scopeStack.push(frame)
        pushedScope = true
      } else if (type === "concept_declaration") {
        // A CONCEPT is a scope frame like a callable: its formal parameters are
        // bindings, and its body belongs to the concept rather than to the file.
        //
        // Without this frame, `type Addable = concept x` / `(x + x) is
        // SomeNumber` published `uses (global) -> x` — the parameter was unbound,
        // so the read fell through to the same-name rule and then attributed
        // itself to file scope. Found by the M12 ground truth; the differential's
        // oracle made the same omission, so the lane reported 0% unexplained with
        // both implementations agreeing on an edge neither should have published.
        const frame: Scope = { names: new Set<string>(), fnName: null }
        // The concept's name lives on the enclosing type_declaration, not on the
        // concept_declaration node.
        const ownerDecl = node.parent && node.parent.type === "type_declaration" ? node.parent.namedChild(0) : null
        if (ownerDecl) {
          const n = ownerDecl.childForFieldName("name")
          const info = n ? this.readNameNode(n) : null
          frame.fnName = info?.name ?? null
        }
        const params = this.firstChildOfType(node, "parameter_list")
        if (params) {
          for (let i = 0; i < params.namedChildCount; i++) {
            const c = params.namedChild(i)
            if (c && (c.type === "identifier" || c.type === "accent_quoted") && c.text !== "_") frame.names.add(c.text)
          }
        }
        scopeStack.push(frame)
        pushedScope = true
      } else if (type === "statement_list" || type === "block" || type === "do_block" || type === "term_rewriting_pattern") {
        scopeStack.push({ names: new Set<string>(), fnName: null })
        pushedScope = true
      } else if (type === "of_branch" || type === "except_branch" || type === "elif_branch" || type === "else_branch" || type === "finally_branch") {
        scopeStack.push({ names: new Set<string>(), fnName: null })
        pushedScope = true
      } else if (type === "variable_declaration") {
        // A `let`/`var`/`const` binds in the CURRENT frame. At module scope the
        // binding is already in `fileValues`, so binding it in a frame is
        // harmless (and required inside a body).
        const frame = top()
        if (frame) {
          const list = node.namedChildCount > 0 ? node.namedChild(0) : null
          if (list && list.type === "symbol_declaration_list") {
            for (const bound of this.readBoundDeclarationNames(list)) frame.names.add(bound)
          }
        }
      } else if (type === "for") {
        // The loop variable binds in the loop's OWN frame so a later read of a
        // same-named module value is not swallowed by it.
        scopeStack.push({ names: new Set<string>(), fnName: null })
        pushedScope = true
        const left = node.childForFieldName("left")
        if (left) {
          const frame = top()
          for (const d of this.symbolNamesIn(left)) if (d && frame) frame.names.add(d)
        }
      }

      // `except ValueError as e` binds `e` in the branch frame.
      if (type === "except_branch") {
        const values = node.childForFieldName("values")
        if (values) {
          const frame = top()
          for (let i = 0; i < values.namedChildCount; i++) {
            const v = values.namedChild(i)
            if (v && v.type === "infix_expression") {
              const op = v.childForFieldName("operator")
              if (op && op.type === "as") {
                const r = v.childForFieldName("right")
                if (r && r.type === "identifier" && frame) frame.names.add(r.text)
              }
            }
          }
        }
      }

      // ── calls ──────────────────────────────────────────────────────────
      if (type === "call") {
        const fn = node.childForFieldName("function")
        // A modifier keyword in a TYPE position (`a: sink seq[int]`) is a type
        // modifier, not a call site; outside one it is the ordinary function.
        const leafForGate = fn ? this.calleeLeafNode(fn) : null
        const isTypeConstruction = !!leafForGate && ctx.fileTypes.has(leafForGate.text) && !ctx.fileCallables.has(leafForGate.text)
        if (fn && this.isParameterModifierCall(node) && this.isInTypePosition(node)) {
          // handled by the declared-type pass
        } else if (isTypeConstruction) {
          // object construction — the `instantiates` pass owns this edge
        } else {
        const leaf = fn ? this.calleeLeafNode(fn) : undefined
        const leafText = leaf?.text
        if (leafText && leafText !== "_" && REAL_NIM_BUILTINS.indexOf(leafText) === -1 && !isKeywordLike(leafText)) {
          const source = currentFn()
          const importBased = fn ? this.isImportQualified(fn, ctx.importQualifiers) : false
          push(source, leafText, ASTEngine.RelationshipType.Calls, importBased ? 0.75 : 0.85, leaf ? leaf.startPosition.row + 1 : node.startPosition.row + 1, {
            relationshipType: "nim_call",
            callExpression: this.nodeText(node).slice(0, 60),
            ...(importBased ? { nimImportBased: true } : {}),
          })
        }
        }
      } else if (type === "dot_generic_call") {
        // `x.method[:T](args)` — the rare explicit-type-argument UFCS form. The
        // `function` field is the METHOD name; `first_argument` is the receiver.
        const fn = node.childForFieldName("function")
        const leafText = fn?.text
        if (leafText && leafText !== "_" && REAL_NIM_BUILTINS.indexOf(leafText) === -1) {
          push(currentFn(), leafText, ASTEngine.RelationshipType.Calls, 0.85, fn ? fn.startPosition.row + 1 : node.startPosition.row + 1, {
            relationshipType: "nim_dot_generic_call",
            callExpression: this.nodeText(node).slice(0, 60),
          })
        }
      }

      // ── uses: member leaf of a dot_expression that is not a call callee ──
      if (type === "dot_expression") {
        const leaf = this.dotLeafNode(node)
        const leafText = leaf?.text
        const left = node.childForFieldName("left")
        const inCallCallee = this.isCallCallee(node)
        // A member leaf that names a CALLABLE this file declares is a PARENLESS
        // UFCS CALL, not a field read: `r.describe` invokes `describe(r)`, and
        // Nim writes it with no parentheses and no call node. The `calls` rule
        // already admits "UFCS member calls"; this is the one call form it was
        // not emitting, because the member-leaf pass had no callee branch at all
        // — the whole shape fell through to `uses` or to nothing.
        //
        // Found by the M12 ground truth (a false negative: `calls
        // exercise -> describe` for `r.describe` inside `echo s, …, r.describe`).
        // Both the analyzer AND the differential oracle omitted it, so the lane
        // reported 0% unexplained — the shape was invisible to every gate.
        const callableName = leafText && (ctx.fileCallables.has(leafText)) ? leafText : null
        if (callableName && !inCallCallee) {
          push(currentFn(), callableName, ASTEngine.RelationshipType.Calls, 0.9, leaf ? leaf.startPosition.row + 1 : node.startPosition.row + 1, {
            relationshipType: "nim_ufcs_member_call",
            callExpression: this.nodeText(node).slice(0, 60),
          })
        } else if (leafText && leafText !== "_" && !inCallCallee && resolvable(leafText) && !isKeywordLike(leafText)) {
          const importBased = left ? this.isImportQualified(left, ctx.importQualifiers) : false
          push(currentFn(), leafText, ASTEngine.RelationshipType.Uses, 0.75, leaf ? leaf.startPosition.row + 1 : node.startPosition.row + 1, {
            relationshipType: "nim_member_access",
            fieldAccessExpression: this.nodeText(node).slice(0, 60),
            ...(importBased ? { nimImportBased: true } : {}),
          })
        }
      }

      // ── uses: bare identifier reads ────────────────────────────────────
      if (type === "identifier") {
        const name = node.text
        if (
          name !== "_" &&
          !name.startsWith("gensym") &&
          resolvable(name) &&
          !isKeywordLike(name) &&
          !this.isDeclarationName(node) &&
          !this.isConceptParameterPosition(node) &&
          !this.isCallCalleeSubtree(node) &&
          !this.isDotLeaf(node) &&
          !this.isInTypePosition(node) &&
          !this.isModulePathPosition(node) &&
          !this.isLabelPosition(node) &&
          !this.isColonLabel(node) &&
          !this.isExceptAliasPosition(node) &&
          !this.isAssignmentTarget(node) &&
          !this.isAssignmentTarget(node, true) &&
          !isShadowed(name)
        ) {
          push(currentFn(), name, ASTEngine.RelationshipType.Uses, 1, node.startPosition.row + 1, {
            relationshipType: "nim_identifier_usage",
            nodeType: node.type,
          })
        }
      }

      stack.push({ node, exit: true, pushed: pushedScope })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const c = node.namedChild(i)
        if (c) stack.push({ node: c, exit: false, pushed: false })
      }
    }
  }

  /**
   * `instantiates` — Nim object construction is `TypeName(field: v, …)`, a
   * `call` whose `function` is a TYPE name. Resolution requires the callee to be
   * a type THIS file declares and not a callable it also declares, so a
   * same-named value wins over the type and no `new`-style builtin's argument is
   * ever misread as a construction.
   */
  private collectInstantiations(
    rootNode: Node,
    relationships: ASTEngine.UniversalRelationship[],
    fileTypes: Set<string>,
    fileCallables: Set<string>,
  ): void {
    const emitted = new Set<string>()
    // The instantiation happens INSIDE a routine in every realistic case, so the
    // edge must be attributed to that routine; "(file)" would make every
    // construction in the file share one source and hide the call chain.
    const stack: { node: Node; fn: string | null }[] = [{ node: rootNode, fn: null }]
    while (stack.length > 0) {
      const { node: n, fn: enclosing } = stack.pop()!
      let nextEnclosing = enclosing
      const callable = this.callableNodes[n.type]
      if (callable) {
        const nameNode = n.childForFieldName("name")
        const info = nameNode ? this.readNameNode(nameNode) : null
        nextEnclosing = info?.name ?? enclosing
      }
      if (n.type === "call") {
        const fn = n.childForFieldName("function")
        const leaf = fn ? this.calleeLeafNode(fn) : null
        const leafText = leaf?.text
        if (leafText && fileTypes.has(leafText) && !fileCallables.has(leafText)) {
          const key = leafText
          if (!emitted.has(key)) {
            emitted.add(key)
            relationships.push({
              source: nextEnclosing ?? "(file)",
              target: leafText,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.9,
              line_number: leaf ? leaf.startPosition.row + 1 : n.startPosition.row + 1,
              metadata: { relationshipType: "nim_object_construction", callExpression: this.nodeText(n).slice(0, 60), isConstructor: true },
            })
          }
        }
        // `new(T)` / `new(result, T)` — the canonical allocation form, whose
        // type argument is a bare identifier rather than a callee.
        if (leafText === "new") {
          const args = this.firstChildOfType(n, "argument_list")
          if (args) {
            for (let i = 0; i < args.namedChildCount; i++) {
              const a = args.namedChild(i)
              if (!a) continue
              const t = a.type === "identifier" ? a.text : null
              if (t && fileTypes.has(t) && !fileCallables.has(t) && !emitted.has(`new:${t}`)) {
                emitted.add(`new:${t}`)
                relationships.push({
                  source: nextEnclosing ?? "(file)",
                  target: t,
                  type: ASTEngine.RelationshipType.Instantiates,
                  confidence: 0.9,
                  line_number: a.startPosition.row + 1,
                  metadata: { relationshipType: "nim_new_allocation", isConstructor: true },
                })
              }
            }
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ node: c, fn: nextEnclosing })
      }
    }
  }

  /**
   * `references` — the declared-type graph, from the positions the grammar
   * marks as types: the `type` field of a parameter/field/variant
   * discriminator/value binding, the `return_type` of a routine or do-block, the
   * `inherits` of an object, the `refines` of a concept, a `cast[T]`, and the
   * right-hand side of a type alias.
   *
   * Two leaves are collected from a type expression, and both matter in Nim:
   *   - the type CONSTRUCTOR (`Vec`, `Table`) — the same as the C/Rust family
   *     rule;
   *   - each type ARGUMENT (`seq[T]`, `Table[K, V]`, `array[3, T]`) — Nim has
   *     no `operator()` call syntax for types, so `seq[MyType]` is the ONLY way
   *     to depend on `MyType` and dropping the argument would lose the
   *     dependency entirely. This is a documented, NIM-specific extension of the
   *     zig "no generic-application refs" precedent.
   *
   * Builtin type names, this file's own generic parameters, and the alias's own
   * name are excluded, so no edge can point at a name that is not a type.
   */
  /**
   * The `instantiates` half of the fused edge walk, as a per-node handler.
   *
   * It used to own a full-tree walk with its own `{node, fn}` stack purely to
   * learn the enclosing callable — which the fused walk already tracks for the
   * shadow rules, so the second copy of that state was pure cost.
   *
   * `enclosing` arrives as the fused walk's `currentFn()`, which returns the
   * sentinel "(global)" when no callable is in scope. The original produced
   * `null` there and wrote `nextEnclosing ?? "(file)"`, so the sentinel is
   * translated back rather than emitted: an instantiation at file scope has no
   * callable to name, and the store resolves a relationship's source_symbol_id by
   * matching the source name against a symbol, so "(global)" would resolve to
   * nothing while "(file)" is the established spelling for this family.
   */
  private collectInstantiationAt(
    node: Node,
    relationships: ASTEngine.UniversalRelationship[],
    fileTypes: Set<string>,
    fileCallables: Set<string>,
    emitted: Set<string>,
    enclosing: string,
  ): void {
    if (node.type !== "call") return
    const source = enclosing === "(global)" ? "(file)" : enclosing
    const fn = node.childForFieldName("function")
    const leaf = fn ? this.calleeLeafNode(fn) : null
    const leafText = leaf?.text
    if (leafText && fileTypes.has(leafText) && !fileCallables.has(leafText)) {
      const key = leafText
      if (!emitted.has(key)) {
        emitted.add(key)
        relationships.push({
          source,
          target: leafText,
          type: ASTEngine.RelationshipType.Instantiates,
          confidence: 0.9,
          line_number: leaf ? leaf.startPosition.row + 1 : node.startPosition.row + 1,
          metadata: { relationshipType: "nim_object_construction", callExpression: this.nodeText(node).slice(0, 60), isConstructor: true },
        })
      }
    }
    // `new(T)` / `new(result, T)` — the canonical allocation form, whose type
    // argument is a bare identifier rather than a callee.
    if (leafText === "new") {
      const args = this.firstChildOfType(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const a = args.namedChild(i)
          if (!a) continue
          const t = a.type === "identifier" ? a.text : null
          if (t && fileTypes.has(t) && !fileCallables.has(t) && !emitted.has(`new:${t}`)) {
            emitted.add(`new:${t}`)
            relationships.push({
              source,
              target: t,
              type: ASTEngine.RelationshipType.Instantiates,
              confidence: 0.9,
              line_number: a.startPosition.row + 1,
              metadata: { relationshipType: "nim_new_allocation", isConstructor: true },
            })
          }
        }
      }
    }
  }

  /**
   * The declared-type half's closures, built ONCE PER FILE.
   *
   * Hoisting these is the whole point of the factory. The first attempt at
   * fusing this family kept the logic inline in the per-node handler, which meant
   * `ownerOf` and the recursive `collectFromTypeExpression` were REBUILT ON EVERY
   * NODE VISIT — they had been built once per file before that. The output was
   * byte-identical and the change measured 5.5% SLOWER, in a walk that visits
   * thousands of nodes per file.
   *
   * Same lesson as the rejected per-node `Map` memoization, arriving from the
   * other direction: in a hot walk, allocating anything per node costs more than
   * the traversal it rides on. So the rule for this walk is one stack, one local
   * counter, and closures built once.
   */
  private makeDeclaredTypeRefHelpers(
    relationships: ASTEngine.UniversalRelationship[],
    fileTypes: Set<string>,
    genericParamNames: Set<string>,
    fileValues: Set<string>,
    fileCallables: Set<string>,
    emitted: Set<string>,
  ): DeclaredTypeRefHelpers {

    /**
     * The DECLARATION a type reference belongs to — the same anchoring the go
     * lane uses (`resolveSource`). It matters at the STORE, not only in the
     * graph: `parallel-indexer` resolves a relationship's `source_symbol_id` by
     * matching the source name against a symbol, so an edge whose source is a
     * synthetic label has nothing to resolve to and the row is DROPPED. Measured
     * through the real CLI on a three-file module: with `source: "(declared-type)"`
     * the declared-type family persisted ZERO rows while every symbol-anchored
     * family persisted; anchoring to the declaring routine/type brought it back.
     * (The zig lane has the same synthetic source and the same latent loss.)
     *
     * A field or a variant discriminator attributes to the OWNING type; a
     * parameter, a return type, a cast and a value annotation attribute to the
     * enclosing callable; a type alias attributes to the alias itself.
     */
    const ownerOf = (start: Node): { name: string; kind: string } | null => {
      let owner: { name: string; kind: string } | null = null
      let p: Node | null = start
      while (p) {
        const callable = this.callableNodes[p.type]
        if (callable) {
          const n = p.childForFieldName("name")
          const info = n ? this.readNameNode(n) : null
          if (info?.name) return { name: info.name, kind: "callable" }
          return null
        }
        if (p.type === "type_declaration") {
          const symDecl = p.namedChildCount > 0 ? p.namedChild(0) : null
          if (symDecl && symDecl.type === "type_symbol_declaration") {
            const n = symDecl.childForFieldName("name")
            const info = n ? this.readNameNode(n) : null
            if (info?.name) return { name: info.name, kind: "type" }
          }
          return null
        }
        if (p.type === "field_declaration" || p.type === "variant_discriminator_declaration") {
          // Keep walking: the owning type_declaration is above it.
          p = p.parent
          continue
        }
        if (p.type === "object_declaration") {
          // The owning type is above the object; a field inside it attributes
          // to the type, which the `type_declaration` arm handles.
          p = p.parent
          continue
        }
        if (p.type === "statement_list" || p.type === "block" || p.type === "do_block") {
          // A LOCAL's type annotation (`var b: Builder` inside a proc) is a real
          // declared-type dependency, and the enclosing CALLABLE is the symbol
          // that owns the fact — so keep walking up to it. Stopping here (the
          // first version) dropped every local annotation, which is the single
          // most common way a Nim proc names a type: measured on the contract
          // fixture, `var b: Builder` in `exercise` produced NO reference edge.
          // What this correctly still drops is a type written in a body that has
          // no enclosing callable at all (a bare `static:` block at file scope).
          p = p.parent
          continue
        }
        p = p.parent
      }
      return owner
    }

    // A name that this file declares as a VALUE or as a CALLABLE is not a type,
    // wherever it is written. The declared-type pass used to accept any
    // identifier it found in a type position, which produced two fabrications
    // the full-corpus oracle names exactly:
    //
    //   references -> fail   (tests/statictypes/tgenericcompiletimeproc.nim:29)
    //       `type Foo = typeof(p(fail(123)))` — `fail` is `proc fail[T](x: T)`,
    //       a callable used as a call, and `typeof(...)` of a call is not a
    //       named type reference to the callee.
    //   references -> false  (tests/objects/tinvalid_construction.nim:267)
    //       `TNestedChoices(outerChoice: false, …)` — `false` is a literal VALUE
    //       of a field named `outerChoice`, and it is not a type at all.
    //
    // Both resolved to real identifiers, so no dangling check could fire, and
    // both are the kind of edge that survives every count-based gate.
    const isValueNotType = (leaf: string): boolean =>
      fileValues.has(leaf) || fileCallables.has(leaf) || NIM_LITERAL_KEYWORDS.indexOf(leaf) !== -1

    const push = (site: Node, relation: string, owner: { name: string; kind: string } | null): void => {
      if (site.type !== "identifier") return
      const leaf = site.text
      if (!leaf) return
      if (NIM_BUILTIN_TYPES.indexOf(leaf) !== -1) return
      if (genericParamNames.has(leaf)) return
      if (isValueNotType(leaf)) return
      if (!owner) return
      // One edge per (owner, target) pair: the same type referenced by three
      // parameters of one proc is one dependency, and the line recorded is the
      // FIRST site it is written at.
      const key = `${owner.name} ${leaf}`
      if (emitted.has(key)) return
      emitted.add(key)
      relationships.push({
        source: owner.name,
        target: leaf,
        type: ASTEngine.RelationshipType.References,
        confidence: 0.9,
        line_number: site.startPosition.row + 1,
        metadata: { relationshipType: relation, declaredBy: owner.kind },
      })
    }

    const collectFromTypeExpression = (te: Node | null, relation: string, owner: { name: string; kind: string } | null): void => {
      if (!te) return
      const ctor = this.typeConstructorLeaf(te)
      if (ctor) push(ctor, relation, owner)
      for (const arg of this.typeArgumentNodes(te)) {
        if (arg.type === "identifier") {
          push(arg, "nim_type_argument", owner)
        } else {
          collectFromTypeExpression(arg, "nim_type_argument", owner)
        }
      }
    }

    return { relationships, fileTypes, genericParamNames, emitted, ownerOf, collectFromTypeExpression, push }
  }

  /** The per-node arm of the declared-type family, riding the fused edge walk. */
  private collectDeclaredTypeRefAt(n: Node, helpers: DeclaredTypeRefHelpers): void {
    const { fileTypes, genericParamNames, emitted, ownerOf, collectFromTypeExpression, push } = helpers
  switch (n.type) {
    case "parameter_declaration":
    case "field_declaration":
    case "variant_discriminator_declaration":
    case "variable_declaration":
    case "cast":
    case "do_block": {
      const t = n.childForFieldName("type")
      if (t) collectFromTypeExpression(t, "nim_declared_type", ownerOf(n))
      break
    }
    case "proc_declaration":
    case "func_declaration":
    case "method_declaration":
    case "iterator_declaration":
    case "template_declaration":
    case "macro_declaration":
    case "converter_declaration": {
      // A routine's own return type hangs off the declaration node's
      // `return_type` field, not off a child's `type` field, so it needs
      // its own arm — without it `proc f(): MyType` declared no dependency.
      const ret = n.childForFieldName("return_type")
      if (ret) collectFromTypeExpression(ret, "nim_return_type", ownerOf(n))
      break
    }
    case "object_declaration": {
      const inh = n.childForFieldName("inherits")
      if (inh) collectFromTypeExpression(inh, "nim_declared_type", ownerOf(n))
      break
    }
    case "concept_declaration": {
      const ref = n.childForFieldName("refines")
      const list = ref ? this.firstChildOfType(ref, "refinement_list") : null
      if (ref && list) for (let i = 0; i < list.namedChildCount; i++) collectFromTypeExpression(list.namedChild(i), "nim_declared_type", ownerOf(n))
      break
    }
    case "type_declaration": {
      const symDecl = n.namedChildCount > 0 ? n.namedChild(0) : null
      if (symDecl && symDecl.type === "type_symbol_declaration") {
        const selfName = symDecl.childForFieldName("name")
        const selfText = selfName ? this.readNameNode(selfName).name : ""
        const owner = selfText ? { name: selfText, kind: "type" } : null
        const rhs = this.typeDefinitionRhs(n)
        if (rhs) {
          // Skip the alias's own name in `type A = A`-shaped chains only;
          // every other occurrence is a real dependency.
          const ctor = this.typeConstructorLeaf(rhs)
          if (ctor && ctor.text !== selfText) push(ctor, "nim_type_alias", owner)
          for (const arg of this.typeArgumentNodes(rhs)) {
            if (arg.type === "identifier") {
              if (arg.text !== selfText) push(arg, "nim_type_argument", owner)
            } else {
              collectFromTypeExpression(arg, "nim_type_argument", owner)
            }
          }
        }
      }
      break
    }
    default:
      break
  }
  }

  /** #419-D evidence-tier classification (family standard: rust/c/cpp/go/zig
   *  all classify; an unclassified edge cannot be judged by the resolver). */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? "")
      const rt = String(md.relationshipType ?? "")
      if (t === "contains" || t === "extends" || t === "overrides") {
        md.evidenceClass = "structural"
        continue
      }
      if (t === "references") {
        md.evidenceClass = rt === "nim_declared_type" || rt === "nim_type_alias" || rt === "nim_type_argument" ? "reference_qualified" : "import_based"
        continue
      }
      if (t === "instantiates") {
        md.evidenceClass = "usage_contextual"
        continue
      }
      md.evidenceClass = rt === "nim_import" || rt === "nim_include" || md.nimImportBased ? "import_based" : "usage_contextual"
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. POSITION HELPERS — every one of these is a grammar field or node type
  // ═══════════════════════════════════════════════════════════════════════

  /** The leaf NAME node of a `name` field: `_symbol` (identifier /
   *  accent_quoted) or `exported_symbol` (the same, then `*`). */
  private readNameNode(node: Node): { name: string; exported: boolean; range: ASTEngine.UniversalSymbol["range"] } {
    if (node.type === "exported_symbol") {
      const inner = node.namedChildCount > 0 ? node.namedChild(0) : null
      return {
        name: inner ? inner.text : "",
        exported: true,
        range: inner ? this.nodeRange(inner) : this.nodeRange(node),
      }
    }
    if (node.type === "identifier" || node.type === "accent_quoted") {
      return { name: node.text, exported: false, range: this.nodeRange(node) }
    }
    return { name: node.text, exported: false, range: this.nodeRange(node) }
  }

  /** The identifier/leaf a call targets. `call.function` is `_basic_expression`
   *  in three shapes: a bare name, a `dot_expression` chain (leaf), or a
   *  `bracket_expression` (generic instantiation → its `left` leaf). */
  private calleeLeafNode(fn: Node): Node | null {
    let cur: Node | null = fn
    let guard = 0
    while (cur && guard++ < 16) {
      switch (cur.type) {
        case "identifier":
        case "accent_quoted":
          return cur
        case "dot_expression": {
          // `a.b.c()` targets `c` — the member, not the receiver.
          const right = cur.childForFieldName("right")
          if (!right) return null
          if (right.type === "identifier" || right.type === "accent_quoted") return right
          cur = right
          continue
        }
        case "bracket_expression": {
          // `Foo[int](x)` is a generic instantiation of `Foo`; `a[i]()` calls `a`.
          const left = cur.childForFieldName("left")
          if (!left) return null
          cur = left
          continue
        }
        case "parenthesized": {
          const inner: Node | null = cur.namedChildCount > 0 ? cur.namedChild(0) : null
          if (!inner) return null
          cur = inner
          continue
        }
        default:
          return null
      }
    }
    return null
  }

  /** True when this identifier is the `right` field of a `dot_expression` — a
   *  MEMBER read, which the dot branch owns. Without this the bare-identifier
   *  branch claimed it first and the deduped edge was mislabelled. */
  private isDotLeaf(node: Node): boolean {
    const p = node.parent
    if (!p || p.type !== "dot_expression") return false
    const right = p.childForFieldName("right")
    return !!right && right.startIndex === node.startIndex && right.endIndex === node.endIndex
  }

  /** The member leaf of a `dot_expression` — its `right` field. */
  private dotLeafNode(expr: Node): Node | null {
    const right = expr.childForFieldName("right")
    if (right && (right.type === "identifier" || right.type === "accent_quoted")) return right
    return null
  }

  /** True when this node IS the callee subtree of a `call` / `dot_generic_call`
   *  — the `calls` edge owns that span, so a `uses` edge would be a duplicate. */
  private isCallCallee(node: Node): boolean {
    const p = node.parent
    return !!p && (p.type === "call" || p.type === "dot_generic_call")
  }

  private isCallCalleeSubtree(node: Node): boolean {
    let top: Node = node
    let p: Node | null = node.parent
    while (p && p.type !== "call" && p.type !== "dot_generic_call" && p.type !== "statement_list" && p.type !== "block") {
      top = p
      p = p.parent
    }
    if (!p || (p.type !== "call" && p.type !== "dot_generic_call")) return false
    const fn = p.childForFieldName("function")
    if (!fn) return false
    return top.startIndex >= fn.startIndex && top.endIndex <= fn.endIndex
  }

  /**
   * True when the identifier names a declaration rather than reading one. The
   * grammar puts every declared name in exactly one of these shapes, so this is
   * a closed list and not a heuristic: `symbol_declaration` (fields, values,
   * for-loop variables, tuple destructuring), `type_symbol_declaration`
   * (types), `enum_field_declaration`, `variant_discriminator_declaration`,
   * and a `for` loop's `left` list.
   */
  /**
   * True for a CONCEPT's formal parameter: the `x` of `type Addable = concept x`.
   *
   * It is a binding, not a read, and it is the one formal parameter in Nim
   * written without any of the syntax the other binders use — no
   * `symbol_declaration` wrapper, no type annotation, nothing for
   * `isDeclarationName` to match. The read pass therefore published
   * `uses (global) -> x` at file scope.
   *
   * Found by the M12 ground truth, where it was the single false positive out of
   * 105 observed facts (precision 0.990). Only an independent audit could catch
   * it: the differential's oracle did not emit the edge either, so the lane
   * reported 0% unexplained with two implementations agreeing on something
   * neither should have published.
   */
  private isConceptParameterPosition(node: Node): boolean {
    const parent = node.parent
    if (!parent || parent.type !== "parameter_list") return false
    return this.hasAncestorOfType(parent, "concept_declaration")
  }

  private isDeclarationName(node: Node): boolean {
    const p = node.parent
    if (!p) return false
    switch (p.type) {
      case "symbol_declaration":
      case "type_symbol_declaration":
      case "enum_field_declaration":
      case "variant_discriminator_declaration":
      // `x*: int` — the export marker wraps the name, so the identifier's parent
      // is `exported_symbol` and the `symbol_declaration` case above never fires.
      case "exported_symbol":
      case "tuple_deconstruct_declaration":
      case "symbol_declaration_list":
        return true
      default:
        return false
    }
  }

  /**
   * True when the identifier sits in a TYPE position. Determined by the
   * grammar's own `type` / `return_type` / `inherits` / `refines` /
   * `generic_parameters` fields and span containment, never by an ancestry
   * guess — a type read is a declared-type fact, and emitting a `uses` edge for
   * it as well would double-count.
   */
  private isInTypePosition(node: Node): boolean {
    let cur: Node = node
    let p: Node | null = node.parent
    let guard = 0
    while (p && guard++ < 32) {
      if (p.type === "statement_list" || p.type === "block" || p.type === "source_file" || p.type === "do_block") return false
      for (const f of TYPE_POSITION_FIELDS) {
        const field = p.childForFieldName(f)
        if (field && field.startIndex <= cur.startIndex && field.endIndex >= cur.endIndex) return true
      }
      cur = p
      p = p.parent
    }
    return false
  }

  /** True when the identifier is part of an `import`/`export`/`include` path —
   *  a module name, never a value read. */
  private isModulePathPosition(node: Node): boolean {
    let cur: Node = node
    let p: Node | null = node.parent
    let guard = 0
    while (p && guard++ < 16) {
      if (p.type === "import_statement" || p.type === "export_statement" || p.type === "include_statement" || p.type === "import_from_statement") {
        return true
      }
      if (p.type === "statement_list" || p.type === "source_file" || p.type === "block") return false
      cur = p
      p = p.parent
    }
    return false
  }

  /**
   * True for a LABEL: the name of a `block name:`, the operand of `break name` /
   * `continue name`, and the left side of a `colon_expression`. Nim has no
   * ternary, so `x: value` only ever names a field — of an object construction
   * (`Vec(x: 1)`) or of a variant branch — and never reads one.
   */
  private isColonLabel(node: Node): boolean {
    const p = node.parent
    if (!p || p.type !== "colon_expression") return false
    const left = p.childForFieldName("left")
    return !!left && left.startIndex === node.startIndex && left.endIndex === node.endIndex
  }

  /** True for a `block name:` label and the `break name` / `continue name`
   *  operand — a goto target, not a read. */
  private isLabelPosition(node: Node): boolean {
    const p = node.parent
    if (!p) return false
    if (p.type === "break_statement" || p.type === "continue_statement") return true
    const label = p.childForFieldName?.("label")
    return !!label && label.startIndex === node.startIndex && label.endIndex === node.endIndex
  }

  /** True for the right side of an `… as name` in an `except` clause — a
   *  binding, not a read. */
  private isExceptAliasPosition(node: Node): boolean {
    const p = node.parent
    if (!p || p.type !== "infix_expression") return false
    const op = p.childForFieldName("operator")
    if (!op || op.type !== "as") return false
    const right = p.childForFieldName("right")
    return !!right && right.startIndex === node.startIndex && right.endIndex === node.endIndex
  }

  /**
   * An assignment target is a WRITE, never a read. For `x = 1` the left field's
   * identifier is the target; for `a.x = 1` the dot leaf is; for `a[i] = 1` the
   * base and the index are both READS, so nothing is suppressed. The first pass
   * (non-member) covers `identifier`; the `member` pass covers the dot leaf.
   */
  private isAssignmentTarget(node: Node, member = false): boolean {
    const p = node.parent
    if (!p || p.type !== "assignment") return false
    const left = p.childForFieldName("left")
    if (!left || left.startIndex > node.startIndex || left.endIndex < node.endIndex) return false
    if (member) return this.isLeftmostLeafOf(p)
    // `x = 1` — the whole left field IS the target.
    return left.type === "identifier"
  }

  private isLeftmostLeafOf(node: Node): boolean {
    let cur = node
    for (;;) {
      const p = cur.parent
      if (!p) return false
      if (p.type === "dot_expression") {
        const left = p.childForFieldName("left")
        if (left && left.startIndex <= cur.startIndex && left.endIndex >= cur.endIndex) {
          cur = p
          continue
        }
        return false
      }
      if (p.type === "bracket_expression") {
        const left = p.childForFieldName("left")
        if (left && left.startIndex <= cur.startIndex && left.endIndex >= cur.endIndex) {
          cur = p
          continue
        }
        return false
      }
      if (p.type === "call" || p.type === "parenthesized") {
        const first = p.namedChildCount > 0 ? p.namedChild(0) : null
        if (first && first.startIndex <= cur.startIndex && first.endIndex >= cur.endIndex) {
          cur = p
          continue
        }
        return false
      }
      return false
    }
  }

  /** True when the leftmost identifier of a chain is a module qualifier from
   *  this file's imports — `os.getCurrentDir()` is an import-based fact, not a
   *  local member read. */
  private isImportQualified(node: Node, qualifiers: Set<string>): boolean {
    if (qualifiers.size === 0) return false
    // Walk down the leftmost spine to the base name: `std.json.parseJson` ->
    // `std`; `os` -> `os`; `a.b.c()` -> `a`.
    let cur: Node = node
    let guard = 0
    while (guard++ < 16) {
      if (cur.type === "identifier" || cur.type === "accent_quoted") return qualifiers.has(cur.text)
      let next: Node | null = null
      for (const f of ["left", "function", "first_argument"]) {
        const fld = cur.childForFieldName(f)
        if (fld && fld.startIndex <= cur.startIndex && cur.endIndex <= fld.endIndex) {
          next = fld
          break
        }
      }
      if (!next && cur.type !== "dot_expression" && cur.type !== "bracket_expression" && cur.type !== "call") {
        const first = cur.namedChildCount > 0 ? cur.namedChild(0) : null
        if (first && first.startIndex <= cur.startIndex && first.endIndex >= cur.endIndex) next = first
      }
      if (!next) return false
      cur = next
    }
    return false
  }

  /**
   * True for `sink T` / `out T` / `var T` / `let T` written as a one-argument
   * call — the shape this grammar gives a modifier keyword that has no node of
   * its own (`doc/grammar.txt` spells the modifier inline in `paramList`, and
   * `var`/`out`/`ref`/`ptr`/`distinct` each got a `*_type` node; `sink` did not).
   * `PARAMETER_MODIFIERS` is a closed set of grammar keywords, so this is a token
   * comparison and never a text pattern.
   */
  private isParameterModifierCall(node: Node): boolean {
    if (node.type !== "call") return false
    const fn = node.childForFieldName("function")
    if (!fn || fn.type !== "identifier") return false
    if (PARAMETER_MODIFIERS.indexOf(fn.text) === -1) return false
    const args = this.firstChildOfType(node, "argument_list")
    return !!args && args.namedChildCount === 1
  }

  /**
   * The type CONSTRUCTOR leaf of a type expression: the leftmost identifier of
   * the outermost `bracket_expression` / `call`, unwrapping the `ref`/`ptr`/
   * `var`/`out`/`distinct`/`type` modifiers. `seq[T]` → `seq`, `Table[K, V]` →
   * `Table`, `ref Node` → `Node`, `int` → `int`.
   */
  private typeConstructorLeaf(te: Node): Node | null {
    let cur: Node = te
    let guard = 0
    while (guard++ < 16) {
      if (cur.type === "identifier" || cur.type === "accent_quoted") return cur
      if (cur.type === "type_expression") {
        const inner = cur.namedChildCount > 0 ? cur.namedChild(0) : null
        if (!inner) return null
        cur = inner
        continue
      }
      if (cur.type === "ref_type" || cur.type === "pointer_type" || cur.type === "out_type" || cur.type === "var_type" || cur.type === "distinct_type") {
        const inner = this.lastNamedChild(cur)
        if (!inner) return null
        cur = inner
        continue
      }
      if (cur.type === "bracket_expression") {
        const left = cur.childForFieldName("left")
        if (!left) return null
        cur = left
        continue
      }
      if (cur.type === "call") {
        const fn = cur.childForFieldName("function")
        if (!fn) return null
        // A modifier keyword applied to a type (`sink seq[int]`, `out int`) has no
        // node of its own; the ONE argument is the type.
        if (this.isParameterModifierCall(cur)) {
          const inner = this.firstChildOfType(cur, "argument_list")
          const only = inner && inner.namedChildCount === 1 ? inner.namedChild(0) : null
          if (only) {
            cur = only
            continue
          }
        }
        cur = fn
        continue
      }
      if (cur.type === "dot_expression") {
        const right = cur.childForFieldName("right")
        if (!right) return null
        cur = right
        continue
      }
      return null
    }
    return null
  }

  /** The type ARGUMENT nodes of a generic type expression — `T` in `seq[T]`,
   *  `K` and `V` in `Table[K, V]`. */
  private typeArgumentNodes(te: Node): Node[] {
    let cur: Node = te
    let guard = 0
    while (guard++ < 16) {
      if (cur.type === "type_expression") {
        const inner = cur.namedChildCount > 0 ? cur.namedChild(0) : null
        if (!inner) return []
        cur = inner
        continue
      }
      if (cur.type === "ref_type" || cur.type === "pointer_type" || cur.type === "out_type" || cur.type === "var_type" || cur.type === "distinct_type") {
        const inner = this.lastNamedChild(cur)
        if (!inner) return []
        cur = inner
        continue
      }
      if (cur.type === "bracket_expression") {
        const right = cur.childForFieldName("right")
        if (!right) return []
        const out: Node[] = []
        for (let i = 0; i < right.namedChildCount; i++) {
          const c = right.namedChild(i)
          if (c) out.push(c)
        }
        return out
      }
      if (cur.type === "call") {
        if (this.isParameterModifierCall(cur)) {
          const inner = this.firstChildOfType(cur, "argument_list")
          const only = inner && inner.namedChildCount === 1 ? inner.namedChild(0) : null
          return only ? [only] : []
        }
        const args = this.firstChildOfType(cur, "argument_list")
        if (!args) return []
        const out: Node[] = []
        for (let i = 0; i < args.namedChildCount; i++) {
          const c = args.namedChild(i)
          if (c) out.push(c)
        }
        return out
      }
      return []
    }
    return []
  }

  /** The leaf NAME of a `type_expression`, used for `nimInherits` and for the
   *  method receiver type. */
  private typeLeafName(te: Node): string {
    const leaf = this.typeConstructorLeaf(te)
    return leaf ? leaf.text : ""
  }

  /**
   * A `method`'s dispatch receiver: the first parameter's declared type, as the
   * OUTERMOST type name. `method speak(a: Animal)` → `Animal`;
   * `method speak(d: ref Dog)` → `Dog`; a container receiver
   * (`method first[T](a: seq[T])`) dispatches on the CONTAINER (`seq`), so the
   * type arguments are deliberately not part of it. Derived from the AST
   * (`parameters` → first `parameter_declaration` → `type` field), never by
   * re-parsing the parameter's text.
   */
  private methodReceiverTypeLeaf(node: Node): string {
    const params = node.childForFieldName("parameters")
    if (!params) return ""
    for (let i = 0; i < params.namedChildCount; i++) {
      const p = params.namedChild(i)
      if (!p || p.type !== "parameter_declaration") continue
      const t = p.childForFieldName("type")
      if (!t) return ""
      const leaf = this.typeConstructorLeaf(t)
      return leaf ? leaf.text : ""
    }
    return ""
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. PURE HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  private pushChildren(
    node: Node,
    stack: { node: Node; inCallable: boolean; objectKind: string }[],
    inCallable: boolean,
    objectKind: string,
  ): void {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (c) stack.push({ node: c, inCallable, objectKind })
    }
  }

  private nodeRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    // 1-based lines AND columns (family standard — a 0-based column fails the
    // `startColumn >= 1` family consistency gate).
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
    return node ? node.text : ""
  }

  private snippet(text: string): string {
    return text.length > 50 ? `${text.slice(0, 50)}…` : text
  }

  /** The last NAMED child. `ref`/`ptr`/`var`/`out`/`distinct` are anonymous
   *  tokens, so a wrapper node's only named child is the type it wraps —
   *  `namedChild(1)` is always null on one. */
  private lastNamedChild(node: Node): Node | null {
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i)
      if (c) return c
    }
    return null
  }

  private firstChildOfType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === type) return c
    }
    return null
  }

  private symbolNamesIn(node: Node): string[] {
    const out: string[] = []
    if (node.type === "symbol_declaration_list") {
      for (let i = 0; i < node.namedChildCount; i++) {
        const d = node.namedChild(i)
        if (!d) continue
        if (d.type === "symbol_declaration") {
          const n = d.childForFieldName("name")
          const info = n ? this.readNameNode(n) : null
          if (info?.name) out.push(info.name)
        } else if (d.type === "tuple_deconstruct_declaration") {
          for (let j = 0; j < d.namedChildCount; j++) {
            const inner = d.namedChild(j)
            const info = inner ? this.readNameNode(inner) : null
            if (info?.name) out.push(info.name)
          }
        }
      }
      return out
    }
    const info = this.readNameNode(node)
    if (info.name) out.push(info.name)
    return out
  }

  private identifierTextsIn(node: Node | null): string[] {
    if (!node) return []
    const out: string[] = []
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "identifier") {
        out.push(n.text)
        continue
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  private unquote(text: string): string {
    if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1)
    return text
  }

  private moduleSegments(path: string): string[] {
    const parts = path.split("/")
    const out: string[] = []
    for (const p of parts) {
      if (!p) continue
      if (p === "." || p === "..") {
        out.push(p)
        continue
      }
      out.push(p)
    }
    return out
  }

  private isDescendantOf(node: Node, ancestor: Node): boolean {
    let p: Node | null = node.parent
    let guard = 0
    while (p && guard++ < 32) {
      if (p.id === ancestor.id) return true
      p = p.parent
    }
    return false
  }

  /**
   * Cyclomatic complexity over a body. Decision points are the grammar's own
   * branch/statement nodes (`if`, `when`, `case`, `while`, `for`, and every
   * `elif`/`else`/`of`/`except`/`finally` branch), plus the short-circuit
   * boolean operators. `and`/`or`/`xor`/`not` are ANONYMOUS tokens with their
   * own node types, so they are matched by token type, never by a substring of
   * the expression text.
   */
  private nimCyclomaticComplexity(node: Node): number {
    let c = 1
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (BRANCH_NODES.indexOf(n.type) !== -1) c++
      if (n.type === "infix_expression") {
        const op = n.childForFieldName("operator")
        if (op && !op.isNamed && (op.type === "and" || op.type === "or" || op.type === "xor")) c++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c2 = n.namedChild(i)
        if (c2) stack.push(c2)
      }
    }
    return c
  }
}

/** The per-file closure bundle the declared-type family needs. Built once per
 *  file and shared by every node visit — see makeDeclaredTypeRefHelpers for why
 *  building it per node cost 5.5%. */
interface DeclaredTypeRefHelpers {
  relationships: ASTEngine.UniversalRelationship[]
  fileTypes: Set<string>
  genericParamNames: Set<string>
  emitted: Set<string>
  ownerOf: (start: Node) => { name: string; kind: string } | null
  collectFromTypeExpression: (te: Node | null, relation: string, owner: { name: string; kind: string } | null) => void
  push: (site: Node, relation: string, owner: { name: string; kind: string } | null) => void
}

/** Literal keywords that are values, never type names. `false` reached the
 *  declared-type pass as a field's value in an object construction. */
const NIM_LITERAL_KEYWORDS = ["true", "false", "nil", "void", "auto"]

/** Grammar fields whose span is a TYPE position. */
const TYPE_POSITION_FIELDS = ["type", "return_type", "inherits", "refines", "generic_parameters"]

/** Grammar nodes that each add one decision point. */
const BRANCH_NODES = [
  "if",
  "when",
  "case",
  "while",
  "for",
  "elif_branch",
  "else_branch",
  "of_branch",
  "except_branch",
  "finally_branch",
]

/**
 * Nim names a user cannot overload, and which therefore never resolve to a
 * symbol in a file. Filtering them is the difference between a `calls` edge that
 * can be resolved and one that is guaranteed noise — the same rule the groovy
 * lane applies to `println`/`printf` and the dart lane to `print`/`assert`.
 * Compiler intrinsics (`echo`, `inc`, `dec`, `new`, `sizeof`, `typeof`,
 * `cast`, `getType`, …) plus the words the grammar already models as keywords.
 */
export const REAL_NIM_BUILTINS = [
  "echo",
  "assert",
  "new",
  "newSeq",
  "newString",
  "newFloat",
  "inc",
  "dec",
  "swap",
  "copyMem",
  "moveMem",
  "zeroMem",
  "getType",
  "typeof",
  "sizeof",
  "alignof",
  "isNil",
  "wasMoved",
  "incl",
  "excl",
  "high",
  "low",
  "ord",
  "result",
  "nil",
  "true",
  "false",
  "cast",
  "addr",
  "bind",
  "mixin",
  "static",
  "discard",
  "raise",
  "yield",
  "return",
  "break",
  "continue",
  "type",
  "var",
  "let",
  "const",
  "object",
  "enum",
  "tuple",
  "proc",
  "func",
  "method",
  "iterator",
  "macro",
  "template",
  "converter",
  "concept",
  "out",
  "ref",
  "ptr",
  "distinct",
  "range",
  "set",
  "seq",
  "array",
  "varargs",
  "pointer",
  "auto",
  "untyped",
  "typedesc",
  "void",
  "int",
  "int8",
  "int16",
  "int32",
  "int64",
  "uint",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "float",
  "float32",
  "float64",
  "bool",
  "char",
  "string",
  "cstring",
  "byte",
  "ordinal",
  "system",
]

/**
 * Parameter-kind modifier keywords. `var`/`out`/`ref`/`ptr`/`distinct` have
 * dedicated `*_type` nodes in this grammar; `sink` (and `let`, `static` in
 * concept parameter position) do not, so they reach the analyzer as a
 * one-argument `call`.
 */
const PARAMETER_MODIFIERS = ["sink", "out", "var", "let", "static"]

/** The compiler's own inheritance roots. Every `ref object` with no explicit
 *  base inherits RootObj, and those names exist in no indexed file, so an
 *  `extends` to them is a guaranteed-dangling edge. Every OTHER base is a real
 *  inheritance fact the store resolves. */
const NIM_COMPILER_ROOTS = new Set(["RootObj", "RootRef", "Object", "rootObj"])

/** Type names of the language and its `system` module: a `references` edge to
 *  one of these can never resolve to a declared type. */
const NIM_BUILTIN_TYPES = [
  // integer / float / fixed-width
  "int", "int8", "int16", "int32", "int64",
  "uint", "uint8", "uint16", "uint32", "uint64",
  "float", "float32", "float64",
  "bool", "char", "byte", "string", "cstring",
  "void", "auto", "untyped", "typedesc", "ordinal", "range",
  // algebraic type classes the standard library defines
  "SomeInteger", "SomeFloat", "SomeNumber", "SomeOrdinal", "SomeOrdered",
  "Natural", "Positive", "Signed", "Unsigned",
  "Ordinal", "Ordered", "SomeComparable", "SomeCopyable", "SomeDefault",
  // containers (a declared-type reference to a container is not a dependency
  // on a user type; the type ARGUMENTS are collected separately)
  "seq", "array", "openArray", "set", "tuple", "varargs", "pointer",
  "Table", "OrderedTable", "CountTable", "HashSet", "OrderedSet", "CountSet",
  "touches", "isNil", "lent",
  // c-interop aliases
  "cpointer", "clong", "cint", "cshort", "cchar", "cschar", "cuchar", "csize",
  "cfloat", "cdouble", "clonglong", "culonglong", "cstringarray",
  // the compiler's own roots and the module every file implicitly imports
  "Object", "RootObj", "RootRef", "rootObj", "system",
  // common standard-library types that appear bare in annotations
  "File", "FileStream", "PFile", "PFileStream", "StringStream", "WideString",
  "charStream", "CString", "TEndian", "Endian",
]

/**
 * Words that the grammar already models as anonymous keyword tokens. A bare
 * `identifier` node never has one of these types, but `readNameNode` returns raw
 * text for a `dot_expression` leaf, and a keyword can reach that position after
 * a `.` (`.import`, `.end`) — the guard keeps either shape from producing an
 * edge to a non-name.
 */
function isKeywordLike(name: string): boolean {
  return KEYWORD_LIKE.indexOf(name) !== -1
}

const KEYWORD_LIKE = [
  "addr",
  "and",
  "as",
  "bind",
  "block",
  "break",
  "case",
  "concept",
  "const",
  "continue",
  "converter",
  "defer",
  "discard",
  "distinct",
  "div",
  "do",
  "elif",
  "else",
  "end",
  "enum",
  "except",
  "export",
  "finally",
  "for",
  "from",
  "func",
  "if",
  "import",
  "in",
  "include",
  "interface",
  "is",
  "isnot",
  "iterator",
  "let",
  "macro",
  "method",
  "mixin",
  "mod",
  "nil",
  "not",
  "notin",
  "object",
  "of",
  "or",
  "out",
  "proc",
  "ptr",
  "raise",
  "ref",
  "return",
  "shl",
  "shr",
  "static",
  "template",
  "try",
  "tuple",
  "type",
  "using",
  "var",
  "when",
  "while",
  "xor",
  "yield",
]
