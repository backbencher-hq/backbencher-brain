import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const S: [string, string][] = [
  ["A assign + nested-call interp", `class C { void m(def p) {\n  String skip = " SKIP \${Integer.valueOf(p.offset.toString())}"\n} }\n`],
  ["B ternary + simple-call interp", `class C { void m(def p) {\n  String skip = p.offset ? " SKIP \${Integer.valueOf(p.offset)}" : ''\n} }\n`],
  ["C ternary + nested-call interp", `class C { void m(def p) {\n  String skip = p.offset ? " SKIP \${Integer.valueOf(p.offset.toString())}" : ''\n} }\n`],
  ["D ternary + plain interp", `class C { void m(def p) {\n  String skip = p.offset ? " SKIP \${p.offset}" : ''\n} }\n`],
  ["E assign + simple-call interp", `class C { void m(def p) {\n  String skip = " SKIP \${Integer.valueOf(p.offset)}"\n} }\n`],
]
for (const wasm of process.argv.slice(2)) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P(); parser.setLanguage(lang)
  console.log(`=== ${wasm.replace(/^.*\//, '')}`)
  for (const [name, src] of S) {
    const t = parser.parse(src)
    const errs: string[] = []
    const walk = (x: any) => { if (x.type === "ERROR" || x.isMissing) errs.push(`${x.type}[${x.startPosition.row+1}:${x.startPosition.column+1}]`); for (let i = 0; i < x.childCount; i++) walk(x.child(i)) }
    walk(t.rootNode)
    console.log(`  ${errs.length ? "BROKEN " + JSON.stringify(errs.slice(0,3)) : "clean  "} | ${name}`)
  }
}
