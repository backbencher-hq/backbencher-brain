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
  // Name → declaration symbol for O(1) owner lookups (supervisor/GenServer
  // marking) — modules are processed before their members, so the map is
  // always populated before a member needs it.
  symbolByName: Map<string, ASTEngine.UniversalSymbol>
  // Dedup set for relationship emission: one edge per (source|type|target).
  seenRels: Set<string>
}

interface Scope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
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
// available in every module and add pure noise to the call graph.
const KERNEL_FUNCTIONS = new Set([
  "length", "hd", "tl", "elem", "put_elem", "map_size", "tuple_size",
  "byte_size", "bit_size", "div", "rem", "abs", "round", "trunc", "min", "max",
  "is_atom", "is_binary", "is_bitstring", "is_boolean", "is_float", "is_function",
  "is_integer", "is_list", "is_map", "is_map_key", "is_number", "is_pid", "is_port",
  "is_reference", "is_tuple", "map_get", "to_string", "inspect", "apply", "self",
  "send", "send_after", "spawn", "spawn_link", "spawn_monitor", "make_ref",
  "node", "put_in", "get_in", "update_in", "struct", "struct!", "binary_part",
  "tuple_to_list", "list_to_tuple", "atom_to_binary", "binary_to_atom",
  "term_to_binary", "binary_to_term", "process_flag", "sleep", "yield",
])

export class RealElixirAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const ctx: ElixirContext = {
        symbols: [], relationships: [], imports: [], exports: [], errors: [],
        patterns: {}, frameworks: {}, content,
        aliases: {}, functionHeads: {}, symbolByName: new Map(), seenRels: new Set(),
    }
    const scopeStack: Scope[] = []
    const stack: { node: Node; isExit?: boolean }[] = [{ node: rootNode }]
    let cyclomaticComplexity = 1

    while (stack.length > 0) {
      const { node, isExit } = stack.pop()!

      if (isExit) {
        if (scopeStack.length > 0 && scopeStack[scopeStack.length - 1].node === node) scopeStack.pop()
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
         if (complexityNodes[t]) cyclomaticComplexity++

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
            } else if (t === "defstruct") {
              this.processStruct(node, ctx, currentScope)
            } else if (DIRECTIVES.has(t)) {
              this.processDirective(node, t, ctx, currentScope)
            } else if (t === "case" || t === "cond" || t === "receive" || t === "match") {
              // case/cond/receive are call-shaped in this grammar (call with
              // identifier target + do_block) — pattern constructs, not calls.
              ctx.patterns["Pattern Matching"] = true
              if (t === "receive") ctx.patterns["Actor Model (OTP)"] = true
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
          this.recordInstantiates(aliasChild.text, ctx, currentScope)
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
          const typeNameNode = binOp
            ? this.findChild(binOp, (c) => c?.type === "identifier")
            : argsNode
              ? this.findChild(argsNode, (c) => c?.type === "identifier")
              : undefined
          if (typeNameNode?.text) {
            ctx.symbols.push({ name: typeNameNode.text, kind: ASTEngine.SymbolKind.Type, range: this.nodeToRange(node), ownerName: currentScope?.name, ownerKind: currentScope?.kind, scope: currentScope?.name || "", visibility: "public", metadata: { elixirSpecific: true, isTypeSpec: true } })
          }
        }
        if (attrName === "behaviour" || attrName === "behavior") {
          const argsNode = attrCall?.type === "call" ? this.findChild(attrCall, (c) => c?.type === "arguments") : undefined
          const first = argsNode && argsNode.namedChildCount > 0 ? argsNode.namedChild(0) : undefined
          const bhv = first ? this.stripQuotes(first.text).trim() : ""
          if (bhv) {
            this.pushRel(ctx, currentScope?.name || "Global", bhv, ASTEngine.RelationshipType.Implements, 0.9)
          }
        }
      } else if (node.type === "anonymous_function" || node.type === "stab_clause") {
        // fn x -> x + 1  or  &(&1 + 1) — closures are scoped declarations, not
        // module symbols. M11.11 closure/macro boundaries: mark pattern usage
        // but never emit synthetic lambda symbols into the symbol table.
        ctx.patterns["Closures"] = true
        // Each case/cond/if/with clause is a decision branch (stab_clause
        // directly under a do_block; fn-clause stab_clauses are under
        // anonymous_function and are not counted).
        if (node.type === "stab_clause" && node.parent?.type === "do_block") cyclomaticComplexity++
      } else if (node.type === "rescue_block" || node.type === "catch_block" || node.type === "after_block" || node.type === "else_block") {
        // try/rescue/catch/after/else blocks are decision branches — counted
        // via their emitted *_block node types (try itself is not a call).
        cyclomaticComplexity++
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
          if (op === "and" || op === "or" || op === "&&" || op === "||") cyclomaticComplexity++
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
          continue
        }
      }
      if (r.metadata && typeof r.metadata === "object" && "_declaredScope" in r.metadata) {
        delete (r.metadata as any)._declaredScope
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
          meta = { ...meta, _declaredScope: declaredScope }
      }
      this.pushRel(ctx, currentScope?.name || "Global", finalTarget, ASTEngine.RelationshipType.Calls, 0.8, { elixirSpecific: true, ...meta })
  }

  private recordInstantiates(structName: string, ctx: ElixirContext, currentScope: Scope | undefined) {
      if (!structName) return
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
  // pair so calls in the body are never misclassified as heads.
  private isDefHead(node: Node): boolean {
      let cur = node.parent
      while (cur) {
        if (cur.type === "do_block") return false
        // Single-line def: `defp add_bid(b, o), do: Map.put(...)` — the body
        // sits in the def's arguments as a `do:` keyword pair.
        if (cur.type === "pair") {
          const kw = this.findChild(cur, (c) => c?.type === "keyword")
          if (kw?.text.startsWith("do")) return false
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
  // like `Map.put(...)` carry arguments and are real invocations.
  private isMemberAccess(node: Node): boolean {
      const target = this.findChild(node, (c) => c?.type === "identifier" || c?.type === "dot")
      if (target?.type !== "dot") return false
      return !this.findChild(node, (c) => c?.type === "arguments")
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
    scopeStack.push({ node, name: fullName, kind: ASTEngine.SymbolKind.Module })
    return true
  }

  private processProtocol(node: Node, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    const argsNode = this.findChild(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (!argsNode) return false
    const name = this.extractName(argsNode)
    const fullName = currentScope ? `${currentScope.name}.${name}` : name
    const protocolSym: ASTEngine.UniversalSymbol = { name: fullName, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node), scope: currentScope?.name || "", visibility: "public", metadata: { elixirSpecific: true, isProtocol: true } }
    ctx.symbols.push(protocolSym)
    ctx.symbolByName.set(fullName, protocolSym)
    scopeStack.push({ node, name: fullName, kind: ASTEngine.SymbolKind.Interface })
    return true
  }

  private processImpl(node: Node, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    const argsNode = this.findChild(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (!argsNode) return false
    // Pure AST: aliases[0] is the protocol, aliases[1] (or the `for:` pair
    // value) is the target type. No source-text splitting.
    const aliases = this.filterChildren(argsNode, (c) => c?.type === "alias")
    const protocol = aliases.length > 0 && aliases[0] ? aliases[0].text : "Unknown"
    let forType = "Unknown"
    const keywordsNode = this.findChild(argsNode, (c) => c?.type === "keywords")
    if (keywordsNode) {
      for (let i = 0; i < keywordsNode.namedChildCount; i++) {
        const pair = keywordsNode.namedChild(i)
        if (!pair || pair.type !== "pair") continue
        const kw = this.findChild(pair, (c) => c?.type === "keyword")
        if (kw?.text.startsWith("for") && pair.namedChildCount > 1) {
          const val = pair.namedChild(1)
          if (val) forType = val.text
        }
      }
    }

    // Name the implementation by its target type (OrderBook), not the
    // protocol-qualified form — the Implements edge records the protocol
    // relationship.
    const forTypeAlias = aliases.length > 1 ? aliases[1].text : forType
    const implName = forTypeAlias && forTypeAlias !== "Unknown" ? forTypeAlias : protocol
    const fullName = implName
    const implSym: ASTEngine.UniversalSymbol = { name: fullName, kind: ASTEngine.SymbolKind.Class, range: this.nodeToRange(node), scope: currentScope?.name || "", visibility: "public", metadata: { elixirSpecific: true, isProtocolImplementation: true, protocol, forType } }
    ctx.symbols.push(implSym)
    ctx.symbolByName.set(fullName, implSym)
    this.pushRel(ctx, fullName, protocol, ASTEngine.RelationshipType.Implements, 1.0, {})
    scopeStack.push({ node, name: fullName, kind: ASTEngine.SymbolKind.Class })
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
    ctx.symbols.push({ name: structName, kind: ASTEngine.SymbolKind.Struct, range: this.nodeToRange(node), scope: currentScope.name, ownerName: currentScope.name, ownerKind: currentScope.kind, visibility: "public", metadata: { elixirSpecific: true, isStruct: true } })
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
            const kwNode = this.findChild(pair, (c) => c?.type === "keyword")
            if (!kwNode?.text) continue
            const fieldName = this.stripAfterColon(kwNode.text)
            if (!fieldName) continue
            ctx.symbols.push({ name: fieldName, kind: ASTEngine.SymbolKind.Property, range: this.nodeToRange(pair), ownerName: currentScope.name, ownerKind: currentScope.kind, scope: currentScope.name, visibility: "public", metadata: { elixirSpecific: true, isStructField: true } })
          }
        }
      }
    }
  }

  private processFunction(node: Node, defType: string, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
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

    // Push a function scope for the body so calls/instantiations inside this
    // function attribute to the function (not the module).
    scopeStack.push({ node, name, kind: symbolKind })
    return true
  }

  private processDirective(node: Node, target: string, ctx: ElixirContext, currentScope: Scope | undefined) {
     const argsNode = this.findChild(node, (c) => c?.type !== "identifier")
     if (!argsNode) return
     const moduleName = this.extractName(argsNode)

     if (target === "alias") {
         // alias Foo.Bar          → aliases["Bar"] = "Foo.Bar"
         // alias Foo.Bar, as: Baz → aliases["Baz"] = "Foo.Bar"
         let asName: string | null = null
         const keywordsNode = this.findChild(argsNode, (c) => c?.type === "keywords")
         if (keywordsNode) {
           for (let i = 0; i < keywordsNode.namedChildCount; i++) {
             const pair = keywordsNode.namedChild(i)
             if (!pair || pair.type !== "pair") continue
             const kw = this.findChild(pair, (c) => c?.type === "keyword")
             if (kw?.text.startsWith("as") && pair.namedChildCount > 1) {
               const val = pair.namedChild(1)
               if (val) asName = val.text
             }
           }
         }
         const parts = moduleName.split(".")
         const defaultAs = parts[parts.length - 1]
         const key = asName ?? defaultAs
         if (key) ctx.aliases[key] = moduleName
     } else if (target === "use") {
         if (moduleName.indexOf("Plug") !== -1 && moduleName.indexOf("Plug.") === -1) ctx.frameworks["Plug"] = true
         if (moduleName.indexOf("Phoenix.Controller") !== -1) ctx.frameworks["Phoenix"] = true
         if (moduleName.indexOf("Phoenix.LiveView") !== -1) ctx.frameworks["Phoenix LiveView"] = true
         if (moduleName.indexOf("Ecto.Schema") !== -1) ctx.frameworks["Ecto"] = true
         if (moduleName.indexOf("Phoenix.PubSub") !== -1 || moduleName.indexOf("Phoenix.Channel") !== -1) ctx.frameworks["Phoenix Channels"] = true
         if (moduleName.indexOf("Broadway") !== -1) ctx.frameworks["Broadway"] = true
         if (moduleName.indexOf("GenServer") !== -1) {
             ctx.patterns["Actor Model (OTP)"] = true
             const sym = currentScope ? ctx.symbolByName.get(currentScope.name) : undefined
             if (sym && sym.metadata) { sym.metadata.isGenServer = true; sym.metadata.otpBehavior = "GenServer" }
         }
         if (moduleName.indexOf("Supervisor") !== -1) {
             ctx.patterns["Supervision Trees"] = true
             ctx.patterns["Actor Model (OTP)"] = true
             const sym = currentScope ? ctx.symbolByName.get(currentScope.name) : undefined
             if (sym && sym.metadata) { sym.metadata.isSupervisor = true; sym.metadata.otpBehavior = "Supervisor" }
         }
     } else if (target === "import") {
         if (moduleName.indexOf("Ecto") !== -1) ctx.frameworks["Ecto"] = true
     }

     // use/import/alias/require are module dependencies: one references edge
     // from the containing module to the referenced module (the FP-family
     // module-dep contract, Clojure ns → required libs).
     if (target === "use" || target === "import" || target === "alias" || target === "require") {
         ctx.imports.push({ module: moduleName, source: moduleName, imported: ["*"], isTypeOnly: false, range: this.nodeToRange(node) })
         this.pushRel(ctx, currentScope?.name || "Global", moduleName, ASTEngine.RelationshipType.References, 0.9)
     }
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return { startLine: node.startPosition.row + 1, startColumn: node.startPosition.column + 1, endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1, startIndex: node.startIndex, endIndex: node.endIndex }
  }
}
