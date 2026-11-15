import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const SRC = "class C {\n  void m() {\n    int sum = sumService.sum 1, 2\n  }\n}\n"
for (const wasm of process.argv.slice(2)) {
  const lang = await L.load(fs.readFileSync(wasm))
  const parser = new P(); parser.setLanguage(lang)
  const t = parser.parse(SRC)
  const errs: string[] = []
  const walk = (x: any, d: number) => {
    if (x.type === "ERROR" || x.isMissing) errs.push(`${x.type}[${x.startPosition.row+1}:${x.startPosition.column+1}]`)
    if (d < 7) for (let i = 0; i < x.childCount; i++) walk(x.child(i), d+1)
  }
  walk(t.rootNode, 0)
  console.log(`--- ${wasm.includes('/') ? wasm.split('/').slice(-2).join('/') : wasm}`)
  console.log("  errors:", JSON.stringify(errs))
  // find the declarator's value shape
  const dump = (x: any, d: number) => {
    const s = `${"  ".repeat(d)}${x.type}${x.childCount === 0 ? " " + JSON.stringify(x.text.slice(0, 18)) : ""}`
    console.log(s)
    if (d < 6 && x.childCount && x.childCount <= 9) for (let i = 0; i < x.childCount; i++) dump(x.child(i), d+1)
  }
  // locate the line's variable_declarator
  const find = (x: any): any => { if (x.type === "variable_declarator") return x; for (let i = 0; i < x.childCount; i++) { const r = find(x.child(i)); if (r) return r } return null }
  const v = find(t.rootNode)
  if (v) dump(v, 1)
}
