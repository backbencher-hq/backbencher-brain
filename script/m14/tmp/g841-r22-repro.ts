// #841 round 22: minimal repro for the GrailsGradlePlugin regression
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

const CASES: Array<[string, string]> = [
  ["V0 full shape", `class C {\n  protected Closure<String> f(GroovyCompile compile, Project project) {\n    return { ->\n      Set<String> starImports = new LinkedHashSet<>()\n      if (grails.importJavaTime) {\n        starImports.add('java.time')\n      }\n      starImports.join(' ')\n    }\n  }\n}\n`],
  ["V1 no typed decl body", `class C {\n  protected Closure<String> f() {\n    return { ->\n      x.add('java.time')\n    }\n  }\n}\n`],
  ["V2 typed decl no arrow", `class C {\n  protected Closure<String> f() {\n    return {\n      Set<String> starImports = new LinkedHashSet<>()\n    }\n  }\n}\n`],
  ["V3 no return", `class C {\n  protected Closure<String> f() {\n    { ->\n      Set<String> starImports = new LinkedHashSet<>()\n    }\n  }\n}\n`],
  ["V4 def method", `class C {\n  def f() {\n    return { ->\n      Set<String> starImports = new LinkedHashSet<>()\n    }\n  }\n}\n`],
  ["V5 untyped decl", `class C {\n  protected Closure<String> f() {\n    return { ->\n      starImports = new LinkedHashSet<>()\n    }\n  }\n}\n`],
]
for (const W of [process.argv[2] ?? "/tmp/x22-base.wasm"]) {
  const lang = await L.load(fs.readFileSync(W))
  const parser = new P(); parser.setLanguage(lang)
  console.log(`===== ${W}`)
  for (const [name, src] of CASES) {
    const root = parser.parse(src).rootNode
    const errs: string[] = []
    const walk = (n: any): void => {
      if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) errs.push(`[${n.startPosition.row + 1}] len=${n.endIndex - n.startIndex}`)
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(root)
    console.log(`  ${name.padEnd(24)} ${errs.length === 0 ? "CLEAN" : "ERR " + errs.slice(0, 2).join(",")}`)
  }
}
