// W23: hand-reduction of end-to-end/spring-dependency-management/.../UrlMappings.groovy,
// whose reduced form fails somewhere in the class body. Each case below is a
// COMPLETE, balanced source (no manufactured failure: nothing truncated, every
// construct closed), so `hasError` is meaningful for them on its own.
// Usage: bun script/m14/tmp/w23-urlmappings-probe.ts
import * as fs from "fs"

const CASES: Array<[string, string]> = [
  ["whole reduced class", `class C {\n    static mappings = {\n        "/$a/$b?" {\n            constraints {\n            }\n        }\n        '404'(view: '/notFound')\n    }\n}\n`],
  ["only string-callee closure", `class C {\n    static m = {\n        "/$a/$b?" {\n            constraints {\n            }\n        }\n    }\n}\n`],
  ["only string-callee closure, plain string", `class C {\n    static m = {\n        "/x/y" {\n            constraints {\n            }\n        }\n    }\n}\n`],
  ["only named-arg call on string callee", `class C {\n    static m = {\n        '404'(view: '/notFound')\n    }\n}\n`],
  ["named-arg call, identifier callee", `class C {\n    static m = {\n        foo(view: '/notFound')\n    }\n}\n`],
  ["string-callee closure alone at script level", `"/$a/$b?" {\n    constraints {\n    }\n}\n`],
  ["gstring callee closure alone", `"/$a" { }\n`],
  ["gstring with ? and () inside", `def x = "/$a/$b?/$c?(.$d)?"\n`],
  ["gstring interp with parens", `def x = "/$a?/$c?(.$d)?"\n`],
  ["plain string with parens", `def x = "/a?/c?(.d)?"\n`],
  ["interp then literal ( .d )?", `def x = "/$a?(.$d)?"\n`],
  ["interp then literal paren group", `def x = "/$a(hi)there"\n`],
  ["interp then literal paren then interp", `def x = "/$a($b)?"\n`],
  ["two interps with slash", `def x = "/$a/$b"\n`],
  ["interp with trailing ?", `def x = "/$a?"\n`],
]

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  for (const [label, src] of CASES) {
    const root = parser.parse(src).rootNode
    let out = `${root.hasError ? "FAIL" : "ok  "}  ${label}`
    if (root.hasError) {
      let first: any = null
      const walk = (n: any): void => {
        if (first) return
        if (n.type === "ERROR" || n.isMissing) {
          if (n.endIndex > n.startIndex) {
            first = n
            return
          }
        }
        for (let i = 0; i < n.childCount && !first; i++) walk(n.child(i))
      }
      walk(root)
      if (first) {
        out += `\n        row ${first.startPosition.row + 1} :: ${JSON.stringify((first.text || "").slice(0, 90))}`
      }
    }
    console.log(out)
  }
}
main()
