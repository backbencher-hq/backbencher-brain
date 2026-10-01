import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// ============================================================================
// Erlang / BEAM analyzer — the OTP surface, in full.
//
// Every grammar fact below was MEASURED on the pinned
// `wasm/tree-sitter-erlang.wasm` over 4,326 corpus files (otp 3,874 / rebar3
// 264 / cowboy 188) with `script/m14/tmp/erlang-grammar-census.ts` (205 node
// types, 122 named) and the shape probes beside it. Nothing in this file
// branches on a node type the census did not observe, and no node type the
// census observed is left without a decision — the full classification lives in
// `script/m14/spec/erlang-completeness.json` (handled / silent / ruled) and the
// evidence in `reviews/erlang/`.
//
// Pure AST: symbols and relationships derive from Tree-sitter nodes only. The
// string helpers at the bottom are pure char scans — there is no RegExp
// construction anywhere in this file (M12 regex census, M49 #849).
// ============================================================================

// OTP behaviours this analyzer knows how to reason about.
const OTP_BEHAVIOURS = new Set(["gen_server", "gen_statem", "gen_event", "supervisor", "application"])

// BIFs that spawn processes: a pattern flag only, never a calls edge (the
// FP-family builtin-exclusion rule — the negative fixture pins that `self/0`,
// `length/1` and `spawn/1` are not edges, because none of them is a symbol in
// this file).
const SPAWN_BIFS = new Set(["spawn", "spawn_link", "spawn_monitor"])

// ER-D16 — node types whose SUBTREE is type syntax, never runtime code.
//
// Measured justification (parent sets from erlang-shapes-probe2.ts, 300 corpus
// files): `call` occurs under type_sig 859, ann_type 3,398, type_alias 145,
// field_type 89, fun_type_sig 38, opaque 16, nominal 4; `record_expr` occurs
// under ann_type 57, type_alias 35, opaque 1, field_type 1. So a
// -spec/-type/-opaque/-nominal/-callback body is a TYPE graph, not a call graph:
// its `call`/`atom` nodes become `references` edges from the declaring type,
// never `calls`. `ann_type` is a type context in BOTH positions — in a type
// signature AND in a guard, where `X :: integer()` is a type test while
// `is_integer(X)` beside it is a real call.
const TYPE_SCOPE_NODES = new Set([
  "spec",
  "callback",
  "type_alias",
  "opaque",
  "nominal",
  "type_sig",
  "fun_type_sig",
  "ann_type",
  "ann_var",
  "field_type",
  "fun_type",
  "range_type",
  "var_args",
  "type_name",
  "type_guards",
  "pipe",
])

// ER-D17 — decision points for the per-ARM complexity model (haskell's
// per-symbol contract, elixir's per-stab_clause parity). Measured arm nodes:
// cr_clause 10,968 (case + receive + try-of + `maybe … else`), if_clause 908,
// catch_clause 585, receive_after 929, andalso 142 / orelse 81. Comprehensions
// count as one point each (elixir-`for` parity): they are iteration, and a
// per-element filter is not a statically countable decision.
const ARM_NODES = new Set(["cr_clause", "if_clause", "catch_clause", "receive_after"])

// ER-D18 — comprehension constructs.
const COMPREHENSION_NODES = new Set(["list_comprehension", "binary_comprehension", "map_comprehension"])

// The only containers that hold top-level forms of their own, so the pre-pass
// descends into them and nowhere else (ER-D29).
//
// `ERROR` is in this set because of a MEASURED counter-example, not a guess: a
// malformed `-record #r{…}` (no parentheses) makes the grammar wrap the WHOLE
// file in one ERROR node and hoist every declaration into it — the
// `-module`, the record and the `-export` lists all become ERROR's children
// instead of source_file's (otp/lib/dialyzer/test/indent_SUITE_data/
// rec_remote_unknown.erl, hasError=true). A pre-pass that read only the top
// level therefore found no module name at all and attributed the whole file to
// the path; the corpus dual lens caught it, and it is why this set is not
// "source_file's children only".
const PRE_PASS_DESCEND = new Set([
  "pp_if", "pp_ifdef", "pp_ifndef", "pp_else", "pp_elif", "pp_endif", "ERROR",
])

// A `match_expr` / `cond_match_expr` / `lc_or_zc_expr` boundary operator: its
// LEFT side is a pattern, its right side is an evaluation. (`cond_match_expr` is
// OTP 28's `maybe` assertion `Pattern ?= Expr`; `<:=` is the binary-generator
// form of `<-`.)
const MATCH_OPERATORS = new Set(["=", "?=", "<-", "<:=", "<="])

// Declaration nodes that push an attribution frame: an edge inside one belongs
// to the DECLARATION, not to the module (ER-D12).
const DECL_NODES = new Set([
  "module_attribute",
  "fun_decl",
  "spec",
  "record_decl",
  "pp_define",
  "type_alias",
  "opaque",
  "nominal",
  "callback",
])

interface SpecInfo {
  /** Parameter type expressions, in order (node text). */
  params: string[]
  /** Return type expression text, when the signature has one. */
  ret?: string
  line: number
}

interface FunDeclInfo {
  name: string
  arity: number
  clauseCount: number
  /** The clause head is a MACRO use (`?NAME(X) -> …`) — 11 corpus sites. */
  macroHead: boolean
  startIndex: number
}

interface DeclFrame {
  /** The symbol every edge inside this declaration is attributed to. */
  source: string
  kind: string
}

interface ErlangContext {
  /** The file being analyzed — the fallback owner of a module-less file (see `ownerNameOf`). */
  filePath: string
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  patterns: Record<string, boolean>
  seenRels: Set<string>

  // ---- pre-pass products (forward-reference resolution) ----
  funDecls: Map<number, FunDeclInfo>
  /** Bare function names — the forward-reference gate for a local call. */
  declaredNames: Set<string>
  /**
   * "name/arity" -> how many `function_clause` nodes in this file carry that
   * identity. Erlang has one function per (name, arity), so the FILE-WIDE tally
   * is the clause count, independent of how the grammar groups the clauses into
   * `fun_decl` nodes (ER-D26).
   */
  clauseCountByKey: Map<string, number>
  /** "name/arity" -> accumulated branch points, summed over every clause. */
  fnBranches: Map<string, number>
  /** "name/arity" -> the -spec that annotates it. */
  specs: Map<string, SpecInfo>
  /** "name/arity" entries named by -nifs / -on_load. */
  /**
   * Macro name -> the ATOM it expands to, for object-like macros whose body is a
   * bare atom (`-define(FILE_SUITE, file_SUITE).`). Filled by the pre-pass, so a
   * `-module(?M)` resolves no matter which side of the `-define` it sits on.
   * ER-D34.
   */
  macroAtoms: Map<string, string>
  /**
   * "name/arity" -> the LINE of the `-nifs` attribute that declared it.
   *
   * The line is kept because for an entry with no Erlang clause this attribute is
   * the ONLY declaration site (ER-D37), so the published symbol's line — and the
   * `contains` edge that carries it — is the attribute's line, not a line that
   * does not exist.
   */
  nifEntries: Map<string, number>
  onLoadEntries: Map<string, number>
  /** "name/arity" -> the function-or-callback symbol for that identity. */
  functionSymbolByKey: Map<string, ASTEngine.UniversalSymbol>

  // ---- walk state ----
  moduleName: string | undefined
  typeDepth: number
  macroDepth: number
  declStack: DeclFrame[]
  currentFun: { name: string; key: string; symbol: ASTEngine.UniversalSymbol; branches: number } | undefined
  totalBranches: number
  optionalCallbacks: string[]
  moduleSymbol: ASTEngine.UniversalSymbol | undefined
  /** Counts kept for the review's accounting, never for behaviour. */
  stats: { dynamicRemote: number; unresolvedNifs: number; macroHeadDecls: number }
}

export class RealErlangAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: ErlangContext = {
      filePath,
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      patterns: {},
      seenRels: new Set(),
      funDecls: new Map(),
      declaredNames: new Set(),
      clauseCountByKey: new Map(),
      fnBranches: new Map(),
      specs: new Map(),
      macroAtoms: new Map(),
      nifEntries: new Map(),
      onLoadEntries: new Map(),
      functionSymbolByKey: new Map(),
      moduleName: undefined,
      typeDepth: 0,
      macroDepth: 0,
      declStack: [],
      currentFun: undefined,
      totalBranches: 0,
      optionalCallbacks: [],
      moduleSymbol: undefined,
      stats: { dynamicRemote: 0, unresolvedNifs: 0, macroHeadDecls: 0 },
    }

    // ---- pre-pass: every fact the main walk cannot derive in document order —
    // the function table (a call may name a function declared LATER in the same
    // file; the fixture erlang/call-resolution pins it), the -spec table (a spec
    // annotates the function it precedes), and the -nifs/-on_load tables (those
    // attributes annotate a declared function rather than minting a duplicate
    // symbol — ER-D22). ----
    this.collectPrePass(rootNode, ctx)

    const stack: { node: Node; isExit?: boolean }[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const { node, isExit } = stack.pop()!
      const type = node.type
      const named = node.isNamed

      // ---- scope exits. A marker pushed before the children is popped AFTER
      // them, so each counter is balanced. These are independent `if`s, not an
      // `else if` chain: `callback` and `type_alias` are BOTH a type scope and a
      // declaration frame, and a chain would decrement one and forget the other.
      if (isExit) {
        if (named && TYPE_SCOPE_NODES.has(type)) ctx.typeDepth--
        if (named && type === "pp_define") ctx.macroDepth--
        if (named && DECL_NODES.has(type)) ctx.declStack.pop()
        if (named && type === "fun_decl") {
          const done = ctx.currentFun
          if (done) ctx.fnBranches.set(done.key, (ctx.fnBranches.get(done.key) ?? 0) + done.branches)
          ctx.currentFun = undefined
        }
        continue
      }

      let pushScope = false
      if (named && TYPE_SCOPE_NODES.has(type)) ctx.typeDepth++
      if (named && type === "pp_define") ctx.macroDepth++
      // Every counter and frame this walk pushes needs its exit marker: the
      // marker is pushed BEFORE the children, so it pops AFTER them.
      if (named && (TYPE_SCOPE_NODES.has(type) || DECL_NODES.has(type) || type === "pp_define")) pushScope = true

      // A grammar failure is reported, never analysed as if it were whole
      // (elixir parity: the ERROR/MISSING node is the evidence). The type is
      // already in hand, so `type === "ERROR"` replaces the `isError` property
      // read on every node in the tree.
      if (type === "ERROR" || node.isMissing) {
        ctx.errors.push({
          message: `Erlang syntax ${node.isMissing ? "MISSING" : "ERROR"} node.`,
          range: this.nodeToRange(node),
          severity: "warning",
        })
      }

      if (named) {
        switch (type) {
          // ---- module-level declarations ----
          case "module_attribute":
            this.processModuleAttribute(node, ctx, filePath)
            break
          case "behaviour_attribute":
            this.processBehaviourAttribute(node, ctx, filePath)
            break
          case "export_attribute":
            this.processFaListAttribute(node, ctx, filePath, ASTEngine.SymbolKind.Function)
            break
          case "export_type_attribute":
            // `-export_type([t/0])` exports a TYPE: the same `fa` shape, a
            // different kind, so the two lists are distinguishable and never
            // merged.
            this.processFaListAttribute(node, ctx, filePath, ASTEngine.SymbolKind.Type)
            break
          case "import_attribute":
            this.processImportAttribute(node, ctx, filePath)
            break
          case "optional_callbacks_attribute":
            this.processOptionalCallbacksAttribute(node, ctx)
            break

          // ---- preprocessor ----
          case "pp_include":
          case "pp_include_lib":
            this.processInclude(node, ctx, type === "pp_include", filePath)
            break
          case "pp_define":
            this.processDefine(node, ctx)
            break

          // ---- type declarations: the type graph ----
          case "type_alias":
          case "opaque":
          case "nominal":
            this.processTypeDeclaration(node, ctx, type, filePath)
            break
          case "callback":
            // ER-G3: a behaviour's callback contract is a Method owned by the
            // module (haskell HS-D8 class-signature parity).
            this.processCallback(node, ctx, filePath)
            break
          case "spec":
            // ER-D3: a -spec declares no symbol — the fun_decl does that — but
            // ER-D27: its signature names the types the function's CONTRACT
            // depends on, so `f -> state` is a real edge of the same type graph
            // a `-type` body builds. The pre-pass already captured the
            // parameter/return association; the name atom is the skip span.
            this.processSpecTypes(node, ctx)
            break
          case "record_decl":
            this.processRecordDecl(node, ctx, filePath)
            break

          case "field_type":
            // A record field's type names types, and processRecordDecl already
            // walks the ones a well-formed `-record` owns. This branch is the
            // orphan case: a MALFORMED record declaration (a dialyzer fixture
            // written `-record #r{…}` with no parentheses) is hoisted into a
            // grammar ERROR, so the `field_type` reaches the walk with no
            // `record_decl` above it. The type dependency is real and its only
            // possible owner is whatever encloses it — measured on
            // otp/lib/dialyzer/test/indent_SUITE_data/src/rec_remote_unknown.erl,
            // where the corpus lens found the analyzer dropping the edge.
            this.processTypeReferences(node, undefined, this.currentSource(ctx) ?? "", ctx)
            break

          // ---- functions ----
          case "fun_decl":
            this.enterFunDecl(node, ctx, filePath)
            break
          // ---- evaluation-time edges ----
          case "call":
            this.processCall(node, ctx)
            break
          case "record_expr":
            this.processRecordExpr(node, ctx)
            break
          case "record_field_expr":
          case "record_index_expr":
            this.processRecordRead(node, ctx)
            break
          case "record_update_expr":
            this.processRecordUpdate(node, ctx)
            break
          case "macro_call_expr":
            this.processMacroUse(node, ctx)
            break
          case "internal_fun":
            this.processFunReference(node, ctx, false)
            break
          case "external_fun":
            this.processFunReference(node, ctx, true)
            break

          // ---- control constructs: patterns + decision points ----
          case "binary_op_expr":
            this.processBinaryOp(node, ctx)
            break
          case "receive_expr":
            ctx.patterns["Message Reception (receive)"] = true
            ctx.patterns["Actor Model (OTP)"] = true
            break
          case "case_expr":
          case "if_expr":
          case "try_expr":
          case "maybe_expr":
            // ER-D19: `maybe … of … else … end` is OTP 28's fourth
            // multi-way construct; it was invisible to the old model entirely.
            // Its `else` arms are cr_clauses and are counted by ARM_NODES, so the
            // construct itself adds no point — the same rule case/try follow.
            ctx.patterns["Pattern Matching"] = true
            break
          case "anonymous_fun":
            ctx.patterns["Higher-Order Functions"] = true
            break

          default:
            if (ARM_NODES.has(type)) this.countBranch(ctx)
            else if (COMPREHENSION_NODES.has(type)) {
              ctx.patterns["Comprehensions"] = true
              this.countBranch(ctx)
            }
            break
        }
      }

      if (pushScope) stack.push({ node, isExit: true })
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push({ node: child })
      }
    }

    // Per-symbol complexity = 1 + every branch point of every clause of that
    // identity (haskell's per-symbol contract, ER-D13's per-ARM counting).
    for (const [key, branches] of ctx.fnBranches) {
      const sym = ctx.functionSymbolByKey.get(key)
      if (sym) sym.complexity = 1 + branches
    }
    this.annotateNativeFunctions(ctx)
    this.emitOwnership(ctx)

    if (ctx.moduleName) {
      ctx.patterns["OTP Module"] = true
      const ms = ctx.moduleSymbol
      if (ms && ctx.optionalCallbacks.length > 0) {
        ms.metadata = { ...(ms.metadata ?? {}), optionalCallbacks: ctx.optionalCallbacks }
      }
    }

    const pa: string[] = []
    for (const k in ctx.patterns) pa.push(k)

    return {
      language: "erlang",
      symbols: ctx.symbols,
      relationships: ctx.relationships,
      imports: ctx.imports,
      exports: ctx.exports,
      errors: ctx.errors,
      metadata: {
        complexity: 1 + ctx.totalBranches,
        linesOfCode: content.split("\n").length,
        patterns: pa,
        framework: "Erlang",
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  // ==========================================================================
  // Pre-pass
  // ==========================================================================
  /**
   * ER-D29: every DECLARATION is a direct child of `source_file`. Measured over
   * the full 4,326-file census: module_attribute, behaviour_attribute,
   * export_attribute, export_type_attribute, import_attribute,
   * optional_callbacks_attribute, pp_include, pp_include_lib, pp_define,
   * type_alias, opaque, nominal, spec, callback, record_decl — every one of them
   * has `source_file` as its ONLY parent (the census's other "parent" entries are
   * the anonymous keyword token that shares the type's name, e.g. the `spec`
   * inside a `spec`).
   *
   * So the pre-pass reads the top level instead of walking all ~4,000 nodes per
   * file again. The one place a declaration can hide is inside conditional
   * compilation (`-ifdef … -endif`), whose bodies are top-level forms too, so
   * those containers are descended into explicitly.
   */
  private collectPrePass(rootNode: Node, ctx: ErlangContext) {
    // The module name ALONE, first: `?MODULE()` is a function head, so the name
    // must be known before any clause is read, and doing it in the same pass
    // would make the answer depend on traversal order.
    // ER-D34: a module attribute's name is not always an atom. Common Test
    // suites conventionally write `-module(?FILE_SUITE).` with the suite name in
    // a macro, so the attribute's child is a `macro_expr`, not an atom — and the
    // pre-ER3 reader, which required an atom, emitted NO module symbol at all.
    // The file then fell back to being owned by its path, so every one of its
    // edges, its export matching and its module identity were wrong, silently.
    // Measured on otp/lib/kernel/test/file_SUITE.erl. The macro table is filled
    // FIRST so the resolution does not depend on which side of the `-define` the
    // attribute sits.
    for (const form of this.prePassForms(rootNode)) {
      if (form.type !== "pp_define") continue
      const lhs = this.getChildByType(form, "macro_lhs")
      const nameNode = lhs ? (this.getChildByType(lhs, "var") ?? this.getChildByType(lhs, "atom")) : undefined
      if (!nameNode?.text) continue
      // Only a body that is EXACTLY one atom is expandable without running the
      // preprocessor. `-define(X, some:expression)` or a concatenation stays
      // unresolved, and the module name stays unknown — which is the honest
      // answer, not a guess. The grammar puts that atom DIRECTLY under
      // pp_define (there is no value_expr wrapper), so the body is the first
      // named child that is an atom.
      for (let i = 0; i < form.namedChildCount; i++) {
        const body = form.namedChild(i)
        if (!body || body.type !== "atom" || !body.text) continue
        ctx.macroAtoms.set(nameNode.text, body.text)
        break
      }
    }
    for (const top of this.prePassForms(rootNode)) {
      if (top.type !== "module_attribute") continue
      const atom = this.getChildByType(top, "atom")
      if (atom?.text) {
        ctx.moduleName = atom.text
        break
      }
      // `-module(?FILE_SUITE).` parses as a module_attribute whose only named
      // child is a macro_call_expr, and the macro's NAME is a `var` (macros are
      // `?Name`, not atoms). Both shapes are accepted: macro_call_expr is what
      // the grammar produces here, macro_expr is the object-like form.
      const expanded = this.expandModuleNameMacro(top, ctx)
      if (expanded) {
        ctx.moduleName = expanded
        break
      }
    }
    // `prePassForms` is an O(forms) walk. Calling it in the loop CONDITION and
    // again in the loop BODY made the pre-pass O(forms^2) on every file — the
    // quadratic term the performance review could not attribute through six
    // ablations, because the ablations were ablating semantics rather than
    // looking at how often this function is invoked. One call, one array.
    const forms = this.prePassForms(rootNode)
    const stack: Node[] = []
    for (let i = forms.length - 1; i >= 0; i--) {
      const top = forms[i]
      if (top) stack.push(top)
    }
    while (stack.length > 0) {
      const node = stack.pop()!
      if (!node.isNamed) continue
      const type = node.type
      if (type === "fun_decl") {
        const clauses = this.collectChildrenByType(node, "function_clause")
        const head = this.readClauseHead(clauses[0], ctx.moduleName)
        if (head) {
          ctx.funDecls.set(node.startIndex, {
            name: head.name,
            arity: head.arity,
            clauseCount: clauses.length,
            macroHead: head.macroHead,
            startIndex: node.startIndex,
          })
          ctx.declaredNames.add(head.name)
          const key = this.fnKey(head.name, head.arity)
          ctx.clauseCountByKey.set(key, (ctx.clauseCountByKey.get(key) ?? 0) + clauses.length)
          if (head.macroHead) ctx.stats.macroHeadDecls++
        }
      } else if (type === "spec") {
        const nameNode = this.getChildByType(node, "atom")
        const sig = this.getChildByType(node, "type_sig")
        if (nameNode?.text && sig) {
          const params = this.namedChildrenTexts(this.getChildByType(sig, "expr_args"))
          ctx.specs.set(this.fnKey(nameNode.text, params.length), {
            params,
            ret: this.typeSigReturnText(sig),
            line: nameNode.startPosition.row + 1,
          })
        }
      } else if (type === "wild_attribute") {
        const attrName = this.attrNameText(node)
        if (attrName === "nifs") this.collectAttributeFaEntries(node, ctx.nifEntries, ctx)
        else if (attrName === "on_load") this.collectAttributeFaEntries(node, ctx.onLoadEntries, ctx)
      } else if (PRE_PASS_DESCEND.has(type)) {
        // `-ifdef … -endif` holds top-level forms of its own, and a grammar
        // ERROR hoists them all into itself.
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const c = node.namedChild(i)
          if (c) stack.push(c)
        }
      }
    }
  }

  /**
   * The forms the pre-pass reads: `source_file`'s named children, with any
   * conditional-compilation or grammar-ERROR container's children spliced in
   * (ER-D29). Every DECLARATION lives here — measured over the 4,326-file
   * census — so the pre-pass costs O(declarations) instead of a second walk of
   * all ~4,000 nodes per file.
   */
  private prePassForms(rootNode: Node): Node[] {
    const out: Node[] = []
    const stack: Node[] = []
    for (let i = rootNode.namedChildCount - 1; i >= 0; i--) {
      const c = rootNode.namedChild(i)
      if (c) stack.push(c)
    }
    while (stack.length > 0) {
      const n = stack.pop()!
      if (!n.isNamed) continue
      if (PRE_PASS_DESCEND.has(n.type)) {
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
        continue
      }
      out.push(n)
    }
    return out
  }

  private fnKey(name: string, arity: number): string {
    return `${name}/${arity}`
  }

  /**
   * The inverse of `fnKey`, for the two places that must go back from a collected
   * "name/arity" entry to a symbol. Erlang function names cannot contain `/`, so
   * the LAST slash is the separator and a name like `mod/1` never appears here.
   */
  private splitFnKey(key: string): [string, string] {
    const i = key.lastIndexOf("/")
    return i === -1 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)]
  }

  /**
   * A clause head's declared name and arity.
   *
   * ER-D25: the name is normally the head's `atom`, but a MACRO-headed
   * definition carries a `macro_call_expr` instead, and the real function name
   * only exists AFTER the preprocessor expands it. Measured over the whole
   * corpus, every one of the 79 such clauses is `?MODULE() -> …` — the OTP test
   * suite idiom — and `?MODULE` is a PREDEFINED macro whose value is this file's
   * module atom, so the expansion is exact: the function is `<module>/<arity>`.
   * That is the OTP `yes_2.erl` / `stacktrace.erl` shape, and resolving it
   * recovers 79 function definitions that previously produced NO symbol at all
   * (the "unreadable clause name" the pre-ER3 oracle had to mirror).
   *
   * Any OTHER macro head is refused on purpose. `-define(DOUBLE(X), helper(X))`
   * plus `?DOUBLE(X) -> X` declares `helper/1`, not `DOUBLE/1`: naming the macro
   * would FABRICATE a function that does not exist, and the analyzer does not
   * expand macros. The clause's body is then attributed to the module, and the
   * parse is reported by the error channel.
   */
  private readClauseHead(
    clause: Node | undefined,
    moduleName: string | undefined,
  ): { name: string; arity: number; macroHead: boolean } | undefined {
    if (!clause) return undefined
    const arity = this.countArgs(this.getChildByType(clause, "expr_args"))
    const direct = this.getChildByType(clause, "atom") ?? this.getChildByType(clause, "var")
    if (direct?.text) return { name: direct.text, arity, macroHead: false }
    const macro = this.getChildByType(clause, "macro_call_expr")
    const macroName = macro ? (this.getChildByType(macro, "var") ?? this.getChildByType(macro, "atom"))?.text : undefined
    if (macroName === "MODULE" && moduleName) return { name: moduleName, arity, macroHead: true }
    return undefined
  }

  /**
   * A parameter list's arity: the named children of `expr_args`, comments
   * excluded. ONE counter serves a clause head, a call site and a `fa`, so
   * `f/1` and `f/2` can never be confused anywhere in this analyzer (ER-D2).
   */
  private countArgs(args: Node | undefined): number {
    if (!args) return 0
    let n = 0
    for (let i = 0; i < args.namedChildCount; i++) {
      const c = args.namedChild(i)
      if (c && c.type !== "comment") n++
    }
    return n
  }

  private namedChildrenTexts(args: Node | undefined): string[] {
    if (!args) return []
    const out: string[] = []
    for (let i = 0; i < args.namedChildCount; i++) {
      const c = args.namedChild(i)
      if (c && c.type !== "comment") out.push(c.text)
    }
    return out
  }

  /** The text after a type signature's `->`, or undefined when it has none. */
  private typeSigReturnText(sig: Node): string | undefined {
    for (let i = 0; i < sig.childCount; i++) {
      const c = sig.child(i)
      if (c?.type !== "->") continue
      const t = sig.text.slice(c.endIndex - sig.startIndex).trim()
      return t.length > 0 ? t : undefined
    }
    return undefined
  }

  // ==========================================================================
  // Module-level declarations
  // ==========================================================================
  /**
   * The module name a `-module(?MACRO)` attribute expands to, or undefined when
   * it cannot be known without running the preprocessor.
   *
   * ER-D34. Common Test suites name themselves through a macro by convention, so
   * this is not exotic: otp/lib/kernel/test/file_SUITE.erl writes
   * `-module(?FILE_SUITE).` and is the only such file in the 4,326-file corpus
   * — rare, but the failure was silent and total. The attribute parsed as a
   * module_attribute with a macro_call_expr child, and a reader that required an
   * `atom` emitted no module symbol at all, so the file fell back to being owned
   * by its path: wrong owner on every edge, no module in the store, exports
   * unmatched.
   */
  private expandModuleNameMacro(attr: Node, ctx: ErlangContext): string | undefined {
    const macro =
      this.getChildByType(attr, "macro_call_expr") ?? this.getChildByType(attr, "macro_expr")
    if (!macro) return undefined
    const nameNode = this.getChildByType(macro, "var") ?? this.getChildByType(macro, "atom")
    if (!nameNode?.text) return undefined
    return ctx.macroAtoms.get(nameNode.text)
  }

  private processModuleAttribute(node: Node, ctx: ErlangContext, filePath: string) {
    if (ctx.moduleSymbol) return
    let nameNode = this.getChildByType(node, "atom")
    let moduleNameOverride: string | undefined
    if (!nameNode?.text) {
      // ER-D34: `-module(?FILE_SUITE).` — the name arrives through a macro. A
      // macro use is a macro use wherever it appears, so the reference is
      // emitted as well as the resolved name; dropping it would lose the fact
      // that this module's identity is a build-time decision.
      const macro =
        this.getChildByType(node, "macro_call_expr") ?? this.getChildByType(node, "macro_expr")
      const macroName = macro
        ? (this.getChildByType(macro, "var") ?? this.getChildByType(macro, "atom"))
        : undefined
      const expanded = this.expandModuleNameMacro(node, ctx)
      if (!macroName?.text) return
      // The macro use is recorded either way, because it happened either way.
      // When the body is a bare atom the source is the RESOLVED module; when it
      // is not expandable without the preprocessor the module name is unknown,
      // so the edge is sourced to the file — the same file-path owner ER-D32
      // gives a module-less file — and tagged so a consumer can tell an
      // unresolved module name from a resolved one. Dropping the unresolved case
      // silently loses the fact that this file's identity is macro-driven.
      const source = expanded ?? this.ownerNameOf(ctx) ?? node.text
      this.pushRel(
        ctx,
        source,
        macroName.text,
        ASTEngine.RelationshipType.References,
        0.9,
        {
          erlangSpecific: true,
          context: "macro use",
          isModuleNameMacro: true,
          moduleNameResolved: !!expanded,
        },
        macroName.startPosition.row + 1,
      )
      // No module symbol is minted from an unresolvable name: the honest
      // representation of "the module name needs a preprocessor" is no module
      // symbol, not a synthesised one.
      if (!expanded) return
      // The symbol is named by what the macro EXPANDS TO. Naming it
      // `FILE_SUITE` would put a macro name in the module slot, and every
      // consumer of a module symbol — exports, imports, cross-module calls —
      // would then look for a module that no compile can ever produce. The
      // macro's own line is kept so `contains`/reference lines stay on the
      // name-bearing node (ER-D33).
      moduleNameOverride = expanded
      nameNode = macroName
    }
    const moduleName = moduleNameOverride ?? nameNode.text
    const symbol: ASTEngine.UniversalSymbol = {
      name: moduleName,
      kind: ASTEngine.SymbolKind.Module,
      range: this.nodeToRange(node),
      metadata: {
        nodeType: "module_attribute",
        line: nameNode.startPosition.row + 1,
        ...(moduleNameOverride
          ? { nameFromMacro: nameNode.text, expandsTo: moduleNameOverride }
          : {}),
      },
    }
    ctx.moduleSymbol = symbol
    ctx.symbols.push(symbol)
    ctx.moduleName = moduleName
    ctx.declStack.push({ source: moduleName, kind: "module" })
    void filePath
  }

  private processBehaviourAttribute(node: Node, ctx: ErlangContext, filePath: string) {
    const beNode = this.getChildByType(node, "atom")
    if (!beNode?.text) return
    // ER-D6: a behaviour is a cross-module contract — the Implements edge only,
    // never a standalone symbol (there is no interface declaration to own).
    this.pushRel(
      ctx,
      ctx.moduleName ?? filePath,
      beNode.text,
      ASTEngine.RelationshipType.Implements,
      1.0,
      { erlangSpecific: true, behaviour: beNode.text, context: "OTP behaviour callback implementation" },
      beNode.startPosition.row + 1,
    )
    if (OTP_BEHAVIOURS.has(beNode.text)) {
      ctx.patterns["Actor Model (OTP)"] = true
      ctx.patterns["OTP Behaviours"] = true
    }
  }

  /** `-export` / `-export_type`: a list of `fa` nodes. */
  private processFaListAttribute(
    node: Node,
    ctx: ErlangContext,
    filePath: string,
    kind: ASTEngine.SymbolKind,
  ) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type !== "fa") continue
      const fa = this.readFa(child, ctx.moduleName)
      if (!fa) continue
      ctx.exports.push({
        name: fa.name,
        arity: fa.arity,
        file: filePath,
        line: fa.line,
        kind,
        ...(kind === ASTEngine.SymbolKind.Type ? { metadata: { isTypeExport: true } } : {}),
      })
    }
  }

  private processImportAttribute(node: Node, ctx: ErlangContext, filePath: string) {
    const modNode = this.getChildByType(node, "atom")
    if (!modNode?.text) return
    const funcs: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type !== "fa") continue
      const fa = this.readFa(child, ctx.moduleName)
      if (fa) funcs.push(fa.name)
    }
    ctx.imports.push({
      module: modNode.text,
      path: modNode.text,
      importType: "named",
      // ER-D20: `-import(lists, …)` names an OTP module, which by construction
      // cannot be declared in this file — M60/#910's `is_external` contract,
      // which the file-dependency engine reads to keep system dependencies out
      // of internal resolution. The old code wrote no classification at all.
      isExternal: true,
      importedNames: funcs,
      items: funcs,
      file: filePath,
      line: modNode.startPosition.row + 1,
      isNif: false,
    })
    this.pushRel(
      ctx,
      ctx.moduleName ?? filePath,
      modNode.text,
      ASTEngine.RelationshipType.References,
      1.0,
      { erlangSpecific: true, isModuleImport: true, importedFunctions: funcs },
      modNode.startPosition.row + 1,
    )
  }

  /**
   * `-optional_callbacks([f/2, …])` names callbacks a behaviour MAY omit. It
   * declares nothing, so no symbol and no edge; the names are recorded on the
   * module symbol, which is the only place they are true.
   */
  private processOptionalCallbacksAttribute(node: Node, ctx: ErlangContext) {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type !== "fa") continue
      const fa = this.readFa(child, ctx.moduleName)
      if (fa) ctx.optionalCallbacks.push(this.fnKey(fa.name, fa.arity))
    }
  }

  // ==========================================================================
  // Preprocessor
  // ==========================================================================
  private processInclude(node: Node, ctx: ErlangContext, isPlain: boolean, filePath: string) {
    // M59 (#825): the line belongs to the NAME-BEARING node — the path STRING,
    // never the `-include` keyword. The fixture erlang/callsite-lines-825 splits
    // the attribute across three lines precisely to pin that difference.
    const fNode = this.getChildByType(node, "string")
    if (!fNode) return
    const includePath = this.stripQuotes(fNode.text)
    const line = fNode.startPosition.row + 1
    ctx.imports.push({
      module: includePath,
      path: includePath,
      importType: isPlain ? "include" : "include_lib",
      // ER-D20: `-include_lib("kernel/include/…")` resolves through the code
      // path — a system dependency. `-include("local.hrl")` is this project's.
      isExternal: !isPlain,
      file: includePath,
      line,
      isNif: false,
    })
    this.pushRel(
      ctx,
      ctx.moduleName ?? filePath,
      includePath,
      ASTEngine.RelationshipType.References,
      0.9,
      { erlangSpecific: true, isInclude: isPlain, isLibInclude: !isPlain },
      line,
    )
  }

  private processDefine(node: Node, ctx: ErlangContext) {
    const lhs = this.getChildByType(node, "macro_lhs")
    if (!lhs) return
    // A macro's NAME is the `var`; `var_args` holds its parameters. A
    // function-like macro (`-define(F(X, Y), …)`) is still one Constant symbol
    // with a parameter count — Erlang macros are not functions, so no call edge
    // can ever resolve to one.
    const nameNode = this.getChildByType(lhs, "var") ?? this.getChildByType(lhs, "atom")
    if (!nameNode?.text) return
    const params = this.getChildByType(lhs, "var_args")
    ctx.symbols.push({
      name: nameNode.text,
      kind: ASTEngine.SymbolKind.Constant,
      range: this.nodeToRange(node),
      ownerName: this.ownerNameOf(ctx),
      ownerKind: ASTEngine.SymbolKind.Module,
      metadata: {
        nodeType: "macro_definition",
        isMacro: true,
        isFunctionLike: params !== undefined,
        parameterCount: this.countArgs(params),
        line: nameNode.startPosition.row + 1,
      },
    })
    // ER-D12: an edge inside this declaration belongs to the MACRO, not to the
    // module — the macro body is its own unit of code.
    ctx.declStack.push({ source: nameNode.text, kind: "macro" })
  }

  // ==========================================================================
  // Types
  // ==========================================================================
  private processTypeDeclaration(node: Node, ctx: ErlangContext, type: string, filePath: string) {
    const typeNameNode = this.getChildByType(node, "type_name")
    const nameNode = typeNameNode ? this.getChildByType(typeNameNode, "atom") : this.getChildByType(node, "atom")
    const typeName = nameNode?.text ?? (typeNameNode ? this.stripFirstParen(typeNameNode.text) : undefined)
    if (!typeName) return
    const params = typeNameNode ? this.getChildByType(typeNameNode, "var_args") : undefined
    ctx.symbols.push({
      name: typeName,
      kind: ASTEngine.SymbolKind.Type,
      range: this.nodeToRange(node),
      ownerName: this.ownerNameOf(ctx),
      ownerKind: ASTEngine.SymbolKind.Module,
      metadata: {
        nodeType: type,
        isOpaque: type === "opaque",
        isNominal: type === "nominal",
        arity: this.countArgs(params),
        line: (nameNode ?? typeNameNode ?? node).startPosition.row + 1,
      },
    })
    // Every type name in the BODY belongs to this type, and the body is a type
    // context (pushed by the caller), so its `call`/`atom` nodes are read as
    // type references here and skipped by processCall.
    ctx.declStack.push({ source: typeName, kind: "type" })
    this.processTypeReferences(node, typeNameNode, typeName, ctx)
  }

  /**
   * ER-G3: a behaviour's callback contract is a Method owned by the module.
   * The arity is the type signature's parameter count. A behaviour that also
   * DEFINES its callback (`-callback init/1` plus `init/1 -> …`) yields ONE
   * symbol: both declare the same (name, arity) identity.
   */
  private processCallback(node: Node, ctx: ErlangContext, filePath: string) {
    const nameNode = this.getChildByType(node, "atom")
    if (!nameNode?.text) return
    const sig = this.getChildByType(node, "type_sig")
    const key = this.fnKey(nameNode.text, this.countArgs(sig ? this.getChildByType(sig, "expr_args") : undefined))
    const existing = ctx.functionSymbolByKey.get(key)
    if (existing) {
      existing.metadata = {
        ...(existing.metadata ?? {}),
        isCallback: true,
        callbackLine: nameNode.startPosition.row + 1,
      }
    } else {
      const symbol: ASTEngine.UniversalSymbol = {
        name: nameNode.text,
        kind: ASTEngine.SymbolKind.Method,
        range: this.nodeToRange(node),
        ownerName: this.ownerNameOf(ctx),
        ownerKind: ASTEngine.SymbolKind.Module,
        metadata: {
          nodeType: "callback",
          isCallback: true,
          arity: this.countArgs(sig ? this.getChildByType(sig, "expr_args") : undefined),
          line: nameNode.startPosition.row + 1,
        },
      }
      ctx.functionSymbolByKey.set(key, symbol)
      ctx.symbols.push(symbol)
    }
    // ER-D27: a callback's SIGNATURE is the behaviour's contract, and it names
    // types: `-callback init_per_suite(Config :: ct_config()) -> …` makes
    // `init_per_suite -> ct_config` a real edge. Without it the behaviour
    // interface — the most valuable type graph in an OTP codebase — was
    // invisible: the corpus census measured 65 such edges dropped in 60 files.
    // The declaration's own name atom is the skip span, so a callback never
    // references itself.
    this.processTypeReferences(node, nameNode, nameNode.text, ctx)
    ctx.declStack.push({ source: nameNode.text, kind: "callback" })
  }

  private processSpecTypes(node: Node, ctx: ErlangContext) {
    const nameNode = this.getChildByType(node, "atom")
    if (!nameNode?.text) return
    this.processTypeReferences(node, nameNode, nameNode.text, ctx)
    // `-spec new() -> #rec{}.` is a dependency of NEW, not of the module: the
    // record reference inside a spec was landing on the module (21 unexplained
    // edges in the 60-file census, all of this shape).
    ctx.declStack.push({ source: nameNode.text, kind: "spec" })
  }

  /**
   * A record is the struct analog: one Struct symbol owned by the module, one
   * Property per field owned by the record. Field DEFAULTS are EVALUATIONS and
   * field TYPES are TYPE references, both attributed to the RECORD (ER-D12) —
   * `-record(state, {t = erlang:make_ref()})` calls a function from the record's
   * own declaration, and `-record(r, {f :: pid()})` names a type from it.
   */
  private processRecordDecl(node: Node, ctx: ErlangContext, filePath: string) {
    const nameNode = this.getChildByType(node, "atom")
    if (!nameNode?.text) return
    const recordName = nameNode.text
    // ER-D12: the record is the attribution frame for its OWN fields, so the
    // frame is pushed BEFORE the field loop — a field's type or default
    // (`-record(r, {f :: #other{}})`) belongs to `r`, not to the module.
    ctx.declStack.push({ source: recordName, kind: "record" })
    const fields: string[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type !== "record_field") continue
      const fieldName = this.getChildByType(child, "atom")
      if (!fieldName?.text) continue
      fields.push(fieldName.text)
      const fieldType = this.getChildByType(child, "field_type")
      const defaultExpr = this.getChildByType(child, "field_expr")
      ctx.symbols.push({
        name: fieldName.text,
        kind: ASTEngine.SymbolKind.Property,
        range: this.nodeToRange(child),
        ownerName: recordName,
        ownerKind: ASTEngine.SymbolKind.Struct,
        metadata: {
          nodeType: "record_field",
          isRecordField: true,
          line: fieldName.startPosition.row + 1,
          ...(defaultExpr ? { defaultValue: defaultExpr.text } : {}),
          ...(fieldType ? { fieldType: fieldType.text } : {}),
        },
      })
      if (fieldType) this.processTypeReferences(fieldType, undefined, recordName, ctx)
    }
    ctx.symbols.push({
      name: recordName,
      kind: ASTEngine.SymbolKind.Struct,
      range: this.nodeToRange(node),
      ownerName: this.ownerNameOf(ctx),
      ownerKind: ASTEngine.SymbolKind.Module,
      metadata: { nodeType: "record_decl", fields, line: nameNode.startPosition.row + 1 },
    })
  }

  // ==========================================================================
  // Functions
  // ==========================================================================
  private enterFunDecl(node: Node, ctx: ErlangContext, filePath: string) {
    const info = ctx.funDecls.get(node.startIndex)
    if (!info) {
      // ER-D25: a macro-headed clause whose name cannot be resolved without
      // expansion. No symbol is minted — inventing one would fabricate a
      // function that does not exist — and the body is attributed to the module
      // rather than leaking onto the PREVIOUS function's frame.
      ctx.declStack.push({ source: ctx.moduleName ?? filePath, kind: "module" })
      return
    }
    const name = info.name
    const arity = info.arity
    const key = this.fnKey(name, arity)
    const clause = this.collectChildrenByType(node, "function_clause")[0]
    // ER-D26: the pinned grammar gives EVERY clause its own `fun_decl`, joined by
    // a trailing `;` (measured: 18,444 fun_decls for 18,409 function_clauses
    // across the corpus, and `;` is a child of fun_decl 7,059 times). Erlang
    // semantics are one function per (name, arity), so the symbol is created ONCE
    // per identity and every later clause of that identity folds into it — the
    // range grows, `clauseCount` accumulates, and the branch counts sum. Reading
    // one symbol per fun_decl is what made `handle_req/2` two rows with
    // `clauseCount` permanently 1.
    let symbol = ctx.functionSymbolByKey.get(key)
    if (symbol) {
      this.extendRange(symbol, clause ?? node)
      // ER-D30: when a module both DECLARES a callback and DEFINES it — a
      // behaviour with a default implementation, the `tftp_logger` shape — the
      // DEFINITION decides the kind. The pre-ER3 order dependence was real: the
      // `-callback` line comes first, so the symbol stayed a Method and the
      // function's own parameters/complexity were never attached. `isCallback`
      // stays: the contract is true whether or not this file implements it.
      if (symbol.kind === ASTEngine.SymbolKind.Method && (symbol.metadata as any)?.isCallback) {
        symbol.kind = ASTEngine.SymbolKind.Function
        // `metadata.line` is the symbol's OWN name line (ER-D30/M59), and after
        // the merge the symbol IS the definition — so the line follows it, while
        // the contract's line stays in callbackLine. Leaving `line` on the
        // `-callback` would make `contains` point at a declaration that is not
        // this symbol.
        symbol.metadata = {
          ...(symbol.metadata ?? {}),
          definedHere: true,
          ...(clause
            ? { definitionLine: clause.startPosition.row + 1, line: clause.startPosition.row + 1 }
            : {}),
        }
        // The symbol's LINE is the definition's, not the contract's: the
        // definition is the thing that exists, and the contract's line stays in
        // metadata.callbackLine. The corpus lens showed the `contains` edge
        // still carrying the `-callback` line (tftp_logger: 51 wanted 66).
        if (clause) {
          const r = this.nodeToRange(clause)
          symbol.range.startLine = r.startLine
          symbol.range.startColumn = r.startColumn
          if (symbol.range.startIndex !== undefined && r.startIndex !== undefined) {
            symbol.range.startIndex = r.startIndex
          }
        }
      }
    } else {
      symbol = this.makeFunctionSymbol(ctx, name, arity, clause, node, info, filePath)
      ctx.functionSymbolByKey.set(key, symbol)
      ctx.symbols.push(symbol)
    }
    ctx.currentFun = { name, key, symbol, branches: 0 }
    // Each extra clause of a function is one more branch. The count is the
    // FILE-wide clause tally for this identity, so it holds whether the grammar
    // emits one fun_decl per clause or groups them.
    const extra = (ctx.clauseCountByKey.get(key) ?? 1) - 1
    for (let i = 0; i < extra; i++) this.countBranch(ctx)
    ctx.declStack.push({ source: name, kind: "function" })
  }

  private extendRange(symbol: ASTEngine.UniversalSymbol, node: Node) {
    const r = this.nodeToRange(node)
    symbol.range.endLine = Math.max(symbol.range.endLine, r.endLine)
    symbol.range.endColumn = Math.max(symbol.range.endColumn, r.endColumn)
    if (symbol.range.endIndex !== undefined && r.endIndex !== undefined) {
      symbol.range.endIndex = Math.max(symbol.range.endIndex, r.endIndex)
    }
  }

  /**
   * The name of the macro sitting in a remote-module position, or undefined when
   * the module is a plain atom.
   *
   * ER-D25 vs ER-D35. `?MODULE:f(X)` is the idiomatic self-dispatch and resolves
   * to this file's module. `?ANYTHING_ELSE:f(X)` does not: the macro is an
   * ordinary build-time constant whose value this analyzer does not expand, and
   * treating it as `?MODULE` fabricates a self-call. The distinction is the
   * macro's NAME, and the full-corpus draw is what forced it — otp's
   * `file_SUITE.erl` writes `?FILE_MODULE:read_file_info(Priv)`, and before this
   * check every one of those calls was reported as a call into its own module.
   */
  private remoteMacroModuleName(remoteModule: Node | undefined): string | undefined {
    if (!remoteModule) return undefined
    const macro =
      this.getChildByType(remoteModule, "macro_call_expr") ??
      this.getChildByType(remoteModule, "macro_expr")
    if (!macro) return undefined
    const nameNode = this.getChildByType(macro, "var") ?? this.getChildByType(macro, "atom")
    return nameNode?.text
  }

  private makeFunctionSymbol(
    ctx: ErlangContext,
    name: string,
    arity: number,
    clause: Node | undefined,
    declNode: Node,
    info: FunDeclInfo | undefined,
    filePath: string,
  ): ASTEngine.UniversalSymbol {
    const key = this.fnKey(name, arity)
    const spec = ctx.specs.get(key)
    const params: ASTEngine.Parameter[] = this.namedChildrenOf(
      clause ? this.getChildByType(clause, "expr_args") : undefined,
    ).map((c, i) => ({
      // ER-D21: a clause head is a PATTERN, not a declaration. The binding's
      // name is carried when the pattern is a plain variable; the pattern itself
      // is always carried, because that is what the head really says.
      name: c.type === "var" ? c.text : "",
      pattern: c.text,
      ...(spec?.params[i] ? { type: spec.params[i] } : {}),
    }))
    return {
      name,
      kind: ASTEngine.SymbolKind.Function,
      range: this.nodeToRange(clause ?? declNode),
      ownerName: this.ownerNameOf(ctx),
      ownerKind: ASTEngine.SymbolKind.Module,
      parameters: params,
      ...(spec?.ret ? { returnType: spec.ret } : {}),
      complexity: 1,
      metadata: {
        nodeType: "function_clause",
        arity,
        clauseCount: ctx.clauseCountByKey.get(key) ?? 1,
        ...(clause ? { line: clause.startPosition.row + 1 } : {}),
        ...(info?.macroHead ? { isMacroHead: true } : {}),
        ...(spec ? { hasSpec: true, specLine: spec.line } : {}),
      },
    }
  }

  /**
   * ER-D22: `-nifs([f/1])` and `-on_load([g/0])` are ATTRIBUTES about functions,
   * not declarations. The old code minted a second Function symbol per entry —
   * and could not have: `attr_name.text` is `-nifs` (the dash is INSIDE the
   * node), so its `=== "nifs"` test never matched, and the entries are
   * `binary_op_expr` (`f/1`), not the `fa` the branch then looked for. Two
   * independent defects hid the same behaviour. The entries now annotate the
   * declared function, which is the honest surface: a NIF always has an
   * Erlang-visible stub.
   */
  private annotateNativeFunctions(ctx: ErlangContext) {
    // ER-D37: a `-nifs` entry with NO Erlang clause is PUBLISHED, not counted as
    // unresolved. The pre-fix comment here claimed "a NIF always has an
    // Erlang-visible stub"; that is false, and the corpus says so. A NIF is
    // implemented in C and its Erlang name is declared BY the attribute — the
    // compiler accepts `-nifs([n/1])` with no `n/1` clause anywhere in the file.
    // So for those entries the attribute is the ONLY declaration site: dropping
    // them made every call to that NIF dangle, with nothing in the graph saying a
    // function was declared. Measured on the co-agent's `imports-and-try`
    // fixture, where `-nifs([nif_one/0, nif_two/1])` declares two functions that
    // appear nowhere else in the file.
    //
    // `-on_load` is deliberately NOT extended the same way: the compiler REQUIRES
    // the named function to be defined in the module, so an entry with no symbol
    // is a genuine unresolved reference and stays counted.
    const owner = this.ownerNameOf(ctx)
    for (const [key, line] of ctx.nifEntries) {
      const sym = ctx.functionSymbolByKey.get(key)
      if (sym) {
        sym.metadata = { ...(sym.metadata ?? {}), isNif: true }
        continue
      }
      const [name, arityText] = this.splitFnKey(key)
      const arity = Number(arityText)
      if (!name || !Number.isFinite(arity)) {
        ctx.stats.unresolvedNifs++
        continue
      }
      const published: ASTEngine.UniversalSymbol = {
        name,
        kind: ASTEngine.SymbolKind.Function,
        range: { startLine: line, startColumn: 1, endLine: line, endColumn: 1 },
        ownerName: owner,
        ownerKind: ASTEngine.SymbolKind.Module,
        metadata: {
          nodeType: "nif_declaration",
          arity,
          clauseCount: 0,
          isNif: true,
          declaredByNifsAttribute: true,
          line,
        },
      }
      ctx.symbols.push(published)
      ctx.functionSymbolByKey.set(key, published)
    }
    for (const [key] of ctx.onLoadEntries) {
      const sym = ctx.functionSymbolByKey.get(key)
      if (sym) sym.metadata = { ...(sym.metadata ?? {}), isOnLoad: true }
    }
  }

  // ==========================================================================
  // Calls
  // ==========================================================================
  private processCall(node: Node, ctx: ErlangContext) {
    const callee = node.namedChild(0)
    if (!callee) return

    if (callee.type === "atom" && SPAWN_BIFS.has(callee.text)) {
      ctx.patterns["Actor Model (OTP)"] = true
      ctx.patterns["Process Spawning"] = true
      return
    }

    // Type context: `term()`, `pid()` and friends inside a -spec/-type/-callback
    // are TYPE names. processTypeReferences already walked the body, so nothing
    // is emitted here.
    if (ctx.typeDepth > 0) return

    // ER-D11: a macro BODY is template text. Its expansion sites are unknown —
    // the grammar does not expand — so a call edge from the template would name
    // a line that is not a call site, and a per-use edge would have to be
    // fabricated. Macro USES inside a body ARE emitted (a macro-to-macro
    // dependency is a static fact, 123 sites per 300 corpus files), because
    // processMacroUse runs before this check.
    if (ctx.macroDepth > 0) return

    const source = this.currentSource(ctx)
    if (!source) return
    const arity = this.countArgs(this.getChildByType(node, "expr_args"))

    const remote = this.getChildByType(node, "remote")
    if (remote) {
      // ER-D14: STRUCTURAL extraction. The module is the `atom` (or the ?MODULE
      // macro) INSIDE `remote_module`; the function is the `atom` that is a
      // DIRECT child of `remote`. The pre-ER2 code took the first two atoms in
      // DFS order, which mis-picked whenever the module position held anything
      // but a bare atom.
      const remoteModule = this.getChildByType(remote, "remote_module")
      const modAtom = remoteModule ? this.getChildByType(remoteModule, "atom") : undefined
      const macroMod = this.remoteMacroModuleName(remoteModule)
      const fnAtom = this.getChildByType(remote, "atom")
      if (!fnAtom?.text) {
        ctx.stats.dynamicRemote++
        return
      }
      if (modAtom?.text) {
        this.pushRel(
          ctx,
          source,
          `${modAtom.text}:${fnAtom.text}`,
          ASTEngine.RelationshipType.Calls,
          0.9,
          { erlangSpecific: true, context: "remote function call", callArity: arity },
          fnAtom.startPosition.row + 1,
        )
        return
      }
      if (macroMod) {
        // `?MODULE:run(X)` — the idiomatic self-dispatch. The module IS known: it
        // is this file's module, so the call resolves exactly like a
        // module-qualified one. The ?MODULE use itself still emits its macro
        // reference from processMacroUse.
        //
        // Any OTHER macro in module position is ER-D35: not a self-dispatch. The
        // value lives in a preprocessor definition the analyzer does not expand,
        // so no callee is derivable. Substituting this module (what this branch
        // used to do for every macro) invents a self-call that does not exist in
        // the source — 922 of them over the corpus, every one of them wrong.
        const mod = macroMod === "MODULE" ? ctx.moduleName : undefined
        if (!mod) {
          ctx.stats.dynamicRemote++
          return
        }
        this.pushRel(
          ctx,
          source,
          `${mod}:${fnAtom.text}`,
          ASTEngine.RelationshipType.Calls,
          0.9,
          { erlangSpecific: true, context: "remote function call", callArity: arity, macroModule: true },
          fnAtom.startPosition.row + 1,
        )
        return
      }
      // ER-D23: a dynamic remote (`M:F(X)`, `erlang:F(X)`) has no statically
      // nameable callee. Naming the leaf alone would conflate every module's
      // `F`; naming nothing is the honest answer. Counted, never invented.
      ctx.stats.dynamicRemote++
      return
    }

    // A local call resolves only when the callee is DECLARED in this file. That
    // one gate keeps every BIF (`length/1`, `self/0`, `is_record/2`) and every
    // auto-imported function out of the call graph.
    if (callee.type !== "atom" || !callee.text) return
    if (!ctx.declaredNames.has(callee.text)) return
    this.pushRel(
      ctx,
      source,
      callee.text,
      ASTEngine.RelationshipType.Calls,
      0.9,
      { erlangSpecific: true, context: "local function call", callArity: arity },
      callee.startPosition.row + 1,
    )
  }

  // ==========================================================================
  // Records
  // ==========================================================================
  private processRecordExpr(node: Node, ctx: ErlangContext) {
    const nameNode = this.getChildByType(node, "record_name")
    const atom = nameNode ? this.getChildByType(nameNode, "atom") : undefined
    if (!atom?.text) return
    const source = this.currentSource(ctx)
    if (!source) return
    const line = atom.startPosition.row + 1
    if (ctx.typeDepth > 0) {
      // `#state{}` inside a -type/-spec is a type dependency, not a
      // construction — and it is the most valuable edge the record graph has: it
      // is how a behaviour's `state()` contract reaches the record.
      this.pushRel(
        ctx,
        source,
        atom.text,
        ASTEngine.RelationshipType.References,
        1.0,
        // The context is the generic type-dependency label so the whole family
        // reads uniformly, and the record-ness is an explicit flag rather than a
        // second context string: a consumer asking "is this a dependency on a
        // record?" then has a boolean to read instead of a string to match.
        { erlangSpecific: true, context: "type reference", isRecordType: true },
        line,
      )
      return
    }
    // A head is a MATCH, not a construction (ER-D4).
    if (this.isPatternPosition(node)) return
    this.pushRel(
      ctx,
      source,
      atom.text,
      ASTEngine.RelationshipType.Instantiates,
      1.0,
      { erlangSpecific: true, isRecordExpr: true },
      line,
    )
  }

  /**
   * ER-D24 (user finding #1, ER-G4): a member READ is the dominant OTP idiom —
   * every gen_server state transition reads the state record. Reads and index
   * reads emit `uses` to the RECORD and to the touched FIELD (java/kotlin
   * member-read parity, #739/#740). A read in PATTERN position is a match and
   * emits nothing.
   */
  private processRecordRead(node: Node, ctx: ErlangContext) {
    if (ctx.typeDepth > 0 || this.isPatternPosition(node)) return
    const source = this.currentSource(ctx)
    if (!source) return
    const recordAtom = this.atomIn(this.getChildByType(node, "record_name"))
    if (recordAtom) {
      this.pushRel(
        ctx,
        source,
        recordAtom.text,
        ASTEngine.RelationshipType.Uses,
        1.0,
        { erlangSpecific: true, context: "record member read" },
        recordAtom.startPosition.row + 1,
      )
    }
    const fieldAtom = this.atomIn(this.getChildByType(node, "record_field_name"))
    if (fieldAtom) {
      this.pushRel(
        ctx,
        source,
        fieldAtom.text,
        ASTEngine.RelationshipType.Uses,
        1.0,
        { erlangSpecific: true, context: "record member read" },
        fieldAtom.startPosition.row + 1,
      )
    }
  }

  /**
   * ER-D4: an UPDATE is member mutation of an existing value, never a
   * construction — so `uses`, never `instantiates` — and it touches the RECORD
   * plus every ASSIGNED field.
   */
  private processRecordUpdate(node: Node, ctx: ErlangContext) {
    if (ctx.typeDepth > 0 || this.isPatternPosition(node)) return
    const source = this.currentSource(ctx)
    if (!source) return
    const recordAtom = this.atomIn(this.getChildByType(node, "record_name"))
    if (recordAtom) {
      this.pushRel(
        ctx,
        source,
        recordAtom.text,
        ASTEngine.RelationshipType.Uses,
        1.0,
        { erlangSpecific: true, context: "record field update" },
        recordAtom.startPosition.row + 1,
      )
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type !== "record_field") continue
      const fieldAtom = this.getChildByType(child, "atom")
      if (!fieldAtom?.text) continue
      this.pushRel(
        ctx,
        source,
        fieldAtom.text,
        ASTEngine.RelationshipType.Uses,
        1.0,
        { erlangSpecific: true, context: "record field update" },
        fieldAtom.startPosition.row + 1,
      )
    }
  }

  // ==========================================================================
  // Macros and fun values
  // ==========================================================================
  /**
   * ER-D9 (user finding #2, ER-G1): every `?MACRO` use is a reference to the
   * macro's Constant symbol, per site, whether or not the macro is defined in
   * this file. A use of a header-defined macro lands as an EXTERNAL target,
   * which is the honest answer — the declaration lives in another file, and the
   * fixture erlang/refs-er2 pins exactly that.
   *
   * The name is the `var` child when the macro takes no arguments and the `atom`
   * child when it does (`?FOO(A)` → atom + macro_call_args). Reading only the
   * `var` would drop every function-like macro use (measured: 2,691 of the 6,612
   * macro_call_expr sites in 300 corpus files carry a macro_call_args).
   */
  private processMacroUse(node: Node, ctx: ErlangContext) {
    // The module's OWN name macro is emitted by processModuleAttribute, tagged
    // `isModuleNameMacro` and sourced to the RESOLVED module. Firing here too
    // produced a second edge from a different source, because this generic path
    // reads `currentSource` — which is still the file path while the attribute's
    // children are walked — so one macro use became two edges with two sources.
    if (node.parent?.type === "module_attribute") return
    const nameNode = this.getChildByType(node, "var") ?? this.getChildByType(node, "atom")
    if (!nameNode?.text) return
    const source = this.currentSource(ctx)
    if (!source) return
    this.pushRel(
      ctx,
      source,
      nameNode.text,
      ASTEngine.RelationshipType.References,
      1.0,
      { erlangSpecific: true, context: "macro use" },
      nameNode.startPosition.row + 1,
    )
  }

  /**
   * ER-D10 (user finding #4, ER-G2): `fun f/1` and `fun lists:map/2` name a
   * function VALUE. Taking a reference is not calling it, so these are
   * `references`, never `calls` (the fixture forbids a calls edge at the same
   * site). A qualified reference keeps its module (ER-D1); `fun ?MODULE:g/0`
   * expands to this module exactly like the remote-call rule.
   */
  private processFunReference(node: Node, ctx: ErlangContext, external: boolean) {
    if (ctx.typeDepth > 0 || ctx.macroDepth > 0) return
    const source = this.currentSource(ctx)
    if (!source) return
    const arityNode = this.getChildByType(node, "arity")
    const arity = arityNode ? this.digitsOf(this.getChildByType(arityNode, "integer")?.text) : 0
    if (!external) {
      const nameAtom = this.getChildByType(node, "atom")
      if (!nameAtom?.text) return
      this.pushRel(
        ctx,
        source,
        nameAtom.text,
        ASTEngine.RelationshipType.References,
        0.9,
        { erlangSpecific: true, context: "fun value reference", callArity: arity },
        nameAtom.startPosition.row + 1,
      )
      return
    }
    const fnAtom = this.getChildByType(node, "atom")
    if (!fnAtom?.text) return
    const modNode = this.getChildByType(node, "module")
    const modAtom = modNode ? this.getChildByType(modNode, "atom") : undefined
    const macroMod = this.remoteMacroModuleName(modNode)
    if (modAtom?.text) {
      this.pushRel(
        ctx,
        source,
        `${modAtom.text}:${fnAtom.text}`,
        ASTEngine.RelationshipType.References,
        0.9,
        { erlangSpecific: true, context: "fun value reference", callArity: arity },
        fnAtom.startPosition.row + 1,
      )
      return
    }
    // ER-D35, same distinction as the call site: only `?MODULE:f/1` names this
    // file's module. `?OTHER:f/1` names nothing derivable.
    if (macroMod === "MODULE" && ctx.moduleName) {
      this.pushRel(
        ctx,
        source,
        `${ctx.moduleName}:${fnAtom.text}`,
        ASTEngine.RelationshipType.References,
        0.9,
        { erlangSpecific: true, context: "fun value reference", callArity: arity, macroModule: true },
        fnAtom.startPosition.row + 1,
      )
    }
  }

  // ==========================================================================
  // Operators
  // ==========================================================================
  private processBinaryOp(node: Node, ctx: ErlangContext) {
    const op = node.child(1)?.text
    // `!` is the SEND operator and parses as a binary_op_expr in this grammar
    // (the `send_expression` shape the old doc described does not exist — the
    // full census has no such node type). A send calls no symbol.
    if (op === "!") {
      ctx.patterns["Message Passing"] = true
      ctx.patterns["Actor Model (OTP)"] = true
      return
    }
    // andalso / orelse are the only short-circuit operators: each is one more
    // branch. and / or / band / bor are bitwise and open no new path.
    if ((op === "andalso" || op === "orelse") && ctx.macroDepth === 0) {
      ctx.patterns["Pattern Matching"] = true
      this.countBranch(ctx)
    }
  }

  private countBranch(ctx: ErlangContext) {
    if (ctx.macroDepth > 0) return
    ctx.totalBranches++
    if (ctx.currentFun) ctx.currentFun.branches++
  }

  // ==========================================================================
  // Type references (the type graph)
  // ==========================================================================
  /**
   * ER-D10 (user finding #6, ER-G5's type half): a declared type's BODY names
   * other types, and that dependency graph is the whole value of reading a
   * `-type`. Inside a type context every `atom` and every applied `call` head is
   * a type name; `var` is a type parameter and `string` is a literal, so both are
   * silent.
   *
   * The declared type's OWN `type_name` is skipped by SPAN CONTAINMENT
   * (startIndex/endIndex), never by object identity: web-tree-sitter hands out a
   * FRESH wrapper per access, so `child !== skip` never matches and the type
   * would reference itself. That was a real defect the M14 hygiene gate caught
   * (KAD2/TSD2 class); the mirrored copy in the oracle was invisible because
   * both sides agreed.
   *
   * A self-reference that survives this filter is LEGAL Erlang (a recursive
   * type, `-type t() :: {t, integer()}`) and is emitted — the span filter removes
   * the declaration's name, not a genuine recursive dependency.
   */
  private processTypeReferences(declNode: Node, skipSpan: Node | undefined, declName: string, ctx: ErlangContext) {
    const stack: Node[] = [declNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      // A `record_name` inside a type is the RECORD's edge, and processRecordExpr
      // emits it with the "record type reference" context; claiming it here too
      // would let the dedup keep the generic label and lose the distinction.
      if (node.isNamed && node.type === "record_name") continue
      // The module atom of a QUALIFIED type is not a second type name. Without
      // this skip `-record(opts, {env :: cowboy_middleware:env()})` emitted both
      // `cowboy_middleware:env` and the bare `cowboy_middleware` — 876 stray
      // edges over the 150-file census draw, every one of them a module name
      // masquerading as a type.
      if (node.isNamed && (node.type === "remote" || node.type === "remote_module")) continue
      // ER-D36: a type dependency is an APPLIED name, and only an applied name.
      // In Erlang type syntax a bare unquoted atom is the ATOM LITERAL of that
      // name, never a type called by that name — you must write `foo()` to apply
      // a type. So
      //     -type day() :: monday | tuesday.        % two atom literals
      //     -type job() :: #{id := job_id()}.       % `id` is a field DECLARATION
      // declare no dependency on anything named monday, tuesday or id, and
      // emitting one is a fabricated edge: it resolves to a same-named type or
      // record property elsewhere in the file and reads as a real dependency.
      // Measured by the M12 differential, which went 1.000 -> 0.784 with 19 false
      // positives, two of them exactly this (`job -> id`, `job -> kind`, the map
      // keys of a map type). The same walk also covers a record type's FIELD
      // names (`#state{q :: [job()]}`) — `q` is a declaration, `job()` is applied.
      if (node.isNamed && node.type === "call") {
        // ER-D31: a QUALIFIED type keeps its module, exactly as a qualified call
        // does (ER-D1). `-record(r, {f :: missing_mod:referenced_type()})` names
        // ONE type, `missing_mod:referenced_type`; reading the callee atom alone
        // would emit the bare `referenced_type` and conflate every module's type
        // of that name. Measured on
        // otp/lib/dialyzer/test/indent_SUITE_data/src/rec_remote_unknown.erl,
        // where the corpus lens showed the analyzer emitting the leaf and the
        // oracle emitting both halves.
        let name: string | undefined
        let nameNode: Node | undefined
        if (node.type === "call") {
          const remote = this.getChildByType(node, "remote")
          if (remote) {
            const remoteModule = this.getChildByType(remote, "remote_module")
            const modAtom = remoteModule ? this.getChildByType(remoteModule, "atom") : undefined
            const fnAtom = this.getChildByType(remote, "atom")
            if (modAtom?.text && fnAtom?.text) {
              name = `${modAtom.text}:${fnAtom.text}`
              nameNode = fnAtom
            }
          } else {
            nameNode = node.namedChild(0) ?? undefined
            name = nameNode?.text
          }
        }
        const inDeclarationName =
          skipSpan !== undefined && nameNode !== undefined && this.spanContains(skipSpan, nameNode)
        if (name && !inDeclarationName) {
          this.pushRel(
            ctx,
            declName,
            name,
            ASTEngine.RelationshipType.References,
            0.9,
            { erlangSpecific: true, context: "type reference" },
            (nameNode ?? node).startPosition.row + 1,
          )
        }
      }
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push(child)
      }
    }
  }

  // ==========================================================================
  // Ownership
  // ==========================================================================
  /**
   * `contains` for every owned symbol: module -> its functions, methods, types,
   * records and macros; record -> its fields. The line is the member's own
   * declaration line, which is where bb_graph's call hierarchy and the M59
   * symbol-line contract read it from.
   */
  /**
   * The owner of a module-scope declaration.
   *
   * Erlang has an honest gap here: a source file may declare NO `-module` at
   * all. OTP's own `lib/syntax_tools/examples/merl/basic_test.erl` is one — its
   * `-module` line is commented out because the file is textually included into
   * another module. Nothing in the file names the module it will end up in, and
   * the analyzer cannot know it. So the owner falls back to the FILE PATH: the
   * outermost container that definitely holds the declaration, and the only
   * identity the file has. (The alternative — inventing a module name from the
   * filename — would fabricate a module that does not exist.)
   *
   * Every module-scope declaration must route through here. The 400-file corpus
   * draw caught the one site that did not: macros took bare `ctx.moduleName`
   * while functions, records, types and callbacks took the fallback, so a
   * macro in a module-less file was emitted with NO owner while the function
   * beside it had one. A fallback that is duplicated per declaration is a
   * fallback that will drift.
   */
  private ownerNameOf(ctx: ErlangContext): string | undefined {
    return ctx.moduleName ?? ctx.filePath
  }

  private emitOwnership(ctx: ErlangContext) {
    for (const s of ctx.symbols) {
      const owner = s.ownerName
      if (!owner) continue
      // M59 (#825): the line belongs to the NAME-BEARING node, never to the
      // construct that contains it. `range.startLine` is the declaration
      // node's line, which for a multi-line `-define(\n  worker(S, …),\n …)` is
      // the `-define(` line — one ABOVE the macro's name. Every declaration
      // records its name's line in `metadata.line`, so that is what `contains`
      // carries. Measured on the 400-file corpus draw (the 150-file draw missed
      // it): otp/lib/snmp/src/manager/snmpm_net_if.erl wanted `contains ->
      // worker` at 209 and 220 and the analyzer said 208 and 219.
      const nameLine = (s.metadata as any)?.line
      const line = typeof nameLine === "number" && nameLine > 0 ? nameLine : s.range.startLine
      this.pushRel(
        ctx,
        owner,
        s.name,
        ASTEngine.RelationshipType.Contains,
        1.0,
        { erlangSpecific: true, isModuleMember: s.ownerKind === ASTEngine.SymbolKind.Module },
        line,
      )
    }
  }

  // ==========================================================================
  // Relationship emission
  // ==========================================================================
  /**
   * One edge per (source, type, target, line, callArity).
   *
   * ER-D2: call-site arity is part of call identity — `pick(1)` and `pick(1,2)`
   * are different callees and must not collapse into one row.
   * M59 (#825): the line is part of identity for per-SITE edges — `run/0` calling
   * `target/0` on four lines is four call sites, and the fixture pins all four.
   * The line also makes the ancestor-wins rule deterministic: in
   * `S#state{count = S#state.count + 1}` the update and the inner read share
   * (source, target, line), and because the outer node is visited first its
   * "record field update" edge is the one that survives.
   */
  private pushRel(
    ctx: ErlangContext,
    source: string,
    target: string,
    type: ASTEngine.RelationshipType,
    confidence: number,
    metadata: Record<string, any> = {},
    line?: number,
  ) {
    const key = `${source}|${type}|${target}|${line ?? ""}|${metadata.callArity ?? ""}`
    if (ctx.seenRels.has(key)) return
    ctx.seenRels.add(key)
    ctx.relationships.push({
      source,
      target,
      type,
      confidence,
      metadata,
      ...(typeof line === "number" && line > 0 ? { line_number: line } : {}),
    })
  }

  // ==========================================================================
  // Context helpers
  // ==========================================================================
  /** The symbol every edge inside the current declaration belongs to. */
  private currentSource(ctx: ErlangContext): string | undefined {
    const top = ctx.declStack[ctx.declStack.length - 1]
    return top?.source ?? ctx.moduleName
  }

  /**
   * Is this node in PATTERN position — a clause head, a `case`/`receive`/`try`
   * arm pattern, the left side of a `=` / `?=` match, or a comprehension
   * generator's left side?
   *
   * A pattern is a MATCH, not an evaluation: `S#state.count` in a head is
   * destructuring, while `State#state{…}` in a body is a real update. The rule
   * climbs to the nearest boundary. A CLAUSE HEAD makes everything below it a
   * pattern (`case X of Y = #state{} -> …` binds, it does not construct). An
   * EVALUATION context (clause body, guard) makes only the pattern side of a
   * match or generator a pattern.
   */
  /**
   * Is this node in PATTERN position?
   *
   * A pattern is a MATCH, not an evaluation. The rule is "the NEAREST enclosing
   * boundary decides", which is the only formulation that survives Erlang's
   * nesting — three corpus shapes decided it, and each one is a case a
   * cumulative flag gets wrong:
   *
   *   `D#r.f == []` in a GUARD                -> evaluation (a guard computes).
   *     Climbing to the clause head would call it a pattern; the boundary is the
   *     guard, and a guard evaluates.
   *   `[C || #cert{der = C} <- Certs]`        -> pattern. The generator's left
   *     side binds, whatever expression holds the comprehension. The nearest
   *     boundary is the generator and the node is on its `<-` side, so the
   *     enclosing `= unzip4(…)` match is never consulted.
   *   `Y = #r{} -> …` in a case arm           -> pattern. The node is on the
   *     match's VALUE side, but the match itself sits in an arm head, so the
   *     rule re-asks the boundary's own context.
   *   `X = #r{}` in a clause body            -> evaluation.
   */
  private isPatternPosition(node: Node): boolean {
    let probe: Node = node
    for (;;) {
      const boundary = this.nearestPatternBoundary(probe.parent)
      if (!boundary) return false
      if (boundary.kind === "head") return true
      if (boundary.kind === "body" || boundary.kind === "guard") return false
      if (this.isOnPatternSide(node, boundary.node)) return true
      // On the value side: the boundary's OWN context decides, so re-ask from
      // just above it. Termination is guaranteed — each step climbs one level.
      probe = boundary.node
    }
  }

  private nearestPatternBoundary(
    from: Node | null,
  ): { node: Node; kind: "head" | "body" | "guard" | "match" } | undefined {
    let cur = from
    while (cur) {
      const t = cur.type
      if (t === "function_clause" || t === "fun_clause" || t === "cr_clause") return { node: cur, kind: "head" }
      if (t === "clause_body") return { node: cur, kind: "body" }
      if (t === "guard" || t === "guard_clause") return { node: cur, kind: "guard" }
      if (t === "match_expr" || t === "cond_match_expr" || t === "lc_or_zc_expr") return { node: cur, kind: "match" }
      cur = cur.parent
    }
    return undefined
  }

  /**
   * Does `node` sit left of the boundary operator of `owner`?
   *
   * The `<-` of a comprehension generator is NOT a direct child of the
   * `lc_or_zc_expr` — the grammar wraps it in a `generator` node (measured shape:
   * `lc_or_zc_expr → generator → {LHS, <-, RHS}`). Both this analyzer AND the
   * independent oracle first missed that and agreed with each other on the wrong
   * answer, which is precisely the case a mirror cannot see: only the authored
   * fixture `erlang/patterns-er3` catches it. The `generator` / `map_generator` /
   * `b_generator` wrapper is resolved here.
   *
   * A `lc_or_zc_expr` with NO generator is a comprehension FILTER, which
   * computes — no operator, so the answer is false.
   */
  private isOnPatternSide(node: Node, owner: Node): boolean {
    let target = owner
    if (owner.type === "lc_or_zc_expr") {
      const gen =
        this.getChildByType(owner, "generator") ??
        this.getChildByType(owner, "map_generator") ??
        this.getChildByType(owner, "b_generator")
      if (gen) target = gen
    }
    for (let i = 0; i < target.childCount; i++) {
      const c = target.child(i)
      if (c && MATCH_OPERATORS.has(c.type)) return node.startIndex < c.startIndex
    }
    return false
  }

  /** Span containment — the only correct way to compare two tree-sitter nodes. */
  private spanContains(outer: Node, inner: Node): boolean {
    return outer.startIndex <= inner.startIndex && inner.endIndex <= outer.endIndex
  }

  // ==========================================================================
  // Node readers
  // ==========================================================================
  /**
   * A callee's NAME node: the `atom` that is a DIRECT child of the `remote`.
   * `undefined` when there is no `remote` and the callee is not the first named
   * child — the dynamic case, where no statically nameable callee exists
   * (ER-D23). Shared by the call path and the type-reference path so both read
   * a remote the same way.
   */
  private calleeNameNode(call: Node): Node | undefined {
    const remote = this.getChildByType(call, "remote")
    if (!remote) return call.namedChild(0) ?? undefined
    return this.getChildByType(remote, "atom")
  }

  /**
   * `name/arity` from an `fa`, with the NAME's line (M59).
   *
   * ER-D28: `-export([?MODULE/0])` is how OTP test suites export the function
   * their `?MODULE() -> …` clause declares — the `fa`'s name child is a
   * `macro_call_expr`, not an `atom`, so the pre-ER3 reader dropped the export
   * entirely (3 corpus sites). `?MODULE` expands to the module atom, so the
   * entry resolves exactly like the clause head does. Any other macro in an
   * `fa` needs expansion and is refused.
   */
  private readFa(fa: Node, moduleName?: string): { name: string; arity: number; line: number } | undefined {
    const nameNode = this.getChildByType(fa, "atom")
    const arityNode = this.getChildByType(fa, "arity")
    const arity = arityNode ? this.digitsOf(this.getChildByType(arityNode, "integer")?.text) : 0
    if (nameNode?.text) return { name: nameNode.text, arity, line: nameNode.startPosition.row + 1 }
    const macro = this.getChildByType(fa, "macro_call_expr")
    const macroName = macro ? (this.getChildByType(macro, "var") ?? this.getChildByType(macro, "atom"))?.text : undefined
    if (macroName === "MODULE" && moduleName) {
      const at = this.getChildByType(macro!, "var") ?? this.getChildByType(macro!, "atom")
      return { name: moduleName, arity, line: (at ?? macro!).startPosition.row + 1 }
    }
    return undefined
  }

  /**
   * `-nifs([f/1])` / `-on_load([g/0])` entries. The list holds
   * `binary_op_expr` (`f` `/` `1`), NOT an `fa` — the second half of the
   * dead-branch defect ER-D22 records. Both spellings are read, because the
   * grammar's own `-record`-in-`wild_attribute` error path produces `fa` nodes
   * for some vendor attributes.
   */
  private collectAttributeFaEntries(node: Node, out: Map<string, number>, ctx: ErlangContext) {
    const line = node.startPosition.row + 1
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.isNamed && n.type === "binary_op_expr" && n.child(1)?.type === "/") {
        const nameNode = this.getChildByType(n, "atom")
        if (nameNode?.text) {
          out.set(this.fnKey(nameNode.text, this.digitsOf(this.getChildByType(n, "integer")?.text)), line)
        }
        continue
      }
      if (n.isNamed && n.type === "fa") {
        const fa = this.readFa(n, ctx.moduleName)
        if (fa) out.set(this.fnKey(fa.name, fa.arity), line)
        continue
      }
      for (let i = n.childCount - 1; i >= 0; i--) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
  }

  /** `-nifs`, not `nifs`: the dash is INSIDE the `attr_name` node. */
  private attrNameText(node: Node): string | undefined {
    const attrName = this.getChildByType(node, "attr_name")
    if (!attrName) return undefined
    return this.getChildByType(attrName, "atom")?.text ?? attrName.text
  }

  private atomIn(node: Node | undefined): Node | undefined {
    return node ? this.getChildByType(node, "atom") : undefined
  }

  private namedChildrenOf(args: Node | undefined): Node[] {
    if (!args) return []
    const out: Node[] = []
    for (let i = 0; i < args.namedChildCount; i++) {
      const c = args.namedChild(i)
      if (c && c.type !== "comment") out.push(c)
    }
    return out
  }

  private getChildByType(node: Node | undefined, targetType: string): Node | undefined {
    if (!node) return undefined
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === targetType) return child
    }
    return undefined
  }

  private collectChildrenByType(node: Node, targetType: string): Node[] {
    const results: Node[] = []
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === targetType) results.push(child)
    }
    return results
  }

  private digitsOf(text: string | undefined): number {
    if (!text) return 0
    const digits = this.keepDigits(text)
    return digits.length > 0 ? parseInt(digits, 10) || 0 : 0
  }

  // ==========================================================================
  // Pure-string helpers (no regex — M12 census, M49 #849)
  // ==========================================================================
  private stripQuotes(text: string): string {
    let out = ""
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '"' || ch === "'") continue
      out += ch
    }
    return out
  }

  private keepDigits(text: string): string {
    let out = ""
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch >= "0" && ch <= "9") out += ch
    }
    return out
  }

  /** `name()` -> `name`; `maybe(T)` -> `maybe`. */
  private stripFirstParen(text: string): string {
    const paren = text.indexOf("(")
    return (paren >= 0 ? text.slice(0, paren) : text).trim()
  }

  private nodeToRange(node: Node) {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
