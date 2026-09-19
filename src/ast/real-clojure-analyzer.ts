import type { Node } from "web-tree-sitter"
import { ASTEngine } from "./engine"

const CLOJURE_CORE_BUILTINS = (function(){ const r: Record<string, boolean> = {}; const arr = [
  "if", "let", "def", "defn", "defn-", "fn", "loop", "recur", "quote", "var", "do", "try", "catch", "finally", "throw", "monitor-enter", "monitor-exit", "new", ".", "set!", "+", "-", "*", "/", "=", "not=", "<", "<=", ">", ">=", "and", "or", "not", "println", "print", "str", "concat", "map", "reduce", "filter", "remove", "into", "assoc", "dissoc", "get", "update", "merge", "keys", "vals", "first", "rest", "next", "last", "cons", "conj", "apply", "comp", "partial", "inc", "dec", "zero?", "empty?", "nil?", "when", "when-not", "when-let", "if-let", "if-not", "cond", "case", "for", "doseq", "dotimes", "->", "->>", "as->", "cond->", "cond->>", "some->", "some->>", "swap!", "reset!", "deref", "alter", "commute", "dosync", "ref", "atom", "agent", "send", "send-off", "future", "promise", "deliver", "defrecord", "defprotocol", "defmulti", "defmethod", "ns", "require", "import", "use", "refer", "comment", "deftest", "is", "testing", "list", "vector", "hash-map", "set", "vec", "seq", "count", "nth", "assoc-in", "update-in", "get-in", "select-keys", "merge-with", "zipmap", "sort", "sort-by", "reverse", "group-by", "frequencies", "distinct", "take", "drop", "take-while", "drop-while", "split-at", "partition", "interleave", "interpose", "flatten", "keep", "mapv", "filterv", "reduce-kv", "into-array", "to-array", "bean", "array-map", "sorted-map", "sorted-set", "subvec", "peek", "pop", "disj", "contains?", "find", "keys", "rseq", "range", "iterate", "repeat", "repeatedly", "cycle", "sequence", "every?", "some", "not-any?", "not-every?", "identity", "constantly", "juxt", "fnil", "memoize", "trampoline", "lazy-seq", "lazy-cat", "defonce", "defmacro", "defstruct", "declare", "binding", "with-bindings", "with-open", "with-local-vars", "time", "assert", "identical?", "instance?", "extends?", "satisfies?", "reify", "proxy", "gen-class", "gen-interface", "extend", "extend-type", "extend-protocol", "proxy-super", "doto", "..", ".", "..", "->", "->>", "amap", "areduce", "aset", "aget", "alength", "aclone", "int-array", "long-array", "double-array", "object-array", "make-array", "char", "int", "long", "double", "float", "boolean", "short", "byte", "bigint", "bigdec", "num", "string?", "keyword?", "symbol?", "number?", "seq?", "vector?", "map?", "set?", "fn?", "ifn?", "coll?", "sequential?", "associative?", "counted?", "indexed?", "reversible?", "sorted?", "namespace", "name", "keyword", "symbol", "str", "subs", "char-array", "upper-case", "lower-case", "trim", "triml", "trimr", "trim-newline", "split", "join", "replace", "re-seq", "re-find", "re-matches", "re-pattern", "re-groups", "format", "printf", "pr", "prn", "pr-str", "prn-str", "print-str", "println-str", "newline", "flush", "read", "read-line", "read-string", "slurp", "spit", "load-string", "load-file", "require", "use", "import", "refer-clojure", "in-ns", "alias", "ns-unmap", "ns-resolve", "resolve", "find-var", "var-get", "var-set", "bound?", "thread-bound?", "alter-var-root", "with-redefs", "with-redefs-fn", "future-call", "future-cancel", "future-cancelled?", "future-done?", "future?", "pmap", "pcalls", "pvalues", "delay", "force", "realized?", "when-first", "when-some", "if-some", "some->", "some->>", "condp", "while", "doseq", "dotimes", "binding", "sync", "io!", "vswap!", "swap-vals!", "reset-vals!", "compare-and-set!", "add-watch", "remove-watch", "set-validator!", "get-validator", "send-via", "await", "await-for", "shutdown-agents", "release-pending-sends", "ensure", "ref-set", "alter", "commute", "dosync", "io!", "min-key", "max-key", "compare", "equiv", "hash", "hash-combine", "sort-by", "comparator", "rand", "rand-int", "rand-nth", "random-sample", "boolean?", "true?", "false?", "nil?", "not", "not=", "identical?", "class", "type", "instance?", "isa?", "parents", "ancestors", "descendants", "derive", "underive", "make-hierarchy", "global-hierarchy", "rationalize", "numerator", "denominator", "int?", "integer?", "even?", "odd?", "pos?", "neg?", "zero?", "nat-int?", "int?", "float?", "double?", "ratio?", "decimal?", "byte?", "short?", "char?", "string?", "keyword?", "symbol?", "uuid?", "uri?", "regexp?", "fn?", "ifn?", "var?", "delayed?", "atom?", "ref?", "agent?", "future?", "promise?", "seqable?", "sequential?", "vector?", "map?", "set?", "list?", "seq?", "coll?", "counted?", "indexed?", "associative?", "reversible?", "sorted?", "unchecked-add", "unchecked-subtract", "unchecked-multiply", "unchecked-divide", "unchecked-inc", "unchecked-dec", "unchecked-negate", "unchecked-remainder", "unchecked-add-int", "unchecked-subtract-int", "unchecked-multiply-int", "unchecked-divide-int", "unchecked-inc-int", "unchecked-dec-int", "unchecked-negate-int", "unchecked-remainder-int", "bit-and", "bit-or", "bit-xor", "bit-not", "bit-shift-left", "bit-shift-right", "bit-and-not", "bit-clear", "bit-set", "bit-flip", "bit-test", "shift-left", "shift-right", "unsigned-bit-shift-right", "bit-count", "Integer/parseInt", "Long/parseLong", "Double/parseDouble", "Math/abs", "Math/max", "Math/min", "Math/round", "Math/floor", "Math/ceil", "Math/sqrt", "Math/pow", "Math/random", "String/valueOf", "String/format", "String/join", "String/split", "System/currentTimeMillis", "System/nanoTime", "System/getProperty", "System/exit", "System/gc", "Thread/sleep", "Thread/currentThread", "UUID/randomUUID", "java.util.Date", "char", "code-char", "symbol", "keyword", "gensym", "unquote", "unquote-splicing", "syntax-quote", "deliver", "promise", "not-empty", "empty", "list*", "cons", "concat", "lazy-seq", "when-let", "if-let", "when-some", "if-some", "when-first", "while", "loop", "recur", "letfn", "defn-", "defmacro", "defmulti", "defmethod", "defprotocol", "defrecord", "deftype", "defstruct", "ns", "in-ns", "require", "use", "import", "refer", "alias", "comment", "declare", "def", "defonce", "binding", "with-bindings", "with-open", "with-local-vars", "time", "assert", "identical?", "instance?", "extends?", "satisfies?", "reify", "proxy", "gen-class", "gen-interface", "extend", "extend-type", "extend-protocol", "proxy-super", "doto", "..", ".", "amap", "areduce", "aset", "aget", "alength", "aclone", "int-array", "long-array", "double-array", "object-array", "make-array"
]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();

const HOF_BUILTINS = (function(){ const r: Record<string, boolean> = {}; const arr = ["apply", "map", "reduce", "filter", "comp", "partial"]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();
const STM_BUILTINS = (function(){ const r: Record<string, boolean> = {}; const arr = ["swap!", "reset!", "deref", "alter", "commute", "dosync", "ref", "atom", "agent", "send", "send-off"]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();
const COMPLEXITY_BUILTINS = (function(){ const r: Record<string, boolean> = {}; const arr = ["if", "cond", "when", "case", "for", "loop", "when-let", "if-let"]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();
const IMPURE_BUILTINS = (function(){ const r: Record<string, boolean> = {}; const arr = ["println", "print", "def", "alter-var-root", "with-redefs", "set!", "swap!", "reset!", "alter"]; for(let i=0;i<arr.length;i++) r[arr[i]] = true; return r; })();

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
    let namespaceAliases: Record<string, string> = {}
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

    // Read the form-name of a list_lit: the first EXECUTABLE value child.
    // The head of a list is decided after discard/trivia, not before it:
    // `(#_ignored quote (trivia-ghost))` is a `quote` form, so its body is data
    // and must never be read as a call (#881). The same holds for a leading
    // `(comment ...)`-style trivia node and a `meta_lit`, which occupy no
    // execution position — `executionHead` is the single definition of that
    // rule and is used here rather than a second copy of it.
    // For `(:require ...)` / `(:import ...)` clauses the head is a kwd_lit
    // (e.g. ":require"); we return its keyword name so clause dispatch works.
    const formNameOf = (listNode: Node): string => {
      const first = executionHead(listNode)
      if (!first) return ""
      if (first.type === "kwd_lit") {
        return first.childForFieldName("name")?.text || ""
      }
      // Only sym_lit heads are forms. A vec_lit head is a multi-arity
      // clause `([a b] body)` — never a call, never a form name.
      if (first.type !== "sym_lit") return ""
      return symName(first)
    }

    // Params: collect symbol names from every parameter vector of the form.
    // Single-arity defn has one direct vec_lit; multi-arity defn has one
    // list_lit (arity clause) per arity whose first child is the params vec.
    const extractParams = (fnNode: Node | null): ASTEngine.Parameter[] => {
      const params: ASTEngine.Parameter[] = []
      if (!fnNode) return params
      const seen = new Set<string>()
      const collectVec = (vec: Node) => {
        for (let i = 0; i < vec.namedChildCount; i++) {
          const child = vec.namedChild(i)
          if (!child || child.type !== "sym_lit") continue
          const name = symName(child)
          if (!name || seen.has(name)) continue
          seen.add(name)
          params.push({ name, type: "Any" })
        }
      }
      const isArityClause = (n: Node): boolean =>
        n.type === "list_lit" && n.namedChild(0)?.type === "vec_lit"
      for (let i = 0; i < fnNode.namedChildCount; i++) {
        const c = fnNode.namedChild(i)
        if (!c) continue
        if (c.type === "vec_lit") collectVec(c)
        else if (isArityClause(c)) collectVec(c.namedChild(0)!)
      }
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
    const pushRel = (rel: ASTEngine.UniversalRelationship) => {
      relationships.push(rel)
    }

    const containsOf = (owner: string) => (target: string) => {
      pushRel({ source: owner, target, type: ASTEngine.RelationshipType.Contains, confidence: 1.0, metadata: {} })
    }

    const executionHead = (list: Node): Node | null => {
      for (let i = 0; i < list.namedChildCount; i++) {
        const child = list.namedChild(i)
        if (child && child.type !== "comment" && child.type !== "dis_expr" && child.type !== "meta_lit") return child
      }
      return null
    }

    let mayShadowComment = false
    const bindingStack: Node[] = [rootNode]
    while (bindingStack.length > 0) {
      const candidate = bindingStack.pop()!
      if (candidate.type === "dis_expr" || candidate.type === "quoting_lit") continue
      if (candidate.type === "sym_lit" && symName(candidate) === "comment") {
        const parent = candidate.parent
        if (parent?.type !== "list_lit" || parent.namedChild(0)?.startIndex !== candidate.startIndex) {
          mayShadowComment = true
          break
        }
      }
      for (let i = 0; i < candidate.namedChildCount; i++) {
        const child = candidate.namedChild(i)
        if (child) bindingStack.push(child)
      }
    }

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
      if (node.type === "list_lit") {
        const form = formNameOf(node)
        if (form === "quote" || form === "clojure.core/comment" || (form === "comment" && !mayShadowComment)) continue
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
          namespaceAliases = {}
          symbols.push({
            name: currentNamespace,
            kind: ASTEngine.SymbolKind.Module,
            range: this.nodeToRange(node),
            scope: "",
            visibility: "public",
            metadata: { clojureSpecific: true }
          })
          exports.push({ name: currentNamespace, kind: ASTEngine.SymbolKind.Module, range: this.nodeToRange(node), visibility: "public" })

          // require / use / import / refer-clojure clauses
          for (let i = 1; i < node.namedChildCount; i++) {
            const clause = node.namedChild(i)
            if (!clause || clause.type !== "list_lit") continue
            const clauseType = formNameOf(clause)
            if (clauseType !== "require" && clauseType !== "use" && clauseType !== "import" && clauseType !== "refer-clojure") continue

            for (let j = 1; j < clause.namedChildCount; j++) {
              const libNode = clause.namedChild(j)
              if (!libNode) continue

              if (libNode.type === "vec_lit") {
                // [lib :as alias] | [lib :refer [a b]] | [lib]
                const libName = symName(libNode.namedChild(0))
                if (!libName) continue
                let alias = ""
                let referNames: string[] = []
                for (let k = 1; k < libNode.namedChildCount; k++) {
                  const part = libNode.namedChild(k)
                  if (!part || part.type !== "kwd_lit") continue
                  const kw = part.childForFieldName("name")?.text || ""
                  if (kw === "as" && k + 1 < libNode.namedChildCount) {
                    alias = symName(libNode.namedChild(k + 1))
                  } else if (kw === "refer" && k + 1 < libNode.namedChildCount) {
                    const refVec = libNode.namedChild(k + 1)
                    if (refVec && refVec.type === "vec_lit") {
                      for (let r = 0; r < refVec.namedChildCount; r++) {
                        const rn = refVec.namedChild(r)
                        if (rn && rn.type === "sym_lit") referNames.push(symName(rn))
                      }
                    }
                  }
                }
                if (alias) namespaceAliases[alias] = libName
                if (referNames.length > 0) {
                  imports.push({ module: libName, items: referNames, type: "named", isExternal: true, line: libNode.startPosition.row + 1 })
                } else {
                  imports.push({ module: libName, items: alias ? [alias] : ["*"], type: "named", isExternal: true, line: libNode.startPosition.row + 1 })
                }
                pushRel({ source: currentNamespace, target: libName, type: ASTEngine.RelationshipType.References, confidence: 0.9, metadata: { clojureSpecific: true, isLibraryDep: true } })
                for (const [needle, fw] of REQUIRED_LIB_PATTERNS) {
                  if (libName.startsWith(needle)) frameworks[fw] = true
                }
              } else if (libNode.type === "list_lit") {
                // (:import (java.util Date UUID)) — package + class list
                const pkg = symName(libNode.namedChild(0))
                if (!pkg) continue
                for (let k = 1; k < libNode.namedChildCount; k++) {
                  const cls = libNode.namedChild(k)
                  if (cls && cls.type === "sym_lit") {
                    imports.push({ module: pkg, items: [symName(cls)], type: "named", isExternal: true, line: cls.startPosition.row + 1 })
                    patterns["Java Interoperability"] = true
                  }
                }
              } else if (libNode.type === "sym_lit") {
                const libName = symName(libNode)
                if (libName) {
                  imports.push({ module: libName, items: ["*"], type: "named", isExternal: true, line: libNode.startPosition.row + 1 })
                  pushRel({ source: currentNamespace, target: libName, type: ASTEngine.RelationshipType.References, confidence: 0.9, metadata: { clojureSpecific: true, isLibraryDep: true } })
                  for (const [needle, fw] of REQUIRED_LIB_PATTERNS) {
                    if (libName.startsWith(needle)) frameworks[fw] = true
                  }
                }
              }
            }
          }
        }
        // ── defn / defn- / defmacro ──────────────────────────────────────
        else if (formName === "defn" || formName === "defn-" || formName === "defmacro" || formName === "s/defn" || formName === "mu/defn") {
          const isMacro = formName === "defmacro"
          const isPrivate = formName === "defn-"
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
          if (isMacro) patterns["Metaprogramming"] = true
          exports.push({ name, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node), visibility: isPrivate ? "private" : "public" })
        }
        // ── defprotocol ──────────────────────────────────────────────────
        else if (formName === "defprotocol") {
          const name = symName(node.namedChild(1)) || "unknown"
          symbols.push({
            name, kind: ASTEngine.SymbolKind.Interface, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            metadata: { clojureSpecific: true, isProtocol: true }
          })
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
        // ── defrecord / deftype ──────────────────────────────────────────
        else if (formName === "defrecord" || formName === "deftype") {
          const name = symName(node.namedChild(1)) || "unknown"
          symbols.push({
            name, kind: ASTEngine.SymbolKind.Class, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            metadata: { clojureSpecific: true, isRecord: formName === "defrecord", isType: formName === "deftype" }
          })
          exports.push({ name, kind: ASTEngine.SymbolKind.Class, range: this.nodeToRange(node), visibility: "public" })

          // fields vector
          const fieldsVec = node.namedChild(2)
          if (fieldsVec && fieldsVec.type === "vec_lit") {
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
          // implements: protocol symbols after the fields vector
          for (let pi = 3; pi < node.namedChildCount; pi++) {
            const protoNode = node.namedChild(pi)
            if (!protoNode) continue
            if (protoNode.type === "sym_lit") {
              const protoName = symName(protoNode)
              if (protoName) {
                pushRel({ source: name, target: protoName, type: ASTEngine.RelationshipType.Implements, confidence: 0.85, metadata: { clojureSpecific: true, isRecord: formName === "defrecord" } })
              }
            } else if (protoNode.type === "list_lit") {
              // protocol method implementations inside the record body
              const mName = symName(protoNode.namedChild(0))
              if (!mName || CLOJURE_CORE_BUILTINS[mName]) continue
              symbols.push({
                name: mName, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(protoNode),
                scope: `${currentNamespace}.${name}`, ownerName: name, visibility: "public",
                parameters: extractParams(protoNode),
                metadata: { clojureSpecific: true, isRecordMethod: true }
              })
            }
          }
        }
        // ── defmulti / defmethod ─────────────────────────────────────────
        else if (formName === "defmulti") {
          const name = symName(node.namedChild(1)) || "unknown"
          symbols.push({
            name, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            metadata: { clojureSpecific: true, isMultimethod: true }
          })
          patterns["Multimethods"] = true
          exports.push({ name, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node), visibility: "public" })
        } else if (formName === "defmethod") {
          const multiName = symName(node.namedChild(1)) || "unknown"
          // The method impl shares the multimethod's var (Clojure semantics:
          // defmethod adds a dispatch method to the defmulti var, it does not
          // create a new var). Emit a line-distinct impl symbol; the Overrides
          // family is inapplicable intra-namespace because source and target
          // share the same identity (documented in the analyzer doc).
          symbols.push({
            name: multiName, kind: ASTEngine.SymbolKind.Function, range: this.nodeToRange(node),
            scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
            parameters: extractParams(node),
            metadata: { clojureSpecific: true, isMethodImpl: true }
          })
          patterns["Multimethods"] = true
        }
        // ── def / defonce ────────────────────────────────────────────────
        else if (formName === "def" || formName === "defonce") {
          const nameNode = node.namedChild(1)
          if (nameNode && nameNode.type === "sym_lit") {
            const name = symName(nameNode)
            symbols.push({
              name, kind: ASTEngine.SymbolKind.Variable, range: this.nodeToRange(node),
              scope: currentNamespace, ownerName: currentNamespace, visibility: "public",
              metadata: { clojureSpecific: true }
            })
            exports.push({ name, kind: ASTEngine.SymbolKind.Variable, range: this.nodeToRange(node), visibility: "public" })
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
        // ── constructor idioms: (->ClassName ...) and (ClassName.) ───────
        else if (formName.startsWith("->") && formName.length > 2 && activeFunction) {
          const cls = formName.slice(2)
          const c0 = cls.charCodeAt(0)
          if (c0 >= 65 && c0 <= 90) {
            pushRel({ source: activeFunction.name, target: cls, type: ASTEngine.RelationshipType.Instantiates, confidence: 0.8, metadata: { clojureSpecific: true, isConstructor: true } })
          }
        } else if (formName.endsWith(".") && formName.length > 1 && activeFunction && !formName.startsWith(".")) {
          const cls = formName.slice(0, -1)
          pushRel({ source: activeFunction.name, target: cls, type: ASTEngine.RelationshipType.Instantiates, confidence: 0.8, metadata: { clojureSpecific: true, isJavaInterop: true } })
          patterns["Java Interoperability"] = true
        }
        // ── Java member/field access: (.method obj) / (.-field obj) ──────
        else if (formName.startsWith(".") && activeFunction) {
          const target = formName.startsWith(".-") ? formName.slice(2) : formName.slice(1)
          if (target) pushRel({ source: activeFunction.name, target, type: ASTEngine.RelationshipType.Uses, confidence: 0.7, metadata: { clojureSpecific: true, isFieldAccess: true } })
          patterns["Java Interoperability"] = true
        }
        // ── threading macros → uses chain ────────────────────────────────
        else if (formName === "->" || formName === "->>" || formName === "some->" || formName === "as->" || formName === "cond->" || formName === "cond->>") {
          if (activeFunction) patterns["Threading Macros"] = true
        }
        // ── generic function calls (non-builtin form symbols) ────────────
        else if (formName && !CLOJURE_CORE_BUILTINS[formName] && activeFunction) {
          const qualified = formName.includes("/")
          if (qualified) {
            const [alias, func] = formName.split("/")
            const resolvedNs = namespaceAliases[alias] || alias
            pushRel({ source: activeFunction.name, target: `${resolvedNs}/${func}`, type: ASTEngine.RelationshipType.Calls, confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } })
            pushRel({ source: currentNamespace, target: resolvedNs, type: ASTEngine.RelationshipType.References, confidence: 0.8, metadata: { clojureSpecific: true, isLibraryDep: true } })
            if (func.endsWith("!")) activeFunction.metadata!.isPure = false
          } else {
            pushRel({ source: activeFunction.name, target: formName, type: ASTEngine.RelationshipType.Calls, confidence: 0.9, metadata: { clojureSpecific: true, isGeneralCall: true } })
            if (formName.endsWith("!")) activeFunction.metadata!.isPure = false
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
            pushRel({ source: activeFunction.name, target: activeFunction.name, type: ASTEngine.RelationshipType.Calls, confidence: 1.0, metadata: { clojureSpecific: true, isRecursion: true } })
            activeFunction.metadata.isRecursive = true
          } else if (formName === activeFunction.name) {
            activeFunction.metadata.isRecursive = true
          }
          if (formName === "lazy-seq") patterns["Lazy Evaluation"] = true
        }
      }

      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const child = node.namedChild(i)
        if (child) walkStack.push({ node: child, isExit: false, previousActiveFunction: null as any, quoteDepth })
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
        containsOf(_owner)(s.name)
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

    if (symbols.length > 0 && totalCyclomaticComplexity === 0) totalCyclomaticComplexity = symbols.length

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
