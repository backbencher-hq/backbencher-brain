// Census the three shapes LUA-09 deliberately left silent, counted off the WIRED
// GRAMPHM at a file's ACTUAL module return — the same discipline as LUA-09's own
// census, for the same reason.
//
// The closure record carried "17 kong files" and "5 kong files" for these shapes.
// Those counted files where the shape IS the module's primary return. A plain grep
// for the shape ANYWHERE at module level gives 87 and 76. Both numbers are
// correct for different questions, and quoting the smaller one without saying so
// is how a gap gets understated. This measures the question that matters — what
// does a consumer of this MODULE see — and reports both.
//
// It also answers the only question that decides whether a shape is fixable: does
// the shape carry a NAME? `return setmetatable(M, mt)` names M. `return
// require("x")` names nothing — x is a module path, not a name this module
// defines. Publishing an export called "x" would be inventing a name, which is the
// fabrication this lane has refused in every other case.
import { join } from "node:path"
import { readFileSync, readdirSync } from "node:fs"

const REPO = "$HOME/backbencher-brain"
const REPOS = "$HOME/fixtures/repositories"
const argOf = (k: string, d?: string): string | undefined => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const ONLY = argOf("--only")
const LIMIT = Number(argOf("--limit", "0")) || 0

const { loadWebTreeSitter } = await import(REPO + "/src/util/wasm")
const mod: any = await loadWebTreeSitter()
const { parseFile } = await import(REPO + "/src/ast/pool-worker")
await parseFile(join(REPOS, "luvit", "init.lua"), REPOS)
const lang = await mod.Language.load(REPO + "/wasm/tree-sitter-lua.wasm")
const parser = new mod.Parser()
parser.setLanguage(lang)

// Identical to lua-export-census.ts on purpose: a return reachable WITHOUT
// ENTERING A FUNCTION is a possible module surface, and the module publishes the
// union of what every such return can name.
const NOT_A_SCOPE = new Set(["function_definition", "function_declaration"])
const fileScopeReturns = (node: any, out: any[] = []): any[] => {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (!c) continue
    if (NOT_A_SCOPE.has(c.type)) continue
    if (c.type === "return_statement") { out.push(c); continue }
    fileScopeReturns(c, out)
  }
  return out
}
const firstExpr = (ret: any): any => {
  for (let i = 0; i < ret.namedChildCount; i++) {
    const c = ret.namedChild(i)
    if (c && c.type === "expression_list") return c.namedChild(0)
  }
  return null
}
const callName = (fc: any): string | null => {
  for (let i = 0; i < fc.childCount; i++) {
    const fn = typeof fc.fieldNameForChild === "function" ? fc.fieldNameForChild(i) : null
    if (fn === "name") return fc.child(i).text
  }
  return null
}
const argAt = (fc: any, i: number): any => {
  let k = 0
  for (let j = 0; j < fc.childCount; j++) {
    const fn = typeof fc.fieldNameForChild === "function" ? fc.fieldNameForChild(j) : null
    if (fn === "arguments") {
      const args = fc.child(j)
      for (let a = 0; a < args.namedChildCount; a++) { const c = args.namedChild(a); if (c) { if (k === i) return c; k++ } }
      return null
    }
  }
  return null
}
const nameBearing = (n: any): string | undefined => {
  if (!n) return undefined
  if (n.type === "identifier") return n.text
  if (n.type === "dot_index_expression" || n.type === "method_index_expression") return n.text
  return undefined
}

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== ".git") walk(p, out) }
    else if (e.name.endsWith(".lua")) out.push(p)
  }
  return out
}

for (const corpus of ["luvit", "kong"]) {
  if (ONLY && corpus !== ONLY) continue
  let files = walk(join(REPOS, corpus))
  if (LIMIT) files = files.slice(0, LIMIT)

  let setmetatableNamed = 0, setmetatableAnon = 0
  let requireReexport = 0
  let stringLiteral = 0
  let otherCall = 0
  const smNames: string[] = []
  const otherCallNames: string[] = []
  const examples: Record<string, string> = {}

  for (const f of files) {
    let tree: any
    try { tree = parser.parse(readFileSync(f, "utf8")) } catch { continue }
    if (tree.rootNode.hasError) continue
    for (const ret of fileScopeReturns(tree.rootNode)) {
      const e = firstExpr(ret)
      if (!e) continue
      if (e.type === "function_call") {
        const cn = callName(e)
        if (cn === "setmetatable") {
          // THE FIXABLE ONE. `return setmetatable(M, mt)` — the module's surface
          // is M, a real name, exactly as in `return M` which already works. The
          // metatable is an attribute OF M, not a separate export.
          const first = argAt(e, 0)
          const nm = nameBearing(first)
          if (nm) { setmetatableNamed++; if (smNames.length < 8) smNames.push(nm) }
          else { setmetatableAnon++; examples.setmetatableAnon ??= f }
        } else if (cn === "require") {
          // NOT a name. The module's surface is whatever the required module
          // exports; this module defines nothing to name.
          requireReexport++
          examples.require ??= f
        } else {
          otherCall++
          if (cn && otherCallNames.length < 10) otherCallNames.push(cn)
          examples.otherCall ??= f
        }
      } else if (e.type === "string") {
        stringLiteral++
        examples.string ??= f
      }
    }
  }

  console.log(`\n===== ${corpus}: ${files.length} files =====`)
  console.log(`  FIXABLE — the shape carries a NAME:`)
  console.log(`    return setmetatable(<name>, mt)   ${String(setmetatableNamed).padStart(5)} files   e.g. ${smNames.slice(0, 5).join(", ")}`)
  console.log(`    return setmetatable(<expr>, mt)   ${String(setmetatableAnon).padStart(5)} files   (no name to publish)`)
  console.log(`  NOT a name — record as a DISCLOSURE, never as a named export:`)
  console.log(`    return require("x")               ${String(requireReexport).padStart(5)} files   (the surface is x's, not this module's)`)
  console.log(`    return "literal"                  ${String(stringLiteral).padStart(5)} files   (a value, not a name)`)
  console.log(`  other calls                       ${String(otherCall).padStart(5)} files   e.g. ${[...new Set(otherCallNames)].slice(0, 6).join(", ")}`)
  const fixable = setmetatableNamed
  const silent = setmetatableAnon + requireReexport + stringLiteral + otherCall
  console.log(`  ---`)
  console.log(`  publishable with a real name: ${fixable} files | silent by design: ${silent} files`)
}
