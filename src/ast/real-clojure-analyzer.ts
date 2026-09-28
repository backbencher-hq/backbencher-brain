import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

// CLJ1-session: exported so the F5 differential's independent clojure oracle
// shares the LANGUAGE FACT (which symbols are core builtins) by import — the
// php/ruby/python import precedent in differential.ts. Rule drift between the
// two sides is what the differential exists to catch; a 450-entry name list
// is a transcription hazard, not a rule.
export const CLOJURE_CORE_BUILTINS = (function(){ const r: Record<string, boolean> = Object.create(null); const arr = [
  "if", "let", "def", "defn", "defn-", "fn", "loop", "recur", "quote", "var", "do", "try", "catch", "finally", "throw", "monitor-enter", "monitor-exit", "new", ".", "set!", "+", "-", "*", "/", "=", "not=", "<", "<=", ">", ">=", "and", "or", "not", "println", "print", "str", "concat", "map", "reduce", "filter", "remove", "into", "assoc", "dissoc", "get", "update", "merge", "keys", "vals", "first", "rest", "next", "last", "cons", "conj", "apply", "comp", "partial", "inc", "dec", "zero?", "empty?", "nil?", "when", "when-not", "when-let", "if-let", "if-not", "cond", "case", "for", "doseq", "dotimes", "->", "->>", "as->", "cond->", "cond->>", "some->", "some->>", "swap!", "reset!", "deref", "alter", "commute", "dosync", "ref", "atom", "agent", "send", "send-off", "future", "promise", "deliver", "defrecord", "defprotocol", "definterface", "defmulti", "defmethod", "ns", "require", "import", "use", "refer", "comment", "deftest", "is", "testing", "list", "vector", "hash-map", "set", "vec", "seq", "count", "nth", "assoc-in", "update-in", "get-in", "select-keys", "merge-with", "zipmap", "sort", "sort-by", "reverse", "group-by", "frequencies", "distinct", "take", "drop", "take-while", "drop-while", "split-at", "partition", "interleave", "interpose", "flatten", "keep", "mapv", "filterv", "reduce-kv", "into-array", "to-array", "bean", "array-map", "sorted-map", "sorted-set", "subvec", "peek", "pop", "disj", "contains?", "find", "keys", "rseq", "range", "iterate", "repeat", "repeatedly", "cycle", "sequence", "every?", "some", "not-any?", "not-every?", "identity", "constantly", "juxt", "fnil", "memoize", "trampoline", "lazy-seq", "lazy-cat", "defonce", "defmacro", "defstruct", "declare", "binding", "with-bindings", "with-open", "with-local-vars", "time", "assert", "identical?", "instance?", "extends?", "satisfies?", "reify", "proxy", "gen-class", "gen-interface", "extend", "extend-type", "extend-protocol", "proxy-super", "doto", "..", ".", "..", "->", "->>", "amap", "areduce", "aset", "aget", "alength", "aclone", "int-array", "long-array", "double-array", "object-array", "make-array", "char", "int", "long", "double", "float", "boolean", "short", "byte", "bigint", "bigdec", "num", "string?", "keyword?", "symbol?", "number?", "seq?", "vector?", "map?", "set?", "fn?", "ifn?", "coll?", "sequential?", "associative?", "counted?", "indexed?", "reversible?", "sorted?", "namespace", "name", "keyword", "symbol", "str", "subs", "char-array", "upper-case", "lower-case", "trim", "triml", "trimr", "trim-newline", "split", "join", "replace", "re-seq", "re-find", "re-matches", "re-pattern", "re-groups", "format", "printf", "pr", "prn", "pr-str", "prn-str", "print-str", "println-str", "newline", "flush", "read", "read-line", "read-string", "slurp", "spit", "load-string", "load-file", "require", "use", "import", "refer-clojure", "in-ns", "alias", "ns-unmap", "ns-resolve", "resolve", "find-var", "var-get", "var-set", "bound?", "thread-bound?", "alter-var-root", "with-redefs", "with-redefs-fn", "future-call", "future-cancel", "future-cancelled?", "future-done?", "future?", "pmap", "pcalls", "pvalues", "delay", "force", "realized?", "when-first", "when-some", "if-some", "some->", "some->>", "condp", "while", "doseq", "dotimes", "binding", "sync", "io!", "vswap!", "swap-vals!", "reset-vals!", "compare-and-set!", "add-watch", "remove-watch", "set-validator!", "get-validator", "send-via", "await", "await-for", "shutdown-agents", "release-pending-sends", "ensure", "ref-set", "alter", "commute", "dosync", "io!", "min-key", "max-key", "compare", "equiv", "hash", "hash-combine", "sort-by", "comparator", "rand", "rand-int", "rand-nth", "random-sample", "boolean?", "true?", "false?", "nil?", "not", "not=", "identical?", "class", "type", "instance?", "isa?", "parents", "ancestors", "descendants", "derive", "underive", "make-hierarchy", "global-hierarchy", "rationalize", "numerator", "denominator", "int?", "integer?", "even?", "odd?", "pos?", "neg?", "zero?", "nat-int?", "int?", "float?", "double?", "ratio?", "decimal?", "byte?", "short?", "char?", "string?", "keyword?", "symbol?", "uuid?", "uri?", "regexp?", "fn?", "ifn?", "var?", "delayed?", "atom?", "ref?", "agent?", "future?", "promise?", "seqable?", "sequential?", "vector?", "map?", "set?", "list?", "seq?", "coll?", "counted?", "indexed?", "associative?", "reversible?", "sorted?", "unchecked-add", "unchecked-subtract", "unchecked-multiply", "unchecked-divide", "unchecked-inc", "unchecked-dec", "unchecked-negate", "unchecked-remainder", "unchecked-add-int", "unchecked-subtract-int", "unchecked-multiply-int", "unchecked-divide-int", "unchecked-inc-int", "unchecked-dec-int", "unchecked-negate-int", "unchecked-remainder-int", "bit-and", "bit-or", "bit-xor", "bit-not", "bit-shift-left", "bit-shift-right", "bit-and-not", "bit-clear", "bit-set", "bit-flip", "bit-test", "shift-left", "shift-right", "unsigned-bit-shift-right", "bit-count", "Integer/parseInt", "Long/parseLong", "Double/parseDouble", "Math/abs", "Math/max", "Math/min", "Math/round", "Math/floor", "Math/ceil", "Math/sqrt", "Math/pow", "Math/random", "String/valueOf", "String/format", "String/join", "String/split", "System/currentTimeMillis", "System/nanoTime", "System/getProperty", "System/exit", "System/gc", "Thread/sleep", "Thread/currentThread", "UUID/randomUUID", "java.util.Date", "char", "code-char", "symbol", "keyword", "gensym", "unquote", "unquote-splicing", "syntax-quote", "deliver", "promise", "not-empty", "empty", "list*", "cons", "concat", "lazy-seq", "when-let", "if-let", "when-some", "if-some", "when-first", "while", "loop", "recur", "letfn", "defn-", "defmacro", "defmulti", "defmethod", "defprotocol", "defrecord", "deftype", "defstruct", "ns", "in-ns", "require", "use", "import", "refer", "alias", "comment", "declare", "def", "defonce", "binding", "with-bindings", "with-open", "with-local-vars", "time", "assert", "identical?", "instance?", "extends?", "satisfies?", "reify", "proxy", "gen-class", "gen-interface", "extend", "extend-type", "extend-protocol", "proxy-super", "doto", "..", ".", "amap", "areduce", "aset", "aget", "alength", "aclone", "int-array", "long-array", "double-array", "object-array", "make-array"
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
    // F3 (adversarial review): Object.create(null) — the SAME prototype-
    // pollution class as F5-2, missed on this record: a plain `{}` alias
    // table answered `["toString"]` with the inherited function, so
    // `(toString/f …)` under `[x :as toString]` emitted the garbage target
    // `"function toString() { [native code] }/f"` (and the oracle's Map
    // emitted the honest `toString/f` — a latent MISSING/unexplained pair).
    let namespaceAliases: Record<string, string> = Object.create(null)
    // W24-mr2: `:refer`-ed names (ns `:refer [a b]` / top-level require) — a
    // CONFIRMED call target, resolved to its source lib (last libspec wins).
    const refers: Record<string, string> = Object.create(null)
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
    const pushRel = (
      source: string,
      target: string,
      type: ASTEngine.RelationshipType,
      confidence: number,
      metadata: Record<string, any> = {},
      line?: number,
      callArity?: number,
    ) => {
      const key = `${source}|${type}|${target}|${callArity ?? ""}|${line ?? ""}`
      if (seenRelKeys.has(key)) return
      seenRelKeys.add(key)
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
            } else if (kw === "refer" && k + 1 < spec.namedChildCount) {
              const refVec = spec.namedChild(k + 1)
              if (refVec && refVec.type === "vec_lit") {
                for (let r = 0; r < refVec.namedChildCount; r++) {
                  const rn = refVec.namedChild(r)
                  if (rn && rn.type === "sym_lit") referNames.push(symName(rn))
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
        if (referNames.length > 0 && libName) for (const rn of referNames) refers[rn] = libName
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

    // W23-b (M49 W24): the shadow is REGIONAL and ORDER-AWARE. The old flat
    // flag (any definition anywhere, order-blind) flipped every `(comment …)`
    // body in the file to code-walking — fabricating calls from data blocks
    // the macro still owns. Ranges now: a def-family NAME binds the var at
    // the FORM'S END (order-aware, live from there on); a binding vector
    // scopes to its ENCLOSING form (params/let bindings are visible only
    // inside it — a multi-arity clause's param covers that clause alone).
    const shadowRanges: Array<{ start: number; end: number }> = []
    const DEF_NAME_HEADS: Record<string, boolean> = Object.create(null)
    for (const h of ["def", "defn", "defn-", "defmacro", "defonce", "defmulti"]) DEF_NAME_HEADS[h] = true
    const BINDING_VEC_HEADS: Record<string, boolean> = Object.create(null)
    for (const h of ["let", "let*", "loop", "loop*", "when-let", "if-let", "when-some", "if-some", "when-first", "binding", "for", "doseq", "dotimes", "with-open", "with-local-vars", "with-bindings", "letfn"]) BINDING_VEC_HEADS[h] = true
    const FN_PARAM_HEADS: Record<string, boolean> = Object.create(null)
    for (const h of ["fn", "defn", "defn-", "defmacro", "defmethod", "deftest"]) FN_PARAM_HEADS[h] = true
    const shadowRangeOf = (candidate: Node): { start: number; end: number } | null => {
      const parent = candidate.parent
      if (!parent) return null
      if (parent.type === "list_lit") {
        // `(def comment …)`-family: the var binds when the form completes —
        // a `(comment …)` inside this form's own init is still the macro.
        const head = formNameOf(parent)
        if (DEF_NAME_HEADS[head] && parent.namedChild(1)?.startIndex === candidate.startIndex) {
          return { start: parent.endIndex, end: Infinity }
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
              return { start: letfnForm.startIndex, end: letfnForm.endIndex }
            }
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
            if (c?.type === "vec_lit") return c.startIndex === parent.startIndex ? { start: gp.startIndex, end: gp.endIndex } : null
          }
          return null
        }
        if (BINDING_VEC_HEADS[head] && gp.namedChild(1)?.startIndex === parent.startIndex) {
          return { start: gp.startIndex, end: gp.endIndex }
        }
        // Multi-arity clause: the vec is the FIRST named child of a list
        // whose parent is a fn/defn form — the param covers that clause.
        if (gp.namedChild(0)?.startIndex === parent.startIndex) {
          const ggp = gp.parent
          if (ggp && ggp.type === "list_lit" && FN_PARAM_HEADS[formNameOf(ggp)]) {
            return { start: gp.startIndex, end: gp.endIndex }
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
              return { start: gp.startIndex, end: gp.endIndex }
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
      if (candidate.type === "sym_lit" && symName(candidate) === "comment") {
        const range = shadowRangeOf(candidate)
        if (range) shadowRanges.push(range)
      }
      for (let i = 0; i < candidate.namedChildCount; i++) {
        const child = candidate.namedChild(i)
        if (child) bindingStack.push(child)
      }
    }
    const isShadowedAt = (pos: number): boolean => {
      for (const r of shadowRanges) if (pos >= r.start && pos < r.end) return true
      return false
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
      if (node.type === "list_lit" && node.parent?.type === "list_lit") {
        // C7/C8 seam guard: the direct list children of a LIBSPEC site are
        // DATA — `(java.util Date)` in `(:import …)` names a package plus
        // classes, it is never a call. The ns-clause and top-level directive
        // branches consume the spec through handleLibNode; without this guard
        // the C8 top-level attribution fabricates `ns -[calls]-> java.util`
        // (caught by the M12 differential as a false positive). Clause
        // parents are kwd-headed (`(:require …)`) — clauseNameOf; directive
        // parents are sym-headed — formNameOf.
        const pf = clauseNameOf(node.parent) || formNameOf(node.parent)
        if (pf === "require" || pf === "use" || pf === "import" || pf === "refer" || pf === "refer-clojure") continue
      }
      if (node.type === "list_lit") {
        const form = formNameOf(node)
        // F10 (adversarial): the data-form skip is SPELLING-independent —
        // `clojure.core/quote` and an aliased `c/comment` (`[clojure.core :as
        // c]`) walked their bodies as code before this canonicalisation.
        const canon = resolveQualified(form)
        if (canon === "quote" || canon === "clojure.core/quote" || canon === "clojure.core/comment" || (canon === "comment" && !isShadowedAt(node.startIndex))) continue
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
          if (hName && !/^%(\d+|&)?$/.test(hName) && !CLOJURE_CORE_BUILTINS[hName]) {
            const line = anonHead.startPosition.row + 1
            const arity = Math.max(0, node.namedChildCount - 1)
            if (hName.includes("/")) {
              const [alias, func] = hName.split("/")
              const resolvedNs = namespaceAliases[alias] || alias
              pushRel(name, `${resolvedNs}/${func}`, ASTEngine.RelationshipType.Calls, 0.9, { clojureSpecific: true, isGeneralCall: true, isAnonShorthand: true }, line, arity)
              if (resolvedNs !== currentNamespace) pushRel(currentNamespace, resolvedNs, ASTEngine.RelationshipType.References, 0.8, { clojureSpecific: true, isLibraryDep: true }, line)
            } else {
              pushRel(name, hName, ASTEngine.RelationshipType.Calls, 0.9, { clojureSpecific: true, isGeneralCall: true, isAnonShorthand: true }, line, arity)
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
        else if (formName === "ns") {
          const nsName = symName(node.namedChild(1))
          if (nsName) currentNamespace = nsName
          // F3: null-prototype reset (see the declaration).
          namespaceAliases = Object.create(null)
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
          const protoSym: ASTEngine.UniversalSymbol = {
            name, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            metadata: { clojureSpecific: true, isProtocol: true }
          }
          symbols.push(protoSym)
          attachDocs(protoSym, node, "always")
          patterns["Protocol-based Polymorphism"] = true
          exports.push({ name, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node), visibility: "public" })
          // protocol method signatures: (method-name [this arg ...])
          for (let i = 2; i < node.namedChildCount; i++) {
            const m = node.namedChild(i)
            if (!m || m.type !== "list_lit") continue
            const mName = symName(m.namedChild(0))
            if (!mName || CLOJURE_CORE_BUILTINS[mName]) continue
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
          const ifaceSym: ASTEngine.UniversalSymbol = {
            name, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            metadata: { clojureSpecific: true, isInterface: true }
          }
          symbols.push(ifaceSym)
          attachDocs(ifaceSym, node, "always")
          exports.push({ name, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node), visibility: "public" })
          for (let i = 2; i < node.namedChildCount; i++) {
            const m = node.namedChild(i)
            if (!m || m.type !== "list_lit") continue
            const mName = symName(m.namedChild(0))
            if (!mName || CLOJURE_CORE_BUILTINS[mName]) continue
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
          const classSym: ASTEngine.UniversalSymbol = {
            name, kind: ASTEngine.SymbolKind.Class, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            metadata: { clojureSpecific: true, isRecord: formName === "defrecord", isType: formName === "deftype" }
          }
          symbols.push(classSym)
          attachDocs(classSym, node, "always")
          exports.push({ name, kind: ASTEngine.SymbolKind.Class, range: this.nodeToRange(node), visibility: "public" })

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
        // ── spec forms ───────────────────────────────────────────────────
        else if ((formName === "s/def" || formName === "s/fdef" || formName === "clojure.spec.alpha/def" || formName === "clojure.spec.alpha/fdef") && node.namedChild(1)) {
          const child = node.namedChild(1)!
          symbols.push({
            name: symName(child), kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            metadata: { isSpec: true, clojureSpecific: true },
          })
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
            const mName = symName(node.namedChild(0))
            if (mName && !CLOJURE_CORE_BUILTINS[mName]) {
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
          const fName = symName(node.namedChild(0))
          if (fName && !CLOJURE_CORE_BUILTINS[fName]) {
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
            const emitStep = (hName: string, line: number, arity: number, bare: boolean) => {
              if (!hName || CLOJURE_CORE_BUILTINS[hName] || hName.startsWith(".") || hName.startsWith("->") || hName.endsWith(".")) return
              pushRel(tSrc, resolveQualified(hName), ASTEngine.RelationshipType.Calls, 0.9, { clojureSpecific: true, isGeneralCall: true, isThreadedStep: true, ...(bare ? { isBareStep: true } : {}), ...tTop }, line, arity)
              if (hName.includes("/")) {
                const [alias] = hName.split("/")
                const resolvedNs = namespaceAliases[alias] || alias
                if (resolvedNs !== currentNamespace) pushRel(currentNamespace, resolvedNs, ASTEngine.RelationshipType.References, 0.8, { clojureSpecific: true, isLibraryDep: true }, line)
              }
            }
            if (step.type === "list_lit") {
              const h = executionHead(step)
              if (!h || h.type !== "sym_lit") continue
              emitStep(symName(h), h.startPosition.row + 1, callArityOf(step) + 1, false)
              threadedSteps.add(step.startIndex)
            } else if (step.type === "sym_lit") {
              emitStep(symName(step), step.startPosition.row + 1, 1, true)
            }
          }
        }
        // F13: a threading step already emitted its thread-adjusted call at
        // the macro site — skip its own head emission (builtin-headed steps
        // fall through to the builtin tracking below).
        else if (threadedSteps.has(node.startIndex) && formName && !CLOJURE_CORE_BUILTINS[formName]) {
        }
        // ── generic function calls (non-builtin form symbols) ────────────
        // C8: calls OUTSIDE any function (def/defonce initializers, top-level
        // side effects) attribute to the namespace — the load-time context
        // that actually invokes them — instead of being dropped. The edge
        // carries isTopLevel so consumers can tell the contexts apart.
        else if (formName && !CLOJURE_CORE_BUILTINS[formName]) {
          const src = activeFunction ? activeFunction.name : currentNamespace
          const topMeta: Record<string, any> = activeFunction ? {} : { isTopLevel: true }
          const headNode = executionHead(node)
          const line = headNode ? headNode.startPosition.row + 1 : undefined
          const arity = callArityOf(node)
          const qualified = formName.includes("/")
          if (qualified) {
            const [alias, func] = formName.split("/")
            const resolvedNs = namespaceAliases[alias] || alias
            pushRel(src, `${resolvedNs}/${func}`, ASTEngine.RelationshipType.Calls, 0.9, { clojureSpecific: true, isGeneralCall: true, ...topMeta }, line, arity)
            // ELXD8 mirror: a self-qualified call (`corpus.invalid-arity.order/def`
            // inside that very namespace) is a lexical no-op as a dependency —
            // never a self-loop references edge (F5-cert).
            if (resolvedNs !== currentNamespace) pushRel(currentNamespace, resolvedNs, ASTEngine.RelationshipType.References, 0.8, { clojureSpecific: true, isLibraryDep: true }, line)
            if (func.endsWith("!") && activeFunction) activeFunction.metadata!.isPure = false
          } else {
            pushRel(src, formName, ASTEngine.RelationshipType.Calls, 0.9, { clojureSpecific: true, isGeneralCall: true, ...topMeta }, line, arity)
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
          if (formName === "recur") {
            const recurHead = executionHead(node)
            pushRel(activeFunction.name, activeFunction.name, ASTEngine.RelationshipType.Calls, 1.0, { clojureSpecific: true, isRecursion: true }, recurHead ? recurHead.startPosition.row + 1 : undefined, callArityOf(node))
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
      const isCaseForm = node.type === "list_lit" && formNameOf(node) === "case"
      const caseDefaultIdx = isCaseForm && node.namedChildCount % 2 === 1 ? node.namedChildCount - 1 : -1
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (!child) continue
        if (isCaseForm && i >= 2 && i % 2 === 0 && child.type === "list_lit" && i !== caseDefaultIdx) continue
        walkStack.push({ node: child, isExit: false, previousActiveFunction: null as any, quoteDepth })
      }
    }

    // ── Post-loop: contains for owned symbols ─────────────────────────────
    // Every symbol carries ownerName (namespace for top-level forms, protocol
    // for protocol methods, record for fields/methods). Emit one contains per
    // (owner, symbol) pair; the identity dedup in the harness collapses
    // overloads and repeated forms with identical identity.
    const seenContains = new Set<string>()
    for (const s of symbols) {
      const _owner = s.ownerName
      // Anonymous functions are locals — no namespace-contains edge.
      if (_owner && _owner !== "user" && !s.metadata?.isAnonymous) {
        const key = `${_owner}->${s.name}`
        if (seenContains.has(key)) continue
        seenContains.add(key)
        // M59 (#825): the contains edge carries the owned symbol's own
        // declaration line (erlang parity) — never 0.
        pushRel(_owner, s.name, ASTEngine.RelationshipType.Contains, 1.0, {}, s.range.startLine)
      }
    }

    // ── exports (ns-level public symbols) ─────────────────────────────────
    const exportedKinds = new Set([
      ASTEngine.SymbolKind.Function, ASTEngine.SymbolKind.Variable,
      ASTEngine.SymbolKind.Class, ASTEngine.SymbolKind.Interface, ASTEngine.SymbolKind.Module,
    ])
    const seenExports = new Set<string>()
    const finalExports: ASTEngine.ExportInfo[] = []
    for (const s of symbols) {
      const isNSLevel = !s.scope || s.scope === currentNamespace || (s.ownerName === currentNamespace)
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
      for (const r of relationships) {
        if (r.type !== ASTEngine.RelationshipType.Calls) continue
        if (typeof r.target !== "string" || r.target.indexOf("/") !== -1 || r.target.indexOf(".") !== -1) continue
        if (localDecls.has(r.target)) continue
        const lib = refers[r.target]
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
