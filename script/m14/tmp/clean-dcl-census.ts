// script/m14/tmp/clean-dcl-census.ts
//
// The `.dcl` question: a Clean definition module's ENTIRE content is declarations
// (`f :: Int -> Bool`), and the analyzer publishes a symbol only for a
// `function_declaration` — so a `.dcl` yields module/type/class symbols and no
// function symbols at all, i.e. the module's declared interface is invisible.
//
// Before ruling on it, measure it, per corpus: how many `.dcl` files there are,
// how many module-level `type_signature` names they declare, how many of those
// are published today, and how many ALSO have a definition in the same file (the
// HC2 prototype+definition merge case). Reads the PINNED wasm and the production
// analyzer only.
//
// Run: bun script/m14/tmp/clean-dcl-census.ts [--samples N]
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealCleanAnalyzer } from "../../../src/ast/real-clean-analyzer"

const ROOT = process.cwd()
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const REPOS = ["Clyde", "clean-stdlib", "Prelude", "cloogle.org", "eastwood"]
const SAMPLES = (() => {
  const i = process.argv.indexOf("--samples")
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : 8
})()

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(lang)

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

/** Module-level `type_signature` names: a signature whose ancestor chain never
 *  passes through a class/instance/function/where body. Mirrors the analyzer's
 *  scope stack (`scopeStack.length === 0` at visit time). */
function moduleLevelSignatures(root: any): string[] {
  const out: string[] = []
  const stack: { n: any; scoped: boolean }[] = [{ n: root, scoped: false }]
  const SCOPING = new Set(["class_declaration", "class_member", "instance_declaration", "instance_member",
    "function_declaration", "where_block", "local_binding", "type_definition"])
  while (stack.length) {
    const { n, scoped } = stack.pop()
    const nowScoped = scoped || SCOPING.has(n.type)
    if (n.type === "type_signature" && !scoped) {
      const sig = (() => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "signature_name") return c } return undefined })()
      const id = sig ? (() => { for (let i = 0; i < sig.namedChildCount; i++) { const c = sig.namedChild(i); if (c?.type === "identifier") return c } return undefined })() : undefined
      if (id?.text) out.push(id.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push({ n: c, scoped: nowScoped }) }
  }
  return out
}

/** In-file function definitions (the analyzer's declared functions). */
function definedNames(root: any): Set<string> {
  const out = new Set<string>()
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "function_declaration") {
      const byField = n.childForFieldName?.("name")
      const nm = byField?.text ?? (() => { for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c?.type === "identifier") return c } return undefined })()?.text
      if (nm) out.add(nm)
      continue
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  return out
}

let totalFiles = 0, dclFiles = 0, declNames = 0, invisible = 0, mergedPairs = 0, bothNames = 0
const dclSamples: string[] = []
const perRepo: Record<string, { dcl: number; names: number; invisible: number; merged: number }> = {}
for (const r of REPOS) perRepo[r] = { dcl: 0, names: 0, invisible: 0, merged: 0 }

for (const f of files.sort()) {
  const src = readFileSync(f, "utf8")
  const tree = parser.parse(src)
  const root = tree.rootNode
  const res = new RealCleanAnalyzer().analyze(root as any, src, f)
  const published = new Set(res.symbols.map((s) => s.name))
  const rel = path.relative(CORPUS, f)
  const repo = REPOS.find((r) => rel.startsWith(r + "/")) ?? "?"
  const isDcl = f.endsWith(".dcl")
  totalFiles++
  if (isDcl) { dclFiles++; perRepo[repo].dcl++ }
  const sigs = moduleLevelSignatures(root)
  const defs = definedNames(root)
  const uniq = [...new Set(sigs)]
  let invHere = 0
  for (const nm of uniq) {
    declNames++
    perRepo[repo].names++
    if (defs.has(nm)) { bothNames++; perRepo[repo].merged++ }
    if (!published.has(nm)) { invisible++; invHere++; perRepo[repo].invisible++ }
  }
  if (isDcl) {
    if (uniq.length > 0 && dclSamples.length < SAMPLES * 4) {
      dclSamples.push(`  ${rel}: ${uniq.length} module-level signature name(s), ${invHere} invisible today (${uniq.slice(0, 4).join(", ")}${uniq.length > 4 ? ", …" : ""})`)
    }
  }
}

console.log(`files=${totalFiles} (.dcl ${dclFiles})`)
console.log(`module-level signature names: ${declNames} (distinct-within-file)\n  invisible today (no symbol published): ${invisible}\n  also defined in the same file (HC2 merge case): ${bothNames}`)
console.log(`\nper repo:`)
for (const r of REPOS) {
  const p = perRepo[r]
  console.log(`  ${r.padEnd(14)} dcl=${String(p.dcl).padStart(3)}  signature-names=${String(p.names).padStart(4)}  invisible=${String(p.invisible).padStart(4)}  also-defined=${p.merged}`)
}
console.log(`\nsample .dcl files:`)
for (const s of dclSamples.slice(0, SAMPLES)) console.log(s)
