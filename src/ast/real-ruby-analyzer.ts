// Ruby Intelligence Engine — Author: Muhammad Ishaq Khan
// What this file is: the pure-AST analyzer for Ruby (.rb, routed by src/ast/language-detection.ts); it
// produces the symbols and relationships the graph engine stores.
// Relationship types covered (the emitted set, stated so the contract row cannot drift from this file
// again): calls, uses, contains, imports, references, exports, extends, mixes_in, overrides,
// instantiates. FOUR OF THESE — `exports`, `imports`, `overrides`, `references` — were MISSING from
// this lane's contract row and were found by the reverse check (the analyzer published them while the
// row did not name them). They are named now; if this file starts or stops emitting one of the ten,
// EDIT THE ROW IN THE SAME COMMIT and say which layer emits it.
// RUBY-D1 (ALL-OUT-OF-ALL phase 2, 2026-10-19): `implements` is RULED OUT of this set — Ruby's grammar
// has no interface/conformance construct, and the family's old adaptation (include/prepend -> implements,
// extend -> extends) was WRONG on both axes: include/prepend compose a module into the ancestor chain
// and extend composes it into the SINGLETON class, i.e. module mixin composition, which the canonical
// vocabulary spells `mixes_in` (source = composing class/module, target = mixin, metadata.mixinType =
// include|prepend|extend). The relabel happened at UNCHANGED construct sites and the delta closes
// exactly (cap-50: implements 17 -> 0, extends 48 -> 44, mixes_in 0 -> 21 = 17 + 4, table totals
// byte-identical). Do not reintroduce `implements` here without a ruling that reverses RUBY-D1.
// Where its scripts and validations live: script/m14/spec/ruby-completeness.json · fixtures
// validation/m14/fixtures/ruby/** (`bun run script/m14/run-fixtures.ts --lang ruby`) · lane doc
// docs/analyzers/real-ruby-analyzer.md.
// WHEN THIS FILE CHANGES, EDIT THESE TOO (the co-edit list): docs/analyzers/real-ruby-analyzer.md, the
// spec JSON's emission sites and requiredKinds row, and the fixtures/expectations pinning a changed edge.
// Grammar: tree-sitter-ruby (wasm/tree-sitter-ruby.wasm).

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
 * The ONE reopen-identity rule, for every site that has to name a class or
 * module the way the symbol table does.
 *
 * `class M::Inner` and `module M; class Inner` declare the same type, so the
 * graph must give them one identity: name = the LEAF, owner = the scope path
 * RELATIVE TO THE ENCLOSING owner. RUBD13 promised that and it held by accident
 * for two-segment names, where the first and last `::` coincide; for three or
 * more they do not, and `class Admin::Announcements::DistributionsController`
 * split on the first separator produced a symbol named
 * `Announcements::DistributionsController` owned by `Admin` while the nested
 * spelling produced `DistributionsController` under Admin > Announcements. The
 * file's own `leafName` split on lastIndexOf, so the analyzer carried two rules
 * that disagreed.
 *
 * Extracted because a THIRD reader needed it: the private-constant pre-pass
 * below has to name the same owner to match a `private_constant :X` against the
 * constant it hides, and a fourth copy of a rule that decides symbol IDENTITY is
 * how the two existing copies came to disagree. One function, three callers.
 */
function rubyReopenIdentity(rawName: string, enclosingOwner: string | undefined): { name: string; owner: string | undefined } {
  const sepIdx = rawName.lastIndexOf("::")
  if (sepIdx < 0) return { name: rawName, owner: enclosingOwner }
  const name = rawName.substring(sepIdx + 2)
  const scopeOwner = rawName.substring(0, sepIdx)
  // An ABSOLUTE reopen names no scope at all: `class ::ReceiverClass` has an EMPTY
  // prefix, so it is a top-level declaration, not a member of a class called "".
  // The prefix used to be used verbatim, so the owner became the empty string —
  // which is truthy, so the symbol kept an owner and the `contains` pass published
  // an edge whose SOURCE was "" (spec/ruby/core/exception/receiver_spec.rb:5).
  // An empty owner is also worse than a missing one: it resolves to no symbol and
  // reads as though it named one.
  if (scopeOwner.length === 0) return { name, owner: enclosingOwner }
  return { name, owner: enclosingOwner ? `${enclosingOwner}::${scopeOwner}` : scopeOwner }
}

/**
 * The FILE as a graph unit: its basename with the extension removed.
 *
 * A require is a file-to-file fact, and the `imports` edge's whole value over the
 * `references` edge it sits beside is that its SOURCE names the importing FILE
 * rather than a scope sentinel (`parallel-indexer.ts` reads
 * `metadata.fileLevel === true` and binds `source_external` to the project-
 * relative path for exactly this reason). Python (`moduleName`), Dart
 * (`moduleName`) and bash (`scriptName`) all name the file the same way, and the
 * weak part of the convention is the same for all three: two files can share a
 * stem. That is recorded as a limitation rather than papered over, because the
 * alternative — the `Global` sentinel — names no unit at all.
 *
 * An empty basename (a caller that passes no path) falls back to the declared
 * file-scope owner rather than publishing an edge with an empty source.
 */
function rubyFileUnitName(filePath: string | undefined): string {
  if (!filePath) return FILE_SCOPE_OWNER
  // Character scan, no regex (R1: this file carries zero regex literals and zero
  // `new RegExp`, and that is a property of the construction rather than a lint).
  // The first version used `filePath.replace(/\\/g, "/")`, which put the file's
  // only regular expression back — one token, and it would have taken the lane's
  // standing regex-census figure from 0 to 1 without changing a single edge.
  let end = filePath.length
  while (end > 0) {
    const c = filePath.charCodeAt(end - 1)
    if (c === 47 /* / */ || c === 92 /* \ */) break
    end--
  }
  const tail = filePath.substring(end)
  if (tail.length === 0) return FILE_SCOPE_OWNER
  const dot = tail.lastIndexOf(".")
  let stem = dot > 0 ? tail.substring(0, dot) : tail
  // A stem that still carries a DOT (`foo.bar.rb`) is rewritten, and this is not
  // cosmetic: `parallel-indexer`'s export filter drops an `exports` edge whose
  // source matches `/^[a-z][a-z0-9_.]*$/` AND contains a dot, because that is the
  // JS/TS `module.exports.a` shape. So a dotted source would be silently deleted
  // on the way to the index — an edge published, stored nowhere, and invisible to
  // every check except a payload census.
  if (stem.indexOf(".") >= 0) {
    let out = ""
    for (let i = 0; i < stem.length; i++) out += stem[i] === "." ? "_" : stem[i]
    stem = out
  }
  return stem.length > 0 ? stem : FILE_SCOPE_OWNER
}

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

/**
 * Ruby's three bare visibility keywords. A DECLARATION, never a call — the same
 * rule the top-level walk applies to an `identifier` node and the differential
 * oracle applies as `isVisibilityDirective`. Named once so the two analyzer
 * sites cannot drift apart again.
 */
function isRubyVisibilityDirectiveName(name: string): boolean {
  return name === "private" || name === "protected" || name === "public"
}

const BARE_CALL_SKIP_PARENTS = new Set([
  // `call` — the METHOD NAME of a call node is part of the call, not a bare
  // read: `Mutex.new` must not also read as a bare `new`. The pinned grammar
  // folds every call shape — paren'd (`foo(1)`), paren-less command (`foo 1`),
  // and command-with-block (`foo 1 do ... end`) — into `call` nodes, and
  // `command` / `command_call` are not node types it can produce. This set USED
  // to carry those two as "grammar-version drift" insurance, which cost two
  // dead branches (a skip entry that can never match, and a `type ===` arm
  // that can never fire) and made the file cite a grammar audit as proof of a
  // claim the audit could not see.
  //
  // Removing the two dead entries is a one-token edit with a real failure mode
  // and the rack-wave fixture caught it immediately: the same edit dropped
  // `call` itself, and every constructor call in a default argument
  // (`def initialize(app, mutex = Mutex.new)`) began reading its `new` as a
  // bare call as well — `calls initialize->new`, a fabricated edge the RB-A
  // fixture has forbidden since the rack wave. A cleanup of two provably dead
  // strings was never a safe place to be casual about the live one beside them.
  "call",
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
  // Module-level visibility MODIFIER METHODS. `private_constant :X` is not a
  // keyword in this grammar — it is an ordinary `call` on Module — and it was
  // missing from this list, so it published `calls <owner> -> private_constant`:
  // an edge whose target is a stdlib method no project declares, which is the same
  // shape as every other entry above and the reason they are here. Found by the
  // oracle-agreement suite, whose negative case asserts the modifier is not a
  // call: the oracle suppressed it (it lists both names among its visibility
  // modifiers) and the analyzer did not, and the analyzer is the side whose
  // suppression list IS the contract — `RUBY_BUILTINS` is a list of things the
  // payload does not carry as call targets, not a judgement about Ruby.
  //
  // The DECLARATION side is not lost: `private_constant`'s effect on the export
  // surface is read by `collectPrivateConstants`. So the pair is the same shape as
  // `attr_reader` (declares a member, no call edge) and `module_function`
  // (declares, no call edge). Measured on the corpus: 142 `private_constant` and
  // 2 `public_constant` sites.
  "private_constant", "public_constant",
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
/**
 * Is this instance_variable node a WRITE target rather than a READ?
 *
 * RUBD1/RUBD5/SCD1 already say the answer for the single-target forms: both
 * `assignment` (@x = v) and `operator_assignment` (@x += / -= / ||= v) put a
 * write on the left, and the family contract gates compound assignment too. The
 * MULTIPLE form escaped, and it escaped on BOTH sides of the differential — the
 * analyzer and the oracle carry the same two-line predicate — so the read
 * oracle agreed with the analyzer and the lane measured 100%/0% while false
 * edges sat in the payload.
 *
 * `@height, @width = h, w` parses as
 *
 *   assignment
 *     left_assignment_list      <- the two instance_variables: WRITES
 *     right_assignment_list     <- `h, w`: the values
 *
 * so a write target's parent is the LIST, never the `assignment`, and a test
 * that requires `parent.type === "assignment"` is simply false for it.
 *
 * Two shapes must NOT be swept in with it, and the reason is that they genuinely
 * READ: you cannot assign through a receiver without reading it.
 *
 *   @cfg.limit = x      left is a `call`;            @cfg is read
 *   @list[i] = v        left is an `element_reference`; @list is read
 *
 * A first draft of the fix took "anything in the LHS subtree" and reported 426
 * false reads on the rails stride — 7x the true count, because it caught those
 * two. See reviews/ruby/m60-deep-round.md §9a.
 *
 * Measured once fixed: rails 59, rubocop 3, mastodon 4 — 66 edges in 23 files
 * per 1,200 sampled.
 */
export function isRubyInstanceVariableWrite(node: Node): boolean {
  const parent = node.parent
  if (!parent) return false

  // FORM 1 — the node IS the assignment's `left`: `@x = v`, `@x += v`.
  if (parent.type === "assignment" || parent.type === "operator_assignment") {
    const left = parent.childForFieldName("left")
    if (!left || left.id !== node.id) return false
    // A receiver is READ even when the assignment writes through it, so
    // `@cfg.limit = x` and `@list[i] = v` must stay reads.
    return left.type !== "call" && left.type !== "element_reference"
  }

  // FORM 2 — the node is a BARE target inside the `left` LIST of a multiple
  // assignment: `@a, @b = …`, `@a, * = …`. The list is `assignment.left`, and
  // a list has no `left` field of its own, so the check has to go UP one level
  // and confirm the list really is the target side.
  if (parent.type === "left_assignment_list") {
    const grand = parent.parent
    if (!grand || (grand.type !== "assignment" && grand.type !== "operator_assignment")) return false
    const left = grand.childForFieldName("left")
    if (!left || left.id !== parent.id) return false
    const _nc1 = parent.namedChildCount
    for (let i = 0; i < _nc1;
 i++) {
      const c = parent.namedChild(i)
      if (c && c.id === node.id) return c.type !== "call" && c.type !== "element_reference"
    }
  }

  return false
}

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

/**
 * Is `name` a plain identifier — `[A-Za-z_$][A-Za-z0-9_$]*` and nothing else?
 *
 * A CHAR SCAN rather than a regular expression, for the same reason the rest of this file
 * scans: `script/m14/no-regex-gate.sh` delegates to the tree-sitter regex census, and a
 * `new RegExp` here would add a use to it. The set is the ARBITER'S OWN
 * (`script/m14/incoming-rule.ts`: the declared-cause claim is admitted only when the reason
 * "must be identifier-shaped and must be the target's own owner").
 *
 * It exists for exactly one caller: whether a first-parent guess may state WHY it could not
 * reach its base. A base that is not identifier-shaped — whitespace that survived a lexical
 * scan, an operator name — must stay silent there rather than be REFUTED, because a refuted
 * cause is counted against the lane (clause 4).
 */
export function isRubyIdentifierShaped(name: string): boolean {
  if (!name) return false
  const isAlpha = (c: number): boolean => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36
  const isDigit = (c: number): boolean => c >= 48 && c <= 57
  if (!isAlpha(name.charCodeAt(0))) return false
  for (let i = 1; i < name.length; i++) {
    const c = name.charCodeAt(i)
    if (!isAlpha(c) && !isDigit(c)) return false
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
      // Set when this frame is INSIDE the block of an anonymous dynamic class
      // (`anon = Class.new(Base) do ... end`). See the assignment branch.
      anonBinding?: string
      /**
       * Set on every frame INSIDE a `singleton_class` body, and reset by a nested
       * class or module. A method declared there belongs to ONE object's singleton,
       * so it is never part of the file's importable surface — which is a fact the
       * symbol table cannot express, because `class << obj` (a LOCAL receiver) has
       * no owner to record, and because `private def m` wraps the def in a `call`
       * whose frame push hardcoded `isSingleton: false`, losing the flag.
       *
       * It exists because the export surface asked a question the payload could not
       * answer: `class << obj; private def coerce(n); end; end`
       * (spec/ruby/core/integer/divide_spec.rb) published a `Function` symbol named
       * `coerce` with NO owner, and an ownerless Function reads as a top-level
       * method, so the export pass published `exports <file> -> coerce` for a
       * private singleton method of a local object. Eleven such edges across the
       * corpus, found by the oracle census rather than by a fixture.
       */
      inSingletonClass: boolean
    }[] = [{
      node: rootNode,
      owner: undefined,
      ownerKind: undefined,
      visibility: "public",
      isSingleton: false,
      inSingletonClass: false,
    }]

    while (stack.length > 0) {
      const frame = stack.pop()!
      const { node, owner, ownerKind, visibility, isSingleton, anonBinding, inSingletonClass } = frame
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
        // LAST `::`, not the first, and the prefix resolved RELATIVE TO the
        // enclosing owner -- `rubyReopenIdentity`, the one copy of that rule.
        const { name, owner: effOwner } = rubyReopenIdentity(rawName, owner)
        const sepIdx = rawName.lastIndexOf("::")

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
            // A class declared inside a `class << obj` body lands on that object's
            // SINGLETON, so no consumer can reach it by name. The module branch
            // below carries the same marker for the same reason, and the export
            // pass reads it for both.
            ...(inSingletonClass ? { declaredInSingletonClass: true } : {}),
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
          const _nc2 = body.namedChildCount
          for (let i = 0; i < _nc2;
 i++) {
            const child = body.namedChild(i)
            if (!child) continue
            bodyFrames.push({
              node: child,
              owner: name,
              ownerKind: "class",
              visibility: bodyVisibility,
              isSingleton: false,
              // A named class declared inside an anonymous block is a REAL
              // class with a real name, so the anonymous binding does not
              // carry into it.
              anonBinding: undefined,
              // Nor does a singleton-class scope: `class << obj; class K; end;
              // end` declares K in the file, not on obj's singleton.
              inSingletonClass: false,
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
          const _nc3 = superNode.namedChildCount
          for (let i = 0; i < _nc3;
 i++) {
            const sc = superNode.namedChild(i)
            // The pinned grammar folds every paren-less/paren'd call into
            // `call`, so only that type is matched here (`command` /
            // `command_call` are not node types it can produce).
            if (sc && sc.type === "call") {
              stack.push({ node: sc, owner, ownerKind, visibility, isSingleton: false, inSingletonClass })
            }
          }
        }
        continue
      }

      // --- Module ---
      if (type === "module") {
        const nameNode = node.childForFieldName("name")
        if (!nameNode) continue
        // Same reopen identity as the class branch above, for the same reason,
        // through the SAME function: `module A::B::C` is one identity with
        // `module A; module B; module C`, with the prefix resolved relative to
        // the enclosing owner (`module Outer; module Inner::Deep` names
        // `Outer::Inner::Deep`).
        const rawName = nameNode.text
        const { name, owner: effOwner } = rubyReopenIdentity(rawName, owner)
        const sepIdx = rawName.lastIndexOf("::")

        const sym: ASTEngine.UniversalSymbol = {
          name,
          kind: ASTEngine.SymbolKind.Module,
          range: this.nodeToRange(node),
          ownerName: effOwner,
          metadata: {
            ...(sepIdx >= 0 ? { fqn: rawName } : {}),
            // A module declared inside a `class << obj` body lands on that object's
            // singleton; the class branch above carries the same marker for the
            // same reason.
            ...(inSingletonClass ? { declaredInSingletonClass: true } : {}),
          },
        }
        symbols.push(sym)
        const body = this.findChild(node, "body_statement")
        if (body) {
          const bodyFrames: typeof stack = []
          let bodyVisibility = "public"
          const _nc4 = body.namedChildCount
          for (let i = 0; i < _nc4;
 i++) {
            const child = body.namedChild(i)
            if (!child) continue
            bodyFrames.push({
              node: child,
              owner: name,
              ownerKind: "module",
              visibility: bodyVisibility,
              isSingleton: false,
              anonBinding: undefined,
              inSingletonClass: false,
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
          metadata: {
            ...(isSingleton ? { isSingleton: true } : {}),
            // Declares that `ownerName` is the LEXICAL owner, not the class
            // this method actually belongs to: the method is defined in the
            // block of an anonymous dynamic class bound to `anonBinding`.
            ...(anonBinding ? { anonymousScopeBinding: anonBinding } : {}),
            // ...and that the method belongs to ONE object's singleton, which is
            // not the same statement: `ownerName` can be right while the method
            // is still unreachable by any name from outside.
            ...(inSingletonClass ? { declaredInSingletonClass: true } : {}),
          },
        }
        symbols.push(sym)

        const enclosingMethod = name

        // The method's own local set: parameter NAMES plus every name a
        // parameter DEFAULT assigns. Ruby evaluates a default in the method's
        // own scope, so `def all(all_queries: (seen = true))` makes `seen` a
        // local of `all` and `return nil if seen` is a LOCAL READ, not a call.
        // walkBody's pre-scan only ever saw the body subtree, so those names
        // were unbound there and every read of one became a fabricated
        // `calls` edge (measured on rails:
        // activerecord/lib/active_record/scoping/named.rb:23 emitted
        // `calls all -> all_queries_not_set` for a name the very signature
        // binds). One set feeds the body AND the default walk, so a default
        // that reads a sibling default's binding also resolves as a local.
        const locals = new Set<string>((params ?? []).map((p) => p.name))
        for (const bound of this.extractParamDefaultBindings(node)) locals.add(bound)

        // Walk body (endless `def f = expr` has no body_statement — the
        // body is a direct expression child; without this the whole body
        // was invisible: probe-verified `def fetch = client.get` emitted
        // nothing while the oracle derives calls->get).
        this.walkMethodBody(node, this.findChild(node, "body_statement"), symbols, relationships, imports, metadata,
          owner, ownerKind, enclosingMethod, visibilityOverrides,
          new Set(locals))
        // Default-argument VALUE expressions run in this method's scope at
        // call time (`mutex = Mutex.new`, `params = Rack::Utils.…`) — surface
        // their calls/reads too (RB-B, rack wave; the oracle truth walks
        // parameter values).
        this.walkParamDefaults(node, symbols, relationships, imports, metadata,
          owner, ownerKind, enclosingMethod, visibilityOverrides,
          new Set(locals))

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
          const _nc5 = body.namedChildCount
          for (let i = 0; i < _nc5;
 i++) {
            const child = body.namedChild(i)
            if (!child) continue
            bodyFrames.push({
              node: child,
              owner,
              ownerKind: "class",
              visibility: bodyVisibility,
              isSingleton: true,
              anonBinding: undefined,
              inSingletonClass: true,
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
          metadata: {
            isSingleton: true,
            ...(anonBinding ? { anonymousScopeBinding: anonBinding } : {}),
            ...(inSingletonClass ? { declaredInSingletonClass: true } : {}),
          },
        }
        symbols.push(sym)

        // Walk body (endless bodies included — see walkMethodBody).
        // Locals = parameter names PLUS the names a parameter DEFAULT assigns
        // (Ruby evaluates a default in the method's scope) — same rule and
        // same reason as the `method` branch above.
        const locals = new Set<string>((params ?? []).map((p) => p.name))
        for (const bound of this.extractParamDefaultBindings(node)) locals.add(bound)
        this.walkMethodBody(node, this.findChild(node, "body_statement"), symbols, relationships, imports, metadata,
          owner, ownerKind, name, visibilityOverrides,
          new Set(locals))
        // Singleton-def receiver (`def @rio.check?`): the receiver object
        // is evaluated at definition time, so an instance-variable
        // receiver reads (`uses->@rio`, matching the oracle). ONLY ivars:
        // identifier receivers are virtually always bound locals (spec
        // setups like `def obj.close` — visiting them fabricated
        // calls->obj), and constants/self never read. Probe-verified on
        // rack minitest specs both ways.
        const _nc6 = node.namedChildCount
        for (let i = 0; i < _nc6;
 i++) {
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
          new Set(locals))

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
          else if (c.type === "simple_symbol") {
            // `alias :"a \"b\"" old` names a method the analyzer can only state if
            // the escape resolves — `rubyNameFromLiteral`, the one rule every
            // name-publishing site uses. A name it declines is skipped rather than
            // published with a backslash in it.
            const n = this.rubyNameFromLiteral(c)
            if (n !== undefined && n.length > 0) { names.push(n); nameNodes.push(c) }
          }
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
      if (type === "identifier" && isRubyVisibilityDirectiveName(node.text)) {
        continue
      }

      // --- Calls in top-level/module/class bodies ---
      // Method bodies are consumed by walkBody above, so this handles only
      // declaration-time calls such as require/include/attr_reader. Note the
      // recursion below: a declaration call's ARGUMENTS may themselves hold
      // calls (`require File.expand_path(...)`) which must still surface.
      if (type === "call") {
        this.processCall(node, symbols, relationships, imports, metadata,
          owner, undefined, visibilityOverrides, anonBinding)
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner, ownerKind, visibility, isSingleton: false, anonBinding, inSingletonClass })
        }
        continue
      }

      // --- Program/top-level statements ---
      // The root `program` node has no owner; forward its named children into
      // the same iterative traversal so top-level modules/classes are visited.
      if (type === "program") {
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner, ownerKind, visibility, isSingleton: false, inSingletonClass })
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
        // An ANONYMOUS dynamic class: the LHS is a local, not a constant, so
        // there is no name to declare — but the block still opens a class
        // scope, and every member written inside it belongs to THAT class, not
        // to the named class that lexically encloses the assignment. The frame
        // keeps the enclosing owner (reparenting onto a name that has no symbol
        // would trade one false edge for a dangling one, and the differential
        // has no truth for an anonymous scope to check either reparenting
        // against), and the binding is recorded on each member SYMBOL so the
        // misattribution is declared rather than silent. Measured on rails:
        // 24 association edges in activerecord/test/cases/associations alone
        // were written against a class that provably does not own them.
        let anonBindingForFrames: string | undefined = anonBinding
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
              // `K = Class.new(Base)` DECLARES A SUPERCLASS, and the lane doc has
              // carried the extends edge for it as owed since the m60 round:
              // "`Class.new(Base)` superclass edges are not emitted. The symbol
              // is the core fix; the extends edge for a factory base is still
              // owed." Ruby states the relationship in the call — `Class.new`
              // takes the superclass as its first argument and the resulting
              // class really does inherit from it — so the construct EXISTS and
              // this is a GAP inside an already-emitted type, not a ruling.
              // Measured over the corpus (rb-factory-define-probe.ts, the engine's
              // own getParser): `K = Class.new(<constant>)` 16 sites in 16 files
              // per the full 7,499-file sweep.
              //
              // RESTRICTED TO `Class.new`, and the restriction is the correctness
              // of the rule rather than a caution about it. `Struct.new(:a, :b)`
              // and `Data.define(:a, :b)` take MEMBER NAMES as their first
              // argument and have no superclass parameter at all, so a rule
              // accepting any factory receiver would publish
              // `extends Car -> wheels` for `Car = Struct.new(:wheels, :doors)`.
              // The ratio is what decides it: 29 member-name factories to 4 real
              // bases per 1,874-file stride, so a general rule would fabricate
              // about seven edges for every one it got right. A base that is a
              // CALL (`Class.new(base_for(x))`) is refused for the reason
              // `isStaticSuperclassName` exists — the concrete base is unknowable
              // — and measured at 0 over the corpus.
              const factoryBaseNode = this.factorySuperclassNode(right)
              const factoryBase = factoryBaseNode ? factoryBaseNode.text.trim() : undefined
              if (factoryBase && this.isStaticSuperclassName(factoryBase)) {
                relationships.push({
                  source: left.text,
                  target: this.leafName(factoryBase),
                  type: ASTEngine.RelationshipType.Extends,
                  confidence: 1.0,
                  // #825: the base type's own node names the edge, which is the
                  // first argument of the factory call.
                  line_number: this.nodeLine(factoryBaseNode),
                  metadata: {
                    // Both ends are WRITTEN — the constant on the left and the
                    // constant in the call — so this is structural evidence with
                    // no inferred name, unlike `instantiates`'
                    // `resolvedTarget: "enclosing-class"`. What the edge ASSERTS is
                    // `Class.new`'s documented meaning, which is Ruby rather than
                    // this file, and there is no `superclass` clause on the line
                    // for a reader to check; the mechanism is recorded so that is
                    // visible rather than implied.
                    definedBy: "Class.new",
                  },
                })
              }
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
          } else if (leftType === "identifier") {
            const right = node.childForFieldName("right")
            if (right && this.dynamicClassFactoryKind(right)) {
              // `anon = Class.new(Base) do ... end` — the ANONYMOUS form. No
              // symbol is declared (a local is not a type), and the block's
              // members are marked instead.
              anonBindingForFrames = left.text
            }
          }
          // Instance/class/global variables at class level: skip (noise)
        }
        // Recurse into the RHS so member calls/constructed calls inside
        // assignments (`x = File.expand_path(foo)`, `X = SomeService.new`)
        // are still surfaced. The assignment node was not otherwise recursed.
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) stack.push({ node: child, owner: factoryOwner ?? owner, ownerKind, visibility, isSingleton: false, anonBinding: anonBindingForFrames, inSingletonClass })
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
        if (!isRubyInstanceVariableWrite(node)) {
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
          // `anonBinding` is CARRIED here. Omitting it dropped the binding at
          // the first level of descent, so every member two or more levels
          // inside an anonymous block — which is to say, every member, since
          // the block body is itself a level — went out unmarked and the first
          // implementation of this marker marked nothing at all.
          if (child) childFrames.push({ node: child, owner, ownerKind, visibility, isSingleton: false, anonBinding, inSingletonClass })
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

    // --- Exports: the file's IMPORTABLE UNITS ---
    //
    // Ruby states no export, so the construct is a CONVENTION, and the reasoning
    // that would rule it out is the one this repository has already overturned
    // once: json's `exports` was ruled on "no export_statement node", and a
    // grammar cannot see a convention. What the language DOES state is
    // visibility — `private`, `protected`, `public`, `private_constant` — which
    // is a measured vocabulary (counts in the lane doc), not an assumed one.
    //
    // The SHAPE is not this lane's to invent. `run-fixtures.ts` carries the M49
    // exports-family invariant on every fixture of every language
    // (reviews/jvm-closure-audit.md, "exports-fork verdict"):
    //
    //   1. export names must be UNIQUE — a duplicate cannot identify its
    //      provider (java/groovy overloads emitted ["Svc","greet","greet"]);
    //   2. every export name must resolve to a TOP-LEVEL symbol — "an importable
    //      unit, i.e. a name an importer can bind", admitting ownerless
    //      file-scope units and namespace/module-owned ones, and REJECTING
    //      type-owned members with the words "membership rides Contains". That
    //      asymmetry IS the ruling.
    //
    // An earlier draft of this pass exported every public member of every class
    // and failed all nine ruby fixtures on both clauses, which is the gate doing
    // its job: it encodes that `import Cls` binds a type and never a bare member,
    // and Ruby has no syntax that binds a bare member of a class either. So the
    // surface is Ruby's TOP-LEVEL declarations — the names `require_relative`
    // puts in the loading file's scope:
    //
    //   `class K` / `module M` / `K = Struct.new(…)` / `CONST = v` / `def m`
    //
    // and it does NOT include a class member (that is `contains`), a nested type
    // (that is `contains`), or `def self.m` at file scope — `self` there is
    // `main`, whose singleton belongs to the loading process and is unreachable
    // from any other file, so it is a member of nothing a consumer can bind.
    //
    // The overlap with `contains` is therefore ZERO BY CONSTRUCTION, not by
    // assertion: `contains` is emitted only for a symbol that HAS an ownerName,
    // and every export is ownerless by this rule. That is what makes the second
    // label worth its bytes here — it names the top-level surface, which no
    // other edge in the payload names at all.
    //
    // The edge source is the FILE's unit (its basename without the extension),
    // which is the python (`moduleName`) and dart (`moduleName`) shape for the
    // same role. It is a path-derived convention and is DECLARED on the edge as
    // `resolvedTarget: "file-unit"`, mirroring the `resolvedTarget:
    // "enclosing-class"` marker `instantiates` already uses for a name implied
    // rather than written. The weakness is shared with those two lanes and is
    // recorded as a limitation: two files can share a stem.
    // GATED on the raw text, and the gate is the cheap direction. Measured on the
    // stride sample, the ungated pre-pass cost 25% of analyze throughput
    // (61.5 -> 49.1 files/s in the A/B, p95 59.6 -> 74.0 ms) for a construct that
    // appears in 73 of 7,500 corpus files. A substring test over the source cannot
    // MISS a `private_constant` — a tree can only contain one if the identifier
    // appears in the text — and a false positive (the word inside a comment or a
    // heredoc) costs one walk that finds nothing. The direction of the error is
    // therefore "walk when you did not have to", never "skip one you needed".
    const privateConstants = content.indexOf("private_constant") >= 0
      ? this.collectPrivateConstants(rootNode)
      : new Map<string, Set<string>>()
    const fileUnit = rubyFileUnitName(filePath)
    const exportedNames = new Set<string>()
    let exportDuplicate = 0
    let exportPrivateConstant = 0
    let exportUnnameable = 0
    let exportMainSingleton = 0
    let exportSingletonMember = 0
    for (const s of symbols) {
      // TOP-LEVEL ONLY, per the ruling above. An owned symbol is a member.
      if (s.ownerName) continue
      if (s.kind !== ASTEngine.SymbolKind.Class &&
          s.kind !== ASTEngine.SymbolKind.Module &&
          s.kind !== ASTEngine.SymbolKind.Constant &&
          s.kind !== ASTEngine.SymbolKind.Function) continue
      const name = String(s.name ?? "")
      // R7: a name that names nothing is not an export. Empty, whitespace, or a
      // template (`"#{…}"`), the last of which a macro argument can still carry.
      if (name.length === 0 || name.trim().length === 0 || name.indexOf("#{") >= 0) {
        exportUnnameable++
        continue
      }
      // `def self.m` at file scope is a singleton method on `main`: it is not
      // reachable from another file, so it is not an importable unit.
      if (s.isStatic) {
        exportMainSingleton++
        continue
      }
      // Anything declared inside a `class << obj` body belongs to that ONE
      // object's singleton and is unreachable by name from outside — a method
      // (`obj` is usually a local, so an ownerless Function reads exactly like a
      // top-level one) and a TYPE alike (`module PathAttr` inside
      // `class << Tempfile`, lib/tempfile.rb:599, is a constant on Tempfile's
      // singleton class, not a top-level one). The reader is
      // `metadata.declaredInSingletonClass`, set from a frame flag rather than from
      // `isStatic`, because `private def m` wraps the def in a `call` whose frame
      // push hardcoded `isSingleton: false`.
      if (s.metadata?.declaredInSingletonClass === true) {
        exportSingletonMember++
        continue
      }
      // `private_constant :X` removes X from the surface a consumer reaches by
      // name, whatever X's kind: the idiom is overwhelmingly a hidden error or
      // warning CLASS, and a factory-declared type (`Hidden = Struct.new(:b)`) is
      // a constant binding like any other. Gating this on the Constant kind was
      // the first version, and it exported exactly the factories a file declares
      // unexportable — found by the ontology fixture's own negative.
      // 142 `private_constant` and 2 `public_constant` sites in the corpus.
      const hidden = privateConstants.get(FILE_SCOPE_OWNER)
      if (hidden?.has(name)) {
        exportPrivateConstant++
        continue
      }
      // A reopen (`class K` twice in one file) or a factory that also has a
      // `class K` is ONE importable unit, so the list names it once.
      if (exportedNames.has(name)) {
        exportDuplicate++
        continue
      }
      exportedNames.add(name)
      exports.push({
        name,
        type: "export_surface",
        kind: s.kind,
        range: s.range,
        metadata: { unit: fileUnit, unitKind: "file", definedBy: s.metadata?.definedBy },
      })
      relationships.push({
        source: fileUnit,
        target: name,
        type: ASTEngine.RelationshipType.Exports,
        confidence: 1.0,
        line_number: s.range?.startLine,
        metadata: {
          // The unit name comes from the PATH, not from a declaration in the
          // file. Declared, so a consumer can tell an inferred unit from a
          // written one — the same convention `instantiates` uses.
          resolvedTarget: "file-unit",
          exportKind: s.kind,
        },
      })
    }
    metadata.exportsExcluded = {
      duplicateReopen: exportDuplicate,
      privateConstant: exportPrivateConstant,
      unnameable: exportUnnameable,
      mainSingleton: exportMainSingleton,
      singletonMember: exportSingletonMember,
      // Owned symbols are refused by RULE (the exports-family ruling), not by a
      // filter that could drift, so this is a constant rather than a count. It is
      // stated here so a reader does not have to infer it from the absence of a
      // number.
      memberByContains: "owned symbols are containment, not importable units",
    }

    // --- The OWNER-QUALIFIED identity of an owned method IS NOT PUBLISHED, and that ---
    // --- is a MEASURED decision rather than an omission. See `RUBY-FIX.md` §4.      ---
    //
    // This pass was written, landed, and run: it sets `qualifiedName = ownerName + "." + name`
    // on every owned method, which is what the lane's own override targets
    // (`target: base + "." + s.name`) have always spelled while publishing no declaration
    // that could answer them. It works — `overrides` 169 resolved, `unresolved` 14,229 ->
    // 13,122 on the cap-400 population — and it was REVERTED because of what it does to the
    // gate's BINDING-INTENT table: publishing a cross-file target's answering key moves 146
    // `overrides` edges from `nothingAnywhere` into `arbitraryTwin`, the file-crossing class
    // the incoming rule names as where the wrong picks live (8,839 -> 8,985 lane-wide). The
    // rule for this programme is explicit — if `arbitraryTwin` rises the change made the lane
    // worse — so the rise is reported and the change is not kept. The measured numbers for
    // BOTH halves (the gate table and a replay of production's four pre-suffix resolution
    // passes) are in `validation/m14/verification/RUBY-FIX.md` §4.
    //
    // WHAT REPLACED IT is the other half of the same finding and it IS kept: the reason the
    // lane already computed on those edges (`first-parent-guess`) is now routed onto the
    // arbiter's declared-cause channel, which is a statement and never a resolution — see the
    // override pass below.

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
          metadata: {
            isOverride: true,
            reasonCode: "first-parent-guess",
            // THE REASON, ROUTED WHERE THE ARBITER READS IT.
            //
            // The lane has stated why since M37.10 — `reasonCode: "first-parent-guess"` — and the
            // incoming gate never saw it: its declared-cause channel reads `baseBeyondRunScope`
            // (`script/m14/incoming-rule.ts:274`), so `causeOK` is 0 fleet-wide and the residual
            // reads as an unstated hole. The claim is the TRUE half of what this branch already
            // knows: the base is not declared in this file AND the companion index gave no opinion
            // (it is never populated in production, M37.10), so the run could not look. It is a
            // claim about the RUN, not about the project, which is why the arbiter reads it only
            // where the target names nothing and why it can never raise `resolved`.
            //
            // Three conditions, each of them the arbiter's own (`classifyEdge`):
            //   · the value must be IDENTIFIER-SHAPED and must BE the target's owner, or the
            //     claim is REFUTED (`causeFAIL`, counted against the lane, clause 4);
            //   · `base === s.ownerName` is the leaf-collapse self-collision guard's case
            //     (`class Rake::TestCase < Test::Unit::TestCase`): the run DID reach that
            //     spelling — it is the class's own leaf — so "beyond this run's reach" would be
            //     the wrong statement and that edge stays silent;
            //   · it is MUTUALLY EXCLUSIVE with every external marker, by the arbiter's rule.
            ...(base !== s.ownerName && isRubyIdentifierShaped(base)
              ? { baseBeyondRunScope: base }
              : {}),
          },
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

    // `exports` and `contains` share no (source, target) pair, and that is a
    // property of the RULES rather than a hope: `contains` is emitted only for a
    // symbol with an ownerName, and the exports-family ruling admits only
    // ownerless symbols. The count is still computed, because a rule that claims
    // zero overlap and is never measured is exactly the kind of claim this
    // repository keeps finding wrong. One linear pass over the containment pairs.
    const containsPairs = new Set<string>()
    for (const r of relationships) {
      if (r.type === ASTEngine.RelationshipType.Contains) containsPairs.add(`${r.source}\u0000${r.target}`)
    }
    let exportDuplicateOfContains = 0
    for (const r of relationships) {
      if (r.type === ASTEngine.RelationshipType.Exports && containsPairs.has(`${r.source}\u0000${r.target}`)) {
        exportDuplicateOfContains++
      }
    }
    metadata.exportsOverlappingContains = exportDuplicateOfContains

    // --- PROJECT INDEX consumption (task-22 phase 2). Behind BB_RUBY_INDEX_CONSUME=1, metadata-only,
    // FAIL-CLOSED on an absent or incomplete index (the index's own `complete` flag). A claim/consume
    // that could not verify falls back to the pre-index output, never to a guessed binding.
    const indexFacts = this.applyProjectIndexFacts(relationships, context)
    if (indexFacts !== undefined) (metadata as any).projectIndex = indexFacts

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
    const _nc7 = node.namedChildCount
    for (let i = 0; i < _nc7;
 i++) {
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
          const _nc8 = left.namedChildCount
          for (let i = 0; i < _nc8;
 i++) {
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
        const _nc9 = sn.namedChildCount
        for (let i = 0; i < _nc9;
 i++) {
          const c = sn.namedChild(i)
          if (!c) continue
          if (c.type === "identifier") {
            localNames.add(c.text)
          } else if (c.type === "destructured_parameter") {
            // tree-sitter-ruby has no `block_var`/`destructured_left`/`pattern_list`:
            // `|(x, y)|` parses as block_parameters > destructured_parameter,
            // whose children are the bound identifiers directly. The bound name
            // is NOT always a direct child: `|(head, *body)|` puts `body` under
            // a `splat_parameter`, and this branch used to read direct children
            // only, so `body` stayed unbound and every use of it became a
            // fabricated bare call — measured on rubocop
            // lib/rubocop/cop/cop_documentation.rb:65, which published
            // `calls tagged_sections -> body` for a block parameter. The
            // generic form-recursion the `else` branch uses is the right rule
            // here too, so both share one implementation.
            const inner: Node[] = [c]
            while (inner.length > 0) {
              const q = inner.pop()!
              if (q.type === "identifier") localNames.add(q.text)
              for (let j = 0; j < q.namedChildCount; j++) {
                const d = q.namedChild(j)
                if (d) inner.push(d)
              }
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
        const _nc10 = sn.namedChildCount
        for (let i = 0; i < _nc10;
 i++) {
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
        const _nc11 = sn.namedChildCount
        for (let i = 0; i < _nc11;
 i++) {
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
        const _nc12 = sn.namedChildCount
        for (let i = 0; i < _nc12;
 i++) {
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

    // ANONYMOUS dynamic classes inside this body: `anon = Class.new(Base) do
    // ... end` binds a LOCAL, so everything the block declares belongs to an
    // unnamed class — NOT to the method's owner. The top-level walk records
    // this on the frame; a method body has no frame stack, so the same fact is
    // recovered here as a node-id -> binding map and looked up at the one place
    // that publishes a member (the association branch of processCall). This is
    // where the measured damage is: rails writes these inside test METHODS
    // (activerecord/test/cases/associations — 24 association edges in one
    // directory), not at class-body scope.
    // Every anonymous factory assignment in the body, at ANY depth — a nested
    // `x = Class.new { y = Class.new { ... } }` puts the inner assignment
    // inside the outer block, so collecting only the body's direct children
    // found the outer one and missed the inner one entirely.
    const anonRanges: Array<{ lo: number; hi: number; binding: string }> = []
    {
      const scan: Node[] = [node]
      while (scan.length > 0) {
        const c = scan.pop()!
        if (c.type === "assignment") {
          const left = c.childForFieldName("left")
          const right = c.childForFieldName("right")
          if (left && left.type === "identifier" && right && this.dynamicClassFactoryKind(right)) {
            anonRanges.push({ lo: right.startIndex, hi: right.endIndex, binding: left.text })
          }
        }
        for (let j = 0; j < c.namedChildCount; j++) {
          const d = c.namedChild(j)
          if (d) scan.push(d)
        }
      }
    }
    // Nested anonymous classes resolve to the INNERMOST one. rails writes them
    // nested in the same statement —
    //   developer = Class.new(Base) {           # outer, binding `developer`
    //     developer_project = Class.new(Base) { # inner, binding `developer_project`
    //       belongs_to :developer               # belongs to the INNER one
    //     }
    //     has_many :developer_projects          # belongs to the OUTER one
    //   }
    // — and registering subtree membership in document order left the outer
    // assignment overwriting the inner one, so `belongs_to :developer` was
    // declared as a member of `developer` when it is a member of
    // `developer_project`. Narrowest containing range wins, and the list is
    // sorted once by width so the lookup is a first-hit scan.
    anonRanges.sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo))
    const anonBindingAt = (startIndex: number): string | undefined => {
      for (const r of anonRanges) {
        if (startIndex >= r.lo && startIndex <= r.hi) return r.binding
      }
      return undefined
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
      // `call` ALONE. The grammar has no `command` / `command_call` node type:
      // its 353 node types (enumerated from the pinned wasm at
      // wasm/tree-sitter-ruby.wasm) contain `call` and neither of the other
      // two, and a corpus sweep of 8,528 .rb files (4,024,840 named nodes,
      // rails + rubocop + mastodon) produced zero of either. The two dead arms
      // this replaces were invisible to M14.0.F1: the audit's `isTypeComparison`
      // only recognises `x.type === "lit"` (a member_expression ending in
      // `type`), and this file dispatches on a DESTRUCTURED LOCAL (`const
      // { type } = frame`), so F1 collected 38 of the file's 60 node-type
      // comparisons and could never have reported these two. Measured by
      // script/m14/tmp/rb-f1-vacuity-probe.ts.
      if (type === "call") {
        this.processCall(n, symbols, relationships, imports, metadata,
          owner, enclosingMethod, visibilityOverrides, anonBindingAt(n.startIndex))
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
        if (!isRubyInstanceVariableWrite(n)) {
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
   * Names a method's PARAMETER DEFAULTS assign, which are locals of the method
   * scope because Ruby evaluates a default expression in that scope.
   *
   * `def all(all_queries: (seen = true))` binds `seen`; a later
   * `return nil if seen` reads a local, not a method. walkBody's pre-scan only
   * ever saw the BODY subtree, so these names were unbound and every read of
   * one became a fabricated bare call — measured on rails in
   * activerecord/lib/active_record/scoping/named.rb:23, where the analyzer
   * published `calls all -> all_queries_not_set` for a name the signature on
   * line 22 itself binds.
   *
   * Only ASSIGNMENT targets are collected, and only from the VALUE position of
   * an `optional_parameter` / `keyword_parameter` — a bare call in a default
   * (`def f(lock = Mutex.new)`) is a real call and must stay one, so the value
   * is scanned for what it BINDS and the call walk is left to walkParamDefaults.
   * The left-hand side forms mirror the body pre-scan's: a plain identifier, and
   * the identifiers under a `left_assignment_list` (tree-sitter-ruby has no
   * `multiple_assignment` node, so `a, b = 1, 2` is one assignment whose left
   * is a list).
   */
  private extractParamDefaultBindings(node: Node): Set<string> {
    const names = new Set<string>()
    const paramsNode = this.findChild(node, "method_parameters") ||
                       this.findChild(node, "parameters")
    if (!paramsNode) return names
    const _nc13 = paramsNode.namedChildCount
    for (let i = 0; i < _nc13;
 i++) {
      const pc = paramsNode.namedChild(i)
      if (!pc) continue
      if (pc.type !== "optional_parameter" && pc.type !== "keyword_parameter") continue
      if (pc.namedChildCount < 2) continue
      // Children are [name, value]; scan the value subtree, skipping child 0.
      const stack: Node[] = []
      for (let j = 1; j < pc.namedChildCount; j++) {
        const c = pc.namedChild(j)
        if (c) stack.push(c)
      }
      while (stack.length > 0) {
        const n = stack.pop()!
        if (n.type === "assignment" || n.type === "operator_assignment") {
          const left = n.childForFieldName("left") ?? n.namedChild(0)
          if (left) {
            if (left.type === "identifier") {
              names.add(left.text)
            } else {
              for (let j = 0; j < left.namedChildCount; j++) {
                const s = left.namedChild(j)
                if (s && s.type === "identifier") names.add(s.text)
              }
            }
          }
        }
        // A block inside a default has its own scope: `def f(cb = -> { x = 1 })`
        // binds `x` inside the lambda, not in the method.
        if (n.type === "do_block" || n.type === "block") continue
        for (let j = 0; j < n.namedChildCount; j++) {
          const c = n.namedChild(j)
          if (c) stack.push(c)
        }
      }
    }
    return names
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
    const _nc14 = paramsNode.namedChildCount
    for (let i = 0; i < _nc14;
 i++) {
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
  // LOAD FACTS — one `require`-family site, THREE surfaces
  // ========================================================================

  /**
   * Everything a receiverless `require` / `require_relative` / `load` /
   * `autoload` of a literal path states. One function because the four call
   * sites this replaces were four copies of the same three pushes, and the
   * `references`/`imports` PAIR is exactly the kind of thing that must not be
   * half-applied: an earlier round of this file already lost a fix to a branch
   * that claimed a rule "already existed" above the code that implemented it.
   *
   *   1. `ImportInfo` — the brain_import row. Reaches the file-dependency engine.
   *   2. `references` — "this file mentions this path". Source is the declared
   *      file-scope owner. Pinned by three committed fixtures; unchanged.
   *   3. `imports` — "this file DEPENDS ON this path". The same target, a second
   *      label, and the reason is not cosmetic:
   *
   *        - it is the label the dependency surfaces and `bb_graph`/`bb_impact`/
   *          `bb_migrate` read. A graph query that narrows to `imports` sees
   *          nothing for ruby today, so "ruby has no file dependencies" is
   *          answerable from the graph and it is false.
   *        - `metadata.fileLevel` is what makes the SOURCE bind to the importing
   *          FILE: `parallel-indexer.ts` binds `source_external` to the
   *          project-relative path when the source names no symbol and the edge
   *          declares `fileLevel`. The `references` edge does not declare it, so
   *          its source stays the scope sentinel and no surface can answer "what
   *          does this file require".
   *
   *      bash emits the same pair for `source` (`isSourceImport` +
   *      `isSourceDependency` on the same normalized path), so this is the family
   *      precedent and not a ruby invention.
   *
   * The TARGET is the bare require path, not the `<path>:<item>` form the
   * js/python/dart lanes use. That is a property of the language, not a choice:
   * `require "json/parser"` names a FILE and Ruby has no syntax for requiring one
   * member of it, so there is no item to write after a colon. The consequence is
   * measured and declared: `import-resolution.ts` only considers `imports` rows
   * whose target contains a `:`, so these rows reach the graph and the dependency
   * engine but NOT that resolver. Inventing a `:*` suffix would buy admission to
   * a pass that then refuses `*` by design ("namespace-star-no-single-target") —
   * bytes and a target string that is not a path, for nothing.
   */
  private pushLoadFacts(
    node: Node,
    arg: Node,
    cleanText: string,
    methodName: string,
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
  ): void {
    // R7: a name that names nothing is not published. `require ''` and `load ""`
    // are legal Ruby — the test suite uses them to assert the failure
    // (test/ruby/test_settracefunc.rb:2594) — and they name no file, so the edge
    // would carry an EMPTY target. One site, and it was published under BOTH
    // labels; the full-corpus oracle census is what found it, because the oracle's
    // `push` refuses an empty target by construction and so could never agree with
    // an edge that has one. The pre-existing `references` forbid on an empty target
    // (the FIX-12 defect) did not catch it either, for the same reason: that forbid
    // is written against a target that a BROKEN expression receiver produced, and
    // here the receiver is absent and the string is empty.
    if (cleanText.length === 0) return
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
    relationships.push({
      source: FILE_SCOPE_OWNER,
      target: cleanText,
      type: ASTEngine.RelationshipType.Imports,
      confidence: 1.0,
      line_number: this.nodeLine(arg),
      metadata: {
        requireMethod: methodName,
        // The importer is the FILE, not a scope — see the note above.
        fileLevel: true,
        // HOW the path is resolved, which is decidable per method and is the
        // only classification that is a fact rather than a guess:
        // `require_relative` is relative to the requiring file by definition, so
        // its target is a path in the project; a bare `require` is resolved
        // against `$LOAD_PATH`, which can name a gem OR a project file, so its
        // target's location is unknown. `is_external` is therefore NOT set:
        // parallel-indexer reads it to keep external packages out of internal
        // resolution, and asserting `false` for a load-path require would be a
        // claim this file cannot make.
        resolution: methodName === "require_relative" ? "file-relative" : "load-path",
      },
    })
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
    // The local an anonymous dynamic class is bound to, for a call that sits
    // inside such a block. Resolved by the caller: the top-level walk carries
    // it on the frame, walkBody resolves it through `anonBindingAt`.
    anonBinding?: string,
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
    const _nc15 = node.namedChildCount
    for (let i = 0; i < _nc15;
 i++) {
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
      } else if (child.type === "self") {
        // `self` is a NAMED node in this grammar, so without this it fell into
        // the expression-receiver branch and `self.new` — which constructs the
        // ENCLOSING instance — would be suppressed along with `X.new(...).new`.
        // It names no class and no anonymous scope, so it is neither: the
        // receiverless branch below resolves it to the enclosing class, which is
        // the shape the callsite-lines-825 fixture pins.
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
        const _nc16 = args.namedChildCount
        for (let i = 0; i < _nc16;
 i++) {
          const arg = args.namedChild(i)
          if (!arg || arg.type !== "simple_symbol") continue
          const targetName = this.stripSymbolColon(arg.text)
          visibilityOverrides.set(`${owner}\u0000${targetName}`, methodName)
        }
      }
      return
    }

    // --- require / require_relative / load ---
    //
    // RECEIVERLESS ONLY, and that qualifier is the whole rule. `require`,
    // `require_relative` and `load` are Kernel/private methods invoked without a
    // receiver, so `require "x"` is a load and `coder.load("--- ")` is some
    // object's method that happens to share the name. The branch used to match
    // on the method NAME alone, so every `YAMLColumn.new("attr_name").load "--- "`
    // and `@serializer.load "hey there"` in a real corpus published a
    // `references` edge naming a document fragment. Found by the payload
    // hygiene sweep, which looks for names that cannot be a name.
    // `!hasExpressionReceiver` as well as `!receiver`: `serializer(format).load("")`
    // leaves `receiver` UNSET (the receiver is a call, which takes the expression
    // branch) and so passed a receiver-only guard, still publishing a
    // `references` edge with an empty target.
    if ((methodName === "require" || methodName === "require_relative" || methodName === "load") &&
        !receiver && receiverNode === null && !hasExpressionReceiver) {
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && arg.type === "string") {
            const cleanText = this.stripQuotes(arg.text)
            // An INTERPOLATED path is a TEMPLATE, not a path:
            // `require "#{__dir__}/mixin/x"` names no file on disk, so both the
            // import record and the `references` edge would carry a target that
            // resolves to nothing. The autoload branch below has said since it
            // was written that it takes "string paths only (dynamic paths are
            // unresolvable, mirroring require)" -- the intent was documented and
            // never implemented, because the check was only `type === "string"`
            // and an interpolated path IS a string.
            // Measured: 217 sites (rails 208, rubocop 9, mastodon 0) per
            // fixtures/repositories.
            if (cleanText.indexOf("#{") >= 0) continue
            this.pushLoadFacts(node, arg, cleanText, methodName, relationships, imports)
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
    if (methodName === "autoload" && !receiver && receiverNode === null && !hasExpressionReceiver) {
      const args = this.findChild(node, "argument_list")
      if (args) {
        for (let i = 0; i < args.childCount; i++) {
          const arg = args.child(i)
          if (arg && arg.type === "string") {
            const cleanText = this.stripQuotes(arg.text)
            // Same rule as the require family above, and this is the branch whose
            // comment claimed the rule already existed.
            if (cleanText.indexOf("#{") >= 0) continue
            this.pushLoadFacts(node, arg, cleanText, methodName, relationships, imports)
          }
        }
      }
      return
    }

    // --- include / extend / prepend (MIXIN COMPOSITION — canonical `mixes_in`, RUBY-D1) ---
    //
    // RUBY-D1 (ALL-OUT-OF-ALL phase 2, grammar-derived): Ruby's `include M` / `prepend M` /
    // `extend M` are MODULE MIXIN composition — M is inserted into the class's ancestor chain
    // (`extend` into its singleton class) — not conformance and not superclass inheritance. The
    // canonical vocabulary has exactly one value for that construct: `mixes_in` (source = the
    // composing class/module, target = the mixin; Dart's `with` is the measured population of the
    // same value). The previous adaptation — include/prepend -> `implements`, extend -> `extends` —
    // is RELABELLED here, not silently dropped: `implements` is ruled NOT APPLICABLE for Ruby (the
    // grammar has no interface/conformance construct; duck typing is not a declared conformance),
    // and `extend` is not superclass inheritance. `metadata.mixinType` keeps the spelling so a
    // consumer can tell include from prepend from extend, and the relabel's delta is measured
    // (implements N -> 0, extends loses the extend-mixin rows, mixes_in gains both) rather than
    // smoothed. Dart's §9.8 relabel is the precedent: a pure enum swap with the construct sites
    // unchanged.
    if (methodName === "include" || methodName === "extend" || methodName === "prepend") {
      const relType = ASTEngine.RelationshipType.MixesIn
      const args = this.findChild(node, "argument_list")
      if (args) {
        const _nc17 = args.namedChildCount
        for (let i = 0; i < _nc17;
 i++) {
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

    // #825, applied to the member SYMBOL and not only to the edge: the node that
    // NAMES a macro member is its ARGUMENT, not the call that wraps it. A
    // multi-line `attr_accessor :a, :b, :c` gave every property the line the call
    // starts on, so `contains -> c` claimed a line that does not contain `c`.
    // Found by the M59 line oracle on 3,000 real files: 49 inconsistent
    // `contains` in 4 files, every one a macro whose argument list wraps. The
    // call node's range is right for the CALL; it was only ever the wrong anchor
    // for a member. All four macro member kinds are fixed together — `attr_*`,
    // the associations, `scope`/`default_scope`, and `define_method` — because a
    // fix that handled only the one the sample happened to contain would leave
    // the same defect in the other three.
    //
    // --- attr_reader / attr_writer / attr_accessor ---
    if (methodName === "attr_reader" || methodName === "attr_writer" || methodName === "attr_accessor") {
      const args = this.findChild(node, "argument_list")
      if (args) {
        const _nc18 = args.namedChildCount
        for (let i = 0; i < _nc18;
 i++) {
          const arg = args.namedChild(i)
          // Bare strings are legal attribute names too (`attr_reader
          // "name"`); the grammar types them `string`, not simple_symbol.
          if (arg && (arg.type === "simple_symbol" || arg.type === "string")) {
            // `rubyNameFromLiteral` so an escape inside the literal is resolved
            // rather than published, and a name it declines is skipped — the same
            // rule `define_method` uses, for the same reason.
            const propName = this.rubyNameFromLiteral(arg)
            if (propName === undefined || propName.length === 0) continue
            symbols.push({
              name: propName,
              kind: ASTEngine.SymbolKind.Property,
              range: this.nodeToRange(arg),
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
    //
    // ARGUMENT 0 AND ONLY ARGUMENT 0. `Module#define_method` has the signature
    // `define_method(symbol, method = nil, &block)`, so the NAME is the first
    // argument and a second literal argument is the method BODY, written as a
    // string, an UnboundMethod or a proc.
    //
    // The branch used to take the first `simple_symbol`/`string` argument it
    // found, wherever that was — which is argument 0 only when the name is a
    // literal. When the name is a VARIABLE there is no literal at position 0 and
    // the scan fell through to the body:
    //
    //   assert_raise(TypeError) { cl.class_eval { define_method(name, "") } }
    //     test/-ext-/symbol/test_inadvertent_creation.rb:65
    //
    // `stripQuotes('""')` is the empty string, so the analyzer published a Method
    // symbol named `""` and `contains` published an edge whose TARGET was the
    // empty string. No reading makes a zero-length string name a member, so that
    // is an R7 violation outright, and the oracle could not catch it: its `push`
    // refuses an empty target by construction, so an edge carrying one can never
    // produce a disagreement to investigate. Measured by the full-corpus R7
    // sweep (rb-r7-triage.ts): 2 empty-named symbols and 2 `contains` edges with
    // an empty target, all on that one file, source `TestInadvertent`.
    //
    // The fix is the SIGNATURE, not a guard against an empty body: reading
    // argument 0 makes `define_method(name, "")` and `define_method(name, other)`
    // both silent, which is the correct answer for a name known only at runtime
    // and is the same silence `define_method(some_var)` already got.
    if (methodName === "define_method") {
      const args = this.findChild(node, "argument_list")
      const nameArg = args && args.namedChildCount > 0 ? args.namedChild(0) : null
      if (nameArg && (nameArg.type === "simple_symbol" || nameArg.type === "string")) {
        // `define_method("#{sym}?")` names a method only at RUNTIME — the
        // argument is a TEMPLATE, not a name, and the graph gained a symbol
        // literally called `#{sym}?` that resolves to no method in any file.
        // R7's placeholder-name doctrine: a symbol name must name something.
        // Measured: 19 template-name sites in 11 files per 1,874-file stride on
        // CRuby, all still silent.
        const name = this.rubyNameFromLiteral(nameArg)
        if (name !== undefined && name.length > 0 && name.indexOf("#{") < 0) {
          symbols.push({
            name,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(nameArg),
            ownerName: owner,
            visibility: "public" as any,
            metadata: { isDynamicMethod: true },
          })
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
            // One name rule for every site that publishes a method name — see
            // `rubyNameFromLiteral`.
            const n = this.rubyNameFromLiteral(arg)
            if (n === undefined || n.length === 0) continue
            names.push(n)
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
          const _nc20 = args.namedChildCount
          for (let i = 0; i < _nc20;
 i++) {
            const arg = args.namedChild(i)
            // A macro argument must be a LITERAL name: a `simple_symbol`
            // (`belongs_to :account`) or a `string` (`belongs_to "author"`).
            //
            // `identifier` used to be accepted here, and an identifier argument
            // is a VARIABLE, so the association's name is unknowable:
            //
            //     def delegated_type(role)          # activerecord delegated_type.rb
            //       belongs_to role, polymorphic: true
            //     end
            //
            // published `uses:->role` AND a `Property` SYMBOL named `role` on the
            // class — a class that has no such method, named after a local. The
            // analyzer already applies exactly this rule one branch above, to
            // `include`/`extend`/`prepend`: "a DYNAMIC mixin — the concrete module
            // is unknowable, and pinning it fabricates implements/extends against
            // a local's name". The association family was simply never held to
            // the standard its own sibling branch sets.
            //
            // Found by the exact M60 line audit (rb-line-audit.ts), where these
            // are 20 of the 22 violations over all 8,528 files — `contains -> name`
            // and `contains -> role` claiming a class contains its own parameter.
            if (arg && (arg.type === "simple_symbol" || arg.type === "string")) {
              // One name rule for every site that publishes a member name — see
              // `rubyNameFromLiteral`.
              const name = this.rubyNameFromLiteral(arg)
              if (name === undefined || name.length === 0) continue
              // `anonBinding` set => this macro is written inside the block of
              // an anonymous dynamic class, so the association belongs to a
              // class with NO name — not to `owner`, which is only the lexical
              // enclosing class. The edge keeps `owner` (reparenting onto a
              // local that has no symbol would trade a false edge for a
              // dangling one) and both the symbol and the edge now DECLARE the
              // real binding, so a consumer can tell an owned association from
              // a lexically-placed one. Measured on rails: 24 such edges in
              // activerecord/test/cases/associations alone, all written inside
              // test methods against classes that provably do not own them.
              const anonMd = anonBinding ? { anonymousScopeBinding: anonBinding } : {}
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Property,
                range: this.nodeToRange(arg),
                ownerName: owner,
                visibility: "public" as any,
                metadata: { associationType: methodName, ...anonMd },
              })
              relationships.push({
                source: owner || FILE_SCOPE_OWNER,
                target: name,
                type: ASTEngine.RelationshipType.Uses,
                confidence: 0.8,
                // #825: the association's own argument node names the edge.
                line_number: this.nodeLine(arg),
                metadata: { activerecordMacro: methodName, ...anonMd },
              })
            }
          }
        }
      } else if (methodName === "scope" || methodName === "default_scope") {
        const args = this.findChild(node, "argument_list")
        if (args && args.namedChildCount > 0) {
          const firstArg = args.namedChild(0)
          if (firstArg && (firstArg.type === "simple_symbol")) {
            // One name rule for every site that publishes a member name — see
            // `rubyNameFromLiteral`.
            const scopeName = this.rubyNameFromLiteral(firstArg)
            if (scopeName === undefined || scopeName.length === 0) return
            symbols.push({
              name: scopeName,
              kind: ASTEngine.SymbolKind.Method,
              range: this.nodeToRange(firstArg),
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
      // RB-A FIRST, before anything is emitted.
      //
      // The expression-receiver guard used to sit BELOW the emit, which made it
      // unreachable in practice: `target` falls back to `owner`, and `owner` is
      // truthy for any capitalized class, so `X.new(...).new` inside a class
      // emitted `instantiates <EnclosingClass> -> <EnclosingClass>` — an edge
      // claiming the enclosing class constructs itself, on a line that does not
      // contain its name. Found by the M59 line oracle on 3,000 real files: 118
      // inconsistent `instantiates` edges in 43 files, every one of this shape
      // (`Class.new(Configuration).new`, `Encoding.json_encoder.new(options)`,
      // `retrieve_store_class(store).new(...)`, `default_scope Struct.new(:call).new(...)`).
      //
      // An expression receiver constructs an ANONYMOUS class, so there is no
      // nameable target and nothing is emitted. `self.new` is unaffected: `self`
      // is an anonymous token, so it never appears in `namedChild`, which means
      // `hasExpressionReceiver` stays false and the receiverless branch below
      // still resolves `self.new` to the enclosing class with its declared
      // `resolvedTarget: "enclosing-class"` marker.
      if (hasExpressionReceiver) return
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
      // Not a constant instantiation. The expression-receiver half of this rule
      // moved ABOVE the emit (see the RB-A note there); what remains is a
      // receiverless `new` at top level, which has no owning class either.
      // Lowercase receivers (`task_class.new`) still fall through — that is a
      // genuine member call (truth parity: deriveRubyEdges pushes calls:new).
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
    // A BARE `private` / `protected` / `public` is a visibility directive, not a
    // call. The parenthesised/symbol-list form (`private :helper`) reaches
    // processCall and is already handled there; the bare keyword parses as a
    // plain `identifier`, and the top-level walk has skipped it since the
    // first version of this file — but pushBareCall, which serves METHOD
    // bodies, never had the rule, so a bare `private` inside a method or block
    // was published as `calls <method> -> private`. Measured on three corpora:
    // 3 occurrences in a 1,200-file stride sample (rails
    // activerecord/test/cases/timestamp_test.rb:229, rails
    // activesupport/test/core_ext/object/try_test.rb:80, mastodon
    // spec/requests/api/v1/csp_spec.rb:33). The differential oracle already
    // filtered these via `isVisibilityDirective`, so the analyzer was the only
    // side that published them.
    if (isRubyVisibilityDirectiveName(name)) return
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
    const _nc21 = node.namedChildCount
    for (let i = 0; i < _nc21;
 i++) {
      const c = node.namedChild(i)
      if (!c) continue
      // Only `call`: the pinned grammar folds every call shape (paren'd,
      // paren-less, with-block) into `call` nodes — `command` and
      // `command_call` are not node types it can produce. NOTE: this comment
      // used to end "(grammar-audit proven)". That was an overclaim, and the
      // grammar audit is what caught it: M14.0.F1 validates node-type literals
      // only where a comparison reads `x.type`, and this file compares a
      // DESTRUCTURED LOCAL named `type`, so F1 never collected this file's
      // dispatch at all (38 of 60 comparisons). The proof is the grammar's own
      // node-type enumeration plus a 4,024,840-node corpus sweep, not F1.
      if (c.type === "call") {
        if (this.dynamicClassFactoryKind(c)) return true
      }
    }
    return false
  }

  /**
 * The NAME a `simple_symbol` or `string` literal declares, or `undefined` when
 * the analyzer cannot state it.
 *
 * ## Why this exists
 *
 * `stripQuotes` removes the OUTER quotes and stops there, so a Ruby escape inside
 * the literal survives into the published name. Ruby's
 * `define_method("test_safe_load_marshal String \"hello\" ivar")` defines a method
 * whose name is `test_safe_load_marshal String "hello" ivar` — with a plain quote,
 * no backslash — and the analyzer published the name with the backslash still in
 * it. That name matches no method in the program, and it propagated: the symbol
 * carried it, `contains` carried it, and `overrides` carried it again as
 * `TestCase.<that name>`. Measured by the full-corpus R7 sweep: 19 distinct
 * escaped names, 14 `contains` edges and 14 `overrides` edges with a quote in a
 * target, every one in test/rubygems/test_gem_safe_marshal.rb — generated
 * round-trip test methods, so the names are real but the escapes were not
 * resolved.
 *
 * ## The escape set, and why it is closed
 *
 * The corpus says which escapes occur, and the inventory is four pairs:
 *
 *   \"  56      \\  21      \x  21      \u  1
 *
 * `\"`, `\\` and the single-character control escapes resolve to text a name can
 * carry, so they are resolved here and the name is published correct. `\x` and
 * `\u` are NOT resolved, and that is a decision rather than an omission: `\x61`
 * is the BYTE 0x61 and `\u{3042}` is a non-ASCII character, so resolving them
 * would publish a name built from raw bytes or a non-Latin script — a string that
 * no consumer can bind and that the parallel-indexer's own name filters would
 * then treat as garbage. A name this analyzer cannot state is not published,
 * which is the same doctrine the `#{…}` template refusal above applies and the
 * reason that refusal exists.
 *
 * So the rule is: resolve the escapes that yield a name, refuse the name when it
 * carries an escape that does not. `\q` — an escape Ruby does not define at all
 * — takes the same path, and returns `undefined` rather than passing the backslash
 * through.
 *
 * ## Character scan, no pattern
 *
 * The escapes are matched by character code against a switch, and the scan walks
 * the string once. A table keyed on a substring would be a lookup dressed as a
 * parse; this reads the backslash, then the character it escapes, and decides on
 * those two codes.
 */
private rubyNameFromLiteral(node: Node): string | undefined {
  const raw = node.text
  let s = raw
  if (node.type === "string") {
    s = this.stripQuotes(raw)
  } else {
    s = this.stripSymbolColon(raw)
  }
  if (s.indexOf("\\") < 0) return s

  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c !== 92 /* backslash */) { out += s[i]; continue }
    if (i + 1 >= s.length) return undefined   // a trailing backslash: not a name
    const e = s[i + 1]
    // Resolvable: the escaped character stands for itself.
    if (e === "\\" || e === '"' || e === "'" || e === "#") { out += e; i++; continue }
    // Ruby's named control escapes. A newline or a tab inside a symbol name is
    // what Ruby itself produces, so the published name matches.
    if (e === "a") { out += "\x07"; i++; continue }
    if (e === "b") { out += "\b"; i++; continue }
    if (e === "e") { out += "\x1b"; i++; continue }
    if (e === "f") { out += "\f"; i++; continue }
    if (e === "n") { out += "\n"; i++; continue }
    if (e === "r") { out += "\r"; i++; continue }
    if (e === "s") { out += " "; i++; continue }
    if (e === "t") { out += "\t"; i++; continue }
    if (e === "v") { out += "\v"; i++; continue }
    if (e === "0") { out += "\0"; i++; continue }
    // Everything else — \x \u \c \C \M, octal, and any escape Ruby does not
    // define — is a name this analyzer declines to state.
    return undefined
  }
  return out
}

/**
   * The node that NAMES the base of a `K = Class.new(Base)` factory, or null.
   *
   * Only `Class.new` counts, and only when the base is the FIRST argument and is
   * written as a constant or a scope path. `Struct.new(:a, :b)` and
   * `Data.define(:a, :b)` take member names there, not a superclass — neither
   * class has a superclass parameter — so recognising them as a base would
   * fabricate an `extends` edge against a symbol name. `Module.new` takes no
   * argument at all, which the method check below also rules out.
   *
   * The RHS may wrap the call (`Class.new(Base) { … }.new`, which
   * `dynamicClassFactoryKind` already recurses through), so the search for the
   * `Class.new` head repeats the same bounded walk rather than assuming the call
   * sits at the top. The recursion is bounded by the grammar: the inner node it
   * recurses into must itself be a `.new` call whose own receiver is a constant.
   */
  private factorySuperclassNode(rhs: Node | null): Node | null {
    if (!rhs) return null
    let callNode: Node | null = rhs.type === "call" ? rhs : null
    if (!callNode) {
      for (let i = 0; i < rhs.namedChildCount; i++) {
        const c = rhs.namedChild(i)
        if (c && c.type === "call") { callNode = c; break }
      }
    }
    if (!callNode) return null
    const methodNode = callNode.childForFieldName("method")
    if (!methodNode || methodNode.text !== "new") return null
    let receiver: string | undefined
    for (let i = 0; i < callNode.namedChildCount; i++) {
      const c = callNode.namedChild(i)
      if (!c) continue
      if (c.id === methodNode.id) break
      if (c.type === "constant" || c.type === "scope_resolution") { receiver = c.text; continue }
      // Any other leading child means the receiver is an expression, whose
      // concrete class is unknowable. Recurse into a nested `.new` and take the
      // INNER call's base only when the inner call is itself a `Class.new` —
      // the same bounded shape `dynamicClassFactoryKind` walks.
      if (c.type === "call") return this.factorySuperclassNode(c)
      return null
    }
    if (receiver !== "Class") return null
    const args = this.findChild(callNode, "argument_list")
    if (!args || args.namedChildCount === 0) return null
    const first = args.namedChild(0)
    if (!first) return null
    if (first.type !== "constant" && first.type !== "scope_resolution") return null
    return first
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
      const _nc22 = node.namedChildCount
      for (let i = 0; i < _nc22;
 i++) {
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
    let methodName = methodNode.text
    let receiver: string | undefined
    const _nc23 = callNode.namedChildCount
    for (let i = 0; i < _nc23;
 i++) {
      const child = callNode.namedChild(i)
      if (child && child.id === methodNode.id) break
      if (!child) continue
      if (child.type === "constant" || child.type === "scope_resolution") {
        receiver = child.text
      } else if (!receiver && child.type === "call" && (methodName === "new" || methodName === "define")) {
        // `.new` / `.define` APPLIED TO A FACTORY BLOCK — `K =
        // Class.new(Base) { … }.new`, which is how a class with a block body and
        // an instance built from it is written, and CRuby ships it
        // (bootstraptest/runner.rb:84 `BT = Class.new(bt) do … end.new`).
        //
        // The outer call's receiver is a CALL node, not a constant, so the guard
        // above found no receiver and the factory went UNRECOGNISED. Two facts
        // were then wrong and neither announced itself: the LHS `K` got no symbol
        // at all, so nothing in the graph named the class, and the block's
        // members kept the FILE as their owner — which makes them read as
        // top-level methods, and a top-level method is what the export surface
        // publishes. Found by the oracle census: `exports -> BT` missing while
        // four of its members came out as file-level exports.
        //
        // The recursion is bounded by the grammar's own shape rather than by a
        // depth counter: the inner call must itself be a factory, which requires
        // a CONSTANT receiver, and a constant receiver has no call child to
        // recurse into.
        const inner = this.dynamicClassFactoryKind(child)
        if (inner) return inner
      }
    }
    if (!receiver) return null
    if (methodName !== "new" && methodName !== "define") return null
    const leaf = receiver.split("::").filter(Boolean).pop() ?? receiver
    if (leaf === "Module" && methodName === "new") return "Module"
    if ((leaf === "Struct" || leaf === "Data" || leaf === "Class") && (methodName === "new" || methodName === "define")) return "Class"
    return null
  }

/**
   * The constants a scope removes from its public surface with
   * `private_constant :A, :B`, keyed by the OWNER NAME THE SYMBOL TABLE USES.
   *
   * Ruby's constant visibility has its own keyword and the method family does not,
   * so the lexical `visibility` this file tracks for methods says nothing about a
   * constant — a `private_constant :VERSION` member would otherwise be published
   * as part of the export surface, which is precisely the members the language
   * declares unexported. Measured on the corpus: 142 sites in 73 files.
   *
   * It is collected in its own walk rather than in `processCall` because it needs
   * the ENCLOSING SCOPE, and threading a map through `walkBody` /
   * `walkMethodBody` / `walkParamDefaults` / `processCall` — eight signatures and
   * eight call sites — to carry one set is a large diff in a hot file for a small
   * fact. The scope rule it needs is the same one the main walk uses, so it calls
   * `rubyReopenIdentity` rather than restating it: a second copy of the reopen
   * rule is exactly how the two existing copies came to disagree.
   *
   * Keyed by the same owner string the export pass reads off `ownerName`, and
   * missing a scope costs a wrong edge, so the walk descends into every node type
   * rather than only the ones a declaration can sit under.
   */
  private collectPrivateConstants(root: Node): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>()
    const stack: Array<{ node: Node; owner: string | undefined }> = [{ node: root, owner: undefined }]
    while (stack.length > 0) {
      const { node, owner } = stack.pop()!
      const type = node.type
      let nextOwner = owner
      if (type === "class" || type === "module" || type === "singleton_class") {
        const nameNode = node.childForFieldName("name")
        if (nameNode) nextOwner = rubyReopenIdentity(nameNode.text, owner).name
        // A `singleton_class` names no new unit: `class << self` is still the
        // enclosing class, and its body belongs to that class.
        if (type === "singleton_class") nextOwner = owner
      } else if (type === "call") {
        const methodNode = node.childForFieldName("method")
        if (methodNode?.text === "private_constant") {
          const args = this.findChild(node, "argument_list")
          if (args) {
            const key = owner ?? FILE_SCOPE_OWNER
            let set = out.get(key)
            if (!set) {
              set = new Set<string>()
              out.set(key, set)
            }
            for (let i = 0; i < args.namedChildCount; i++) {
              const arg = args.namedChild(i)
              if (!arg) continue
              if (arg.type === "simple_symbol" || arg.type === "string") {
              // The SAME name rule the export pass reads its names through, so a
              // `private_constant :"A \"B\""` hides the name the symbol table
              // actually holds. A name the rule declines hides nothing, which is
              // the safe direction: the export surface then names a unit the
              // modifier could not have removed.
              const n = this.rubyNameFromLiteral(arg)
              if (n !== undefined && n.length > 0) set.add(n)
            }
            // An IDENTIFIER argument names a local, not a constant, and a
            // template names nothing at all (R7) — both are refused, exactly as
            // the association-macro branch refuses them.
            }
          }
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) stack.push({ node: child, owner: nextOwner })
      }
    }
    return out
  }

  /**
   * Extract superclass from class node — pure char scan, no regex
   */
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
    const _nc24 = params.namedChildCount
    for (let i = 0; i < _nc24;
 i++) {
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
  /**
   * PROJECT INDEX CONSUMPTION (task-22 phase 2) — facts, never fabrications.
   *
   * Behind `BB_RUBY_INDEX_CONSUME=1` ONLY, and FAIL-CLOSED: no context, no index, or `index.complete`
   * not strictly true ⇒ touches nothing and the file's output is byte-identical to the pre-index run.
   * What it does, in the pre-committed shape of the phase-1 sizing (4,611-row bound):
   *   · overrides — VERIFY the first-parent guess: base type declared AND the base declares the member
   *     (`typeKinds` + `typeMembers`, NOT counts) ⇒ `metadata.projectIndexVerified`/`ownerEvidence`,
   *     confidence raised to structural; otherwise DECLINED with a reason (the 102 none-base rows stay
   *     declared causes, they are not overwritten).
   *   · instantiates/extends/mixes_in — a static constant path that the index declares gets
   *     `metadata.projectIndexDeclared` (module existence is all mixes_in needs; typeBases is not read).
   *   · calls — NOT TOUCHED. Name-only binding would bind decoys (the ruby D4 lesson); ruby has no
   *     static receiver typing, so the index may not manufacture a call binding.
   * Declined rows are COUNTED BY REASON in `metadata.projectIndex.declined`, never merged into a result.
   */
  private applyProjectIndexFacts(
    relationships: ASTEngine.UniversalRelationship[],
    context: ASTEngine.AnalyzeContext | undefined,
  ): Record<string, unknown> | undefined {
    if (process.env.BB_RUBY_INDEX_CONSUME !== "1") return undefined
    const index = (context as any)?.projectIndex as import("./project-index").ProjectIndex | undefined
    if (!index || index.complete !== true) return undefined
    const leafOf = (name: string): string => {
      const at = name.lastIndexOf("::")
      return at >= 0 ? name.slice(at + 2) : name
    }
    const hasType = (name: string): boolean => index.typeKinds.has(name) || index.typeKinds.has(leafOf(name))
    const membersOf = (name: string): Set<string> | undefined =>
      index.typeMembers.get(name) ?? index.typeMembers.get(leafOf(name))
    let verifiedOverrides = 0
    let declaredTargets = 0
    const declined: Record<string, number> = {}
    const decline = (reason: string): void => { declined[reason] = (declined[reason] ?? 0) + 1 }
    for (const r of relationships) {
      const type = String(r.type ?? "")
      const md: any = (r.metadata ??= {})
      if (type === "overrides") {
        const target = String(r.target ?? "")
        const dot = target.lastIndexOf(".")
        if (dot <= 0) { decline("overrideTargetUnnameable"); continue }
        const base = target.slice(0, dot)
        const method = target.slice(dot + 1)
        if (!hasType(base)) { decline("baseNotDeclared"); continue }
        const members = membersOf(base)
        if (!members || !members.has(method)) { decline("memberNotOnBase"); continue }
        md.projectIndexVerified = true
        md.ownerEvidence = "projectIndex"
        r.confidence = Math.max(r.confidence ?? 0, 0.95)
        verifiedOverrides++
      } else if (type === "instantiates" || type === "extends" || type === "mixes_in") {
        if (!hasType(String(r.target ?? ""))) { decline(`${type}:typeNotDeclared`); continue }
        md.projectIndexDeclared = true
        declaredTargets++
      }
    }
    return {
      complete: true,
      verifiedOverrides,
      declaredTargets,
      callsUntouched: true,
      declined,
    }
  }

  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const type = r.type ?? r.relationshipType ?? ""
      const md: any = r.metadata ?? {}
      if (type === "contains") { md.evidenceClass = "structural"; continue }
      // `imports` and `references` are import_based: they are read off a path
      // literal in a load directive. `exports` is NOT, and it was grouped here by
      // the label list alone — a rule that classified by NAME. A ruby `exports`
      // edge is derived from a declaration plus a visibility decision, both of
      // which the analyzer computed from the tree, so it is structural evidence.
      // The grouping only ever affected ruby (this method is a private member of
      // this analyzer), and ruby emitted no `exports` edge before this wave.
      if (type === "imports" || type === "references") { md.evidenceClass = "import_based"; continue }
      if (type === "exports") { md.evidenceClass = "structural"; continue }
      if (type === "calls" || type === "uses") {
        md.evidenceClass = (r.confidence ?? 0) >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      // RUBY-D1: `mixes_in` is the declared mixin-composition construct (the relabel of the old
      // implements/extends adaptation), so it belongs in the DECLARED-structural group with
      // instantiates/extends — the tier follows the construct, not the old label. `implements` stays
      // in the list as the retained spelling of the same tier even though this lane no longer emits
      // it (a rule that reads by NAME must not silently drop a label the family still defines).
      if (type === "instantiates" || type === "extends" || type === "implements" || type === "mixes_in") {
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
    const _nc25 = node.namedChildCount
    for (let i = 0; i < _nc25;
 i++) {
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
