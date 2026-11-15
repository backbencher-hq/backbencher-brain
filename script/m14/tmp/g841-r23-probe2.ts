// #841 round 23: boundary probe — which ingredient poisons what
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const CASES: Array<[string, string]> = [
  // r23 target family
  ["V1 varargs closure", `class C {\n  def m() {\n    each { String... names ->\n      names.each { println it }\n    }\n  }\n}\n`],
  ["V2 default closure", `class C {\n  def m() {\n    each { String filePath = null ->\n      println filePath\n    }\n  }\n}\n`],
  ["V3 varargs+default", `class C {\n  def m() {\n    each { String... names = null ->\n      println names\n    }\n  }\n}\n`],
  // T2 repro (the regression vector)
  ["T2 jar.doFirst", `jar.doFirst {\n  jar.manifest.attributes.remove('X')\n}\n`],
  ["T2b class-wrapped", `class C {\n  def m() {\n    jar.doFirst {\n      jar.manifest.attributes.remove('X')\n    }\n  }\n}\n`],
  // r22 must-still-hold shapes
  ["R22 typed closure", `class C {\n  def m() {\n    project.tasks.register('bom', Bar) { Bar task ->\n      task.xmlOutput.convention(reportDir)\n    }\n  }\n}\n`],
  ["R22 untyped closure", `class C {\n  def m() {\n    project.tasks.register('bom') { task ->\n      task.xmlOutput.convention(reportDir)\n    }\n  }\n}\n`],
]
for (const W of process.argv.slice(2)) {
  const lang = await L.load(fs.readFileSync(W))
  const parser = new P(); parser.setLanguage(lang)
  console.log(`===== ${W}`)
  for (const [name, src] of CASES) {
    const t = parser.parse(src).rootNode
    const errs: string[] = []
    const walk = (n: any): void => {
      if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex) errs.push(`${n.type}[${n.startPosition.row + 1}] len=${n.endIndex - n.startIndex}`)
      for (let i = 0; i < n.childCount; i++) walk(n.child(i))
    }
    walk(t)
    console.log(`  ${name.padEnd(22)} ${errs.length === 0 ? "CLEAN" : "ERR " + errs.slice(0, 2).join(",")}`)
  }
}
