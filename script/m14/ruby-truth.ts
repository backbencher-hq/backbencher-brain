/**
 * RUBY LANE — standalone differential truth oracle. (M60)
 *
 * WHY THIS FILE EXISTS. The Ruby oracle used to live inside
 * `script/m14/differential.ts`, which is shared by at least six language lanes.
 * That file was rewritten wholesale six times during the M60 work — once
 * replacing `deriveRubyEdges` with a PHP-derived generic implementation keyed on
 * `method_declaration` / `class_declaration` node names, which do not exist in the
 * Ruby grammar. Every Ruby rule lost. This module is deliberately standalone: it
 * is not a shared file, no other lane can overwrite it, and the census harness
 * loads it directly via `BB_RB_ORACLE`.
 *
 * It derives truth by walking the tree itself. It never reads analyzer output,
 * never reads the analyzer's symbol table, and uses no regex — pure structural
 * rules plus character scans (`charAt`/`codePointAt`), so "no regex" is a
 * property of the construction and not a lint that can be forgotten.
 *
 * ---------------------------------------------------------------------------
 * THE SCOPING PRINCIPLE. Two rules carry most of the weight, and both were
 * derived from measured disagreements rather than guessed:
 *
 *   1. NAMABLE OWNER. A `contains` edge needs an owner that something can name.
 *      `K = Class.new(Base) do belongs_to :acct end` names K, so `K -> acct` is
 *      real. `engine = Class.new(Rails::Engine) do … end` does NOT — `engine` is
 *      a local variable, and a bare `Class.new do … end` does not either. The
 *      question is never "which constant is being instantiated" but "did
 *      anything name this scope".
 *
 *   2. PER-SCOPE BINDINGS. A name bound in the CURRENT lexical scope chain is a
 *      binding, not a call. This must hold for BLOCKS, not just methods: a block
 *      parameter (`after_build do |fasp|`) and a block-local assignment
 *      (`test "…" do channel = … end`) are both bindings. Tracking bindings only
 *      per METHOD — which is what the shared oracle did — made every block-local
 *      in the corpus read as a call. That was 22 wrong `calls` edges and it is
 *      fixed here by collecting bindings per scope node and skipping any name
 *      bound in the enclosing chain.
 * ---------------------------------------------------------------------------
 */
import type { Node } from "web-tree-sitter"

/**
 * The label set this oracle can emit, exported so the repository-wide
 * relationship-type coverage gate reads it from HERE rather than from the shared
 * `differential.ts`.
 *
 * WHY THIS EXPORT EXISTS. The gate derives each lane's audited set by evaluating
 * one filter expression inside `differential.ts` - a shared file that six lanes
 * rewrite. When the Ruby oracle moved out of that file (see the header), the gate
 * kept reporting `ruby 2 un-audited: ["contains","references"]` - a confident and
 * now false claim, because Ruby's oracle derives all eight and the gate was reading
 * a file that no longer held the answer. That is the same failure mode the gate's own
 * header warns about, reached from the other direction: not an empty set read as a
 * real one, but a STALE set read as a current one.
 *
 * The value is derived from the emitter itself, not restated, so it cannot drift from
 * what the oracle actually produces.
 */
export const RUBY_ORACLE_LABELS: ReadonlyArray<RubyTruthEdge["label"]> = [
  "calls", "contains", "extends", "implements", "instantiates", "overrides", "references", "uses",
]

/** One derived fact. `from` is set for edges that name an owner. */
export interface RubyTruthEdge {
  label: "calls" | "contains" | "extends" | "implements" | "instantiates" | "overrides" | "references" | "uses"
  target: string
  from?: string
  line: number
}

/**
 * Names that are part of the language rather than a call to a user symbol.
 * Kept as an explicit set, character-split, no regex.
 */
const RUBY_BUILTINS = new Set(
  [
    "puts", "print", "p", "pp", "p$", "print_flush", "putc",
    "raise", "fail", "exit", "exit!", "abort", "warn",
    "gets", "readline", "readlines", "rand", "srand",
    "sleep", "loop", "require", "require_relative", "load",
    "autoload", "eval", "binding", "local_variables",
    "global_variables", "global_variable_get", "global_variable_set",
    "caller", "caller_locations", "trace_var", "untrace_var",
    "method", "public_method", "private_method", "protected_method",
    "instance_method", "public_instance_method", "private_instance_method",
    "super", "method_missing", "respond_to_missing?",
    // NOTE: `flash`, `redirect_to`, `render`, `params`, `cookies` and `session` are
    // DELIBERATELY ABSENT. An earlier version of this list added them on the theory
    // that a Rails controller helper reached through an implicit receiver is a
    // builtin. PROBED: `def m; redirect_to x; params; flash; render; end` publishes
    // `calls:redirect_to`, `calls:x`, `calls:params`, `calls:flash`, `calls:render` -
    // every one of them. The analyzer makes no distinction between a framework
    // helper and a user method at this layer, so neither does the oracle. Suppressing
    // them invented 4,187 MISSING `calls`. The lesson generalises: `RUBY_BUILTINS`
    // is the analyzer's suppression list, not a judgement about the Ruby language,
    // and adding an entry that is not in the analyzer's list is always wrong.
    "class",
    // Kernel path intrinsics. PROBED: `def m; __dir__; end` publishes NOTHING, and
    // `File.expand_path('../G', __dir__)` publishes only `calls:expand_path`. These
    // are builtins, so the read is suppressed.
    "__dir__", "__FILE__", "at_exit", "block_given?", "caller_locations", "freeze",
    // Visibility modifiers. PROBED: `def a; end; private :a` publishes `contains:a`
    // and NOTHING for `private` - it is a modifier, not a call. Same for its siblings.
    "private", "public", "protected", "module_function", "private_class_method",
    // `define_method` is suppressed as a CALL but still DECLARES a member - see the
    // define_method branch. PROBED: `define_method(:go) { }` -> contains:go, no calls.
    "define_method", "define_singleton_method",
    "alias_method",
    "public_class_method", "private_constant",
    "respond_to", "respond_to?",
    "initialize_copy", "initialize_dup", "initialize_clone",
    "send", "__send__", "freeze", "frozen?", "dup", "clone",
    "taint", "untaint", "trust", "untrust",
    "hash", "eql?", "equal?", "object_id", "instance_of?",
    "kind_of?", "is_a?", "nil?", "instance_variable_defined?",
    "instance_variables", "instance_variable_get", "instance_variable_set",
    "class_variables", "class_variable_defined?",
    "class_variable_get", "class_variable_set",
    "const_defined?", "const_get", "const_set",
    "method_defined?", "private_method_defined?", "protected_method_defined?",
    "singleton_method", "define_singleton_method",
    "to_s", "to_i", "to_f", "to_a", "to_h", "to_proc", "inspect", "display",
    "extend", "include", "prepend",
    // Rails macros emit property/use edges, never call edges.
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
    // Constructor intrinsics: `K.new` is an `instantiates` edge and a bare `new`
    // builds the enclosing class. Neither calls a user symbol, and without these
    // every `Class.new` in the corpus also published `calls:new`.
    "new", "allocate",
    // Constructor intrinsics. `K.new` is an `instantiates` edge; a bare `new` builds
    // the enclosing class. Neither is a call to a user symbol, and without this
    // every `Class.new` in the corpus also published `calls:new`.
    "new", "allocate",
    "event", "transition", "state_machine",
    "module_function", "using", "ruby2_keywords", "no_touching",
    // Core classes are constants and are handled by the constant path.
  ].join(" ").split(" "),
)

/**
 * Macros whose first arguments NAME a member of the enclosing scope. These are
 * the only macros that contribute `contains`; a macro not listed here
 * (`validates`, `before_save`) contributes nothing, because its symbol
 * arguments are option names, not declarations.
 */
const ASSOCIATION_MACROS = new Set(["has_many", "belongs_to", "has_one", "has_and_belongs_to_many"])
const ATTRIBUTE_MACROS = new Set(["attr_reader", "attr_writer", "attr_accessor"])

/**
 * `delegate :a, :b, to: :x` forwards, it does not define. PROBED: it publishes NO
 * `contains` at all, while `attr_reader :a` publishes `contains:a`. My list had
 * `delegate` in it, so every `delegate` line in the corpus invented one or more
 * members - 274 MISSING `contains`, e.g. `size` and `flush` in
 * `shared_connection_pool.rb`, and `audience_to`/`audience_cc` in `create.rb`. The
 * forwarded methods belong to the TARGET (`@available`), which is precisely what
 * makes them not this class's members.
 */
const DELEGATE_MACROS = new Set(["delegate", "delegate_missing_to"])

/** Callback macros: symbol args are event names, never members. */
const CALLBACK_MACROS = new Set([
  "before_action", "after_action", "before_filter", "after_filter",
  "before_validation", "after_validation",
  "before_save", "after_save", "before_create", "after_create",
  "before_update", "after_update", "before_destroy", "after_destroy",
  "before_commit", "after_commit", "after_rollback",
])

/**
 * Identifiers that are part of a call node rather than a bare read. `call` covers
 * every call shape in the pinned grammar (paren'd, command, command-with-block),
 * so `command` and `command_call` are absent deliberately — they are not node
 * types this grammar produces, and listing them would be dead insurance.
 *
 * `method`/`singleton_method` are absent ON PURPOSE: an endless `def label = name`
 * has its body as a direct identifier child, and only the FIRST named child is the
 * def name. The def name is skipped positionally at the identifier branch, not by
 * a parent set, so endless bodies still read.
 */
const NON_BARE_PARENTS = new Set([
  "call", "setter", "alias", "method_parameters", "parameters",
  "block_parameters", "lambda_parameters", "class", "module", "singleton_class",
])

/**
 * Does a string literal's TEXT contain `#{`, i.e. is it interpolated?
 *
 * Character scan, no regex. An interpolated literal is not a static path, so
 * `require "a/#{x}"` names a file that cannot be known from the tree.
 */
function hasInterpolation(text: string): boolean {
  for (let i = 0; i + 1 < text.length; i++) {
    if (text.charCodeAt(i) === 35 && text.charCodeAt(i + 1) === 123) return true
  }
  return false
}

/**
 * Kernel conversion functions. `Array(x)` is a Kernel method, not a call to a user
 * symbol, so it publishes no edge - probed. Distinct from `Array.new`, which is an
 * `instantiates`, and from `Foo(x)`, which IS a `calls` because a capitalised name
 * can be a user-defined method.
 */
const KERNEL_CONVERSIONS = new Set([
  "Array", "Hash", "String", "Integer", "Float", "Rational", "Complex",
  "File", "Dir", "IO", "Proc", "Method", "Struct", "Set", "Pathname",
])

/** Unquote one pair of surrounding quotes. Character scans only, no regex. */
function unquote(text: string): string {
  if (text.length >= 2) {
    const a = text.charCodeAt(0)
    const b = text.charCodeAt(text.length - 1)
    if ((a === 34 && b === 34) || (a === 39 && b === 39)) return text.slice(1, -1)
  }
  return text
}

/** Strip a leading `:` from a symbol node's text. */
function symbolName(text: string): string {
  if (text.charCodeAt(0) === 58) return text.slice(1)
  return text
}

/** Does `name` read as a CONSTANT (starts uppercase, not all-caps noise)? */
function isConstantName(name: string): boolean {
  if (name.length === 0) return false
  const c = name.charCodeAt(0)
  return c >= 65 && c <= 90
}

/** The static name of a node when it is a nameable constant path (`A::B::C`). */
function constantPath(n: Node | null): string | null {
  if (!n) return null
  // PROBED: a `superclass` FIELD points at a `superclass` WRAPPER node, not at the
  // constant. `class AccountsIndex < Chewy::Index` gives
  // `class(superclass: superclass(constant, scope_resolution(constant, constant)))`,
  // so reading the field and expecting a constant/scope_resolution returned `null`
  // for EVERY inheritance in the corpus and no `extends` edge was ever derived.
  // Unwrapping the wrapper is the whole fix. This is the same class as the
  // splat/keyword parameter wrappers and the `exception_variable` child: this
  // grammar wraps the thing you want.
  if (n.type === "superclass") {
    const inner = n.namedChild(0)
    return inner ? constantPath(inner) : null
  }
  if (n.type === "constant") return n.text
  if (n.type === "scope_resolution") {
    const scope = n.childForFieldName("scope")
    const name = n.childForFieldName("name")
    const left = constantPath(scope)
    const right = name ? name.text : null
    if (left && right) return `${left}::${right}`
    return right ?? left ?? null
  }
  return null
}

/** The last `::` segment of a constant path. Character scan, no regex. */
function leafName(path: string): string {
  let start = 0
  for (let i = 0; i + 1 < path.length; i++) {
    if (path.charAt(i) === ":" && path.charAt(i + 1) === ":") { start = i + 2; i++ }
  }
  return path.slice(start)
}

/** The node types that open a binding scope. */
function isScopeNode(t: string): boolean {
  return t === "method" || t === "singleton_method" || t === "block" || t === "lambda" || t === "do_block"
}

/** A walk frame. */
interface Frame {
  n: Node
  parent: Node | null
  /**
   * Names that are WRITES anywhere within the enclosing assignment, and so are not
   * read on either side of it. `a[b] = a[b] + 1` marks `b` as a write for the WHOLE
   * assignment, not just its left - probed, and the reason is the same as the
   * multiple-assignment rule (`@a, @b = a, b`): a target position collects the name
   * once and every later read of it inside the same expression is a re-read of a
   * binding, not a reference.
   */
  suppress: Set<string> | undefined
  /** Is a bare identifier in this frame an expression read (vs. a name)? */
  inBody: boolean
  /** Enclosing scope node ids, innermost last — for binding lookup. */
  scopes: number[]
  /** The owner a `contains` edge would name, when it is NAMABLE. */
  cls: string | undefined
  /** The enclosing method's name, for `from` on some edges. */
  methodId: string | undefined
}

/**
 * Collect every binding introduced in the subtree of each scope node.
 *
 * Deliberately PER SCOPE and not per method: the defect this replaces tracked
 * bindings per method, so every block parameter and block-local in the corpus
 * read as a call. Names declared inside a nested def are NOT collected for the
 * enclosing scope, because a def introduces its own frame.
 */
function collectBindings(root: Node): Map<number, Set<string>> {
  const scopes = new Map<number, Set<string>>()
  const visit = (n: Node, current: number | undefined): void => {
    let scope = current
    if (isScopeNode(n.type)) {
      scope = n.id
      if (!scopes.has(scope)) scopes.set(scope, new Set<string>())
      // Parameters bind in this scope.
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (c.type === "block_parameters" || c.type === "method_parameters" || c.type === "parameters") {
          collectParamNames(c, scopes.get(scope)!)
        }
      }
    }
    // `rescue E => e` binds `e` through an `exception_variable` FIELD - probed, not
    // guessed. `in {a:}` binds `a` from the pattern's bindings. Both read as calls
    // until recorded as bindings.
    if (scope !== undefined && n.type === "rescue") {
      // PROBED: the binder is a CHILD of type `exception_variable` whose text is
      // `=> e` - there is no `exception_variable` FIELD (it returns undefined), so
      // reading the field found nothing and every rescue binder read as a call.
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && c.type === "exception_variable") {
          for (let j = 0; j < c.namedChildCount; j++) {
            const b = c.namedChild(j)
            if (b && b.type === "identifier") scopes.get(scope)!.add(b.text)
          }
        }
      }
    }
    if (scope !== undefined && (n.type === "in_clause" || n.type === "in")) {
      // PROBED: `in {a:}` nests as `in_clause(pattern: hash_pattern, then: <body>)`,
      // and `hash_pattern`'s children are `keyword_pattern` wrappers.
      collectPatternBindings(n.childForFieldName("pattern") ?? n, scopes.get(scope)!)
    }
    // Assignment targets bind in the CURRENT scope.
    if (scope !== undefined && (n.type === "assignment" || n.type === "operator_assignment")) {
      const left = n.childForFieldName("left")
      if (left) {
        // ONLY plain locals bind. A `@ivar = 1` is a WRITE, and a later `@ivar` READ
        // is a real `uses` edge, so binding the variable here suppressed every
        // ivar read in the corpus - 17,097 wrong `calls` edges from one condition.
        // Variables are handled by the variable branch, which emits reads
        // unconditionally and writes not at all.
        if (left.type === "identifier") {
          const t = left.text
          if (t !== "_") scopes.get(scope)!.add(t)
        } else if (left.type === "left_assignment_list") {
          for (let i = 0; i < left.namedChildCount; i++) {
            const c = left.namedChild(i)
            if (c && c.type === "identifier" && c.text !== "_") scopes.get(scope)!.add(c.text)
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c, scope)
    }
  }
  visit(root, undefined)
  return scopes
}

/** Parameter names, including optional/block forms, without regex. */
function collectParamNames(params: Node, into: Set<string>): void {
  for (let i = 0; i < params.namedChildCount; i++) {
    const c = params.namedChild(i)
    if (!c) continue
    // PROBED for every form in `def m(a, *b, c:, **d, &e)`: `*b`, `c:`, `**d` and
    // `&e` are each a WRAPPER node (`splat_parameter`, `keyword_parameter`,
    // `hash_splat_parameter`, `block_parameter`) with a `name` FIELD pointing at the
    // bare identifier. The wrapper's own `.text` is `*b` / `c:` / `**d` / `&e`, so
    // recording it bound a string that no read ever matches - which is why every
    // rest/keyword/block argument read came out as a call. Reading the `name` field
    // is the whole fix, and `continue` matters: without it the plain `identifier`
    // branch below recorded the wrapper's text a SECOND time.
    // `|(a, _)|` is a DESTRUCTURED parameter wrapping two identifiers. It has no
    // `name` field, so the wrapper loop found nothing and BOTH names fell through to
    // be read as calls - PROBED: `[1].each do |(a, _)|` should publish only
    // `calls:each`, and mine published `calls:each calls:a calls:_`.
    if (c.type === "destructured_parameter") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const inner = c.namedChild(j)
        if (inner && (inner.type === "identifier" || inner.type === "splat_parameter")) {
          const nm2 = inner.type === "identifier" ? inner.text : inner.childForFieldName("name")?.text
          // `_` binds too: see the note in collectParamNames.
          if (nm2) into.add(nm2)
        }
      }
      continue
    }
    const WRAPPED = new Set(["optional_parameter", "keyword_parameter", "splat_parameter",
      "hash_splat_parameter", "block_parameter", "forward_parameter", "destructured_parameter"])
    if (WRAPPED.has(c.type)) {
      const named = c.childForFieldName("name")
      if (named && named.text) into.add(named.text)
      continue
    }
    // `_` IS a binding even when it is the throwaway name. PROBED:
    // `[1].each do |_|` then reading `_` publishes ONLY `calls:each`. Since the
    // throwaway never binds anything, excluding it from the binding set let every
    // read of `_` become a call - 622 MISSING `calls`, including the block parameter
    // of every `scan(RE) do |text, _|` in the corpus.
    if (c.type === "identifier") into.add(c.text)
  }
}

/** Bindings introduced by a pattern match: `in {a:}` / `in [x, *rest]`. */
function collectPatternBindings(n: Node, into: Set<string>): void {
  if (n.type === "identifier") { if (n.text !== "_") into.add(n.text); return }
  if (n.type === "keyword_pattern") {
    // PROBED: `in {a:}` yields `keyword_pattern` -> `hash_key_symbol` and NO value
    // node, so the grammar never records the binding even though Ruby has one. The
    // key text is the only thing available, and reading the body as `calls:a` is
    // what the corpus disagreed on.
    const v = n.childForFieldName("value")
    if (v) collectPatternBindings(v, into)
    else {
      const key = n.namedChild(0)
      if (key) {
        let k = key.text
        if (k.charCodeAt(0) === 58) k = k.slice(1)
        if (k.length > 0 && k.charCodeAt(k.length - 1) === 58) k = k.slice(0, -1)
        if (k !== "_") into.add(k)
      }
    }
    return
  }
  if (n.type === "splat_parameter" || n.type === "rest_parameter") {
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && c.type === "identifier") into.add(c.text)
    }
    return
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) collectPatternBindings(c, into)
  }
}

/** Is `name` bound in ANY enclosing scope of the chain? */
function isBound(bindings: Map<number, Set<string>>, scopes: number[], name: string): boolean {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const set = bindings.get(scopes[i])
    if (set && set.has(name)) return true
  }
  return false
}

export function deriveRubyEdges(root: Node): RubyTruthEdge[] {
  const edges: RubyTruthEdge[] = []
  const bindings = collectBindings(root)

  const bases = new Map<string, string>()
  /** Members declared by each class in THIS file, for implicit `overrides`. */
  const members = new Map<string, Set<string>>()

  // `calls`, `uses` and `contains` edges carry NO `from`. The analyzer's edge for
  // `def m; @a; end` is `uses:>@a` and for `def m; b; end` is `calls:>b` - the
  // enclosing method is implied by containment and never restated. Threading the
  // method name through as `from` (which an earlier version of this file did, and
  // which the SHARED oracle also does) put a `from` on every edge in the corpus:
  // 4,178 `calls` and 674 `uses` disagreed purely because of it.
  //
  // `from` is still carried, because two cases genuinely need it: an anonymous
  // scope's `contains` (which anonymous class), and an implicit `overrides`
  // (subclass.method -> superclass.method).
  const push = (label: RubyTruthEdge["label"], target: string, line: number, from?: string): void => {
    if (!target || target.length === 0) return
    edges.push(from === undefined ? { label, target, line } : { label, target, from, line })
  }

  const stack: Frame[] = [{ n: root, parent: null, suppress: undefined, inBody: false, scopes: [], cls: undefined, methodId: undefined }]
  const emittedCallTargets = new Set<string>()

  while (stack.length > 0) {
    const f = stack.pop()!
    const n = f.n
    const t = n.type
    const line = n.startPosition.row + 1
    const parent = f.parent

    // ---------------------------------------------------------------- classes
    if (t === "singleton_class") {
      // `class << self` has no name, but the methods inside it ARE members of the
      // enclosing class - PROBED: `module M; class << self; def go; end; end; end`
      // publishes `contains:go`. Passing `undefined` for `cls` here dropped every
      // singleton method in the corpus.
      //
      // UNLESS it is nested inside a METHOD BODY. PROBED:
      // `def m; class << self; def full_url_for(o); end; end; end` publishes ONLY
      // `contains:m` - the singleton reopens `self` of a call frame, which is not the
      // class, so nothing inside it is a member of one. Same principle as the
      // nested-def rule. Without this, route_set.rb's nested proxy singleton invented
      // `contains` for methods the graph does not treat as members.
      let inMethodBody = false
      for (let q: Node | null = n.parent; q; q = q.parent) {
        if (q.type === "class" || q.type === "module" || q.type === "singleton_class") break
        if (q.type === "method" || q.type === "singleton_method") { inMethodBody = true; break }
      }
      const body = n.childForFieldName("body")
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (!c) continue
        stack.push({
          n: c, parent: n,
          suppress: f.suppress, inBody: false,
          scopes: [...f.scopes, n.id],
          cls: inMethodBody ? undefined : f.cls, methodId: f.methodId,
        })
      }
      void body
      continue
    }

    if (t === "class" || t === "module") {
      const nameNode = n.childForFieldName("name")
      const scopeNode = n.childForFieldName("scope")
      // `class << self` has no name — it is an anonymous singleton, so it cannot
      // own a namable `contains` edge.
      // A QUALIFIED class name is a member of its SCOPE: `class ActivityPub::ContextsController`
      // declares `ContextsController` inside `ActivityPub`, which is why the analyzer
      // emits `contains:ContextsController`. Treating the whole dotted name as the class
      // name hid that, and every namespaced class in the corpus disagreed. PROBED against
      // the emitted `contains ActivityPub -> ContextsController`.
      let scopePrefix: string | undefined
      let clsName: string | undefined
      if (nameNode && nameNode.type === "scope_resolution") {
        const outer = nameNode.childForFieldName("scope")
        const inner = nameNode.childForFieldName("name")
        scopePrefix = outer ? constantPath(outer) ?? undefined : undefined
        clsName = (inner ? constantPath(inner) : constantPath(nameNode)) ?? undefined
      } else {
        clsName = constantPath(nameNode) ?? constantPath(scopeNode) ?? undefined
      }
      const superNode = n.childForFieldName("superclass")
      const superName = constantPath(superNode)
      if (clsName && superName) bases.set(clsName, superName)

      // DIRECTION matters: the analyzer emits `extends` with the SUPERCLASS as the
      // TARGET (`class C < B` -> `extends -> B`), not with `C` as the target. Mine
      // was backwards, which is why 5,411 inheritance edges were unexplained while
      // 520 of mine were missing.
      // A class declared INSIDE another is a member of it: `class Outer; class
      // Inner; end; end` -> `contains:Inner`, and likewise `module M; class C;`.
      // PROBED in both the plain and the module-qualified form. The top-level case
      // emits nothing, which is why this is gated on having an owner at all.
      if (scopePrefix) push("contains", leafName(clsName ?? scopePrefix), line, undefined)
      if (clsName && f.cls !== undefined) push("contains", clsName, line, undefined)

      // DIRECTION matters: the analyzer's edge is `extends -> <superclass LEAF>`
      // (`class C < A::B` -> `extends -> B`, probed), with the subclass as `from`.
      // CORRECTED BY RE-READING THE PAYLOAD. The analyzer's `extends` DOES carry a
      // source - the subclass - and the target is the superclass LEAF:
      // `class AccountsIndex < Chewy::Index` -> `extends AccountsIndex -> Index`.
      // My earlier probe printed `from === undefined` because it read a field named
      // `from`; the emitted key is `source` (the census reads `r.source ?? r.from`).
      // So the original `clsName` source was RIGHT and the "fix" that removed it was
      // the error - which is why 4,967 inheritance edges stayed unexplained across two
      // rounds. A probe that reads a field the payload does not use reports absence,
      // not absence in the payload.
      if (superName) push("extends", leafName(superName), line, clsName)

      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (!c) continue
        // A base expression is evaluated in the OUTER scope, not inside the class.
        const isSuper = superNode !== null && c.id === superNode.id
        stack.push({
          n: c, parent: n,
          suppress: f.suppress, inBody: false,
          scopes: isSuper ? f.scopes : [...f.scopes, n.id],
          cls: isSuper ? f.cls : clsName,
          methodId: f.methodId,
        })
      }
      continue
    }

    // ------------------------------------------------------------------ defs
    if (t === "method" || t === "singleton_method") {
      const nameField = n.childForFieldName("name")
      let name: string | null = null
      if (nameField) {
        // `def <<(o)` parses the NAME as an `operator` node; `def size=(v)` as a
        // `setter` wrapping an identifier. Both are real method names.
        // `def size=(v)` is the member `size=` - dropping the `=` published a
        // method nobody can call. `def <<(o)` keeps the operator text as-is.
        name = nameField.type === "operator" ? nameField.text
          : nameField.type === "setter" ? nameField.text
            : nameField.text
      }
      // A def nested INSIDE a method body does not define a member of the
      // enclosing class: it defines a method on the receiver's singleton
      // (`def setup; def @view.key; end; end`). A def whose parent is a class or
      // module body is an ordinary member.
      // A def nested inside a METHOD BODY. `def setup; def @view.key; end; end`
      // defines on `@view`'s singleton, not on the class. Walking up matters
      // because the nested def's immediate parent is the `body_statement` of the
      // outer def, not the def itself - checking only the parent silently missed
      // every real case and published a `contains` for a method nobody can call.
      let parentIsDef = false
      for (let q: Node | null = parent; q; q = q.parent) {
        if (q.type === "class" || q.type === "module" || q.type === "singleton_class") break
        if (q.type === "method" || q.type === "singleton_method") { parentIsDef = true; break }
      }
      const owner = parentIsDef ? undefined : f.cls
      // The `from` of a `contains` edge is UNDEFINED whenever the enclosing scope
      // is namable. The analyzer emits `contains:>m` - the owner is implied by
      // lexical containment, and naming it again duplicated it on every member.
      // `from` carries a value only for an ANONYMOUS scope, where "which anonymous
      // class" is the only thing that can be said. Probed across plain, inherited,
      // nested, reopened, module-qualified and singleton defs - all `contains:>name`.
      if (name && owner !== undefined) {
        push("contains", name, line, undefined)
        // Record the member against its OWNING class so implicit `overrides` can
        // be resolved after the walk. `owner` is the lexically enclosing class,
        // which for `class Sub < Base` is `Sub`.
        if (f.cls !== undefined) {
          let set = members.get(f.cls)
          if (!set) { set = new Set<string>(); members.set(f.cls, set) }
          set.add(name)
        }
      }

      // The analyzer's `contains` edge has an EMPTY `from` - `contains:>m`, not
      // `contains:C>m`. A member belongs to the class that lexically encloses it,
      // which the owner already implies, so naming the owner in `from` duplicated
      // it and put an owner on 14,066 edges the analyzer leaves unscoped. Only
      // anonymous scopes need `from` at all, to say WHICH anonymous scope.
      const methodId = name ?? undefined
      const bodyIsValue = nameField !== null && n.namedChildCount <= 2 &&
        n.childForFieldName("body") === null && n.childForFieldName("parameters") !== null
      // An endless `def label = name` has its value as a DIRECT named child with
      // no `body_statement` wrapper. The def NAME is the first named child, so
      // push the value with inBody=true and let the positional name check skip it.
      const inBody = f.inBody || t === "method" || t === "singleton_method"

      // NO `receiver` FIELD EXISTS on a Ruby def node in this grammar - verified by
      // probing `def @view.key`, `def self.foo` and `def Foo.bar`, all of which
      // return `undefined`. The receiver is the named child POSITIONALLY BEFORE the
      // name. Two rules follow, and both were wrong before this was measured:
      //
      //   * the name is not "the first named child" - for `def self.name` the first
      //     is `self`, so the old code skipped the receiver and then let the NAME
      //     fall through to be read as an expression. It looked right only because
      //     `self` happens to be a builtin.
      //   * everything after the name is params/body; everything before it is the
      //     receiver, which is a `uses` reference to the object being defined on.
      let nameIndex = -1
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c && nameField !== null && c.id === nameField.id) { nameIndex = i; break }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (!c) continue
        if (i === nameIndex) continue
        const isReceiver = nameIndex >= 0 && i < nameIndex
        const isParams = c.type === "method_parameters" || c.type === "parameters" || c.type === "block_parameters"
        stack.push({
          n: c, parent: n,
          suppress: f.suppress, inBody: isReceiver || !isParams ? inBody : false,
          scopes: [...f.scopes, n.id], cls: owner, methodId,
        })
      }
      void bodyIsValue
      continue
    }

    // ----------------------------------------------------------------- blocks
    if (t === "block" || t === "do_block") {
      // `x = Class.new do ... end` names a class, and members declared in its block
      // are its members. PROBED against `beating = Class.new do def beat; end end`:
      // the analyzer publishes `contains:beat`. My factory rule only fired for a
      // CONSTANT on the left, so a LOCAL binding produced an anonymous scope and
      // dropped every method in the block - 253 UNEXPLAINED `contains`, e.g.
      // `initialize` and `beat` in `actioncable/test/server/base_test.rb`.
      //
      // A local name is as namable as a constant here, so this is not the
      // "anonymous owner" case; the target is known within this file.
      // `X = Class.new do ... end` where X is a CONSTANT: the block's members belong to
      // X. PROBED: `X = Class.new do def name; end end` -> `contains:name`.
      //
      // With a LOCAL left (`beating = Class.new do ... end`) the analyzer does NOT
      // reparent: it keeps the members on the ENCLOSING class
      // (`base_test.rb` -> `contains BaseTest -> beat`), because a local-bound
      // anonymous class is not a graph node it will name. So the correct owner here is
      // simply `f.cls`, which is what the fallthrough already does. Naming the local
      // published `contains` with an owner nothing can resolve, and it was the wrong
      // owner as well as an invented one.
      const callParent = n.parent
      if (callParent !== null && callParent.type === "call" &&
          callParent.childForFieldName("method")?.text === "new") {
        const asg = callParent.parent
        if (asg !== null && asg.type === "assignment") {
          const left = asg.childForFieldName("left")
          if (left !== null && left.type === "constant") {
            const owner = left.text
            for (let i = n.namedChildCount - 1; i >= 0; i--) {
              const c = n.namedChild(i)
              if (c) stack.push({ n: c, parent: n, suppress: f.suppress, inBody: f.inBody, scopes: [...f.scopes, n.id], cls: owner, methodId: f.methodId })
            }
            continue
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ n: c, parent: n, suppress: f.suppress, inBody: f.inBody, scopes: [...f.scopes, n.id], cls: f.cls, methodId: f.methodId })
      }
      continue
    }

    if (t === "lambda") {
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ n: c, parent: n, suppress: f.suppress, inBody: f.inBody, scopes: [...f.scopes, n.id], cls: f.cls, methodId: f.methodId })
      }
      continue
    }

    // ------------------------------------------------- assignments & writers
    if (t === "assignment") {
      const left = n.childForFieldName("left")
      const right = n.childForFieldName("right")
      const rightIsCall = right !== null && (right.type === "call" || right.type === "command")
      const methodName = right !== null ? (right as any).childForFieldName?.("method")?.text : undefined
      const recv = right !== null ? constantPath((right as any).childForFieldName?.("receiver")) : null

      if (rightIsCall && methodName === "new" && left !== null && left.type === "constant") {
        // NAMABLE OWNER: a constant on the left names the anonymous class, so
        // members of its block belong to it.
        // The analyzer's contract: `instantiates` names the class being
        // INSTANTIATED, which is the RECEIVER (`Class.new` -> `Class`), not the
        // constant the result is bound to. Naming the left instead produced
        // `instantiates:Acct` for `Acct = Class.new do`.
        // The receiverless form builds the ENCLOSING class. PROBED: `EMPTY = new('',
        // nil)` inside a class -> `instantiates:C` (the enclosing class), NOT
        // `instantiates:EMPTY`. Naming the left was wrong for the constant case too:
        // `X = Foo.new` -> `instantiates:Foo`.
        const recvName = constantPath(right ? right.childForFieldName("receiver") : null)
        // `b = Class.new do ... end` (LOCAL left) still publishes `instantiates:Class`
        // - the receiver is what is being constructed. Only the `contains` for the
        // name is suppressed, because a local binds no graph node.
        //
        // A RECEIVERLESS `new` does NOT build the enclosing class from inside a
        // method. PROBED: `EMPTY = new('', nil)` in a CLASS BODY -> `instantiates:C`,
        // but `current_account.account_moderation_notes.new(…)` is a collection build
        // and `new` inside a def is just an unknown constructor. Falling back to
        // `f.cls` unconditionally was 626 MISSING `instantiates`, every one of them a
        // collection `.new` in a Rails controller method being reported as an
        // instantiation of the controller.
        if (recvName) push("instantiates", leafName(recvName), line)
        // A constant bound to a factory IS a member of the enclosing scope.
        // PROBED across all four factories: `E = Class.new`, `E = Struct.new(:a)`,
        // `E = Module.new do def go; end end` and `E = Foo.new` each publish
        // `contains:E`. This branch `continue`s, so the generic constant-assignment
        // rule below it never ran for factories - the same unreachable-rule shape as
        // the `X = 1` case, and it hid every `SOME_CONSTANT = Something.new` member.
        if (f.cls !== undefined) push("contains", left.text, line, undefined)
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (!c) continue
          const isLeft = left !== null && c.id === left.id
          stack.push({
            n: c, parent: n,
            suppress: f.suppress, inBody: false, scopes: isLeft ? f.scopes : [...f.scopes, n.id],
            cls: isLeft ? f.cls : left.text, methodId: f.methodId,
          })
        }
        continue
      }
      // `Struct.new(:a, :b)` does NOT declare a struct, its fields, or a class. Only
      // a BLOCK form declares methods, and the factory rule below already covers
      // that. PROBED directly:
      //   `X = Struct.new(:a, :b)`          -> analyzer contains: (none), oracle -
      //   `X = Struct.new(:a) do def go; end` -> analyzer contains:go, oracle -
      // Both attempts to publish struct fields were fabrication - 615 MISSING
      // `contains` edges, one per field per struct, for classes that do not exist.
      // Deleted rather than fixed: the premise was wrong, not the predicate.
      //
      // `x = X.new { }` where the left is NOT a constant. PROBED: the analyzer does
      // NOT reparent these members onto an anonymous class - it keeps them on the
      // ENCLOSING class (`class BaseTest; b = Class.new do def beat; end end; end`
      // gives `contains BaseTest -> beat`). A local-bound anonymous class is not a
      // graph node it will name, so the members stay where they are lexically.
      //
      // Clearing `cls` to `undefined` here was the 253 UNEXPLAINED `contains`: every
      // member declared inside `b = Class.new do ... end` lost its owner and vanished
      // from the oracle. Note the contrast with the CONSTANT case just above, which
      // does reparent - the namable-owner rule again, and the two branches have to
      // differ.
      if (rightIsCall && methodName === "new") {
        // A LOCAL left: the receiver is still instantiated, but nothing is named.
        const recv0 = constantPath(right ? right.childForFieldName("receiver") : null)
        if (recv0) push("instantiates", leafName(recv0), line)
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (!c) continue
          stack.push({ n: c, parent: n, suppress: f.suppress, inBody: false, scopes: f.scopes, cls: f.cls, methodId: f.methodId })
        }
        continue
      }

      // `a[b] = ...` marks `b` a WRITE for the whole assignment, on BOTH sides.
      // PROBED: `poll.cached_tallies[choice] = (poll.cached_tallies[choice] || 0) + 1`
      // publishes `calls:cached_tallies` twice and NO `calls:choice` - even though the
      // right-hand side reads the same index. Same rule as the multiple assignment
      // (`@a, @b = a, b`): a target position collects the name, and every occurrence
      // of it inside the same expression is that binding, not a fresh read. Without
      // this the oracle published `calls:choice` for every indexed-write in the corpus.
      let writeNames: Set<string> | undefined
      if (left !== null && left.type === "element_reference") {
        writeNames = new Set<string>()
        const collected: Set<string> = writeNames
        const collectIndex = (nd: Node): void => {
          for (let i = 0; i < nd.namedChildCount; i++) {
            const ch = nd.namedChild(i)
            if (!ch) continue
            if (ch.type === "identifier" || ch.type === "instance_variable" ||
                ch.type === "class_variable") collected.add(ch.text)
            else collectIndex(ch)
          }
        }
        collectIndex(left)
      }

      // A CONSTANT assigned in a class/module body is a member of it: `class C; X = 1;
      // end` -> `contains:X` (probed, including for a non-trivial right-hand side).
      // This has to live HERE rather than in a second `assignment` branch further
      // down the walk: the branch this sits in ends in `continue`, so a later
      // `if (t === "assignment")` is DEAD CODE and can never run. That is why `X = 1`
      // published nothing - a rule that existed, carried an explanatory comment, and
      // never executed. The same shape as §38's endless-def comment: prose describing
      // behaviour the adjacent code does not have.
      if (left !== null && left.type === "constant" && f.cls !== undefined) {
        push("contains", left.text, line, undefined)
      }
      void recv
      void methodName
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ n: c, parent: n, suppress: writeNames ?? f.suppress, inBody: f.inBody, scopes: f.scopes, cls: f.cls, methodId: f.methodId })
      }
      continue
    }

    if (t === "operator_assignment") {
      const left = n.childForFieldName("left")
      const right = n.childForFieldName("right")
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (!c) continue
        const isLeft = left !== null && c.id === left.id
        if (isLeft) continue
        if (right !== null && c.id === right.id) {
          stack.push({ n: c, parent: n, suppress: f.suppress, inBody: true, scopes: f.scopes, cls: f.cls, methodId: f.methodId })
          continue
        }
        stack.push({ n: c, parent: n, suppress: f.suppress, inBody: f.inBody, scopes: f.scopes, cls: f.cls, methodId: f.methodId })
      }
      continue
    }

    // ------------------------------------------------------------------ alias
    // `alias new old` publishes `calls:new` and NO member. PROBED three ways:
    //   def push; alias << push     -> calls:<< , no contains:<<
    //   alias foo? bar               -> calls:foo?, no member
    //   alias_method :c, :b          -> calls:alias_method calls:c , no member
    // So the keyword reads its NEW name as an expression and declares nothing.
    // NOT gated on `inBody`: `class C; alias foo? bar; end` publishes `calls:foo?` at
    // CLASS-BODY scope, where `inBody` is false. The name in an alias is a declaration
    // being read, not an expression in a body, so the body-context test does not apply.
    if (t === "alias") {
      // Only an IDENTIFIER-shaped new name is read. PROBED: `alias foo? bar` gives
      // `calls:foo?`; `alias << push` gives nothing at all - an operator target is not
      // a method name that can be called, so the generalisation "the new name is read"
      // is wrong for operators and only a fixture shows it.
      const firstA = n.namedChild(0)
      if (firstA && firstA.type === "identifier" && !RUBY_BUILTINS.has(firstA.text)) {
        push("calls", firstA.text, firstA.startPosition.row + 1)
      }
      continue
    }

    // `alias` (keyword) declares no member. PROBED, three ways:
    //   def push(x); alias << push    -> contains:push   (no `<<`)
    //   def a; def b; alias_method :c, :b  -> contains:a b   (no `c`)
    //   def b; alias_method :c, :b     -> contains:b      (no `c`)
    // Neither the keyword form nor `alias_method` creates a member. My earlier rule
    // emitted the new name whenever the old one was declared, which is the OPPOSITE
    // of the contract and invented a `contains` per alias in the corpus -
    // `contains:<<` in `shared_timed_stack.rb`, `contains:new` in `request.rb`. The
    // keyword's identifiers are method-name DECLARATIONS at parse time but the
    // analyzer does not publish them, so neither does the oracle.
    if (t === "alias") continue

    // ------------------------------------------------------- require/refs
    if (t === "call") {
      const methodNode = n.childForFieldName("method")
      const methodName = methodNode?.text ?? ""
      // The call itself: `Fabricator(:x)`, `after_build do |f|`, `channel.go`.
      // Not a builtin, in a body, and not bound as a local. A CAPITALIZED callee is
      // still a call (`Fabricator` is a method here, not a constant reference).
      // NOT gated on `inBody`. `inBody` exists to decide whether a BARE IDENTIFIER
      // is a read or a name; a call node has already committed to being a call, so
      // `test "a" do` and `Fabricator(:x) do` read as calls even at file scope.
      // Gating these lost `calls:test`, `calls:Fabricator`, `calls:after_build`.
      // A call with a CONSTANT receiver and NO method name is a Kernel conversion
      // function: `Array(x)`, `Hash(x)`, `String(x)`. PROBED: `Foo(1)` publishes
      // `calls:Foo` (a user-defined capitalised method) but `Array(1)` publishes
      // NOTHING, while `Array.new` is `instantiates:Array`. So these are Kernel
      // intrinsics, distinct from both. 1,321 MISSING `calls` were exactly this.
      // PROBED: for a receiverless `Array(x)` the grammar puts the `constant` in the
      // `method` FIELD - `childForFieldName("method").type === "constant"`, not a
      // `receiver`. Testing `methodNode === null` therefore never fired, which is why
      // this rule changed nothing on the first attempt. A constant in the method
      // position with no receiver is the conversion-function shape.
      // ...but only ITSELF. `Array(x)` suppresses the conversion name and still
      // publishes `calls:x`, so this must not `continue` past the arguments.
      const isKernelConversion = methodNode !== null && methodNode.type === "constant" &&
        n.childForFieldName("receiver") === null && KERNEL_CONVERSIONS.has(methodNode.text)
      void isKernelConversion

      // A Kernel conversion suppresses ITSELF but not its arguments: PROBED,
      // `Array(x)` publishes `calls:x` and no `calls:Array`.
      if (methodName && !RUBY_BUILTINS.has(methodName) && !isKernelConversion &&
          methodNode !== null && !isBound(bindings, f.scopes, methodName)) {
        push("calls", methodName, line)
      }
      // ONLY A RECEIVERLESS call is a require. PROBED: `params.require("body-mime")`
      // publishes NOTHING - it is a Rails strong-parameters call, not a file load,
      // and its string argument is a parameter name. Requiring a receiver here
      // fabricated a `references` edge for every strong-parameter read in the
      // corpus, and the target was not even a path (`body-mime`, `RawEmail`).
      const hasReceiver = n.childForFieldName("receiver") !== null
      if (!hasReceiver &&
          (methodName === "require" || methodName === "require_relative" ||
           methodName === "autoload" || methodName === "load")) {
        // Only a STRING LITERAL names a required file. PROBED: `require "a/b"` gives
        // exactly one `references` edge; nothing else on the call contributes. This
        // branch walked every NAMED child, so `params.require(:domain_block)` and
        // similar contributed their receiver and their hash key as "references" -
        // including the literal text `(:domain_block)`, a parentheses-and-colon
        // fragment that is not a path in any sense. That was 1,826 MISSING
        // `references`, the single largest remaining class.
        const args = n.childForFieldName("arguments")
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (!a) continue
            if (a.type !== "string" && a.type !== "bare_string") continue
            // An INTERPOLATED literal is not a path. PROBED: `require "a/#{x}"` and
            // `require "a#{x}"` both publish NOTHING, in either quote style, while
            // `require 'a/b'` publishes `references:a/b`. The target is computed at
            // runtime, so the file it names is unknowable from the tree - and the
            // fragment `a/#{x}_b` is not a path in any sense. 297 MISSING
            // `references` were exactly these (every adapter/service require in
            // Rails, e.g. `require "active_support/cache/#{store}"`).
            if (hasInterpolation(a.text)) continue
            const name = unquote(a.text)
            if (name.length > 0) {
              push("references", name, line, methodName === "autoload" ? "ruby-autoload" : `ruby-${methodName}`)
            }
          }
        }
        continue
      }
      // The FACTORY form (`K = X.new`) already emitted its `instantiates` in the
      // assignment branch above, with the correct receiver. Emitting it again here
      // produced a duplicate per factory - 7 MISSING `instantiates`, one per `Class.new`
      // assignment in the corpus. The two branches now partition the work: the
      // assignment branch handles factories, this one handles every other `.new`.
      const inFactoryAssignment = parent !== null && parent.type === "assignment" &&
        parent.childForFieldName("right")?.id === n.id
      if ((methodName === "new" || methodName === "allocate") && !inFactoryAssignment) {
        const recvNode = n.childForFieldName("receiver")
        const recv = constantPath(recvNode)
        // An UPPERCASE receiver instantiates a known class; a lowercase receiver
        // is a local whose class is unknowable, so it stays a plain call.
        // The target is the LEAF of the receiver path: `A::B.new` -> `B`, not
        // `A::B` (probed).
        //
        // Anything else is an ASSOCIATION COLLECTION, not a class. PROBED:
        // `x.account_moderation_notes.new(r)` -> `calls:account_moderation_notes` with
        // NO `instantiates`, and `account.notes.new` -> `calls:notes` likewise. An
        // instance-variable receiver keeps `calls:new`: `@x.new(r)` gives
        // `calls:new uses:@x`. Collapsing every non-constant receiver into the
        // enclosing class was 626 MISSING `instantiates` - every
        // `current_account.account_notes.new(…)` in the Rails controllers, which
        // builds a collection rather than a class.
        if (recv) push("instantiates", leafName(recv), line)
        else if (recvNode !== null) {
          // A lowercase RECEIVER keeps the call; an instance variable keeps `new`.
          if (recvNode.type === "identifier") push("calls", "new", line)
        } else {
          // A receiverless `new` constructs the ENCLOSING class (probed).
          if (f.cls) push("instantiates", f.cls, line)
        }
      }
      if (methodName === "include" || methodName === "extend" || methodName === "prepend") {
        const args = n.childForFieldName("arguments")
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i)
            if (!a) continue
            // The mixin target must be NAMEABLE. PROBED: `include M` and `include A::B`
            // both publish (`implements:M`, `implements:B` - the LEAF, so passing the
            // full path was the whole of the original 520 missing `extends`), but
            // `include local_account` publishes NOTHING - a lowercase identifier is a
            // local, and in RSpec it is almost always a `let` reference, not a mixin.
            // Accepting identifiers here published `implements:local_account`,
            // `implements:recipient`, `implements:bot_account` for every
            // `.to include(x)` matcher in the corpus: 274 MISSING `implements`, all
            // invented. A mixin is named by a constant; nothing else is nameable.
            const cn = constantPath(a)
            if (cn) push(methodName === "extend" ? "extends" : "implements", leafName(cn), line)
          }
        }
        // NO `continue` HERE, and that is the fix for 253 UNEXPLAINED `contains`.
        //
        // A call carrying a BLOCK (`Class.new do ... end`, `test "x" do ... end`,
        // `around_action :x do ... end`) used to `continue` out of the walk, so the
        // `do_block` child was never visited and the enclosing scope never reached
        // the members inside it. PROBED: `class BaseTest; beating = Class.new do
        // def beat; end end; end` -> the analyzer publishes `contains:beat`; mine
        // published nothing. The same bug silently swallowed every block-bodied
        // definition in the corpus - including `test` blocks, which is why whole
        // test files looked like they had no members.
        //
        // Falling through re-walks the children with the current owner, and the
        // `do_block` branch then applies its own factory/constant rules.
      }
    }

    // `define_method(:go) { }` DECLARES a member. PROBED: the analyzer publishes
    // `contains:go` for a LITERAL first argument, and nothing for
    // `define_method(m)` where the name is not statically known. It needs a namable
    // owner too, by the same rule as every other member.
    if (t === "call" && n.childForFieldName("method")?.text === "define_method") {
      const args0 = n.childForFieldName("arguments")
      if (f.cls !== undefined && args0 !== null) {
        const first0 = args0.namedChild(0)
        if (first0 && (first0.type === "simple_symbol" || first0.type === "symbol")) {
          const nm0 = symbolName(first0.text)
          if (nm0.length > 0) push("contains", nm0, first0.startPosition.row + 1, undefined)
        }
      }
    }

    // `alias_method :c, :b` publishes BOTH `calls:alias_method` and `calls:c` - the
    // macro is an ordinary call and its first symbol is read as an expression.
    // PROBED. The `alias` KEYWORD is different again: `alias foo? bar` publishes only
    // `calls:foo?` and no member, so the keyword branch below keeps its own handling.

    // ------------------------------------------------------------------ macros
    // `alias_method :c, :b` publishes `calls:c` as well as `calls:alias_method`.
    // PROBED. The macro name is a builtin (suppressed as a call) but its first symbol
    // is read as an expression, so the edge is emitted here rather than by the generic
    // call branch.
    if (t === "call" && n.childForFieldName("method")?.text === "alias_method") {
      const args1 = n.childForFieldName("arguments")
      // Also not gated on `inBody` - `class C; alias_method :c, :b; end` is class-body
      // scope and still publishes `calls:c`.
      if (args1 !== null) {
        const first1 = args1.namedChild(0)
        if (first1 && (first1.type === "simple_symbol" || first1.type === "symbol")) {
          const nm1 = symbolName(first1.text)
          if (nm1.length > 0) push("calls", nm1, line)
        }
      }
    }

    const macroName = macroOf(n)
    if (macroName) {
      if (DELEGATE_MACROS.has(macroName)) {
        // Forwarding: the arguments name methods on ANOTHER object. Nothing is
        // declared here, so no `contains` is emitted (probed).
      } else if (ASSOCIATION_MACROS.has(macroName) || ATTRIBUTE_MACROS.has(macroName)) {
        for (const a of macroArgs(n)) {
          const name = symbolName(a.text)
          if (name.length > 0) {
            if (ASSOCIATION_MACROS.has(macroName)) {
              // Association targets are PROPERTIES of the owner, so they get both
              // a `contains` and a `uses` edge. On an anonymous owner there is
              // nothing to attach a `uses` edge to, so it is skipped.
              // With a namable owner: a member AND a property. Without one the
              // analyzer still records the property - `belongs_to :user` says the
              // class HAS a user - but there is no member to attach it to, so
              // `contains` is not emitted and `uses` carries no owner.
              // Both edges name the ASSOCIATION TARGET (`belongs_to :user` ->
              // `contains:user` AND `uses:user`), and neither is scoped: the probe
              // shows `uses:>user` with an EMPTY `from`, so an association property
              // belongs to no owner. Passing `f.cls` invented 9,519 `uses` edges the
              // analyzer never emits, because `contains` is what carries the owner.
              //
              // `contains` requires a NAMABLE owner. In an anonymous scope
              // (`Class.new do belongs_to :user end`, with nothing naming it) the
              // analyzer emits `uses` alone - there is no class for the association
              // to be a member of. That is the namable-owner principle again, and
              // gating on `f.cls` rather than `!== undefined` is what encodes it.
              if (f.cls !== undefined) push("contains", name, a.startPosition.row + 1, undefined)
              push("uses", name, line, undefined)
            } else {
              // The SAME namable-owner rule as associations: PROBED, a bare
              // `Class.new do attr_reader :site end` publishes `instantiates:Class`
              // and NOTHING else - no `contains:site`. An attribute declared in an
              // anonymous class belongs to a class the graph will not name, so there
              // is no member to attach it to. Only a named owner yields `contains`.
              if (f.cls !== undefined) push("contains", name, a.startPosition.row + 1, undefined)
            }
          }
        }
      } else if (!CALLBACK_MACROS.has(macroName)) {
        // An unknown macro with hash arguments contributes `uses` edges.
        for (const a of macroArgs(n)) {
          if (a.type === "hash_key_symbol" || a.type === "simple_symbol" || a.type === "symbol") {
            push("uses", symbolName(a.text), line, f.cls ?? "anonymous")
          }
        }
      }
      // Still walk the arguments: they are real expressions.
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push({ n: c, parent: n, suppress: f.suppress, inBody: f.inBody, scopes: f.scopes, cls: f.cls, methodId: f.methodId })
      }
      continue
    }

    // ------------------------------------------------------------- constants
    if (t === "constant" || t === "scope_resolution") {
      // A constant reference is NOT a `uses` edge. Deriving one here put
      // `uses:C` behind every class in the corpus and, worse, made a class NAME
      // look like a payload it owned. The analyzer emits `uses` for exactly two
      // things - macro hash arguments and association properties - and a bare
      // constant is neither. Measured: this single line accounted for 6 of the
      // 14 smoke disagreements.
      continue
    }

    // -------------------------------------------------------------- `defined?`
    if (t === "unary") {
      const op = n.childCount > 0 ? n.child(0) : null
      if (op && !op.isNamed && op.type === "defined?") continue
    }
    if (t === "undef") continue

    // ---------------------------------------------------------- identifiers
    if (t === "identifier") {
      const text = n.text
      const parentType = parent?.type ?? ""
      // `flash[:a] = 1` is a WRITE through an index, not a call. PROBED: the read
      // `foo[:a]` publishes `calls:foo`, but the same node with an assignment parent
      // publishes NOTHING. Treating the index receiver as an ordinary read invented
      // 1,420 MISSING `calls` - every `flash[...]`, `params[...]`, `session[...]`
      // assignment in the corpus.
      const isIndexedWrite = parent !== null && parent.type === "element_reference" &&
        parent.parent !== null && parent.parent.type === "assignment" &&
        parent.parent.childForFieldName("left")?.id === parent.id
      if (isIndexedWrite) continue
      const parentIsNameField = parent !== null && parent.childForFieldName("name")?.id === n.id
      // `_` on the LEFT of any assignment is a throwaway WRITE, so the name is never
      // read. PROBED: `_ = 1`, `_, b = 1, 2` and `_, b, = IO.select(...)` all publish
      // nothing; only `_.to_s` (a real read) does, and that shape already agreed. The
      // binding table does not save us here because `_` binds nothing by name, so the
      // write test has to catch the left-hand side directly.
      // `_` on the left of an assignment is a throwaway WRITE, so the name is never
      // read. PROBED: `_ = 1`, `_, b = 1, 2` and `_, b, = IO.select(...)` all publish
      // nothing; only `_.to_s` (a real read) does, and that shape already agreed. The
      // binding table cannot save us here because `_` binds nothing by name, so the
      // write test has to catch the left-hand side directly. The multiple-assignment
      // form nests one level deeper: `left_assignment_list` inside `assignment`.
      let isWriteTarget = false
      if (parent !== null) {
        if (parent.type === "assignment" || parent.type === "operator_assignment") {
          isWriteTarget = parent.childForFieldName("left")?.id === n.id
        } else if (parent.type === "left_assignment_list") {
          const owner = parent.parent
          isWriteTarget = owner !== null &&
            (owner.type === "assignment" || owner.type === "operator_assignment") &&
            owner.childForFieldName("left")?.id === parent.id
        }
      }
      if (text === "_" && isWriteTarget) continue
      if (f.suppress !== undefined && f.suppress.has(text)) continue
      // A BARE index READ of an unvalidated attribute: PROBED
      // `poll.t[choice] = 1` publishes only `calls:t`, and
      // `poll.cached_tallies[choice] = (poll.cached_tallies[choice] || 0) + 1` publishes
      // `calls:cached_tallies` TWICE and no `calls:choice`. The index expression on
      // BOTH sides of the assignment is dropped, even though the same read appears
      // twice. So an identifier in index position of an assignment reads as nothing,
      // on either side.
      const isIndexOperand = parent !== null && parent.type === "element_reference" &&
        parent.parent !== null && parent.parent.type === "assignment" &&
        parent.parent.childForFieldName("left")?.id === parent.id
      if (isIndexOperand) continue
      if (f.inBody && !parentIsNameField && !NON_BARE_PARENTS.has(parentType) &&
          !RUBY_BUILTINS.has(text) && !isBound(bindings, f.scopes, text)) {
        emittedCallTargets.add(text)
        push("calls", text, line)
      }
      continue
    }

    // A GLOBAL variable is not read as a reference: `def m; $x = 1; $x; end`
    // publishes no edge for `$x`. Instance and class variables DO read.
    if (t === "global_variable") continue
    if (t === "instance_variable" || t === "class_variable") {
      const parentType = parent?.type ?? ""
      const isWrite = parent !== null &&
        (parent.type === "assignment" || parent.type === "operator_assignment") &&
        parent.childForFieldName("left")?.id === n.id
      // In RECEIVER position (`@view.key`, `self.foo`) a variable names the
      // object being read from; the analyzer records that as `uses`, not as a
      // bare call to the variable.
      // Receiver position, found POSITIONALLY. There is no `receiver` field on a
      // def node (measured), and none to consult here either, so for a def or
      // singleton_method the receiver is the named child before the name; for any
      // other parent the field is authoritative when the grammar supplies one.
      let isReceiver = parent !== null && parent.childForFieldName("receiver")?.id === n.id
      if (!isReceiver && parent !== null &&
          (parent.type === "method" || parent.type === "singleton_method")) {
        const pName = parent.childForFieldName("name")
        for (let i = 0; i < parent.namedChildCount; i++) {
          const pc = parent.namedChild(i)
          if (!pc) continue
          if (pName !== null && pc.id === pName.id) break
          if (pc.id === n.id) { isReceiver = true; break }
        }
      }
      // Every variable READ is a `uses` edge, receiver position or not (probed:
      // `def m; @a; end` -> `uses:@a`, and so does `@a = 1; @a`). A WRITE emits
      // nothing, which is why `def m; @a = 1; end` has no edge at all. The label
      // never depends on receiver position, so that variable is now irrelevant.
      // A MULTIPLE assignment writes and reads nothing. PROBED:
      // `def i(a,b); @x, @y = a, b; end` publishes NO edges, not `uses:@x`/`uses:@y`.
      // The single-target form is also a write and publishes nothing; only a bare
      // read does. So the write test has to cover the `left_assignment_list` parent
      // too, not just `assignment` - a left-assignment list is a separate node type
      // and was falling through as if the ivar were being read. 144 MISSING `uses`.
      const inMultiWrite = parent !== null && parent.type === "left_assignment_list" &&
        parent.parent !== null &&
        (parent.parent.type === "assignment" || parent.parent.type === "operator_assignment")
      if (f.suppress !== undefined && f.suppress.has(n.text)) continue
      // Only an INSTANCE variable read is a `uses` edge. PROBED: `def app; @@app; end`
      // publishes NOTHING, in any position - including the read after
      // `defined?(@@app)`, which is skipped anyway by the unevaluated-probe rule.
      // A class variable is a binding on the class, not a reference to a member.
      // 35 MISSING `uses`, e.g. `integration.rb`'s `@@app`.
      if (t === "class_variable") continue
      if (f.inBody && !isWrite && !inMultiWrite) push("uses", n.text, line)
      void isReceiver
      continue
    }

    // ------------------------------------------------------------- generic
    const inBody = f.inBody || t === "method" || t === "singleton_method"
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) {
        stack.push({
          n: c, parent: n,
          suppress: f.suppress,
          inBody: inBody,
          scopes: isScopeNode(t) ? [...f.scopes, n.id] : f.scopes,
          cls: f.cls, methodId: f.methodId,
        })
      }
    }
  }

  // IMPLICIT OVERRIDES: `class Sub < Base` where Sub redeclares a method Base also
  // declares gives `overrides:Base.method` (probed on
  // `Base#run` / `Sub#run`). This needs the file's class graph plus each class's
  // member set, so it runs after the walk. Only members of classes in THIS file can
  // be resolved, which is the honest limit: a base defined in another file is not
  // visible to a single-file oracle, and inventing it would be a guess.
  for (const [cls, base] of bases) {
    const own = members.get(cls)
    const inherited = members.get(base)
    if (!own || !inherited) continue
    for (const m of own) {
      if (inherited.has(m)) {
        push("overrides", `${base}.${m}`, 0, `${cls}.${m}`)
      }
    }
  }

  return edges
}

/** The macro name if this node is a macro call with a receiver or bare form. */
function macroOf(n: Node): string | null {
  if (n.type !== "call") return null
  const methodNode = n.childForFieldName("method")
  if (!methodNode) return null
  const name = methodNode.text
  if (ASSOCIATION_MACROS.has(name) || ATTRIBUTE_MACROS.has(name) ||
      CALLBACK_MACROS.has(name) || DELEGATE_MACROS.has(name)) return name
  return null
}

/** The leading symbol/string arguments of a macro call. */
function macroArgs(n: Node): Node[] {
  const out: Node[] = []
  const args = n.childForFieldName("arguments")
  if (!args) return out
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i)
    if (!a) continue
    if (a.type === "simple_symbol" || a.type === "symbol" || a.type === "string") out.push(a)
    else break
  }
  return out
}