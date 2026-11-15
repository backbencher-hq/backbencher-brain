// #841 round 23 bisect: T2 repro — bare-arg command call + dotted-call closure body
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const CASES: Array<[string, string]> = [
  ["T2 jar.doFirst", `jar.doFirst {\n  jar.manifest.attributes.remove('X')\n}\n`],
  ["T2b class-wrapped", `class C {\n  def m() {\n    jar.doFirst {\n      jar.manifest.attributes.remove('X')\n    }\n  }\n}\n`],
  ["T2c deeper body", `class C {\n  def m() {\n    jar.doFirst {\n      jar.manifest.attributes.remove('X')\n      println 'done'\n    }\n  }\n}\n`],
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
    console.log(`  ${name.padEnd(20)} ${errs.length === 0 ? "CLEAN" : "ERR " + errs.slice(0, 2).join(",")}`)
  }
}
