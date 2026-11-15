/**
 * ELIXIR MASTER REVIEW — the two claims audited weakest so far, tightened to
 * exact contracts.
 *
 * CLAIM 1 (line numbers, M60): every relationship carries a NAME-BEARING line.
 *   The deep audit checked "the callee's name appears within ±2 lines" — a
 *   heuristic. This instrument asserts the EXACT contract PER LABEL, with no
 *   window:
 *     calls       the line of the node that BEARS the callee name (the target
 *                 node, not the statement) — for a pipe step, the step; for a
 *                 capture, the captured name; for a chained receiver, the
 *                 method leaf
 *     contains    the MEMBER's own declaration line (m21 rule)
 *     references  the line of the module NAME node; a multi-line alias member
 *                 carries ITS line (EX3), not the prefix's
 *     implements  the line of the behaviour/protocol atom (or the for-type for
 *                 defimpl, per element)
 *     instantiates the line of the struct alias / the raise's first argument
 *   Every deviation is printed with its file, line and edge so it can be
 *   adjudicated as a defect or an enumerated exception.
 *
 * CLAIM 2 (no relationship is missing): the F5 oracle mirrors the analyzer's
 *   rules, so both can be wrong together, and every earlier census asked
 *   "did an edge appear on this line", not "is this the right edge". This
 *   instrument enumerates the NAMING constructs off the tree and checks each
 *   one produced the edge it names — per site, with the target resolved
 *   independently (an in-file alias map built from the alias directives, not
 *   the analyzer's registry):
 *     use / import / require / alias   -> references (per member)
 *     %Mod{} / %Mod{...}               -> instantiates Mod
 *     raise Mod / reraise Mod          -> instantiates Mod
 *     @behaviour A / @behavior A       -> implements -> A
 *     defimpl P, for: X                -> implements X -> P
 *     @derive A                        -> implements -> A
 *     struct(Mod, …)                   -> instantiates Mod
 *     &Mod.fun/N                       -> calls Mod.fun
 *     Mod.fun(args)                    -> calls Mod.fun  (capitalized receiver)
 *   A construct that names a target and produced no edge is a MISSING edge,
 *   reported with the file and line.
 *
 * CLI: npx tsx script/m14/tmp/elixir-master-audit.ts --repo=<name> [--sample=N]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/sano/ishaq/backbencher-brain"
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPO = arg("repo") ?? "ecto_sql"
const SAMPLE = Number(arg("sample") ?? "60")
const SHOW = Number(arg("show") ?? "8")

function walk(d: string, out: string[] = []): string[] {
  let e: fs.Dirent[]
  try { e = fs.readdirSync(d, { withFileTypes: true }) } catch { return out }
  for (const x of e) {
    if ([".git", "_build", "deps", "node_modules"].includes(x.name)) continue
    const p = path.join(d, x.name)
    if (x.isDirectory()) walk(p, out)
    else if (x.name.endsWith(".ex") || x.name.endsWith(".exs")) out.push(p)
  }
  return out
}
const firstChild = (n: any, t: string) => { for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === t) return c } return null }
const childOfType = (n: any, t: string) => { for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === t) return c } return null }
const rowOf = (n: any) => n.startPosition.row + 1
const leafOf = (s: string) => s.split(".").pop() ?? s

interface Expect { label: string; target: string; line: number; why: string; file: string }

const DEF_FORMS = new Set(["def", "defp", "defmacro", "defmacrop", "defdelegate", "defguard", "defguardp"])

/** EX-D5/X2 pattern position: before the `->` of a stab_clause, on the left of
 *  `=` / `<-`, OR inside a declaration HEAD (the signature of a def/defp, which
 *  the analyzer's `isDefHead` owns: inside a DEF_CONSTRUCT's `arguments`, not
 *  past its `do_block`, and not in a `do:` pair or a `\\` default value).
 *  The arrow token is ANONYMOUS, so it is read from `children`.
 *
 *  The def-head half was missing from the first version of this audit, and its
 *  absence produced 43 phantom "missing" instantiates in a 60-file slice — every
 *  one of them a struct literal in a signature, which is the DECLARED silence.
 *  An independent reviewer has to know this rule to review the lane at all. */
function inPatternPosition(node: any): boolean {
  let cur: any = node
  while (cur && cur.parent) {
    const p: any = cur.parent
    if (p.type === "stab_clause") {
      let arrow: any = null
      for (const c of p.children ?? []) if (c && c.type === "->") { arrow = c; break }
      return arrow ? node.startIndex < arrow.startIndex : false
    }
    if (p.type === "binary_operator" && (p.child(1)?.text === "=" || p.child(1)?.text === "<-")) {
      const left = p.child(0)
      // only the LEFT of a match is a pattern. A struct on the RIGHT of `=`
      // (`insert_all(query = %Ecto.Query{}, _counter)`) is a CONSTRUCTION, and
      // the walk must CONTINUE so the enclosing def-head rule can still fire.
      // The first version returned the rule's answer either way, which made
      // every default-bound struct in a signature look like code.
      if (left && node.startIndex >= left.startIndex && node.endIndex <= left.endIndex) return true
    }
    if (p.type === "call") {
      const id = childOfType(p, "identifier")
      if (id && DEF_FORMS.has(id.text)) {
        // inside the signature? stop at the body, at a `do:` pair, and at a
        // default-value expression (EX2-U6: a default EXECUTES, so it is code)
        // compare by POSITION, not object identity: web-tree-sitter hands back a
        // fresh wrapper per `.parent` access, so `q !== p` never fires and the
        // walk runs past the def into its do_block — which returned `false` and
        // made every guarded def head look like code. (The analyzer's own
        // isDefHead compares node TYPES, so it never had this hazard.)
        let q: any = node
        while (q && !(q.type === "call" && q.startIndex === p.startIndex && q.endIndex === p.endIndex)) {
          if (q.type === "do_block") return false
          if (q.type === "pair") { const kw = childOfType(q, "keyword"); if (kw && kw.text.replace(/:$/, "") === "do") return false }
          if (q.type === "binary_operator" && q.child(1)?.text === "\\") { const r = q.child(2); if (r && node.startIndex >= r.startIndex) return false }
          q = q.parent
        }
        return true
      }
    }
    cur = p
  }
  return false
}
/** The DECLARATION attributes (EX-D25): a docstring is text and a typespec's
 *  `%Changeset{}` is a TYPE REFERENCE, not a construction — so `@type t ::
 *  %Changeset{...}` is silent by rule. A CODE-valued attribute is NOT (that is
 *  EX-A17's whole finding), which is why this list is the only exemption. */
const DECL_ATTRS = new Set([
  "moduledoc", "doc", "spec", "type", "typep", "opaque", "callback", "macrocallback",
  "optional_callbacks", "behaviour", "behavior", "derive", "deprecated",
])
function inDeclarationAttributeValue(node: any): boolean {
  let cur: any = node.parent
  while (cur) {
    if (cur.type === "unary_operator" && cur.child(0)?.text === "@") {
      const value = cur.child(1)
      if (!value || value.type !== "call") return true
      const id = childOfType(value, "identifier")
      return DECL_ATTRS.has(id?.text ?? "")
    }
    cur = cur.parent
  }
  return false
}

/** ELXD8: `alias Phx.New.Project` inside `defmodule Phx.New.Project` is a
 *  lexical no-op — never a self-loop dependency edge. */
function enclosingModuleName(node: any, modules: { name: string; start: number; end: number }[]): string {
  let best = ""
  for (const m of modules) if (node.startIndex >= m.start && node.endIndex <= m.end && m.name.length > best.length) best = m.name
  return best
}
let patternSites = 0
let declAttrSites = 0
let selfDirectiveSites = 0

/** Independent alias map for this file: alias directives as written. */
function aliasMap(root: any): Map<string, string> {
  const m = new Map<string, string>()
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "call") {
      const id = childOfType(n, "identifier")
      if (id?.text === "alias") {
        const args = childOfType(n, "arguments")
        const target = args ? (childOfType(args, "alias") ?? childOfType(args, "identifier")) : null
        if (target) {
          let as: string | null = null
          for (let i = 0; i < (args?.childCount ?? 0); i++) {
            const c = args.child(i)
            if (c?.type === "pair") {
              const kw = childOfType(c, "keyword")
              if (kw && kw.text.replace(/:$/, "") === "as") { const v = c.namedChild?.(1); if (v) as = v.text }
            }
          }
          const full = target.text.startsWith("__MODULE__") ? target.text : target.text
          m.set(as ?? full.split(".").pop()!, full)
        }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return m
}
const resolve = (name: string, am: Map<string, string>): string => {
  if (!name || name.startsWith(":")) return name
  const parts = name.split(".")
  const hit = am.get(parts[0]!)
  if (hit) { parts[0] = hit; return parts.join(".") }
  return name
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
  const parser = new P(); parser.setLanguage(g)
  // `--file=<abs>` adjudicates ONE file — the mode the master review uses when a
  // site is reported, so the claim can be settled by reading that file, not by
  // re-running a sample and hoping the site is in it.
  const ONE = arg("file")
  const dir = path.join(CORPUS_ROOT, REPO)
  const all = ONE ? [path.resolve(ONE)] : walk(dir).sort()
  const files = ONE ? all : SAMPLE > 0 && SAMPLE < all.length ? all.slice(0, SAMPLE) : all

  const lineViol: Record<string, { n: number; ex: string[] }> = {}
  const missing: Record<string, { n: number; ex: string[] }> = {}
  const bump = (m: Record<string, { n: number; ex: string[] }>, k: string, ex: string) => {
    if (!m[k]) m[k] = { n: 0, ex: [] }
    m[k]!.n++
    if (m[k]!.ex.length < SHOW) m[k]!.ex.push(ex)
  }
  let rels = 0, lines0 = 0, sites = 0, sitesCovered = 0

  for (const f of files) {
    const content = fs.readFileSync(f, "utf8")
    const root = parser.parse(content).rootNode
    const res: any = await ASTEngine.parseFile(f, content)
    const rel = path.relative(dir, f)
    const rels_ = (res.relationships ?? []) as any[]
    const relsByLine = new Map<number, any[]>()
    for (const r of rels_) {
      rels++
      if (typeof r.line_number !== "number" || r.line_number <= 0) { lines0++; bump(lineViol, `${r.type} NO LINE`, `${rel} ${r.type} ${r.source} -> ${r.target}`); continue }
      if (!relsByLine.has(r.line_number)) relsByLine.set(r.line_number, [])
      relsByLine.get(r.line_number)!.push(r)
    }

    // ---------- CLAIM 1: contains carries the MEMBER's declaration line -----
    const symStart = new Map<string, number[]>()
    for (const s of res.symbols ?? []) {
      const k = `${s.name}`
      if (!symStart.has(k)) symStart.set(k, [])
      symStart.get(k)!.push(s.range.startLine)
    }
    for (const r of rels_) {
      if (r.type !== "contains" || typeof r.line_number !== "number") continue
      const starts = symStart.get(String(r.target)) ?? []
      if (starts.length === 0) { bump(lineViol, "contains target is not a symbol", `${rel}:${r.line_number} ${r.source} -> ${r.target}`); continue }
      // the member's own declaration line must be among the stored starts, and
      // the edge must name that line
      if (!starts.includes(r.line_number)) {
        bump(lineViol, "contains line != member declaration line", `${rel}:${r.line_number} ${r.source} -> ${r.target} (symbol starts at ${starts.join(",")})`)
      }
    }

    // ---------- CLAIM 2: per-site edge identity for the NAMING constructs ---
    const am = aliasMap(root)
    const mods: { name: string; start: number; end: number }[] = []
    {
      const st: { n: any; q: number }[] = [{ n: root, q: 0 }]
      while (st.length) {
        const { n: x, q } = st.pop()!
        if (x.type === "call" && q === 0) {
          const id = childOfType(x, "identifier")
          if (id?.text === "defmodule" || id?.text === "defprotocol") {
            // a nested module name is a `dot` chain in this grammar, not one
            // `alias` node (`defmodule Phx.New.Project` — and that self-alias
            // two lines down is exactly the site the ELXD8 rule is about)
            // the module name sits in the defmodule's `arguments`
            // (call[identifier, arguments[alias], do_block]), NOT as a direct
            // child — the first version of this pass looked for a direct alias
            // child, found none, and collected an empty module list, which left
            // the ELXD8 self-alias check permanently unable to fire.
            const aArgs = childOfType(x, "arguments")
            const a = childOfType(x, "alias") ?? childOfType(x, "dot")
              ?? (aArgs ? childOfType(aArgs, "alias") ?? childOfType(aArgs, "dot") : null)
            if (a) mods.push({ name: a.text, start: x.startIndex, end: x.endIndex })
          }
        }
        const inner = x.type === "call" && q === 0 && childOfType(x, "identifier")?.text === "quote" ? q + 1 : q
        for (let i = x.namedChildCount - 1; i >= 0; i--) { const c = x.namedChild(i); if (c) st.push({ n: c, q: inner }) }
      }
    }
    const expects: Expect[] = []
    const stack: any[] = [{ n: root, quote: 0 }]
    while (stack.length) {
      const { n, quote } = stack.pop()!
      let inQ = quote > 0
      if (n.type === "call") {
        const id = childOfType(n, "identifier")
        const t = id?.text ?? ""
        if (t === "quote") inQ = true
        const quoted = quote > 0
        const args = childOfType(n, "arguments")
        if (!quoted && (t === "use" || t === "import" || t === "require" || t === "alias")) {
          const target = args ? (childOfType(args, "alias") ?? childOfType(args, "identifier")) : null
          if (target && target.text !== "__MODULE__") {
            // ELXD8 mirror: a directive naming the module it sits inside is a
            // lexical no-op (`alias Phx.New.Project` inside `defmodule
            // Phx.New.Project`); a self-loop dependency edge would be fabricated.
            if (resolve(target.text, am) === enclosingModuleName(target, mods) && enclosingModuleName(target, mods) !== "") { selfDirectiveSites++; continue }
            expects.push({ label: "references", target: resolve(target.text, am), line: rowOf(target), why: `${t} ${target.text}`, file: rel })
          }
        }
        if (!quoted && (t === "raise" || t === "reraise" || t === "struct" || t === "struct!")) {
          const a0 = args?.namedChild?.(0)
          if (a0?.type === "alias") expects.push({ label: "instantiates", target: resolve(a0.text, am), line: rowOf(a0), why: `${t} ${a0.text}`, file: rel })
        }
        if (!quoted && t === "defimpl") {
          // protocol = first alias, for-type = the `for:` value
          const aliases = []
          if (args) for (let i = 0; i < args.childCount; i++) { const c = args.child(i); if (c?.type === "alias") aliases.push(c) }
          const proto = aliases[0] ? resolve(aliases[0].text, am) : null
          let forTypes: any[] = []
          for (let i = 0; i < (args?.childCount ?? 0); i++) {
            const c = args.child(i)
            if (c?.type !== "pair") continue
            const kw = childOfType(c, "keyword")
            if (kw && kw.text.replace(/:$/, "") === "for") {
              const v = c.namedChild?.(1)
              if (v) forTypes = v.type === "list" ? v.namedChildren.filter((x: any) => x.type === "alias") : [v]
            }
          }
          if (proto) for (const ft of forTypes) expects.push({ label: "implements", target: proto, line: rowOf(ft), why: `defimpl ${proto} for ${ft.text} (edge ${resolve(ft.text, am)} -> ${proto})`, file: rel, })
        }
        // a qualified call: Mod.fun( ... ) with a capitalized receiver and args
        // no regex anywhere in this lane's instruments either: an uppercase
        // root is a module name, tested by character code
        const isUpper = (x: string) => x.length > 0 && x[0] >= "A" && x[0] <= "Z"
        if (!quoted && t && isUpper(t) && args && n.children.some((c: any) => c.type === "dot")) {
          expects.push({ label: "calls", target: resolve(t, am), line: rowOf(id!), why: `${t}(…) qualified call`, file: rel })
        }
      }
      if (n.type === "unary_operator" && n.child(0)?.text === "@" && !inQ) {
        const inner = n.child(1)
        const aid = inner?.type === "call" ? childOfType(inner, "identifier") : null
        const aargs = inner?.type === "call" ? childOfType(inner, "arguments") : null
        if (aid && (aid.text === "behaviour" || aid.text === "behavior")) {
          const a0 = aargs?.namedChild?.(0)
          if (a0?.type === "atom") expects.push({ label: "implements", target: a0.text.replace(/^:/, ""), line: rowOf(a0), why: `@${aid.text} :${a0.text}`, file: rel })
        }
        if (aid && aid.text === "derive") {
          const a0 = aargs?.namedChild?.(0)
          const protos: any[] = []
          if (a0?.type === "alias") protos.push(a0)
          else if (a0?.type === "tuple") { const x = childOfType(a0, "alias"); if (x) protos.push(x) }
          else if (a0?.type === "list") for (const el of a0.namedChildren) { if (el.type === "alias") protos.push(el); else if (el.type === "tuple") { const y = childOfType(el, "alias"); if (y) protos.push(y) } }
          for (const p of protos) expects.push({ label: "implements", target: resolve(p.text, am), line: rowOf(p), why: `@derive ${p.text}`, file: rel })
        }
      }
      if (n.type === "map" && !inQ) {
        const inDeclAttr = inDeclarationAttributeValue(n)
        if (inDeclAttr) { declAttrSites++ }
        const st = childOfType(n, "struct")
        const al = st ? childOfType(st, "alias") : null
        // The declared PATTERN rule (EX-D5/X2): a struct literal in a def head,
        // a `case`/`fn`/`receive` clause pattern, or the left of `=`/`<-` is a
        // DESTRUCTURING MATCH, not a construction, and is silent. This audit
        // must state the rule or it reports the silence as a missing edge — the
        // first version did exactly that and produced 167 phantom "missing"
        // instantiates in a 60-file slice, every one of them this shape.
        if (al && !inPatternPosition(n) && !inDeclAttr) expects.push({ label: "instantiates", target: resolve(al.text, am), line: rowOf(al), why: `%${al.text}{}`, file: rel })
        else if (al) patternSites++
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push({ n: c, quote: inQ ? quote + 1 : quote }) }
    }
    for (const e of expects) {
      sites++
      const onLine = relsByLine.get(e.line) ?? []
      const hit = onLine.some((r) => r.type === e.label && (String(r.target) === e.target || leafOf(String(r.target)) === leafOf(e.target)))
      if (hit) sitesCovered++
      else {
        // try the whole file, and record which edge class is near the line
        const near = [...relsByLine.entries()].filter(([l]) => Math.abs(l - e.line) <= 3).flatMap(([, rs]) => rs.map((r) => `${r.type}->${r.target}@${r.line_number}`))
        bump(missing, `${e.label} (${e.why.split(" ")[0]})`, `${e.file}:${e.line} expected ${e.label} -> ${e.target}  near: ${near.join(", ") || "(nothing)"}`)
      }
    }
  }

  console.log(`\n######## ELIXIR MASTER AUDIT — repo=${REPO} files=${files.length} relationships=${rels} (line-less: ${lines0})`)
  console.log(`CLAIM 1 line contract — exact per label:`)
  const lv = Object.keys(lineViol)
  if (lv.length === 0) console.log("    CLEAN — every edge line is the name-bearing line and every contains edge names its member's declaration line")
  for (const k of lv.sort()) { console.log(`    ${String(lineViol[k]!.n).padStart(5)}  ${k}`); for (const e of lineViol[k]!.ex) console.log(`        ${e}`) }
  console.log(`CLAIM 2 per-site relationship identity — ${sitesCovered}/${sites} naming constructs produced the edge they name (${((sitesCovered / Math.max(1, sites)) * 100).toFixed(2)}%):`)
  console.log(`    (struct literals in PATTERN position, correctly silent per EX-D5/X2: ${patternSites})`)
  console.log(`    (naming constructs inside a DECLARATION attribute value, correctly silent per EX-D25: ${declAttrSites}; self-directives per ELXD8: ${selfDirectiveSites})`)
  const ms = Object.keys(missing)
  if (ms.length === 0) console.log("    CLEAN — every use/import/alias/require, %Mod{}, raise Mod, @behaviour, @derive, defimpl, struct(Mod,…) and Mod.fun(…) site produced its edge")
  for (const k of ms.sort((a, b) => missing[b]!.n - missing[a]!.n)) { console.log(`    ${String(missing[k]!.n).padStart(5)}  ${k}`); for (const e of missing[k]!.ex) console.log(`        ${e}`) }
}
main().catch((e) => { console.error(e); process.exit(1) })
