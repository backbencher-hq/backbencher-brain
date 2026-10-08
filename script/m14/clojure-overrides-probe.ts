// CLOJURE OVERRIDES PROBE — does the LANGUAGE have the construct?
//
// THE RULING UNDER TEST. docs/analyzers/real-clojure-analyzer.md ruled `overrides`
// N/A with this reason: "`defmethod` shares the multimethod's var identity, so
// source and target would be identical". That is a PROSE ruling, and the
// ontology workstream exists precisely because a prose justification for
// `overrides` survived a whole wave and was wrong. So the ruling is treated as
// the hypothesis and the corpus is the experiment.
//
// WHY THE REASON IS SUSPECT ON ITS FACE. In every other lane the overriding
// method and the overridden method SHARE A NAME — `BufferedWriter.write`
// overrides `Writer.write`. Name identity is the NORMAL case for an override,
// not a disqualifier. What decides the question is whether a TYPE relation puts
// the two ends in opposition, and Clojure has two such relations nobody counted:
//
//   1. a protocol method IMPLEMENTED on a record/type/reify/extend-* — the exact
//      Java shape (`R.m` overrides `P.m` where `R implements P`), and the
//      analyzer already emits the `implements` leg, so the override leg has
//      everything it needs inside one file;
//   2. `proxy [Super Ifaces]` — the one form that names a SUPERCLASS, and the
//      analyzer already emits `extends` for it.
//
// This probe counts that population ON THE PARSE TREE, plus the defmulti /
// defmethod population the existing prose ruling names, so the ruling is tested
// rather than restated.
//
// THE TIGHT FORM (what an analyzer may emit without inventing an edge):
//
//   impl(M on owner O)  ∧  O's form names protocol P  ∧  P is DECLARED in this
//   file  ∧  M ∈ methods(P)
//
// Every conjunct is a tree fact. Nothing here is guessed from a name, and no
// conjunct needs to know what another FILE contains — which is the difference
// between an edge and a fabrication.
//
// INSTRUMENT CONTRACT: the population is DERIVED (readdir walk + extension
// test) and printed with every count. The tree is walked through the node API —
// `node.type`, `namedChild(i)`, `childForFieldName` — never source text. NO REGEX
// anywhere: the ontology gate was burned twice by a text probe matching a
// comment and a heredoc.
//
// Usage:
//   BB_REPO=<repo> BB_CORPUS_DIR=clj-kondo bun script/m14/clojure-overrides-probe.ts
import { readdirSync, statSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const REPO = process.env.BB_REPO || "$HOME/backbencher-brain"
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const DIRS = (process.env.BB_CORPUS_DIR || "clj-kondo").split(",")
const LIMIT = Number(process.env.BB_LIMIT || 0)
const EXT = [".clj", ".cljs", ".cljc"]

const { getParser } = await import(`${REPO}/src/ast/engine.ts`)

function deriveFiles(root: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 24) return
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "target") continue
        walk(p, depth + 1)
      } else if (EXT.some((x) => e.name.endsWith(x))) {
        try { if (statSync(p).size <= 400_000) out.push(p) } catch {}
      }
    }
  }
  walk(root, 0)
  out.sort()
  return out
}

type N = any
const symName = (n: N | null): string => {
  if (!n || n.type !== "sym_lit") return ""
  const nm = n.childForFieldName("name")
  return nm ? String(nm.text) : ""
}
const headName = (form: N): string => {
  const h = form.namedChild(0)
  return h ? symName(h) : ""
}

const PROTO_DECLS = ["defprotocol", "definterface"]

interface Impl { method: string; line: number; form: string; owner: string; ownerKind: "type" | "anonymous"; protocols: string[]; superName: string }
interface FileFacts {
  protoMethods: Map<string, Set<string>>
  multimethods: Map<string, number>
  defmethods: Array<{ name: string; line: number }>
  impls: Impl[]
}

function readFacts(root: N): FileFacts {
  const protoMethods = new Map<string, Set<string>>()
  const multimethods = new Map<string, number>()
  const defmethods: Array<{ name: string; line: number }> = []
  const impls: Impl[] = []
  const stack: N[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "list_lit") {
      const form = headName(n)
      const line = n.startPosition.row + 1
      if (PROTO_DECLS.includes(form)) {
        const pname = symName(n.namedChild(1))
        if (pname) {
          const ms = new Set<string>()
          for (let i = 2; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type === "list_lit") {
              const mn = symName(c.namedChild(0))
              if (mn) ms.add(mn)
            }
          }
          protoMethods.set(pname, ms)
        }
      } else if (form === "defmulti") {
        const mn = symName(n.namedChild(1))
        if (mn) multimethods.set(mn, line)
      } else if (form === "defmethod") {
        defmethods.push({ name: symName(n.namedChild(1)), line })
      } else if (form === "defrecord" || form === "deftype") {
        const owner = symName(n.namedChild(1))
        let fieldsAt = -1
        for (let i = 2; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "vec_lit") { fieldsAt = i; break }
        }
        const protocols: string[] = []
        for (let i = fieldsAt + 1; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "sym_lit") protocols.push(symName(c))
        }
        for (let i = fieldsAt + 1; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "list_lit") continue
          const mn = symName(c.namedChild(0))
          if (mn) impls.push({ method: mn, line, form, owner, ownerKind: "type", protocols, superName: "" })
        }
      } else if (form === "reify") {
        const protocols: string[] = []
        for (let i = 1; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "sym_lit") protocols.push(symName(c))
        }
        for (let i = 1; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "list_lit") continue
          const mn = symName(c.namedChild(0))
          if (mn) impls.push({ method: mn, line, form, owner: "", ownerKind: "anonymous", protocols, superName: "" })
        }
      } else if (form === "extend-type" || form === "extend-protocol") {
        // (extend-type T P (m …))  |  (extend-protocol P T (m …))
        const protos: string[] = []
        const owners: string[] = []
        for (let i = 1; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "sym_lit") {
            if (form === "extend-type") { owners.push(symName(c)); protos.push(symName(n.namedChild(2))) }
            else { protos.push(symName(c)); owners.push(symName(n.namedChild(2))) }
          }
          if (c && c.type === "list_lit") {
            const mn = symName(c.namedChild(0))
            if (mn) impls.push({ method: mn, line, form, owner: owners[0] || "", ownerKind: "type", protocols: protos.filter(Boolean), superName: "" })
          }
        }
      } else if (form === "proxy") {
        // (proxy [Super Ifaces] (m [args] …) …) — the Super is the one place
        // Clojure names a superclass, and the analyzer emits `extends` for it.
        const sv = n.namedChild(1)
        const supers: string[] = []
        if (sv && sv.type === "vec_lit") {
          for (let i = 0; i < sv.namedChildCount; i++) {
            const c = sv.namedChild(i)
            if (c && c.type === "sym_lit") supers.push(symName(c))
          }
        }
        for (let i = 2; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c || c.type !== "list_lit") continue
          const mn = symName(c.namedChild(0))
          if (mn) impls.push({ method: mn, line, form, owner: "", ownerKind: "anonymous", protocols: [], superName: supers[0] || "" })
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return { protoMethods, multimethods, defmethods, impls }
}

type Counter = Record<string, number>
const rows: Array<{ dir: string; files: number; parsed: number; c: Counter; ex: Record<string, string[]> }> = []

for (const dirName of DIRS) {
  const corpusDir = join(CORPUS, dirName)
  let ok = false
  try { ok = statSync(corpusDir).isDirectory() } catch {}
  if (!ok) { console.error(`PROBE: ${corpusDir} absent — a missing corpus is a SKIP, never a pass.`); continue }
  const discovered = deriveFiles(corpusDir)
  const files = LIMIT > 0 ? discovered.slice(0, LIMIT) : discovered
  // Annotated with the row type the counter helpers below write THROUGH: `c: {}` and
  // `ex: {}` infer as the empty type on their own, so `row.c[k]` was indexing `{}` —
  // the counters the probe records were typed as impossible-to-write.
  const row: (typeof rows)[number] = { dir: dirName, files: files.length, parsed: 0, c: {}, ex: {} }
  const bump = (k: string, where: string) => {
    row.c[k] = (row.c[k] || 0) + 1
    const arr = row.ex[k] || (row.ex[k] = [])
    if (arr.length < 3) arr.push(where)
  }
  const parser = await getParser("clojure")
  for (const f of files) {
    const rel = relative(corpusDir, f)
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    let tree: any
    try { tree = await parser.parse(content, f) } catch { continue }
    row.parsed++
    const facts = readFacts(tree.rootNode)
    // ── the population the PROSE RULING names ──
    for (const [, ms] of facts.protoMethods) bump("proto_method_decl", `${rel} (${ms.size} signature(s) declared)`)
    for (const d of facts.defmethods) {
      bump("defmethod", `${rel}:${d.line} (${d.name})`)
      if (facts.multimethods.has(d.name)) bump("defmethod_paired_with_infile_defmulti", `${rel}:${d.line} (${d.name})`)
      else bump("defmethod_multimethod_not_in_file", `${rel}:${d.line} (${d.name})`)
    }
    for (const [, line] of facts.multimethods) { bump("defmulti", `${rel}:${line}`); break }
    // ── the population an `overrides` edge could be derived from ──
    for (const im of facts.impls) {
      bump("impl_site", `${rel}:${im.line} (${im.form} ${im.method})`)
      if (im.ownerKind === "type") bump("impl_site_named_owner", `${rel}:${im.line} (${im.owner}/${im.method})`)
      else bump("impl_site_anonymous_owner", `${rel}:${im.line} (${im.form}/${im.method})`)
      // conjunct 1+2: the owner names a protocol AND the method is one of ITS methods
      for (const p of im.protocols) {
        const bare = p.indexOf("/") >= 0 ? p.slice(p.indexOf("/") + 1) : p
        const ms = facts.protoMethods.get(bare)
        if (!ms) continue
        if (ms.has(im.method)) {
          bump("override_derivable", `${rel}:${im.line} (${im.owner || im.form}.${im.method} overrides ${p}/${im.method})`)
          if (im.ownerKind === "type") bump("override_derivable_named_owner", `${rel}:${im.line} (${im.owner}.${im.method} -> ${p}/${im.method})`)
          else bump("override_derivable_anonymous_owner", `${rel}:${im.line} (${im.form}/${im.method} -> ${p}/${im.method})`)
          break
        }
      }
      // proxy: the Super is named, and an in-file defprotocol/deftype of that name
      // gives the method's declaration. Java classes are not, so this is rare.
      if (im.superName) {
        const ms = facts.protoMethods.get(im.superName)
        if (ms && ms.has(im.method)) bump("override_derivable_from_proxy_super", `${rel}:${im.line} (proxy Super ${im.superName}/${im.method})`)
        else bump("proxy_super_not_declared_in_file", `${rel}:${im.line} (proxy Super ${im.superName}/${im.method})`)
      }
    }
  }
  rows.push(row)
}

console.log("CLOJURE OVERRIDES PROBE — parse-tree counts, source text never read\n")
const KEYS = [
  "proto_method_decl", "defmulti", "defmethod", "defmethod_paired_with_infile_defmulti",
  "defmethod_multimethod_not_in_file",
  "impl_site", "impl_site_named_owner", "impl_site_anonymous_owner",
  "override_derivable", "override_derivable_named_owner", "override_derivable_anonymous_owner",
  "proxy_super_not_declared_in_file", "override_derivable_from_proxy_super",
]
for (const row of rows) {
  console.log(`corpus ${row.dir}: files discovered ${row.files}, parsed ${row.parsed}`)
  for (const k of KEYS) {
    const n = row.c[k] || 0
    console.log(`  ${k.padEnd(40)} ${String(n).padStart(6)}${n > 0 ? "   e.g. " + (row.ex[k] || []).slice(0, 2).join(" | ") : ""}`)
  }
  console.log("")
}
console.log("READING")
console.log("  override_derivable  — THE NUMBER THAT DECIDES THE RULING. Every conjunct is a tree fact:")
console.log("                       the impl sits on a form that names protocol P, P is declared in THIS")
console.log("                       file, and the impl's method name is one of P's declared methods.")
console.log("                       Nothing needs another file, so nothing here is a guess.")
console.log("  defmethod / defmulti — the population the existing prose ruling names. A defmethod is")
console.log("                       NOT an override in any language: a multimethod has no base")
console.log("                       implementation to replace, it has a DISPATCH FUNCTION.")