// CLJ-DEEP · INSTRUMENT 4 — the SUSPECT-SHAPE census.
//
// A targeted, AST-driven count of specific constructs across the whole corpus.
// Each row is a shape the analyzer's current rule set may handle incorrectly;
// the counts turn a suspicion into a measurement, and the sample lines let a
// reviewer read real source instead of trusting the number.
//
// Every count is over the TREE, never over text: no regex anywhere in this file.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"

function listFiles(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(dir)) return []
  let tracked: string[] = []
  try { tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { tracked = [] }
  if (tracked.length === 0) return []
  return tracked.filter(f => /\.(clj|cljc|cljs)$/i.test(f)).map(f => path.join(dir, f)).sort()
}

const SUSPECTS: Record<string, string> = {
  use_only: "(:use [lib :only [names]])` — the legacy twin of `:refer`; the libspec handler reads `:refer` only, so an `:only` name never enters the refer table",
  refer_all: "`:refer :all` — the whole-lib form of `:refer`; no name list exists to read",
  use_prefix_only: "(:use [prefix :only [...]])`",
  require_rename: "`:rename {…}` — a declared limitation (F17); read to measure its size",
  require_refer_metas: "`:refer-macros`/`:use-macros` clauses",
  declare_forms: "`(declare a b c)` — interns vars; no branch creates a symbol, so later calls dangle",
  second_ns: "a SECOND `(ns …)` form in one file — the ns branch resets `namespaceAliases` but not `refers`",
  private_type: "`^:private` on a defrecord/deftype/defprotocol name — the def/defn branches read it, the type branches do not",
  private_defprotocol: "`^:private` on a defprotocol name",
  meta_on_head: "a def/defn form whose declared NAME node is a `meta_lit` rather than a `sym_lit`",
  spec_kw: "`(s/def ::kw …)` — an auto-resolved keyword as the spec name",
  reader_cond_stmt: "`#?(:clj …)` wrapping a top-level declaration",
  tagged_upper: "a `tagged_or_ctor_lit` whose tag's last segment is uppercase (CLJ-D1 constructor reading)",
  multi_ns_arity: "a defn with more than one arity clause (W23-c: merged parameters)",
  deftest_fixtures: "`(deftest name [fixtures] …)` — a fixtures vector in the parameter position",
  import_paren: "`(:import (pkg Cls…))` — the list-shaped import spec",
  proxy_vec: "`(proxy [Super Ifaces] …)`",
  letfn_shadow: "a `letfn` fn-spec head (W24-mr1 shadow site)",
  comment_shadow_def: "a `(comment …)` form inside a def-family form (shadow-range site)",
  top_level_thread: "a threading macro at TOP LEVEL (no activeFunction)",
  recur_toplevel: "`(recur …)` outside any fn context",
  ns_no_name: "an `(ns …)` form whose name node is not a symbol",
  def_no_name: "a `(def …)` form whose name node is not a symbol",
  reify_toplevel: "a top-level `reify`",
  extend_protocol_multi: "`(extend-protocol P T1 (m …) T2 (m …))` — multiple types",
  protocol_impl_builtin_name: "a protocol/record method impl whose name IS a core builtin (dropped by the builtin filter)",
}

async function main() {
  const repo = process.argv[2] ?? "clojure"
  const shard = process.argv[3] ? parseInt(process.argv[3]) : 0
  const nshards = process.argv[4] ? parseInt(process.argv[4]) : 1
  const out = process.argv[5] ?? `/tmp/opencode/clj-shapes-${repo}-${shard}.json`

  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const analyzer = new mod.RealClojureAnalyzer()
  const CORE: Record<string, boolean> = mod.CLOJURE_CORE_BUILTINS

  const files = listFiles(repo).filter((_, i) => i % nshards === shard)
  const counts: Record<string, number> = {}
  const samples: Record<string, string[]> = {}
  for (const k of Object.keys(SUSPECTS)) { counts[k] = 0; samples[k] = [] }
  const bump = (k: string, at: string) => {
    counts[k] = (counts[k] ?? 0) + 1
    if (samples[k]!.length < 6) samples[k]!.push(at)
  }
  let fileCount = 0

  for (const file of files) {
    let content: string
    try { content = readFileSync(file, "utf8") } catch { continue }
    if (content.length > 400_000) continue
    let root: any
    try { root = parser.parse(content).rootNode } catch { continue }
    fileCount++
    const at = (n: any) => `${path.relative(CORPUS_ROOT, file)}:${n.startPosition.row + 1}`

    const headOf = (list: any): any => {
      for (let i = 0; i < list.namedChildCount; i++) {
        const c = list.namedChild(i)
        if (c && c.type !== "comment" && c.type !== "dis_expr" && c.type !== "meta_lit") return c
      }
      return null
    }
    const symName = (nd: any): string => {
      if (!nd) return ""
      if (nd.type === "sym_lit") {
        const nm = nd.childForFieldName("name"); const ns = nd.childForFieldName("namespace")
        if (nm && ns) return `${ns.text}/${nm.text}`
        if (nm) return nm.text
        return nd.text
      }
      return nd.text
    }
    const kwdName = (n: any): string => (n && n.type === "kwd_lit" ? (n.childForFieldName("name")?.text ?? "") : "")
    const metaOn = (node: any): any => {
      for (let i = 0; i < node.namedChildCount; i++) { const c = node.namedChild(i); if (c && c.type === "meta_lit") return c }
      return null
    }
    const hasPrivateMeta = (node: any): boolean => {
      const m = metaOn(node)
      if (!m) return false
      const scan = (n: any): boolean => {
        if (n.type === "kwd_lit" && n.text === ":private") return true
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && scan(c)) return true }
        return false
      }
      return scan(m)
    }

    let nsForms = 0
    const st: any[] = [root]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "list_lit") {
        const h = headOf(n)
        const hn = h && h.type === "sym_lit" ? symName(h) : ""
        const cn = h && h.type === "kwd_lit" ? kwdName(h) : ""
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) kids.push(c) }

        if (hn === "ns") {
          nsForms++
          if (nsForms > 1) bump("second_ns", at(n))
          const nameNode = kids.find(c => c.type !== "comment" && c.type !== "dis_expr" && c.type !== "meta_lit" && kids.indexOf(c) > 0)
          if (nameNode && nameNode.type !== "sym_lit") bump("ns_no_name", at(n))
        }
        if (hn === "declare" || hn === "defn-" === false && hn === "declare") bump("declare_forms", at(n))
        if (hn === "def" || hn === "defonce") {
          const nm = kids[1]
          if (nm && nm.type !== "sym_lit" && nm.type !== "meta_lit") bump("def_no_name", at(n))
        }
        if (hn === "defn" || hn === "defn-" || hn === "defmacro") {
          const nm = kids[1]
          if (nm && nm.type === "meta_lit") bump("meta_on_head", at(n))
        }
        if ((hn === "defrecord" || hn === "deftype") && hasPrivateMeta(kids[1] ?? n)) bump("private_type", at(n))
        if (hn === "defprotocol" && hasPrivateMeta(kids[1] ?? n)) bump("private_defprotocol", at(n))
        if (hn === "defprotocol" || hn === "definterface") {
          for (const k of kids.slice(1)) {
            if (k.type !== "list_lit") continue
            const mn = symName(headOf(k))
            if (mn && CORE[mn]) bump("protocol_impl_builtin_name", `${at(k)} (${hn} method ${mn})`)
          }
        }
        if (hn === "s/def" || hn === "s/fdef" || hn === "clojure.spec.alpha/def" || hn === "clojure.spec.alpha/fdef") {
          const nm = kids[1]
          if (nm && nm.type === "kwd_lit" && nm.text.startsWith("::")) bump("spec_kw", at(n))
        }
        if (hn === "deftest") {
          const v = kids.find(k => k.type === "vec_lit")
          if (v) bump("deftest_fixtures", at(n))
        }
        if (hn === "defn" || hn === "defn-" || hn === "defmacro") {
          let arity = 0
          for (const k of kids.slice(1)) {
            if (k.type === "list_lit") { const hh = headOf(k); if (hh && hh.type === "vec_lit") arity++ }
          }
          if (arity > 1) bump("multi_ns_arity", `${at(n)} (${arity} arities)`)
        }
        if (hn === "letfn") {
          const specVec = kids[1]
          if (specVec && specVec.type === "vec_lit") {
            for (let i = 0; i < specVec.namedChildCount; i++) {
              const sp = specVec.namedChild(i)
              if (sp && sp.type === "list_lit") { bump("letfn_shadow", at(sp)); break }
            }
          }
        }
        if (hn === "proxy" && kids[1] && kids[1].type === "vec_lit") bump("proxy_vec", at(n))
        if (hn === "extend-protocol") {
          let types = 0
          for (const k of kids.slice(2)) if (k.type === "sym_lit") types++
          if (types > 1) bump("extend_protocol_multi", `${at(n)} (${types} types)`)
        }
        if (hn === "reify" && (!n.parent || n.parent.type !== "list_lit" || headOf(n.parent)?.type !== "sym_lit")) bump("reify_toplevel", at(n))
        if (hn === "recur" && (!n.parent || n.parent.type !== "list_lit")) bump("recur_toplevel", at(n))
        if ((hn === "->" || hn === "->>") && (!n.parent || n.parent.type !== "list_lit")) bump("top_level_thread", at(n))
        if (cn === "use" || cn === "require") {
          for (let i = 1; i < kids.length; i++) {
            const spec = kids[i]
            if (!spec || spec.type !== "vec_lit") continue
            for (let j = 1; j < spec.namedChildCount; j++) {
              const p = spec.namedChild(j)
              if (p && p.type === "kwd_lit") {
                const kw = kwdName(p)
                if (kw === "only") { if (cn === "use") bump("use_only", at(spec)); else bump("use_only", at(spec)) }
                if (kw === "refer" && spec.namedChild(j + 1) && spec.namedChild(j + 1)!.type === "kwd_lit") bump("refer_all", at(spec))
                if (kw === "rename") bump("require_rename", at(spec))
              }
            }
          }
        }
        if (cn === "require-macros" || cn === "use-macros") bump("require_refer_metas", at(n))
        if (cn === "import") {
          for (let i = 1; i < kids.length; i++) if (kids[i] && kids[i].type === "list_lit") bump("import_paren", at(kids[i]))
        }
        if (n.type === "list_lit" && headOf(n)?.type === "sym_lit" && symName(headOf(n)) === "comment" && n.parent?.type === "list_lit") {
          const ph = headOf(n.parent); const pn = ph && ph.type === "sym_lit" ? symName(ph) : ""
          if (["def", "defn", "defn-", "defmacro", "defonce", "defmulti", "deftest"].includes(pn)) bump("comment_shadow_def", at(n))
        }
        if (n.type === "read_cond_lit" || n.type === "splicing_read_cond_lit") {
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "list_lit") {
              const ch = headOf(c)
              if (ch && ch.type === "sym_lit" && ["defn", "def", "defrecord", "defprotocol", "ns"].includes(symName(ch))) bump("reader_cond_stmt", at(c))
            }
          }
        }
        if (n.type === "tagged_or_ctor_lit") {
          const tag = symName(n.namedChild(0)); const payload = n.namedChild(1)
          if (tag && payload && (payload.type === "vec_lit" || payload.type === "map_lit")) {
            const np = tag.includes("/") ? tag.slice(tag.indexOf("/") + 1) : tag
            const ls = np.includes(".") ? np.slice(np.lastIndexOf(".") + 1) : np
            const c0 = ls.charCodeAt(0)
            if (c0 >= 65 && c0 <= 90) bump("tagged_upper", at(n))
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
  }

  writeFileSync(out, JSON.stringify({ repo, shard, nshards, fileCount, counts, samples, descriptions: SUSPECTS }, null, 1))
  console.log(`${repo} shard ${shard}/${nshards}: files=${fileCount}`)
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    if (v > 0) console.log(`  ${String(v).padStart(7)}  ${k}   e.g. ${samples[k]![0] ?? ""}`)
  }
  console.log(`  written ${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
