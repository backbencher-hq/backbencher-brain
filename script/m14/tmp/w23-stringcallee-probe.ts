// W23: isolate `'404'(view: '/notFound')` — the minimal repro reduced out of
// UrlMappings.groovy. Each case is a complete balanced source.
// Usage: bun script/m14/tmp/w23-stringcallee-probe.ts
import * as fs from "fs"

const CASES: Array<[string, string]> = [
  ["in class+closure (corpus shape)", `class C {\n    static m = {\n        '404'(view: '/x')\n    }\n}\n`],
  ["top level, single quotes", `'404'(view: '/x')\n`],
  ["top level, double quotes", `"404"(view: '/x')\n`],
  ["top level, string callee positional arg", `'404'('/x')\n`],
  ["top level, string callee no args", `'404'()\n`],
  ["top level, string callee 2 named args", `'404'(a: 1, b: 2)\n`],
  ["top level, string callee named arg, no space", `'404'(view:'/x')\n`],
  ["identifier callee named arg (control)", `foo(view: '/x')\n`],
  ["string callee named arg, after dot", `this.'404'(view: '/x')\n`],
  ["string callee named arg with trailing stmt", `'404'(view: '/x')\nprintln 1\n`],
  ["string callee named arg inside method", `class C {\n    def m() {\n        '404'(view: '/x')\n    }\n}\n`],
  ["gstring callee named arg", `"/x"(view: '/x')\n`],
  ["string callee named arg, outer parens", `('404'(view: '/x'))\n`],
  ["string callee, map literal arg", `'404'([view: '/x'])\n`],
  ["numeric callee named arg", `404(view: '/x')\n`],
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
        if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) {
          first = n
          return
        }
        for (let i = 0; i < n.childCount && !first; i++) walk(n.child(i))
      }
      walk(root)
      if (first) out += `\n        row ${first.startPosition.row + 1} col ${first.startPosition.column + 1} :: ${JSON.stringify((first.text || "").slice(0, 90))}`
      const top = Array.from({ length: root.namedChildCount }, (_, i) => root.namedChild(i).type).join(" ")
      out += `\n        root children: ${top}`
    }
    console.log(out)
  }
}
main()
