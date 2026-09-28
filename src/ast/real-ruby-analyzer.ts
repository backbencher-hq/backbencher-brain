import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// ============================================================================
// RUBY BUILTINS — filtered from call relationships (same contract as JS/Python)
// ============================================================================
// Identifiers whose parent nodes mean they are NOT bare method calls:
// method/receiver names inside call nodes, def names, assignment targets,
// hash keys, parameter lists, and class/module names.
/**
 * The FILE-SCOPE owner: the source an edge carries when its construct sits
 * outside any named class/module/method.
 *
 * This is a DECLARED convention, not a placeholder, and it is now a single
 * symbol for one role. Ruby's top level is a real scope (an instance of Object),
 * so an edge written there has a truthful scope to name — unlike a
 * "could not find out" state, which the analyzer expresses as a MISSING field
 * (top-level methods are emitted with `ownerName: undefined`, and the store
 * persists a missing edge source as `source_symbol_id IS NULL`, a state
 * `src/lsp/graph_request.ts` already queries for the imports family).
 *
 * The file had grown TWO spellings for this one role: `"Global"` on bare calls,
 * instance-variable reads and require edges, and `"unknown"` on the four
 * alias/alias_method/mixin/association sites. That is the same two-sentinels-one-
 * role defect this file already fixed once (the require edge used to say
 * `"root"` — see the GAD2 note below), and the second spelling is what R7
 * (M60 standing rules) exists to forbid: `"unknown"` is on the indexer's
 * SYMBOL_NAME_DENYLIST, so it could never resolve to a symbol while still
 * appearing in the analyzer's own evidence as if it named one.
 *
 * One constant, so a third spelling is now structurally impossible.
 */
/**
 * ASCII whitespace by character code — R1 ("no regex") as a scan. Used by the
 * superclass-marker fallback, whose leading-marker-plus-whitespace pattern was
 * this analyzer's only regular expression; the caller trims afterwards, so any
 * non-ASCII whitespace the loop does not match is still removed from the leading
 * position.
 */
function isAsciiWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11
}

const FILE_SCOPE_OWNER = "Global"

/**
 * The one name this analyzer publishes Rails under (#749).
 *
 * It used to be two: `detectedFrameworks` was pushed `"Ruby on Rails"` while
 * `frameworkPatterns` was pushed `"Rails"`, so the two published arrays could not be
 * joined by name and any consumer keying on the framework string saw two frameworks.
 * Same defect as the file-scope owner's two spellings, on a different surface.
 */
const RAILS_FRAMEWORK = "Ruby on Rails"

/**
 * Receiver node types that are VARIABLE READS: `@ivar`, `@@cvar`, `$global`.
 * A variable names no class, so `.new` on one is a member call, never an
 * instantiation — the same ruling RB-A made for lowercase identifier receivers
 * (`task_class.new`). Kept as a named set so the rule reads as a rule, and so a
 * third spelling of "unknowable receiver" cannot drift in unnoticed.
 */
const VARIABLE_RECEIVER_TYPES = new Set(["instance_variable", "class_variable", "global_variable"])

const BARE_CALL_SKIP_PARENTS = new Set([
  "call", "command", "command_call",
  // NOTE: `method`/`singleton_method` are deliberately ABSENT — an endless
  // `def label = name` body is a DIRECT identifier child of the def node,
  // and only the FIRST named child is the def name (second review: the set
  // form suppressed endless-body reads on both sides). The def-name check
  // lives inline at the identifier branch (positional).
  // `def size=(v)` parses the NAME as a `setter` node wrapping the plain
  // identifier — without this the nested `size` leaked as a bare call
  // (master-review 2026-09; oracle already carried `setter`).
  "setter",
  // Keyword `alias new_name old_name` (any scope): its identifiers are
  // method-name DECLARATIONS, never expression calls. Class-level alias
  // gets the RB-E alias_method contract in the main loop; alias inside a
  // method body is a runtime-definition (SyntaxError in practice) and must
  // emit nothing, not two junk calls (master-review 2026-09).
  "alias",
  // NOT present: `pair` — a hash/argument pair's VALUE is a real expression
  // (`{ x: helper }`, `foo(k: helper)`); only colon-form KEYS are
  // non-expression, and those are hash_key_symbol/simple_symbol nodes, never
  // identifiers. Rocket-form keys (`key => v`) also evaluate. pair was
  // suppressing genuine value-position method calls on both sides — a
  // shared blind spot F5 cannot see (master-review 2026-09, RUBD12).
  "method_parameters", "parameters", "block_parameters", "lambda_parameters", "block_parameters",
  "class", "module", "singleton_class",
])

export const RUBY_BUILTINS = new Set([
  // Kernel / top-level
  "puts", "print", "p", "pp", "p$", "print_flush", "putc",
  "raise", "fail", "exit", "exit!", "abort", "warn",
  "gets", "readline", "readlines", "rand", "srand",
  "sleep", "loop", "require", "require_relative", "load",
  "autoload", "eval", "binding", "local_variables",
  "global_variables", "global_variable_get", "global_variable_set",
  "caller", "caller_locations", "trace_var", "untrace_var",
  "method", "public_method", "private_method", "protected_method",
  "instance_method", "public_instance_method", "private_instance_method",
  "respond_to", "respond_to?", "class", "superclass",
  "Object", "Kernel", "BasicObject", "NilClass", "TrueClass", "FalseClass",
  "Integer", "Float", "String", "Array", "Hash", "Symbol", "Regexp", "Range",
  "IO", "File", "Dir", "Process", "Signal", "GC", "ObjectSpace",
  "Marshal", "Thread", "Fiber", "Random", "SecureRandom",
  "Time", "Date", "DateTime", "Math",
  "Comparable", "Enumerable", "Errno",
  // Ruby dunders / special methods
  "super", "method_missing", "respond_to_missing?", "initialize_copy",
  "initialize_dup", "initialize_clone", "send", "__send__",
  "freeze", "frozen?", "dup", "clone", "taint", "untaint", "trust", "untrust",
  "hash", "eql?", "equal?", "object_id", "instance_of?", "kind_of?", "is_a?",
  "nil?", "instance_variable_defined?", "instance_variables",
  "instance_variable_get", "instance_variable_set",
  "class_variables", "class_variable_defined?", "class_variable_get", "class_variable_set",
  "const_defined?", "const_get", "const_set", "const_defined?",
  "method_defined?", "private_method_defined?", "protected_method_defined?",
  "singleton_method", "define_singleton_method",
  "to_s", "to_i", "to_f", "to_a", "to_h", "to_proc", "inspect", "display",
  "extend", "include", "prepend",
  // Rails macros (emit properties, not call edges)
  "has_many", "belongs_to", "has_one", "has_and_belongs_to_many",
  "scope", "default_scope",
  "validates", "validate", "validates_with", "validates_each",
  "before_action", "after_action", "before_filter", "after_filter",
  "before_validation", "after_validation",
  "before_save", "after_save", "before_create", "after_create",
  "before_update", "after_update", "before_destroy", "after_destroy",
  "before_commit", "after_commit", "after_rollback",
  "attr_reader", "attr_writer", "attr_accessor",
  "alias_method", "remove_method", "undef_method",
  "delegate", "delegate_missing_to",
  "event", "transition", "state_machine",
  "module_function", "using",
  "ruby2_keywords", "no_touching",
])

// Rails-specific call targets (emit as property/use edges, not call edges)
/**
 * True when a superclass expression is a statically nameable constant /
 * scope path (`Foo`, `::Foo`, `A::B::C`, `A :: B`). Anything else — a call
 * (`Struct.new(...)`, `Class.new(Base)`), an operator expression, a
 * lowercase identifier — is a DYNAMIC superclass whose concrete base is
 * unknowable statically; emitting its raw text as an extends target
 * fabricated junk on both the analyzer and the oracle truth (RB-C ruling;
 * master-review 2026-09). Pure character scan (no regex) so the analyzer
 * and the differential oracle share ONE source of truth — a duplicated
 * regex literal previously drifted into junk targets on the oracle side.
 */
export function isRubyStaticSuperclassName(text: string): boolean {
  if (!text) return false
  const t = text.trim()
  const isConstChar = (c: string): boolean => {
    const code = c.charCodeAt(0)
    return code >= 65 && code <= 90
  }
  const isNameChar = (c: string): boolean => {
    const code = c.charCodeAt(0)
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) || c === "_"
  }
  let i = 0
  const readConst = (): boolean => {
    // Consume one CONSTANT segment; true if one was read.
    if (i >= t.length || !isConstChar(t[i])) return false
    i++
    while (i < t.length && isNameChar(t[i])) i++
    return true
  }
  if (t.startsWith("::")) i = 2
  if (!readConst()) return false
  while (i < t.length) {
    while (i < t.length && (t[i] === " " || t[i] === "\t")) i++
    if (i >= t.length) break
    if (t[i] !== ":") return false
    if (t[i + 1] !== ":") return false
    i += 2
    while (i < t.length && (t[i] === " " || t[i] === "\t")) i++
    if (!readConst()) return false
  }
  return true
}

export const RAILS_MACRO_METHODS = new Set([
  "has_many", "belongs_to", "has_one", "has_and_belongs_to_many",
  "scope", "default_scope",
  "validates", "validate", "validates_with", "validates_each",
  "attr_reader", "attr_writer", "attr_accessor",
  "alias_method", "remove_method", "undef_method",
  "delegate", "delegate_missing_to",
  "event", "transition",
  "before_action", "after_action",
  "before_validation", "after_validation",
  "before_save", "after_save", "before_create", "after_create",
  "before_update", "after_update", "before_destroy", "after_destroy",
  "before_commit", "after_commit", "after_rollback",
  "define_method",
  "module_function",
])

// ============================================================================
// MAIN ANALYZER
// ============================================================================
export class RealRubyAnalyzer implements ASTEngine.LanguageAnalyzer {
  public analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): Omit<ASTEngine.ParseResult, "language" | "metadata"> & { metadata?: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []

    const metadata: Partial<ASTEngine.FileMetadata> = {
      detectedFrameworks: [],
      frameworkPatterns: [],
      cyclomaticComplexity: 1,
      linesOfCode: 0,
    }

    if (!rootNode) return { symbols, imports, errors: [] }

    // --- Error collection ---
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          if (!metadata.errors) metadata.errors = []
          metadata.errors.push({
            message: `Syntax ${n.type} detected.`,
            range: this.nodeToRange(n),
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    // --- Line count ---
    let loc = 1
    for (let i = 0; i < content.length; i++) {
      if (content[i] === "\n") loc++
    }
    metadata.linesOfCode = loc

    // ========================================================================
    // EXTRACTIVE WALK — iterative stack, single pass
    // ========================================================================
    // Scope tracking: modules/classes → owner chain
    // Visibility tracking: private/protected state markers
    // Call source: the nearest enclosing method/function name
    const visibilityOverrides = new Map<string, string>()
    const stack: {
      node: Node
      owner: string | undefined
      ownerKind: string | undefined
      visibility: string
      isSingleton: boolean
    }[] = [{
      node: rootNode,
      owner: undefined,
      ownerKind: undefined,
      visibility: "public",
      isSingleton: false,
    }]

    while (stack.length > 0) {
      const frame = stack.pop()!
      const { node, owner, ownerKind, visibility, isSingleton } = frame
      const type = node.type

      // --- Class ---
      if (type === "class") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        // Namespaced reopen (`class Rake::NameSpace`) declares the same class
        // as the nested form `module Rake; class NameSpace` — the graph must
        // give them ONE identity: name = leaf, owner = the module scope path.
        // Before this the reopen carried the FULL path as a bare name with no
        // owner, so the two spellings never unified across files (rake's own
        // lib uses both styles; master-review 2026-09, RUBD13). The module
        // scope is kept verbatim (`A::B`) — identical reopen spellings merge,
        // matching how nested owners are compared by string elsewhere.
        const rawName = nameNode.text
        const sepIdx = rawName.indexOf("::")
        const name = sepIdx >= 0 ? rawName.substring(sepIdx + 2) : rawName
        const scopeOwner = sepIdx >= 0 ? rawName.substring(0, sepIdx) : undefined
        const effOwner = scopeOwner ?? owner

        const superClass = this.extractSuperclass(node)
        const isRailsModel = this.isRailsModelName(superClass)
        const isRailsController = this.isRailsControllerName(superClass)

        if (isRailsModel || isRailsController) {
          this.recordFramework(metadata, RAILS_FRAMEWORK)
        }

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: ASTEngine.SymbolKind.Class,
          range: this.nodeToRange(node),
          ownerName: effOwner,
          metadata: {
            superClass,
            isRailsModel,
            isRailsController,
            // Full declaration path for reopen spellings (`Rake::NameSpace`)
            // so consumers that want the lexical path can recover it even
            // though the identity is leaf+owner (php-family precedent).
            ...(sepIdx >= 0 ? { fqn: rawName } : {}),
          },
        }
        symbols.push(sym)
        // extends relationship — ONLY when the superclass is a statically
        // nameable constant/scope path. `class X < Struct.new(:a)` has an
        // ANONYMOUS base (RB-C ruling: no extends); emitting the raw
        // expression text fabricated `extends X -> "Struct.new(:a, :b)"`
        // (master-review 2026-09: extractSuperclass never filtered calls).
        if (superClass && this.isStaticSuperclassName(superClass)) {
          const leaf = this.leafName(superClass)
          relationships.push({
            source: name,
            target: leaf,
            type: ASTEngine.RelationshipType.Extends,
            confidence: 1.0,
            // #825: the base type's own node, NOT the `superclass` node — that
            // one starts at `<`, so a wrapped `class X <\n  Base` would stamp the
            // edge one line above the type it names (measured, not assumed).
            line_number: this.nodeLine(this.superclassTargetNode(node)),
            metadata: {},
          })
        }

        // Walk the body in source order. Visibility is lexical in Ruby, so
        // capture it on each frame rather than using mutable global state.
        const body = this.findChild(node, "body_statement")
        if (body) {
          const bodyFrames: typeof stack = []
          let bodyVisibility = "public"
          for (let i = 0; i < body.namedChildCount; i++) {
            const child = body.namedChild(i)
            if (!child) continue
            bodyFrames.push({
              node: child,
              owner: name,
              ownerKind: "class",
              visibility: bodyVisibility,
              isSingleton: false,
            })
            if (this.isNoArgumentVisibilityMarker(child)) {
              bodyVisibility = child.text
            }
          }
          for (let i = bodyFrames.length - 1; i >= 0; i--) stack.push(bodyFrames[i])
        }
        // The superclass expression may itself CONSTRUCT the base class
        // (`class Body < Struct.new(:root, :path, :files)`) — visit the nested
        // call under the declaration's own (outer) scope so `Struct.new`
        // surfaces as an instantiation. Parity with the oracle truth, which
        // walks the superclass subtree (RB-C, rack wave).
        const superNode = this.findChild(node, "superclass")
        if (superNode) {
          for (let i = 0; i < superNode.namedChildCount; i++) {
            const sc = superNode.namedChild(i)
            // The pinned grammar folds every paren-less/paren'd call into
            // `call`, so only that type is matched here (command types are
            // never produced — F6 dead-literal guard).
            if (sc && sc.type === "call") {
              stack.push({ node: sc, owner, ownerKind, visibility, isSingleton: false })
            }
          }
        }
        continue
      }

      // --- Module ---
      if (type === "module") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        // Same reopen normalization as class (`module A::B` ≡ nested
        // `module A; module B`) — RUBD13, master-review 2026-09.
        const rawName = nameNode.text
        const sepIdx = rawName.indexOf("::")
        const name = sepIdx >= 0 ? rawName.substring(sepIdx + 2) : rawName
        const scopeOwner = sepIdx >= 0 ? rawName.substring(0, sepIdx) : undefined
        const effOwner = scopeOwner ?? owner

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: ASTEngine.SymbolKind.Module,
          range: this.nodeToRange(node),
          ownerName: effOwner,
          metadata: { ...(sepIdx >= 0 ? { fqn: rawName } : {}) },
        }
        symbols.push(sym)
        const body = this.findChild(node, "body_statement")
        if (body) {
          const bodyFrames: typeof stack = []
          let bodyVisibility = "public"
          for (let i = 0; i < body.namedChildCount; i++) {
            const child = body.namedChild(i)
            if (!child) continue
            bodyFrames.push({
              node: child,
              owner: name,
              ownerKind: "module",
              visibility: bodyVisibility,
              isSingleton: false,
            })
            if (this.isNoArgumentVisibilityMarker(child)) {
              bodyVisibility = child.text
            }
          }
          for (let i = bodyFrames.length - 1; i >= 0; i--) stack.push(bodyFrames[i])
        }
        continue
      }

      // --- Method ---
      if (type === "method") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        const name = nameNode.text

        const params = this.extractParameters(node)
        const isTopLevel = !owner

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: isTopLevel ? ASTEngine.SymbolKind.Function : ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          ownerName: owner,
          parameters: params,
          visibility: visibility as any,
          isStatic: isSingleton || undefined,
          // Per-symbol cyclomatic complexity (managed-OO family contract —
          // csharp #264 wave precedent). Mirrors the file-level counter's
          // node set (if/unless/while/until/case/rescue/elsif), scoped to
          // this method's subtree; base 1.
          complexity: this.calculateNodeComplexity(node),
          metadata: isSingleton ? { isSingleton: true } : {},
        }
        symbols.push(sym)

        const enclosingMethod = name

        // Walk body (endless `def f = expr` has no body_statement — the
        // body is a direct expression child; without this the whole body
        // was invisible: probe-verified `def fetch = client.get` emitted
        // nothing while the oracle derives calls->get).
        this.walkMethodBody(node, this.findChild(node, "body_statement"), symbols, relationships, imports, metadata,
          owner, ownerKind, enclosingMethod, visibilityOverrides,
          new Set((params ?? []).map((p) => p.name)))
        // Default-argument VALUE expressions run in this method's scope at
        // call time (`mutex = Mutex.new`, `params = Rack::Utils.…`) — surface
        // their calls/reads too (RB-B, rack wave; the oracle truth walks
        // parameter values).
        this.walkParamDefaults(node, symbols, relationships, imports, metadata,
          owner, ownerKind, enclosingMethod, visibilityOverrides,
          new Set((params ?? []).map((p) => p.name)))

        continue
      }

      // --- Singleton class (class << self) ---
      // Its methods belong to the enclosing class and are static/singleton
      // methods, even though the grammar represents them as ordinary `method`
      // nodes inside a `singleton_class` container.
      if (type === "singleton_class") {
        const body = this.findChild(node, "body_statement")
        if (body) {
          const bodyFrames: typeof stack = []
          let bodyVisibility = "public"
          for (let i = 0; i < body.namedChildCount; i++) {
            const child = body.namedChild(i)
            if (!child) continue
            bodyFrames.push({
              node: child,
              owner,
              ownerKind: "class",
              visibility: bodyVisibility,
              isSingleton: true,
            })
            if (this.isNoArgumentVisibilityMarker(child)) bodyVisibility = child.text
          }
          for (let i = bodyFrames.length - 1; i >= 0; i--) stack.push(bodyFrames[i])
        }
        continue
      }

      // --- Singleton method (def self.foo) ---
      if (type === "singleton_method") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        const name = nameNode.text

        const params = this.extractParameters(node)
        const isTopLevel = !owner

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: isTopLevel ? ASTEngine.SymbolKind.Function : ASTEngine.SymbolKind.Method,
          range: this.nodeToRange(node),
          ownerName: owner,
          parameters: params,
          visibility: visibility as any,
          isStatic: true,
          // Per-symbol cyclomatic complexity (managed-OO family contract —
          // csharp #264 wave precedent). Same node set as the file-level
          // counter, scoped to this method's subtree; base 1.
          complexity: this.calculateNodeComplexity(node),
          metadata: { isSingleton: true },
        }
        symbols.push(sym)

        // Walk body (endless bodies included — see walkMethodBody).
        this.walkMethodBody(node, this.findChild(node, "body_statement"), symbols, relationships, imports, metadata,
          owner, ownerKind, name, visibilityOverrides,
          new Set((params ?? []).map((p) => p.name)))
        // Singleton-def receiver (`def @rio.check?`): the receiver object
        // is evaluated at definition time, so an instance-variable
        // receiver reads (`uses->@rio`, matching the oracle). ONLY ivars:
        // identifier receivers are virtually always bound locals (spec
        // setups like `def obj.close` — visiting them fabricated
        // calls->obj), and constants/self never read. Probe-verified on
        // rack minitest specs both ways.
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (!c || c.type !== "instance_variable") continue
          const nm = node.childForFieldName("name")
          if (nm && c.id === (nm as any).id) continue
          const p0 = node.namedChild(0)
          if (p0 && c.id === (p0 as any).id && (node.childForFieldName("name") == null)) continue
          relationships.push({
            source: name,
            target: c.text,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            // #825: the member-read node names the edge.
            line_number: this.nodeLine(c),
            metadata: { memberRead: true },
          })
        }
        // RB-B default-argument values (see walkParamDefaults above).
        this.walkParamDefaults(node, symbols, relationships, imports, metadata,
          owner, ownerKind, name, visibilityOverrides,
          new Set((params ?? []).map((p) => p.name)))

        continue
      }

      // --- Keyword alias (class/module/top-level scope) ---
      // `alias new_name old_name` is the keyword twin of alias_method and
      // makes `new_name` a callable member of the class — same RB-E
      // contract: calls:<alias> with aliasedTo metadata (master-review
      // 2026-09; before this the alias was invisible at declaration scope
      // while method-body aliases leaked two junk bare calls, now suppressed
      // by the `alias` entry in BARE_CALL_SKIP_PARENTS).
      if (type === "alias") {
        const names: string[] = []
        // The alias NAME's own node travels with its text: the edge is named by
        // the new name, and `alias a b` writes that name on this line.
        const nameNodes: Node[] = []
        for (let i = 0; i < node.namedChildCount && names.length < 2; i++) {
          const c = node.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") { names.push(c.text); nameNodes.push(c) }
          else if (c.type === "simple_symbol") { names.push(this.stripSymbolColon(c.text)); nameNodes.push(c) }
        }
        if (names.length === 2) {
          relationships.push({
            source: owner || FILE_SCOPE_OWNER,
            target: names[0],
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.9,
            line_number: this.nodeLine(nameNodes[0]),
            metadata: { aliasedTo: names[1], keywordAlias: true },
          })
        }
        continue
      }

      // --- Visibility markers (private, protected, public) ---
      // Ruby's grammar represents these bare keywords as named identifiers.
      if (type === "identifier") {
        const text = node.text
        if (text === "private" || text === "protected" || text === "public") {
          continue
        }
      }

      // --- Calls in top-level/module/class bodies ---
      // Method bodies are consumed by walkBody above, so this handles only
      // declaration-time calls such as require/include/attr_reader. Note the
      // recursion below: a declaration call's ARGUMENTS may themselves hold
      // calls (`require File.expand_path(...)`) which must still surface.
      if (type === "call") {
        this.processCall(node, symbols, relationships, imports, metadata,
          owner, undefined, visibilityOverrides)
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner, ownerKind, visibility, isSingleton: false })
        }
        continue
      }

      // --- Program/top-level statements ---
      // The root `program` node has no owner; forward its named children into
      // the same iterative traversal so top-level modules/classes are visited.
      if (type === "program") {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner, ownerKind, visibility, isSingleton: false })
        }
        continue
      }

      // --- Assignment at module/class level (constants, instance vars) ---
      // Dynamic class/module creation also applies at TOP level (owner
      // undefined) — `Point = Struct.new` almost always sits at file top
      // level, so gating on owner would miss the common case. Plain
      // constants keep the existing owner-gated behavior.
      if (type === "assignment" && (owner || this.isDynamicClassFactoryRhs(node))) {
        const left = node.childForFieldName("left")
        // A dynamic class/module factory's LHS is a NAME for a real class, and
        // the factory's block body executes in that class's scope — so members
        // declared inside it belong to it. Probe (script/m14/tmp/rb-sentinel-probe.ts):
        // `Widget = Class.new do has_many :parts end` emitted `property:parts`
        // with NO owner and `uses:<file scope>->parts`, while the same
        // `has_many` in `class Acct` emitted `property:widgets@Acct` and
        // `uses:Acct->widgets`. The class-level shape is the correct one, and
        // the factory already knows the name, so the body frames inherit it
        // rather than falling through to the file-scope owner.
        let factoryOwner: string | undefined
        if (left) {
          const leftType = left.type
          if (leftType === "constant") {
            // Dynamic class/module creation (`Point = Struct.new(:x)`,
            // `Cfg = Data.define(:h)`, `K = Class.new(Base)`,
            // `M = Module.new`): the LHS names a real class/module, not a
            // plain constant — probe-verified the defined type was
            // otherwise invisible (no symbol; methods calling Point.new
            // resolved against nothing). Emits Class (Struct/Data/Class)
            // or Module (Module.new) instead of Constant. Block-defined
            // methods keep the enclosing owner (documented residual —
            // reparenting dynamic scopes is a wave of its own).
            const right = node.childForFieldName("right")
            const factoryKind = right ? this.dynamicClassFactoryKind(right) : null
            if (factoryKind) {
              symbols.push({
                name: left.text,
                kind: factoryKind === "Module" ? ASTEngine.SymbolKind.Module : ASTEngine.SymbolKind.Class,
                range: this.nodeToRange(node),
                ownerName: owner,
                visibility: visibility as any,
                metadata: { definedBy: factoryKind === "Module" ? "Module.new" : "classFactory" },
              })
              // The symbol above IS this name in this file, so the body's
              // member edges and member symbols attribute to it.
              factoryOwner = left.text
            } else if (owner) {
              symbols.push({
                name: left.text,
                kind: ASTEngine.SymbolKind.Constant,
                range: this.nodeToRange(node),
                ownerName: owner,
                visibility: visibility as any,
                metadata: { variableType: "constant" },
              })
            }
          }
          // Instance/class/global variables at class level: skip (noise)
        }
        // Recurse into the RHS so member calls/constructed calls inside
        // assignments (`x = File.expand_path(foo)`, `X = SomeService.new`)
        // are still surfaced. The assignment node was not otherwise recursed.
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner: factoryOwner ?? owner, ownerKind, visibility, isSingleton: false })
        }
        continue
      }

      // --- Instance-variable reads outside method bodies (RB-D) ---
      // walkBody emits member-read `uses` inside defs. Spec/DSL code (`it`,
      // `before` blocks, bare class-level reads) has no enclosing method, yet
      // the oracle truth counts every instance_variable READ — attribute them
      // to the file-level owner (owner || Global), the same fallback calls
      // use, so analyzer and truth stay in parity on spec/DSL-heavy corpora
      // (rack wave: @content_type/@app reads in minitest specs).
      if (type === "instance_variable") {
        const parentType = node.parent?.type
        const isLhsOfAssign = (parentType === "assignment" || parentType === "operator_assignment") &&
          node.parent?.childForFieldName("left")?.id === node.id
        if (!isLhsOfAssign) {
          relationships.push({
            source: owner || FILE_SCOPE_OWNER,
            target: node.text,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            // #825: the read node names the edge (top-level/DSL member read).
            line_number: this.nodeLine(node),
            metadata: { memberRead: true },
          })
        }
      }

      // --- Fallback: recurse into any other top-level/module/class body
      // node (command/command_call, arrays, hashes, parenthesized groups,
      // bare assignments with no owner, etc.) so nested declaration calls
      // and constants are still visited. Containers above `continue`, so this
      // only runs for expression/statement nodes whose children may carry
      // calls or constructed values.
      {
        const childFrames: typeof stack = []
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) childFrames.push({ node: child, owner, ownerKind, visibility, isSingleton: false })
        }
        for (const cf of childFrames) stack.push(cf)
      }
    }

    // Apply symbol-list visibility directives in one linear pass. Keeping the
    // directive map separate avoids an O(symbols) scan for every `private :x`.
    for (const symbol of symbols) {
      if (!symbol.ownerName) continue
      const override = visibilityOverrides.get(`${symbol.ownerName}\u0000${symbol.name}`)
      if (override) symbol.visibility = override as any
    }

    // --- Override relationships ---
    // Ruby permits implicit overrides; use local declarations first, then the
    // project companion index supplied by the production/differential caller.
    const baseByClass = new Map<string, string>()
    for (const s of symbols) {
      if (s.kind === ASTEngine.SymbolKind.Class && s.metadata?.superClass) {
        // The base must be a NAME the source writes. A dynamic superclass —
        // `class DirectoryBody < Struct.new(:root, :path, :files)` — has no base
        // class at all, and the extends edge already refuses it
        // (isStaticSuperclassName). This map did not, so the overrides pass was
        // handed the raw expression's leaf as if it were a class name:
        //   overrides DirectoryBody.each -> "Struct.new(:root, :path, :files).each"
        // (measured on rack/rack + rack/multipart, 3 phantom first-parent guesses
        // on the 200-file draw). One predicate, applied in both places — the
        // defect was invisible until the M59 line oracle gave the edge a line.
        const superText = String(s.metadata.superClass)
        if (this.isStaticSuperclassName(superText)) {
          baseByClass.set(s.name, this.leafName(superText))
        }
      }
    }
    const methodsByOwner = new Map<string, Set<string>>()
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName) continue
      let names = methodsByOwner.get(s.ownerName)
      if (!names) {
        names = new Set<string>()
        methodsByOwner.set(s.ownerName, names)
      }
      names.add(s.name)
    }
    for (const s of symbols) {
      if (s.kind !== ASTEngine.SymbolKind.Method || !s.ownerName) continue
      const base = baseByClass.get(s.ownerName)
      if (!base) continue
      // Self-collision guard (master-review 2026-09, RUBD14): a namespaced
      // reopen like `class Rake::TestCase < Test::Unit::TestCase` leaf-
      // collapses its superclass to `TestCase` — the class's OWN leaf after
      // the RUBD13 reopen normalization. A class can never extend itself, so
      // this is a resolution artifact, not a declared in-file base: route it
      // to the honest external first-parent guess instead of fabricating
      // VERIFIED self-overrides (rake helper.rb: 9 phantom 0.95 edges).
      const inFileMethods = base === s.ownerName ? undefined : methodsByOwner.get(base)
      const baseMethods = inFileMethods ?? context?.overrideCompanion?.get(base)
      if (baseMethods?.has(s.name)) {
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${base}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 0.95,
          // #825: a symbol-named edge carries the SYMBOL's own declaration line,
          // so the edge moves with its symbol.
          line_number: s.range?.startLine,
          metadata: { isOverride: true },
        })
      } else if (!inFileMethods && !context?.overrideCompanion?.get(base)) {
        // Pass 3 (family parity with java/groovy resolveOverrides): the base
        // is not declared in this file and the companion index gave no
        // opinion (it is never populated in production — see M37.10), so
        // declaring-parent verification is impossible. Emit the deterministic
        // first-parent guess BELOW the patterns.ts threshold (0.7): visible
        // in raw output, never contaminating thresholded analysis, and
        // counted as heuristic (honest suspicion) by the differential. The
        // pre-M37.10 behavior dropped the edge entirely when the base was
        // external — silently losing every cross-file override.
        relationships.push({
          source: `${s.ownerName}.${s.name}`,
          target: `${base}.${s.name}`,
          type: ASTEngine.RelationshipType.Overrides,
          confidence: 0.5,
          line_number: s.range?.startLine,
          metadata: { isOverride: true, reasonCode: "first-parent-guess" },
        })
      }
    }

    // --- Contains relationships (from ownerName on symbols) ---
    for (const s of symbols) {
      const _owner = s.ownerName
      if (_owner) {
        relationships.push({
          source: _owner,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          line_number: s.range?.startLine,
          metadata: {},
        })
      }
    }

    // Evidence-tier classification (managed-OO family contract — swift/dart/
    // csharp/objc/php precedent; M14 section D requires >=2 distinct
    // evidenceClass values).
    this.classifyEvidenceTier(relationships)

    return {
      symbols,
      imports,
      relationships,
      exports,
      metadata,
      errors: metadata.errors || [],
    }
  }

  /**
   * Walk a method's body: the body_statement when present, else (endless
   * `def f = expr`) every direct child except the name and parameter nodes.
   * Endless bodies are real executable code in the method's scope with its
   * params bound — skipping them dropped all calls/reads inside.
   */
  private walkMethodBody(
    node: Node,
    body: Node | null,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    metadata: Partial<ASTEngine.FileMetadata>,
    owner: string | undefined,
    ownerKind: string | undefined,
    enclosingMethod: string,
    visibilityOverrides: Map<string, string>,
    locals: Set<string>,
  ): void {
    if (body) {
      this.walkBody(body, symbols, relationships, imports, metadata,
        owner, ownerKind, enclosingMethod, visibilityOverrides, locals)
      return
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      if (c.type === "method_parameters" || c.type === "block_parameters") continue
      const fld = (node as any).childForFieldName?.("name")
      if (fld && c.id === (fld as any).id) continue
      if (c.type === "identifier" && i === 0) {
        // Defensive: a leading bare identifier is the def name under every
        // observed shape; the name field check above covers the rest.
        continue
      }
      this.walkBody(c, symbols, relationships, imports, metadata,
        owner, ownerKind, enclosingMethod, visibilityOverrides, new Set(locals))
    }
  }

  // ========================================================================
  // BODY WALKER — processes statements inside a method/function body
  // Handles: calls, require/require_relative, include/extend/prepend,
  //          attr_*, define_method, alias_method, etc.
  // ========================================================================
  private walkBody(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    metadata: Partial<ASTEngine.FileMetadata>,
    owner: string | undefined,
    ownerKind: string | undefined,
    enclosingMethod: string | undefined,
    visibilityOverrides: Map<string, string>,
    locals: Set<string> = new Set(),
  ): void {
    // Ruby scope rule: a bare identifier is a LOCAL VARIABLE READ if the name
    // is a parameter or assigned anywhere in the enclosing scope; otherwise it
    // is a METHOD CALL (Ruby resolves this at parse-of-scope time, before
    // execution). Pre-scan the whole body for assignment targets so identifier
    // reads resolve honestly — nested blocks share the method scope.
    const localNames = new Set(locals)
    const scanStack: Node[] = [node]
    while (scanStack.length > 0) {
      const sn = scanStack.pop()!
      // `defined?(...)` is unevaluated — never bind names inside it.
      if (sn.type === "unary") {
        const op = sn.childCount > 0 ? sn.child(0) : null
        if (op && !op.isNamed && op.type === "defined?") continue
      }
      if (sn.type === "assignment" || sn.type === "operator_assignment") {
        // tree-sitter-ruby has NO `multiple_assignment` node: `a, b = 1, 2`
        // parses as `assignment` whose left is a `left_assignment_list` —
        // every identifier under it is an assignment target.
        const left = sn.childForFieldName("left") ?? sn.namedChild(0)
        if (left) {
          if (left.type === "identifier") {
            localNames.add(left.text)
          }
          for (let i = 0; i < left.namedChildCount; i++) {
            const c = left.namedChild(i)
            if (c?.type === "identifier") localNames.add(c.text)
          }
        }
      }
      // Nested method declarations (`def @app.mm(*a, &b)` inside a method
      // body) bind their OWN parameters as locals of that nested scope.
      // walkBody walks nested defs' bodies (Ruby defines them when the outer
      // method runs), so without this the params leak as bare calls of the
      // OUTER method (verified: rake top_level_functions.rb setup leaks
      // calls:a/calls:b from `def @app.method_missing(*a, &b)`).
      if (sn.type === "method_parameters") {
        const inner: Node[] = [sn]
        while (inner.length > 0) {
          const q = inner.pop()!
          if (q.type === "identifier") localNames.add(q.text)
          for (let j = 0; j < q.namedChildCount; j++) {
            const d = q.namedChild(j)
            if (d) inner.push(d)
          }
        }
      }
      // Block/lambda parameters (`|item|`, `->(x)`) are locals of the block
      // body — their names must not be mistaken for method calls.
      if (sn.type === "block_parameters" || sn.type === "lambda_parameters") {
        for (let i = 0; i < sn.namedChildCount; i++) {
          const c = sn.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") {
            localNames.add(c.text)
          } else if (c.type === "destructured_parameter") {
            // tree-sitter-ruby has no `block_var`/`destructured_left`/`pattern_list`:
            // `|(x, y)|` parses as block_parameters > destructured_parameter,
            // whose children are the bound identifiers directly.
            for (let j = 0; j < c.namedChildCount; j++) {
              const d = c.namedChild(j)
              if (d?.type === "identifier") localNames.add(d.text)
            }
          } else {
            // Splat/keyword/block parameter forms wrap the bound name in a
            // container node (`splat_parameter` > identifier, etc.) — recurse
            // so every bound name inside any form is registered as a local.
            const inner: Node[] = [c]
            while (inner.length > 0) {
              const q = inner.pop()!
              if (q.type === "identifier") localNames.add(q.text)
              for (let j = 0; j < q.namedChildCount; j++) {
                const d = q.namedChild(j)
                if (d) inner.push(d)
              }
            }
          }
        }
      }
      // `rescue Exception => ex` binds `ex` as a local of the enclosing
      // scope — the pinned grammar wraps it in `exception_variable`.
      if (sn.type === "exception_variable") {
        for (let i = 0; i < sn.namedChildCount; i++) {
          const c = sn.namedChild(i)
          if (c?.type === "identifier") localNames.add(c.text)
        }
      }
      // Ruby 3 pattern matching (RUBYG1): `case v; in [a, b]`, `in {name:}`,
      // `in Integer => n`, rightward `v => {x:}` — pattern identifiers BIND
      // locals (same contract as left_assignment_list: a binding is a local,
      // NEVER a bare-call edge). Before this rule every pattern binding
      // leaked as a bogus calls edge BOTH in the pattern and in the match
      // body (verified: `in [a, b]; a + b; end` emitted calls:a + calls:b x2).
      // Bindings live as identifier children of array/find patterns, the
      // value position of keyword_pattern (hash destructure), the right side
      // of as_pattern (`Integer => n`), splat_parameter names (`[*head]`),
      // and bare identifiers directly under in_clause (`in x`). Guard
      // expressions (`if x > 0`) and match bodies (`then`) READ these
      // names — registering them here makes those reads resolve as locals.
      // `variable_reference_pattern` (`^n`) is deliberately EXCLUDED: it
      // PINNS an outer local, it does not bind a new one.
      if (sn.type === "array_pattern" || sn.type === "find_pattern" ||
          sn.type === "as_pattern") {
        for (let i = 0; i < sn.namedChildCount; i++) {
          const c = sn.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") {
            localNames.add(c.text)
          } else if (c.type === "splat_parameter") {
            const nm = c.childForFieldName("name") ?? c.namedChild(0)
            if (nm?.type === "identifier") localNames.add(nm.text)
          }
        }
      } else if (sn.type === "keyword_pattern") {
        // `{age: x}` binds x; `{name:}` binds name (shorthand — the name is
        // the hash_key_symbol itself, not an identifier); `{point: [x, y]}`
        // binds x/y through the nested array_pattern (recursed below).
        for (let i = 0; i < sn.namedChildCount; i++) {
          const c = sn.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") localNames.add(c.text)
          else if (c.type === "hash_key_symbol") localNames.add(this.stripSymbolColon(c.text))
        }
      } else if (sn.type === "in_clause") {
        // Bare `in x` — the pattern is a lone identifier (first named child;
        // the `then` body reads it and must resolve it as a local).
        const first = sn.namedChild(0)
        if (first?.type === "identifier") localNames.add(first.text)
      }
      for (let i = sn.namedChildCount - 1; i >= 0; i--) {
        const child = sn.namedChild(i)
        if (child) scanStack.push(child)
      }
    }

    // Iterative DFS
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      const type = n.type

      // --- `defined?(expr)` is unevaluated: the operand is a name being
      // probed, never a call or read (`defined?(bar)` emitted junk
      // calls->bar; `defined?(x = 1)` must not bind x either). Skip the
      // whole subtree. Other unary operators (`-`, `!`, `~`, `not`)
      // evaluate their operand and descend normally.
      if (type === "unary") {
        const op = n.childCount > 0 ? n.child(0) : null
        if (op && !op.isNamed && op.type === "defined?") continue
      }

      // --- Call (method(), obj.method(), command-style) ---
      // `command`/`command_call` guard against grammar-version drift where
      // paren-less calls may not be folded into `call` nodes.
      if (type === "call" || type === "command" || type === "command_call") {
        this.processCall(n, symbols, relationships, imports, metadata,
          owner, enclosingMethod, visibilityOverrides)
      }

      // --- Bare identifier in expression position: method call unless local ---
      // tree-sitter-ruby parses `foo` (no receiver, no args) as a plain
      // `identifier`. Identifiers that are parts of call nodes, def names,
      // hash keys, or assignment targets are excluded — they are either
      // handled by processCall or are locals by definition.
      if (type === "identifier") {
        const parentType = n.parent?.type
        // Only the def NAME is skipped — receiver-qualified defs
        // (`def result.name`, `def @rio.check?`) put the receiver first,
        // so positional-first misses them. Prefer the `name` field, fall
        // back to first-named-child for fieldless shapes (mirrors the
        // oracle exactly).
        const nameField = (parentType === "method" || parentType === "singleton_method")
          ? (n.parent as any)?.childForFieldName?.("name") ?? null
          : null
        const isDefName = nameField
          ? (nameField as any).id === n.id
          : (parentType === "method" || parentType === "singleton_method") &&
            n.parent!.namedChild(0)?.id === n.id
        if (isDefName) continue
        if (!BARE_CALL_SKIP_PARENTS.has(parentType as string) && !localNames.has(n.text)) {
          this.pushBareCall(n.text, n, owner, enclosingMethod, relationships)
        }
      }

      // --- Instance-variable member reads (family contract) ---
      // `@total`, `@config.host` reads emit `uses` (managed-OO family
      // contract: csharp/dart/swift/objc). Assignment LHS = write → skip.
      // SCD1 family parity (M37 #599 pre-wave): `operator_assignment`
      // (@x += / -= / ||= v) LHS is ALSO a write — java JAD1/kotlin KAD1/
      // scala SCD1/groovy KAD1 and the pre-wave swift gate all exclude
      // compound-assignment LHS from uses. The old RMW-emits rationale
      // claimed csharp/dart/swift/objc support; probe-verified false:
      // dart emits no member uses at all, swift/objc gate plain-assign
      // LHS, and csharp's field-access pass has no read/write split
      // (fixed in the same wave). Writes (including RMW LHS) stay
      // silent — the READ side of `@x += v` survives via RHS/other
      // mentions, matching every other family member.
      // tree-sitter-ruby node type is `instance_variable`.
      if (type === "instance_variable") {
        const parentType = n.parent?.type
        const isLhsOfAssign = (parentType === "assignment" || parentType === "operator_assignment") &&
          n.parent?.childForFieldName("left")?.id === n.id
        if (!isLhsOfAssign) {
          const src = enclosingMethod || owner || FILE_SCOPE_OWNER
          relationships.push({
            source: src,
            target: n.text,
            type: ASTEngine.RelationshipType.Uses,
            confidence: 0.9,
            line_number: this.nodeLine(n),
            metadata: { memberRead: true },
          })
        }
      }

      // --- Complexity counting ---
      // Postfix modifiers count too (same rationale as calculateNodeComplexity:
      // `x if cond` is a branch; the pinned grammar emits if_modifier etc.).
      if (type === "if" || type === "unless" || type === "while" ||
          type === "until" || type === "case" || type === "rescue" ||
          type === "elsif" || type === "if_modifier" ||
          type === "unless_modifier" || type === "while_modifier" ||
          type === "until_modifier" || type === "rescue_modifier") {
        if (metadata.cyclomaticComplexity !== undefined) {
          metadata.cyclomaticComplexity++
        }
      }

      // --- Class/global variables: declared limitation (RUBD3) ---
      // @@class_vars and $globals are file-global/cross-file by nature;
      // per-file emission would fabricate cross-file semantics. Deliberately
      // NOT emitting uses for class_variable/global_variable nodes.
      if (type === "class_variable" || type === "global_variable") {
        metadata.classAndGlobalVarsSkipped = (metadata.classAndGlobalVarsSkipped ?? 0) + 1
      }

      // --- `undef foo` names methods being undefined, never calls/reads.
      // Skip the whole subtree (probe: `undef helper` emitted junk
      // calls->helper). Mirrored in the oracle.
      if (type === "undef") continue

      // Recurse into children
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
  }

  /**
   * Walk the default-argument VALUE expressions of a method's parameters
   * (`optional_parameter` `x = v`, `keyword_parameter` `k: v`) in the method's
   * own scope. Ruby evaluates these at call time, so their calls, member
   * reads and instantiations belong to the method — only the body was walked
   * before, silently dropping `def f(app, lock = Lock.new)`-style call sites
   * (RB-B, rack wave: mutex = Mutex.new, params = Rack::Utils.default_query_parser,
   * app = @app). Mirrors the oracle truth, which walks parameter values.
   */
  private walkParamDefaults(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    metadata: Partial<ASTEngine.FileMetadata>,
    owner: string | undefined,
    ownerKind: string | undefined,
    enclosingMethod: string | undefined,
    visibilityOverrides: Map<string, string>,
    locals: Set<string>,
  ): void {
    const paramsNode = this.findChild(node, "method_parameters") ||
                       this.findChild(node, "parameters")
    if (!paramsNode) return
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const pc = paramsNode.namedChild(i)
      if (!pc) continue
      if (pc.type === "optional_parameter" || pc.type === "keyword_parameter") {
        // Children are [name, value]; the value is the last named child.
        if (pc.namedChildCount >= 2) {
          const value = pc.namedChild(pc.namedChildCount - 1)
          if (value) {
            this.walkBody(value, symbols, relationships, imports, metadata,
              owner, ownerKind, enclosingMethod, visibilityOverrides, locals)
          }
        }
      }
    }
  }

  // ========================================================================
  // CALL PROCESSOR — resolves a single `call` node
  // ========================================================================
  private processCall(
    node: Node,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    metadata: Partial<ASTEngine.FileMetadata>,
    owner: string | undefined,
    enclosingMethod: string | undefined,
    visibilityOverrides: Map<string, string>,
  ): void {
    const methodNode = node.childForFieldName("method")
    if (!methodNode) return
    const methodName = methodNode.text
    if (!methodName) return

    // --- Extract receiver (identifier before the method name) ---
    let receiver: string | undefined
    let receiverLeaf: string | undefined
    // The receiver NODE, not just its text: an `instantiates` edge is named by
    // the type it constructs, and that type is written at the receiver. Bare
    // `new` inside a class has no receiver node and falls back to the call node.
    let receiverNode: Node | null = null
    // A receiver that is itself a call/block expression (`Class.new { }.new`)
    // is an ANONYMOUS target — RB-A uses this to suppress `.new` on it instead
    // of leaking a junk `calls:new` (rack spec_lock.rb wave).
    let hasExpressionReceiver = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.id === methodNode.id) break
      if (!child) continue
      if (child.type === "identifier" || child.type === "constant" || child.type === "scope_resolution") {
        receiver = child.text
        receiverLeaf = this.leafName(child.text)
        receiverNode = child
      } else if (VARIABLE_RECEIVER_TYPES.has(child.type)) {
        // A receiver that is a VARIABLE READ (`@params_class.new`) names no
        // class: the variable holds what was assigned to it, so `.new` on it is
        // a member call whose class is unknowable. RB-A already ruled exactly
        // this for lowercase identifier receivers (`task_class.new`), which
        // never reach the instantiates branch. A variable receiver used to be
        // classified as an expression receiver AND read as receiverless, so
        // `@params_class.new` inside `class QueryParser` was emitted as
        // `instantiates make_params -> QueryParser` — a name the line does not
        // support (@params_class is a constructor PARAMETER; measured on rack
        // query_parser.rb:203/207). The F5 oracle mirrored the same fallback, so
        // the differential could not see it. `receiverLeaf` stays undefined on
        // purpose: `receiver` is set so the call falls through to the member
        // call, while no class name is claimed.
        receiver = child.text
        receiverNode = child
      } else {
        hasExpressionReceiver = true
      }
    }

    // --- Visibility directives ---
    // `private`/`protected`/`public` are declarations, not call edges. The
    // symbol-list form (`private :helper`) changes already-declared methods;
    // the bare form is captured lexically when class frames are built.
    if (methodName === "private" || methodName === "protected" || methodName === "public") {
      const args = this.findChild(node, "argument_list")
      if (args && owner && args.namedChildCount > 0) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          if (!arg || arg.type !== "simple_symbol") continue
          const targetName = this.stripSymbolColon(arg.text)
          visibilityOverrides.set(`${owner}\u0000${targetName}`, methodName)
        }
      }
      return
    }

    // --- require / require_relative / load ---
    if (methodName === "require" || methodName === "require_relative" || methodName === "load") {
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && arg.type === "string") {
            const cleanText = this.stripQuotes(arg.text)
            imports.push({
              module: cleanText,
              names: [],
              range: this.nodeToRange(node),
              isWildcard: true,
              metadata: { requireMethod: methodName },
            })
            relationships.push({
              // GAD2 twin (groovy wave, standing rule): the require edge's
              // source used a hardcoded "root" while calls/uses/instan-
              // tiates at the same top level use "Global" — two sentinels
              // for one role in one file. Unified on "Global" (the pinned
              // convention; no fixture ever pinned "root") — and now unified
              // through FILE_SCOPE_OWNER, which is what made the SECOND
              // divergent spelling ("unknown", four sites: alias,
              // alias_method, mixin, association) visible at all.
              source: FILE_SCOPE_OWNER,
              target: cleanText,
              type: ASTEngine.RelationshipType.References,
              confidence: 0.9,
              // #825: the required path's string node names the edge.
              line_number: this.nodeLine(arg),
              metadata: { requireMethod: methodName },
            })
          }
        }
      }
      return
    }

    // --- autoload: `autoload :JsonParser, "json/parser"` loads a file for
    // one constant — record the same import/reference shape as require
    // (probe: previously recorded nothing at all). String paths only
    // (dynamic paths are unresolvable, mirroring require); the const name
    // itself declares nothing here (defined in the loaded file).
    if (methodName === "autoload") {
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && arg.type === "string") {
            const cleanText = this.stripQuotes(arg.text)
            imports.push({
              module: cleanText,
              names: [],
              range: this.nodeToRange(node),
              isWildcard: true,
              metadata: { requireMethod: methodName },
            })
            relationships.push({
              source: FILE_SCOPE_OWNER,
              target: cleanText,
              type: ASTEngine.RelationshipType.References,
              confidence: 0.9,
              // #825: the required path's string node names the edge.
              line_number: this.nodeLine(arg),
              metadata: { requireMethod: methodName },
            })
          }
        }
      }
      return
    }

    // --- include / extend / prepend (mixin relationships) ---
    if (methodName === "include" || methodName === "extend" || methodName === "prepend") {
      const relType = methodName === "extend"
        ? ASTEngine.RelationshipType.Extends
        : ASTEngine.RelationshipType.Implements
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          // Only CONSTANT mixin targets are pinned (mirrors the differential
          // oracle). A lowercase identifier arg (`include(pattern)` where
          // pattern is a block var, or `extend klass` with a variable) is a
          // DYNAMIC mixin — the concrete module is unknowable statically, and
          // pinning it fabricates implements/extends against a local's name
          // (verified: rake file_list.rb `patterns.each { |pattern| include
          // (pattern) }` -> bogus implements:pattern).
          if (arg && (arg.type === "constant" || arg.type === "scope_resolution")) {
            const target = this.leafName(arg.text)
            relationships.push({
              source: owner || FILE_SCOPE_OWNER,
              target,
              type: relType,
              confidence: 1.0,
              // #825: the mixin CONSTANT's node names the edge.
              line_number: this.nodeLine(arg),
              metadata: { mixinType: methodName },
            })
          }
        }
      }
      return
    }

    // --- attr_reader / attr_writer / attr_accessor ---
    if (methodName === "attr_reader" || methodName === "attr_writer" || methodName === "attr_accessor") {
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          // Bare strings are legal attribute names too (`attr_reader
          // "name"`); the grammar types them `string`, not simple_symbol.
          if (arg && (arg.type === "simple_symbol" || arg.type === "string")) {
            let propName = this.stripSymbolColon(arg.text)
            if (arg.type === "string") propName = this.stripQuotes(arg.text)
            symbols.push({
              name: propName,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeToRange(node),
              ownerName: owner,
              visibility: "public" as any,
              metadata: { accessorType: methodName },
            })
          }
        }
      }
      return
    }

    // --- define_method ---
    if (methodName === "define_method") {
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.namedChildCount; i++) {
          const arg = args.namedChild(i)
          if (arg && (arg.type === "simple_symbol" || arg.type === "string")) {
            let name = this.stripSymbolColon(arg.text)
            if (arg.type === "string") name = this.stripQuotes(arg.text)
            symbols.push({
              name,
              kind: ASTEngine.SymbolKind.Method,
              range: this.nodeToRange(node),
              ownerName: owner,
              visibility: "public" as any,
              metadata: { isDynamicMethod: true },
            })
            break
          }
        }
      }
      return
    }

    // --- alias_method ---
    if (methodName === "alias_method") {
      const args = this.findChild(node, "argument_list")
      if (args) {
        const names: string[] = []
        const argNodes: Node[] = []
        for (let i = 0; i < args.namedChildCount && names.length < 2; i++) {
          const arg = args.namedChild(i)
          if (arg && (arg.type === "simple_symbol")) {
            names.push(this.stripSymbolColon(arg.text))
            argNodes.push(arg)
          }
        }
        if (names.length === 2) {
          relationships.push({
            source: owner || FILE_SCOPE_OWNER,
            target: names[0],
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.9,
            // #825: the `:new_name` argument's node names the edge.
            line_number: this.nodeLine(argNodes[0]),
            metadata: { aliasedTo: names[1] },
          })
        }
      }
      return
    }

    // --- Framework detection (#749) ---
    //
    // This MUST run BEFORE the RAILS_MACRO_METHODS branch below, because that branch
    // RETURNS. `before_action` is a member of that set (alongside has_many, scope,
    // validates, attr_reader, the callbacks), so the `before_action`/`after_action`
    // trigger that used to sit after the return was unreachable in every execution:
    // measured, a file containing `before_action` published `frameworkPatterns: []`,
    // always. The R8 census's dominated-trigger shape is what found it — a guard on a
    // literal that is a member of a set an earlier guard already returned on.
    if (methodName === "redirect_to" || methodName === "render" ||
        methodName === "before_action" || methodName === "after_action") {
      this.recordFramework(metadata, RAILS_FRAMEWORK)
    }
    if (methodName === "before_action" || methodName === "after_action") {
      this.recordFramework(metadata, RAILS_FRAMEWORK, "Callbacks")
    }

    // --- has_many / belongs_to / has_one / has_and_belongs_to_many ---
    if (RAILS_MACRO_METHODS.has(methodName)) {
      if (["has_many", "belongs_to", "has_one", "has_and_belongs_to_many"].includes(methodName)) {
        const args = this.findChild(node, "argument_list")
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const arg = args.namedChild(i)
            if (arg && (arg.type === "simple_symbol" || arg.type === "string" || arg.type === "identifier")) {
              let name = this.stripSymbolColon(arg.text)
              if (arg.type === "string") name = this.stripQuotes(arg.text)
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(node),
                ownerName: owner,
                visibility: "public" as any,
                metadata: { associationType: methodName },
              })
              relationships.push({
                source: owner || FILE_SCOPE_OWNER,
                target: name,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.8,
                // #825: the association's own argument node names the edge.
                line_number: this.nodeLine(arg),
                metadata: { activerecordMacro: methodName },
              })
            }
          }
        }
      } else if (methodName === "scope" || methodName === "default_scope") {
        const args = this.findChild(node, "argument_list")
        if (args && args.namedChildCount > 0) {
          const firstArg = args.namedChild(0)
          if (firstArg && (firstArg.type === "simple_symbol")) {
            const scopeName = this.stripSymbolColon(firstArg.text)
            symbols.push({
              name: scopeName,
              kind: ASTEngine.SymbolKind.Method,
              range: this.nodeToRange(node),
              ownerName: owner,
              visibility: "public" as any,
              metadata: { scopeType: methodName },
            })
          }
        }
      }
      // All RAILS_MACRO_METHODS: no call relationship emitted
      return
    }

    // --- Skip builtins ---
    if (RUBY_BUILTINS.has(methodName)) return

    // --- String interpolation: self.class inside #{...} → skip ---
    if (methodName === "class" && receiver === "self") return

    const source = enclosingMethod || owner || FILE_SCOPE_OWNER

    // `Class.new(...)` is a constructor expression, not an ordinary call.
    // A bare `new(...)` inside a class method constructs the owning class.
    if (methodName === "new") {
      const target = receiverLeaf || (!receiver ? owner : undefined)
      const firstChar = target?.charCodeAt(0) ?? 0
      if (target && (!receiverLeaf || (firstChar >= 65 && firstChar <= 90))) {
        relationships.push({
          source,
          target,
          fromSymbol: source,
          toSymbol: target,
          type: ASTEngine.RelationshipType.Instantiates,
          // #825: the constructed TYPE names the edge — its receiver node when
          // there is one, else the call node itself (bare `new`).
          line_number: this.nodeLine(receiverNode ?? node),
          confidence: 0.9,
          // When no receiver supplied the name, the target is the ENCLOSING
          // class: Ruby's `self.new`, `self.class.new` and a receiverless `new`
          // all construct the class they appear in. The line is the call site
          // (correct), but the class name is IMPLIED rather than written there,
          // so the inference is declared instead of left to look like a written
          // name. The M59 oracle reads this marker to classify the claim as
          // structurally uncheckable-by-token rather than as a failed claim.
          metadata: receiverLeaf ? {} : { resolvedTarget: "enclosing-class" },
        })
        return
      }
      // RB-A (rack wave): not a constant instantiation. Two shapes must NOT
      // fall through to a generic `calls:new`:
      //  1. expression receivers (`Class.new { ... }.new`) instantiate an
      //     anonymous class — no nameable target exists;
      //  2. a receiverless `new` at top level has no owning class either.
      // Lowercase receivers (`task_class.new`) still fall through — that is a
      // genuine member call (truth parity: deriveRubyEdges pushes calls:new).
      if (hasExpressionReceiver) return
      if (!receiver && !owner) return
    }

    // --- Regular call relationship ---
    const qualified = receiver ? `${receiver}.${methodName}` : methodName
    relationships.push({
      source,
      target: methodName,
      fromSymbol: source,
      toSymbol: qualified,
      type: ASTEngine.RelationshipType.Calls,
      confidence: 0.9,
      // #825: the METHOD field's node, never the call node — a call node starts
      // at its receiver, which is the line ABOVE the callee in `a.b.c` chains.
      line_number: this.nodeLine(methodNode),
      metadata: {},
    })
  }

  /**
   * Emit a calls relationship for a bare identifier used as a method call
   * (tree-sitter-ruby parses `foo` with no receiver/args as an identifier).
   * Mirrors processCall's regular-call tail: builtins are skipped and the
   * same confidence/metadata shape is used so the graph stays consistent.
   */
  private pushBareCall(
    name: string,
    nameNode: Node | null,
    owner: string | undefined,
    enclosingMethod: string | undefined,
    relationships: ASTEngine.UniversalRelationship[],
  ): void {
    if (RUBY_BUILTINS.has(name)) return
    if (name === "self" || name === "nil" || name === "true" || name === "false") return
    // Constants are a distinct node type, but guard anyway.
    const firstChar = name.charCodeAt(0)
    if (firstChar >= 65 && firstChar <= 90) return
    // Pseudo-constants (__FILE__, __LINE__, __method__, ...)
    if (name.startsWith("__") && name.endsWith("__")) return

    const source = enclosingMethod || owner || FILE_SCOPE_OWNER
    relationships.push({
      source,
      target: name,
      fromSymbol: source,
      toSymbol: name,
      type: ASTEngine.RelationshipType.Calls,
      confidence: 0.9,
      // #825: the identifier's own node names the bare call.
      line_number: this.nodeLine(nameNode),
      metadata: { bareCall: true },
    })
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  /**
   * True when an `assignment` node's RHS is a dynamic class/module factory
   * call (`Struct.new`, `Data.define`, `Class.new`, `Module.new`, possibly
   * with blocks/args). Used to admit top-level factory assignments that
   * the owner-gated constant rule would otherwise skip.
   */
  private isDynamicClassFactoryRhs(node: Node): boolean {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (!c) continue
      // Only `call`: the pinned grammar folds every call shape (paren,
      // paren-less command, command_call) into `call` nodes — the other
      // two names do not exist in it (grammar-audit proven).
      if (c.type === "call") {
        if (this.dynamicClassFactoryKind(c)) return true
      }
    }
    return false
  }

  /**
   * If `node` is a `X.new`/`X.define` call on a class-factory receiver,
   * return "Class" (Struct/Data/Class) or "Module" (Module.new); else null.
   * Receiver must be the bare constant (RHS of the assignment may wrap in
   * blocks — only the call head matters).
   */
  private dynamicClassFactoryKind(node: Node): "Class" | "Module" | null {
    let callNode: Node | null = node.type === "call" ? node : null
    if (!callNode) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "call") {
          callNode = c
          break
        }
      }
    }
    if (!callNode) return null
    const methodNode = callNode.childForFieldName("method")
    if (!methodNode) return null
    const methodName = methodNode.text
    if (methodName !== "new" && methodName !== "define") return null
    let receiver: string | undefined
    for (let i = 0; i < callNode.namedChildCount; i++) {
      const child = callNode.namedChild(i)
      if (child && child.id === methodNode.id) break
      if (!child) continue
      if (child.type === "constant" || child.type === "scope_resolution") {
        receiver = child.text
      }
    }
    if (!receiver) return null
    const leaf = receiver.split("::").filter(Boolean).pop() ?? receiver
    if (leaf === "Module" && methodName === "new") return "Module"
    if ((leaf === "Struct" || leaf === "Data" || leaf === "Class") && (methodName === "new" || methodName === "define")) return "Class"
    return null
  }

  /** Extract superclass from class node — pure char scan, no regex */
  /**
   * The node that NAMES the base type of a `class X < Base` declaration: the
   * first named child of the `superclass` node, i.e. `Base` as written. The
   * `superclass` node itself begins at the `<` token, which sits on the previous
   * line whenever the base is wrapped — so it is the wrong anchor for a line.
   */
  private superclassTargetNode(node: Node): Node | null {
    const superNode = this.findChild(node, "superclass")
    if (!superNode || superNode.namedChildCount === 0) return null
    return superNode.namedChild(0)
  }

  private extractSuperclass(node: Node): string | undefined {
    const superNode = this.findChild(node, "superclass")
    if (!superNode) return undefined

    // Prefer the TYPE NODE's own text, trimmed. The `superclass` node includes
    // the `<` marker and every character the source put between `<` and the
    // name. Measured on a WRAPPED superclass (`class Widget <\n    Base`), the
    // old strip of `<`, spaces and tabs left "\n    Base": a target carrying a
    // newline, which is not a class name and cannot match the class it names.
    // Two consequences, both real and both invisible until a fixture wrapped the
    // base: the `extends`/`overrides` TARGETS disagreed with the differential's
    // trimmed truth (a latent missing+unexplained pair), and the in-file
    // override this declares could never be verified, so it was silently
    // downgraded to a 0.5 first-parent guess (`metadata.superClass` carried the
    // newline too — a payload field, not just an edge).
    const target = this.superclassTargetNode(node)
    if (target?.text) return target.text.trim()


    // Fallback (malformed/partial trees with no named child): strip the marker.
    // R1 ("no regex") as a char scan: drop the leading `<`, then leading
    // whitespace. Written out because this was the ruby ANALYZER's only regular
    // expression and §3.7-R1 of reviews/m60-oo-family-plan.md claimed the other
    // OO lanes carried none — a claim the analyzer census refutes (php and ruby,
    // one each). The `\s` class is ASCII here by construction: the grammar's
    // whitespace between `<` and a class name is space/tab/newline/CR.
    // EXACTLY one leading `<` (the expression's `^<`), then whitespace: a loop
    // that stripped every leading `<` was this rewrite's first attempt and the R1
    // probe caught the divergence on `<<Foo` — the regex left it `"<Foo"` and the
    // loop returned `"Foo"`. Kept as a single conditional so the rewrite states the
    // same rule the expression did.
    const rawText = superNode.text
    let i = rawText.charCodeAt(0) === 60 ? 1 : 0
    while (i < rawText.length && isAsciiWhitespace(rawText.charCodeAt(i))) i++
    const text = rawText.substring(i).trim()
    return text.length > 0 ? text : undefined
  }

  /** Extract parameters from method node */
  private extractParameters(node: Node): ASTEngine.Parameter[] | undefined {
    const params = this.findChild(node, "method_parameters") ||
                   this.findChild(node, "parameters")
    if (!params) return undefined

    const result: ASTEngine.Parameter[] = []
    for (let i = 0; i < params.namedChildCount; i++) {
      const child = params.namedChild(i)
      if (!child) continue
      const childType = child.type
      if (childType === "identifier") {
        result.push({ name: child.text })
      } else if (childType === "optional_parameter") {
        const name = child.childForFieldName("name")
        if (name) result.push({ name: name.text })
      } else if (childType === "keyword_parameter" || childType === "keyword_rest") {
        const name = child.childForFieldName("name")
        if (name) result.push({ name: name.text })
      } else if (childType === "splat_parameter" || childType === "hash_splat_parameter") {
        const name = child.childForFieldName("name")
        if (name) result.push({ name: name.text })
      } else if (childType === "block_parameter") {
        // `def foo(&block)` — `block` is a bound local of the body. The
        // pinned grammar has no `block_var` node; the identifier is a direct
        // child. Skipping the name leaked it as a bogus bare call.
        const name = child.childForFieldName("name") ?? child.namedChild(0)
        if (name && name.type === "identifier") result.push({ name: name.text })
      } else if (childType === "destructured_parameter") {
        // |a, b| — extract sub-identifiers
        for (let j = 0; j < child.namedChildCount; j++) {
          const sub = child.namedChild(j)
          if (sub && sub.type === "identifier") {
            result.push({ name: sub.text })
          }
        }
      }
    }
    return result.length > 0 ? result : undefined
  }

  /** Return true for a bare visibility directive that affects following methods. */
  private isNoArgumentVisibilityMarker(node: Node): boolean {
    if (node.type === "identifier") {
      return node.text === "private" || node.text === "protected" || node.text === "public"
    }
    if (node.type !== "call") return false
    const method = node.childForFieldName("method")
    if (!method || (method.text !== "private" && method.text !== "protected" && method.text !== "public")) return false
    const args = this.findChild(node, "argument_list")
    return !args || args.namedChildCount === 0
  }

  /** Per-symbol cyclomatic complexity (managed-OO family contract —
   * csharp #264 wave precedent). Mirrors the file-level counter's node set
   * (if/unless/while/until/case/rescue/elsif PLUS the postfix *modifier
   * forms), scoped to one method/function subtree; base 1.
   *
   * Postfix conditionals MUST count: `return false if amount <= 0` is a
   * genuine branch — semantically identical to the block form, and the most
   * idiomatic Ruby. tree-sitter-ruby emits a DISTINCT node type
   * (if_modifier/unless_modifier/while_modifier/until_modifier/
   * rescue_modifier) for postfix forms; before this fix the analyzer counted
   * only the block forms, under-reporting every modifier-heavy method
   * (verified: fixture authorize has 2 if_modifier + 1 while = complexity 4,
   * previously pinned at the wrong value 2). */
  private calculateNodeComplexity(node: Node): number {
    if (!node) return 1
    let complexity = 1
    const stack: Node[] = [node]
    let guard = 0
    while (stack.length > 0 && guard++ < 200000) {
      const n = stack.pop()!
      if (n.type === "if" || n.type === "unless" || n.type === "while" ||
          n.type === "until" || n.type === "case" || n.type === "rescue" ||
          n.type === "elsif" || n.type === "if_modifier" ||
          n.type === "unless_modifier" || n.type === "while_modifier" ||
          n.type === "until_modifier" || n.type === "rescue_modifier") {
        complexity++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) stack.push(child)
      }
    }
    return complexity
  }

  /**
   * Evidence-tier classification — same rules as the swift/dart/csharp/objc
   * family (see swift wave #266 for the full rationale).
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      const md: any = r.metadata ?? {}
      if (type === "contains") { md.evidenceClass = "structural"; continue }
      if (type === "imports" || type === "exports" || type === "references") { md.evidenceClass = "import_based"; continue }
      if (type === "calls" || type === "uses") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (type === "instantiates" || type === "extends" || type === "implements") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      if (type === "overrides") {
        // M37.10 family contract: verified overrides are structural; a
        // Pass-3 first-parent guess is only "inferred" (the external base
        // may not even declare the method).
        md.evidenceClass = (r.confidence ?? 0) >= 0.9 ? "structural" : "inferred"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  private findChild(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child && child.type === type) return child
    }
    return null
  }

  /** Strip leading ': ' from symbol text — pure char scan */
  /**
   * Record a detected framework EXACTLY ONCE, and publish the primary pick (#749).
   *
   * Both accumulators are arrays published into the graph, and every caller runs once
   * per class and once per call, so a bare `.push` published one entry per trigger hit:
   * measured, `["Ruby on Rails", "Ruby on Rails", …]` five times on a five-model file
   * and three times on `rack/test.rb`. `metadata.framework` — the contract's
   * deterministic primary pick — was published for nothing at all, so every file that
   * DID detect Rails read as framework-less downstream.
   */
  private recordFramework(metadata: Partial<ASTEngine.FileMetadata>, name: string, pattern?: string): void {
    const detected = (metadata.detectedFrameworks ??= [])
    if (!detected.includes(name)) detected.push(name)
    metadata.framework ??= name
    if (!pattern) return
    const patterns = (metadata.frameworkPatterns ??= [])
    if (!patterns.some((p) => p.framework === name)) patterns.push({ framework: name, patterns: [pattern] })
  }

  private stripSymbolColon(text: string): string {
    let start = 0
    while (start < text.length && text[start] === ":") start++
    return start < text.length ? text.substring(start) : text
  }

  /** Strip surrounding quotes — pure char scan */
  private stripQuotes(text: string): string {
    if (text.length >= 2) {
      const first = text.charCodeAt(0)
      const last = text.charCodeAt(text.length - 1)
      if ((first === 34 && last === 34) || (first === 39 && last === 39)) {
        return text.substring(1, text.length - 1)
      }
    }
    return text
  }

  /** Extract the leaf name from a possibly-qualified name like A::B */
  private leafName(name: string): string {
    const idx = name.lastIndexOf("::")
    return idx >= 0 ? name.substring(idx + 2) : name
  }

  private isStaticSuperclassName(text: string): boolean {
    return isRubyStaticSuperclassName(text)
  }

  private isRailsModelName(superClass: string | undefined): boolean {
    if (!superClass) return false
    const leaf = this.leafName(superClass)
    return leaf === "Base" && superClass.includes("ActiveRecord") || leaf === "ApplicationRecord"
  }

  private isRailsControllerName(superClass: string | undefined): boolean {
    if (!superClass) return false
    const leaf = this.leafName(superClass)
    return leaf === "Base" && superClass.includes("ActionController") || leaf === "ApplicationController"
  }

  /**
   * M59.A7 (#825): the 1-based line of the node that NAMES an edge's target.
   *
   * The contract is the family's, not this file's: a relationship's `line_number`
   * is the line where the TARGET is written — the callee for a call, the read for
   * a member use, the constructed type for an instantiation, the symbol's own
   * declaration for contains/overrides. It is checked independently by
   * script/m59/oracle-callsite.ts, which re-derives every edge from the tree and
   * requires the target token to appear on the claimed line.
   *
   * Two shapes are traps and both were measured on the python lane first:
   *   * a call's node starts at its RECEIVER, so `items.strip.upper` stamped the
   *     whole call on the `items` line — hence the method field's node below,
   *     which in this grammar IS the leaf that names the callee;
   *   * `undefined` is a first-class answer. A node that does not exist (a dynamic
   *     mixin, a computed callee) contributes NO line rather than a fabricated 0,
   *     which is the rule `0 means unknown and unknown must be absent` (#820/#821)
   *     applied to this field.
   */
  private nodeLine(node: Node | null | undefined): number | undefined {
    if (!node) return undefined
    return node.startPosition.row + 1
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
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
