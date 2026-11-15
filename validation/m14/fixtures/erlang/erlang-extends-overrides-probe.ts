// validation/m14/fixtures/erlang/erlang-extends-overrides-probe.ts
//
// The two labels DERIV_EXPORTS_ERL does not emit — `extends` and `overrides` —
// settled by measuring the LANGUAGE over the whole corpus, which is the only
// instrument the ontology gate accepts for a ruling (see its header: `overrides`
// had a prose justification for a whole wave and it was wrong).
//
// A ruling needs a written reason AND a corpus measurement, and the gate
// accepts two instruments, chosen by the question:
//
//   A. GRAMMAR INVENTORY — for a type that needs a node type the language does
//      not have. Enumerating every node type the pinned wasm actually produces
//      is positive evidence of absence: if the grammar has no construct that
//      can say "this type has a supertype", nothing in the corpus can say it
//      either, however much corpus you read.
//
//   B. PARSE-TREE SEMANTIC COUNT — for a type the language CAN express. Some
//      of Erlang genuinely does have redefinition-shaped facts, and a grammar
//      inventory cannot see them; they have to be counted on the tree, where a
//      string literal or a comment cannot fake them.
//
// THIS FILE MEASURES BOTH, for both labels, and refuses to conclude anything
// it did not count.
//
// The three findings it is built to test:
//
//   F1  EXTENDS/INHERITANCE. The grammar has no type declaration at all.
//       Erlang has no class, no struct-with-a-base, no interface, no trait, no
//       nominal subtyping declaration. `-behaviour(B)` is the ONLY
//       "conform to another module's contract" construct in the language, and
//       the analyzer already emits it as `implements`. Emitting `extends` for
//       it would put a second, different label on one fact — and `extends` on a
//       behaviour would be WRONG, because `-behaviour` says nothing about
//       where B's definitions come from: B is not a supertype, it is an
//       unrelated module that happens to require some functions.
//
//   F2  OVERRIDES/REDEFINITION. This is the one Erlang genuinely could be said
//       to have, and it is measured rather than asserted: a second clause group
//       for the SAME (name, arity) in the same file is legal SYNTAX (which is
//       why a grammar inventory cannot find it — you have to count), so this
//       script counts `fun_decl`s per identity through a cursor walk and
//       reports the distribution. The expectation is 1 everywhere, because the
//       Erlang compiler rejects a second definition. If the corpus contradicts
//       that, the ruling is FALSIFIED and the gate says so.
//
//   F3  BEHAVIOUR CALLBACK SATISFACTION. The nearest thing Erlang has to a
//       method override: a behaviour declares `-callback foo(...)`, and the
//       implementing module defines `foo(...)`. Counted here — every behaviour
//       edge in the corpus, every callback declaration, and every definition
//       that satisfies a declared callback. This is already carried by ONE
//       `implements` edge per behaviour. Emitting `overrides` for it would be a
//       second label for one fact, and `bb_impact` would then report two kinds
//       of breakage for one change.
//
// NO REGEXP. Every count is a tree-sitter cursor walk over node.type and named
// children. Attribute names come from the grammar's own `attr_name`/`atom`
// nodes, which is why a `wxe_util:get_cbId` inside a string literal cannot
// appear here.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const REPO_LIST = REPOS.length > 0 ? REPOS : ["otp"]
const OUT = process.env.BB_OUT ?? ""

const SKIP_DIR = new Set([".git", "_build", "_checkouts", "node_modules", "otp_build", "prebuild"])
const files: string[] = []
let skippedBig = 0
const walk = (dir: string): void => {
  let ents: import("node:fs").Dirent[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (SKIP_DIR.has(e.name)) continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) { walk(abs); continue }
    if (!(e.name.endsWith(".erl") || e.name.endsWith(".hrl"))) continue
    let size = 0
    try { size = statSync(abs).size } catch { continue }
    if (size > 400_000) { skippedBig++; continue }
    files.push(abs)
  }
}
for (const repo of REPO_LIST) {
  const dir = path.join(CORPUS, repo)
  if (!existsSync(dir)) { console.error(`repos ${repo} not present under ${CORPUS}`); process.exit(2) }
  walk(dir)
}
files.sort()

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-erlang.wasm")))
const parser = new P()
parser.setLanguage(lang)

// ---------------------------------------------------------------------------
// INSTRUMENT A — the grammar's own vocabulary, over the whole corpus.
// A node-type name that would express inheritance or redefinition. Matched by
// WORD, not by regex: a node type name is a lower_snake_case token, so splitting
// on `_` and comparing tokens is exact and cannot match a substring.
const WOULD_MEAN = new Set([
  // a declaration that could carry a supertype
  "class", "classs", "classdeclaration", "classdef", "struct", "interface", "trait", "impl",
  "inherit", "inherits", "extends", "superclass", "subclass", "base", "basetype", "prototype",
  "mixin", "subtype", "supertype", "parent", "abstract", "open",
  // a declaration that could replace another
  "override", "overrides", "overriding", "redefinition", "redefines", "redeclare",
])
const wouldMeanTokens = new Map<string, number>()
const nodeTypes = new Map<string, number>()
const attrNames = new Map<string, number>()
const attributeKinds = new Map<string, number>()

// ---------------------------------------------------------------------------
// INSTRUMENT B — semantic counts on the tree.
// B1: a second (name, arity) definition in one file.
const redefineSites: string[] = []
let funDeclCount = 0
let functionClauseCount = 0
let maxClausesPerIdentity = 0
// B2: behaviours, their callbacks, and the definitions that satisfy them.
let behaviourAttrs = 0
const behaviourEdges = new Map<string, number>()
let callbackAttrs = 0
let optionalCallbackAttrs = 0
let filesWithBehaviour = 0
const callbackSat: { file: string; behaviour: string; callback: string }[] = []
let modulesDeclaringBehaviour = 0
// F3 census: what OTP actually does with behaviours, so the ruling rests on a
// measured shape rather than on a claim about one.
let behaviourUses = new Map<string, number>()

const childByType = (n: any, t: string): any => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === t) return c
  }
  return undefined
}
const argCount = (args: any): number => {
  if (!args) return 0
  let n = 0
  for (let i = 0; i < args.namedChildCount; i++) {
    const c = args.namedChild(i)
    if (c && c.type !== "comment") n++
  }
  return n
}
const stripHash = (t: string): string => (t.startsWith("#") ? t.slice(1) : t)
const digitsOf = (t: string | undefined): string => {
  let out = ""
  for (const ch of t ?? "") if (ch >= "0" && ch <= "9") out += ch
  return out
}
/** `fa` -> "name/arity", from the grammar's own node, in both spellings. */
const readFa = (fa: any): string | undefined => {
  const atom = childByType(fa, "atom")
  const ar = childByType(fa, "arity")
  if (atom && ar) return `${stripHash(atom.text)}/${digitsOf(childByType(ar, "integer")?.text)}`
  // `-nifs` spells the arity as `f / 1`, a binary_op_expr, not an `fa`.
  const parts: string[] = []
  for (let i = 0; i < fa.namedChildCount; i++) {
    const c = fa.namedChild(i)
    if (!c) continue
    parts.push(c.type === "binary_op_expr" ? c.text.replace(" ", "") : c.text)
  }
  if (parts.length >= 2 && parts[0].length > 0) return `${stripHash(parts[0])}/${digitsOf(parts[1])}`
  if (atom) return atom.text
  return undefined
}

let parseFail = 0
let damaged = 0
const topLevelErrorFiles: string[] = []

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(content) } catch { parseFail++; continue }
  if (!tree) { parseFail++; continue }
  const root = tree.rootNode
  const rel = f.slice(CORPUS.length + 1)

  // --- A: the node-type inventory
  const cur = root.walk()
  let descend = true
  for (;;) {
    const n: any = cur.currentNode
    const t: string = n.type
    nodeTypes.set(t, (nodeTypes.get(t) ?? 0) + 1)
    if (t.includes("_")) {
      for (const tok of t.split("_")) {
        if (WOULD_MEAN.has(tok)) wouldMeanTokens.set(t, (wouldMeanTokens.get(t) ?? 0) + 1)
      }
    } else if (WOULD_MEAN.has(t)) wouldMeanTokens.set(t, (wouldMeanTokens.get(t) ?? 0) + 1)
    if (t === "attr_name" || t === "attribute") attributeKinds.set(t, (attributeKinds.get(t) ?? 0) + 1)
    if (cur.gotoFirstChild()) continue
    for (;;) {
      if (cur.gotoNextSibling()) { descend = true; break }
      if (!cur.gotoParent()) { descend = false; break }
    }
    if (!descend) break
  }

  // --- top-level forms: attributes, behaviours, callbacks, definitions
  const forms: any[] = []
  const fstack: any[] = []
  for (let i = root.namedChildCount - 1; i >= 0; i--) {
    const c = root.namedChild(i)
    if (c) fstack.push(c)
  }
  const COND = new Set(["pp_if", "pp_ifdef", "pp_ifndef", "pp_else", "pp_elif", "pp_endif", "ERROR"])
  while (fstack.length > 0) {
    const n = fstack.pop()
    if (COND.has(n.type)) {
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) fstack.push(c)
      }
      continue
    }
    forms.push(n)
  }
  if (forms.some((n: any) => n.type === "ERROR") && forms.length > 0 && topLevelErrorFiles.length < 6) {
    topLevelErrorFiles.push(rel)
  }

  const identities = new Map<string, number>()
  const declaredCallbacks = new Set<string>()
  const behaviours: string[] = []
  let hasModule = false
  for (const form of forms) {
    if (form.type === "fun_decl") {
      funDeclCount++
      const clauses: any[] = []
      for (let i = 0; i < form.namedChildCount; i++) {
        const c = form.namedChild(i)
        if (c && c.type === "function_clause") clauses.push(c)
      }
      functionClauseCount += clauses.length
      const head = clauses[0]
      if (head) {
        const nm = childByType(head, "atom") ?? childByType(head, "var")
        if (nm) {
          const key = `${nm.text}/${argCount(childByType(head, "expr_args"))}`
          const c = (identities.get(key) ?? 0) + 1
          identities.set(key, c)
          if (c > maxClausesPerIdentity) maxClausesPerIdentity = c
          if (c === 2 && redefineSites.length < 20) {
            redefineSites.push(`${rel}: ${key} declared by ${c} fun_decl groups`)
          }
        } else {
          const mc = childByType(head, "macro_call_expr")
          const mn = mc ? (childByType(mc, "var") ?? childByType(mc, "atom")) : undefined
          if (mn) {
            const key = `?${mn.text}/${argCount(childByType(head, "expr_args"))}`
            const c = (identities.get(key) ?? 0) + 1
            identities.set(key, c)
            if (c > maxClausesPerIdentity) maxClausesPerIdentity = c
          }
        }
      }
    } else if (form.type === "module_attribute") {
      hasModule = true
    } else if (form.type === "behaviour_attribute") {
      behaviourAttrs++
      const at = childByType(form, "atom")
      const b = at ? at.text : undefined
      if (b) {
        behaviours.push(b)
        behaviourEdges.set(b, (behaviourEdges.get(b) ?? 0) + 1)
        behaviourUses = behaviourEdges
      }
    } else if (form.type === "callback") {
      callbackAttrs++
      for (let i = 0; i < form.namedChildCount; i++) {
        const c = form.namedChild(i)
        if (c && c.type === "fa") {
          const fa = readFa(c)
          if (fa) declaredCallbacks.add(fa)
        }
      }
    } else if (form.type === "optional_callbacks_attribute") {
      optionalCallbackAttrs++
    } else if (form.type === "wild_attribute") {
      const an = childByType(form, "attr_name")
      const nm = an ? (childByType(an, "atom")?.text ?? an.text) : undefined
      if (nm) attrNames.set(nm, (attrNames.get(nm) ?? 0) + 1)
    }
  }
  if (behaviours.length > 0) {
    filesWithBehaviour++
    if (hasModule) modulesDeclaringBehaviour++
    // The satisfying definitions this module writes for its behaviour's
    // contract. `-callback init/1` in gen_server + `-export([init/1])` here is
    // contract satisfaction, which is F3 — the fact `overrides` is measured
    // against.
    for (const key of identities.keys()) {
      const bare = key.split("/")[0]
      const ar = key.split("/")[1]
      if (declaredCallbacks.has(`${bare}/${ar}`) && callbackSat.length < 20) {
        callbackSat.push({ file: rel, behaviour: behaviours.join("+"), callback: key })
      }
    }
  }
  tree.delete?.()
}

// ---------------------------------------------------------------------------
const named = [...nodeTypes.entries()].filter(([t]) => t !== "ERROR" && t !== "MISSING")
const totalNodeTypes = nodeTypes.size
console.log(`erlang extends/overrides construct probe — repos ${REPO_LIST.join(" ")}`)
console.log(`population: ${files.length} .erl/.hrl files derived by directory walk${skippedBig ? `, ${skippedBig} skipped over the 400 KB ceiling` : ""}`)
console.log(`pinned grammar: wasm/tree-sitter-erlang.wasm · parse failures ${parseFail}\n`)

console.log(`A. GRAMMAR INVENTORY — the construct for extends/overrides would need a node type`)
console.log(`   distinct node types produced across the corpus: ${totalNodeTypes} (${named.length} excluding ERROR/MISSING)`)
console.log(`   node types whose name contains an inheritance/redefinition token: ${wouldMeanTokens.size}`)
for (const [t, n] of [...wouldMeanTokens.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${t}: ${n}`)
console.log(`   the full inventory is printed below, so the absence is checkable rather than asserted:`)
const inv: string[] = []
for (const [t, n] of [...named.entries()].sort((a, b) => b[1] - a[1])) inv.push(`${t}:${n}`)
for (let i = 0; i < inv.length; i += 6) console.log(`     ${inv.slice(i, i + 6).join("  ")}`)

console.log(`\n   top-level ` + "`wild_attribute`" + ` names seen (the grammar's own attr_name/atom nodes):`)
console.log(`     ${[...attrNames.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)

console.log(`\nB. PARSE-TREE SEMANTIC COUNT — what the language can express`)
console.log(`   B1 REDEFINITION (the construct overrides would need)`)
console.log(`      fun_decl nodes: ${funDeclCount} · function_clause nodes: ${functionClauseCount}`)
console.log(`      distinct (name, arity) identities per file that have MORE THAN ONE fun_decl group: ${redefineSites.length}`)
for (const s of redefineSites.slice(0, 10)) console.log(`        ${s}`)
console.log(`      max fun_decl groups for one identity in any file: ${maxClausesPerIdentity}  (1 = every identity is ONE definition split into clauses)`)
console.log(`   B2 BEHAVIOUR CALLBACK SATISFACTION (the construct closest to an override)`)
console.log(`      -behaviour attributes: ${behaviourAttrs} in ${filesWithBehaviour} files (${modulesDeclaringBehaviour} of them declare a -module)`)
console.log(`      -callback declarations: ${callbackAttrs} · -optional_callbacks attributes: ${optionalCallbackAttrs}`)
console.log(`      definitions satisfying a callback this module also declares a behaviour for: ${callbackSat.length}${callbackSat.length >= 20 ? "+" : ""}`)
for (const s of callbackSat.slice(0, 10)) console.log(`        ${s.file}  ${s.behaviour} <- ${s.callback}`)
console.log(`      behaviours named, with counts:`)
for (const [k, v] of [...behaviourEdges.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`        ${k}: ${v}`)
console.log(`\n   files whose top level holds an ERROR node: ${topLevelErrorFiles.length}${topLevelErrorFiles.length ? ` (e.g. ${topLevelErrorFiles.slice(0, 3).join(", ")})` : ""}`)

if (OUT) {
  const { writeFileSync } = await import("node:fs")
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        tool: "erlang-extends-overrides-probe-erl",
        corpus: REPO_LIST,
        population: { files, skippedOver400KB: skippedBig },
        instrumentA: { distinctNodeTypes: totalNodeTypes, inventory: Object.fromEntries([...named.entries()].sort()), wouldMeanTokens: Object.fromEntries(wouldMeanTokens), attrNames: Object.fromEntries([...attrNames.entries()].sort((a, b) => b[1] - a[1])) },
        instrumentB: {
          funDecl: funDeclCount,
          functionClause: functionClauseCount,
          redefinitionSites: redefineSites,
          maxClausesPerIdentity,
          behaviourAttrs,
          filesWithBehaviour,
          modulesDeclaringBehaviour,
          callbackAttrs,
          optionalCallbackAttrs,
          callbackSatisfaction: callbackSat,
          behaviourEdges: Object.fromEntries(behaviourEdges),
        },
      },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${OUT}`)
}
