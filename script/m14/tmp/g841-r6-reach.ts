// Is the typed-parameter reading REACHABLE, or only losing? §7f showed a
// precedence tie-break changes nothing, which suggests unreachable. Vary ONLY
// the body and report which reading the parser actually took:
//   WRONG  = zero-param closure whose body starts with a command call
//            (`juxt_function_call`) — the `File f` misreading
//   RIGHT  = the closure carries a typed parameter
import { readFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

const BODIES: Array<[string, string]> = [
  ["literal", "1"],
  ["param alone", "f"],
  ["field access", "f.x"],
  ["field + empty call", "f.x()"],
  ["field + call + arg", "f.x(y)"],
  ["two fields", "f.x.y"],
  ["three segments + call", "f.x.y(z)"],
  ["method call on param", "f.m(y)"],
  ["plain local chain", "x.y.z"],
  ["local chain + call", "x.y.z(w)"],
  ["arithmetic on field", "f.x + 1"],
  ["call on local", "g(f)"],
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
  const parser = new P()
  parser.setLanguage(lang)

  const closureOf = (root: any): any => {
    let found: any = null
    const walk = (n: any): void => {
      if (found) return
      if (n.type === "closure") { found = n; return }
      for (let i = 0; i < n.childCount && !found; i++) walk(n.child(i))
    }
    walk(root)
    return found
  }

  console.log("body                          typed-param?  verdict")
  for (const [label, body] of BODIES) {
    const src = `def m(d) { d.each { File f -> ${body} } }\n`
    const root = parser.parse(src)!.rootNode
    const c = closureOf(root)
    // The typed reading shows a type_identifier (or generic/array type) that is
    // a sibling BEFORE the parameter identifier, inside the closure.
    let typed = false
    let wrong = false
    const walk = (n: any): void => {
      if (n.type === "juxt_function_call") wrong = true
      if (["type_identifier", "generic_type", "array_type", "scoped_type_identifier"].includes(n.type)) typed = true
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    if (c) walk(c)
    console.log(`${label.padEnd(28)}  typed=${String(typed).padEnd(5)} error=${String(root.hasError).padEnd(5)} wrongReading=${wrong}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
