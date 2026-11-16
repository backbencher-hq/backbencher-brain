// script/m14/tmp/clean-dcl-shapes.ts
//
// Before ruling on the `.dcl` declaration contract, the shapes have to be READ,
// not assumed: is a module-level `f :: Int -> Bool` a `type_signature` with a
// `signature_name → identifier`, and is a module-level OPERATOR declaration
// (`(==) :: a a -> Bool`) the same node with a `parenthesized_operator`, or a
// different node type entirely? The instance member probe showed
// `operator_definition` for a member operator, so the answer decides whether the
// ruling needs a second branch.
//
// Part 2 counts the corpus: module-level signatures by name-child type, and
// module-level `operator_definition` nodes with their published status.
//
// Run: bun script/m14/tmp/clean-dcl-shapes.ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealCleanAnalyzer } from "../../../src/ast/real-clean-analyzer"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories"
const REPOS = ["Clyde", "clean-stdlib", "Prelude", "cloogle.org", "eastwood"]

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(lang)

const CASES: [string, string][] = [
  ["module-level signature", `module m\nf :: !Int -> Bool\n`],
  ["module-level operator signature", `module m\n(==) infix 4 :: a a -> Bool\n`],
  ["signature + definition", `module m\nf :: !Int -> Bool\nf x = x == 0\n`],
  ["module-level operator definition", `module m\n(++) infixr 5 :: a b -> c\n(++) x y = x\n`],
  ["strict signature + record arg", `module m\n:: P = { px :: Int }\nf :: !P -> P\n`],
]

const dump = (n: any, depth = 0): string => {
  const fields: string[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    const f = n.fieldNameForChild?.(i)
    if (f) fields.push(`${f}:${c.type}`)
  }
  const leaves = n.namedChildCount === 0 && n.childCount === 0 ? ` = ${JSON.stringify(n.text.slice(0, 24))}` : ""
  const out = [`${"  ".repeat(depth)}${n.type}${fields.length ? ` [${fields.join(", ")}]` : ""}${leaves}`]
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(dump(c, depth + 1)) }
  return out.join("\n")
}

for (const [name, src] of CASES) {
  const tree = parser.parse(src)
  console.log(`### ${name}   errors=${tree.rootNode.hasError}`)
  console.log(dump(tree.rootNode))
  const res = new RealCleanAnalyzer().analyze(tree.rootNode as any, src, "probe.icl")
  console.log(`  analyzer symbols: ${res.symbols.map((s) => `${s.kind}:${s.name}`).join(", ") || "(none)"}`)
  console.log()
}

// ---- corpus census of the module-level declaration surface ------------------
const files: string[] = []
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    if (e === ".git" || e === "node_modules") continue
    const p = path.join(d, e)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p)
    else if (e.endsWith(".icl") || e.endsWith(".dcl")) files.push(p)
  }
}
for (const r of REPOS) { try { walk(path.join(CORPUS, r)) } catch { /* absent */ } }

const bySigChild = new Map<string, number>()
const bySigChildInvisible = new Map<string, number>()
const sigSamples = new Map<string, string[]>()
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
// A parenthesized_operator is a REAL operator only if the parenthesized text
// carries an operator character — `(%.)` and `(++)` are operators, while
// `(curposq,curlenq,charnrq)` is the grammar's mis-shape for the tuple-pattern
// let-before-expression (`# (a,b,c) = expr;`). Publishing a symbol for the latter
// would fabricate names no source declares.
// A parenthesized name is REAL — an operator (`%.`, `++`, `==`) or a
// parenthesized identifier (`bitxor`) — unless its top level contains a comma or
// a brace, which is the grammar's mis-shape for a PATTERN: `# (a,b,c) = expr;`
// and `# (r,{gst & ls=s}) = expr;`. Publishing those would fabricate names.
const isPatternShape = (text: string): boolean => {
  const inner = text.replace(/^\(|\)$/g, "")
  return /[,\{\}]/.test(inner)
}
const nameOfParenthesized = (text: string): string => text.replace(/^\(|\)$/g, "").trim()
const isOperatorShape = (text: string): boolean => !isPatternShape(text) && OPERATOR_CHAR.test(nameOfParenthesized(text))
const OPERATOR_CHAR = /[-+*/<>=!&|^~%#:.$@?\\]/
let moduleOperators = 0, moduleOperatorsInvisible = 0, operatorShaped = 0, operatorShapedInvisible = 0
let operatorBodyApplications = 0, operatorBodyAttributed = 0
// Everything here is measured against the analyzer as it IS, so the counters
// cannot quietly describe a previous revision: `invisible` compares the
// NORMALIZED name (the analyzer publishes `==` for `(==)`), and `attributed`
// asks whether the analyzer actually emitted a `calls` edge whose SOURCE is the
// operator — the difference between "this body holds applications" and "this
// body's applications have an attribution target".
const byEnclosure = new Map<string, { sites: number; real: number; apps: number; invisible: number; attributed: number }>()
const operatorSamples: string[] = []
const misParseSamples: string[] = []
const SCOPING = new Set(["class_declaration", "class_member", "instance_declaration", "instance_member",
  "function_declaration", "where_block", "local_binding", "type_definition"])

for (const f of files) {
  const src = readFileSync(f, "utf8")
  const root = parser.parse(src).rootNode
  const res = new RealCleanAnalyzer().analyze(root as any, src, f)
  const published = new Set((res.symbols as any[]).map((s) => s.name))
  const callSources = new Set(
    (res.relationships as any[]).filter((r) => String(r.type) === "calls").map((r) => String(r.source)),
  )
  const stack: { n: any; scoped: boolean }[] = [{ n: root, scoped: false }]
  while (stack.length) {
    const { n, scoped } = stack.pop()
    const nowScoped = scoped || SCOPING.has(n.type)
    if (n.type === "type_signature" && !scoped) {
      const sig = n.namedChildren.find((c: any) => c.type === "signature_name")
      const kid = sig?.namedChildren?.[0]
      const kind = kid?.type ?? "none"
      bump(bySigChild, kind)
      // Compare the NORMALIZED name: the analyzer publishes `==` for `(==)` and
      // `bitxor` for `(bitxor)`, so a raw-text check would report 54 false
      // invisibles (measured — this probe's own first draft did exactly that).
      const raw = kid?.text ?? ""
      const normalized = isPatternShape(raw) ? null : nameOfParenthesized(raw)
      if (!normalized || !published.has(normalized)) bump(bySigChildInvisible, kind)
      const list = sigSamples.get(kind) ?? []
      if (list.length < 5 && kid?.text) { list.push(`${path.relative(CORPUS, f)}: ${kid.text}`); sigSamples.set(kind, list) }
    }
    if (n.type === "operator_definition") {
      // Where does it sit? An INSTANCE operator is the Clean norm for Eq/Ord, a
      // module-level one is the file's own operator, and a where-local one is
      // scoped noise (M11.11).
      let enc = "module", cur = n.parent
      while (cur) {
        if (cur.type === "instance_member") { enc = "instance-method"; break }
        if (cur.type === "class_member") { enc = "class-member"; break }
        if (cur.type === "where_block" || cur.type === "local_binding") { enc = "where-local"; break }
        if (cur.type === "function_declaration" || cur.type === "operator_definition") { enc = "nested-in-body"; break }
        cur = cur.parent
      }
      const nm = n.childForFieldName?.("name")?.text ?? "?"
      const real = !isPatternShape(nm)
      // The analyzer's key for an operator is the unparenthesized name.
      const opKey = nameOfParenthesized(nm)
      const body = n.childForFieldName?.("body")
      let apps = 0
      if (body) {
        const st: any[] = [body]
        while (st.length) {
          const x = st.pop()
          if (x.type === "application") apps++
          for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c) st.push(c) }
        }
      }
      if (enc === "module") {
        moduleOperators++
        if (real) {
          operatorShaped++
          operatorBodyApplications += apps
          if (opKey && callSources.has(opKey)) operatorBodyAttributed += apps
          if (!opKey || !published.has(opKey)) operatorShapedInvisible++
          if (operatorSamples.length < 8) operatorSamples.push(`${path.relative(CORPUS, f)}: ${nm}`)
        } else {
          if (!opKey || !published.has(opKey)) moduleOperatorsInvisible++
          if (misParseSamples.length < 6) misParseSamples.push(`${path.relative(CORPUS, f)}: ${nm}`)
        }
      } else {
        const e = byEnclosure.get(enc) ?? { sites: 0, real: 0, apps: 0, invisible: 0, attributed: 0 }
        e.sites++
        if (real) {
          e.real++
          e.apps += apps
          if (opKey && callSources.has(opKey)) e.attributed += apps
          if (!opKey || !published.has(opKey)) e.invisible++
        }
        byEnclosure.set(enc, e)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push({ n: c, scoped: nowScoped }) }
  }
}

console.log(`### corpus: module-level signature_name child types`)
for (const [k, v] of bySigChild) {
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(4)} sites, ${String(bySigChildInvisible.get(k) ?? 0).padStart(4)} name(s) invisible today`)
  for (const s of sigSamples.get(k) ?? []) console.log(`      e.g. ${s}`)
}
console.log(`\n### corpus: operator_definition by ENCLOSURE`)
console.log(`  module-level: ${moduleOperators} site(s) — ${operatorShaped} real, ${operatorShapedInvisible} invisible today, ${operatorBodyApplications} body application(s) (${operatorBodyAttributed} attributed)`)
console.log(`                (${moduleOperators - operatorShaped} are pattern mis-parses the ruling leaves alone)`)
for (const [enc, e] of byEnclosure) {
  console.log(`  ${enc.padEnd(16)} ${String(e.sites).padStart(3)} site(s) — ${e.real} real, ${e.invisible} name(s) invisible, ${e.apps} body application(s) (${e.attributed} attributed)`)
}
for (const s of operatorSamples) console.log(`    module operator ${s}`)
for (const s of misParseSamples) console.log(`    NOT-an-operator ${s}`)
