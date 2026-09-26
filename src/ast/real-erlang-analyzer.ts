import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

const OTP_BEHAVIOURS = new Set(["gen_server", "gen_statem", "gen_event", "supervisor", "application"])

// Node types whose subtree is TYPE SYNTAX: `-spec`, `-callback`, `-type` and
// `-opaque` annotate, they never invoke (ruling ER-D3). A `call` node under one
// of these is a type APPLICATION (`state()`, `binary()`), never a call site —
// the refs-er2 fixture's DECL-ONLY forbid. Read by isInTypeSyntax(), which
// walks ancestors (span containment, not object identity: web-tree-sitter hands
// out fresh wrappers, and a `child !== skip` comparison silently never matched
// — the hygiene gate's KAD2/TSD2 rule, which found exactly this class twice).
const TYPE_SYNTAX_NODES = new Set([
  "spec",
  "callback",
  "type_alias",
  "opaque",
  "type_sig",
  "fun_type",
  "fun_type_sig",
  "ann_type",
  "ann_var",
  "field_type",
  "range_type",
  "nominal",
  "type_name",
  "var_args",
  "type_guards",
  "pipe",
])

const SPAWN_BIFS = new Set(["spawn", "spawn_link", "spawn_monitor"])

interface ErlangContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  patterns: Record<string, boolean>
  seenRels: Set<string>
  seenImports: Set<string>
  // Every function DECLARATION in this file (name/arity), collected in a pre-pass
  // so local calls resolve forward — and so a call to f/2 is not satisfied by a
  // declaration of f/1 (ER-D2: arity is part of the callee's identity).
  declaredFunctions: Set<string>
  // Function symbols already emitted, keyed name/arity, so a multi-clause
  // declaration is ONE symbol with a clauseCount rather than one per clause.
  // (The pinned grammar opens a NEW fun_decl per semicolon-separated clause, so
  // the merge is the analyzer's job — measured 2026-09-25.)
  functionSymbols: Map<string, ASTEngine.UniversalSymbol>
  // Arms and clause count accumulated per function key; the symbol's `complexity`
  // is 1 + arms + (clauses - 1), recomputed on every merge (ER-D13).
  functionArms: Map<string, number>
  functionClauses: Map<string, number>
  currentModule: string | undefined
  currentFunction: string | undefined
  // Set while walking a `-record` declaration: a call inside a field DEFAULT is
  // attributed to the RECORD symbol, not to a function or the module (ER-D12).
  currentRecord: string | undefined
}

export class RealErlangAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: ErlangContext = {
      symbols: [],
      relationships: [],
      imports: [],
      exports: [],
      errors: [],
      patterns: {},
      seenRels: new Set(),
      seenImports: new Set(),
      declaredFunctions: new Set(),
      functionSymbols: new Map(),
      functionArms: new Map(),
      functionClauses: new Map(),
      currentModule: undefined,
      currentFunction: undefined,
      currentRecord: undefined,
    }
    let cyclomaticComplexity = 1

    // Pre-pass: every function name+arity in the file, so local calls resolve
    // even when the callee is defined LATER (forward references).
    this.collectDeclaredFunctions(rootNode, ctx.declaredFunctions)

    const stack: { node: Node; exit?: "fun" | "record" }[] = [{ node: rootNode }]

    while (stack.length > 0) {
      const item = stack.pop()!
      const node = item.node
      if (item.exit === "fun") {
        ctx.currentFunction = undefined
        continue
      }
      if (item.exit === "record") {
        ctx.currentRecord = undefined
        continue
      }
      const type = node.type
      const currentLine = node.startPosition.row + 1
      let pushedScope = false

      // ---- -include / -include_lib (pp_include / pp_include_lib) ----
      // The include path node is `string`; `string_literal` does not exist in this
      // grammar (ER1: the fallback was a dead branch the F1 auditor held open).
      // MEASURED (script/m14/tmp/erlang-er2-literal-audit.ts, 4,433 files): the
      // grammar's include WRAPPERS are `pp_include` / `pp_include_lib`; there is
      // no `*_attribute` include type. The restored branch list carried both,
      // and neither existing register could see it — the F1 extractor and the
      // F6 audit both recognise `x.type ===` (a member expression) or the
      // *ByType helpers, and this branch reads a LOCAL (`const type = node.type`).
      if (type === "pp_include" || type === "pp_include_lib") {
        const fNode = this.getChildByType(node, "string")
        if (fNode) {
          const includePath = this.stripQuotes(fNode.text)
          ctx.imports.push({ module: includePath, file: includePath, line: currentLine, isNif: false })
          // Site line = the include path STRING's line: `-include(` on line 8 and
          // `"path.hrl"` on line 9 pins 9 (M59.O2 — the name-bearing node, never
          // the construct that contains it).
          this.pushRel(ctx, this.fileSource(ctx), includePath, ASTEngine.RelationshipType.References, 0.9, {
            erlangSpecific: true, isInclude: type === "pp_include", isLibInclude: type === "pp_include_lib",
          }, this.lineOf(fNode))
        }
      }

      // ---- -module(...) ---- (first declaration wins, ER-D15: a second
      // `-module()` used to silently overwrite the identity)
      else if (type === "module_attribute") {
        const nameNode = this.getChildByType(node, "atom")
        if (nameNode?.text && !ctx.currentModule) {
          ctx.currentModule = nameNode.text
          ctx.symbols.push({
            name: ctx.currentModule,
            kind: ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            metadata: { nodeType: "module_attribute" },
          })
        }
      }

      // ---- -behaviour(gen_server). / -behaviour(my_behaviour). ----
      else if (type === "behaviour_attribute") {
        const beNode = this.getChildByType(node, "atom")
        if (beNode?.text) {
          // Any behaviour is a cross-module contract: the Implements edge only,
          // never a standalone symbol. OTP behaviours additionally mark the
          // OTP patterns. Line = the behaviour ATOM's line, not `-behaviour(`'s.
          this.pushRel(ctx, this.fileSource(ctx), beNode.text, ASTEngine.RelationshipType.Implements, 1.0, {
            erlangSpecific: true,
            behaviour: beNode.text,
            context: "OTP behaviour callback implementation",
          }, this.lineOf(beNode))
          if (OTP_BEHAVIOURS.has(beNode.text)) {
            ctx.patterns["Actor Model (OTP)"] = true
            ctx.patterns["OTP Behaviours"] = true
          }
        }
      }

      // ---- -export([greet/1, add/2]). ----
      else if (type === "export_attribute") {
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "fa") {
            const nameNode = this.getChildByType(child, "atom")
            const arityNode = this.getChildByType(child, "integer") || this.getChildByType(child, "arity")
            if (nameNode?.text) {
              const arity = arityNode ? parseInt(this.keepDigits(arityNode.text)) || 0 : 0
              ctx.exports.push({ name: nameNode.text, arity, file: filePath, line: currentLine })
            }
          }
        }
      }

      // ---- -import(lists, [map/2]). ----
      else if (type === "import_attribute") {
        const modNode = this.getChildByType(node, "atom")
        const funcs: string[] = []
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "fa") {
            const faName = this.getChildByType(child, "atom")
            if (faName?.text) funcs.push(faName.text)
          }
        }
        if (modNode?.text) {
          ctx.imports.push({ module: modNode.text, functions: funcs, file: "", line: currentLine, isNif: false })
          this.pushRel(ctx, this.fileSource(ctx), modNode.text, ASTEngine.RelationshipType.References, 1.0, {
            erlangSpecific: true, isModuleImport: true, importedFunctions: funcs,
          }, this.lineOf(modNode))
        }
      }

      // ---- -nifs([...]) ----
      // A NIF is declared HERE and nowhere else: this attribute is the only
      // symbol source for it, so it publishes one Function per entry.
      // (`-on_load(init/0)` names a function the module ALREADY declares — a
      // symbol here would be a second row for one entity, so it emits nothing;
      // pinned by erlang/imports-and-try.)
      else if (type === "wild_attribute") {
        const attrNameNode = this.getChildByType(node, "attr_name")
        const attrName = attrNameNode ? this.lastAtomText(attrNameNode) : undefined
        if (attrName === "nifs") {
          for (const entry of this.nifEntries(node)) {
            ctx.symbols.push({
              name: entry.name,
              kind: ASTEngine.SymbolKind.Function,
              range: this.nodeToRange(entry.node),
              ownerName: ctx.currentModule,
              metadata: { nodeType: attrName, isNif: true, ...(entry.arity !== undefined ? { arity: entry.arity } : {}) },
            })
          }
        }
      }

      // ---- -record(person, {name, age}). ----
      else if (type === "record_decl") {
        const nameNode = this.getChildByType(node, "atom")
        if (nameNode?.text) {
          const recordName = nameNode.text
          const fields: string[] = []
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (child?.type === "record_field") {
              const fieldNameNode = this.getChildByType(child, "atom")
              if (fieldNameNode?.text) {
                fields.push(fieldNameNode.text)
                // Record fields → property symbols owned by the record (struct),
                // matching the universal struct-field contract (C/Rust/Zig).
                ctx.symbols.push({
                  name: fieldNameNode.text,
                  kind: ASTEngine.SymbolKind.Property,
                  range: this.nodeToRange(child),
                  ownerName: recordName,
                  ownerKind: ASTEngine.SymbolKind.Struct,
                  metadata: { nodeType: "record_field", isRecordField: true },
                })
              }
            }
          }
          ctx.symbols.push({
            name: recordName,
            kind: ASTEngine.SymbolKind.Struct,
            range: this.nodeToRange(node),
            ownerName: ctx.currentModule,
            metadata: { nodeType: "record_decl", fields },
          })
          // Field DEFAULTS are evaluated in the record's own scope: a call there
          // attributes to the RECORD (ER-D12), which is what keeps
          // `-record(state, {timer = erlang:make_ref()})` visible at all.
          ctx.currentRecord = recordName
          pushedScope = true
        }
      }

      // ---- -define(MACRO, value). ----
      // The node type is `pp_define`; `define` is the unnamed keyword TOKEN the
      // wrapper contains (measured: it never occurs as a parent in 4,433 files),
      // and the name lives in `macro_lhs` (`var`, with `var_args` when the macro
      // takes parameters). The older `macro_name` fallback is not a grammar type
      // at all — both dead branches are gone (same probe as the include note).
      else if (type === "pp_define") {
        let macroName = ""
        const macroLhs = this.getChildByType(node, "macro_lhs")
        if (macroLhs) {
          const varNode = this.getChildByType(macroLhs, "var") || this.getChildByType(macroLhs, "atom")
          macroName = varNode?.text || ""
        }
        if (macroName) {
          ctx.symbols.push({
            name: macroName,
            kind: ASTEngine.SymbolKind.Constant,
            range: this.nodeToRange(node),
            ownerName: ctx.currentModule,
            metadata: { nodeType: "macro_definition", isMacro: true },
          })
        }
      }

      // ---- -callback handle(term()) -> {reply, term()}. (HS-D8 parity, ER-D11) ----
      else if (type === "callback") {
        const nameNode = this.getChildByType(node, "atom")
        if (nameNode?.text) {
          const sig = this.getChildByType(node, "type_sig")
          const args = sig ? this.getChildByType(sig, "expr_args") : undefined
          ctx.symbols.push({
            name: nameNode.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(node),
            ownerName: ctx.currentModule,
            ownerKind: ASTEngine.SymbolKind.Module,
            metadata: {
              nodeType: "callback",
              isCallback: true,
              arity: args ? this.argCount(args) : 0,
            },
          })
        }
      }

      // ---- -type name() :: ... / -type maybe(T) :: T | undefined. ----
      else if (type === "type_alias" || type === "opaque") {
        const typeNameNode = this.getChildByType(node, "type_name")
        const typeName = typeNameNode?.text ? this.stripFirstParen(typeNameNode.text) : this.getChildByType(node, "atom")?.text
        if (typeName) {
          const isOpaque = type === "opaque"
          ctx.symbols.push({
            name: typeName,
            kind: ASTEngine.SymbolKind.Type,
            range: this.nodeToRange(node),
            ownerName: ctx.currentModule,
            metadata: { nodeType: isOpaque ? "opaque" : "type_alias", ...(isOpaque ? { isOpaque: true } : {}) },
          })
          // ER-D10: the type dependency graph — references from the declared type
          // to every NAMED type in its expression (atoms + applied call heads).
          // Type vars are PARAMETERS, never references, and the declaration's own
          // type_name subtree is skipped by SPAN (a type that referenced itself
          // would be a mirrored bug on both sides of the differential).
          this.collectTypeRefs(node, typeNameNode ?? null, typeName, ctx)
        }
      }

      // ---- -spec name(...) :: ... ----
      else if (type === "spec") {
        // Specs are type annotations for the function that follows; the function
        // declaration itself emits the symbol, and nothing under a spec is an
        // invocation (isInTypeSyntax silences the type syntax).
      }

      // ---- ! (message send — binary_op_expr in this grammar) ----
      else if (type === "binary_op_expr") {
        const op = node.child(1)?.text
        if (op === "!") {
          ctx.patterns["Message Passing"] = true
          ctx.patterns["Actor Model (OTP)"] = true
        }
      }

      // ---- #person{name = Name} (record construction) ----
      // Record updates (State#state{...}) and accesses (State#state.q) are
      // record_update_expr / record_field_expr / record_index_expr — NOT
      // construction. A record_expr in a clause HEAD is a PATTERN, not a site.
      else if (type === "record_expr") {
        // ER3: a record_expr INSIDE type syntax is a record TYPE
        // (`-type r() :: #state{q :: [job()]}`) — a declaration of the record's
        // shape, never a construction, so it emits no instantiates (the same
        // DECL-ONLY boundary the calls rule uses). The record/dependency side of
        // that declaration is emitted by collectTypeRefs.
        if (!this.isInClauseHead(node) && !this.isInTypeSyntax(node)) {
          const nameNode = this.getChildByType(node, "record_name") || this.getChildByType(node, "atom")
          const recordName = nameNode?.text ? this.stripLeadingHash(nameNode.text) : ""
          if (recordName) {
            this.pushRel(ctx, this.callSource(ctx), recordName, ASTEngine.RelationshipType.Instantiates, 1.0, {
              erlangSpecific: true, isRecordExpr: true,
            }, this.lineOf(nameNode))
          }
        }
      }

      // ---- S#state.count (record member READ, ER-D7) ----
      else if (type === "record_field_expr" || type === "record_index_expr") {
        if (!this.isInClauseHead(node)) {
          const nameNode = this.getChildByType(node, "record_name")
          const fieldNode = this.getChildByType(node, "record_field_name")
          const recordName = nameNode?.text ? this.stripLeadingHash(nameNode.text) : ""
          const fieldName = fieldNode ? this.lastAtomText(fieldNode) : undefined
          const line = this.lineOf(nameNode)
          if (recordName) {
            this.pushRel(ctx, this.callSource(ctx), recordName, ASTEngine.RelationshipType.Uses, 1.0, {
              erlangSpecific: true, context: "record member read",
            }, line)
          }
          if (fieldName) {
            this.pushRel(ctx, this.callSource(ctx), fieldName, ASTEngine.RelationshipType.Uses, 1.0, {
              erlangSpecific: true, context: "record member read",
            }, line)
          }
        }
      }

      // ---- S#state{count = X} (record member UPDATE, ER-D7/ER-D4) ----
      // An update is a member WRITE, never a construction: `uses` -> the record
      // and -> each assigned field, so the OTP state-transition idiom is visible.
      else if (type === "record_update_expr") {
        if (!this.isInClauseHead(node)) {
          const nameNode = this.getChildByType(node, "record_name")
          const recordName = nameNode?.text ? this.stripLeadingHash(nameNode.text) : ""
          const line = this.lineOf(nameNode)
          if (recordName) {
            this.pushRel(ctx, this.callSource(ctx), recordName, ASTEngine.RelationshipType.Uses, 1.0, {
              erlangSpecific: true, context: "record field update",
            }, line)
          }
          for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i)
            if (child?.type !== "record_field") continue
            const fieldNode = this.getChildByType(child, "atom")
            if (fieldNode?.text) {
              this.pushRel(ctx, this.callSource(ctx), fieldNode.text, ASTEngine.RelationshipType.Uses, 1.0, {
                erlangSpecific: true, context: "record field update",
              }, line)
            }
          }
        }
      }

      // ---- ?MACRO uses (ER-D8: the declaration was a symbol, every use was invisible) ----
      else if (type === "macro_call_expr") {
        const nameNode = this.getChildByType(node, "var") || this.getChildByType(node, "atom")
        if (nameNode?.text) {
          // A use is emitted whether or not the macro is defined in this file: a
          // header-defined macro's use is still a use, and its unresolved target
          // lands as an external — honest.
          this.pushRel(ctx, this.callSource(ctx), nameNode.text, ASTEngine.RelationshipType.References, 1.0, {
            erlangSpecific: true, context: "macro use",
          }, this.lineOf(nameNode))
        }
      }

      // ---- fun f/1 / fun lists:map/2 (fun VALUE references, ER-D9: a value is
      // not an invocation — the call happens at apply time) ----
      else if (type === "internal_fun") {
        const nameNode = this.getChildByType(node, "atom")
        if (nameNode?.text) {
          this.pushRel(ctx, this.callSource(ctx), nameNode.text, ASTEngine.RelationshipType.References, 1.0, {
            erlangSpecific: true, context: "fun value reference",
          }, this.lineOf(nameNode))
        }
      }
      else if (type === "external_fun") {
        const modNode = this.getChildByType(node, "module")
        const nameNode = this.getChildByType(node, "atom")
        const modName = modNode ? this.lastAtomText(modNode) : undefined
        if (nameNode?.text && modName) {
          this.pushRel(ctx, this.callSource(ctx), `${modName}:${nameNode.text}`, ASTEngine.RelationshipType.References, 1.0, {
            erlangSpecific: true, context: "fun value reference",
          }, this.lineOf(nameNode))
        }
      }

      // ---- calls (local + remote), in evaluation contexts only ----
      else if (type === "call") {
        if (!this.isInClauseHead(node) && !this.isInTypeSyntax(node)) {
          this.processCall(node, ctx)
        }
      }

      // ---- fun_decl (function definition) ----
      else if (type === "fun_decl") {
        const funcClauses = this.collectChildrenByType(node, "function_clause")
        let funcName = ""
        for (const funcClause of funcClauses) {
          if (!funcClause) continue
          const nameNode = this.getChildByType(funcClause, "atom") || this.getChildByType(funcClause, "var")
          if (!nameNode?.text) continue
          funcName = nameNode.text
          const arity = this.clauseArity(funcClause)
          const key = `${funcName}/${arity}`
          if (!ctx.currentModule) continue
          const existing = ctx.functionSymbols.get(key)
          const arms = (ctx.functionArms.get(key) ?? 0) + this.functionArms(node)
          const clauses = (ctx.functionClauses.get(key) ?? 0) + funcClauses.length
          ctx.functionArms.set(key, arms)
          ctx.functionClauses.set(key, clauses)
          if (existing) {
            // A second clause group of the same name/arity: extend the range to
            // cover every clause (the identity contract: one symbol, the whole
            // clause list) and re-state the count and complexity.
            existing.range.endLine = node.endPosition.row + 1
            existing.range.endColumn = node.endPosition.column + 1
            existing.range.endIndex = node.endIndex
            existing.metadata = { ...(existing.metadata ?? {}), clauseCount: clauses }
            existing.complexity = 1 + arms + (clauses - 1)
          } else {
            const symbol: ASTEngine.UniversalSymbol = {
              name: funcName,
              kind: ASTEngine.SymbolKind.Function,
              range: this.nodeToRange(node),
              ownerName: ctx.currentModule,
              complexity: 1 + arms + (clauses - 1),
              metadata: { nodeType: "function_clause", clauseCount: clauses, arity },
            }
            ctx.functionSymbols.set(key, symbol)
            ctx.symbols.push(symbol)
          }
        }
        // A clause whose name is not readable (a macro head, `?CFMT(...) ->`) keeps
        // the edges attributed to the enclosing scope rather than to a name that
        // is not there — the module, exactly like the analyzer's own fallback.
        if (funcName) {
          ctx.currentFunction = funcName
          pushedScope = true
        }
      }

      // ---- receive ... end ----
      else if (type === "receive_expr") {
        ctx.patterns["Message Reception (receive)"] = true
        ctx.patterns["Actor Model (OTP)"] = true
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i)
          if (child?.type === "receive_after") {
            ctx.patterns["Receive with Timeout"] = true
          }
        }
      }

      if (pushedScope) stack.push({ node, exit: type === "record_decl" ? "record" : "fun" })
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push({ node: child })
      }
    }

    // File-level complexity = base 1 + every arm/guard counted per symbol, so the
    // file total and the per-symbol numbers cannot drift apart.
    for (const s of ctx.symbols) {
      if (typeof s.complexity === "number") cyclomaticComplexity += s.complexity - 1
    }

    // Post-loop: contains for owned symbols — module → its types/constants/
    // records/functions/callbacks/nifs; record → its fields. The line is the
    // CHILD's own declaration line (#921): that is the anchor the store's
    // resolver reads, so a wrong anchor is worse than no anchor.
    for (const s of ctx.symbols) {
      const owner = s.ownerName
      if (owner) {
        this.pushRel(ctx, owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, { erlangSpecific: true, isModuleMember: true }, s.range?.startLine)
      }
    }

    if (ctx.currentModule) ctx.patterns["OTP Module"] = true
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
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        patterns: pa,
        framework: "Erlang",
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  // ==========================================================================
  // Call extraction (evaluation contexts, main walk — ER-D12: one attribution
  // rule for every context: named function > enclosing record > module).
  // ==========================================================================
  private processCall(node: Node, ctx: ErlangContext): void {
    const callee = node.namedChild(0)
    if (!callee) return
    const arity = this.argCount(this.getChildByType(node, "expr_args"))
    const source = this.callSource(ctx)

    if (callee.type === "remote") {
      // Structural extraction (ER-D14), not a DFS over atoms: the module is the
      // atom child of `remote_module`, the function the atom child of `remote`.
      const modNode = this.getChildByType(callee, "remote_module")
      const funNode = this.getChildByType(callee, "atom")
      if (!funNode?.text) return
      let modName: string | undefined
      let macroModule = false
      const modChild = modNode ? modNode.namedChild(0) : undefined
      if (modChild?.type === "atom") {
        modName = modChild.text
      } else if (modChild?.type === "macro_call_expr") {
        // `?MODULE:run(X)` — the idiomatic self-dispatch. ?MODULE is the one
        // predefined macro whose meaning is unambiguous; the use itself still
        // emits its macro reference from the walk.
        const macroName = this.getChildByType(modChild, "var") || this.getChildByType(modChild, "atom")
        if (macroName?.text === "MODULE" && ctx.currentModule) {
          modName = ctx.currentModule
          macroModule = true
        }
      }
      if (!modName) return
      this.pushRel(ctx, source, `${modName}:${funNode.text}`, ASTEngine.RelationshipType.Calls, 0.9, {
        erlangSpecific: true, context: "remote function call", callArity: arity, ...(macroModule ? { macroModule: true } : {}),
      }, this.lineOf(funNode), arity)
      return
    }

    if (callee.type !== "atom" || !callee.text) return
    // OTP process spawning — pattern only (spawn is a BIF, not a local function;
    // the FP-family builtin-exclusion rule). A file that declares its own
    // spawn/1 emits the call on both sides, because the gate below is the
    // declaration set, not this list.
    if (SPAWN_BIFS.has(callee.text)) {
      ctx.patterns["Actor Model (OTP)"] = true
      ctx.patterns["Process Spawning"] = true
    }
    // Local call: only when THIS FILE declares that name at that ARITY
    // (forward references resolve via the pre-pass). BIFs (length, self,
    // element, ...) and imported functions are not local symbols.
    if (!ctx.currentModule) return
    if (!ctx.declaredFunctions.has(`${callee.text}/${arity}`)) return
    this.pushRel(ctx, source, callee.text, ASTEngine.RelationshipType.Calls, 0.9, {
      erlangSpecific: true, context: "local function call", callArity: arity,
    }, this.lineOf(callee), arity)
  }

  /** Where an edge's source lives: the named function, else the record being
   *  declared (a field default), else the module. */
  private callSource(ctx: ErlangContext): string {
    return ctx.currentFunction || ctx.currentRecord || ctx.currentModule || "Global"
  }

  /** Where a FILE-LEVEL edge's source lives: the module when the file declares
   *  one, else `Global` — the same fallback the expression paths above use.
   *
   *  ER3 (measured on the big corpora): these three attribute sites (include,
   *  behaviour, import) used to fall back to the FILE PATH, so every one of the
   *  corpus's 290 module-less headers attributed its edges to an absolute
   *  checkout path. Nothing caught it: F5 compares `label + target` and never
   *  reads `from`, and the lane's sample is `.erl`-only. A path is also not an
   *  identity — it changes with the checkout, which is exactly what an evidence
   *  artifact must not do. */
  private fileSource(ctx: ErlangContext): string {
    return ctx.currentModule || "Global"
  }

  // ==========================================================================
  // Relationship emission. The identity key includes the SITE LINE (M59.O2/#825
  // per-site edges, ER-D2) and, for calls, the callee ARITY — so two call sites
  // of one callee are two edges and f/1 is never merged into f/2.
  // ==========================================================================
  private pushRel(
    ctx: ErlangContext,
    source: string,
    target: string,
    type: ASTEngine.RelationshipType,
    confidence: number,
    metadata: Record<string, any> = {},
    line?: number,
    arity?: number,
  ) {
    const key = `${source}|${type}|${target}|${line ?? ""}|${arity ?? ""}`
    if (ctx.seenRels.has(key)) return
    ctx.seenRels.add(key)
    const rel: ASTEngine.UniversalRelationship = { source, target, type, confidence, metadata }
    if (typeof line === "number" && Number.isInteger(line) && line > 0) {
      ;(rel as any).line_number = line
    }
    ctx.relationships.push(rel)
  }

  /** The 1-based line of the node that NAMES the edge's target, or undefined. */
  private lineOf(node: Node | undefined): number | undefined {
    if (!node) return undefined
    const row = node.startPosition?.row
    return typeof row === "number" ? row + 1 : undefined
  }

  // ==========================================================================
  // Complexity (ER-D13): per ARM — case/receive/try arms (cr_clause covers all
  // three, catch_clause the catch arms), if arms, a receive_after, and
  // andalso/orelse. A clause HEAD is a match, not an arm. The symbol's total is
  // 1 + arms + one per EXTRA clause, assembled where the clauses are merged.
  // ==========================================================================
  private functionArms(funDecl: Node): number {
    let arms = 0
    const stack: Node[] = [funDecl]
    while (stack.length > 0) {
      const node = stack.pop()!
      switch (node.type) {
        case "cr_clause":
        case "if_clause":
        case "catch_clause":
        case "receive_after":
          arms++
          break
        case "binary_op_expr": {
          const op = node.child(1)?.text
          if (op === "andalso" || op === "orelse") arms++
          break
        }
        default:
          break
      }
      for (let i = node.childCount - 1; i >= 0; i--) {
        const child = node.child(i)
        if (child) stack.push(child)
      }
    }
    return arms
  }

  // ==========================================================================
  // Type references (ER-D10, narrowed by ER3): -type and -opaque emit
  // references from the declared type to every type name it APPLIES.
  //
  // ER3 (2026-09-25, from the M12 differential): a type dependency is an
  // applied name, and only an applied name. In Erlang type syntax
  //   -type day() :: monday | tuesday.        % atom LITERALS, not types
  //   -type job() :: #{id := job_id()}.       % `id` is a field DECLARATION
  //   -type t() :: maps:iterator().           % remote type: mod:type
  //   -type r() :: #state{q :: [job()]}.      % record type + applied args
  // a bare unquoted atom denotes the atom literal of that name (writing
  // `integer` without parens is the ATOM integer, not the type integer()), and
  // a map/record field key is a declaration site. The ER2 authoring counted
  // every bare atom as a reference; on the M12 fixtures that produced two false
  // dependencies (`job -> id`, `job -> kind`, map keys of a `#{}` type that
  // resolved to the record properties of the same name). Applied names are the
  // shape the language gives a type USE: `name(...)` inside a call node, and a
  // record type's own name. Vars are the type's PARAMETERS (never references),
  // quoted atoms are literals, and the declaration's own name is skipped by
  // span.
  // ==========================================================================
  private collectTypeRefs(node: Node, typeNameNode: Node | null, declaredName: string, ctx: ErlangContext): void {
    const pushTypeRef = (name: string, line: number | undefined) => {
      if (!name || name.startsWith("'")) return
      this.pushRel(ctx, declaredName, name, ASTEngine.RelationshipType.References, 1.0, {
        erlangSpecific: true, context: "type reference",
      }, line)
    }
    // `Mod:Type` (a REMOTE type application). Kept whole, like the analyzer's
    // remote call/fun targets (ER-D1: the separator is semantic). Shape (pinned
    // grammar): `remote(remote_module(atom Mod, ':'), atom Type)` — the module
    // atom is wrapped in `remote_module`, exactly as in a remote call.
    const walkRemote = (n: Node): boolean => {
      const modNode = this.getChildByType(n, "remote_module")
      const typeNode = this.getChildByType(n, "atom")
      const modName = modNode ? this.lastAtomText(modNode) : undefined
      if (modName && typeNode?.text) {
        pushTypeRef(`${modName}:${typeNode.text}`, this.lineOf(modNode))
        return true
      }
      return false
    }
    const walk = (n: Node) => {
      if (typeNameNode && n.startIndex >= typeNameNode.startIndex && n.endIndex <= typeNameNode.endIndex) return
      switch (n.type) {
        case "comment":
        case "var":
        case "integer":
        case "float":
        case "string":
        case "char":
        // ER3: a bare atom is an atom LITERAL or a field KEY, never a type use.
        case "atom":
          return
        // A record TYPE (`-type r() :: #state{q :: [job()]}`): the record name
        // is a type use, the field keys are declarations. The field TYPES are
        // walked (they are the record type's own dependencies).
        case "record_expr": {
          const nameNode = this.getChildByType(n, "record_name") || this.getChildByType(n, "atom")
          const recordName = nameNode?.text ? this.stripLeadingHash(this.lastAtomText(nameNode) || nameNode.text) : ""
          pushTypeRef(recordName, this.lineOf(nameNode))
          for (let i = 0; i < n.namedChildCount; i++) {
            const child = n.namedChild(i)
            if (child) walk(child)
          }
          return
        }
        case "remote":
          walkRemote(n)
          return
        case "call": {
          // An applied type: the HEAD names a type, the args are its parameters.
          const head = n.namedChild(0)
          if (head?.type === "atom") {
            pushTypeRef(head.text, this.lineOf(head))
          } else if (head?.type === "remote") {
            walkRemote(head)
          }
          for (let i = 1; i < n.namedChildCount; i++) {
            const child = n.namedChild(i)
            if (child) walk(child)
          }
          return
        }
        default: {
          for (let i = 0; i < n.namedChildCount; i++) {
            const child = n.namedChild(i)
            if (child) walk(child)
          }
        }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) walk(child)
    }
  }

  // ==========================================================================
  // Shape helpers.
  // ==========================================================================

  /** Arity of a call: the expr_args' named children, comments excluded (a
   *  commented argument list is not an argument — probed 2026-09-18). */
  private argCount(exprArgs: Node | undefined): number {
    if (!exprArgs) return 0
    let n = 0
    for (let i = 0; i < exprArgs.namedChildCount; i++) {
      const child = exprArgs.namedChild(i)
      if (child && child.type !== "comment") n++
    }
    return n
  }

  private clauseArity(clause: Node): number {
    return this.argCount(this.getChildByType(clause, "expr_args"))
  }

  /** `-nifs([f/0, g/1])`: the grammar wraps the entries in a list of
   *  binary_op_expr (`name/arity`) inside a paren_expr; the older `fa` shape is
   *  accepted too, so a grammar move does not silently empty the attribute. */
  private nifEntries(node: Node): { name: string; arity?: number; node: Node }[] {
    const out: { name: string; arity?: number; node: Node }[] = []
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "fa") {
        const nameNode = this.getChildByType(n, "atom")
        const arityNode = this.getChildByType(n, "integer") || this.getChildByType(n, "arity")
        if (nameNode?.text) out.push({ name: nameNode.text, arity: arityNode ? parseInt(this.keepDigits(arityNode.text)) || 0 : undefined, node: nameNode })
        continue
      }
      if (n.type === "binary_op_expr" && n.child(1)?.text === "/") {
        const nameNode = n.child(0)
        const arityNode = n.child(2)
        if (nameNode?.type === "atom" && nameNode.text) {
          const digits = arityNode ? this.keepDigits(arityNode.text) : ""
          out.push({ name: nameNode.text, arity: digits ? parseInt(digits) : undefined, node: nameNode })
        }
        continue
      }
      for (let i = n.childCount - 1; i >= 0; i--) {
        const child = n.child(i)
        if (child) stack.push(child)
      }
    }
    return out
  }

  /** Is this node inside a clause HEAD (a pattern) rather than a guard or a
   *  clause BODY? A head is a match, not an evaluation: `worker(#unused{a=1})`
   *  constructs nothing, while a guard's record read is an evaluation (ER-D7). */
  private isInClauseHead(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      const t = cur.type
      if (t === "clause_body" || t === "guard") return false
      if (t === "expr_args") {
        const parent = cur.parent
        if (parent && (parent.type === "function_clause" || parent.type === "fun_clause")) return true
      }
      if (t === "function_clause" || t === "fun_clause") return false
      cur = cur.parent
    }
    return false
  }

  /** Is this node inside type syntax (-spec/-callback/-type/-opaque)? Those are
   *  declarations: `state()` there is a type application, never a call. */
  private isInTypeSyntax(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      if (TYPE_SYNTAX_NODES.has(cur.type)) return true
      if (cur.type === "clause_body" || cur.type === "source_file") return false
      cur = cur.parent
    }
    return false
  }

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

  // `name()` → `name`; `maybe(T)` → `maybe` (strip the parameter list).
  private stripFirstParen(text: string): string {
    const paren = text.indexOf("(")
    return (paren >= 0 ? text.slice(0, paren) : text).trim()
  }

  private stripLeadingHash(text: string): string {
    return text.length > 0 && text[0] === "#" ? text.slice(1) : text
  }

  /** The last atom in a wrapper node (`remote_module` = atom + ':', `module` =
   *  atom + ':', `record_field_name` = '.' + atom). */
  private lastAtomText(node: Node): string | undefined {
    let found: string | undefined
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "atom" && child.text) found = child.text
    }
    return found ?? (node.type === "atom" ? node.text : undefined)
  }

  // ==========================================================================
  // Pre-pass: declared function names+arities (forward-reference resolution).
  // ==========================================================================
  private collectDeclaredFunctions(node: Node, out: Set<string>): void {
    if (node.type === "fun_decl") {
      const clauses = this.collectChildrenByType(node, "function_clause")
      for (const c of clauses) {
        const nameNode = this.getChildByType(c, "atom") || this.getChildByType(c, "var")
        if (nameNode?.text) out.add(`${nameNode.text}/${this.clauseArity(c)}`)
      }
      return
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) this.collectDeclaredFunctions(child, out)
    }
  }

  private getChildByType(node: Node, targetType: string): Node | undefined {
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
