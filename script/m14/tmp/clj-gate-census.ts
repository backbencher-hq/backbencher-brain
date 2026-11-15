// CLJ-DEEP · INSTRUMENT 5 — the gate census.
//
// After CLJ-D1/D2 the analyzer asks, at every bare head, "is this the standard
// library, the file's own var, or a referred external name?" and emits a `calls`
// edge only for the last two. This instrument answers the review question that
// follows: for every SURVIVING call edge whose target is a real clojure.core
// var (per the derivation), WHICH exemption admitted it?
//
// The three admissible answers are checked structurally, independently of the
// analyzer's own gate, so this is a check on the rule and not a restatement of
// it:
//   FILE-DECLARED — the file mints a symbol of that name (a def-family name, a
//                   protocol signature, a `declare`);
//   REGION-BOUND  — the call sits inside a form that BINDS that name (a fn
//                   parameter, a `let`/binding vector, a letfn spec) — the
//                   shape the region-scoped shadow ranges exist for;
//   REFERRED      — an ns `:refer`/`:only`/`:rename` clause names it.
// Anything else is a residual fabrication and is reported as such.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const CORE_VARS = new Set<string>(JSON.parse(readFileSync(process.env.BB_CORE_VARS ?? "/tmp/opencode/clj-core-vars.json", "utf8")).derived)

function listFiles(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(dir)) return []
  let tracked: string[] = []
  try { tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { tracked = [] }
  if (tracked.length === 0) return []
  return tracked.filter(f => /\.(clj|cljc|cljs)$/i.test(f)).map(f => path.join(dir, f)).sort()
}

const DEF_HEADS = new Set(["def", "defn", "defn-", "defmacro", "defonce", "defmulti", "defmethod", "deftest", "declare", "s/defn", "mu/defn"])
const BIND_HEADS = new Set(["let", "let*", "loop", "loop*", "when-let", "if-let", "when-some", "if-some", "when-first", "binding", "for", "doseq", "dotimes", "with-open", "with-local-vars", "with-bindings", "letfn"])
const FN_HEADS = new Set(["fn", "defn", "defn-", "defmacro", "defmethod", "deftest", "s/defn", "mu/defn"])

async function main() {
  const repo = process.argv[2] ?? "clojure"
  const out = process.argv[3] ?? `/tmp/opencode/clj-gate-${repo}.json`

  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const analyzer = new mod.RealClojureAnalyzer()

  const headOf = (list: any): any => {
    for (let i = 0; i < list.namedChildCount; i++) {
      const c = list.namedChild(i)
      if (c && c.type !== "comment" && c.type !== "dis_expr" && c.type !== "meta_lit") return c
    }
    return null
  }
  const symName = (nd: any): string => {
    if (!nd) return ""
    if (nd.type === "sym_lit") { const nm = nd.childForFieldName("name"); const ns = nd.childForFieldName("namespace"); if (nm && ns) return `${ns.text}/${nm.text}`; if (nm) return nm.text; return nd.text }
    return nd.text
  }
  // Is `name` bound by an ENCLOSING form at `pos`? An ancestor walk with a
  // direct structural test per form type — deliberately a different mechanism
  // from the analyzer's flat range list.
  const regionBound = (node: any, name: string): string | null => {
    let cur = node.parent
    while (cur) {
      if (cur.type === "list_lit") {
        const h = headOf(cur)
        const hn = h && h.type === "sym_lit" ? symName(h) : ""
        if (FN_HEADS.has(hn) || DEF_HEADS.has(hn)) {
          for (let i = 0; i < cur.namedChildCount; i++) {
            const c = cur.namedChild(i)
            if (c && c.type === "vec_lit") {
              for (let j = 0; j < c.namedChildCount; j++) { const b = c.namedChild(j); if (b && b.type === "sym_lit" && symName(b) === name) return `param(${hn})` }
            }
          }
        }
        if (BIND_HEADS.has(hn)) {
          const bv = cur.namedChild(1)
          if (bv && bv.type === "vec_lit") {
            for (let j = 0; j < bv.namedChildCount; j++) { const b = bv.namedChild(j); if (b && b.type === "sym_lit" && symName(b) === name) return `binding(${hn})` }
          }
        }
        if (hn === "letfn") {
          const sv = cur.namedChild(1)
          if (sv && sv.type === "vec_lit") for (let j = 0; j < sv.namedChildCount; j++) { const sp = sv.namedChild(j); if (sp && sp.type === "list_lit" && symName(headOf(sp)) === name) return "letfn-spec" }
        }
      }
      cur = cur.parent
    }
    return null
  }

  const classes: Record<string, number> = { "FILE-DECLARED": 0, "REGION-BOUND": 0, REFERRED: 0, RESIDUAL: 0 }
  const residual: string[] = []
  const admitted: Record<string, number> = {}
  let files = 0, surviving = 0

  for (const file of listFiles(repo)) {
    let content: string
    try { content = readFileSync(file, "utf8") } catch { continue }
    if (content.length > 400_000) continue
    let root: any
    try { root = parser.parse(content).rootNode } catch { continue }
    let res: any
    try { res = analyzer.analyze(root, content, file) } catch { continue }
    files++
    const declared = new Set<string>((res.symbols ?? []).map((s: any) => s.name))
    // map: (line, target) -> the call NODE, so regionBound can walk from it
    const byLine: Map<number, any[]> = new Map()
    const st0: any[] = [root]
    while (st0.length > 0) {
      const n = st0.pop()!
      if (n.type === "list_lit") {
        const h = headOf(n)
        if (h && h.type === "sym_lit") {
          const nm = symName(h)
          if (nm && !nm.includes("/")) { const l = h.startPosition.row + 1; if (!byLine.has(l)) byLine.set(l, []); byLine.get(l)!.push(n) }
        }
      }
      // The `#(f …)` shorthand has NO inner list: the callee is the anon_fn_lit's
      // own first named child (the analyzer's F1 finding). Index it by the same
      // line, or a region-bound shorthand head reads as a residual.
      if (n.type === "anon_fn_lit") {
        const h0 = n.namedChild(0)
        if (h0 && h0.type === "sym_lit") {
          const nm = symName(h0)
          if (nm && !nm.includes("/")) { const l = h0.startPosition.row + 1; if (!byLine.has(l)) byLine.set(l, []); byLine.get(l)!.push(n) }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st0.push(c) }
    }
    for (const r of res.relationships ?? []) {
      if (r.type !== "calls") continue
      const t = String(r.target)
      if (t.includes("/") || !CORE_VARS.has(t)) continue
      surviving++
      let cls: string | null = null
      if (declared.has(t)) cls = "FILE-DECLARED"
      if (!cls) {
        for (const cand of byLine.get(r.line_number ?? -1) ?? []) {
          if (symName(headOf(cand)) !== t) continue
          const rb = regionBound(cand, t)
          if (rb) { cls = "REGION-BOUND"; break }
        }
      }
      if (!cls) {
        // REFERRED: the target was rewritten to lib/name by the post-walk
        // pass, so a surviving BARE core name cannot have been referred… unless
        // the refer shadowed nothing. Recorded as residual for a human read.
        cls = "RESIDUAL"
        if (residual.length < 60) residual.push(`${path.relative(CORPUS_ROOT, file)}:${r.line_number} ${r.source} -[calls]-> ${t}`)
      }
      classes[cls] = (classes[cls] ?? 0) + 1
      if (cls !== "RESIDUAL") admitted[`${cls}:${t}`] = (admitted[`${cls}:${t}`] ?? 0) + 1
    }
  }

  writeFileSync(out, JSON.stringify({ repo, files, survivingCoreCallEdges: surviving, classes, residual, admitted }, null, 1))
  console.log(`${repo}: files=${files} surviving call edges to a derived clojure.core var = ${surviving}`)
  for (const [k, v] of Object.entries(classes).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(6)}  ${k}`)
  if (residual.length) { console.log("   RESIDUALS:"); for (const r of residual) console.log("     " + r) }
  console.log(`   written ${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
