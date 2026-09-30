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
    if (name && ns) return `${ns.text}/${name.text}`
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
        if (v) out.push({ at: n.startIndex, name: v, aliases: aliasTableOf(n) })
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
function aliasTableOf(nsForm: Node): Map<string, string> {
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
      const first = spec.namedChild(0)
      if (!first) continue
      if (first.type === "sym_lit") {
        const lib = symName(first)
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
      if (first.type === "vec_lit") {
        const prefix = first.namedChild(0)
        const prefixName = prefix && prefix.type === "sym_lit" ? symName(prefix) : ""
        if (!prefixName) continue
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
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) rec(c, nextOwner, depth) }
  }
  rec(root, nsAt(nsTimeline, 0), 0)
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
  let i = 1
  while (i < node.namedChildCount) {
    const c = node.namedChild(i)
    if (!c) return ""
    if (c.type === "meta_lit") { i++; continue }
    return c.type === "sym_lit" ? symName(c) : ""
  }
  return ""
}

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
    if (prev === undefined || h!.startPosition.row + 1 < prev) earliest.set(k, h!.startPosition.row + 1)
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

/** A libspec symbol `lib`, `lib/sub` or `[lib :as a] …` → the LIB name. */
function libNameOf(spec: Node): string {
  if (spec.type === "sym_lit") {
    const nm = symName(spec)
    return nm
  }
  if (spec.type === "vec_lit") {
    const first = spec.namedChild(0)
    if (!first) return ""
    if (first.type === "sym_lit") return symName(first)
    if (first.type === "vec_lit") {
      // `[[prefix [sub :as a] …]]` — a prefix list's own head.
      const p0 = first.namedChild(0)
      return p0 && p0.type === "sym_lit" ? symName(p0) : ""
    }
  }
  return ""
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
export function deriveClojureReferencesTruth(root: Node): RelEdge[] {
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
  const walkAliasedUses = (): void => {
    walk(root, (node) => {
      if (node.type !== "list_lit") return
      if (isLibspecSite(node) || isCaseConstant(node)) return
      const h = executionHead(node)
      if (!h || h.type !== "sym_lit") return
      const form = symName(h)
      if (NON_CODE_HEADS.has(form)) return
      const al = aliasesAt(timeline, node.startIndex)
      const ns = nsAt(timeline, node.startIndex)
      const mark = (name: string, line: number) => {
        const slash = name.indexOf("/")
        if (slash <= 0) return
        const resolved = al.get(name.slice(0, slash))
        if (!resolved || resolved === ns) return
        const id = `references|${ns}->${resolved}@${line}`
        if (seen.has(id)) return
        seen.add(id)
        out.push({ label: "references", from: ns, to: resolved, line })
      }
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
              if (!lib) continue
              const line = spec.startPosition.row + 1
              const id = `${v}->${lib}@${line}`
              if (seen.has(id)) continue
              seen.add(id)
              out.push({ label: "references", from: v, to: lib, line })
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
    const id = `${owner}->${cls}@${line}`
    if (seen.has(id)) return
    seen.add(id)
    out.push({ label: "instantiates", from: owner, to: cls, line })
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
      // 2. every child from 1 is a protocol; the source is the ENCLOSING CONTEXT.
      for (let i = 1; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c && c.type === "sym_lit") add("implements", ctxNs, R(symName(c)), protoLine(c))
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
      const ifaces = node.namedChild(1)
      if (!ifaces || ifaces.type !== "vec_lit") return
      for (let i = 0; i < ifaces.namedChildCount; i++) {
        const c = ifaces.namedChild(i)
        if (c && c.type === "sym_lit") add(i === 0 ? "extends" : "implements", ctx, R(symName(c)), protoLine(c))
      }
    }
  })
  return out
}
