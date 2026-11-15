import * as fs from "fs"
async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync(process.argv[2]))
  const parser = new P(); parser.setLanguage(lang)
  const cases = [
    ["W1 ternary with method-call cond", `class A {\n  def f() {\n    def x = project.hasProperty(P) ? 'a' : 'b'\n  }\n}\n`],
    ["W2 dotted chain call", `class A {\n  def f() {\n    project.layout.buildDirectory.dir(PATH)\n  }\n}\n`],
    ["W3 setter chain", `class A {\n  def f() {\n    it.reports.xml.required.set(true)\n  }\n}\n`],
    ["W4 ternary control", `class A {\n  def f(p) {\n    def x = p ? 'a' : 'b'\n  }\n}\n`],
    ["W5 generic local decl", `class A {\n  def f() {\n    Provider<Directory> generatedDir = project.layout.buildDirectory.dir(PATH)\n  }\n}\n`],
  ]
  for (const [cls, src] of cases) {
    const tree = parser.parse(src)
    const bad = (tree.rootNode as any).hasError
    console.log(`${bad ? "FAIL" : "OK  "} ${cls}`)
  }
}
main()
