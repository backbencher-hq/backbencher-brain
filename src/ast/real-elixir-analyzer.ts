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
  // EX-A14: `@callback name(args) :: type` is a DECLARATION of a function, and
  // its relationship to a sibling `def` is order-independent (a protocol may
  // write either first). Keyed `owner/name/arity` -> spec text, read when the
  // symbol is created and read again when a callback attribute is walked, so
  // whichever comes second completes the other.
  callbackSpecs: Record<string, string>
  // EX-A14: `@optional_callbacks a: 0, b: 0` — same ordering problem, so the
  // names are parked here and stamped onto the method symbols on creation.
  optionalCallbacks: Record<string, string[]>
  // Dedup set for relationship emission: one edge per (source|type|target).
  seenRels: Set<string>
  // ELIXIR_FIX2-O1 — `defoverridable` bookkeeping, keyed by the enclosing module
  // name. Elixir's override construct is `defoverridable`: it marks a function
  // (or every function of a named module) as an override point. Two shapes:
  //   defoverridable child_spec: 1        -> names one function/arity
  //   defoverridable EEx.Engine           -> names EVERY function of that module
  // Recorded here rather than in the symbol table because it is not a
  // declaration of anything. Measured on the corpus (601 files): 26 defoverridable
  // sites in 14 files.
  overridableNames: Map<string, Set<string>>
  overridableModules: Map<string, Set<string>>
  // `use <module>` per enclosing module — the other half of ELIXIR_FIX2-O1.
  // Measured: 510 use sites in 325 files.
  moduleUses: Map<string, Set<string>>
  // EX-EX3 × ELIXIR_FIX2-U1 — STAGED member reads, resolved after the walk.
  //
  // Two pins constrain this rule from opposite sides and both are the lane's
  // spec, so the rule has to satisfy both (the reconciliation is written out at
  // the resolution step below): `ontology-uses` (EX-EX3) requires a member read
  // to be published ONLY when its leaf names a struct field the FILE declares,
  // and `member-read-uses` (ELIXIR_FIX2-U1) requires the reads of a file that
  // declares no struct field at all to be published as contextual uses. The
  // gate needs the file's whole declared-field vocabulary, and a read can
  // precede the `defstruct` that declares its field (or live in a module
  // processed before it), so the site is STAGED here and resolved post-walk.
  usesCandidates: { source: string; field: string; receiver: string; line: number }[]
  // EX-EX12 — variables bound to a MAP in a definition (`%{} = m`,
  // `%{a: a} = m`), keyed by the same scope identity the edges are sourced
  // from (`Module.fun/arity`). A read through one of these is a MAP KEY read,
  // never a struct-field read, so it is dropped from the `uses` surface even
  // when the leaf happens to be a declared struct field elsewhere in the file.
  mapBoundByScope: Map<string, Set<string>>
  // Countable reasons, reported in `metadata` (§4's third clause): how many
  // staged reads were verified, how many were published as contextual, and how
  // many were dropped because the receiver was provably a map.
  usesVerified: number
  usesContextual: number
  mapKeyReceiverDropped: number
}

// ELIXIR_FIX2-X1 — the symbol kinds an Elixir module PUBLISHES. This is the
// language's own distinction, and it is the one Elixir's `exports` edge means:
// `def`/`defmacro`/`defguard`/`defdelegate`/`@type`/`@opaque`/`@callback`/
// `defstruct`/a nested `defmodule` are reachable from outside the file, while
// `defp`/`defmacrop`/`defguardp`/`@typep` are not callable by name from another
// module. Measured on the corpus: 5,303 public def/defdelegate/defguard sites in
// 404 files and 343 public defmacro in 77, against 7,918 PRIVATE
// defp/defmacrop/defguardp in 347 files and 41 `@typep` in 12. The private
// figures are the falsifier: an `exports` edge that fired on `defp` would
// publish 7,918 names no importer can bind.
// `Property` (a struct field) is deliberately NOT here: the importable unit of
// a struct is the struct, its fields are read through it, and membership
// already rides `contains` (the exports-family ruling in
// script/m14/run-fixtures.ts: "type-owned bare members are not importable;
// membership rides Contains").
const EXPORTED_KINDS = new Set<string>([
  ASTEngine.SymbolKind.Module,
  ASTEngine.SymbolKind.Interface,
  ASTEngine.SymbolKind.Class,
  ASTEngine.SymbolKind.Struct,
  ASTEngine.SymbolKind.Function,
  ASTEngine.SymbolKind.Method,
  ASTEngine.SymbolKind.Macro,
  ASTEngine.SymbolKind.Type,
])

// ELIXIR_FIX2-C1 — the evidence class each label claims when the emitting site
// does not name one. Chosen per label, not globally:
//   syntactic_declaration — the edge is read straight off a declaration node
//     (`contains` is ownership read off ownerName; `exports` off the visibility
//     of a definition; `implements` at 1.0 off `defimpl`'s protocol name).
//   structural_inference — the edge follows from a language rule rather than
//     from one node (`instantiates` from `%Mod{}`, `references` from a
//     directive).
//   usage_contextual — the edge names something CONSUMED, and the consuming
//     context is what makes it an edge at all (`calls`, `uses`).
const DEFAULT_EVIDENCE_CLASS: Record<string, string> = {
  calls: "usage_contextual",
  uses: "usage_contextual",
  contains: "syntactic_declaration",
  exports: "syntactic_declaration",
  implements: "structural_inference",
  instantiates: "structural_inference",
  references: "structural_inference",
  extends: "structural_inference",
  overrides: "structural_inference",
  imports: "structural_inference",
}

interface Scope {
  node: Node
  name: string
  kind: ASTEngine.SymbolKind
  // ELIXIR_FIX2-P6 — a module whose NAME could not be derived from an `alias`
  // (`defmodule name do`, `defmodule Module.concat(A, B) do`). The scope exists
  // so the walk keeps the right nesting, but nothing inside it may be attributed
  // to the ENCLOSING module: `name` is deliberately kept as the enclosing name
  // so every existing derivation (symbol identity, scope identity, alias frames)
  // is untouched, and `unnamedModule` is what the symbol and edge passes read.
  unnamedModule?: boolean
  // Branches counted while this scope was innermost (ELXD15) — written to
  // the scope's symbol on exit as 1 + count (multi-clause takes the max).
  complexity: number
  symbol?: ASTEngine.UniversalSymbol
  // W23-E1: the alias map of the ENCLOSING frame at entry — restored on
  // scope exit, so alias registrations are lexical (child frames are
  // Object.create(parent) chains; writes land in the innermost map, reads
  // walk the chain). Explicit `alias` directives never leak to siblings;
  // a nested module's implied alias dies with its enclosing frame.
  savedAliases?: Record<string, string>
}

// Call-target keywords that are decision points in this grammar. Each fires
// only when a `call` node's identifier matches (verified against the pinned
// grammar's emitted shapes). `try`/`rescue`/`catch`/`after`/`else` are NOT
// call targets — they parse as *_block node types and are counted separately
// in the walk (see the rescue_block/catch_block/after_block/else_block and
// stab_clause branches).
// Object.create(null) (adversarial X11): a plain `{}` here answered
// `["toString"]`/`["valueOf"]`/`["constructor"]` from Object.prototype — a
// function named `toString` inflated cyclomatic complexity on every call
// (measured A/B, Clojure F5-2 class).
const complexityNodes: Record<string, boolean> = (function(){ const r: Record<string, boolean> = Object.create(null); const arr = ["if", "unless", "case", "cond", "receive", "with", "for", "def", "defp", "defmacro", "defmacrop"]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();

// Function-definition constructs. The signature call nested in their
// `arguments` is the declaration head — never a runtime call. defdelegate
// defines a public function (optionally renamed via `as:`); defguard/
// defguardp define guard macros.
const DEF_CONSTRUCTS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])
// Module directives — handled as dependencies, never as runtime calls.
const DIRECTIVES = new Set(["use", "import", "alias", "require"])

// EX-A17: the attributes whose VALUE is a declaration, not a call site. A
// docstring is text, a typespec's `%Duration{}` is a TYPE reference, and
// @behaviour/@derive/@deprecated are compile-time contracts. Every other
// attribute value is CODE (see isInDeclarationAttributeValue).
const DECLARATION_ATTRIBUTES = new Set([
  "moduledoc", "doc", "spec", "type", "typep", "opaque", "callback", "macrocallback",
  "optional_callbacks", "behaviour", "behavior", "derive", "deprecated",
])
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
        // W23-E1: alias frames are prototype CHAINS (Object.create(parent));
        // the null-prototype root makes chain lookups pollution-safe.
        aliases: Object.create(null), functionHeads: {}, pendingDoc: undefined, importList: [], callbackSpecs: {}, optionalCallbacks: {},
        symbolByName: new Map(), seenRels: new Set(),
        overridableNames: new Map(), overridableModules: new Map(), moduleUses: new Map(),
        usesCandidates: [], mapBoundByScope: new Map(), usesVerified: 0, usesContextual: 0, mapKeyReceiverDropped: 0,
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
          // W23-E1: leave the frame's alias scope — restore the ENCLOSING
          // map BEFORE the implied registration below, so the automatic
          // last-segment alias goes live in the enclosing scope only.
          if (sc.savedAliases) ctx.aliases = sc.savedAliases
          // EX-L5 (CLJ1-session correction; F5 falsifier: the elixir lane's
          // MISSING edge `Registry.Supervisor -> Supervisor`): the automatic
          // last-segment alias (`defmodule A.B` means `B` names A.B) goes
          // live in the ENCLOSING scope when the definition CLOSES — never
          // inside the module's own body. Kernel.defmodule docs: the alias
          // allows access "in the same lexical scope where it's defined (the
          // Foo module)"; stdlib proof: `Task.Supervisor` and
          // `Registry.Supervisor` bodies do `use Supervisor` and MUST
          // resolve the external Supervisor (self-resolution would be
          // circular; the stdlib compiles). Entry-time registration
          // resolved the body's own references to the module itself, and the
          // ELXD8 self-directive guard then silently dropped `use
          // Supervisor` — the F5 differential caught it as the lane's only
          // MISSING edge.
          if ((sc.kind === ASTEngine.SymbolKind.Module || sc.kind === ASTEngine.SymbolKind.Interface) && sc.name) {
            const implied = sc.name.split(".").pop()
            if (implied && !ctx.aliases[implied]) ctx.aliases[implied] = sc.name
          }
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
            } else if (t === "defoverridable") {
              // ELIXIR_FIX2-O1: the language's override-point marker. Recorded,
              // not declared — it creates no symbol. Two shapes, both measured
              // on the corpus (26 sites / 14 files):
              //   defoverridable child_spec: 1, code_change: 3   -> named funcs
              //   defoverridable EEx.Engine                       -> a whole module
              // A quoted block is excluded: `defoverridable` inside a
              // __using__ TEMPLATE describes the module that USES the template,
              // which is not this module and is not in this file.
              this.recordOverridable(node, ctx, currentScope)
            } else if (t === "case" || t === "cond" || t === "receive" || t === "match") {
              // case/cond/receive are call-shaped in this grammar (call with
              // identifier target + do_block) — pattern constructs, not calls.
              ctx.patterns["Pattern Matching"] = true
              if (t === "receive") ctx.patterns["Actor Model (OTP)"] = true
            } else if (t === "struct" || t === "struct!" || t === "raise" || t === "reraise") {
              // struct(User, attrs) / struct!(__MODULE__, attrs) construct
              // the named type (ELXD19) — an instantiates edge, never a call.
              // EX-A9: `raise Mod` / `raise Mod, "msg"` / `reraise Mod, stack`
              // is the SAME construction through the exception entry point —
              // Kernel.raise/2 calls `Mod.exception([])`, which builds `%Mod{}`
              // — so it emits the same instantiates edge and never a call
              // (raise/reraise stay in SPECIAL_FORMS, so the call half of this
              // branch is still skipped for them). Measured 401 alias-named
              // `raise` sites in 200 files of elixir@024beb1b carrying no
              // dependency edge at all: an exception struct that a module
              // raises is exactly as much a dependency as one it writes
              // literally, and the defexception struct symbol already existed.
              // Dynamic first args stay silent (no static target to name):
              // `raise "boom"`, `raise err` (a bound exception), `raise` with a
              // computed module are all unnameable, not dropped names.
              if (!this.isInDeclarationAttributeValue(node) && !this.isDefHead(node)) {
                const structArgs = this.findChild(node, (c) => c?.type === "arguments")
                const first = structArgs && structArgs.namedChildCount > 0 ? structArgs.namedChild(0) : undefined
                if (first?.type === "alias") this.recordInstantiates(this.resolveAlias(first.text, ctx), ctx, currentScope, first.startPosition.row + 1)
                else if (first?.type === "identifier" && first.text === "__MODULE__") {
                  let modScope: string | undefined
                  for (let i = scopeStack.length - 1; i >= 0; i--) {
                    const k = scopeStack[i].kind
                    if (k === ASTEngine.SymbolKind.Module || k === ASTEngine.SymbolKind.Interface) { modScope = scopeStack[i].name; break }
                  }
                  if (modScope) this.recordInstantiates(modScope, ctx, currentScope, first.startPosition.row + 1)
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
                // ELIXIR_FIX2-U1: a MEMBER FIELD READ is `uses`, not silence.
                  //
                  // Measured tree shape (tree-sitter-elixir 0.3.5): `user.name`
                  // parses as a `call` whose target is a `dot` and which has NO
                  // `arguments` child — the same node shape as a zero-arity
                  // remote call. `isMemberAccess` (ELXD18) separates the two by
                  // the receiver's first character: lowercase = a variable, so
                  // this is a field read; uppercase = a module, so it is a real
                  // remote reference and the `calls` edge below owns it. Before
                  // this branch the field read produced NOTHING at all.
                  //
                  // Why `uses` and not `references`: the family contract for
                  // `uses` is a member/selector READ that is not an invocation.
                  // Go publishes selector field access at 0.7 and states the
                  // skip rule verbatim — "Selectors that are the callee of a
                  // call_expression are skipped (the calls edge handles them)";
                  // Erlang publishes a record member read; Clojure publishes
                  // `.-field` and never `calls`. Elixir's field read is that
                  // same thing, and Elixir already has no other home for it:
                  // the struct field is a `Property` reachable only through
                  // `contains`, which is ownership, not use.
                  //
                  // Measured: 2,244 sites in 182 of 601 corpus files. Excluded,
                  // with reasons: a quoted block (data, not code), a def
                  // signature head, a DECLARATION attribute's value, and a
                  // `->` pattern position (a pattern is not an evaluation —
                  // ER-D7's rule, "a head pattern emits nothing").
                  const memberLeaf = this.memberReadLeaf(node)
                  if (memberLeaf && !this.isDefHead(node) && !this.isInDeclarationAttributeValue(node) && !this.isPatternPosition(node)) {
                    // EX-EX3: STAGED, not published here — the gate is the FILE's
                    // declared struct fields and a struct may be declared later in
                    // the file than the read, so the verdict is not available yet.
                    // The two gates that need the walk to be over (the declared-
                    // field gate and the map-bound-receiver gate) are applied at
                    // the resolution step in `analyze`. The line is the dot node's
                    // own line, so a chain's intermediate and leaf reads both
                    // report the line their text sits on.
                    ctx.usesCandidates.push({
                      source: currentScope?.name || "Global", field: memberLeaf.leaf, receiver: memberLeaf.receiver,
                      line: targetNode ? targetNode.startPosition.row + 1 : node.startPosition.row + 1,
                    })
                  } else if (!this.shouldSkipCall(node, t) && !this.isPipeStep(node) && !this.isCaptureHead(node)) {
                  // EX-A13: the marker is only reachable for the QUALIFIED spawn
                  // forms. `send`/`send_after`/`spawn`/`spawn_link`/`spawn_monitor`
                  // are Kernel auto-imports, so the EX-D2 exclusion drops them a
                  // few lines below and the `isMessagePass`/`isSend` flags this
                  // branch used to build for them could NEVER reach an edge — a
                  // dead store that read as a live payload. Measured, not assumed:
                  // a probe file with `send(pid, :hi)` emits zero relationships
                  // while `Task.async/1` and `Agent.start_link/1` (qualified, not
                  // Kernel) emit `isProcessSpawn`. Message passing survives as the
                  // file-level `Message Passing` pattern, which IS pinned
                  // (fixture otp-messaging).
                  let meta: any = {}
                  if (t === "Task.async" || t === "Task.start" || t === "Task.start_link" || t === "Agent.start" || t === "Agent.start_link") meta = { isProcessSpawn: true }
                  // M59: the callee name-bearing node's line + the call's arity.
                  const callArgs = this.findChild(node, (c) => c?.type === "arguments")
                  this.recordCall(t, ctx, currentScope, this.enclosingDeclaredScope(scopeStack), meta, targetNode ? targetNode.startPosition.row + 1 : node.startPosition.row + 1, callArgs ? callArgs.namedChildCount : 0)
                }
            }
         }
      } else if (node.type === "map") {
        // Struct literal: %StructName{...} — the construction site. Only an
        // alias-backed struct (not %{} or %__MODULE__{}) is an instantiation,
        // and only in executable position (never a def signature or attribute).
        const structChild = this.findChild(node, (c) => c?.type === "struct")
        const aliasChild = structChild ? this.findChild(structChild, (c) => c?.type === "alias") : undefined
        if (aliasChild?.text && !this.isInQuotedCode(node) && !this.isDefHead(node) && !this.isInDeclarationAttributeValue(node) && !this.isPatternPosition(node)) {
          this.recordInstantiates(this.resolveAlias(aliasChild.text, ctx), ctx, currentScope, aliasChild.startPosition.row + 1)
        } else if (!aliasChild && !this.isInQuotedCode(node) && !this.isDefHead(node) && !this.isInDeclarationAttributeValue(node) && !this.isPatternPosition(node)) {
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
            if (modScope) this.recordInstantiates(modScope, ctx, currentScope, selfChild.startPosition.row + 1)
          }
        }
      } else if (node.type === "unary_operator" && node.child(0)?.text === "@" && !this.isInQuotedCode(node)) {
        // Module attribute: @name value. The attribute itself is never a call.
        const attrCall = node.child(1)
        const attrCallId = attrCall?.type === "call" ? this.findChild(attrCall, (c) => c?.type === "identifier") : undefined
        const attrName = attrCallId?.text || (attrCall?.type !== "call" ? attrCall?.text || "" : "")
        if (attrName === "moduledoc" || attrName === "doc") ctx.patterns["Documentation"] = true
        if (attrName === "spec" || attrName === "type" || attrName === "typep" || attrName === "opaque") ctx.patterns["Typespecs"] = true
        if (attrName === "callback" || attrName === "macrocallback" || attrName === "optional_callbacks") {
          ctx.patterns["Behaviours"] = true
          // EX-A14: a typed callback is a DECLARATION of a function — the same
          // kind of published fact as @type (which already emits a Type symbol),
          // and it was emitting NOTHING but a pattern flag: 165 sites in a
          // 100-file sample of elixir+phoenix+ash, 98 in a 171-file
          // ecto_sql+ecto+wallaby sample, 0 covered by a symbol. A module may
          // declare a callback with no `def` at all (a behaviour surface), in
          // which case the callback existed nowhere in the index.
          if (attrCallId && (attrCallId.text === "callback" || attrCallId.text === "macrocallback")) {
            const argsNode = this.findChild(attrCall!, (c) => c?.type === "arguments")
            // Find the `::` operator EXPLICITLY, not the first binary_operator: a
            // typespec may carry a `when` constraint
            // (`@callback get_and_update(d, k, f) :: {…} when c: v`), and taking
            // the first binary operator whichever it is picked the `when` side —
            // so a constrained callback published no symbol at all (found by the
            // declaration census on elixir's own access.ex:187).
            // The `when` constraint WRAPS the `::` expression
            // (`@callback pop(d, k) :: {…} when d: container` parses as one
            // binary_operator whose operator is `when` and whose LEFT side is the
            // `::`), so the search descends: depth-bounded, and only through
            // binary operators, which is where a typespec's shape lives.
            const findTypeOp = (n: Node | null, depth = 0): Node | null => {
                if (!n || depth > 4) return null
                if (n.type === "binary_operator" && n.child(1)?.text === "::") return n
                for (let i = 0; i < n.childCount; i++) {
                    const c = n.child(i)
                    if (c && c.type === "binary_operator") { const hit = findTypeOp(c, depth + 1); if (hit) return hit }
                }
                return null
            }
            const binOp = findTypeOp(argsNode)
            // `@callback fetch(t, key) :: …` — the declared name is the `::`
            // LEFT side, identifier or call head (the EX2-U4 rule, reused).
            // A spec written without a `::` (a bare `@callback load(t)`) is not
            // a typespec declaration; it stays silent rather than guessing.
            let lhs: Node | null = null
            if (binOp) {
              const left = binOp.child(0)
              if (left?.type === "identifier") lhs = left
              else if (left?.type === "call") lhs = this.findChild(left, (c) => c?.type === "identifier")
            }
            if (lhs?.text) {
              let arity = 0
              if (binOp) {
                const left = binOp.child(0)
                if (left?.type === "call") {
                  for (let i = 0; i < left.childCount; i++) { const c = left.child(i); if (c && c.type === "arguments") arity = c.namedChildCount }
                }
              }
              // the owner is the nearest module/interface scope: a callback
              // declared inside a def belongs to the module, not the function
              let ownerName = ""
              let ownerKind: ASTEngine.SymbolKind | undefined
              for (let i = scopeStack.length - 1; i >= 0; i--) {
                const k = scopeStack[i].kind
                if (k === ASTEngine.SymbolKind.Module || k === ASTEngine.SymbolKind.Interface) { ownerName = scopeStack[i].name; ownerKind = k; break }
              }
              const specText = this.nodeToRange(binOp ?? node) && (binOp ? binOp.text : node.text)
              const key = `${ownerName}/${lhs.text}/${arity}`
              ctx.callbackSpecs[key] = specText
              const existing = ctx.symbols.find((sym) => sym.name === lhs!.text && (sym.ownerName ?? sym.scope ?? "") === ownerName && sym.metadata?.arity === arity)
              if (existing) {
                // the sibling `def size(x)`: complete the ONE method with its
                // typed spec rather than minting a second symbol for it.
                // Declaration-ness is NOT decided here — a bodiless protocol
                // head is a declaration and a `def … do … end` implementation is
                // not, and only the DEF knows which it is (processFunction
                // applies its own verdict, clearing the flag when a body exists).
                existing.metadata = { ...existing.metadata, callbackSpec: specText, isCallbackDeclaration: true, ...(attrCallId.text === "macrocallback" ? { isMacroCallback: true } : {}) }
                if (existing.isDeclaration) existing.metadata.isDeclaration = true
                // EX-D16 parity: the typed spec is part of the declaration
                // surface, so the symbol's extent grows to cover it — the same
                // "first..last of everything this symbol is" rule the clause
                // merge applies. `clauseRanges` is NOT touched: a callback is a
                // declaration, not a clause.
                this.extendRange(existing, this.nodeToRange(node))
              } else {
                const isMethod = ownerKind === ASTEngine.SymbolKind.Interface || ownerKind === ASTEngine.SymbolKind.Class
                const cbSym: ASTEngine.UniversalSymbol = {
                  name: lhs.text,
                  kind: isMethod ? ASTEngine.SymbolKind.Method : ASTEngine.SymbolKind.Function,
                  range: this.nodeToRange(node),
                  scope: ownerName,
                  ownerName: ownerName || undefined,
                  ownerKind,
                  visibility: "public",
                  isDeclaration: true,
                  metadata: {
                    elixirSpecific: true, isCallback: true, isBodylessDeclaration: true, isDeclaration: true, arity, heads: 0, clauseRanges: [],
                    ...(attrCallId.text === "macrocallback" ? { isMacroCallback: true } : {}),
                    callbackSpec: specText, hasCallbackSpec: true,
                  },
                }
                ctx.symbols.push(cbSym)
                // Share the function merge key (`owner.name/arity`, the same
                // spelling processFunction builds), so a `def` of the same
                // callback later in the module COMPLETES this symbol instead of
                // minting a second one for the same function. Without it, a
                // module with `@callback load(t)` + `def load(x)` published two
                // `load` symbols — a duplicate the index's
                // `${fileId}:${name}:${startLine}` ids could not even keep apart.
                if (ownerName) ctx.functionHeads[`${ownerName}.${lhs.text}/${arity}`] = cbSym
              }
            }
          } else if (attrCallId && attrCallId.text === "optional_callbacks") {
            // `@optional_callbacks after_begin: 0, before_commit: 0` names the
            // callbacks an implementation MAY omit. It declares nothing new, so
            // it annotates: the names ride the owning protocol/module's
            // metadata and stamp the matching members.
            const argsNode = this.findChild(attrCall!, (c) => c?.type === "arguments")
            const names: string[] = []
            // Two shapes carry the names: the bare keyword form
            // (`@optional_callbacks after_begin: 0`) and a LIST of keywords
            // (`@optional_callbacks [path: 1, filename: 1]` — ash uses this one,
            // and the first version of this branch read only the bare form, so
            // the list form annotated nothing).
            const keywordGroups: Node[] = []
            if (argsNode) {
              for (const c of this.filterChildren(argsNode, (x) => x?.type === "keywords" || x?.type === "list")) {
                if (c.type === "keywords") { keywordGroups.push(c); continue }
                for (const inner of this.filterChildren(c, (x) => x?.type === "keywords" || x?.type === "pair")) keywordGroups.push(inner)
              }
            }
            for (const grp of keywordGroups) {
              for (let j = 0; j < grp.namedChildCount; j++) {
                const pair = grp.namedChild(j)
                if (!pair || pair.type !== "pair") continue
                const kw = this.findChild(pair, (c) => c?.type === "keyword" || c?.type === "quoted_keyword")
                if (kw?.text) names.push(this.stripAfterColon(this.stripQuotes(kw.text)))
              }
            }
            let ownerName = ""
            for (let i = scopeStack.length - 1; i >= 0; i--) {
              const k = scopeStack[i].kind
              if (k === ASTEngine.SymbolKind.Module || k === ASTEngine.SymbolKind.Interface) { ownerName = scopeStack[i].name; break }
            }
            if (names.length > 0 && ownerName) {
              ctx.optionalCallbacks[ownerName] = [...(ctx.optionalCallbacks[ownerName] ?? []), ...names]
              const ownerSym = ctx.symbolByName.get(ownerName)
              if (ownerSym) ownerSym.metadata = { ...ownerSym.metadata, optionalCallbacks: [...(ownerSym.metadata?.optionalCallbacks ?? []), ...names] }
            }
          }
        }
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
            // ELIXIR_FIX2-V1: `@typep` is Elixir's PRIVATE type alias — it is
            // not part of the module's published surface, exactly as `defp` is
            // not callable by name from another module. The analyzer published
            // every type alias as `public`, so the flag could not carry the one
            // distinction Elixir makes here. Measured 41 `@typep` sites in 12
            // corpus files, all of which this had marked public.
            const isPrivateAlias = attrCallId.text === "typep"
            ctx.symbols.push({ name: typeNameNode.text, kind: ASTEngine.SymbolKind.Type, range: this.nodeToRange(node), ownerName: currentScope?.unnamedModule ? undefined : currentScope?.name, ownerKind: currentScope?.unnamedModule ? undefined : currentScope?.kind, scope: currentScope?.unnamedModule ? "" : (currentScope?.name || ""), visibility: isPrivateAlias ? "private" : "public", metadata: { elixirSpecific: true, isTypeSpec: true, ...(isPrivateAlias ? { isPrivateTypeAlias: true } : {}), ...(currentScope?.unnamedModule ? { elixirOwnerUnknown: "un-nameable enclosing defmodule/defprotocol" } : {}) } })
          }
        }
        if (attrName === "behaviour" || attrName === "behavior") {
          const argsNode = attrCall?.type === "call" ? this.findChild(attrCall, (c) => c?.type === "arguments") : undefined
          const first = argsNode && argsNode.namedChildCount > 0 ? argsNode.namedChild(0) : undefined
          let bhvRaw = first ? this.stripQuotes(first.text).trim() : ""
          // W23 (review finding, fixture behaviour-atom): the ATOM form
          // (`@behaviour :gen_server`) kept its leading colon in the target —
          // the colon is syntax, not part of the behaviour's identity, and
          // the alias form never carried it.
          if (bhvRaw.startsWith(":")) bhvRaw = bhvRaw.slice(1)
          const bhv = bhvRaw ? this.resolveAlias(bhvRaw, ctx) : ""
          if (bhv) {
            this.pushRel(ctx, currentScope?.name || "Global", bhv, ASTEngine.RelationshipType.Implements, 0.9, { reasonCode: "elixir_behaviour_attribute" }, first ? first.startPosition.row + 1 : node.startPosition.row + 1)
          }
        }
        if (attrName === "derive") {
          // @derive JSON.Encoder / @derive {JSON.Encoder, only: [...]} /
          // @derive [A, B] / @derive [{C, :ok}]: the enclosing struct derives
          // every named protocol (EX-L4). CORRECTION (adversarial X10): the
          // original note claimed "8 real corpus sites incl. protocol.ex:422"
          // — that block is @moduledoc heredoc TEXT, not code, and the real
          // list-form incidence on both corpora is 0; the branch is
          // synthetic-pinned only, which is why the oracle mirror went
          // unnoticed (3 UNEXPLAINED the moment a list form exists).
          const argsNode = attrCall?.type === "call" ? this.findChild(attrCall, (c) => c?.type === "arguments") : undefined
          const first = argsNode && argsNode.namedChildCount > 0 ? argsNode.namedChild(0) : undefined
          const protoNodes: Node[] = []
          if (first?.type === "alias") protoNodes.push(first)
          else if (first?.type === "tuple") {
            const a = this.findChild(first, (c) => c?.type === "alias")
            if (a) protoNodes.push(a)
          } else if (first?.type === "list") {
            for (let i = 0; i < first.namedChildCount; i++) {
              const el = first.namedChild(i)
              if (!el) continue
              if (el.type === "alias") protoNodes.push(el)
              else if (el.type === "tuple") {
                const a = this.findChild(el, (c) => c?.type === "alias")
                if (a) protoNodes.push(a)
              }
            }
          }
          for (const pn of protoNodes) {
            const proto = this.resolveAlias(pn.text, ctx)
            if (currentScope && proto) {
              this.pushRel(ctx, currentScope.name, proto, ASTEngine.RelationshipType.Implements, 0.9, { reasonCode: "elixir_derive_attribute" }, pn.startPosition.row + 1)
            }
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
            // EX-L9 (elixir half of the doc channel): the RULED doc channel
            // is `docstring` (M60: comments has no store binding by design);
            // mirror the chunk so the payload survives the store seam.
            if (sym) { sym.comments = [text]; (sym as any).docstring = text }
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
      } else if (node.type === "unary_operator" && node.child(0)?.text === "&") {
          // EX-L7: `&name/arity` captures a NAMED function — a real reference
          // to it (previously emitted nothing). `&(&1 + 1)` has a non-`/`
          // operator inside and stays silent.
          const inner = node.child(1)
          if (inner?.type === "binary_operator" && inner.child(1)?.text === "/" && !this.isInQuotedCode(node)) {
            const fnNode = inner.child(0)
            const arityNode = inner.child(2)
            const arity = arityNode ? parseInt(arityNode.text, 10) : 0
            let fnName = ""
            if (fnNode?.type === "identifier") fnName = fnNode.text
            else if (fnNode?.type === "call") {
              const tgt = this.findChild(fnNode, (c) => c?.type === "identifier" || c?.type === "dot")
              if (tgt && !this.findChild(fnNode, (c) => c?.type === "arguments")) fnName = tgt.text
            }
            const leaf = fnName.split(".").pop() ?? fnName
            // The Kernel-name filter is for UNQUALIFIED captures (`&length/1`
            // names the local/Kernel length); a QUALIFIED capture is a remote
            // reference whose leaf merely collides (`&String.length/1`,
            // `&IO.inspect/1` — measured: leaf-filtering dropped real
            // String.length/IO.inspect/List.to_string captures once the
            // generic re-emission of the capture head was suppressed).
            const skipName = fnName.includes(".") ? fnName : leaf
            if (fnName && !this.shouldSkipCall(node, skipName)) {
              this.recordCall(fnName, ctx, currentScope, this.enclosingDeclaredScope(scopeStack), { isCapture: true }, fnNode ? fnNode.startPosition.row + 1 : node.startPosition.row + 1, arity)
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
                   const rightArgs = right.type === "call" ? this.findChild(right, (c) => c?.type === "arguments") : null
                   // X6 (adversarial): the piped value is an ARGUMENT — the
                   // step invokes the callee with written args + 1 (`x |> f(1)`
                   // is f/2; a bare `x |> g` is g/1); the raw undercount was
                   // measured on both A/B probes and 15 corpus-visible shapes.
                   this.recordCall(targetName, ctx, currentScope, this.enclosingDeclaredScope(scopeStack), { isPipe: true }, right.startPosition.row + 1, (rightArgs ? rightArgs.namedChildCount : 0) + 1)
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
      // A MODULE (or protocol) is a public entry point whatever its nesting:
      // `MyApp.User` is addressable from outside its file, so the EX-A10
      // ownerName must not demote it out of the export surface. File-level
      // declarations (functions/structs written outside any module — the .exs
      // script shape) are the other half, and they carry no owner by
      // definition.
      const isModLevel = !s.ownerName || s.kind === ASTEngine.SymbolKind.Module || s.kind === ASTEngine.SymbolKind.Interface
      const isPub = s.visibility === "public"
      const isExp = [ASTEngine.SymbolKind.Module, ASTEngine.SymbolKind.Function, ASTEngine.SymbolKind.Interface, ASTEngine.SymbolKind.Struct].includes(s.kind)
      if (isModLevel && isPub && isExp) { ctx.exports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility }) }
    }

    // Post-loop: add contains for owned symbols (module → its types, struct,
    // fields, functions, macros; interface/class → their methods).
    for (const s of ctx.symbols) {
      const _owner = s.ownerName || s.scope
      // EX-L3: a symbol owned by ITSELF (a struct named like its module:
      // name === ownerName) forged `X -[contains]-> X` structural no-ops —
      // 11 of them on a 120-file corpus slice, and the M12 elixir ground
      // truth had pinned one (registered there for its lane).
      if (_owner && _owner !== s.name) {
        this.pushRel(ctx, _owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, { reasonCode: "elixir_symbol_owner_ownership" }, s.range.startLine)
      }
    }

    // ELIXIR_FIX2-X2 — `exports`: the edge that says what this module
    // PUBLISHES. Elixir has no `export` keyword, and that is the point: the
    // language draws the export surface with the definition form itself. `def`,
    // `defmacro`, `defguard`, `defdelegate`, `@type`, `@opaque`, `@callback` and
    // `defstruct` are callable from outside the file; `defp`, `defmacrop`,
    // `defguardp` and `@typep` are not. Measured on 601 corpus files:
    //   5,303 public def/defdelegate/defguard   in 404 files
    //     343 public defmacro                  in  77 files
    //     652 public @type/@opaque             in 119 files
    //     177 public @callback/@macrocallback  in  30 files
    //   7,918 PRIVATE defp/defmacrop/defguardp in 347 files   <- must NOT export
    //      41 PRIVATE @typep                   in  12 files   <- must NOT export
    // The private figures are what makes this a measurement and not a gesture:
    // an implementation keyed on "is it a function" instead of "is it PUBLIC"
    // publishes 7,959 names that no importer can bind, and the differential
    // oracle cannot see that — both sides would be written from the same wrong
    // rule.
    //
    // Deliberately NOT published here:
    //   * `Property` (a struct field) — the importable unit of a struct is the
    //     struct; membership rides `contains` (the exports-family ruling).
    //   * an ownerless symbol — there is no owner to publish from, and the
    //     `Global` pseudo-source is an unattributable endpoint.
    //   * `owner === name` (the `defstruct` symbol named after its own module) —
    //     same self-loop the `contains` pass suppresses (EX-L3).
    // NOTE: `res.exports` (the ExportInfo LIST) is a different channel with a
    // different contract — the exports-family ruling says a module's members
    // are NOT importable bare names in a language whose import binds the module
    // (`import MyApp.User` does not bring `new` into scope), so the list stays
    // modules + file-scope units. This edge does not change it.
    for (const s of ctx.symbols) {
      const owner = s.ownerName || s.scope || ""
      if (owner.length === 0 || owner === s.name) continue
      if (s.visibility !== "public") continue
      if (!EXPORTED_KINDS.has(String(s.kind))) continue
      if (s.name.length === 0 || s.name === "unknown") continue
      this.pushRel(ctx, owner, s.name, ASTEngine.RelationshipType.Exports, 1.0,
        { elixirSpecific: true, exportKind: String(s.kind), evidenceClass: "syntactic_declaration" },
        s.range.startLine)
    }

    // ELIXIR_FIX2-O2 — `overrides`. Elixir HAS an override construct:
    // `defoverridable` marks a default implementation as replaceable (26 corpus
    // sites / 14 files) and `super(...)` calls it (17 sites / 4 files). The
    // overriding definition, however, lives in the module that `use`s the
    // provider — a DIFFERENT file, 510 `use` sites across 325 files — and this
    // analyzer reads one file at a time and publishes OUTGOING edges only. So
    // the only shape in which both endpoints are nameable here is:
    //
    //   the file both DECLARES N (with `defoverridable`) and `use`s N.
    //
    // That shape measures **0 sites in 601 files** (probe E8), which is why the
    // type does not fire on this corpus and why the branch below is honest about
    // being a reader rather than a generator.
    //
    // The three shapes that DO fire are deliberately NOT published, each with its
    // measurement, because each would put a wrong edge in the graph:
    //   * `defoverridable f: 1` + a later `def f` in the SAME module — 17 sites
    //     / 3 files, and a real override, but this lane merges a multi-clause
    //     head into ONE symbol, so both endpoints are the same string and the
    //     edge is a self-loop carrying no graph information.
    //   * `use N` for an N in another file, plus any `def f` in the using
    //     module — a FABRICATION. Most definitions in a `use N` module are new
    //     functions; only the ones N marks overridable are replacements, and N
    //     is not readable from here.
    //   * a def whose name repeats across two modules in one file — 21 sites /
    //     9 files, and NOT an override at all (`Registry.Supervisor.start_link`
    //     beside `Registry.Partition.start_link` are two different modules).
    for (const [mod, used] of ctx.moduleUses) {
      for (const provider of used) {
        // What does `use provider` make overridable? Elixir's rule: a
        // `defoverridable` mark written in the PROVIDER's body declares an
        // override point for the module that USES it. Two forms, and they say
        // different things:
        //   defoverridable f: 1, g: 2   -> f/1 and g/2 OF THE PROVIDER
        //   defoverridable SomeModule    -> every function OF SomeModule
        // The second form is the one a `__using__` template writes
        // (`defoverridable EEx.Engine`, measured at agent.ex:231,
        // application.ex:416, dict.ex:218, eex/engine.ex:108 and 10 more).
        const named = ctx.overridableNames.get(provider)
        const moduleMarks = ctx.overridableModules.get(provider)
        if (!named && !moduleMarks) continue
        for (const member of ctx.symbols) {
          const owner = member.ownerName || ""
          if (owner !== mod) continue
          const arity = typeof member.metadata?.arity === "number" ? String(member.metadata!.arity) : "?"
          const qualified = `${member.name}/${arity}`
          const bare = member.name
          let overriddenBy = ""
          if (named && (named.has(qualified) || named.has(bare))) overriddenBy = provider
          else if (moduleMarks) {
            for (const m of moduleMarks) {
              // The provider of the mark is named, but its FUNCTION LIST is not
              // readable unless it is declared in this file — and naming a
              // function of a module this file does not contain is how
              // `overrides` becomes a fabrication.
              const declares = ctx.symbols.some((s) => (s.ownerName || "") === m && s.name === member.name)
              if (declares) { overriddenBy = m; break }
            }
          }
          if (overriddenBy.length === 0) continue
          const overridden = `${overriddenBy}.${member.name}`
          if (overridden === `${mod}.${member.name}`) continue
          this.pushRel(ctx, `${mod}.${member.name}`, overridden, ASTEngine.RelationshipType.Overrides, 0.9,
            { elixirSpecific: true, elixirOverridesKind: "use_of_defoverridable", provider: overriddenBy, evidenceClass: "structural_inference", reasonCode: "elixir_use_defoverridable" },
            member.range.startLine)
        }
      }
    }

    // EX-EX3 × ELIXIR_FIX2-U1 — resolve the staged member reads.
    //
    // The two `uses` pins are a SPEC COLLISION between two authors, both landed
    // by the corpus commit `1719ff6b3`, and neither line ever satisfied both:
    // `ontology-uses` was authored by the ontology wave (37be14e7a, 2026-10-03)
    // and `member-read-uses` by the FIX2 wave (2a169c958, 2026-10-05). Measured
    // across every revision of this analyzer that exists (11 distinct blobs, all
    // refs + the unreachable layer): NONE passes both. The wave's realization
    // (5d6dbd58, "ontology-uses passes") replaced the unconditional member-read
    // rule with the declared-field gate and turned `member-read-uses` red
    // (it is in that revision's 18-failure list); this file's lineage kept the
    // unconditional rule and stayed red on `ontology-uses`. Neither is right:
    //
    //   ontology-uses  wants a published target to always be a real symbol: "the
    //                  edge is published only when the leaf is a field some struct
    //                  in this file declares" — and forbids the map-key read
    //                  `m.domain`, the map-BOUND read `m.id` (`%{} = m`), and the
    //                  chain's intermediate `u.profile`.
    //   member-read-uses wants a member read to never be SILENT (`opts.domain`,
    //                  `user.address.city`, all of them) in a file with no struct
    //                  at all, at 0.7 with `usage_contextual`.
    //
    // The reconciliation is a FILE-LEVEL branch, and it is the only shape that
    // satisfies both: the declared-field gate is applied exactly when the file
    // has the vocabulary to apply it (it declares ≥1 struct field).
    //   - file declares struct fields  -> GATE. A read of a field this file does
    //     not declare is dropped rather than published as a name that resolves to
    //     nothing (α's rule, and `ontology-uses` states it verbatim). Verified
    //     edges carry `struct_field_read` at 0.9.
    //   - file declares NO struct field -> PUBLISH. There is nothing to verify
    //     against; a field of a struct declared in another file is not a
    //     fabrication, and `member-read-uses` requires these reads to exist.
    //     They stay at 0.7 `usage_contextual` — the weaker label is the honest
    //     one, and it keeps the two populations countable apart (§4 clause 3).
    //
    // The MAP gates apply in BOTH branches, because they do not depend on the
    // declared-field vocabulary: `%{} = m` then `m.id` is a map-key read whether
    // or not some struct also declares `id` (EX-EX12 names the corpus case,
    // `defp from_map(%{} = datetime_map)` reading eleven keys at
    // calendar/datetime.ex:2063). `%Mod{} = u` binds a STRUCT and is NOT a map
    // binding, so a read through it stays a verified struct-field read.
    const declaredStructFields = new Set<string>()
    for (const s of ctx.symbols) {
      if (s.kind === ASTEngine.SymbolKind.Property && (s.metadata as any)?.isStructField) declaredStructFields.add(s.name)
    }
    const verifyAgainstDeclaredFields = declaredStructFields.size > 0
    for (const c of ctx.usesCandidates) {
      // charCodeAt 37 = `%`: a struct/map LITERAL receiver is a value, not a
      // binding, so no map binding can apply to it and it is not looked up.
      if (c.receiver.charCodeAt(0) !== 37 && (ctx.mapBoundByScope.get(c.source)?.has(c.receiver) ?? false)) {
        ctx.mapKeyReceiverDropped++
        continue
      }
      if (verifyAgainstDeclaredFields && !declaredStructFields.has(c.field)) continue
      if (verifyAgainstDeclaredFields) {
        ctx.usesVerified++
        this.pushRel(ctx, c.source, c.field, ASTEngine.RelationshipType.Uses, 0.9,
          { elixirSpecific: true, memberAccess: true, receiver: c.receiver, elixirUsesKind: "member_field_read", evidenceClass: "struct_field_read", reasonCode: "elixir_struct_field_read" },
          c.line)
      } else {
        ctx.usesContextual++
        this.pushRel(ctx, c.source, c.field, ASTEngine.RelationshipType.Uses, 0.7,
          { elixirSpecific: true, memberAccess: true, receiver: c.receiver, elixirUsesKind: "member_field_read", evidenceClass: "usage_contextual", reasonCode: "elixir_member_field_read" },
          c.line)
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
        architecturalScore: Math.min(100, Math.max(0, 100 - ctx.errors.length * 5)), codeQuality: ctx.errors.length === 0 ? "Excellent" : "Fair", hasTypeInference: false, hasFrameworkIntelligence: true, analysisVersion: "10.0.0-elixir-dfs-strict",
        // EX-EX3 × ELIXIR_FIX2-U1: the countable split of the `uses` surface
        // (§4 clause 3 — a ratio is only countable if the populations are named).
        usesCandidates: ctx.usesCandidates.length, usesVerified: ctx.usesVerified, usesContextual: ctx.usesContextual, mapKeyReceiverDropped: ctx.mapKeyReceiverDropped,
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
  private pushRel(ctx: ElixirContext, source: string, target: string, type: ASTEngine.RelationshipType, confidence: number, metadata: Record<string, any> = {}, line?: number) {
    // EX-L2 (ER-D2 parity + adversarial X13): the call-site ARITY joins the
    // identity too — same-line sites of arity-distinct clauses (`{f(1),
    // f(2, 3)}`) collapsed to one edge, contradicting the name+arity contract
    // (f/1 and f/2 are distinct callees).
const key = `${source}|${type}|${target}|${line ?? ""}|${(metadata as any).callArity ?? ""}`
    if (ctx.seenRels.has(key)) return
    ctx.seenRels.add(key)
    // ELIXIR_FIX2-C1 — M14-HONESTY-CONTRACT §4, first clause: "Any relationship
    // or symbol emitted with confidence < 1.0 must carry a machine-readable
    // reason code (not just a number)". Measured on this lane's corpus BEFORE
    // this line: 49,007/49,007 calls edges at 0.8, 930/930 references at 0.9,
    // 1,187/1,187 instantiates at 0.9 and 73/73 implements at 0.9 carried NO
    // reason code, and `evidenceClass` was absent on 100% of edges of every
    // type (61,188/61,188). §4's third clause wants the ratio countable, and a
    // per-site code is only countable if every sub-1.0 site HAS one — so the
    // default is filled in HERE, at the single choke point every edge passes
    // through, rather than at 14 call sites where one omission would be invisible.
    // A site that knows better passes its own `reasonCode` / `evidenceClass` in
    // `metadata` and this only fills the gaps.
    // Clone ONLY when a key is actually missing. An unconditional `{...metadata}`
    // here allocates a second object for every one of the 68,372 corpus edges,
    // and the two labels that already pass an evidenceClass at their own site
    // (contains, exports — 14,940 of them) never needed it. Measured: the
    // unconditional clone cost the lane +24.7% wall time on the whole corpus,
    // which is inside the 25% report band and worth not spending.
    let md: Record<string, any> = metadata
    const needReason = confidence < 1 && !(typeof metadata.reasonCode === "string" && metadata.reasonCode.length > 0)
    const needClass = !(typeof metadata.evidenceClass === "string" && metadata.evidenceClass.length > 0)
    if (needReason || needClass) {
      md = { ...metadata }
      if (needReason) {
        md.reasonCode = `elixir_${String(type)}_heuristic`
        md.reasonCodeSource = "default_at_pushrel"
      }
      if (needClass) md.evidenceClass = DEFAULT_EVIDENCE_CLASS[String(type)] ?? (confidence < 1 ? "heuristic" : "syntactic_declaration")
    }
    // M59 (#825): the NAME-BEARING node's 1-based line — the callee, the
    // module named by use/import/alias, the behaviour/protocol atom, the
    // struct alias. Never an enclosing declaration's line, never 0. NULL
    // when underivable. Carried at construction: M60.P1's emit surface
    // reads `line_number:` from the analyzer source (the assignment form
    // left the matrix cell dead — clojure's CLJ-D1 fixed both spellings).
    const rel: ASTEngine.UniversalRelationship = {
      source, target, type, confidence, metadata: md,
      ...(typeof line === "number" && line > 0 ? { line_number: line } : {}),
    }
    ctx.relationships.push(rel)
  }

  private recordCall(targetName: string, ctx: ElixirContext, currentScope: Scope | undefined, declaredScope: string | undefined, meta: any = {}, line?: number, arity?: number) {
      let finalTarget = targetName
      // X4 (adversarial): a chained-receiver target (`Mix.shell().error`)
      // carried its call syntax verbatim — an identity matching no symbol
      // (148+91 corpus edges). The receiver is a value, so the callee is the
      // final METHOD leaf; it skips declared-set resolution (nothing local
      // can be named by a method on a result).
      if (finalTarget.indexOf("(") !== -1) {
          const lastDot = finalTarget.lastIndexOf(".")
          finalTarget = lastDot >= 0 ? finalTarget.slice(lastDot + 1) : finalTarget
          const paren = finalTarget.indexOf("(")
          if (paren !== -1) finalTarget = finalTarget.slice(0, paren)
          if (finalTarget) {
            if (arity && arity > 0) meta = { ...meta, callArity: arity }
            this.pushRel(ctx, currentScope?.name || "Global", finalTarget, ASTEngine.RelationshipType.Calls, 0.8, { elixirSpecific: true, reasonCode: "elixir_call_chained_receiver_leaf", ...meta }, line)
          }
          return
      }
      // X5 (adversarial): `__MODULE__.fun` names the enclosing module
      // (ELXD21 parity — the literal prefix matched no symbol; 5+8 sites).
      // With no enclosing module the literal names nothing: drop.
      if (finalTarget.startsWith("__MODULE__.")) {
          if (!declaredScope) return
          finalTarget = declaredScope + finalTarget.slice("__MODULE__".length)
      }
      const parts = finalTarget.split(".")
      if (parts.length > 1) {
          const root = parts[0]
          if (ctx.aliases[root]) {
              parts[0] = ctx.aliases[root]!
              finalTarget = parts.join(".")
          }
      }
      if (!finalTarget) return
      // X9 (adversarial): qualified Kernel builtins are the same call-graph
      // noise as bare ones (EX-D2) — `Kernel.length`/`Kernel.raise` emitted
      // calls while `length`/`raise` did not (49 corpus sites).
      if (finalTarget.startsWith("Kernel.")) {
          const leaf = finalTarget.slice("Kernel.".length)
          if (KERNEL_FUNCTIONS.has(leaf) || SPECIAL_FORMS.has(leaf)) return
      }
      // EX-A18: `alias Helper.{make, name}` makes `make()` a statically nameable
      // call to Helper.make — the alias map's ONLY lowercase keys are the ones
      // that multi-alias writes (module aliases and the implied
      // `Task.Supervisor` -> Supervisor keys are all capitalized), so resolving
      // a bare name through it cannot capture any other call.
      if (finalTarget.indexOf(".") === -1) {
          const aliased = ctx.aliases[finalTarget]
          if (aliased && aliased.indexOf(".") !== -1) finalTarget = aliased
      }
      // EX-L2 (ER-D2 parity): call-site arity rides the edge — `pick/1` and
      // `pick/2` are distinct callees and distinct edges.
      if (arity && arity > 0) meta = { ...meta, callArity: arity }
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
      this.pushRel(ctx, currentScope?.name || "Global", finalTarget, ASTEngine.RelationshipType.Calls, 0.8,
        { elixirSpecific: true, reasonCode: finalTarget.indexOf(".") !== -1 ? "elixir_call_qualified_module_receiver" : "elixir_call_local_declared_scope", ...meta }, line)
  }

private recordInstantiates(structName: string, ctx: ElixirContext, currentScope: Scope | undefined, line?: number) {
      if (!structName) return
      // Self-construction (X instantiates X) is vacuous as a dependency
      // edge — %__MODULE__{} in X's own body (e.g. test blocks, which push
      // no function scope) would forge it (ELXD13). Structural self-loops
      // are never legitimate; the oracle holds the same guard.
      if (structName === currentScope?.name) return
      // ELIXIR_FIX2-C2: NO per-site reasonCode here, on purpose. A `%Mod{}`
      // literal, `struct/2` and `raise Mod` are three syntaxes for ONE fact —
      // this module constructed that struct — so a per-site code would be
      // three spellings of the same statement, and pushRel's default
      // (`elixir_instantiates_heuristic`, plus `reasonCodeSource:
      // "default_at_pushrel"`) is exactly as informative while being one
      // place instead of three. The default has to be a LIVE branch to be
      // worth having: a guarantee no edge exercises is dead code wearing a
      // safety net's name, and the mutant that removes it would survive
      // forever. fixture member-read-uses pins `meta.reasonCodeSource` on the
      // uses edge, which carries its own code, and the instantiates row in
      // fixture struct-update is what pins the default.
      this.pushRel(ctx, currentScope?.name || "Global", structName, ASTEngine.RelationshipType.Instantiates, 0.9, { elixirSpecific: true, isStruct: true }, line)
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
          // X7 (adversarial): `unquote`/`unquote_splicing` ARGUMENTS execute
          // at expansion time — the nearest boundary wins over the enclosing
          // quote (first match while walking upward), so unquoted code emits
          // its calls while the rest of the quote stays data.
          if (id?.text === "unquote" || id?.text === "unquote_splicing") return false
        }
        cur = cur.parent
      }
      return false
  }

  // EX-A14: does this `def` have a BODY? Two shapes, both real: a `do_block`
  // child, and the single-line `, do: body` pair — which the grammar nests
  // INSIDE the def's `arguments`, so it is not a sibling of it (the first
  // version of this check looked for a direct `pair` child and read every
  // `def f(x), do: y` as bodiless, which is how a definition ended up carrying
  // isDeclaration). The walk stays inside `arguments` and never descends into
  // a nested `do_block`, which is a body of some inner construct, not this def's.
  private hasDefBody(node: Node): boolean {
      if (this.findChild(node, (c) => c?.type === "do_block") !== null) return true
      const args = this.findChild(node, (c) => c?.type === "arguments")
      if (!args) return false
      const stack: Node[] = [args]
      while (stack.length > 0) {
          const n = stack.pop()!
          if (n !== args && n.type === "do_block") continue
          if (n.type === "pair") {
              const kw = this.findChild(n, (c) => c?.type === "keyword")
              if (kw && this.stripAfterColon(kw.text) === "do") return true
          }
          for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) stack.push(c) }
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

  // EX-A17: the attribute's OWN call node is its NAME (`@section ...` is
  // call[section, arguments[...]]), never an invocation of `section`. The
  // blanket isInAttribute gate hid that correctly, so the relaxation below has
  // to keep naming it explicitly or every attribute publishes a phantom
  // lowercase call.
  private isAttributeNameCall(node: Node): boolean {
      const p = node.parent
      return !!(p && p.type === "unary_operator" && p.child(0)?.text === "@" && p.child(1) === node)
  }

  // EX-A17: a module attribute's VALUE is COMPILE-TIME CODE. `@section
  // %Spark.Dsl.Section{build: Spark.Dsl.build(:x)}` builds that struct while
  // the module compiles, `@deferred fn -> Helper.later() end` names a real
  // remote call, and `@raised raise Helper.Error` raises a real exception —
  // the whole DSL ecosystem (Ash/Spark, Ecto.Migration, Quantum) is built on
  // it. The blanket gate silenced every edge inside an attribute value, so a
  // DSL section named no dependency at all: 21 attributes carrying 21 struct
  // literals in a 250-file sample of ash, 0 elsewhere in 938 files — and the
  // SAME walk already counted `case` inside an attribute toward cyclomatic
  // complexity and set its pattern flags, so the gate contradicted the
  // analyzer's own treatment of the same subtree. The DECLARATION attributes
  // keep their silence; `isInAttribute` still guards the directive and
  // member-read walks, because a `use`/`alias` cannot legitimately appear in
  // an attribute value.
  private isInDeclarationAttributeValue(node: Node): boolean {
      let cur = node.parent
      while (cur) {
        if (cur.type === "unary_operator" && cur.child(0)?.text === "@") {
          const value = cur.child(1)
          if (!value || value.type !== "call") return true
          const id = this.findChild(value, (c) => c?.type === "identifier")
          return DECLARATION_ATTRIBUTES.has(id?.text ?? "")
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
  // ELIXIR_FIX2-P2 — a def-shaped call inside a def-shaped BODY is a CALL.
  //
  // Elixir requires `def`/`defp`/`defmacro`/… to sit at module level; a
  // definition inside a definition body is a macro invocation of the same name
  // (the one legal way to generate definitions — inside a `quote` — is already
  // excluded by isInQuotedCode). Found by the contains oracle, not by reading:
  //
  //   lib/elixir/lib/kernel/utils.ex:317-319
  //     defmacro defguard(args, expr) do
  //       defguard(args, expr, __CALLER__)
  //     end
  //
  // published a MACRO symbol named `args`, owned by `Kernel.Utils.defguard/2`.
  // The shape is `call > identifier(defguard) + arguments(identifier,
  // identifier, identifier)` — with bare arguments there is NO nested `call`
  // node, so the existing signature read takes `arguments`' first named child
  // and the argument becomes the name. `isDefHead` cannot see it: it returns
  // false on the enclosing `do_block` before it ever reaches the outer call,
  // which is the correct answer to "is this a signature head" and the wrong
  // question to ask here.
  private isInsideDefBody(node: Node): boolean {
    let cur: Node | null = node.parent
    while (cur) {
      if (cur.type === "do_block") {
        const owner = cur.parent
        if (owner && owner.type === "call") {
          const id = this.findChild(owner, (c) => c?.type === "identifier")
          if (id && DEF_CONSTRUCTS.has(id.text)) return true
        }
        // A do_block under anything else (defmodule, defprotocol, defimpl,
        // try, fn, case) is not a definition body.
      }
      // The SINGLE-LINE body form: `defmodule X, do: defguard(...)`. The `do:`
      // pair is a body when its owner is a DEF-shaped call and a module body when
      // its owner is a MODULE-shaped one, so the two are separated here rather
      // than by whether a do_block exists. Found by the contains oracle:
      // kernel/guard_test.exs:196-200 publishes
      //   defmodule(LiteralUsage, do: defguard("literal is bad"))
      //   defmodule(RemoteUsage,   do: defguard(Remote.call(is_bad)))
      // inside `assert_raise ArgumentError` blocks — Elixir treats both
      // `defguard` calls as definitions at module level (which is why the test
      // asserts they are invalid), and the analyzer was dropping the second one's
      // containment.
      if (cur.type === "pair") {
        const kw = this.findChild(cur, (c) => c?.type === "keyword")
        const kwt = kw?.text ?? ""
        const owner = cur.parent
        if ((kwt === "do" || kwt.startsWith("do:")) && owner && owner.type === "call") {
          const id = this.findChild(owner, (c) => c?.type === "identifier")
          if (id && DEF_CONSTRUCTS.has(id.text)) return true
        }
      }
      cur = cur.parent
    }
    return false
  }

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

  // X2 (adversarial): PATTERN positions are never constructions. A struct
  // literal in a case/fn/receive clause pattern, or on the left of `=` or
  // `<-`, is a destructure — 43+16 live corpus sites each emitted a false
  // instantiates (e.g. `fn %Mix.Dep{app: app} = dep ->`). The arrow token in
  // a stab_clause separates pattern from body; the operators separate the
  // match subject from the built value. (A `cond` clause test evaluates —
  // structs there are nonsense code and are treated as patterns uniformly.)
  private isPatternPosition(node: Node): boolean {
      let cur: Node | null = node
      while (cur && cur.parent) {
        const p: Node = cur.parent
        if (p.type === "stab_clause") {
          const arrow = this.findChild(p, (c) => c?.type === "->")
          return arrow ? node.startIndex < arrow.startIndex : false
        }
        if (p.type === "binary_operator" && (p.child(1)?.text === "=" || p.child(1)?.text === "<-")) {
          const left = p.child(0)
          return !!(left && node.startIndex >= left.startIndex && node.endIndex <= left.endIndex)
        }
        cur = p
      }
      return false
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

  // ELIXIR_FIX2-O1 — record `defoverridable`. Two shapes, both on the corpus:
  //
  //   defoverridable child_spec: 1, code_change: 3     named function/arity
  //   defoverridable EEx.Engine                         a whole module
  //
  // The name/arity list arrives as `keywords` or as a `list` of `pair`s /
  // bare `keyword`s, and the arity is irrelevant to the edge — the edge names
  // the FUNCTION, and Elixir's own `Module.overridable?/2` keys on name+arity,
  // so the arity is carried in the recorded string for readability only. No
  // pattern: a colon is found with indexOf and the head is a slice.
  private recordOverridable(node: Node, ctx: ElixirContext, currentScope: Scope | undefined): void {
    const owner = currentScope?.name || ""
    if (owner.length === 0) return
    // No quote guard HERE, and that is deliberate: the WALK already routes every
    // quoted `call` away from the whole branch chain (`if (isInQuotedCode(node))
    // { /* data */ } else if (t === …)`), so a `defoverridable` inside a
    // `__using__` template never arrives here. An earlier version carried a
    // second, redundant guard inside this method — and it was DEAD CODE: the
    // mutant that removed it produced byte-identical output on the corpus and
    // on the fixtures, which is the workstream's own test for "this branch can
    // never match". Measured on the corpus, 14 of the 26 `defoverridable` sites
    // ARE that shape (agent.ex:231, dict.ex:218, eex/engine.ex:108,
    // application.ex:416, gen_server.ex:920), so the behaviour is worth the
    // coverage — fixture Cc1.WithTemplate/template_only pins it — and the dead
    // guard is not. Mutant elixir/overrides-quoted-leak attacks the LIVE gate.
    const argsNode = this.findChild(node, (c) => c?.type === "arguments")
    if (!argsNode) return
    const addName = (name: string): void => {
      if (name.length === 0) return
      let set = ctx.overridableNames.get(owner)
      if (!set) { set = new Set(); ctx.overridableNames.set(owner, set) }
      set.add(name)
    }
    const namedKids = (n: Node): Node[] => {
      const res: Node[] = []
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) res.push(c) }
      return res
    }
    const addModule = (m: string): void => {
      if (m.length === 0) return
      let set = ctx.overridableModules.get(owner)
      if (!set) { set = new Set(); ctx.overridableModules.set(owner, set) }
      set.add(this.resolveAlias(m, ctx))
    }
    const takePair = (pair: Node): void => {
      const kw = this.findChild(pair, (c) => c?.type === "keyword")
      if (!kw) return
      const colon = kw.text.indexOf(":")
      if (colon <= 0) return
      // Elixir's own `Module.overridable?/2` keys on name AND arity, so the
      // recorded identity carries it: `base_fun/1` matches a `def base_fun(a)`.
      // A mark written without an arity is stored bare and matches any arity.
      const name = kw.text.slice(0, colon)
      const rest = kw.text.slice(colon + 1)
      let digits = ""
      for (let i = 0; i < rest.length; i++) { const c = rest.charCodeAt(i); if (c >= 48 && c <= 57) digits += rest[i] }
      addName(digits.length > 0 ? `${name}/${digits}` : name)
    }
    // One dispatcher over the arguments subtree, keyed on the node type read
    // through `String(...)`. Written this way because TypeScript's control-flow
    // analysis narrows a `child.type` comparison chain against the discriminant
    // it just matched, and a five-armed if/else over the same field is exactly
    // the shape it refuses — which is a type error about the CODE, not about the
    // trees. The recursion covers the two shapes the corpus uses
    // (`defoverridable f: 1, g: 2` and `defoverridable [f: 1, g: 2]`).
    const visit = (n: Node, depth: number): void => {
      if (depth > 4) return
      const t: string = String(n.type)
      if (t === "pair") { takePair(n); return }
      if (t === "keyword") { const colon = n.text.indexOf(":"); if (colon > 0) addName(n.text.slice(0, colon)); return }
      if (t === "alias") { addModule(n.text); return }
      if (t === "identifier") { addName(n.text); return }
      for (const c of namedKids(n)) visit(c, depth + 1)
    }
    visit(argsNode, 0)
  }

  // ELIXIR_FIX2-U1 — the SAME predicate isMemberAccess uses, returning the two Kept next to it on purpose: if the two ever
  // disagree, a field read is either double-labelled (edge here AND a call) or
  // silently dropped (neither), and the only way to notice is the two sitting in
  // one file. Pure char scan — `charCodeAt` against a-z — not a pattern.
  private memberReadLeaf(node: Node): { leaf: string; receiver: string } | undefined {
      const target = this.findChild(node, (c) => c?.type === "identifier" || c?.type === "dot")
      if (target?.type !== "dot") return undefined
      if (this.findChild(node, (c) => c?.type === "arguments")) return undefined
      const parts = target.text.split(".")
      if (parts.length < 2) return undefined
      const root = parts[0] ?? ""
      if (root.length === 0) return undefined
      const c0 = root.charCodeAt(0)
      // 37 = `%`. A struct/map LITERAL receiver (`%OntoUser{}.name`, the
      // `%URI{uri | path: "/bar"}.path` R7 endpoint) is a VALUE, and the read
      // through it is still a read of the named field, so it is staged here.
      // It can never be a variable, so it is exempt from the map-binding gate
      // and it is exempt from naming a CALLABLE name — see `shouldSkipCall`,
      // where the same `%` keeps the literal text out of a `calls` target (R7).
      if (!((c0 >= 97 && c0 <= 122) || c0 === 37)) return undefined
      const leaf = parts[parts.length - 1] ?? ""
      // R7: no empty names, and never the placeholder literal.
      if (leaf.length === 0 || leaf === "unknown") return undefined
      return { leaf, receiver: root }
  }

  // EX-EX12 — the variables this DEFINITION binds to a MAP, by shape (no
  // patterns, no regexes):
  //   `%{} = m`         a match whose map side is a bare map  -> m
  //   `%{a: a} = m`     a destructuring match                 -> m and a
  //   `m = %{a: a}`     the same match written the other way   -> m and a
  //   `%Mod{} = u`      NOT a map (the map side carries a `struct` child) -> none
  // A NESTED definition owns its own bindings, so its subtree is not scanned
  // here — its own `processFunction` call records them under its own scope.
  private mapBoundVariables(within: Node): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (name: string): void => {
      if (name.length === 0 || seen.has(name)) return
      seen.add(name)
      out.push(name)
    }
    const scan = (n: Node): void => {
      if (n !== within && n.type === "call") {
        const kwt = this.findChild(n, (c) => c?.type === "identifier")?.text ?? ""
        if (DEF_CONSTRUCTS.has(kwt) && !this.isDefHead(n)) return
      }
      if (n.type === "binary_operator" && this.binaryPart(n, "operator")?.text === "=") {
        const left = this.binaryPart(n, "left")
        const right = this.binaryPart(n, "right")
        const leftIsMap = left?.type === "map" && this.findChild(left, (c) => c?.type === "struct") === null
        const rightIsMap = right?.type === "map" && this.findChild(right, (c) => c?.type === "struct") === null
        if (leftIsMap || rightIsMap) {
          const pattern = (leftIsMap ? left : right)!
          const bound = leftIsMap ? right : left
          for (const name of this.identifiersIn(pattern)) add(name)
          if (bound?.type === "identifier") add(bound.text)
          else if (bound) for (const name of this.identifiersIn(bound)) add(name)
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) scan(c)
      }
    }
    scan(within)
    return out
  }

  /** The identifiers a subtree names — the keys of `%{a: a, b: b}` bind `a`/`b`.
   *  A `pair`'s key (`:day` in `%{day: day}`) is a NAME, not a binding, so the
   *  key child is skipped and only the value side is walked. */
  private identifiersIn(n: Node): string[] {
    const out: string[] = []
    const stack: Node[] = [n]
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (cur.type === "identifier" && cur.text) out.push(cur.text)
      if (cur.type === "pair") {
        const key = this.findChild(cur, (c) => c?.type === "keyword")
        if (key) {
          for (let i = 0; i < cur.namedChildCount; i++) { const c = cur.namedChild(i); if (c && c !== key) stack.push(c) }
          continue
        }
      }
      for (let i = 0; i < cur.namedChildCount; i++) {
        const c = cur.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out
  }

  // X6 companion: the right-hand side of `|>` is consumed by the pipe
  // branch (thread-adjusted arity) — its own walk must not re-emit the
  // written arity as a second edge once arity joins the dedupe key.
  // Same for the function head of a `&fun/arity` capture (the capture
  // branch emits it with the declared arity; the bare head is not a
  // zero-arity invocation).
  private isPipeStep(node: Node): boolean {
      const p = node.parent
      return !!(p && p.type === "binary_operator" && p.child(1)?.text === "|>" && p.child(2) && p.child(2)!.startIndex === node.startIndex)
  }

  private isCaptureHead(node: Node): boolean {
      const p = node.parent
      if (!p || p.type !== "binary_operator" || p.child(1)?.text !== "/") return false
      const g = p.parent
      return !!(g && g.type === "unary_operator" && g.child(0)?.text === "&")
  }

  private shouldSkipCall(node: Node, t: string): boolean {
      if (SPECIAL_FORMS.has(t)) return true
      if (KERNEL_FUNCTIONS.has(t)) return true
      if (this.isInQuotedCode(node)) return true
      // EX-A17: the attribute's own name and the declaration attributes stay
      // silent; a code-valued attribute is a call site like any other.
      if (this.isAttributeNameCall(node)) return true
      if (this.isInDeclarationAttributeValue(node)) return true
      if (this.isDefHead(node)) return true
      if (this.isMemberAccess(node)) return true
      // R7 (EX-EX3, R7EndpointNames, ELX4.R7Host): a target carrying `%` or `{}`
      // names no symbol. A struct-literal or map-literal receiver is a VALUE, so
      // `%OntoUser{}.name`, `%Helper{}.helper_fun` and `%URI{uri | path: "/bar"}.path`
      // are not callable names and must not be published as `calls` targets. The
      // test cannot hit a real name: `%` at position 0 is the struct/map operator
      // (a callable name never starts with it) and `{` cannot appear in a name.
      if (t.length > 0 && (t.charCodeAt(0) === 37 || t.indexOf("{") !== -1)) return true
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

  // ELIXIR_FIX2-P3 — a `defmodule`/`defprotocol`/`defimpl` name must come from
  // an `alias` / `dot` / `identifier` node. `extractName` FALLS BACK to the
  // node's raw text, which is right for a directive argument (`import Foo` is
  // an alias, but `alias Foo.{Bar, Baz}` is a dot) and wrong for a module
  // declaration: found by the contains oracle at
  //   lib/elixir/test/elixir/kernel_test.exs:906  `defmodule 1 + 2, do: :ok`
  //   lib/elixir/test/elixir/kernel_test.exs:924  `defmodule :"foo/bar", do: :ok`
  //   lib/elixir/test/elixir/kernel_test.exs:928  `defmodule :"foo\bar", do: :ok`
  // which published module symbols named `KernelTest.1 + 2, do: :ok`,
  // `KernelTest.:"foo/bar", do: :ok` and `KernelTest.:"foo\bar", do: :ok`. All
  // three are Elixir code that RAISES (the surrounding test is an
  // `assert_raise ArgumentError`), so the construct is a computed module name,
  // not a declaration, and the honest reading is silence. A name this reader
  // cannot produce is a name the analyzer must not invent.
  private declarationName(argsNode: Node): string {
    // `alias` / `dot` ONLY. A bare `identifier` is a VARIABLE, and Elixir's
    // `defmodule name do … end` accepts an expression — so `name = :dynamic;
    // defmodule name` creates a module called `LoggerTest.dynamic`, while
    // reading the identifier publishes `LoggerTest.name`. Measured by the
    // contains oracle on the corpus: logger_test.exs (`LoggerTest.name` plus its
    // two members `debug`/`error`), exception_test.exs
    // (`ExceptionTest.module` plus `foo`), module_test.exs
    // (`ModuleTest.__MODULE__.NonAtomAlias` plus `hello`). A module name is a
    // namespace, and a variable's spelling is not one.
    const aliasNode = this.findChild(argsNode, (c) => c?.type === "alias" || c?.type === "dot")
    if (!aliasNode) return ""
    const txt = aliasNode.text
    if (txt.length === 0) return ""
    // A name that still carries Elixir source punctuation is a fallback that
    // leaked, not a module name: reject rather than publish it.
    for (let i = 0; i < txt.length; i++) {
      const c = txt.charCodeAt(i)
      const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 46 || c === 33
      if (!ok) return ""
    }
    return txt
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
    if (this.isInsideDefBody(node)) return false
    const name = this.declarationName(argsNode)
    // ELIXIR_FIX2-P6. Reaching here with no name means the construct IS a module
    // declaration whose name is a computed expression or a variable, so there is
    // no module to own what follows. The first version returned false and left
    // the ENCLOSING module in scope, so `def foo` inside
    // `for module <- modules do write_beam(defmodule module do def foo, do: :bar
    // end end) end` published `contains ExceptionTest -> foo` and
    // `exports ExceptionTest -> foo` for a function that belongs to a module the
    // corpus never names. Measured: 10 declarations in 5 files (exception_test,
    // map_test, module_test, logger_test, compile.erlang_test). Publishing a
    // wrong edge is the expensive mistake, so the scope is pushed UNNAMED and the
    // members carry no owner.
    if (name.length === 0) {
      scopeStack.push({ node, name: currentScope?.name ?? "", kind: ASTEngine.SymbolKind.Module, complexity: 0, unnamedModule: true, savedAliases: ctx.aliases })
      ctx.aliases = Object.create(ctx.aliases)
      return true
    }
    const fullName = currentScope ? `${currentScope.name}.${name}` : name
    // EX-A10: a NESTED defmodule is owned by its enclosing declaration — the
    // same field its own functions/struct/fields already carry, the lane's own
    // symbol contract ("nested modules owned by the parent") and the M14 ledger
    // ruling (`ownerName` = the innermost enclosing declaration, #867). Only
    // `scope` was written, so `ownerName`/`ownerKind` were undefined on every
    // nested module in every corpus (measured: 100% of nested-module symbols on
    // ecto_sql's 60-file slice) and any consumer reading `ownerName` alone — as
    // src/ast/override-context.ts and src/ast/framework-intelligence.ts do —
    // saw a module with no parent. The indexer survived it only because it
    // falls back to `scope`; the contract did not.
    const symbol: ASTEngine.UniversalSymbol = {
        name: fullName, kind: ASTEngine.SymbolKind.Module, range: this.nodeToRange(node), scope: currentScope?.name || "", ownerName: currentScope?.name, ownerKind: currentScope?.kind, visibility: "public",
        metadata: { elixirSpecific: true }
    }
    ctx.symbols.push(symbol)
    ctx.symbolByName.set(fullName, symbol)
    // EX-L5 (corrected): the last-segment alias registers on scope EXIT (see
    // the isExit branch) — inside the body, `B` still names the EXTERNAL B,
    // so `use Supervisor` in Registry.Supervisor is the stdlib Supervisor.
    // A new scope is a documentation boundary (ELXD14) — a staged @doc
    // never leaks past it.
    ctx.pendingDoc = undefined
    // W23-E1: alias scoping is LEXICAL — the frame saves the enclosing map
    // and swaps in a child map. The prototype chain gives lookups the
    // enclosing aliases for free; writes land in this frame only, and the
    // exit block restores the parent BEFORE the own-implied registration.
    scopeStack.push({ node, name: fullName, kind: ASTEngine.SymbolKind.Module, complexity: 0, symbol, savedAliases: ctx.aliases })
    ctx.aliases = Object.create(ctx.aliases)
    return true
  }

  private processProtocol(node: Node, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    if (this.isDefHead(node) || this.isInAttribute(node) || this.isInQuotedCode(node)) return false
    // ELIXIR_FIX2-P6, same rule as processModule: an un-nameable protocol owns
    // nothing, and its callbacks must not be published as the enclosing
    // module's exports.
    const argsNode = this.findChild(node, (c) => c?.type !== "identifier" && c?.type !== "do_block")
    if (!argsNode) return false
    if (this.isInsideDefBody(node)) return false
    const name = this.declarationName(argsNode)
    // ELIXIR_FIX2-P6. Reaching here with no name means the construct IS a module
    // declaration whose name is a computed expression or a variable, so there is
    // no module to own what follows. The first version returned false and left
    // the ENCLOSING module in scope, so `def foo` inside
    // `for module <- modules do write_beam(defmodule module do def foo, do: :bar
    // end end) end` published `contains ExceptionTest -> foo` and
    // `exports ExceptionTest -> foo` for a function that belongs to a module the
    // corpus never names. Measured: 10 declarations in 5 files (exception_test,
    // map_test, module_test, logger_test, compile.erlang_test). Publishing a
    // wrong edge is the expensive mistake, so the scope is pushed UNNAMED and the
    // members carry no owner.
    if (name.length === 0) {
      scopeStack.push({ node, name: currentScope?.name ?? "", kind: ASTEngine.SymbolKind.Module, complexity: 0, unnamedModule: true, savedAliases: ctx.aliases })
      ctx.aliases = Object.create(ctx.aliases)
      return true
    }
    const fullName = currentScope ? `${currentScope.name}.${name}` : name
    // EX-A10 (same ruling, protocol half): a protocol declared inside a module
    // is owned by it, like every other nested declaration in this file.
    const protocolSym: ASTEngine.UniversalSymbol = { name: fullName, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node), scope: currentScope?.name || "", ownerName: currentScope?.name, ownerKind: currentScope?.kind, visibility: "public", metadata: { elixirSpecific: true, isProtocol: true } }
    ctx.symbols.push(protocolSym)
    ctx.symbolByName.set(fullName, protocolSym)
    // EX-L5 (corrected): same exit-time registration for protocols — the
    // alias belongs to the enclosing scope, not the defining body.
    ctx.pendingDoc = undefined
    // W23-E1: same lexical alias swap as modules (protocols are scopes too).
    scopeStack.push({ node, name: fullName, kind: ASTEngine.SymbolKind.Interface, complexity: 0, symbol: protocolSym, savedAliases: ctx.aliases })
    ctx.aliases = Object.create(ctx.aliases)
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
    // W23 (review finding, fixture defimpl-target-forms): `defimpl P, for:
    // [A, B]` is a valid MULTI-TYPE implementation — the old path passed the
    // RAW list text through resolveAlias, minting a garbage impl name and
    // edge target ("[A, B]"). Valid `for:` values are one alias or a list
    // of aliases.
    const forTypeList: string[] = []
    let forTypeListNode: Node | null = null
    const keywordsNode = this.findChild(argsNode, (c) => c?.type === "keywords")
    if (keywordsNode) {
      for (let i = 0; i < keywordsNode.namedChildCount; i++) {
        const pair = keywordsNode.namedChild(i)
        if (!pair || pair.type !== "pair") continue
        const kw = this.findChild(pair, (c) => c?.type === "keyword")
        if (kw && this.stripAfterColon(kw.text) === "for" && pair.namedChildCount > 1) {
          const val = pair.namedChild(1)
          if (!val) continue
          if (val.type === "list") {
            forTypeListNode = val
            for (let k = 0; k < val.namedChildCount; k++) {
              const el = val.namedChild(k)
              if (el && el.type === "alias") forTypeList.push(this.resolveAlias(el.text, ctx))
            }
            forType = forTypeList.length > 0 ? forTypeList[0] : "Unknown"
          } else {
            forType = this.resolveAlias(val.text, ctx)
          }
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
    // W23: a multi-type list mints one implementation symbol per type and
    // one Implements edge per type (each type genuinely implements the
    // protocol); the shared method body's scope rides the FIRST type.
    // Single-type output is byte-identical to the pre-fix behavior.
    // EX-A12: `forType` records the type the implementation is FOR — the
    // single-argument form (`defimpl P do` nested in a module) implements P FOR
    // THE ENCLOSING MODULE, whose name the symbol already carries, so the old
    // `"Unknown"` sentinel there was a PLACEHOLDER LITERAL in the payload
    // (the same literal this lane forbids as a symbol name) sitting next to the
    // real answer. When no type is derivable at all the field is ABSENT, which
    // is what "unknown" is allowed to look like in a payload.
    const resolvedForType: string | string[] | undefined =
        forTypeList.length > 0 ? forTypeList : (forType !== "Unknown" ? forType : (implName !== protocol ? implName : undefined))
    const implSym: ASTEngine.UniversalSymbol = { name: fullName, kind: ASTEngine.SymbolKind.Class, range: this.nodeToRange(node), scope: currentScope?.name || "", visibility: "public", metadata: { elixirSpecific: true, isProtocolImplementation: true, protocol, ...(resolvedForType !== undefined ? { forType: resolvedForType } : {}) } }
    ctx.symbols.push(implSym)
    ctx.symbolByName.set(fullName, implSym)
    if (forTypeList.length > 1) {
      for (let ti = 1; ti < forTypeList.length; ti++) {
        const tSym: ASTEngine.UniversalSymbol = { name: forTypeList[ti], kind: ASTEngine.SymbolKind.Class, range: this.nodeToRange(node), scope: currentScope?.name || "", visibility: "public", metadata: { elixirSpecific: true, isProtocolImplementation: true, protocol, forType: forTypeList[ti] } }
        ctx.symbols.push(tSym)
        ctx.symbolByName.set(forTypeList[ti], tSym)
      }
    }
    // A degenerate for-less defimpl names nothing real — never a self-loop.
    // (Line fallback made real: `(x)?.a.b + 1 ?? y` short-circuits to NaN,
    // not y — tsc flagged the dead `??`; the intended node fallback now runs.)
    const implLineNode = aliases.length > 1 ? aliases[1] : aliases[0]
    if (forTypeListNode && forTypeList.length > 0) {
      // W23: per-element edges with per-element lines (each list entry has
      // its own name-bearing node).
      for (let k = 0; k < forTypeListNode.namedChildCount; k++) {
        const el = forTypeListNode.namedChild(k)
        if (!el || el.type !== "alias") continue
        const t = this.resolveAlias(el.text, ctx)
        if (t && t !== "Unknown" && t !== protocol) this.pushRel(ctx, t, protocol, ASTEngine.RelationshipType.Implements, 1.0, { reasonCode: "elixir_defimpl_for_type" }, el.startPosition.row + 1)
      }
    } else if (fullName !== protocol) {
      this.pushRel(ctx, fullName, protocol, ASTEngine.RelationshipType.Implements, 1.0, { reasonCode: "elixir_defimpl_protocol" }, implLineNode ? implLineNode.startPosition.row + 1 : node.startPosition.row + 1)
    }
    ctx.pendingDoc = undefined
    // W23-E1: same lexical alias swap as modules (defimpl bodies are scopes).
    scopeStack.push({ node, name: fullName, kind: ASTEngine.SymbolKind.Class, complexity: 0, symbol: implSym, savedAliases: ctx.aliases })
    ctx.aliases = Object.create(ctx.aliases)
    return true
  }

  private processStruct(node: Node, ctx: ElixirContext, currentScope: Scope | undefined) {
    // A defstruct-shaped call in a declaration head (defmacro defstruct(fields))
    // is the macro head, not a struct declaration — same class as def heads
    // (isDefHead) and attributes. Without this the defstruct IMPLEMENTATION
    // itself fabricates struct:defstruct (ELXD4, kernel.ex:5624).
    if (this.isDefHead(node) || this.isInAttribute(node) || this.isInQuotedCode(node)) return
    if (!currentScope) return
    // ELIXIR_FIX2-P6: a struct's name IS its module's name. With no module name
    // there is no struct name, so neither the struct nor its fields are
    // published — naming the struct after the ENCLOSING module would forge a
    // struct that module does not define.
    if (currentScope.unnamedModule) return
    const structName = currentScope.name
    const structSym: ASTEngine.UniversalSymbol = { name: structName, kind: ASTEngine.SymbolKind.Struct, range: this.nodeToRange(node), scope: currentScope.name, ownerName: currentScope.name, ownerKind: currentScope.kind, visibility: "public", metadata: { elixirSpecific: true, isStruct: true } }
    ctx.symbols.push(structSym)
    // ELXD14: @doc before defstruct documents the struct itself.
    if (ctx.pendingDoc) { structSym.comments = [ctx.pendingDoc]; (structSym as any).docstring = ctx.pendingDoc; ctx.pendingDoc = undefined }
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

  /**
   * M60 (#924, elixir E): the parts of a binary_operator read RELATIVE TO ITS OPERATOR
   * TOKEN, never by absolute child index. A comment between a definition head and its
   * `when` guard is an extra node that lands at index 1, so `child(1)` published the
   * COMMENT as the function name (measured: list.ex:783; node shape in
   * script/m14/tmp/c924-elixir-head-shape.ts — [0]left call, [1] comment,
   * [2]operator `when`, [3]right guard).
   */
  private binaryPart(node: Node, part: "operator" | "left" | "right"): Node | null {
    let opIdx = -1
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && !c.isNamed) { opIdx = i; break }
    }
    if (opIdx === -1) return null
    if (part === "operator") return node.child(opIdx)
    // A COMMENT is not an operand. The measured shape of a comment-split head is
    // [left call][comment][operator when][right guard], so the nearest named child before
    // the operator IS the comment, and taking it as the head published the analyzer's
    // Unknown fallback — caught by the publication dump's --all, NOT by the census probe
    // (that file publishes the same name from its OTHER clauses, so the name was present
    // for the wrong reason). Trivia is skipped on both sides.
    const isTrivia = (c: Node) => c.type === "comment"
    if (part === "left") {
      for (let i = opIdx - 1; i >= 0; i--) {
        const c = node.child(i)
        if (c && c.isNamed && !isTrivia(c)) return c
      }
      return null
    }
    for (let i = opIdx + 1; i < node.childCount; i++) {
      const c = node.child(i)
      if (c && c.isNamed && !isTrivia(c)) return c
    }
    return null
  }

  private processFunction(node: Node, defType: string, ctx: ElixirContext, currentScope: Scope | undefined, scopeStack: Scope[]): boolean {
    // A def-shaped call nested in another declaration head is the inner
    // signature (`defmacro def(sig)`, `def defguard(...)`) — never a new
    // definition (ELXD23). Without this the inner head fabricates phantoms
    // (macro "args", function "Unknown"/"sig").
    if (this.isDefHead(node) || this.isInAttribute(node) || this.isInQuotedCode(node)) return false
    if (this.isInsideDefBody(node)) return false
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
       // M60 (#924, elixir E): the operator and its operands come from binaryPart — a
       // comment between the head and its guard is why child(1) named the function
       // after a COMMENT.
       if (sigNode.type === "binary_operator" && this.binaryPart(sigNode, "operator")?.text === "when") {
          const guardExpr = this.binaryPart(sigNode, "right")
          if (guardExpr) guardList.push(guardExpr.text)
          actualCall = this.binaryPart(sigNode, "left") || undefined
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
                   let paramName = "_"
                   if (argChild.type === "identifier") paramName = argChild.text
                   else if (argChild.type === "binary_operator" && argChild.childCount > 0 && argChild.child(0)?.type === "identifier") paramName = argChild.child(0)!.text
                   // EX-L6: a literal/pattern argument (`def multi(1)`) is an
                   // UNNAMED parameter — its source text is not a name.
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
        } else if (actualCall.type === "block" || this.findChild(actualCall, (c) => c?.type === "operator_identifier") !== null) {
          // EX-A15: a PARENTHESIZED operator definition with no argument list —
          // `defmacro (..) do … end`, how Kernel defines the zero-arity range
          // operator. The grammar shapes the name as
          // `arguments > block > operator_identifier`, which no earlier branch
          // recognised, so the definition fell through to the EX-D9
          // placeholder: elixir's own kernel.ex:4347 published a macro named
          // `Unknown`, and a second parenthesized operator in the same module
          // MERGED into it (both arity 0), so one real definition was invisible
          // and one row stood for two. The operator token is statically
          // nameable, so it is named.
          const opNode = this.findChild(actualCall, (c) => c?.type === "operator_identifier")
          if (opNode?.text) {
              name = opNode.text
              // `defmacro (..)` has no argument list — the macro receives the one
              // AST argument, so arity 1. A parenthesized operator WITH
              // arguments (`def (op)(a, b)`) is an ERROR node in this grammar
              // whose `(a, b)` sibling is still readable, so take the parameter
              // list from there rather than guessing one operand.
              const siblingArgs = this.filterChildren(actualCall.parent ?? ({ namedChildCount: 0, namedChild: () => null } as any), (c) => c?.type === "arguments")[0]
              if (siblingArgs) {
                  for (let i = 0; i < siblingArgs.namedChildCount; i++) {
                      const a = siblingArgs.namedChild(i)
                      if (a) parameters.push({ name: a.type === "identifier" ? a.text : "_", type: "dynamic" })
                  }
              } else {
                  parameters.push({ name: "operand", type: "dynamic" })
              }
          } else {
            // ELIXIR_FIX2-P1. These three lines read the OPERATOR shape out of a
            // binary_operator node. They were left UNCONDITIONAL inside this
            // branch, so on every `defmacro (..)` they ran AFTER the operator
            // name had been taken correctly and overwrote it: binaryPart on a
            // `block` returns its first ANONYMOUS child, which is the `(` token,
            // so `defmacro (..)` published a macro named "(" with arity 3 (the
            // one operand plus two fabricated ones) and `defmacro (---)`
            // published arity 4. Measured on this lane's own fixture
            // paren-operator-forms, which has been FAILING on the inherited
            // baseline (validation/m14/fixture-baseline.json says elixir: 0
            // failures) rather than passing:
            //   53b5ec1ac (EX-A15 lands)  macro ..  arity 1   macro --- arity 2
            //   a7368a806 (#924 E half)   macro Unknown arity 0, heads 3
            //   1ce88e403 (merge m48)     macro (   arity 3   macro (   arity 4
            // The binary_operator arm above already reads the same three fields
            // on the node type that HAS them, so this else keeps the old
            // behaviour for a node that matched the `||` without being a block.
            name = this.binaryPart(actualCall, "operator")?.text || "Unknown"
            parameters.push({ name: this.binaryPart(actualCall, "left")?.text || "left", type: "dynamic" })
            parameters.push({ name: this.binaryPart(actualCall, "right")?.text || "right", type: "dynamic" })
          }
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

    // EX-A14: a `def` with NO BODY is a DECLARATION, not a definition — the
    // protocol callback head (`def size(item)` inside `defprotocol`), the one
    // Elixir form where a bodiless def is legal and meaningful. Marked at the
    // TOP level too, because that is the field the indexer binds to
    // brain_symbol.is_declaration (#612) and the C/Clean lanes already set it
    // for their prototypes. Detection is structural: no `do_block` child and no
    // `do:` keyword pair in the arguments (a single-line `def f(x), do: y` has
    // the pair, so it is never mistaken for a head).
    const isDeclaration = !this.hasDefBody(node) && defType === "def"
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

    const specKey = `${currentScope?.name ?? ""}/${name}/${arity}`
    const parkedSpec = ctx.callbackSpecs[specKey]
    const parkedOptional = currentScope?.name ? ctx.optionalCallbacks[currentScope.name] : undefined

    if (ctx.functionHeads[fnId]) {
        const existing = ctx.functionHeads[fnId]!
        // `heads` counts CLAUSES, so a clause counts only when it has a BODY.
        // A `@callback` that seeded this identity is a declaration and carries
        // no clause, and a bodiless `def` head is a declaration too — while
        // `def twice(y)` + `def twice(y), do: y` is two heads of one function,
        // because the second one has a body.
        if (!isDeclaration) existing.metadata!.heads = (existing.metadata!.heads as number) + 1
        if (parkedSpec) existing.metadata!.callbackSpec = parkedSpec
        if (isDeclaration) {
            if (!existing.isDeclaration) { existing.isDeclaration = true; existing.metadata!.isBodylessDeclaration = true }
            existing.metadata!.isDeclaration = true
        } else {
            // A clause WITH a body makes the merged symbol a DEFINITION, even if
            // its first clause was a bodiless head (`def f(y)` + `def f(y), do:
            // y`) or a `@callback` of the same name was parked for it: leaving
            // the flag on would be a false statement about the symbol.
            existing.isDeclaration = undefined
            existing.metadata!.isBodylessDeclaration = undefined
            if (parkedSpec) existing.metadata!.isCallbackDeclaration = true
        }
        // EX-A8: a MERGED multi-clause definition's extent is the whole
        // function — first clause start .. LAST CLAUSE end. The symbol keeps
        // the first clause's start (its declaration site, which is what the id
        // and the name-line contract are built on) and the end follows the last
        // clause, exactly the rule real-clean-analyzer.ts already applies to a
        // multi-clause `f x = ...` definition. Before this the payload claimed
        // `heads: 7` while the range covered ONE clause: measured 2,321 merged
        // groups in 559 elixir-repo files, of which 184 in a 60-file ecto_sql
        // slice (`def loaders/2` heads=7, range 211..211), so any consumer that
        // asks "is this symbol here?" (LSP document symbols, the indexer's
        // enclosing-span attribution, a hover over clause 3) could not see the
        // definition it was asking about.
        //
        // The span is first..last and NOT clause-by-clause because a span can
        // only be one — and because first..last alone is lossy in the other
        // direction: measured on elixir@024beb1b, 195 of 2,321 merged groups
        // (8.4%) have OTHER declarations between their first and last clause
        // (`Date.to_string/1` spans 335..1170 and swallows 54 defs). So the
        // exact per-clause ranges ride `metadata.clauseRanges`: the span is the
        // function, the list is the clauses, and neither is inferable from the
        // other.
        this.extendRange(existing, this.nodeToRange(node))
        // Defensive: EX-A14 lets a `@callback` seed the same merge key, and a
        // callback has no CLAUSE, so its list starts empty. (Caught the hard
        // way: an unguarded push here threw on the first callback+def pair, and
        // the engine's timeout path downgraded it to a "basic parse result" —
        // the exact silent-failure shape registered as R4 in the review.)
        let clauseRanges = existing.metadata!.clauseRanges as ASTEngine.UniversalSymbol["range"][] | undefined
        if (!clauseRanges) { clauseRanges = []; existing.metadata!.clauseRanges = clauseRanges }
        clauseRanges.push(this.nodeToRange(node))
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
            name, kind: symbolKind, range: this.nodeToRange(node), scope: currentScope?.unnamedModule ? "" : (currentScope?.name || ""), ownerName: currentScope?.unnamedModule ? undefined : currentScope?.name, ownerKind: currentScope?.unnamedModule ? undefined : currentScope?.kind, visibility, parameters,
            ...(isDeclaration ? { isDeclaration: true } : {}),
            metadata: {
                elixirSpecific: true, isMacro: defType.indexOf("macro") !== -1, arity, heads: 1, clauseRanges: [this.nodeToRange(node)],
                // ELIXIR_FIX2-P6: the declaration is real, its OWNER is not
                // knowable (the enclosing defmodule's name is a variable or a
                // computed expression). Recorded so a consumer can see WHY the
                // symbol has no owner, instead of inferring a bug.
                ...(currentScope?.unnamedModule ? { elixirOwnerUnknown: "un-nameable enclosing defmodule/defprotocol" } : {}),
                hasPatternMatching: hasPattern, guards: guardList, isGenServerCallback: isGenCallback, isSupervisorCallback: isSupCallback,
                ...(isDeclaration ? { isBodylessDeclaration: true, isDeclaration: true } : {}),
                ...(parkedSpec ? { callbackSpec: parkedSpec, isCallbackDeclaration: true } : {}),
                ...(parkedOptional && parkedOptional.includes(name) ? { isOptionalCallback: true } : {}),
            }
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
        // EX-L9: mirror the staged chunk into the ruled docstring channel.
        if (!(fnSym as any).docstring) (fnSym as any).docstring = ctx.pendingDoc
        ctx.pendingDoc = undefined
    }

    // X8 (adversarial): defdelegate DEFINES the local function and delegates
    // to `to:` (optionally renamed via `as:`) — the delegation is a real
    // call; 71+12 corpus definitions previously carried zero dependency
    // signal. The `to:` value's line is the name-bearing line.
    if (defType === "defdelegate" && name !== "Unknown") {
      let toMod = ""
      let asName = ""
      let toLine = node.startPosition.row + 1
      const dscan: Node[] = [node]
      while (dscan.length > 0) {
        const x = dscan.pop()!
        if (x.type === "pair") {
          const kw = this.findChild(x, (c) => c?.type === "keyword")
          const kt = kw ? this.stripAfterColon(kw.text) : ""
          if (kt === "to" && x.namedChildCount > 1) {
            const v = x.namedChild(1)
            if (v?.type === "alias") { toMod = v.text; toLine = v.startPosition.row + 1 }
          } else if (kt === "as" && x.namedChildCount > 1) {
            const v = x.namedChild(1)
            if (v?.type === "atom") asName = v.text.startsWith(":") ? v.text.slice(1) : v.text
          }
          continue
        }
        if (x !== node && (x.type === "do_block" || x.type === "anonymous_function")) continue
        for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) dscan.push(c) }
      }
      if (toMod) {
        const resolved = this.resolveAlias(toMod, ctx)
        // W24 #17: the delegate edge's source follows the scope-arity rule —
        // the declared function's identity is name+arity (see scopeName).
        const delScope = currentScope ? `${currentScope.name}.${name}/${arity}` : `${name}/${arity}`
        this.pushRel(ctx, delScope, `${resolved}.${asName || name}`, ASTEngine.RelationshipType.Calls, 0.9, { elixirSpecific: true, isDelegate: true, reasonCode: "elixir_defdelegate_remote_target" }, toLine)
      }
    }

    // Push a function scope for the body so calls/instantiations inside this
    // function attribute to the function (not the module). EX2-U2: the scope
    // NAME is module-qualified (`MyMod.run`) — bare function names collided
    // across modules, so two different `run/0` functions produced
    // indistinguishable edge sources and the source|type|target dedupe
    // silently deleted one module's call edge (3487 bare-sourced calls on the
    // phoenix corpus). W24 #17 (review E7): the name ALSO carries the ARITY —
    // `run/0` and `run/1` bodies previously shared one identity (`MyMod.run`)
    // and merged, the same collision class one level down; the scope name now
    // equals the symbol's merge key (fnId, `MyMod.run/1`). The SYMBOL keeps
    // its bare name + ownerName; only the scope identity and the edges
    // sourced from it are qualified.
    const scopeName = currentScope ? `${currentScope.name}.${name}/${arity}` : `${name}/${arity}`
    // W23-E1: function bodies are lexical too — an `alias` inside a def
    // scopes to that def, never to the whole module.
    scopeStack.push({ node, name: scopeName, kind: symbolKind, complexity: 0, symbol: fnSym, savedAliases: ctx.aliases })
    // EX-EX12 — this definition's MAP bindings, recorded under the scope identity
    // the member reads are sourced from. Cheap pre-test first: a definition whose
    // text carries no `%{` cannot contain a bare map literal (`%Mod{` does not
    // match, because the character after `%` is the alias's first letter), so the
    // scan is skipped for the majority of definitions — measured on the corpus,
    // 1,344 of 9,492 definitions carry one.
    if (ctx.content.includes("%{")) {
      const bound = this.mapBoundVariables(node)
      if (bound.length > 0) {
        let set = ctx.mapBoundByScope.get(scopeName)
        if (!set) { set = new Set(); ctx.mapBoundByScope.set(scopeName, set) }
        for (const b of bound) set.add(b)
      }
    }
    ctx.aliases = Object.create(ctx.aliases)
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
     // ELIXIR_FIX2-O1: `use N` is the other half of the override rule — N is
     // what the using module can override. Recorded per enclosing module so the
     // post-walk pass can ask "does this file both use N and declare N?".
     if (target === "use" && modScope && moduleName.length > 0) {
       let set = ctx.moduleUses.get(modScope)
       if (!set) { set = new Set(); ctx.moduleUses.set(modScope, set) }
       set.add(moduleName)
     }

      // Dependency targets: exactly one module, except multi-alias
      // (`alias Foo.{Bar, Baz}`) which expands to one dependency per member
      // (ELXD20) — the bare prefix alone is not a module and emits nothing.
      // Dependency targets: exactly one module, except multi-alias
      // (`alias Foo.{Bar, Baz}`) which expands to one dependency per member
      // (ELXD20) — the bare prefix alone is not a module and emits nothing.
      // X12 (adversarial): each dep carries ITS OWN name-bearing line — the
      // multi-line member list previously pinned every member to the prefix
      // line. The ANALYZER-side line is per-node; the dedupe key still holds
      // the resolved name.
      let deps: { name: string; line: number }[] = [{ name: moduleName, line: argsNode.startPosition.row + 1 }]
      // M60 (#924, elixir E): the group form is a DEPENDENCY shape, not an alias-only
      // one. `import Module.Types.{Helpers, Descr}` names two modules —
      // Module.Types.Helpers and Module.Types.Descr — while the brace group is an
      // EXPRESSION, and it was published verbatim as the reference target (measured:
      // module/types/pattern.ex:9). ELXD20 already ruled the shape for `alias` ("the
      // bare prefix alone is not a module and emits nothing"); this applies the same
      // rule to use/import/require. Alias REGISTRATION stays alias-only: a plain
      // `import Foo.Bar` does not create the local alias `Bar` in Elixir, so this edit
      // changes nothing but the published module NAMES.
      if (target !== "alias") {
          const groupDot = this.findChild(argsNode, (c) => c?.type === "dot" && !!this.findChild(c, (d) => d?.type === "tuple"))
          const groupTuple = groupDot ? this.findChild(groupDot, (c) => c?.type === "tuple") : undefined
          if (groupDot && groupTuple) {
            deps = []
            const rawPrefix = this.findChild(groupDot, (c) => c?.type === "alias")?.text
              ?? this.findChild(groupDot, (c) => c?.type === "identifier" && c.text === "__MODULE__")?.text ?? ""
            const prefix = this.resolveAlias(resolveSelf(rawPrefix), ctx)
            for (const kid of this.filterChildren(groupTuple, (c) => c?.type === "alias" || c?.type === "dot")) {
              const full = prefix ? `${prefix}.${kid.text}` : kid.text
              if (full) deps.push({ name: full, line: kid.startPosition.row + 1 })
            }
          }
      }
      if (target === "alias") {
          // alias Foo.Bar          → aliases["Bar"] = "Foo.Bar"
          // alias Foo.Bar, as: Baz → aliases["Baz"] = "Foo.Bar"
          const multiDot = this.findChild(argsNode, (c) => c?.type === "dot" && !!this.findChild(c, (d) => d?.type === "tuple"))
          const tuple = multiDot ? this.findChild(multiDot, (c) => c?.type === "tuple") : undefined
          if (tuple) {
            deps = []
            const rawPrefix = this.findChild(multiDot!, (c) => c?.type === "alias")?.text
              ?? this.findChild(multiDot!, (c) => c?.type === "identifier" && c.text === "__MODULE__")?.text ?? ""
            const prefix = this.resolveAlias(resolveSelf(rawPrefix), ctx)
            // EX-A18: members may be lowercase — `alias Helper.{make, name}`
            // aliases two FUNCTIONS, and the member node is an `identifier`,
            // not an `alias`, so the expander produced zero dependency edges and
            // zero local aliases for it. Measured 0 in 938 files of the six
            // corpora (latent hole, not a corpus defect), fixed because the hole
            // is one predicate wide and the rule is the same one the uppercase
            // members already follow.
            for (const kid of this.filterChildren(tuple, (c) => c?.type === "alias" || c?.type === "dot" || c?.type === "identifier")) {
              const full = prefix ? `${prefix}.${kid.text}` : kid.text
              const key = kid.text.split(".").pop()
              if (key && full) {
                ctx.aliases[key] = full
                deps.push({ name: full, line: kid.startPosition.row + 1 })
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
          for (const dep of deps) {
            if (!dep.name) continue
            ctx.imports.push({ module: dep.name, source: dep.name, imported: ["*"], isTypeOnly: false, range: this.nodeToRange(node) })
            if (dep.name !== currentScope?.name) this.pushRel(ctx, currentScope?.name || "Global", dep.name, ASTEngine.RelationshipType.References, 0.9,
              { reasonCode: `elixir_directive_${target}`, directive: target }, dep.line)
          }
      }
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return { startLine: node.startPosition.row + 1, startColumn: node.startPosition.column + 1, endLine: node.endPosition.row + 1, endColumn: node.endPosition.column + 1, startIndex: node.startIndex, endIndex: node.endIndex }
  }

  // EX-A8: grow a symbol's range to include a later declaration of the SAME
  // definition (a merged multi-clause head). The start never moves — the
  // declaration site is what every id and name-line consumer is built on — and
  // endColumn is only meaningful together with its endLine, so a clause ending
  // on a later line replaces the column and a clause ending on the same line
  // takes the larger one. endIndex follows the same max rule.
  private extendRange(symbol: ASTEngine.UniversalSymbol, r: ASTEngine.UniversalSymbol["range"]): void {
      const cur = symbol.range
      if (r.endLine > cur.endLine) { cur.endLine = r.endLine; cur.endColumn = r.endColumn }
      else if (r.endLine === cur.endLine && r.endColumn > cur.endColumn) cur.endColumn = r.endColumn
      if (typeof r.endIndex === "number" && typeof cur.endIndex === "number" && r.endIndex > cur.endIndex) cur.endIndex = r.endIndex
  }
}
