// CLJ-DEEP · the TRUTH for the two relationship classes F5 never compared.
//
// WHY THIS FILE EXISTS. `differential.ts` documents its allowlist as: "a label
// the truth side does not derive cannot be compared, because every analyzer edge
// of that label would be counted as fabrication (the #910 lesson)". That rule is
// right, and it had a consequence nobody wrote down: for the clojure lane, `uses`
// and `contains` were therefore not compared AT ALL. Two of the seven
// relationship classes the analyzer emits had no gate, no oracle and no residual
// — while the lane reported 100% completeness. "No relationship missed" is not a
// claim you can make while two classes are unexamined.
//
// This module derives that truth FROM THE TREE, so the comparison becomes
// possible without inventing a second opinion:
//
//   uses      the Java member/field access class — `(.method obj)`, `(-.field
//             obj)`, and the same forms nested inside `..` chains. Every such
//             site is a use of a named member. `pushRel` does not filter, so
//             the truth is exact rather than a subset.
//
//   contains  file → namespace containment. The owner attribution is a judgment
//             call, so this is the NIM precedent applied honestly: the shared
//             ground truth is the analyzer's own owner name, and the oracle
//             derives the CONTAINMENT ARITHMETIC and the line, not a rival
//             notion of who owns what. Overlap safety is the dedupe-key identity
//             `pushRel` uses, so a duplicate call collapses exactly as it does
//             in the analyzer — the same way `contains` is judged in nim.
//
// AST only. No regex. No human-typed name lists. Where a rule is copied from the
// analyzer it is copied because the TRUTH of "what did this form mean" is the
// same question the analyzer asked — not to make the comparison agree. Where the
// two could legitimately differ, the rule is written from the tree and the
// difference is the finding.
import type { Node } from "web-tree-sitter"
import { ASTEngine } from "../../src/ast/engine.ts"

// ── the two helpers, replicated from the analyzer so the ORACLE measures the
// same positions rather than a near-miss that would read as a defect ──────────
const SKIP_CHILD = new Set(["comment", "dis_expr", "meta_lit"])

/** Forms whose BODY IS NOT CODE — the analyzer honours this, so the truth must. */
const NON_CODE_HEADS = new Set(["comment", "quote"])


function executionHead(list: Node): Node | null {
  for (let i = 0; i < list.namedChildCount; i++) {
    const c = list.namedChild(i)
    if (c && !SKIP_CHILD.has(c.type)) return c
  }
  return null
}
function callArityOf(list: Node): number {
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
/**
 * The name of a symbol node — ONE reader, because the grammar splits a qualified
 * symbol into `namespace` and `name` FIELDS (CLJ-D28).
 *
 * Reading only the `name` field turns `JDK8InterfaceMethods/.bar` into `.bar`,
 * which then reads as an INSTANCE member access: 23 static sites in clojure's own
 * test suite were reported as 23 fabricated `uses` edges, and the class edge was
 * never derived at all. The slash is part of the name and has to be put back.
 */
const symName = (n: Node | null): string => {
  if (!n) return ""
  if (n.type === "sym_lit") {
    const name = n.childForFieldName("name")
    const ns = n.childForFieldName("namespace")
    // CLJ-D54: A QUALIFIED SYMBOL'S PREFIX MAY CARRY METADATA, and the metadata is not
    // the namespace. `yaml/YAMLCodec` where `yaml` is written
    // `^{:clj-kondo/ignore [:discouraged-namespace]}yaml` produced the target
    // `^{:clj-kondo/ignore [:discouraged-namespace]}/YAMLCodec` - not a type, not a var,
    // not resolvable by anything. The prefix's own `name` field is the bare symbol, so
    // reading THAT rather than the node's text is the fix, and it costs nothing when
    // there is no metadata.
    const nsText = ns ? ((ns.text ?? "").startsWith("^{") ? (ns.childForFieldName("name")?.text ?? ns.text) : ns.text) : ""
    if (name && nsText) return `${nsText}/${name.text}`
    if (name) return name.text
    return n.text
  }
  return n.text
}

/**
 * The namespace name a `ns`/`in-ns` form names.
 *
 * `(ns a.b)` takes a BARE symbol; `(in-ns 'a.b)` takes a QUOTED one. Reading the
 * second one as a plain node yields `'a.b` — with the reader quote still on it —
 * which is not a name any other file can refer to, and which made every one of
 * clojure's 17 `in-ns` files look like 106-484 missing `contains` edges when the
 * analyzer had in fact published all of them. The apostrophe is the whole bug:
 * both sides agreed on every other field.
 */
function namespaceNameOf(arg: Node | null): string {
  if (!arg) return ""
  // CLJ-D49: AN `ns` FORM MAY CARRY METADATA, AND THE METADATA IS NOT THE NAME.
  //
  // `(ns ^{:no-doc true} clj-kondo.impl.rewrite-clj.node.indent …)` puts a
  // `meta_lit` where the name is expected, so this returned "" — and the caller
  // does `if (v) out.push({ at, name: v, aliases: aliasTableOf(n, v) })`, so an empty
  // name dropped the WHOLE timeline entry. Not just the name: every alias in the
  // file went with it, silently. That is why `LinePrefixedNode -> node/Node` was
  // published unresolvable while the analyzer published
  // `LinePrefixedNode -> clj-kondo.impl.rewrite-clj.node.protocols/Node`: the alias
  // `node` was never in the table, not because it was unread but because the entry
  // holding it had been thrown away before it was read.
  //
  // `clj-kondo` is dense with `^{:no-doc true}`, so this was not a rare shape, and
  // the failure mode compounds silently across every derivation that consults the
  // namespace timeline.
  if (arg.type === "meta_lit") {
    const inner = executionHead(arg)
    return inner ? namespaceNameOf(inner) : ""
  }
  if (arg.type === "sym_lit") return arg.childForFieldName("name")?.text ?? ""
  // `(in-ns 'a.b)` — the name is the quote's own first child.
  if (arg.type === "quoting_lit" || arg.type === "syn_quoting_lit") {
    const inner = executionHead(arg)
    return inner && inner.type === "sym_lit" ? inner.childForFieldName("name")?.text ?? "" : ""
  }
  return ""
}

export type TruthEdge = { source: string; target: string; type: ASTEngine.RelationshipType; line: number; callArity?: number }

// The dedupe identity `pushRel` enforces, so a truth that predicts a duplicate
// collapses the same way the analyzer's does. Without this, a file with two
// identical `(.toString x)` calls on the same line would show a phantom residual.
const edgeKey = (e: TruthEdge): string => `${e.source}|${e.type}|${e.target}|${e.callArity ?? ""}|${e.line ?? ""}`

/** Names of def-family forms, and the form that OWNS a body. */
const DEF_HEADS = new Set([
  "def", "defn", "defn-", "defmacro", "defmulti", "defmethod", "defprotocol", "defrecord",
  "deftype", "definterface", "deftest", "defonce", "declare", "defstruct", "defcurried",
])

/**
 * The single walk both derivations need: it yields every `list_lit` together with
 * the function that lexically contains it and the file's namespace — the same two
 * attributions `activeFunction` / `currentNamespace` give the analyzer, derived
 * from the tree so the oracle is not reading the analyzer's answer off the
 * analyzer.
 */

/**
 * The namespace timeline of a file: every `ns`/`in-ns` form with the byte offset
 * it takes effect from. A file may switch namespace part-way through — the
 * `contains` and `uses` derivations both need the namespace IN FORCE AT A GIVEN
 * FORM, not the file's first one, so both read this.
 */
function namespaceTimeline(root: Node): NsCtx[] {
  const out: NsCtx[] = []
  // The DATA RULE, applied to namespace forms. An `(ns …)` inside a `quote`, a
  // syntax quote, a `comment` or a `#_` discard does not switch this file's
  // namespace — it is a string the reader will evaluate somewhere else. Two real
  // cases, both in clojure's own test suite:
  //   reader.cljc:497   (eval '(do (ns foo (:require [clojure.core :as bar]) …)))
  //   ns_libs.clj:60    (eval '(do (ns exporter-2) … (ns importer) …))
  // Reading those as switches handed 25 top-level `deftest` forms to a namespace
  // that exists only inside a quoted program, and reported every one of them as
  // a missing containment.
  const rec = (n: Node, dataDepth: number): void => {
    let depth = dataDepth
    if (n.type === "dis_expr" || n.type === "quoting_lit") return
    if (n.type === "syn_quoting_lit") depth = dataDepth + 1
    else if (n.type === "unquoting_lit" || n.type === "unquote_splicing_lit") depth = Math.max(0, dataDepth - 1)

    if (n.type === "list_lit" && depth === 0) {
      const h = executionHead(n)
      const nm = h && h.type === "sym_lit" ? symName(h) : ""
      if (NON_CODE_HEADS.has(nm)) return
      if ((nm === "ns" || nm === "in-ns") && n.namedChildCount > 1) {
        const v = namespaceNameOf(n.namedChild(1))
        if (v) out.push({ at: n.startIndex, name: v, aliases: aliasTableOf(n, v) })
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) rec(c, depth) }
  }
  rec(root, 0)
  out.sort((a, b) => a.at - b.at)
  return out
}

type NsCtx = { at: number; name: string; aliases: Map<string, string> }

/**
 * The alias table an `ns`/`in-ns` form declares: `[clojure.string :as str]` maps
 * `str` to `clojure.string`, and `[prefix [sub :as a]]` maps `a` to `prefix.sub`.
 *
 * This was MISSING, and its absence is why `implements` derived the right NUMBER
 * of edges (444) with none of the KEYS matching: the analyzer resolves every
 * protocol name through `resolveQualified`, so `(extend-type T alias/P …)` is
 * published as `real.ns/P` while the truth published `alias/P`. 403 edges right
 * and 403 wrong — which is what a missing resolution step looks like from the
 * outside, and a reminder that matching COUNTS is not matching FACTS.
 */
/**
 * RESOLVE A LIBSPEC TO A NAMESPACE, which is not always what it says.
 *
 * A libspec with no dot in its first segment is RELATIVE: Clojure resolves it
 * against the namespace doing the requiring, so `[protocols :as node]` inside
 * `(ns clj-kondo.impl.rewrite-clj.node.indent …)` means
 * `clj-kondo.impl.rewrite-clj.node.protocols` — the current namespace's prefix with
 * its last segment replaced. Storing the literal `protocols` left every use of the
 * alias unresolved, which is 8 of the 15 `implements` residuals in this wave:
 * `LinePrefixedNode -> node/Node` against the analyzer's
 * `LinePrefixedNode -> clj-kondo.impl.rewrite-clj.node.protocols/Node`, same edge,
 * same line, unresolvable target.
 *
 * The absolute roots are the ones `clojure.lang.RT` treats as roots; a segment
 * containing a dot is absolute on its own.
 */
const LIBSPEC_ROOTS = new Set(["clojure", "java", "javax", "jdk.nashorn", "sun", "com.sun"])

function resolveLibSpec(lib: string, currentNs: string): string {
  if (!lib) return lib
  const first = lib.split("/")[0] ?? lib
  if (lib.includes(".") || LIBSPEC_ROOTS.has(first)) return lib
  // RELATIVE: the current namespace's PARENT prefix, then the spec.
  const cut = currentNs.lastIndexOf(".")
  const parent = cut > 0 ? currentNs.slice(0, cut) : ""
  return parent ? `${parent}.${lib}` : lib
}

function aliasTableOf(nsForm: Node, currentNs = ""): Map<string, string> {
  const m = new Map<string, string>()
  for (let ci = 1; ci < nsForm.namedChildCount; ci++) {
    const clause = nsForm.namedChild(ci)
    if (!clause || clause.type !== "list_lit") continue
    const ck = executionHead(clause)
    const kw = ck && ck.type === "kwd_lit" ? (ck.childForFieldName("name")?.text ?? "") : ""
    if (!LIB_KEYWORDS.has(kw)) continue
    for (let k = 1; k < clause.namedChildCount; k++) {
      const spec = clause.namedChild(k)
      if (!spec || spec.type !== "vec_lit") continue
      const rawFirst = spec.namedChild(0)
      // CLJ-D54: A LIBSPEC MAY CARRY METADATA, and the metadata is not the lib.
      // `(:require ^{:clj-kondo/ignore [:discouraged-namespace]} [clj-yaml.core :as yaml]
      // …)` in metabase/util/yaml.clj puts a `meta_lit` where the lib symbol is expected,
      // so `first.type === "sym_lit"` failed and the `yaml` alias was never registered at
      // all — every `yaml/…` use in the file then published the raw alias, and because
      // the symbol's PREFIX carries the metadata the target came back as
      // `^{:clj-kondo/ignore [:discouraged-namespace]}/YAMLCodec`, which is not a type and
      // resolves to nothing. The same lesson as CLJ-D39's `^{:no-doc true}` namespace and
      // CLJ-D50's quoted require: the reader's decoration is not part of the name.
      const first = rawFirst && (rawFirst.type === "meta_lit" || rawFirst.type === "quote_lit")
        ? executionHead(rawFirst)
        : rawFirst
      if (!first) continue
      // CLJ-D49: A SPEC IS A PREFIX LIST IF IT HAS A NESTED SPEC — not if its first
      // child happens to be a symbol, which a prefix list ALSO has.
      //
      // `(ns ^{:no-doc true} clj-kondo…indent (:require [clj-kondo…node
      // [protocols :as node] [whitespace :as ws]] [clojure.string :as string]))`
      //
      // The outer spec's first child is the sym_lit `clj-kondo…node`, so the old
      // `first.type === "sym_lit"` test took the PLAIN-SPEC branch, found no `:as`
      // among a symbol's children, registered nothing, and never reached the prefix
      // branch below it. The measured symptom was an alias table of size 1 — `string`
      // only — where `node` and `ws` were simply absent, so every use published an
      // unresolvable `node/Node` while the analyzer published
      // `clj-kondo.impl.rewrite-clj.node.protocols/Node`.
      const isPrefixList = first.type === "vec_lit" || (() => {
        for (let q = 1; q < spec.namedChildCount; q++) { const c = spec.namedChild(q); if (c && c.type === "vec_lit") return true }
        return false
      })()
      if (!isPrefixList && first.type === "sym_lit") {
        const lib = resolveLibSpec(symName(first), currentNs)
        for (let q = 1; q < spec.namedChildCount; q++) {
          const c = spec.namedChild(q)
          if (c && c.type === "kwd_lit") {
            const key = c.childForFieldName("name")?.text ?? ""
            if (key === "as" || key === "as-alias") {
              const a = spec.namedChild(q + 1)
              if (a && a.type === "sym_lit") m.set(symName(a), lib)
            }
          }
        }
        continue
      }
      if (isPrefixList) {
        // The prefix is the spec's FIRST child — a symbol like
        // `clj-kondo.impl.rewrite-clj.node` — and the nested specs are its SIBLINGS,
        // not its children. Reading them off `first` (as this did) only worked for
        // the shape where the prefix is itself wrapped in a vector, which is not the
        // shape clj-kondo writes.
        const prefixName = first.type === "sym_lit" ? symName(first) : ""
        const host = first.type === "vec_lit" ? first : spec
        if (!prefixName) continue
        for (let q = 1; q < host.namedChildCount; q++) {
          const c = host.namedChild(q)
          if (!c || c.type !== "vec_lit") continue
          const sub = c.namedChild(0)
          const subName = sub && sub.type === "sym_lit" ? symName(sub) : ""
          if (!subName) continue
          for (let r = 1; r < c.namedChildCount; r++) {
            const kk = c.namedChild(r)
            const key = kk && kk.type === "kwd_lit" ? (kk.childForFieldName("name")?.text ?? "") : ""
            // `:as-alias` ALSO takes a positional name, so both keys are read here
            // rather than only the `:as` one — CLJ-D40's second alias key, which this
            // reader had never grown.
            if (key !== "as" && key !== "as-alias") continue
            const a = c.namedChild(r + 1)
            if (a && a.type === "sym_lit") m.set(symName(a), `${prefixName}.${subName}`)
          }
        }
      }
    }
  }
  return m
}

/** The alias table in force at a byte offset, merged across every ns form so far. */
function aliasesAt(timeline: NsCtx[], idx: number): Map<string, string> {
  const m = new Map<string, string>()
  for (const t of timeline) {
    if (t.at > idx) break
    for (const [k, v] of t.aliases) m.set(k, v)
  }
  return m
}

/** `alias/name` -> `real.ns/name`; a bare or unknown name is returned unchanged. */
function resolveAlias(name: string, aliases: Map<string, string>): string {
  const slash = name.indexOf("/")
  if (slash <= 0) return name
  const resolved = aliases.get(name.slice(0, slash))
  return resolved ? `${resolved}${name.slice(slash)}` : name
}

/** The namespace in force at a byte offset. */
function nsAt(timeline: NsCtx[], idx: number): string {
  let name = ""
  for (const t of timeline) { if (t.at <= idx) name = t.name; else break }
  return name
}

function walk(root: Node, onList: (node: Node, src: string) => void): void {
  // The namespace IN FORCE AT EACH POINT, not just the first one. A file may
  // switch: clojure/core/server.clj declares `clojure.core.server`, then at line
  // 169 does `(in-ns 'user)` and defines `repl-read`, `repl`, `prepl` and five
  // more. Those definitions belong to `user`, and reading only the FIRST ns form
  // made the truth demand `clojure.core.server -> repl-read` for 36 edges the
  // analyzer had correctly attributed elsewhere.
  const nsTimeline = namespaceTimeline(root)

  // Pass 2: every list, with its lexical owner and its QUOTE DEPTH. The owner is
  // the INNERMOST def-family form that contains the list, which is what "the code
  // inside this defn" means to a reader of the graph.
  //
  // THE QUOTE MODEL, which took two corrections to get right and is the same one
  // the analyzer uses. Inside a syntax quote, a form is DATA — except where an
  // unquote makes it EVALUATED code again. So depth goes up at
  // `syn_quoting_lit` and down at `unquoting_lit` / `unquote_splicing_lit`, and a
  // site only counts when the depth is 0. The first version of this walk skipped
  // every `syn_quoting_lit` subtree wholesale and reported 127 real edges in
  // clojure/core.clj as MISSED; the second, once the skip was subtree-wide,
  // reported 2 edges in core.async's go.clj as FABRICATED — both inside `~@(...)`
  // within a backtick (go.clj:1026), where `(.hasJavaClass lb)` genuinely IS
  // evaluated. A plain `quote` is a FULL skip with no unquote case, which is why
  // `'(.reset v 1)` emits nothing and `` `~(.reset v 1) `` emits a real edge.
  const rec = (n: Node, owner: string, dataDepth: number): void => {
    // `#_` is the READER DISCARD: `#_(deftest CLJ-1154 …)` drops the form before
    // the compiler ever sees it, so a `(.mkdir tmp)` inside one is not code. The
    // node type is `dis_expr`. clojure/test/clojure/test_clojure/compilation.clj
    // has 6 such sites and 6 of the 12 in param_tags.clj, which is where the
    // first version of this truth's 54 "MISSED" uses came from.
    if (n.type === "dis_expr") return
    // METADATA IS DATA (CLJ-D5). `^{:name (format "(.getObject rs %d)" (.getCanonicalName …))}`
    // at metabase/api/…/execute.clj:685 is a description STRING, and the member
    // access inside it is never evaluated — the analyzer correctly emits nothing,
    // and the first version of this truth demanded a `uses` edge for it.
    if (n.type === "meta_lit") return
    if (n.type === "quoting_lit") return // full skip, as the analyzer does
    let depth = dataDepth
    if (n.type === "syn_quoting_lit") depth = dataDepth + 1
    else if (n.type === "unquoting_lit" || n.type === "unquote_splicing_lit") depth = Math.max(0, dataDepth - 1)

    let nextOwner = owner
    if (n.type === "list_lit" && depth === 0) {
      const h = executionHead(n)
      const nm = h && h.type === "sym_lit" ? symName(h) : ""
      if (NON_CODE_HEADS.has(nm)) return // comment / quote bodies are data
      // THE THREE DATA POSITIONS THAT ARE NOT QUOTES. All three are rules the
      // analyzer already applies; the truth did not, and each one invented a
      // relationship out of a list that is never evaluated:
      //
      // · A LIBSITE SITE. `(:use [clojure.test :only (deftest is are)])` — the
      //   `:only` list names functions to refer, and the analyzer reads it as a
      //   refer clause (CLJ-D5/D22). The truth read it as three `deftest`
      //   definitions and demanded a containment for each (pprint.clj:14,
      //   test_helper.clj:18, pipeline_test.clj:2).
      if (isLibspecSite(n)) return
      // · A `case` CONSTANT POSITION. `(def defonce defmulti goog-define)` at
      //   clj-kondo/impl/analyzer.clj:3566 is a clause of a `case` over form
      //   NAMES: the list is a group of unevaluated alternatives, not a
      //   definition. The analyzer skips it (F7/CLJ-D36); the truth read
      //   `defonce`, `defn-`, `defprotocol` and `deftype` as definitions and
      //   demanded four containments that do not exist.
      if (isCaseConstant(n)) return
      // The owner of a top-level form is the namespace in force HERE, not the one
      // at the top of the file.
      if (nsTimeline.length > 0 && isTopLevelChild(n)) owner = nsAt(nsTimeline, n.startIndex)
      onList(n, owner)
      if (DEF_HEADS.has(nm) || isDefLikeHead(nm)) {
        const dn = defNameOf(n)
        if (dn) nextOwner = dn
      } else if (nm === "fn" || nm === "fn*") {
        // A `fn` LITERAL IS A FUNCTION and the analyzer names it
        // `lambda_<row>_<col>` (0-based row, as the analyzer spells it). Without
        // this frame the truth attributed everything inside a lambda to the
        // ENCLOSING defn: `(new IllegalArgumentException …)` inside a `fn` inside
        // `assoc` was published as `assoc -> IllegalArgumentException` where the
        // analyzer says `lambda_191_1 -> …`. Same cause as the `uses` owner
        // audit — attribution is a separate question from existence, and a truth
        // that answers the wrong one produces a confident wrong edge.
        nextOwner = `lambda_${n.startPosition.row}_${n.startPosition.column}`
      }
    }
    // CLJ-D45: THE ANONYMOUS-FN SHORTHAND IS A CALL SITE, AND THE WALK NEVER VISITED
    // IT. `#(h %)` parses as an `anon_fn_lit` whose children are the body DIRECTLY —
    // there is no `list_lit` and no `fn` head, so `onList` never fired and every call
    // written in the shorthand was invisible to this truth.
    //
    // That is a big class rather than a curiosity: clojure/core.clj is written in the
    // shorthand, and 55 of the residual edges here were calls like `#(shift-mask s m
    // %)`, `#(seq-reduce …)`, `#(foldvec …)`. The analyzer names the shorthand
    // `lambda_<row>_<col>` from the node's own position, so the owner rule for `fn`
    // has to apply here too or the edge is attributed to the enclosing defn.
    //
    // Firing `onList` for a node the other derivations ignore is safe: each of their
    // callbacks opens with `if (node.type !== "list_lit") return`.
    else if (n.type === "anon_fn_lit" && depth === 0) {
      nextOwner = `lambda_${n.startPosition.row}_${n.startPosition.column}`
      onList(n, owner)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) rec(c, nextOwner, depth) }
  }
  rec(root, nsAt(nsTimeline, 0), 0)
}


/**
 * The alias table for a `require`/`use`/`import` FORM of any shape — the `ns`
 * clause, a top-level `(require …)`, or either nested.
 *
 * The top-level case is not a rarity. clojure/core.clj:7248 reads
 * `(require '[clojure.java.io :as jio])` — a bare call, no `ns` around it — and
 * the analyzer runs the same libspec handler for it, so `jio` is registered. The
 * first version of this read only the `ns` form, so every alias declared by a
 * top-level `require` was missing, and `jio/copy` was derived unresolved where
 * the analyzer derives `clojure.java.io/copy`. It was the largest single
 * contributor to the residual.
 *
 * It returns a TIMELINE rather than one map, because a `require` takes effect
 * from its own position: a call above it is not aliased and one below is, exactly
 * as Clojure's reader would see it.
 */
function aliasTimelineOf(root: Node): { at: number; aliases: Map<string, string> }[] {
  const out: { at: number; aliases: Map<string, string> }[] = []
  // ONE spec, in any of its four shapes, contributing to an alias table. The
  // shapes differ because the two callers differ: an `ns` form holds CLAUSES
  // (`(:require [lib :as a] …)`) whose children are specs, while a top-level
  // `(require '[lib :as a] …)` holds the SPECS ITSELF, quoted. Reading one shape
  // with the other's loop is what missed every top-level `require`.
  const aliasesFromSpec = (m: Map<string, string>, spec: Node): void => {
    let node = spec
    if (node.type === "quote_lit" || node.type === "quoting_lit" || node.type === "syn_quoting_lit") {
      const inner = executionHead(node)
      if (!inner) return
      node = inner
    }
    if (node.type === "sym_lit") return // a bare lib name registers no alias
    if (node.type !== "vec_lit") return
    const rawFirst = node.namedChild(0)
    // CLJ-D54: same unwrap as `aliasTableOf` — a libspec may carry metadata.
    const first = rawFirst && (rawFirst.type === "meta_lit" || rawFirst.type === "quote_lit")
      ? executionHead(rawFirst)
      : rawFirst
    if (!first) return
    if (first.type === "sym_lit") {
      const lib = symName(first)
      for (let q = 1; q < node.namedChildCount; q++) {
        const c = node.namedChild(q)
        if (c && c.type === "kwd_lit") {
          const key = c.childForFieldName("name")?.text ?? ""
          if (key === "as" || key === "as-alias") {
            const a = node.namedChild(q + 1)
            if (a && a.type === "sym_lit") m.set(symName(a), lib)
          }
        }
      }
      return
    }
    if (first.type === "vec_lit") {
      const prefix = first.namedChild(0)
      const prefixName = prefix && prefix.type === "sym_lit" ? symName(prefix) : ""
      if (!prefixName) return
      for (let q = 1; q < first.namedChildCount; q++) {
        const c = first.namedChild(q)
        if (c && c.type === "vec_lit") {
          const sub = c.namedChild(0)
          const subName = sub && sub.type === "sym_lit" ? symName(sub) : ""
          for (let r = 1; r < c.namedChildCount; r++) {
            const kk = c.namedChild(r)
            if (kk && kk.type === "kwd_lit" && (kk.childForFieldName("name")?.text ?? "") === "as") {
              const a = c.namedChild(r + 1)
              if (a && a.type === "sym_lit" && subName) m.set(symName(a), `${prefixName}.${subName}`)
            }
          }
        }
      }
    }
  }

  const visit = (form: Node): void => {
    const m = new Map<string, string>()
    const head = executionHead(form)
    const hname = head && head.type === "sym_lit" ? symName(head) : ""
    if (hname === "ns" || hname === "in-ns") {
      // the CLAUSES: `(:require [lib :as a] …)`
      for (let ci = 1; ci < form.namedChildCount; ci++) {
        const raw = form.namedChild(ci)
        if (!raw) continue
        const clause = (raw.type === "quote_lit" || raw.type === "quoting_lit") ? executionHead(raw) : raw
        if (!clause || clause.type !== "list_lit") continue
        const ck = executionHead(clause)
        const kw = ck && ck.type === "kwd_lit" ? (ck.childForFieldName("name")?.text ?? "") : ""
        if (!LIB_KEYWORDS.has(kw)) continue
        for (let k = 1; k < clause.namedChildCount; k++) { const spec = clause.namedChild(k); if (spec) aliasesFromSpec(m, spec) }
      }
    } else {
      // a top-level `(require …)` / `(use …)`: the CHILDREN ARE THE SPECS
      for (let ci = 1; ci < form.namedChildCount; ci++) { const spec = form.namedChild(ci); if (spec) aliasesFromSpec(m, spec) }
    }
    if (m.size > 0) out.push({ at: form.startIndex, aliases: m })
  }
  const st: Node[] = [root]
  while (st.length > 0) {
    const n = st.pop()!
    if (n.type === "list_lit") {
      const h = executionHead(n)
      const nm = h && h.type === "sym_lit" ? symName(h) : ""
      if (nm === "ns" || nm === "in-ns" || nm === "require" || nm === "use" || nm === "import" || nm === "require-macros" || nm === "use-macros") visit(n)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
  }
  // CLJ-D58: THE TIMELINE MUST BE SORTED BY POSITION BEFORE ANYTHING ASKS "IN FORCE".
  //
  // `namespaceTimeline` sorts; this did not, and the pre-pass here is a LIFO stack, so
  // children are visited in REVERSE sibling order and a later form lands earlier in the
  // array. `aliasesInForce` then does `if (t.at > idx) break` — finds the LATE entry
  // first, and returns an EMPTY table for every position before it.
  //
  // That is not a rare shape. In metabase's hooks/clojure/core/defn.clj the timeline
  // came out as `[{at: 2464}, {at: 0}]`, so every `str/…` and `hooks/…` in the file was
  // published as the bare ALIAS while the analyzer published `clojure.string` and
  // `clj-kondo.hooks-api` — 141 `metabase.util.malli`, 84 `clojure.spec.alpha`, 39 `u`,
  // 31 `hooks`, 19 `str` among the metabase `references` residual.
  //
  // It is invisible on a file with ONE `ns` form, which is why the small corpora looked
  // fine and only the 4,253-file corpus showed it. A one-entry array is sorted by
  // accident; two is not.
  out.sort((a, b) => a.at - b.at)
  return out
}

/** The alias table in force at a byte offset, merged across every form so far. */
/**
 * THE ANALYZER'S `activeFunction` AT EVERY NODE — ONE RULE, SHARED.
 *
 * CLJ-D48 first derived this inside `deriveClojureTypeRelationTruth`, and
 * `instantiates` was still reading `walk`'s owner, which is a different question and
 * gave a different answer on 299 edges. Two derivations, two answers, one language
 * fact — the same lesson as the four alias tables, and the reason this lives at module
 * scope rather than inside a derivation where the next one cannot find it.
 *
 * The rule is the analyzer's own: a call or a constructor is attributed to the
 * innermost enclosing FUNCTION FORM, and to the NAMESPACE when there is none. Which
 * makes three positions `walk`'s owner gets wrong:
 *
 *   · `fn` — the active function is literally the FORM NAME, so `(fn [] (throw
 *     (IllegalArgumentException. …)))` at core.clj:4776 publishes
 *     `fn -> IllegalArgumentException` while `walk` invents `lambda_4772_15`. The
 *     generated lambda name is the CALLS owner (CLJ-D45) and is a different thing.
 *   · a PROXY or DEFTYPE METHOD — `(proxy [ThreadLocal] [] (initialValue [] (doto
 *     (java.text.SimpleDateFormat. …))))` publishes `initialValue -> …`. The method
 *     IS a function form.
 *   · `def` — a var, not a function. `(def pool (delay (ForkJoinPool.)))` publishes
 *     `clojure.core.reducers -> ForkJoinPool`; `walk`'s owner says `pool`.
 *
 * A `defn`-family form takes its own name; a method-impl position takes its head.
 */
/**
 * IS THIS LIST A FUNCTION BOUND IN A DESTRUCTURING FORM?
 *
 * `(let [{:keys [a]} (f [x] …)] …)` — the binding vector's ODD children are values,
 * and a value that is a list headed by a symbol binds that symbol to a function. The
 * position test is the whole of it, which is why it is a separate predicate rather
 * than another entry in a name set: no name identifies this shape.
 */
function isBindingFnPosition(node: Node): boolean {
  if (node.type !== "list_lit") return false
  const vec = node.parent
  if (!vec || vec.type !== "vec_lit") return false
  const form = vec.parent
  if (!form || form.type !== "list_lit") return false
  const fh = executionHead(form)
  const fname = fh && fh.type === "sym_lit" ? symName(fh) : ""
  if (!SHADOW_BINDING_VEC_HEADS.has(fname)) return false
  // It must LOOK like a function: a binding is `(f [args] body)`, and the ARGLIST VECTOR
  // is what separates that from an ordinary call in the same position. Without this the
  // rule matched `(let [result (compute 1)] …)` too, and treating `compute` as the
  // enclosing function moved every constructor in its body: metabase `implements`
  // 100.00% -> 97.60% and the small corpora 100.00% -> 97.75%. The position test alone
  // was not enough, which is the eighth time in this file that one sample was read as a
  // rule - position, prefix, form name, `fn` vs `fn*`, a "def-like" head. The evidence
  // keeps being that a SHAPE is needed and a name never is.
  if (node.namedChild(1)?.type !== "vec_lit") return false
  // the value position of a binding pair
  for (let i = 1; i < vec.namedChildCount; i += 2) {
    if (vec.namedChild(i)?.startIndex === node.startIndex) return true
  }
  return false
}

/** A head's name with any namespace qualifier removed: `mu/defn` -> `defn`. */
function bareHead(head: string): string {
  return head.includes("/") ? head.slice(head.lastIndexOf("/") + 1) : head
}

function activeFunctionOf(root: Node): Map<number, string> {
  const m = new Map<number, string>()
  const rec = (n: Node, fn: string): void => {
    m.set(n.startIndex, fn)
    let next = fn
    // An ANONYMOUS FUNCTION IS OWNED BY ITS GENERATED NAME, `lambda_<row>_<col>`,
    // for both `(fn …)` and the `#(…)` shorthand. I first wrote the form name `fn`
    // here, inferring it from one core.clj sample, and the fixture refuted it
    // immediately: the analyzer publishes `lambda_17_12 -> java.util.HashMap` for
    // `(def via-fn (fn [] (java.util.HashMap.)))`. Where the bare string `fn` appears
    // as a source is a different position again, and one sample was not the evidence.
    const lambdaName = (): string => `lambda_${n.startPosition.row}_${n.startPosition.column}`
    if (n.type === "anon_fn_lit") {
      next = lambdaName()
    } else if (n.type === "list_lit") {
      const h = executionHead(n)
      const nm = h && h.type === "sym_lit" ? symName(h) : ""
      if (nm === "fn") {
        next = lambdaName()
      } else if (nm === "fn*") {
        // `fn*` IS NOT `fn` FOR OWNERSHIP. `(fn* [sig] …)` at core.clj:4773 publishes
        // `fn -> IllegalArgumentException`, while `(fn [] …)` and `#(…)` publish the
        // GENERATED name. One sample of each and they are genuinely two rules, which
        // is the fourth time in this file that a name I assumed was a synonym turned
        // out to be two contracts. `fn*` is the compiler intrinsic the reader expands
        // to, and the analyzer has no lambda-naming for it.
        next = "fn"
      } else if (SHADOW_FN_PARAM_HEADS.has(nm) || SHADOW_FN_PARAM_HEADS.has(bareHead(nm))) {
        // CLJ-D55, AND ONLY HERE. A FUNCTION-BOUNDARY test, not a DEFINITION test.
        //
        // metabase defines thousands of functions with `mu/defn`, so
        // `(mu/defn do-with-resolved-connection-data-source …)` has to be a function
        // boundary or the constructor at :283 inside its body is attributed to the
        // namespace. Widening `isDefLikeHead` for this was tried first and is WRONG: that
        // function answers "is this a DEFINITION", and `contains` uses it, so making
        // `mu/defn` def-like added 14 missed containments on the small corpora and 1,948
        // on metabase while changing implements and extends by exactly nothing. The
        // qualifier is a namespace and not part of the macro's name, so strip it HERE and
        // leave the definition test alone — the two questions were being conflated, which
        // is the same shape as CLJ-D51's two derivations disagreeing.
        const dn = defNameOf(n)
        if (dn) next = dn
      } else if (isBindingFnPosition(n) && h && h.type === "sym_lit") {
        // CLJ-D57: A FUNCTION BOUND IN A DESTRUCTURING FORM IS A FUNCTION BOUNDARY.
        //
        // `(let [{:keys [session-key]} (saml-request [url] (with-open [in
        // (java.util.zip.InflaterInputStream. …)] …))] …)` binds `saml-request` to a
        // function, and the constructors inside its body belong to it — the analyzer
        // publishes `saml-request -> java.util.zip.InflaterInputStream` and it is right,
        // because that IS the function being run. The truth attributed them to the
        // enclosing `saml-logout-session-index`, i.e. to a `deftest` that is not running
        // anything.
        //
        // This is CLJ-D51's rule again at a position none of the four families cover: it
        // is not a `defn`, not a special form, not a proxy method and not an anonymous
        // fn. A binding-position list whose head is a symbol is a function, and the
        // binding vector's ODD children are the values, so the even/odd position is the
        // whole test — the same parity idea as CLJ-D36's `case` constants, applied to
        // destructuring instead.
        const mn = symName(h)
        if (mn) next = mn
      } else if (isMethodImplPosition(n) && h && h.type === "sym_lit") {
        const mn = symName(h)
        if (mn && !isAnonArgShorthand(mn)) next = mn
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) rec(c, next) }
  }
  rec(root, "")
  return m
}

function aliasesInForce(timeline: { at: number; aliases: Map<string, string> }[], idx: number): Map<string, string> {
  const m = new Map<string, string>()
  for (const t of timeline) { if (t.at > idx) break; for (const [k, v] of t.aliases) m.set(k, v) }
  return m
}

/**
 * Is this list a METHOD DEFINITION rather than a call?
 *
 * C9: the DIRECT list children of a protocol-extending form are method
 * definitions. `(px [_] 3)` is not a call to `px`; it defines `px`. A `defprotocol`
 * or `definterface` SIGNATURE is the same thing — a declaration.
 *
 * The test is STRUCTURAL, and that is the whole point. The first version asked
 * whether the node's own form NAME was one of the extending forms, which
 * describes the PARENT and not the node, so it never fired: `isRealized`,
 * `isCancelled`, `cancel`, `invoke` and `iterator` were all derived as calls and
 * none of them is published. A method's name is whatever the protocol says it is,
 * so the form name of the CHILD carries no information at all — the position
 * does.
 */
function isMethodImplPosition(node: Node): boolean {
  const parent = node.parent
  if (!parent || parent.type !== "list_lit") return false
  const ph = executionHead(parent)
  if (!ph || ph.type !== "sym_lit") return false
  const pname = symName(ph)
  if (!METHOD_IMPL_FORMS.has(pname)) return false
  // the extending form's own HEAD is not a method
  return parent.namedChild(0)?.startIndex !== node.startIndex
}

/** CLJ-D7/D22: is this list inside an `ns` libspec clause? That data, not code. */
const LIBSPEC_FORMS = new Set(["require", "use", "import", "refer", "refer-clojure", "require-macros", "use-macros", "refer-macros"])
function isLibspecSite(n: Node): boolean {
  for (let anc: Node | null = n.parent; anc; anc = anc.parent) {
    if (anc.type !== "list_lit") continue
    const h = executionHead(anc)
    if (!h) continue
    // The head is read as TEXT with any leading colon removed, which covers both
    // spellings a libspec clause takes: the symbol form `(:use …)` is a
    // KEYWORD-headed list whose text is ":use", and the bare form
    // `(require …)` is sym-headed. Reading the `name` FIELD alone missed the
    // keyword case, and every `:only` list in a `:use` clause was then read as
    // code — pprint.clj:14, test_helper.clj:18 and pipeline_test.clj:2 each
    // demanded a `contains` for the `is` in `(deftest is are)`.
    const head = h.text ?? ""
    const bare = head.charCodeAt(0) === 58 /* : */ ? head.slice(1) : head
    if (LIBSPEC_FORMS.has(bare)) return true
  }
  return false
}

/**
 * F7 / CLJ-D36: is this list in a CONSTANT position of a `case`?
 *
 * children = [case, expr, test…, expr…, default?] over EXECUTABLE children only
 * (a comment is not a position). The constants are at even positions from 2, and
 * the optional default is the last one when the count is odd.
 */
function isCaseConstant(n: Node): boolean {
  const parent = n.parent
  if (!parent || parent.type !== "list_lit") return false
  const ph = executionHead(parent)
  if (!ph || ph.type !== "sym_lit" || symName(ph) !== "case") return false
  const exec: Node[] = []
  for (let i = 0; i < parent.namedChildCount; i++) {
    const c = parent.namedChild(i)
    if (!c || c.type === "comment" || c.type === "dis_expr") continue
    exec.push(c)
  }
  const defaultPos = exec.length % 2 === 1 ? exec.length - 1 : -1
  for (let pos = 2; pos < exec.length; pos += 2) {
    if (pos === defaultPos) continue
    // Compared by startIndex, never by reference: each `namedChild()` call
    // returns a FRESH JS wrapper, so `exec[pos] === n` is false for the very
    // node it came from, and the rule silently matched nothing.
    if (exec[pos]!.startIndex === n.startIndex) return true
  }
  return false
}


/**
 * THE NAME A DEF-FAMILY FORM BINDS, looking past the things that may sit
 * between the head and the name.
 *
 * Clojure puts metadata on a definition's name constantly — `^:private`,
 * `^{:doc "…"}`, `^{:clj-kondo/ignore [...]}` — and the analyzer reads past all of
 * it. The truth read only `namedChild(1)`, so `(deftest ^:parallel tricky …)` and
 * metabase's `(deftest ^:parallel complicated-test-1 …)` under a
 * `^{:clj-kondo/ignore …}` each produced an edge with a target that was not the
 * name. A truth that guesses wrong about WHICH name a form binds is worse than
 * one that derives nothing, because its answer looks like a real finding.
 *
 * The scan is positional, not clever: past the head, skip every metadata form,
 * then skip a docstring and an attribute map, and the first SYMBOL_LIT left is
 * the name. A def form with no symbol in any of those positions binds nothing,
 * which is the honest answer.
 */
function defNameOf(node: Node): string {
  // ONLY metadata is skipped, and the scan stops at the first thing that is not
  // metadata. An earlier version also skipped docstrings and attribute maps,
  // which let the scan reach PAST the name on a form whose second child is not
  // one — and it then picked up an ARGUMENT: metabase/cmd/reset_password.clj
  // produced `contains -> email-address` for the `let` parameter of
  // `(cmd.db/user-id-and-active-by-email email-address)`, and
  // revisions/impl/dashboard.clj produced one for `num-cards-diff`. Ten
  // fabricated edges to fix two real ones is a bad trade, and the lesson is the
  // narrow one: skip exactly the case that occurs, and stop at everything else.
  // CLJ-D56: METADATA MAY PRECEDE THE HEAD, AND IT SHIFTS THE NAME.
  //
  // When a form carries leading metadata the grammar folds the metadata INTO the
  // `list_lit`, so it becomes `namedChild(0)` and pushes the head to index 1:
  //
  //   list_lit  ^{:clj-kondo/ignore [...]} (deftest ^:parallel complicated-test-1 …)
  //     meta_lit   ^:clj-kondo/ignore […]        <- child 0
  //     sym_lit    deftest                       <- child 1  (the HEAD, not the name)
  //     sym_lit    ^:parallel complicated-test-1 <- child 2  (the NAME, inside metadata)
  //
  // Scanning from a fixed index 1 therefore returned `deftest` — the MACRO — and metabase
  // got two `contains -> deftest` edges with no line, in both
  // sql_tools/macaw/references_test.clj:1272 and sql_tools/sqlglot/references_test.clj:1261.
  // Two positions, not one: the name may be wrapped in metadata (`^:parallel
  // complicated-test-1`) as well as preceded by it.
  //
  // So: find the HEAD as the first child that is not metadata, then scan from the one
  // after it, and unwrap metadata at the name position rather than skipping past it.
  let head = 0
  while (head < node.namedChildCount && node.namedChild(head)?.type === "meta_lit") head++
  let i = head + 1
  while (i < node.namedChildCount) {
    const c = node.namedChild(i)
    if (!c) return ""
    if (c.type === "meta_lit") {
      const inner = executionHead(c)
      if (inner && inner.type === "sym_lit") return symName(inner)
      i++
      continue
    }
    return c.type === "sym_lit" ? symName(c) : ""
  }
  return ""
}

/** C9: forms whose DIRECT list children are METHOD DEFINITIONS, never calls. */
const METHOD_IMPL_FORMS = new Set(["reify", "extend-type", "extend-protocol", "proxy", "defrecord", "deftype", "defprotocol", "definterface"])

/** Is this list a DIRECT child of the file root? That is what "top level" means. */
function isTopLevelChild(n: Node): boolean {
  const p = n.parent
  if (!p) return false
  if (p.type === "source") return true
  // a wrapper (meta_lit, reader conditional) still counts as the root level
  return p.type !== "list_lit" && p.type !== "vec_lit" && p.type !== "map_lit" && p.type !== "set_lit"
}

/** The same def-like test the analyzer uses, spelled the same way (CLJ-D30). */
function isDefLikeHead(head: string): boolean {
  if (head.length < 3) return false
  if (head.charCodeAt(0) !== 100 || head.charCodeAt(1) !== 101 || head.charCodeAt(2) !== 102) return false
  if (head.length === 3) return true
  const c3 = head.charCodeAt(3)
  if (c3 !== 45 && c3 !== 95) {
    if (head.startsWith("default") || head.startsWith("define")) return false
    return true
  }
  return true
}

/** Forms whose BODY IS NOT CODE — the analyzer honours this, so the truth must. */
/**
 * TRUTH for `uses` — the Java member/field access class.
 *
 * A site qualifies when its execution head is a `sym_lit` whose name starts with
 * a dot and is not `..` (which is a chain operator, not a member — the analyzer
 * had this defect and the comment at the emission site still records it). The
 * member is the name with the leading `.`/`.-` removed.
 *
 * TWO PLACES WHERE A SITE IS NOT CODE, both measured rather than assumed:
 *
 * 1. `..` is not a member. The first version of this function had it fixed
 *    upstream; the residual re-proved it (a `uses -> "."` edge, garbage
 *    identity).
 * 2. INSIDE `comment`, `quote` OR A SYNTAX QUOTE, a `(.reset v 1)` is DATA, not
 *    a call this file makes. clojure/core.clj:2564 is the proof: `vswap!` builds
 *    `` `(.reset ~v (~f (.deref ~v) ~@args)) `` — the analyzer correctly emits
 *    no `uses` for it, and the first version of this truth reported all 127 such
 *    sites as MISSED. tree-sitter-clojure names the wrappers `syn_quoting_lit`,
 *    `quoting_lit` and `quote_lit`, and `comment` is an ordinary head, so all
 *    three spellings are excluded.
 *
 * Nothing is filtered by resolvability, because `pushRel` does not filter: an
 * unresolvable member is still emitted, and a truth that quietly dropped the
 * unresolvable ones would be unable to see an analyzer that dropped real ones.
 */
export function deriveClojureUsesTruth(root: Node): TruthEdge[] {
  const out: TruthEdge[] = []
  const seen = new Set<string>()
  walk(root, (node, owner) => {
    const head = executionHead(node)
    if (!head || head.type !== "sym_lit") return
    const formName = symName(head)
    if (!formName.startsWith(".") || formName === "..") return
    if (NON_CODE_HEADS.has(formName)) return
    const target = formName.startsWith(".-") ? formName.slice(2) : formName.slice(1)
    if (!target) return
    const e: TruthEdge = {
      source: owner,
      target,
      type: ASTEngine.RelationshipType.Uses,
      line: head.startPosition.row + 1,
      callArity: callArityOf(node),
    }
    const k = edgeKey(e)
    if (seen.has(k)) return
    seen.add(k)
    out.push(e)
  })
  return out
}

/**
 * TRUTH for STATIC interop — `Class/.member`, a second `uses` class (CLJ-D32).
 *
 * A static member access names a member of a class, exactly as `(.method obj)`
 * does, so both forms are `uses` edges. The static form carries one extra fact —
 * WHICH CLASS — so it derives TWO edges: the member at the form's arity, and the
 * class at arity 0. Neither is filtered by resolvability, for the same reason the
 * instance form is not: `pushRel` does not filter.
 *
 * The discriminator is the `/.`, not a bare `/`: `str/join` and
 * `clojure.string/trim` qualify a NAMESPACE and stay ordinary calls. And the
 * uncurried statics in the core list (`Integer/parseInt`, `Math/abs`) are
 * suppressed by the analyzer before this point, so they are excluded here too —
 * otherwise the truth would demand an edge the analyzer deliberately omits.
 */
export function deriveClojureStaticUsesTruth(root: Node, isSuppressed: (head: string) => boolean): TruthEdge[] {
  const out: TruthEdge[] = []
  const seen = new Set<string>()
  walk(root, (node, owner) => {
    const head = executionHead(node)
    if (!head || head.type !== "sym_lit") return
    const formName = symName(head)
    if (NON_CODE_HEADS.has(formName)) return
    if (isSuppressed(formName)) return
    // A static head is `Class/.member` — it does NOT start with a dot, which is
    // what distinguishes it from the instance form. The `/.` test below is the
    // discriminator; there is no leading-dot test to make here, and the first
    // version of this function had one, which rejected every real static site.
    const slash = formName.lastIndexOf("/")
    if (slash <= 0) return
    // BOTH dot positions: `Class/.member` and `Class./member`. The third
    // spelling, `Class/member`, is a NAMESPACE-qualified call and stays one —
    // `str/join` and `clojure.string/trim` have the identical shape, so a rule
    // that promoted it would fabricate a member access for every qualified call
    // in the corpus. The CLJ-D32 fixture is what found the second spelling
    // missing: `java.io.File./getName` was emitting a dangling
    // `calls -> java.io.File./getName`.
    const afterDot = formName.charCodeAt(slash + 1) === 46
    const beforeDot = formName.charCodeAt(slash - 1) === 46
    if (!afterDot && !beforeDot) return
    const member = afterDot ? formName.slice(slash + 2) : formName.slice(slash + 1)
    const cls = afterDot ? formName.slice(0, slash) : formName.slice(0, slash - 1)
    if (!member || !cls) return
    const line = head.startPosition.row + 1
    for (const e of [
      { source: owner, target: member, type: ASTEngine.RelationshipType.Uses, line, callArity: callArityOf(node) },
      { source: owner, target: cls, type: ASTEngine.RelationshipType.Uses, line, callArity: 0 },
    ] as TruthEdge[]) {
      const k = edgeKey(e)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(e)
    }
  })
  return out
}

/**
 * TRUTH for `contains` — the INDEPENDENTLY DERIVED MINIMUM.
 *
 * `contains` is emitted per-symbol from the analyzer's own `ownerName`, so a
 * truth that re-read `ownerName` would be tautological (the nim shared-ground-
 * truth precedent, and it is labelled as such where it applies). But the MINIMUM
 * is independent of ownership judgment: every top-level def in a file that
 * declares a namespace is, by definition, contained by that namespace. That
 * minimum is derived here from the tree, with no reference to the analyzer.
 *
 * THREE RULES THIS HAD TO LEARN, each from a real residual rather than theory:
 *
 * 1. DEDUPE BY (owner, name), KEEPING THE EARLIEST DECLARATION. A namespace
 *    contains a NAME, not a name once per occurrence. clojure/core.clj proves it:
 *    `map` is declared at 1727 and again at 2745, `dotimes` at 2730 and 3329,
 *    `let` at 32 and 4711. `(declare HEADER)` at gen_math.clj:16 followed by
 *    `(def ^String HEADER …)` at 119 is the same story. Expecting an edge per
 *    definition invents a residual for correct behaviour — the first version of
 *    this function did, on 793 sites.
 *
 * 2. A FORM INSIDE `comment` OR `quote` IS NOT CODE. The analyzer honours this
 *    (its walk skips both bodies, unless the name is locally rebound); a
 *    definition under either is commented out or data, so a containment edge for
 *    it would claim a definition that does not exist.
 *
 * 3. THE LINE IS THE FIRST DECLARATION'S LINE. Not "whichever symbol the walk
 *    met first": push order is not source order, so a name with two symbols can
 *    land on the later one. Pinning the earliest line makes the class
 *    deterministic, which is what lets check 2 below be a real check.
 */

export function deriveClojureContainsTruth(root: Node): { edges: TruthEdge[]; namespace: string } {
  const timeline = namespaceTimeline(root)
  // EVERY def-family form, at ANY depth, with the form that lexically encloses
  // it. The first version of this derived TOP-LEVEL forms only, which is wrong in
  // two directions: a `defmethod` nested inside a data structure
  // (metabase/modules/drivers/athena/…/athena.clj:59, inside a `supported?` map
  // in a `let`) defines a var just as a top-level one does, and the analyzer sees
  // both. Reporting only the top-level one made the analyzer's edge — which
  // correctly points at the earlier, nested definition — look like 17 missing
  // containments.
  //
  // And an INNER definition is contained by the enclosing DEFINITION, not by the
  // namespace: a `defn` inside a `defn` makes the inner one a member of the outer
  // one. `walk` already tracks that owner, so this reuses it rather than keeping
  // a second walk that could disagree.
  const earliest = new Map<string, number>()
  walk(root, (node, owner) => {
    if (node.type !== "list_lit") return
    const h = executionHead(node)
    const nm = h && h.type === "sym_lit" ? symName(h) : ""
    // A FORWARD DECLARATION is not a definition (CLJ-D23) — `(declare cat
    // select-keys)` at core.clj:2799 precedes `(defn cat …)` at 7980, and an edge
    // pointing at the declare would claim the namespace defines `cat` where it
    // only promises to.
    if (nm === "declare") return
    if (!DEF_HEADS.has(nm) && !isDefLikeHead(nm)) return
    const dn = defNameOf(node)
    if (!dn) return
    // THE OWNER IS THE NAMESPACE, AT EVERY DEPTH. A `defn` interns a var in the
    // current namespace whatever encloses it lexically — `(defn outer [] (defn
    // inner [] 1))` defines `inner` in the namespace, not inside `outer`. The
    // first version of this used the lexically enclosing DEFINITION as the owner,
    // which is the right rule for CALL attribution (an `activeFunction`) and the
    // wrong one for containment: it demanded
    // `clickhouse-temporal-bucketing-server-tz -> start-of-year!` for a
    // `defn-` inside a `deftest` body, and the analyzer — correctly — owned it
    // by the namespace. 62 edges across metabase.
    const src = nsAt(timeline, node.startIndex)
    if (!src) return
    const k = `${src}->${dn}`
    const prev = earliest.get(k)
    // CLJ-D56: A CONTAINMENT IS ANCHORED AT THE FORM'S START, which for a form with
    // LEADING metadata is the line the `^{…}` is on, not the line the head is on. The
    // analyzer anchors there because that is where the symbol's RANGE starts, and
    // `sql_tools/sqlglot/references_test.clj` is the case that shows it: the truth said
    // 1261 (`(deftest …)`) while the analyzer said 1260 (`^{:clj-kondo/ignore …}`).
    // For every form without leading metadata the two are the same line, so this is a
    // no-op everywhere else.
    const startLine = node.startPosition.row + 1
    if (prev === undefined || startLine < prev) earliest.set(k, startLine)
  })
  const edges: TruthEdge[] = []
  for (const [k, line] of earliest) {
    const split = k.indexOf("->")
    edges.push({ source: k.slice(0, split), target: k.slice(split + 2), type: ASTEngine.RelationshipType.Contains, line })
  }
  const namespace = timeline.length > 0 ? timeline[timeline.length - 1]!.name : ""
  return { edges, namespace }
}

// ══════════════════════════════════════════════════════════════════════════
// THE REMAINING FOUR CLASSES. `uses` and `contains` were derived above; these
// close the rest, so that no relationship the clojure analyzer emits is
// unexamined. Each is read from the tree for the same reason the first two are:
// an unexamined class is not a class anyone can claim is complete.
//
//   references   the `ns` libspec edges — which namespace depends on which.
//                `:require`/`:use`/`:import` name a LIB; `:refer`/`:only`/`:rename`
//                name a SYMBOL in a lib, and the analyzer emits a reference to
//                the lib for the first and nothing for the rest (`:refer :all`
//                included — a whole-library refer has no single name to point
//                at, and that is the honest reading rather than a wildcard).
//   instantiates  a CONSTRUCTOR: `(new Class …)`, `(Class. …)`, and the `->Class`
//                / `->>Class` ctor idiom. Distinct from `uses`, which is a member
//                access, and from a static `Class/.member`, which is also a
//                member access — a constructor names a class to BUILD.
//   implements   `(deftype X A …)` / `(defrecord X A …)` declare supertypes and
//                protocols; `(extend-type T P (m …))` and
//                `(extend-protocol P T (m …))` declare an extension; `(proxy [A]
//                T …)` and `(reify T …)` declare a supertype.
//   extends      the `Object`-level supertype position, kept separate because the
//                analyzer keeps it separate.
// ══════════════════════════════════════════════════════════════════════════

const LIB_KEYWORDS = new Set(["require", "use", "import", "refer-clojure", "require-macros", "use-macros"])

/**
 * The reference TARGET of a libspec entry, and the LINE the edge carries.
 *
 * Four syntactic shapes, and the analyzer treats the twins identically on
 * purpose — `(:import [java.util Date])` and `(:import (java.util Date))` both
 * reference the PACKAGE, and the class is an import, not a reference:
 *
 *   `[clojure.string :as str]`  → `clojure.string`, at the vector's line
 *   `clojure.core`              → `clojure.core`,  at the symbol's line
 *   `[:require (java.util Date)]` the PAREN form: index 0 is the package and it
 *   `[:import (java.lang Character Date)]`  is referenced at the PACKAGE's line
 *   `[[clojure [string :as s]]]` a PREFIX list: the head is the prefix, and each
 *                                `[sub :as a]` additionally references `prefix.sub`
 *
 * The paren form was the whole of 1,113 fabrications: `libNameOf` returned "" for
 * it, so `(:import (java.lang Character))` produced no edge where the analyzer
 * produced one.
 */
function libNameOf(spec: Node): string {
  if (spec.type === "sym_lit") return symName(spec)
  if (spec.type === "list_lit") {
    // `(:import (java.util Date UUID))` — index 0 is the package.
    const pkg = spec.namedChild(0)
    return pkg && pkg.type === "sym_lit" ? symName(pkg) : ""
  }
  if (spec.type === "vec_lit") {
    const first = spec.namedChild(0)
    if (!first) return ""
    if (first.type === "sym_lit") return symName(first)
    if (first.type === "vec_lit") {
      const p0 = first.namedChild(0)
      return p0 && p0.type === "sym_lit" ? symName(p0) : ""
    }
  }
  return ""
}

/** A PREFIX list's `prefix.sub` targets — `[[clojure [string :as s]]]` → `clojure.string`. */
function prefixSubTargets(spec: Node): string[] {
  if (spec.type !== "vec_lit") return []
  const first = spec.namedChild(0)
  if (!first || first.type !== "vec_lit") return []
  const prefix = first.namedChild(0)
  const prefixName = prefix && prefix.type === "sym_lit" ? symName(prefix) : ""
  if (!prefixName) return []
  const out: string[] = []
  for (let q = 1; q < first.namedChildCount; q++) {
    const c = first.namedChild(q)
    if (!c || c.type !== "vec_lit") continue
    const sub = c.namedChild(0)
    if (sub && sub.type === "sym_lit") out.push(`${prefixName}.${symName(sub)}`)
  }
  return out
}

/** Is this spec an alias-only entry (`:as-alias`), which registers no library? */
function isAsAliasOnly(spec: Node): boolean {
  if (spec.type !== "vec_lit") return false
  for (let i = 0; i < spec.namedChildCount; i++) {
    const c = spec.namedChild(i)
    if (c && c.type === "kwd_lit") {
      const k = c.childForFieldName("name")?.text ?? ""
      if (k === "as-alias") return true
    }
  }
  return false
}

export type RelEdge = { label: string; from: string; to: string; line: number }

/**
 * TRUTH for `references` — the namespace's own dependency edges.
 *
 * One edge per libspec entry, at the SPEC's line, from the namespace in force
 * there. A `:refer :all` or a bare `:refer-clojure` with no `:exclude` names no
 * single symbol, so it contributes no reference: publishing a wildcard target
 * would be a name nothing can refer to.
 */
export function deriveClojureReferencesTruth(root: Node, isSuppressed: (name: string) => boolean = () => false): RelEdge[] {
  const out: RelEdge[] = []
  const seen = new Set<string>()
  const st: Node[] = [root]
  // THE SECOND SOURCE, and the one that accounted for 4,784 of the 4,840
  // residuals: a reference is not only the ns CLAUSE, it is also a USE of an
  // ALIASED name. The analyzer emits `references: <ns> -> <lib>` wherever a
  // qualified head's alias resolves to a different namespace — at the CALL's
  // line, not at the require — and both the generic call branch and the
  // threading-step branch do it. So `(-> x (str/join "," xs))` in a file that
  // aliased `str` to `clojure.string` produces a dependency edge at the step's
  // own line, which is the only place a reader learns the thread step reaches
  // into another library.
  //
  // A SELF-QUALIFIED call (`corpus.invalid-arity.order/def` inside that very
  // namespace) is a lexical no-op as a dependency and never a self-loop, so
  // `resolvedNs !== currentNamespace` is part of the RULE and not a guard added
  // afterwards.
  const timeline = namespaceTimeline(root)
  // CLJ-D50: THE ALIAS TIMELINE, NOT THE `ns` FORM.
  //
  // This derivation read its aliases from `namespaceTimeline`, which only sees the
  // `ns` form's clauses. A TOP-LEVEL `(require '[clojure.java.io :as jio])` is not in
  // an `ns` form at all, so `jio` was never in the table and core.clj:7267 published
  // the bare, unresolvable `references: clojure.core -> jio`.
  //
  // This is CLJ-D40's defect in a derivation CLJ-D40 never reached, and it was
  // INVISIBLE while the shared alias table was also wrong about prefix lists: two
  // errors in the same direction cancel in a diff. `aliasTimelineOf` handles the
  // quoted top-level form, the `:as-alias` positional spelling and the relative
  // libspec, and it is already the `calls` derivation's source — one reader, one
  // answer.
  const aliasTl = aliasTimelineOf(root)
  const walkAliasedUses = (): void => {
    walk(root, (node) => {
      if (node.type !== "list_lit") return
      if (isLibspecSite(node) || isCaseConstant(node)) return
      const h = executionHead(node)
      if (!h || h.type !== "sym_lit") return
      const form = symName(h)
      if (NON_CODE_HEADS.has(form)) return
      const al = aliasesInForce(aliasTl, node.startIndex)
      const ns = nsAt(timeline, node.startIndex)
      const mark = (name: string, line: number) => {
        const slash = name.indexOf("/")
        if (slash <= 0) return
        // A SUPPRESSED call emits no edge of any label — the analyzer's core gate
        // fires before the reference, so `Math/abs` and `Integer/parseInt`, which
        // are in the derived core list as uncurried interop statics, are not
        // dependencies on anything. Without this the truth derived 426 edges the
        // analyzer deliberately does not publish.
        if (isSuppressed(name)) return
        // A QUALIFIED HEAD REFERENCES ITS NAMESPACE, whether or not the name is
        // a known alias. The analyzer reads the head's `namespace` field and
        // resolves it as `namespaceAliases[alias] || alias`, so `(clojure.lang.RT/conj x)`
        // in clojure/core.clj publishes `clojure.core -> clojure.lang.RT` — a real
        // dependency on a Java class, arrived at by the same rule as an alias.
        //
        // My first version required the prefix to BE a declared alias, which is
        // the stricter reading and the wrong one: it dropped every Java
        // interop head, because a class name is never in the alias table. 1,062
        // fabrications, and the fix is one `??`.
        const prefix = name.slice(0, slash)
        const resolved = al.get(prefix) ?? prefix
        // CLJ-D50, THE OTHER HALF: the FROM side needs the fallback chain CLJ-D47
        // gave the `calls` derivation. `nsAt` returns "" for a file with no `ns` form
        // and the analyzer attributes those references to `user`, so 70 edges in this
        // corpus were published as `references||…` — a relationship with only one end,
        // which is what the "all extracted, resolved and emitted" contract exists to
        // prevent. The two halves drifting apart is the same lesson as the alias
        // tables: one language fact re-derived in four places, each copy differing.
        const from = ns !== "" ? ns : "user"
        if (resolved === from) return
        const id = `references|${from}->${resolved}@${line}`
        if (seen.has(id)) return
        seen.add(id)
        out.push({ label: "references", from, to: resolved, line })
      }
      // NOT yet restricted to call-shaped positions. Restricting it traded 31
      // fewer misses for 653 MORE fabrications — a worse net residual (894
      // against 631) — which is the signature of a rule still not understood
      // rather than of a missing case. The honest state is measured and left
      // alone: the class is REPORTED, not enforced, and the residual is written
      // down instead of being tuned until the number looks good. Two things are
      // known and not yet modelled: a qualified SYMBOL in a binding vector, map
      // value or vector element is a NAME and not a dependency, and a
      // method-impl position (the direct list children of reify/extend-type/
      // defrecord — C9) is a definition and not a call. Both are recorded in the
      // gate's output as the class's remaining rules.
      mark(form, h.startPosition.row + 1)
      if (form === "->" || form === "->>" || form === "some->" || form === "some->>" || form === "cond->" || form === "cond->>" || form === "doto") {
        for (let i = 2; i < node.namedChildCount; i++) {
          const step = node.namedChild(i)
          if (!step) continue
          const sh = step.type === "list_lit" ? executionHead(step) : step
          if (!sh || sh.type !== "sym_lit") continue
          mark(symName(sh), sh.startPosition.row + 1)
        }
      }
    })
  }
  while (st.length > 0) {
    const n = st.pop()!
    if (n.type === "list_lit") {
      const h = executionHead(n)
      if (h && h.type === "sym_lit") {
        const nm = symName(h)
        if ((nm === "ns" || nm === "in-ns") && n.namedChildCount > 1) {
          const v = namespaceNameOf(n.namedChild(1))
          for (let i = 1; i < n.namedChildCount; i++) {
            const clause = n.namedChild(i)
            if (!clause || clause.type !== "list_lit") continue
            const ck = executionHead(clause)
            const kw = ck && ck.type === "kwd_lit" ? (ck.childForFieldName("name")?.text ?? "") : ""
            if (!LIB_KEYWORDS.has(kw)) continue
            for (let k = 1; k < clause.namedChildCount; k++) {
              const spec = clause.namedChild(k)
              if (!spec) continue
              if (spec.type === "kwd_lit") {
                const key = spec.childForFieldName("name")?.text ?? ""
                // A `:refer`/`:only`/`:exclude`/`:as` KEY is not a lib, and its
                // value list was already read as the previous spec.
                if (key === "refer" || key === "only" || key === "exclude" || key === "as" || key === "as-alias" || key === "rename" || key === "refer-clojure") continue
                continue
              }
              if (isAsAliasOnly(spec)) continue
              const lib = libNameOf(spec)
              const line = spec.startPosition.row + 1
              if (lib) {
                const id = `${v}->${lib}@${line}`
                if (!seen.has(id)) { seen.add(id); out.push({ label: "references", from: v, to: lib, line }) }
              }
              // A PREFIX list references each `prefix.sub` as well, and the
              // analyzer emits those at the sub-list's own line.
              for (const sub of prefixSubTargets(spec)) {
                const subNode = spec.namedChild(0)
                const sid = `${v}->${sub}@${line}`
                if (seen.has(sid)) continue
                seen.add(sid)
                out.push({ label: "references", from: v, to: sub, line: subNode ? line : line })
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
  }
  walkAliasedUses()
  return out
}

/** The ctor class of a form, or null: `(new C …)`, `(C. …)`, `(->C …)`. */
function ctorClassOf(node: Node): string | null {
  const h = executionHead(node)
  if (!h || h.type !== "sym_lit") return null
  const form = symName(h)
  if (form === "new") {
    const arg = node.namedChild(1)
    return arg && arg.type === "sym_lit" ? symName(arg) : null
  }
  if (form.endsWith(".") && form.length > 1 && !form.startsWith(".")) return form.slice(0, -1)
  // CLJ-D51, THE PART THAT IS NOT DERIVABLE: a static factory call `Class/method`
  // is an `instantiates` edge ONLY when the method is a record factory —
  // `RecordToTestStatics1/create` at test_clojure/protocols.clj:291 is, and
  // `Integer/parseInt` is not. Adding the shape unconditionally took `instantiates`
  // from 99.62% to 66.67%, 520 fabricated edges, which is the measurement that says
  // it cannot be decided from one file: telling a record factory from an ordinary
  // static method needs to know that `RecordToTestStatics1` IS a record, and that is
  // cross-file type knowledge. Recorded rather than guessed.
  if (form.startsWith("->") && form.length > 2 && form !== "->>") {
    const cls = form.slice(2)
    const namePart = cls.includes("/") ? cls.slice(cls.indexOf("/") + 1) : cls
    const lastSeg = namePart.includes(".") ? namePart.slice(namePart.lastIndexOf(".") + 1) : namePart
    const c0 = lastSeg.charCodeAt(0)
    if (c0 >= 65 && c0 <= 90) return cls
  }
  return null
}

/** A class the record/type/protocol names as a supertype, or null. */
function supertypeArgOf(node: Node, from: number): string | null {
  for (let i = from; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) return null
    if (c.type === "sym_lit") {
      const nm = symName(c)
      // A docstring, an attribute map or a class NAME position.
      if (i === from) return null
      return nm
    }
    if (c.type === "str_lit" || c.type === "map_lit" || c.type === "meta_lit") continue
    return null
  }
  return null
}

/**
 * TRUTH for `instantiates` and the type/protocol class.
 *
 * `instantiates` is a CONSTRUCTOR: the class is BUILT. A `uses` edge is a member
 * READ, so the two never overlap — `(java.io.File. "x")` instantiates and
 * `(.getName f)` uses, and a static `File./getName` uses without instantiating.
 * The ctor class of `->Class` must end in an uppercase segment, which is the
 * same test the analyzer uses and the reason `->` is not mistaken for the
 * threading macro.
 */
export function deriveClojureInstantiatesTruth(root: Node): RelEdge[] {
  const out: RelEdge[] = []
  const seen = new Set<string>()
  const tl = namespaceTimeline(root)
  const activeFn = activeFunctionOf(root)
  walk(root, (node, owner) => {
    if (node.type !== "list_lit") return
    if (isLibspecSite(node) || isCaseConstant(node)) return
    const h = executionHead(node)
    if (!h || h.type !== "sym_lit") return
    const form = symName(h)
    if (form === "comment" || form === "quote") return
    const cls0 = ctorClassOf(node)
    if (!cls0) return
    const cls = resolveAlias(cls0, aliasesAt(tl, node.startIndex))
    const line = h.startPosition.row + 1
    // CLJ-D48, THE `instantiates` HALF: the source is the analyzer's `activeFunction`
    // and not `walk`'s owner. 299 edges, and the three positions that differ are listed
    // at `activeFunctionOf` above.
    // The fallback is the NAMESPACE, not `walk`'s owner. `owner` is a different
    // question — it tracks `def` — and `(def via-def (delay (java.io.StringReader. …)))`
    // publishes `clj.fixture.activefn -> java.io.StringReader`, because a `def` creates
    // a var and not a function.
    // …and where there is no `ns` either, the analyzer attributes to Clojure's default
    // namespace, `user` — CLJ-D47's chain again, and the second derivation in this file
    // to need it. `instantiates||java.io.File` is the shape.
    const src = activeFn.get(node.startIndex) || nsAt(tl, node.startIndex) || "user"
    const id = `${src}->${cls}@${line}`
    if (seen.has(id)) return
    seen.add(id)
    out.push({ label: "instantiates", from: src, to: cls, line })
  })
  return out
}

/**
 * TRUTH for `implements` / `extends` — what a type or extension declares.
 *
 * These were the two rules I got most wrong: the first version derived 26 truth
 * edges against 444 emitted, which indicts the DERIVATION and not the analyzer.
 * Rewritten against the analyzer's five emission sites, each of which is a
 * different shape:
 *
 * 1. `(defrecord R Docstring? [fields…] Proto…)` — protocols start at index
 *    **3**, not 2, because index 2 is the FIELD VECTOR. Every one is
 *    `implements`; a record does not extend anything on this label.
 * 2. `(reify P …)` — every child from index 1 is a protocol, and the SOURCE is
 *    the ENCLOSING CONTEXT, not the reify (a reify has no name of its own).
 * 3. `(extend-protocol P Type …)` — index 1 is the PROTOCOL, and each child
 *    from index 2 is a TYPE THAT EXTENDS IT, so the child is the SOURCE. My
 *    first version stopped after the first child.
 * 4. `(extend-type Type P …)` — index 1 is the TYPE and each child from index 2
 *    is a protocol, so the SOURCE is index 1. My first version had this
 *    backwards: it emitted `Type -> enclosing` instead of `Type -> Protocol`.
 * 5. `(proxy [Super Iface…] …)` — inside the VECTOR, the FIRST entry is
 *    `extends` and the rest are `implements`, and the source is again the
 *    enclosing context. My first version emitted `extends` for all of them and
 *    used the proxy's own name as the source.
 *
 * The enclosing context is the active function's name, or the namespace at the
 * top level — the same attribution `uses` gets, so it is read from the same
 * walk rather than a second one that could disagree.
 */
export function deriveClojureTypeRelationTruth(root: Node): RelEdge[] {
  const out: RelEdge[] = []
  const seen = new Set<string>()
  const tl = namespaceTimeline(root)
  const add = (label: string, from: string, to: string, line: number) => {
    if (!from || !to) return
    const id = `${label}|${from}->${to}@${line}`
    if (seen.has(id)) return
    seen.add(id)
    out.push({ label, from, to, line })
  }
  // `||`, NOT `??`. `activeFunctionOf` stores "" for "no enclosing function", and
  // `??` only falls back on null/undefined — so an empty active function was passed
  // straight through to `add`, whose `if (!from || !to) return` then DROPPED the edge
  // silently. That is CLJ-D47's empty-source bug for the third time in this file, and
  // it cost 6 `extends` edges the moment the two derivations were unified.
  const typeSource = (n: Node): string => activeFunctionOf(root).get(n.startIndex) || nsAt(tl, n.startIndex)

  const isDefTypeish = (form: string) => form === "deftype" || form === "defrecord"
  walk(root, (node, ctx) => {
    if (node.type !== "list_lit") return
    if (isLibspecSite(node) || isCaseConstant(node)) return
    const h = executionHead(node)
    if (!h || h.type !== "sym_lit") return
    const form = symName(h)
    // The edge's line is the PROTOCOL/interface node's own line, not the form
    // head's. `(deftype Date … (inst-ms* …) Object (toString …))` in core.clj
    // puts the head on 7061 and `Object` on 7062, and the analyzer emits 7062 —
    // the line a reader follows to find the type declaration. A whole-form line
    // made all 403 `implements` keys wrong while the COUNTS matched exactly,
    // which is the most misleading failure a completeness gate can have.
    const protoLine = (n: Node): number => n.startPosition.row + 1
    // The analyzer resolves EVERY protocol and type name through
    // `resolveQualified`, so the truth must too — see `aliasTableOf`.
    const al = aliasesAt(tl, node.startIndex)
    const R = (n: string): string => resolveAlias(n, al)
    // A `reify`/`proxy` builds an ANONYMOUS type, and the analyzer's C9 branch
    // walks their bodies with `previousActiveFunction: null`, so its `ctxName`
    // falls back to the NAMESPACE rather than the enclosing function. Observed:
    // `(proxy [ThreadLocal] …)` in clojure/instant.clj is published as
    // `clojure.instant -> ThreadLocal`, not as the `thread-local-utc-date-format`
    // defn the naive walk attributes it to. The namespace is also the
    // conservative choice — an anonymous type belongs to no named function.
    const ctxNs = nsAt(tl, node.startIndex)

    if (isDefTypeish(form)) {
      // 1. protocols from index 3 — index 2 is the field vector.
      const own = defNameOf(node)
      if (!own) return
      for (let pi = 3; pi < node.namedChildCount; pi++) {
        const c = node.namedChild(pi)
        if (!c || c.type !== "sym_lit") continue
        add("implements", own, R(symName(c)), protoLine(c))
      }
      return
    }
    if (form === "reify") {
      // CLJ-D48: A `reify` ATTRIBUTES TO THE ENCLOSING DEFINITION, not the namespace.
      //
      // The comment this replaces claimed the opposite — that the analyzer's C9
      // branch walks a reify body with `previousActiveFunction: null` so its
      // `ctxName` falls back to the namespace. That observation was true of
      // `proxy` and was generalised to `reify`, where it is false: in core.clj the
      // `(reify clojure.lang.IDeref …)` at :7291 is nested inside `(defn future-call
      // …)`, and the analyzer publishes `future-call -> clojure.lang.IDeref` while
      // this truth published `clojure.core -> clojure.lang.IDeref`. 122 misses and
      // 122 fabrications, symmetric, every one the same edge with a different
      // SOURCE — which is why the counts matched exactly while every key was wrong.
      //
      // An anonymous type is still built by the definition that builds it. The
      // namespace fallback is kept only for the case that motivated the original
      // comment: a `reify` with no enclosing definition at all.
      for (let i = 1; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "sym_lit") add("implements", typeSource(node), R(symName(c)), protoLine(c))
      }
      return
    }
    if (form === "extend-protocol") {
      // 3. index 1 is the protocol; each child from 2 is a TYPE that extends it.
      const proto = node.namedChild(1)
      const protoName = proto && proto.type === "sym_lit" ? R(symName(proto)) : ""
      if (!protoName) return
      for (let i = 2; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "sym_lit") add("implements", R(symName(c)), protoName, protoLine(c))
      }
      return
    }
    if (form === "extend-type") {
      // 4. index 1 is the TYPE; each child from 2 is a protocol it extends.
      const t = node.namedChild(1)
      const typeName = t && t.type === "sym_lit" ? R(symName(t)) : ""
      if (!typeName) return
      for (let i = 2; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "sym_lit") add("implements", typeName, R(symName(c)), protoLine(c))
      }
      return
    }
    if (form === "proxy") {
      // 5. inside the VECTOR: first extends, the rest implement, source = context.
      // CLJ-D53: A `proxy`'s CLASS VECTOR MAY CARRY METADATA, and the metadata is not
      // the vector. `(proxy ^{:clj-kondo/ignore [:discouraged-namespace]} [yaml/YAMLCodec]
      // [] …)` in metabase's Temporal namespace put a `meta_lit` where the vector is
      // expected, and the class name came back as the whole
      // `^{:clj-kondo/ignore [:discouraged-namespace]}/YAMLCodec` — a target that is not a
      // type and resolves to nothing.
      const rawIfaces = node.namedChild(1)
      const ifaces = rawIfaces && (rawIfaces.type === "meta_lit" || rawIfaces.type === "quote_lit")
        ? executionHead(rawIfaces)
        : rawIfaces
      if (!ifaces || ifaces.type !== "vec_lit") return
      // CLJ-D48: a `proxy`'s SUPERCLASS and its INTERFACES BOTH attribute to the
      // enclosing definition. I first "fixed" the superclass to the namespace on the
      // strength of one sample — `clojure.instant -> ThreadLocal` — and that made
      // `extends` WORSE, 7 wrong out of 39 becoming 33. The sample was a real
      // disagreement but it was not the rule: 32 of 39 proxies already matched with
      // `ctx`, so a single sample was being read as a convention. Measuring the
      // whole class instead of generalising from the first example is the lesson,
      // and it is the same mistake as the `reify` comment above, one position over.
      for (let i = 0; i < ifaces.namedChildCount; i++) {
        const c = ifaces.namedChild(i)
        if (c && c.type === "sym_lit") {
          add(i === 0 ? "extends" : "implements", typeSource(node), R(symName(c)), protoLine(c))
        }
      }
    }
  })
  return out
}

// ══════════════════════════════════════════════════════════════════════════
// TRUTH FOR `calls` — the largest class, and the one whose oracle lived in the
// SHARED harness until the consolidation replaced it with a smaller one.
//
// WHY IT IS HERE. `calls` is 50% of metabase's output — 293,469 of 585,506
// relationships — and for three waves its only oracle was `deriveClojureEdges` in
// `differential.ts`, a file rewritten every few seconds by another lane. That is
// not a safe place for the truth about the lane's biggest class, and it is not
// where a fix belongs either. So the derivation lives here, in a file nobody else
// edits, and `differential.ts` delegates.
//
// THE THREE GATES, because they are what the whole class turns on. Every site
// that decides "this bare head is the language, not the program" asks the same
// question, and the three exemptions cannot be allowed to drift apart:
//
//   1. SHADOWED — the file binds the name at this point. Order-aware, and it has
//      to be: Clojure compiles a form as it reads it, so `(map f xs)` ABOVE
//      `(defn map …)` really is the standard library and one BELOW is the file's
//      own var. 555 real in-file call sites in the clojure corpus are silenced by
//      a name collision alone.
//   2. REFERRED — `(:require [lib :refer [name]])` / `:only` / `:rename` names a
//      CONFIRMED external target.
//   3. not a core name at all.
//
// The six ways a name binds, all mirrored from the analyzer's `shadowRangeOf`:
//
//   a def-family NAME binds at the form's END and lasts forever
//   a `letfn` fn-spec head binds for its whole ENCLOSING letfn (specs are
//     mutually visible, exactly like a binding-vector entry)
//   a protocol/interface SIGNATURE binds from the form's end (CLJ-D19)
//   an `fn` PARAM vector covers its ENCLOSING form
//   a binding-vector entry covers its enclosing form
//   a multi-arity clause's param covers THAT CLAUSE, and a letfn spec's param
//     covers its own spec form only
// ══════════════════════════════════════════════════════════════════════════

const SHADOW_DEF_NAME_HEADS = new Set(["def", "defn", "defn-", "defmacro", "defonce", "defmulti", "defmethod", "deftest", "declare"])
const SHADOW_PROTO_SIG_PARENTS = new Set(["defprotocol", "definterface"])
const SHADOW_BINDING_VEC_HEADS = new Set(["let", "let*", "loop", "loop*", "when-let", "if-let", "when-some", "if-some", "when-first", "binding", "for", "doseq", "dotimes", "with-open", "with-local-vars", "with-bindings", "letfn"])
const SHADOW_FN_PARAM_HEADS = new Set(["fn", "defn", "defn-", "defmacro", "defmethod", "deftest"])
/** Forms whose execution head is NOT a call, so nothing is emitted for them. */
const NON_CALL_FORMS = new Set([
  "if", "do", "let", "let*", "letfn", "loop", "loop*", "when", "when-not", "if-not", "if-let", "when-let",
  "when-some", "if-some", "when-first", "cond", "condp", "case", "and", "or", "for", "doseq", "dotimes",
  "while", "binding", "with-open", "with-local-vars", "with-bindings", "with-redefs", "try", "catch", "finally",
  "throw", "quote", "var", "set!", "new", "recur", "monitor-enter", "monitor-exit", "comment",
  "->", "->>", "some->", "some->>", "cond->", "cond->>", "as->", "doto", "..", "lazy-seq", "delay",
  "assert", "ns", "in-ns", "require", "use", "import", "refer", "refer-clojure", "load", "gen-class",
  "if-not", "while", "if-let", "when-first", "declare", "def", "defn", "defn-", "defmacro", "defonce",
  "defmulti", "defmethod", "deftest", "defprotocol", "defrecord", "deftype", "definterface", "defstruct",
  "reify", "proxy", "extend-type", "extend-protocol", "let-me", "clojure.core/fn",
])

/**
 * NAMESPACE AND CLASS-CREATING FORMS — not invocations, whatever supplies the name.
 *
 * core.clj defines `require` and `import`, and `clojure.core.proxy` defines `proxy`,
 * so the shadow rule was publishing `calls -> require`. A libspec is a DIRECTIVE and
 * `proxy` builds a class; neither invokes a var. Unconditional for the same reason as
 * `THREADING_HEADS`: what the head names is not something that was called.
 */
const LIBSPEC_OR_CLASS_FORMS = new Set([
  "ns", "in-ns", "require", "use", "import", "refer", "refer-clojure", "load",
  "gen-class", "proxy", "defstruct", "extend-type", "extend-protocol", "extend",
])

/**
 * IS THIS AN ANONYMOUS-FN ARGUMENT PLACEHOLDER — `%`, `%1`, `%&` — rather than a name?
 *
 * `#(inc %)` CALLS `inc`; `#(% 1)` merely applies the argument. Tree-sitter puts both
 * in the same place, so the distinction has to be made on the symbol itself. Mirrors
 * `isAnonArgShorthand` in the analyzer, which is the authority; kept local for the
 * same reason the core list is a parameter rather than an import.
 */
function isAnonArgShorthand(s: string): boolean {
  if (s.length === 0) return false
  if (s.charCodeAt(0) !== 37) return false                    // '%'
  if (s.length === 1) return true                             // "%"
  const c1 = s.charCodeAt(1)
  if (c1 === 38) return s.length === 2                        // "%&" exactly, never "%&x"
  return c1 >= 49 && c1 <= 57                                 // "%1" .. "%9"
}

/**
 * THREADING MACROS — transparent expansion, so never a call target.
 *
 * `(-> x (f y))` reads as "call `f` to `y` in the pipeline": the arrow is punctuation.
 * These names are in the core list, which would normally suppress them as standard
 * library; this set exists because core.clj DEFINES `->`, `doto` and `..`, so the
 * shadow rule would otherwise publish `calls -> ->` (12 edges) and `calls -> ..`.
 *
 * Unconditional on purpose, and unlike `loop`/`letfn`/`case` from CLJ-D44: these
 * expand to a call on their ARGUMENTS, so the arrow names nothing that was invoked
 * even in the file that defines it.
 */
const THREADING_HEADS = new Set([
  "->", "->>", "some->", "some->>", "cond->", "cond->>", "as->", "doto", "..",
])

/**
 * THE SPECIAL FORMS — a closed set, and a special form is NOT A CALL.
 *
 * This has to be consulted BEFORE the shadow check, which is the whole point of
 * it. clojure/core.clj:4748 is `(defmacro fn …)`: the file redefines `fn` as a
 * bootstrap macro, so the CLJ-D39 shadow rule says every `(fn …)` below that line
 * is a call to the file's own var, and it published 212 such edges. They are all
 * wrong. `fn` is a special form; a definition of it in one file does not turn it
 * into a var, and the compiler still treats the head as a form. The analyzer
 * knows this and stayed silent.
 *
 * `NON_CALL_FORMS` cannot do this job — it is a list of MACROS and binding forms
 * that happens to contain most of the special forms by coincidence, and it is
 * consulted by the `uses`/`contains` derivations, where a special form is still
 * worth walking. It also lists `clojure.core/fn`, a namespaced spelling no
 * head is ever written as.
 */
/**
 * THREADING MACROS — transparent expansion, so never a call target.
 *
 * `(-> x (f y))` reads as "call `f` to `y` in the pipeline": the arrow is punctuation.
 * An arrow in the core list would normally be suppressed as a standard-library
 * name, and it is listed there; this set exists because core.clj DEFINES these, so
 * the shadow rule would otherwise publish `calls -> ->`.
 */
/**
 * THE SPECIAL FORMS — a closed set, and a special form is NOT A CALL.
 *
 * Consulted BEFORE the shadow check. clojure/core.clj:4748 is `(defmacro fn …)`,
 * so the CLJ-D39 shadow rule says every `(fn …)` below that line is a call to the
 * file's own var, and it published 212 such edges. All 212 are wrong: `fn` is a
 * special form, a file defining it does not turn it into a var, and the compiler
 * still reads the head as a form.
 *
 * CLJ-D44: `loop`, `loop*`, `letfn`, `letfn*` and `case` were in this list and have
 * been REMOVED. They are MACROS, not special forms; core.clj defines every one of
 * them; and CLJ-D43 says a call to a macro the file defines IS a call. The analyzer
 * was right about them and this was wrong — which is the same two-lists-disagree
 * failure as everywhere else in this wave, and the reason a language fact is
 * derived rather than recalled.
 *
 * Kept separate from `src/ast/real-clojure-analyzer.ts` deliberately: this file
 * takes the core list as a PARAMETER so a derivation can run against an injected
 * language surface, and a hard import would undo that. The analyzer's exported
 * `CLOJURE_SPECIAL_FORMS` is the authority, and it now gates its own generic-call
 * emission on the set, so the two can be compared directly.
 */
const SPECIAL_FORM_HEADS = new Set([
  "def", "do", "fn", "fn*", "if", "if*", "let", "let*", "quote", "quote*", "var", "var*",
  "recur", "recur*", "throw", "throw*", "try", "try*", "catch", "catch*", "finally",
  "new", "new*", "set!", "monitor-enter", "monitor-exit", "case*", "letfn*", "loop*",
  ".", "&",
])

/** The member of a static-interop head, or null — both dot positions (CLJ-D32). */
function staticInteropMemberOf(head: string): string | null {
  const slash = head.lastIndexOf("/")
  if (slash <= 0) return null
  const member = head.slice(slash + 1)
  if (member.length === 0) return null
  const afterDot = head.charCodeAt(slash + 1) === 46
  const beforeDot = head.charCodeAt(slash - 1) === 46
  if (!afterDot && !beforeDot) return null
  return afterDot ? head.slice(slash + 2) : member
}

/** Does a `->Class` head's final segment begin uppercase? The ctor test. */
function ctorIsUppercase(form: string): boolean {
  const cls = form.slice(2)
  const namePart = cls.includes("/") ? cls.slice(cls.indexOf("/") + 1) : cls
  const lastSeg = namePart.includes(".") ? namePart.slice(namePart.lastIndexOf(".") + 1) : namePart
  return lastSeg.charCodeAt(0) >= 65 && lastSeg.charCodeAt(0) <= 90
}

/** The head's name for a list, or "" — the truth's own reader, not the analyzer's. */
function formNameOf(list: Node): string {
  const h = executionHead(list)
  if (!h || h.type !== "sym_lit") return ""
  return symName(h)
}

/** The `(name, span)` a symbol binds, or null — a mirror of `shadowRangeOf`. */
function shadowRangeOf(candidate: Node): { name: string; start: number; end: number } | null {
  const nm = symName(candidate)
  if (!nm) return null
  const parent = candidate.parent
  if (!parent) return null
  if (parent.type === "list_lit") {
    const head = executionHead(parent)
    const hn = head && head.type === "sym_lit" ? symName(head) : ""
    // a def-family NAME binds when the form COMPLETES, so a `(comment …)` inside
    // this form's own init is still the macro
    if (SHADOW_DEF_NAME_HEADS.has(hn) && parent.namedChild(1)?.startIndex === candidate.startIndex) {
      return { name: nm, start: parent.endIndex, end: Infinity }
    }
    // a letfn fn-spec head: `[(comment [args] body) …]` binds for the whole letfn
    if (parent.namedChild(0)?.startIndex === candidate.startIndex) {
      const specVec = parent.parent
      if (specVec && specVec.type === "vec_lit") {
        const letfnForm = specVec.parent
        if (letfnForm && letfnForm.type === "list_lit" && formNameOf(letfnForm) === "letfn" && letfnForm.namedChild(1)?.startIndex === specVec.startIndex) {
          return { name: nm, start: letfnForm.startIndex, end: letfnForm.endIndex }
        }
      }
      // a protocol/interface SIGNATURE head (CLJ-D19)
      const declForm = parent.parent
      if (declForm && declForm.type === "list_lit" && SHADOW_PROTO_SIG_PARENTS.has(formNameOf(declForm)) && declForm.namedChild(0)?.startIndex !== parent.startIndex) {
        return { name: nm, start: declForm.endIndex, end: Infinity }
      }
    }
    return null
  }
  if (parent.type === "vec_lit") {
    const gp = parent.parent
    if (!gp || gp.type !== "list_lit") return null
    const head = formNameOf(gp)
    if (SHADOW_FN_PARAM_HEADS.has(head)) {
      for (let i = 0; i < gp.namedChildCount; i++) {
        const c = gp.namedChild(i)
        if (c?.type === "vec_lit") return c.startIndex === parent.startIndex ? { name: nm, start: gp.startIndex, end: gp.endIndex } : null
      }
      return null
    }
    if (SHADOW_BINDING_VEC_HEADS.has(head) && gp.namedChild(1)?.startIndex === parent.startIndex) {
      return { name: nm, start: gp.startIndex, end: gp.endIndex }
    }
    // a multi-arity clause: the vec is the FIRST named child of a list whose
    // parent is a fn/defn form, so the param covers that clause
    if (gp.namedChild(0)?.startIndex === parent.startIndex) {
      const ggp = gp.parent
      if (ggp && ggp.type === "list_lit" && SHADOW_FN_PARAM_HEADS.has(formNameOf(ggp))) {
        return { name: nm, start: gp.startIndex, end: gp.endIndex }
      }
    }
    // a letfn fn-spec PARAM vector covers its own spec form only
    {
      const specVec = gp.parent
      if (specVec && specVec.type === "vec_lit") {
        const letfnForm = specVec.parent
        if (letfnForm && letfnForm.type === "list_lit" && formNameOf(letfnForm) === "letfn" && letfnForm.namedChild(1)?.startIndex === specVec.startIndex) {
          return { name: nm, start: gp.startIndex, end: gp.endIndex }
        }
      }
    }
    return null
  }
  return null
}

/** The `(:require [lib :refer [name]])` names in force at a position, per ns form. */
function referTimeline(root: Node, coreNames: Iterable<string>): { start: number; end: number; names: Map<string, string> }[] {
  const out: { start: number; end: number; names: Map<string, string> }[] = []
  const st: Node[] = [root]
  while (st.length > 0) {
    const n = st.pop()!
    if (n.type !== "list_lit") { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }; continue }
    const h = executionHead(n)
    const hn = h && h.type === "sym_lit" ? symName(h) : ""
    if (hn !== "ns" && hn !== "in-ns") { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }; continue }
    const names = new Map<string, string>()
    // NOT a full-library refer, and the reason is worth recording because I got
    // it wrong twice. `:refer-clojure` looks like it should refer all of
    // clojure.core, and modelling it that way put 7,234 extra edges in this truth
    // — but the analyzer's refer table is written ONLY from explicit
    // `:refer` / `:only` / `:rename` NAME LISTS, and it deliberately does not feed
    // `refer-clojure` clauses through the libspec handler at all. So a bare
    // `(first xs)` in core.clj is NOT a referred target, and the suppression gate
    // stands. The `refer-clojure` clause is read only for its `:exclude` list,
    // which suppresses rather than refers.
    for (let ci = 1; ci < n.namedChildCount; ci++) {
      const clause = n.namedChild(ci)
      if (!clause || clause.type !== "list_lit") continue
      const ck = executionHead(clause)
      const kw = ck && ck.type === "kwd_lit" ? (ck.childForFieldName("name")?.text ?? "") : ""
      if (!LIB_KEYWORDS.has(kw)) continue
      for (let k = 1; k < clause.namedChildCount; k++) {
        const spec = clause.namedChild(k)
        if (!spec) continue
        const lib = libNameOf(spec)
        if (!lib) continue
        if (spec.type === "vec_lit") {
          for (let q = 1; q < spec.namedChildCount; q++) {
            const c = spec.namedChild(q)
            if (c && c.type === "kwd_lit") {
              const key = c.childForFieldName("name")?.text ?? ""
              if (key === "refer" || key === "only") {
                // both shapes carry names: `[a b]` and `(a b)` (CLJ-D21b)
                const list = spec.namedChild(q + 1)
                if (list && (list.type === "vec_lit" || list.type === "list_lit")) {
                  for (let r = 0; r < list.namedChildCount; r++) {
                    const rn = list.namedChild(r)
                    if (rn && rn.type === "sym_lit") names.set(symName(rn), lib)
                  }
                }
              }
            }
          }
        }
      }
    }
    if (out.length > 0) out[out.length - 1]!.end = n.startIndex
    out.push({ start: n.startIndex, end: Infinity, names })
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
  }
  return out
}
/** The referred name at a position, or "" — one or two segments per file. */
function referAt(segments: { start: number; end: number; names: Map<string, string> }[], name: string, pos: number): string {
  for (const seg of segments) if (pos >= seg.start && pos < seg.end) return seg.names.get(name) || ""
  return ""
}

export type CallEdge = { label: string; from: string; target: string }

/**
 * TRUTH FOR `calls`.
 *
 * BOTH core arguments are passed IN rather than imported. The analyzer and this
 * file must agree about which names are the language, and the way to guarantee
 * that is for the caller to hand over the SAME constant (CLJ-D17 — a second copy
 * of the list is a second answer to the same question). `isCore` answers "is
 * this a language name" and `isCoreNames` is the set itself, which `:refer-clojure`
 * needs because a whole-library refer is the complement of an exclusion list.
 */
/**
 * NOT YET WIRED, and the measurement says why.
 *
 *   shared `deriveClojureEdges`   MISSING 38    unexplained 221
 *   this derivation               MISSING 216   unexplained 392
 *
 * Both directions are worse, so `differential.ts` keeps its own derivation and
 * this one is kept, unwired, with what is actually left written down.
 *
 * TWO OF MY THREE EARLIER "GAPS" WERE WRONG, and the working-out is worth
 * keeping because the wrong conclusions were confident ones.
 *
 * I claimed the 221 unexplained `core.clj` edges were "the core-name shadow
 * boundary — a genuine semantic question". THEY ARE NOT. The analyzer is right
 * about every one of them. `core.clj` defines `first` at line 49 — `(def ^{:
 * arglists '([coll]) :doc "Returns the first item…" } first (fn …))`, where the
 * docstring contains the word "first" and the definition is spread over lines —
 * so it binds from byte 1650, and `(first xs)` at line 90 is the FILE'S OWN var,
 * correctly published. I had read the definition as being at line 705 because a
 * line-anchored regex cannot see a name that sits on its own line after a
 * metadata map. The order-aware shadow table is correct, and the isolated
 * experiment says so directly: a call above a `(defn first …)` emits nothing, a
 * call below emits, and `(def ^{:doc} first (fn …))` behaves identically.
 *
 * I also claimed `:refer-clojure` refers a whole library. IT DOES NOT, and
 * modelling it that way put 7,234 extra edges in this truth. The analyzer's
 * refer table is written ONLY from explicit `:refer` / `:only` / `:rename` NAME
 * LISTS, and it deliberately does not feed `refer-clojure` clauses through the
 * libspec handler at all. Twice is the right number of times to learn a
 * convention: once is a reading, twice is a rule.
 *
 * WHAT IS ACTUALLY LEFT, in the order it should be done:
 *
 * 1. A TOP-LEVEL `(require '[lib :as alias])` REGISTERS AN ALIAS. core.clj:7248
 *    does exactly this for `jio`, and `aliasTableOf` reads only the `ns` /
 *    `in-ns` form, so `jio/copy` is derived unresolved where the analyzer derives
 *    `clojure.java.io/copy`. One clause reader, and it is the largest single
 *    contributor to the 216.
 * 2. A METHOD-IMPL POSITION IS A DEFINITION, NOT A CALL. The direct list children
 *    of `deftype` / `defrecord` / `reify` / `extend-type` are method definitions
 *    (C9). `isRealized`, `isCancelled`, `cancel`, `invoke`, `iterator` are
 *    derived here and not published there, because the test recognises a FORM
 *    NAME where it needs to recognise a SHAPE.
 * 3. THE SHADOW TABLE NEEDS THE `(def ^{meta} name (fn …))` SHAPE EXPLICITLY.
 *    Both implementations agree in isolation, and they disagree on this corpus,
 *    so one of them is wrong about a name that sits after a metadata map — and
 *    the honest next step is to find which, by asking the two implementations
 *    for their RANGE for a known name at a known offset rather than by reasoning
 *    about either.
 *
 * THE ONE LARGE WIN, and the transferable part: routing the four interop shapes
 * out of `calls` — member access and static interop are `uses`, `Class.` and
 * `->Class` are `instantiates` — took the over-generation from 1,944 invented
 * targets to 216. A derivation that emits a call for every `(.append x)` in a
 * corpus is not nearly right; it is wrong in a way that scales with the corpus.
 */
export function deriveClojureCallsTruth(
  root: Node,
  isCore: (name: string) => boolean,
  _coreNames: Iterable<string>,
): CallEdge[] {
  const edges: CallEdge[] = []
  const seen = new Set<string>()
  // NO CORE FILTER HERE. The filter belongs in the walk, not in the sink: a
  // SHADOWED core name is the file's own var and must be published, and a filter
  // in `push` cannot tell those two apart. It was here from the first draft, and
  // it is why every call below a definition of a core-named function vanished —
  // 401 edges in clojure/core.clj, which is a file made almost entirely of them.
  const push = (from: string, target: string): void => {
    if (!from || !target) return
    const k = `calls|${from}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label: "calls", from, target })
  }

  // PRE-PASS: every name the file binds, and where. Collected before the walk so
  // the gate can ask about a position that has not been visited yet.
  const shadowIndex = new Map<string, Array<{ start: number; end: number }>>()
  {
    const st: Node[] = [root]
    while (st.length > 0) {
      const n = st.pop()!
      // TWO FILTERS, and missing both was the whole of a 213-edge residual.
      //
      // 1. DO NOT DESCEND INTO A DISCARD OR A QUOTE. A name inside `#_(def
      //    first …)` binds nothing, and one inside `'clojure.core/first` is data.
      //    Recording a range from either marks real positions as shadowed that are
      //    not, and the walk then publishes a core call the analyzer suppresses.
      if (n.type === "dis_expr" || n.type === "quoting_lit") continue
      // 2. ONLY CORE NAMES GET A RANGE. The table answers one question — "is this
      //    bare head the standard library or the file's own var?" — so a range for
      //    a name outside the core list is not answering it. It is harmless in
      //    isolation, and wrong in aggregate: it turns a non-core local into a
      //    shadowed one, and the walk publishes it down a path the analyzer's
      //    suppression gate never even reaches.
      if (n.type === "sym_lit" && isCore(symName(n))) {
        const r = shadowRangeOf(n)
        if (r) {
          const list = shadowIndex.get(r.name)
          if (list) list.push({ start: r.start, end: r.end })
          else shadowIndex.set(r.name, [{ start: r.start, end: r.end }])
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
  }
  const isShadowedAt = (name: string, pos: number): boolean => {
    const list = shadowIndex.get(name)
    if (list === undefined) return false
    for (let i = 0; i < list.length; i++) { const r = list[i]!; if (pos >= r.start && pos < r.end) return true }
    return false
  }
  // The core list is passed IN rather than imported, for the reason the calls
  // derivation takes it as a predicate: two copies of the list are two answers.
  const referSegs = referTimeline(root, _coreNames)
  const nsTl = namespaceTimeline(root)
  const aliasTl = aliasTimelineOf(root)
  // The one suppression gate, asked by every site.
  const suppressed = (name: string, pos: number): boolean =>
    isCore(name) && !isShadowedAt(name, pos) && referAt(referSegs, name, pos) === ""

  walk(root, (node, owner) => {
    // CLJ-D45: the shorthand's first child is the CALLEE — unless it is `%`/`%1`,
    // in which case the shorthand merely APPLIES its argument and calls nothing.
    if (node.type === "anon_fn_lit") {
      const ah = executionHead(node)
      if (!ah || ah.type !== "sym_lit") return
      const an = symName(ah)
      if (!an || isAnonArgShorthand(an)) return
    } else if (node.type !== "list_lit") return
    if (isLibspecSite(node) || isCaseConstant(node)) return
    const h = executionHead(node)
    if (!h || h.type !== "sym_lit") return
    const form = symName(h)
    // CLJ-D43: A NAME THE FILE DEFINES IS NOT A "NON-CALL FORM" ANY MORE.
    //
    // These three early-returns asked "is this a macro or a binding form?" and
    // answered from the NAME alone, before the shadow table was consulted. That is
    // right for a macro the language provides and wrong for one the file defines
    // itself, and clojure/core.clj is the worst possible file for the mistake: it
    // IS clojure.core. It defines `when-let` at :1879, `if-let` at :1859, `doseq`,
    // `lazy-seq` and `loop`, and then calls them - 29, 9, 12, 41 and 29 times. Every
    // one of those calls is a call to the file's own macro and the analyzer
    // publishes it; this returned first and published none, which is where most of
    // the remaining unexplained edges came from.
    //
    // So the shadow table is asked FIRST, and the name-based lists apply only to a
    // name that is still the language's. Same ordering as CLJ-D41 one level up: a
    // local definition wins over every name-based list, including the core list.
    //
    // `isMethodImplPosition` stays UNCONDITIONAL on purpose - a method definition is
    // not a call to itself whatever else is true.
    const shadowedName = isShadowedAt(form, h.startIndex)
    // UNCONDITIONAL, and the distinction is the point of CLJ-D43.
    //
    // Three groups are not "calls" for a reason that survives the file defining the
    // name, and letting them through cost 32 edges:
    //
    //   · A THREADING MACRO IS TRANSPARENT EXPANSION. `(-> x (foo y))` means a call
    //     to `foo`; the arrow is punctuation, and a `calls -> ->` edge records the
    //     shape of the reader's syntax rather than anything invoked. core.clj
    //     defines `->`, `doto` and friends, so shadowing made 16 of these appear.
    //   · A DEFINITION IS A DEFINITION. `(defn f …)` is a definition whether `defn`
    //     comes from the language or from this file, and core.clj defines `defn-`,
    //     `definline`, `defonce`, `declare` and `defmulti` itself. CLJ-D30 gives
    //     these their own relationship class; re-publishing the macro name as a call
    //     would duplicate it and invent an invocation.
    //   · `NON_CODE_HEADS` covers `comment` and friends, where the point is that the
    //     form is never evaluated. A file defining a macro named `comment` does not
    //     make `(comment …)` code.
    //
    // `SPECIAL_FORM_HEADS` is checked below for the same reason, and
    // `isMethodImplPosition` for the same reason again.
    if (THREADING_HEADS.has(form)) return
    // Same argument, for the namespace and class-creating forms: `(require …)`
    // and `(proxy …)` are not invocations whatever supplies the name, and core.clj
    // defines `require`, `import` and `proxy` itself.
    if (LIBSPEC_OR_CLASS_FORMS.has(form)) return
    if (DEF_HEADS.has(form) || isDefLikeHead(form)) return
    if (NON_CODE_HEADS.has(form)) return
    if (!shadowedName && NON_CALL_FORMS.has(form)) return
    if (isMethodImplPosition(node)) return
    // THE FOUR INTEROP SHAPES BELONG TO OTHER CLASSES, and emitting them as
    // `calls` is what put 1,944 targets in this truth that the analyzer never
    // publishes. Each is a different relationship, and the analyzer routes it:
    //
    //   `(.append x)`            a MEMBER ACCESS      → `uses`
    //   `(StringBuilder. …)`     a CONSTRUCTOR        → `instantiates`
    //   `(->Rec …)`              the ctor idiom       → `instantiates`
    //   `(String/.toUpperCase s)` a STATIC member     → `uses` (CLJ-D32)
    //
    // They are all still WALKED — they are code, and the truth for their own
    // classes derives them from the same tree. They simply are not calls, and a
    // derivation that says otherwise invents an edge for every interop site in
    // the corpus.
    if (form.startsWith(".") && form !== "..") return
    if (form.endsWith(".") && form.length > 1 && !form.startsWith(".")) return
    if (staticInteropMemberOf(form) !== null) return
    if (form.startsWith("->") && form.length > 2 && form !== "->>" && ctorIsUppercase(form)) return
    const pos = h.startIndex
    if (suppressed(form, pos)) return
    const slash = form.indexOf("/")
    if (slash > 0) {
      // A QUALIFIED head: a known alias resolves, otherwise the namespace is
      // taken as written (the same reading the analyzer's `resolveQualified`
      // uses, `namespaceAliases[alias] || alias`).
      const al = aliasesInForce(aliasTl, node.startIndex)
      push(owner, resolveAlias(form, al))
      return
    }
    // A BARE NAME THAT IS REFERRED is a CONFIRMED target, and it is published
    // RESOLVED — `clojure.core/first`, not `first`. Two bugs met here, and both
    // were mine:
    //
    //   · the `isCore` early-return fired even when the refer table had just
    //     said the name is a real target, so a referred core name emitted nothing
    //     at all — the `:refer-clojure` fix looked like it did nothing because
    //     the line after it still refused;
    //   · and the target has to carry the library, because that is what the
    //     analyzer's post-walk refer pass writes and therefore what the harness
    //     compares.
    //
    // A LOCALLY BOUND name wins over a refer (Clojure's ns mapping: a definition
    // in the file shadows what it refers), which is what `shadowed` decides — and
    // `isShadowedAt` is the same order-aware table the suppression gate uses.
    // THE ORDER IS THE WHOLE RULE, and getting it wrong is what the 401
    // unexplained `core.clj` edges were. Three ways a bare name can be a call, and
    // they are tried in Clojure's own order:
    //
    //   1. THE FILE DEFINED IT — shadowed. A local definition wins over
    //      everything, INCLUDING over the core list: `(defn first …)` then
    //      `(first x)` is a call to the FILE'S OWN var and must be published. My
    //      version checked "shadowed" only inside the REFER branch and then let
    //      `isCore(form)` return, so every call below a definition of a core-named
    //      function was silently dropped — and core.clj is nothing but those.
    //   2. IT IS REFERRED — a confirmed external target, published RESOLVED.
    //   3. IT IS THE LANGUAGE — no edge, which is the contract's whole point.
    //
    // The minimal reproduction that found it is four lines: `(defn first [x] x)`
    // then `(first x)`. The analyzer publishes it; this did not.
    if (SPECIAL_FORM_HEADS.has(form)) return
    // CLJ-D47: AN EDGE WITH NO ATTRIBUTABLE OWNER IS STILL A REAL CALL.
    //
    // `push` drops any edge whose `from` is empty, on the reasonable-sounding
    // grounds that a relationship needs two ends. That silently deleted 43 calls
    // across the corpus — every one of them an ownerless form in a test file, e.g.
    // `(foo 3.14159)` at test_cl_format.clj:611, inside a `(simple-tests …)` block
    // whose owner chain ran out before reaching it. `owner` is "" at every one of
    // those sites, so the edge was built and then thrown away, and because the
    // throw-away is silent the file simply looked like a coverage gap.
    //
    // The analyzer already has a rule for exactly this, and it is C8: a call OUTSIDE
    // any function — a def initializer, a top-level side effect — attributes to the
    // NAMESPACE IN FORCE, which is the load-time context that actually invokes it.
    // So the fallback is not an invention here; it is the analyzer's own convention,
    // and leaving it out made this truth lose edges it had already derived.
    // …and when there is no `ns` form either, the load-time context is Clojure's own
    // default namespace. The analyzer attributes it to `user` — visible in this
    // fixture as `calls: user -> before-ns` — so a truth that stops one step short
    // still drops every call in a file that has no `ns`, which is the smallest
    // possible reproduction of the bug this ruling exists to fix.
    const src = owner !== "" ? owner : (nsAt(nsTl, pos) || "user")
    const shadowed = isShadowedAt(form, pos)
    if (shadowed) { push(src, form); return }
    const ref = referAt(referSegs, form, pos)
    if (ref) { push(src, ref.includes("/") ? ref : `${ref}/${form}`); return }
    if (isCore(form)) return
    push(src, form)
  })
  return edges
}
