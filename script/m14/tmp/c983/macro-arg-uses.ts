// The macro-argument `uses` claim (e306ab09), measured. The claim is that a
// macro ARGUMENT is a provable `uses` even where `contains` is not, because a
// use is weaker than ownership. #981's ruling says the argument survives; what
// has never been done is measure it over the corpus, because a general rule
// touches every macro invocation in every file.
//
// This counts, per corpus file:
//   - macro INVOCATIONS, split by whether the argument is a bare identifier
//   - how many arguments NAME something the file actually declares
//   - how many would be a `uses` a consumer can resolve
//   - the existing edge count, so the ratio is against something
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..", "..", "..")
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))
const analyzer = new RealCAnalyzer()
const CORPUS = "/home/sano/ishaq/bb_tests/repositories"

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const LIMIT = Number(arg("max-files", "600"))

function collectC(dir: string, out: string[], cap: number): string[] {
  if (out.length >= cap) return out
  let es: fs.Dirent[] = []
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    if (out.length >= cap) return out
    if (e.name === ".git" || e.name === "node_modules") continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collectC(full, out, cap)
    else if (e.name.endsWith(".c") || e.name.endsWith(".h")) out.push(full)
  }
  return out
}
const files: string[] = []
for (const repo of ["curl", "libgit2", "redis", "zig"]) collectC(path.join(CORPUS, repo), files, LIMIT)
files.sort()

let filesParsed = 0
let invocations = 0
let bareIdentifierArgs = 0
let resolvableArgs = 0
let localArgs = 0
let existingUses = 0
let alreadyEmittedAsUses = 0
const byMacro = new Map<string, number>()
const examples: string[] = []

for (const file of files) {
  let src: string
  try { src = fs.readFileSync(file, "utf8") } catch { continue }
  if (src.length > 400_000) continue
  let root: any
  try { root = parser.parse(src).rootNode } catch { continue }
  filesParsed++
  let result: any
  try { result = analyzer.analyze(root, src, file) } catch { continue }

  const declared = new Set<string>()
  for (const s of result.symbols ?? []) if (["variable", "constant", "macro", "function", "struct", "enum", "type", "property"].includes(String(s.kind))) declared.add(String(s.name))
  const emittedUses = new Set<string>()
  for (const r of result.relationships ?? []) if (String(r.type) === "uses") emittedUses.add(`${r.source}|${r.target}`)
  existingUses += emittedUses.size

  // names bound inside any function body -- a macro argument is overwhelmingly one of
  // these, which is the whole answer
  const bodyBound = new Set<string>()
  {
    const leftmostId = (node: any): string | null => {
      if (!node) return null
      if (node.type === "identifier" || node.type === "field_identifier") return node.text
      for (let i = 0; i < node.namedChildCount; i++) { const r = leftmostId(node.namedChild(i)); if (r) return r }
      return null
    }
    const stb: any[] = [root]
    while (stb.length) {
      const n = stb.pop()
      if (!n) continue
      if (n.type === "function_definition") {
        const d = n.childForFieldName("declarator")
        const body = n.childForFieldName("body")
        const find = (node: any, t: string): any => {
          if (!node) return null
          if (node.type === t) return node
          for (let i = 0; i < node.namedChildCount; i++) { const r = find(node.namedChild(i), t); if (r) return r }
          return null
        }
        const pl = find(d, "parameter_list")
        if (pl) { const s2: any[] = [pl]; while (s2.length) { const m = s2.pop(); if (!m) continue; if (m.type === "identifier") bodyBound.add(m.text); if (m.type === "parameter_declaration") { const id = leftmostId(m.childForFieldName("declarator")); if (id) bodyBound.add(id) } if (m.type === "parameter_list" || m.type === "function_declarator" || m.type === "parenthesized_declarator") for (let i = 0; i < m.namedChildCount; i++) s2.push(m.namedChild(i)) } }
        const sc = (x: any): void => { if (!x) return; if (x.type === "declaration") for (let i = 0; i < x.namedChildCount; i++) { const c = x.namedChild(i); if (c && (c.type.endsWith("declarator") || c.type === "identifier")) { const id = leftmostId(c); if (id) bodyBound.add(id) } } for (let i = 0; i < x.namedChildCount; i++) sc(x.namedChild(i)) }
        sc(body)
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stb.push(c) }
    }
  }

  const macros = new Set<string>()
  const st0: any[] = [root]
  while (st0.length) {
    const n = st0.pop()
    if (!n) continue
    if (n.type === "preproc_function_def") {
      const nm = n.namedChild(0)
      if (nm?.type === "identifier") macros.add(nm.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st0.push(c) }
  }
  if (macros.size === 0) continue

  // A macro INVOCATION is a call_expression / macro_type_specifier whose callee is a
  // function-like macro the file defines. Object-like macros have no argument_list.
  const st: any[] = [root]
  while (st.length) {
    const n = st.pop()
    if (!n) continue
    let macroName = ""
    let args: any = null
    if (n.type === "call_expression") {
      const fn = n.childForFieldName("function")
      if (fn?.type === "identifier" && macros.has(fn.text)) {
        macroName = fn.text
        args = n.childForFieldName("arguments")
      }
    } else if (n.type === "macro_type_specifier" || n.type === "macro_prefixed_type_specifier") {
      const inner = n.namedChild(0)
      if (inner?.type === "identifier" && macros.has(inner.text)) {
        macroName = inner.text
        args = n.namedChild(1)
      }
    }
    if (macroName && args) {
      invocations++
      byMacro.set(macroName, (byMacro.get(macroName) ?? 0) + 1)
      for (let i = 0; i < args.namedChildCount; i++) {
        const a = args.namedChild(i)
        if (!a) continue
        if (a.type === "identifier") {
          bareIdentifierArgs++
          if (declared.has(a.text)) resolvableArgs++
          if (bodyBound.has(a.text)) localArgs++
          if (emittedUses.has(`|${a.text}`)) alreadyEmittedAsUses++
          if (examples.length < 24) examples.push(`${path.relative(CORPUS, file)}  ${macroName}(${a.text})  file-scope-declared=${declared.has(a.text)}  bound-in-a-body=${bodyBound.has(a.text)}`)
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
  }
}
console.log(`files parsed ${filesParsed} of ${files.length}`)
console.log(`macro INVOCATIONS with an argument list:        ${invocations}`)
console.log(`  bare-identifier arguments:                    ${bareIdentifierArgs}`)
console.log(`  ...of which the name IS a declared symbol:    ${resolvableArgs}  (${(100 * resolvableArgs / Math.max(1, bareIdentifierArgs)).toFixed(2)}%)`)
console.log(`  ...BOUND IN A FUNCTION BODY (a local):       ${localArgs}  (${(100 * localArgs / Math.max(1, bareIdentifierArgs)).toFixed(2)}%)`)
const neither = bareIdentifierArgs - resolvableArgs - localArgs
console.log(`  ...neither (no declaration anywhere):        ${neither}  (${(100 * neither / Math.max(1, bareIdentifierArgs)).toFixed(2)}%)`)
console.log(`  ...already emitted as a \`uses\` today:        ${alreadyEmittedAsUses}`)
console.log(`distinct \`uses\` edges in the same files:      ${existingUses}`)
console.log(`\ntop macros by invocation count:`)
for (const [k, v] of [...byMacro.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(v).padStart(6)}  ${k}`)
console.log("\nsample arguments that resolve:")
for (const e of examples) console.log("  " + e)
