import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// ── The clojure.core surface (CLJ-D17, 2026-09-28) ─────────────────────────
//
// WHAT THIS IS. The set of bare heads that are CLOJURE ITSELF — the standard
// library plus the special forms — so a call to one of them is a call to the
// language, not to a symbol in the program being indexed, and the analyzer
// emits no `calls` edge for it. That is the lane's declared contract (the
// Negative fixture pins it; the elixir lane's Kernel set is the family
// precedent) and it is unchanged by this wave. What changed is the SET.
//
// WHY IT IS NO LONGER HAND-TYPED. It WAS hand-typed — 437 names, 368 of them
// clojure.core vars and 69 deliberate extras. The F5 oracle IMPORTS this object
// by reference, so every name MISSING from the list is a MIRRORED
// fabrication: the analyzer emitted `calls -> mapcat` and the truth side
// derived `calls -> mapcat`, and the differential reported 0 unexplained. The
// lane's own history is a list of exactly that class of defect (W23's mirrored
// `case` default, W24's mirrored letfn shadow), so a shared hand list was a
// single point of blindness no gate could see through.
//
// MEASURED, not asserted. `script/m14/tmp/clj-core-derive.ts` parses
// clojure/clojure's own `src/clj/clojure/*.clj` with the pinned wasm, keeps the
// files whose `ns`/`in-ns` is `clojure.core` (or `clojure.core.protocols` /
// `clojure.core.reducers`), keeps only TOP-LEVEL def-family forms (an
// internal helper defined inside a `defn` body is not public API), and drops
// anything the analyzer's own privacy rule calls private (`defn-`,
// `^:private`, `^{:private true}`). That derivation yields **654** public
// vars. The gap against the hand list was **286**; the impact census
// (`script/m14/tmp/clj-core-impact.ts`) measured **2,525** fabricated `calls`
// edges to those 286 names in the clojure corpus alone (30% of all 8,391 call
// edges), 999 in clj-kondo and 151 in core.async.
//
// WHY A CONSTANT AND NOT A RUNTIME DERIVATION. The analyzer must not read the
// corpus: its output has to be a function of one file, not of which checkouts
// happen to be on the box. So the DERIVATION is the evidence and this list is
// the shipped constant — a reviewed, diffable artifact that the derivation
// re-checks (a gate, `script/m14/tmp/clj-core-derive.ts`, prints the gap).
//
// THE 69 EXTRAS are deliberate and kept: special forms (`if` `do` `let` `try`
// `catch` `finally` `throw` `recur` `quote` `var` `set!` `new` `def` `defn`
// `defn-` `defonce` `in-ns` `monitor-enter`/`-exit` `deftest` `is` `testing`),
// the declaration heads, uncurried interop statics that a Clojure program
// writes bare (`Math/abs`, `String/join`, `System/exit`, …), and the
// clojure.string / clojure.test spellings (`join` `split` `trim`
// `lower-case` `upper-case` `triml` `trimr` `trim-newline`).
//
// AND THE GUARD, because a name can be both: a core name that the FILE ITSELF
// binds, or that an ns `:refer`/`:only`/`:rename` clause names, is not a
// standard-library call at that site. `isCoreCallSuppressed` (below) is the
// only gate any suppression site uses, and it consults the analyzer's existing
// order-aware shadow ranges and the refer table. Without it the expansion
// would trade 286 fabrications for new ones.
export const CLOJURE_CORE_BUILTINS = (function(){ const r: Record<string, boolean> = Object.create(null); const arr = [
  "*", "*'", "*1", "*2", "*3", "*data-readers*", "*default-data-reader-fn*", "*e", "*print-length*", "*print-level*", "*print-namespace-maps*", "*repl*",
  "*verbose-defrecords*", "+", "+'", "-", "-'", "->", "->>", "-cache-protocol-fn", "-reset-methods", ".", "..", "/",
  "<", "<=", "=", "==", ">", ">=", "Double/parseDouble", "EMPTY-NODE", "Integer/parseInt", "Long/parseLong", "Math/abs", "Math/ceil",
  "Math/floor", "Math/max", "Math/min", "Math/pow", "Math/random", "Math/round", "Math/sqrt", "NaN?", "PrintWriter-on", "StackTraceElement->vec", "String/format", "String/join",
  "String/split", "String/valueOf", "System/currentTimeMillis", "System/exit", "System/gc", "System/getProperty", "System/nanoTime", "Thread/currentThread", "Thread/sleep", "Throwable->map", "UUID/randomUUID", "abs",
  "accessor", "aclone", "add-classpath", "add-doc-and-meta", "add-tap", "add-watch", "agent", "agent-error", "agent-errors", "agent?", "aget", "alength",
  "alias", "all-ns", "alter", "alter-meta!", "alter-var-root", "amap", "ancestors", "and", "any?", "append!", "apply", "areduce",
  "array-map", "as->", "aset", "assert", "assoc", "assoc!", "assoc-in", "associative?", "atom", "atom?", "await", "await-for",
  "await1", "bases", "bean", "bigdec", "bigint", "biginteger", "binding", "binding-conveyor-fn", "bit-and", "bit-and-not", "bit-clear", "bit-count",
  "bit-flip", "bit-not", "bit-or", "bit-set", "bit-shift-left", "bit-shift-right", "bit-test", "bit-xor", "boolean", "boolean-array", "boolean?", "booleans",
  "bound-fn", "bound-fn*", "bound?", "bounded-count", "butlast", "byte", "byte-array", "byte?", "bytes", "bytes?", "case", "cast",
  "cat", "catch", "char", "char-array", "char-escape-string", "char-name-string", "char?", "chars", "chunk", "chunk-append", "chunk-buffer", "chunk-cons",
  "chunk-first", "chunk-next", "chunk-rest", "chunked-seq?", "class", "class?", "clear-agent-errors", "clojure-version", "code-char", "coll?", "comment", "commute",
  "comp", "comparator", "compare", "compare-and-set!", "compile", "complement", "completing", "concat", "cond", "cond->", "cond->>", "condp",
  "conj", "conj!", "cons", "constantly", "construct-proxy", "contains?", "count", "counted?", "create-ns", "create-struct", "cycle", "dec",
  "dec'", "decimal?", "declare", "dedupe", "def", "default-data-readers", "definline", "definterface", "defmacro", "defmethod", "defmulti", "defn",
  "defn-", "defonce", "defprotocol", "defrecord", "defstruct", "deftest", "deftype", "delay", "delay?", "delayed?", "deliver", "denominator",
  "deref", "derive", "descendants", "destructure", "disj", "disj!", "dissoc", "dissoc!", "distinct", "distinct?", "do", "doall",
  "dorun", "doseq", "dosync", "dotimes", "doto", "double", "double-array", "double?", "doubles", "drop", "drop-last", "drop-while",
  "eduction", "empty", "empty?", "ensure", "ensure-reduced", "enumeration-seq", "equiv", "error-handler", "error-mode", "eval", "even?", "every-pred",
  "every?", "ex-cause", "ex-data", "ex-info", "ex-message", "extend", "extend-protocol", "extend-type", "extenders", "extends?", "false?", "ffirst",
  "file-seq", "filter", "filterv", "finally", "find", "find-keyword", "find-ns", "find-protocol-impl", "find-protocol-method", "find-var", "first", "fjtask",
  "flatten", "float", "float-array", "float?", "floats", "flush", "fn", "fn?", "fnext", "fnil", "fold", "foldcat",
  "folder", "for", "force", "format", "frequencies", "future", "future-call", "future-cancel", "future-cancelled?", "future-done?", "future?", "gen-class",
  "gen-interface", "gensym", "get", "get-in", "get-method", "get-proxy-class", "get-thread-bindings", "get-validator", "global-hierarchy", "group-by", "halt-when", "hash",
  "hash-combine", "hash-map", "hash-ordered-coll", "hash-set", "hash-unordered-coll", "ident?", "identical?", "identity", "if", "if-let", "if-not", "if-some",
  "ifn?", "import", "in-ns", "inc", "inc'", "indexed?", "infinite?", "init-proxy", "inst-ms", "inst?", "instance?", "int",
  "int-array", "int?", "integer?", "interleave", "intern", "interpose", "into", "into-array", "ints", "io!", "is", "isa?",
  "iterate", "iteration", "iterator-reduce!", "iterator-seq", "java.util.Date", "join", "juxt", "keep", "keep-indexed", "key", "keys", "keyword",
  "keyword?", "last", "lazy-cat", "lazy-seq", "let", "letfn", "line-seq", "list", "list*", "list?", "load", "load-file",
  "load-reader", "load-string", "loaded-libs", "locking", "long", "long-array", "longs", "loop", "lower-case", "macroexpand", "macroexpand-1", "make-array",
  "make-hierarchy", "map", "map-entry?", "map-indexed", "map?", "mapcat", "mapv", "max", "max-key", "memfn", "memoize", "merge",
  "merge-with", "meta", "method-sig", "methods", "min", "min-key", "mix-collection-hash", "mk-am", "mk-bound-fn", "mod", "monitor-enter", "monitor-exit",
  "monoid", "munge", "name", "namespace", "namespace-munge", "nat-int?", "neg-int?", "neg?", "new", "newline", "next", "nfirst",
  "nil?", "nnext", "not", "not-any?", "not-empty", "not-every?", "not=", "ns", "ns-aliases", "ns-imports", "ns-interns", "ns-map",
  "ns-name", "ns-publics", "ns-refers", "ns-resolve", "ns-unalias", "ns-unmap", "nth", "nthnext", "nthrest", "num", "number?", "numerator",
  "object-array", "odd?", "or", "parents", "parse-boolean", "parse-double", "parse-long", "parse-uuid", "partial", "partition", "partition-all", "partition-by",
  "partitionv", "partitionv-all", "pcalls", "peek", "persistent!", "pmap", "pool", "pop", "pop!", "pop-thread-bindings", "pos-int?", "pos?",
  "pr", "pr-on", "pr-str", "prefer-method", "prefers", "primitives-classnames", "print", "print-ctor", "print-simple", "print-str", "printf", "println",
  "println-str", "prn", "prn-str", "process-annotation", "promise", "promise?", "proxy", "proxy-call-with-super", "proxy-mappings", "proxy-name", "proxy-super", "push-thread-bindings",
  "pvalues", "qualified-ident?", "qualified-keyword?", "qualified-symbol?", "quot", "quote", "rand", "rand-int", "rand-nth", "random-sample", "random-uuid", "range",
  "ratio?", "rational?", "rationalize", "re-find", "re-groups", "re-matcher", "re-matches", "re-pattern", "re-seq", "read", "read+string", "read-line",
  "read-string", "reader-conditional", "reader-conditional?", "realized?", "record?", "recur", "reduce", "reduce-kv", "reduced", "reduced?", "reducer", "reductions",
  "ref", "ref-history-count", "ref-max-history", "ref-min-history", "ref-set", "ref?", "refer", "refer-clojure", "regexp?", "reify", "release-pending-sends", "rem",
  "remove", "remove-all-methods", "remove-method", "remove-ns", "remove-tap", "remove-watch", "repeat", "repeatedly", "replace", "replicate", "req!", "require",
  "requiring-resolve", "reset!", "reset-meta!", "reset-vals!", "resolve", "rest", "restart-agent", "resultset-seq", "reverse", "reversible?", "rseq", "rsubseq",
  "run!", "satisfies?", "second", "select-keys", "send", "send-off", "send-via", "seq", "seq-to-map-for-destructuring", "seq?", "seqable?", "seque",
  "sequence", "sequential?", "set", "set!", "set-agent-send-executor!", "set-agent-send-off-executor!", "set-error-handler!", "set-error-mode!", "set-validator!", "set?", "shift-left", "shift-right",
  "short", "short-array", "short?", "shorts", "shuffle", "shutdown-agents", "simple-ident?", "simple-keyword?", "simple-symbol?", "slurp", "some", "some->",
  "some->>", "some-fn", "some-vals", "some?", "sort", "sort-by", "sorted-map", "sorted-map-by", "sorted-set", "sorted-set-by", "sorted?", "special-symbol?",
  "spit", "split", "split-at", "split-with", "splitv-at", "spread", "str", "stream-into!", "stream-reduce!", "stream-seq!", "stream-transduce!", "string?",
  "struct", "struct-map", "subs", "subseq", "subvec", "supers", "swap!", "swap-vals!", "symbol", "symbol?", "sync", "syntax-quote",
  "tagged-literal", "tagged-literal?", "take", "take-last", "take-nth", "take-while", "tap->", "tap>", "test", "testing", "the-ns", "thread-bound?",
  "throw", "time", "to-array", "to-array-2d", "trampoline", "transduce", "transient", "tree-seq", "trim", "trim-newline", "triml", "trimr",
  "true?", "try", "type", "unchecked-add", "unchecked-add-int", "unchecked-byte", "unchecked-char", "unchecked-dec", "unchecked-dec-int", "unchecked-divide", "unchecked-divide-int", "unchecked-double",
  "unchecked-float", "unchecked-inc", "unchecked-inc-int", "unchecked-int", "unchecked-long", "unchecked-multiply", "unchecked-multiply-int", "unchecked-negate", "unchecked-negate-int", "unchecked-remainder", "unchecked-remainder-int", "unchecked-short",
  "unchecked-subtract", "unchecked-subtract-int", "underive", "unquote", "unquote-splicing", "unreduced", "unsigned-bit-shift-right", "update", "update-in", "update-keys", "update-proxy", "update-vals",
  "upper-case", "uri?", "use", "uuid?", "val", "vals", "var", "var-get", "var-set", "var?", "vary-meta", "vec",
  "vector", "vector-of", "vector?", "volatile!", "volatile?", "vreset!", "vswap!", "when", "when-first", "when-let", "when-not", "when-some",
  "while", "with-bindings", "with-bindings*", "with-in-str", "with-loading-context", "with-local-vars", "with-meta", "with-open", "with-out-str", "with-precision", "with-redefs", "with-redefs-fn",
  "xml-seq", "zero?", "zipmap",
]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();

const HOF_BUILTINS = (function(){ const r: Record<string, boolean> = Object.create(null); const arr = ["apply", "map", "reduce", "filter", "comp", "partial"]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();
const STM_BUILTINS = (function(){ const r: Record<string, boolean> = Object.create(null); const arr = ["swap!", "reset!", "deref", "alter", "commute", "dosync", "ref", "atom", "agent", "send", "send-off"]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();
const COMPLEXITY_BUILTINS = (function(){ const r: Record<string, boolean> = Object.create(null); const arr = ["if", "if-not", "if-let", "if-some", "when", "when-not", "when-let", "when-some", "cond", "condp", "case", "for", "while", "loop", "cond->", "cond->>", "some->", "some->>"]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();
const IMPURE_BUILTINS = (function(){ const r: Record<string, boolean> = Object.create(null); const arr = ["println", "print", "def", "alter-var-root", "with-redefs", "set!", "swap!", "reset!", "alter"]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();

// C9: forms whose DIRECT list_lit children are METHOD DEFINITIONS, not calls —
// `(px [_] 3)` inside reify/extend-type/extend-protocol/proxy/defrecord/deftype
// (defprotocol signatures are listed too: they are already symbolized by the
// defprotocol branch, but they must still be excluded from call handling).
// Object.create(null): a PLAIN `{}` record answers `["toString"]` (and
// valueOf/constructor/hasOwnProperty) from Object.prototype — the truthy
// lookup made every Java-class `(toString [this] …)` override misfire the
// impl rule and consume its body's calls as "method definitions" (found by
// the F5 clj-kondo lane: 12 MISSING edges across rewrite-clj node files).
const METHOD_IMPL_PARENT_FORMS = (function(){ const r: Record<string, boolean> = Object.create(null); const arr = ["defrecord", "deftype", "reify", "extend-type", "extend-protocol", "proxy", "defprotocol", "definterface"]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();

/**
 * CLJ-D30 — does this head DEFINE a name, whatever it is called?
 *
 * A character walk, deliberately: the zero-regex census (`reviews/regex-policy.md`,
 * counted at HEAD) reads this file, so a `def-` test here has to be spelled in
 * characters. A head is def-like when it is `def`, or `def` followed by `-`/`_`
 * plus at least one more character — which admits `defcurried`, `def-aset`,
 * `defsetting`, `defclause*` and every future spelling a project invents.
 *
 * The two exclusions are not arbitrary: `default…` and `define…` are ordinary
 * verbs in Clojure code (`(default-db ...)`, `(define-spec ...)`), and
 * promoting a CALL to a DEFINITION would mint a symbol for something that
 * defines nothing. Everything else in def position is treated as a definition
 * by the CLJ-D30 branch, which is the general rule rather than a hand list.
 */
function isDefLikeHead(head: string): boolean {
  if (head.length < 3) return false
  if (head.charCodeAt(0) !== 100 /* d */ || head.charCodeAt(1) !== 101 /* e */ || head.charCodeAt(2) !== 102 /* f */) return false
  if (head.length === 3) return true
  const c3 = head.charCodeAt(3)
  if (c3 !== 45 /* - */ && c3 !== 95 /* _ */) {
    if (head.startsWith("default") || head.startsWith("define")) return false
    return true
  }
  return true
}

/**
 * CLJ-D32 — the member name of a STATIC interop head, or null.
 *
 * Clojure writes a static member access THREE ways, and only one of them is
 * unambiguous with a plain character test:
 *
 *   `String/.toUpperCase`  a dot immediately AFTER the slash
 *   `java.io.File./getName` a dot immediately BEFORE the slash
 *   `String/toUpperCase`   no dot at all — AMBIGUOUS
 *
 * The third is left as a call on purpose. `String/toUpperCase` and
 * `clojure.string/trim` have the same shape, and a rule that promoted both would
 * turn every namespace-qualified call into a member access — a far larger
 * fabrication than the one it fixed. So the dot is the discriminator, and BOTH
 * dot positions are recognised: the fixture for CLJ-D32 caught the second form
 * emitting `calls -> java.io.File./getName`, a dangling target, because the
 * first version of this test only looked right of the slash.
 *
 * For the `Class./member` spelling the class carries Clojure's trailing dot
 * (`java.io.File.`), which is dropped so the edge names `java.io.File` — the
 * same target the `Class.` constructor spelling produces.
 *
 * Character indexing, no regex: the zero-regex census reads this file.
 */
function staticInteropMember(head: string): string | null {
  const slash = head.lastIndexOf("/")
  if (slash <= 0) return null
  const member = head.slice(slash + 1)
  if (member.length === 0) return null
  const afterDot = head.charCodeAt(slash + 1) === 46 /* . */
  const beforeDot = head.charCodeAt(slash - 1) === 46 /* . */
  if (afterDot) {
    // `Class/.member` — the class has no trailing dot of its own.
    const m = head.slice(slash + 2)
    return m.length > 0 && head.slice(0, slash).length > 0 ? m : null
  }
  if (beforeDot) {
    // `Class./member` — strip the class's trailing dot, then require a member.
    const cls = head.slice(0, slash - 1)
    return member.length > 0 && cls.length > 0 ? member : null
  }
  return null
}

/** The CLASS of a static interop head, or null — `Class` or `java.io.File`. */
function staticInteropClass(head: string): string | null {
  const slash = head.lastIndexOf("/")
  if (slash <= 0) return null
  if (staticInteropMember(head) === null) return null
  const cls = head.charCodeAt(slash + 1) === 46 ? head.slice(0, slash) : head.slice(0, slash - 1)
  return cls.length > 0 ? cls : null
}

// CLJ-D20: the anonymous-argument shorthands — `%`, `%1`..`%N`, `%&` — are
// PARAMETER references, never callees. This was the lane's last regex,
// `/^%(\d+|&)?$/`, registered in reviews/regex-policy.md with the note
// "mechanically convertible to a structural symbol-name check". It is a char
// scan now, and the conversion is PROVED, not asserted:
// `script/m14/tmp/clj-regex-equiv.ts` runs both forms over every `sym_lit`
// name in three corpora (633 files, 187,678 symbol nodes, 13,363 distinct
// names) plus a 42-case adversarial battery (`%%`, `%&x`, `%0`, `%00`, `%١`,
// `% 1`, `%1a`, a 20-digit `%…`, …) and reports **0 mismatches**.
//
// The walk is the regex's own grammar, step for step: one `%`, then either
// nothing, a single `&`, or a run of ASCII digits (48..57) and nothing else.
export const isAnonArgShorthand = (s: string): boolean => {
  if (s.length === 0) return false
  if (s.charCodeAt(0) !== 37) return false          // '%'
  if (s.length === 1) return true                   // "%"
  const c1 = s.charCodeAt(1)
  if (c1 === 38) return s.length === 2              // "%&" exactly, never "%&x"
  if (c1 < 48 || c1 > 57) return false              // then digits only
  for (let i = 2; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false              // ASCII digits ONLY (not ٣)
  }
  return true
}

/**
 * THE SPECIAL FORMS — a closed set, and a special form is NOT a call.
 *
 * CLJ-D41/CLJ-D44. Exported so the truth oracle and the analyzer cannot disagree
 * about it: two lists is two answers, and the disagreement between them was 5 of
 * the 105 residual edges in this wave.
 *
 * Macros are deliberately absent. `loop`, `letfn`, `case`, `..` and `tap>` are
 * macros, core.clj defines every one of them, and CLJ-D43 says a call to a macro
 * the file defines IS a call. Suppressing those was my error, not the analyzer's.
 * `fn*` and `let` are here and were missing from the core list's reach: `fn*` is a
 * compiler intrinsic with no public var, and `let` is shadowed in core.clj.
 */
export const CLOJURE_SPECIAL_FORMS: ReadonlySet<string> = new Set([
  "def", "do", "fn", "fn*", "if", "if*", "let", "let*", "quote", "quote*", "var", "var*",
  "recur", "recur*", "throw", "throw*", "try", "try*", "catch", "catch*", "finally",
  "new", "new*", "set!", "monitor-enter", "monitor-exit", "case*", "letfn*", "loop*",
  ".", "&",
])

export class RealClojureAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(rootNode: Node, content: string, filePath: string): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const frameworks: Record<string, boolean> = {}
    const patterns: Record<string, boolean> = {}

    let currentNamespace = "user"
    // CLJ-D34: has this file DECLARED its namespace with an `ns`/`in-ns` form?
    // A file that declares none still HAS a namespace — `user` — and saying so
    // is what makes its exports resolvable.
    let sawNamespaceForm = false
    // F3 (adversarial review): Object.create(null) — the SAME prototype-
    // pollution class as F5-2, missed on this record: a plain `{}` alias
    // table answered `["toString"]` with the inherited function, so
    // `(toString/f …)` under `[x :as toString]` emitted the garbage target
    // `"function toString() { [native code] }/f"` (and the oracle's Map
    // emitted the honest `toString/f` — a latent MISSING/unexplained pair).
    let namespaceAliases: Record<string, string> = Object.create(null)
    // W24-mr2: `:refer`-ed names (ns `:refer [a b]` / `:only` / `:rename` /
    // top-level require) — a CONFIRMED call target, resolved to its source lib
    // (last libspec wins).
    //
    // CLJ-D24, and the half that is easy to get wrong: a file with TWO `(ns …)`
    // forms (45 sites — clj-kondo's `corpus/` dialect files, test files that
    // switch namespace mid-file) has two namespaces, so a single mutable table
    // is wrong in BOTH directions. Resetting it at the second `ns` fixes the
    // suppression gate and BREAKS the post-walk resolution pass, which runs at
    // the end and would then resolve a first-namespace call against the
    // second namespace's table. The table is therefore POSITIONAL: a segment
    // per namespace form, and every lookup takes the call site's offset.
    // `referAt` is a linear scan over one or two segments per file.
    const referSegments: Array<{ start: number; end: number; names: Record<string, string> }> = []
    const openReferSegment = (start: number): Record<string, string> => {
      let seg = referSegments[referSegments.length - 1]
      // A CLOSED segment is never reused. That test is load-bearing and its
      // absence is a real defect this fixture caught: almost every Clojure file
      // opens with `(ns …)` at byte 0, so closing the bootstrap segment at 0
      // and asking for one "at 0" returned the CLOSED segment — a zero-width
      // span that matches no position — and every `:refer` in the file stopped
      // resolving. The `refer-forms` fixture went red on it.
      if (!seg || seg.start !== start || seg.end !== Infinity) {
        seg = { start, end: Infinity, names: Object.create(null) }
        referSegments.push(seg)
      }
      return seg.names
    }
    // A libspec before any `ns` form (a bare `(require '[x :refer [y]])` at the
    // top of a file) opens a segment at 0.
    let referTable: Record<string, string> = openReferSegment(0)
    const referAt = (name: string, pos: number): string => {
      for (const seg of referSegments) if (pos >= seg.start && pos < seg.end) return seg.names[name] || ""
      return ""
    }
    let activeFunction: ASTEngine.UniversalSymbol | null = null

    let totalCyclomaticComplexity = 0

    if (rootNode.hasError) {
      errors.push({
        message: "Syntax Error bypassed",
        range: this.nodeToRange(rootNode),
        severity: "warning",
      })
    }

    // ── AST helpers (never source-text scanning) ──────────────────────────
    // @yogthos/tree-sitter-clojure (0.0.14): every parenthesized form is a
    // `list_lit` with `value:` children. A symbol is a `sym_lit` carrying
    // structured fields: `name:` (sym_name — full dotted text for plain
    // symbols like `com.example.foo`) and optionally `namespace:` (sym_ns) for
    // qualified symbols like `str/join`. Meta data (`^String`, `^:private`)
    // is a `meta_lit` child on the symbol or form. There are NO interop or
    // qualified_symbol nodes — dotted names and constructor idioms (`Date.`,
    // `->ClojureService`) are single sym_lit nodes.
    const symName = (node: Node | null): string => {
      if (!node) return ""
      if (node.type === "sym_lit") {
        const name = node.childForFieldName("name")
        const ns = node.childForFieldName("namespace")
        if (name && ns) return `${ns.text}/${name.text}`
        if (name) return name.text
        return node.text
      }
      return node.text
    }

    // W24-mr3 (review CLJ-MR3): `^{:private true}` / `^:private` IS the
    // visibility contract (the canonical alternative to the `defn-` suffix) —
    // only the suffix was read before, so meta-private vars/fns exported as
    // public. Meta stays DATA (CLJ-D5) — this only READS the flag.
    const metaHasPrivate = (nd: Node | null): boolean => {
      if (!nd) return false
      const scan = (n: Node): boolean => {
        if (n.type === "kwd_lit" && n.text === ":private") return true
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && scan(c)) return true
        }
        return false
      }
      for (let i = 0; i < nd.namedChildCount; i++) {
        const c = nd.namedChild(i)
        if (c && c.type === "meta_lit" && scan(c)) return true
      }
      return false
    }

    // Read the form-name of a list_lit: the first EXECUTABLE value child.
    // The head of a list is decided after discard/trivia, not before it:
    // `(#_ignored quote (trivia-ghost))` is a `quote` form, so its body is data
    // and must never be read as a call (#881). The same holds for a leading
    // `(comment ...)`-style trivia node and a `meta_lit`, which occupy no
    // execution position — `executionHead` is the single definition of that
    // rule and is used here rather than a second copy of it.
    // For `(:require ...)` / `(:import ...)` clauses the head is a kwd_lit
    // (e.g. ":require"); we return its keyword name so clause dispatch works.
    // Read the form-name of a list_lit: the first EXECUTABLE value child.
    // SYM-HEADS ONLY — declarations are symbol-headed; a kwd-headed list
    // (`(:ns (meta var))` in junit.clj) is DATA or an ns clause and must
    // NEVER dispatch a declaration branch (it fired the ns branch, reset the
    // alias table mid-file, and corrupted the namespace for every following
    // form — found by the F5 clojure lane). Kwd names are read by
    // clauseNameOf for the ns-clause sites that legitimately need them.
    // For `(:require ...)` / `(:import ...)` clauses the head is a kwd_lit.
    const formNameOf = (listNode: Node): string => {
      const first = executionHead(listNode)
      if (!first) return ""
      // Only sym_lit heads are forms. A vec_lit head is a multi-arity
      // clause `([a b] body)` — never a call, never a form name.
      if (first.type !== "sym_lit") return ""
      return symName(first)
    }

    // Clause dispatch name: the keyword name of a kwd-headed list
    // (`(:require …)` -> "require"). Used ONLY by the ns branch and the
    // libspec-child guard — never by declaration dispatch.
    const clauseNameOf = (listNode: Node): string => {
      const first = executionHead(listNode)
      if (first && first.type === "kwd_lit") return first.childForFieldName("name")?.text || ""
      return ""
    }

    // Params (C10/C11): the parameter vector is THE FIRST direct vec_lit
    // child of the form — never "every vec_lit child" (a body vector like the
    // `[y z]` in `(defn w [x] [y z])` leaked into parameters: `(defn g
    // [{:keys [a b]} c] [a b c])` reported ["c","a","b"]). Only when NO direct
    // vec exists do list children get read as multi-arity clauses — `(defn h
    // ([] 1) ([x] x))` — and only clauses that OPEN with a vec_lit (a body
    // list never does). Bindings resolve through destructuring the way the
    // reader binds them: `&` never becomes a parameter name, vector nesting
    // recurses, and map destructuring contributes :keys/:strs/:syms names,
    // :as aliases, and explicit {local :key} symbols — `:or` default values
    // are expressions, not bindings, and are skipped wholesale.
    const extractParams = (fnNode: Node | null): ASTEngine.Parameter[] => {
      const params: ASTEngine.Parameter[] = []
      if (!fnNode) return params
      const seen = new Set<string>()
      const collectBinding = (binding: Node) => {
        if (binding.type === "sym_lit") {
          const name = symName(binding)
          if (!name || name === "&" || seen.has(name)) return
          seen.add(name)
          params.push({ name, type: "Any" })
          return
        }
        if (binding.type === "vec_lit") {
          for (let i = 0; i < binding.namedChildCount; i++) {
            const c = binding.namedChild(i)
            if (c) collectBinding(c)
          }
          return
        }
        if (binding.type === "map_lit") {
          for (let i = 0; i < binding.namedChildCount; i++) {
            const k = binding.namedChild(i)
            if (!k) continue
            if (k.type === "kwd_lit") {
              const kw = k.childForFieldName("name")?.text || ""
              if (kw === "keys" || kw === "strs" || kw === "syms") {
                const v = binding.namedChild(i + 1)
                if (v && (v.type === "vec_lit" || v.type === "sym_lit")) { collectBinding(v); i++ }
              } else if (kw === "as") {
                const v = binding.namedChild(i + 1)
                if (v) { collectBinding(v); i++ }
              } else if (kw === "or") {
                i++ // default-value map: values are expressions, never bindings
              }
            } else if (k.type === "sym_lit") {
              collectBinding(k) // {local :key} — the symbol is the binding
            }
          }
          return
        }
        // Any other node shape carries no bindings.
      }
      let directVec: Node | null = null
      const arityVecs: Node[] = []
      for (let i = 0; i < fnNode.namedChildCount; i++) {
        const c = fnNode.namedChild(i)
        if (!c) continue
        if (c.type === "vec_lit") { if (!directVec) directVec = c }
        else if (c.type === "list_lit" && c.namedChild(0)?.type === "vec_lit") arityVecs.push(c.namedChild(0)!)
      }
      if (directVec) collectBinding(directVec)
      else for (const v of arityVecs) collectBinding(v)
      return params
    }

    // ── Framework/pattern detection driven by AST require/import forms ─────
    const REQUIRED_LIB_PATTERNS: Array<[string, string]> = [
      ["ring.adapter", "Ring"], ["ring.util", "Ring"], ["ring.middleware", "Ring"],
      ["compojure.core", "Compojure"], ["compojure.route", "Compojure"],
      ["reagent.core", "Reagent"], ["re-frame.core", "Re-frame"],
      ["datomic.api", "Datomic"], ["clojure.test", "Clojure.test"],
      ["clojure.core.async", "Core.async"],
    ]

    // ── Symbol/relationship helpers ───────────────────────────────────────
    // Relationship emission (dedupe by source|type|target|callArity|line
    // identity — the ER-D2/EX-L2 row-identity contract). Two call SITES of one
    // callee on different lines are TWO edges (the store row id is
    // `source:type:target:line:m40`, so a NULL line collapsed every site of a
    // callee into one row — the measured pre-fix state: 0/8381 clojure edges
    // carried a line). Sites sharing a line still collapse — one row per site
    // line. The LINE is always the NAME-BEARING node's 1-based line (the
    // callee, the libspec, the protocol/type name, the symbol's own
    // declaration) — never 0, and absent only where no name-bearing node
    // exists.
    const seenRelKeys = new Set<string>()
    // CLJ-D24: edge-index -> the call site's byte offset, for the positional
    // refer lookup. See pushRel. A Map keyed by the array index, because the
    // post-walk pass reads it before it splices duplicates (indices are stable
    // for the whole rewrite loop).
    const relOrigins = new Map<number, number>()
    const pushRel = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      metadata: Record<string, any> = {},
      line?: number,
      callArity?: number,
      origin?: number,
    ) => {
      const key = `${source}|${type}|${target}|${callArity ?? ""}|${line ?? ""}`
      if (seenRelKeys.has(key)) return
      seenRelKeys.add(key)
      // CLJ-D24: the refer resolution pass runs after the walk, so it cannot
      // know which namespace form the call sat in. The byte offset rides along
      // in a WeakMap rather than on the edge, so the published relationship
      // keeps exactly the fields the store contract declares.
      if (typeof origin === "number") relOrigins.set(relationships.length, origin)
      void 0
      // M59 (#825): the line joins the edge at construction (M60.P1's
      // emit surface reads `line_number:` from the analyzer source) — the
      // name-bearing node's 1-based line, never 0, absent when underivable.
      const rel: ASTEngine.UniversalRelationship = {
        source, target, type, confidence,
        metadata: callArity === undefined ? metadata : { ...metadata, callArity },
        ...(typeof line === "number" && line > 0 ? { line_number: line } : {}),
      }
      relationships.push(rel)
    }

    // C5: `alias/Name` resolves through the ns aliases (ns clauses AND
    // top-level require forms register into the same map) — `p/Proto` must
    // outlive the raw alias exactly like call targets do, or implements edges
    // dangle on `p` while calls resolve.
    const resolveQualified = (name: string): string => {
      const slash = name.indexOf("/")
      if (slash <= 0) return name
      const alias = name.slice(0, slash)
      const rest = name.slice(slash + 1)
      const resolved = namespaceAliases[alias]
      return resolved ? `${resolved}/${rest}` : name
    }

    // ── CLJ-D28: the ONE qualified-callee resolver ──────────────────────────
    // The grammar already splits a qualified symbol into `namespace` and
    // `name` FIELDS, and the analyzer was splitting the TEXT a second time —
    // twice, differently. `"h2x//".split("/")` yields `["h2x","",""]`, so the
    // generic-call branch published `metabase.util.honey-sql-2/`, while
    // `resolveQualified` (slice after the first slash) published
    // `metabase.util.honey-sql-2//`. Metabase calls `h2x//` — a function whose
    // own NAME is `/` — at 5 sites in one file and 2 in another, and the two
    // answers disagreed with each other inside ONE analyzer. A 60-file draw
    // never met the shape; the full-extent run over 4,252 metabase files found
    // it (2 unexplained of 239,192 truth edges). The AST field is the answer
    // that cannot drift: the name IS `/`, so the qualified name is `h2x` + `/`
    // + `/`, and every path now says so for the same reason.
    const resolveCallee = (head: Node | null, formName: string): { alias: string; name: string; target: string } => {
      if (head && head.type === "sym_lit") {
        const nsNode = head.childForFieldName("namespace")
        const nameNode = head.childForFieldName("name")
        if (nsNode && nameNode) {
          const alias = nsNode.text
          const nm = nameNode.text
          const resolved = namespaceAliases[alias]
          return { alias, name: nm, target: resolved ? `${resolved}/${nm}` : `${alias}/${nm}` }
        }
      }
      return { alias: "", name: formName, target: formName }
    }

    // Call-site arity (C3): the count of argument FORMS after the executable
    // head — comments/discards occupy no argument position. Together with the
    // line it joins the edge identity, so `(pick)` and `(pick x)` on one line
    // are two distinct edges, exactly like erlang's `pick/0` vs `pick/1`.
    const callArityOf = (list: Node): number => {
      const head = executionHead(list)
      if (!head) return 0
      let n = 0
      for (let i = 0; i < list.namedChildCount; i++) {
        const c = list.namedChild(i)
        if (!c || c.type === "comment" || c.type === "dis_expr") continue
        if (c.startIndex > head.startIndex) n++
      }
      return n
    }

    // ── Doc channel (C4, EX-L9/M60 parity) ────────────────────────────────
    // comments mirrors the text (the payload survives even though comments
    // has no store binding by design); docstring is the channel the store
    // seam reads. Two sources: the leading `;;` comment block immediately
    // above the form, and the form's own docstring string.
    const stripCommentText = (text: string): string => {
      let i = 0
      while (i < text.length && text[i] === ";") i++
      return text.slice(i).trim()
    }
    const stripDocstringText = (text: string): string => {
      const t = text.trim()
      if (t.length >= 2 && t.startsWith("\"") && t.endsWith("\"")) return t.slice(1, -1)
      return t
    }
    const leadingCommentTexts = (n: Node): string[] => {
      const out: string[] = []
      // F11 (adversarial): only a CONTIGUOUS block of `;;` comments directly
      // above the form is its doc. A trailing comment on the previous form's
      // line, a blank-line-separated header, and single-`;` notes used to be
      // attached — moving docstring text onto the wrong symbols.
      let prev = n.previousNamedSibling
      let anchorRow = n.startPosition.row
      while (prev && prev.type === "comment") {
        // NOTE: a comment node's text INCLUDES its trailing newline, so its
        // endPosition.row is one past the visible line — every row comparison
        // below works on VISIBLE rows.
        if (prev.startPosition.row !== anchorRow - 1) break     // blank line above
        if (!prev.text.startsWith(";;")) break                 // single-`;` note
        const before = prev.previousNamedSibling
        if (before) {
          const beforeEndRow = before.type === "comment" ? before.endPosition.row - 1 : before.endPosition.row
          if (before.startPosition.row === prev.startPosition.row) break // shares the previous form's line
          if (beforeEndRow === prev.startPosition.row) break             // previous form ENDS on this comment's line
        }
        const t = stripCommentText(prev.text)
        if (t.length > 0) out.unshift(t)
        anchorRow = prev.startPosition.row
        prev = prev.previousNamedSibling
      }
      return out
    }
    const docstringOf = (formNode: Node, style: "fn" | "def" | "always"): string => {
      if (style === "always") {
        const c2 = formNode.namedChild(2)
        return c2 && c2.type === "str_lit" ? stripDocstringText(c2.text) : ""
      }
      if (style === "def") {
        // `(def x "literal")` — a lone string is the VALUE; a docstring needs
        // an initializer after it: `(def x "doc" init)`.
        const c2 = formNode.namedChild(2)
        const c3 = formNode.namedChild(3)
        return c2 && c2.type === "str_lit" && c3 ? stripDocstringText(c2.text) : ""
      }
      // fn family: the string must sit directly before the params vec (single
      // arity) or before an arity clause (multi-arity) — a string anywhere
      // else is a body expression.
      for (let i = 2; i < formNode.namedChildCount; i++) {
        const c = formNode.namedChild(i)
        if (!c) continue
        if (c.type === "str_lit") {
          const next = formNode.namedChild(i + 1)
          const beforeParams = next !== null && (next.type === "vec_lit" || (next.type === "list_lit" && next.namedChild(0)?.type === "vec_lit"))
          return beforeParams ? stripDocstringText(c.text) : ""
        }
        if (c.type === "vec_lit" || c.type === "list_lit") return ""
      }
      return ""
    }
    const attachDocs = (sym: ASTEngine.UniversalSymbol, formNode: Node, style: "fn" | "def" | "always") => {
      const doc = docstringOf(formNode, style)
      const comments = leadingCommentTexts(formNode)
      if (doc) {
        sym.comments = comments.length > 0 ? [...comments, doc] : [doc]
        ;(sym as any).docstring = doc
      } else if (comments.length > 0) {
        sym.comments = comments
        ;(sym as any).docstring = comments.join(" ")
      }
    }

    // C7: one lib-spec handler for BOTH sites — ns clauses (`(:require …)`)
    // and the top-level directive forms (`(require '[x :as y])` after the ns)
    // that previously vanished (aliases unregistered, imports unrecorded, and
    // every `s/join` call left dangling). Top-level forms quote their specs
    // (`'[x :as y]`, `'(pkg Cls)`), so a quoting_lit is unwrapped first.
    const handleLibNode = (rawNode: Node) => {
      const spec = rawNode.type === "quoting_lit" ? (rawNode.namedChild(0) ?? rawNode) : rawNode
      if (spec.type === "read_cond_lit" || spec.type === "splicing_read_cond_lit") {
        // F12 (adversarial): `(:require #?(:clj [x :as y] :cljs [x :as z]))`
        // — the union of both platforms' libspecs is the analysis contract
        // (the read-cond transparency of CLJ-D2). Previously the payload was
        // never unwrapped, so cljc requires left every aliased call dangling.
        for (let i = 0; i < spec.namedChildCount; i++) {
          const c = spec.namedChild(i)
          if (!c) continue
          if (c.type === "vec_lit" || c.type === "list_lit" || c.type === "sym_lit" || c.type === "quoting_lit" || c.type === "read_cond_lit" || c.type === "splicing_read_cond_lit") handleLibNode(c)
        }
        return
      }
      if (spec.type === "vec_lit") {
        // [lib :as alias] | [lib :refer [a b]] | [lib] | (:import [pkg Cls1 Cls2])
        const libNameNode = spec.namedChild(0)
        const libName = symName(libNameNode)
        if (!libName) return
        let alias = ""
        let referNames: string[] = []
        const subNames: string[] = []
        let sawKwd = false
        // F12 (adversarial): `:as-alias` registers the alias for QUALIFIED
        // NAME RESOLUTION but the lib is not loaded — no references edge and
        // no import row (the alias-only form appears in real cljc: `[x
        // :as-alias y]`).
        let hasAsAlias = false
        for (let k = 1; k < spec.namedChildCount; k++) {
          const part = spec.namedChild(k)
          if (!part) continue
          if (part.type === "kwd_lit") {
            sawKwd = true
            const kw = part.childForFieldName("name")?.text || ""
            if ((kw === "as" || kw === "as-alias") && k + 1 < spec.namedChildCount) {
              alias = symName(spec.namedChild(k + 1))
              if (kw === "as-alias") hasAsAlias = true
            } else if ((kw === "refer" || kw === "only") && k + 1 < spec.namedChildCount) {
              // CLJ-D21: `:only` is `:refer`'s legacy twin and means exactly the
              // same thing, so `(:use [clojure.java.browse :only (browse-url)])`
              // — 16 sites in the clojure corpus alone — was registering NO
              // refer name, and every `(browse-url …)` call dangled. `:all`
              // (`:refer :all`) has no name list to read; it is left to the
              // `["*"]` items path, which is the honest "whole lib" reading.
              // CLJ-D21b: the name list is a LIST as often as a vector —
              // `(browse-url)`, not `[browse-url]` — so both shapes are read.
              const refVec = spec.namedChild(k + 1)
              if (refVec && (refVec.type === "vec_lit" || refVec.type === "list_lit")) {
                for (let r = 0; r < refVec.namedChildCount; r++) {
                  const rn = refVec.namedChild(r)
                  if (rn && rn.type === "sym_lit") referNames.push(symName(rn))
                }
              }
            } else if (kw === "rename" && k + 1 < spec.namedChildCount) {
              // CLJ-D25: `:rename {old new}` is a REFERRED name under a new
              // spelling — the declared F17 limitation, now measured (7 sites
              // in clj-kondo) and closed. `{old new}` is a MAP_LIT whose
              // entries are alternating kwd/value pairs: the VALUE is the name
              // the file may call, the key is unbound in this namespace, so
              // only the value enters the refer table.
              const renameMap = spec.namedChild(k + 1)
              if (renameMap && renameMap.type === "map_lit") {
                // A map literal's named children alternate key, value, so
                // `{old new}` is (child 0, child 1) and the NEW name — the one
                // this namespace may call — is the ODD child. Reading both
                // would make the unbound `old` name resolve too, which is
                // exactly the shadowing `:rename` exists to prevent.
                for (let r = 1; r < renameMap.namedChildCount; r += 2) {
                  const v = renameMap.namedChild(r)
                  if (v && v.type === "sym_lit") referNames.push(symName(v))
                }
              }
            }
          } else if (part.type === "sym_lit") {
            // (:import [java.util Date UUID]) — symbols after the package are
            // imported class names, not part of the lib name.
            subNames.push(symName(part))
          } else if (part.type === "vec_lit") {
            // PREFIX-LIST spec: `[prefix [sub :as a] [sub2 :as b]]` — each
            // nested vector requires prefix.sub with its own alias (F5-cert:
            // clj-kondo's vendored rewrite-clj uses this form; real Clojure
            // resolves `a/fn` to prefix.sub/fn). A nested vector DIRECTLY
            // AFTER a keyword is a name list (`:refer [foo bar]`), not a
            // sub-libspec — skip those (M12 caught the misread as an FP).
            const prev = spec.namedChild(k - 1)
            if (prev && prev.type === "kwd_lit") continue
            const sub = symName(part.namedChild(0))
            if (!sub) continue
            const full = `${libName}.${sub}`
            let subAlias = ""
            for (let q = 1; q < part.namedChildCount; q++) {
              const pp = part.namedChild(q)
              if (pp && pp.type === "kwd_lit" && (pp.childForFieldName("name")?.text || "") === "as") {
                const av = part.namedChild(q + 1)
                if (av) subAlias = symName(av)
              }
            }
            if (subAlias) namespaceAliases[subAlias] = full
            if (full !== currentNamespace) pushRel(currentNamespace, full, ASTEngine.RelationshipType.References, 0.9, { clojureSpecific: true, isLibraryDep: true }, part.startPosition.row + 1)
          }
        }
        if (alias) namespaceAliases[alias] = libName
        // W24-mr2: `:refer [a b]` names resolve unqualified calls — the
        // ELXD17 sibling contract (last libspec wins, like the alias rule).
        if (referNames.length > 0 && libName) for (const rn of referNames) referTable[rn] = libName
        const items = referNames.length > 0 ? referNames : subNames.length > 0 && !sawKwd ? subNames : alias ? [alias] : ["*"]
        if (!hasAsAlias) {
          imports.push({ module: libName, items: [...items], type: "named", isExternal: true, line: (libNameNode ?? spec).startPosition.row + 1 })
          // ELXD8 mirror: a self-require/self-import is a lexical no-op — never
          // a self-loop references edge (F5-cert: corpus/invalid_arity/order.clj
          // and clj-kondo node.clj both carry self-qualified require sites).
          if (libName !== currentNamespace) pushRel(currentNamespace, libName, ASTEngine.RelationshipType.References, 0.9, { clojureSpecific: true, isLibraryDep: true }, (libNameNode ?? spec).startPosition.row + 1)
          for (const [needle, fw] of REQUIRED_LIB_PATTERNS) {
            if (libName.startsWith(needle)) frameworks[fw] = true
          }
        }
        if (subNames.length > 0 && !sawKwd) patterns["Java Interoperability"] = true
      } else if (spec.type === "list_lit") {
        // (:import (java.util Date UUID)) — package + class list. The
        // references edge mirrors the vec-import site (`[java.util Date]`)
        // so the two syntactic twins behave identically (#CLJ1 fixture
        // toplevel-forms); it targets the package, line = the package name.
        const pkgNode = spec.namedChild(0)
        const pkg = symName(pkgNode)
        if (!pkg) return
        if (pkg !== currentNamespace) pushRel(currentNamespace, pkg, ASTEngine.RelationshipType.References, 0.9, { clojureSpecific: true, isLibraryDep: true, isImport: true }, (pkgNode ?? spec).startPosition.row + 1)
        for (let k = 1; k < spec.namedChildCount; k++) {
          const cls = spec.namedChild(k)
          if (!cls) continue
          if (cls.type === "list_lit") {
            // F15 (adversarial): paren prefix-list `(adv.prefix (sub :as
            // sp))` — the list twin of the vec prefix form. Register the
            // nested alias and reference `adv.prefix.sub`; both sides
            // emitted raw `sp/one` + `references -> sp` garbage before.
            const subName = symName(cls.namedChild(0))
            if (!subName) continue
            const full = `${pkg}.${subName}`
            for (let q = 1; q < cls.namedChildCount; q++) {
              const pp = cls.namedChild(q)
              if (pp && pp.type === "kwd_lit" && (pp.childForFieldName("name")?.text || "") === "as") {
                const av = cls.namedChild(q + 1)
                const subAlias = av ? symName(av) : ""
                if (subAlias) namespaceAliases[subAlias] = full
              }
            }
            if (full !== currentNamespace) pushRel(currentNamespace, full, ASTEngine.RelationshipType.References, 0.9, { clojureSpecific: true, isLibraryDep: true }, cls.startPosition.row + 1)
          } else if (cls.type === "sym_lit") {
            imports.push({ module: pkg, items: [symName(cls)], type: "named", isExternal: true, line: cls.startPosition.row + 1 })
            patterns["Java Interoperability"] = true
          }
        }
      } else if (spec.type === "sym_lit") {
        const libName = symName(spec)
        if (libName) {
          imports.push({ module: libName, items: ["*"], type: "named", isExternal: true, line: spec.startPosition.row + 1 })
          if (libName !== currentNamespace) pushRel(currentNamespace, libName, ASTEngine.RelationshipType.References, 0.9, { clojureSpecific: true, isLibraryDep: true }, spec.startPosition.row + 1)
          for (const [needle, fw] of REQUIRED_LIB_PATTERNS) {
            if (libName.startsWith(needle)) frameworks[fw] = true
          }
        }
      }
    }

    // C9: the owner of a method implementation — the record/type name for
    // defrecord/deftype, the nearest preceding symbol for extend-protocol
    // (the TYPE before the impl group; the protocol is child 1), the named
    // type for extend-type, and the enclosing context for reify/proxy
    // (anonymous types have no name of their own).
    const methodImplOwner = (implNode: Node, parentForm: string): string => {
      const parent = implNode.parent
      if ((parentForm === "defrecord" || parentForm === "deftype" || parentForm === "extend-type") && parent) {
        return symName(parent.namedChild(1))
      }
      if (parentForm === "extend-protocol") {
        let prev = implNode.previousNamedSibling
        while (prev && prev.type !== "sym_lit") prev = prev.previousNamedSibling
        return prev ? symName(prev) : ""
      }
      return activeFunction ? activeFunction.name : currentNamespace
    }

    const executionHead = (list: Node): Node | null => {
      for (let i = 0; i < list.namedChildCount; i++) {
        const child = list.namedChild(i)
        if (child && child.type !== "comment" && child.type !== "dis_expr" && child.type !== "meta_lit") return child
      }
      return null
    }
    // The head's byte offset — the position the suppression gate needs, because
    // "is this bare head the file's own var" is a question about WHERE the
    // call sits, not only about its name. Falls back to the form's own start
    // for a list whose first executable child is absent (`()`), which keeps
    // the position defined rather than 0.
    const headStartIndex = (list: Node): number => {
      const h = executionHead(list)
      return h ? h.startIndex : list.startIndex
    }

    // W23-b (M49 W24): the shadow is REGIONAL and ORDER-AWARE. The old flat
    // flag (any definition anywhere, order-blind) flipped every `(comment …)`
    // body in the file to code-walking — fabricating calls from data blocks
    // the macro still owns. Ranges now: a def-family NAME binds the var at
    // the FORM'S END (order-aware, live from there on); a binding vector
    // scopes to its ENCLOSING form (params/let bindings are visible only
    // inside it — a multi-arity clause's param covers that clause alone).
    // CLJ-D18: a range is (name, span), not just a span. The `comment` check
    // that this table was born for asks "is the name `comment` shadowed HERE?",
    // and a bare span answered that only because `comment` was the sole
    // consumer. The core-suppression gate asks about a DIFFERENT name at each
    // site, so a span without a name over-answers: a `(defprotocol A (seq
    // [o]))` records the span [form-end, ∞) for the name `seq`, and a span-only
    // test then declared every LATER bare head in the file shadowed — which
    // turned `defprotocol`, `join`, `trim` and `hashCode` into call sites in
    // the oracle while the analyzer (name-aware) suppressed them. The first
    // post-change F5 run read 26 MISSING / 11 UNEXPLAINED for exactly that.
    const shadowRanges: Array<{ name: string; start: number; end: number }> = []
    // PERF (2026-09-30). `isShadowedAt` is called at EVERY call site, so the
    // shadow table's shape is the analyzer's hot loop. It was a linear scan over
    // EVERY range for EVERY site, which makes a file O(sites × ranges) — quadratic
    // in the file, and invisible in a corpus total because the mean is dominated
    // by the big files. The cost-by-size census caught it in the one view that
    // shows super-linearity: `test_clojure/data_structures.clj` cost 23 ms/KB
    // against a 5.6 ms/KB corpus norm, at only 60 KB — a TEST file, where every
    // `deftest` adds a range and every assertion adds a site, which is precisely
    // the worst case for that scan.
    //
    // The ranges were ALREADY keyed by name (CLJ-D18 made them `(name, span)`), so
    // the fix is to index them and look up ONE key: O(1) plus the two or three
    // ranges for that name, which is almost always zero. No semantic change — the
    // same predicate, asked of less data. The array is kept because the range
    // COUNT is part of what the census reports.
    const shadowIndex = new Map<string, Array<{ start: number; end: number }>>()
    const indexShadowRange = (name: string, start: number, end: number): void => {
      const list = shadowIndex.get(name)
      if (list) list.push({ start, end })
      else shadowIndex.set(name, [{ start, end }])
    }
    const DEF_NAME_HEADS: Record<string, boolean> = Object.create(null)
    // CLJ-D18: `defmethod` and `deftest` bind a var of the multimethod's / test's
    // name (the defmethod case is the lane's declared 3-symbol multi-site
    // model), and `declare` interns a var WITHOUT a body — `(declare coll)`
    // then `(coll)` is a real call to a real in-file var, and before this wave
    // `declare` was in the core list, so the head produced nothing at all.
    for (const h of ["def", "defn", "defn-", "defmacro", "defonce", "defmulti", "defmethod", "deftest", "declare"]) DEF_NAME_HEADS[h] = true
    // CLJ-D19: a `defprotocol` / `definterface` SIGNATURE names a var too, and
    // it is callable by bare name — `(format-value x)` dispatches through the
    // protocol fn this form creates.
    const PROTO_SIG_PARENTS: Record<string, boolean> = Object.create(null)
    for (const h of ["defprotocol", "definterface"]) PROTO_SIG_PARENTS[h] = true
    const BINDING_VEC_HEADS: Record<string, boolean> = Object.create(null)
    for (const h of ["let", "let*", "loop", "loop*", "when-let", "if-let", "when-some", "if-some", "when-first", "binding", "for", "doseq", "dotimes", "with-open", "with-local-vars", "with-bindings", "letfn"]) BINDING_VEC_HEADS[h] = true
    const FN_PARAM_HEADS: Record<string, boolean> = Object.create(null)
    for (const h of ["fn", "defn", "defn-", "defmacro", "defmethod", "deftest"]) FN_PARAM_HEADS[h] = true
    const shadowRangeOf = (candidate: Node): { name: string; start: number; end: number } | null => {
      const nm = symName(candidate)
      const parent = candidate.parent
      if (!parent) return null
      if (parent.type === "list_lit") {
        // `(def comment …)`-family: the var binds when the form completes —
        // a `(comment …)` inside this form's own init is still the macro.
        const head = formNameOf(parent)
        if (DEF_NAME_HEADS[head] && parent.namedChild(1)?.startIndex === candidate.startIndex) {
          return { name: nm, start: parent.endIndex, end: Infinity }
        }
        // W24-mr1: a letfn fn-spec head — `[(comment [args] body) …]` — binds
        // the name for the whole enclosing letfn form (specs are mutually
        // visible, exactly like a binding-vector entry).
        if (parent.namedChild(0)?.startIndex === candidate.startIndex) {
          const specVec = parent.parent
          if (specVec && specVec.type === "vec_lit") {
            const letfnForm = specVec.parent
            if (letfnForm && letfnForm.type === "list_lit" && formNameOf(letfnForm) === "letfn"
                && letfnForm.namedChild(1)?.startIndex === specVec.startIndex) {
              return { name: nm, start: letfnForm.startIndex, end: letfnForm.endIndex }
            }
          }
          // CLJ-D19: a protocol/interface SIGNATURE head — `(format-value [this
          // v])` inside `(defprotocol Formatter …)` — binds the name from the
          // form's end, exactly like a def-family name: the signature is the
          // declaration, and `(format-value x)` is a real call afterwards.
          const declForm = parent.parent
          if (declForm && declForm.type === "list_lit" && PROTO_SIG_PARENTS[formNameOf(declForm)]
              && declForm.namedChild(0)?.startIndex !== parent.startIndex) {
            return { name: nm, start: declForm.endIndex, end: Infinity }
          }
        }
        return null
      }
      if (parent.type === "vec_lit") {
        const gp = parent.parent
        if (!gp || gp.type !== "list_lit") return null
        const head = formNameOf(gp)
        if (FN_PARAM_HEADS[head]) {
          for (let i = 0; i < gp.namedChildCount; i++) {
            const c = gp.namedChild(i)
            if (c?.type === "vec_lit") return c.startIndex === parent.startIndex ? { name: nm, start: gp.startIndex, end: gp.endIndex } : null
          }
          return null
        }
        if (BINDING_VEC_HEADS[head] && gp.namedChild(1)?.startIndex === parent.startIndex) {
          return { name: nm, start: gp.startIndex, end: gp.endIndex }
        }
        // Multi-arity clause: the vec is the FIRST named child of a list
        // whose parent is a fn/defn form — the param covers that clause.
        if (gp.namedChild(0)?.startIndex === parent.startIndex) {
          const ggp = gp.parent
          if (ggp && ggp.type === "list_lit" && FN_PARAM_HEADS[formNameOf(ggp)]) {
            return { name: nm, start: gp.startIndex, end: gp.endIndex }
          }
        }
        // W24-mr1b: a letfn fn-spec PARAM vector — `[(f [comment] …)]` — the
        // param covers its own spec form only (params are local to the spec).
        {
          const specVec = gp.parent
          if (specVec && specVec.type === "vec_lit") {
            const letfnForm = specVec.parent
            if (letfnForm && letfnForm.type === "list_lit" && formNameOf(letfnForm) === "letfn"
                && letfnForm.namedChild(1)?.startIndex === specVec.startIndex) {
              return { name: nm, start: gp.startIndex, end: gp.endIndex }
            }
          }
        }
        return null
      }
      return null
    }
    const bindingStack: Node[] = [rootNode]
    while (bindingStack.length > 0) {
      const candidate = bindingStack.pop()!
      if (candidate.type === "dis_expr" || candidate.type === "quoting_lit") continue
      // CLJ-D18: the table is no longer `comment`-only. Every name that could
      // shadow a CORE name is recorded, because the same ranges answer two
      // questions — "is this `(comment …)` a real call or the macro?" and "is
      // this bare head the standard library or the file's own var?". One
      // mechanism, two consumers, and both are order-aware and region-scoped.
      // The gate is one null-prototype Set lookup, so the hot path is unchanged.
      if (candidate.type === "sym_lit" && CLOJURE_CORE_BUILTINS[symName(candidate)]) {
        const range = shadowRangeOf(candidate)
        if (range) { shadowRanges.push(range); indexShadowRange(range.name, range.start, range.end) }
      }
      for (let i = 0; i < candidate.namedChildCount; i++) {
        const child = candidate.namedChild(i)
        if (child) bindingStack.push(child)
      }
    }
    const isShadowedAt = (name: string, pos: number): boolean => {
      const list = shadowIndex.get(name)
      if (list === undefined) return false
      for (let i = 0; i < list.length; i++) { const r = list[i]!; if (pos >= r.start && pos < r.end) return true }
      return false
    }
    // ── The one suppression gate (CLJ-D17/CLJ-D18/D2) ───────────────────────────────
    // Every site that decides "this bare head is the language, not the
    // program" goes through here, so the three exemptions cannot drift apart:
    //
    //   1. SHADOWED — the file binds the name itself at this point (def-family
    //      name, `declare`, a protocol signature, a param, a binding vector, a
    //      letfn spec). Clojure compiles a form when it reads it, so a
    //      `(map f xs)` ABOVE `(defn map …)` really is the standard library
    //      and one BELOW is the file's own var — which is why the ranges are
    //      order-aware and this takes a POSITION.
    //   2. REFERRED — `(:require [lib :refer [name]])` / `:only` / `:rename`
    //      names a CONFIRMED external target. A `:refer` that shadows a core
    //      name (`[clojure.string :refer [join]]`) is a dependency, and the
    //      post-walk refer pass resolves it to `lib/name`.
    //   3. not a core name at all — the cheap exit every site already had.
    //
    // Without 1 and 2 the 723-name list would trade one fabrication for
    // another: measured, 555 real in-file call sites in the clojure corpus
    // alone are silenced by a name collision, and every `:refer` of a
    // core-shaped name would vanish.
    const isCoreCallSuppressed = (name: string, pos: number): boolean => {
      if (!name || !CLOJURE_CORE_BUILTINS[name]) return false
      if (referAt(name, pos)) return false
      return !isShadowedAt(name, pos)
    }
    // F13: threading step lists already emitted their thread-adjusted call
    // at the macro site — their own walk must not re-emit the written arity.
    const threadedSteps = new Set<number>()

    // ── Walk ──────────────────────────────────────────────────────────────
    const walkStack: Array<{ node: Node; isExit: boolean; previousActiveFunction: any; quoteDepth: number }> = [{ node: rootNode, isExit: false, previousActiveFunction: activeFunction, quoteDepth: 0 }]

    while (walkStack.length > 0) {
      const { node, isExit, previousActiveFunction: savedActiveFunction, quoteDepth } = walkStack.pop()!
      if (!node) continue

      if (isExit) {
        activeFunction = savedActiveFunction
        continue
      }

      if (node.type === "dis_expr") continue
      // CLJ-D5 (adversarial F5): metadata is compile-time DATA — never walked.
      // `^{:doc (meta-fn)}` fabricated `calls meta-fn` before this; metadata
      // occupies no execution position (the #881 head rule) and its values are
      // reader data, so the whole subtree is skipped.
      if (node.type === "meta_lit") continue
      if (node.type === "syn_quoting_lit" || quoteDepth > 0) {
        let childDepth = quoteDepth
        if (node.type === "syn_quoting_lit") childDepth++
        else if (node.type === "unquoting_lit" || node.type === "unquote_splicing_lit") childDepth--
        for (let i = node.namedChildCount - 1; i >= 0; i--) {
          const child = node.namedChild(i)
          if (child) walkStack.push({ node: child, isExit: false, previousActiveFunction: null, quoteDepth: childDepth })
        }
        continue
      }
      if (node.type === "quoting_lit") continue
      // ── C12/C13: tagged / constructor literals ───────────────────────
      // `#Foo[1 2]` / `#probe.recs.Rec{:x 1}` (Clojure 1.12 record/class
      // literals) name a TYPE: emit an instantiates edge from the enclosing
      // context. The reader decides ctor-vs-tag by class resolution, which an
      // AST-only pass cannot do — the shape rule is the same one the ctor
      // idioms already use: a constructor name ENDS IN AN UPPERCASE SEGMENT
      // (Foo, probe.recs.Rec, p/Rec); lowercase tags (`#my/tag [1 2]`) are
      // reader DATA. Payloads are data either way — `#my/tag (call-x)` must
      // never emit a call to call-x (the measured C13 defect).
      if (node.type === "tagged_or_ctor_lit") {
        const tagNode = node.namedChild(0)
        const payload = node.namedChild(1)
        const tag = symName(tagNode)
        // CLJ-D37: `#js` IS AN EVALUATED PAYLOAD, EXCEPT FOR ITS KEYS.
        //
        // ClojureScript's `#js` compiles its map (or vector) to a JavaScript
        // object/array LITERAL, and a literal's VALUES are evaluated. So
        // `(dayjs #js {:year (.year ^dayjs a-date) …})` makes six real member
        // accesses — and the blanket "payloads are data either way" rule above
        // dropped all six, together with every call in the values. metabase's
        // util/time/impl.cljs:313-319 is the whole of it in this corpus, and it
        // is invisible to the `calls` gate for the reason this file keeps
        // finding: the `calls` truth derives calls, the analyzer emitted none,
        // and a form that walks as NOTHING looks identical to a form with no
        // calls in it.
        //
        // The discriminator is the tag. `#js` (and the historical `#JS`) is the
        // one tag whose payload is a literal with evaluated values; `#inst`,
        // `#uuid` and every record/class literal take DATA. The KEYS are still
        // data — a key is a property name, not an expression — so the walk
        // descends into map values and vector elements only.
        const bareTag = tag.includes("/") ? tag.slice(tag.indexOf("/") + 1) : tag
        if ((bareTag === "js" || bareTag === "JS") && payload) {
          const walkJsValues = (nd: Node): void => {
            if (nd.type === "kwd_lit") return // a property name, never an expression
            if (nd.type === "map_lit") {
              // children alternate key/value; keys are data, values are code.
              for (let i = 0; i < nd.namedChildCount; i++) {
                const c = nd.namedChild(i)
                if (!c) continue
                const isKey = i % 2 === 0
                if (!isKey) walkStack.push({ node: c, isExit: false, previousActiveFunction: null as any, quoteDepth })
              }
              return
            }
            if (nd.type === "vec_lit" || nd.type === "set_lit") {
              for (let i = 0; i < nd.namedChildCount; i++) {
                const c = nd.namedChild(i)
                if (c) walkStack.push({ node: c, isExit: false, previousActiveFunction: null as any, quoteDepth })
              }
              return
            }
            // a scalar payload evaluates to itself
          }
          walkJsValues(payload)
          continue
        }
        if (tag && payload && (payload.type === "vec_lit" || payload.type === "map_lit")) {
          const namePart = tag.includes("/") ? tag.slice(tag.indexOf("/") + 1) : tag
          const lastSeg = namePart.includes(".") ? namePart.slice(namePart.lastIndexOf(".") + 1) : namePart
          const c0 = lastSeg.charCodeAt(0)
          if (c0 >= 65 && c0 <= 90) {
            const src = activeFunction ? activeFunction.name : currentNamespace
            pushRel(src, resolveQualified(tag), ASTEngine.RelationshipType.Instantiates, 0.8, { clojureSpecific: true, isCtorLiteral: true, ...(activeFunction ? {} : { isTopLevel: true }) }, tagNode ? tagNode.startPosition.row + 1 : undefined, payload.type === "vec_lit" ? payload.namedChildCount : undefined)
          }
        }
        continue
      }
      if (node.type === "list_lit") {
        // C7/C8 seam guard: a list inside a LIBSPEC site is DATA, never a
        // call. The ns-clause and top-level directive branches consume the
        // spec through handleLibNode; without this guard the C8 top-level
        // attribution fabricates `ns -[calls]-> java.util` (caught by the M12
        // differential as a false positive). Clause parents are kwd-headed
        // (`(:require …)`) — clauseNameOf; directive parents are sym-headed —
        // formNameOf.
        //
        // CLJ-D22: the guard used to look ONLY at a LIST parent, which covered
        // `(java.util Date)` and the direct libspecs but MISSED a name list
        // nested inside a VECTOR spec — `(:use [lib :only (browse-up)])`,
        // where the parent is the spec's `[…]`. So the `:only` list walked as
        // code and fabricated a top-level call, and once D5 taught the handler
        // to read `:only` that fabrication even acquired a lib: `ns
        // -[calls]-> clj.java.browse/browse-up` with `isTopLevel`. The test is
        // now "is any enclosing list a libspec site", which is the actual rule.
        let site: Node | null = null
        for (let anc: Node | null = node.parent; anc; anc = anc.parent) {
          if (anc.type !== "list_lit") continue
          const pf = clauseNameOf(anc) || formNameOf(anc)
          if (pf === "require" || pf === "use" || pf === "import" || pf === "refer" || pf === "refer-macros" || pf === "use-macros" || pf === "refer-clojure") { site = anc; break }
        }
        if (site) continue
      }
      if (node.type === "list_lit") {
        const form = formNameOf(node)
        // F10 (adversarial): the data-form skip is SPELLING-independent —
        // `clojure.core/quote` and an aliased `c/comment` (`[clojure.core :as
        // c]`) walked their bodies as code before this canonicalisation.
        const canon = resolveQualified(form)
        if (canon === "quote" || canon === "clojure.core/quote" || canon === "clojure.core/comment" || (canon === "comment" && !isShadowedAt("comment", node.startIndex))) continue
      }

      const previousActiveFunction = activeFunction
      walkStack.push({ node, isExit: true, previousActiveFunction, quoteDepth })

      // ── anonymous fn shorthand: #(...) ──────────────────────────────────
      if (node.type === "anon_fn_lit") {
        const name = `lambda_${node.startPosition.row}_${node.startPosition.column}`
        const lambdaSymbol: ASTEngine.UniversalSymbol = {
          name, kind: ASTEngine.SymbolKind.Function,
          range: this.nodeToRange(node), scope: currentNamespace, ownerName: "",
          visibility: "local",
          parameters: [],
          metadata: { isAnonymous: true, isPure: true, complexity: 1, clojureSpecific: true }
        }
        symbols.push(lambdaSymbol)
        activeFunction = lambdaSymbol
        // F1 (adversarial): `#(f a b)` is a bare call form with NO list
        // wrapper — its first named child IS the callee, and the generic
        // child walk only ever saw argument positions, so the head call
        // never emitted (`(defn f [] (#(helper %) 1))` produced only
        // `contains f` — 168 non-builtin heads across 61 corpus files, e.g.
        // main.clj `#(core-class? …)`). `%`, `%N`, `%&` heads are parameter
        // references, never callees; builtin heads follow the builtin policy.
        const anonHead = node.namedChild(0)
        if (anonHead && anonHead.type === "sym_lit") {
          const hName = symName(anonHead)
          // CLJ-D46: THE SHORTHAND MUST ROUTE INTEROP HEADS THE WAY THE LIST PATH
          // DOES. It did not, and that was 20 of the residual edges.
          //
          // `(.getName o)` on its own is a MEMBER ACCESS and correctly emits
          // `uses: getName` (see the `.`-prefix branch on a list). Written as
          // `#(.getName %)`, the same expression took this path instead, and this
          // path pushed `calls: lambda_1_18 -> .getName` — a call edge to a name
          // that starts with a dot, is not a var in the file, and is not an export.
          // A dangling relationship, which is the one thing the "all extracted,
          // resolved and emitted" contract exists to prevent, and it was invisible
          // to the differential because the truth ALSO files these under `uses`:
          // the two agreed on the ontology and disagreed only on whether the
          // shorthand was analysed at all.
          //
          // So this was never the "where does a Java method invocation belong"
          // question it looked like. The analyzer's own convention is already
          // settled and already implemented 600 lines below; the shorthand simply
          // skipped it. Same shape as CLJ-D45 on the truth side, in the same wave.
          const anonMember =
            hName && hName.startsWith(".") && hName !== ".."
              ? (hName.startsWith(".-") ? hName.slice(2) : hName.slice(1))
              : null
          const anonStatic = hName ? staticInteropMember(hName) : null
          if (anonMember) {
            const mLine = anonHead.startPosition.row + 1
            pushRel(name, anonMember, ASTEngine.RelationshipType.Uses, 0.7,
              { clojureSpecific: true, isFieldAccess: true, isAnonShorthand: true },
              mLine, Math.max(0, node.namedChildCount - 1), anonHead.startIndex)
            patterns["Java Interoperability"] = true
          } else if (anonStatic !== null) {
            const mLine = anonHead.startPosition.row + 1
            const mArity = Math.max(0, node.namedChildCount - 1)
            pushRel(name, anonStatic, ASTEngine.RelationshipType.Uses, 0.7,
              { clojureSpecific: true, isFieldAccess: true, isAnonShorthand: true },
              mLine, mArity, anonHead.startIndex)
            const anonCls = staticInteropClass(hName)
            if (anonCls) {
              pushRel(name, resolveQualified(anonCls), ASTEngine.RelationshipType.Uses, 0.8,
                { clojureSpecific: true, isClassReference: true, isAnonShorthand: true },
                mLine, 0, anonHead.startIndex)
            }
            patterns["Java Interoperability"] = true
          } else if (hName && !isAnonArgShorthand(hName) && !isCoreCallSuppressed(hName, anonHead.startIndex)) {
            const line = anonHead.startPosition.row + 1
            const arity = Math.max(0, node.namedChildCount - 1)
            const q = resolveCallee(anonHead, hName)   // CLJ-D28
            if (q.alias) {
              const resolvedNs = namespaceAliases[q.alias] || q.alias
              pushRel(name, q.target, ASTEngine.RelationshipType.Calls, 0.9, { clojureSpecific: true, isGeneralCall: true, isAnonShorthand: true }, line, arity, anonHead.startIndex)
              if (resolvedNs !== currentNamespace) pushRel(currentNamespace, resolvedNs, ASTEngine.RelationshipType.References, 0.8, { clojureSpecific: true, isLibraryDep: true }, line)
            } else {
              pushRel(name, hName, ASTEngine.RelationshipType.Calls, 0.9, { clojureSpecific: true, isGeneralCall: true, isAnonShorthand: true }, line, arity, anonHead.startIndex)
            }
          }
        }
      } else if (node.type === "list_lit") {
        const formName = formNameOf(node)

        // ── (fn [params] ...) anonymous function form ─────────────────────
        if (formName === "fn") {
          const name = `lambda_${node.startPosition.row}_${node.startPosition.column}`
          const lambdaSymbol: ASTEngine.UniversalSymbol = {
            name, kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(node), scope: currentNamespace, ownerName: "",
            visibility: "local",
            parameters: extractParams(node),
            metadata: { isAnonymous: true, isPure: true, complexity: 1, clojureSpecific: true }
          }
          symbols.push(lambdaSymbol)
          activeFunction = lambdaSymbol
        }
        // ── ns form ──────────────────────────────────────────────────────
        else if (formName === "ns" || formName === "in-ns") {
          sawNamespaceForm = true
          // CLJ-D31: `in-ns` IS A NAMESPACE FORM. `(in-ns 'clojure.pprint)` is how
          // a file loaded into a running runtime declares its namespace — and
          // `currentNamespace` stayed "user" for it, so every top-level
          // definition in such a file was stranded on owner `user` with no
          // `contains` edge and the wrong scope. 484 definitions across 17
          // files, the whole of clojure's own pretty-printer among them
          // (cl_format, pprint_base, dispatch, pretty_writer, core_print, …),
          // plus genclass.clj and core_deftype.clj. The class was invisible for
          // three waves because it is an ABSENCE, not a wrong value: a file
          // whose namespace is unknown still emits a full, plausible symbol
          // table, and every per-class completeness claim was true of it.
          //
          // `in-ns` takes a QUOTED symbol, not a bare one: `(in-ns 'a.b)`. So
          // the name is read from the quote's child. The alias/refer state is
          // NOT reset here — `in-ns` switches namespace without re-running
          // `ns`, so an alias table from a previous `ns` form in the same file
          // is still in force, and clearing it would invent unresolved
          // references. That is why only `ns` keeps the resets below.
          const argNode = node.namedChild(1)
          let nsName = ""
          if (argNode) {
            if (argNode.type === "sym_lit") nsName = symName(argNode)
            else if (argNode.type === "quoting_lit" || argNode.type === "syn_quoting_lit") {
              // `(in-ns 'a.b)` — the name is the quote's own first child.
              const inner = executionHead(argNode)
              const innerName = inner && inner.type === "sym_lit" ? symName(inner) : ""
              nsName = innerName
            }
          }
          if (nsName) currentNamespace = nsName
          if (formName === "ns") {
            // F3: null-prototype reset (see the declaration).
            namespaceAliases = Object.create(null)
            // CLJ-D24: the refer table is namespace state for the same reason the
            // alias table is. The previous segment CLOSES at this form — a
            // `(comment …)` or a docstring before it still resolves against the
            // namespace it was written in — and a new one opens for this ns.
            if (referSegments.length > 0) referSegments[referSegments.length - 1]!.end = node.startIndex
            referTable = openReferSegment(node.startIndex)
          }
          const modSym: ASTEngine.UniversalSymbol = {
            name: currentNamespace,
            kind: ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            metadata: { clojureSpecific: true }
          }
          symbols.push(modSym)
          attachDocs(modSym, node, "always")
          exports.push({ name: currentNamespace, kind: ASTEngine.SymbolKind.Module, range: this.nodeToRange(node), visibility: "public" })

          // require / use / import / require-macros clauses. `refer-clojure`
          // is NOT fed through the libspec handler (adversarial F2): its
          // `:exclude [my-map]` / `:only` name-lists are VAR names — the
          // handler treated `[my-map]` as a libspec and fabricated
          // `references -> my-map` plus an import of package "my-map"
          // (measured: 43 files, e.g. string.clj `:exclude [replace
          // reverse]` → `references -> replace` + imported class items). The
          // clause is consumed as data — nothing in it is a dependency.
          // Reader-conditional clauses `#?(:clj (:require …) …)` unwrap to
          // their list children (adversarial F12 — real cljc files carried
          // alias-less requires, leaving every aliased call dangling).
          const clauses: Node[] = []
          for (let i = 1; i < node.namedChildCount; i++) {
            const clause = node.namedChild(i)
            if (!clause) continue
            if (clause.type === "list_lit") clauses.push(clause)
            else if (clause.type === "read_cond_lit" || clause.type === "splicing_read_cond_lit") {
              for (let c = 0; c < clause.namedChildCount; c++) {
                const inner = clause.namedChild(c)
                if (inner && inner.type === "list_lit") clauses.push(inner)
              }
            }
          }
          for (const clause of clauses) {
            const clauseType = clauseNameOf(clause)
            if (clauseType !== "require" && clauseType !== "use" && clauseType !== "import" && clauseType !== "require-macros") continue

            for (let j = 1; j < clause.namedChildCount; j++) {
              const libNode = clause.namedChild(j)
              if (libNode) handleLibNode(libNode)
            }
          }
        }
        // ── C7: top-level directive forms after the ns ────────────────────
        // `(require '[clojure.string :as s])`, `(import '(java.util Date))`,
        // `(use 'foo)`, `(refer 'foo)` — previously ignored entirely (only ns
        // clauses were parsed), leaving aliases unregistered and every
        // `s/join`-style call dangling. The kwd-headed ns clauses
        // (`(:require …)`) are consumed by the ns branch above; this branch
        // fires only for sym-headed top-level forms.
        else if ((formName === "require" || formName === "use" || formName === "import" || formName === "refer" || formName === "require-macros") && executionHead(node)?.type === "sym_lit") {
          for (let j = 1; j < node.namedChildCount; j++) {
            const libNode = node.namedChild(j)
            if (libNode) handleLibNode(libNode)
          }
        }
        // ── defn / defn- / defmacro ──────────────────────────────────────
        else if (formName === "defn" || formName === "defn-" || formName === "defmacro" || formName === "s/defn" || formName === "mu/defn") {
          const isMacro = formName === "defmacro"
          // W24-mr3: `defn-` AND `^{:private true}` / `^:private` both bind private.
          const isPrivate = formName === "defn-" || metaHasPrivate(node.namedChild(1))
          const name = symName(node.namedChild(1)) || "unknown"
          const funcSymbol: ASTEngine.UniversalSymbol = {
            name, kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(node), scope: currentNamespace, ownerName: currentNamespace,
            visibility: isPrivate ? "private" : "public",
            parameters: extractParams(node),
            metadata: { clojureSpecific: true, isPure: true, complexity: 1, isMacro: isMacro || undefined }
          }
          symbols.push(funcSymbol)
          activeFunction = funcSymbol
          attachDocs(funcSymbol, node, "fn")
          if (isMacro) patterns["Metaprogramming"] = true
          exports.push({ name, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node), visibility: isPrivate ? "private" : "public" })
        }
        // ── deftest (clojure.test) ───────────────────────────────────────
        // The test body is a function: calls inside it were dropped entirely
        // (no symbol, no activeFunction) and, with top-level attribution
        // arriving in the same wave, the deftest name is the honest caller.
        else if (formName === "deftest") {
          const name = symName(node.namedChild(1)) || `test_${node.startPosition.row}`
          const testSym: ASTEngine.UniversalSymbol = {
            name, kind: ASTEngine.SymbolKind.Function,
            range: this.nodeToRange(node), scope: currentNamespace, ownerName: currentNamespace,
            visibility: "public", parameters: [],
            metadata: { clojureSpecific: true, isTest: true, isPure: true, complexity: 1 }
          }
          symbols.push(testSym)
          activeFunction = testSym
          attachDocs(testSym, node, "fn")
        }
        // ── defprotocol ──────────────────────────────────────────────────
        else if (formName === "defprotocol") {
          const name = symName(node.namedChild(1)) || "unknown"
          // CLJ-D27: `^:private` / `^{:private true}` on a TYPE declaration is
          // the same privacy contract W24-mr3 established for `def`/`defn`; the
          // type branches never read it, so a private record or protocol was
          // published as public in the namespace's export surface.
          const typeVisibility = metaHasPrivate(node.namedChild(1)) ? "private" : "public"
          const protoSym: ASTEngine.UniversalSymbol = {
            name, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: typeVisibility,
            metadata: { clojureSpecific: true, isProtocol: true }
          }
          symbols.push(protoSym)
          attachDocs(protoSym, node, "always")
          patterns["Protocol-based Polymorphism"] = true
          exports.push({ name, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node), visibility: typeVisibility })
          // protocol method signatures: (method-name [this arg ...])
          for (let i = 2; i < node.namedChildCount; i++) {
            const m = node.namedChild(i)
            if (!m || m.type !== "list_lit") continue
            const mName = symName(m.namedChild(0))
            // CLJ-D19: NO core-builtin gate on a DECLARATION. This gate was
            // left over from C9, whose real fix was the null-prototype alias
            // table (a plain `{}` answered `toString` from Object.prototype);
            // `toString` was never in the list, so the gate never fired for the
            // pollution it was written for. What it DID do is drop real
            // members: gvec.clj's `(definterface ArrayManager …)` declares
            // `array`, `alength`, `aclone`, `aget`, `aset` and FOUR of the five
            // are in the list, so the interface was emitted with 1 method; and
            // `(definterface … (identity [x]))` was emitted with none. The
            // 723-name list would have made it worse — `get`, `key`, `count`
            // are all core names AND common protocol method names.
            if (!mName) continue
            symbols.push({
              name: mName, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(m),
              scope: `${currentNamespace}.${name}`, ownerName: name, visibility: "public",
              parameters: extractParams(m),
              metadata: { clojureSpecific: true, isProtocolMethod: true }
            })
          }
        }
        // ── definterface (adversarial F9) ───────────────────────────────
        // Mirror of defprotocol: the interface name is a symbol and each
        // signature list `(size [])` is a method definition — it used to
        // fall to the generic-call branch (`calls definterface`, `calls
        // size`, `calls run`) with no interface symbol at all (33 corpus
        // lines). Signature lists are excluded from call handling by the
        // impl-context branch (definterface added to METHOD_IMPL_PARENT_FORMS).
        else if (formName === "definterface") {
          const name = symName(node.namedChild(1)) || "unknown"
          const typeVisibility = metaHasPrivate(node.namedChild(1)) ? "private" : "public"
          const ifaceSym: ASTEngine.UniversalSymbol = {
            name, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: typeVisibility,
            metadata: { clojureSpecific: true, isInterface: true }
          }
          symbols.push(ifaceSym)
          attachDocs(ifaceSym, node, "always")
          exports.push({ name, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node), visibility: typeVisibility })
          for (let i = 2; i < node.namedChildCount; i++) {
            const m = node.namedChild(i)
            if (!m || m.type !== "list_lit") continue
            const mName = symName(m.namedChild(0))
            // CLJ-D19 twin: see the defprotocol branch — a signature is a
            // DECLARATION, so no core-builtin gate belongs here.
            if (!mName) continue
            symbols.push({
              name: mName, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(m),
              scope: `${currentNamespace}.${name}`, ownerName: name, visibility: "public",
              parameters: extractParams(m),
              metadata: { clojureSpecific: true, isInterfaceMethod: true }
            })
          }
        }
        // ── defrecord / deftype ──────────────────────────────────────────
        else if (formName === "defrecord" || formName === "deftype") {
          const name = symName(node.namedChild(1)) || "unknown"
          // CLJ-D27 twin.
          const typeVisibility = metaHasPrivate(node.namedChild(1)) ? "private" : "public"
          const classSym: ASTEngine.UniversalSymbol = {
            name, kind: ASTEngine.SymbolKind.Class, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: typeVisibility,
            metadata: { clojureSpecific: true, isRecord: formName === "defrecord", isType: formName === "deftype" }
          }
          symbols.push(classSym)
          attachDocs(classSym, node, "always")
          exports.push({ name, kind: ASTEngine.SymbolKind.Class, range: this.nodeToRange(node), visibility: typeVisibility })

          // fields vector — the first direct vec_lit child (a docstring may
          // sit at index 2; adversarial F16: `(defrecord Foo "doc" [x y] …)`
          // lost the x/y property symbols)
          let fieldsVec: Node | null = null
          for (let i = 2; i < node.namedChildCount; i++) {
            const c = node.namedChild(i)
            if (c && c.type === "vec_lit") { fieldsVec = c; break }
          }
          if (fieldsVec) {
            for (let i = 0; i < fieldsVec.namedChildCount; i++) {
              const field = fieldsVec.namedChild(i)
              if (field && field.type === "sym_lit") {
                symbols.push({
                  name: symName(field), kind: ASTEngine.SymbolKind.Property, range: this.nodeToRange(field),
                  scope: `${currentNamespace}.${name}`, ownerName: name, visibility: "public",
                  metadata: { clojureSpecific: true }
                })
              }
            }
          }
          // implements: protocol symbols after the fields vector — aliases
          // resolve (C5) and the edge carries the protocol name's line. The
          // method implementations `(px [_] …)` in the body are method
          // DEFINITIONS, handled structurally by the impl-context branch on
          // the child lists (C9) — never here, and never as calls.
          for (let pi = 3; pi < node.namedChildCount; pi++) {
            const protoNode = node.namedChild(pi)
            if (!protoNode || protoNode.type !== "sym_lit") continue
            const protoName = resolveQualified(symName(protoNode))
            if (protoName) {
              pushRel(name, protoName, ASTEngine.RelationshipType.Implements, 0.85, { clojureSpecific: true, isRecord: formName === "defrecord" }, protoNode.startPosition.row + 1)
            }
          }
        }
        // ── C9: protocol-extending forms — implements edges ───────────────
        // `(reify P …)`, `(extend-type Type P …)`, `(extend-protocol P Type
        // …)`, `(proxy [Super Ifaces] …)`. The method bodies are handled by
        // the impl-context branch on the child lists; HERE the type edges are
        // emitted: reify/proxy attach to the enclosing context, extend-*
        // attach the named TYPE (source = the type, like defrecord).
        else if (formName === "reify" || formName === "extend-type" || formName === "extend-protocol" || formName === "proxy") {
          const ctxName = activeFunction ? activeFunction.name : currentNamespace
          const topMeta = activeFunction ? {} : { isTopLevel: true }
          if (formName === "reify") {
            for (let i = 1; i < node.namedChildCount; i++) {
              const c = node.namedChild(i)
              if (c && c.type === "sym_lit") {
                const proto = resolveQualified(symName(c))
                if (proto) pushRel(ctxName, proto, ASTEngine.RelationshipType.Implements, 0.85, { clojureSpecific: true, isReify: true, ...topMeta }, c.startPosition.row + 1)
              }
            }
            patterns["Protocol-based Polymorphism"] = true
          } else if (formName === "extend-protocol") {
            const proto = resolveQualified(symName(node.namedChild(1)))
            for (let i = 2; i < node.namedChildCount; i++) {
              const c = node.namedChild(i)
              if (c && c.type === "sym_lit" && proto) {
                pushRel(symName(c), proto, ASTEngine.RelationshipType.Implements, 0.85, { clojureSpecific: true, isExtendProtocol: true }, c.startPosition.row + 1)
              }
            }
            patterns["Protocol-based Polymorphism"] = true
          } else if (formName === "extend-type") {
            const typeName = symName(node.namedChild(1))
            for (let i = 2; i < node.namedChildCount; i++) {
              const c = node.namedChild(i)
              if (c && c.type === "sym_lit") {
                const proto = resolveQualified(symName(c))
                if (proto && typeName) pushRel(typeName, proto, ASTEngine.RelationshipType.Implements, 0.85, { clojureSpecific: true, isExtendType: true }, c.startPosition.row + 1)
              }
            }
            patterns["Protocol-based Polymorphism"] = true
          } else {
            // proxy: [SuperClass Iface…] — the first symbol is extended, the
            // rest implemented.
            const ifaces = node.namedChild(1)
            if (ifaces && ifaces.type === "vec_lit") {
              for (let i = 0; i < ifaces.namedChildCount; i++) {
                const c = ifaces.namedChild(i)
                if (c && c.type === "sym_lit") {
                  const iface = resolveQualified(symName(c))
                  if (iface) pushRel(ctxName, iface, i === 0 ? ASTEngine.RelationshipType.Extends : ASTEngine.RelationshipType.Implements, 0.8, { clojureSpecific: true, isProxy: true, ...topMeta }, c.startPosition.row + 1)
                }
              }
            }
            patterns["Java Interoperability"] = true
          }
        }
        // ── defmulti / defmethod ─────────────────────────────────────────
        else if (formName === "defmulti") {
          const name = symName(node.namedChild(1)) || "unknown"
          const multiSym: ASTEngine.UniversalSymbol = {
            name, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            metadata: { clojureSpecific: true, isMultimethod: true }
          }
          symbols.push(multiSym)
          attachDocs(multiSym, node, "always")
          patterns["Multimethods"] = true
          exports.push({ name, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node), visibility: "public" })
        } else if (formName === "defmethod") {
          const multiName = symName(node.namedChild(1)) || "unknown"
          // The method impl shares the multimethod's var (Clojure semantics:
          // defmethod adds a dispatch method to the defmulti var, it does not
          // create a new var). Emit a line-distinct impl symbol; the Overrides
          // family is inapplicable intra-namespace because source and target
          // share the same identity (documented in the analyzer doc). The
          // impl becomes the walking context so body calls attribute to it
          // instead of being dropped (C8 class).
          const methodSym: ASTEngine.UniversalSymbol = {
            name: multiName, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            parameters: extractParams(node),
            metadata: { clojureSpecific: true, isMethodImpl: true }
          }
          symbols.push(methodSym)
          activeFunction = methodSym
          patterns["Multimethods"] = true
        }
        // ── def / defonce ────────────────────────────────────────────────
        else if (formName === "def" || formName === "defonce") {
          const nameNode = node.namedChild(1)
          if (nameNode && nameNode.type === "sym_lit") {
            const name = symName(nameNode)
            // W24-mr3: `^{:private true}` / `^:private` binds a private var.
            const varVisibility = metaHasPrivate(nameNode) ? "private" : "public"
            const varSym: ASTEngine.UniversalSymbol = {
              name, kind: ASTEngine.SymbolKind.Variable, range: this.nodeToRange(node),
              scope: currentNamespace, ownerName: currentNamespace, visibility: varVisibility,
              metadata: { clojureSpecific: true }
            }
            symbols.push(varSym)
            attachDocs(varSym, node, "def")
            exports.push({ name, kind: ASTEngine.SymbolKind.Variable, range: this.nodeToRange(node), visibility: varVisibility })
          }
        }
        // ── declare (CLJ-D23) ─────────────────────────────────────────────
        // `(declare coll transform)` interns a var per name with NO body. It
        // was in the core list, so the form produced no symbol and no edge at
        // all, and — worse — the names it introduces were not registered as
        // in-file declarations, so every later `(coll …)` call dangled with
        // nothing to resolve to. 68 sites across the three corpora (mutual
        // recursion in the compiler and in clj-kondo's compojure fixture).
        //
        // A declared var is a Variable with `isForwardDeclaration`, and it is
        // NOT an export: a forward declaration is not a definition, and
        // publishing one in the namespace's export surface would claim a var
        // the file does not define. It IS a `contains` member (the owner loop
        // runs on ownerName) so the graph has a node for the call target.
        else if (formName === "declare") {
          for (let i = 1; i < node.namedChildCount; i++) {
            const nameNode = node.namedChild(i)
            if (!nameNode) continue
            if (nameNode.type === "sym_lit") {
              const name = symName(nameNode)
              if (!name || CLOJURE_CORE_BUILTINS[name]) continue
              symbols.push({
                name, kind: ASTEngine.SymbolKind.Variable, range: this.nodeToRange(node),
                scope: currentNamespace, ownerName: currentNamespace,
                visibility: metaHasPrivate(nameNode) ? "private" : "public",
                metadata: { clojureSpecific: true, isForwardDeclaration: true },
              })
            } else if (nameNode.type === "vec_lit") {
              // `(declare [a b] c)` is not legal Clojure; a vector here is a
              // docstring-ish or a stray body form. Skip it rather than mint
              // a symbol whose name is `[a b]`.
              continue
            }
          }
        }
        // ── CLJ-D30: a def-like head in def position DEFINES a name ────────
        // Found by the `uses`/`contains` audit, which is the first gate that
        // could see it: 1,136 top-level definitions across the four corpora
        // were recorded as nothing at all — no symbol, no `contains` edge, no
        // export. `(defcurried map …)` in clojure/core/reducers.clj defines all
        // ten of that file's core vars and produced ZERO output.
        //
        // WHY NO GATE CAUGHT IT SO LONG. The F1 node-type census is blind to it:
        // `(defcurried map …)` parses as an ordinary `list_lit`, so the form is
        // a CALL until the analyzer decides otherwise, and a census of node
        // TYPES cannot see an unrecognized CALL. Only a census of top-level
        // HEADS can, and that is `script/m14/tmp/clj-defforms.ts`. The F5
        // `calls` truth was equally blind: it derives calls, and a form it
        // believes is a call matches what the analyzer emitted. A missing
        // DEFINITION is not a wrong call; it is an absence, and absence is
        // exactly what a class-by-class completeness claim cannot detect.
        //
        // THE RULE, WHICH IS GENERAL RATHER THAN A LIST. In Clojure a macro in
        // def position takes the name it defines first. So any def-like head
        // whose first argument is a symbol defines that symbol — no per-macro
        // knowledge required, which is the only version of this that survives
        // the next language/library the analyzer meets. It covers 1,043 sites in
        // metabase alone (`defsetting`, `defenterprise`, `defclause`,
        // `deferror`, `defspec`, `defroutes`, …) and 93 in the other three
        // corpora, including LOCAL macros a per-file analyzer could never have
        // been taught (`def-aset`, `definline`, `defblockingop`,
        // `deftest-both`) and a third-party one (`defprotocol+`).
        //
        // `isDefLikeHead` is a character test, not a regex (the zero-regex
        // census reads this file): `def` optionally followed by `-`/`_`, with
        // the `default…`/`define…` spellings excluded so an ordinary call is not
        // promoted. The KNOWN forms keep their precise kinds above — this branch
        // only ever runs for a head they did not claim, so `defn` is still a
        // Function with parameters and `defrecord` is still a Class.
        //
        // HONESTY: the KIND is inferred (Function when an arglist vector
        // follows, else Variable) and the symbol is stamped
        // `isUnknownDefMacro: true`, so a consumer can tell an inferred kind
        // from a proven one and no downstream claim rests on it. It is still
        // published: a definition the graph does not contain is a hole, and a
        // hole is worse than an inferred kind.
        // NO core-name guard here, and its absence was a real miss. `definline` is
        // a clojure.core macro (core.clj:5461), so it is in the derived core list
        // — and a guard excluding core-named heads threw away `(definline
        // booleans …)`, `(definline bytes …)` and 6 siblings at core.clj:5580+,
        // the `def` family that produces every typed-array coercion. The guard
        // was never needed: every core-named def head is `def`/`defn`/`defmacro`/
        // `defonce`/`declare`/`deftest`/`defmulti`/`defmethod`/`defprotocol`/
        // `defrecord`/`deftype`/`definterface`, and each is claimed by an EARLIER
        // branch, so this one only ever runs for a head nobody handled.
        else if (isDefLikeHead(formName) && node.namedChild(1)?.type === "sym_lit") {
          const nameNode = node.namedChild(1)!
          const name = symName(nameNode)
          if (name) {
            // `def-aset aset-int setInt int`: a name, a docstring, then
            // arbitrary arguments. An arglist is a VECTOR named the same as the
            // definition; a metadata map, a docstring and a body are not. So the
            // kind is Function only when one is actually present.
            let hasArglist = false
            for (let i = 2; i < node.namedChildCount; i++) {
              const c = node.namedChild(i)
              if (c && c.type === "vec_lit") { hasArglist = true; break }
              if (c && c.type === "str_lit") continue
              if (c && c.type === "map_lit") continue
              if (c && c.type === "meta_lit") continue
              break
            }
            const inferredKind = hasArglist ? ASTEngine.SymbolKind.Function : ASTEngine.SymbolKind.Variable
            const visibility = metaHasPrivate(nameNode) ? "private" : "public"
            const sym: ASTEngine.UniversalSymbol = {
              name, kind: inferredKind, range: this.nodeToRange(node),
              scope: currentNamespace, ownerName: currentNamespace, visibility,
              ...(hasArglist ? { parameters: extractParams(node) } : {}),
              metadata: { clojureSpecific: true, isPure: true, complexity: 1, isUnknownDefMacro: true, definedBy: formName },
            }
            symbols.push(sym)
            activeFunction = sym
            attachDocs(sym, node, "fn")
            exports.push({ name, kind: inferredKind, range: this.nodeToRange(node), visibility })
          }
        }
        // ── spec forms ───────────────────────────────────────────────────
        else if ((formName === "s/def" || formName === "s/fdef" || formName === "clojure.spec.alpha/def" || formName === "clojure.spec.alpha/fdef") && node.namedChild(1)) {
          const child = node.namedChild(1)!
          // CLJ-D26: `(s/def ::email …)` names the spec with an AUTO-RESOLVED
          // keyword, whose real name is `:current-ns/email` — the reader
          // qualifies `::` against the namespace. The symbol was published
          // under the literal `::email`, so the spec had no resolvable identity
          // and could not be referenced by any other file. 2 sites in
          // clj-kondo's `corpus/spec_syntax.clj`.
          const raw = symName(child)
          const specName = child.type === "kwd_lit" && raw.startsWith("::")
            ? `:${currentNamespace}/${raw.slice(2)}`
            : raw
          // CLJ-D35: A SPEC FORM NAMES A VAR, so its argument must be a NAME.
          // `(s/fdef 1 :args)` — a clj-kondo corpus fixture for reader recovery —
          // published a symbol literally called `1`, with a `contains` edge
          // `spec-syntax->1` beside it. A symbol named after a literal is not a
          // var, and nothing can ever resolve it, so it is a placeholder
          // identity in a table whose whole contract is that every name in it is
          // referable. Skipped rather than invented.
          if (!specName || child.type === "num_lit" || child.type === "str_lit" || child.type === "bool_lit" || child.type === "char_lit") {
            // fall through to the generic-call branch, which records the spec
            // expression's own call relationships and nothing else
          } else {
          symbols.push({
            name: specName, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            metadata: { isSpec: true, clojureSpecific: true },
          })
          }
        }
        // ── C9: method implementations inside protocol-extending forms ────
        // A DIRECT list child of reify/extend-type/extend-protocol/proxy/
        // defrecord/deftype is a METHOD DEFINITION, never a call: `(px [_] 3)`
        // used to fabricate `use-reify -[calls]-> px`. The method symbol owns
        // its body's calls. defprotocol signatures are already symbolized by
        // the defprotocol branch — listed here so they are still excluded
        // from call handling.
        else if (node.parent?.type === "list_lit" && METHOD_IMPL_PARENT_FORMS[formNameOf(node.parent)] && executionHead(node.parent)?.startIndex !== node.startIndex) {
          const parentForm = formNameOf(node.parent)
          if (parentForm !== "defprotocol" && parentForm !== "definterface") {
            // CLJ-D19 twin: an impl whose name is a core name is still a
            // DECLARATION. C9's prototype-pollution class is already closed by
            // the null-prototype lookup tables, so this gate only dropped
            // members (a `(toString [this] x)` record override, an
            // `(alength [arr])` interface impl).
            const mName = symName(node.namedChild(0))
            if (mName) {
              const owner = methodImplOwner(node, parentForm)
              const isRecord = parentForm === "defrecord" || parentForm === "deftype"
              const methodSym: ASTEngine.UniversalSymbol = {
                name: mName, kind: ASTEngine.SymbolKind.Function,
                range: this.nodeToRange(node),
                scope: owner ? `${currentNamespace}.${owner}` : currentNamespace,
                ownerName: owner || currentNamespace,
                visibility: "public",
                parameters: extractParams(node),
                metadata: { clojureSpecific: true, isProtocolMethodImpl: true, ...(isRecord ? { isRecordMethod: true } : {}) }
              }
              symbols.push(methodSym)
              activeFunction = methodSym
            }
          }
        }
        // ── letfn local functions (adversarial F8) ───────────────────────
        // `(letfn [(f [x] …) (g-inner [y] …)] …)` — each binding-vector list
        // is a DEFINITION: it used to emit `calls outer -> f arity 2` (the
        // definition misread as an invocation, the C9 class one form further)
        // and body calls attributed to the enclosing fn. The definition list
        // mints a local fn symbol and becomes the walking context for its own
        // body; no contains edge (locals, like `fn`).
        else if (node.parent?.type === "vec_lit" && node.parent.parent?.type === "list_lit" && formNameOf(node.parent.parent) === "letfn") {
          // CLJ-D19 twin: a letfn spec DEFINES the name, so no core gate.
          const fName = symName(node.namedChild(0))
          if (fName) {
            const fnSym: ASTEngine.UniversalSymbol = {
              name: fName, kind: ASTEngine.SymbolKind.Function,
              range: this.nodeToRange(node), scope: currentNamespace, ownerName: "",
              visibility: "local",
              parameters: extractParams(node),
              metadata: { clojureSpecific: true, isLocalFn: true, isPure: true, complexity: 1 }
            }
            symbols.push(fnSym)
            activeFunction = fnSym
          }
        }
        // ── constructor idioms ──────────────────────────────────────────
        // `(->ClassName …)` / `(ClassName. …)` / `(new ClassName …)` — the
        // capitalisation rule is FINAL-SEGMENT uppercase (aligned with the
        // tagged-literal branch of CLJ-D1; the old first-char test rejected
        // `->probe.recs.Rec` and `->p/Rec` — adversarial F14) and every
        // target resolves through aliases like other type names. `->>` is
        // NOT a ctor idiom — it must fall through to the threading branch
        // (it starts with `->` and the length test alone would eat it).
        else if (formName.startsWith("->") && formName.length > 2 && formName !== "->>") {
          const cls = formName.slice(2)
          const namePart = cls.includes("/") ? cls.slice(cls.indexOf("/") + 1) : cls
          const lastSeg = namePart.includes(".") ? namePart.slice(namePart.lastIndexOf(".") + 1) : namePart
          const c0 = lastSeg.charCodeAt(0)
          if (c0 >= 65 && c0 <= 90) {
            const src = activeFunction ? activeFunction.name : currentNamespace
            const headNode = executionHead(node)
            pushRel(src, resolveQualified(cls), ASTEngine.RelationshipType.Instantiates, 0.8, { clojureSpecific: true, isConstructor: true, ...(activeFunction ? {} : { isTopLevel: true }) }, headNode ? headNode.startPosition.row + 1 : undefined, callArityOf(node))
          }
        } else if (formName === "new") {
          // `(new ClassName args…)` (F14): an invocation of the class ctor —
          // arity = argument forms after the class name; target line = the
          // class name itself. `new` is a special form, so it never reaches
          // the generic-call branch.
          const clsNode = node.namedChild(1)
          const clsName = symName(clsNode)
          if (clsName) {
            const src = activeFunction ? activeFunction.name : currentNamespace
            pushRel(src, resolveQualified(clsName), ASTEngine.RelationshipType.Instantiates, 0.8, { clojureSpecific: true, isJavaInterop: true, ...(activeFunction ? {} : { isTopLevel: true }) }, clsNode ? clsNode.startPosition.row + 1 : undefined, Math.max(0, node.namedChildCount - 2))
            patterns["Java Interoperability"] = true
            if (activeFunction?.metadata) activeFunction.metadata.isPure = false
          }
        } else if (formName.endsWith(".") && formName.length > 1 && !formName.startsWith(".")) {
          const cls = resolveQualified(formName.slice(0, -1))
          const src = activeFunction ? activeFunction.name : currentNamespace
          const headNode = executionHead(node)
          pushRel(src, cls, ASTEngine.RelationshipType.Instantiates, 0.8, { clojureSpecific: true, isJavaInterop: true, ...(activeFunction ? {} : { isTopLevel: true }) }, headNode ? headNode.startPosition.row + 1 : undefined, callArityOf(node))
          patterns["Java Interoperability"] = true
        }
        // ── Java member/field access: (.method obj) / (.-field obj) ──────
        // F6: `..` is NOT a member name — the old slice made `(.. x (m1))`
        // emit `uses -> "."` (garbage identity; the `uses` label has no
        // oracle truth for clojure, so no gate could see it). `..` falls
        // through to the builtin branch (it is a core form).
        else if (formName.startsWith(".") && formName !== "..") {
          const target = formName.startsWith(".-") ? formName.slice(2) : formName.slice(1)
          const src = activeFunction ? activeFunction.name : currentNamespace
          const headNode = executionHead(node)
          if (target) pushRel(src, target, ASTEngine.RelationshipType.Uses, 0.7, { clojureSpecific: true, isFieldAccess: true, ...(activeFunction ? {} : { isTopLevel: true }) }, headNode ? headNode.startPosition.row + 1 : undefined, callArityOf(node))
          patterns["Java Interoperability"] = true
        }
        // ── CLJ-D32: STATIC interop `Class/.member` ─────────────────────────
        // A static member access is the same KIND of access as `(.method obj)` —
        // it names a member of a class — so it emits a `uses` edge, not a `calls`
        // edge to a name nobody defines. It used to fall through to the generic
        // call branch and produce `f -[calls]-> String/.toUpperCase`: an edge
        // whose target is not a symbol in the file, is not an export, and is not
        // in any `contains` — a dangling relationship, the one thing the "all
        // extracted, resolved and emitted" contract exists to prevent.
        //
        // It is invisible to F5 by construction, which is the lesson repeated
        // here: the `calls` truth derives calls, and the analyzer emitted a call,
        // so the two agreed perfectly on an edge that pointed at nothing. 23 real
        // sites across clojure's own test suite (param_tags 14, java_interop 3,
        // genclass 4, method_thunks 2) plus clj-kondo's java interop.
        //
        // TWO EDGES, because the static form carries one fact the instance form
        // does not: WHICH CLASS. `(.method obj)` gets the class from its receiver;
        // `String/.toUpperCase` names it in the head, so it is emitted as a
        // second `uses` edge with arity 0 (naming a class, not invoking it).
        // `(Integer/parseInt "1")` and `(Math/abs -1)` are unaffected — those are
        // the uncurried interop statics already declared in the core list, and
        // the suppression gate above still catches them by their whole head name.
        else if (staticInteropMember(formName) !== null) {
          const member = staticInteropMember(formName)!
          const clsName = staticInteropClass(formName)
          const src = activeFunction ? activeFunction.name : currentNamespace
          const headNode = executionHead(node)
          const line = headNode ? headNode.startPosition.row + 1 : undefined
          const topMeta = activeFunction ? {} : { isTopLevel: true }
          if (member) {
            pushRel(src, member, ASTEngine.RelationshipType.Uses, 0.7, { clojureSpecific: true, isFieldAccess: true, isStaticInterop: true, ...topMeta }, line, callArityOf(node))
          }
          if (clsName) {
            const clsNode = headNode
            pushRel(src, resolveQualified(clsName), ASTEngine.RelationshipType.Uses, 0.8, { clojureSpecific: true, isStaticInteropClass: true, ...topMeta }, clsNode ? clsNode.startPosition.row + 1 : undefined, 0)
          }
          patterns["Java Interoperability"] = true
        }
        // ── threading macros (CLJ-D10, adversarial F13) ─────────────────
        // Steps are INVOCATIONS: `(-> x foo bar)` emitted nothing and
        // `(-> x (f 1))` reported arity 1 while f is invoked with 2 (the
        // thread injects the value). Each step emits a calls edge with
        // THREAD-ADJUSTED arity (written args + 1); bare symbol steps emit
        // arity 1; builtin-headed steps follow the builtin policy (no call
        // edge, like every other builtin site — builtin tracking still runs
        // on them via the fall-through below). The step list is flagged so
        // its own walk does not re-emit the written arity; `as->` binds
        // explicitly ($ appears at each use site) and stays as-written.
        // `cond->`/`cond->>` children alternate test/step — tests are
        // ordinary expressions and walk normally.
        else if (formName === "->" || formName === "->>" || formName === "some->" || formName === "some->>" || formName === "cond->" || formName === "cond->>" || formName === "doto") {
          if (activeFunction) patterns["Threading Macros"] = true
          // CC1-c (CLJ-D16): a CONDITIONAL threader counts +1 — once, like
          // `cond` (its tests/steps are expressions, not clause nodes). Plain
          // `->`/`->>`/`doto` are not conditionals and do not count. This
          // branch intercepts before the COMPLEXITY_BUILTINS check below, so
          // the counting lives here.
          if ((formName === "cond->" || formName === "cond->>" || formName === "some->" || formName === "some->>") && activeFunction?.metadata) {
            activeFunction.metadata.complexity = (activeFunction.metadata.complexity || 1) + 1
            totalCyclomaticComplexity++
          }
          const isCond = formName === "cond->" || formName === "cond->>"
          const tSrc = activeFunction ? activeFunction.name : currentNamespace
          const tTop: Record<string, any> = activeFunction ? {} : { isTopLevel: true }
          for (let i = 2; i < node.namedChildCount; i++) {
            if (isCond && i % 2 === 0) continue // test position: walked normally
            const step = node.namedChild(i)
            if (!step) continue
            const emitStep = (hName: string, line: number, arity: number, bare: boolean, stepPos: number, alias = "") => {
              if (!hName || isCoreCallSuppressed(hName, stepPos) || hName.startsWith(".") || hName.startsWith("->") || hName.endsWith(".")) return
              // CLJ-D28: `hName` already carries its resolved namespace when the
              // caller read the head's fields, so `resolveQualified` is applied
              // only to the unqualified form.
              pushRel(tSrc, alias ? hName : resolveQualified(hName), ASTEngine.RelationshipType.Calls, 0.9, { clojureSpecific: true, isGeneralCall: true, isThreadedStep: true, ...(bare ? { isBareStep: true } : {}), ...tTop }, line, arity, stepPos)
              if (alias) {
                const resolvedNs = namespaceAliases[alias] || alias
                if (resolvedNs !== currentNamespace) pushRel(currentNamespace, resolvedNs, ASTEngine.RelationshipType.References, 0.8, { clojureSpecific: true, isLibraryDep: true }, line)
              }
            }
            if (step.type === "list_lit") {
              const h = executionHead(step)
              if (!h || h.type !== "sym_lit") continue
              // CLJ-D28: the qualified name comes from the head's FIELDS, so a
              // step whose own name contains a slash survives intact.
              const qh = resolveCallee(h, symName(h))
              emitStep(qh.alias ? qh.target : symName(h), h.startPosition.row + 1, callArityOf(step) + 1, false, h.startIndex, qh.alias)
              threadedSteps.add(step.startIndex)
            } else if (step.type === "sym_lit") {
              const qs = resolveCallee(step, symName(step))
              emitStep(qs.alias ? qs.target : symName(step), step.startPosition.row + 1, 1, true, step.startIndex, qs.alias)
            }
          }
        }
        // F13: a threading step already emitted its thread-adjusted call at
        // the macro site — skip its own head emission (builtin-headed steps
        // fall through to the builtin tracking below).
        else if (threadedSteps.has(node.startIndex) && formName && !isCoreCallSuppressed(formName, node.startIndex)) {
        }
        // ── generic function calls (non-builtin form symbols) ────────────
        // C8: calls OUTSIDE any function (def/defonce initializers, top-level
        // side effects) attribute to the namespace — the load-time context
        // that actually invokes them — instead of being dropped. The edge
        // carries isTopLevel so consumers can tell the contexts apart.
        else if (formName && !CLOJURE_SPECIAL_FORMS.has(formName) && !isCoreCallSuppressed(formName, headStartIndex(node))) {
          const src = activeFunction ? activeFunction.name : currentNamespace
          const topMeta: Record<string, any> = activeFunction ? {} : { isTopLevel: true }
          const headNode = executionHead(node)
          const line = headNode ? headNode.startPosition.row + 1 : undefined
          const arity = callArityOf(node)
          const q = resolveCallee(headNode, formName)   // CLJ-D28
          if (q.alias) {
            const resolvedNs = namespaceAliases[q.alias] || q.alias
            pushRel(src, q.target, ASTEngine.RelationshipType.Calls, 0.9, { clojureSpecific: true, isGeneralCall: true, ...topMeta }, line, arity, headStartIndex(node))
            // ELXD8 mirror: a self-qualified call (`corpus.invalid-arity.order/def`
            // inside that very namespace) is a lexical no-op as a dependency —
            // never a self-loop references edge (F5-cert).
            if (resolvedNs !== currentNamespace) pushRel(currentNamespace, resolvedNs, ASTEngine.RelationshipType.References, 0.8, { clojureSpecific: true, isLibraryDep: true }, line)
            if (q.name.endsWith("!") && activeFunction) activeFunction.metadata!.isPure = false
          } else {
            pushRel(src, formName, ASTEngine.RelationshipType.Calls, 0.9, { clojureSpecific: true, isGeneralCall: true, ...topMeta }, line, arity, headStartIndex(node))
            if (formName.endsWith("!") && activeFunction) activeFunction.metadata!.isPure = false
          }
        }
        // ── builtin/special forms: complexity + impurity tracking ────────
        else if (formName && activeFunction && activeFunction.metadata) {
          if (COMPLEXITY_BUILTINS[formName]) {
            activeFunction.metadata.complexity = (activeFunction.metadata.complexity || 1) + 1
            totalCyclomaticComplexity++
          }
          if (HOF_BUILTINS[formName]) {
            activeFunction.metadata.isHigherOrder = true
            patterns["Higher-Order Functions"] = true
          }
          if (STM_BUILTINS[formName]) {
            activeFunction.metadata.usesSTM = true
            patterns["Software Transactional Memory"] = true
          }
          if (IMPURE_BUILTINS[formName] || formName.endsWith("!") || formName.startsWith(".") || formName.endsWith(".")) {
            activeFunction.metadata.isPure = false
          }
          // CLJ-D42: `recur` IS NOT A CALL, AND A `calls` EDGE FROM A SYMBOL TO
          // ITSELF IS NOT A CALL AT ALL.
          //
          // This used to push `calls: activeFunction -> activeFunction` with
          // `isRecursion: true`, which manufactured 18 edges in clojure/core.clj
          // alone - every one of them `lambda_83_6 -> lambda_83_6` on a line whose
          // head is `(recur …)`. Three separate reasons make it wrong:
          //
          //   1. `recur` is a SPECIAL FORM. It transfers control to the enclosing
          //      `fn`/`loop`; it names no var and invokes nothing. This is the same
          //      ruling as CLJ-D41, and the analyzer already half-believed it -
          //      `recur` is in the derived core list at :97, so the suppression gate
          //      has the information to stay silent and this line overrode it.
          //   2. THE TARGET IS NOT NAVIGABLE. `lambda_83_6` is a GENERATED name for
          //      an anonymous function, an internal artifact of the walk rather
          //      than anything a reader of the graph can reach. A relationship whose
          //      target is an implementation detail is a claim the graph cannot
          //      honour.
          //   3. IT IS NOT A CALL. The fact being recorded - "this function
          //      recurses" - is real, and `metadata.isRecursive` on the enclosing
          //      symbol already records it, which is the right home for it. An
          //      edge from a symbol to itself duplicated that fact in the one
          //      relationship type every consumer reads as invocation, which is how
          //      18 fabrications reached a differential gate that was measuring 0
          //      defects at the time.
          //
          // Nothing reads `isRecursive` today. That is a separate finding - a dead
          // capability claim - and it is left visible rather than papered over here.
          if (formName === "recur") {
            activeFunction.metadata.isRecursive = true
          } else if (formName === activeFunction.name) {
            activeFunction.metadata.isRecursive = true
          }
          if (formName === "lazy-seq") patterns["Lazy Evaluation"] = true
        }
      }

      // F7 (adversarial): `(case e (a b) :r …)` — a LIST in a constant
      // position is a GROUP of unevaluated constants, not an invocation
      // (`calls a` was fabricated from it). Result positions and the expr
      // still walk; only list constants are skipped. Same positions in the
      // F5 oracle.
      // W23 (review finding, measured): the optional trailing DEFAULT sits at
      // index N-1 — an EVEN index whenever present — so a LIST-shaped default
      // was skipped by the same parity rule and its calls silently vanished
      // from BOTH sides (mirrored — no gate could see it). The default is
      // always the last child (children = [case, expr, test…, expr…,
      // default?]): never skip it.
      //
      // CLJ-D36: THE PARITY IS COMPUTED OVER EXECUTABLE CHILDREN ONLY. A
      // `comment` node is a named child, so one comment inside a `case` shifts
      // every later index by one — and then a BODY lands on an even index and is
      // skipped as if it were a constant, taking every relationship inside it
      // with it. metabase/dev/src/dev/kondo_ratchet.clj:343 is the proof: its
      // `case` has 10 named children because of one `;;` comment at index 6, so
      // index 8 — `(do (when … (.charAt sb (inc i)) …))`, a real body — was
      // dropped, and the `uses` edges for `.charAt` and `.setCharAt` at 348-349
      // vanished from the graph. Two edges in one file is a small loss; the rule
      // is wrong for every `case` in every corpus that has a comment in one,
      // and it is invisible because the mirror had the same bug — the two
      // agreed on a body that neither walked.
      //
      // So the executable positions are computed first, over children that are
      // not comments and not discards, and the parity is read off THAT list. A
      // comment is not a test and not an expression; it is not a position at
      // all, and letting it occupy one is what broke the count.
      const isCaseForm = node.type === "list_lit" && formNameOf(node) === "case"
      let caseSkip: Set<number> | null = null
      if (isCaseForm) {
        // children = [case, expr, test…, expr…, default?] — the default is
        // present iff the executable count is odd, and is never a constant.
        const exec: number[] = []
        for (let i = 0; i < node.namedChildCount; i++) {
          const c = node.namedChild(i)
          if (!c || c.type === "comment" || c.type === "dis_expr") continue
          exec.push(i)
        }
        const hasDefault = exec.length % 2 === 1
        const defaultIdx = hasDefault ? exec[exec.length - 1]! : -1
        caseSkip = new Set<number>()
        // position 0 is `case`, 1 is the expr; from 2 the constants are at
        // even POSITIONS (index 2, 4, 6 … in the executable list).
        for (let pos = 2; pos < exec.length; pos += 2) {
          const childIdx = exec[pos]!
          if (childIdx === defaultIdx) continue
          const c = node.namedChild(childIdx)
          if (c && c.type === "list_lit") caseSkip.add(childIdx)
        }
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (!child) continue
        if (caseSkip !== null && caseSkip.has(i)) continue
        walkStack.push({ node: child, isExit: false, previousActiveFunction: null as any, quoteDepth })
      }
    }

    // ── CLJ-D34: the IMPLICIT namespace is still a namespace ───────────────
    // A Clojure file with no `ns`/`in-ns` form is evaluated in the ambient
    // namespace, and `user` is its conventional name. Representing that is
    // strictly more complete than not: without a namespace symbol the harness's
    // export invariant could not tell that `undeclared-fn` belongs to a
    // namespace at all, and reported a perfectly ordinary top-level definition
    // as an unresolvable export. The module symbol carries the file's first line
    // — the namespace exists from the top of the file, which is exactly what
    // "ambient" means.
    if (!sawNamespaceForm) {
      const implicitNs: ASTEngine.UniversalSymbol = {
        name: currentNamespace,
        kind: ASTEngine.SymbolKind.Module,
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1, startIndex: 0, endIndex: 0 },
        scope: "",
        visibility: "public",
        metadata: { clojureSpecific: true, isImplicitNamespace: true },
      }
      symbols.push(implicitNs)
      exports.push({ name: currentNamespace, kind: ASTEngine.SymbolKind.Module, range: implicitNs.range, visibility: "public" })
    }

    // ── Post-loop: contains for owned symbols ─────────────────────────────
    // Every symbol carries ownerName (namespace for top-level forms, protocol
    // for protocol methods, record for fields/methods). Emit one contains per
    // (owner, symbol) pair; the identity dedup in the harness collapses
    // overloads and repeated forms with identical identity.
    //
    // CLJ-D33: WHICH SYMBOL THE EDGE POINTS AT IS NOW DETERMINISTIC. It used to
    // be "whichever the walk pushed first", and push order is not source order —
    // a protocol's methods are symbolized when the protocol is met, a record's
    // when the record is, so a name with two symbols could land on the later
    // declaration. 667 edges across the three corpora were affected.
    //
    // The rule is two-part, and BOTH parts were measured:
    //
    // 1. PREFER A REAL DEFINITION OVER A NON-DEFINITION. Two things in this table
    //    announce a name without defining it:
    //
    //    A FORWARD DECLARATION — `(declare HEADER)` at gen_math.clj:16 then
    //    `(def ^String HEADER …)` at 119. The edge pointed at 16, claiming the
    //    namespace defines `HEADER` where it only promises to. A `contains` edge
    //    says "this owner has this member", and the line is where a reader goes
    //    to find it — so it must be the definition. The forward-declaration
    //    SYMBOL is still published (CLJ-D23: the graph needs a node for the call
    //    target, and `declare` skips core names entirely); only the EDGE moves.
    //
    //    A SPEC ANNOTATION — `(s/fdef my-inc …)` at clj-kondo
    //    corpus/spec_syntax.clj:6 then `(defn my-inc [x] …)` at 13. Same shape,
    //    same consequence: the edge pointed at the spec, which annotates a var
    //    rather than defining it.
    //
    // 2. AMONG CANDIDATES, THE EARLIEST DECLARATION LINE. Source order, not push
    //    order — so the same input always yields the same edge, which is what
    //    makes the class auditable at all.
    const isDefinition = (s: ASTEngine.UniversalSymbol): boolean =>
      s.metadata?.isForwardDeclaration !== true && s.metadata?.isSpec !== true
    const containsPick = new Map<string, ASTEngine.UniversalSymbol>()
    for (const s of symbols) {
      const _owner = s.ownerName
      // Anonymous functions are locals — no namespace-contains edge.
      //
      // CLJ-D34: `user` IS AN ORDINARY NAMESPACE, in both the explicit and the
      // implicit case. The skip this replaces existed so a file with no `ns` form
      // would not claim a `user` namespace it never declared — but that is
      // exactly what Clojure does: `(defn f …)` in a file with no `ns` form
      // interns `f` into the ambient namespace, and `user` is the conventional
      // name for it.
      //
      // A fixture pair is what settled it, in the direction OPPOSITE to the one
      // this comment originally argued. Treating a fallback `user` as a
      // non-namespace published the SYMBOL but withheld its `contains`, and the
      // export pass's own invariant then fired: "export `undeclared-fn` does not
      // resolve to a top-level symbol (membership rides Contains)". Withholding
      // the membership while keeping the export is the one option that cannot be
      // made consistent, because the two must agree. `(in-ns 'user)` at
      // clojure/core/server.clj:169 declares one explicitly and the eight
      // definitions after it belong to it — 36 containment edges were being lost
      // there — and the implicit case now behaves the same way, which is both
      // simpler and true.
      if (!_owner || s.metadata?.isAnonymous) continue
      const key = `${_owner}->${s.name}`
      const prev = containsPick.get(key)
      if (prev === undefined) { containsPick.set(key, s); continue }
      // A definition always displaces a non-definition.
      if (!isDefinition(prev) && isDefinition(s)) { containsPick.set(key, s); continue }
      if (isDefinition(prev) && !isDefinition(s)) continue
      // Otherwise the earliest declaration line wins.
      if (s.range.startLine < prev.range.startLine) containsPick.set(key, s)
    }
    for (const s of containsPick.values()) {
      // M59 (#825): the contains edge carries the owned symbol's own
      // declaration line (erlang parity) — never 0.
      pushRel(s.ownerName!, s.name, ASTEngine.RelationshipType.Contains, 1.0, {}, s.range.startLine)
    }

    // ── exports (ns-level public symbols) ─────────────────────────────────
    const exportedKinds = new Set([
      ASTEngine.SymbolKind.Function, ASTEngine.SymbolKind.Variable,
      ASTEngine.SymbolKind.Class, ASTEngine.SymbolKind.Interface, ASTEngine.SymbolKind.Module,
    ])
    const seenExports = new Set<string>()
    const finalExports: ASTEngine.ExportInfo[] = []
    // CLJ-D38: A SPEC ANNOTATION IS NOT A SECOND PUBLIC ENTITY.
    //
    // `(s/fdef my-inc :args …)` then `(defn my-inc [x] …)` produced TWO exports
    // named `my-inc` — one Interface (the spec) and one Function (the var) —
    // because the dedupe key is `name|kind`, and the two differ in kind. The
    // export pass's duplicate-name invariant caught it, and the invariant is
    // right: a namespace exports each name ONCE. A spec annotates a var; it
    // does not introduce a second thing to export.
    //
    // But a spec is a public entity in its own right when nothing else claims
    // the name — `(s/def ::email :string?)` and `(s/def my-spec :int?)` have no
    // `defn` at all, and those exports must stay. So the rule is exactly the one
    // `contains` uses (CLJ-D33): a real definition displaces the annotation, and
    // an annotation with no definition stands on its own.
    const definedNames = new Set<string>()
    for (const s of symbols) {
      if (s.metadata?.isForwardDeclaration) continue
      if (s.metadata?.isSpec) continue
      definedNames.add(s.name)
    }
    for (const s of symbols) {
      const isNSLevel = !s.scope || s.scope === currentNamespace || (s.ownerName === currentNamespace)
      // CLJ-D23: a `(declare …)` var is public in its namespace but NOT defined
      // here, so it is not an export of this file. Without the exclusion the
      // declared name and the real `defn` of the same name are two public
      // Variables with one name, and the export pass's duplicate-name
      // invariant fires — the fixture caught exactly that.
      if (s.metadata?.isForwardDeclaration) continue
      if (s.metadata?.isSpec && definedNames.has(s.name)) continue
      if (isNSLevel && s.visibility === "public" && exportedKinds.has(s.kind)) {
        const key = `${s.name}|${s.kind}`
        if (seenExports.has(key)) continue
        seenExports.add(key)
        finalExports.push({ name: s.name, kind: s.kind, range: s.range, visibility: s.visibility })
      }
    }
    for (const e of exports) {
      const key = `${e.name}|${e.kind}`
      if (seenExports.has(key)) continue
      seenExports.add(key)
      finalExports.push(e)
    }
    exports.length = 0
    exports.push(...finalExports)

    let pureCount = 0
    let funcCount = 0
    for (let _i = 0; _i < symbols.length; _i++) {
      const s = symbols[_i]
      if (s.kind === ASTEngine.SymbolKind.Function && !s.metadata?.isMultimethod) {
        funcCount++
        if (s.metadata?.isPure) pureCount++
      }
    }
    const immutabilityScore = funcCount > 0 ? Math.round((pureCount / funcCount) * 100) : 0

    const patternsArray: string[] = []
    for (const p in patterns) patternsArray.push(p)
    const frameworksArray: string[] = []
    for (const f in frameworks) frameworksArray.push(f)

    let score = 50 + (immutabilityScore * 0.3)
    if (!!patterns["Metaprogramming"]) score += 10
    if (!!patterns["Protocol-based Polymorphism"]) score += 10
    if (!!patterns["Software Transactional Memory"]) score += 5
    if (!!patterns["Immutable Data Structures"]) score += 5

    // C6: the pre-fix fallback claimed complexity equal to the SYMBOL count
    // (vars, protocols, records included — fabricated payload). The honest
    // convention: a file with no decision points reports the function
    // baseline — one per function — never a number invented from unrelated
    // symbols; a file with neither functions nor decisions reports 1 below.
    if (totalCyclomaticComplexity === 0) totalCyclomaticComplexity = funcCount

    // W24-mr2 (review CLJ-MR2, the ELXD17 sibling): a bare call whose name is
    // a `:refer` — `(:require [lib :refer [name]])` — is a CONFIRMED
    // dependency; resolve the target to `lib/name` in a POST-WALK pass so
    // order plays no role and a LOCAL definition of the same name wins
    // (Clojure's ns mapping: locals shadow refers). The elixir lane's
    // declared-set post-pass is the same shape.
    {
      const localDecls = new Set<string>()
      for (const s of symbols) {
        if (s.kind === ASTEngine.SymbolKind.Function || s.kind === ASTEngine.SymbolKind.Macro || s.kind === ASTEngine.SymbolKind.Variable) localDecls.add(s.name)
      }
      for (let i = 0; i < relationships.length; i++) {
        const r = relationships[i]!
        if (r.type !== ASTEngine.RelationshipType.Calls) continue
        if (typeof r.target !== "string" || r.target.indexOf("/") !== -1 || r.target.indexOf(".") !== -1) continue
        if (localDecls.has(r.target)) continue
        // CLJ-D24: resolve against the refer table OF THE NAMESPACE THIS CALL
        // SITS IN, not whatever the last `ns` form left behind.
        const lib = referAt(r.target, relOrigins.get(i) ?? 0)
        if (lib) r.target = `${lib}/${r.target}`
      }
      // The rewrite can collide with an already-qualified edge; re-dedupe
      // with pushRel's own identity (source|type|target|callArity|line).
      const seenFinal = new Set<string>()
      for (let i = relationships.length - 1; i >= 0; i--) {
        const r = relationships[i]!
        const key = `${r.source}|${r.type}|${r.target}|${(r.metadata as any)?.callArity ?? ""}|${r.line_number ?? ""}`
        if (seenFinal.has(key)) relationships.splice(i, 1)
        else seenFinal.add(key)
      }
    }

    // CC1-f (elixir-parity, the ELXD15 shape): per-symbol complexity exposure —
    // functions/macros mirror the walk's metadata.complexity so consumers and
    // fixtures can pin the decision baseline per symbol, not only the file
    // total. Additive for clojure (nothing read the field before); pinned by
    // fixture complexity-forms.
    for (const s of symbols) {
      const cx = (s.metadata as any)?.complexity
      if (typeof cx === "number" && s.complexity === undefined) s.complexity = cx
    }

    return {
      language: "clojure",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        complexity: symbols.length + relationships.length || 1,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: totalCyclomaticComplexity || 1,
        framework: frameworksArray[0],
        patterns: patternsArray,
        detectedFrameworks: frameworksArray,
        frameworkPatterns: frameworksArray.length > 0 ? [{ framework: frameworksArray[0], patterns: patternsArray }] : [],
        architecturalInsights: [],
        architecturalScore: Math.min(100, Math.round(score)),
        codeQuality: score >= 80 ? "Excellent" : score >= 60 ? "Good" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        immutabilityScore,
        concurrencyComplexity: !!patterns["Software Transactional Memory"] ? 1 : 0,
        replDrivenScore: !!patterns["REPL-driven Development"] ? 100 : 0,
        analysisVersion: "6.0-clojure-yogthos-grammar-pure-ast-single-pass"
      }
    }
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
