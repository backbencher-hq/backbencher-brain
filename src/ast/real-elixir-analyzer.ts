import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

interface ElixirContext {
  symbols: ASTEngine.UniversalSymbol[]
  relationships: ASTEngine.UniversalRelationship[]
  imports: ASTEngine.ImportInfo[]
  exports: ASTEngine.ExportInfo[]
  errors: ASTEngine.ParseError[]
  patterns: Record<string, boolean>
  frameworks: Record<string, boolean>
  content: string
  aliases: Record<string, string>
  functionHeads: Record<string, ASTEngine.UniversalSymbol>
  // Pending @doc string for the next definition (Elixir documentation
  // chunk semantics — set by @doc, consumed by the following def/struct,
  // cleared by scope boundaries and `@doc false`).
  pendingDoc: string | undefined
  // Name → declaration symbol for O(1) owner lookups (supervisor/GenServer
  // marking) — modules are processed before their members, so the map is
  // always populated before a member needs it.
  symbolByName: Map<string, ASTEngine.UniversalSymbol>
  // Ordered import records for :only-based call resolution (ELXD17).
  importList: { module: string; only?: Set<string>; scope: string }[]
  // Dedup set for relationship emission: one edge per (source|type|target).
  seenRels: Set<string>
}

interface Scope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
  // Branches counted while this scope was innermost (ELXD15) — written to
  // the scope's symbol on exit as 1 + count (multi-clause takes the max).
  complexity: number
  symbol?: ASTEngine.UniversalSymbol
}

// Call-target keywords that are decision points in this grammar. Each fires
// only when a `call` node's identifier matches (verified against the pinned
// grammar's emitted shapes). `try`/`rescue`/`catch`/`after`/`else` are NOT
// call targets — they parse as *_block node types and are counted separately
// in the walk (see the rescue_block/catch_block/after_block/else_block and
// stab_clause branches).
const complexityNodes: Record<string, boolean> = {
  "if": true,
  "unless": true,
  "case": true,
  "cond": true,
  "receive": true,
  "with": true,
  "for": true,
  "def": true,
  "defp": true,
  "defmacro": true,
  "defmacrop": true,
}

// Function-definition constructs. The signature call nested in their
// `arguments` is the declaration head — never a runtime call. defdelegate
// defines a public function (optionally renamed via `as:`); defguard/
// defguardp define guard macros.
const DEF_CONSTRUCTS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
// Module directives — handled as dependencies, never as runtime calls.
const DIRECTIVES = new Set(["use", "import", "alias", "require"])
// Elixir language special forms / control-flow constructs. A `call` whose
// target is one of these is syntax, not a function invocation.
const SPECIAL_FORMS = new Set([
  "if", "unless", "case", "cond", "receive", "for", "with",
  "try", "rescue", "catch", "after", "else",
  "quote", "unquote", "super", "raise", "throw", "exit", "fn", "do",
])
// Kernel-module builtins. Following the FP-family precedent (Clojure core
// builtins produce no calls edges), Kernel functions are excluded — they are
// available in every module and add pure noise to the call graph. The set
// covers every call-shaped auto-import (ELXD16 audited the full Kernel
// surface against both corpora: match?/is_nil/tap/then/dbg and friends were
// previously leaking top-level phantoms like `calls Global->match?`).
// Operators (and/or/&&/||/|>/=), unary `not`/`!`, and discussed-in-EX-D2
// special forms never reach this set (they are not call nodes).
const KERNEL_FUNCTIONS = new Set([
  "length", "hd", "tl", "elem", "put_elem", "map_size", "tuple_size",
  "byte_size", "bit_size", "div", "rem", "abs", "round", "trunc", "ceil", "floor", "min", "max",
  "is_atom", "is_binary", "is_bitstring", "is_boolean", "is_float", "is_function",
  "is_integer", "is_list", "is_map", "is_map_key", "is_number", "is_pid", "is_port",
  "is_reference", "is_tuple", "is_nil", "is_struct", "is_exception",
  "map_get", "to_string", "inspect", "apply", "self",
  "send", "send_after", "spawn", "spawn_link", "spawn_monitor", "make_ref",
  "node", "put_in", "get_in", "update_in", "get_and_update_in", "pop_in",
  "struct", "struct!", "binary_part", "binding", "tap", "then", "dbg",
  "tuple_to_list", "list_to_tuple", "atom_to_binary", "binary_to_atom",
  "term_to_binary", "binary_to_term", "process_flag", "sleep", "yield",
  "match?", "function_exported?", "macro_exported?", "reraise",
])

export class RealElixirAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: ElixirContext = {
        symbols: [], relationships: [], imports: [], exports: [], errors: [],
        patterns: {}, frameworks: {}, content,
        aliases: {}, functionHeads: {}, pendingDoc: undefined, importList: [], symbolByName: new Map(), seenRels: new Set(),
    }
    const scopeStack: Scope[] = []
    const stack: { node: Node; isExit?: boolean }[] = [{ node: rootNode }]
    let cyclomaticComplexity = 1

    while (stack.length > 0) {
      const { node, isExit } = stack.pop()!

      if (isExit) {
        if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].node === node) {
          const sc = scopeStack.pop()!
          // ELXD15: per-symbol complexity write-out (max across merged heads).
          if (sc.symbol) sc.symbol.complexity = Math.max(sc.symbol.complexity ?? 1, sc.complexity + 1)
        }
        continue
      }

      if (node.hasError || node.isMissing) {
        if (node.type === "ERROR" || node.type === "MISSING") {
          ctx.errors.push({ message: `Syntax ${node.type} detected.`, range: this.nodeToRange(node), severity: "warning" })
        }
      }

      let pushedScope = false
      const currentScope = scopeStack.length > 0 ? scopeStack[scopeStack.length - 1] : undefined

      if (node.type === "call") {
         const targetNode = this.findChild(node, (c) => c?.type === "identifier" || c?.type === "dot")
         const t = targetNode?.text || ""
         // Quoted code is data, not decisions (ELXD22) — a `quote do if ...`
         // must not inflate the file or the enclosing macro's complexity.
         if (complexityNodes[t] && !this.isInQuotedCode(node)) {
           cyclomaticComplexity++
           if (scopeStack.length > 0) scopeStack[scopeStack.length - 1].complexity++
         }

         if (t) {
            if (this.isInQuotedCode(node)) {
              // M12.23 quote-as-data: everything inside a `quote do ... end`
              // block is macro-generated data, never executable module code.
              // No symbols, no call edges, no directives — Clojure's quoted-
              // data negative-fixture analog for Elixir.
            } else if (t === "defmodule") {
              pushedScope = this.processModule(node, ctx, currentScope, scopeStack)
            } else if (DEF_CONSTRUCTS.has(t)) {
              pushedScope = this.processFunction(node, t, ctx, currentScope, scopeStack)
            } else if (t === "defprotocol") {
              pushedScope = this.processProtocol(node, ctx, currentScope, scopeStack)
            } else if (t === "defimpl") {
              pushedScope = this.processImpl(node, ctx, currentScope, scopeStack)
            } else if (t === "defstruct" || t === "defexception") {
              // defexception defines an exception struct with defstruct-
              // identical field semantics (ELXD10) — same symbol+field path
              // (the isDefHead/isInAttribute/isInQuotedCode guard inside
              // processStruct covers `defmacro defexception` heads too).
              this.processStruct(node, ctx, currentScope)
            } else if (DIRECTIVES.has(t)) {
              this.processDirective(node, t, ctx, currentScope, scopeStack)
            } else if (t === "case" || t === "cond" || t === "receive" || t === "match") {
              // case/cond/receive are call-shaped in this grammar (call with
              // identifier target + do_block) — pattern constructs, not calls.
              ctx.patterns["Pattern Matching"] = true
              if (t === "receive") ctx.patterns["Actor Model (OTP)"] = true
            } else if (t === "struct" || t === "struct!") {
              // struct(User, attrs) / struct!(__MODULE__, attrs) construct
              // the named type (ELXD19) — an instantiates edge, never a call.
              // Dynamic first args stay silent (no static target to name).
              if (!this.isInAttribute(node) && !this.isDefHead(node)) {
                const structArgs = this.findChild(node, (c) => c?.type === "arguments")
                const first = structArgs && structArgs.namedChildCount > 0 ? structArgs.namedChild(0) : undefined
                if (first?.type === "alias") this.recordInstantiates(this.resolveAlias(first.text, ctx), ctx, currentScope)
                else if (first?.type === "identifier" && first.text === "__MODULE__") {
                  let modScope: string | undefined
                  for (let i = scopeStack.length - 1; i >= 0; i--) {
                    const k = scopeStack[i].kind
                    if (k === ASTEngine.SymbolKind.Module || k === ASTEngine.SymbolKind.Interface) { modScope = scopeStack[i].name; break }
                  }
                  if (modScope) this.recordInstantiates(modScope, ctx, currentScope)
                }
              }
            } else {
                if (t === "send" || t === "send_after") {
                  ctx.patterns["Actor Model (OTP)"] = true
                  ctx.patterns["Message Passing"] = true
                } else if (t === "spawn" || t === "spawn_link" || t === "spawn_monitor" || t === "Task.async" || t === "Task.start" || t === "Task.start_link" || t === "Agent.start" || t === "Agent.start_link") {
                  ctx.patterns["Actor Model (OTP)"] = true
                  ctx.patterns["Process Spawning"] = true
                }
                if (!this.shouldSkipCall(node, t)) {
                  let meta: any = {}
                  if (t === "send" || t === "send_after") meta = { isMessagePass: true, isSend: true }
                  else if (t === "spawn" || t === "spawn_link" || t === "spawn_monitor" || t === "Task.async" || t === "Task.start" || t === "Task.start_link" || t === "Agent.start" || t === "Agent.start_link") meta = { isProcessSpawn: true }
                  this.recordCall(t, ctx, currentScope, this.enclosingDeclaredScope(scopeStack), meta)
                }
            }
         }
      } else if (node.type === "map") {
        // Struct literal: %StructName{...} — the construction site. Only an
        // alias-backed struct (not %{} or %__MODULE__{}) is an instantiation,
        // and only in executable position (never a def signature or attribute).
        const structChild = this.findChild(node, (c) => c?.type === "struct")
        const aliasChild = structChild ? this.findChild(structChild, (c) => c?.type === "alias") : undefined
        if (aliasChild?.text && !this.isInQuotedCode(node) && !this.isInDefHeadOrAttribute(node)) {
          this.recordInstantiates(this.resolveAlias(aliasChild.text, ctx), ctx, currentScope)
        } else if (!aliasChild && !this.isInQuotedCode(node) && !this.isInDefHeadOrAttribute(node)) {
          // %__MODULE__{}: self-construction of the lexically enclosing
          // module (ELXD12). The struct head is an identifier, not an alias;
          // resolve to the nearest module/interface scope (a function scope
          // is never the target — __MODULE__ is the module itself).
          const selfChild = structChild ? this.findChild(structChild, (c) => c?.type === "identifier" && c.text === "__MODULE__") : undefined
          if (selfChild) {
            let modScope: string | undefined
            for (let i = scopeStack.length - 1; i >= 0; i--) {
              const k = scopeStack[i].kind
              if (k === ASTEngine.SymbolKind.Module || k === ASTEngine.SymbolKind.Interface) { modScope = scopeStack[i].name; break }
            }
            if (modScope) this.recordInstantiates(modScope, ctx, currentScope)
          }
        }
      } else if (node.type === "unary_operator" && node.child(0)?.text === "@") {
        // Module attribute: @name value. The attribute itself is never a call.
        const attrCall = node.child(1)
        const attrCallId = attrCall?.type === "call" ? this.findChild(attrCall, (c) => c?.type === "identifier") : undefined
        const attrName = attrCallId?.text || (attrCall?.type !== "call" ? attrCall?.text || "" : "")
        if (attrName === "moduledoc" || attrName === "doc") ctx.patterns["Documentation"] = true
        if (attrName === "spec" || attrName === "type" || attrName === "typep" || attrName === "opaque") ctx.patterns["Typespecs"] = true
        if (attrName === "callback" || attrName === "macrocallback") ctx.patterns["Behaviours"] = true
        // @type name :: ... — type aliases are declaration-site symbols (Type
        // kind), mirroring Erlang -type handling. M11.11 universal contract.
        if (attrCallId && (attrCallId.text === "type" || attrCallId.text === "typep" || attrCallId.text === "opaque")) {
          const argsNode = this.findChild(attrCall!, (c) => c?.type === "arguments")
          const binOp = argsNode ? this.findChild(argsNode, (c) => c?.type === "binary_operator") : undefined
          // EX2-U4: the declared name is the LEFT side of `name :: type` —
          // an identifier (`@type t :: …`) or a call head (`@type t(a) :: …`,
          // `@type days() :: …`; parameterized and empty-paren forms both
          // parse the LHS as a `call` whose first identifier is the name).
          // Scanning the whole operator for any identifier picked the RIGHT
          // side when it was an identifier (`@typep pt(b) :: b` fabricated a
          // Type symbol named `b`) and dropped every declaration whose RHS
          // was a composite — 19 missing + 4 fabricated on the pinned elixir
          // corpus (paramcheck).
          let typeNameNode: Node | null = null
          if (binOp) {
            const lhs = binOp.child(0)
            if (lhs?.type === "identifier") typeNameNode = lhs
            else if (lhs?.type === "call") typeNameNode = this.findChild(lhs, (c) => c?.type === "identifier")
          } else if (argsNode) {
            typeNameNode = this.findChild(argsNode, (c) => c?.type === "identifier")
          }
          if (typeNameNode?.text) {
            ctx.symbols.push({ name: typeNameNode.text, kind: ASTEngine.SymbolKind.Type, range: this.nodeToRange(node), ownerName: currentScope?.name, ownerKind: currentScope?.kind, scope: currentScope?.name || "", visibility: "public", metadata: { elixirSpecific: true, isTypeSpec: true } })
          }
        }
        if (attrName === "behaviour" || attrName === "behavior") {
          const argsNode = attrCall?.type === "call" ? this.findChild(attrCall, (c) => c?.type === "arguments") : undefined
          const first = argsNode && argsNode.namedChildCount > 0 ? argsNode.namedChild(0) : undefined
          const bhvRaw = first ? this.stripQuotes(first.text).trim() : ""
          const bhv = bhvRaw ? this.resolveAlias(bhvRaw, ctx) : ""
          if (bhv) {
            this.pushRel(ctx, currentScope?.name || "Global", bhv, ASTEngine.RelationshipType.Implements, 0.9)
          }
        }
        if (attrName === "derive") {
          // @derive JSON.Encoder / @derive {JSON.Encoder, only: [...]}: the
          // enclosing struct derives the protocol (ELXD11). Bare form puts
          // the alias directly under arguments; the options form wraps it
          // in a tuple whose first element is the protocol.
          const argsNode = attrCall?.type === "call" ? this.findChild(attrCall, (c) => c?.type === "arguments") : undefined
          const first = argsNode && argsNode.namedChildCount > 0 ? argsNode.namedChild(0) : undefined
          const protoRaw = first?.type === "alias" ? first.text
            : first?.type === "tuple" ? this.findChild(first, (c) => c?.type === "alias")?.text ?? "" : ""
          const proto = protoRaw ? this.resolveAlias(protoRaw, ctx) : ""
          if (currentScope && proto) {
            this.pushRel(ctx, currentScope.name, proto, ASTEngine.RelationshipType.Implements, 0.9)
          }
        }
        if (attrName === "moduledoc") {
          // @moduledoc documents the enclosing module (ELXD14) — attached
          // directly since the module symbol already exists at this point.
          const argsNode = attrCall?.type === "call" ? this.findChild(attrCall, (c) => c?.type === "arguments") : undefined
          const first = argsNode && argsNode.namedChildCount > 0 ? argsNode.namedChild(0) : undefined
          const text = first ? this.docContent(first) : ""
          if (text && currentScope) {
            const sym = ctx.symbolByName.get(currentScope.name)
            if (sym) sym.comments = [text]
          }
        }
        if (attrName === "doc") {
          // @doc stages the chunk for the next definition; `@doc false`
          // explicitly documents nothing and clears any staged chunk
          // (ELXD14). Consumption happens in processFunction/processStruct;
          // scope boundaries (module/protocol/impl) discard stale chunks.
          const argsNode = attrCall?.type === "call" ? this.findChild(attrCall, (c) => c?.type === "arguments") : undefined
          const first = argsNode && argsNode.namedChildCount > 0 ? argsNode.namedChild(0) : undefined
          // `@doc false` (boolean or identifier leaf) and `@doc nil`
          // explicitly document nothing and clear any staged chunk.
          if (first && (first.text === "false" || first.text === "nil") && (first.type === "identifier" || first.type === "boolean" || first.type === "nil")) ctx.pendingDoc = undefined
          else {
            const text = first ? this.docContent(first) : ""
            if (text) ctx.pendingDoc = text
          }
        }
      } else if (node.type === "anonymous_function" || node.type === "stab_clause") {
        // fn x -> x + 1  or  &(&1 + 1) — closures are scoped declarations, not
        // module symbols. M11.11 closure/macro boundaries: mark pattern usage
        // but never emit synthetic lambda symbols into the symbol table.
        ctx.patterns["Closures"] = true
        // Each case/cond/if/with clause is a decision branch (stab_clause
        // directly under a do_block; fn-clause stab_clauses are under
        // anonymous_function and are not counted). Quoted clauses are data
        // (ELXD22).
        if (node.type === "stab_clause" && node.parent?.type === "do_block" && !this.isInQuotedCode(node)) {
          cyclomaticComplexity++
          if (scopeStack.length > 0) scopeStack[scopeStack.length - 1].complexity++
        }
      } else if ((node.type === "rescue_block" || node.type === "catch_block" || node.type === "after_block" || node.type === "else_block") && !this.isInQuotedCode(node)) {
        // try/rescue/catch/after/else blocks are decision branches — counted
        // via their emitted *_block node types (try itself is not a call).
        // Quoted blocks are data (ELXD22).
        cyclomaticComplexity++
        if (scopeStack.length > 0) scopeStack[scopeStack.length - 1].complexity++
      } else if (node.type === "binary_operator") {
          const op = node.child(1)?.text
          if (op === "|>") {
             ctx.patterns["Pipe Operator"] = true
             const right = node.child(2)
             if (right) {
                 let targetName = ""
                 if (right.type === "call") {
                     const rId = this.findChild(right, (c) => c?.type === "identifier" || c?.type === "dot")
                     if (rId) targetName = rId.text
                 } else if (right.type === "identifier" || right.type === "dot") {
                     targetName = right.text
                 }
                 if (targetName && !this.shouldSkipCall(right, targetName)) {
                   this.recordCall(targetName, ctx, currentScope, this.enclosingDeclaredScope(scopeStack), { isPipe: true })
                 }
             }
          }
          // Quoted boolean operators are data (ELXD22).
          if ((op === "and" || op === "or" || op === "&&" || op === "||") && !this.isInQuotedCode(node)) {
            cyclomaticComplexity++
            if (scopeStack.length > 0) scopeStack[scopeStack.length - 1].complexity++
          }
      } else if (node.type === "dot") {
          const left = node.child(0)?.text
          if (left === "Enum" || left === "Stream") ctx.patterns["Functional Programming"] = true
      }

      if (pushedScope) stack.push({ node, isExit: true })
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child })
      }
    }

    const frameworks: string[] = []
    for (const f in ctx.frameworks) frameworks.push(f)

    const patterns: string[] = []
    for (const p in ctx.patterns) patterns.push(p)

    const frameworkPatterns: { framework: string, patterns: { type: string, detected: boolean, description: string }[] }[] = []
    for (let i = 0; i < frameworks.length; i++) {
        frameworkPatterns.push({
            framework: frameworks[i],
            patterns: [{ type: "usage", detected: true, description: `${frameworks[i]} usage detected` }]
        })
    }

    for (const s of ctx.symbols) {
      const isModLevel = !s.ownerName
      const isPub = s.visibility === "public"
      const isExp = [ASTEngine.SymbolKind.Module, ASTEngine.SymbolKind.Function, ASTEngine.SymbolKind.Interface, ASTEngine.SymbolKind.Struct].includes(s.kind)
      if (isModLevel && isPub && isExp) { ctx.exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility }) }
    }

    // Post-loop: add contains for owned symbols (module → its types, struct,
    // fields, functions, macros; interface/class → their methods).
    for (const s of ctx.symbols) {
      const _owner = s.ownerName || s.scope
      if (_owner) {
        this.pushRel(ctx, _owner, s.name, ASTEngine.RelationshipType.Contains, 1.0)
      }
    }

    // Unqualified-call resolution (post-walk, so every declaration is known —
    // forward references like `run -> run_compiler` where run_compiler is
    // defined later in the file resolve correctly). Elixir resolution: an
    // unqualified call is a local function, a Kernel builtin, or an import —
    // Kernel builtins (length/is_*/function_exported?) and imported functions
    // are NOT local symbols, so they produce no call edge. The enclosing
    // declared scope was captured on each edge at emission time.
    const declaredByScope = new Map<string, Set<string>>()
    for (const s of ctx.symbols) {
      if (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Macro || s.kind === ASTEngine.SymbolKind.Method) {
        const owner = s.ownerName || s.scope || ""
        let set = declaredByScope.get(owner)
        if (!set) {
          set = new Set()
          declaredByScope.set(owner, set)
        }
        set.add(s.name)
      }
    }
    const filteredRels: ASTEngine.UniversalRelationship[] = []
    for (const r of ctx.relationships) {
      if (r.type === ASTEngine.RelationshipType.Calls && typeof r.target === "string" && r.target.indexOf(".") === -1) {
        const declaredScope = (r.metadata as any)?._declaredScope
        if (typeof declaredScope === "string" && declaredScope !== "" && !(declaredByScope.get(declaredScope)?.has(r.target))) {
          // ELXD17: not a local — but possibly an :only-imported function.
          // EX2-U5: the import may be lexically scoped to the calling
          // function (`import Enum, only: …` inside a def body) — it is
          // recorded under that function's scope, so resolution must match
          // the module scope OR the call-site function scope (last import
          // wins across both, mirroring Elixir).
          const callScope = typeof (r.metadata as any)?._callScope === "string" ? (r.metadata as any)._callScope : undefined
          const resolved = this.resolveImport(ctx, declaredScope, r.target, callScope)
          if (resolved) r.target = resolved
          else continue
        }
      }
      if (r.metadata && typeof r.metadata === "object") {
        if ("_declaredScope" in r.metadata) delete (r.metadata as any)._declaredScope
        if ("_callScope" in r.metadata) delete (r.metadata as any)._callScope
      }
      filteredRels.push(r)
    }
    ctx.relationships = filteredRels

    return {
      language: "elixir", symbols: ctx.symbols, relationships: ctx.relationships, imports: ctx.imports, exports: ctx.exports, errors: ctx.errors,
      metadata: {
        complexity: ctx.symbols.length + ctx.relationships.length, linesOfCode: content.split("\n").length, cyclomaticComplexity, framework: frameworks[0], patterns: patterns,
        detectedFrameworks: frameworks, frameworkPatterns,
        architecturalScore: Math.min(100, Math.max(0, 100 - ctx.errors.length * 5)), codeQuality: ctx.errors.length === 0 ? "Excellent" : "Fair", hasTypeInference: false, hasFrameworkIntelligence: true, analysisVersion: "10.0.0-elixir-dfs-strict"
      }
    }
  }

  // ELXD17: resolve an unqualified call through :only-constrained imports
  // (last import wins, mirroring Elixir's conflict rule). Bare imports and
  // :except lists cannot confirm a target per-file, so they never resolve —
  // those calls stay dropped rather than fabricated.
  // EX2-U5: the import's lexical scope must equal the declared scope that
  // governs the call site (module-level import) OR the call site's own
  // function (an import written inside a def body).
  private resolveImport(ctx: ElixirContext, scope: string, name: string, callScope?: string): string | undefined {
      for (let i = ctx.importList.length - 1; i >= 0; i--) {
        const imp = ctx.importList[i]
        if (imp.scope !== scope && imp.scope !== callScope) continue
        if (imp.only && imp.only.has(name)) return `${imp.module}.${name}`
      }
      return undefined
  }

  // EX2-U1: resolve the ROOT segment of a dotted name through the module's
  // alias table (`alias MyApp.OrderBook` → OrderBook → MyApp.OrderBook).
  // recordCall already did this; every other site that NAMES a type/module —
  // struct literals, struct()/1, @behaviour, @derive, defimpl (protocol and
  // target), and use/import/require module names — did not, so their edges
  // pointed at strings that match nothing in the symbol table. Pure
  // alias-table lookup on AST text — no scanning, no regexes.
  private resolveAlias(name: string, ctx: ElixirContext): string {
      if (!name) return name
      const parts = name.split(".")
      const root = parts[0]
      if (root && ctx.aliases[root]) {
          parts[0] = ctx.aliases[root]!
          return parts.join(".")
      }
      return name
  }

  // The top non-function scope on the stack — the module/class whose declared
  // set governs unqualified-call resolution for the current call site.
  private enclosingDeclaredScope(scopeStack: Scope[]): string | undefined {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const k = scopeStack[i].kind
      if (k !== ASTEngine.SymbolKind.Function && k !== ASTEngine.SymbolKind.Macro && k !== ASTEngine.SymbolKind.Method) {
        return scopeStack[i].name
      }
    }
    return undefined
  }

  // ==========================================================================
  // Relationship emission helpers (dedupe by source|type|target identity).
  // ==========================================================================
  private pushRel(ctx: ElixirContext, source: string, target: string, type: ASTEngine.RelationshipType, confidence: number, metadata: Record<string, any> = {}) {
    const key = `${source}|${type}|${target}`
    if (ctx.seenRels.has(key)) return
    ctx.seenRels.add(key)
    ctx.relationships.push({ source, target, type, confidence, metadata })
  }

  private recordCall(targetName: string, ctx: ElixirContext, currentScope: Scope | undefined, declaredScope: string | undefined, meta: any = {}) {
      let finalTarget = targetName
      const parts = targetName.split(".")
      if (parts.length > 1) {
          const root = parts[0]
          if (ctx.aliases[root]) {
              parts[0] = ctx.aliases[root]!
              finalTarget = parts.join(".")
          }
      }
      if (!finalTarget) return
      if (finalTarget.indexOf(".") !== -1) {
          // Qualified call: a capitalized root is a module/alias (real call);
          // a lowercase root is a variable receiver — dynamic dispatch with an
          // unresolvable target (module.manifests() where `module` is a
          // parameter), which emits no edge.
          const root = finalTarget.split(".")[0]
          if (root && root.length > 0 && root[0] !== root[0].toUpperCase()) return
      } else if (declaredScope) {
          // Unqualified call: the declared set is not complete mid-walk
          // (forward references), so the resolution check runs post-walk.
          // Capture the enclosing declared scope on the edge for that pass.
          // EX2-U5: also capture the enclosing FUNCTION scope (kind-decided —
          // the module scope's name is the module itself) — an import written
          // inside a def is lexically scoped to that function and resolution
          // must be able to see it.
          const callScope = currentScope && (currentScope.kind === ASTEngine.SymbolKind.Function || currentScope.kind === ASTEngine.SymbolKind.Macro || currentScope.kind === ASTEngine.SymbolKind.Method) ? currentScope.name : undefined
          meta = { ...meta, _declaredScope: declaredScope, _callScope: callScope }
      }
      this.pushRel(ctx, currentScope?.name || "Global", finalTarget, ASTEngine.RelationshipType.Calls, 0.8, { elixirSpecific: true, ...meta })
  }

  private recordInstantiates(structName: string, ctx: ElixirContext, currentScope: Scope | undefined) {
      if (!structName) return
      // Self-construction (X instantiates X) is vacuous as a dependency
      // edge — %__MODULE__{} in X's own body (e.g. test blocks, which push
      // no function scope) would forge it (ELXD13). Structural self-loops
      // are never legitimate; the oracle holds the same guard.
      if (structName === currentScope?.name) return
      this.pushRel(ctx, currentScope?.name || "Global", structName, ASTEngine.RelationshipType.Instantiates, 0.9, { elixirSpecific: true, isStruct: true })
  }

  // ==========================================================================
  // Call-skip predicates (the noise-elimination contract).
  // ==========================================================================

  // Everything inside a `quote do ... end` block is data (macro AST), not
  // executable code — the Clojure quoted-data rule for Elixir.
  private isInQuotedCode(node: Node): boolean {
      let cur = node.parent
      while (cur) {
        if (cur.type === "call") {
          const id = this.findChild(cur, (c) => c?.type === "identifier")
          if (id?.text === "quote") return true
        }
        cur = cur.parent
      }
      return false
  }

  // Inside a module attribute (@foo ...) — the attribute's inner call is the
  // attribute declaration, never a runtime invocation.
  private isInAttribute(node: Node): boolean {
      let cur = node.parent
      while (cur) {
        if (cur.type === "unary_operator") {
          const op = cur.child(0)
          if (op?.text === "@") return true
        }
        cur = cur.parent
      }
      return false
  }

  // The signature call (and its pattern-position arguments) nested in a
  // def/defp/defmacro/defmacrop `arguments` is the declaration head, not a call
  // site. Stops at both the do_block boundary AND the single-line `, do: body`
  // pair so calls in the body are never misclassified as heads. The pair
  // check matches exactly `do:` — keyword pairs like `domain:` in signature
  // patterns must not end the head walk (deep-review hygiene).
  private isDefHead(node: Node): boolean {
      const startIndex = node.startIndex
      let cur = node.parent
      while (cur) {
        if (cur.type === "do_block") return false
        // Single-line def: `defp add_bid(b, o), do: Map.put(...)` — the body
        // sits in the def's arguments as a `do:` keyword pair. The pair
        // check matches exactly `do:` — keyword pairs like `domain:` in
        // signature patterns must not end the head walk (deep-review hygiene).
        if (cur.type === "pair") {
          const kw = this.findChild(cur, (c) => c?.type === "keyword")
          const kwt = kw?.text ?? ""
          if (kwt === "do" || kwt.startsWith("do:")) return false
        }
        // EX2-U6: a default-value expression (`x \\ g()`) EXECUTES at call
        // time — it lives in the signature subtree but is not part of the
        // declaration head. The head walk stops at the right-hand side of a
        // `\\` operator so the call inside it is never swallowed (node shape
        // dumped first: binary_operator [lhs, "\\", rhs]).
        if (cur.type === "binary_operator" && cur.childCount > 2 && cur.child(1)?.text === "\\\\") {
          const rhs = cur.child(2)
          if (rhs && startIndex >= rhs.startIndex) return false
        }
        if (cur.type === "call") {
          const id = this.findChild(cur, (c) => c?.type === "identifier")
          if (id && DEF_CONSTRUCTS.has(id.text)) return true
        }
        cur = cur.parent
      }
      return false
  }

  // Struct literal in a def signature or attribute (pattern position) is not
  // a construction site.
  private isInDefHeadOrAttribute(node: Node): boolean {
      return this.isInAttribute(node) || this.isDefHead(node)
  }

  // Member/property access: `order.side` is a call whose target is a `dot`
  // node with no arguments — a field read, not an invocation. Module calls
  // like `Map.put(...)` carry arguments and are real invocations. A bare
  // remote reference (`Enum.map`, `&Mod.fun/2`, `:lists.member`) also has no
  // arguments but names a real remote function — only a lowercase root is a
  // variable receiver or field read; anything else emits (ELXD18).
  private isMemberAccess(node: Node): boolean {
      const target = this.findChild(node, (c) => c?.type === "identifier" || c?.type === "dot")
      if (target?.type !== "dot") return false
      if (this.findChild(node, (c) => c?.type === "arguments")) return false
      const root = target.text.split(".")[0] ?? ""
      return root.length > 0 && root[0] >= "a" && root[0] <= "z"
  }

  private shouldSkipCall(node: Node, t: string): boolean {
      if (SPECIAL_FORMS.has(t)) return true
      if (KERNEL_FUNCTIONS.has(t)) return true
      if (this.isInQuotedCode(node)) return true
      if (this.isInAttribute(node)) return true
      if (this.isDefHead(node)) return true
      if (this.isMemberAccess(node)) return true
      return false
  }

  // ==========================================================================
  // Pure-string helpers (no regexes).
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

  private stripParens(text: string): string {
      let out = ""
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === "(" || ch === ")") continue
        out += ch
      }
      return out.trim()
  }

  private stripAfterColon(text: string): string {
      const colon = text.indexOf(":")
      return (colon >= 0 ? text.slice(0, colon) : text).trim()
  }

  // Documentation-chunk text of a string node: the grammar already excludes
  // delimiters (heredoc fences included) from quoted_content leaves, so
  // concatenating them is exact — no quote stripping that would eat
  // interior apostrophes (ELXD14).
  private docContent(node: Node): string {
      // EX2-U7: sigil docs (`@doc ~S"""…"""`, `@doc ~s(…)`) are the same
      // documentation chunk as a plain string — the extractor accepts every
      // literal form the grammar gives for docs (node shapes dumped first:
      // `sigil` carries the text in `quoted_content`, exactly like `string`).
      if (node.type !== "string" && node.type !== "sigil") return ""
      let out = ""
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && (c.type === "quoted_content" || c.type === "interpolation")) out += c.text
      }
      return out
  }

  // ==========================================================================
  // Node helpers.
  // ==========================================================================
  private findChild(node: Node, predicate: (child: Node) => boolean): Node | null {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && predicate(child)) return child;
      }
      return null;
    }

    private filterChildren(node: Node, predicate: (child: Node) => boolean): Node[] {
      const res: Node[] = [];
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && predicate(child)) res.push(child);
      }
      return res;
    }

  private extractName(node: Node): string {
      let aliasNode = this.findChild(node, (c) => c?.type === "alias")
      if (aliasNode) return aliasNode.text
      if (node.namedChildCount > 0) {
          const first = node.namedChild(0)
          if (first?.type === "alias" || first?.type === "identifier") return first.text
          if (first?.type === "dot") return first.text
      }
      return this.stripParens(node.text)
  }

  // ==========================================================================
  // Declaration processors.
  // ==========================================================================
  private processModule(node: Node, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    // Declaration heads nest (defmacro def, def defguard) — the inner head
    // is a signature, never a new definition (ELXD23). Uniform guard on all
    // declaration processors (struct/impl already carry it).
    if (this.isDefHead(node) || this.isInAttribute(node) || this.isInQuotedCode(node)) return false
    const argsNode = this.findChild(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (!argsNode) return false
    const name = this.extractName(argsNode)
    const fullName = currentScope ? `${currentScope.name}.${name}` : name
    const symbol: ASTEngine.UniversalSymbol = {
        name: fullName, kind: ASTEngine.SymbolKind.Module, range: this.nodeToRange(node), scope: currentScope?.name || "", visibility: "public",
        metadata: { elixirSpecific: true }
    }
    ctx.symbols.push(symbol)
    ctx.symbolByName.set(fullName, symbol)
    // A new scope is a documentation boundary (ELXD14) — a staged @doc
    // never leaks past it.
    ctx.pendingDoc = undefined
    scopeStack.push({ node, name: fullName, kind: ASTEngine.SymbolKind.Module, complexity: 0, symbol })
    return true
  }

  private processProtocol(node: Node, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    if (this.isDefHead(node) || this.isInAttribute(node) || this.isInQuotedCode(node)) return false
    const argsNode = this.findChild(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (!argsNode) return false
    const name = this.extractName(argsNode)
    const fullName = currentScope ? `${currentScope.name}.${name}` : name
    const protocolSym: ASTEngine.UniversalSymbol = { name: fullName, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node), scope: currentScope?.name || "", visibility: "public", metadata: { elixirSpecific: true, isProtocol: true } }
    ctx.symbols.push(protocolSym)
    ctx.symbolByName.set(fullName, protocolSym)
    ctx.pendingDoc = undefined
    scopeStack.push({ node, name: fullName, kind: ASTEngine.SymbolKind.Interface, complexity: 0, symbol: protocolSym })
    return true
  }

  private processImpl(node: Node, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    // A defimpl-shaped call in a declaration head (defmacro defimpl(name,
    // opts)) is the macro head, not a protocol implementation — the same
    // class as ELXD4 (defstruct heads). Without this the defimpl MACRO
    // itself fabricates impl:Unknown, pollutes the scope stack, and drops
    // the macro body's real call edges (ELXD7, kernel.ex:5745).
    if (this.isDefHead(node) || this.isInAttribute(node) || this.isInQuotedCode(node)) return false
    const argsNode = this.findChild(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (!argsNode) return false
    // Pure AST: aliases[0] is the protocol, aliases[1] (or the `for:` pair
    // value) is the target type. No source-text splitting.
    const aliases = this.filterChildren(argsNode, (c) => c?.type === "alias")
    const protocol = aliases.length > 0 && aliases[0] ? this.resolveAlias(aliases[0].text, ctx) : "Unknown"
    let forType = "Unknown"
    const keywordsNode = this.findChild(argsNode, (c) => c?.type === "keywords")
    if (keywordsNode) {
      for (let i = 0; i < keywordsNode.namedChildCount; i++) {
        const pair = keywordsNode.namedChild(i)
        if (!pair || pair.type !== "pair") continue
        const kw = this.findChild(pair, (c) => c?.type === "keyword")
        if (kw && this.stripAfterColon(kw.text) === "for" && pair.namedChildCount > 1) {
          const val = pair.namedChild(1)
          if (val) forType = this.resolveAlias(val.text, ctx)
        }
      }
    }

    // Name the implementation by its target type (OrderBook), not the
    // protocol-qualified form — the Implements edge records the protocol
    // relationship. Single-argument form (`defimpl String.Chars do` nested
    // in a module) implements the protocol FOR THE ENCLOSING MODULE —
    // without this the implementation takes the protocol's own name, forging
    // a self-loop edge and mis-owning its methods (ELXD6, date.ex:1167).
    const forTypeAlias = aliases.length > 1 ? this.resolveAlias(aliases[1].text, ctx) : forType
    const implName = forTypeAlias && forTypeAlias !== "Unknown" ? forTypeAlias : (currentScope ? currentScope.name : protocol)
    const fullName = implName
    const implSym: ASTEngine.UniversalSymbol = { name: fullName, kind: ASTEngine.SymbolKind.Class, range: this.nodeToRange(node), scope: currentScope?.name || "", visibility: "public", metadata: { elixirSpecific: true, isProtocolImplementation: true, protocol, forType } }
    ctx.symbols.push(implSym)
    ctx.symbolByName.set(fullName, implSym)
    // A degenerate for-less defimpl names nothing real — never a self-loop.
    if (fullName !== protocol) this.pushRel(ctx, fullName, protocol, ASTEngine.RelationshipType.Implements, 1.0, {})
    ctx.pendingDoc = undefined
    scopeStack.push({ node, name: fullName, kind: ASTEngine.SymbolKind.Class, complexity: 0, symbol: implSym })
    return true
  }

  private processStruct(node: Node, ctx: ElixirContext, currentScope: Scope | undefined) {
    // A defstruct-shaped call in a declaration head (defmacro defstruct(fields))
    // is the macro head, not a struct declaration — same class as def heads
    // (isDefHead) and attributes. Without this the defstruct IMPLEMENTATION
    // itself fabricates struct:defstruct (ELXD4, kernel.ex:5624).
    if (this.isDefHead(node) || this.isInAttribute(node) || this.isInQuotedCode(node)) return
    if (!currentScope) return
    const structName = currentScope.name
    const structSym: ASTEngine.UniversalSymbol = { name: structName, kind: ASTEngine.SymbolKind.Struct, range: this.nodeToRange(node), scope: currentScope.name, ownerName: currentScope.name, ownerKind: currentScope.kind, visibility: "public", metadata: { elixirSpecific: true, isStruct: true } }
    ctx.symbols.push(structSym)
    // ELXD14: @doc before defstruct documents the struct itself.
    if (ctx.pendingDoc) { structSym.comments = [ctx.pendingDoc]; ctx.pendingDoc = undefined }
    // Struct fields (defstruct bids: [], asks: []) → property symbols owned by
    // the enclosing module. M11.11: defstruct keyword pairs are the universal
    // property-equivalent of struct fields in C/Rust/Zig.
    const argsNode = this.findChild(node, (c) => c?.type === "arguments")
    if (argsNode) {
      for (let i = 0; i < argsNode.namedChildCount; i++) {
        const child = argsNode.namedChild(i)
        if (!child) continue
        // defstruct may use the bare keyword form or a list form:
        //   defstruct bids: [], asks: []
        //   defstruct [id: nil, email: ""]
        const kwGroups: Node[] =
          child.type === "keywords" ? [child] :
          child.type === "list" ? this.filterChildren(child, (c) => c?.type === "keywords") : []
        if (child.type === "list") {
          for (let j = 0; j < child.namedChildCount; j++) {
            const el = child.namedChild(j)
            if (!el || el.type !== "atom") continue
            const fieldName = el.text.startsWith(":") ? el.text.slice(1) : el.text
            if (!fieldName) continue
            ctx.symbols.push({ name: fieldName, kind: ASTEngine.SymbolKind.Property, range: this.nodeToRange(el), ownerName: currentScope.name, ownerKind: currentScope.kind, scope: currentScope.name, visibility: "public", metadata: { elixirSpecific: true, isStructField: true } })
          }
        }
        for (const kwGroup of kwGroups) {
          for (let j = 0; j < kwGroup.namedChildCount; j++) {
            const pair = kwGroup.namedChild(j)
            if (!pair || pair.type !== "pair") continue
            const kwNode = this.findChild(pair, (c) => c?.type === "keyword" || c?.type === "quoted_keyword")
            if (!kwNode?.text) continue
            // Quoted keys (`defstruct ["a": 1]`) carry the name in a
            // quoted_keyword node — strip the quotes after the colon (ELXD5).
            const fieldName = this.stripQuotes(this.stripAfterColon(kwNode.text))
            if (!fieldName) continue
            ctx.symbols.push({ name: fieldName, kind: ASTEngine.SymbolKind.Property, range: this.nodeToRange(pair), ownerName: currentScope.name, ownerKind: currentScope.kind, scope: currentScope.name, visibility: "public", metadata: { elixirSpecific: true, isStructField: true } })
          }
        }
      }
    }
  }

  private processFunction(node: Node, defType: string, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    // A def-shaped call nested in another declaration head is the inner
    // signature (`defmacro def(sig)`, `def defguard(...)`) — never a new
    // definition (ELXD23). Without this the inner head fabricates phantoms
    // (macro "args", function "Unknown"/"sig").
    if (this.isDefHead(node) || this.isInAttribute(node) || this.isInQuotedCode(node)) return false
    const sigNodes = this.filterChildren(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (sigNodes.length === 0) return false

    let actualCall: Node | undefined
    let guardList: string[] = []
    let name = "Unknown"
    let hasPattern = false
    const parameters: ASTEngine.Parameter[] = []

    let sigNode = sigNodes[0]
    if (sigNode && sigNode.type === "arguments" && sigNode.namedChildCount > 0) {
        const first = sigNode.namedChild(0)
        if (first) sigNode = first
    }

    if (sigNode) {
       if (sigNode.type === "binary_operator" && sigNode.childCount > 1 && sigNode.child(1)?.text === "when") {
          const guardExpr = sigNode.childCount > 2 ? sigNode.child(2) : null
          if (guardExpr) guardList.push(guardExpr.text)
          actualCall = sigNode.childCount > 0 ? sigNode.child(0) || undefined : undefined
          ctx.patterns["Pattern Matching"] = true
          hasPattern = true
       } else {
          actualCall = sigNode
       }
    }

    if (actualCall) {
        if (actualCall.type === "call") {
            const innerId = this.findChild(actualCall, (c) => c?.type === "identifier")
            if (innerId) name = innerId.text
            const innerArgs = this.findChild(actualCall, (c) => c?.type === "arguments")
            if (innerArgs) {
               for (let i=0; i < innerArgs.namedChildCount; i++) {
                   const argChild = innerArgs.namedChild(i)
                   if (!argChild) continue
                   // Parameter name: the bare identifier when the argument is
                   // an identifier or a `name = default` binary_operator.
                   let paramName = argChild.text
                   if (argChild.type === "identifier") paramName = argChild.text
                   else if (argChild.type === "binary_operator" && argChild.childCount > 0 && argChild.child(0)?.type === "identifier") paramName = argChild.child(0)!.text
                   parameters.push({ name: paramName, type: "dynamic" })
                   if (argChild.text.indexOf(":") !== -1 || argChild.text.indexOf("%") !== -1 || argChild.text.indexOf("_") !== -1 || argChild.text.startsWith("[")) {
                       hasPattern = true
                       ctx.patterns["Pattern Matching"] = true
                   }
               }
            }
        } else if (actualCall.type === "identifier") {
            name = actualCall.text
        } else if (actualCall.type === "binary_operator") {
            name = actualCall.childCount > 1 ? actualCall.child(1)?.text || "Unknown" : "Unknown"
            parameters.push({ name: actualCall.childCount > 0 ? actualCall.child(0)?.text || "left" : "left", type: "dynamic" })
            parameters.push({ name: actualCall.childCount > 2 ? actualCall.child(2)?.text || "right" : "right", type: "dynamic" })
        } else if (actualCall.type === "unary_operator") {
            // Unary operator definition (`def +value`) — the name is the
            // operator token, the operand the single parameter (ELXD24).
            for (let i = 0; i < actualCall.childCount; i++) {
              const c = actualCall.child(i)
              if (c && !c.isNamed) { name = c.text; break }
            }
            const operand = this.findChild(actualCall, (c) => c?.type === "identifier")
            parameters.push({ name: operand?.text || "operand", type: "dynamic" })
        }
    }

    const visibility = (defType === "defp" || defType === "defmacrop" || defType === "defguardp") ? "private" : "public"
    let isGenCallback = false, isSupCallback = false

    if (name === "init" || name === "handle_call" || name === "handle_cast" || name === "handle_info" || name === "terminate") isGenCallback = true

    let isSupervisor = false
    if (currentScope) {
        const ownerSym = ctx.symbolByName.get(currentScope.name)
        if (ownerSym?.metadata?.isSupervisor) isSupervisor = true
    }

    if (name === "init" && isSupervisor) isSupCallback = true

    const arity = parameters.length
    const fnId = `${currentScope?.name || ""}.${name}/${arity}`

    // Universal-kind mapping: defmacro/defmacrop/defguard/defguardp → Macro;
    // interface (defprotocol) and class (defimpl) members → Method; module
    // functions (def/defp/defdelegate) stay Function.
    let symbolKind = ASTEngine.SymbolKind.Function
    if (defType === "defmacro" || defType === "defmacrop" || defType === "defguard" || defType === "defguardp") {
      symbolKind = ASTEngine.SymbolKind.Macro
    } else if (currentScope && (currentScope.kind === ASTEngine.SymbolKind.Interface || currentScope.kind === ASTEngine.SymbolKind.Class)) {
      symbolKind = ASTEngine.SymbolKind.Method
    }

    if (ctx.functionHeads[fnId]) {
        const existing = ctx.functionHeads[fnId]!
        existing.metadata!.heads = (existing.metadata!.heads as number) + 1
        if (hasPattern) existing.metadata!.hasPatternMatching = true
        if (guardList.length > 0) {
            let existingGuards = existing.metadata!.guards as string[] || []
            for (let i = 0; i < guardList.length; i++) {
                existingGuards.push(guardList[i])
            }
            existing.metadata!.guards = existingGuards
        }
    } else {
        const symbol: ASTEngine.UniversalSymbol = {
            name, kind: symbolKind, range: this.nodeToRange(node), scope: currentScope?.name || "", ownerName: currentScope?.name, ownerKind: currentScope?.kind, visibility, parameters,
            metadata: { elixirSpecific: true, isMacro: defType.indexOf("macro") !== -1, arity, heads: 1, hasPatternMatching: hasPattern, guards: guardList, isGenServerCallback: isGenCallback, isSupervisorCallback: isSupCallback }
        }
        ctx.symbols.push(symbol)
        ctx.functionHeads[fnId] = symbol
    }
    // ELXD14: a staged @doc chunk attaches to the definition (first head
    // wins on multi-clause merge); the chunk is consumed either way so a
    // stale doc can never leak onto a later definition.
    const fnSym = ctx.functionHeads[fnId]!
    if (ctx.pendingDoc) {
        if (!fnSym.comments) fnSym.comments = [ctx.pendingDoc]
        ctx.pendingDoc = undefined
    }

    // Push a function scope for the body so calls/instantiations inside this
    // function attribute to the function (not the module). EX2-U2: the scope
    // NAME is module-qualified (`MyMod.run`) — bare function names collided
    // across modules, so two different `run/0` functions produced
    // indistinguishable edge sources and the source|type|target dedupe
    // silently deleted one module's call edge (3487 bare-sourced calls on the
    // phoenix corpus). The SYMBOL keeps its bare name + ownerName; only the
    // scope identity and the edges sourced from it are qualified.
    const scopeName = currentScope ? `${currentScope.name}.${name}` : name
    scopeStack.push({ node, name: scopeName, kind: symbolKind, complexity: 0, symbol: fnSym })
    return true
  }

  private processDirective(node: Node, target: string, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]) {
     const argsNode = this.findChild(node, (c) => c?.type !== "identifier")
     if (!argsNode) return
     const rawModuleName = this.extractName(argsNode)
     // __MODULE__ means the lexically enclosing MODULE — never a function
     // scope (`alias` inside a def body still refers to the module).
     let modScope: string | undefined
     for (let i = scopeStack.length - 1; i >= 0; i--) {
       const k = scopeStack[i].kind
       if (k === ASTEngine.SymbolKind.Module || k === ASTEngine.SymbolKind.Interface) { modScope = scopeStack[i].name; break }
     }
     // __MODULE__-prefixed aliases (`alias __MODULE__.Endpoint`,
     // `alias __MODULE__.{A, B}`) resolve against the enclosing module
     // (ELXD21) — the literal prefix names no real module. With no
     // enclosing module (degenerate top-level) the literal stands.
     const resolveSelf = (name: string): string => {
       if (!name.startsWith("__MODULE__") || !modScope) return name
       return modScope + name.slice("__MODULE__".length)
     }
     const moduleName = this.resolveAlias(resolveSelf(rawModuleName), ctx)

      // Dependency targets: exactly one module, except multi-alias
      // (`alias Foo.{Bar, Baz}`) which expands to one dependency per member
      // (ELXD20) — the bare prefix alone is not a module and emits nothing.
      let depModules: string[] = [moduleName]
      if (target === "alias") {
          // alias Foo.Bar          → aliases["Bar"] = "Foo.Bar"
          // alias Foo.Bar, as: Baz → aliases["Baz"] = "Foo.Bar"
          const multiDot = this.findChild(argsNode, (c) => c?.type === "dot" && !!this.findChild(c, (d) => d?.type === "tuple"))
          const tuple = multiDot ? this.findChild(multiDot, (c) => c?.type === "tuple") : undefined
          if (tuple) {
            depModules = []
            const rawPrefix = this.findChild(multiDot!, (c) => c?.type === "alias")?.text
              ?? this.findChild(multiDot!, (c) => c?.type === "identifier" && c.text === "__MODULE__")?.text ?? ""
            const prefix = this.resolveAlias(resolveSelf(rawPrefix), ctx)
            for (const kid of this.filterChildren(tuple, (c) => c?.type === "alias" || c?.type === "dot")) {
              const full = prefix ? `${prefix}.${kid.text}` : kid.text
              const key = kid.text.split(".").pop()
              if (key && full) {
                ctx.aliases[key] = full
                depModules.push(full)
              }
            }
          } else {
            let asName: string | null = null
            const keywordsNode = this.findChild(argsNode, (c) => c?.type === "keywords")
            if (keywordsNode) {
              for (let i = 0; i < keywordsNode.namedChildCount; i++) {
                const pair = keywordsNode.namedChild(i)
                if (!pair || pair.type !== "pair") continue
                const kw = this.findChild(pair, (c) => c?.type === "keyword")
                if (kw && this.stripAfterColon(kw.text) === "as" && pair.namedChildCount > 1) {
                  const val = pair.namedChild(1)
                  if (val) asName = val.text
                }
              }
            }
            const parts = moduleName.split(".")
            const defaultAs = parts[parts.length - 1]
            const key = asName ?? defaultAs
            if (key) ctx.aliases[key] = moduleName
          }
      } else if (target === "use") {
          // Framework detection is root-segment based (ELXD9): the hex
          // package owns its top-level namespace, so `use Plug.Router`
          // marks Plug and any `Phoenix.*` use marks Phoenix. The old
          // substring contract both missed real usage (`Plug.*` was
          // excluded — 21 silent sites across both corpora) and risked
          // false positives (`MyApp.Plugs` contains "Plug").
          const fwRoot = moduleName.split(".")[0]
          if (fwRoot === "Plug") ctx.frameworks["Plug"] = true
          if (fwRoot === "Phoenix") ctx.frameworks["Phoenix"] = true
          if (moduleName === "Phoenix.LiveView" || moduleName.startsWith("Phoenix.LiveView.")) ctx.frameworks["Phoenix LiveView"] = true
          if (fwRoot === "Ecto") ctx.frameworks["Ecto"] = true
          if (moduleName.indexOf("Phoenix.PubSub") !== -1 || moduleName.indexOf("Phoenix.Channel") !== -1) ctx.frameworks["Phoenix Channels"] = true
          if (fwRoot === "Broadway") ctx.frameworks["Broadway"] = true
         // EX2-U3: root-segment equality — the same contract ELXD9 applied to
         // Plug/Phoenix/Ecto two sections up. `use MyApp.GenServerPool` /
         // `use MyApp.SupervisorTree` are not GenServer or Supervisor;
         // substring matching fabricated OTP patterns AND isGenServer /
         // isSupervisor metadata (which then mislabels init/1 as a supervisor
         // callback in processFunction). Corpus: dynamic_supervisor_test.exs
         // falsely reported "Supervision Trees w/o use Supervisor".
         if (moduleName.split(".")[0] === "GenServer") {
             ctx.patterns["Actor Model (OTP)"] = true
             const sym = currentScope ? ctx.symbolByName.get(currentScope.name) : undefined
             if (sym && sym.metadata) { sym.metadata.isGenServer = true; sym.metadata.otpBehavior = "GenServer" }
         }
         if (moduleName.split(".")[0] === "Supervisor") {
             ctx.patterns["Supervision Trees"] = true
             ctx.patterns["Actor Model (OTP)"] = true
             const sym = currentScope ? ctx.symbolByName.get(currentScope.name) : undefined
             if (sym && sym.metadata) { sym.metadata.isSupervisor = true; sym.metadata.otpBehavior = "Supervisor" }
         }
      } else if (target === "import") {
          // ELXD9: same root-segment contract as `use` — `import Plug.Conn`
          // is real Plug usage (12 sites in the phoenix corpus).
          const fwRoot = moduleName.split(".")[0]
          if (fwRoot === "Plug") ctx.frameworks["Plug"] = true
          if (fwRoot === "Phoenix") ctx.frameworks["Phoenix"] = true
          if (fwRoot === "Ecto") ctx.frameworks["Ecto"] = true
          // ELXD17: record :only-constrained imports for call resolution.
          // `import Enum, only: [map: 2]` names its functions locally; bare
          // imports and :except lists (or atom values like `only:
          // :functions`) cannot confirm a target, so only stays undefined.
          if (moduleName) {
            let only: Set<string> | undefined
            const kwNode = this.findChild(argsNode, (c) => c?.type === "keywords")
            if (kwNode) {
              for (let i = 0; i < kwNode.namedChildCount; i++) {
                const pair = kwNode.namedChild(i)
                if (!pair || pair.type !== "pair") continue
                const kw = this.findChild(pair, (c) => c?.type === "keyword")
                if (!kw || this.stripAfterColon(kw.text) !== "only" || pair.namedChildCount < 2) continue
                const val = pair.namedChild(1)
                if (val?.type !== "list") continue
                const names = new Set<string>()
                for (const kwGroup of this.filterChildren(val, (c) => c?.type === "keywords")) {
                  for (let j = 0; j < kwGroup.namedChildCount; j++) {
                    const fp = kwGroup.namedChild(j)
                    if (!fp || fp.type !== "pair") continue
                    const fk = this.findChild(fp, (c) => c?.type === "keyword")
                    if (fk?.text) names.add(this.stripAfterColon(fk.text))
                  }
                }
                if (names.size > 0) only = names
              }
            }
            ctx.importList.push({ module: moduleName, only, scope: currentScope?.name ?? "" })
          }
      }

      // use/import/alias/require are module dependencies: one references edge
      // from the containing module to the referenced module (the FP-family
      // module-dep contract, Clojure ns → required libs). A self-directive
      // (`alias IEx.History` inside `defmodule IEx.History`) is a lexical
      // no-op as a dependency — never a self-loop edge (ELXD8). The alias
      // registration above still stands (call resolution needs it).
      if (target === "use" || target === "import" || target === "alias" || target === "require") {
          for (const dep of depModules) {
            if (!dep) continue
            ctx.imports.push({ module: dep, source: dep, imported: ["*"], isTypeOnly: false, range: this.nodeToRange(node) })
            if (dep !== currentScope?.name) this.pushRel(ctx, currentScope?.name || "Global", dep, ASTEngine.RelationshipType.References, 0.9)
          }
      }
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return { startLine: node.startPosition.row + 1, startColumn: node.startPosition.column + 1, endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1, startIndex: node.startIndex, endIndex: node.endIndex }
  }
}
